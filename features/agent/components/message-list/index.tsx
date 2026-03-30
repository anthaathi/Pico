import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { ArrowDown } from "lucide-react-native";
import { useAgentSession } from "@pi-ui/client";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import { SystemMessage } from "./system-message";

interface MessageListProps {
  sessionId: string;
}

interface VisibleMessageItem {
  key: string;
  message: ChatMessage;
  toolCalls?: ToolCallInfo[];
  turnDurationMs?: number;
}

function mergeConsecutiveToolCalls(
  messages: ChatMessage[],
  turnDurations: Map<string, number>,
): VisibleMessageItem[] {
  const visible: VisibleMessageItem[] = [];
  let anchor: VisibleMessageItem | null = null;

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]!;
    const hasText =
      msg.text.length > 0 ||
      (!!msg.errorMessage && msg.errorMessage.length > 0) ||
      (!!msg.thinking && msg.thinking.length > 0);
    const toolCalls = msg.toolCalls?.length ? msg.toolCalls : undefined;
    const turnDurationMs = turnDurations.get(msg.id);

    if (msg.role === "user" || msg.role === "system") {
      anchor = null;
      visible.push({ key: msg.id, message: msg, turnDurationMs });
      continue;
    }

    if (hasText || !anchor || msg.isStreaming) {
      const item: VisibleMessageItem = {
        key: msg.id,
        message: msg,
        toolCalls,
        turnDurationMs,
      };
      anchor = msg.isStreaming ? null : item;
      visible.push(item);
      continue;
    }

    if (toolCalls?.length && anchor) {
      anchor.toolCalls = anchor.toolCalls?.length
        ? [...anchor.toolCalls, ...toolCalls]
        : [...toolCalls];
      anchor.turnDurationMs = anchor.turnDurationMs ?? turnDurationMs;
    }
  }

  return visible;
}

const SCROLL_THRESHOLD = 200;
const INITIAL_RENDER_COUNT = 8;
const RENDER_BATCH_COUNT = 4;
const WINDOW_SIZE = 7;

export const MessageList = memo(function MessageList({
  sessionId,
}: MessageListProps) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme];
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);

  const session = useAgentSession(sessionId);
  const messages = session.messages as ChatMessage[];
  const isStreaming = session.isStreaming;

  const prevMessageCountRef = useRef(messages.length);

  const turnDurations = useMemo(() => {
    const map = new Map<string, number>();
    let turnStartTs: number | null = null;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === "user") {
        turnStartTs = msg.timestamp;
      } else if (msg.role === "assistant" && msg.stopReason === "stop" && turnStartTs) {
        map.set(msg.id, msg.timestamp - turnStartTs);
        turnStartTs = null;
      }
    }
    return map;
  }, [messages]);

  const visibleItems = useMemo(
    () => mergeConsecutiveToolCalls(messages, turnDurations),
    [messages, turnDurations],
  );
  const reversed = useMemo(() => [...visibleItems].reverse(), [visibleItems]);

  useEffect(() => {
    if (!autoFollow) return;
    const countChanged = messages.length !== prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (countChanged) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
    }
  }, [messages.length, autoFollow]);

  useEffect(() => {
    if (!isStreaming || !autoFollow) return;
    const id = setInterval(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 800);
    return () => clearInterval(id);
  }, [isStreaming, autoFollow]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const isAwayFromBottom = e.nativeEvent.contentOffset.y > SCROLL_THRESHOLD;
      setShowScrollButton(isAwayFromBottom);
      setAutoFollow(!isAwayFromBottom);
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    setAutoFollow(true);
    setShowScrollButton(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const handleLoadMore = useCallback(() => {
    if (session.hasMoreMessages && !session.isLoadingOlderMessages) {
      session.loadOlderMessages();
    }
  }, [session]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<VisibleMessageItem>) => (
      <MessageItem
        message={item.message}
        toolCalls={item.toolCalls}
        isDark={isDark}
        turnDurationMs={item.turnDurationMs}
      />
    ),
    [isDark],
  );

  const keyExtractor = useCallback((item: VisibleMessageItem) => item.key, []);

  const listFooter = (
    <View style={styles.historyLoaderWrap}>
      {session.isLoadingOlderMessages ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(180)}
          style={styles.historyLoader}
        >
          <ActivityIndicator size="small" color={colors.textTertiary} />
        </Animated.View>
      ) : session.hasMoreMessages ? (
        <Pressable onPress={handleLoadMore} style={styles.loadMoreBtn}>
          <Text style={[styles.loadMoreText, { color: colors.textTertiary }]}>
            Load earlier messages
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={reversed as VisibleMessageItem[]}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        inverted
        style={styles.list}
        contentContainerStyle={styles.content}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        initialNumToRender={INITIAL_RENDER_COUNT}
        maxToRenderPerBatch={RENDER_BATCH_COUNT}
        updateCellsBatchingPeriod={50}
        windowSize={WINDOW_SIZE}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
        }}
        ListFooterComponent={listFooter}
      />
      {showScrollButton && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={styles.scrollBtnWrap}
        >
          <Pressable
            onPress={scrollToBottom}
            style={[
              styles.scrollBtn,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            ]}
          >
            <ArrowDown size={16} color={colors.icon} strokeWidth={2} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

const TurnDivider = memo(function TurnDivider({
  durationMs,
  isDark,
}: {
  durationMs: number;
  isDark: boolean;
}) {
  const colors = isDark ? Colors.dark : Colors.light;
  return (
    <View style={styles.dividerWrap}>
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      <Text style={[styles.dividerText, { color: colors.textTertiary }]}>
        Worked for {formatDuration(durationMs)}
      </Text>
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
    </View>
  );
});

const MessageItem = memo(function MessageItem({
  message,
  toolCalls,
  isDark,
  turnDurationMs,
}: {
  message: ChatMessage;
  toolCalls?: ToolCallInfo[];
  isDark: boolean;
  turnDurationMs?: number;
}) {
  const content = (() => {
    switch (message.role) {
      case "user":
        return <UserMessage message={message} isDark={isDark} />;
      case "assistant":
        return <AssistantMessage message={message} toolCallsOverride={toolCalls} isDark={isDark} />;
      case "system":
        return <SystemMessage message={message} isDark={isDark} />;
      default:
        return null;
    }
  })();

  return (
    <Animated.View
      layout={LinearTransition.duration(180)}
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(140)}
      style={styles.itemWrap}
    >
      {content}
      {typeof turnDurationMs === "number" && turnDurationMs > 0 && (
        <TurnDivider durationMs={turnDurationMs} isDark={isDark} />
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  content: {
    paddingTop: 8,
    paddingBottom: 24,
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
  },
  itemWrap: { paddingVertical: 2 },
  dividerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  historyLoaderWrap: {
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  historyLoader: {
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  loadMoreText: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
  },
  scrollBtnWrap: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
  },
  scrollBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
});
