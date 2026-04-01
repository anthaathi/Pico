import type { ChatMessage, ToolCallInfo, ToolResultImage, MessageUsageInfo, AgentMode, PendingExtensionUiRequest, SubagentMeta } from "../types/chat-message";
import type { AgentStreamEvent, AgentStateData, StreamEventEnvelope } from "../types/stream-events";

export interface SessionState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isReady: boolean;
  isLoading: boolean;
  isLoadingOlderMessages: boolean;
  hasMoreMessages: boolean;
  oldestEntryId: string | null;
  mode: AgentMode;
  pendingExtensionUiRequest: PendingExtensionUiRequest | null;
  agentState: AgentStateData | null;
}

export function createEmptySessionState(): SessionState {
  return {
    messages: [],
    isStreaming: false,
    isReady: false,
    agentState: null,
    isLoading: false,
    isLoadingOlderMessages: false,
    hasMoreMessages: false,
    oldestEntryId: null,
    mode: "chat",
    pendingExtensionUiRequest: null,
  };
}

function extractTextFromContent(content: unknown[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: string; text: string } =>
      typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "text",
    )
    .map((c) => c.text ?? "")
    .join("");
}

function extractImagesFromContent(content: unknown[] | undefined): ToolResultImage[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .filter((c): c is { type: string; data: string; mimeType: string } =>
      typeof c === "object" &&
      c !== null &&
      "type" in c &&
      (c as { type: string }).type === "image" &&
      "data" in c &&
      typeof (c as { data: unknown }).data === "string",
    )
    .map((c) => ({ data: c.data, mimeType: c.mimeType ?? "image/png" }));
  return images.length > 0 ? images : undefined;
}

function extractMessageEntryId(msg: Record<string, unknown>): string | undefined {
  const rawId = msg["entryId"] ?? msg["entry_id"] ?? msg["id"] ?? msg["messageId"];
  if (typeof rawId === "string" && rawId.trim()) return rawId;
  if (typeof rawId === "number" && Number.isFinite(rawId)) return String(rawId);
  return undefined;
}

function isModeSlashCommand(message: string): boolean {
  const first = message.trim().split(/\s+/)[0];
  return first === "/chat" || first === "/plan";
}

const CLEAR_PENDING_EVENTS = new Set([
  "turn_start", "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "turn_end", "agent_end", "session_process_exited",
]);

function stampTurnEndFromBackend(
  messages: ChatMessage[],
  stats: { filesEdited?: number; filesCreated?: number; linesAdded?: number; linesRemoved?: number; durationMs?: number },
): ChatMessage[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx === -1) return messages;
  const msg = messages[lastAssistantIdx]!;
  if (msg.turnDurationMs !== undefined) return messages;

  const hasFileStats = (stats.filesEdited ?? 0) > 0 || (stats.filesCreated ?? 0) > 0;
  const next = [...messages];
  next[lastAssistantIdx] = {
    ...msg,
    turnDurationMs: stats.durationMs ?? 0,
    turnFileStats: hasFileStats
      ? { filesEdited: stats.filesEdited ?? 0, filesCreated: stats.filesCreated ?? 0, linesAdded: stats.linesAdded ?? 0, linesRemoved: stats.linesRemoved ?? 0 }
      : undefined,
  };
  return next;
}

function findLastStreamingIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant" && messages[i]!.isStreaming) return i;
  }
  return -1;
}

function updateLastStreaming(messages: ChatMessage[], updater: (msg: ChatMessage) => ChatMessage): ChatMessage[] {
  const idx = findLastStreamingIndex(messages);
  if (idx === -1) return messages;
  const next = [...messages];
  next[idx] = updater(messages[idx]!);
  return next;
}

function extractSubagentMeta(details: unknown): SubagentMeta | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  const results = Array.isArray(d["results"]) ? d["results"] as Record<string, unknown>[] : [];
  const first = results[0];
  if (!first) return undefined;
  const usage = first["usage"] as Record<string, unknown> | undefined;
  const summary = first["progressSummary"] as Record<string, unknown> | undefined;
  const meta: SubagentMeta = {};
  if (typeof first["model"] === "string") meta.model = first["model"] as string;
  if (usage) {
    if (typeof usage["cost"] === "number") meta.cost = usage["cost"] as number;
    if (typeof usage["turns"] === "number") meta.turns = usage["turns"] as number;
  }
  if (summary) {
    if (typeof summary["toolCount"] === "number") meta.toolCount = summary["toolCount"] as number;
    if (typeof summary["tokens"] === "number") meta.tokens = summary["tokens"] as number;
    if (typeof summary["durationMs"] === "number") meta.durationMs = summary["durationMs"] as number;
  }
  if (!meta.model && !meta.cost && !meta.toolCount) return undefined;
  return meta;
}

