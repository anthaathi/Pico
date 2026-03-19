import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import { useAppSettingsStore } from '@/features/settings/store';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);
  const themeMode = useAppSettingsStore((s) => s.themeMode);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (themeMode === 'system') {
    if (hasHydrated) {
      return colorScheme ?? 'light';
    }
    return 'light';
  }

  return themeMode;
}
