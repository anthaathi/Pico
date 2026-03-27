import { ActivityIndicator, Platform, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useWorkspaceStore } from '@/features/workspace/store';
import { useServersStore } from '@/features/servers/store';
import { useAuthStore } from '@/features/auth/store';

export default function AppIndex() {
  const serversLoaded = useServersStore((s) => s.loaded);
  const authLoaded = useAuthStore((s) => s.loaded);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const workspaceLoading = useWorkspaceStore((s) => s.loading);

  if (!serversLoaded || !authLoaded || workspaceLoading) {
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