function stringifyToolArguments(argumentsValue: unknown): string {
  if (typeof argumentsValue === "string") return argumentsValue;
  return JSON.stringify(argumentsValue ?? {});
}

function findToolCallIndex(toolCalls: ToolCallInfo[], contentIndex?: number): number {
  if (typeof contentIndex === "number") {
    const exact = toolCalls.findIndex((tc) => tc.contentIndex === contentIndex);
    if (exact !== -1) return exact;
  }
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (toolCalls[i]?.status === "streaming") return i;
  }
  return toolCalls.length - 1;
}

function buildToolCallsFromContent(
  content: Record<string, unknown>[],
  previousToolCalls: ToolCallInfo[] | undefined,
  defaultStatus: ToolCallInfo["status"],
): ToolCallInfo[] {
  const nextToolCalls: ToolCallInfo[] = [];

  for (const [contentIndex, block] of content.entries()) {
    if (block["type"] !== "toolCall") continue;

    const id = typeof block["id"] === "string" ? block["id"] : `tc-${contentIndex}`;
    const previous = previousToolCalls?.find(
      (tc) => tc.id === id || tc.previousId === id || tc.contentIndex === contentIndex,
    );
    const previousId = previous?.previousId ?? (previous && previous.id !== id ? previous.id : undefined);

    nextToolCalls.push({
      ...previous,
      id,
      name: typeof block["name"] === "string" ? block["name"] : previous?.name ?? "",
      arguments: stringifyToolArguments(block["arguments"]),
      status: previous?.status ?? defaultStatus,
      contentIndex,
      ...(previousId ? { previousId } : {}),
    });
  }

  return nextToolCalls;
}

