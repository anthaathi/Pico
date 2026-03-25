import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Square, Monitor, ChevronUp, ChevronDown } from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/features/auth/store';
import { useServersStore } from '@/features/servers/store';
import { useDesktopStore } from '@/features/desktop/store';
import { DesktopSetup } from '@/features/desktop/components/desktop-setup';
import { VncViewer } from '@/features/desktop/components/vnc-viewer';
import { useResponsiveLayout } from '@/features/navigation/hooks/use-responsive-layout';

export default function DesktopScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { isWideScreen } = useResponsiveLayout();

  const activeServerId = useAuthStore((s) => s.activeServerId);
  const accessToken = useAuthStore((s) =>
    s.activeServerId ? s.tokens[s.activeServerId]?.accessToken ?? '' : '',
  );
  const serverAddress = useServersStore((s) =>
    activeServerId
      ? s.servers.find((srv) => srv.id === activeServerId)?.address ?? ''
      : '',
  );

  const desktopInfo = useDesktopStore((s) => s.desktopInfo);
  const loading = useDesktopStore((s) => s.loading);
  const stopping = useDesktopStore((s) => s.stopping);
  const fetchStatus = useDesktopStore((s) => s.fetchStatus);
  const stopDesktop = useDesktopStore((s) => s.stopDesktop);

  const isRunning = desktopInfo.status === 'running';

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    if (isRunning) {
      ScreenOrientation.unlockAsync();
    }
    return () => {
      if (Platform.OS !== 'web') {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    };
  }, [isRunning]);

  const immersive = useDesktopStore((s) => s.immersive);
  const setImmersive = useDesktopStore((s) => s.setImmersive);
  const [fabExpanded, setFabExpanded] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const handleStop = useCallback(() => {
    stopDesktop();
  }, [stopDesktop]);

  const handleToggleFullscreen = useCallback((fullscreen: boolean) => {
    setImmersive(fullscreen);
  }, [setImmersive]);

  const toggleFab = useCallback(() => {
    const next = !fabExpanded;
    setFabExpanded(next);
    Animated.spring(fabAnim, {
      toValue: next ? 1 : 0,
      tension: 300,
      friction: 26,
      useNativeDriver: false,
    }).start();
  }, [fabExpanded, fabAnim]);

  if (loading || desktopInfo.status === 'starting') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" />
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>
          Starting desktop...
        </Text>
      </View>
    );
  }

  if (desktopInfo.status === 'running' && desktopInfo.vnc_port && serverAddress) {
    // Wide screen: simple inline toolbar
    if (isWideScreen) {
      return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          {!immersive && (
            <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
              <Text style={[styles.toolbarText, { color: colors.textSecondary }]} numberOfLines={1}>
                {desktopInfo.mode === 'actual' ? 'Screen Share' : 'Virtual Desktop'}
                {' — '}
                {desktopInfo.display} (VNC :{desktopInfo.vnc_port})
              </Text>
              <Pressable
                onPress={handleStop}
                disabled={stopping}
                style={({ pressed }) => [
                  styles.stopButton,
                  {
                    backgroundColor: isDark ? '#3A1A1A' : '#FFF0F0',
                    opacity: stopping ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                {stopping ? (
                  <ActivityIndicator size={14} color={colors.destructive} />
                ) : (
                  <Square size={14} color={colors.destructive} />
                )}
                <Text style={[styles.stopText, { color: colors.destructive }]}>
                  {stopping ? 'Stopping...' : 'Stop'}
                </Text>
              </Pressable>
            </View>
          )}
          <VncViewer
            serverUrl={serverAddress}
            accessToken={accessToken}
            vncPort={desktopInfo.vnc_port}
            vncPassword={desktopInfo.vnc_password}
            onToggleFullscreen={handleToggleFullscreen}
          />
        </View>
      );
    }

    // Mobile: full-bleed VNC with expandable FAB at bottom
    const panelHeight = fabAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 80],
    });

    return (
      <View style={[styles.container, { backgroundColor: '#111' }]}>
        <VncViewer
          serverUrl={serverAddress}
          accessToken={accessToken}
          vncPort={desktopInfo.vnc_port}
          vncPassword={desktopInfo.vnc_password}
          onToggleFullscreen={handleToggleFullscreen}
        />
        {!immersive && (
          <View
            style={[
              styles.fabContainer,
              { paddingBottom: Math.max(insets.bottom, 8) },
            ]}
            pointerEvents="box-none"
          >
            <Animated.View
              style={[
                styles.fabPanel,
                {
                  height: panelHeight,
                  opacity: fabAnim,
                  backgroundColor: isDark
                    ? 'rgba(30,30,30,0.95)'
                    : 'rgba(255,255,255,0.95)',
                },
              ]}
            >
              <View style={styles.fabPanelContent}>
                <View style={styles.fabInfoRow}>
                  <Monitor size={14} color={colors.textSecondary} />
                  <Text
                    style={[styles.fabInfoText, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {desktopInfo.mode === 'actual' ? 'Screen Share' : 'Virtual Desktop'}
                    {' — '}
                    {desktopInfo.display}
                  </Text>
                </View>
                <Pressable
                  onPress={handleStop}
                  disabled={stopping}
                  style={({ pressed }) => [
                    styles.fabStopButton,
                    {
                      backgroundColor: isDark ? '#3A1A1A' : '#FFF0F0',
                      opacity: stopping ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {stopping ? (
                    <ActivityIndicator size={14} color={colors.destructive} />
                  ) : (
                    <Square size={14} color={colors.destructive} />
                  )}
                  <Text style={[styles.stopText, { color: colors.destructive }]}>
                    {stopping ? 'Stopping...' : 'Stop Desktop'}
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
            <Pressable
              onPress={toggleFab}
              style={({ pressed }) => [
                styles.fabToggle,
                {
                  backgroundColor: isDark
                    ? 'rgba(30,30,30,0.95)'
                    : 'rgba(255,255,255,0.95)',
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {fabExpanded ? (
                <ChevronDown size={16} color={colors.textSecondary} />
              ) : (
                <ChevronUp size={16} color={colors.textSecondary} />
              )}
              <Text style={[styles.fabToggleText, { color: colors.textSecondary }]}>
                {fabExpanded ? 'Hide' : 'Controls'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <DesktopSetup />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  // Wide screen toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  toolbarText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stopText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
  // Mobile FAB
  fabContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  fabPanel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 6,
  },
  fabPanelContent: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
    gap: 10,
  },
  fabInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fabInfoText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  fabStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fabToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  fabToggleText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
});
