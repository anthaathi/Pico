import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'chat_state';

interface ChatPersistedState {
  lastSessionId?: string | null;
  noTools?: boolean;
  systemPrompt?: string | null;
}

interface ChatState {
  selectedSessionId: string | null;
  lastSessionId: string | null;
  noTools: boolean;
  systemPrompt: string | null;
  loaded: boolean;
  selectSession: (id: string | null) => void;
  setNoTools: (enabled: boolean) => void;
  setSystemPrompt: (prompt: string | null) => void;
  load: () => Promise<void>;
}

async function readFromStore(): Promise<ChatPersistedState> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    }
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeToStore(data: ChatPersistedState) {
  try {
    const json = JSON.stringify(data);
    if (Platform.OS === 'web') {
      localStorage.setItem(STORAGE_KEY, json);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, json);
    }
  } catch {}
}

function persistState(state: ChatState) {
  writeToStore({
    lastSessionId: state.lastSessionId,
    noTools: state.noTools,
    systemPrompt: state.systemPrompt,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  selectedSessionId: null,
  lastSessionId: null,
  noTools: true,
  systemPrompt: null,
  loaded: false,

  selectSession: (id) => {
    set({ selectedSessionId: id, lastSessionId: id });
    persistState({ ...get(), selectedSessionId: id, lastSessionId: id });
  },

  setNoTools: (enabled) => {
    set({ noTools: enabled });
    persistState({ ...get(), noTools: enabled });
  },

  setSystemPrompt: (prompt) => {
    set({ systemPrompt: prompt });
    persistState({ ...get(), systemPrompt: prompt });
  },

  load: async () => {
    const stored = await readFromStore();
    set({
      lastSessionId: stored.lastSessionId ?? null,
      noTools: stored.noTools ?? true,
      systemPrompt: stored.systemPrompt ?? null,
      loaded: true,
    });
  },
}));
