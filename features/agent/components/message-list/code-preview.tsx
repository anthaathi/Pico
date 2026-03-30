import { memo, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";

interface CodePreviewProps {
  code: string;
  isDark: boolean;
  maxHeight?: number;
  startLine?: number;
  language?: string;
  diffLanguage?: string;
  showLineNumbers?: boolean;
}

type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "property"
  | "punctuation"
  | "diffAdd"
  | "diffRemove"
  | "diffMeta";

interface Segment {
  text: string;
  kind: TokenKind;
}

const JS_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "class",
  "extends",
  "import",
  "from",
  "export",
  "default",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "instanceof",
  "in",
  "of",
  "interface",
  "type",
  "implements",
  "public",
  "private",
  "protected",
  "readonly",
]);

const PY_KEYWORDS = new Set([
  "def",
  "class",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "try",
  "except",
  "finally",
  "raise",
  "import",
  "from",
  "as",
  "with",
  "pass",
  "break",
  "continue",
  "lambda",
  "yield",
  "True",
  "False",
  "None",
  "and",
  "or",
  "not",
  "in",
  "is",
]);

const BASH_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "fi",
  "for",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "local",
  "export",
  "echo",
  "cd",
  "cat",
  "grep",
  "find",
  "rg",
  "yarn",
  "npm",
  "node",
  "bash",
  "sh",
  "git",
  "curl",
  "mkdir",
  "rm",
  "mv",
  "cp",
]);

function normalizeLanguage(language?: string): string {
  return (language || "").toLowerCase().trim();
}

function createTokenColors(isDark: boolean) {
  return {
    plain: isDark ? "#D4D4D4" : "#24292E",
    keyword: isDark ? "#C792EA" : "#6F42C1",
    string: isDark ? "#C3E88D" : "#0B6E4F",
    number: isDark ? "#F78C6C" : "#B75501",
    comment: isDark ? "#6A9955" : "#6A737D",
    operator: isDark ? "#89DDFF" : "#005CC5",
    property: isDark ? "#82AAFF" : "#005CC5",
    punctuation: isDark ? "#89DDFF" : "#586069",
    diffAdd: isDark ? "#3FB950" : "#1A7F37",
    diffRemove: isDark ? "#F85149" : "#CF222E",
    diffMeta: isDark ? "#D2A8FF" : "#8250DF",
  } satisfies Record<TokenKind, string>;
}

function tokenizeGeneric(line: string): Segment[] {
  return [{ text: line || " ", kind: "plain" }];
}

function tintSegments(segments: Segment[], kind: TokenKind): Segment[] {
  return segments.map((segment) =>
    segment.kind === "plain" || segment.kind === "punctuation" ? { ...segment, kind } : segment,
  );
}

function tokenizeDiff(line: string, diffLanguage?: string): Segment[] {
  if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) {
    return [{ text: line || " ", kind: "diffMeta" }];
  }
  if (line.startsWith("+")) {
    return [{ text: "+", kind: "diffAdd" }, ...tintSegments(tokenizeLine(line.slice(1), diffLanguage), "diffAdd")];
  }
  if (line.startsWith("-")) {
    return [{ text: "-", kind: "diffRemove" }, ...tintSegments(tokenizeLine(line.slice(1), diffLanguage), "diffRemove")];
  }
  if (line.startsWith(" ")) {
    return [{ text: " ", kind: "plain" }, ...tokenizeLine(line.slice(1), diffLanguage)];
  }
  return tokenizeGeneric(line);
}

function tokenizeWithPattern(line: string, pattern: RegExp, classify: (value: string) => TokenKind): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), kind: "plain" });
    }
    const value = match[0];
    segments.push({ text: value, kind: classify(value) });
    lastIndex = match.index + value.length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), kind: "plain" });
  }

  return segments.length ? segments : [{ text: line || " ", kind: "plain" }];
}

function tokenizeJsLike(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\s*:)\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,:;]+)/g,
    (value) => {
      if (value.startsWith("//")) return "comment";
      if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) return "string";
      if (/^\d/.test(value)) return "number";
      if (/^[{}()[\].,:;]+$/.test(value)) return "punctuation";
      if (JS_KEYWORDS.has(value)) return "keyword";
      if (/^[A-Za-z_$][\w$]*$/.test(value)) return "property";
      return "plain";
    },
  );
}

function tokenizeJson(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /("(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:])/g,
    (value) => {
      if (/^".*"$/.test(value)) return "string";
      if (/^\d/.test(value)) return "number";
      if (/^(true|false|null)$/.test(value)) return "keyword";
      return "punctuation";
    },
  );
}

