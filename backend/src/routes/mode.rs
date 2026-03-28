use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::models::mode::{AgentMode, CreateAgentModeRequest, UpdateAgentModeRequest};
use crate::models::ApiResponse;
use crate::routes::auth::require_auth;
use crate::server::state::AppState;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SessionModeResponse {
    pub session_id: String,
    pub mode: Option<AgentMode>,
}

#[utoipa::path(
    get,
    path = "/api/modes",
    responses(
        (status = 200, description = "List all agent modes", body = Vec<AgentMode>),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "modes"
)]
pub async fn list_modes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<Vec<AgentMode>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.list_agent_modes() {
        Ok(modes) => (StatusCode::OK, Json(ApiResponse::ok(modes))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("DB error: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/modes",
    request_body = CreateAgentModeRequest,
    responses(
        (status = 200, description = "Mode created", body = AgentMode),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "modes"
)]
pub async fn create_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateAgentModeRequest>,
) -> (StatusCode, Json<ApiResponse<AgentMode>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let extensions = req.extensions.unwrap_or_default();
    let skills = req.skills.unwrap_or_default();
    let extra_args = req.extra_args.unwrap_or_default();

    match state.db.create_agent_mode(
        &req.name,
        req.description.as_deref(),
        req.model.as_deref(),
        req.thinking_level.as_deref(),
        &extensions,
        &skills,
        &extra_args,
        req.is_default.unwrap_or(false),
        req.sort_order.unwrap_or(0),
    ) {
        Ok(mode) => (StatusCode::OK, Json(ApiResponse::ok(mode))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("DB error: {e}"))),
        ),
    }
}

#[utoipa::path(
    put,
    path = "/api/modes/{mode_id}",
    params(("mode_id" = String, Path, description = "Mode ID")),
    request_body = UpdateAgentModeRequest,
    responses(
        (status = 200, description = "Mode updated", body = AgentMode),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "modes"
)]
pub async fn update_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(mode_id): Path<String>,
    Json(req): Json<UpdateAgentModeRequest>,
) -> (StatusCode, Json<ApiResponse<AgentMode>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.update_agent_mode(
        &mode_id,
        req.name.as_deref(),
        Some(req.description.as_deref()),
        Some(req.model.as_deref()),
        Some(req.thinking_level.as_deref()),
        req.extensions.as_deref(),
        req.skills.as_deref(),
        req.extra_args.as_deref(),
        req.is_default,
        req.sort_order,
    ) {
        Ok(Some(mode)) => (StatusCode::OK, Json(ApiResponse::ok(mode))),
        Ok(None) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Mode not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("DB error: {e}"))),
        ),
    }
}

#[utoipa::path(
    delete,
    path = "/api/modes/{mode_id}",
    params(("mode_id" = String, Path, description = "Mode ID")),
    responses(
        (status = 200, description = "Mode deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "modes"
)]
pub async fn delete_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(mode_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.db.delete_agent_mode(&mode_id) {
        Ok(true) => (StatusCode::OK, Json(ApiResponse::ok("Mode deleted".to_string()))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(ApiResponse::err("Mode not found"))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("DB error: {e}"))),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/sessions/{session_id}/mode",
    params(("session_id" = String, Path, description = "Session ID")),
    responses(
        (status = 200, description = "Session mode", body = SessionModeResponse),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "modes"
)]
pub async fn get_session_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<SessionModeResponse>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let mode = match state.db.get_session_mode(&session_id) {
        Ok(Some(mode_id)) => match state.db.get_agent_mode(&mode_id) {
            Ok(m) => m,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse::err(format!("DB error: {e}"))),
                );
            }
        },
        Ok(None) => None,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("DB error: {e}"))),
            );
        }
    };

    (
        StatusCode::OK,
        Json(ApiResponse::ok(SessionModeResponse { session_id, mode })),
    )
}
