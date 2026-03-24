import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useResponsiveLayout } from "@/features/navigation/hooks/use-responsive-layout";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { useIsMessageVisible, useMobileDiffSheet } from "./visibility-context";
import { animateLayout, basename, countLines, sharedStyles as styles } from "./tool-call-shared";
import {
  CodePreview,
  buildCodeRows,
  editStyles,
} from "./code-preview";
import { useDiffPanel, useAutoOpenDiffTab, type DiffTab } from "../diff-panel/context";

export function WriteToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const { isWideScreen } = useResponsiveLayout();
  const isRunning = isToolCallActive(tc);
  const isVisible = useIsMessageVisible();
  const statusLabel = getToolStatusLabel(tc);
  const mobileDiffSheet = useMobileDiffSheet();

  const diffPanel = useDiffPanel();
  const hasDiffPanel = diffPanel !== null && diffPanel.selectTab !== undefined;

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const newText = parsed.content ?? "";
  const fileName = basename(path);

  const tab: DiffTab | null = useMemo(() => {
    if (!tc.id || !path) return null;
    return { id: tc.id, toolName: "write" as const, path, fileName };
  }, [tc.id, path, fileName]);

  const usesSidebar = isWideScreen && hasDiffPanel;
  const isActiveInSidebar = usesSidebar && (diffPanel.activeTabId === tc.id || diffPanel.activeTabId === tab?.id);

  useAutoOpenDiffTab(tab, isRunning);

  const [expanded, setExpanded] = useState(!usesSidebar && isWideScreen && isRunning);

  useEffect(() => {
    if (!usesSidebar && isRunning && isWideScreen) setExpanded(true);
  }, [usesSidebar, isRunning, isWideScreen]);

  const previewRows = useMemo(() => buildCodeRows(newText, 1), [newText]);

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const addColor = isDark ? "#3FB950" : "#1A7F37";
  const boxBg = isDark ? "#0D0D0D" : "#FAFAFA";
  const boxBorder = isDark ? "#2A2A2A" : "#E8E8E8";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const activeIndicatorColor = isDark ? "#3B82F6" : "#2563EB";

  return (
    <View>
      <Pressable style={styles.row} onPress={() => {
        if (!isWideScreen) {
          mobileDiffSheet.open(tab?.id ?? undefined);
        } else if (usesSidebar && tab) {
          diffPanel.selectTab(tab);
        } else {
          animateLayout();
          setExpanded((v) => !v);
        }
      }}>
        {isActiveInSidebar && (
          <View style={{ width: 3, height: 14, borderRadius: 1.5, backgroundColor: activeIndicatorColor, marginRight: 4 }} />
        )}
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
        {usesSidebar ? null : !isWideScreen ? null : expanded
          ? <ChevronDown size={13} color={mutedColor} strokeWidth={1.8} />
          : <ChevronRight size={13} color={mutedColor} strokeWidth={1.8} />
        }
      </Pressable>

      {!usesSidebar && isWideScreen && expanded && isVisible && (previewRows.length > 0 || isRunning) && (
        <View style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}>
          <View style={[editStyles.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}>
            <Text style={[editStyles.toolbarPath, { color: mutedColor }]} numberOfLines={1}>{path}</Text>
          </View>

          {previewRows.length > 0 ? (
            <CodePreview rows={previewRows} isDark={isDark} lineNoBg={lineNoBg} lineNoColor={lineNoColor} />
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>Writing file...</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
