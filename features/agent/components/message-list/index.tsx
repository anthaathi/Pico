import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowDown } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAgentStore } from "../../store";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

const EMPTY_MESSAGES: ChatMessage[] = [];
const BOTTOM_THRESHOLD = 300;

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

function getTurnSummary(
  messages: ChatMessage[],
  currentUserIdx: number,
): string | null {
  let prevUserIdx = -1;
  for (let i = currentUserIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      prevUserIdx = i;
      break;
    }
  }
  if (prevUserIdx < 0) return null;

  const startTs = messages[prevUserIdx].timestamp;
  const endTs = messages[currentUserIdx].timestamp;
  const duration = endTs - startTs;
  if (duration <= 0) return null;

  let wasInterrupted = false;
  for (let i = prevUserIdx + 1; i < currentUserIdx; i++) {
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
  if (!lastMsg || lastMsg.role === "user") return null;

  const duration = lastMsg.timestamp - messages[lastUserIdx].timestamp;
  if (duration <= 0) return null;

  const durationStr = formatDuration(duration);
  if (!durationStr) return null;

  const wasInterrupted = messages
    .slice(lastUserIdx + 1)
    .some((m) => m.role === "assistant" && m.stopReason === "aborted");

  return wasInterrupted ? `Interrupted after ${durationStr}` : `Worked for ${durationStr}`;
}

function formatModelName(modelId: string): string {
  const clean = modelId
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `Using ${clean}`;
}

function mergeConsecutiveToolCalls(messages: ChatMessage[]): {
  visible: ChatMessage[];
  merged: Map<string, ToolCallInfo[]>;
} {
  const visible: ChatMessage[] = [];
  const merged = new Map<string, ToolCallInfo[]>();
  let anchor: ChatMessage | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      anchor = null;
      visible.push(msg);
      continue;
    }

    const hasText =
      msg.text.length > 0 ||
      (!!msg.thinking && msg.thinking.length > 0);

    if (hasText || !anchor || msg.isStreaming) {
      anchor = msg.isStreaming ? null : msg;
      visible.push(msg);
      if (msg.toolCalls?.length) {
        merged.set(msg.id, [...msg.toolCalls]);
      }
    } else if (msg.toolCalls?.length) {
      if (!merged.has(anchor.id)) {
        merged.set(anchor.id, [...(anchor.toolCalls ?? [])]);
      }
      merged.get(anchor.id)!.push(...msg.toolCalls);
    }
  }

  return { visible, merged };
}

function TurnDivider({ label, isDark }: { label?: string | null; isDark: boolean }) {
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
}

export function MessageList({ sessionId }: { sessionId: string }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const messages = useAgentStore(
    (s) => s.messages[sessionId] ?? EMPTY_MESSAGES,
  );
  const isStreaming = useAgentStore(
    (s) => s.streaming[sessionId] ?? false,
  );

  const scrollRef = useRef<ScrollView>(null);
  const isNearBottomRef = useRef(true);
  const hasScrolledRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollToBottom = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(
    (e: any) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const maxScroll = contentSize.height - layoutMeasurement.height;
      if (maxScroll <= 0) {
        isNearBottomRef.current = true;
        setShowScrollButton(false);
        return;
      }
      hasScrolledRef.current = true;
      const distanceFromBottom = maxScroll - contentOffset.y;
      const nearBottom = distanceFromBottom < BOTTOM_THRESHOLD;
      isNearBottomRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    },
    [],
  );

  const handleContentSizeChange = useCallback(() => {
    if (!isNearBottomRef.current) return;
    setShowScrollButton(false);
    // Debounce: only one smooth scroll per frame to avoid jitter
    // from rapid content size changes during streaming.
    if (scrollTimerRef.current) return;
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 16);
  }, []);

  const { visible, merged } = useMemo(
    () => mergeConsecutiveToolCalls(messages),
    [messages],
  );

  useEffect(() => {
    hasHydratedRef.current = false;
    seenMessageIdsRef.current = new Set();
  }, [sessionId]);

  useEffect(() => {
    if (visible.length === 0) {
      return;
    }

    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      seenMessageIdsRef.current = new Set(visible.map((msg) => msg.id));
      return;
    }

    for (const msg of visible) {
      seenMessageIdsRef.current.add(msg.id);
    }
  }, [visible]);

  const lastTurnSummary = useMemo(() => {
    if (isStreaming) return null;
    return getLastTurnSummary(messages);
  }, [messages, isStreaming]);

  if (visible.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={100}
        onContentSizeChange={handleContentSizeChange}
      >
        {visible.map((msg, idx) => {
          const isNewTurn = msg.role === "user" && idx > 0;
          const animateOnMount =
            hasHydratedRef.current && !seenMessageIdsRef.current.has(msg.id);

          let modelChanged = false;
          if (msg.role === "assistant" && msg.model) {
            const prevAssistant = visible
              .slice(0, idx)
              .findLast((m) => m.role === "assistant");
            modelChanged =
              !prevAssistant || prevAssistant.model !== msg.model;
          }

          const turnSummary = isNewTurn
            ? getTurnSummary(messages, messages.indexOf(msg))
            : null;

          return (
            <View key={msg.id}>
              {isNewTurn && <TurnDivider label={turnSummary} isDark={isDark} />}

              {modelChanged && msg.model && (
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
                      {formatModelName(msg.model)}
                    </Text>
                  </View>
                </View>
              )}

              {msg.role === "user" ? (
                <UserMessage message={msg} />
              ) : (
                <AssistantMessage
                  message={msg}
                  toolCalls={merged.get(msg.id)}
                  animateOnMount={animateOnMount}
                />
              )}
            </View>
          );
        })}

        {lastTurnSummary && <TurnDivider label={lastTurnSummary} isDark={isDark} />}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {showScrollButton && (
        <Pressable
          onPress={() => {
            isNearBottomRef.current = true;
            setShowScrollButton(false);
            scrollToBottom();
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
    paddingTop: 12,
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
