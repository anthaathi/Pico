use std::convert::Infallible;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::Json;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::models::agent::*;
use crate::models::ApiResponse;
use crate::routes::auth::require_auth;
use crate::services::agent::{AgentSessionInfo, ActiveSessionSummary};
use crate::services::runtime;
use crate::services::session;

fn auth_err(code: StatusCode, msg: String) -> (StatusCode, Json<ApiResponse<Value>>) {
    (code, Json(ApiResponse::err(msg)))
}

async fn forward_command(
    state: &AppState,
    session_id: &str,
    command: Value,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    match state.agent.send_command(session_id, command).await {
        Ok(response) => {
            if response["success"].as_bool().unwrap_or(false) {
                let data = response.get("data").cloned().unwrap_or(Value::Null);
                (StatusCode::OK, Json(ApiResponse::ok(data)))
            } else {
                let error = response["error"]
                    .as_str()
                    .unwrap_or("Unknown error")
                    .to_string();
                (StatusCode::BAD_REQUEST, Json(ApiResponse::err(error)))
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

async fn forward_command_with_session_refresh(
    state: &AppState,
    session_id: &str,
    command: Value,
) -> (
    StatusCode,
    Json<ApiResponse<AgentSessionCommandResponse>>,
) {
    match state.agent.send_command(session_id, command).await {
        Ok(response) => {
            if response["success"].as_bool().unwrap_or(false) {
                let result =
                    response.get("data").cloned().unwrap_or(Value::Null);
                match state.agent.refresh_session_state(session_id).await {
                    Ok(session) => (
                        StatusCode::OK,
                        Json(ApiResponse::ok(AgentSessionCommandResponse {
                            result,
                            session,
                        })),
                    ),
                    Err(e) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiResponse::err(e)),
                    ),
                }
            } else {
                let error = response["error"]
                    .as_str()
                    .unwrap_or("Unknown error")
                    .to_string();
                (
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse::err(error)),
                )
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

async fn auto_touch(
    state: &AppState,
    session_id: &str,
    workspace_id: Option<&str>,
    session_file: Option<&str>,
) -> Option<AgentSessionInfo> {
    let workspace_id = workspace_id?;
    let session_file = session_file?;

    let workspace = state.db.get_workspace(workspace_id).ok()??;

    state
        .agent
        .touch_session(session_id, session_file.to_string(), workspace_id.to_string(), workspace.path)
        .await
        .ok()
}

// --- Session Management ---

#[utoipa::path(
    get,
    path = "/api/agent/runtime-status",
    responses(
        (status = 200, description = "Pi and Node runtime status", body = AgentRuntimeStatus),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn runtime_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<AgentRuntimeStatus>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let status = tokio::task::spawn_blocking({
        let config = state.config.as_ref().clone();
        move || runtime::get_agent_runtime_status(&config)
    })
    .await
    .unwrap();

    (StatusCode::OK, Json(ApiResponse::ok(status)))
}

#[utoipa::path(
    post,
    path = "/api/agent/sessions",
    request_body = CreateAgentSessionRequest,
    responses(
        (status = 200, description = "Session created", body = AgentSessionInfo),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateAgentSessionRequest>,
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

    let workspace = match state.db.get_workspace(&req.workspace_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err("Workspace not found")),
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("DB error: {e}"))),
            );
        }
    };

    match state
        .agent
        .create_session(req.workspace_id, workspace.path, req.session_path)
        .await
    {
        Ok(info) => {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!(
                    "Failed to emit initial agent_state for {}: {}",
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
    post,
    path = "/api/agent/sessions/{session_id}/touch",
    params(("session_id" = String, Path, description = "Pi session ID")),
    request_body = TouchAgentSessionRequest,
    responses(
        (status = 200, description = "Session touched/resumed", body = AgentSessionInfo),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn touch_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(req): Json<TouchAgentSessionRequest>,
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

    let workspace = match state.db.get_workspace(&req.workspace_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err("Workspace not found")),
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("DB error: {e}"))),
            );
        }
    };

    match state
        .agent
        .touch_session(&session_id, req.session_file, req.workspace_id, workspace.path)
        .await
    {
        Ok(info) => {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!(
                    "Failed to emit touched agent_state for {}: {}",
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
    delete,
    path = "/api/agent/sessions/{session_id}",
    params(("session_id" = String, Path, description = "Pi session ID")),
    responses(
        (status = 200, description = "Session killed"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn kill_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.agent.kill_session(&session_id).await {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok("Session killed".to_string())),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/agent/sessions",
    responses(
        (status = 200, description = "Active sessions", body = Vec<ActiveSessionSummary>),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<Vec<ActiveSessionSummary>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let sessions = state.agent.list_sessions().await;
    (StatusCode::OK, Json(ApiResponse::ok(sessions)))
}

// --- SSE Stream ---

#[utoipa::path(
    get,
    path = "/api/stream",
    params(("from" = Option<u64>, Query, description = "Replay events after this ID")),
    responses(
        (status = 200, description = "SSE event stream"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<StreamQuery>,
) -> impl IntoResponse {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::<String>::err(msg))).into_response();
    }

    let replay_events = state.agent.get_buffered_events(params.from).await;
    let mut rx = state.agent.subscribe();

    let stream = async_stream::stream! {
        for event in replay_events {
            let data = serde_json::to_string(&event).unwrap_or_default();
            yield Ok::<_, Infallible>(
                Event::default().id(event.id.to_string()).data(data),
            );
        }

        loop {
            match rx.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok::<_, Infallible>(
                        Event::default().id(event.id.to_string()).data(data),
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    let warning = serde_json::json!({
                        "type": "stream_lagged",
                        "missed_events": n,
                    });
                    yield Ok::<_, Infallible>(
                        Event::default().data(warning.to_string()),
                    );
                }
                Err(_) => break,
            }
        }
    };

    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

// --- Prompting ---

#[utoipa::path(
    post,
    path = "/api/agent/prompt",
    request_body = AgentPromptRequest,
    responses(
        (status = 200, description = "Prompt accepted"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn prompt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentPromptRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    let mut cmd = json!({"type": "prompt", "message": req.message});
    if let Some(images) = &req.images {
        cmd["images"] = serde_json::to_value(images).unwrap_or_default();
    }
    if let Some(behavior) = &req.streaming_behavior {
        cmd["streamingBehavior"] = json!(behavior);
    }

    let result = forward_command(&state, &req.session_id, cmd.clone()).await;
    if result.0 == StatusCode::INTERNAL_SERVER_ERROR {
        if let Some(info) = auto_touch(&state, &req.session_id, req.workspace_id.as_deref(), req.session_file.as_deref()).await {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!("Failed to emit agent_state after auto-touch: {err}");
            }
            return forward_command(&state, &req.session_id, cmd).await;
        }
    }
    result
}

#[utoipa::path(
    post,
    path = "/api/agent/steer",
    request_body = AgentMessageRequest,
    responses(
        (status = 200, description = "Steer queued"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn steer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentMessageRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    let mut cmd = json!({"type": "steer", "message": req.message});
    if let Some(images) = &req.images {
        cmd["images"] = serde_json::to_value(images).unwrap_or_default();
    }

    let result = forward_command(&state, &req.session_id, cmd.clone()).await;
    if result.0 == StatusCode::INTERNAL_SERVER_ERROR {
        if let Some(info) = auto_touch(&state, &req.session_id, req.workspace_id.as_deref(), req.session_file.as_deref()).await {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!("Failed to emit agent_state after auto-touch: {err}");
            }
            return forward_command(&state, &req.session_id, cmd).await;
        }
    }
    result
}

#[utoipa::path(
    post,
    path = "/api/agent/follow-up",
    request_body = AgentMessageRequest,
    responses(
        (status = 200, description = "Follow-up queued"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn follow_up(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentMessageRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    let mut cmd = json!({"type": "follow_up", "message": req.message});
    if let Some(images) = &req.images {
        cmd["images"] = serde_json::to_value(images).unwrap_or_default();
    }

    let result = forward_command(&state, &req.session_id, cmd.clone()).await;
    if result.0 == StatusCode::INTERNAL_SERVER_ERROR {
        if let Some(info) = auto_touch(&state, &req.session_id, req.workspace_id.as_deref(), req.session_file.as_deref()).await {
            if let Err(err) = state.agent.emit_agent_state(&info.session_id).await {
                tracing::warn!("Failed to emit agent_state after auto-touch: {err}");
            }
            return forward_command(&state, &req.session_id, cmd).await;
        }
    }
    result
}

#[utoipa::path(
    post,
    path = "/api/agent/abort",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Aborted"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn abort(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "abort"})).await
}

// --- State ---

#[utoipa::path(
    post,
    path = "/api/agent/state",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Agent state"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    match state
        .agent
        .send_command(&req.session_id, json!({"type": "get_state"}))
        .await
    {
        Ok(response) => {
            if response["success"].as_bool().unwrap_or(false) {
                let mut data = response.get("data").cloned().unwrap_or(Value::Null);
                let pending_request = state
                    .agent
                    .get_pending_extension_ui_request(&req.session_id)
                    .await
                    .unwrap_or(Value::Null);

                if let Some(obj) = data.as_object_mut() {
                    obj.insert(
                        "pendingExtensionUiRequest".to_string(),
                        pending_request,
                    );
                }

                (StatusCode::OK, Json(ApiResponse::ok(data)))
            } else {
                let error = response["error"]
                    .as_str()
                    .unwrap_or("Unknown error")
                    .to_string();
                (StatusCode::BAD_REQUEST, Json(ApiResponse::err(error)))
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/agent/messages",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Conversation messages"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    match state
        .agent
        .send_command(&req.session_id, json!({"type": "get_messages"}))
        .await
    {
        Ok(response) => {
            if response["success"].as_bool().unwrap_or(false) {
                let data = response.get("data").cloned().unwrap_or(Value::Null);
                (StatusCode::OK, Json(ApiResponse::ok(data)))
            } else {
                let error = response["error"]
                    .as_str()
                    .unwrap_or("Unknown error")
                    .to_string();
                (StatusCode::BAD_REQUEST, Json(ApiResponse::err(error)))
            }
        }
        Err(err) => {
            let base = state.config.sessions_base_path();
            let session_id = req.session_id.clone();
            match tokio::task::spawn_blocking(move || {
                session::get_session_messages_anywhere(&base, &session_id)
            })
            .await
            .unwrap()
            {
                Some(messages) => {
                    tracing::info!(
                        "Falling back to direct session-file read for get_messages: {}",
                        req.session_id
                    );
                    (
                        StatusCode::OK,
                        Json(ApiResponse::ok(json!({ "messages": messages }))),
                    )
                }
                None => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse::err(err)),
                ),
            }
        }
    }
}

// --- New Session (within pi) ---

#[utoipa::path(
    post,
    path = "/api/agent/new-session",
    request_body = AgentNewSessionRequest,
    responses(
        (status = 200, description = "New session started within pi", body = AgentSessionCommandResponse),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn new_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentNewSessionRequest>,
) -> (
    StatusCode,
    Json<ApiResponse<AgentSessionCommandResponse>>,
) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (
            code,
            Json(ApiResponse::err(msg)),
        );
    }
    let mut cmd = json!({"type": "new_session"});
    if let Some(parent) = req.parent_session {
        cmd["parentSession"] = json!(parent);
    }
    forward_command_with_session_refresh(&state, &req.session_id, cmd).await
}

// --- Model ---

#[utoipa::path(
    post,
    path = "/api/agent/set-model",
    request_body = AgentSetModelRequest,
    responses(
        (status = 200, description = "Model set"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetModelRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_model", "provider": req.provider, "modelId": req.model_id}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/cycle-model",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Cycled to next model"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn cycle_model(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "cycle_model"})).await
}

#[utoipa::path(
    post,
    path = "/api/agent/models",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Available models"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_available_models(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "get_available_models"}),
    )
    .await
}

// --- Thinking ---

#[utoipa::path(
    post,
    path = "/api/agent/set-thinking",
    request_body = AgentSetThinkingRequest,
    responses(
        (status = 200, description = "Thinking level set"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_thinking_level(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetThinkingRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_thinking_level", "level": req.level}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/cycle-thinking",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Cycled thinking level"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn cycle_thinking_level(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "cycle_thinking_level"}),
    )
    .await
}

// --- Queue Modes ---

#[utoipa::path(
    post,
    path = "/api/agent/set-steering-mode",
    request_body = AgentSetModeRequest,
    responses(
        (status = 200, description = "Steering mode set"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_steering_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetModeRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_steering_mode", "mode": req.mode}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/set-follow-up-mode",
    request_body = AgentSetModeRequest,
    responses(
        (status = 200, description = "Follow-up mode set"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_follow_up_mode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetModeRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_follow_up_mode", "mode": req.mode}),
    )
    .await
}

// --- Compaction ---

#[utoipa::path(
    post,
    path = "/api/agent/compact",
    request_body = AgentCompactRequest,
    responses(
        (status = 200, description = "Compaction result"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn compact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentCompactRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    let mut cmd = json!({"type": "compact"});
    if let Some(instructions) = req.custom_instructions {
        cmd["customInstructions"] = json!(instructions);
    }
    forward_command(&state, &req.session_id, cmd).await
}

#[utoipa::path(
    post,
    path = "/api/agent/set-auto-compaction",
    request_body = AgentSetBoolRequest,
    responses(
        (status = 200, description = "Auto-compaction setting updated"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_auto_compaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetBoolRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_auto_compaction", "enabled": req.enabled}),
    )
    .await
}

// --- Retry ---

#[utoipa::path(
    post,
    path = "/api/agent/set-auto-retry",
    request_body = AgentSetBoolRequest,
    responses(
        (status = 200, description = "Auto-retry setting updated"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_auto_retry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetBoolRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_auto_retry", "enabled": req.enabled}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/abort-retry",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Retry aborted"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn abort_retry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "abort_retry"})).await
}

// --- Bash ---

#[utoipa::path(
    post,
    path = "/api/agent/bash",
    request_body = AgentBashRequest,
    responses(
        (status = 200, description = "Bash output"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn bash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentBashRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "bash", "command": req.command}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/abort-bash",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Bash aborted"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn abort_bash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "abort_bash"})).await
}

// --- Session Stats ---

#[utoipa::path(
    post,
    path = "/api/agent/session-stats",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Session statistics"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_session_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "get_session_stats"})).await
}

#[utoipa::path(
    post,
    path = "/api/agent/export-html",
    request_body = AgentExportHtmlRequest,
    responses(
        (status = 200, description = "HTML export path"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn export_html(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentExportHtmlRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    let mut cmd = json!({"type": "export_html"});
    if let Some(path) = req.output_path {
        cmd["outputPath"] = json!(path);
    }
    forward_command(&state, &req.session_id, cmd).await
}

// --- Session Switching ---

#[utoipa::path(
    post,
    path = "/api/agent/switch-session",
    request_body = AgentSwitchSessionRequest,
    responses(
        (status = 200, description = "Session switched", body = AgentSessionCommandResponse),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn switch_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSwitchSessionRequest>,
) -> (
    StatusCode,
    Json<ApiResponse<AgentSessionCommandResponse>>,
) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (
            code,
            Json(ApiResponse::err(msg)),
        );
    }
    forward_command_with_session_refresh(
        &state,
        &req.session_id,
        json!({"type": "switch_session", "sessionPath": req.session_path}),
    )
    .await
}

// --- Forking ---

#[utoipa::path(
    post,
    path = "/api/agent/fork",
    request_body = AgentForkRequest,
    responses(
        (status = 200, description = "Fork result"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn fork(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentForkRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "fork", "entryId": req.entry_id}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/fork-messages",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Fork-eligible messages"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_fork_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "get_fork_messages"})).await
}

