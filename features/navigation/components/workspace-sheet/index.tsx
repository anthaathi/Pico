import { useCallback, useEffect, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PagerView from 'react-native-pager-view';
import { usePathname, useRouter } from 'expo-router';
import { SquarePen, RefreshCw, Plus } from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWorkspaceStore } from '@/features/workspace/store';
import { useSessions } from '@/features/workspace/hooks/use-sessions';
import { usePiClient } from '@pi-ui/client';
import { requestBrowserNotificationPermission } from '@/features/agent/browser-notifications';
import { NewWorkspaceDialog } from '@/features/workspace/components/new-workspace-dialog';
import { SessionActivityIndicator } from '@/features/workspace/components/session-activity-indicator';

const SHEET_HEIGHT = 620;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };
const AVATAR_SIZE = 48;

interface WorkspaceSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function WorkspaceSheet({ visible, onClose }: WorkspaceSheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const translateY = useSharedValue(SHEET_HEIGHT);
  const overlayOpacity = useSharedValue(0);

  const [showNewDialog, setShowNewDialog] = useState(false);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const selectedWorkspaceId = useWorkspaceStore((s) => s.selectedWorkspaceId);
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);

  const pagerRef = useRef<PagerView>(null);
  const stripScrollRef = useRef<ScrollView>(null);

  const selectedIndex = workspaces.findIndex((w) => w.id === selectedWorkspaceId);

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const textSecondary = isDark ? '#f1ece8' : colors.textSecondary;
  const activeBorder = isDark ? '#ede8e4' : '#1A1A1A';
  const avatarScrollBg = isDark ? '#191919' : '#F8F8F8';

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

  const scrollStripToIndex = useCallback(
    (index: number) => {
      const ITEM_WIDTH = 58 + 16;
      const offset = Math.max(0, index * ITEM_WIDTH - 80);
      stripScrollRef.current?.scrollTo({ x: offset, animated: true });
    },
    [],
  );

  const getLastSession = useWorkspaceStore((s) => s.getLastSession);

  const handleWorkspacePress = useCallback(
    (id: string, index: number) => {
      selectWorkspace(id);
      const lastSession = getLastSession(id);
      if (lastSession) {
        router.replace(`/workspace/${id}/s/${lastSession}`);
      } else {
        router.replace(`/workspace/${id}`);
      }
      pagerRef.current?.setPage(index);
      scrollStripToIndex(index);
    },
    [selectWorkspace, getLastSession, router, scrollStripToIndex],
  );

  const handlePageSelected = useCallback(
    (index: number) => {
      const ws = workspaces[index];
      if (ws && ws.id !== selectedWorkspaceId) {
        selectWorkspace(ws.id);
        const lastSession = getLastSession(ws.id);
        if (lastSession) {
          router.replace(`/workspace/${ws.id}/s/${lastSession}`);
        } else {
          router.replace(`/workspace/${ws.id}`);
        }
        scrollStripToIndex(index);
      }
    },
    [workspaces, selectedWorkspaceId, selectWorkspace, getLastSession, router, scrollStripToIndex],
  );

  const handleAddWorkspace = useCallback(() => {
    dismiss();
    setTimeout(() => setShowNewDialog(true), 300);
  }, [dismiss]);

  const handleServersPress = useCallback(() => {
    router.push('/servers');
    dismiss();
  }, [router, dismiss]);

  const handleSettingsPress = useCallback(() => {
    router.push('/settings');
    dismiss();
  }, [router, dismiss]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
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
    pointerEvents:
      overlayOpacity.value > 0 ? ('auto' as const) : ('none' as const),
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
      <Animated.View
        style={[styles.overlay, { backgroundColor: colors.overlay }, overlayStyle]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.sheetBackground,
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

        <View style={[styles.workspaceStrip, { backgroundColor: avatarScrollBg }]}>
          <ScrollView
            ref={stripScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.workspaceScrollContent}
          >
            {workspaces.map((ws, index) => {
              const isActive = ws.id === selectedWorkspaceId;
              return (
                <Pressable
                  key={ws.id}
                  onPress={() => handleWorkspacePress(ws.id, index)}
                  style={({ pressed }) => [
                    styles.workspaceItem,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View
                    style={[
                      styles.avatarOuter,
                      isActive && {
                        borderColor: activeBorder,
                        borderWidth: 2,
                      },
                    ]}
                  >
                    <View
                      style={[styles.avatarInner, { backgroundColor: ws.color }]}
                    >
                      <Text style={styles.avatarInitial}>
                        {ws.title.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    {ws.hasNotifications && (
                      <View
                        style={[
                          styles.workspaceDot,
                          { backgroundColor: colors.notificationDot },
                        ]}
                      />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.workspaceLabel,
                      { color: isActive ? textPrimary : textMuted },
                      isActive && { fontFamily: Fonts.sansMedium },
                    ]}
                    numberOfLines={1}
                  >
                    {ws.title}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={handleAddWorkspace}
              style={({ pressed }) => [
                styles.workspaceItem,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View
                style={[
                  styles.avatarOuter,
                  {
                    borderColor: isDark ? '#3b3a39' : 'rgba(0,0,0,0.12)',
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                  },
                ]}
              >
                <Plus size={18} color={textMuted} strokeWidth={1.8} />
              </View>
              <Text style={[styles.workspaceLabel, { color: textMuted }]}>
                Add
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={Math.max(0, selectedIndex)}
          onPageSelected={(e) => handlePageSelected(e.nativeEvent.position)}
          overdrag
        >
          {workspaces.map((ws) => (
            <View key={ws.id} style={styles.page}>
              <SessionPage
                workspaceId={ws.id}
                onSessionPress={(sessionId) => {
                  router.navigate(`/workspace/${ws.id}/s/${sessionId}`);
                  dismiss();
                }}
                onDismiss={dismiss}
              />
            </View>
          ))}
        </PagerView>

        <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={handleServersPress}
            style={({ pressed }) => [
              styles.footerItem,
              pressed && { opacity: 0.5 },
            ]}
          >
            <MaterialIcons name="dns" size={18} color={colors.icon} />
            <Text style={[styles.footerLabel, { color: textSecondary }]}>
              Servers
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSettingsPress}
            style={({ pressed }) => [
              styles.footerItem,
              pressed && { opacity: 0.5 },
            ]}
          >
            <MaterialIcons name="settings" size={18} color={colors.icon} />
            <Text style={[styles.footerLabel, { color: textSecondary }]}>
              Settings
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <NewWorkspaceDialog
        visible={showNewDialog}
        onClose={() => setShowNewDialog(false)}
      />
    </View>
  );
}

interface SessionPageProps {
  workspaceId: string;
  onSessionPress: (sessionId: string) => void;
  onDismiss: () => void;
}

function SessionPage({ workspaceId, onSessionPress, onDismiss }: SessionPageProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const pathname = usePathname();
  const selectedSessionId =
    pathname.match(new RegExp(`/workspace/${workspaceId}/s/([^/]+)`))?.[1] ?? null;

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const btnBg = isDark ? '#252525' : '#F0F0F0';

  const {
    sessions,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useSessions(workspaceId);

  const piClient = usePiClient();
  const [createPending, setCreatePending] = useState(false);

  const handleNewSession = useCallback(async () => {
    if (createPending) return;
    setCreatePending(true);
    requestBrowserNotificationPermission();
    try {
      const info = await piClient.createAgentSession({ workspaceId });
      router.navigate(`/workspace/${workspaceId}/s/${info.session_id}`);
      onDismiss();
    } catch {} finally { setCreatePending(false); }
  }, [workspaceId, createPending, piClient, router, onDismiss]);

  return (
    <View style={styles.pageContent}>
      <View style={styles.sessionsHeader}>
        <Text style={[styles.sessionsTitle, { color: textPrimary }]}>
          Sessions
        </Text>
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

      <View style={styles.actions}>
        <Pressable
          onPress={handleNewSession}
          disabled={createPending}
          style={({ pressed }) => [
            styles.newSessionButton,
            { backgroundColor: btnBg },
            pressed && { opacity: 0.8 },
          ]}
        >
          {createPending ? (
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
        style={styles.sessionList}
        contentContainerStyle={styles.sessionListContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
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
              onPress={() => onSessionPress(session.id)}
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
    height: SHEET_HEIGHT,
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  workspaceStrip: {
    paddingVertical: 12,
    marginHorizontal: 12,
    borderRadius: 10,
  },
  workspaceScrollContent: {
    paddingHorizontal: 12,
    gap: 16,
  },
  workspaceItem: {
    alignItems: 'center',
    width: 58,
  },
  avatarOuter: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: 'transparent',
    borderWidth: 2,
    position: 'relative',
  },
  avatarInner: {
    width: AVATAR_SIZE - 8,
    height: AVATAR_SIZE - 8,
    borderRadius: (AVATAR_SIZE - 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Fonts.sansSemiBold,
  },
  workspaceDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workspaceLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    marginTop: 4,
    textAlign: 'center',
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  pageContent: {
    flex: 1,
  },
  sessionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sessionsTitle: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    flex: 1,
  },
  iconButton: {
    padding: 6,
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: 10,
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
  sessionList: {
    flex: 1,
  },
  sessionListContent: {
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
  sheetFooter: {
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  footerLabel: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
});
