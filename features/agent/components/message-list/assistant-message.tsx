import React, { memo, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronDown, ChevronRight, Brain, AlertCircle } from "lucide-react-native";
import { useMarkdown, type useMarkdownHookOptions } from "react-native-marked";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ChatMessage, ToolCallInfo } from "../../types";
import { ToolCallGroup, groupToolCalls } from "./tool-call-group";
import { markedDarkOptions, markedLightOptions } from "../../theme";

function StreamingCursor() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [scale, opacity]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={cursorStyles.container}>
      <Animated.View style={[cursorStyles.dot, dotStyle]} />
    </View>
  );
}

const cursorStyles = StyleSheet.create({
  container: {
    width: 10,
    height: 18,
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#D71921",
  },
});

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

function AssistantMessageComponent({
  message,
  toolCalls: overrideToolCalls,
  animateOnMount: _animateOnMount = true,
}: {
  message: ChatMessage;
  toolCalls?: ToolCallInfo[];
  animateOnMount?: boolean;
}) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const effectiveToolCalls = overrideToolCalls ?? message.toolCalls;
  const hasThinking = !!message.thinking && message.thinking.length > 0;
  const hasToolCalls =
    !!effectiveToolCalls && effectiveToolCalls.length > 0;
  const hasNotice =
    ["error", "aborted"].includes(message.stopReason ?? "") &&
    !!message.errorMessage &&
    message.errorMessage.length > 0;
  const noticeLabel =
    message.stopReason === "aborted" ? "Stopped" : "Request Failed";
  const noticeMeta = [message.provider, message.model]
    .filter(Boolean)
    .join(" · ");

  const markdownOptions = useMemo<useMarkdownHookOptions>(
    () => (isDark ? markedDarkOptions : markedLightOptions),
    [isDark],
  );
  const markdownElements = useMarkdown(message.text, markdownOptions);
  const groupedToolCalls = useMemo(
    () => (effectiveToolCalls ? groupToolCalls(effectiveToolCalls) : []),
    [effectiveToolCalls],
  );
  const noticeBlock = hasNotice ? (
    <View
      style={[
        styles.errorBlock,
        {
          backgroundColor: isDark ? "#171313" : "#FCF8F7",
        },
      ]}
    >
      <View style={styles.errorHeader}>
        <AlertCircle
          size={14}
          color={isDark ? "#C28B84" : "#B35B52"}
          strokeWidth={1.9}
        />
        <Text
          style={[
            styles.errorLabel,
            { color: isDark ? "#CDA7A2" : "#9C5B54" },
          ]}
        >
          {noticeLabel}
        </Text>
        {noticeMeta ? (
          <Text
            style={[
              styles.errorMeta,
              { color: isDark ? "#8E7570" : "#AD817A" },
            ]}
          >
            {noticeMeta}
          </Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.errorText,
          { color: isDark ? "#CDBAB7" : "#6C5552" },
        ]}
        selectable
      >
        {message.errorMessage}
      </Text>
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      {hasThinking && (
        <Pressable
          style={styles.thinkingToggle}
          onPress={() => setThinkingExpanded(!thinkingExpanded)}
        >
          <Brain
            size={13}
            color={colors.textTertiary}
            strokeWidth={1.8}
          />
          <Text
            style={[
              styles.thinkingLabel,
              { color: colors.textTertiary },
            ]}
          >
            Thinking
          </Text>
          {thinkingExpanded ? (
            <ChevronDown
              size={13}
              color={colors.textTertiary}
              strokeWidth={1.8}
            />
          ) : (
            <ChevronRight
              size={13}
              color={colors.textTertiary}
              strokeWidth={1.8}
            />
          )}
        </Pressable>
      )}

      {hasThinking && thinkingExpanded && (
        <View
          style={[
            styles.thinkingBlock,
            {
              backgroundColor: isDark ? "#1A1A1A" : "#F5F5F5",
              borderColor: isDark ? "#2A2A2A" : "#E8E8E8",
            },
          ]}
        >
          <Text
            style={[
              styles.thinkingText,
              { color: isDark ? "#888" : "#666" },
            ]}
            selectable
          >
            {message.thinking}
          </Text>
        </View>
      )}

      {message.text.length > 0 && (
        <View style={styles.markdownWrap}>
          {markdownElements.map((el, i) => (
            <View key={i} style={styles.markdownBlock}>
              {el}
            </View>
          ))}
          {message.isStreaming && !hasToolCalls && (
            <View style={styles.cursorWrap}>
              <StreamingCursor />
            </View>
          )}
        </View>
      )}

      {message.isStreaming && message.text.length === 0 && !hasToolCalls && (
        <StreamingCursor />
      )}

      {noticeBlock}

      {hasToolCalls && (
        <View style={styles.toolCalls}>
          {groupedToolCalls.map((item) => (
            <ToolCallGroup
              key={item.key}
              toolName={item.toolName}
              calls={item.calls}
            />
          ))}
          {message.isStreaming && (
            <View style={styles.toolStreaming}>
              <StreamingCursor />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export const AssistantMessage = memo(
  AssistantMessageComponent,
  (prev, next) =>
    prev.message === next.message &&
    areToolCallArraysEqual(prev.toolCalls, next.toolCalls),
);

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 6,
  },
  thinkingToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  thinkingLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
  },
  thinkingBlock: {
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 12,
    maxHeight: 200,
  },
  thinkingText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    lineHeight: 18,
  },
  errorBlock: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  errorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  errorLabel: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 0.2,
  },
  errorMeta: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  errorText: {
    fontSize: 12.5,
    lineHeight: 19,
    fontFamily: Fonts.sans,
  },
  markdownWrap: {
    gap: 4,
  },
  markdownBlock: {
    minWidth: 0,
  },
  cursorWrap: {
    paddingTop: 2,
  },
  toolCalls: {
    gap: 10,
    marginTop: 6,
  },
  toolStreaming: {
    paddingTop: 2,
  },
});
