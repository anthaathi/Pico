import { create } from "zustand";
import type {
  AgentConnectionState,
  ChatMessage,
  MessageUsageInfo,
  StreamEvent,
  ToolCallInfo,
} from "../types";
import {
  parsePendingExtensionUiRequest,
  type PendingExtensionUiRequest,
} from "../extension-ui";
import { extractAgentMode, type AgentMode } from "../mode";

const PENDING_EXTENSION_UI_CLEAR_EVENTS = new Set([
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "turn_end",
  "agent_end",
  "session_process_exited",
]);

const DEFAULT_CONNECTION_STATE: AgentConnectionState = {
  status: "idle",
  retryAttempt: 0,
  nextRetryAt: null,
  lastDisconnectReason: null,
  disconnectedAt: null,
};

function updateToolCall(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (toolCall: ToolCallInfo) => ToolCallInfo,
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.toolCalls) {
      const toolCallIndex = msg.toolCalls.findIndex((t) => t.id === toolCallId);
      if (toolCallIndex === -1) continue;

      const currentToolCall = msg.toolCalls[toolCallIndex]!;
      const nextToolCall = updater(currentToolCall);
      if (nextToolCall === currentToolCall) {
        return messages;
      }

      const nextToolCalls = [...msg.toolCalls];
      nextToolCalls[toolCallIndex] = nextToolCall;

      const nextMessages = [...messages];
      nextMessages[i] = {
        ...msg,
        toolCalls: nextToolCalls,
      };

      return nextMessages;
    }
  }
  return messages;
}

function extractTextFromContent(content: any[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");

  const imageCount = content.filter((c) => c.type === "image").length;
  if (imageCount === 0) {
    return text;
  }

  const imageLabel =
    imageCount === 1 ? "1 image output" : `${imageCount} image outputs`;
  if (!text.trim()) {
    return `[${imageLabel}]`;
  }

  return `${text}\n\n[${imageLabel}]`;
}

function getAssistantErrorMessage(message: any): string | undefined {
  if (
    ["error", "aborted"].includes(message?.stopReason) &&
    typeof message?.errorMessage === "string" &&
    message.errorMessage.trim()
  ) {
    return message.errorMessage.trim();
  }
  return undefined;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function isModeSlashCommand(message: string): boolean {
  const firstToken = message.trim().split(/\s+/)[0];
  return firstToken === "/chat" || firstToken === "/plan";
}

function getStableMessageId(msg: any, role: ChatMessage["role"], index: number): string {
  const rawId =
    msg?.id ??
    msg?.messageId ??
    msg?.entryId ??
    msg?.entry_id ??
    null;

  if (rawId !== null && rawId !== undefined && rawId !== "") {
    return `${role}-${String(rawId)}`;
  }

  const timestamp =
    typeof msg?.timestamp === "number" ? msg.timestamp : "no-timestamp";
  return `${role}-${timestamp}-${index}`;
}

function extractUsageInfo(message: any): MessageUsageInfo | undefined {
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  return {
    input: typeof usage.input === "number" ? usage.input : undefined,
    output: typeof usage.output === "number" ? usage.output : undefined,
    cacheRead:
      typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
    cacheWrite:
      typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
    totalTokens:
      typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : undefined,
  };
}

function convertPiMessage(
  msg: any,
  index: number,
): ChatMessage | null {
  if (msg.role === "user") {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : extractTextFromContent(msg.content);
    return {
      id: getStableMessageId(msg, "user", index),
      role: "user",
      text,
      timestamp: parseTimestamp(msg.timestamp),
    };
  }

  if (msg.role === "assistant") {
    const content = Array.isArray(msg.content) ? msg.content : [];
    const contentText = content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    const thinking = content
      .filter((c: any) => c.type === "thinking")
      .map((c: any) => c.thinking)
      .join("");
    const toolCalls: ToolCallInfo[] = content
      .filter((c: any) => c.type === "toolCall")
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        arguments:
          typeof c.arguments === "string"
            ? c.arguments
            : JSON.stringify(c.arguments),
        status: "complete" as const,
      }));

    return {
      id: getStableMessageId(msg, "assistant", index),
      role: "assistant",
      text: contentText,
      errorMessage: getAssistantErrorMessage(msg),
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: parseTimestamp(msg.timestamp),
      model: msg.model,
      provider: msg.provider,
      api: msg.api,
      responseId: msg.responseId,
      usage: extractUsageInfo(msg),
      stopReason: msg.stopReason,
    };
  }

  if (msg.role === "bashExecution") {
    return {
      id: getStableMessageId(msg, "system", index),
      role: "system",
      systemKind: "bashExecution",
      text: typeof msg.output === "string" ? msg.output : "",
      command: typeof msg.command === "string" ? msg.command : undefined,
      timestamp: parseTimestamp(msg.timestamp),
      exitCode:
        typeof msg.exitCode === "number" ? msg.exitCode : undefined,
      cancelled: !!msg.cancelled,
      truncated: !!msg.truncated,
      fullOutputPath:
        typeof msg.fullOutputPath === "string"
          ? msg.fullOutputPath
          : null,
    };
  }

  return null;
}

