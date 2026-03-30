import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import type { ToolCallInfo } from "../../../types";
import { isToolActive, toolDisplayName, basename, parseToolArguments, countLines } from "../utils";
import { ToolStatusDot } from "./tool-status-dot";
import { AnimatedCollapse } from "../animated-collapse";
import { BashToolCall } from "./bash-tool-call";
import { ReadToolCall } from "./read-tool-call";
import { WriteToolCall } from "./write-tool-call";
import { EditToolCall } from "./edit-tool-call";
import { DownloadToolCall } from "./download-tool-call";
import { SubagentToolCall } from "./subagent-tool-call";
import { GenericToolCall } from "./generic-tool-call";

const NEVER_GROUP = new Set(["bash", "write", "edit", "subagent"]);
const MAX_VISIBLE = 5;

const GROUP_LABELS: Record<string, { before: string; after: string; activeBefore?: string }> = {
  read: { before: "Explored ", activeBefore: "Exploring ", after: " files" },
  search: { before: "", after: " web searches" },
  scrape: { before: "Scraped ", after: " pages" },
  crawl: { before: "Crawled ", after: " sites" },
  download: { before: "", after: " downloads" },
  subagent: { before: "Ran ", after: " agents" },
};

interface RenderGroup {
  key: string;
  toolName: string;
  calls: ToolCallInfo[];
}

function groupToolCalls(toolCalls: ToolCallInfo[]): RenderGroup[] {
  if (!toolCalls.length) return [];
  const result: RenderGroup[] = [];
  const pending = new Map<string, RenderGroup>();

  for (const tc of toolCalls) {
    const stableId = tc.previousId ?? tc.id;
    if (NEVER_GROUP.has(tc.name)) {
      result.push({ key: `s-${stableId}`, toolName: tc.name, calls: [tc] });
    } else {
      const existing = pending.get(tc.name);
      if (existing) {
        existing.calls.push(tc);
      } else {
        const item: RenderGroup = {
          key: `g-${stableId}`,
          toolName: tc.name,
          calls: [tc],
        };
        pending.set(tc.name, item);
        result.push(item);
      }
    }
  }
  return result;
}

interface ToolCallGroupProps {
  toolCalls: ToolCallInfo[];
  isDark: boolean;
}

export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
  isDark,
}: ToolCallGroupProps) {
  const groups = useMemo(() => groupToolCalls(toolCalls), [toolCalls]);
  if (!groups.length) return null;

  return (
    <View style={styles.container}>
      {groups.map((g) =>
        g.calls.length === 1 && g.toolName !== "read" ? (
          <SingleToolCall key={g.key} tc={g.calls[0]} isDark={isDark} />
        ) : (
          <GroupedToolCalls
            key={g.key}
            toolName={g.toolName}
            calls={g.calls}
            isDark={isDark}
          />
        ),
      )}
    </View>
  );
});

function SingleToolCall({ tc, isDark }: { tc: ToolCallInfo; isDark: boolean }) {
  switch (tc.name) {
    case "bash":
      return <BashToolCall tc={tc} isDark={isDark} />;
    case "read":
      return <ReadToolCall tc={tc} isDark={isDark} />;
    case "write":
      return <WriteToolCall tc={tc} isDark={isDark} />;
    case "edit":
      return <EditToolCall tc={tc} isDark={isDark} />;
    case "download":
      return <DownloadToolCall tc={tc} isDark={isDark} />;
    case "subagent":
      return <SubagentToolCall tc={tc} isDark={isDark} />;
    default:
      return <GenericToolCall tc={tc} isDark={isDark} />;
  }
}

function AnimatedNumber({ value, style }: { value: number; style?: any }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === prevRef.current) return;
    prevRef.current = value;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 80,
      useNativeDriver: true,
    }).start(() => {
      setDisplay(value);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }).start();
    });
  }, [value, opacity]);

  return (
    <Animated.Text style={[style, { opacity, fontVariant: ["tabular-nums"] }]}>
      {display}
    </Animated.Text>
  );
}

function formatSingleLine(tc: ToolCallInfo): string {
  const parsed = parseToolArguments(tc.arguments);
  switch (tc.name) {
    case "read": {
      const name = parsed.path ? basename(parsed.path as string) : "file";
      return `Read ${name}`;
    }
    case "write": {
      const name = parsed.path ? basename(parsed.path as string) : "file";
      return `Write ${name}`;
    }
    case "edit": {
      const name = parsed.path ? basename(parsed.path as string) : "file";
      return `Edit ${name}`;
    }
    case "bash": {
      const cmd = (parsed.command as string) || "command";
      return `$ ${cmd.length > 50 ? cmd.slice(0, 50) + "…" : cmd}`;
    }
    default:
      return toolDisplayName(tc.name);
  }
}

const GroupedToolCalls = memo(function GroupedToolCalls({
  toolName,
  calls,
  isDark,
}: {
  toolName: string;
  calls: ToolCallInfo[];
  isDark: boolean;
}) {
  const colors = isDark ? Colors.dark : Colors.light;
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const activeCall = calls.find(isToolActive);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  const baseParts = GROUP_LABELS[toolName] ?? { before: "", after: ` ${toolName} calls` };
  const parts = {
    before: activeCall ? (baseParts.activeBefore ?? baseParts.before) : baseParts.before,
    after: toolName === "read" ? " files" : baseParts.after,
  };
  const hasMore = calls.length > MAX_VISIBLE;
  const visible = expanded ? (showAll ? calls : calls.slice(0, MAX_VISIBLE)) : [];
  const hiddenCount = calls.length - MAX_VISIBLE;

  return (
    <View>
      <Pressable onPress={toggle} style={styles.groupHeader}>
        <View style={styles.labelRow}>
          {parts.before ? (
            <Text style={[styles.groupLabel, { color: colors.text }]}>
              {parts.before}
            </Text>
          ) : null}
          <AnimatedNumber
            value={calls.length}
            style={[styles.groupLabel, { color: colors.text }]}
          />
          <Text style={[styles.groupLabel, { color: colors.text }]}>
            {parts.after}
          </Text>
        </View>
      </Pressable>

      <AnimatedCollapse expanded={expanded} maxHeight={400}>
        <View style={styles.expandedList}>
          {visible.map((tc) => (
            <View key={tc.id} style={styles.expandedItem}>
              <ToolStatusDot status={tc.status} size={4} />
              <Text
                style={[styles.expandedItemText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {formatSingleLine(tc)}
              </Text>
            </View>
          ))}
          {hasMore && !showAll && (
            <Pressable
              style={styles.showMoreBtn}
              onPress={() => setShowAll(true)}
            >
              <Text style={[styles.showMoreText, { color: colors.textTertiary }]}>
                Show {hiddenCount} more…
              </Text>
            </Pressable>
          )}
        </View>
      </AnimatedCollapse>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 2,
    marginTop: 4,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupLabel: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  expandedList: {
    paddingLeft: 12,
    paddingTop: 4,
    gap: 2,
  },
  expandedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 2,
  },
  expandedItemText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    flex: 1,
  },
  showMoreBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  showMoreText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
});
