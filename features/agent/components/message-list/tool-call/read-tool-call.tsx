import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { basename, isToolActive, parseToolArguments } from "../utils";
import { CodePreview } from "../code-preview";
import { AnimatedCollapse } from "../animated-collapse";
import { ToolResultImages } from "./tool-result-images";

interface ReadToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
  turnCompleted?: boolean;
}

export const ReadToolCall = memo(function ReadToolCall({
  tc,
  isDark,
  turnCompleted = false,
}: ReadToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const active = isToolActive(tc);
  const [expanded, setExpanded] = useState(() => active);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  const prevTurnCompleted = useRef(turnCompleted);
  useEffect(() => {
    const justCompleted = turnCompleted && !prevTurnCompleted.current;
    prevTurnCompleted.current = turnCompleted;
    if (justCompleted && !active) {
      const timer = setTimeout(() => setExpanded(false), 400);
      return () => clearTimeout(timer);
    }
  }, [turnCompleted, active]);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = (parsed.path as string) || "";
  const fileName = basename(filePath);
  const offset = (parsed.offset as number) || 1;
  const content = tc.result || "";
  const hasImages = !!(tc.resultImages && tc.resultImages.length > 0);
  const hasContent = !!content || hasImages;

  return (
    <View>
      <Pressable onPress={hasContent ? toggle : undefined} style={styles.header}>
        <Text style={[styles.fileName, { color: colors.textSecondary }]} numberOfLines={1}>
          Read {fileName || filePath || "file"}
        </Text>
      </Pressable>
      {hasImages && <ToolResultImages images={tc.resultImages!} isDark={isDark} />}
      <AnimatedCollapse expanded={expanded && !!content} maxHeight={300}>
        <View style={styles.previewWrap}>
          <CodePreview code={content} isDark={isDark} startLine={offset} maxHeight={250} />
        </View>
      </AnimatedCollapse>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  fileName: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    flex: 1,
  },
  previewWrap: {
    marginTop: 8,
    marginLeft: 12,
  },
});
