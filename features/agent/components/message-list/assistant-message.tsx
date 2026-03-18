import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated as RNAnimated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronDown, ChevronRight, Brain } from "lucide-react-native";
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

export function AssistantMessage({
  message,
  toolCalls: overrideToolCalls,
  animateOnMount = true,
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

  const markdownOptions = useMemo<useMarkdownHookOptions>(
    () => (isDark ? markedDarkOptions : markedLightOptions),
    [isDark],
  );
  const markdownElements = useMarkdown(message.text, markdownOptions);

  const shouldAnimate = animateOnMount && !message.isStreaming;

  const fadeOpacity = useRef(
    new RNAnimated.Value(shouldAnimate ? 0 : 1),
  ).current;
  const fadeTranslateY = useRef(
    new RNAnimated.Value(shouldAnimate ? 6 : 0),
  ).current;

  useEffect(() => {
    if (!shouldAnimate) {
      fadeOpacity.setValue(1);
      fadeTranslateY.setValue(0);
      return;
    }

    const animation = RNAnimated.parallel([
      RNAnimated.timing(fadeOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      RNAnimated.timing(fadeTranslateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [shouldAnimate, fadeOpacity, fadeTranslateY]);

  return (
    <RNAnimated.View
      style={[
        styles.container,
        { opacity: fadeOpacity, transform: [{ translateY: fadeTranslateY }] },
      ]}
    >
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
            <Fragment key={i}>{el}</Fragment>
          ))}
          {message.isStreaming && !hasToolCalls && <StreamingCursor />}
        </View>
      )}

      {message.isStreaming && message.text.length === 0 && !hasToolCalls && (
        <StreamingCursor />
      )}

      {hasToolCalls && (
        <View style={styles.toolCalls}>
          {groupToolCalls(effectiveToolCalls!).map((item) => (
            <ToolCallGroup
              key={item.key}
              toolName={item.toolName}
              calls={item.calls}
            />
          ))}
        </View>
      )}
    </RNAnimated.View>
  );
}

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
  markdownWrap: {
    gap: 4,
  },
  toolCalls: {
    gap: 10,
    marginTop: 6,
  },
});
