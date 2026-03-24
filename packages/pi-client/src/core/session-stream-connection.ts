import { Subject, BehaviorSubject, Observable } from "rxjs";
import type { StreamEventEnvelope } from "../types/stream-events";
import { XhrEventSource } from "./event-source";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export type SessionStreamStatus = "idle" | "connecting" | "loading_history" | "connected" | "disconnected";

export interface SessionStreamState {
  status: SessionStreamStatus;
  sessionId: string | null;
}

export interface SessionStreamConfig {
  serverUrl: string;
  getAccessToken: () => string;
  getResumeCursor?: (sessionId: string) => string | undefined;
  onAuthError?: () => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

function isStreamEventPayload(value: object): boolean {
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "number" &&
    typeof v["session_id"] === "string" &&
    typeof v["type"] === "string" &&
    typeof v["timestamp"] === "number" &&
    typeof v["data"] === "object" &&
    v["data"] !== null
  );
}

export class SessionStreamConnection {
  private readonly _events$ = new Subject<StreamEventEnvelope>();
  private readonly _historyEvents$ = new Subject<StreamEventEnvelope>();
  private readonly _historyDone$ = new Subject<void>();
  private readonly _state$ = new BehaviorSubject<SessionStreamState>({
    status: "idle",
    sessionId: null,
  });

  private readonly _config: SessionStreamConfig;
  private _es: XhrEventSource | null = null;
  private _sessionId: string | null = null;
  private _lastMessageId: string | undefined;
  private _before: string | undefined;
  private _limit: number | undefined;
  private _retryCount = 0;
  private _autoReconnect = true;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(config: SessionStreamConfig) {
    this._config = config;
  }

  get events$(): Observable<StreamEventEnvelope> {
    return this._events$.asObservable();
  }

  get historyEvents$(): Observable<StreamEventEnvelope> {
    return this._historyEvents$.asObservable();
  }

  get historyDone$(): Observable<void> {
    return this._historyDone$.asObservable();
  }

  get state$(): Observable<SessionStreamState> {
    return this._state$.asObservable();
  }

  get stateSnapshot(): SessionStreamState {
    return this._state$.getValue();
  }

  get currentSessionId(): string | null {
    return this._sessionId;
  }

  connect(
    sessionId: string,
    lastMessageId?: string,
    before?: string,
    limit?: number,
    autoReconnect = true,
  ): void {
    if (this._destroyed) return;

    this._clearReconnectTimer();
    this._close();
    this._sessionId = sessionId;
    this._lastMessageId = lastMessageId;
    this._before = before;
    this._limit = limit;
    this._retryCount = 0;
    this._autoReconnect = autoReconnect;
    this._setState({ status: "connecting", sessionId });
    this._openSse(sessionId);
  }

  disconnect(): void {
    if (__DEV__) console.log("[pi:sess-stream]", "disconnect", this._sessionId);
    this._clearReconnectTimer();
    this._close();
    this._sessionId = null;
    this._setState({ status: "idle", sessionId: null });
  }

  reconnect(): void {
    if (this._destroyed || !this._sessionId) return;
    this._clearReconnectTimer();
    this._close();
    this._retryCount = 0;
    this._setState({ status: "connecting", sessionId: this._sessionId });
    this._openSse(this._sessionId);
  }

  destroy(): void {
    this._destroyed = true;
    this._clearReconnectTimer();
    this._close();
    this._events$.complete();
    this._historyEvents$.complete();
    this._historyDone$.complete();
    this._state$.complete();
  }

