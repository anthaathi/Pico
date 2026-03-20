import { useCallback, useEffect, useMemo } from "react";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { SessionListState } from "../core/pi-client";

interface UseSessionListOptions {
  limit?: number;
  autoLoad?: boolean;
}

export interface SessionListHandle extends SessionListState {
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const INITIAL: SessionListState = {
  items: [],
  page: 0,
  total: 0,
  hasMore: false,
  isLoading: false,
  isLoadingMore: false,
};

export function useSessionList(
  workspaceId: string | null,
  options?: UseSessionListOptions,
): SessionListHandle {
  const client = usePiClient();
  const limit = options?.limit ?? 20;
  const autoLoad = options?.autoLoad ?? true;

  const state$ = useMemo(
    () => workspaceId ? client.sessionList$(workspaceId) : null,
    [client, workspaceId],
  );

  const state = useObservable(state$!, INITIAL);

  useEffect(() => {
    if (!workspaceId || !autoLoad) return;
    client.loadSessions(workspaceId, { page: 1, limit });
  }, [client, workspaceId, limit, autoLoad]);

  const loadMore = useCallback(async () => {
    if (!workspaceId) return;
    await client.loadMoreSessions(workspaceId);
  }, [client, workspaceId]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    await client.refreshSessions(workspaceId);
  }, [client, workspaceId]);

  return {
    ...(state ?? INITIAL),
    loadMore,
    refresh,
  };
}
