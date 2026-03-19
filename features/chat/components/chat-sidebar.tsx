import { useRef, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname } from 'expo-router';
import { SquarePen, RefreshCw } from 'lucide-react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatSessions } from '../hooks/use-chat-sessions';
import type { SessionListItem } from '@/features/api/generated/types.gen';
import { SessionActivityIndicator } from '@/features/workspace/components/session-activity-indicator';

interface ChatSidebarProps {
  onNewSession: () => void;
  onSelectSession: (sessionId: string, filePath: string) => void;
}

export function ChatSidebar({ onNewSession, onSelectSession }: ChatSidebarProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const pathname = usePathname();
  const chatMatch = pathname.match(/\/chat\/([^/]+)/);
  const selectedSessionId = chatMatch?.[1] ?? null;

  const {
    sessions,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
  } = useChatSessions();

  const bg = colors.background;
  const borderColor = isDark ? '#323131' : 'rgba(0,0,0,0.08)';
  const textPrimary = isDark ? '#fefdfd' : colors.text;
  const textMuted = isDark ? '#cdc8c5' : colors.textTertiary;
  const btnBg = isDark ? '#191919' : '#F0F0F0';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: bg,
          borderLeftColor: borderColor,
          borderTopColor: borderColor,
          height: '100%',
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.title, { color: textPrimary }]}>Chat</Text>
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
          onPress={onNewSession}
          style={({ pressed }) => [
            styles.newSessionButton,
            { backgroundColor: btnBg },
            pressed && { opacity: 0.8 },
          ]}
        >
          <SquarePen size={14} color={textPrimary} strokeWidth={1.8} />
          <Text style={[styles.newSessionText, { color: textPrimary }]}>
            New chat
          </Text>
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
          <Text style={[styles.emptyText, { color: textMuted }]}>
            No chats yet
          </Text>
        ) : (
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelect={onSelectSession}
            textPrimary={textPrimary}
            textMuted={textMuted}
            isDark={isDark}
          />
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

function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  textPrimary,
  textMuted,
  isDark,
}: {
  sessions: SessionListItem[];
  selectedSessionId: string | null;
  onSelect: (id: string, filePath: string) => void;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isSelected={session.id === selectedSessionId}
          onSelect={onSelect}
          textPrimary={textPrimary}
          textMuted={textMuted}
          isDark={isDark}
        />
      ))}
    </Animated.View>
  );
}

function SessionItem({
  session,
  isSelected,
  onSelect,
  textPrimary,
  textMuted,
  isDark,
}: {
  session: SessionListItem;
  isSelected: boolean;
  onSelect: (id: string, filePath: string) => void;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
}) {
  const title = session.display_name ?? session.id;
  const selectedBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <Pressable
      onPress={() => onSelect(session.id, session.file_path)}
      style={({ pressed }) => [
        styles.sessionItem,
        isSelected && { backgroundColor: selectedBg },
        pressed && { opacity: 0.7 },
      ]}
    >
      <SessionActivityIndicator sessionId={session.id} color={textMuted} />
      <Text
        style={[styles.sessionTitle, { color: textPrimary }]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  header: {
    paddingLeft: 24,
    paddingRight: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
    lineHeight: 21,
  },
  actions: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  iconButton: {
    padding: 6,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    borderRadius: 6,
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
    paddingTop: 24,
    gap: 4,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sessionTitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    flex: 1,
    lineHeight: 25.2,
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
    height: 32,
    borderRadius: 6,
    marginTop: 8,
  },
  loadMoreText: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
});
