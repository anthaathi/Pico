import { useCallback, useEffect, useMemo } from "react";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { SessionState } from "../core/message-reducer";
import type { ImageContent } from "../types/stream-events";

interface UseAgentSessionOptions {
  workspaceId?: string;
  sessionFile: string;
}

export interface AgentSessionHandle extends SessionState {
  prompt: (message: string, options?: { images?: ImageContent[] }) => Promise<void>;
  steer: (message: string, options?: { images?: ImageContent[] }) => Promise<void>;
  followUp: (message: string, options?: { images?: ImageContent[] }) => Promise<void>;
  abort: () => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  sendExtensionUiResponse: (params: {
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => Promise<void>;
}

const EMPTY: SessionState = {
  messages: [],

  isStreaming: false,
  isReady: false,
  isLoading: false,
  isLoadingOlderMessages: false,
  hasMoreMessages: false,
  oldestEntryId: null,
  mode: "chat",
  pendingExtensionUiRequest: null,
};

export function useAgentSession(
  sessionId: string | null,
  options?: UseAgentSessionOptions,
): AgentSessionHandle {
  const client = usePiClient();

  const session$ = useMemo(
    () => (sessionId ? client.session$(sessionId) : null),
    [client, sessionId],
  );

  const state = useObservable(session$!, EMPTY);

  useEffect(() => {
    if (!sessionId || !options?.sessionFile) return;
    client.openSession(sessionId, {
      workspaceId: options.workspaceId,
      sessionFile: options.sessionFile,
    });
    const sub = client.serverRestart$.subscribe(() => {
      client.openSession(sessionId, {
        workspaceId: options.workspaceId,
        sessionFile: options.sessionFile!,
      });
    });
    return () => {
      sub.unsubscribe();
      client.closeSession(sessionId);
    };
  }, [client, sessionId, options?.workspaceId, options?.sessionFile]);

  const prompt = useCallback(
    (message: string, opts?: { images?: ImageContent[] }) => {
      if (!sessionId) return Promise.resolve();
      return client.prompt(sessionId, message, {
        images: opts?.images,
        workspaceId: options?.workspaceId,
        sessionFile: options?.sessionFile,
      });
    },
    [client, sessionId, options?.workspaceId, options?.sessionFile],
  );

  const steer = useCallback(
    (message: string, opts?: { images?: ImageContent[] }) => {
      if (!sessionId) return Promise.resolve();
      return client.steer(sessionId, message, {
        images: opts?.images,
        workspaceId: options?.workspaceId,
        sessionFile: options?.sessionFile,
      });
    },
    [client, sessionId, options?.workspaceId, options?.sessionFile],
  );

  const followUp = useCallback(
    (message: string, opts?: { images?: ImageContent[] }) => {
      if (!sessionId) return Promise.resolve();
      return client.followUp(sessionId, message, {
        images: opts?.images,
        workspaceId: options?.workspaceId,
        sessionFile: options?.sessionFile,
      });
    },
    [client, sessionId, options?.workspaceId, options?.sessionFile],
  );

  const abort = useCallback(() => {
    if (!sessionId) return Promise.resolve();
    return client.abort(sessionId);
  }, [client, sessionId]);

  const loadOlderMessages = useCallback(() => {
    if (!sessionId) return Promise.resolve();
    return client.loadOlderMessages(sessionId);
  }, [client, sessionId]);

  const sendExtensionUiResponse = useCallback(
    (params: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (!sessionId) return Promise.resolve();
      return client.sendExtensionUiResponse({ sessionId, ...params });
    },
    [client, sessionId],
  );

  return {
    ...(state ?? EMPTY),
    prompt,
    steer,
    followUp,
    abort,
    loadOlderMessages,
    sendExtensionUiResponse,
  };
}
