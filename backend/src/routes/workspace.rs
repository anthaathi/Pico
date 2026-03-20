use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::server::state::AppState;
use crate::models::*;
use crate::services::session;
use crate::routes::auth::require_auth;

#[utoipa::path(
    get,
    path = "/api/workspaces",
    params(
        ("include_archived" = Option<bool>, Query, description = "Include archived workspaces (default: false)")
    ),
    responses(
        (status = 200, description = "List of workspaces", body = Vec<Workspace>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<ListQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<Workspace>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.list_workspaces(params.include_archived.unwrap_or(false)) {
        Ok(workspaces) => (StatusCode::OK, Json(ApiResponse::ok(workspaces))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to list workspaces: {e}"))),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}",
    params(("id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace found", body = Workspace),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Workspace>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.get_workspace(&id) {
        Ok(Some(w)) => (StatusCode::OK, Json(ApiResponse::ok(w))),
        Ok(None) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to get workspace: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/workspaces",
    request_body = CreateWorkspaceRequest,
    responses(
        (status = 201, description = "Workspace created", body = Workspace),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateWorkspaceRequest>,
) -> (StatusCode, Json<ApiResponse<Workspace>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let path = crate::services::session::normalize_path(&req.path);
    if !std::path::Path::new(&path).exists() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err(format!("Path does not exist: {path}"))),
        );
    }

    match state.db.create_workspace(
        &req.name,
        &path,
        req.color.as_deref(),
        req.workspace_enabled.unwrap_or(true),
        req.startup_script.as_deref(),
    ) {
        Ok(w) => (StatusCode::CREATED, Json(ApiResponse::ok(w))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to create workspace: {e}"))),
        ),
    }
}

#[utoipa::path(
    put,
    path = "/api/workspaces/{id}",
    params(("id" = String, Path, description = "Workspace ID")),
    request_body = UpdateWorkspaceRequest,
    responses(
        (status = 200, description = "Workspace updated", body = Workspace),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateWorkspaceRequest>,
) -> (StatusCode, Json<ApiResponse<Workspace>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let color = req.color.as_ref().map(|c| Some(c.as_str()));
    let startup_script = req.startup_script.as_ref().map(|s| Some(s.as_str()));

    match state.db.update_workspace(
        &id,
        req.name.as_deref(),
        req.path.as_deref(),
        color,
        req.workspace_enabled,
        startup_script,
    ) {
        Ok(Some(w)) => (StatusCode::OK, Json(ApiResponse::ok(w))),
        Ok(None) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to update workspace: {e}"))),
        ),
    }
}

#[utoipa::path(
    delete,
    path = "/api/workspaces/{id}",
    params(("id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.delete_workspace(&id) {
        Ok(true) => (StatusCode::OK, Json(ApiResponse::ok("Workspace deleted".to_string()))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to delete workspace: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/workspaces/{id}/archive",
    params(("id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace archived", body = Workspace),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn archive(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Workspace>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.set_workspace_status(&id, &WorkspaceStatus::Archived) {
        Ok(Some(w)) => (StatusCode::OK, Json(ApiResponse::ok(w))),
        Ok(None) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to archive workspace: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/workspaces/{id}/unarchive",
    params(("id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace unarchived", body = Workspace),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn unarchive(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Workspace>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.set_workspace_status(&id, &WorkspaceStatus::Active) {
        Ok(Some(w)) => (StatusCode::OK, Json(ApiResponse::ok(w))),
        Ok(None) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to unarchive workspace: {e}"))),
        ),
    }
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct ListQuery {
    pub include_archived: Option<bool>,
}

macro_rules! resolve_workspace {
    ($state:expr, $id:expr) => {
        match $state.db.get_workspace($id) {
            Ok(Some(w)) => w,
            Ok(None) => return (StatusCode::NOT_FOUND, Json(ApiResponse::err("Workspace not found"))),
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(ApiResponse::err(format!("DB error: {e}")))),
        }
    };
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("page" = Option<u32>, Query, description = "Page number (default: 1)"),
        ("limit" = Option<u32>, Query, description = "Items per page (default: 20)"),
    ),
    responses(
        (status = 200, description = "Paginated sessions", body = PaginatedSessions),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Workspace not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<SessionListQuery>,
) -> (StatusCode, Json<ApiResponse<PaginatedSessions>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    let page = params.page.unwrap_or(1);
    let limit = params.limit.unwrap_or(20);
    let result = tokio::task::spawn_blocking(move || {
        session::list_sessions(&base, &cwd, page, limit)
    })
    .await
    .unwrap();
    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct SessionListQuery {
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions/{session_id}",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
    ),
    responses(
        (status = 200, description = "Session detail", body = SessionDetail),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id)): Path<(String, String)>,
) -> (StatusCode, Json<ApiResponse<SessionDetail>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    match tokio::task::spawn_blocking(move || session::get_session(&base, &cwd, &session_id))
        .await.unwrap()
    {
        Some(d) => (StatusCode::OK, Json(ApiResponse::ok(d))),
        None => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session not found"))),
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions/{session_id}/tree",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
    ),
    responses(
        (status = 200, description = "Session tree", body = Vec<SessionTreeNode>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_tree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id)): Path<(String, String)>,
) -> (StatusCode, Json<ApiResponse<Vec<SessionTreeNode>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    match tokio::task::spawn_blocking(move || session::get_session_tree(&base, &cwd, &session_id))
        .await.unwrap()
    {
        Some(t) => (StatusCode::OK, Json(ApiResponse::ok(t))),
        None => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session not found"))),
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions/{session_id}/leaf",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
    ),
    responses(
        (status = 200, description = "Leaf entry", body = SessionEntry),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_leaf(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id)): Path<(String, String)>,
) -> (StatusCode, Json<ApiResponse<SessionEntry>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    match tokio::task::spawn_blocking(move || session::get_leaf(&base, &cwd, &session_id))
        .await.unwrap()
    {
        Some(e) => (StatusCode::OK, Json(ApiResponse::ok(e))),
        None => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session or leaf not found"))),
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions/{session_id}/children/{entry_id}",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
        ("entry_id" = String, Path, description = "Parent entry ID"),
    ),
    responses(
        (status = 200, description = "Children entries", body = Vec<SessionEntry>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_children(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id, entry_id)): Path<(String, String, String)>,
) -> (StatusCode, Json<ApiResponse<Vec<SessionEntry>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    match tokio::task::spawn_blocking(move || session::get_children(&base, &cwd, &session_id, &entry_id))
        .await.unwrap()
    {
        Some(e) => (StatusCode::OK, Json(ApiResponse::ok(e))),
        None => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session not found"))),
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/{id}/sessions/{session_id}/branch/{entry_id}",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
        ("entry_id" = String, Path, description = "Entry ID to walk to root"),
    ),
    responses(
        (status = 200, description = "Branch path root to entry", body = Vec<SessionEntry>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id, entry_id)): Path<(String, String, String)>,
) -> (StatusCode, Json<ApiResponse<Vec<SessionEntry>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    match tokio::task::spawn_blocking(move || session::get_branch(&base, &cwd, &session_id, &entry_id))
        .await.unwrap()
    {
        Some(e) => (StatusCode::OK, Json(ApiResponse::ok(e))),
        None => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session not found"))),
    }
}

#[utoipa::path(
    delete,
    path = "/api/workspaces/{id}/sessions/{session_id}",
    params(
        ("id" = String, Path, description = "Workspace ID"),
        ("session_id" = String, Path, description = "Session UUID"),
    ),
    responses(
        (status = 200, description = "Session deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "sessions"
)]
pub async fn sessions_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, session_id)): Path<(String, String)>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let ws = resolve_workspace!(&state, &id);
    let base = state.config.sessions_base_path();
    let cwd = ws.path;
    let deleted = tokio::task::spawn_blocking(move || session::delete_session(&base, &cwd, &session_id))
        .await.unwrap();
    if deleted {
        (StatusCode::OK, Json(ApiResponse::ok("Session deleted".to_string())))
    } else {
        (StatusCode::NOT_FOUND, Json(ApiResponse::err("Session not found")))
    }
}

#[utoipa::path(
    get,
    path = "/api/workspaces/suggest",
    responses(
        (status = 200, description = "Workspace paths from sessions", body = Vec<String>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "workspaces"
)]
pub async fn suggest_workspaces(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<Vec<String>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }
    let base = state.config.sessions_base_path();
    let result = tokio::task::spawn_blocking(move || session::suggest_workspaces(&base))
        .await.unwrap();
    (StatusCode::OK, Json(ApiResponse::ok(result)))
}
