import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ToolCallInfo } from "../../types";
import { getToolStatusLabel, isToolCallActive, parseToolArguments } from "./tool-call-utils";
import { useIsMessageVisible } from "./visibility-context";
import { animateLayout, basename, sharedStyles as styles } from "./tool-call-shared";
import {
  CodePreview,
  buildCodeRows,
  editStyles,
  parseReadOutput,
  toolMetaStyles,
} from "./code-preview";

export function ReadToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const isVisible = useIsMessageVisible();
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(false);

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const fileName = basename(path);
  const output = tc.result ?? "";
  const parsedOutput = useMemo(() => parseReadOutput(output), [output]);
  const startLine = (parsed.offset ?? 0) + 1;
  const rows = useMemo(
    () => buildCodeRows(parsedOutput.body, startLine),
    [parsedOutput.body, startLine],
  );

  const textColor = isDark ? "#CCCCCC" : "#1A1A1A";
  const mutedColor = isDark ? "#888" : "#888";
  const boxBg = isDark ? "#0D0D0D" : "#FAFAFA";
  const boxBorder = isDark ? "#2A2A2A" : "#E8E8E8";
  const toolbarBg = isDark ? "#161616" : "#F3F3F3";
  const toolbarBorder = isDark ? "#2A2A2A" : "#E0E0E0";
  const lineNoBg = isDark ? "#111111" : "#F3F3F3";
  const lineNoColor = isDark ? "#444" : "#BBBBBB";

  const lineRange =
    rows.length > 0
      ? `${rows[0]?.lineNo}-${rows[rows.length - 1]?.lineNo}`
      : null;

  return (
    <View>
      <Pressable style={styles.row} onPress={() => { animateLayout(); setExpanded((v) => !v); }}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Read</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {fileName}</Text>
          {lineRange ? (
            <Text style={[styles.status, { color: mutedColor }]}> lines {lineRange}</Text>
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

      {expanded && isVisible && (rows.length > 0 || isRunning || !!output) && (
        <View style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}>
          <View
            style={[editStyles.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}
          >
            <Text style={[editStyles.toolbarPath, { color: mutedColor }]} numberOfLines={1}>
              {path}
            </Text>
            <View style={toolMetaStyles.row}>
              {parsed.limit != null ? (
                <Text style={[toolMetaStyles.text, { color: mutedColor }]}>
                  {parsed.limit} lines
                </Text>
              ) : null}
              {lineRange ? (
                <Text style={[toolMetaStyles.text, { color: mutedColor }]}>
                  {lineRange}
                </Text>
              ) : null}
            </View>
          </View>

          {rows.length > 0 ? (
            <CodePreview rows={rows} isDark={isDark} lineNoBg={lineNoBg} lineNoColor={lineNoColor} />
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>
                {tc.isError ? output : statusLabel ?? "Waiting for file contents..."}
              </Text>
            </View>
          )}

          {parsedOutput.remainingLines != null && parsedOutput.nextOffset != null ? (
            <View style={toolMetaStyles.footer}>
              <Text style={[toolMetaStyles.text, { color: mutedColor }]}>
                {parsedOutput.remainingLines} more lines available at offset {parsedOutput.nextOffset}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
