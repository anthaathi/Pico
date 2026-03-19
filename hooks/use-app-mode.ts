import { usePathname } from 'expo-router';

export type AppMode = 'chat' | 'code';

export function useAppMode(): AppMode {
  const pathname = usePathname();
  return pathname.startsWith('/chat') ? 'chat' : 'code';
}
