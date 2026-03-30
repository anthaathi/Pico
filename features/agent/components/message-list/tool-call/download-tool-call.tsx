import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { parseToolArguments } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";

interface DownloadToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

export const DownloadToolCall = memo(function DownloadToolCall({
  tc,
  isDark,
}: DownloadToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const parsed = parseToolArguments(tc.arguments);
  const url = (parsed.url as string) || "";

  return (
    <View>
      <View style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Download
        </Text>
        {url ? (
          <Text style={[styles.url, { color: colors.textTertiary }]} numberOfLines={1}>
            {url}
          </Text>
        ) : null}
      </View>

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
  label: {
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
  },
  url: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    flex: 1,
  },

});