export function reduceStreamEvent(state: SessionState, envelope: StreamEventEnvelope): SessionState {
  const event = envelope.data;
  const eventType = envelope.type;

  let { messages, isStreaming, mode, pendingExtensionUiRequest, agentState } = state;

  if (CLEAR_PENDING_EVENTS.has(eventType)) {
    pendingExtensionUiRequest = null;
  }

  switch (eventType) {
    case "client_command": {
      const data = event as { type: string; message?: string };
      if (
        ["prompt", "steer", "follow_up"].includes(data.type) &&
        data.message &&
        !isModeSlashCommand(data.message)
      ) {
        messages = [...messages, {
          id: `user-${envelope.id}`,
          role: "user",
          text: data.message,
          timestamp: envelope.timestamp,
        }];
      }
      break;
    }

    case "agent_start":
    case "turn_start": {
      isStreaming = true;
      break;
    }

    case "turn_end": {
      break;
    }

    case "agent_end": {
      isStreaming = false;
      let lastAssist: ChatMessage | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.role === "assistant") { lastAssist = messages[i]; break; }
      }
      if (lastAssist?.stopReason === "stop") {
        const raw = (event as unknown as Record<string, unknown>)["turnStats"] as
          | { filesEdited?: number; filesCreated?: number; linesAdded?: number; linesRemoved?: number; durationMs?: number }
          | undefined;
        if (raw) {
          messages = stampTurnEndFromBackend(messages, raw);
        }
      }
      messages = updateLastStreaming(messages, (msg) => ({ ...msg, isStreaming: false }));
      break;
    }

    case "message_start": {
      if (event.type !== "message_start") break;
      const msg = event.message;
      if (msg?.role === "assistant") {
        const newId = `assistant-${envelope.id}`;
        const existingIdx = messages.findIndex((m) => m.id === newId);
        if (existingIdx >= 0) {
          const next = [...messages];
          next[existingIdx] = { ...next[existingIdx]!, isStreaming: true };
          messages = next;
        } else {
          messages = [...messages, {
            id: newId,
            entryId: extractMessageEntryId(msg as unknown as Record<string, unknown>),
            role: "assistant",
            text: "",
            thinking: "",
            toolCalls: [],
            timestamp: envelope.timestamp,
            isStreaming: true,
            model: msg.model,
            provider: msg.provider,
            api: msg.api,
            responseId: msg.responseId,
          }];
        }
      }
      break;
    }

    case "message_update": {
      if (event.type !== "message_update") break;
      let idx = findLastStreamingIndex(messages);
      if (idx === -1) {
        messages = [...messages, {
          id: `assistant-${envelope.id}`,
          role: "assistant" as const,
          text: "",
          thinking: "",
          toolCalls: [],
          timestamp: envelope.timestamp,
          isStreaming: true,
        }];
        idx = messages.length - 1;
      }
      const delta = event.assistantMessageEvent;
      const current = messages[idx]!;
      let updated = { ...current };

      if (event.message) {
        const msg = event.message;
        const content = Array.isArray(msg.content) ? msg.content : [];
        updated.text = content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text ?? "")
          .join("");
        const thinking = content
          .filter((c: any) => c.type === "thinking")
          .map((c: any) => c.thinking ?? "")
          .join("");
        if (thinking) updated.thinking = thinking;
        const toolCalls = buildToolCallsFromContent(
          content as unknown as Record<string, unknown>[],
          updated.toolCalls,
          "streaming",
        );
        if (toolCalls.length > 0) updated.toolCalls = toolCalls;
        updated.model = msg.model ?? updated.model;
        updated.provider = msg.provider ?? updated.provider;
        updated.api = msg.api ?? updated.api;
        updated.responseId = msg.responseId ?? updated.responseId;
        updated.entryId = extractMessageEntryId(msg as unknown as Record<string, unknown>) ?? updated.entryId;
        updated.usage = extractUsage(msg as unknown as Record<string, unknown>) ?? updated.usage;
      } else {
        switch (delta.type) {
          case "text_delta":
            updated.text = (updated.text ?? "") + delta.delta;
            break;
          case "thinking_delta":
            updated.thinking = (updated.thinking ?? "") + delta.delta;
            break;
          case "toolcall_start": {
            const toolCalls = [...(updated.toolCalls ?? [])];
            toolCalls.push({
              id: delta.partial?.id ?? `tc-${Date.now()}`,
              name: delta.partial?.name ?? "",
              arguments: "",
              status: "streaming",
              contentIndex: delta.contentIndex,
            });
            updated.toolCalls = toolCalls;
            break;
          }
          case "toolcall_delta": {
            const toolCalls = [...(updated.toolCalls ?? [])];
            const toolCallIndex = findToolCallIndex(toolCalls, delta.contentIndex);
            const currentToolCall = toolCalls[toolCallIndex];
            if (currentToolCall) {
              const nextArgs = currentToolCall.arguments + delta.delta;
              let inferredName = currentToolCall.name;
              if (!inferredName && nextArgs.length > 10) {
                if (nextArgs.includes('"oldText"')) inferredName = "edit";
                else if (nextArgs.includes('"content"')) inferredName = "write";
                else if (nextArgs.includes('"command"')) inferredName = "bash";
                else if (nextArgs.includes('"query"')) inferredName = "search";
                else if (nextArgs.includes('"agent"')) inferredName = "subagent";
              }
              toolCalls[toolCallIndex] = {
                ...currentToolCall,
                arguments: nextArgs,
                contentIndex: delta.contentIndex ?? currentToolCall.contentIndex,
                ...(inferredName && inferredName !== currentToolCall.name ? { name: inferredName } : {}),
              };
              updated.toolCalls = toolCalls;
            }
            break;
          }
          case "toolcall_end": {
            const toolCalls = [...(updated.toolCalls ?? [])];
            const toolCallIndex = findToolCallIndex(toolCalls, delta.contentIndex);
            const currentToolCall = toolCalls[toolCallIndex];
            if (currentToolCall && delta.toolCall) {
              const prevId = currentToolCall.id !== delta.toolCall.id ? currentToolCall.id : currentToolCall.previousId;
              toolCalls[toolCallIndex] = {
                ...currentToolCall,
                id: delta.toolCall.id,
                name: delta.toolCall.name,
                arguments: stringifyToolArguments(delta.toolCall.arguments),
                status: "pending",
                contentIndex: delta.contentIndex ?? currentToolCall.contentIndex,
                ...(prevId ? { previousId: prevId } : {}),
              };
              updated.toolCalls = toolCalls;
            }
            break;
          }
          case "done":
            updated.isStreaming = false;
            updated.stopReason = delta.reason;
            break;
          case "error":
            updated.isStreaming = false;
            updated.stopReason = (delta.reason as ChatMessage["stopReason"]) ?? "error";
            updated.errorMessage = delta.reason && !["error", "aborted"].includes(delta.reason) ? delta.reason : undefined;
            break;
        }
      }

      const next = [...messages];
      next[idx] = updated;
      messages = next;
      break;
    }

    case "message_end": {
      if (event.type !== "message_end") break;
      const endMsg = event.message as unknown as Record<string, unknown> | undefined;
      let endIdx = findLastStreamingIndex(messages);
      if (endIdx === -1) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]!.role === "assistant") { endIdx = i; break; }
        }
      }
      if (endIdx !== -1) {
        const msg = messages[endIdx]!;
        const updated: ChatMessage = {
          ...msg,
          isStreaming: false,
          entryId: extractMessageEntryId(endMsg ?? {}) ?? msg.entryId,
          stopReason: endMsg?.["stopReason"] as ChatMessage["stopReason"] ?? msg.stopReason,
          errorMessage: (endMsg?.["errorMessage"] as string) ?? msg.errorMessage,
          provider: (endMsg?.["provider"] as string) ?? msg.provider,
          api: (endMsg?.["api"] as string) ?? msg.api,
          responseId: (endMsg?.["responseId"] as string) ?? msg.responseId,
          usage: extractUsage(endMsg as Record<string, unknown> ?? {}) ?? msg.usage,
        };
        if (endMsg && Array.isArray(endMsg["content"])) {
          const content = endMsg["content"] as Record<string, unknown>[];
          const text = content.filter(c => c["type"] === "text").map(c => (c["text"] as string) ?? "").join("");
          if (text) updated.text = text;
          const thinking = content.filter(c => c["type"] === "thinking").map(c => (c["thinking"] as string) ?? "").join("");
          if (thinking) updated.thinking = thinking;
          const toolCalls = buildToolCallsFromContent(content, msg.toolCalls, "pending");
          if (toolCalls.length > 0) updated.toolCalls = toolCalls;
        }
        const next = [...messages];
        next[endIdx] = updated;
        messages = next;
      }
      break;
    }

    case "tool_execution_start": {
      if (event.type !== "tool_execution_start") break;
      messages = updateToolCall(messages, event.toolCallId, (tc) => ({ ...tc, status: "running" }));
      break;
    }

    case "tool_execution_update": {
      if (event.type !== "tool_execution_update") break;
      const partial = event.partialResult
        ? extractTextFromContent(event.partialResult.content as unknown[])
        : undefined;
      const details = (event.partialResult as any)?.details;
      const progress = Array.isArray(details?.progress) ? details.progress[0] : undefined;
      if (partial !== undefined || progress) {
        messages = updateToolCall(messages, event.toolCallId, (tc) => ({
          ...tc,
          ...(partial !== undefined ? { partialResult: partial } : {}),
          ...(progress ? { progress } : {}),
        }));
      }
      break;
    }

    case "tool_execution_end": {
      if (event.type !== "tool_execution_end") break;
      const resultText = event.result
        ? extractTextFromContent(event.result.content as unknown[])
        : undefined;
      const resultImages = event.result
        ? extractImagesFromContent(event.result.content as unknown[])
        : undefined;
      const resultDetails = (event.result as any)?.details;
      const subagentMeta = resultDetails ? extractSubagentMeta(resultDetails) : undefined;
      const diff = resultDetails && typeof resultDetails.diff === "string" ? resultDetails.diff : undefined;
      messages = updateToolCall(messages, event.toolCallId, (tc) => ({
        ...tc,
        status: event.isError ? "error" : "complete",
        result: resultText,
        resultImages,
        isError: event.isError,
        ...(subagentMeta ? { subagentMeta } : {}),
        ...(diff ? { diff } : {}),
      }));
      break;
    }

    case "session_process_exited": {
      isStreaming = false;
      messages = updateLastStreaming(messages, (msg) => ({ ...msg, isStreaming: false }));
      break;
    }

    case "session_state": {
      const data = event as unknown as { isStreaming?: boolean };
      if (typeof data.isStreaming === "boolean") {
        isStreaming = data.isStreaming;
        if (!isStreaming) {
          messages = updateLastStreaming(messages, (msg) => ({ ...msg, isStreaming: false }));
        }
      }
      break;
    }

    case "agent_state": {
      const data = event as unknown as AgentStateData;
      if (typeof data.isStreaming === "boolean") {
        isStreaming = data.isStreaming;
        if (!isStreaming) {
          messages = updateLastStreaming(messages, (msg) => ({ ...msg, isStreaming: false }));
        }
      }
      if (typeof data.mode === "string") {
        if (data.mode === "plan" || data.mode === "chat") {
          mode = data.mode;
        }
      }
      agentState = data;
      break;
    }

    case "extension_ui_request": {
      if (event.type !== "extension_ui_request") break;
      if ("method" in event) {
        const method = event.method;
        if (method === "select" || method === "confirm" || method === "input" || method === "editor") {
          pendingExtensionUiRequest = {
            id: event.id,
            method,
            ...(method === "select" ? { title: event.title, options: event.options, timeout: event.timeout } : {}),
            ...(method === "confirm" ? { title: event.title, message: event.message, timeout: event.timeout } : {}),
            ...(method === "input" ? { title: event.title, placeholder: event.placeholder } : {}),
            ...(method === "editor" ? { title: event.title, prefill: event.prefill } : {}),
          };
        }
        if (method === "setStatus" && event.statusKey === "plan-mode") {
          const statusText = typeof event.statusText === "string" ? event.statusText.toLowerCase() : "";
          mode = statusText.includes("plan") ? "plan" : "chat";
        }
      }
      break;
    }
  }

  return { ...state, messages, isStreaming, mode, pendingExtensionUiRequest, agentState };
}

