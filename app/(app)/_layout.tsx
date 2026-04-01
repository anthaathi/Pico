import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { Redirect, Slot, usePathname, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { PiClientProvider, type PiClientConfig } from '@pi-ui/client';
import { AdaptiveNavigation } from '@/features/navigation/containers/adaptive-navigation';
import { TaskEventSubscriber } from '@/features/tasks/components/task-event-subscriber';
import { PreviewEventSubscriber } from '@/features/preview/components/preview-event-subscriber';
import { DesktopEventSubscriber } from '@/features/desktop/components/desktop-event-subscriber';
import { usePreviewServiceWorker, usePreviewTokenSync } from '@/features/preview/service-worker';
import { useAuthStore } from '@/features/auth/store';
import { useServersStore } from '@/features/servers/store';
import { useWorkspaceStore } from '@/features/workspace/store';

type StartupStatus = 'loading' | 'ready' | 'no-server' | 'offline';

const STARTUP_MAX_RETRIES = 3;
const STARTUP_RETRY_DELAY_MS = 1200;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StartupScreen({
  title,
  description,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: {
  title: string;
  description: string;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: isDark ? '#121212' : colors.background,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 420,
          paddingHorizontal: 24,
          paddingVertical: 28,
          borderRadius: 24,
          borderWidth: 1,
          backgroundColor: isDark ? '#1a1a1a' : '#fff',
          borderColor: isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)',
        }}
      >
        <Text
          style={{
            fontFamily: Fonts.sansSemiBold,
            fontSize: 24,
            lineHeight: 30,
            color: isDark ? '#fefdfd' : colors.text,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            marginTop: 10,
            fontFamily: Fonts.sans,
            fontSize: 15,
            lineHeight: 22,
            color: isDark ? '#cdc8c5' : colors.textSecondary,
          }}
        >
          {description}
        </Text>

        {primaryLabel && onPrimaryPress ? (
          <Pressable
            onPress={onPrimaryPress}
            style={({ pressed }) => ({
              marginTop: 24,
              borderRadius: 999,
              paddingHorizontal: 18,
              paddingVertical: 14,
              alignItems: 'center',
              backgroundColor: isDark ? '#fefdfd' : '#1a1a1a',
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: Fonts.sansSemiBold,
                fontSize: 15,
                color: isDark ? '#1a1a1a' : '#fff',
              }}
            >
              {primaryLabel}
            </Text>
          </Pressable>
        ) : null}

        {secondaryLabel && onSecondaryPress ? (
          <Pressable
            onPress={onSecondaryPress}
            style={({ pressed }) => ({
              marginTop: 12,
              borderRadius: 999,
              paddingHorizontal: 18,
              paddingVertical: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: isDark ? '#3a3a3a' : 'rgba(0,0,0,0.12)',
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: Fonts.sansMedium,
                fontSize: 15,
                color: isDark ? '#fefdfd' : colors.text,
              }}
            >
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function AppLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const serversLoaded = useServersStore((s) => s.loaded);
  const servers = useServersStore((s) => s.servers);
  const authLoaded = useAuthStore((s) => s.loaded);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const hasToken = useAuthStore((s) => s.hasToken);
  const activateServer = useAuthStore((s) => s.activateServer);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const switchServer = useWorkspaceStore((s) => s.switchServer);
  const accessToken = useAuthStore((s) =>
    s.activeServerId ? s.tokens[s.activeServerId]?.accessToken ?? '' : '',
  );
  const serverAddress = useServersStore((s) =>
    activeServerId
      ? s.servers.find((srv) => srv.id === activeServerId)?.address ?? ''
      : '',
  );

  const [status, setStatus] = useState<StartupStatus>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const isServerRoute = pathname === '/servers';
  const ensureActiveServerSession = useAuthStore((s) => s.ensureActiveServerSession);
  const refreshActiveServerSession = useAuthStore((s) => s.refreshActiveServerSession);

  usePreviewServiceWorker();
  usePreviewTokenSync(accessToken || undefined);

  const onAuthError = useCallback(() => {
    // Token expired on the SSE stream — try to refresh silently
    refreshActiveServerSession().then((ok) => {
      if (!ok) {
        setStatus('offline');
      }
    });
  }, [refreshActiveServerSession]);

  const onApiAuthError = useCallback(async (): Promise<string | null> => {
    const ok = await refreshActiveServerSession();
    if (!ok) return null;
    const state = useAuthStore.getState();
    const sid = state.activeServerId;
    return sid ? state.tokens[sid]?.accessToken ?? null : null;
  }, [refreshActiveServerSession]);

  const piClientConfig = useMemo<PiClientConfig>(
    () => ({
      serverUrl: serverAddress,
      accessToken,
      onAuthError,
      onApiAuthError,
    }),
    [serverAddress, accessToken, onAuthError, onApiAuthError],
  );

  const syncSessionInBackground = useCallback(() => {
    if (!serverAddress || !accessToken) {
      return;
    }

    void ensureActiveServerSession();
  }, [accessToken, ensureActiveServerSession, serverAddress]);

  useEffect(() => {
    if (!serverAddress || !accessToken) {
      return;
    }

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          syncSessionInBackground();
        }
      },
    );

    if (Platform.OS !== 'web') {
      return () => {
        appStateSubscription.remove();
      };
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncSessionInBackground();
      }
    };
    const handleWindowFocus = () => {
      syncSessionInBackground();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      appStateSubscription.remove();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [accessToken, serverAddress, syncSessionInBackground]);

  useEffect(() => {
    if (!serversLoaded || !authLoaded) return;

    const candidate = activeServerId
      ? servers.find((s) => s.id === activeServerId && hasToken(s.id))
      : servers.find((s) => hasToken(s.id));

    if (!candidate) {
      setStatus('no-server');
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus('loading');

      for (let attempt = 1; attempt <= STARTUP_MAX_RETRIES; attempt += 1) {
        try {
          await switchServer(candidate.id);
          const valid = await activateServer(candidate);
          if (cancelled) return;

          if (!valid) {
            setStatus('no-server');
            return;
          }

          await fetchWorkspaces(candidate.id);
          if (cancelled) return;

          const workspaceError = useWorkspaceStore.getState().error;
          if (!workspaceError) {
            setStatus('ready');
            return;
          }
        } catch (error) {
          console.warn('[startup] failed to connect to server', error);
        }

        if (attempt < STARTUP_MAX_RETRIES) {
          await wait(STARTUP_RETRY_DELAY_MS * attempt);
        }
      }

      if (!cancelled) {
        setStatus('offline');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    serversLoaded,
    authLoaded,
    activeServerId,
    servers,
    hasToken,
    activateServer,
    switchServer,
    fetchWorkspaces,
    retryNonce,
  ]);

  if (!serversLoaded || !authLoaded || status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (status === 'no-server') {
    if (isServerRoute) {
      return <Slot />;
    }
    return <Redirect href="/servers" />;
  }

  if (status === 'offline') {
    if (isServerRoute) {
      return <Slot />;
    }

    return (
      <StartupScreen
        title="Can’t reach server"
        description="The selected server appears to be offline or unreachable. Check that pi-server is running, then retry, or open the Servers screen to switch to another server."
        primaryLabel="Retry"
        onPrimaryPress={() => setRetryNonce((value) => value + 1)}
        secondaryLabel="Open Servers"
        onSecondaryPress={() => router.replace('/servers')}
      />
    );
  }

  if (!serverAddress || !accessToken) {
    return <Redirect href="/servers" />;
  }

  return (
    <PiClientProvider config={piClientConfig}>
      <TaskEventSubscriber />
      <PreviewEventSubscriber />
      <DesktopEventSubscriber />
      <AdaptiveNavigation>
        <Slot />
      </AdaptiveNavigation>
    </PiClientProvider>
  );
}
