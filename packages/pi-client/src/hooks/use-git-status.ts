import { useEffect, useCallback, useRef } from "react";
import { BehaviorSubject } from "rxjs";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type {
  GitStatusResponse,
  GitDiffResponse,
  GitFileDiffResponse,
  GitLogEntry,
  NestedGitReposResponse,
} from "../types";

export interface GitStatusState {
  data: GitStatusResponse | null;
  isLoading: boolean;
  isRefetching: boolean;
  isGitRepo: boolean;
  isNotGitRepo: boolean;
  error: string | null;
  isCommitting: boolean;
}

const INITIAL_STATE: GitStatusState = {
  data: null,
  isLoading: true,
  isRefetching: false,
  isGitRepo: false,
  isNotGitRepo: false,
  error: null,
  isCommitting: false,
};

export interface GitStatusHandle extends GitStatusState {
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<void>;
  refresh: () => void;
}

export function useGitStatus(cwd: string | null): GitStatusHandle {
  const client = usePiClient();
  const { api } = client;
  const state$ = useRef(new BehaviorSubject<GitStatusState>(INITIAL_STATE));
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const emit = useCallback(
    (patch: Partial<GitStatusState>) => {
      state$.current.next({ ...state$.current.value, ...patch });
    },
    [],
  );

  const fetchStatus = useCallback(async () => {
    const dir = cwdRef.current;
    if (!dir) return;
    try {
      const data = await api.gitStatus(dir);
      emit({
        data,
        isLoading: false,
        isRefetching: false,
        isGitRepo: true,
        isNotGitRepo: false,
        error: null,
      });
    } catch (e: any) {
      const msg: string = e?.message?.toLowerCase?.() ?? "";
      if (msg.includes("not a git repository")) {
        emit({
          data: null,
          isLoading: false,
          isRefetching: false,
          isGitRepo: false,
          isNotGitRepo: true,
          error: null,
        });
      } else {
        emit({
          isLoading: false,
          isRefetching: false,
          error: e?.message ?? "Failed to fetch git status",
        });
      }
    }
  }, [api, emit]);

  useEffect(() => {
    state$.current.next(INITIAL_STATE);

    if (!cwd) return;

    fetchStatus();

    const sub = client.fileSystemChanged$.subscribe(() => {
      emit({ isRefetching: true });
      fetchStatus();
    });

    return () => {
      sub.unsubscribe();
    };
  }, [cwd, client, fetchStatus, emit]);

  const refresh = useCallback(() => {
    emit({ isRefetching: true });
    fetchStatus();
  }, [fetchStatus, emit]);

  const stage = useCallback(
    async (paths: string[]) => {
      if (!cwdRef.current) return;
      await api.gitStage(cwdRef.current, paths);
      refresh();
    },
    [api, refresh],
  );

  const unstage = useCallback(
    async (paths: string[]) => {
      if (!cwdRef.current) return;
      await api.gitUnstage(cwdRef.current, paths);
      refresh();
    },
    [api, refresh],
  );

  const discard = useCallback(
    async (paths: string[]) => {
      if (!cwdRef.current) return;
      await api.gitDiscard(cwdRef.current, paths);
      refresh();
    },
    [api, refresh],
  );

  const commit = useCallback(
    async (message: string) => {
      if (!cwdRef.current) return;
      emit({ isCommitting: true });
      try {
        await api.gitCommit(cwdRef.current, message);
        refresh();
      } finally {
        emit({ isCommitting: false });
      }
    },
    [api, refresh, emit],
  );

  const snapshot = useObservable(state$.current, INITIAL_STATE);

  return { ...snapshot, stage, unstage, discard, commit, refresh };
}

// ---------------------------------------------------------------------------

export interface GitDiffState {
  data: GitDiffResponse | null;
  isLoading: boolean;
  error: string | null;
}

export function useGitDiff(cwd: string | null, staged: boolean): GitDiffState {
  const { api } = usePiClient();
  const state$ = useRef(
    new BehaviorSubject<GitDiffState>({ data: null, isLoading: true, error: null }),
  );

  useEffect(() => {
    state$.current.next({ data: null, isLoading: true, error: null });
    if (!cwd) return;

    let cancelled = false;
    api
      .gitDiff(cwd, staged)
      .then((data) => {
        if (!cancelled) state$.current.next({ data, isLoading: false, error: null });
      })
      .catch((e: any) => {
        if (!cancelled)
          state$.current.next({
            data: null,
            isLoading: false,
            error: e?.message ?? "Failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, staged, api]);

  return useObservable(state$.current, { data: null, isLoading: true, error: null });
}

// ---------------------------------------------------------------------------

export interface GitFileDiffState {
  data: GitFileDiffResponse | null;
  isLoading: boolean;
  error: string | null;
}

export function useFileDiff(
  cwd: string | null,
  filePath: string | null,
  staged: boolean,
): GitFileDiffState {
  const { api } = usePiClient();
  const state$ = useRef(
    new BehaviorSubject<GitFileDiffState>({ data: null, isLoading: true, error: null }),
  );

  useEffect(() => {
    state$.current.next({ data: null, isLoading: true, error: null });
    if (!cwd || !filePath) return;

    let cancelled = false;
    api
      .gitDiffFile(cwd, filePath, staged)
      .then((data) => {
        if (!cancelled) state$.current.next({ data, isLoading: false, error: null });
      })
      .catch((e: any) => {
        if (!cancelled)
          state$.current.next({
            data: null,
            isLoading: false,
            error: e?.message ?? "Failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, staged, api]);

  return useObservable(state$.current, { data: null, isLoading: true, error: null });
}

// ---------------------------------------------------------------------------

export interface GitLogState {
  entries: GitLogEntry[];
  isLoading: boolean;
  error: string | null;
}

export function useGitLog(cwd: string | null, count = 30): GitLogState {
  const { api } = usePiClient();
  const state$ = useRef(
    new BehaviorSubject<GitLogState>({ entries: [], isLoading: true, error: null }),
  );

  useEffect(() => {
    state$.current.next({ entries: [], isLoading: true, error: null });
    if (!cwd) return;

    let cancelled = false;
    api
      .gitLog(cwd, count)
      .then((entries) => {
        if (!cancelled) state$.current.next({ entries, isLoading: false, error: null });
      })
      .catch((e: any) => {
        if (!cancelled)
          state$.current.next({
            entries: [],
            isLoading: false,
            error: e?.message ?? "Failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, count, api]);

  return useObservable(state$.current, { entries: [], isLoading: true, error: null });
}

// ---------------------------------------------------------------------------

export interface NestedReposState {
  repos: NestedGitReposResponse["repos"];
  isLoading: boolean;
  error: string | null;
}

export function useNestedRepos(cwd: string | null): NestedReposState {
  const { api } = usePiClient();
  const state$ = useRef(
    new BehaviorSubject<NestedReposState>({ repos: [], isLoading: true, error: null }),
  );

  useEffect(() => {
    state$.current.next({ repos: [], isLoading: true, error: null });
    if (!cwd) return;

    let cancelled = false;
    api
      .gitNestedRepos(cwd)
      .then((data) => {
        if (!cancelled)
          state$.current.next({ repos: data.repos ?? [], isLoading: false, error: null });
      })
      .catch((e: any) => {
        if (!cancelled)
          state$.current.next({
            repos: [],
            isLoading: false,
            error: e?.message ?? "Failed",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, api]);

  return useObservable(state$.current, { repos: [], isLoading: true, error: null });
}
