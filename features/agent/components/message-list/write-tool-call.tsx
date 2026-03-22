import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ChevronDown, ChevronRight, Columns2, Rows2 } from "lucide-react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettingsStore, type DiffViewMode } from "@/features/settings/store";
import { useFileRead } from "@/features/workspace/hooks/use-file-list";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { useIsMessageVisible } from "./visibility-context";
import { animateLayout, basename, countLines, sharedStyles as styles } from "./tool-call-shared";
import {
  CodePreview,
  SplitDiffView,
  TokenizedText,
  buildCodeRows,
  buildInline,
  buildSideBySide,
  editStyles,
  isResolvableFilePath,
  lcsLineDiff,
  toolMetaStyles,
} from "./code-preview";

type WriteBaselineState =
  | { kind: "content"; content: string }
  | { kind: "missing" };

export function WriteToolCall({ tc }: { tc: ToolCallInfo }) {
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
  const [baseline, setBaseline] = useState<WriteBaselineState | null>(null);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const newText = parsed.content ?? "";
  const fileName = basename(path);
  const canCaptureBaseline = isResolvableFilePath(path);
  const shouldCaptureBaseline = isRunning && canCaptureBaseline && baseline === null;
  const baselineQuery = useFileRead(shouldCaptureBaseline ? path : null);

  useEffect(() => {
    if (baseline !== null) return;
    if (baselineQuery.data?.content != null) {
      setBaseline({ kind: "content", content: baselineQuery.data.content });
      return;
    }
    if (baselineQuery.isError) {
      setBaseline({ kind: "missing" });
    }
  }, [baseline, baselineQuery.data?.content, baselineQuery.isError]);

  const oldText = baseline?.kind === "content" ? baseline.content : "";
  const previewRows = useMemo(() => buildCodeRows(newText, 1), [newText]);
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

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const boxBg = isDark ? "#0D0D0D" : "#FAFAFA";
  const boxBorder = isDark ? "#2A2A2A" : "#E8E8E8";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const dividerColor = isDark ? "#2A2A2A" : "#E0E0E0";
  const emptyBg = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const activeBtnBg = isDark ? "#2A2A2A" : "#FFFFFF";
  const addBg = isDark ? "rgba(63, 185, 80, 0.10)" : "rgba(26, 127, 55, 0.06)";
  const removeBg = isDark ? "rgba(248, 81, 73, 0.10)" : "rgba(207, 34, 46, 0.06)";
  const hasData = ops.length > 0;
  const canShowDiff = baseline !== null;

  const baselineLabel = (() => {
    if (!newText && isRunning) return statusLabel ?? "Preparing file contents...";
    if (baselineQuery.isLoading) return "Loading current file for diff...";
    if (baseline?.kind === "content") return "Diffing against current file";
    if (baseline?.kind === "missing") return "Treating this as a new file";
    if (!canCaptureBaseline && isRunning) return "Showing incoming file contents";
    if (!isRunning) return "Previous file state unavailable; showing written contents";
    return null;
  })();

  return (
    <View>
      <Pressable style={styles.row} onPress={() => { animateLayout(); setExpanded((v) => !v); }}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Write</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {fileName}</Text>
          {newText ? (
            <Text style={[styles.diff, { color: addColor }]}> +{countLines(newText)}</Text>
          ) : null}
          {statusLabel ? (
            <Text style={[styles.status, { color: mutedColor }]}> {statusLabel}</Text>
          ) : null}
        </Text>
        {expanded
          ? <ChevronDown size={13} color={mutedColor} strokeWidth={1.8} />
          : <ChevronRight size={13} color={mutedColor} strokeWidth={1.8} />
        }
      </Pressable>

      {expanded && isVisible && (hasData || isRunning || !!newText) && (
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

          {baselineLabel ? (
            <View style={toolMetaStyles.banner}>
              <Text style={[toolMetaStyles.text, { color: mutedColor }]}>{baselineLabel}</Text>
            </View>
          ) : null}

          {canShowDiff && hasData ? (
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
                    const prefixColor = row.type === "added" ? addColor : isDark ? "#F85149" : "#CF222E";
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
          ) : previewRows.length > 0 ? (
            <CodePreview rows={previewRows} isDark={isDark} lineNoBg={lineNoBg} lineNoColor={lineNoColor} rowBackgroundColor={addBg} />
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>{baselineLabel ?? "Preparing diff..."}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
