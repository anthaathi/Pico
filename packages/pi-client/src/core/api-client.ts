import { client as defaultClient } from "../generated/client.gen";
import * as sdk from "../generated/sdk.gen";
import type {
  AgentSessionInfo,
  PaginatedSessions,
  ActiveSessionSummary,
  AgentSessionCommandResponse,
  AgentRuntimeStatus,
  SessionDetail,
  SessionEntry,
  SessionTreeNode,
  Workspace,
  AuthTokensResponse,
} from "../generated/types.gen";
import type { ImageContent } from "../types/stream-events";

function unwrapResult<T>(result: { data?: unknown; error?: unknown }): T {
  if (result.error !== undefined && result.error !== null) {
    const errBody = result.error;
    if (typeof errBody === "object" && errBody !== null && "error" in errBody) {
      throw new Error((errBody as { error: string }).error);
    }
    throw new Error("Request failed");
  }
  const body = result.data;
  if (body !== null && body !== undefined && typeof body === "object" && "success" in body) {
    const envelope = body as { success: boolean; data?: T; error?: string };
    if (envelope.success === false) {
      throw new Error(envelope.error ?? "Request failed");
    }
    return envelope.data as T;
  }
  return body as T;
}

export class ApiClient {
  private _serverUrl: string;
  private _accessToken: string;

  constructor(serverUrl: string, accessToken: string) {
    this._serverUrl = serverUrl;
    this._accessToken = accessToken;
    defaultClient.setConfig({ baseUrl: serverUrl });
    defaultClient.interceptors.request.use((request) => {
      request.headers.set("Authorization", `Bearer ${this._accessToken}`);
      return request;
    });
  }

  get serverUrl(): string {
    return this._serverUrl;
  }

  get accessToken(): string {
    return this._accessToken;
  }

