import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useWorkspaceStore } from '@/features/workspace/store';
import { useServersStore, type Server } from '@/features/servers/store';
import { useAuthStore } from '@/features/auth/store';

export default function AppIndex() {
  const servers = useServersStore((s) => s.servers);
  const serversLoaded = useServersStore((s) => s.loaded);
  const authLoaded = useAuthStore((s) => s.loaded);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const hasToken = useAuthStore((s) => s.hasToken);

  if (!serversLoaded || !authLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (servers.length === 0) {
    return <Redirect href="/servers" />;
  }

  // Find a server we have a stored token for
  const candidateServer = activeServerId
    ? servers.find((s) => s.id === activeServerId && hasToken(s.id))
    : servers.find((s) => hasToken(s.id));

  if (candidateServer) {
    return <VerifyAndRedirect server={candidateServer} />;
  }

  // No stored token → go to servers to add/re-connect
  return <Redirect href="/servers" />;
}

function VerifyAndRedirect({ server }: { server: Server }) {
  const activateServer = useAuthStore((s) => s.activateServer);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const switchServer = useWorkspaceStore((s) => s.switchServer);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);

  const [state, setState] = useState<'verifying' | 'ready' | 'expired'>('verifying');

  useEffect(() => {
    let cancelled = false;
    switchServer(server.id).then(() =>
      activateServer(server).then((valid) => {
        if (cancelled) return;
        if (!valid) {
          setState('expired');
          return;
        }
        fetchWorkspaces(server.id).then(() => {
          if (!cancelled) setState('ready');
        });
      })
    );
    return () => { cancelled = true; };
  }, [server, activateServer, switchServer, fetchWorkspaces]);

  if (state === 'expired') {
    return <Redirect href="/servers" />;
  }

  if (state === 'verifying') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const targetId = selectedWorkspaceId ?? workspaces[0]?.id;
  if (targetId) {
    const lastSession = Platform.OS !== 'web'
      ? useWorkspaceStore.getState().getLastSession(targetId)
      : null;
    if (lastSession) {
      return <Redirect href={`/workspace/${targetId}/s/${lastSession}`} />;
    }
    return <Redirect href={`/workspace/${targetId}`} />;
  }

  return <Redirect href="/settings" />;
}
