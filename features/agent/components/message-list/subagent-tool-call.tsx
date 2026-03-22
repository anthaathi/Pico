import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { animateLayout, sharedStyles as styles } from "./tool-call-shared";

function ShimmerLine({ width, isDark, delay = 0 }: { width: number | string; isDark: boolean; delay?: number }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [shimmer, delay]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.8],
  });

  return (
    <Animated.View
      style={[
        subagentStyles.shimmerLine,
        {
          width: width as any,
          backgroundColor: isDark ? "#222" : "#E0E0E0",
          opacity,
        },
      ]}
    />
  );
}

function parseSubagentSteps(output: string): { tool: string; detail: string }[] {
  const steps: { tool: string; detail: string }[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const readMatch = trimmed.match(/^(?:Read|Wrote|Edit(?:ed)?)\s+(.+)/);
    if (readMatch) {
      const verb = trimmed.split(/\s/)[0]!;
      steps.push({ tool: verb, detail: readMatch[1]! });
      continue;
    }
    const bashMatch = trimmed.match(/^\$\s+(.+)/);
    if (bashMatch) {
      steps.push({ tool: "$", detail: bashMatch[1]! });
      continue;
    }
    const searchMatch = trimmed.match(/^(?:Search|Grep|Find|Glob)\s+(.+)/i);
    if (searchMatch) {
      steps.push({ tool: trimmed.split(/\s/)[0]!, detail: searchMatch[1]! });
    }
  }
  return steps;
}

export function SubagentToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const isComplete = tc.status === "complete" || tc.status === "error";
  const [expanded, setExpanded] = useState(!isComplete);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const agentType = parsed.agent ?? "agent";
  const task = parsed.task ?? "";

  const output = tc.result ?? tc.partialResult;
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const accentColor = isDark ? "#BB86FC" : "#7B2FF2";
  const borderColor = isDark ? "#2A2A2A" : "#E8E8E8";
  const boxBg = isDark ? "#0D0D0D" : "#FAFAFA";
  const stepBg = isDark ? "#141414" : "#F5F5F5";

  const toggle = useCallback(() => { animateLayout(); setExpanded((v) => !v); }, []);

  const steps = useMemo(
    () => (output && isComplete ? parseSubagentSteps(output) : []),
    [output, isComplete],
  );

  return (
    <View>
      <Pressable style={styles.row} onPress={toggle}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: accentColor }]}>Agent</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {agentType}</Text>
        </Text>
        {expanded
          ? <ChevronDown size={13} color={mutedColor} strokeWidth={1.8} />
          : <ChevronRight size={13} color={mutedColor} strokeWidth={1.8} />
        }
      </Pressable>

      {expanded && (
        <View style={[subagentStyles.box, { backgroundColor: boxBg, borderColor }]}>
          {task ? (
            <View style={[subagentStyles.taskRow, { borderBottomColor: borderColor }]}>
              <View style={subagentStyles.taskHeader}>
                <Text style={[subagentStyles.taskLabel, { color: mutedColor }]}>Task</Text>
                {isRunning ? (
                  <ActivityIndicator size="small" color={accentColor} style={subagentStyles.spinner} />
                ) : null}
              </View>
              <Text style={[subagentStyles.taskText, { color: textColor }]} numberOfLines={3}>
                {task}
              </Text>
            </View>
          ) : null}

          {isRunning && !output && (
            <View style={subagentStyles.shimmerWrap}>
              <ShimmerLine width="70%" isDark={isDark} delay={0} />
              <ShimmerLine width="50%" isDark={isDark} delay={150} />
              <ShimmerLine width="85%" isDark={isDark} delay={300} />
            </View>
          )}

          {isRunning && output && (
            <View style={subagentStyles.streamingWrap}>
              <ScrollView style={subagentStyles.scroll} nestedScrollEnabled>
                <Text style={[subagentStyles.streamingText, { color: isDark ? "#999" : "#555" }]}>
                  {output.length > 3000 ? "…" + output.slice(output.length - 3000) : output}
                </Text>
              </ScrollView>
              <View style={subagentStyles.shimmerOverlay}>
                <ShimmerLine width="40%" isDark={isDark} delay={0} />
              </View>
            </View>
          )}

          {isComplete && steps.length > 0 && (
            <View style={subagentStyles.stepsWrap}>
              {steps.map((step, i) => (
                <View key={i} style={[subagentStyles.stepRow, { backgroundColor: stepBg }]}>
                  <Text style={[subagentStyles.stepVerb, { color: textColor }]}>{step.tool}</Text>
                  <Text style={[subagentStyles.stepDetail, { color: mutedColor }]} numberOfLines={1}>{step.detail}</Text>
                </View>
              ))}
            </View>
          )}

          {isComplete && output && (
            <ScrollView style={subagentStyles.scroll} nestedScrollEnabled>
              <Text
                style={[subagentStyles.output, {
                  color: tc.isError ? (isDark ? "#F85149" : "#CF222E") : (isDark ? "#8B8B8B" : "#555"),
                }]}
                selectable
              >
                {output.length > 5000 ? output.slice(0, 5000) + "\n… truncated" : output}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const subagentStyles = StyleSheet.create({
  box: { borderRadius: 8, borderWidth: 1, marginTop: 8, overflow: "hidden" },
  taskRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 0.633 },
  taskHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  taskLabel: { fontSize: 10, fontFamily: Fonts.sansSemiBold, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  taskText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  spinner: { marginLeft: 4, transform: [{ scale: 0.7 }] },
  shimmerWrap: { paddingHorizontal: 12, paddingVertical: 14, gap: 8 },
  shimmerLine: { height: 8, borderRadius: 4 },
  shimmerOverlay: { paddingHorizontal: 12, paddingBottom: 8 },
  streamingWrap: { overflow: "hidden" },
  streamingText: { fontSize: 12, fontFamily: Fonts.mono, lineHeight: 18 },
  stepsWrap: { paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, gap: 6 },
  stepVerb: { fontSize: 12, fontFamily: Fonts.sansSemiBold, fontWeight: "600" },
  stepDetail: { fontSize: 12, fontFamily: Fonts.mono, flex: 1 },
  scroll: { maxHeight: 400, paddingHorizontal: 12, paddingVertical: 10 },
  output: { fontSize: 12, fontFamily: Fonts.mono, lineHeight: 18 },
});
