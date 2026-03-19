import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ChevronDown, ChevronRight, Columns2, Rows2 } from "lucide-react-native";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettingsStore, type DiffViewMode } from "@/features/settings/store";
import { useFileRead } from "@/features/workspace/hooks/use-file-list";
import type { ToolCallInfo } from "../../types";
import { ToolCallCard } from "./tool-call-card";
import {
  getToolStatusLabel,
  isToolCallActive,
  parseToolArguments,
} from "./tool-call-utils";

const SINGLE_VERB: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  bash: "$",
  python: "Python",
  search: "Search",
  scrape: "Scrape",
  crawl: "Crawl",
  subagent: "Sub-agent",
};

function areToolCallArraysEqual(left: ToolCallInfo[], right: ToolCallInfo[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function AnimatedNumber({ value, style }: { value: number; style?: any }) {
  const prevRef = useRef(value);
  const slideOut = useRef(new Animated.Value(0)).current;
  const slideIn = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState({ prev: value, next: value });
  const animating = useRef(false);

  useEffect(() => {
    if (value === prevRef.current) return;
    const prev = prevRef.current;
    prevRef.current = value;
    setDisplay({ prev, next: value });
    animating.current = true;
    slideOut.setValue(0);
    slideIn.setValue(1);
    Animated.parallel([
      Animated.timing(slideOut, {
        toValue: -1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(slideIn, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      animating.current = false;
      setDisplay({ prev: value, next: value });
    });
  }, [value, slideOut, slideIn]);

  const height = 18;

  if (display.prev === display.next && !animating.current) {
    return <Text style={style}>{display.next}</Text>;
  }

  return (
    <View style={{ height, overflow: "hidden", justifyContent: "center" }}>
      <Animated.Text
        style={[
          style,
          {
            position: "absolute",
            opacity: slideOut.interpolate({
              inputRange: [-1, 0],
              outputRange: [0, 1],
            }),
            transform: [
              {
                translateY: slideOut.interpolate({
                  inputRange: [-1, 0],
                  outputRange: [-height, 0],
                }),
              },
            ],
          },
        ]}
      >
        {display.prev}
      </Animated.Text>
      <Animated.Text
        style={[
          style,
          {
            opacity: slideIn.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
            transform: [
              {
                translateY: slideIn.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, height],
                }),
              },
            ],
          },
        ]}
      >
        {display.next}
      </Animated.Text>
    </View>
  );
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function formatSingleCall(tc: ToolCallInfo): {
  verb: string;
  detail: string;
  diffAdded?: number;
  diffRemoved?: number;
} {
  const verb = SINGLE_VERB[tc.name] ?? tc.name;
  const parsed = parseToolArguments(tc.arguments);
  switch (tc.name) {
    case "read": {
      const name = parsed.path ? basename(parsed.path) : "";
      const params: string[] = [];
      if (parsed.offset != null) params.push(`offset=${parsed.offset}`);
      if (parsed.limit != null) params.push(`limit=${parsed.limit}`);
      return {
        verb,
        detail: params.length ? `${name} ${params.join(" ")}` : name,
      };
    }
    case "edit": {
      const name = parsed.path ? basename(parsed.path) : "";
      const added = countLines(parsed.newText ?? "");
      const removed = countLines(parsed.oldText ?? "");
      return { verb, detail: name, diffAdded: added, diffRemoved: removed };
    }
    case "write": {
      const name = parsed.path ? basename(parsed.path) : "";
      return { verb, detail: name };
    }
    case "bash": {
      const cmd = parsed.command ?? "";
      return { verb, detail: cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd };
    }
    default:
      return { verb, detail: "" };
  }
}

const MULTI_GROUP_PARTS: Record<string, { before: string; after: string }> = {
  read: { before: "Read ", after: " files" },
  edit: { before: "Edited ", after: " files" },
  write: { before: "Wrote ", after: " files" },
  bash: { before: "Ran ", after: " commands" },
  python: { before: "Ran Python ", after: " times" },
  search: { before: "", after: " web searches" },
  scrape: { before: "Scraped ", after: " pages" },
  crawl: { before: "Crawled ", after: " sites" },
  subagent: { before: "Ran ", after: " sub-agents" },
};

function multiGroupLabelParts(
  toolName: string,
  _count: number,
): { before: string; after: string } {
  return MULTI_GROUP_PARTS[toolName] ?? { before: "", after: `× ${toolName}` };
}

function BashToolCall({ tc }: { tc: ToolCallInfo }) {
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

  const toggle = useCallback(() => setExpanded((v) => !v), []);

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
              {isRunning && !output && (
                <Text style={[bashStyles.output, { color: isDark ? "#8B8B8B" : "#999999" }]}>Running…</Text>
              )}
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

type DiffOp = { type: "equal" | "insert" | "delete"; lines: string[] };

function lcsLineDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0, j = 0;

  const push = (type: DiffOp["type"], line: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      last.lines.push(line);
    } else {
      ops.push({ type, lines: [line] });
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < n) { push("delete", a[i]); i++; }
  while (j < m) { push("insert", b[j]); j++; }

  return ops;
}

interface SideBySideRow {
  leftLineNo: number | null;
  leftText: string | null;
  leftType: "removed" | "context" | "empty";
  rightLineNo: number | null;
  rightText: string | null;
  rightType: "added" | "context" | "empty";
}

function buildSideBySide(ops: DiffOp[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "equal") {
      for (const line of op.lines) {
        rows.push({
          leftLineNo: oldLine++, leftText: line, leftType: "context",
          rightLineNo: newLine++, rightText: line, rightType: "context",
        });
      }
    } else if (op.type === "delete") {
      const next = ops[i + 1];
      if (next && next.type === "insert") {
        const maxLen = Math.max(op.lines.length, next.lines.length);
        for (let k = 0; k < maxLen; k++) {
          const hasOld = k < op.lines.length;
          const hasNew = k < next.lines.length;
          rows.push({
            leftLineNo: hasOld ? oldLine++ : null,
            leftText: hasOld ? op.lines[k] : null,
            leftType: hasOld ? "removed" : "empty",
            rightLineNo: hasNew ? newLine++ : null,
            rightText: hasNew ? next.lines[k] : null,
            rightType: hasNew ? "added" : "empty",
          });
        }
        i++;
      } else {
        for (const line of op.lines) {
          rows.push({
            leftLineNo: oldLine++, leftText: line, leftType: "removed",
            rightLineNo: null, rightText: null, rightType: "empty",
          });
        }
      }
    } else {
      for (const line of op.lines) {
        rows.push({
          leftLineNo: null, leftText: null, leftType: "empty",
          rightLineNo: newLine++, rightText: line, rightType: "added",
        });
      }
    }
  }
  return rows;
}

interface InlineRow {
  type: "context" | "added" | "removed";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function buildInline(ops: DiffOp[]): InlineRow[] {
  const rows: InlineRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      for (const line of op.lines) {
        rows.push({ type: "context", text: line, oldLineNo: oldLine++, newLineNo: newLine++ });
      }
    } else if (op.type === "delete") {
      for (const line of op.lines) {
        rows.push({ type: "removed", text: line, oldLineNo: oldLine++, newLineNo: null });
      }
    } else {
      for (const line of op.lines) {
        rows.push({ type: "added", text: line, oldLineNo: null, newLineNo: newLine++ });
      }
    }
  }
  return rows;
}

interface Token { text: string; color: string }

interface CodeRow {
  lineNo: number;
  text: string;
}

interface ParsedReadOutput {
  body: string;
  nextOffset?: number;
  remainingLines?: number;
}

const READ_MORE_PATTERN =
  /\n?\[(\d+) more lines in file\. Use offset=(\d+) to continue\.\]\s*$/;

const KEYWORDS = new Set([
  "import", "export", "from", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "this", "class", "extends", "super", "typeof", "instanceof",
  "void", "delete", "throw", "try", "catch", "finally", "async", "await",
  "yield", "in", "of", "true", "false", "null", "undefined", "type",
  "interface", "enum", "implements", "abstract", "as", "is", "readonly",
  "static", "private", "protected", "public", "def", "self", "None", "True",
  "False", "elif", "except", "raise", "with", "lambda", "pass", "and", "or",
  "not", "struct", "impl", "fn", "pub", "mut", "use", "mod", "crate",
]);

function tokenizeLine(line: string, isDark: boolean): Token[] {
  const c = {
    keyword: isDark ? "#C586C0" : "#AF00DB",
    string: isDark ? "#CE9178" : "#A31515",
    number: isDark ? "#B5CEA8" : "#098658",
    comment: isDark ? "#6A9955" : "#008000",
    type: isDark ? "#4EC9B0" : "#267F99",
    func: isDark ? "#DCDCAA" : "#795E26",
    punct: isDark ? "#808080" : "#999999",
    plain: isDark ? "#9CDCFE" : "#333333",
  };

  const tokens: Token[] = [];
  const re = /\/\/.*|\/\*[\s\S]*?\*\/|#.*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+\.?\d*(?:e[+-]?\d+)?\b|\b0x[0-9a-fA-F]+\b|[A-Z][a-zA-Z0-9_]*|[a-zA-Z_]\w*(?=\s*\()|[a-zA-Z_]\w*|[{}()\[\];:,.<>!=+\-*/%&|^~?@]|[ \t]+|\S/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const t = match[0];
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("/*")) {
      tokens.push({ text: t, color: c.comment });
    } else if (/^["'`]/.test(t) || t.startsWith('"""') || t.startsWith("'''")) {
      tokens.push({ text: t, color: c.string });
    } else if (/^\d/.test(t) || /^0x/i.test(t)) {
      tokens.push({ text: t, color: c.number });
    } else if (KEYWORDS.has(t)) {
      tokens.push({ text: t, color: c.keyword });
    } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(t)) {
      tokens.push({ text: t, color: c.type });
    } else if (/^[a-zA-Z_]\w*$/.test(t) && line[match.index + t.length] === "(") {
      tokens.push({ text: t, color: c.func });
    } else if (/^[{}()\[\];:,.<>!=+\-*/%&|^~?@]$/.test(t)) {
      tokens.push({ text: t, color: c.punct });
    } else {
      tokens.push({ text: t, color: c.plain });
    }
  }

  if (tokens.length === 0) {
    tokens.push({ text: line, color: c.plain });
  }

  return tokens;
}

