use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::app::AppState;
use crate::models::ApiResponse;
use crate::routes::auth::require_auth;
use crate::services::agent::AgentSessionInfo;
use crate::services::session;
use crate::services::runtime;
use crate::models::PaginatedSessions;

const CHAT_WORKSPACE_ID: &str = "__chat__";

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateChatSessionRequest {
    pub no_tools: Option<bool>,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TouchChatSessionRequest {
    pub session_file: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ChatSessionListQuery {
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

#[utoipa::path(
    post,
    path = "/api/chat/sessions",
    request_body = CreateChatSessionRequest,
    responses(
        (status = 200, description = "Chat session created", body = AgentSessionInfo),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "chat"
)]
pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateChatSessionRequest>,
) -> (StatusCode, Json<ApiResponse<AgentSessionInfo>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let runtime_status = tokio::task::spawn_blocking({
        let config = state.config.as_ref().clone();
        move || runtime::get_agent_runtime_status(&config)
    })
    .await
    .unwrap();
    if let Some(message) = runtime::get_runtime_prerequisite_error(&runtime_status) {
        return (StatusCode::PRECONDITION_FAILED, Json(ApiResponse::err(message)));
    }

    let cwd = state.config.chat_cwd();
    let system_prompt = req.system_prompt.or_else(|| state.config.chat_system_prompt());
    let no_tools = req.no_tools.unwrap_or_else(|| state.config.chat_no_tools());

    match state
        .agent
        .create_chat_session(
            CHAT_WORKSPACE_ID.to_string(),
            cwd,
            system_prompt,
            no_tools,
        )
        .await
    {
        Ok(info) => {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!(
                    "Failed to emit initial agent_state for chat session {}: {}",
                    info.session_id,
                    err
                );
            }
            (StatusCode::OK, Json(ApiResponse::ok(info)))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/chat/sessions",
    params(ChatSessionListQuery),
    responses(
        (status = 200, description = "Paginated chat sessions", body = PaginatedSessions),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "chat"
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ChatSessionListQuery>,
) -> (StatusCode, Json<ApiResponse<PaginatedSessions>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let base = state.config.sessions_base_path();
    let cwd = state.config.chat_cwd();
    let page = params.page.unwrap_or(1);
    let limit = params.limit.unwrap_or(20);

    let result = tokio::task::spawn_blocking(move || {
        session::list_sessions(&base, &cwd, page, limit)
    })
    .await
    .unwrap();

    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

#[utoipa::path(
    delete,
    path = "/api/chat/sessions/{session_id}",
    params(("session_id" = String, Path, description = "Chat session ID")),
    responses(
        (status = 200, description = "Chat session deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "chat"
)]
pub async fn delete_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let _ = state.agent.kill_session(&session_id).await;

    let base = state.config.sessions_base_path();
    let cwd = state.config.chat_cwd();
    let deleted = tokio::task::spawn_blocking(move || {
        session::delete_session(&base, &cwd, &session_id)
    })
    .await
    .unwrap();

    if deleted {
        (StatusCode::OK, Json(ApiResponse::ok("Chat session deleted".to_string())))
    } else {
        (StatusCode::NOT_FOUND, Json(ApiResponse::err("Chat session not found")))
    }
}

#[utoipa::path(
    post,
    path = "/api/chat/sessions/{session_id}/touch",
    params(("session_id" = String, Path, description = "Chat session ID")),
    request_body = TouchChatSessionRequest,
    responses(
        (status = 200, description = "Chat session touched/resumed", body = AgentSessionInfo),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "chat"
)]
pub async fn touch_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(req): Json<TouchChatSessionRequest>,
) -> (StatusCode, Json<ApiResponse<AgentSessionInfo>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let runtime_status = tokio::task::spawn_blocking({
        let config = state.config.as_ref().clone();
        move || runtime::get_agent_runtime_status(&config)
    })
    .await
    .unwrap();
    if let Some(message) = runtime::get_runtime_prerequisite_error(&runtime_status) {
        return (StatusCode::PRECONDITION_FAILED, Json(ApiResponse::err(message)));
    }

    let cwd = state.config.chat_cwd();
    let session_file = req.session_file
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| session_id.clone());

    match state
        .agent
        .touch_session(
            &session_id,
            session_file,
            CHAT_WORKSPACE_ID.to_string(),
            cwd,
        )
        .await
    {
        Ok(info) => {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!(
                    "Failed to emit touched agent_state for chat session {}: {}",
                    info.session_id,
                    err
                );
            }
            (StatusCode::OK, Json(ApiResponse::ok(info)))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}
