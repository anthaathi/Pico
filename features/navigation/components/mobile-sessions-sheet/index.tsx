import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SquarePen, RefreshCw } from 'lucide-react-native';
import { usePathname, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCreateSession } from '@/features/agent/hooks/use-agent-session';
import { useWorkspaceStore } from '@/features/workspace/store';
import { useSessions } from '@/features/workspace/hooks/use-sessions';
import { requestBrowserNotificationPermission } from '@/features/agent/browser-notifications';
import { SessionActivityIndicator } from '@/features/workspace/components/session-activity-indicator';

const SHEET_HEIGHT = 420;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };

interface MobileSessionsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function MobileSessionsSheet({ visible, onClose }: MobileSessionsSheetProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const translateY = useSharedValue(SHEET_HEIGHT);
  const overlayOpacity = useSharedValue(0);

  const router = useRouter();
  const createSession = useCreateSession();
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  );

  const {
    sessions,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useSessions(selectedWorkspaceId);

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const textSecondary = isDark ? '#f1ece8' : colors.textSecondary;
  const btnBg = isDark ? '#191919' : '#F0F0F0';
  const selectedSessionId = pathname.match(/\/workspace\/[^/]+\/s\/([^/]+)/)?.[1] ?? null;

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, TIMING_CONFIG);
      overlayOpacity.value = withTiming(1, TIMING_CONFIG);
    } else {
      translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
      overlayOpacity.value = withTiming(0, TIMING_CONFIG);
    }
  }, [visible, translateY, overlayOpacity]);

  const dismiss = useCallback(() => {
    translateY.value = withTiming(SHEET_HEIGHT, TIMING_CONFIG);
    overlayOpacity.value = withTiming(0, TIMING_CONFIG, () => {
      runOnJS(onClose)();
    });
  }, [translateY, overlayOpacity, onClose]);

  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId || createSession.isPending) return;
    requestBrowserNotificationPermission();
    try {
      const info = await createSession.mutateAsync({
        workspaceId: selectedWorkspaceId,
      });
      router.navigate(`/workspace/${selectedWorkspaceId}/s/${info.session_id}`);
      dismiss();
    } catch {}
  }, [selectedWorkspaceId, createSession, router, dismiss]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 500) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withTiming(0, TIMING_CONFIG);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    pointerEvents: overlayOpacity.value > 0 ? 'auto' as const : 'none' as const,
  }));

  return (
    <View
      {...(Platform.OS !== 'web'
        ? { pointerEvents: visible ? ('auto' as const) : ('none' as const) }
        : {})}
      style={[
        styles.root,
        Platform.OS === 'web' && ({ pointerEvents: visible ? 'auto' : 'none' } as any),
      ]}
    >
      <Animated.View style={[styles.overlay, { backgroundColor: colors.overlay }, overlayStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: isDark ? '#1e1e1e' : '#FFFFFF',
            paddingBottom: insets.bottom + 16,
          },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: colors.sheetHandle }]} />
          </View>
        </GestureDetector>

          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: textPrimary }]}>
                  Sessions
                </Text>
                {workspace && (
                  <Text style={[styles.workspacePath, { color: textSecondary }]} numberOfLines={1}>
                    {workspace.title.toLowerCase().replace(/\s+/g, '-')}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => refetch()}
                disabled={isRefetching}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {isRefetching ? (
                  <ActivityIndicator size={13} color={textMuted} />
                ) : (
                  <RefreshCw size={13} color={textMuted} strokeWidth={1.8} />
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={handleNewSession}
              disabled={createSession.isPending}
              style={({ pressed }) => [
                styles.newSessionButton,
                { backgroundColor: btnBg },
                pressed && { opacity: 0.8 },
              ]}
            >
              {createSession.isPending ? (
                <ActivityIndicator size={14} color={textPrimary} />
              ) : (
                <SquarePen size={14} color={textPrimary} strokeWidth={1.8} />
              )}
              <Text style={[styles.newSessionText, { color: textPrimary }]}>
                New session
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : sessions.length === 0 ? (
              <Text style={[styles.emptyText, { color: textMuted }]}>
                No sessions yet
              </Text>
            ) : (
              sessions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => {
                    if (selectedWorkspaceId) {
                      router.navigate(`/workspace/${selectedWorkspaceId}/s/${session.id}`);
                    }
                    dismiss();
                  }}
                  style={({ pressed }) => [
                    styles.sessionItem,
                    session.id === selectedSessionId && {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <SessionActivityIndicator
                    sessionId={session.id}
                    color={textMuted}
                  />
                  <Text
                    style={[styles.sessionTitle, { color: textPrimary }]}
                    numberOfLines={1}
                  >
                    {session.display_name ?? session.id}
                  </Text>
                </Pressable>
              ))
            )}
            {hasNextPage && (
              <Pressable
                onPress={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                style={({ pressed }) => [
                  styles.loadMoreButton,
                  { backgroundColor: btnBg },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {isFetchingNextPage ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={[styles.loadMoreText, { color: textMuted }]}>
                    Load more
                  </Text>
                )}
              </Pressable>
            )}
          </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: SHEET_HEIGHT,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  iconButton: {
    padding: 6,
  },
  title: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  workspacePath: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 8,
  },
  newSessionText: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 2,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  sessionTitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    flex: 1,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 24,
  },
  loadMoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    borderRadius: 8,
    marginTop: 8,
  },
  loadMoreText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
});
