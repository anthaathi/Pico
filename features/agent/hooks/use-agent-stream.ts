import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { Platform } from "react-native";
import EventSource, { type EventSourceEvent } from "../event-source";
import { useAuthStore } from "@/features/auth/store";
import { useServersStore } from "@/features/servers/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { browserWindowHasAttention } from "../browser-notifications";
import { useAgentStore } from "../store";
import type { AgentConnectionState, StreamEvent } from "../types";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

type StreamTransportKind = "sse" | "ws";

type StreamErrorEvent =
  | ({ transport: "sse" } & EventSourceEvent)
  | {
      transport: "ws";
      type: "close" | "error";
      code?: number;
      reason?: string;
      message?: string;
      wasClean?: boolean;
    };

function isViewingWorkspace(
  pathname: string | null,
  workspaceId: string,
): boolean {
  if (!pathname) return false;
  return (
    pathname === `/workspace/${workspaceId}` ||
    pathname.startsWith(`/workspace/${workspaceId}/`)
  );
}

function getReconnectDelay(attempt: number): number {
  return Math.min(
    RECONNECT_BASE_MS * Math.pow(2, Math.max(0, attempt - 1)),
    RECONNECT_MAX_MS,
  );
}

function parseDisconnectMessage(message: string | undefined): string | null {
  const trimmed = message?.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown } | null;
    if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {}

  return trimmed;
}

function defaultTransport(): StreamTransportKind {
  return "sse";
}

function isAuthDisconnect(event?: StreamErrorEvent): boolean {
  if (!event) return false;

  if (event.transport === "ws") {
    return event.type === "close" && (event.code === 4401 || event.code === 4403);
  }

  return event.type === "error" && (event.xhrStatus === 401 || event.xhrStatus === 403);
}

function isRetryableDisconnect(event?: StreamErrorEvent): boolean {
  if (!event) return true;
  if (event.transport === "ws") {
    if (event.type === "error") {
      return true;
    }

    if (event.code === 4401 || event.code === 4403) {
      return false;
    }

    return true;
  }

  if (event.type === "timeout" || event.type === "exception") {
    return true;
  }
  if (event.type !== "error") {
    return true;
  }

  const status = event.xhrStatus ?? 0;
  if (status === 0) return true;
  if (status === 401 || status === 403) {
    return false;
  }

  return status >= 500 || status === 408;
}

function getDisconnectReason(event?: StreamErrorEvent): string {
  if (!event) {
    return "The connection to the server was lost.";
  }

  if (event.transport === "ws") {
    if (event.type === "error") {
      return event.message || "The websocket connection failed.";
    }

    if (event.code === 4401 || event.code === 4403) {
      return "Authentication expired. Sign in again to reconnect.";
    }

    return (
      parseDisconnectMessage(event.reason ?? event.message) ??
      "The websocket connection was lost."
    );
  }

  if (event.type === "timeout") {
    return "The server connection timed out.";
  }

  if (event.type === "exception") {
    return event.message || "The app hit a connection error.";
  }

  if (event.type === "error") {
    const status = event.xhrStatus ?? 0;
    if (status === 401 || status === 403) {
      return "Authentication expired. Sign in again to reconnect.";
    }
    if (status >= 500) {
      return "The server is temporarily unavailable.";
    }

    return (
      parseDisconnectMessage(event.message) ??
      "The connection to the server was lost."
    );
  }

  return "The connection to the server was lost.";
}