function convertPiMessages(piMessages: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const [index, msg] of piMessages.entries()) {
    const converted = convertPiMessage(msg, index);
    if (converted) {
      result.push(converted);
      continue;
    }

    if (msg.role === "toolResult") {
      const lastAssistant = [...result]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant?.toolCalls) {
        const tc = lastAssistant.toolCalls.find(
          (t) => t.id === msg.toolCallId,
        );
        if (tc) {
          tc.result = extractTextFromContent(msg.content);
          tc.isError = msg.isError;
          tc.status = msg.isError ? "error" : "complete";
        }
      }
    }
  }

  return result;
}

function convertSessionEntries(entries: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const [index, entry] of entries.entries()) {
    const raw = entry?.raw && typeof entry.raw === "object" ? entry.raw : entry;
    if (!raw || typeof raw !== "object") {
      continue;
    }

    if ((raw as any).type === "message" && (raw as any).message) {
      const converted = convertPiMessage((raw as any).message, index);
      if (converted) {
        result.push(converted);
        continue;
      }

      const msg = (raw as any).message;
      if (msg?.role === "toolResult") {
        const lastAssistant = [...result]
          .reverse()
          .find((m) => m.role === "assistant");
        if (lastAssistant?.toolCalls) {
          const tc = lastAssistant.toolCalls.find(
            (t) => t.id === msg.toolCallId,
          );
          if (tc) {
            tc.result = extractTextFromContent(msg.content);
            tc.isError = msg.isError;
            tc.status = msg.isError ? "error" : "complete";
          }
        }
      }
      continue;
    }

    const rawType = (raw as any).type;
    if (rawType === "model_change") {
      const provider = (raw as any).provider ?? "provider";
      const modelId = (raw as any).modelId ?? "model";
      result.push({
        id: `system-model-${(raw as any).id ?? index}`,
        role: "system",
        systemKind: "event",
        text: `Switched model to ${provider}/${modelId}`,
        timestamp: parseTimestamp((raw as any).timestamp),
      });
      continue;
    }

    if (rawType === "thinking_level_change") {
      const level = (raw as any).thinkingLevel ?? "unknown";
      result.push({
        id: `system-thinking-${(raw as any).id ?? index}`,
        role: "system",
        systemKind: "event",
        text: `Thinking level set to ${level}`,
        timestamp: parseTimestamp((raw as any).timestamp),
      });
      continue;
    }

    if (rawType === "compaction") {
      result.push({
        id: `system-compaction-${(raw as any).id ?? index}`,
        role: "system",
        systemKind: "event",
        text: "Conversation compacted",
        timestamp: parseTimestamp((raw as any).timestamp),
      });
      continue;
    }

    if (rawType === "custom" && (raw as any).customType === "plan-mode") {
      const enabled = !!(raw as any).data?.enabled;
      result.push({
        id: `system-plan-${(raw as any).id ?? index}`,
        role: "system",
        systemKind: "event",
        text: enabled ? "Plan mode enabled" : "Plan mode disabled",
        timestamp: parseTimestamp((raw as any).timestamp),
      });
      continue;
    }

    const preview =
      typeof entry?.preview === "string" && entry.preview.trim()
        ? entry.preview.trim()
        : typeof (raw as any).text === "string" && (raw as any).text.trim()
          ? (raw as any).text.trim()
          : typeof (raw as any).message === "string" &&
              (raw as any).message.trim()
            ? (raw as any).message.trim()
            : null;

    if (preview) {
      result.push({
        id: `system-${rawType ?? "entry"}-${(raw as any).id ?? index}`,
        role: "system",
        systemKind: "event",
        text: preview,
        timestamp: parseTimestamp((raw as any).timestamp ?? entry?.timestamp),
      });
    }
  }

  return result;
}