  updateToken(accessToken: string): void {
    this._accessToken = accessToken;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async login(username: string, password: string): Promise<AuthTokensResponse> {
    const result = await sdk.login({ body: { username, password } });
    return unwrapResult<AuthTokensResponse>(result);
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponse> {
    const result = await sdk.refresh({ body: { refresh_token: refreshToken } });
    return unwrapResult<AuthTokensResponse>(result);
  }

  async logout(refreshToken?: string): Promise<void> {
    const result = await sdk.logout({
      body: refreshToken ? { refresh_token: refreshToken } : undefined,
    });
    unwrapResult(result);
  }

  async checkSession(): Promise<void> {
    const result = await sdk.checkSession({});
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — runtime
  // ---------------------------------------------------------------------------

  async runtimeStatus(): Promise<AgentRuntimeStatus> {
    const result = await sdk.runtimeStatus({});
    return unwrapResult<AgentRuntimeStatus>(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — session lifecycle
  // ---------------------------------------------------------------------------

  async createAgentSession(params: {
    workspaceId: string;
    sessionPath?: string;
  }): Promise<AgentSessionInfo> {
    const result = await sdk.createSession({
      body: {
        workspace_id: params.workspaceId,
        session_path: params.sessionPath,
      },
    });
    return unwrapResult<AgentSessionInfo>(result);
  }

  async touchAgentSession(
    sessionId: string,
    params: { sessionFile: string; workspaceId: string },
  ): Promise<AgentSessionInfo> {
    const result = await sdk.touchSession({
      path: { session_id: sessionId },
      body: {
        session_file: params.sessionFile,
        workspace_id: params.workspaceId,
      },
    });
    return unwrapResult<AgentSessionInfo>(result);
  }

  async killSession(sessionId: string): Promise<void> {
    const result = await sdk.killSession({
      path: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  async listActiveSessions(): Promise<ActiveSessionSummary[]> {
    const result = await sdk.listSessions({});
    return unwrapResult<ActiveSessionSummary[]>(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — prompting
  // ---------------------------------------------------------------------------

  async prompt(params: {
    sessionId: string;
    message: string;
    images?: ImageContent[];
    streamingBehavior?: "steer" | "followUp";
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    const result = await sdk.prompt({
      body: {
        session_id: params.sessionId,
        message: params.message,
        images: params.images,
        streaming_behavior: params.streamingBehavior,
        workspace_id: params.workspaceId,
        session_file: params.sessionFile,
      },
    });
    unwrapResult(result);
  }

  async steer(params: {
    sessionId: string;
    message: string;
    images?: ImageContent[];
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    const result = await sdk.steer({
      body: {
        session_id: params.sessionId,
        message: params.message,
        images: params.images,
        workspace_id: params.workspaceId,
        session_file: params.sessionFile,
      },
    });
    unwrapResult(result);
  }

  async followUp(params: {
    sessionId: string;
    message: string;
    images?: ImageContent[];
    workspaceId?: string;
    sessionFile?: string;
  }): Promise<void> {
    const result = await sdk.followUp({
      body: {
        session_id: params.sessionId,
        message: params.message,
        images: params.images,
        workspace_id: params.workspaceId,
        session_file: params.sessionFile,
      },
    });
    unwrapResult(result);
  }

  async abort(sessionId: string): Promise<void> {
    const result = await sdk.abort({
      body: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — state & config
  // ---------------------------------------------------------------------------

  async getState(sessionId: string): Promise<Record<string, string>> {
    const result = await sdk.getState({
      body: { session_id: sessionId },
    });
    return unwrapResult<Record<string, string>>(result);
  }

  async getMessages(sessionId: string): Promise<{ messages: Record<string, string>[] }> {
    const result = await sdk.getMessages({
      body: { session_id: sessionId },
    });
    return unwrapResult<{ messages: Record<string, string>[] }>(result);
  }

  async setModel(
    sessionId: string,
    params: { provider: string; modelId: string },
  ): Promise<void> {
    const result = await sdk.setModel({
      body: {
        session_id: sessionId,
        provider: params.provider,
        modelId: params.modelId,
      },
    });
    unwrapResult(result);
  }

  async cycleModel(sessionId: string): Promise<void> {
    const result = await sdk.cycleModel({
      body: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  async getAvailableModels(
    sessionId: string,
  ): Promise<{ models: Record<string, string>[] }> {
    const result = await sdk.getAvailableModels({
      body: { session_id: sessionId },
    });
    return unwrapResult<{ models: Record<string, string>[] }>(result);
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const result = await sdk.setThinkingLevel({
      body: { session_id: sessionId, level },
    });
    unwrapResult(result);
  }

  async cycleThinkingLevel(sessionId: string): Promise<void> {
    const result = await sdk.cycleThinkingLevel({
      body: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    const result = await sdk.setSteeringMode({
      body: { session_id: sessionId, mode },
    });
    unwrapResult(result);
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    const result = await sdk.setFollowUpMode({
      body: { session_id: sessionId, mode },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — compaction & retry
  // ---------------------------------------------------------------------------

  async compact(sessionId: string, customInstructions?: string): Promise<void> {
    const result = await sdk.compact({
      body: { session_id: sessionId, customInstructions },
    });
    unwrapResult(result);
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    const result = await sdk.setAutoCompaction({
      body: { session_id: sessionId, enabled },
    });
    unwrapResult(result);
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    const result = await sdk.setAutoRetry({
      body: { session_id: sessionId, enabled },
    });
    unwrapResult(result);
  }

  async abortRetry(sessionId: string): Promise<void> {
    const result = await sdk.abortRetry({
      body: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — bash
  // ---------------------------------------------------------------------------

  async bash(
    sessionId: string,
    command: string,
  ): Promise<{
    output: string;
    exitCode: number;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string | null;
  }> {
    const result = await sdk.bash({
      body: { session_id: sessionId, command },
    });
    return unwrapResult(result);
  }

  async abortBash(sessionId: string): Promise<void> {
    const result = await sdk.abortBash({
      body: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — session switching / forking
  // ---------------------------------------------------------------------------

  async newSession(
    sessionId: string,
    parentSession?: string,
  ): Promise<AgentSessionCommandResponse> {
    const result = await sdk.newSession({
      body: { session_id: sessionId, parentSession },
    });
    return unwrapResult<AgentSessionCommandResponse>(result);
  }

  async switchSession(
    sessionId: string,
    sessionPath: string,
  ): Promise<AgentSessionCommandResponse> {
    const result = await sdk.switchSession({
      body: { session_id: sessionId, sessionPath },
    });
    return unwrapResult<AgentSessionCommandResponse>(result);
  }

  async fork(
    sessionId: string,
    entryId: string,
  ): Promise<{ text: string; cancelled: boolean }> {
    const result = await sdk.fork({
      body: { session_id: sessionId, entryId },
    });
    return unwrapResult(result);
  }

  async getForkMessages(
    sessionId: string,
  ): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
    const result = await sdk.getForkMessages({
      body: { session_id: sessionId },
    });
    return unwrapResult(result);
  }

  async getLastAssistantText(sessionId: string): Promise<{ text: string | null }> {
    const result = await sdk.getLastAssistantText({
      body: { session_id: sessionId },
    });
    return unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — stats / export / name / commands
  // ---------------------------------------------------------------------------

  async getSessionStats(sessionId: string): Promise<{
    sessionFile: string;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
  }> {
    const result = await sdk.getSessionStats({
      body: { session_id: sessionId },
    });
    return unwrapResult(result);
  }

  async exportHtml(
    sessionId: string,
    outputPath?: string,
  ): Promise<{ path: string }> {
    const result = await sdk.exportHtml({
      body: { session_id: sessionId, outputPath },
    });
    return unwrapResult(result);
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const result = await sdk.setSessionName({
      body: { session_id: sessionId, name },
    });
    unwrapResult(result);
  }

  async getCommands(
    sessionId: string,
  ): Promise<{
    commands: Array<{
      name: string;
      description?: string;
      source: "extension" | "prompt" | "skill";
      location?: "user" | "project" | "path";
      path?: string;
    }>;
  }> {
    const result = await sdk.getCommands({
      body: { session_id: sessionId },
    });
    return unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Agent — extension UI
  // ---------------------------------------------------------------------------

  async extensionUiResponse(params: {
    sessionId: string;
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): Promise<void> {
    const result = await sdk.extensionUiResponse({
      body: {
        session_id: params.sessionId,
        id: params.id,
        value: params.value,
        confirmed: params.confirmed,
        cancelled: params.cancelled,
      },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Chat — session lifecycle
  // ---------------------------------------------------------------------------

  async createChatSession(params?: {
    noTools?: boolean;
    systemPrompt?: string;
  }): Promise<AgentSessionInfo> {
    const result = await sdk.createSession2({
      body: {
        no_tools: params?.noTools,
        system_prompt: params?.systemPrompt,
      },
    });
    return unwrapResult<AgentSessionInfo>(result);
  }

  async listChatSessions(params?: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedSessions> {
    const result = await sdk.listSessions2({
      query: { page: params?.page, limit: params?.limit },
    });
    return unwrapResult<PaginatedSessions>(result);
  }

  async touchChatSession(
    sessionId: string,
    sessionFile?: string,
  ): Promise<AgentSessionInfo> {
    const result = await sdk.touchSession2({
      path: { session_id: sessionId },
      body: { session_file: sessionFile },
    });
    return unwrapResult<AgentSessionInfo>(result);
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    const result = await sdk.deleteSession({
      path: { session_id: sessionId },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  async listWorkspaces(includeArchived?: boolean): Promise<Workspace[]> {
    const result = await sdk.list2({
      query: { include_archived: includeArchived },
    });
    return unwrapResult<Workspace[]>(result);
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const result = await sdk.get({ path: { id } });
    return unwrapResult<Workspace>(result);
  }

  async createWorkspace(params: {
    name: string;
    path: string;
    color?: string;
    workspaceEnabled?: boolean;
    startupScript?: string;
  }): Promise<Workspace> {
    const result = await sdk.create({
      body: {
        name: params.name,
        path: params.path,
        color: params.color,
        workspace_enabled: params.workspaceEnabled,
        startup_script: params.startupScript,
      },
    });
    return unwrapResult<Workspace>(result);
  }

  async updateWorkspace(
    id: string,
    params: {
      name?: string;
      path?: string;
      color?: string;
      workspaceEnabled?: boolean;
      startupScript?: string;
    },
  ): Promise<Workspace> {
    const result = await sdk.update2({
      path: { id },
      body: {
        name: params.name,
        path: params.path,
        color: params.color,
        workspace_enabled: params.workspaceEnabled,
        startup_script: params.startupScript,
      },
    });
    return unwrapResult<Workspace>(result);
  }

  async deleteWorkspace(id: string): Promise<void> {
    const result = await sdk.delete2({ path: { id } });
    unwrapResult(result);
  }

  async archiveWorkspace(id: string): Promise<Workspace> {
    const result = await sdk.archive({ path: { id } });
    return unwrapResult<Workspace>(result);
  }

  async unarchiveWorkspace(id: string): Promise<Workspace> {
    const result = await sdk.unarchive({ path: { id } });
    return unwrapResult<Workspace>(result);
  }

  async suggestWorkspaces(): Promise<string[]> {
    const result = await sdk.suggestWorkspaces({});
    return unwrapResult<string[]>(result);
  }

  // ---------------------------------------------------------------------------
  // Workspace sessions (file-based)
  // ---------------------------------------------------------------------------

  async listWorkspaceSessions(
    workspaceId: string,
    params?: { page?: number; limit?: number },
  ): Promise<PaginatedSessions> {
    const result = await sdk.sessionsList({
      path: { id: workspaceId },
      query: { page: params?.page, limit: params?.limit },
    });
    return unwrapResult<PaginatedSessions>(result);
  }

  async getWorkspaceSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<SessionDetail> {
    const result = await sdk.sessionsGet({
      path: { id: workspaceId, session_id: sessionId },
    });
    return unwrapResult<SessionDetail>(result);
  }

  async deleteWorkspaceSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await sdk.sessionsDelete({
      path: { id: workspaceId, session_id: sessionId },
    });
    unwrapResult(result);
  }

  async getSessionTree(
    workspaceId: string,
    sessionId: string,
  ): Promise<SessionTreeNode[]> {
    const result = await sdk.sessionsTree({
      path: { id: workspaceId, session_id: sessionId },
    });
    return unwrapResult<SessionTreeNode[]>(result);
  }

  async getSessionLeaf(
    workspaceId: string,
    sessionId: string,
  ): Promise<SessionEntry> {
    const result = await sdk.sessionsLeaf({
      path: { id: workspaceId, session_id: sessionId },
    });
    return unwrapResult<SessionEntry>(result);
  }

  async getSessionChildren(
    workspaceId: string,
    sessionId: string,
    entryId: string,
  ): Promise<SessionEntry[]> {
    const result = await sdk.sessionsChildren({
      path: { id: workspaceId, session_id: sessionId, entry_id: entryId },
    });
    return unwrapResult<SessionEntry[]>(result);
  }

  async getSessionBranch(
    workspaceId: string,
    sessionId: string,
    entryId: string,
  ): Promise<SessionEntry[]> {
    const result = await sdk.sessionsBranch({
      path: { id: workspaceId, session_id: sessionId, entry_id: entryId },
    });
    return unwrapResult<SessionEntry[]>(result);
  }

  // ---------------------------------------------------------------------------
  // Stream URLs
  // ---------------------------------------------------------------------------

  getStreamUrl(from?: number): string {
    const url = new URL(`${this._serverUrl}/api/stream`);
    if (from !== undefined) url.searchParams.set("from", String(from));
    return url.toString();
  }

  getWsStreamUrl(from?: number): string {
    const httpUrl = new URL(`${this._serverUrl}/ws/stream`);
    if (from !== undefined) httpUrl.searchParams.set("from", String(from));
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return httpUrl.toString();
  }
}
