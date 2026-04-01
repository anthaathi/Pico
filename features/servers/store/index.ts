import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'servers_list';

export interface Server {
  id: string;
  name: string;
  address: string;
}

interface ServersState {
  servers: Server[];
  loaded: boolean;
  load: () => Promise<void>;
  addServer: (server: Omit<Server, 'id'> & { id?: string }) => Promise<void>;
  updateServer: (id: string, updates: Partial<Omit<Server, 'id'>>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

async function readFromStore(): Promise<Server[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeToStore(servers: Server[]) {
  try {
    const json = JSON.stringify(servers);
    if (Platform.OS === 'web') {
      localStorage.setItem(STORAGE_KEY, json);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, json);
    }
  } catch {
    // silently fail
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  loaded: false,

  load: async () => {
    const raw = await readFromStore();
    const servers = raw.map(({ username, password, ...s }: any) => ({ ...s, address: stripTrailingSlashes(s.address) }));
    set({ servers, loaded: true });
    if (raw.some((s: any) => s.username || s.password)) {
      await writeToStore(servers);
    }
  },

  addServer: async (server) => {
    const newServer: Server = { ...server, id: server.id ?? generateId(), address: stripTrailingSlashes(server.address) };
    const existingIndex = get().servers.findIndex((entry) => entry.id === newServer.id);
    const servers =
      existingIndex >= 0
        ? get().servers.map((entry, index) =>
            index === existingIndex ? newServer : entry,
          )
        : [...get().servers, newServer];
    set({ servers });
    await writeToStore(servers);
  },

  updateServer: async (id, updates) => {
    const sanitized = updates.address != null ? { ...updates, address: stripTrailingSlashes(updates.address) } : updates;
    const servers = get().servers.map((s) =>
      s.id === id ? { ...s, ...sanitized } : s,
    );
    set({ servers });
    await writeToStore(servers);
  },

  removeServer: async (id) => {
    const servers = get().servers.filter((s) => s.id !== id);
    set({ servers });
    await writeToStore(servers);
  },
}));
