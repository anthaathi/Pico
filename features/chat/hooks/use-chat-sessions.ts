import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { listChatSessions, deleteChatSession } from '../api';
import type { SessionListItem } from '@/features/api/generated/types.gen';

const PAGE_SIZE = 20;
const QUERY_KEY = ['chat-sessions'] as const;

export function useChatSessions() {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ pageParam }) => {
      const result = await listChatSessions(pageParam, PAGE_SIZE);
      return {
        items: (result.items ?? []) as SessionListItem[],
        page: result.page ?? 1,
        hasMore: result.has_more === true,
        total: result.total ?? 0,
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
  });

  const sessions = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const total = useMemo(
    () => query.data?.pages.at(-1)?.total ?? 0,
    [query.data],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await deleteChatSession(sessionId);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    [queryClient],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  return {
    sessions,
    total,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    deleteSession,
    invalidate,
    isRefetching: query.isRefetching && !query.isFetchingNextPage,
  };
}