  private _openSse(sessionId: string): void {
    if (this._destroyed) return;

    const url = this._buildUrl(sessionId);
    const token = this._config.getAccessToken();

    const es = new XhrEventSource(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this._es = es;

    let receivingHistory = true;

    es.addEventListener("open", () => {
      if (this._destroyed || this._sessionId !== sessionId) {
        es.close();
        return;
      }
      this._retryCount = 0;
      this._setState({ status: "loading_history", sessionId });
    });

    es.addEventListener("message", (event) => {
      if (this._destroyed || !event.data || this._sessionId !== sessionId) return;

      try {
        const raw = JSON.parse(event.data) as Record<string, unknown>;
        if (raw["type"] === "session_stream_hello") return;
        if (raw["type"] === "history_done") {
          receivingHistory = false;
          this._setState({ status: "connected", sessionId });
          this._historyDone$.next();
          return;
        }
      } catch {
        // not a control event
      }

      try {
        const parsed = JSON.parse(event.data) as object;
        if (typeof parsed === "object" && parsed !== null && isStreamEventPayload(parsed)) {
          const envelope = parsed as StreamEventEnvelope;
          if (receivingHistory) {
            this._historyEvents$.next(envelope);
          } else {
            this._events$.next(envelope);
          }
        }
      } catch {
        // parse error
      }
    });

    es.addEventListener("history", (event) => {
      if (this._destroyed || !event.data || this._sessionId !== sessionId) return;
      try {
        const parsed = JSON.parse(event.data) as object;
        if (typeof parsed === "object" && parsed !== null && isStreamEventPayload(parsed)) {
          this._historyEvents$.next(parsed as StreamEventEnvelope);
        }
      } catch {
        // parse error
      }
    });

    es.addEventListener("history_done", () => {
      if (this._destroyed || this._sessionId !== sessionId) return;
      receivingHistory = false;
      this._setState({ status: "connected", sessionId });
      this._historyDone$.next();
    });

    es.addEventListener("error", (event) => {
      if (this._destroyed || this._sessionId !== sessionId) return;
      const status = event.xhrStatus ?? 0;
      this._close();
      if (status === 401 || status === 403) {
        this._setState({ status: "disconnected", sessionId });
        this._config.onAuthError?.();
        return;
      }
      this._scheduleReconnect(sessionId);
    });

    es.addEventListener("close", () => {
      if (this._destroyed || this._sessionId !== sessionId) return;
      this._close();
      this._scheduleReconnect(sessionId);
    });
  }

  private _close(): void {
    if (this._es) {
      this._es.removeAllEventListeners();
      this._es.close();
      this._es = null;
    }
  }

  private _setState(state: SessionStreamState): void {
    this._state$.next(state);
  }

  private _scheduleReconnect(sessionId: string): void {
    if (this._destroyed || !this._autoReconnect) {
      this._setState({ status: "disconnected", sessionId });
      return;
    }
    if (this._reconnectTimer) return;

    this._retryCount += 1;
    const baseMs = this._config.reconnectBaseMs ?? RECONNECT_BASE_MS;
    const maxMs = this._config.reconnectMaxMs ?? RECONNECT_MAX_MS;
    const delay = Math.min(baseMs * Math.pow(2, Math.max(0, this._retryCount - 1)), maxMs);
    this._setState({ status: "disconnected", sessionId });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._destroyed || this._sessionId !== sessionId) return;
      this._setState({ status: "connecting", sessionId });
      this._openSse(sessionId);
    }, delay);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _resolveLastMessageId(sessionId: string): string | undefined {
    if (this._retryCount > 0 && !this._before) {
      return this._config.getResumeCursor?.(sessionId) ?? this._lastMessageId;
    }
    return this._lastMessageId;
  }

  private _buildUrl(sessionId: string): string {
    const url = new URL(`${this._config.serverUrl}/api/stream/${encodeURIComponent(sessionId)}`);
    const lastMessageId = this._resolveLastMessageId(sessionId);
    if (lastMessageId) {
      url.searchParams.set("last_message_id", lastMessageId);
    }
    if (this._before) {
      url.searchParams.set("before", this._before);
    }
    if (this._limit) {
      url.searchParams.set("limit", String(this._limit));
    }
    return url.toString();
  }
}
