use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::server::state::AppState;
use crate::models::*;
use crate::routes::auth::require_auth;
use crate::services::git;

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct CwdQuery {
    pub cwd: String,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct LogQuery {
    pub cwd: String,
    pub count: Option<u32>,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct DiffQuery {
    pub cwd: String,
    pub staged: Option<bool>,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct FileDiffQuery {
    pub cwd: String,
    pub path: String,
    pub staged: Option<bool>,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct StashDropQuery {
    pub cwd: String,
    pub index: u32,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct StashPushQuery {
    pub cwd: String,
    pub message: Option<String>,
}

fn git_op_result(op: &str, result: Result<String, String>) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    match result {
        Ok(out) => (StatusCode::OK, Json(ApiResponse::ok(OperationResult { operation: op.to_string(), success: true, output: out }))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::ok(OperationResult { operation: op.to_string(), success: false, output: e }))),
    }
}

macro_rules! auth_guard {
    ($state:expr, $headers:expr) => {
        if let Err((code, msg)) = require_auth($state, $headers).await {
            return (code, Json(ApiResponse::err(msg)));
        }
    };
}

#[utoipa::path(
    get,
    path = "/api/git/status",
    params(("cwd" = String, Query, description = "Working directory path")),
    responses(
        (status = 200, description = "Git status", body = GitStatusResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
) -> (StatusCode, Json<ApiResponse<GitStatusResponse>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    match tokio::task::spawn_blocking(move || git::status(&cwd)).await.unwrap() {
        Ok(s) => (StatusCode::OK, Json(ApiResponse::ok(s))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/repos",
    params(("cwd" = String, Query, description = "Working directory path")),
    responses(
        (status = 200, description = "Nested git repos", body = NestedGitReposResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn nested_repos(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
) -> (StatusCode, Json<ApiResponse<NestedGitReposResponse>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let result = tokio::task::spawn_blocking(move || git::nested_repos(&cwd, 3))
        .await
        .unwrap();
    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

#[utoipa::path(
    get,
    path = "/api/git/branches",
    params(("cwd" = String, Query, description = "Working directory path")),
    responses(
        (status = 200, description = "Branch list", body = Vec<GitBranch>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn branches(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<GitBranch>>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    match tokio::task::spawn_blocking(move || git::branches(&cwd)).await.unwrap() {
        Ok(b) => (StatusCode::OK, Json(ApiResponse::ok(b))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/log",
    params(
        ("cwd" = String, Query, description = "Working directory path"),
        ("count" = Option<u32>, Query, description = "Number of commits (default: 20)")
    ),
    responses(
        (status = 200, description = "Commit log", body = Vec<GitLogEntry>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn log(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<LogQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<GitLogEntry>>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let count = params.count.unwrap_or(20);
    match tokio::task::spawn_blocking(move || git::log(&cwd, count)).await.unwrap() {
        Ok(l) => (StatusCode::OK, Json(ApiResponse::ok(l))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    post,
    path = "/api/git/checkout",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitCheckoutRequest,
    responses(
        (status = 200, description = "Checkout result", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn checkout(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitCheckoutRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let branch = req.branch;
    let create = req.create.unwrap_or(false);
    match tokio::task::spawn_blocking(move || git::checkout(&cwd, &branch, create)).await.unwrap() {
        Ok(out) => (
            StatusCode::OK,
            Json(ApiResponse::ok(OperationResult {
                operation: "checkout".to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: "checkout".to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/worktrees",
    params(("cwd" = String, Query, description = "Working directory path")),
    responses(
        (status = 200, description = "Worktree list", body = Vec<GitWorktree>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn worktree_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<GitWorktree>>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    match tokio::task::spawn_blocking(move || git::worktree_list(&cwd)).await.unwrap() {
        Ok(w) => (StatusCode::OK, Json(ApiResponse::ok(w))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    post,
    path = "/api/git/worktrees",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitWorktreeAddRequest,
    responses(
        (status = 201, description = "Worktree added", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn worktree_add(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitWorktreeAddRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    match tokio::task::spawn_blocking(move || {
        git::worktree_add(&cwd, &req.path, req.branch.as_deref(), req.new_branch.as_deref())
    })
    .await
    .unwrap()
    {
        Ok(out) => (
            StatusCode::CREATED,
            Json(ApiResponse::ok(OperationResult {
                operation: "worktree_add".to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: "worktree_add".to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    delete,
    path = "/api/git/worktrees",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitWorktreeRemoveRequest,
    responses(
        (status = 200, description = "Worktree removed", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn worktree_remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitWorktreeRemoveRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let force = req.force.unwrap_or(false);
    match tokio::task::spawn_blocking(move || git::worktree_remove(&cwd, &req.path, force))
        .await
        .unwrap()
    {
        Ok(out) => (
            StatusCode::OK,
            Json(ApiResponse::ok(OperationResult {
                operation: "worktree_remove".to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: "worktree_remove".to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/diff",
    params(
        ("cwd" = String, Query, description = "Working directory path"),
        ("staged" = Option<bool>, Query, description = "Show staged diff (default: false)")
    ),
    responses(
        (status = 200, description = "Diff output", body = GitDiffResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn diff(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<DiffQuery>,
) -> (StatusCode, Json<ApiResponse<GitDiffResponse>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let staged = params.staged.unwrap_or(false);
    match tokio::task::spawn_blocking(move || git::diff(&cwd, staged)).await.unwrap() {
        Ok(d) => (StatusCode::OK, Json(ApiResponse::ok(d))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/diff/file",
    params(
        ("cwd" = String, Query, description = "Working directory path"),
        ("path" = String, Query, description = "File path relative to repo root"),
        ("staged" = Option<bool>, Query, description = "Show staged diff (default: false)")
    ),
    responses(
        (status = 200, description = "File diff output", body = GitFileDiffResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn diff_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<FileDiffQuery>,
) -> (StatusCode, Json<ApiResponse<GitFileDiffResponse>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let path = params.path;
    let staged = params.staged.unwrap_or(false);
    match tokio::task::spawn_blocking(move || git::diff_file(&cwd, &path, staged)).await.unwrap() {
        Ok(d) => (StatusCode::OK, Json(ApiResponse::ok(d))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    get,
    path = "/api/git/stash",
    params(("cwd" = String, Query, description = "Working directory path")),
    responses(
        (status = 200, description = "Stash list", body = Vec<GitStashEntry>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn stash_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<GitStashEntry>>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    match tokio::task::spawn_blocking(move || git::stash_list(&cwd)).await.unwrap() {
        Ok(s) => (StatusCode::OK, Json(ApiResponse::ok(s))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

#[utoipa::path(
    post,
    path = "/api/git/stash",
    params(
        ("cwd" = String, Query, description = "Working directory path"),
        ("message" = Option<String>, Query, description = "Stash message")
    ),
    responses(
        (status = 200, description = "Stash pushed", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn stash_push(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<StashPushQuery>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let message = params.message;
    match tokio::task::spawn_blocking(move || git::stash_push(&cwd, message.as_deref()))
        .await
        .unwrap()
    {
        Ok(out) => (
            StatusCode::OK,
            Json(ApiResponse::ok(OperationResult {
                operation: "stash_push".to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: "stash_push".to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/git/stash/apply",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitStashApplyRequest,
    responses(
        (status = 200, description = "Stash applied", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn stash_apply(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitStashApplyRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let index = req.index.unwrap_or(0);
    let pop = req.pop.unwrap_or(false);
    match tokio::task::spawn_blocking(move || git::stash_apply(&cwd, index, pop))
        .await
        .unwrap()
    {
        Ok(out) => (
            StatusCode::OK,
            Json(ApiResponse::ok(OperationResult {
                operation: if pop { "stash_pop" } else { "stash_apply" }.to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: if pop { "stash_pop" } else { "stash_apply" }.to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    delete,
    path = "/api/git/stash",
    params(
        ("cwd" = String, Query, description = "Working directory path"),
        ("index" = u32, Query, description = "Stash index to drop")
    ),
    responses(
        (status = 200, description = "Stash dropped", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn stash_drop(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<StashDropQuery>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);

    let cwd = params.cwd;
    let index = params.index;
    match tokio::task::spawn_blocking(move || git::stash_drop(&cwd, index))
        .await
        .unwrap()
    {
        Ok(out) => (
            StatusCode::OK,
            Json(ApiResponse::ok(OperationResult {
                operation: "stash_drop".to_string(),
                success: true,
                output: out,
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::ok(OperationResult {
                operation: "stash_drop".to_string(),
                success: false,
                output: e,
            })),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/git/stage",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitPathsRequest,
    responses(
        (status = 200, description = "Files staged", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn stage(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitPathsRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);
    let cwd = params.cwd;
    let paths = req.paths;
    let result = tokio::task::spawn_blocking(move || git::stage(&cwd, &paths)).await.unwrap();
    git_op_result("stage", result)
}

#[utoipa::path(
    post,
    path = "/api/git/unstage",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitPathsRequest,
    responses(
        (status = 200, description = "Files unstaged", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn unstage(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitPathsRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);
    let cwd = params.cwd;
    let paths = req.paths;
    let result = tokio::task::spawn_blocking(move || git::unstage(&cwd, &paths)).await.unwrap();
    git_op_result("unstage", result)
}

#[utoipa::path(
    post,
    path = "/api/git/discard",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitPathsRequest,
    responses(
        (status = 200, description = "Changes discarded", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn discard(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitPathsRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);
    let cwd = params.cwd;
    let paths = req.paths;
    let result = tokio::task::spawn_blocking(move || git::discard(&cwd, &paths)).await.unwrap();
    git_op_result("discard", result)
}

#[utoipa::path(
    post,
    path = "/api/git/commit",
    params(("cwd" = String, Query, description = "Working directory path")),
    request_body = GitCommitRequest,
    responses(
        (status = 200, description = "Commit result", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "git"
)]
pub async fn commit(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<CwdQuery>,
    Json(req): Json<GitCommitRequest>,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    auth_guard!(&state, &headers);
    let cwd = params.cwd;
    let message = req.message;
    let result = tokio::task::spawn_blocking(move || git::commit(&cwd, &message)).await.unwrap();
    git_op_result("commit", result)
}
