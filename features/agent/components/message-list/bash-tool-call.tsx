import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { animateLayout, sharedStyles as styles } from "./tool-call-shared";

export function BashToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const isRunning = isToolCallActive(tc);
  const isComplete = tc.status === "complete" || tc.status === "error";
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(!isComplete);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const command = parsed.command ?? "";

  const output = tc.result ?? tc.partialResult;
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const shortCmd = command.length > 60 ? command.slice(0, 60) + "…" : command;

  const toggle = useCallback(() => { animateLayout(); setExpanded((v) => !v); }, []);

  return (
    <View>
      <Pressable style={styles.row} onPress={toggle}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Shell</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {shortCmd}</Text>
          {statusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}> {statusLabel}</Text>
          ) : null}
        </Text>
        {expanded
          ? <ChevronDown size={13} color={mutedColor} strokeWidth={1.8} />
          : <ChevronRight size={13} color={mutedColor} strokeWidth={1.8} />
        }
      </Pressable>

      {expanded && (
        <View style={[bashStyles.box, {
          backgroundColor: isDark ? "#0D0D0D" : "#F6F6F6",
          borderColor: isDark ? "#2A2A2A" : "#E8E8E8",
        }]}>
          {command ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={bashStyles.commandLine} selectable numberOfLines={1}>
                <Text style={[bashStyles.prompt, { color: isDark ? "#3FB950" : "#1A7F37" }]}>$ </Text>
                <Text style={[bashStyles.command, { color: textColor }]}>{command}</Text>
              </Text>
            </ScrollView>
          ) : null}
          <ScrollView style={bashStyles.scroll} nestedScrollEnabled>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {output ? (
                <Text
                  style={[bashStyles.output, {
                    color: tc.isError
                      ? (isDark ? "#F85149" : "#CF222E")
                      : (isDark ? "#8B8B8B" : "#666666"),
                  }]}
                  selectable
                >
                  {output.length > 3000
                    ? output.slice(0, 3000) + "\n… truncated"
                    : output}
                </Text>
              ) : null}
            </ScrollView>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const bashStyles = StyleSheet.create({
  box: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    gap: 6,
  },
  scroll: {
    maxHeight: 400,
  },
  commandLine: {
    fontSize: 13,
    fontFamily: Fonts.mono,
    lineHeight: 20,
  },
  prompt: {
    fontFamily: Fonts.mono,
    fontSize: 13,
  },
  command: {
    fontFamily: Fonts.mono,
    fontSize: 13,
  },
  output: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 18,
  },
});
