import { BehaviorSubject, Subject, Observable, filter, map, distinctUntilChanged } from "rxjs";
import type { ConnectionState, PiClientConfig, SessionListItem } from "../types";
import type { StreamEventEnvelope, ImageContent } from "../types/stream-events";
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
  private readonly _config: PiClientConfig;
  private readonly _serverRestart$ = new Subject<void>();
  private _instanceId: string | null = null;
  private _activeSessionIds = new Set<string>();

  constructor(config: PiClientConfig) {
    this._config = config;
    this.api = new ApiClient(config.serverUrl, config.accessToken);
    this._stream = new StreamConnection({
      serverUrl: config.serverUrl,
      getAccessToken: () => this._config.accessToken,
      onAuthError: config.onAuthError,
      reconnectBaseMs: config.reconnectBaseMs,
      reconnectMaxMs: config.reconnectMaxMs,
    });

    this._stream.events$.subscribe((envelope) => {
      this._processEvent(envelope);
    });

    this._stream.instanceId$.subscribe((instanceId) => {
      this._handleInstanceId(instanceId);
    });

    this._stream.activeSessions$.subscribe((sessionIds) => {
      this._activeSessionIds = new Set(sessionIds);
    });
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

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

  updateToken(accessToken: string): void {
    (this._config as { accessToken: string }).accessToken = accessToken;
    this.api.updateToken(accessToken);
  }

  // ---------------------------------------------------------------------------
  // Raw events
  // ---------------------------------------------------------------------------

  get events$(): Observable<StreamEventEnvelope> {
    return this._stream.events$;
  }

  sessionEvents$(sessionId: string): Observable<StreamEventEnvelope> {
    return this._stream.events$.pipe(filter((e) => e.session_id === sessionId));
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle — PiClient owns all logic
  // ---------------------------------------------------------------------------

  async openSession(
    sessionId: string,
    params: { workspaceId?: string; sessionFile: string },
  ): Promise<void> {
    const subject = this._getOrCreateSessionSubject(sessionId);
    const current = subject.getValue();

    if (current.isReady) return;
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

    try {
      const result = await this.api.getMessages(sessionId);
      const rawMessages = result.messages;
      if (rawMessages && rawMessages.length > 0) {
        const messages = convertRawMessages(rawMessages);
        const latest = subject.getValue();
        if (!latest.isStreaming && messages.length > latest.messages.length) {
          subject.next({ ...latest, messages });
        }
      }
    } catch {
      // no history
    }

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

  closeSession(_sessionId: string): void {
    // no-op: keep cached state so switching back is instant
  }

  // ---------------------------------------------------------------------------
  // Session state — single observable per session
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

  getSessionSnapshot(sessionId: string): SessionState {
    return this._getOrCreateSessionSubject(sessionId).getValue();
  }

  // ---------------------------------------------------------------------------
  // Session list (paginated)
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
  // Agent actions — fire and forget, SSE handles state updates
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

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  async createAgentSession(params: { workspaceId: string; sessionPath?: string }) {
    const info = await this.api.createAgentSession(params);
    this.loadSessions(params.workspaceId, { page: 1 });
    return info;
  }

  async createChatSession(params?: { noTools?: boolean; systemPrompt?: string }) {
    return this.api.createChatSession(params);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  private _handleInstanceId(instanceId: string): void {
    if (this._instanceId !== null && this._instanceId !== instanceId) {
      for (const [id, subject] of this._sessionStates) {
        if (!this._activeSessionIds.has(id)) {
          subject.next({ ...createEmptySessionState(), isLoading: true });
        }
      }
      this._knownStreamSessionIds.clear();
      this._serverRestart$.next();
    }
    this._instanceId = instanceId;
  }

  private _processEvent(envelope: StreamEventEnvelope): void {
    const sessionId = envelope.session_id;
    const subject = this._getOrCreateSessionSubject(sessionId);
    const currentState = subject.getValue();
    const nextState = reduceStreamEvent(currentState, envelope);
    if (nextState !== currentState) {
      subject.next(nextState);
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
