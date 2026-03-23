import { create } from 'zustand';
import { client } from '@/features/api/generated/client.gen';
import { getActiveToken } from '@/features/api/client-auth';
import type { TaskDefinition, TasksConfig, TaskInfo, TaskLogs } from '../types';

interface TasksState {
  /** Task definitions from .pi/tasks.json */
  definitions: TaskDefinition[];
  /** Running/stopped task instances */
  instances: TaskInfo[];
  /** Logs keyed by task instance id */
  logsById: Record<string, string[]>;
  /** Whether the tasks panel is open */
  panelOpen: boolean;
  /** Currently selected task id for log viewing */
  selectedTaskId: string | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Has tasks config (workspace has .pi/tasks.json) */
  hasConfig: boolean;

  // Actions
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setSelectedTaskId: (id: string | null) => void;
  fetchConfig: (workspaceId: string) => Promise<void>;
  fetchInstances: (workspaceId: string) => Promise<void>;
  fetchLogs: (taskId: string) => Promise<void>;
  startTask: (label: string, workspaceId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  restartTask: (taskId: string) => Promise<void>;
  removeTask: (taskId: string) => Promise<void>;
  appendLogLine: (taskId: string, line: string) => void;
  updateTaskStatus: (taskId: string, status: TaskInfo['status'], exitCode?: number | null) => void;
  addTaskInstance: (info: TaskInfo) => void;
}

function getBaseUrl(): string {
  const config = client.getConfig();
  return (config as any).baseUrl || 'http://127.0.0.1:5454';
}

function authHeaders(): Record<string, string> {
  const token = getActiveToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function apiGet<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    headers: authHeaders(),
  });
  const body = await res.json();
  return body?.data ?? undefined;
}

async function apiPost<T>(path: string, data: unknown): Promise<T | undefined> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!body?.success) {
    throw new Error(body?.error || 'Request failed');
  }
  return body?.data ?? undefined;
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const body = await res.json();
  if (!body?.success) {
    throw new Error(body?.error || 'Delete failed');
  }
}

export const useTasksStore = create<TasksState>((set, get) => ({
  definitions: [],
  instances: [],
  logsById: {},
  panelOpen: false,
  selectedTaskId: null,
  loading: false,
  error: null,
  hasConfig: false,

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  fetchConfig: async (workspaceId) => {
    try {
      const config = await apiGet<TasksConfig>(`/tasks/config/${workspaceId}`);
      if (config) {
        set({
          definitions: config.tasks,
          hasConfig: config.tasks.length > 0,
          error: null,
        });
      } else {
        set({ definitions: [], hasConfig: false });
      }
    } catch (e: any) {
      set({ definitions: [], hasConfig: false, error: e.message });
    }
  },

  fetchInstances: async (workspaceId) => {
    try {
      const instances = await apiGet<TaskInfo[]>(`/tasks/list/${workspaceId}`);
      if (instances) {
        set({ instances, error: null });
      }
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  fetchLogs: async (taskId) => {
    try {
      const logs = await apiGet<TaskLogs>(`/tasks/logs/${taskId}`);
      if (logs) {
        set((s) => ({
          logsById: { ...s.logsById, [taskId]: logs.lines },
        }));
      }
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  startTask: async (label, workspaceId) => {
    set({ loading: true, error: null });
    try {
      const info = await apiPost<TaskInfo>('/tasks/start', {
        label,
        workspace_id: workspaceId,
      });
      if (info) {
        set((s) => ({
          instances: [...s.instances.filter((i) => i.id !== info.id), info],
          loading: false,
          selectedTaskId: info.id,
        }));
      }
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  stopTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const info = await apiPost<TaskInfo>('/tasks/stop', { task_id: taskId });
      if (info) {
        set((s) => ({
          instances: s.instances.map((i) => (i.id === info.id ? info : i)),
          loading: false,
        }));
      }
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  restartTask: async (taskId) => {
    set({ loading: true, error: null });
    try {
      const info = await apiPost<TaskInfo>('/tasks/restart', { task_id: taskId });
      if (info) {
        set((s) => ({
          instances: [
            ...s.instances.filter((i) => i.id !== taskId && i.id !== info.id),
            info,
          ],
          loading: false,
          selectedTaskId: info.id,
          logsById: { ...s.logsById, [info.id]: [] },
        }));
      }
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  removeTask: async (taskId) => {
    try {
      await apiDelete(`/tasks/remove/${taskId}`);
      set((s) => ({
        instances: s.instances.filter((i) => i.id !== taskId),
        selectedTaskId: s.selectedTaskId === taskId ? null : s.selectedTaskId,
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  appendLogLine: (taskId, line) =>
    set((s) => {
      const existing = s.logsById[taskId] ?? [];
      const updated = [...existing, line];
      // Keep max 5000 lines on client
      if (updated.length > 5000) {
        updated.splice(0, updated.length - 5000);
      }
      return { logsById: { ...s.logsById, [taskId]: updated } };
    }),

  updateTaskStatus: (taskId, status, exitCode) =>
    set((s) => ({
      instances: s.instances.map((i) =>
        i.id === taskId
          ? { ...i, status, exit_code: exitCode ?? i.exit_code, stopped_at: status !== 'running' ? new Date().toISOString() : i.stopped_at }
          : i
      ),
    })),

  addTaskInstance: (info) =>
    set((s) => ({
      instances: [...s.instances.filter((i) => i.id !== info.id), info],
    })),
}));
