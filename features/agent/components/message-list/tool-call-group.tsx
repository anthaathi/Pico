import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive } from "./tool-call-utils";
import {
  MAX_VISIBLE_GROUP_ITEMS,
  animateLayout,
  formatSingleCall,
  multiGroupLabelParts,
  sharedStyles as styles,
} from "./tool-call-shared";
import { BashToolCall } from "./bash-tool-call";
import { ReadToolCall } from "./read-tool-call";
import { WriteToolCall } from "./write-tool-call";
import { EditToolCall } from "./edit-tool-call";
import { DownloadToolCall } from "./download-tool-call";
import { SubagentToolCall } from "./subagent-tool-call";
import { ToolCallCard } from "./tool-call-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function areToolCallArraysEqual(left: ToolCallInfo[], right: ToolCallInfo[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function AnimatedNumber({ value, style }: { value: number; style?: any }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [displayValue, setDisplayValue] = useState(value);
  const prevRef = useRef(value);
  const numberStyle = [style, { fontVariant: ["tabular-nums"] as const }];

  useEffect(() => {
    if (value === prevRef.current) return;
    prevRef.current = value;

    Animated.timing(opacity, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      setDisplayValue(value);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    });
  }, [value, opacity]);

  return (
    <Animated.Text style={[numberStyle, { opacity }]}>
      {displayValue}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// SingleToolCall — dispatches to the correct renderer
// ---------------------------------------------------------------------------

function SingleToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [expanded, setExpanded] = useState(false);

  if (tc.name === "bash") return <BashToolCall tc={tc} />;
  if (tc.name === "read") return <ReadToolCall tc={tc} />;
  if (tc.name === "write") return <WriteToolCall tc={tc} />;
  if (tc.name === "edit") return <EditToolCall tc={tc} />;
  if (tc.name === "download") return <DownloadToolCall tc={tc} />;
  if (tc.name === "subagent") return <SubagentToolCall tc={tc} />;

  const { verb, detail, diffAdded, diffRemoved } = formatSingleCall(tc);
  const output = tc.result ?? tc.partialResult;
  const statusLabel = getToolStatusLabel(tc);
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const removeColor = isDark ? "#F85149" : "#CF222E";

  return (
    <View>
      <Pressable
        style={styles.row}
        onPress={() => { if (output) { animateLayout(); setExpanded((v) => !v); } }}
      >
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>{verb}</Text>
          {detail ? (
            <Text style={[styles.detail, { color: mutedColor }]}> {detail}</Text>
          ) : null}
          {diffAdded != null && diffRemoved != null ? (
            <>
              <Text style={[styles.diff, { color: addColor }]}> +{diffAdded}</Text>
              <Text style={[styles.diff, { color: removeColor }]}> -{diffRemoved}</Text>
            </>
          ) : null}
          {statusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}> {statusLabel}</Text>
          ) : null}
        </Text>
      </Pressable>

      {expanded && output && (
        <View style={groupStyles.expandedOutput}>
          <Text
            style={[
              groupStyles.outputText,
              {
                color: tc.isError
                  ? colors.destructive
                  : isDark ? "#555" : "#888",
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

// ---------------------------------------------------------------------------
// ToolCallGroup — groups multiple calls of the same type
// ---------------------------------------------------------------------------

function ToolCallGroupComponent({
  toolName,
  calls,
}: {
  toolName: string;
  calls: ToolCallInfo[];
}) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const [expanded, setExpanded] = useState(false);
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const activeCall = calls.find((call) => isToolCallActive(call));
  const groupStatusLabel = activeCall ? getToolStatusLabel(activeCall) : null;

  useEffect(() => {
    if (groupStatusLabel) setExpanded(true);
  }, [groupStatusLabel]);

  const toggle = useCallback(() => { animateLayout(); setExpanded((v) => !v); }, []);
  const groupParts = multiGroupLabelParts(toolName, calls.length);

  const [showAll, setShowAll] = useState(false);
  const mutedColor = isDark ? "#888" : "#888";

  if (calls.length === 1) {
    return <SingleToolCall tc={calls[0]} />;
  }

  const hasMore = calls.length > MAX_VISIBLE_GROUP_ITEMS;
  const visibleCalls = expanded
    ? (showAll ? calls : calls.slice(0, MAX_VISIBLE_GROUP_ITEMS))
    : [];
  const hiddenCount = calls.length - MAX_VISIBLE_GROUP_ITEMS;

  return (
    <View>
      <Pressable style={styles.row} onPress={toggle}>
        <View style={groupStyles.animatedLabelRow}>
          {groupParts.before ? (
            <Text style={[groupStyles.label, { color: textColor }]}>{groupParts.before}</Text>
          ) : null}
          <AnimatedNumber
            value={calls.length}
            style={[groupStyles.label, { color: textColor }]}
          />
          {groupParts.after ? (
            <Text style={[groupStyles.label, { color: textColor }]}>{groupParts.after}</Text>
          ) : null}
          {groupStatusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}>
              {" "}
              {groupStatusLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {expanded && (
        <View style={groupStyles.expandedList}>
          {visibleCalls.map((tc) => (
            <SingleToolCall key={tc.id} tc={tc} />
          ))}
          {hasMore && !showAll && (
            <Pressable
              style={groupStyles.showMoreBtn}
              onPress={() => { animateLayout(); setShowAll(true); }}
            >
              <Text style={[groupStyles.showMoreText, { color: mutedColor }]}>
                Show {hiddenCount} more…
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export const ToolCallGroup = memo(
  ToolCallGroupComponent,
  (prev, next) =>
    prev.toolName === next.toolName &&
    areToolCallArraysEqual(prev.calls, next.calls),
);

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

export interface ToolCallRenderItem {
  key: string;
  toolName: string;
  calls: ToolCallInfo[];
}

const NEVER_GROUP = new Set(["bash", "write", "edit"]);

function stableToolCallId(tc: ToolCallInfo): string {
  return tc.previousId ?? tc.id;
}

export function groupToolCalls(
  toolCalls: ToolCallInfo[],
): ToolCallRenderItem[] {
  if (toolCalls.length === 0) return [];

  const result: ToolCallRenderItem[] = [];
  const pending = new Map<string, ToolCallRenderItem>();

  for (const tc of toolCalls) {
    if (NEVER_GROUP.has(tc.name)) {
      result.push({
        key: `single-${stableToolCallId(tc)}`,
        toolName: tc.name,
        calls: [tc],
      });
    } else {
      const existing = pending.get(tc.name);
      if (existing) {
        existing.calls.push(tc);
      } else {
        const item: ToolCallRenderItem = {
          key: `group-${stableToolCallId(tc)}`,
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const groupStyles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
  },
  animatedLabelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  expandedList: {
    paddingLeft: 8,
    paddingTop: 6,
    gap: 4,
  },
  showMoreBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  showMoreText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  expandedOutput: {
    paddingLeft: 8,
    paddingTop: 8,
    paddingBottom: 4,
    maxHeight: 300,
  },
  outputText: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    lineHeight: 16,
  },
});
