import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  status as gitStatus,
  nestedRepos as gitNestedRepos,
  stage as gitStage,
  unstage as gitUnstage,
  discard as gitDiscard,
  commit as gitCommit,
  diff as gitDiff,
  diffFile as gitDiffFile,
  log as gitLog,
} from '@/features/api/generated/sdk.gen';

function extract<T>(raw: unknown): T | undefined {
  const envelope = raw as Record<string, unknown> | null | undefined;
  if (envelope && 'data' in envelope && envelope.data != null) {
    return envelope.data as T;
  }
  return envelope as T | undefined;
}

function extractErrorMessage(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Error) return raw.message;

  if (typeof raw === 'object') {
    const envelope = raw as Record<string, unknown>;
    if (typeof envelope.error === 'string') return envelope.error;
    if (typeof envelope.message === 'string') return envelope.message;
    if (envelope.error) return extractErrorMessage(envelope.error);
  }

  return undefined;
}

function isNotGitRepoError(raw: unknown): boolean {
  const message = extractErrorMessage(raw)?.toLowerCase();
  return !!message && message.includes('not a git repository');
}

function statusKey(cwd: string) {
  return ['git-status', cwd] as const;
}

function useAppVisibility() {
  const [isVisible, setIsVisible] = useState(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      return document.visibilityState !== 'hidden';
    }
    return AppState.currentState === 'active';
  });

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const handleVisibilityChange = () => {
        setIsVisible(document.visibilityState !== 'hidden');
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      handleVisibilityChange();

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsVisible(nextState === 'active');
    });

    setIsVisible(AppState.currentState === 'active');

    return () => {
      subscription.remove();
    };
  }, []);

  return isVisible;
}

type GitRemoteData = {
  name: string;
  url: string;
};

type GitStatusData = {
  branch: string;
  is_clean: boolean;
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: Array<string>;
  ahead: number;
  behind: number;
  remote_url?: string | null;
  remotes?: GitRemoteData[];
};

type NestedGitRepoData = {
  path: string;
  branch: string;
  remotes: GitRemoteData[];
};

export function useGitStatus(cwd: string | null) {
  const queryClient = useQueryClient();
  const isAppVisible = useAppVisibility();
  const wasAppVisible = useRef(isAppVisible);

  const query = useQuery({
    queryKey: statusKey(cwd ?? ''),
    queryFn: async () => {
      const result = await gitStatus({ query: { cwd: cwd! } });
      if (result.error) {
        if (isNotGitRepoError(result.error)) {
          return null;
        }

        throw new Error(
          extractErrorMessage(result.error) ?? 'Failed to fetch git status',
        );
      }

      const payload = extract<GitStatusData>(result.data);
      if (!payload) {
        throw new Error('Failed to fetch git status');
      }

      return payload;
    },
    enabled: !!cwd,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (!isAppVisible) return false;
      if (query.state.status === 'error') return false;
      if (query.state.data === null) return false;
      return 10_000;
    },
  });

  useEffect(() => {
    if (!cwd) {
      wasAppVisible.current = isAppVisible;
      return;
    }

    const becameVisible = isAppVisible && !wasAppVisible.current;
    wasAppVisible.current = isAppVisible;

    if (!becameVisible) return;

    const cached = queryClient.getQueryData<GitStatusData | null>(statusKey(cwd));
    if (cached) {
      queryClient.invalidateQueries({ queryKey: statusKey(cwd) });
    }
  }, [cwd, isAppVisible, queryClient]);

  const isGitRepo = query.status === 'success' && query.data != null;
  const isNotGitRepo = query.status === 'success' && query.data === null;

  const invalidate = useCallback(() => {
    if (cwd) queryClient.invalidateQueries({ queryKey: statusKey(cwd) });
  }, [cwd, queryClient]);

  const stageMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      const result = await gitStage({ query: { cwd: cwd! }, body: { paths } });
      if (result.error) throw new Error('Failed to stage');
    },
    onSuccess: invalidate,
  });

  const unstageMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      const result = await gitUnstage({ query: { cwd: cwd! }, body: { paths } });
      if (result.error) throw new Error('Failed to unstage');
    },
    onSuccess: invalidate,
  });

  const discardMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      const result = await gitDiscard({ query: { cwd: cwd! }, body: { paths } });
      if (result.error) throw new Error('Failed to discard');
    },
    onSuccess: invalidate,
  });

  const commitMutation = useMutation({
    mutationFn: async (message: string) => {
      const result = await gitCommit({ query: { cwd: cwd! }, body: { message } });
      if (result.error) throw new Error('Failed to commit');
    },
    onSuccess: invalidate,
  });

  return {
    data: query.data ?? undefined,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    isGitRepo,
    isNotGitRepo,
    error: query.error instanceof Error ? query.error : null,
    stage: stageMutation.mutateAsync,
    unstage: unstageMutation.mutateAsync,
    discard: discardMutation.mutateAsync,
    commit: commitMutation.mutateAsync,
    isCommitting: commitMutation.isPending,
    refresh: invalidate,
  };
}

export function useGitDiff(cwd: string | null, staged: boolean) {
  return useQuery({
    queryKey: ['git-diff', cwd ?? '', staged],
    queryFn: async () => {
      const result = await gitDiff({ query: { cwd: cwd!, staged } });
      if (result.error) throw new Error('Failed to fetch diff');
      return extract<{ diff: string; stats: string }>(result.data);
    },
    enabled: !!cwd,
  });
}

export function useFileDiff(
  cwd: string | null,
  filePath: string | null,
  staged: boolean,
) {
  return useQuery({
    queryKey: ['git-diff-file', cwd ?? '', filePath ?? '', staged],
    queryFn: async () => {
      const result = await gitDiffFile({
        query: { cwd: cwd!, path: filePath!, staged },
      });
      if (result.error) throw new Error('Failed to fetch file diff');
      return extract<{ path: string; diff: string }>(result.data);
    },
    enabled: !!cwd && !!filePath,
    staleTime: 0,
    retry: 1,
  });
}

export function useGitLog(cwd: string | null, count = 30) {
  return useQuery({
    queryKey: ['git-log', cwd ?? '', count],
    queryFn: async () => {
      const result = await gitLog({ query: { cwd: cwd!, count } });
      if (result.error) throw new Error('Failed to fetch log');
      return (
        extract<
          Array<{
            hash: string;
            short_hash: string;
            author: string;
            date: string;
            message: string;
          }>
        >(result.data) ?? []
      );
    },
    enabled: !!cwd,
  });
}

export function useNestedRepos(cwd: string | null) {
  return useQuery({
    queryKey: ['git-nested-repos', cwd ?? ''],
    queryFn: async () => {
      const result = await gitNestedRepos({ query: { cwd: cwd! } });
      if (result.error) throw new Error('Failed to fetch nested repos');
      const payload = extract<{ repos: NestedGitRepoData[] }>(result.data);
      return payload?.repos ?? [];
    },
    enabled: !!cwd,
    staleTime: 60_000, // refresh every 60s at most
  });
}
