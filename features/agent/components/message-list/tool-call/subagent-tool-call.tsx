import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { useStableMarkdown } from "../../../hooks/use-stable-markdown";
import { markedDarkOptions, markedLightOptions } from "../../../theme";
import { isToolActive, parseToolArguments } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { AnimatedCollapse } from "../animated-collapse";

interface SubagentToolCallProps {
  tc: ToolCallInfo;
  isDark: boolean;
}

const DETAIL_MAX_HEIGHT = 340;

export const SubagentToolCall = memo(function SubagentToolCall({
  tc,
  isDark,
}: SubagentToolCallProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const active = isToolActive(tc);
  const hasResult = !!tc.result;
  const [expanded, setExpanded] = useState(active || hasResult);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (active || hasResult) setExpanded(true);
  }, [active, hasResult]);

  const transcript = tc.result || tc.partialResult || "";
  const parsed = parseToolArguments(tc.arguments);
  const task = (parsed.task as string) || "";
  const agentName = (parsed.agent as string) || tc.progress?.agent || "agent";
  const recentTools = tc.progress?.recentTools ?? [];
  const recentOutput = tc.progress?.recentOutput ?? [];
  const hasProgressMeta = !!tc.progress?.status || !!tc.progress?.toolCount || !!tc.progress?.durationMs;
  const hasDetail = !!transcript || recentTools.length > 0 || recentOutput.length > 0 || hasProgressMeta;

  useEffect(() => {
    if (active && scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [active, transcript, tc.progress]);

  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const markdownOptions = isDark ? markedDarkOptions : markedLightOptions;
  const markdownElements = useStableMarkdown(
    transcript,
    markdownOptions,
    active && !tc.result,
  );

  const meta = tc.subagentMeta;

  const metaItems = useMemo(() => {
    const items: string[] = [];
    if (meta?.model) items.push(meta.model);
    const status = tc.progress?.status || (active ? "running" : undefined);
    if (status) items.push(status);
    const toolCount = meta?.toolCount ?? tc.progress?.toolCount;
    if (typeof toolCount === "number" && toolCount > 0) items.push(`${toolCount} tools`);
    const durationMs = meta?.durationMs ?? tc.progress?.durationMs;
    if (typeof durationMs === "number" && durationMs > 0) {
      const seconds = durationMs / 1000;
      items.push(seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`);
    }
    if (typeof meta?.cost === "number" && meta.cost > 0) {
      items.push(`$${meta.cost < 0.01 ? meta.cost.toFixed(4) : meta.cost.toFixed(2)}`);
    }
    return items;
  }, [active, meta, tc.progress, tc.status]);

  return (
    <View>
      <Pressable onPress={hasDetail ? toggle : undefined} style={styles.header}>
        <ToolStatusDot status={tc.status} />
        <View style={styles.headerText}>
          <View style={styles.headerTopRow}>
            <Text style={[styles.agentName, { color: colors.textSecondary }]}>
              {agentName}
            </Text>
            {!!metaItems.length && (
              <Text style={[styles.metaInline, { color: colors.textTertiary }]} numberOfLines={1}>
                {metaItems.join(" • ")}
              </Text>
            )}
          </View>
          {task ? (
            <Text style={[styles.task, { color: colors.textTertiary }]} numberOfLines={1}>
              {task}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <AnimatedCollapse expanded={expanded && hasDetail} maxHeight={420}>
        <View style={[styles.detailBox, { backgroundColor: colors.surfaceRaised }]}> 
          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: DETAIL_MAX_HEIGHT }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {recentTools.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Steps</Text>
                {recentTools.map((step, i) => (
                  <Text key={i} style={[styles.stepText, { color: colors.textSecondary }]}>
                    {step.tool}({step.args})
                  </Text>
                ))}
              </View>
            )}

            {recentOutput.length > 0 && !transcript && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Output</Text>
                {recentOutput.map((line, i) => (
                  <Text key={`o-${i}`} style={[styles.outputText, { color: colors.textSecondary }]}> 
                    {line}
                  </Text>
                ))}
              </View>
            )}

            {!!transcript && (
              <View style={styles.section}>
                {(recentTools.length > 0 || recentOutput.length > 0 || hasProgressMeta) && (
                  <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Transcript</Text>
                )}
                <View style={styles.markdownWrap}>{markdownElements}</View>
              </View>
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
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 3,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  agentName: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  metaInline: {
    flex: 1,
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
  task: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
  detailBox: {
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    marginLeft: 12,
  },
  section: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    marginBottom: 4,
  },
  stepText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
  },
  outputText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Fonts.mono,
  },
  markdownWrap: {
    minWidth: 0,
  },
});
