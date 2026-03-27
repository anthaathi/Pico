pub mod agent;
pub mod mode;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AuthTokensResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: DateTime<Utc>,
    pub refresh_expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionInfo {
    pub access_token: String,
    pub refresh_token: String,
    pub username: String,
    pub created_at: DateTime<Utc>,
    pub access_expires_at: DateTime<Utc>,
    pub refresh_expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PackageStatus {
    pub name: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct OperationLog {
    pub id: i64,
    pub operation: String,
    pub status: String,
    pub output: String,
    pub created_at: String,
}


#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct OperationResult {
    pub operation: String,
    pub success: bool,
    pub output: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct VersionResponse {
    pub name: String,
    pub version: String,
    pub server_id: String,
    /// Whether the server has desktop/remote mode enabled (Linux only).
    pub remote: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    pub success: bool,
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    Active,
    Archived,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub workspace_enabled: bool,
    pub startup_script: Option<String>,
    pub status: WorkspaceStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub workspace_enabled: Option<bool>,
    pub startup_script: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateWorkspaceRequest {
    pub name: Option<String>,
    pub path: Option<String>,
    pub color: Option<String>,
    pub workspace_enabled: Option<bool>,
    pub startup_script: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PairRequest {
    pub qr_id: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct LogoutRequest {
    pub refresh_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PathCompletion {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsListResponse {
    pub path: String,
    pub entries: Vec<FsEntry>,
    pub total: u32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsReadResponse {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
    pub offset: u64,
    pub length: u64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsWriteRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsDeleteRequest {
    pub path: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsMkdirRequest {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsUploadFileResult {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FsUploadResponse {
    pub total: u32,
    pub succeeded: u32,
    pub files: Vec<FsUploadFileResult>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitStatusResponse {
    pub branch: String,
    pub is_clean: bool,
    pub staged: Vec<GitFileEntry>,
    pub unstaged: Vec<GitFileEntry>,
    pub untracked: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub remotes: Vec<GitRemote>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct NestedGitRepo {
    /// Relative path from the workspace root
    pub path: String,
    pub branch: String,
    pub remotes: Vec<GitRemote>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct NestedGitReposResponse {
    pub repos: Vec<NestedGitRepo>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitFileEntry {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub commit: String,
    pub is_bare: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitCheckoutRequest {
    pub branch: String,
    pub create: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitWorktreeAddRequest {
    pub path: String,
    pub branch: Option<String>,
    pub new_branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitWorktreeRemoveRequest {
    pub path: String,
    pub force: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitDiffResponse {
    pub diff: String,
    pub stats: String,
    pub files_changed: u32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitFileDiffResponse {
    pub path: String,
    pub diff: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitStashEntry {
    pub index: u32,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitPathsRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitCommitRequest {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GitStashApplyRequest {
    pub index: Option<u32>,
    pub pop: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionListItem {
    pub id: String,
    pub cwd: String,
    pub created_at: String,
    pub last_active: u64,
    pub version: u32,
    pub display_name: Option<String>,
    pub message_count: u32,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PaginatedSessions {
    pub items: Vec<SessionListItem>,
    pub page: u32,
    pub limit: u32,
    pub total: u32,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionHeader {
    pub version: u32,
    pub id: String,
    pub timestamp: String,
    pub cwd: String,
    pub parent_session: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SessionEntry {
    pub id: String,
    pub parent_id: Option<String>,
    pub entry_type: String,
    pub role: Option<String>,
    pub timestamp: String,
    pub preview: Option<String>,
    pub raw: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionDetail {
    pub header: SessionHeader,
    pub entries: Vec<SessionEntry>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[schema(no_recursion)]
pub struct SessionTreeNode {
    pub id: String,
    pub entry_type: String,
    pub role: Option<String>,
    pub timestamp: String,
    pub children: Vec<SessionTreeNode>,
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/// A single task definition – either from .pi/tasks.json or auto-detected
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TaskDefinition {
    pub label: String,
    #[serde(default = "default_task_type")]
    #[serde(rename = "type")]
    pub task_type: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub is_background: Option<bool>,
    #[serde(default)]
    pub auto_run: Option<bool>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    /// Where this task was detected from: "npm", "make", "cargo", "docker-compose",
    /// "pip", "gradle", "pi" (from .pi/tasks.json), etc.
    #[serde(default = "default_source_pi")]
    pub source: String,
}

fn default_task_type() -> String {
    "shell".to_string()
}

fn default_source_pi() -> String {
    "pi".to_string()
}

/// Tasks configuration file format
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TasksConfig {
    #[serde(default = "default_tasks_version")]
    pub version: String,
    pub tasks: Vec<TaskDefinition>,
}

fn default_tasks_version() -> String {
    "1.0".to_string()
}

/// Status of a running task
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Stopped,
    Failed,
}

/// Runtime info about a task instance
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TaskInfo {
    pub id: String,
    pub label: String,
    pub command: String,
    pub workspace_id: String,
    pub status: TaskStatus,
    pub exit_code: Option<i32>,
    pub started_at: String,
    pub stopped_at: Option<String>,
    /// Source of the task: "npm", "make", "cargo", "pi", etc.
    pub source: String,
}

/// Task log output
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TaskLogs {
    pub id: String,
    pub label: String,
    pub lines: Vec<String>,
    pub total_lines: u32,
}

/// Request to start a task
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct StartTaskRequest {
    pub label: String,
    pub workspace_id: String,
}

/// Request to stop/restart a task
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct TaskActionRequest {
    pub task_id: String,
}
