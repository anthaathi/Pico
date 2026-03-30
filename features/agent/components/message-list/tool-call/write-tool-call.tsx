import { memo, useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { basename, isToolActive, parseToolArguments, countLines } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { CodePreview } from "../code-preview";
import { AnimatedCollapse } from "../animated-collapse";

interface WriteToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

export const WriteToolCall = memo(function WriteToolCall({
  tc,
  isDark,
}: WriteToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const active = isToolActive(tc);
  const [expanded, setExpanded] = useState(() => isToolActive(tc));

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = (parsed.path as string) || "";
  const fileName = basename(filePath);
  const content = (parsed.content as string) || "";
  const addedLines = countLines(content);
  const hasContent = !!content;
  const title = active ? "Writing" : "Wrote";

  return (
    <View>
      <Pressable onPress={toggle} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <View style={styles.titleRow}>
          <Text style={[styles.fileName, { color: colors.textSecondary }]} numberOfLines={1}>
            {title} {fileName || filePath || "file"}
          </Text>
          {addedLines > 0 && (
            <View style={styles.metaRow}>
              <Text style={[styles.metaAdd, { color: isDark ? "#3FB950" : "#1A7F37" }]}>+{addedLines}</Text>
            </View>
          )}
        </View>
      </Pressable>
      <AnimatedCollapse expanded={expanded && hasContent} maxHeight={300}>
        <View style={styles.previewWrap}>
          <CodePreview code={content} isDark={isDark} maxHeight={250} />
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
  },
  metaAdd: {
    fontSize: 10,
    fontFamily: Fonts.mono,
  },
  metaRemove: {
    fontSize: 10,
    fontFamily: Fonts.mono,
  },
  previewWrap: {
    marginTop: 4,
    marginLeft: 12,
  },

});
