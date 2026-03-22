import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from "react-native";
import { ArrowDown, CheckCircle2 } from "lucide-react-native";
import Animated, {
  SlideInUp,
  SlideOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { useQueryClient } from "@tanstack/react-query";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAgentSession, useTurnEnd } from "@pi-ui/client";
import { useWorkspaceStore } from "@/features/workspace/store";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { AssistantMessage } from "./assistant-message";
import { SystemMessage } from "./system-message";
import { UserMessage } from "./user-message";


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
  if (startTs == null) return null;

  // Find the last assistant/system message before the next user message
  // to avoid including idle time between the agent finishing and the user
  // sending the next message.
  let endTs: number | undefined;
  for (let i = currentUserIdx - 1; i > previousUserIdx; i--) {
    if (messages[i].role !== "user") {
      endTs = messages[i].timestamp;
      break;
    }
  }
  if (endTs == null) return null;

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

function ShimmerLine({ width, isDark }: { width: `${number}%` | number; isDark: boolean }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        shimmerStyles.line,
        animStyle,
        {
          width,
          backgroundColor: isDark ? "#2A2A2A" : "#E8E8E8",
        },
      ]}
    />
  );
}

function MessageShimmer({ isDark }: { isDark: boolean }) {
  return (
    <View style={shimmerStyles.container}>
      <View style={shimmerStyles.userBlock}>
        <ShimmerLine width="45%" isDark={isDark} />
      </View>
      <View style={shimmerStyles.assistantBlock}>
        <ShimmerLine width="90%" isDark={isDark} />
        <ShimmerLine width="100%" isDark={isDark} />
        <ShimmerLine width="75%" isDark={isDark} />
        <ShimmerLine width="60%" isDark={isDark} />
      </View>
      <View style={shimmerStyles.userBlock}>
        <ShimmerLine width="35%" isDark={isDark} />
      </View>
      <View style={shimmerStyles.assistantBlock}>
        <ShimmerLine width="85%" isDark={isDark} />
        <ShimmerLine width="95%" isDark={isDark} />
        <ShimmerLine width="50%" isDark={isDark} />
      </View>
    </View>
  );
}

const shimmerStyles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 20,
    maxWidth: 1080,
    alignSelf: "center",
    width: "100%",
  },
  userBlock: {
    alignItems: "flex-end",
    gap: 8,
  },
  assistantBlock: {
    gap: 8,
  },
  line: {
    height: 14,
    borderRadius: 7,
  },
});

const BANNER_DURATION = 4000;

interface BannerInfo {
  sessionId: string;
  workspaceId?: string;
  workspaceTitle: string;
  sessionLabel: string;
}

function TurnCompleteBanner({
  info,
  isDark,
  onView,
}: {
  info: BannerInfo;
  isDark: boolean;
  onView: () => void;
}) {
  const bg = isDark ? "#1A2E1A" : "#E8F5E9";
  const textColor = isDark ? "#C8E6C9" : "#2E7D32";
  const mutedColor = isDark ? "#81C784" : "#388E3C";
  const iconColor = isDark ? "#66BB6A" : "#43A047";
  const btnBg = isDark ? "#2E7D32" : "#43A047";

  return (
    <Animated.View
      entering={SlideInUp.duration(300)}
      exiting={SlideOutUp.duration(200)}
      style={[bannerStyles.container, { backgroundColor: bg }]}
    >
      <View style={bannerStyles.content}>
        <CheckCircle2 size={15} color={iconColor} strokeWidth={2} />
        <View style={bannerStyles.textWrap}>
          <Text style={[bannerStyles.title, { color: textColor }]} numberOfLines={1}>
            {info.workspaceTitle}
          </Text>
          <Text style={[bannerStyles.subtitle, { color: mutedColor }]} numberOfLines={1}>
            {info.sessionLabel}
          </Text>
        </View>
        <Pressable style={[bannerStyles.viewBtn, { backgroundColor: btnBg }]} onPress={onView}>
          <Text style={bannerStyles.viewBtnText}>View</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  textWrap: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  viewBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  viewBtnText: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});

function findSessionName(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  targetSessionId: string,
): string | null {
  if (!workspaceId) return null;
  const cache = queryClient.getQueryData<{ pages: { items: { id: string; display_name?: string | null }[] }[] }>(
    ["sessions", workspaceId],
  );
  if (!cache?.pages) return null;
  for (const page of cache.pages) {
    const match = page.items.find((s) => s.id === targetSessionId);
    if (match?.display_name) return match.display_name;
  }
  return null;
}

export function MessageList({ sessionId }: { sessionId: string }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const router = useRouter();
  const queryClient = useQueryClient();

  const session = useAgentSession(sessionId);
  const messages = session.messages as ChatMessage[];
  const isStreaming = session.isStreaming;

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessionWorkspaceById = useWorkspaceStore((s) => s.sessionWorkspaceById);

  const listRef = useRef<FlatList<VisibleMessageItem>>(null);
  const isNearBottomRef = useRef(true);
  const hasHydratedRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showScrollButtonRef = useRef(false);
  const contentDirtyRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Turn-complete haptic + banner via agent_end event
  const [bannerInfo, setBannerInfo] = useState<BannerInfo | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTurnEnd(useCallback((event) => {
    const isSameSession = event.sessionId === sessionId;

    // Haptic only when viewing the session that just finished
    if (isSameSession && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    // Skip banner if viewing the session that just completed
    if (isSameSession) return;

    // Resolve workspace title and session name
    const wsId = event.workspaceId ?? sessionWorkspaceById[event.sessionId];
    const ws = wsId ? workspaces.find((w) => w.id === wsId) : undefined;
    const workspaceTitle = ws?.title ?? "Session";
    const sessionName = findSessionName(queryClient, wsId, event.sessionId);
    const sessionLabel = sessionName
      ? `Ready · ${sessionName}`
      : "Ready";

    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBannerInfo({
      sessionId: event.sessionId,
      workspaceId: wsId,
      workspaceTitle,
      sessionLabel,
    });
    bannerTimerRef.current = setTimeout(() => {
      setBannerInfo(null);
      bannerTimerRef.current = null;
    }, BANNER_DURATION);
  }, [sessionId, workspaces, sessionWorkspaceById, queryClient]));

  const handleBannerView = useCallback(() => {
    if (!bannerInfo) return;
    // Clear banner
    setBannerInfo(null);
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    // Navigate to the completed session
    if (bannerInfo.workspaceId && bannerInfo.workspaceId !== "__chat__") {
      router.navigate(
        `/workspace/${bannerInfo.workspaceId}/s/${bannerInfo.sessionId}` as any,
      );
    } else {
      router.navigate(
        `/chat/${bannerInfo.sessionId}` as any,
      );
    }
  }, [bannerInfo, router]);

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

  // Mark content dirty when messages change so auto-scroll only fires for
  // real data updates, not layout-only changes (e.g. keyboard appearing).
  useEffect(() => {
    contentDirtyRef.current = true;
  }, [messages]);

  const handleContentSizeChange = useCallback(() => {
    if (!isNearBottomRef.current) return;
    if (!contentDirtyRef.current) return;
    contentDirtyRef.current = false;

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
    contentDirtyRef.current = false;
    setScrollButtonVisible(false);

    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setBannerInfo(null);
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
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
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
    if (session.isLoading) {
      return <MessageShimmer isDark={isDark} />;
    }
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

      {bannerInfo ? (
        <TurnCompleteBanner info={bannerInfo} isDark={isDark} onView={handleBannerView} />
      ) : null}

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
