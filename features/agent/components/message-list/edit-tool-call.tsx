import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ChevronDown, ChevronRight, Columns2, Rows2 } from "lucide-react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettingsStore, type DiffViewMode } from "@/features/settings/store";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { useIsMessageVisible } from "./visibility-context";
import { animateLayout, basename, countLines, sharedStyles as styles } from "./tool-call-shared";
import {
  SplitDiffView,
  TokenizedText,
  buildInline,
  buildSideBySide,
  editStyles,
  lcsLineDiff,
} from "./code-preview";

export function EditToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const isVisible = useIsMessageVisible();
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(isRunning);
  const diffViewMode = useAppSettingsStore((s) => s.diffViewMode);
  const updateSettings = useAppSettingsStore((s) => s.update);
  const viewMode = diffViewMode;
  const setViewMode = (mode: DiffViewMode) => updateSettings({ diffViewMode: mode });
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const oldText = parsed.oldText ?? "";
  const newText = parsed.newText ?? "";

  const fileName = basename(path);
  const addedCount = countLines(newText);
  const removedCount = countLines(oldText);
  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const removeColor = isDark ? "#F85149" : "#CF222E";

  const ops = useMemo(() => {
    if (!expanded || (!oldText && !newText)) return [];
    return lcsLineDiff(oldText, newText);
  }, [expanded, oldText, newText]);

  const sideBySideRows = useMemo(() => {
    if (!expanded || viewMode !== "split") return [];
    return buildSideBySide(ops);
  }, [expanded, viewMode, ops]);

  const inlineRows = useMemo(() => {
    if (!expanded || viewMode !== "inline") return [];
    return buildInline(ops);
  }, [expanded, viewMode, ops]);

  const addBg = isDark ? "rgba(63, 185, 80, 0.10)" : "rgba(26, 127, 55, 0.06)";
  const removeBg = isDark ? "rgba(248, 81, 73, 0.10)" : "rgba(207, 34, 46, 0.06)";
  const boxBg = isDark ? "#0D0D0D" : "#FAFAFA";
  const boxBorder = isDark ? "#2A2A2A" : "#E8E8E8";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const dividerColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const emptyBg = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const activeBtnBg = isDark ? "#2A2A2A" : "#FFFFFF";
  const hasData = ops.length > 0;

  return (
    <View>
      <Pressable style={styles.row} onPress={() => { animateLayout(); setExpanded((v) => !v); }}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Edit</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {fileName}</Text>
          <Text style={[styles.diff, { color: addColor }]}> +{addedCount}</Text>
          <Text style={[styles.diff, { color: removeColor }]}> -{removedCount}</Text>
          {statusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}> {statusLabel}</Text>
          ) : null}
        </Text>
        {expanded
          ? <ChevronDown size={13} color={mutedColor} strokeWidth={1.8} />
          : <ChevronRight size={13} color={mutedColor} strokeWidth={1.8} />
        }
      </Pressable>

      {expanded && isVisible && (hasData || isRunning) && (
        <View
          style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <View style={[editStyles.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}>
            <Text style={[editStyles.toolbarPath, { color: mutedColor }]} numberOfLines={1}>{path}</Text>
            <View style={editStyles.viewToggle}>
              <Pressable
                onPress={() => setViewMode("inline")}
                style={[editStyles.viewToggleBtn, viewMode === "inline" && { backgroundColor: activeBtnBg }]}
              >
                <Rows2 size={12} color={viewMode === "inline" ? textColor : mutedColor} strokeWidth={1.8} />
              </Pressable>
              <Pressable
                onPress={() => setViewMode("split")}
                style={[editStyles.viewToggleBtn, viewMode === "split" && { backgroundColor: activeBtnBg }]}
              >
                <Columns2 size={12} color={viewMode === "split" ? textColor : mutedColor} strokeWidth={1.8} />
              </Pressable>
            </View>
          </View>

          {hasData ? (
            <ScrollView style={editStyles.scrollV} nestedScrollEnabled>
              {viewMode === "split" ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <SplitDiffView rows={sideBySideRows} containerWidth={containerWidth} isDark={isDark} removeBg={removeBg} addBg={addBg} emptyBg={emptyBg} lineNoBg={lineNoBg} lineNoColor={lineNoColor} dividerColor={dividerColor} />
                </ScrollView>
              ) : (
                <View>
                  {inlineRows.map((row, i) => {
                    const rowBg = row.type === "added" ? addBg : row.type === "removed" ? removeBg : undefined;
                    const prefix = row.type === "added" ? "+" : row.type === "removed" ? "-" : " ";
                    const prefixColor = row.type === "added" ? addColor : row.type === "removed" ? removeColor : mutedColor;
                    return (
                      <View key={i} style={[editStyles.inlineRow, rowBg ? { backgroundColor: rowBg } : undefined]}>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>{row.oldLineNo ?? ""}</Text>
                        </View>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>{row.newLineNo ?? ""}</Text>
                        </View>
                        <Text style={[editStyles.prefix, { color: prefixColor }]}>{prefix}</Text>
                        <TokenizedText line={row.text} isDark={isDark} style={editStyles.lineText} />
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>{statusLabel ?? "Preparing diff..."}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
