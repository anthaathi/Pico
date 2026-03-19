import { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
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
import { useRouter } from 'expo-router';
import { SquarePen, RefreshCw } from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatSessions } from '../hooks/use-chat-sessions';
import { useChatStore } from '../store';
import { SessionActivityIndicator } from '@/features/workspace/components/session-activity-indicator';
import type { SessionListItem } from '@/features/api/generated/types.gen';

const SHEET_HEIGHT = 520;
const TIMING_CONFIG = { duration: 280, easing: Easing.out(Easing.cubic) };

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ChatSheet({ visible, onClose }: ChatSheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const translateY = useSharedValue(SHEET_HEIGHT);
  const overlayOpacity = useSharedValue(0);

  const selectSession = useChatStore((s) => s.selectSession);

  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const btnBg = isDark ? '#252525' : '#F0F0F0';

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

  const handleNewChat = useCallback(() => {
    selectSession(null);
    router.replace('/chat');
    dismiss();
  }, [selectSession, router, dismiss]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
      router.replace({ pathname: '/chat/[sessionId]', params: { sessionId } });
      dismiss();
    },
    [selectSession, router, dismiss],
  );

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
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
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

        <ChatSessionList
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
          textPrimary={textPrimary}
          textMuted={textMuted}
          btnBg={btnBg}
          isDark={isDark}
        />
      </Animated.View>
    </View>
  );
}

function ChatSessionList({
  onNewChat,
  onSelectSession,
  textPrimary,
  textMuted,
  btnBg,
  isDark,
}: {
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  textPrimary: string;
  textMuted: string;
  btnBg: string;
  isDark: boolean;
}) {
  const {
    sessions,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useChatSessions();

  return (
    <View style={styles.listContent}>
      <View style={styles.sessionsHeader}>
        <Text style={[styles.sessionsTitle, { color: textPrimary }]}>Chat Sessions</Text>
        <Pressable
          onPress={() => refetch()}
          disabled={isRefetching}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
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
          onPress={onNewChat}
          style={({ pressed }) => [
            styles.newButton,
            { backgroundColor: btnBg },
            pressed && { opacity: 0.8 },
          ]}
        >
          <SquarePen size={14} color={textPrimary} strokeWidth={1.8} />
          <Text style={[styles.newButtonText, { color: textPrimary }]}>New chat</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.sessionList}
        contentContainerStyle={styles.sessionListContent}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : sessions.length === 0 ? (
          <Text style={[styles.emptyText, { color: textMuted }]}>No chats yet</Text>
        ) : (
          sessions.map((session: SessionListItem) => (
            <Pressable
              key={session.id}
              onPress={() => onSelectSession(session.id)}
              style={({ pressed }) => [styles.sessionItem, pressed && { opacity: 0.7 }]}
            >
              <SessionActivityIndicator sessionId={session.id} color={textMuted} />
              <Text style={[styles.sessionTitle, { color: textPrimary }]} numberOfLines={1}>
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
              <Text style={[styles.loadMoreText, { color: textMuted }]}>Load more</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  overlay: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    height: SHEET_HEIGHT,
  },
  handleBar: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  listContent: { flex: 1 },
  sessionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sessionsTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold, flex: 1 },
  iconBtn: { padding: 6 },
  actions: { paddingHorizontal: 16, paddingBottom: 10 },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 8,
  },
  newButtonText: { fontSize: 14, fontFamily: Fonts.sansMedium },
  sessionList: { flex: 1 },
  sessionListContent: { paddingHorizontal: 12, gap: 2 },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  sessionTitle: { fontSize: 14, fontFamily: Fonts.sans, flex: 1 },
  emptyText: { fontSize: 13, fontFamily: Fonts.sans, textAlign: 'center', marginTop: 24 },
  loadMoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    borderRadius: 8,
    marginTop: 8,
  },
  loadMoreText: { fontSize: 13, fontFamily: Fonts.sansMedium },
});
