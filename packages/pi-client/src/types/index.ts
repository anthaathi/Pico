export * from "./stream-events";
export * from "./chat-message";

export type {
  AgentMode,
  AgentSessionInfo,
  ActiveSessionSummary,
  AgentRuntimeStatus,
  AgentSessionCommandResponse,
  AuthTokensResponse,
  CustomModelEntry,
  CustomModelsConfig,
  CustomProvider,
  FsEntry,
  FsListResponse,
  FsReadResponse,
  FsUploadFileResult,
  FsUploadResponse,
  GitBranch,
  GitDiffResponse,
  GitFileDiffResponse,
  GitFileEntry,
  GitLogEntry,
  GitRemote,
  GitStashEntry,
  GitStatusResponse,
  GitWorktree,
  NestedGitRepo,
  NestedGitReposResponse,
  PackageStatus,
  PaginatedSessions,
  PathCompletion,
  SessionDetail,
  SessionEntry,
  SessionHistoryResponse,
  SessionListItem,
  SessionTreeNode,
  TaskDefinition,
  TaskInfo,
  TaskLogs,
  TasksConfig,
  Workspace,
} from "../generated/types.gen";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  retryAttempt: number;
  nextRetryAt: number | null;
  lastDisconnectReason: string | null;
  disconnectedAt: number | null;
}

export interface PiClientConfig {
  serverUrl: string;
  accessToken: string;
  onAuthError?: () => void;
  onApiAuthError?: () => Promise<string | null>;
  transport?: "sse" | "ws";
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}
