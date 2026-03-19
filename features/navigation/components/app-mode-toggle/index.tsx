import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppMode, type AppMode } from '@/hooks/use-app-mode';
import { useWorkspaceStore } from '@/features/workspace/store';
import { useChatStore } from '@/features/chat/store';

const MODES: { key: AppMode; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'code', label: 'Code' },
];

const TAB_WIDTH = 56;
const TAB_GAP = 1;
const PILL_TRAVEL = TAB_WIDTH + TAB_GAP;

export function AppModeToggle() {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme];
  const router = useRouter();
  const appMode = useAppMode();
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null);

  const visualMode = pendingMode ?? appMode;
  const activeIndex = MODES.findIndex((m) => m.key === visualMode);
  const slideX = useRef(new Animated.Value(activeIndex * PILL_TRAVEL)).current;

  const animateToIndex = useCallback(
    (index: number) => {
      Animated.spring(slideX, {
        toValue: index * PILL_TRAVEL,
        tension: 320,
        friction: 30,
        useNativeDriver: true,
      }).start();
    },
    [slideX],
  );

  useEffect(() => {
    animateToIndex(activeIndex);
  }, [activeIndex, animateToIndex]);

  useEffect(() => {
    if (pendingMode === appMode) {
      setPendingMode(null);
    }
  }, [appMode, pendingMode]);

  const handleSelect = useCallback(
    (mode: AppMode) => {
      if (mode === visualMode) return;

      const workspaceId = useWorkspaceStore.getState().selectedWorkspaceId;
      const lastChatSession = useChatStore.getState().lastSessionId;
      const target =
        mode === 'chat'
          ? lastChatSession
            ? { pathname: '/chat/[sessionId]' as const, params: { sessionId: lastChatSession } }
            : '/chat'
          : workspaceId
            ? { pathname: '/workspace/[workspaceId]' as const, params: { workspaceId } }
            : null;

      if (!target) return;

      setPendingMode(mode);
      startTransition(() => {
        router.replace(target);
      });
    },
    [router, visualMode],
  );

  const containerBg = isDark ? '#242422' : '#ECEBE7';
  const containerBorder = isDark ? '#3b3a39' : 'rgba(0,0,0,0.10)';
  const activeBg = isDark ? '#343432' : '#FFFFFF';
  const textActive = isDark ? '#fefdfd' : colors.text;
  const textInactive = isDark ? '#afaca9' : colors.textTertiary;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: containerBg, borderColor: containerBorder },
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: activeBg,
            transform: [{ translateX: slideX }],
          },
        ]}
      />
      {MODES.map((mode) => {
        const isActive = visualMode === mode.key;
        return (
          <Pressable
            key={mode.key}
            onPress={() => handleSelect(mode.key)}
            style={({ pressed }) => [
              styles.tab,
              pressed && !isActive && { opacity: 0.72 },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                { color: isActive ? textActive : textInactive },
                isActive && { fontFamily: Fonts.sansMedium },
              ]}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.633,
    borderRadius: 999,
    padding: 2,
    gap: TAB_GAP,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: TAB_WIDTH,
    height: 26,
    borderRadius: 999,
  },
  tab: {
    width: TAB_WIDTH,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tabText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
  },
});
