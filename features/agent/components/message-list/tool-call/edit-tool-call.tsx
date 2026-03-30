import { memo, useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { basename, countLines, isToolActive, parseToolArguments } from "../utils";
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
  const active = isToolActive(tc);
  const [expanded, setExpanded] = useState(() => isToolActive(tc));

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const parsed = parseToolArguments(tc.arguments);
  const filePath = (parsed.path as string) || "";
  const fileName = basename(filePath);
  const oldText = (parsed.oldText as string) || "";
  const newText = (parsed.newText as string) || "";
  const hasDiff = !!oldText || !!newText;
  const removedLines = countLines(oldText);
  const addedLines = countLines(newText);
  const title = active ? "Editing" : "Edited";

  const removeBg = isDark ? "rgba(248,81,73,0.08)" : "rgba(207,34,46,0.06)";
  const addBg = isDark ? "rgba(63,185,80,0.08)" : "rgba(26,127,55,0.06)";
  const removeColor = isDark ? "#F85149" : "#CF222E";
  const addColor = isDark ? "#3FB950" : "#1A7F37";

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
        <View style={styles.diffWrap}>
          <ScrollView
            style={styles.diffScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {oldText ? (
              <View style={[styles.diffBlock, { backgroundColor: removeBg }]}>
                <Text style={[styles.diffPrefix, { color: removeColor }]}>−</Text>
                <Text style={[styles.diffText, { color: removeColor }]} selectable>{oldText}</Text>
              </View>
            ) : null}
            {newText ? (
              <View style={[styles.diffBlock, { backgroundColor: addBg }]}>
                <Text style={[styles.diffPrefix, { color: addColor }]}>+</Text>
                <Text style={[styles.diffText, { color: addColor }]} selectable>{newText}</Text>
              </View>
            ) : null}
          </ScrollView>
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
  diffWrap: {
    marginTop: 4,
    marginLeft: 12,
    borderRadius: 6,
    overflow: "hidden",
  },
  diffScroll: {
    maxHeight: 250,
  },
  diffBlock: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  diffPrefix: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    width: 14,
    fontWeight: "700",
  },
  diffText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
    flex: 1,
  },

});
