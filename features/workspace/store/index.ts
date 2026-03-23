import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Workspace } from '../types';
import type { Workspace as ApiWorkspace } from '@/features/api/generated/types.gen';
import { list2 as list, create as apiCreate, delete2 as apiDelete } from '@/features/api/generated/sdk.gen';
import { unwrapApiData } from '@/features/api/unwrap';
import { WorkspaceColors } from '@/constants/theme';

const SELECTED_WORKSPACE_KEY = 'selected_workspace_id';
const LAST_SESSION_KEY = 'last_session_by_workspace';
// Per-server keys use a suffix: selected_workspace_id:<serverId>
const SERVER_SELECTED_KEY_PREFIX = 'selected_workspace_id:';
const SERVER_SESSION_KEY_PREFIX = 'last_session_by_workspace:';

function serverSelectedKey(serverId: string) {
  return `${SERVER_SELECTED_KEY_PREFIX}${serverId}`;
}
function serverSessionKey(serverId: string) {
  return `${SERVER_SESSION_KEY_PREFIX}${serverId}`;
}

async function readStorageItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStorageItem(key: string, value: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } else {
      if (value) await SecureStore.setItemAsync(key, value);
      else await SecureStore.deleteItemAsync(key);
    }
  } catch {}
}

async function readSelectedId(serverId?: string | null): Promise<string | null> {
  if (serverId) {
    const perServer = await readStorageItem(serverSelectedKey(serverId));
    if (perServer) return perServer;
  }
  // Fallback to global key for migration
  return readStorageItem(SELECTED_WORKSPACE_KEY);
}

async function writeSelectedId(id: string | null, serverId?: string | null) {
  // Always write global for backward compat
  await writeStorageItem(SELECTED_WORKSPACE_KEY, id);
  // Also write per-server
  if (serverId) {
    await writeStorageItem(serverSelectedKey(serverId), id);
  }
}

