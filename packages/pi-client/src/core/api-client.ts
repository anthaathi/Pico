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
  GitStatusResponse,
  GitBranch,
  GitLogEntry,
  GitDiffResponse,
  GitFileDiffResponse,
  GitStashEntry,
  GitWorktree,
  NestedGitReposResponse,
  PackageStatus,
  TaskInfo,
  TasksConfig,
  TaskLogs,
  TaskDefinition,
  AgentMode,
  CustomModelsConfig,
  CustomProvider,
  FsListResponse,
  FsReadResponse,
  FsEntry,
  FsUploadResponse,
  PathCompletion,
  SessionHistoryResponse,
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
  if (
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    "success" in body
  ) {
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
  private _onAuthError?: () => Promise<string | null>;

  constructor(serverUrl: string, accessToken: string) {
    this._serverUrl = serverUrl;
    this._accessToken = accessToken;
  }

  get serverUrl(): string {
    return this._serverUrl;
  }

  get accessToken(): string {
    return this._accessToken;
  }

  updateConfig(serverUrl: string, accessToken: string): void {
    this._serverUrl = serverUrl;
    this._accessToken = accessToken;
  }

  updateToken(accessToken: string): void {
    this._accessToken = accessToken;
  }

  setAuthErrorHandler(handler: () => Promise<string | null>): void {
    this._onAuthError = handler;
  }

  private buildApiUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this._serverUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async authFetch(input: string, init?: RequestInit, allowRetry = true): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this._accessToken}`);

    const response = await fetch(input, {
      ...init,
      headers,
    });

    if (response.status !== 401 || !allowRetry || !this._onAuthError) {
      return response;
    }

    const newToken = await this._onAuthError();
    if (!newToken) return response;

    this._accessToken = newToken;
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("Authorization", `Bearer ${newToken}`);

    return fetch(input, {
      ...init,
      headers: retryHeaders,
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async login(
    username: string,
    password: string,
    baseUrl?: string,
  ): Promise<AuthTokensResponse> {
    const result = await sdk.login({
      body: { username, password },
      ...(baseUrl && { baseUrl }),
    });
    return unwrapResult<AuthTokensResponse>(result);
  }

  async refresh(
    refreshToken: string,
    baseUrl?: string,
  ): Promise<AuthTokensResponse> {
    const result = await sdk.refresh({
      body: { refresh_token: refreshToken },
      ...(baseUrl && { baseUrl }),
    });
    return unwrapResult<AuthTokensResponse>(result);
  }

  async logout(refreshToken?: string, baseUrl?: string): Promise<void> {
    const result = await sdk.logout({
      body: refreshToken ? { refresh_token: refreshToken } : undefined,
      ...(baseUrl && { baseUrl }),
    });
    unwrapResult(result);
  }

  async pair(
    qrId: string,
    baseUrl?: string,
  ): Promise<AuthTokensResponse> {
    const result = await sdk.pair({
      body: { qr_id: qrId },
      ...(baseUrl && { baseUrl }),
    });
    return unwrapResult<AuthTokensResponse>(result);
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
    modeId?: string;
  }): Promise<AgentSessionInfo> {
    const result = await sdk.createSession({
      body: {
        workspace_id: params.workspaceId,
        session_path: params.sessionPath,
        mode_id: params.modeId,
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

  async getMessages(
    sessionId: string,
  ): Promise<{ messages: Record<string, string>[] }> {
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

  async compact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<void> {
    const result = await sdk.compact({
      body: { session_id: sessionId, customInstructions },
    });
    unwrapResult(result);
  }

  async setAutoCompaction(
    sessionId: string,
    enabled: boolean,
  ): Promise<void> {
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

  async getLastAssistantText(
    sessionId: string,
  ): Promise<{ text: string | null }> {
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
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
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

  async getCommands(sessionId: string): Promise<{
    commands: Array<{
      name: string;
      description?: string;
      source?: "extension" | "prompt" | "skill";
      location?: "user" | "project" | "path";
      path?: string;
      sourceInfo?: {
        path?: string;
        scope?: "user" | "project";
        source?: string;
      };
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
    modeId?: string;
  }): Promise<AgentSessionInfo> {
    const result = await sdk.createSession2({
      body: {
        no_tools: params?.noTools,
        system_prompt: params?.systemPrompt,
        mode_id: params?.modeId,
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
  // Git
  // ---------------------------------------------------------------------------

  async gitStatus(cwd: string): Promise<GitStatusResponse> {
    const result = await sdk.status({ query: { cwd } });
    return unwrapResult<GitStatusResponse>(result);
  }

  async gitBranches(cwd: string): Promise<GitBranch[]> {
    const result = await sdk.branches({ query: { cwd } });
    return unwrapResult<GitBranch[]>(result);
  }

  async gitCheckout(
    cwd: string,
    params: { branch: string; create?: boolean },
  ): Promise<void> {
    const result = await sdk.checkout({
      query: { cwd },
      body: {
        branch: params.branch,
        create: params.create,
      },
    });
    unwrapResult(result);
  }

  async gitCommit(cwd: string, message: string): Promise<void> {
    const result = await sdk.commit({ query: { cwd }, body: { message } });
    unwrapResult(result);
  }

  async gitDiff(
    cwd: string,
    staged?: boolean,
  ): Promise<GitDiffResponse> {
    const result = await sdk.diff({ query: { cwd, staged } });
    return unwrapResult<GitDiffResponse>(result);
  }

  async gitDiffFile(
    cwd: string,
    path: string,
    staged?: boolean,
  ): Promise<GitFileDiffResponse> {
    const result = await sdk.diffFile({ query: { cwd, path, staged } });
    return unwrapResult<GitFileDiffResponse>(result);
  }

  async gitDiscard(cwd: string, paths: string[]): Promise<void> {
    const result = await sdk.discard({ query: { cwd }, body: { paths } });
    unwrapResult(result);
  }

  async gitLog(
    cwd: string,
    count?: number,
  ): Promise<GitLogEntry[]> {
    const result = await sdk.log({ query: { cwd, count } });
    return unwrapResult<GitLogEntry[]>(result);
  }

  async gitStage(cwd: string, paths: string[]): Promise<void> {
    const result = await sdk.stage({ query: { cwd }, body: { paths } });
    unwrapResult(result);
  }

  async gitUnstage(cwd: string, paths: string[]): Promise<void> {
    const result = await sdk.unstage({ query: { cwd }, body: { paths } });
    unwrapResult(result);
  }

  async gitNestedRepos(cwd: string): Promise<NestedGitReposResponse> {
    const result = await sdk.nestedRepos({ query: { cwd } });
    return unwrapResult<NestedGitReposResponse>(result);
  }

  async gitStashList(cwd: string): Promise<GitStashEntry[]> {
    const result = await sdk.stashList({ query: { cwd } });
    return unwrapResult<GitStashEntry[]>(result);
  }

  async gitStashPush(cwd: string, message?: string): Promise<void> {
    const result = await sdk.stashPush({
      query: { cwd, message },
    });
    unwrapResult(result);
  }

  async gitStashApply(cwd: string, index?: number, pop?: boolean): Promise<void> {
    const result = await sdk.stashApply({
      query: { cwd },
      body: { index, pop },
    });
    unwrapResult(result);
  }

  async gitStashDrop(cwd: string, index: number): Promise<void> {
    const result = await sdk.stashDrop({
      query: { cwd, index },
    });
    unwrapResult(result);
  }

  async gitWorktreeList(cwd: string): Promise<GitWorktree[]> {
    const result = await sdk.worktreeList({ query: { cwd } });
    return unwrapResult<GitWorktree[]>(result);
  }

  async gitWorktreeAdd(
    cwd: string,
    params: { path: string; branch?: string; newBranch?: string },
  ): Promise<void> {
    const result = await sdk.worktreeAdd({
      query: { cwd },
      body: {
        path: params.path,
        branch: params.branch,
        new_branch: params.newBranch,
      },
    });
    unwrapResult(result);
  }

  async gitWorktreeRemove(cwd: string, path: string): Promise<void> {
    const result = await sdk.worktreeRemove({
      query: { cwd },
      body: { path },
    });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------

  async fsList(path: string): Promise<FsListResponse> {
    const result = await sdk.list({ query: { path } });
    return unwrapResult<FsListResponse>(result);
  }

  async fsRead(path: string): Promise<FsReadResponse> {
    const result = await sdk.read({ query: { path } });
    return unwrapResult<FsReadResponse>(result);
  }

  async fsWrite(path: string, content: string): Promise<void> {
    const result = await sdk.write({ body: { path, content } });
    unwrapResult(result);
  }

  async fsDelete(path: string): Promise<void> {
    const result = await sdk.delete_({ body: { path } });
    unwrapResult(result);
  }

  async fsMkdir(path: string): Promise<void> {
    const result = await sdk.mkdir({ body: { path } });
    unwrapResult(result);
  }

  async fsComplete(input: string): Promise<PathCompletion[]> {
    const result = await sdk.complete({ query: { q: input } });
    return unwrapResult<PathCompletion[]>(result);
  }

  async fsUpload(params: {
    path: string;
    createFormData: () => FormData;
    onProgress?: (loaded: number, total: number) => void;
  }): Promise<FsUploadResponse> {
    const url = this.buildApiUrl("/api/fs/upload", { path: params.path });

    const execute = (allowRetry: boolean) =>
      new Promise<FsUploadResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${this._accessToken}`);
        xhr.responseType = "text";

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            params.onProgress?.(event.loaded, event.total);
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.onabort = () => reject(new Error("Upload cancelled"));
        xhr.onload = async () => {
          if (xhr.status === 401 && allowRetry && this._onAuthError) {
            const newToken = await this._onAuthError();
            if (newToken) {
              this._accessToken = newToken;
              execute(false).then(resolve).catch(reject);
              return;
            }
          }

          let parsed: any = null;
          try {
            parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            // ignore parse failure and use status handling below
          }

          if (xhr.status < 200 || xhr.status >= 300) {
            const message = parsed?.error ?? parsed?.output ?? `Upload failed (${xhr.status})`;
            reject(new Error(message));
            return;
          }

          try {
            resolve(unwrapResult<FsUploadResponse>({ data: parsed }));
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Upload failed"));
          }
        };

        xhr.send(params.createFormData());
      });

    return execute(true);
  }

  async fsDownload(path: string): Promise<{
    data: Uint8Array;
    fileName: string;
    contentType: string;
  }> {
    const url = this.buildApiUrl("/api/fs/download", { path });
    const response = await this.authFetch(url);

    if (!response.ok) {
      let message = `Download failed (${response.status})`;
      try {
        const data = await response.json();
        if (data && typeof data === "object") {
          message = (data as any).error ?? message;
        }
      } catch {
        // ignore json parse errors
      }
      throw new Error(message);
    }

    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    const fileName = fileNameMatch?.[1] ?? path.split("/").pop() ?? "file";
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await response.arrayBuffer();

    return {
      data: new Uint8Array(buffer),
      fileName,
      contentType,
    };
  }

  // ---------------------------------------------------------------------------
  // Package management
  // ---------------------------------------------------------------------------

  async packageStatus(): Promise<PackageStatus> {
    const result = await sdk.status2({});
    return unwrapResult<PackageStatus>(result);
  }

  async packageUpdate(): Promise<void> {
    const result = await sdk.update({});
    unwrapResult(result);
  }

  async packageInstall(): Promise<void> {
    const result = await sdk.install({});
    unwrapResult(result);
  }

  async packageLogs(limit?: number): Promise<TaskLogs> {
    const result = await sdk.logs({ query: { limit } });
    return unwrapResult<TaskLogs>(result);
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  async getTaskConfig(workspaceId: string): Promise<TasksConfig> {
    const result = await sdk.getConfig({ path: { workspace_id: workspaceId } });
    return unwrapResult<TasksConfig>(result);
  }

  async listTasks(workspaceId: string): Promise<TaskInfo[]> {
    const result = await sdk.listTasks({ path: { workspace_id: workspaceId } });
    return unwrapResult<TaskInfo[]>(result);
  }

  async startTask(label: string, workspaceId: string): Promise<TaskInfo> {
    const result = await sdk.startTask({
      body: { label, workspace_id: workspaceId },
    });
    return unwrapResult<TaskInfo>(result);
  }

  async stopTask(taskId: string): Promise<TaskInfo> {
    const result = await sdk.stopTask({ body: { task_id: taskId } });
    return unwrapResult<TaskInfo>(result);
  }

  async restartTask(taskId: string): Promise<TaskInfo> {
    const result = await sdk.restartTask({ body: { task_id: taskId } });
    return unwrapResult<TaskInfo>(result);
  }

  async removeTask(taskId: string): Promise<void> {
    const result = await sdk.removeTask({ path: { task_id: taskId } });
    unwrapResult(result);
  }

  async getTaskLogs(taskId: string): Promise<TaskLogs> {
    const result = await sdk.getLogs({ path: { task_id: taskId } });
    return unwrapResult<TaskLogs>(result);
  }

  // ---------------------------------------------------------------------------
  // Custom models
  // ---------------------------------------------------------------------------

  async getCustomModels(): Promise<CustomModelsConfig> {
    const result = await sdk.getCustomModels({});
    return unwrapResult<CustomModelsConfig>(result);
  }

  async saveCustomModels(config: { providers: Record<string, CustomProvider> }): Promise<void> {
    const result = await sdk.saveCustomModels({ body: { providers: config.providers } });
    unwrapResult(result);
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------

  async listModes(): Promise<AgentMode[]> {
    const result = await sdk.listModes();
    return unwrapResult<AgentMode[]>(result);
  }

  async createMode(params: {
    name: string;
    description?: string;
    model?: string;
    thinkingLevel?: string;
    extensions?: string[];
    skills?: string[];
    extraArgs?: string[];
    isDefault?: boolean;
    sortOrder?: number;
  }): Promise<AgentMode> {
    const result = await sdk.createMode({
      body: {
        name: params.name,
        description: params.description,
        model: params.model,
        thinking_level: params.thinkingLevel,
        extensions: Array.isArray(params.extensions) && params.extensions.length > 0 ? params.extensions : undefined,
        skills: Array.isArray(params.skills) && params.skills.length > 0 ? params.skills : undefined,
        extra_args: Array.isArray(params.extraArgs) && params.extraArgs.length > 0 ? params.extraArgs : undefined,
        is_default: params.isDefault,
        sort_order: params.sortOrder,
      },
    });
    return unwrapResult<AgentMode>(result);
  }

  async updateMode(
    modeId: string,
    params: {
      name?: string;
      description?: string;
      model?: string;
      thinkingLevel?: string;
      extensions?: string[];
      skills?: string[];
      extraArgs?: string[];
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): Promise<AgentMode> {
    const result = await sdk.updateMode({
      path: { mode_id: modeId },
      body: {
        name: params.name,
        description: params.description,
        model: params.model,
        thinking_level: params.thinkingLevel,
        extensions: Array.isArray(params.extensions) ? params.extensions : undefined,
        skills: Array.isArray(params.skills) ? params.skills : undefined,
        extra_args: Array.isArray(params.extraArgs) ? params.extraArgs : undefined,
        is_default: params.isDefault,
        sort_order: params.sortOrder,
      },
    });
    return unwrapResult<AgentMode>(result);
  }

  async deleteMode(modeId: string): Promise<void> {
    const result = await sdk.deleteMode({ path: { mode_id: modeId } });
    unwrapResult(result);
  }

  async getSessionMode(sessionId: string): Promise<{ session_id: string; mode: AgentMode | null }> {
    const result = await sdk.getSessionMode({ path: { session_id: sessionId } });
    return unwrapResult<{ session_id: string; mode: AgentMode | null }>(result);
  }

  // ---------------------------------------------------------------------------
  // Session history (REST)
  // ---------------------------------------------------------------------------

  async getSessionHistory(
    sessionId: string,
    params?: { before?: string; limit?: number },
  ): Promise<SessionHistoryResponse> {
    const result = await sdk.sessionHistory({
      path: { session_id: sessionId },
      query: { before: params?.before, limit: params?.limit },
    });
    return unwrapResult<SessionHistoryResponse>(result);
  }

  // ---------------------------------------------------------------------------
  // Active session (per-connection)
  // ---------------------------------------------------------------------------

  async setActiveSession(
    connectionId: string,
    sessionId: string | null,
    fromEventId?: number,
    fromDeltaEventId?: number,
  ): Promise<void> {
    const url = this.buildApiUrl("/api/stream-active-session");
    const response = await this.authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection_id: connectionId,
        session_id: sessionId,
        from_event_id: fromEventId,
        from_delta_event_id: fromDeltaEventId,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error((body as any)?.error ?? `setActiveSession failed (${response.status})`);
    }
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