function tokenizePython(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /(#.*$|""".*|''' .*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b|[=:+\-*/%<>!]+|[{}()[\].,:;]+)/g,
    (value) => {
      if (value.startsWith("#")) return "comment";
      if (value.startsWith('"') || value.startsWith("'")) return "string";
      if (/^\d/.test(value)) return "number";
      if (/^[=:+\-*/%<>!]+$/.test(value)) return "operator";
      if (/^[{}()[\].,:;]+$/.test(value)) return "punctuation";
      if (PY_KEYWORDS.has(value)) return "keyword";
      return "property";
    },
  );
}

function tokenizeBash(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /(#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\$\{?\w+\}?|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w-]*\b|[|&><=]+|[{}()[\].,:;]+)/g,
    (value) => {
      if (value.startsWith("#")) return "comment";
      if (value.startsWith('"') || value.startsWith("'")) return "string";
      if (value.startsWith("$")) return "property";
      if (/^\d/.test(value)) return "number";
      if (/^[|&><=]+$/.test(value)) return "operator";
      if (/^[{}()[\].,:;]+$/.test(value)) return "punctuation";
      if (BASH_KEYWORDS.has(value)) return "keyword";
      return "plain";
    },
  );
}

function tokenizeYaml(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /(#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|\b[A-Za-z0-9_.-]+(?=\s*:)|[{}\[\],:-])/g,
    (value) => {
      if (value.startsWith("#")) return "comment";
      if (value.startsWith('"') || value.startsWith("'")) return "string";
      if (/^\d/.test(value)) return "number";
      if (/^(true|false|null)$/.test(value)) return "keyword";
      if (/^[A-Za-z0-9_.-]+$/.test(value)) return "property";
      return "punctuation";
    },
  );
}

function tokenizeMarkup(line: string): Segment[] {
  return tokenizeWithPattern(
    line,
    /(<!--[\s\S]*?-->|<\/?|\/?>|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[A-Za-z_:][\w:.-]*(?==)|\b[A-Za-z][\w:-]*\b|=)/g,
    (value) => {
      if (value.startsWith("<!--")) return "comment";
      if (value === "<" || value === "</" || value === ">" || value === "/>" ) return "punctuation";
      if (value === "=") return "operator";
      if (value.startsWith('"') || value.startsWith("'")) return "string";
      if (/^[A-Za-z_:][\w:.-]*(?==)$/.test(value)) return "property";
      if (/^[A-Za-z][\w:-]*$/.test(value)) return "keyword";
      return "plain";
    },
  );
}

function tokenizeLine(line: string, language?: string, diffLanguage?: string): Segment[] {
  const lang = normalizeLanguage(language);

  if (["ts", "tsx", "js", "jsx", "typescript", "javascript"].includes(lang)) {
    return tokenizeJsLike(line);
  }
  if (lang === "json") return tokenizeJson(line);
  if (["py", "python"].includes(lang)) return tokenizePython(line);
  if (["bash", "sh", "shell", "zsh"].includes(lang)) return tokenizeBash(line);
  if (["yaml", "yml"].includes(lang)) return tokenizeYaml(line);
  if (["html", "htm", "xml", "xhtml", "svg"].includes(lang)) return tokenizeMarkup(line);
  if (["diff", "patch"].includes(lang)) return tokenizeDiff(line, diffLanguage);
  return tokenizeGeneric(line);
}

export const CodePreview = memo(function CodePreview({
  code,
  isDark,
  maxHeight,
  startLine = 1,
  language,
  diffLanguage,
  showLineNumbers = true,
}: CodePreviewProps) {
  const colors = isDark ? Colors.dark : Colors.light;
  const tokenColors = useMemo(() => createTokenColors(isDark), [isDark]);
  const lines = useMemo(() => code.split("\n"), [code]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
      <ScrollView
        style={maxHeight ? { maxHeight } : undefined}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {lines.map((line, i) => {
              const segments = tokenizeLine(line, language, diffLanguage);
              return (
                <View key={i} style={styles.row}>
                  {showLineNumbers ? (
                    <View style={[styles.lineNoCol, { borderRightColor: colors.border }]}> 
                      <Text style={[styles.lineNo, { color: colors.textTertiary }]}> 
                        {startLine + i}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={[styles.lineText, !showLineNumbers && styles.lineTextNoGutter, { color: tokenColors.plain }]}>
                    {segments.length ? segments.map((segment, idx) => (
                      <Text key={`${i}-${idx}`} style={{ color: tokenColors[segment.kind] }}>
                        {segment.text || (idx === 0 ? " " : "")}
                      </Text>
                    )) : " "}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 6,
    borderWidth: 0.5,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    minHeight: 20,
  },
  lineNoCol: {
    width: 40,
    alignItems: "flex-end",
    paddingRight: 8,
    paddingVertical: 1,
    borderRightWidth: 0.5,
  },
  lineNo: {
    fontSize: 11,
    lineHeight: 20,
    fontFamily: Fonts.mono,
  },
  lineText: {
    fontSize: 12,
    lineHeight: 20,
    fontFamily: Fonts.mono,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  lineTextNoGutter: {
    paddingLeft: 10,
  },
});
