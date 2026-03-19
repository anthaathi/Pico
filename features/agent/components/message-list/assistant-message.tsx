import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated as NativeAnimated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
} from "lucide-react-native";
import { useMarkdown, type useMarkdownHookOptions } from "react-native-marked";
import Animated, {
  FadeInUp,
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

const WEB_INFO_POPOVER_WIDTH = 260;
const WEB_INFO_POPOVER_MARGIN = 12;
const WEB_INFO_POPOVER_GAP = 10;

function MessageInfoSheet({
  visible,
  rows,
  isDark,
  colors,
  onClose,
}: {
  visible: boolean;
  rows: { label: string; value: string }[];
  isDark: boolean;
  colors: (typeof Colors)["light"] | (typeof Colors)["dark"];
  onClose: () => void;
}) {
  const slideAnim = useRef(new NativeAnimated.Value(300)).current;
  const overlayAnim = useRef(new NativeAnimated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    NativeAnimated.parallel([
      NativeAnimated.timing(overlayAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      NativeAnimated.spring(slideAnim, {
        toValue: 0,
        tension: 120,
        friction: 14,
        useNativeDriver: true,
      }),
    ]).start();
  }, [overlayAnim, slideAnim, visible]);

  const animateClose = (cb: () => void) => {
    NativeAnimated.parallel([
      NativeAnimated.timing(overlayAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      NativeAnimated.timing(slideAnim, {
        toValue: 300,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => cb());
  };

  const handleClose = () => {
    animateClose(onClose);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={sheetStyles.modalRoot}>
        <NativeAnimated.View style={[sheetStyles.overlay, { opacity: overlayAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </NativeAnimated.View>
        <NativeAnimated.View
          style={[
            sheetStyles.container,
            {
              backgroundColor: isDark ? "#1e1e1e" : "#FFFFFF",
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={sheetStyles.handle}>
            <View
              style={[
                sheetStyles.handleBar,
                { backgroundColor: isDark ? "#555" : "#CCC" },
              ]}
            />
          </View>
          <Text style={[sheetStyles.title, { color: colors.text }]}>
            Message Info
          </Text>
          <View style={sheetStyles.rows}>
            {rows.map((row) => (
              <View key={row.label} style={sheetStyles.row}>
                <Text
                  style={[
                    sheetStyles.label,
                    { color: colors.textTertiary },
                  ]}
                >
                  {row.label}
                </Text>
                <Text
                  style={[
                    sheetStyles.value,
                    { color: isDark ? "#D8D8D8" : colors.text },
                  ]}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </NativeAnimated.View>
      </View>
    </Modal>
  );
}

function WebMessageInfoPopover({
  visible,
  rows,
  anchor,
  isDark,
  colors,
  onClose,
}: {
  visible: boolean;
  rows: { label: string; value: string }[];
  anchor: { x: number; y: number; width: number; height: number };
  isDark: boolean;
  colors: (typeof Colors)["light"] | (typeof Colors)["dark"];
  onClose: () => void;
}) {
  const [popoverHeight, setPopoverHeight] = useState(0);
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 0;
  const estimatedHeight = popoverHeight || rows.length * 20 + 36;
  const left = Math.max(
    WEB_INFO_POPOVER_MARGIN,
    Math.min(
      anchor.x,
      viewportWidth - WEB_INFO_POPOVER_WIDTH - WEB_INFO_POPOVER_MARGIN,
    ),
  );
  const preferredTop = anchor.y - estimatedHeight - WEB_INFO_POPOVER_GAP;
  const fallbackTop = anchor.y + anchor.height + WEB_INFO_POPOVER_GAP;
  const top =
    preferredTop >= WEB_INFO_POPOVER_MARGIN
      ? preferredTop
      : Math.min(
          fallbackTop,
          viewportHeight - estimatedHeight - WEB_INFO_POPOVER_MARGIN,
        );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={webPopoverStyles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          entering={FadeInUp.duration(180)}
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height;
            if (nextHeight !== popoverHeight) {
              setPopoverHeight(nextHeight);
            }
          }}
          style={[
            webPopoverStyles.popover,
            {
              top: Math.max(WEB_INFO_POPOVER_MARGIN, top),
              left,
              backgroundColor: isDark ? "#232323" : "#FFFFFF",
              borderColor: isDark ? "#333333" : "#E2E2E2",
              boxShadow: isDark
                ? "0px 10px 24px rgba(0, 0, 0, 0.55)"
                : "0px 10px 24px rgba(0, 0, 0, 0.14)",
            } as any,
          ]}
        >
          {rows.map((row) => (
            <View key={row.label} style={styles.infoRow}>
              <Text
                style={[
                  styles.infoLabel,
                  { color: colors.textTertiary },
                ]}
              >
                {row.label}
              </Text>
              <Text
                style={[
                  styles.infoValue,
                  { color: isDark ? "#D8D8D8" : colors.text },
                ]}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

function formatCount(value: number | undefined): string | null {
  if (typeof value !== "number") return null;
  return value.toLocaleString("en-US");
}

function formatCost(value: number | undefined, currency?: string): string | null {
  if (typeof value !== "number") return null;
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 4 : 2;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return currency ? `${currency.toUpperCase()} ${formatted}` : formatted;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) return false;

  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }
}

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
  const [thinkingContentHeight, setThinkingContentHeight] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isActionHovered, setIsActionHovered] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoButtonRef = useRef<any>(null);
  const previousStreamingRef = useRef(message.isStreaming ?? false);
  const [webPopoverAnchor, setWebPopoverAnchor] = useState({
    x: WEB_INFO_POPOVER_MARGIN,
    y: WEB_INFO_POPOVER_MARGIN,
    width: 0,
    height: 0,
  });

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
  const infoRows = useMemo(() => {
    const rows: { label: string; value: string }[] = [];

    if (message.provider) rows.push({ label: "Provider", value: message.provider });
    if (message.model) rows.push({ label: "Model", value: message.model });
    if (message.api) rows.push({ label: "API", value: message.api });

    const totalTokens = formatCount(message.usage?.totalTokens);
    if (totalTokens) rows.push({ label: "Tokens", value: totalTokens });

    const inputTokens = formatCount(message.usage?.input);
    if (inputTokens) rows.push({ label: "Input", value: inputTokens });

    const outputTokens = formatCount(message.usage?.output);
    if (outputTokens) rows.push({ label: "Output", value: outputTokens });

    const cacheReadTokens = formatCount(message.usage?.cacheRead);
    if (cacheReadTokens) rows.push({ label: "Cache read", value: cacheReadTokens });

    const cacheWriteTokens = formatCount(message.usage?.cacheWrite);
    if (cacheWriteTokens) rows.push({ label: "Cache write", value: cacheWriteTokens });

    const totalCost = formatCost(message.usage?.totalCost, message.usage?.currency);
    if (totalCost) rows.push({ label: "Cost", value: totalCost });

    const inputCost = formatCost(message.usage?.inputCost, message.usage?.currency);
    if (inputCost) rows.push({ label: "Input cost", value: inputCost });

    const outputCost = formatCost(message.usage?.outputCost, message.usage?.currency);
    if (outputCost) rows.push({ label: "Output cost", value: outputCost });

    const cacheReadCost = formatCost(
      message.usage?.cacheReadCost,
      message.usage?.currency,
    );
    if (cacheReadCost) rows.push({ label: "Read cost", value: cacheReadCost });

    const cacheWriteCost = formatCost(
      message.usage?.cacheWriteCost,
      message.usage?.currency,
    );
    if (cacheWriteCost) rows.push({ label: "Write cost", value: cacheWriteCost });

    if (message.responseId) rows.push({ label: "Response", value: message.responseId });

    return rows;
  }, [message]);
  const canCopy = message.text.trim().length > 0;
  const showActions =
    Platform.OS !== "web" || isHovered || isActionHovered || infoOpen || copied;
  const actionVisibilityStyle = Platform.OS === "web"
    ? ({
        visibility: showActions ? "visible" : "hidden",
        opacity: showActions ? 1 : 0,
        transition: "opacity 0.15s ease",
      } as any)
    : null;
  const isMobileInfoSheet = Platform.OS !== "web";
  const thinkingReveal = useSharedValue(0);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
      if (hoverOutRef.current) {
        clearTimeout(hoverOutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const wasStreaming = previousStreamingRef.current;
    const isStreaming = !!message.isStreaming;

    if (hasThinking && isStreaming) {
      setThinkingExpanded(true);
    } else if (wasStreaming && !isStreaming) {
      setThinkingExpanded(false);
    }

    previousStreamingRef.current = isStreaming;
  }, [hasThinking, message.id, message.isStreaming]);

  useEffect(() => {
    thinkingReveal.value = withTiming(thinkingExpanded ? 1 : 0, {
      duration: thinkingExpanded ? 220 : 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [thinkingExpanded, thinkingReveal]);

  const thinkingCollapseStyle = useAnimatedStyle(() => {
    const measuredHeight = thinkingContentHeight || 1;
    return {
      height: measuredHeight * thinkingReveal.value,
      opacity: thinkingReveal.value,
      transform: [{ translateY: (1 - thinkingReveal.value) * -6 }],
      overflow: "hidden",
    };
  }, [thinkingContentHeight]);

  const handleHoverIn = () => {
    if (hoverOutRef.current) {
      clearTimeout(hoverOutRef.current);
      hoverOutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleHoverOut = () => {
    if (Platform.OS !== "web" || infoOpen || copied) return;
    if (hoverOutRef.current) {
      clearTimeout(hoverOutRef.current);
    }
    hoverOutRef.current = setTimeout(() => {
      setIsHovered(false);
      hoverOutRef.current = null;
    }, 250);
  };

  const handleActionHoverIn = () => {
    setIsActionHovered(true);
    handleHoverIn();
  };

  const handleActionHoverOut = () => {
    setIsActionHovered(false);
    handleHoverOut();
  };

  const measureWebInfoPopover = useCallback(() => {
    if (Platform.OS !== "web") return;

    const anchor = infoButtonRef.current as
      | {
          measureInWindow?: (
            cb: (x: number, y: number, width: number, height: number) => void,
          ) => void;
          getBoundingClientRect?: () => DOMRect;
        }
      | null;
    const updateAnchor = (
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      setWebPopoverAnchor({ x, y, width, height });
    };

    if (anchor?.measureInWindow) {
      anchor.measureInWindow((x, y, width, height) => {
        updateAnchor(x, y, width, height);
      });
      return;
    }

    if (anchor?.getBoundingClientRect) {
      const rect = anchor.getBoundingClientRect();
      updateAnchor(rect.left, rect.top, rect.width, rect.height);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !infoOpen) return;

    measureWebInfoPopover();
    const handleViewportChange = () => measureWebInfoPopover();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [infoOpen, measureWebInfoPopover]);

  const handleCopy = async () => {
    if (!canCopy) return;
    const didCopy = await copyToClipboard(message.text);
    if (!didCopy) return;
    setCopied(true);
    if (copyResetRef.current) {
      clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = setTimeout(() => {
      setCopied(false);
      copyResetRef.current = null;
    }, 1500);
  };

  const handleInfoPress = () => {
    if (isMobileInfoSheet) {
      setInfoOpen(true);
      return;
    }

    if (infoOpen) {
      setInfoOpen(false);
      return;
    }

    measureWebInfoPopover();
    setInfoOpen(true);
  };
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
    <Pressable
      accessible={false}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={[styles.container, Platform.OS === "web" && styles.webCursorDefault]}
    >
      <View style={[styles.body, Platform.OS === "web" && styles.webCursorDefault]}>
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

        {hasThinking && (
          <Animated.View
            style={[styles.thinkingCollapse, thinkingCollapseStyle]}
          >
            <View
              style={[
                styles.thinkingBlock,
                {
                  backgroundColor: isDark ? "#1A1A1A" : "#F5F5F5",
                  borderColor: isDark ? "#2A2A2A" : "#E8E8E8",
                },
              ]}
              onLayout={(event) => {
                const nextHeight = event.nativeEvent.layout.height;
                if (nextHeight !== thinkingContentHeight) {
                  setThinkingContentHeight(nextHeight);
                }
              }}
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
          </Animated.View>
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

        <Pressable
          accessible={false}
          onHoverIn={handleActionHoverIn}
          onHoverOut={handleActionHoverOut}
          style={[styles.messageMeta, actionVisibilityStyle]}
        >
          <View style={styles.actionRail}>
            <Pressable
              ref={infoButtonRef}
              accessibilityRole="button"
              accessibilityLabel="Show message info"
              onPress={handleInfoPress}
              onHoverIn={handleActionHoverIn}
              onHoverOut={handleActionHoverOut}
              style={({ pressed, hovered: buttonHovered }: any) => [
                styles.actionButton,
                {
                  backgroundColor: isDark ? "#171717" : "#FFFFFF",
                  borderColor: isDark ? "#2E2E2E" : "#E2E2E2",
                },
                (pressed || buttonHovered || infoOpen) && {
                  backgroundColor: isDark ? "#202020" : "#F6F6F6",
                },
              ]}
            >
              <Info size={13} color={colors.textTertiary} strokeWidth={1.9} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? "Copied message" : "Copy message"}
              disabled={!canCopy}
              onPress={handleCopy}
              onHoverIn={handleActionHoverIn}
              onHoverOut={handleActionHoverOut}
              style={({ pressed, hovered: buttonHovered }: any) => [
                styles.actionButton,
                {
                  backgroundColor: isDark ? "#171717" : "#FFFFFF",
                  borderColor: isDark ? "#2E2E2E" : "#E2E2E2",
                  opacity: canCopy ? 1 : 0.45,
                },
                canCopy && (pressed || buttonHovered || copied) && {
                  backgroundColor: isDark ? "#202020" : "#F6F6F6",
                },
              ]}
            >
              {copied ? (
                <Check size={13} color={colors.textTertiary} strokeWidth={2.1} />
              ) : (
                <Copy size={13} color={colors.textTertiary} strokeWidth={1.9} />
              )}
            </Pressable>
          </View>
        </Pressable>
      </View>
      {Platform.OS === "web" && infoRows.length > 0 ? (
        <WebMessageInfoPopover
          visible={infoOpen}
          rows={infoRows}
          anchor={webPopoverAnchor}
          isDark={isDark}
          colors={colors}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
      {isMobileInfoSheet && infoRows.length > 0 ? (
        <MessageInfoSheet
          visible={infoOpen}
          rows={infoRows}
          isDark={isDark}
          colors={colors}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </Pressable>
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
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 16,
    position: "relative",
    overflow: "visible",
  },
  body: {
    gap: 6,
    position: "relative",
  },
  webCursorDefault: {
    cursor: "default",
  } as any,
  messageMeta: {
    gap: 8,
    minHeight: 24,
    position: "relative",
    overflow: "visible",
  },
  actionRail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 0.633,
    alignItems: "center",
    justifyContent: "center",
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
  thinkingCollapse: {
    overflow: "hidden",
  },
  thinkingBlock: {
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 12,
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
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0,
  },
  infoLabel: {
    width: 72,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.sansMedium,
    flexShrink: 0,
  },
  infoValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.sans,
    textAlign: "right",
    flexWrap: "wrap",
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

const sheetStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  container: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 34,
    maxHeight: "70%",
  },
  handle: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  title: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  rows: {
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minWidth: 0,
  },
  label: {
    width: 78,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sansMedium,
    flexShrink: 0,
  },
  value: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sans,
    textAlign: "right",
    flexWrap: "wrap",
  },
});

const webPopoverStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  popover: {
    position: "absolute",
    width: WEB_INFO_POPOVER_WIDTH,
    borderRadius: 12,
    borderWidth: 0.633,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    zIndex: 1000,
  },
});
