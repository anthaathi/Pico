import { Subject, BehaviorSubject, Observable } from "rxjs";
import type { ConnectionState } from "../types";
import type { StreamEventEnvelope } from "../types/stream-events";
import { XhrEventSource } from "./event-source";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function getReconnectDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), maxMs);
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

function parseStreamEvents(raw: string): StreamEventEnvelope[] {
  try {
    const parsed = JSON.parse(raw) as object | object[];
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.filter(
      (item): item is StreamEventEnvelope =>
        typeof item === "object" && item !== null && isStreamEventPayload(item),
    );
  } catch {
    return [];
  }
}

export interface StreamConnectionConfig {
  serverUrl: string;
  getAccessToken: () => string;
  onAuthError?: () => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class StreamConnection {
  private readonly _events$ = new Subject<StreamEventEnvelope>();
  private readonly _connection$ = new BehaviorSubject<ConnectionState>({
    status: "idle",
    retryAttempt: 0,
    nextRetryAt: null,
    lastDisconnectReason: null,
    disconnectedAt: null,
  });
  private readonly _instanceId$ = new Subject<string>();
  private readonly _activeSessions$ = new Subject<string[]>();

  private readonly _config: StreamConnectionConfig;
  private _lastEventId: number | null = null;
  private _retryCount = 0;
  private _es: XhrEventSource | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(config: StreamConnectionConfig) {
    this._config = config;
  }

  get events$(): Observable<StreamEventEnvelope> {
    return this._events$.asObservable();
  }

  get connection$(): Observable<ConnectionState> {
    return this._connection$.asObservable();
  }

  get instanceId$(): Observable<string> {
    return this._instanceId$.asObservable();
  }

  get activeSessions$(): Observable<string[]> {
    return this._activeSessions$.asObservable();
  }

  get connectionSnapshot(): ConnectionState {
    return this._connection$.getValue();
  }

  get lastEventId(): number | null {
    return this._lastEventId;
  }

  connect(): void {
    if (this._destroyed) return;
    this._close();
    this._clearReconnectTimer();
    this._retryCount = 0;
    this._openSse();
  }

  disconnect(): void {
    this._destroyed = true;
    this._clearReconnectTimer();
    this._close();
    this._setConnection({ status: "idle" });
    this._events$.complete();
    this._connection$.complete();
    this._instanceId$.complete();
    this._activeSessions$.complete();
  }

  reconnect(): void {
    if (this._destroyed) return;
    this._close();
    this._clearReconnectTimer();
    this._retryCount = 0;
    this._openSse();
  }

  private _openSse(): void {
    if (this._destroyed) return;

    const url = this._buildStreamUrl();
    const token = this._config.getAccessToken();

    this._setConnection({
      status: this._retryCount > 0 ? "reconnecting" : "connecting",
      retryAttempt: this._retryCount,
    });

    const es = new XhrEventSource(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    this._es = es;

    es.addEventListener("open", () => {
      if (this._destroyed) { es.close(); return; }
      this._retryCount = 0;
      this._setConnection({ status: "connected" });
    });

    es.addEventListener("message", (event) => {
      if (this._destroyed || !event.data) return;
      try {
        const raw = JSON.parse(event.data) as Record<string, unknown>;
        if (raw["type"] === "server_hello" && typeof raw["instance_id"] === "string") {
          this._instanceId$.next(raw["instance_id"] as string);
          return;
        }
        if (raw["type"] === "active_sessions" && Array.isArray(raw["session_ids"])) {
          this._activeSessions$.next(raw["session_ids"] as string[]);
          return;
        }
      } catch { /* not a control event, continue */ }
      const events = parseStreamEvents(event.data);
      for (const evt of events) {
        if (evt.id > 0) {
          this._lastEventId = evt.id;
        }
        this._events$.next(evt);
      }
    });

    es.addEventListener("error", (event) => {
      if (this._destroyed) { es.close(); return; }

      const status = event.xhrStatus ?? 0;
      if (status === 401 || status === 403) {
        this._close();
        this._setConnection({
          status: "disconnected",
          lastDisconnectReason: "Authentication expired. Sign in again to reconnect.",
          disconnectedAt: Date.now(),
        });
        this._config.onAuthError?.();
        return;
      }

      this._close();
      this._scheduleReconnect(event.message ?? "SSE connection lost");
    });

    es.addEventListener("close", () => {
      if (this._destroyed) return;
      this._close();
      this._scheduleReconnect("SSE connection closed");
    });
  }

  private _scheduleReconnect(reason: string): void {
    if (this._destroyed) return;

    this._retryCount += 1;
    const baseMs = this._config.reconnectBaseMs ?? RECONNECT_BASE_MS;
    const maxMs = this._config.reconnectMaxMs ?? RECONNECT_MAX_MS;
    const delay = getReconnectDelay(this._retryCount, baseMs, maxMs);

    this._setConnection({
      status: "reconnecting",
      retryAttempt: this._retryCount,
      nextRetryAt: Date.now() + delay,
      lastDisconnectReason: reason,
      disconnectedAt: this._connection$.getValue().disconnectedAt ?? Date.now(),
    });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openSse();
    }, delay);
  }

  private _close(): void {
    if (this._es) {
      this._es.removeAllEventListeners();
      this._es.close();
      this._es = null;
    }
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _setConnection(partial: Partial<ConnectionState>): void {
    const current = this._connection$.getValue();
    this._connection$.next({
      status: partial.status ?? current.status,
      retryAttempt: partial.retryAttempt ?? 0,
      nextRetryAt: partial.nextRetryAt ?? null,
      lastDisconnectReason: partial.lastDisconnectReason ?? null,
      disconnectedAt: partial.disconnectedAt ?? null,
    });
  }

  private _buildStreamUrl(): string {
    const url = new URL(`${this._config.serverUrl}/api/stream`);
    if (this._lastEventId !== null) {
      url.searchParams.set("from", String(this._lastEventId));
    }
    return url.toString();
  }
}