interface AgentState {
  messages: Record<string, ChatMessage[]>;
  modes: Record<string, AgentMode | null | undefined>;
  pendingExtensionUiRequests: Record<
    string,
    PendingExtensionUiRequest | null | undefined
  >;
  streaming: Record<string, boolean>;
  lastEventId: number | null;
  connection: AgentConnectionState;
  reconnectNonce: number;
  pendingPrompt: { workspaceId: string; text: string } | null;
  alertMessage: string | null;

  processStreamEvent: (event: StreamEvent) => void;
  processStreamEvents: (events: StreamEvent[]) => void;
  setHistoryMessages: (sessionId: string, piMessages: any[]) => void;
  setHistoryEntries: (sessionId: string, entries: any[]) => void;
  clearMessages: (sessionId: string) => void;
  setConnectionState: (connection: AgentConnectionState) => void;
  requestReconnect: () => void;
  setPendingPrompt: (
    pending: { workspaceId: string; text: string } | null,
  ) => void;
  setAlertMessage: (message: string | null) => void;
  setPendingExtensionUiRequest: (
    sessionId: string,
    pending: PendingExtensionUiRequest | null,
  ) => void;
}

function getStreamAlertMessage(event: StreamEvent): string | null {
  const data = event.data as Record<string, any> | undefined;

  if (event.type === "message_update") {
    const delta = data?.assistantMessageEvent as
      | { type?: string; reason?: string }
      | undefined;
    if (delta?.type === "error" && delta.reason !== "aborted") {
      return delta?.reason
        ? `Agent error: ${delta.reason}`
        : "Agent response failed.";
    }
  }

  if (event.type === "extension_error" && typeof data?.error === "string") {
    return `Extension error: ${data.error}`;
  }

  if (
    event.type === "auto_retry_end" &&
    data?.success === false &&
    typeof data?.finalError === "string"
  ) {
    return `Retry failed: ${data.finalError}`;
  }

  if (
    event.type === "auto_compaction_end" &&
    data?.result == null &&
    data?.aborted === false &&
    typeof data?.errorMessage === "string"
  ) {
    return `Compaction failed: ${data.errorMessage}`;
  }

  return null;
}

