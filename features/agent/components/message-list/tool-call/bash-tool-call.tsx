import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { isToolActive, parseToolArguments, truncateOutput } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { AnimatedCollapse } from "../animated-collapse";

interface BashToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

const OUTPUT_MAX_HEIGHT = 220;

export const BashToolCall = memo(function BashToolCall({
  tc,
  isDark,
}: BashToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const active = isToolActive(tc);
  const [expanded, setExpanded] = useState(() => isToolActive(tc));
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  useEffect(() => {
    if (active && scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [active, tc.partialResult, tc.result]);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const parsed = parseToolArguments(tc.arguments);
  const rawCommand = (parsed.command as string) || "";
  const cdMatch = rawCommand.match(/^cd\s+(.+?)\s*&&\s*(.+)/);
  const command = cdMatch ? cdMatch[2]!.trim() : rawCommand;
  const cdPath = cdMatch ? cdMatch[1]!.trim() : undefined;
  const output = tc.result || tc.partialResult || "";
  const { text: displayOutput, truncated } = truncateOutput(output);
  const hasOutput = !!displayOutput;

  return (
    <View>
      <Pressable onPress={toggle} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <Text style={[styles.ranLabel, { color: colors.textSecondary }]} numberOfLines={1}>Ran <Text style={[styles.command, { color: colors.text }]}>{command || "bash"}</Text>{cdPath ? <Text> in <Text style={[styles.command, { color: colors.text }]}>{cdPath}</Text></Text> : null}</Text>
      </Pressable>
      <AnimatedCollapse expanded={expanded} maxHeight={280}>
        <View style={[styles.terminal, { backgroundColor: isDark ? "#0D0D0D" : "#F5F5F5" }]}>
          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: OUTPUT_MAX_HEIGHT }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <View style={styles.promptLine}>
              <Text style={[styles.promptChar, { color: isDark ? "#999" : "#888" }]}>{'>'}</Text>
              <Text style={[styles.cmdText, { color: isDark ? "#E0E0E0" : "#1A1A1A" }]} selectable>{command}</Text>
            </View>
            {hasOutput && (
              <>
                <Text style={[styles.outputText, { color: isDark ? "#CCC" : "#333" }]} selectable>{displayOutput}</Text>
                {truncated && (
                  <Text style={[styles.truncatedText, { color: isDark ? "#666" : "#999" }]}>… output truncated</Text>
                )}
              </>
            )}
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
  ranLabel: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  command: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  terminal: {
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    marginLeft: 12,
  },
  promptLine: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 4,
  },
  promptChar: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: "700",
  },
  cmdText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  outputText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
  },
  truncatedText: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontStyle: "italic",
    marginTop: 4,
  },
});
