import { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { basename, parseToolArguments } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { CodePreview } from "../code-preview";
import { AnimatedCollapse } from "../animated-collapse";

interface ReadToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

export const ReadToolCall = memo(function ReadToolCall({
  tc,
  isDark,
}: ReadToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = (parsed.path as string) || "";
  const fileName = basename(filePath);
  const offset = (parsed.offset as number) || 1;
  const content = tc.result || "";
  const hasContent = !!content;

  return (
    <View>
      <Pressable onPress={hasContent ? toggle : undefined} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <Text style={[styles.fileName, { color: colors.textSecondary }]} numberOfLines={1}>
          Read {fileName || filePath || "file"}
        </Text>
      </Pressable>
      <AnimatedCollapse expanded={expanded && hasContent} maxHeight={300}>
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
    paddingVertical: 3,
  },
  fileName: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    flex: 1,
  },
  previewWrap: {
    marginTop: 4,
    marginLeft: 12,
  },
});