function buildStreamUrl(
  serverAddress: string,
  path: string,
  params: Record<string, string | number | null | undefined>,
) {
  const url = new URL(serverAddress);
  const basePath = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  url.pathname = `${basePath}${path}`;

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function buildSseStreamUrl(serverAddress: string, from: number | null) {
  return buildStreamUrl(serverAddress, "/api/stream", { from });
}

function buildWebSocketStreamUrl(
  serverAddress: string,
  from: number | null,
) {
  const url = new URL(
    buildStreamUrl(serverAddress, "/ws/stream", {
      from,
    }),
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStreamEventPayload(value: unknown): value is StreamEvent {
  return (
    isObjectRecord(value) &&
    typeof value.id === "number" &&
    typeof value.session_id === "string" &&
    typeof value.type === "string" &&
    typeof value.timestamp === "number" &&
    isObjectRecord(value.data) &&
    (value.workspace_id === undefined || typeof value.workspace_id === "string")
  );
}

function extractStreamEvents(value: unknown): StreamEvent[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(isStreamEventPayload);
}

function createConnectionState(
  status: AgentConnectionState["status"],
  overrides: Partial<Omit<AgentConnectionState, "status">> = {},
): AgentConnectionState {
  return {
    status,
    retryAttempt: 0,
    nextRetryAt: null,
    lastDisconnectReason: null,
    disconnectedAt: null,
    ...overrides,
  };
}

export function useAgentStream() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const refreshActiveServerSession = useAuthStore(
    (s) => s.refreshActiveServerSession,
  );
  const authToken = useAuthStore((s) =>
    s.activeServerId ? s.tokens[s.activeServerId]?.accessToken ?? null : null,
  );
  const serverAddress = useServersStore((s) =>
    activeServerId
      ? s.servers.find((server) => server.id === activeServerId)?.address ?? null
      : null,
  );
  const reconnectNonce = useAgentStore((s) => s.reconnectNonce);
  const lastEventIdRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const pathnameRef = useRef<string | null>(pathname ?? null);
  const streamTargetRef = useRef<string | null>(null);
  const preferredTransportRef = useRef<StreamTransportKind>(defaultTransport());

  useEffect(() => {
    pathnameRef.current = pathname ?? null;
  }, [pathname]);

  useEffect(() => {
    const nextTarget =
      activeServerId && serverAddress
        ? `${activeServerId}:${serverAddress}`
        : null;
    const previousTarget = streamTargetRef.current;
    if (previousTarget !== nextTarget) {
      streamTargetRef.current = nextTarget;
      lastEventIdRef.current = null;
      retryCountRef.current = 0;
      preferredTransportRef.current = defaultTransport();
      if (previousTarget !== null) {
        useAgentStore.getState().setConnectionState(createConnectionState("idle"));
      }
    }
  }, [activeServerId, serverAddress]);

  useEffect(() => {
    if (!activeServerId || !serverAddress || !authToken) {
      useAgentStore.getState().setConnectionState(createConnectionState("idle"));
      return;
    }

    const streamServerAddress = serverAddress;
    const streamAuthToken = authToken;
    let es: EventSource | null = null;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;
    let disconnectHandled = false;
    let connectionInstance = 0;

    function setConnectionState(connection: AgentConnectionState) {
      useAgentStore.getState().setConnectionState(connection);
    }

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function cleanup() {
      if (es) {
        es.removeAllEventListeners();
        es.close();
        es = null;
      }
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    }

    const knownStreamSessionIds = new Set<string>();

    function processStreamMessage(rawData: string) {
      try {
        const payload: unknown = JSON.parse(rawData);
        const streamEvents = extractStreamEvents(payload);
        if (streamEvents.length === 0) {
          return;
        }

        lastEventIdRef.current = streamEvents[streamEvents.length - 1]!.id;
        useAgentStore.getState().processStreamEvents(streamEvents);

        for (const streamEvent of streamEvents) {
          const sid = streamEvent.session_id;
          const eventType = streamEvent.type;
          const explicitWorkspaceId = streamEvent.workspace_id?.trim()
            ? streamEvent.workspace_id
            : undefined;
          const workspaceStore = useWorkspaceStore.getState();
          const workspaceId =
            explicitWorkspaceId ?? workspaceStore.getWorkspaceForSession(sid);

          if (explicitWorkspaceId) {
            workspaceStore.registerSessionWorkspace(
              sid,
              explicitWorkspaceId,
            );
          }

          if (eventType === "turn_end") {
            const isFirstTurn = !knownStreamSessionIds.has(sid);
            knownStreamSessionIds.add(sid);
            handleSessionCompletion(streamEvent, workspaceId, isFirstTurn);
          }
        }
      } catch {}
    }

    function fallbackToSse() {
      if (
        Platform.OS !== "web" ||
        !mounted ||
        preferredTransportRef.current === "sse"
      ) {
        return false;
      }

      preferredTransportRef.current = "sse";
      cleanup();
      clearReconnectTimer();
      disconnectHandled = false;
      connect();
      return true;
    }

    function scheduleReconnect(errorEvent?: StreamErrorEvent) {
      if (!mounted || disconnectHandled) return;
      disconnectHandled = true;
      cleanup();
      clearReconnectTimer();

      const reason = getDisconnectReason(errorEvent);
      const disconnectedAt =
        useAgentStore.getState().connection.disconnectedAt ?? Date.now();

      if (isAuthDisconnect(errorEvent)) {
        setConnectionState(
          createConnectionState("reconnecting", {
            retryAttempt: retryCountRef.current,
            lastDisconnectReason: "Refreshing authentication...",
            disconnectedAt,
          }),
        );

        void (async () => {
          const refreshed = await refreshActiveServerSession();
          if (!mounted) {
            return;
          }

          if (!refreshed) {
            setConnectionState(
              createConnectionState("disconnected", {
                retryAttempt: retryCountRef.current,
                lastDisconnectReason: reason,
                disconnectedAt,
              }),
            );
          }
        })();
        return;
      }

      if (!isRetryableDisconnect(errorEvent)) {
        setConnectionState(
          createConnectionState("disconnected", {
            retryAttempt: retryCountRef.current,
            lastDisconnectReason: reason,
            disconnectedAt,
          }),
        );
        return;
      }

      const attempt = retryCountRef.current + 1;
      retryCountRef.current = attempt;
      const delay = getReconnectDelay(attempt);

      setConnectionState(
        createConnectionState("reconnecting", {
          retryAttempt: attempt,
          nextRetryAt: Date.now() + delay,
          lastDisconnectReason: reason,
          disconnectedAt,
        }),
      );

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        disconnectHandled = false;
        connect();
      }, delay);
    }

    function maybeNotifyTurnComplete(
      streamEvent: StreamEvent,
      workspaceId: string,
    ) {
      if (browserWindowHasAttention()) {
        return;
      }

      const NotificationApi = (globalThis as any).Notification as
        | {
            new (
              title: string,
              options?: { body?: string; tag?: string },
            ): { close: () => void; onclick: (() => void) | null };
            permission?: string;
            requestPermission?: () => Promise<string>;
          }
        | undefined;

      if (!NotificationApi) return;
      if (NotificationApi.permission !== "granted") return;

      const workspace = useWorkspaceStore
        .getState()
        .workspaces.find((item) => item.id === workspaceId);
      const title = workspace
        ? `${workspace.title} is ready`
        : "Session turn completed";
      const body = "A workspace session finished working in the background.";

      const showNotification = () => {
        const notification = new NotificationApi(title, {
          body,
          tag: `session-turn-${streamEvent.session_id}`,
        });

        notification.onclick = () => {
          if (typeof window !== "undefined") {
            window.focus();
          }
          notification.close();
        };

        setTimeout(() => notification.close(), 10_000);
      };

      if (NotificationApi.permission === "granted") {
        showNotification();
      }
    }

    function handleSessionCompletion(
      streamEvent: StreamEvent,
      workspaceId: string | null,
      isNewSession: boolean,
    ) {
      const stopReason =
        (streamEvent.data as Record<string, any> | undefined)?.message
          ?.stopReason ?? null;
      if (stopReason === "aborted") {
        return;
      }

      if (workspaceId) {
        if (isNewSession) {
          queryClient.invalidateQueries({
            queryKey: ["sessions", workspaceId],
          });
        }

        if (!isViewingWorkspace(pathnameRef.current, workspaceId)) {
          useWorkspaceStore
            .getState()
            .markWorkspaceNotification(workspaceId);
        }

        maybeNotifyTurnComplete(streamEvent, workspaceId);
        return;
      }

      if (isNewSession) {
        queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] === "sessions",
        });
      }
    }

    function connect() {
      if (!mounted) return;
      cleanup();
      clearReconnectTimer();
      disconnectHandled = false;
      connectionInstance += 1;
      const currentConnection = connectionInstance;
      const previousConnection = useAgentStore.getState().connection;
      const isReconnectAttempt =
        retryCountRef.current > 0 ||
        previousConnection.status === "disconnected" ||
        previousConnection.status === "reconnecting" ||
        previousConnection.disconnectedAt !== null;

      setConnectionState(
        createConnectionState(
          isReconnectAttempt ? "reconnecting" : "connecting",
          {
            retryAttempt: retryCountRef.current,
            lastDisconnectReason: previousConnection.lastDisconnectReason,
            disconnectedAt: previousConnection.disconnectedAt,
          },
        ),
      );

      const from = lastEventIdRef.current;
      const transport = preferredTransportRef.current;

      if (transport === "ws") {
        const url = buildWebSocketStreamUrl(
          streamServerAddress,
          from,
        );
        let opened = false;

        try {
          ws =
            Platform.OS === "web"
              ? new WebSocket(url, [
                  "pi-stream-v1",
                  `auth.${streamAuthToken}`,
                ])
              : (new (globalThis as any).WebSocket(url, undefined, {
                  headers: {
                    Authorization: `Bearer ${streamAuthToken}`,
                  },
                }) as WebSocket);
        } catch {
          if (fallbackToSse()) {
            return;
          }
          scheduleReconnect({
            transport: "ws",
            type: "error",
            message: "The websocket connection failed.",
          });
          return;
        }

        ws.onopen = () => {
          if (!mounted || currentConnection !== connectionInstance) return;
          opened = true;
          retryCountRef.current = 0;
          setConnectionState(createConnectionState("connected"));
        };

        ws.onmessage = (event) => {
          if (!mounted || currentConnection !== connectionInstance) return;
          if (typeof event.data !== "string") return;
          processStreamMessage(event.data);
        };

        ws.onerror = () => {
          if (!mounted || currentConnection !== connectionInstance) return;
          if (!opened && fallbackToSse()) {
            return;
          }
          scheduleReconnect({
            transport: "ws",
            type: "error",
            message: "The websocket connection failed.",
          });
        };

        ws.onclose = (event) => {
          if (!mounted || currentConnection !== connectionInstance) return;
          const disconnectEvent: StreamErrorEvent = {
            transport: "ws",
            type: "close",
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          };
          if (
            !opened &&
            !isAuthDisconnect(disconnectEvent) &&
            fallbackToSse()
          ) {
            return;
          }
          scheduleReconnect(disconnectEvent);
        };
        return;
      }

      const url = buildSseStreamUrl(streamServerAddress, from);

      es = new EventSource(url, {
        headers: {
          Authorization: {
            toString: () => `Bearer ${streamAuthToken}`,
          },
        },
        pollingInterval: 0,
        timeoutBeforeConnection: 0,
      });

      es.addEventListener("open", () => {
        if (!mounted || currentConnection !== connectionInstance) return;
        retryCountRef.current = 0;
        setConnectionState(createConnectionState("connected"));
      });

      es.addEventListener("message", (event) => {
        if (
          !mounted ||
          currentConnection !== connectionInstance ||
          !event.data
        ) {
          return;
        }
        processStreamMessage(event.data);
      });

      es.addEventListener("error", (event) => {
        if (!mounted || currentConnection !== connectionInstance) return;
        scheduleReconnect({ transport: "sse", ...event });
      });

      es.addEventListener("close", () => {
        if (!mounted || currentConnection !== connectionInstance) return;
        scheduleReconnect();
      });
    }

    connect();

    return () => {
      mounted = false;
      connectionInstance += 1;
      clearReconnectTimer();
      cleanup();
    };
  }, [
    activeServerId,
    authToken,
    queryClient,
    reconnectNonce,
    refreshActiveServerSession,
    serverAddress,
  ]);

  useEffect(() => {
    return () => {
      useAgentStore.getState().setConnectionState(createConnectionState("idle"));
    };
  }, []);
}
