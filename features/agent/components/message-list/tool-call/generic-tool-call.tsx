import { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { toolDisplayName } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { AnimatedCollapse } from "../animated-collapse";

interface GenericToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

export const GenericToolCall = memo(function GenericToolCall({
  tc,
  isDark,
}: GenericToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const hasResult = !!tc.result || !!tc.partialResult;
  const resultText = tc.result || tc.partialResult || "";

  return (
    <View>
      <Pressable onPress={hasResult ? toggle : undefined} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <Text style={[styles.name, { color: colors.textSecondary }]}>
          {toolDisplayName(tc.name)}
        </Text>
      </Pressable>
      <AnimatedCollapse expanded={expanded && hasResult} maxHeight={350}>
        <View style={[styles.resultBox, { backgroundColor: colors.surfaceRaised }]}>
          <Text
            style={[styles.resultText, { color: colors.textSecondary }]}
            numberOfLines={20}
            selectable
          >
            {resultText}
          </Text>
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
  name: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
  },
  resultBox: {
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    marginLeft: 12,
  },
  resultText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
  },
});
