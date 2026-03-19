import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from "react-native";
import { ArrowDown } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAgentStore } from "../../store";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { AssistantMessage } from "./assistant-message";
import { SystemMessage } from "./system-message";
import { UserMessage } from "./user-message";

const EMPTY_MESSAGES: ChatMessage[] = [];
const BOTTOM_THRESHOLD = 300;
const INITIAL_BATCH_SIZE = 10;

interface MergedMessageItem {
  message: ChatMessage;
  originalIndex: number;
  toolCalls?: ToolCallInfo[];
}

interface VisibleMessageItem {
  message: ChatMessage;
  toolCalls?: ToolCallInfo[];
  showTurnDivider: boolean;
  turnSummary: string | null;
  modelLabel: string | null;
  animateOnMount: boolean;
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 1) return "";
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

function getTurnSummaryForRange(
  messages: ChatMessage[],
  previousUserIdx: number,
  currentUserIdx: number,
): string | null {
  if (previousUserIdx < 0) return null;

  const startTs = messages[previousUserIdx]?.timestamp;
  const endTs = messages[currentUserIdx]?.timestamp;
  if (startTs == null || endTs == null) return null;

  const duration = endTs - startTs;
  if (duration <= 0) return null;

  let wasInterrupted = false;
  for (let i = previousUserIdx + 1; i < currentUserIdx; i++) {
    if (messages[i].role === "assistant" && messages[i].stopReason === "aborted") {
      wasInterrupted = true;
      break;
    }
  }

  const durationStr = formatDuration(duration);
  if (!durationStr) return null;
  return wasInterrupted ? `Interrupted after ${durationStr}` : `Worked for ${durationStr}`;
}

function getLastTurnSummary(messages: ChatMessage[]): string | null {
  const lastUserIdx = findLastIndex(messages, (m) => m.role === "user");
  if (lastUserIdx < 0) return null;

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") return null;

  const duration = lastMsg.timestamp - messages[lastUserIdx].timestamp;
  if (duration <= 0) return null;

  const durationStr = formatDuration(duration);
  if (!durationStr) return null;

  let wasInterrupted = false;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i].stopReason === "aborted") {
      wasInterrupted = true;
      break;
    }
  }

  return wasInterrupted ? `Interrupted after ${durationStr}` : `Worked for ${durationStr}`;
}

function formatModelName(modelId: string): string {
  const clean = modelId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `Using ${clean}`;
}

