import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Copy, Info } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Portal } from "@/components/ui/portal";
import { useStableMarkdown } from "../../hooks/use-stable-markdown";
import { markedDarkOptions, markedLightOptions } from "../../theme";
import type { ChatMessage } from "../../types";
import { ThinkingBlock } from "./thinking-block";
import { StreamingCursor } from "./streaming-cursor";
import { ToolCallGroup } from "./tool-call";

interface AssistantMessageProps {
  message: ChatMessage;
  isDark: boolean;
  toolCallsOverride?: ChatMessage["toolCalls"];
  sessionStreaming?: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  isDark,
  toolCallsOverride,
  sessionStreaming = false,
}: AssistantMessageProps) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const markdownOptions = colorScheme === "dark" ? markedDarkOptions : markedLightOptions;
  const elements = useStableMarkdown(
    message.text || "",
    markdownOptions,
    message.isStreaming,
  );

  const toolCalls = toolCallsOverride ?? message.toolCalls;
  const hasThinking = !!message.thinking;
  const hasText = !!message.text;
  const hasToolCalls = !!(toolCalls && toolCalls.length > 0);
  const hasError = !!message.errorMessage;
  const isStreaming = !!message.isStreaming;
  const isThinkingOnly = hasThinking && !hasText && !hasToolCalls && isStreaming;
  const isMidTurn = message.stopReason === "toolUse";
  const turnCompleted = !sessionStreaming;
  const isFinalResponse = message.stopReason === "stop";
  const showToolbar = !isStreaming && isFinalResponse && (!!message.text || !!message.errorMessage);

  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === "web";

  return (
    <View
      style={styles.container}
      {...(isWeb
        ? {
            onPointerEnter: () => setHovered(true),
            onPointerLeave: () => setHovered(false),
          }
        : {})}
    >
      {hasThinking && (
        <ThinkingBlock
          text={message.thinking!}
          isStreaming={isThinkingOnly}
          isDark={isDark}
        />
      )}

      {hasText && <View style={styles.textBlock}>{elements}</View>}

      {hasToolCalls && (
        <ToolCallGroup toolCalls={toolCalls!} isDark={isDark} turnCompleted={turnCompleted} />
      )}

      {hasError && (
        <View
          style={[
            styles.errorBlock,
            { backgroundColor: isDark ? "rgba(255,69,58,0.08)" : "rgba(255,59,48,0.05)" },
          ]}
        >
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {message.errorMessage}
          </Text>
        </View>
      )}

      {isStreaming && !isThinkingOnly && (
        <StreamingCursor color={colors.textTertiary} />
      )}

      {showToolbar && (
        <MessageToolbar message={message} isDark={isDark} hovered={hovered} />
      )}
    </View>
  );
});

const FADE = { duration: 150, easing: Easing.out(Easing.cubic) };