async function readLastSessionMap(serverId?: string | null): Promise<Record<string, string>> {
  try {
    let raw: string | null = null;
    if (serverId) {
      raw = await readStorageItem(serverSessionKey(serverId));
    }
    if (!raw) {
      // Fallback to global key for migration
      raw = await readStorageItem(LAST_SESSION_KEY);
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeLastSessionMap(map: Record<string, string>, serverId?: string | null) {
  const json = JSON.stringify(map);
  await writeStorageItem(LAST_SESSION_KEY, json);
  if (serverId) {
    await writeStorageItem(serverSessionKey(serverId), json);
  }
}

function mapApiWorkspace(ws: ApiWorkspace, index: number): Workspace {
  return {
    id: ws.id,
    title: ws.name,
    path: ws.path,
    color: ws.color ?? WorkspaceColors[index % WorkspaceColors.length],
    runningSessions: 0,
    hasNotifications: false,
    worktreeEnabled: ws.workspace_enabled,
    status: ws.status,
    startupScript: ws.startup_script,
  };
}

function mergeWorkspaceUiState(
  apiWorkspaces: ApiWorkspace[],
  currentWorkspaces: Workspace[],
): Workspace[] {
  const currentById = new Map(
    currentWorkspaces.map((workspace) => [workspace.id, workspace]),
  );

  return apiWorkspaces.map((workspace, index) => {
    const mapped = mapApiWorkspace(workspace, index);
    const current = currentById.get(mapped.id);
    if (!current) {
      return mapped;
    }

    return {
      ...mapped,
      runningSessions: current.runningSessions,
      hasNotifications: current.hasNotifications,
    };
  });
}

interface WorkspaceState {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  lastSessionByWorkspace: Record<string, string>;
  sessionWorkspaceById: Record<string, string>;
  currentServerId: string | null;
  loading: boolean;
  error: string | null;

  fetchWorkspaces: (serverId?: string | null) => Promise<void>;
  selectWorkspace: (id: string) => void;
  setLastSession: (workspaceId: string, sessionId: string) => void;
  getLastSession: (workspaceId: string) => string | null;
  clearLastSession: (workspaceId: string) => void;
  addWorkspace: (workspace: { title: string; path: string; color?: string; startupScript?: string; worktreeEnabled?: boolean }) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  registerSessionWorkspace: (sessionId: string, workspaceId: string) => void;
  registerWorkspaceSessions: (
    workspaceId: string,
    sessionIds: string[],
  ) => void;
  getWorkspaceForSession: (sessionId: string) => string | null;
  markWorkspaceNotification: (workspaceId: string) => void;
  clearWorkspaceNotification: (workspaceId: string) => void;
  switchServer: (serverId: string | null) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  selectedWorkspaceId: null,
  lastSessionByWorkspace: {},
  sessionWorkspaceById: {},
  currentServerId: null,
  loading: false,
  error: null,

  fetchWorkspaces: async (serverId?: string | null) => {
    const sid = serverId ?? get().currentServerId;
    // Restore per-server state
    const [restoredId, restoredSessionMap] = await Promise.all([
      readSelectedId(sid),
      readLastSessionMap(sid),
    ]);
    set({ loading: true, error: null, lastSessionByWorkspace: restoredSessionMap, currentServerId: sid });
    const result = await list();
    if (result.error) {
      set({ loading: false, error: 'Failed to fetch workspaces' });
      return;
    }
    const rawWorkspaces = unwrapApiData(result.data) ?? [];
    const workspaces = mergeWorkspaceUiState(rawWorkspaces, get().workspaces);
    const currentSelected = get().selectedWorkspaceId ?? restoredId;
    const selectedWorkspaceId =
      workspaces.find((w) => w.id === currentSelected)?.id ?? workspaces[0]?.id ?? null;
    set({ workspaces, selectedWorkspaceId, loading: false });
    writeSelectedId(selectedWorkspaceId, sid);
  },

  selectWorkspace: (id) => {
    set({ selectedWorkspaceId: id });
    writeSelectedId(id, get().currentServerId);
  },

  setLastSession: (workspaceId, sessionId) => {
    const updated = { ...get().lastSessionByWorkspace, [workspaceId]: sessionId };
    set({ lastSessionByWorkspace: updated });
    writeLastSessionMap(updated, get().currentServerId);
  },

  getLastSession: (workspaceId) => {
    return get().lastSessionByWorkspace[workspaceId] ?? null;
  },

  clearLastSession: (workspaceId) => {
    const { [workspaceId]: _, ...rest } = get().lastSessionByWorkspace;
    set({ lastSessionByWorkspace: rest });
    writeLastSessionMap(rest, get().currentServerId);
  },

  addWorkspace: async (workspace) => {
    const result = await apiCreate({
      body: {
        name: workspace.title,
        path: workspace.path,
        color: workspace.color,
        startup_script: workspace.startupScript,
        workspace_enabled: workspace.worktreeEnabled,
      },
    });
    const rawWorkspace = unwrapApiData(result.data);
    if (rawWorkspace) {
      const ws = mapApiWorkspace(rawWorkspace, get().workspaces.length);
      set((state) => ({
        workspaces: [...state.workspaces, ws],
        selectedWorkspaceId: ws.id,
      }));
      writeSelectedId(ws.id, get().currentServerId);
    }
  },

  removeWorkspace: async (id) => {
    const result = await apiDelete({ path: { id } });
    if (!result.error) {
      set((state) => {
        const filtered = state.workspaces.filter((w) => w.id !== id);
        const sessionWorkspaceById = Object.fromEntries(
          Object.entries(state.sessionWorkspaceById).filter(
            ([, workspaceId]) => workspaceId !== id,
          ),
        );
        const selectedId =
          state.selectedWorkspaceId === id
            ? (filtered[0]?.id ?? null)
            : state.selectedWorkspaceId;
        writeSelectedId(selectedId, state.currentServerId);
        return {
          workspaces: filtered,
          selectedWorkspaceId: selectedId,
          sessionWorkspaceById,
        };
      });
    }
  },

  registerSessionWorkspace: (sessionId, workspaceId) =>
    set((state) => {
      if (state.sessionWorkspaceById[sessionId] === workspaceId) {
        return state;
      }

      return {
        sessionWorkspaceById: {
          ...state.sessionWorkspaceById,
          [sessionId]: workspaceId,
        },
      };
    }),

  registerWorkspaceSessions: (workspaceId, sessionIds) =>
    set((state) => {
      let changed = false;
      const next = { ...state.sessionWorkspaceById };

      for (const sessionId of sessionIds) {
        if (next[sessionId] === workspaceId) continue;
        next[sessionId] = workspaceId;
        changed = true;
      }

      if (!changed) {
        return state;
      }

      return { sessionWorkspaceById: next };
    }),

  getWorkspaceForSession: (sessionId) => {
    return get().sessionWorkspaceById[sessionId] ?? null;
  },

  markWorkspaceNotification: (workspaceId) =>
    set((state) => {
      let changed = false;
      const workspaces = state.workspaces.map((workspace) => {
        if (
          workspace.id !== workspaceId ||
          workspace.hasNotifications
        ) {
          return workspace;
        }

        changed = true;
        return { ...workspace, hasNotifications: true };
      });

      return changed ? { workspaces } : state;
    }),

  clearWorkspaceNotification: (workspaceId) =>
    set((state) => {
      let changed = false;
      const workspaces = state.workspaces.map((workspace) => {
        if (
          workspace.id !== workspaceId ||
          !workspace.hasNotifications
        ) {
          return workspace;
        }

        changed = true;
        return { ...workspace, hasNotifications: false };
      });

      return changed ? { workspaces } : state;
    }),

  switchServer: async (serverId: string | null) => {
    if (serverId === get().currentServerId) return;
    // Reset workspace state and load per-server persisted state
    const [restoredId, restoredSessionMap] = await Promise.all([
      readSelectedId(serverId),
      readLastSessionMap(serverId),
    ]);
    set({
      workspaces: [],
      selectedWorkspaceId: restoredId,
      lastSessionByWorkspace: restoredSessionMap,
      sessionWorkspaceById: {},
      currentServerId: serverId,
      loading: false,
      error: null,
    });
  },
}));
