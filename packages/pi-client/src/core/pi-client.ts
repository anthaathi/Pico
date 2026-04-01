import { BehaviorSubject, Subject, Observable, filter, map, distinctUntilChanged } from "rxjs";
import type { ConnectionState, PiClientConfig, SessionListItem } from "../types";
import type { StreamEventEnvelope, ImageContent, AgentStateData } from "../types/stream-events";
import type { ChatMessage, AgentMode, PendingExtensionUiRequest } from "../types/chat-message";
import { ApiClient } from "./api-client";
import { StreamConnection } from "./stream-connection";
import { reduceStreamEvent, createEmptySessionState, convertRawMessages, type SessionState } from "./message-reducer";

export interface SessionListState {
  items: SessionListItem[];
  page: number;
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
}

export class PiClient {
  readonly api: ApiClient;
  private readonly _stream: StreamConnection;
  private readonly _sessionStates = new Map<string, BehaviorSubject<SessionState>>();
  private readonly _sessionListStates = new Map<string, BehaviorSubject<SessionListState>>();
  private readonly _activeSessionIds$ = new BehaviorSubject<Set<string>>(new Set());
  private readonly _config: PiClientConfig;
  private readonly _serverRestart$ = new Subject<void>();
  private readonly _fileSystemChanged$ = new Subject<void>();
  private _instanceId: string | null = null;
  private _activeSessionIds = new Set<string>();
  private _viewedSessionId: string | null = null;
  private _pendingActiveSession: string | null | undefined = undefined;
  private readonly _highWaterMarks = new Map<string, number>();
  private readonly _deltaHighWaterMarks = new Map<string, number>();

  constructor(config: PiClientConfig) {
    this._config = config;
    this.api = new ApiClient(config.serverUrl, config.accessToken);
    if (config.onApiAuthError) {
      this.api.setAuthErrorHandler(config.onApiAuthError);
    }
    this._stream = new StreamConnection({
      serverUrl: config.serverUrl,
      getAccessToken: () => this._config.accessToken,
      onAuthError: config.onAuthError,
      reconnectBaseMs: config.reconnectBaseMs,
      reconnectMaxMs: config.reconnectMaxMs,
    });

    this._stream.events$.subscribe((envelope) => {
      if (__DEV__) console.log("[pi:stream]", envelope.type, envelope.session_id, envelope.id);
      this._processEvent(envelope);
    });

    this._stream.instanceId$.subscribe((instanceId) => {
      this._handleInstanceId(instanceId);
    });

    this._stream.connectionId$.subscribe(() => {
      const sessionId = this._pendingActiveSession !== undefined
        ? this._pendingActiveSession
        : this._viewedSessionId;
      this._pendingActiveSession = undefined;

      if (sessionId) {
        this._fetchAndApplyHistory(sessionId).then(() => {
          this._sendActiveSession(sessionId);
        });
      }
    });

    this._stream.activeSessions$.subscribe((sessionIds) => {
      this._activeSessionIds = new Set(sessionIds);
      this._activeSessionIds$.next(this._activeSessionIds);
    });
  }

  get connection$(): Observable<ConnectionState> {
    return this._stream.connection$;
  }

  get connectionSnapshot(): ConnectionState {
    return this._stream.connectionSnapshot;
  }

  connect(): void {
    this._stream.connect();
  }

  disconnect(): void {
    this._stream.disconnect();
  }

  reconnect(): void {
    this._stream.reconnect();
  }

  get serverRestart$(): Observable<void> {
    return this._serverRestart$.asObservable();
  }

  get fileSystemChanged$(): Observable<void> {
    return this._fileSystemChanged$.asObservable();
  }

  get activeSessions$(): Observable<Set<string>> {
    return this._activeSessionIds$.asObservable();
  }

  isSessionActive(sessionId: string): boolean {
    return this._activeSessionIds.has(sessionId);
  }

  updateToken(accessToken: string): void {
    (this._config as { accessToken: string }).accessToken = accessToken;
    this.api.updateToken(accessToken);
  }

  get events$(): Observable<StreamEventEnvelope> {
    return this._stream.events$;
  }