function TokenizedText({ line, isDark, style }: { line: string; isDark: boolean; style?: any }) {
  const tokens = useMemo(() => tokenizeLine(line, isDark), [line, isDark]);
  return (
    <Text style={style} selectable>
      {tokens.map((tok, i) => (
        <Text key={i} style={{ color: tok.color }}>{tok.text}</Text>
      ))}
    </Text>
  );
}

function buildCodeRows(text: string, startLine: number): CodeRow[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split("\n");
  return lines.map((line, index) => ({
    lineNo: startLine + index,
    text: line,
  }));
}

function parseReadOutput(text: string): ParsedReadOutput {
  const match = text.match(READ_MORE_PATTERN);
  if (!match || match.index == null) {
    return { body: text };
  }

  return {
    body: text.slice(0, match.index).replace(/\n+$/, ""),
    remainingLines: Number.parseInt(match[1] ?? "", 10),
    nextOffset: Number.parseInt(match[2] ?? "", 10),
  };
}

function isResolvableFilePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~");
}

function CodePreview({
  rows,
  isDark,
  lineNoBg,
  lineNoColor,
  rowBackgroundColor,
}: {
  rows: CodeRow[];
  isDark: boolean;
  lineNoBg: string;
  lineNoColor: string;
  rowBackgroundColor?: string;
}) {
  return (
    <ScrollView style={editStyles.scrollV} nestedScrollEnabled>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={codeStyles.table}>
          {rows.map((row) => (
            <View
              key={`${row.lineNo}-${row.text}`}
              style={[
                codeStyles.row,
                rowBackgroundColor ? { backgroundColor: rowBackgroundColor } : undefined,
              ]}
            >
              <View style={[codeStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                  {row.lineNo}
                </Text>
              </View>
              <TokenizedText
                line={row.text}
                isDark={isDark}
                style={editStyles.lineText}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function SplitDiffView({
  rows,
  containerWidth,
  isDark,
  removeBg,
  addBg,
  emptyBg,
  lineNoBg,
  lineNoColor,
  dividerColor,
}: {
  rows: SideBySideRow[];
  containerWidth: number;
  isDark: boolean;
  removeBg: string;
  addBg: string;
  emptyBg: string;
  lineNoBg: string;
  lineNoColor: string;
  dividerColor: string;
}) {
  const halfW = Math.max(200, Math.floor((containerWidth - 1) / 2));
  return (
    <View style={[editStyles.table, { width: halfW * 2 + 1 }]}>
      {rows.map((row, i) => (
        <View key={i} style={editStyles.tableRow}>
          <View style={[
            editStyles.half,
            { width: halfW },
            row.leftType === "removed" ? { backgroundColor: removeBg } :
            row.leftType === "empty" ? { backgroundColor: emptyBg } : undefined,
          ]}>
            <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
              <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                {row.leftLineNo ?? ""}
              </Text>
            </View>
            {row.leftText != null ? (
              <TokenizedText line={row.leftText} isDark={isDark} style={editStyles.lineText} />
            ) : (
              <Text style={editStyles.lineText}>{" "}</Text>
            )}
          </View>
          <View style={[editStyles.divider, { backgroundColor: dividerColor }]} />
          <View style={[
            editStyles.half,
            { width: halfW },
            row.rightType === "added" ? { backgroundColor: addBg } :
            row.rightType === "empty" ? { backgroundColor: emptyBg } : undefined,
          ]}>
            <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
              <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                {row.rightLineNo ?? ""}
              </Text>
            </View>
            {row.rightText != null ? (
              <TokenizedText line={row.rightText} isDark={isDark} style={editStyles.lineText} />
            ) : (
              <Text style={editStyles.lineText}>{" "}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function ReadToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
    }
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const fileName = basename(path);
  const output = tc.result ?? tc.partialResult ?? "";
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
      <Pressable style={styles.row} onPress={() => setExpanded((v) => !v)}>
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

      {expanded && (rows.length > 0 || isRunning || !!output) && (
        <View style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}>
          <View
            style={[
              editStyles.toolbar,
              { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder },
            ]}
          >
            <Text
              style={[editStyles.toolbarPath, { color: mutedColor }]}
              numberOfLines={1}
            >
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
            <CodePreview
              rows={rows}
              isDark={isDark}
              lineNoBg={lineNoBg}
              lineNoColor={lineNoColor}
            />
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>
                {tc.isError
                  ? output
                  : statusLabel ?? "Waiting for file contents..."}
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

type WriteBaselineState =
  | { kind: "content"; content: string }
  | { kind: "missing" };

function WriteToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(isRunning);
  const diffViewMode = useAppSettingsStore((s) => s.diffViewMode);
  const updateSettings = useAppSettingsStore((s) => s.update);
  const viewMode = diffViewMode;
  const setViewMode = (mode: DiffViewMode) => updateSettings({ diffViewMode: mode });
  const [containerWidth, setContainerWidth] = useState(0);
  const [baseline, setBaseline] = useState<WriteBaselineState | null>(null);

  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
    }
  }, [isRunning]);

  const parsed = parseToolArguments(tc.arguments);
  const path = parsed.path ?? "";
  const newText = parsed.content ?? "";
  const fileName = basename(path);
  const canCaptureBaseline = isResolvableFilePath(path);
  const shouldCaptureBaseline =
    isRunning && canCaptureBaseline && baseline === null;
  const baselineQuery = useFileRead(shouldCaptureBaseline ? path : null);

  useEffect(() => {
    if (baseline !== null) {
      return;
    }
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
    if (!newText && isRunning) {
      return statusLabel ?? "Preparing file contents...";
    }
    if (baselineQuery.isLoading) {
      return "Loading current file for diff...";
    }
    if (baseline?.kind === "content") {
      return "Diffing against current file";
    }
    if (baseline?.kind === "missing") {
      return "Treating this as a new file";
    }
    if (!canCaptureBaseline && isRunning) {
      return "Showing incoming file contents";
    }
    if (!isRunning) {
      return "Previous file state unavailable; showing written contents";
    }
    return null;
  })();

  return (
    <View>
      <Pressable style={styles.row} onPress={() => setExpanded((v) => !v)}>
        <Text style={styles.singleLine} numberOfLines={1}>
          <Text style={[styles.verb, { color: textColor }]}>Write</Text>
          <Text style={[styles.detail, { color: mutedColor }]}> {fileName}</Text>
          {newText ? (
            <Text style={[styles.diff, { color: addColor }]}>
              {" "}
              +{countLines(newText)}
            </Text>
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

      {expanded && (hasData || isRunning || !!newText) && (
        <View
          style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <View
            style={[
              editStyles.toolbar,
              { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder },
            ]}
          >
            <Text
              style={[editStyles.toolbarPath, { color: mutedColor }]}
              numberOfLines={1}
            >
              {path}
            </Text>
            <View style={editStyles.viewToggle}>
              <Pressable
                onPress={() => setViewMode("inline")}
                style={[
                  editStyles.viewToggleBtn,
                  viewMode === "inline" && { backgroundColor: activeBtnBg },
                ]}
              >
                <Rows2
                  size={12}
                  color={viewMode === "inline" ? textColor : mutedColor}
                  strokeWidth={1.8}
                />
              </Pressable>
              <Pressable
                onPress={() => setViewMode("split")}
                style={[
                  editStyles.viewToggleBtn,
                  viewMode === "split" && { backgroundColor: activeBtnBg },
                ]}
              >
                <Columns2
                  size={12}
                  color={viewMode === "split" ? textColor : mutedColor}
                  strokeWidth={1.8}
                />
              </Pressable>
            </View>
          </View>

          {baselineLabel ? (
            <View style={toolMetaStyles.banner}>
              <Text style={[toolMetaStyles.text, { color: mutedColor }]}>
                {baselineLabel}
              </Text>
            </View>
          ) : null}

          {canShowDiff && hasData ? (
            <ScrollView style={editStyles.scrollV} nestedScrollEnabled>
              {viewMode === "split" ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <SplitDiffView
                    rows={sideBySideRows}
                    containerWidth={containerWidth}
                    isDark={isDark}
                    removeBg={removeBg}
                    addBg={addBg}
                    emptyBg={emptyBg}
                    lineNoBg={lineNoBg}
                    lineNoColor={lineNoColor}
                    dividerColor={dividerColor}
                  />
                </ScrollView>
              ) : (
                <View>
                  {inlineRows.map((row, i) => {
                    const rowBg =
                      row.type === "added" ? addBg :
                      row.type === "removed" ? removeBg : undefined;
                    const prefix =
                      row.type === "added" ? "+" : row.type === "removed" ? "-" : " ";
                    const prefixColor =
                      row.type === "added" ? addColor :
                      isDark ? "#F85149" : "#CF222E";

                    return (
                      <View key={i} style={[editStyles.inlineRow, rowBg ? { backgroundColor: rowBg } : undefined]}>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                            {row.oldLineNo ?? ""}
                          </Text>
                        </View>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                            {row.newLineNo ?? ""}
                          </Text>
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
            <CodePreview
              rows={previewRows}
              isDark={isDark}
              lineNoBg={lineNoBg}
              lineNoColor={lineNoColor}
              rowBackgroundColor={addBg}
            />
          ) : (
            <View style={editStyles.pendingState}>
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>
                {baselineLabel ?? "Preparing diff..."}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function EditToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const isRunning = isToolCallActive(tc);
  const statusLabel = getToolStatusLabel(tc);
  const [expanded, setExpanded] = useState(isRunning);
  const diffViewMode = useAppSettingsStore((s) => s.diffViewMode);
  const updateSettings = useAppSettingsStore((s) => s.update);
  const viewMode = diffViewMode;
  const setViewMode = (mode: DiffViewMode) => updateSettings({ diffViewMode: mode });
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (isRunning) {
      setExpanded(true);
    }
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
      <Pressable style={styles.row} onPress={() => setExpanded((v) => !v)}>
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

      {expanded && (hasData || isRunning) && (
        <View
          style={[editStyles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          <View style={[editStyles.toolbar, { backgroundColor: toolbarBg, borderBottomColor: toolbarBorder }]}>
            <Text style={[editStyles.toolbarPath, { color: mutedColor }]} numberOfLines={1}>{path}</Text>
            <View style={editStyles.viewToggle}>
              <Pressable
                onPress={() => setViewMode("inline")}
                style={[
                  editStyles.viewToggleBtn,
                  viewMode === "inline" && { backgroundColor: activeBtnBg },
                ]}
              >
                <Rows2 size={12} color={viewMode === "inline" ? textColor : mutedColor} strokeWidth={1.8} />
              </Pressable>
              <Pressable
                onPress={() => setViewMode("split")}
                style={[
                  editStyles.viewToggleBtn,
                  viewMode === "split" && { backgroundColor: activeBtnBg },
                ]}
              >
                <Columns2 size={12} color={viewMode === "split" ? textColor : mutedColor} strokeWidth={1.8} />
              </Pressable>
            </View>
          </View>

          {hasData ? (
            <ScrollView style={editStyles.scrollV} nestedScrollEnabled>
              {viewMode === "split" ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <SplitDiffView
                    rows={sideBySideRows}
                    containerWidth={containerWidth}
                    isDark={isDark}
                    removeBg={removeBg}
                    addBg={addBg}
                    emptyBg={emptyBg}
                    lineNoBg={lineNoBg}
                    lineNoColor={lineNoColor}
                    dividerColor={dividerColor}
                  />
                </ScrollView>
              ) : (
                <View>
                  {inlineRows.map((row, i) => {
                    const rowBg =
                      row.type === "added" ? addBg :
                      row.type === "removed" ? removeBg : undefined;
                    const prefix =
                      row.type === "added" ? "+" : row.type === "removed" ? "-" : " ";
                    const prefixColor =
                      row.type === "added" ? addColor :
                      row.type === "removed" ? removeColor : mutedColor;

                    return (
                      <View key={i} style={[editStyles.inlineRow, rowBg ? { backgroundColor: rowBg } : undefined]}>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                            {row.oldLineNo ?? ""}
                          </Text>
                        </View>
                        <View style={[editStyles.lineNoCol, { backgroundColor: lineNoBg }]}>
                          <Text style={[editStyles.lineNo, { color: lineNoColor }]}>
                            {row.newLineNo ?? ""}
                          </Text>
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
              <Text style={[editStyles.pendingText, { color: mutedColor }]}>
                {statusLabel ?? "Preparing diff..."}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const editStyles = StyleSheet.create({
  box: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 0.633,
  },
  toolbarPath: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    flex: 1,
    marginRight: 8,
  },
  viewToggle: {
    flexDirection: "row",
    borderRadius: 4,
    overflow: "hidden",
    gap: 2,
  },
  viewToggleBtn: {
    width: 24,
    height: 20,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollV: {
    maxHeight: 400,
  },
  pendingState: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  pendingText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  table: {
    minWidth: "100%",
  },
  tableRow: {
    flexDirection: "row",
    minHeight: 22,
  },
  half: {
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  divider: {
    width: 1,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 22,
  },
  prefix: {
    width: 16,
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 22,
    textAlign: "center",
  },
  lineNoCol: {
    width: 32,
    paddingHorizontal: 4,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  lineNo: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    lineHeight: 22,
  },
  lineText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 22,
    paddingHorizontal: 8,
    flex: 1,
  },
});

const codeStyles = StyleSheet.create({
  table: {
    minWidth: "100%",
  },
  row: {
    flexDirection: "row",
    minHeight: 22,
  },
  lineNoCol: {
    width: 56,
    paddingHorizontal: 6,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});

const toolMetaStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  banner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(127,127,127,0.2)",
  },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(127,127,127,0.2)",
  },
  text: {
    fontSize: 11,
    fontFamily: Fonts.sans,
  },
});

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
    // Match lines like "Read file.tsx", "$ command", "Edit file.ts +3 -2", "Wrote file.ts"
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

function SubagentToolCall({ tc }: { tc: ToolCallInfo }) {
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

  const toggle = useCallback(() => setExpanded((v) => !v), []);

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
                <Text
                  style={[subagentStyles.streamingText, { color: isDark ? "#999" : "#555" }]}
                >
                  {output.length > 3000
                    ? "…" + output.slice(output.length - 3000)
                    : output}
                </Text>
              </ScrollView>
              <View style={[subagentStyles.shimmerOverlay]}>
                <ShimmerLine width="40%" isDark={isDark} delay={0} />
              </View>
            </View>
          )}

          {isComplete && steps.length > 0 && (
            <View style={subagentStyles.stepsWrap}>
              {steps.map((step, i) => (
                <View key={i} style={[subagentStyles.stepRow, { backgroundColor: stepBg }]}>
                  <Text style={[subagentStyles.stepVerb, { color: textColor }]}>
                    {step.tool}
                  </Text>
                  <Text
                    style={[subagentStyles.stepDetail, { color: mutedColor }]}
                    numberOfLines={1}
                  >
                    {step.detail}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {isComplete && output && (
            <ScrollView style={subagentStyles.scroll} nestedScrollEnabled>
              <Text
                style={[subagentStyles.output, {
                  color: tc.isError
                    ? (isDark ? "#F85149" : "#CF222E")
                    : (isDark ? "#8B8B8B" : "#555"),
                }]}
                selectable
              >
                {output.length > 5000
                  ? output.slice(0, 5000) + "\n… truncated"
                  : output}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const subagentStyles = StyleSheet.create({
  box: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden",
  },
  taskRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 0.633,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  taskLabel: {
    fontSize: 10,
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  taskText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    lineHeight: 18,
  },
  spinner: {
    marginLeft: 4,
    transform: [{ scale: 0.7 }],
  },
  shimmerWrap: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 8,
  },
  shimmerLine: {
    height: 8,
    borderRadius: 4,
  },
  shimmerOverlay: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  streamingWrap: {
    overflow: "hidden",
  },
  streamingText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 18,
  },
  stepsWrap: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 6,
  },
  stepVerb: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
    fontWeight: "bold",
  },
  stepDetail: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    flex: 1,
  },
  scroll: {
    maxHeight: 400,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  output: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    lineHeight: 18,
  },
});

function SingleToolCall({ tc }: { tc: ToolCallInfo }) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [expanded, setExpanded] = useState(false);

  if (tc.name === "bash") {
    return <BashToolCall tc={tc} />;
  }
  if (tc.name === "read") {
    return <ReadToolCall tc={tc} />;
  }
  if (tc.name === "write") {
    return <WriteToolCall tc={tc} />;
  }
  if (tc.name === "edit") {
    return <EditToolCall tc={tc} />;
  }
  if (tc.name === "subagent") {
    return <SubagentToolCall tc={tc} />;
  }

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
        onPress={() => output && setExpanded((v) => !v)}
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
        <View style={styles.expandedOutput}>
          <Text
            style={[
              styles.outputText,
              {
                color: tc.isError
                  ? colors.destructive
                  : isDark
                    ? "#555"
                    : "#888",
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
  const groupStatusLabel = activeCall
    ? getToolStatusLabel(activeCall)
    : null;

  useEffect(() => {
    if (groupStatusLabel) {
      setExpanded(true);
    }
  }, [groupStatusLabel]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const groupParts = multiGroupLabelParts(toolName, calls.length);

  if (calls.length === 1) {
    return <SingleToolCall tc={calls[0]} />;
  }

  return (
    <View>
      <Pressable style={styles.row} onPress={toggle}>
        <View style={styles.animatedLabelRow}>
          {groupParts.before ? (
            <Text style={[styles.label, { color: textColor }]}>{groupParts.before}</Text>
          ) : null}
          <AnimatedNumber
            value={calls.length}
            style={[styles.label, { color: textColor }]}
          />
          {groupParts.after ? (
            <Text style={[styles.label, { color: textColor }]}>{groupParts.after}</Text>
          ) : null}
          {groupStatusLabel ? (
            <Text style={[styles.status, { color: isDark ? "#888" : "#888" }]}>
              {" "}
              {groupStatusLabel}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.expandedList}>
          {calls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
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

export interface ToolCallRenderItem {
  key: string;
  toolName: string;
  calls: ToolCallInfo[];
}

const NEVER_GROUP = new Set(["bash", "read", "write", "edit"]);

export function groupToolCalls(
  toolCalls: ToolCallInfo[],
): ToolCallRenderItem[] {
  if (toolCalls.length === 0) return [];

  const result: ToolCallRenderItem[] = [];
  const pending = new Map<string, ToolCallRenderItem>();

  for (const tc of toolCalls) {
    if (NEVER_GROUP.has(tc.name)) {
      result.push({
        key: `single-${tc.id}`,
        toolName: tc.name,
        calls: [tc],
      });
    } else {
      const existing = pending.get(tc.name);
      if (existing) {
        existing.calls.push(tc);
      } else {
        const item: ToolCallRenderItem = {
          key: `group-${tc.id}`,
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

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
    fontWeight: "bold",
  },
  animatedLabelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  singleLine: {
    fontSize: 13,
    flexShrink: 1,
  },
  verb: {
    fontFamily: Fonts.sansBold,
    fontWeight: "bold",
    fontSize: 13,
  },
  detail: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  diff: {
    fontFamily: Fonts.sansMedium,
    fontWeight: "500",
    fontSize: 12,
  },
  status: {
    fontFamily: Fonts.sans,
    fontSize: 12,
  },
  expandedList: {
    paddingLeft: 8,
    paddingTop: 6,
    gap: 4,
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
