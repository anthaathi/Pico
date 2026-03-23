import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Slot, usePathname } from 'expo-router';

import { PiClientProvider, type PiClientConfig } from '@pi-ui/client';
import { AdaptiveNavigation } from '@/features/navigation/containers/adaptive-navigation';
import { useAuthStore } from '@/features/auth/store';
import { useServersStore } from '@/features/servers/store';
import { useWorkspaceStore } from '@/features/workspace/store';

export default function AppLayout() {
  const pathname = usePathname();
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

  const [status, setStatus] = useState<'loading' | 'ready' | 'no-server'>('loading');
  const isServerRoute = pathname === '/servers';
  const refreshActiveServerSession = useAuthStore((s) => s.refreshActiveServerSession);

  const onAuthError = useCallback(() => {
    // Token expired on the SSE stream — try to refresh silently
    refreshActiveServerSession().then((ok) => {
      if (!ok) {
        setStatus('no-server');
      }
    });
  }, [refreshActiveServerSession]);

  const onApiAuthError = useCallback(async () => {
    // Token expired on an API call (prompt, steer, etc.) — refresh and retry
    return refreshActiveServerSession();
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
    switchServer(candidate.id).then(() =>
      activateServer(candidate).then((valid) => {
        if (cancelled) return;
        if (!valid) {
          setStatus('no-server');
          return;
        }
        fetchWorkspaces(candidate.id).then(() => {
          if (!cancelled) setStatus('ready');
        });
      })
    );
    return () => { cancelled = true; };
  }, [serversLoaded, authLoaded, activeServerId, servers, hasToken, activateServer, switchServer, fetchWorkspaces]);

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

  if (!serverAddress || !accessToken) {
    return <Redirect href="/servers" />;
  }

  return (
    <PiClientProvider config={piClientConfig}>
      <AdaptiveNavigation>
        <Slot />
      </AdaptiveNavigation>
    </PiClientProvider>
  );
}
