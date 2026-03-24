import { BehaviorSubject, Subject, Observable, filter, map, distinctUntilChanged } from "rxjs";
import type { ConnectionState, PiClientConfig, SessionListItem } from "../types";
import type { StreamEventEnvelope, ImageContent } from "../types/stream-events";
import type { ChatMessage, AgentMode, PendingExtensionUiRequest } from "../types/chat-message";
import { ApiClient } from "./api-client";
import { StreamConnection } from "./stream-connection";
import { SessionStreamConnection } from "./session-stream-connection";
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
  private readonly _sessionStreams = new Map<string, SessionStreamConnection>();
  private readonly _staleSessionIds = new Set<string>();
  private readonly _activeSessionIds$ = new BehaviorSubject<Set<string>>(new Set());
  private readonly _config: PiClientConfig;
  private readonly _serverRestart$ = new Subject<void>();
  private readonly _fileSystemChanged$ = new Subject<void>();
  private _instanceId: string | null = null;
  private _activeSessionIds = new Set<string>();
  private _viewedSessionId: string | null = null;

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
      if (__DEV__) console.log("[pi:global]", envelope.type, envelope.session_id, envelope.id, envelope.data);
      this._processEvent(envelope);
    });

    this._stream.instanceId$.subscribe((instanceId) => {
      this._handleInstanceId(instanceId);
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
    for (const stream of this._sessionStreams.values()) {
      stream.destroy();
    }
    this._sessionStreams.clear();
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

  async openSession(
    sessionId: string,
    params: { workspaceId?: string; sessionFile: string },
  ): Promise<void> {
    if (this._viewedSessionId && this._viewedSessionId !== sessionId) {
      const prev = this._viewedSessionId;
      if (__DEV__) console.log("[pi:session]", "auto-close previous", prev);
      this._closeSessionStream(prev);
    }
    this._viewedSessionId = sessionId;

    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();

    if (current.isReady) {
      this._ensureSessionStream(sessionId);
      return;
    }
    subject.next({ ...current, isLoading: true });

    try {
      if (params.workspaceId) {
        await this.api.touchAgentSession(sessionId, {
          workspaceId: params.workspaceId,
          sessionFile: params.sessionFile,
        });
      } else {
        await this.api.touchChatSession(sessionId, params.sessionFile);
      }
    } catch {
      subject.next({ ...current, isLoading: false });
      return;
    }

    const sessionStream = this._getOrCreateSessionStream(sessionId);
    sessionStream.connect(sessionId);

    try {
      const state = await this.api.getState(sessionId);
      const pending = (state as Record<string, unknown>)["pendingExtensionUiRequest"];
      if (pending && typeof pending === "object" && "id" in pending && "method" in pending) {
        const latest = subject.getValue();
        subject.next({
          ...latest,
          pendingExtensionUiRequest: pending as PendingExtensionUiRequest,
        });
      }
    } catch {
      // state fetch failed
    }

    const latest = subject.getValue();
    subject.next({ ...latest, isReady: true, isLoading: false });
  }

  closeSession(sessionId: string): void {
    if (__DEV__) console.log("[pi:close]", sessionId);
    if (this._viewedSessionId === sessionId) {
      this._viewedSessionId = null;
    }
    this._closeSessionStream(sessionId);
  }

  private _closeSessionStream(sessionId: string): void {
    const stream = this._sessionStreams.get(sessionId);
    if (stream) {
      if (__DEV__) console.log("[pi:close]", "disconnecting stream", sessionId, stream.stateSnapshot.status);
      stream.disconnect();
    }
  }

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

  getSessionSnapshot(sessionId: string): SessionState {
    return this._getOrCreateSessionSubject(sessionId).getValue();
  }

  hasMoreMessages$(sessionId: string): Observable<boolean> {
    return this.session$(sessionId).pipe(map((s) => s.hasMoreMessages), distinctUntilChanged());
  }

  async loadOlderMessages(sessionId: string, limit = 20): Promise<void> {
    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();
    if (!current.hasMoreMessages || current.isLoadingOlderMessages) return;

    subject.next({ ...current, isLoadingOlderMessages: true });

    try {
      const temp = new SessionStreamConnection({
        serverUrl: this._config.serverUrl,
        getAccessToken: () => this._config.accessToken,
      });

      const result = await new Promise<StreamEventEnvelope | null>((resolve) => {
        const timeout = setTimeout(() => {
          temp.destroy();
          resolve(null);
        }, 10000);

        temp.historyEvents$.subscribe((envelope) => {
          clearTimeout(timeout);
          temp.destroy();
          resolve(envelope);
        });

        temp.historyDone$.subscribe(() => {
          clearTimeout(timeout);
          temp.destroy();
          resolve(null);
        });

        temp.connect(sessionId, undefined, current.oldestEntryId ?? undefined, limit);
      });

      if (result) {
        this._processHistoryEvent(sessionId, result, true);
      } else {
        subject.next({ ...subject.getValue(), isLoadingOlderMessages: false });
      }
    } catch {
      subject.next({ ...subject.getValue(), isLoadingOlderMessages: false });
    }
  }

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

  async createAgentSession(params: { workspaceId: string; sessionPath?: string }) {
    const info = await this.api.createAgentSession(params);
    const subject = this._getOrCreateSessionSubject(info.session_id);
    subject.next({ ...createEmptySessionState(), isReady: true });
    this.loadSessions(params.workspaceId, { page: 1 });
    return info;
  }

  async createChatSession(params?: { noTools?: boolean; systemPrompt?: string }) {
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
  // Internal
  // ---------------------------------------------------------------------------

  private _knownStreamSessionIds = new Set<string>();

  private _isSessionStreamActive(sessionId: string): boolean {
    const stream = this._sessionStreams.get(sessionId);
    return !!stream && stream.stateSnapshot.status === "connected";
  }

  private _handleInstanceId(instanceId: string): void {
    if (this._instanceId !== null && this._instanceId !== instanceId) {
      for (const [id, subject] of this._sessionStates) {
        if (!this._activeSessionIds.has(id)) {
          subject.next({ ...createEmptySessionState(), isLoading: true });
        }
      }
      for (const stream of this._sessionStreams.values()) {
        stream.disconnect();
      }
      this._knownStreamSessionIds.clear();
      this._staleSessionIds.clear();
      this._serverRestart$.next();
    }
    this._instanceId = instanceId;
  }

  private _processEvent(envelope: StreamEventEnvelope): void {
    const sessionId = envelope.session_id;

    if (envelope.type === "history_messages") {
      this._processHistoryEvent(sessionId, envelope);
      return;
    }

    if (envelope.type === "agent_end" && !this._isSessionStreamActive(sessionId)) {
      this._staleSessionIds.add(sessionId);
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

  private _processHistoryEvent(sessionId: string, envelope: StreamEventEnvelope, prepend = false): void {
    const data = envelope.data as unknown as Record<string, unknown>;
    if (data["type"] !== "history_messages") return;

    const rawMessages = data["messages"] as Record<string, string>[];
    const hasMore = data["has_more"] === true;
    const oldestEntryId = (data["oldest_entry_id"] as string) ?? null;

    if (__DEV__) console.log("[pi:history]", sessionId, rawMessages?.length ?? 0, "messages", prepend ? "(prepend)" : "(replace)", "hasMore:", hasMore);

    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();

    if (!rawMessages || rawMessages.length === 0) {
      subject.next({ ...current, hasMoreMessages: hasMore, oldestEntryId, isLoadingOlderMessages: false });
      return;
    }

    const converted = convertRawMessages(rawMessages);

    if (prepend) {
      subject.next({
        ...current,
        messages: [...converted, ...current.messages],
        hasMoreMessages: hasMore,
        oldestEntryId,
        isLoadingOlderMessages: false,
      });
    } else {
      subject.next({
        ...current,
        messages: converted,
        hasMoreMessages: hasMore,
        oldestEntryId,
        isLoadingOlderMessages: false,
      });
    }
  }

  private _ensureSessionStream(sessionId: string): void {
    const isStale = this._staleSessionIds.has(sessionId);
    this._staleSessionIds.delete(sessionId);

    const stream = this._sessionStreams.get(sessionId);
    if (stream && stream.stateSnapshot.status === "connected" && !isStale) {
      if (__DEV__) console.log("[pi:session]", "already connected", sessionId);
      return;
    }

    const sessionStream = this._getOrCreateSessionStream(sessionId);

    if (isStale) {
      if (__DEV__) console.log("[pi:session]", "reconnect (stale)", sessionId);
      sessionStream.connect(sessionId);
    } else {
      const hasMessages = this._getOrCreateSessionSubject(sessionId).getValue().messages.length > 0;
      if (hasMessages) {
        if (__DEV__) console.log("[pi:session]", "reconnect (SKIP_HISTORY, cached)", sessionId);
        sessionStream.connect(sessionId, "SKIP_HISTORY");
      } else {
        if (__DEV__) console.log("[pi:session]", "connect (fresh)", sessionId);
        sessionStream.connect(sessionId);
      }
    }
  }

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

  private _getOrCreateSessionStream(sessionId: string): SessionStreamConnection {
    let stream = this._sessionStreams.get(sessionId);
    if (!stream) {
      stream = new SessionStreamConnection({
        serverUrl: this._config.serverUrl,
        getAccessToken: () => this._config.accessToken,
      });

      stream.historyEvents$.subscribe((envelope) => {
        if (__DEV__) console.log("[pi:sess-history]", sessionId, envelope.type, envelope.data);
        this._processHistoryEvent(sessionId, envelope);
      });

      stream.events$.subscribe((envelope) => {
        if (__DEV__) console.log("[pi:sess-live]", sessionId, envelope.type, envelope.id, envelope.data);
        this._processEvent(envelope);
      });

      this._sessionStreams.set(sessionId, stream);
    }
    return stream;
  }
}
