import { useEffect, useCallback, useRef } from "react";
import { BehaviorSubject } from "rxjs";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { AgentMode } from "../types";

export interface AgentModesState {
  modes: AgentMode[];
  loaded: boolean;
  saving: boolean;
  error: string | null;
}

const INITIAL: AgentModesState = {
  modes: [],
  loaded: false,
  saving: false,
  error: null,
};

export interface AgentModesHandle extends AgentModesState {
  load: () => Promise<void>;
  create: (params: {
    name: string;
    description?: string;
    model?: string;
    thinkingLevel?: string;
    extensions?: string[];
    skills?: string[];
    extraArgs?: string[];
    isDefault?: boolean;
    sortOrder?: number;
  }) => Promise<AgentMode>;
  update: (
    modeId: string,
    params: {
      name?: string;
      description?: string;
      model?: string;
      thinkingLevel?: string;
      extensions?: string[];
      skills?: string[];
      extraArgs?: string[];
      isDefault?: boolean;
      sortOrder?: number;
    },
  ) => Promise<AgentMode>;
  remove: (modeId: string) => Promise<void>;
  defaultMode: AgentMode | undefined;
}

export function useAgentModes(): AgentModesHandle {
  const { api } = usePiClient();
  const state$ = useRef(new BehaviorSubject<AgentModesState>(INITIAL));

  const emit = useCallback(
    (patch: Partial<AgentModesState>) =>
      state$.current.next({ ...state$.current.value, ...patch }),
    [],
  );

  const load = useCallback(async () => {
    try {
      const result = await api.listModes();
      emit({ modes: Array.isArray(result) ? result : [], loaded: true, error: null });
    } catch {
      emit({ loaded: true, error: "Failed to load modes" });
    }
  }, [api, emit]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (params: Parameters<AgentModesHandle["create"]>[0]) => {
      emit({ saving: true, error: null });
      try {
        const mode = await api.createMode(params);
        await load();
        emit({ saving: false });
        return mode;
      } catch (e) {
        emit({ saving: false, error: "Failed to create mode" });
        throw e;
      }
    },
    [api, emit, load],
  );

  const update = useCallback(
    async (
      modeId: string,
      params: Parameters<AgentModesHandle["update"]>[1],
    ) => {
      emit({ saving: true, error: null });
      try {
        const mode = await api.updateMode(modeId, params);
        await load();
        emit({ saving: false });
        return mode;
      } catch (e) {
        emit({ saving: false, error: "Failed to update mode" });
        throw e;
      }
    },
    [api, emit, load],
  );

  const remove = useCallback(
    async (modeId: string) => {
      emit({ saving: true, error: null });
      try {
        await api.deleteMode(modeId);
        await load();
        emit({ saving: false });
      } catch (e) {
        emit({ saving: false, error: "Failed to delete mode" });
        throw e;
      }
    },
    [api, emit, load],
  );

  const snapshot = useObservable(state$.current, INITIAL);
  const modes = Array.isArray(snapshot.modes) ? snapshot.modes : [];
  const defaultMode = modes.find((m) => m.is_default);

  return { ...snapshot, load, create, update, remove, defaultMode };
}
