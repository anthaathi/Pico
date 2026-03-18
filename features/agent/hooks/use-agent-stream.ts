import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import EventSource, { type EventSourceEvent } from "../event-source";
import { useAuthStore } from "@/features/auth/store";
import { useServersStore } from "@/features/servers/store";
import { useWorkspaceStore } from "@/features/workspace/store";
import { browserWindowHasAttention } from "../browser-notifications";
import { useAgentStore } from "../store";
import type { AgentConnectionState, StreamEvent } from "../types";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

type StreamErrorEvent = EventSourceEvent;

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

function isRetryableDisconnect(event?: StreamErrorEvent): boolean {
  if (!event) return true;
  if (event.type === "timeout" || event.type === "exception") {
    return true;
  }
  if (event.type !== "error") {
    return true;
  }

  if (event.xhrStatus === 0) return true;
  if (event.xhrStatus === 401 || event.xhrStatus === 403) {
    return false;
  }

  return event.xhrStatus >= 500 || event.xhrStatus === 408;
}

function getDisconnectReason(event?: StreamErrorEvent): string {
  if (!event) {
    return "The connection to the server was lost.";
  }

  if (event.type === "timeout") {
    return "The server connection timed out.";
  }

  if (event.type === "exception") {
    return event.message || "The app hit a connection error.";
  }

  if (event.type === "error") {
    if (event.xhrStatus === 401 || event.xhrStatus === 403) {
      return "Authentication expired. Sign in again to reconnect.";
    }
    if (event.xhrStatus >= 500) {
      return "The server is temporarily unavailable.";
    }

    return (
      parseDisconnectMessage(event.message) ??
      "The connection to the server was lost."
    );
  }

  return "The connection to the server was lost.";
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

    let es: EventSource | null = null;
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
    }

    function scheduleReconnect(errorEvent?: StreamErrorEvent) {
      if (!mounted || disconnectHandled) return;
      disconnectHandled = true;
      cleanup();
      clearReconnectTimer();

      const reason = getDisconnectReason(errorEvent);
      const disconnectedAt =
        useAgentStore.getState().connection.disconnectedAt ?? Date.now();

      if (
        errorEvent?.type === "error" &&
        (errorEvent.xhrStatus === 401 || errorEvent.xhrStatus === 403)
      ) {
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
    ) {
      const stopReason =
        (streamEvent.data as Record<string, any> | undefined)?.message
          ?.stopReason ?? null;
      if (stopReason === "aborted") {
        return;
      }

      if (workspaceId) {
        queryClient.invalidateQueries({
          queryKey: ["sessions", workspaceId],
        });

        if (!isViewingWorkspace(pathnameRef.current, workspaceId)) {
          useWorkspaceStore
            .getState()
            .markWorkspaceNotification(workspaceId);
        }

        maybeNotifyTurnComplete(streamEvent, workspaceId);
        return;
      }

      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "sessions",
      });
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

      const fromParam =
        lastEventIdRef.current !== null
          ? `?from=${lastEventIdRef.current}`
          : "";
      const url = `${serverAddress}/api/stream${fromParam}`;

      es = new EventSource(url, {
        headers: {
          Authorization: {
            toString: () => `Bearer ${authToken}`,
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
        try {
          const streamEvent: StreamEvent = JSON.parse(event.data);
          lastEventIdRef.current = streamEvent.id;
          useAgentStore.getState().processStreamEvent(streamEvent);

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
            handleSessionCompletion(streamEvent, workspaceId);
          }
        } catch {}
      });

      es.addEventListener("error", (event) => {
        if (!mounted || currentConnection !== connectionInstance) return;
        scheduleReconnect(event);
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