const MessageToolbar = memo(function MessageToolbar({
  message,
  isDark,
  hovered,
}: {
  message: ChatMessage;
  isDark: boolean;
  hovered: boolean;
}) {
  const colors = isDark ? Colors.dark : Colors.light;
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  const isWeb = Platform.OS === "web";
  const wrapRef = useRef<View | null>(null);
  const infoBtnRef = useRef<View | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(hovered ? 1 : 0, FADE);
  }, [hovered, opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const handleCopy = useCallback(async () => {
    if (!message.text) return;
    await Clipboard.setStringAsync(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.text]);

  const openInfo = useCallback(() => {
    if (isWeb) {
      const node = infoBtnRef.current as unknown as { measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void } | null;
      node?.measureInWindow?.((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setShowInfo((v) => !v);
      });
      if (!node?.measureInWindow) setShowInfo((v) => !v);
      return;
    }
    setShowInfo((v) => !v);
  }, [isWeb]);
  const closeInfo = useCallback(() => setShowInfo(false), []);

  useEffect(() => {
    if (!isWeb || !showInfo) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = wrapRef.current as unknown as { contains?: (target: Node | null) => boolean } | null;
      if (node?.contains?.(event.target as Node | null)) return;
      setShowInfo(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isWeb, showInfo]);

  const infoLines = useMemo(() => {
    const lines: { label: string; value: string }[] = [];
    if (message.model) lines.push({ label: "Model", value: message.model });
    if (message.provider) lines.push({ label: "Provider", value: message.provider });
    const cost = message.usage?.totalCost;
    if (cost != null && cost > 0) lines.push({ label: "Cost", value: `$${cost.toFixed(4)}` });
    const tokens = message.usage?.totalTokens;
    if (tokens != null && tokens > 0) lines.push({ label: "Tokens", value: tokens.toLocaleString() });
    const input = message.usage?.input;
    if (input != null) lines.push({ label: "Input", value: input.toLocaleString() });
    const output = message.usage?.output;
    if (output != null) lines.push({ label: "Output", value: output.toLocaleString() });
    const cacheRead = message.usage?.cacheRead;
    if (cacheRead != null && cacheRead > 0) lines.push({ label: "Cache read", value: cacheRead.toLocaleString() });
    return lines;
  }, [message.model, message.provider, message.usage]);

  return (
    <>
      <View ref={wrapRef} style={styles.toolbarWrap}>
        <Animated.View style={[styles.toolbar, animStyle]}>
          <View style={styles.toolbarBtns}>
            <Pressable
              onPress={handleCopy}
              style={[styles.toolbarBtn, copied && { backgroundColor: colors.surfaceRaised }]}
              hitSlop={4}
            >
              {copied ? (
                <Text style={[styles.copiedText, { color: colors.textTertiary }]}>✓</Text>
              ) : (
                <Copy size={13} color={colors.textTertiary} strokeWidth={1.8} />
              )}
            </Pressable>
            <Pressable
              ref={infoBtnRef}
              onPress={openInfo}
              style={[styles.toolbarBtn, showInfo && { backgroundColor: colors.surfaceRaised }]}
              hitSlop={4}
            >
              <Info size={13} color={colors.textTertiary} strokeWidth={1.8} />
            </Pressable>
          </View>
        </Animated.View>

        {isWeb && showInfo && anchor ? (
          <Portal>
            <Pressable style={styles.webBackdrop} onPress={closeInfo}>
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={[
                  styles.inlinePopover,
                  {
                    backgroundColor: colors.sheetBackground,
                    borderColor: colors.border,
                    left: Math.max(12, anchor.x - 8),
                    top: anchor.y + anchor.height + 8,
                    zIndex: 1000,
                  },
                ]}
              >
                {infoLines.map((l, i) => (
                  <View key={i} style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.textTertiary }]}>{l.label}</Text>
                    <Text style={[styles.infoValue, { color: colors.text }]} selectable>{l.value}</Text>
                  </View>
                ))}
              </Pressable>
            </Pressable>
          </Portal>
        ) : null}
      </View>

      {!isWeb ? (
        <BottomSheet visible={showInfo} onClose={closeInfo} title="Message Info">
          {infoLines.map((l, i) => (
            <View
              key={i}
              style={[
                styles.sheetRow,
                i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.sheetLabel, { color: colors.textTertiary }]}>{l.label}</Text>
              <Text style={[styles.sheetValue, { color: colors.text }]} selectable>{l.value}</Text>
            </View>
          ))}
        </BottomSheet>
      ) : null}
    </>
  );
});


const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 12,
  },
  textBlock: {},
  errorBlock: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },
  toolbar: {},
  toolbarBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  toolbarBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  copiedText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  toolbarWrap: {
    position: "relative",
    zIndex: 20,
  },
  webBackdrop: {
    position: "fixed" as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  inlinePopover: {
    position: "absolute",
    left: 0,
    top: 30,
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 10,
    minWidth: 240,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    gap: 6,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  infoValue: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    textAlign: "right",
  },
  sheetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    gap: 12,
  },
  sheetLabel: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  sheetValue: {
    fontSize: 14,
    fontFamily: Fonts.mono,
    textAlign: "right",
  },
});
