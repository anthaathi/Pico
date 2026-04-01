export interface StreamEvent {
  id: number;
  session_id: string;
  workspace_id?: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
}

export type AgentConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface AgentConnectionState {
  status: AgentConnectionStatus;
  retryAttempt: number;
  nextRetryAt: number | null;
  lastDisconnectReason: string | null;
  disconnectedAt: number | null;
}

export interface SubagentProgress {
  agent?: string;
  status?: string;
  durationMs?: number;
  toolCount?: number;
  recentTools?: { tool: string; args: string; endMs?: number }[];
  recentOutput?: string[];
}

export interface SubagentMeta {
  model?: string;
  provider?: string;
  toolCount?: number;
  tokens?: number;
  durationMs?: number;
  cost?: number;
  turns?: number;
}

export interface ToolResultImage {
  data: string;
  mimeType: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "streaming" | "pending" | "running" | "complete" | "error";
  result?: string;
  resultImages?: ToolResultImage[];
  isError?: boolean;
  partialResult?: string;
  progress?: SubagentProgress;
  subagentMeta?: SubagentMeta;
  diff?: string;
  previousId?: string;
  contentIndex?: number;
}

export interface MessageUsageInfo {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  totalTokens?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
  currency?: string;
}

export interface TurnFileStats {
  filesEdited: number;
  filesCreated: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  errorMessage?: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  timestamp: number;
  isStreaming?: boolean;
  model?: string;
  provider?: string;
  api?: string;
  responseId?: string;
  usage?: MessageUsageInfo;
  stopReason?: string;
  turnDurationMs?: number;
  turnFileStats?: TurnFileStats;
  systemKind?: "bashExecution" | "event";
  command?: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string | null;
}