  sessionEvents$(sessionId: string): Observable<StreamEventEnvelope> {
    return this._stream.events$.pipe(filter((e) => e.session_id === sessionId));
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  async openSession(
    sessionId: string,
    params: { workspaceId?: string; sessionFile: string },
  ): Promise<void> {
    this._viewedSessionId = sessionId;

    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();

    const touch = async () => {
      if (params.workspaceId) {
        await this.api.touchAgentSession(sessionId, {
          workspaceId: params.workspaceId,
          sessionFile: params.sessionFile,
        });
      } else {
        await this.api.touchChatSession(sessionId, params.sessionFile);
      }
    };

    if (current.isReady) {
      touch().catch(() => {});
      await this._fetchAndApplyHistory(sessionId);
      this._setActiveSessionOnBackend(sessionId);
      return;
    }

    subject.next({ ...current, isLoading: true });

    try { await touch(); } catch {
      await this._fetchAndApplyHistory(sessionId);
      this._setActiveSessionOnBackend(sessionId);
      return;
    }

    await this._fetchAndApplyHistory(sessionId);
    this._setActiveSessionOnBackend(sessionId);
  }

  closeSession(sessionId: string): void {
    if (__DEV__) console.log("[pi:close]", sessionId);
    if (this._viewedSessionId === sessionId) {
      this._viewedSessionId = null;
      this._setActiveSessionOnBackend(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Observables
  // ---------------------------------------------------------------------------

  session$(sessionId: string): Observable<SessionState> {
    return this._getOrCreateSessionSubject(sessionId).asObservable();
  }

  messages$(sessionId: string): Observable<ChatMessage[]> {
    return this.session$(sessionId).pipe(map((s) => s.messages), distinctUntilChanged());
  }

  isStreaming$(sessionId: string): Observable<boolean> {
    return this.session$(sessionId).pipe(map((s) => s.isStreaming), distinctUntilChanged());
  }

  mode$(sessionId: string): Observable<AgentMode> {
    return this.session$(sessionId).pipe(map((s) => s.mode), distinctUntilChanged());
  }

  pendingExtensionUiRequest$(sessionId: string): Observable<PendingExtensionUiRequest | null> {
    return this.session$(sessionId).pipe(map((s) => s.pendingExtensionUiRequest), distinctUntilChanged());
  }

  agentState$(sessionId: string): Observable<AgentStateData | null> {
    return this.session$(sessionId).pipe(map((s) => s.agentState), distinctUntilChanged());
  }

  getSessionSnapshot(sessionId: string): SessionState {
    return this._getOrCreateSessionSubject(sessionId).getValue();
  }

  hasMoreMessages$(sessionId: string): Observable<boolean> {
    return this.session$(sessionId).pipe(map((s) => s.hasMoreMessages), distinctUntilChanged());
  }

  // ---------------------------------------------------------------------------
  // Load older messages (pagination)
  // ---------------------------------------------------------------------------

  async loadOlderMessages(sessionId: string, limit = 50): Promise<void> {
    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();
    if (!current.hasMoreMessages || current.isLoadingOlderMessages) return;

    subject.next({ ...current, isLoadingOlderMessages: true });

    try {
      const result = await this.api.getSessionHistory(sessionId, {
        before: current.oldestEntryId ?? undefined,
        limit,
      });

      const rawMessages = result.messages as Record<string, string>[];
      if (rawMessages.length > 0) {
        const converted = convertRawMessages(rawMessages);
        const latest = subject.getValue();
        const existingKeys = new Set(latest.messages.map((m) => m.entryId).filter(Boolean));
        const unique = converted.filter((m) => !m.entryId || !existingKeys.has(m.entryId));
        subject.next({
          ...latest,
          messages: [...unique, ...latest.messages],
          hasMoreMessages: result.has_more,
          oldestEntryId: result.oldest_entry_id ?? null,
          isLoadingOlderMessages: false,
        });
      } else {
        subject.next({
          ...subject.getValue(),
          hasMoreMessages: result.has_more,
          oldestEntryId: result.oldest_entry_id ?? null,
          isLoadingOlderMessages: false,
        });
      }
    } catch {
      subject.next({ ...subject.getValue(), isLoadingOlderMessages: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Session list management
  // ---------------------------------------------------------------------------

  sessionList$(workspaceId: string): Observable<SessionListState> {
    return this._getOrCreateSessionListSubject(workspaceId).asObservable();
  }

  async loadSessions(workspaceId: string, params?: { page?: number; limit?: number }): Promise<void> {
    const subject = this._getOrCreateSessionListSubject(workspaceId);
    const current = subject.getValue();
    subject.next({ ...current, isLoading: true });

    try {
      const result = await this.api.listWorkspaceSessions(workspaceId, {
        page: params?.page ?? 1,
        limit: params?.limit ?? 20,
      });
      subject.next({
        items: result.items,
        page: result.page,
        total: result.total,
        hasMore: result.has_more,
        isLoading: false,
        isLoadingMore: false,
      });
    } catch {
      subject.next({ ...current, isLoading: false });
    }
  }

  async loadMoreSessions(workspaceId: string): Promise<void> {
    const subject = this._getOrCreateSessionListSubject(workspaceId);
    const current = subject.getValue();
    if (!current.hasMore || current.isLoadingMore) return;

    subject.next({ ...current, isLoadingMore: true });

    try {
      const nextPage = current.page + 1;
      const result = await this.api.listWorkspaceSessions(workspaceId, { page: nextPage, limit: 20 });
      subject.next({
        items: [...current.items, ...result.items],
        page: result.page,
        total: result.total,
        hasMore: result.has_more,
        isLoading: false,
        isLoadingMore: false,
      });
    } catch {
      subject.next({ ...current, isLoadingMore: false });
    }
  }

  async refreshSessions(workspaceId: string): Promise<void> {
    return this.loadSessions(workspaceId, { page: 1 });
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async prompt(sessionId: string, message: string, options?: {
    images?: ImageContent[];
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    return this.api.prompt({
      sessionId,
      message,
      images: options?.images,
      workspaceId: options?.workspaceId,
      sessionFile: options?.sessionFile,
    });
  }

  async steer(sessionId: string, message: string, options?: {
    images?: ImageContent[];
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    return this.api.steer({
      sessionId,
      message,
      images: options?.images,
      workspaceId: options?.workspaceId,
      sessionFile: options?.sessionFile,
    });
  }

  async followUp(sessionId: string, message: string, options?: {
    images?: ImageContent[];
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    return this.api.followUp({
      sessionId,
      message,
      images: options?.images,
      workspaceId: options?.workspaceId,
      sessionFile: options?.sessionFile,
    });
  }

  async abort(sessionId: string): Promise<void> {
    return this.api.abort(sessionId);
  }

  async setModel(sessionId: string, params: { provider: string; modelId: string }): Promise<void> {
    return this.api.setModel(sessionId, params);
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    return this.api.setThinkingLevel(sessionId, level);
  }

  async sendExtensionUiResponse(params: {
    sessionId: string;
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): Promise<void> {
    await this.api.extensionUiResponse(params);
    const subject = this._sessionStates.get(params.sessionId);
    if (subject) {
      const current = subject.getValue();
      subject.next({ ...current, pendingExtensionUiRequest: null });
    }
  }

  async killSession(sessionId: string): Promise<void> {
    await this.api.killSession(sessionId);
  }

  async createAgentSession(params: { workspaceId: string; sessionPath?: string; modeId?: string }) {
    const info = await this.api.createAgentSession(params);
    const subject = this._getOrCreateSessionSubject(info.session_id);
    subject.next({ ...createEmptySessionState(), isReady: true });
    this.loadSessions(params.workspaceId, { page: 1 });
    return info;
  }

  async createChatSession(params?: { noTools?: boolean; systemPrompt?: string; modeId?: string }) {
    return this.api.createChatSession(params);
  }

  waitForTurnEnd(sessionId: string): Promise<StreamEventEnvelope> {
    return new Promise((resolve) => {
      const sub = this.sessionEvents$(sessionId).pipe(
        filter((e) => e.type === "turn_end" || e.type === "agent_end"),
      ).subscribe((event) => {
        sub.unsubscribe();
        resolve(event);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Internal — event processing (single unified stream)
  // ---------------------------------------------------------------------------

  private _knownStreamSessionIds = new Set<string>();

  private _processEvent(envelope: StreamEventEnvelope): void {
    if (envelope.type === "history_messages") return;

    const sessionId = envelope.session_id;

    if (envelope.id > 0) {
      const hwm = this._highWaterMarks.get(sessionId) ?? 0;
      if (envelope.id <= hwm) {
        return;
      }
      this._highWaterMarks.set(sessionId, envelope.id);
      if (envelope.type === "message_update" || envelope.type === "tool_execution_update") {
        this._deltaHighWaterMarks.set(sessionId, envelope.id);
      }
    }

    const subject = this._getOrCreateSessionSubject(sessionId);
    const currentState = subject.getValue();
    const nextState = reduceStreamEvent(currentState, envelope);
    if (nextState !== currentState) {
      subject.next(nextState);
    }

    if (envelope.type === "turn_end") {
      this._fileSystemChanged$.next();
    } else if (envelope.type === "tool_execution_end") {
      const event = envelope.data as { toolName?: string } | undefined;
      const tool = event?.toolName ?? "";
      if (tool === "write" || tool === "edit" || tool === "bash") {
        this._fileSystemChanged$.next();
      }
    }

    if (
      envelope.type === "message_start" &&
      envelope.workspace_id &&
      !this._knownStreamSessionIds.has(sessionId)
    ) {
      this._knownStreamSessionIds.add(sessionId);
      const listSubject = this._sessionListStates.get(envelope.workspace_id);
      if (listSubject) {
        this.refreshSessions(envelope.workspace_id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — active session management
  // ---------------------------------------------------------------------------

  private _setActiveSessionOnBackend(sessionId: string | null): void {
    const connectionId = this._stream.connectionId;
    if (!connectionId) {
      this._pendingActiveSession = sessionId;
      return;
    }
    this._pendingActiveSession = undefined;
    this._sendActiveSession(sessionId);
  }

  private _sendActiveSession(sessionId: string | null): void {
    const connectionId = this._stream.connectionId;
    if (!connectionId) return;
    const fromEventId = sessionId ? this._highWaterMarks.get(sessionId) : undefined;
    const fromDeltaEventId = sessionId ? this._deltaHighWaterMarks.get(sessionId) : undefined;
    if (__DEV__) {
      console.log(
        "[pi:active-session]",
        "set",
        sessionId,
        "conn=",
        connectionId,
        "from=",
        fromEventId,
        "fromDelta=",
        fromDeltaEventId,
      );
    }
    this.api.setActiveSession(connectionId, sessionId, fromEventId, fromDeltaEventId).catch((err) => {
      if (__DEV__) console.warn("[pi:active-session]", "failed", err);
    });
  }

  private async _fetchAndApplyHistory(sessionId: string): Promise<void> {
    const subject = this._getOrCreateSessionSubject(sessionId);

    try {
      const result = await this.api.getSessionHistory(sessionId, { limit: 50 });
      const rawMessages = result.messages as Record<string, string>[];
      const converted = convertRawMessages(rawMessages);
      const current = subject.getValue();

      subject.next({
        ...current,
        messages: converted,
        hasMoreMessages: result.has_more,
        oldestEntryId: result.oldest_entry_id ?? null,
        isReady: true,
        isLoading: false,
        isLoadingOlderMessages: false,
        isStreaming: this._activeSessionIds.has(sessionId) ? true : current.isStreaming,
      });
    } catch {
      const current = subject.getValue();
      subject.next({ ...current, isReady: true, isLoading: false, isLoadingOlderMessages: false });
    }
  }

  private _handleInstanceId(instanceId: string): void {
    if (this._instanceId !== null && this._instanceId !== instanceId) {
      for (const [_id, subject] of this._sessionStates) {
        subject.next({ ...createEmptySessionState(), isLoading: true });
      }
      this._knownStreamSessionIds.clear();
      this._highWaterMarks.clear();
      this._deltaHighWaterMarks.clear();
      this._serverRestart$.next();
    }
    this._instanceId = instanceId;
  }

  // ---------------------------------------------------------------------------
  // Internal — subject factories
  // ---------------------------------------------------------------------------

  private _getOrCreateSessionSubject(sessionId: string): BehaviorSubject<SessionState> {
    let subject = this._sessionStates.get(sessionId);
    if (!subject) {
      subject = new BehaviorSubject<SessionState>(createEmptySessionState());
      this._sessionStates.set(sessionId, subject);
    }
    return subject;
  }

  private _getOrCreateSessionListSubject(workspaceId: string): BehaviorSubject<SessionListState> {
    let subject = this._sessionListStates.get(workspaceId);
    if (!subject) {
      subject = new BehaviorSubject<SessionListState>({
        items: [],
        page: 0,
        total: 0,
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
      });
      this._sessionListStates.set(workspaceId, subject);
    }
    return subject;
  }

}
