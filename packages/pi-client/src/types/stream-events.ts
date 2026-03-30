export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContentBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolCallContentBlock;

export interface ToolProgressStep {
  tool: string;
  args: string;
  endMs?: number;
}

export interface ToolProgressSnapshot {
  agent?: string;
  status?: string;
  durationMs?: number;
  toolCount?: number;
  recentTools?: ToolProgressStep[];
  recentOutput?: string[];
}

export interface ToolResultDetails {
  truncation?: string | null;
  fullOutputPath?: string | null;
  progress?: ToolProgressSnapshot[];
  [key: string]: unknown;
}

export interface ToolContent {
  content: ContentBlock[];
  details?: ToolResultDetails | null;
}

export interface CostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageInfo {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: CostInfo;
}

export type ModelInputType = "text" | "image";

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ModelInputType[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
  timestamp: number;
  attachments?: Attachment[];
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  api?: string;
  provider?: string;
  model?: string;
  responseId?: string;
  usage?: UsageInfo;
  stopReason?: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
  timestamp: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath: string | null;
  timestamp: number;
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage;

export interface Attachment {
  id: string;
  type: "image";
  fileName: string;
  mimeType: string;
  size: number;
  content: string;
  extractedText: string | null;
  preview: string | null;
}

export interface ToolCallPartial {
  id?: string;
  name?: string;
}

export interface ToolCallFull {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export type MessageDelta =
  | { type: "start" }
  | { type: "text_start"; contentIndex?: number; partial?: AssistantMessage }
  | {
      type: "text_delta";
      delta: string;
      contentIndex?: number;
      partial?: AssistantMessage;
    }
  | {
      type: "text_end";
      contentIndex?: number;
      content?: string;
      partial?: AssistantMessage;
    }
  | {
      type: "thinking_start";
      contentIndex?: number;
      partial?: AssistantMessage;
    }
  | {
      type: "thinking_delta";
      delta: string;
      contentIndex?: number;
      partial?: AssistantMessage;
    }
  | { type: "thinking_end"; contentIndex?: number; partial?: AssistantMessage }
  | {
      type: "toolcall_start";
      contentIndex?: number;
      partial?: ToolCallPartial;
    }
  | { type: "toolcall_delta"; delta: string; contentIndex?: number }
  | { type: "toolcall_end"; contentIndex?: number; toolCall: ToolCallFull }
  | { type: "done"; reason?: StopReason; message?: AssistantMessage }
  | { type: "error"; reason?: string; message?: AssistantMessage };

export interface CompactionResult {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: Record<string, string>;
}

export type ExtensionUiRequest =
  | {
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      method: "confirm";
      title: string;
      message?: string;
      timeout?: number;
    }
  | { method: "input"; title: string; placeholder?: string }
  | { method: "editor"; title: string; prefill?: string }
  | { method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { method: "setStatus"; statusKey: string; statusText?: string }
  | {
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | { method: "setTitle"; title: string }
  | { method: "set_editor_text"; text: string };

export type AgentStreamEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message?: AssistantMessage;
      toolResults?: ToolResultMessage[];
    }
  | { type: "message_start"; message: AssistantMessage }
  | {
      type: "message_update";
      assistantMessageEvent: MessageDelta;
      message?: AssistantMessage;
    }
  | { type: "message_end"; message: AssistantMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args?: Record<string, string>;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args?: Record<string, string>;
      partialResult?: ToolContent;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result?: ToolContent;
      isError: boolean;
    }
  | {
      type: "auto_compaction_start";
      reason: "threshold" | "overflow";
    }
  | {
      type: "auto_compaction_end";
      result?: CompactionResult | null;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | {
      type: "extension_error";
      extensionPath: string;
      event: string;
      error: string;
    }
  | ({ type: "extension_ui_request"; id: string } & ExtensionUiRequest)
  | ({ type: "agent_state" } & AgentStateData)
  | { type: "session_state"; isStreaming?: boolean }
  | { type: "session_process_exited" }
  | { type: "session_idle_timeout" };

export interface AgentStateData {
  model?: ModelInfo | null;
  thinkingLevel?: string;
  mode?: "chat" | "plan";
  isStreaming?: boolean;
  isCompacting?: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled?: boolean;
  messageCount?: number;
  pendingMessageCount?: number;
  pendingExtensionUiRequest?: (ExtensionUiRequest & { id: string }) | null;
}

export interface StreamEventEnvelope {
  id: number;
  session_id: string;
  workspace_id?: string;
  type: string;
  data: AgentStreamEvent;
  timestamp: number;
}
