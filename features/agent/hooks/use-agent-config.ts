import { useQuery, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAvailableModels,
  setModel as apiSetModel,
  setThinkingLevel as apiSetThinkingLevel,
  getState as apiGetState,
  prompt as apiPrompt,
} from "@/features/api/generated/sdk.gen";
import { unwrapApiData } from "@/features/api/unwrap";
import { extractAgentMode, type AgentMode } from "@/features/agent/mode";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
}

export const THINKING_LEVELS = [
  "off",
  "low",
  "medium",
  "high",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const AGENT_MODELS_GC_TIME = 60 * 60_000;
const AGENT_STATE_GC_TIME = 30 * 60_000;

export function useAgentModels(sessionId: string | null | undefined, ready = true) {
  return useQuery({
    queryKey: ["agent-models", sessionId],
    queryFn: async () => {
      const result = await getAvailableModels({
        body: { session_id: sessionId! },
      });
      if (result.error) throw new Error("Failed to fetch models");
      const data = unwrapApiData(result.data) as { models?: any[] } | undefined;
      const models: ModelInfo[] = (data?.models ?? []).map((m: any) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: m.provider ?? "unknown",
        reasoning: m.reasoning ?? false,
      }));
      return models;
    },
    enabled: !!sessionId && ready,
    staleTime: 5 * 60_000,
    gcTime: AGENT_MODELS_GC_TIME,
  });
}

export function useAgentState(sessionId: string | null | undefined, ready = true) {
  return useQuery({
    queryKey: ["agent-state", sessionId],
    queryFn: async () => {
      const result = await apiGetState({
        body: { session_id: sessionId! },
      });
      if (result.error) throw new Error("Failed to fetch state");
      const data = unwrapApiData(result.data) as Record<string, any> | undefined;
      return {
        model: data?.model as ModelInfo | null,
        thinkingLevel: (data?.thinkingLevel ?? "medium") as ThinkingLevel,
        mode: extractAgentMode(data),
      };
    },
    enabled: !!sessionId && ready,
    staleTime: 30_000,
    gcTime: AGENT_STATE_GC_TIME,
  });
}

export function useAgentModelsSuspense(sessionId: string) {
  return useSuspenseQuery({
    queryKey: ["agent-models", sessionId],
    queryFn: async () => {
      const result = await getAvailableModels({
        body: { session_id: sessionId },
      });
      if (result.error) throw new Error("Failed to fetch models");
      const data = unwrapApiData(result.data) as { models?: any[] } | undefined;
      const models: ModelInfo[] = (data?.models ?? []).map((m: any) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: m.provider ?? "unknown",
        reasoning: m.reasoning ?? false,
      }));
      return models;
    },
    staleTime: 5 * 60_000,
    gcTime: AGENT_MODELS_GC_TIME,
  });
}

export function useAgentStateSuspense(sessionId: string) {
  return useSuspenseQuery({
    queryKey: ["agent-state", sessionId],
    queryFn: async () => {
      const result = await apiGetState({
        body: { session_id: sessionId },
      });
      if (result.error) throw new Error("Failed to fetch state");
      const data = unwrapApiData(result.data) as Record<string, any> | undefined;
      return {
        model: data?.model as ModelInfo | null,
        thinkingLevel: (data?.thinkingLevel ?? "medium") as ThinkingLevel,
        mode: extractAgentMode(data),
      };
    },
    staleTime: 30_000,
    gcTime: AGENT_STATE_GC_TIME,
  });
}

export function useSetModel(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { provider: string; modelId: string }) => {
      if (!sessionId) throw new Error("No session");
      const result = await apiSetModel({
        body: {
          session_id: sessionId,
          provider: params.provider,
          modelId: params.modelId,
        },
      });
      if (result.error) throw new Error("Failed to set model");
      return unwrapApiData(result.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-state", sessionId] });
    },
  });
}

export function useSetThinkingLevel(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (level: string) => {
      if (!sessionId) throw new Error("No session");
      const result = await apiSetThinkingLevel({
        body: { session_id: sessionId, level },
      });
      if (result.error) throw new Error("Failed to set thinking level");
      return unwrapApiData(result.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-state", sessionId] });
    },
  });
}

export function useSetAgentMode(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      mode: AgentMode;
      currentMode?: AgentMode | null;
    }) => {
      if (!sessionId) throw new Error("No session");
      if (params.currentMode === params.mode) {
        return null;
      }
      const result = await apiPrompt({
        body: {
          session_id: sessionId,
          message: "/plan",
        },
      });
      if (result.error) throw new Error("Failed to set mode");
      return unwrapApiData(result.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-state", sessionId] });
    },
  });
}
