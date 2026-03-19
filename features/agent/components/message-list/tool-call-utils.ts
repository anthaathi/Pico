import type { ToolCallInfo } from "../../types";

type ParsedToolArguments = {
  path?: string;
  command?: string;
  oldText?: string;
  newText?: string;
  content?: string;
  offset?: number;
  limit?: number;
};

const TOOL_STATUS_LABELS: Record<string, string> = {
  read: "Reading...",
  edit: "Editing...",
  write: "Writing...",
  bash: "Running...",
  python: "Running...",
  search: "Searching...",
  scrape: "Scraping...",
  crawl: "Crawling...",
  subagent: "Running...",
};

function decodeEscapedChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    default:
      return char;
  }
}

function extractPartialJsonStringField(
  raw: string,
  fieldName: string,
): string | undefined {
  const keyToken = `"${fieldName}"`;
  const keyIndex = raw.indexOf(keyToken);
  if (keyIndex === -1) return undefined;

  const colonIndex = raw.indexOf(":", keyIndex + keyToken.length);
  if (colonIndex === -1) return undefined;

  let cursor = colonIndex + 1;
  while (cursor < raw.length && /\s/.test(raw[cursor]!)) {
    cursor += 1;
  }

  if (raw[cursor] !== '"') return undefined;
  cursor += 1;

  let result = "";
  let escaping = false;

  while (cursor < raw.length) {
    const char = raw[cursor]!;
    if (escaping) {
      result += decodeEscapedChar(char);
      escaping = false;
      cursor += 1;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      cursor += 1;
      continue;
    }

    if (char === '"') {
      return result;
    }

    result += char;
    cursor += 1;
  }

  return result || undefined;
}

function extractPartialJsonNumberField(
  raw: string,
  fieldName: string,
): number | undefined {
  const match = raw.match(new RegExp(`"${fieldName}"\\s*:\\s*(-?\\d+)`));
  if (!match) return undefined;

  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseToolArguments(rawArgs: string): ParsedToolArguments {
  if (!rawArgs.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return {
      path: typeof parsed.path === "string" ? parsed.path : undefined,
      command:
        typeof parsed.command === "string" ? parsed.command : undefined,
      oldText:
        typeof parsed.oldText === "string" ? parsed.oldText : undefined,
      newText:
        typeof parsed.newText === "string" ? parsed.newText : undefined,
      content:
        typeof parsed.content === "string" ? parsed.content : undefined,
      offset:
        typeof parsed.offset === "number" ? parsed.offset : undefined,
      limit: typeof parsed.limit === "number" ? parsed.limit : undefined,
    };
  } catch {
    return {
      path: extractPartialJsonStringField(rawArgs, "path"),
      command: extractPartialJsonStringField(rawArgs, "command"),
      oldText: extractPartialJsonStringField(rawArgs, "oldText"),
      newText: extractPartialJsonStringField(rawArgs, "newText"),
      content: extractPartialJsonStringField(rawArgs, "content"),
      offset: extractPartialJsonNumberField(rawArgs, "offset"),
      limit: extractPartialJsonNumberField(rawArgs, "limit"),
    };
  }
}

export function isToolCallActive(
  toolCall: Pick<ToolCallInfo, "status">,
): boolean {
  return (
    toolCall.status === "streaming" ||
    toolCall.status === "pending" ||
    toolCall.status === "running"
  );
}

export function getToolStatusLabel(
  toolCall: Pick<ToolCallInfo, "name" | "status">,
): string | null {
  if (!isToolCallActive(toolCall)) {
    return null;
  }

  return TOOL_STATUS_LABELS[toolCall.name] ?? "Running...";
}
