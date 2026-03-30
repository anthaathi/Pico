import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Maximize2, X } from "lucide-react-native";
import { Colors, Fonts } from "@/constants/theme";
import { CodePreview } from "../code-preview";
import type { ToolCallInfo } from "../../../types";
import { basename, isToolActive, parseToolArguments } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { AnimatedCollapse } from "../animated-collapse";

interface EditToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

export const EditToolCall = memo(function EditToolCall({
  tc,
  isDark,
}: EditToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const { width, height } = useWindowDimensions();
  const active = isToolActive(tc);
  const hasCompleted = tc.status === "complete";
  const [expanded, setExpanded] = useState(() => active || hasCompleted);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [heroRect, setHeroRect] = useState({ x: 16, y: 120, width: Math.max(240, width - 32), height: 220 });
  const previewRef = useRef<View | null>(null);
  const heroProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active || hasCompleted) setExpanded(true);
  }, [active, hasCompleted]);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const openFullscreen = useCallback(() => {
    const fallbackRect = { x: 16, y: 120, width: Math.max(240, width - 32), height: Math.min(260, height - 160) };
    const openFromRect = (nextRect: typeof fallbackRect) => {
      setHeroRect(nextRect);
      heroProgress.setValue(0);
      setFullscreenOpen(true);
      requestAnimationFrame(() => {
        Animated.timing(heroProgress, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      });
    };

    if (!previewRef.current) {
      openFromRect(fallbackRect);
      return;
    }

    previewRef.current.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      if (!measuredWidth || !measuredHeight) {
        openFromRect(fallbackRect);
        return;
      }
      openFromRect({ x, y, width: measuredWidth, height: measuredHeight });
    });
  }, [height, heroProgress, width]);

  const closeFullscreen = useCallback(() => {
    Animated.timing(heroProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setFullscreenOpen(false);
    });
  }, [heroProgress]);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = (parsed.path as string) || "";
  const fileName = basename(filePath);
  const detectedLanguage = (() => {
    const lower = (fileName || filePath).toLowerCase();
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".ts")) return "ts";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".js")) return "js";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
    if (lower.endsWith(".py")) return "py";
    if (lower.endsWith(".sh")) return "bash";
    if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xml") || lower.endsWith(".svg")) return "html";
    return undefined;
  })();
  const rawDiff = tc.diff?.trim() || "";
  const rawEdits = Array.isArray(parsed.edits) ? parsed.edits : [];
  const editBlocks = rawEdits.length > 0
    ? rawEdits.map((item) => {
        const value = item as { oldText?: unknown; newText?: unknown };
        return {
          oldText: typeof value.oldText === "string" ? value.oldText : "",
          newText: typeof value.newText === "string" ? value.newText : "",
        };
      })
    : [{
        oldText: (parsed.oldText as string) || "",
        newText: (parsed.newText as string) || "",
      }];
  const fallbackDiff = editBlocks.flatMap((block) => {
    const lines: string[] = [];
    if (block.oldText) lines.push(...block.oldText.split("\n").map((line) => `-${line}`));
    if (block.newText) lines.push(...block.newText.split("\n").map((line) => `+${line}`));
    return lines;
  }).join("\n");
  const diffText = rawDiff || fallbackDiff;
  const hasDiff = !!diffText;
  const diffLines = diffText ? diffText.split("\n") : [];
  const removedLines = diffLines.filter((line) => /^-(?!-)/.test(line)).length;
  const addedLines = diffLines.filter((line) => /^\+(?!\+)/.test(line)).length;
  const title = active ? "Editing" : "Edited";

  return (
    <View>
      <Pressable onPress={toggle} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <View style={styles.titleRow}>
          <Text style={[styles.fileName, { color: colors.textSecondary }]} numberOfLines={1}>
            {title} {fileName || filePath || "file"}
          </Text>
          {(addedLines > 0 || removedLines > 0) && (
            <View style={styles.metaRow}>
              <Text style={[styles.metaAdd, { color: isDark ? "#3FB950" : "#1A7F37" }]}>+{addedLines}</Text>
              <Text style={[styles.metaRemove, { color: isDark ? "#F85149" : "#CF222E" }]}>-{removedLines}</Text>
            </View>
          )}
        </View>
      </Pressable>
      <AnimatedCollapse expanded={expanded && hasDiff} maxHeight={300}>
        <View ref={previewRef} style={styles.diffWrap}>
          <Pressable
            onPress={openFullscreen}
            style={[styles.fullscreenButton, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
          >
            <Maximize2 size={12} color={colors.textSecondary} strokeWidth={2} />
            <Text style={[styles.fullscreenButtonText, { color: colors.textSecondary }]}>Fullscreen</Text>
          </Pressable>
          <CodePreview code={diffText} isDark={isDark} maxHeight={250} language="diff" showLineNumbers={false} />
        </View>
      </AnimatedCollapse>
      <Modal
        visible={fullscreenOpen}
        transparent
        animationType="none"
        onRequestClose={closeFullscreen}
      >
        <View style={styles.heroRoot}>
          <Animated.View style={[styles.heroBackdrop, { opacity: heroProgress }]} />
          <Pressable style={styles.heroBackdropPressable} onPress={closeFullscreen} />
          <Animated.View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                left: heroProgress.interpolate({ inputRange: [0, 1], outputRange: [heroRect.x, 0] }),
                top: heroProgress.interpolate({ inputRange: [0, 1], outputRange: [heroRect.y, 0] }),
                width: heroProgress.interpolate({ inputRange: [0, 1], outputRange: [heroRect.width, width] }),
                height: heroProgress.interpolate({ inputRange: [0, 1], outputRange: [heroRect.height, height] }),
                borderRadius: heroProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
              },
            ]}
          >
            <Animated.View
              style={{
                flex: 1,
                opacity: heroProgress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] }),
              }}
            >
              <View style={[styles.fullscreenHeader, { borderBottomColor: colors.border, backgroundColor: colors.background }]}> 
                <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                  {fileName || filePath || "Diff"}
                </Text>
                <Pressable onPress={closeFullscreen} style={styles.modalCloseButton}>
                  <X size={16} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
              </View>
              <View style={styles.fullscreenBody}>
                <CodePreview
                  code={diffText}
                  isDark={isDark}
                  maxHeight={Math.max(320, height - 88)}
                  language="diff"
                  diffLanguage={detectedLanguage}
                  showLineNumbers={false}
                />
              </View>
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  metaAdd: {
    fontSize: 10,
    fontFamily: Fonts.mono,
  },
  metaRemove: {
    fontSize: 10,
    fontFamily: Fonts.mono,
  },
  fullscreenButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 0.5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fullscreenButtonText: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
  },
  diffWrap: {
    marginTop: 4,
    marginLeft: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  heroRoot: {
    flex: 1,
  },
  heroBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  heroBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  heroCard: {
    position: "absolute",
    borderWidth: 0.5,
    overflow: "hidden",
  },
  fullscreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  modalTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sansSemiBold,
    marginRight: 12,
  },
  modalCloseButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenBody: {
    flex: 1,
    padding: 12,
  },

});
