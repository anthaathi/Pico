import { useMemo, useRef, useState, useEffect, type JSX } from "react";
import { lexer, type Token } from "marked";
import type { useMarkdownHookOptions } from "react-native-marked";
import { Renderer } from "react-native-marked";
import type { ReactNode } from "react";

interface ParserLike {
  parse(tokens?: Token[]): ReactNode[];
}

interface ParserConstructor {
  new (options: {
    styles: Record<string, unknown>;
    baseUrl?: string;
    renderer: Renderer;
  }): ParserLike;
}

let CachedParserClass: ParserConstructor | null = null;

function getParserClass(): ParserConstructor {
  if (!CachedParserClass) {
    // Parser is not re-exported from the public API — load from dist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-marked/dist/commonjs/lib/Parser");
    CachedParserClass = (mod.default ?? mod) as ParserConstructor;
  }
  return CachedParserClass;
}

// Mirrors react-native-marked's internal style builder so we avoid importing
// private module paths for styles.
import { StyleSheet } from "react-native";

const THEME_COLORS = {
  light: {
    background: "#ffffff",
    code: "#f6f8fa",
    link: "#0366d6",
    text: "#000000",
    border: "#e1e4e8",
  },
  dark: {
    background: "#0d1117",
    code: "#161b22",
    link: "#58a6ff",
    text: "#c9d1d9",
    border: "#30363d",
  },
} as const;

const DEFAULT_SPACING = { xs: 2, s: 4, m: 8, l: 12 } as const;

function buildStyles(
  userStyles: useMarkdownHookOptions["styles"],
  colorScheme: useMarkdownHookOptions["colorScheme"],
  userTheme: useMarkdownHookOptions["theme"],
): Record<string, unknown> {
  const scheme = colorScheme === "dark" ? "dark" : "light";
  const mdColors = { ...THEME_COLORS[scheme], ...userTheme?.colors };
  const mdSpacing = { ...DEFAULT_SPACING, ...userTheme?.spacing };

  const fontRegular = { fontSize: 16, lineHeight: 24, color: mdColors.text };
  const fontHeading = { fontWeight: "500" as const, color: mdColors.text };

  return StyleSheet.create({
    em: StyleSheet.flatten([fontRegular, { fontStyle: "italic" as const }, userStyles?.em]) ?? {},
    strong: StyleSheet.flatten([fontRegular, { fontWeight: "bold" as const }, userStyles?.strong]) ?? {},
    strikethrough: StyleSheet.flatten([
      fontRegular,
      { textDecorationLine: "line-through" as const, textDecorationStyle: "solid" as const },
      userStyles?.strikethrough,
    ]) ?? {},
    text: StyleSheet.flatten([fontRegular, userStyles?.text]) ?? {},
    paragraph: StyleSheet.flatten([{ paddingVertical: mdSpacing.m }, userStyles?.paragraph]) ?? {},
    link: StyleSheet.flatten([
      fontRegular,
      { fontStyle: "italic" as const, color: mdColors.link },
      userStyles?.link,
    ]) ?? {},
    blockquote: StyleSheet.flatten([
      {
        borderLeftColor: mdColors.border,
        paddingLeft: mdSpacing.l,
        borderLeftWidth: mdSpacing.s,
        opacity: 0.8,
      },
      userStyles?.blockquote,
    ]) ?? {},
    h1: StyleSheet.flatten([
      fontHeading,
      {
        fontSize: 32, lineHeight: 40, fontWeight: "bold" as const,
        marginVertical: mdSpacing.m, letterSpacing: 0,
        paddingBottom: mdSpacing.s, borderBottomColor: mdColors.border, borderBottomWidth: 1,
      },
      userStyles?.h1,
    ]) ?? {},
    h2: StyleSheet.flatten([
      fontHeading,
      {
        fontSize: 28, lineHeight: 36, marginVertical: mdSpacing.m,
        paddingBottom: mdSpacing.s, borderBottomColor: mdColors.border, borderBottomWidth: 1,
      },
      userStyles?.h2,
    ]) ?? {},
    h3: StyleSheet.flatten([
      fontHeading,
      { fontSize: 24, lineHeight: 32, marginVertical: mdSpacing.s },
      userStyles?.h3,
    ]) ?? {},
    h4: StyleSheet.flatten([
      fontHeading,
      { fontSize: 22, lineHeight: 28, marginVertical: mdSpacing.s },
      userStyles?.h4,
    ]) ?? {},
    h5: StyleSheet.flatten([fontRegular, fontHeading, { marginVertical: mdSpacing.xs }, userStyles?.h5]) ?? {},
    h6: StyleSheet.flatten([
      fontHeading,
      { fontSize: 14, lineHeight: 20, marginVertical: mdSpacing.xs },
      userStyles?.h6,
    ]) ?? {},
    codespan: StyleSheet.flatten([
      fontRegular,
      { fontStyle: "italic" as const, backgroundColor: mdColors.code, fontWeight: "300" as const },
      userStyles?.codespan,
    ]) ?? {},
    code: StyleSheet.flatten([
      { padding: mdSpacing.l, backgroundColor: mdColors.code, minWidth: "100%" as const },
      userStyles?.code,
    ]) ?? {},
    hr: StyleSheet.flatten([
      { borderBottomWidth: 1, borderBottomColor: mdColors.border, marginVertical: mdSpacing.s },
      userStyles?.hr,
    ]) ?? {},
    list: StyleSheet.flatten([userStyles?.list]) ?? {},
    li: StyleSheet.flatten([fontRegular, { flexShrink: 1 }, userStyles?.li]) ?? {},
    image: StyleSheet.flatten([{ resizeMode: "cover" as const }, userStyles?.image]) ?? {},
    table: StyleSheet.flatten([{ borderWidth: 1, borderColor: mdColors.border }, userStyles?.table]) ?? {},
    tableRow: StyleSheet.flatten([{ flexDirection: "row" as const }, userStyles?.tableRow]) ?? {},
    tableCell: StyleSheet.flatten([{ padding: mdSpacing.s }, userStyles?.tableCell]) ?? {},
  });
}

