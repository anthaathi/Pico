import type { ToolCallInfo } from "../../types";

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const partial: Record<string, unknown> = {};
    const pathMatch = raw.match(/"path"\s*:\s*"([^"]*)/);
    if (pathMatch) partial.path = pathMatch[1];
    const cmdMatch = raw.match(/"command"\s*:\s*"([^"]*)/);
    if (cmdMatch) partial.command = cmdMatch[1];
    const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]*)/);
    if (contentMatch) partial.content = contentMatch[1];
    const oldTextMatch = raw.match(/"oldText"\s*:\s*"([\s\S]*?)(?:"\s*,|\s*$)/);
    if (oldTextMatch) partial.oldText = oldTextMatch[1];
    const newTextMatch = raw.match(/"newText"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|\s*$)/);
    if (newTextMatch) partial.newText = newTextMatch[1];
    const queryMatch = raw.match(/"query"\s*:\s*"([^"]*)/);
    if (queryMatch) partial.query = queryMatch[1];
    const urlMatch = raw.match(/"url"\s*:\s*"([^"]*)/);
    if (urlMatch) partial.url = urlMatch[1];
    const agentMatch = raw.match(/"agent"\s*:\s*"([^"]*)/);
    if (agentMatch) partial.agent = agentMatch[1];
    const taskMatch = raw.match(/"task"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|\s*$)/);
    if (taskMatch) partial.task = taskMatch[1];
    return partial;
  }
}

export function isToolActive(tc: ToolCallInfo): boolean {
  return tc.status === "streaming" || tc.status === "pending" || tc.status === "running";
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function truncateOutput(text: string, maxLines = 50): { text: string; truncated: boolean } {
  if (!text) return { text: "", truncated: false };
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, truncated: false };
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
}

export function toolDisplayName(name: string): string {
  switch (name) {
    case "bash": return "Terminal";
    case "read": return "Read";
    case "write": return "Write";
    case "edit": return "Edit";
    case "search": return "Search";
    case "scrape": return "Scrape";
    case "crawl": return "Crawl";
    case "subagent": return "Agent";
    case "questionnaire": return "Question";
    case "download": return "Download";
    default: return name;
  }
}