function updateToolCall(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!msg.toolCalls) continue;
    const idx = msg.toolCalls.findIndex((t) => t.id === toolCallId || t.previousId === toolCallId);
    if (idx === -1) continue;
    const nextToolCalls = [...msg.toolCalls];
    nextToolCalls[idx] = updater(msg.toolCalls[idx]!);
    const next = [...messages];
    next[i] = { ...msg, toolCalls: nextToolCalls };
    return next;
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Convert raw pi messages (from getMessages RPC) to ChatMessage[]
// ---------------------------------------------------------------------------

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function stableId(msg: Record<string, unknown>, role: string, index: number): string {
  const rawId = msg["id"] ?? msg["messageId"] ?? msg["entryId"] ?? msg["entry_id"];
  if (rawId !== null && rawId !== undefined && rawId !== "") return `${role}-${String(rawId)}`;
  const ts = typeof msg["timestamp"] === "number" ? msg["timestamp"] : "no-ts";
  return `${role}-${ts}-${index}`;
}

function extractUsage(msg: Record<string, unknown>): MessageUsageInfo | undefined {
  const usage = msg["usage"];
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const cost = u["cost"] && typeof u["cost"] === "object" ? u["cost"] as Record<string, unknown> : undefined;
  return {
    input: typeof u["input"] === "number" ? u["input"] : undefined,
    output: typeof u["output"] === "number" ? u["output"] : undefined,
    cacheRead: typeof u["cacheRead"] === "number" ? u["cacheRead"] : undefined,
    cacheWrite: typeof u["cacheWrite"] === "number" ? u["cacheWrite"] : undefined,
    cacheReadCost: typeof cost?.["cacheRead"] === "number" ? cost["cacheRead"] as number : undefined,
    cacheWriteCost: typeof cost?.["cacheWrite"] === "number" ? cost["cacheWrite"] as number : undefined,
    inputCost: typeof cost?.["input"] === "number" ? cost["input"] as number : undefined,
    outputCost: typeof cost?.["output"] === "number" ? cost["output"] as number : undefined,
    totalCost: typeof cost?.["total"] === "number" ? cost["total"] as number : undefined,
    currency: typeof cost?.["currency"] === "string" ? cost["currency"] as string : undefined,
  };
}