function areToolCallArraysEqual(
  left?: ToolCallInfo[],
  right?: ToolCallInfo[],
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function mergeConsecutiveToolCalls(messages: ChatMessage[]): MergedMessageItem[] {
  const visible: MergedMessageItem[] = [];
  let anchor: MergedMessageItem | null = null;

  for (let index = 0; index < messages.length; index++) {
    const msg = messages[index]!;
    if (msg.role === "user" || msg.role === "system") {
      anchor = null;
      visible.push({
        message: msg,
        originalIndex: index,
      });
      continue;
    }

    const hasText =
      msg.text.length > 0 ||
      (!!msg.errorMessage && msg.errorMessage.length > 0) ||
      (!!msg.thinking && msg.thinking.length > 0);
    const toolCalls = msg.toolCalls?.length ? msg.toolCalls : undefined;

    if (hasText || !anchor || msg.isStreaming) {
      const item: MergedMessageItem = {
        message: msg,
        originalIndex: index,
        toolCalls,
      };
      anchor = msg.isStreaming ? null : item;
      visible.push(item);
      continue;
    }

    if (toolCalls?.length && anchor) {
      anchor.toolCalls = anchor.toolCalls?.length
        ? [...anchor.toolCalls, ...toolCalls]
        : [...toolCalls];
    }
  }

  return visible;
}

function buildVisibleMessageItems(
  messages: ChatMessage[],
  hasHydrated: boolean,
  seenMessageIds: Set<string>,
): VisibleMessageItem[] {
  const visible = mergeConsecutiveToolCalls(messages);
  let previousUserIdx = -1;
  let previousAssistantModel: string | undefined;

  return visible.map((item, visibleIndex) => {
    const { message, originalIndex, toolCalls } = item;
    const showTurnDivider = message.role === "user" && visibleIndex > 0;
    const turnSummary = showTurnDivider
      ? getTurnSummaryForRange(messages, previousUserIdx, originalIndex)
      : null;

    if (message.role === "user") {
      previousUserIdx = originalIndex;
    }

    let modelLabel: string | null = null;
    if (message.role === "assistant" && message.model) {
      if (previousAssistantModel !== message.model) {
        modelLabel = formatModelName(message.model);
      }
      previousAssistantModel = message.model;
    }

    return {
      message,
      toolCalls,
      showTurnDivider,
      turnSummary,
      modelLabel,
      animateOnMount: hasHydrated && !seenMessageIds.has(message.id),
    };
  });
}

const TurnDivider = memo(function TurnDivider({
  label,
  isDark,
}: {
  label?: string | null;
  isDark: boolean;
}) {
  const lineColor = isDark ? "#222" : "#EEEEEE";
  const textColor = isDark ? "#555" : "#BBBBBB";

  return (
    <View style={styles.turnDivider}>
      <View style={[styles.turnLine, { backgroundColor: lineColor }]} />
      {label ? (
        <Text style={[styles.turnLabel, { color: textColor }]}>{label}</Text>
      ) : null}
      <View style={[styles.turnLine, { backgroundColor: lineColor }]} />
    </View>
  );
});

const ModelDivider = memo(function ModelDivider({
  label,
  isDark,
}: {
  label: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.modelDivider}>
      <View
        style={[
          styles.modelPill,
          { backgroundColor: isDark ? "#1E1E1E" : "#F3F3F3" },
        ]}
      >
        <Text
          style={[
            styles.modelPillText,
            { color: isDark ? "#888" : "#777" },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
});

const MessageRow = memo(
  function MessageRow({
    item,
    isDark,
  }: {
    item: VisibleMessageItem;
    isDark: boolean;
  }) {
    const { message, toolCalls, showTurnDivider, turnSummary, modelLabel, animateOnMount } =
      item;

    return (
      <View>
        {showTurnDivider ? (
          <TurnDivider label={turnSummary} isDark={isDark} />
        ) : null}

        {modelLabel ? <ModelDivider label={modelLabel} isDark={isDark} /> : null}

        {message.role === "user" ? (
          <UserMessage message={message} />
        ) : message.role === "assistant" ? (
          <AssistantMessage
            message={message}
            toolCalls={toolCalls}
            animateOnMount={animateOnMount}
          />
        ) : (
          <SystemMessage message={message} />
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.isDark === next.isDark &&
    prev.item.message === next.item.message &&
    areToolCallArraysEqual(prev.item.toolCalls, next.item.toolCalls) &&
    prev.item.showTurnDivider === next.item.showTurnDivider &&
    prev.item.turnSummary === next.item.turnSummary &&
    prev.item.modelLabel === next.item.modelLabel &&
    prev.item.animateOnMount === next.item.animateOnMount,
);

const MessageListFooter = memo(function MessageListFooter({
  lastTurnSummary,
  isDark,
}: {
  lastTurnSummary: string | null;
  isDark: boolean;
}) {
  return (
    <View>
      {lastTurnSummary ? (
        <TurnDivider label={lastTurnSummary} isDark={isDark} />
      ) : null}
      <View style={styles.bottomPadding} />
    </View>
  );
});

export function MessageList({ sessionId }: { sessionId: string }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const messages = useAgentStore((s) => s.messages[sessionId] ?? EMPTY_MESSAGES);
  const isStreaming = useAgentStore((s) => s.streaming[sessionId] ?? false);

  const listRef = useRef<FlatList<VisibleMessageItem>>(null);
  const isNearBottomRef = useRef(true);
  const hasHydratedRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showScrollButtonRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const setScrollButtonVisible = useCallback((nextVisible: boolean) => {
    if (showScrollButtonRef.current === nextVisible) {
      return;
    }

    showScrollButtonRef.current = nextVisible;
    setShowScrollButton(nextVisible);
  }, []);

  const scrollToLatest = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const visibleItems = useMemo(
    () =>
      buildVisibleMessageItems(
        messages,
        hasHydratedRef.current,
        seenMessageIdsRef.current,
      ),
    [messages],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const maxScroll = contentSize.height - layoutMeasurement.height;
      if (maxScroll <= 0) {
        isNearBottomRef.current = true;
        setScrollButtonVisible(false);
        return;
      }

      const nearBottom = contentOffset.y < BOTTOM_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setScrollButtonVisible(!nearBottom);
    },
    [setScrollButtonVisible],
  );

  const handleContentSizeChange = useCallback(() => {
    if (!isNearBottomRef.current) return;

    setScrollButtonVisible(false);
    if (scrollTimerRef.current) return;

    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }, 16);
  }, [setScrollButtonVisible]);

  useEffect(() => {
    hasHydratedRef.current = false;
    seenMessageIdsRef.current = new Set();
    isNearBottomRef.current = true;
    setScrollButtonVisible(false);

    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  }, [sessionId, setScrollButtonVisible]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      return;
    }

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      seenMessageIdsRef.current = new Set(
        visibleItems.map((item) => item.message.id),
      );
      return;
    }

    for (const item of visibleItems) {
      seenMessageIdsRef.current.add(item.message.id);
    }
  }, [visibleItems]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const lastTurnSummary = useMemo(() => {
    if (isStreaming) return null;
    return getLastTurnSummary(messages);
  }, [messages, isStreaming]);

  const footer = useMemo(
    () => <MessageListFooter lastTurnSummary={lastTurnSummary} isDark={isDark} />,
    [isDark, lastTurnSummary],
  );

  const renderItem = useCallback(
    ({ item }: { item: VisibleMessageItem }) => (
      <MessageRow item={item} isDark={isDark} />
    ),
    [isDark],
  );

  const reversedVisibleItems = useMemo(
    () => [...visibleItems].reverse(),
    [visibleItems],
  );

  const keyExtractor = useCallback(
    (item: VisibleMessageItem) => item.message.id,
    [],
  );

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={reversedVisibleItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.list}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        inverted
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
        initialNumToRender={INITIAL_BATCH_SIZE}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={16}
        windowSize={7}
        ListHeaderComponent={footer}
        showsVerticalScrollIndicator={false}
      />

      {showScrollButton ? (
        <Pressable
          onPress={() => {
            isNearBottomRef.current = true;
            setScrollButtonVisible(false);
            scrollToLatest();
          }}
          style={[
            styles.scrollButton,
            {
              backgroundColor: isDark ? "#2A2A2A" : "#FFFFFF",
              borderColor: isDark ? "#3A3A3A" : "#E0E0E0",
            },
          ]}
        >
          <ArrowDown
            size={16}
            color={isDark ? "#CCCCCC" : "#333333"}
            strokeWidth={2}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  contentContainer: {
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
    paddingBottom: 12,
  },
  turnDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 12,
    gap: 10,
  },
  turnLine: {
    flex: 1,
    height: 1,
  },
  turnLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  modelDivider: {
    alignItems: "center",
    paddingVertical: 8,
  },
  modelPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  modelPillText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  bottomPadding: {
    height: 48,
  },
  scrollButton: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.1)",
    elevation: 3,
  },
});
