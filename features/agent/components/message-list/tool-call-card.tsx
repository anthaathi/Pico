import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ToolCallInfo } from "../../types";
import {
  getToolStatusLabel,
  parseToolArguments,
} from "./tool-call-utils";

function formatToolLabel(name: string, args: string): string {
  const parsed = parseToolArguments(args);
  switch (name) {
    case "bash":
      return parsed.command
        ? `$ ${parsed.command.slice(0, 80)}`
        : "bash";
    case "read":
      return parsed.path ?? "read";
    case "edit":
      return parsed.path ?? "edit";
    case "write":
      return parsed.path ?? "write";
    default:
      return name;
  }
}

function ToolCallCardComponent({ toolCall }: { toolCall: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [expanded, setExpanded] = useState(false);

  const label = formatToolLabel(toolCall.name, toolCall.arguments);
  const output = toolCall.result ?? toolCall.partialResult;
  const isRunning =
    toolCall.status === "running" ||
    toolCall.status === "streaming" ||
    toolCall.status === "pending";
  const statusLabel = getToolStatusLabel(toolCall);
  const mutedColor = isDark ? "#666" : "#999";

  return (
    <View>
      <Pressable
        style={styles.row}
        onPress={() => output && setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown size={12} color={mutedColor} strokeWidth={1.8} />
        ) : (
          <ChevronRight size={12} color={mutedColor} strokeWidth={1.8} />
        )}
        <Text
          style={[styles.label, { color: mutedColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {statusLabel ? (
          <Text
            style={[styles.status, { color: mutedColor }]}
            numberOfLines={1}
          >
            {statusLabel}
          </Text>
        ) : isRunning ? (
          <Text
            style={[styles.status, { color: mutedColor }]}
            numberOfLines={1}
          >
            Running...
          </Text>
        ) : null}
      </Pressable>

      {expanded && output && (
        <View style={styles.output}>
          <Text
            style={[
              styles.outputText,
              {
                color: toolCall.isError
                  ? colors.destructive
                  : isDark
                    ? "#555"
                    : "#888",
              },
            ]}
            selectable
          >
            {output.length > 2000
              ? output.slice(0, 2000) + "\n… truncated"
              : output}
          </Text>
        </View>
      )}
    </View>
  );
}

export const ToolCallCard = memo(
  ToolCallCardComponent,
  (prev, next) => prev.toolCall === next.toolCall,
);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  label: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flexShrink: 1,
  },
  status: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    flexShrink: 0,
  },
  output: {
    paddingLeft: 16,
    paddingTop: 4,
    paddingBottom: 2,
    maxHeight: 300,
  },
  outputText: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    lineHeight: 16,
  },
});