function errorMsg(msg: Record<string, unknown>): string | undefined {
  if (
    ["error", "aborted"].includes(msg["stopReason"] as string) &&
    typeof msg["errorMessage"] === "string" &&
    (msg["errorMessage"] as string).trim()
  ) {
    return (msg["errorMessage"] as string).trim();
  }
  return undefined;
}

function convertSingleMessage(msg: Record<string, unknown>, index: number): ChatMessage | null {
  const role = msg["role"] as string;

  if (role === "user") {
    const content = msg["content"];
    const text = typeof content === "string" ? content : extractTextFromContent(content as unknown[] | undefined);
    return {
      id: stableId(msg, "user", index),
      entryId: extractMessageEntryId(msg),
      role: "user",
      text,
      timestamp: parseTimestamp(msg["timestamp"]),
    };
  }

  if (role === "assistant") {
    const content = Array.isArray(msg["content"]) ? msg["content"] as Record<string, unknown>[] : [];
    const text = content.filter(c => c["type"] === "text").map(c => c["text"] as string ?? "").join("");
    const thinking = content.filter(c => c["type"] === "thinking").map(c => c["thinking"] as string ?? "").join("");
    const toolCalls = buildToolCallsFromContent(content, undefined, "complete");

    const backendStats = msg["turnFileStats"] as Record<string, number> | undefined;
    const backendDuration = typeof msg["turnDurationMs"] === "number" ? msg["turnDurationMs"] as number : undefined;

    return {
      id: stableId(msg, "assistant", index),
      entryId: extractMessageEntryId(msg),
      role: "assistant",
      text,
      errorMessage: errorMsg(msg),
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: parseTimestamp(msg["timestamp"]),
      model: msg["model"] as string | undefined,
      provider: msg["provider"] as string | undefined,
      api: msg["api"] as string | undefined,
      responseId: msg["responseId"] as string | undefined,
      usage: extractUsage(msg),
      stopReason: msg["stopReason"] as ChatMessage["stopReason"],
      turnDurationMs: backendDuration,
      turnFileStats: backendStats ? {
        filesEdited: backendStats["filesEdited"] ?? 0,
        filesCreated: backendStats["filesCreated"] ?? 0,
        linesAdded: backendStats["linesAdded"] ?? 0,
        linesRemoved: backendStats["linesRemoved"] ?? 0,
      } : undefined,
    };
  }

  if (role === "bashExecution") {
    return {
      id: stableId(msg, "system", index),
      role: "system",
      systemKind: "bashExecution",
      text: typeof msg["output"] === "string" ? msg["output"] : "",
      command: typeof msg["command"] === "string" ? msg["command"] : undefined,
      timestamp: parseTimestamp(msg["timestamp"]),
      exitCode: typeof msg["exitCode"] === "number" ? msg["exitCode"] : undefined,
      cancelled: !!msg["cancelled"],
      truncated: !!msg["truncated"],
      fullOutputPath: typeof msg["fullOutputPath"] === "string" ? msg["fullOutputPath"] : null,
    };
  }

  return null;
}

export function convertRawMessages(rawMessages: Record<string, string>[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const [index, msg] of rawMessages.entries()) {
    const raw = msg as unknown as Record<string, unknown>;
    const converted = convertSingleMessage(raw, index);
    if (converted) {
      result.push(converted);
      continue;
    }

    if (raw["role"] === "toolResult") {
      for (let i = result.length - 1; i >= 0; i--) {
        const assistant = result[i];
        if (assistant?.role !== "assistant" || !assistant.toolCalls) continue;
        const tc = assistant.toolCalls.find(
          (toolCall) => toolCall.id === raw["toolCallId"] || toolCall.previousId === raw["toolCallId"],
        );
        if (!tc) continue;
        tc.result = extractTextFromContent(raw["content"] as unknown[] | undefined);
        tc.resultImages = extractImagesFromContent(raw["content"] as unknown[] | undefined);
        tc.isError = raw["isError"] as boolean;
        tc.status = raw["isError"] ? "error" : "complete";
        const details = raw["details"] as Record<string, unknown> | undefined;
        const meta = extractSubagentMeta(details);
        if (meta) tc.subagentMeta = meta;
        if (typeof details?.["diff"] === "string") tc.diff = details["diff"] as string;
        break;
      }
    }
  }

  return result;
}
