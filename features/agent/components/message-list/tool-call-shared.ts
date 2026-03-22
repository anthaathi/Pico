import { LayoutAnimation, Platform, StyleSheet } from "react-native";
import { Fonts } from "@/constants/theme";
import { parseToolArguments } from "./tool-call-utils";
import type { ToolCallInfo } from "../../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_VISIBLE_GROUP_ITEMS = 5;

export const SINGLE_VERB: Record<string, string> = {
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

export const MULTI_GROUP_PARTS: Record<string, { before: string; after: string }> = {
  read: { before: "Explored ", after: " files" },
  edit: { before: "Edited ", after: " files" },
  write: { before: "Wrote ", after: " files" },
  bash: { before: "Ran ", after: " commands" },
  python: { before: "Ran Python ", after: " times" },
  search: { before: "", after: " web searches" },
  scrape: { before: "Scraped ", after: " pages" },
  crawl: { before: "Crawled ", after: " sites" },
  subagent: { before: "Ran ", after: " sub-agents" },
};

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const EXPAND_ANIM = LayoutAnimation.create(
  200,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

export function animateLayout() {
  if (Platform.OS !== "web") {
    LayoutAnimation.configureNext(EXPAND_ANIM);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

export function multiGroupLabelParts(
  toolName: string,
  _count: number,
): { before: string; after: string } {
  return MULTI_GROUP_PARTS[toolName] ?? { before: "", after: `× ${toolName}` };
}

export function formatSingleCall(tc: ToolCallInfo): {
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

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

export const sharedStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    gap: 6,
  },
  singleLine: {
    fontSize: 13,
    flexShrink: 1,
  },
  verb: {
    fontFamily: Fonts.sansSemiBold,
    fontWeight: "600",
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
});
