import { create } from 'zustand';
import {
  getCustomModels,
  saveCustomModels,
} from '@/features/api/generated/sdk.gen';
import { unwrapApiData } from '@/features/api/unwrap';
import type {
  CustomProvider,
  CustomModelEntry,
  CustomModelsConfig,
} from '@/features/api/generated/types.gen';

export type { CustomProvider, CustomModelEntry };

export type ProvidersMap = Record<string, CustomProvider>;

interface CustomModelsState {
  providers: ProvidersMap;
  loaded: boolean;
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;
  save: (providers: ProvidersMap) => Promise<void>;
  addProvider: (name: string, provider: CustomProvider) => Promise<void>;
  removeProvider: (name: string) => Promise<void>;
  updateProvider: (name: string, provider: CustomProvider) => Promise<void>;
}

export const useCustomModelsStore = create<CustomModelsState>((set, get) => ({
  providers: {},
  loaded: false,
  saving: false,
  error: null,

  load: async () => {
    try {
      const result = await getCustomModels();
      const data = unwrapApiData(result.data) as CustomModelsConfig | undefined;
      set({
        providers: data?.providers ?? {},
        loaded: true,
        error: null,
      });
    } catch {
      set({ loaded: true, error: 'Failed to load custom models' });
    }
  },

  save: async (providers) => {
    set({ saving: true, error: null });
    try {
      await saveCustomModels({ body: { providers } });
      set({ providers, saving: false });
    } catch {
      set({ saving: false, error: 'Failed to save custom models' });
    }
  },

  addProvider: async (name, provider) => {
    const providers = { ...get().providers, [name]: provider };
    await get().save(providers);
  },

  removeProvider: async (name) => {
    const { [name]: _, ...rest } = get().providers;
    await get().save(rest);
  },

  updateProvider: async (name, provider) => {
    const providers = { ...get().providers, [name]: provider };
    await get().save(providers);
  },
}));