function reduceStreamEvents(
  state: Pick<
    AgentState,
    "messages" | "modes" | "pendingExtensionUiRequests" | "streaming" | "lastEventId" | "alertMessage"
  >,
  events: StreamEvent[],
) {
  const messages = { ...state.messages };
  const modes = { ...state.modes };
  const pendingExtensionUiRequests = {
    ...state.pendingExtensionUiRequests,
  };
  const streaming = { ...state.streaming };
  let lastEventId = state.lastEventId;
  let alertMessage = state.alertMessage;

  for (const event of events) {
    const { session_id: sessionId } = event;
    const piEvent = event.data;
    const eventType = event.type;
    let msgs = [...(messages[sessionId] ?? [])];
    const streamedMode = extractAgentMode(piEvent);

    if (streamedMode) {
      modes[sessionId] = streamedMode;
    }

    if (PENDING_EXTENSION_UI_CLEAR_EVENTS.has(eventType)) {
      pendingExtensionUiRequests[sessionId] = null;
    }

    switch (eventType) {
      case "client_command": {
        if (
          ["prompt", "steer", "follow_up"].includes(piEvent.type) &&
          piEvent.message &&
          !isModeSlashCommand(piEvent.message)
        ) {
          msgs.push({
            id: `user-${event.id}`,
            role: "user",
            text: piEvent.message,
            timestamp: event.timestamp,
          });
        }
        if (piEvent.type === "extension_ui_response") {
          pendingExtensionUiRequests[sessionId] = null;
        }
        break;
      }

      case "agent_start": {
        streaming[sessionId] = true;
        break;
      }

      case "turn_start": {
        streaming[sessionId] = true;
        break;
      }

      case "agent_end": {
        streaming[sessionId] = false;
        break;
      }

      case "extension_ui_request": {
        if (piEvent.method === "setStatus" && piEvent.statusKey === "plan-mode") {
          const statusText =
            typeof piEvent.statusText === "string"
              ? piEvent.statusText.toLowerCase()
              : "";
          modes[sessionId] = statusText.includes("plan") ? "plan" : "chat";
        }
        const pending = parsePendingExtensionUiRequest(piEvent);
        if (pending) {
          pendingExtensionUiRequests[sessionId] = pending;
        }
        break;
      }

      case "message_start": {
        const msg = piEvent.message;
        if (msg?.role === "assistant") {
          msgs.push({
            id: `assistant-${event.id}`,
            role: "assistant",
            text: "",
            errorMessage: undefined,
            thinking: "",
            toolCalls: [],
            timestamp: event.timestamp,
            isStreaming: true,
            model: msg.model,
            provider: msg.provider,
            api: msg.api,
            responseId: msg.responseId,
            usage: extractUsageInfo(msg),
          });
        }
        break;
      }

      case "message_update": {
        const delta = piEvent.assistantMessageEvent;
        const lastIdx = msgs.findLastIndex(
          (m) => m.role === "assistant" && m.isStreaming,
        );
        if (lastIdx === -1 || !delta) break;

        const lastMsg = { ...msgs[lastIdx] };
        msgs[lastIdx] = lastMsg;

        switch (delta.type) {
          case "text_delta":
            lastMsg.text += delta.delta ?? "";
            break;
          case "thinking_delta":
            lastMsg.thinking = (lastMsg.thinking ?? "") + (delta.delta ?? "");
            break;
          case "toolcall_start": {
            const toolCalls = [...(lastMsg.toolCalls ?? [])];
            toolCalls.push({
              id: delta.partial?.id ?? `tc-${Date.now()}`,
              name: delta.partial?.name ?? "",
              arguments: "",
              status: "streaming",
            });
            lastMsg.toolCalls = toolCalls;
            break;
          }
          case "toolcall_delta": {
            const toolCalls = [...(lastMsg.toolCalls ?? [])];
            const last = toolCalls[toolCalls.length - 1];
            if (last) {
              toolCalls[toolCalls.length - 1] = {
                ...last,
                arguments: last.arguments + (delta.delta ?? ""),
              };
            }
            lastMsg.toolCalls = toolCalls;
            break;
          }
          case "toolcall_end": {
            const toolCalls = [...(lastMsg.toolCalls ?? [])];
            const last = toolCalls[toolCalls.length - 1];
            if (last && delta.toolCall) {
              toolCalls[toolCalls.length - 1] = {
                ...last,
                id: delta.toolCall.id,
                name: delta.toolCall.name,
                arguments:
                  typeof delta.toolCall.arguments === "string"
                    ? delta.toolCall.arguments
                    : JSON.stringify(delta.toolCall.arguments),
                status: "pending",
              };
            }
            lastMsg.toolCalls = toolCalls;
            break;
          }
          case "done":
            lastMsg.isStreaming = false;
            lastMsg.stopReason =
              delta.reason ?? piEvent.message?.stopReason;
            lastMsg.provider =
              piEvent.message?.provider ?? lastMsg.provider;
            lastMsg.api = piEvent.message?.api ?? lastMsg.api;
            lastMsg.responseId =
              piEvent.message?.responseId ?? lastMsg.responseId;
            lastMsg.usage =
              extractUsageInfo(piEvent.message) ?? lastMsg.usage;
            break;
          case "error":
            lastMsg.isStreaming = false;
            lastMsg.stopReason =
              delta.reason ?? piEvent.message?.stopReason ?? "error";
            lastMsg.errorMessage =
              getAssistantErrorMessage(piEvent.message) ??
              (typeof delta.reason === "string" &&
              !["error", "aborted"].includes(delta.reason)
                ? delta.reason
                : undefined);
            lastMsg.provider =
              piEvent.message?.provider ?? lastMsg.provider;
            lastMsg.api = piEvent.message?.api ?? lastMsg.api;
            lastMsg.responseId =
              piEvent.message?.responseId ?? lastMsg.responseId;
            lastMsg.usage =
              extractUsageInfo(piEvent.message) ?? lastMsg.usage;
            break;
        }
        break;
      }

      case "message_end": {
        const lastIdx = msgs.findLastIndex(
          (m) => m.role === "assistant" && m.isStreaming,
        );
        if (lastIdx !== -1) {
          msgs[lastIdx] = {
            ...msgs[lastIdx],
            errorMessage:
              msgs[lastIdx].errorMessage ??
              getAssistantErrorMessage(piEvent.message),
            provider: piEvent.message?.provider ?? msgs[lastIdx].provider,
            api: piEvent.message?.api ?? msgs[lastIdx].api,
            responseId:
              piEvent.message?.responseId ?? msgs[lastIdx].responseId,
            usage:
              extractUsageInfo(piEvent.message) ?? msgs[lastIdx].usage,
            isStreaming: false,
            stopReason: piEvent.message?.stopReason,
          };
        }
        break;
      }

      case "tool_execution_start": {
        msgs = updateToolCall(msgs, piEvent.toolCallId, (toolCall) => {
          if (toolCall.status === "running") {
            return toolCall;
          }

          return {
            ...toolCall,
            status: "running",
          };
        });
        break;
      }

      case "tool_execution_update": {
        if (!piEvent.partialResult?.content) break;

        const partialResult = extractTextFromContent(
          piEvent.partialResult.content,
        );

        msgs = updateToolCall(msgs, piEvent.toolCallId, (toolCall) => {
          if (toolCall.partialResult === partialResult) {
            return toolCall;
          }

          return {
            ...toolCall,
            partialResult,
          };
        });
        break;
      }

      case "tool_execution_end": {
        const status = piEvent.isError ? "error" : "complete";
        const result = extractTextFromContent(piEvent.result?.content);

        msgs = updateToolCall(msgs, piEvent.toolCallId, (toolCall) => {
          if (
            toolCall.status === status &&
            toolCall.result === result &&
            toolCall.isError === piEvent.isError
          ) {
            return toolCall;
          }

          return {
            ...toolCall,
            status,
            result,
            isError: piEvent.isError,
          };
        });
        break;
      }

      case "session_process_exited": {
        streaming[sessionId] = false;
        break;
      }
    }

    const nextAlertMessage = getStreamAlertMessage(event);
    if (nextAlertMessage) {
      alertMessage = nextAlertMessage;
    }

    messages[sessionId] = msgs;
    lastEventId = event.id;
  }

  return {
    messages,
    modes,
    pendingExtensionUiRequests,
    streaming,
    lastEventId,
    alertMessage,
  };
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: {},
  modes: {},
  pendingExtensionUiRequests: {},
  streaming: {},
  lastEventId: null,
  connection: DEFAULT_CONNECTION_STATE,
  reconnectNonce: 0,
  pendingPrompt: null,
  alertMessage: null,

  processStreamEvent: (event: StreamEvent) => {
    get().processStreamEvents([event]);
  },

  processStreamEvents: (events: StreamEvent[]) => {
    if (events.length === 0) return;
    set((state) => reduceStreamEvents(state, events));
  },

  setHistoryMessages: (sessionId: string, piMessages: any[]) => {
    const existing = get().messages[sessionId];
    const converted = convertPiMessages(piMessages);
    if (!existing || existing.length === 0) {
      set((state) => ({
        messages: { ...state.messages, [sessionId]: converted },
      }));
      return;
    }
    const isStreaming = get().streaming[sessionId];
    if (isStreaming) return;
    if (converted.length <= existing.length) return;
    set((state) => ({
      messages: { ...state.messages, [sessionId]: converted },
    }));
  },

  setHistoryEntries: (sessionId: string, entries: any[]) => {
    const existing = get().messages[sessionId];
    const converted = convertSessionEntries(entries);
    if (!converted.length) return;
    if (!existing || existing.length === 0) {
      set((state) => ({
        messages: { ...state.messages, [sessionId]: converted },
      }));
      return;
    }
    const isStreaming = get().streaming[sessionId];
    if (isStreaming) return;
    if (converted.length <= existing.length) return;
    set((state) => ({
      messages: { ...state.messages, [sessionId]: converted },
    }));
  },

  clearMessages: (sessionId: string) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.messages;
      const { [sessionId]: ___, ...modeRest } = state.modes;
      const { [sessionId]: __, ...pendingRest } =
        state.pendingExtensionUiRequests;
      return {
        messages: rest,
        modes: modeRest,
        pendingExtensionUiRequests: pendingRest,
      };
    });
  },

  setConnectionState: (connection) => set({ connection }),

  requestReconnect: () =>
    set((state) => ({ reconnectNonce: state.reconnectNonce + 1 })),

  setPendingPrompt: (pending) => set({ pendingPrompt: pending }),

  setAlertMessage: (alertMessage) => set({ alertMessage }),

  setPendingExtensionUiRequest: (sessionId, pending) =>
    set((state) => ({
      pendingExtensionUiRequests: {
        ...state.pendingExtensionUiRequests,
        [sessionId]: pending,
      },
    })),
}));
