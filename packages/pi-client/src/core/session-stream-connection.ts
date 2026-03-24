import { Subject, BehaviorSubject, Observable } from "rxjs";
import type { StreamEventEnvelope } from "../types/stream-events";
import { XhrEventSource } from "./event-source";

export type SessionStreamStatus = "idle" | "connecting" | "loading_history" | "connected" | "disconnected";

export interface SessionStreamState {
  status: SessionStreamStatus;
  sessionId: string | null;
}

export interface SessionStreamConfig {
  serverUrl: string;
  getAccessToken: () => string;
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

  connect(sessionId: string, lastMessageId?: string, before?: string, limit?: number): void {
    if (this._destroyed) return;

    this._close();
    this._sessionId = sessionId;
    this._setState({ status: "connecting", sessionId });
    this._openSse(sessionId, lastMessageId, before, limit);
  }

  disconnect(): void {
    if (__DEV__) console.log("[pi:sess-stream]", "disconnect", this._sessionId);
    this._close();
    this._sessionId = null;
    this._setState({ status: "idle", sessionId: null });
  }

  destroy(): void {
    this._destroyed = true;
    this._close();
    this._events$.complete();
    this._historyEvents$.complete();
    this._historyDone$.complete();
    this._state$.complete();
  }

  private _openSse(sessionId: string, lastMessageId?: string, before?: string, limit?: number): void {
    if (this._destroyed) return;

    const url = this._buildUrl(sessionId, lastMessageId, before, limit);
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

    es.addEventListener("error", () => {
      if (this._destroyed || this._sessionId !== sessionId) return;
      this._close();
      this._setState({ status: "disconnected", sessionId });
    });

    es.addEventListener("close", () => {
      if (this._destroyed || this._sessionId !== sessionId) return;
      this._close();
      this._setState({ status: "disconnected", sessionId });
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

  private _buildUrl(sessionId: string, lastMessageId?: string, before?: string, limit?: number): string {
    const url = new URL(`${this._config.serverUrl}/api/stream/${encodeURIComponent(sessionId)}`);
    if (lastMessageId) {
      url.searchParams.set("last_message_id", lastMessageId);
    }
    if (before) {
      url.searchParams.set("before", before);
    }
    if (limit) {
      url.searchParams.set("limit", String(limit));
    }
    return url.toString();
  }
}
