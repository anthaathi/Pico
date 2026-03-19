import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createSession,
  sessionsGet,
  touchSession,
  prompt as apiPrompt,
  steer as apiSteer,
  followUp as apiFollowUp,
  abort as apiAbort,
  extensionUiResponse as apiExtensionUiResponse,
  getState as apiGetState,
  getMessages as apiGetMessages,
} from "@/features/api/generated/sdk.gen";
import { extractApiErrorMessage, unwrapApiData } from "@/features/api/unwrap";
import { parsePendingExtensionUiRequest } from "../extension-ui";
import { useAgentStore } from "../store";
import type { AgentSessionInfo } from "@/features/api/generated/types.gen";
import { useWorkspaceStore } from "@/features/workspace/store";

export type PromptStreamingBehavior = "steer" | "followUp";

export function useAgentSession(
  sessionId: string | null,
  workspaceId: string | null,
  sessionFile?: string | null,
) {
  const setHistoryMessages = useAgentStore((s) => s.setHistoryMessages);
  const setHistoryEntries = useAgentStore((s) => s.setHistoryEntries);
  const setPendingExtensionUiRequest = useAgentStore(
    (s) => s.setPendingExtensionUiRequest,
  );
  const registerSessionWorkspace = useWorkspaceStore(
    (s) => s.registerSessionWorkspace,
  );
  const touchedRef = useRef<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);

  useEffect(() => {
    if (!sessionId || !workspaceId) return;
    registerSessionWorkspace(sessionId, workspaceId);
  }, [sessionId, workspaceId, registerSessionWorkspace]);

  useEffect(() => {
    touchedRef.current = null;
    setIsSessionReady(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !workspaceId || !sessionFile) return;
    if (touchedRef.current === sessionId) return;
    touchedRef.current = sessionId;
    setPendingExtensionUiRequest(sessionId, null);

    (async () => {
      const detail = await sessionsGet({
        path: { id: workspaceId, session_id: sessionId },
      });
      if (!detail.error) {
        const data = unwrapApiData(detail.data) as
          | { entries?: unknown[] }
          | undefined;
        if (data?.entries) {
          setHistoryEntries(sessionId, data.entries);
        }
      } else {
        const msgs = await apiGetMessages({
          body: { session_id: sessionId },
        });
        if (!msgs.error) {
          const data = unwrapApiData(msgs.data) as Record<string, any> | undefined;
          if (data?.messages) {
            setHistoryMessages(sessionId, data.messages);
          }
        }
      }

      const result = await touchSession({
        path: { session_id: sessionId },
        body: {
          session_file: sessionFile,
          workspace_id: workspaceId,
        },
      });
      if (!result.error) {
        const stateResult = await apiGetState({
          body: { session_id: sessionId },
        });
        if (!stateResult.error) {
          const data = unwrapApiData(stateResult.data) as
            | Record<string, unknown>
            | undefined;
          setPendingExtensionUiRequest(
            sessionId,
            parsePendingExtensionUiRequest(data?.pendingExtensionUiRequest),
          );
        } else {
          setPendingExtensionUiRequest(sessionId, null);
        }
        setIsSessionReady(true);
      }
    })();
  }, [
    sessionId,
    workspaceId,
    sessionFile,
    registerSessionWorkspace,
    setHistoryEntries,
    setHistoryMessages,
    setPendingExtensionUiRequest,
  ]);

  return { isSessionReady };
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const registerSessionWorkspace = useWorkspaceStore(
    (s) => s.registerSessionWorkspace,
  );

  return useMutation({
    mutationFn: async (params: {
      workspaceId: string;
      sessionPath?: string;
    }) => {
      const result = await createSession({
        body: {
          workspace_id: params.workspaceId,
          session_path: params.sessionPath,
        },
      });
      if (result.error) {
        throw new Error(
          extractApiErrorMessage(
            result.error,
            extractApiErrorMessage(result.data, "Failed to create session"),
          ),
        );
      }
      return unwrapApiData(result.data) as AgentSessionInfo;
    },
    onSuccess: (data, variables) => {
      registerSessionWorkspace(
        data.session_id,
        data.workspace_id ?? variables.workspaceId,
      );
      queryClient.refetchQueries({
        queryKey: ["sessions", variables.workspaceId],
      });
    },
  });
}

export function useSendPrompt() {
  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      message: string;
      streamingBehavior?: PromptStreamingBehavior;
      workspaceId?: string;
      sessionFile?: string;
    }) => {
      const result =
        params.streamingBehavior === "steer"
          ? await apiSteer({
              body: {
                session_id: params.sessionId,
                message: params.message,
                workspace_id: params.workspaceId,
                session_file: params.sessionFile,
              },
            })
          : params.streamingBehavior === "followUp"
            ? await apiFollowUp({
                body: {
                  session_id: params.sessionId,
                  message: params.message,
                  workspace_id: params.workspaceId,
                  session_file: params.sessionFile,
                },
              })
            : await apiPrompt({
                body: {
                  session_id: params.sessionId,
                  message: params.message,
                  workspace_id: params.workspaceId,
                  session_file: params.sessionFile,
                },
              });
      if (result.error) {
        throw new Error(
          extractApiErrorMessage(
            result.error,
            extractApiErrorMessage(result.data, "Failed to send prompt"),
          ),
        );
      }
      return unwrapApiData(result.data);
    },
  });
}

export function useAbortAgent() {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const result = await apiAbort({
        body: { session_id: sessionId },
      });
      if (result.error) {
        throw new Error(
          extractApiErrorMessage(
            result.error,
            extractApiErrorMessage(result.data, "Failed to abort"),
          ),
        );
      }
      return unwrapApiData(result.data);
    },
  });
}

export function useSendExtensionUiResponse() {
  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      id: string;
      value?: unknown;
      confirmed?: boolean;
      cancelled?: boolean;
    }) => {
      const result = await apiExtensionUiResponse({
        body: {
          session_id: params.sessionId,
          id: params.id,
          value: params.value,
          confirmed: params.confirmed,
          cancelled: params.cancelled,
        },
      });
      if (result.error) {
        throw new Error(
          extractApiErrorMessage(
            result.error,
            extractApiErrorMessage(
              result.data,
              "Failed to send extension UI response",
            ),
          ),
        );
      }
      return unwrapApiData(result.data);
    },
    onSuccess: (_data, variables) => {
      useAgentStore
        .getState()
        .setPendingExtensionUiRequest(variables.sessionId, null);
    },
  });
}
