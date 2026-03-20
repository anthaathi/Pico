import { useCallback, useEffect, useMemo, useState } from "react";
import { usePiClient } from "./context";
import type { ModelInfo, AgentStateData } from "../types/stream-events";
import type { AgentMode } from "../types/chat-message";

export interface AgentConfigHandle {
  state: AgentStateData | null;
  models: ModelInfo[] | null;
  isLoading: boolean;
  setModel: (params: { provider: string; modelId: string }) => Promise<void>;
  setThinkingLevel: (level: string) => Promise<void>;
  setMode: (mode: AgentMode) => Promise<void>;
  reload: () => Promise<void>;
}

export function useAgentConfig(sessionId: string | null): AgentConfigHandle {
  const client = usePiClient();
  const [state, setState] = useState<AgentStateData | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const [stateResult, modelsResult] = await Promise.all([
        client.api.getState(sessionId),
        client.api.getAvailableModels(sessionId),
      ]);
      setState(stateResult as unknown as AgentStateData);
      setModels((modelsResult.models ?? []) as unknown as ModelInfo[]);
    } catch {
      // leave current state
    } finally {
      setIsLoading(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const setModel = useCallback(
    async (params: { provider: string; modelId: string }) => {
      if (!sessionId) return;
      await client.setModel(sessionId, params);
      load();
    },
    [client, sessionId, load],
  );

  const setThinkingLevel = useCallback(
    async (level: string) => {
      if (!sessionId) return;
      await client.setThinkingLevel(sessionId, level);
      load();
    },
    [client, sessionId, load],
  );

  const setMode = useCallback(
    async (mode: AgentMode) => {
      if (!sessionId) return;
      await client.prompt(sessionId, mode === "plan" ? "/plan" : "/chat");
      load();
    },
    [client, sessionId, load],
  );

  return {
    state,
    models,
    isLoading,
    setModel,
    setThinkingLevel,
    setMode,
    reload: load,
  };
}
