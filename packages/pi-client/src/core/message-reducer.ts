import type { ChatMessage, ToolCallInfo, MessageUsageInfo, AgentMode, PendingExtensionUiRequest } from "../types/chat-message";
import type { AgentStreamEvent, StreamEventEnvelope } from "../types/stream-events";

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
}

export function createEmptySessionState(): SessionState {
  return {
    messages: [],
    isStreaming: false,
    isReady: false,
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

export function reduceStreamEvent(state: SessionState, envelope: StreamEventEnvelope): SessionState {
  const event = envelope.data;
  const eventType = envelope.type;

  let { messages, isStreaming, mode, pendingExtensionUiRequest } = state;

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

    case "agent_end": {
      isStreaming = false;
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
        idx = messages.findLastIndex((m) => m.role === "assistant");
      }
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
        const toolCalls: ToolCallInfo[] = content
          .filter((c: any) => c.type === "toolCall")
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments),
            status: "streaming" as const,
          }));
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
            });
            updated.toolCalls = toolCalls;
            break;
          }
          case "toolcall_delta": {
            const toolCalls = [...(updated.toolCalls ?? [])];
            const last = toolCalls[toolCalls.length - 1];
            if (last) {
              const nextArgs = last.arguments + delta.delta;
              let inferredName = last.name;
              if (!inferredName && nextArgs.length > 10) {
                if (nextArgs.includes('"oldText"')) inferredName = "edit";
                else if (nextArgs.includes('"content"')) inferredName = "write";
                else if (nextArgs.includes('"command"')) inferredName = "bash";
                else if (nextArgs.includes('"query"')) inferredName = "search";
              }
              toolCalls[toolCalls.length - 1] = {
                ...last,
                arguments: nextArgs,
                ...(inferredName && inferredName !== last.name ? { name: inferredName } : {}),
              };
              updated.toolCalls = toolCalls;
            }
            break;
          }
          case "toolcall_end": {
            const toolCalls = [...(updated.toolCalls ?? [])];
            const last = toolCalls[toolCalls.length - 1];
            if (last && delta.toolCall) {
              const prevId = last.id !== delta.toolCall.id ? last.id : undefined;
              toolCalls[toolCalls.length - 1] = {
                ...last,
                id: delta.toolCall.id,
                name: delta.toolCall.name,
                arguments: typeof delta.toolCall.arguments === "string"
                  ? delta.toolCall.arguments
                  : JSON.stringify(delta.toolCall.arguments),
                status: "pending",
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
      messages = updateLastStreaming(messages, (msg) => {
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
          if (text && !msg.text) updated.text = text;
          const thinking = content.filter(c => c["type"] === "thinking").map(c => (c["thinking"] as string) ?? "").join("");
          if (thinking && !msg.thinking) updated.thinking = thinking;
        }
        return updated;
      });
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
      messages = updateToolCall(messages, event.toolCallId, (tc) => ({
        ...tc,
        status: event.isError ? "error" : "complete",
        result: resultText,
        isError: event.isError,
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
      // agent_state is emitted on session touch/create with full session state
      // from the backend. It carries isStreaming, mode, model info, etc.
      const data = event as unknown as {
        isStreaming?: boolean;
        mode?: string;
      };
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

  return { ...state, messages, isStreaming, mode, pendingExtensionUiRequest };
}

function updateToolCall(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (tc: ToolCallInfo) => ToolCallInfo,
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!msg.toolCalls) continue;
    const idx = msg.toolCalls.findIndex((t) => t.id === toolCallId);
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
    const toolCalls: ToolCallInfo[] = content
      .filter(c => c["type"] === "toolCall")
      .map(c => ({
        id: c["id"] as string,
        name: c["name"] as string,
        arguments: typeof c["arguments"] === "string" ? c["arguments"] : JSON.stringify(c["arguments"]),
        status: "complete" as const,
      }));

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
      const lastAssistant = [...result].reverse().find(m => m.role === "assistant");
      if (lastAssistant?.toolCalls) {
        const tc = lastAssistant.toolCalls.find(t => t.id === raw["toolCallId"]);
        if (tc) {
          tc.result = extractTextFromContent(raw["content"] as unknown[] | undefined);
          tc.isError = raw["isError"] as boolean;
          tc.status = raw["isError"] ? "error" : "complete";
        }
      }
    }
  }

  return result;
}