const STREAMING_THROTTLE_MS = 100;

/**
 * A drop-in replacement for `useMarkdown` from react-native-marked that:
 *
 * 1. **Resets the Renderer's internal slugger before every parse** so React
 *    keys are deterministic across re-renders (the stock hook lets the slugger
 *    accumulate, producing new keys on every parse → full unmount/remount).
 *
 * 2. **Throttles text updates while streaming** so the expensive markdown
 *    lexer + parser only runs at most once every STREAMING_THROTTLE_MS
 *    instead of on every single text delta (10-50 per second).
 */
export function useStableMarkdown(
  text: string,
  options: useMarkdownHookOptions,
  isStreaming?: boolean,
): JSX.Element[] {
  const textRef = useRef(text);
  textRef.current = text;

  const [throttledText, setThrottledText] = useState(text);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = false;
      setThrottledText(text);
      return;
    }

    if (timerRef.current) {
      pendingRef.current = true;
      return;
    }

    setThrottledText(text);

    timerRef.current = setTimeout(function tick() {
      timerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current = false;
        setThrottledText(textRef.current);
        timerRef.current = setTimeout(tick, STREAMING_THROTTLE_MS);
      }
    }, STREAMING_THROTTLE_MS);
  }, [text, isStreaming]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // --- Markdown parsing with stable keys ------------------------------------
  const styles = useMemo(
    () => buildStyles(options.styles, options.colorScheme, options.theme),
    [options.styles, options.colorScheme, options.theme],
  );

  const Parser = getParserClass();

  const elements = useMemo(() => {
    const renderer = new Renderer();
    const parser = new Parser({ styles, baseUrl: options.baseUrl, renderer });
    const tokens = lexer(throttledText, {
      gfm: true,
      tokenizer: options.tokenizer,
    });
    return parser.parse(tokens) as JSX.Element[];
  }, [throttledText, styles, options.baseUrl, options.tokenizer, Parser]);

  return elements;
}