#[utoipa::path(
    post,
    path = "/api/agent/last-assistant-text",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Last assistant text"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_last_assistant_text(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "get_last_assistant_text"}),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/api/agent/set-session-name",
    request_body = AgentSetSessionNameRequest,
    responses(
        (status = 200, description = "Session name set"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn set_session_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSetSessionNameRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(
        &state,
        &req.session_id,
        json!({"type": "set_session_name", "name": req.name}),
    )
    .await
}

// --- Commands ---

#[utoipa::path(
    post,
    path = "/api/agent/commands",
    request_body = AgentSessionIdRequest,
    responses(
        (status = 200, description = "Available commands"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn get_commands(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentSessionIdRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }
    forward_command(&state, &req.session_id, json!({"type": "get_commands"})).await
}

// --- Extension UI Response ---

#[utoipa::path(
    post,
    path = "/api/agent/extension-ui-response",
    request_body = AgentExtensionUiResponseRequest,
    responses(
        (status = 200, description = "Extension UI response sent"),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn extension_ui_response(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AgentExtensionUiResponseRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return auth_err(code, msg);
    }

    let mut cmd = json!({
        "type": "extension_ui_response",
        "id": req.id,
    });

    if let Some(value) = req.value {
        cmd["value"] = value;
    }
    if let Some(confirmed) = req.confirmed {
        cmd["confirmed"] = json!(confirmed);
    }
    if let Some(cancelled) = req.cancelled {
        cmd["cancelled"] = json!(cancelled);
    }

    match state
        .agent
        .send_untracked_command(&req.session_id, cmd)
        .await
    {
        Ok(_) => {
            state
                .agent
                .clear_pending_extension_ui_request(&req.session_id)
                .await;
            (StatusCode::OK, Json(ApiResponse::ok(json!({"sent": true}))))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}
