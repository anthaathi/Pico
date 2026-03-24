mod normalize;

use std::{convert::Infallible, time::Duration};

use axum::body::Bytes;
use axum::extract::{
    ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    Path, Query, State,
};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::server::state::AppState;
use crate::models::agent::*;
use crate::models::ApiResponse;
use crate::routes::auth::{extract_token, require_auth, validate_access_token};
use crate::services::agent::{AgentSessionInfo, ActiveSessionSummary, StreamEvent, is_global_event, is_session_only_event};
use crate::services::runtime;
use crate::services::session;

const WS_KEEPALIVE_SECS: u64 = 20;
const WS_MAX_BATCH_EVENTS: usize = 32;
const WS_CLOSE_UNAUTHORIZED: u16 = 4401;
const WS_CLOSE_INTERNAL_ERROR: u16 = 1011;
const PREVIEW_COOKIE_NAME: &str = "pi_preview_auth";

#[derive(Debug, Default, Deserialize)]
pub struct PreviewProxyQuery {
    access_token: Option<String>,
}

fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value.split(';').find_map(|entry| {
                let mut parts = entry.trim().splitn(2, '=');
                let key = parts.next()?.trim();
                let value = parts.next()?.trim();
                if key == name {
                    Some(value.to_string())
                } else {
                    None
                }
            })
        })
}

fn extract_preview_auth_token(
    headers: &HeaderMap,
    query: &PreviewProxyQuery,
) -> Option<String> {
    extract_token(headers)
        .or_else(|| {
            headers
                .get("x-proxy-authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        })
        .or_else(|| query.access_token.clone())
        .or_else(|| extract_cookie(headers, PREVIEW_COOKIE_NAME))
}

fn filter_request_headers(headers: &HeaderMap) -> HeaderMap {
    let mut filtered = HeaderMap::new();
    for (name, value) in headers.iter() {
        if name == header::HOST
            || name == header::AUTHORIZATION
            || name == header::COOKIE
            || name == header::CONTENT_LENGTH
            || name.as_str() == "x-proxy-authorization"
        {
            continue;
        }
        filtered.append(name.clone(), value.clone());
    }
    filtered
}

fn append_preview_response_headers(
    headers: &mut HeaderMap,
    cookie_token: Option<&str>,
    cookie_path: &str,
    header_mode: bool,
) {
    if !header_mode {
        headers.insert(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("SAMEORIGIN"),
        );
        headers.insert(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("frame-ancestors 'self'"),
        );
    } else {
        headers.remove(HeaderName::from_static("x-frame-options"));
        headers.remove(HeaderName::from_static("content-security-policy"));
    }
    if let Some(token) = cookie_token {
        let cookie = format!(
            "{}={}; Path={}; HttpOnly; SameSite=Lax",
            PREVIEW_COOKIE_NAME, token, cookie_path
        );
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            headers.append(header::SET_COOKIE, value);
        }
    }
}

fn filtered_preview_query(query: Option<&str>) -> String {
    query
        .unwrap_or_default()
        .split('&')
        .filter(|entry| !entry.is_empty())
        .filter(|entry| !entry.starts_with("access_token="))
        .collect::<Vec<_>>()
        .join("&")
}

fn build_upstream_preview_url(hostname: &str, port: u16, path: Option<&str>, query: &str) -> String {
    let normalized_path = path
        .map(|value| value.trim_start_matches('/'))
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let mut url = if normalized_path.is_empty() {
        format!("http://{hostname}:{port}/")
    } else {
        format!("http://{hostname}:{port}/{normalized_path}")
    };
    if !query.is_empty() {
        url.push('?');
        url.push_str(query);
    }
    url
}

fn rewrite_preview_location(location: &str, session_id: &str, hostname: &str, port: u16) -> Option<String> {
    if location.starts_with("http://") || location.starts_with("https://") {
        let parsed = reqwest::Url::parse(location).ok()?;
        let target_host = parsed.host_str()?;
        let target_port = parsed.port_or_known_default()?;
        if target_host != hostname || target_port != port {
            return None;
        }
        let path = parsed.path().trim_start_matches('/');
        let mut rewritten = format!(
            "/api/agent/sessions/{session_id}/preview/{hostname}/{port}/{}",
            path
        );
        if let Some(query) = parsed.query() {
            rewritten.push('?');
            rewritten.push_str(query);
        }
        return Some(rewritten);
    }

    if location.starts_with('/') {
        return Some(format!(
            "/api/agent/sessions/{session_id}/preview/{hostname}/{port}{location}"
        ));
    }

    None
}

fn rewrite_header_preview_location(location: &str, hostname: &str, port: u16) -> Option<String> {
    if location.starts_with("http://") || location.starts_with("https://") {
        let parsed = reqwest::Url::parse(location).ok()?;
        let target_host = parsed.host_str()?;
        let target_port = parsed.port_or_known_default()?;
        if target_host != hostname || target_port != port {
            return None;
        }
        let mut rewritten = parsed.path().to_string();
        if let Some(query) = parsed.query() {
            rewritten.push('?');
            rewritten.push_str(query);
        }
        return Some(rewritten);
    }

    if location.starts_with('/') {
        return Some(location.to_string());
    }

    None
}

fn auth_err(code: StatusCode, msg: String) -> (StatusCode, Json<ApiResponse<Value>>) {
    (code, Json(ApiResponse::err(msg)))
}

async fn forward_command(
    state: &AppState,
    session_id: &str,
    command: Value,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    let cmd_type = command.get("type").and_then(|t| t.as_str()).map(String::from);

    match state.agent.send_command(session_id, command).await {
        Ok(response) => {
            if response["success"].as_bool().unwrap_or(false) {
                let mut data = response.get("data").cloned().unwrap_or(Value::Null);

                // Normalize get_commands response to use sourceInfo consistently
                if cmd_type.as_deref() == Some("get_commands") {
                    normalize::normalize_commands_response(&mut data);
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

fn stream_event_json<T: serde::Serialize>(event: &T) -> String {
    serde_json::to_string(event).unwrap_or_default()
}

fn stream_event_value<T: serde::Serialize>(event: &T) -> Value {
    serde_json::to_value(event).unwrap_or(Value::Null)
}

fn strip_live_event(mut event: Value) -> Value {
    let event_type = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string();

    if event_type != "message_start" {
        event.as_object_mut().map(|obj| obj.remove("workspace_id"));
    }

    if event_type == "message_update" {
        if let Some(data) = event.get_mut("data") {
            if let Some(obj) = data.as_object_mut() {
                obj.remove("message");
                if let Some(ame) = obj.get_mut("assistantMessageEvent") {
                    if let Some(ame_obj) = ame.as_object_mut() {
                        ame_obj.remove("partial");
                    }
                }
            }
        }
    }

    // Strip partialResult from tool_execution_update for "read" tool calls.
    // The frontend doesn't render partial read results (they contain the full
    // file on every delta, causing expensive re-renders), so avoid sending
    // the large payload over the wire entirely.
    if event_type == "tool_execution_update" {
        let is_read = event
            .get("data")
            .and_then(|d| d.get("toolName"))
            .and_then(|n| n.as_str())
            .map_or(false, |n| n == "Read" || n == "read");
        if is_read {
            if let Some(data) = event.get_mut("data") {
                if let Some(obj) = data.as_object_mut() {
                    obj.remove("partialResult");
                }
            }
        }
    }

    event
}

fn stream_lagged_json(missed_events: u64) -> String {
    serde_json::json!({
        "type": "stream_lagged",
        "missed_events": missed_events,
    })
    .to_string()
}

fn stream_lagged_value(missed_events: u64) -> Value {
    serde_json::json!({
        "type": "stream_lagged",
        "missed_events": missed_events,
    })
}

async fn close_ws(mut socket: WebSocket, code: u16, reason: String) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: code.into(),
            reason: reason.chars().take(123).collect::<String>().into(),
        })))
        .await;
}

async fn send_ws_batch(socket: &mut WebSocket, payloads: Vec<Value>) -> bool {
    if payloads.is_empty() {
        return true;
    }

    let payload = if payloads.len() == 1 {
        payloads.into_iter().next().unwrap_or(Value::Null)
    } else {
        Value::Array(payloads)
    };

    socket
        .send(Message::Text(payload.to_string().into()))
        .await
        .is_ok()
}

fn extract_ws_protocol_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(|entry| entry.trim())
                .find_map(|entry| entry.strip_prefix("auth.").map(|token| token.to_string()))
        })
}

fn drain_ws_pending_payloads(
    rx: &mut tokio::sync::broadcast::Receiver<crate::services::agent::StreamEvent>,
    payloads: &mut Vec<Value>,
) -> bool {
    drain_ws_pending_payloads_filtered(rx, payloads, None)
}

fn drain_ws_pending_payloads_filtered(
    rx: &mut tokio::sync::broadcast::Receiver<crate::services::agent::StreamEvent>,
    payloads: &mut Vec<Value>,
    session_filter: Option<&str>,
) -> bool {
    let mut closed = false;

    while payloads.len() < WS_MAX_BATCH_EVENTS {
        match rx.try_recv() {
            Ok(event) => {
                if let Some(sid) = session_filter {
                    if event.session_id != sid || !is_session_only_event(&event.event_type) {
                        continue;
                    }
                } else if !is_global_event(&event.event_type) {
                    continue;
                }
                payloads.push(strip_live_event(stream_event_value(&event)));
            }
            Err(tokio::sync::broadcast::error::TryRecvError::Lagged(n)) => {
                payloads.push(stream_lagged_value(n.into()));
            }
            Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
            Err(tokio::sync::broadcast::error::TryRecvError::Closed) => {
                closed = true;
                break;
            }
        }
    }

    closed
}

async fn handle_ws_stream(
    mut socket: WebSocket,
    state: AppState,
    access_token: Option<String>,
    from: Option<u64>,
) {
    let token = match access_token {
        Some(token) => token,
        None => {
            close_ws(
                socket,
                WS_CLOSE_UNAUTHORIZED,
                "Missing authorization token".to_string(),
            )
            .await;
            return;
        }
    };

    if let Err((status, msg)) = validate_access_token(&state, &token) {
        let close_code = if status == StatusCode::UNAUTHORIZED {
            WS_CLOSE_UNAUTHORIZED
        } else {
            WS_CLOSE_INTERNAL_ERROR
        };
        close_ws(socket, close_code, msg).await;
        return;
    }

    let hello = serde_json::json!({
        "type": "server_hello",
        "instance_id": *state.instance_id,
    });
    if !send_ws_batch(&mut socket, vec![hello]).await {
        return;
    }

    let replay_events = state.agent.get_buffered_events(from).await;
    let mut replay_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
    for event in replay_events {
        if !is_global_event(&event.event_type) {
            continue;
        }
        replay_payloads.push(stream_event_value(&event));
        if replay_payloads.len() >= WS_MAX_BATCH_EVENTS {
            if !send_ws_batch(&mut socket, replay_payloads).await {
                return;
            }
            replay_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
        }
    }
    if !replay_payloads.is_empty()
        && !send_ws_batch(&mut socket, replay_payloads).await
    {
        return;
    }

    // Send current port state
    {
        let ports_data = state.port_scanner.get_current_ports_event().await;
        let ports_event = StreamEvent {
            id: 0,
            session_id: String::new(),
            workspace_id: String::new(),
            event_type: "preview_state".to_string(),
            data: ports_data,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let payload = stream_event_value(&ports_event);
        if !send_ws_batch(&mut socket, vec![payload]).await {
            return;
        }
    }

    let mut rx = state.agent.subscribe();
    let mut keepalive =
        tokio::time::interval(Duration::from_secs(WS_KEEPALIVE_SECS));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = keepalive.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Pong(_)))
                    | Some(Ok(Message::Text(_)))
                    | Some(Ok(Message::Binary(_))) => {}
                    Some(Err(_)) => break,
                }
            }
            result = rx.recv() => {
                let mut payloads = match result {
                    Ok(event) => {
                        if !is_global_event(&event.event_type) {
                            continue;
                        }
                        vec![strip_live_event(stream_event_value(&event))]
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        vec![stream_lagged_value(n.into())]
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };

                let closed = drain_ws_pending_payloads(&mut rx, &mut payloads);

                if !send_ws_batch(&mut socket, payloads).await {
                    break;
                }

                if closed {
                    break;
                }
            }
        }
    }
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

pub async fn header_based_preview_proxy(
    state: AppState,
    headers: HeaderMap,
    method: Method,
    uri: axum::http::Uri,
    body: Bytes,
) -> Option<Response<axum::body::Body>> {
    tracing::info!(
        "[preview-proxy] START uri={} method={} headers: session={:?} hostname={:?} port={:?} auth={:?} proxy-auth={:?}",
        uri,
        method,
        headers.get("x-pi-preview-session").map(|v| v.to_str().unwrap_or("?")),
        headers.get("x-pi-preview-hostname").map(|v| v.to_str().unwrap_or("?")),
        headers.get("x-pi-preview-port").map(|v| v.to_str().unwrap_or("?")),
        headers.get("authorization").map(|_| "<present>"),
        headers.get("x-proxy-authorization").map(|_| "<present>"),
    );

    let session_id = match headers
        .get("x-pi-preview-session")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    {
        Some(id) => id,
        None => {
            tracing::warn!("[preview-proxy] missing/invalid x-pi-preview-session header");
            return None;
        }
    };

    let hostname = headers
        .get("x-pi-preview-hostname")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost")
        .to_string();

    let port: u16 = match headers
        .get("x-pi-preview-port")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
    {
        Some(p) => p,
        None => {
            tracing::warn!("[preview-proxy] missing/invalid x-pi-preview-port header");
            return None;
        }
    };

    let response = proxy_preview_request(
        state,
        headers,
        method,
        session_id,
        hostname,
        port,
        None,
        PreviewProxyQuery::default(),
        uri.query(),
        body,
        true,
    )
    .await;

    tracing::info!("[preview-proxy] END status={}", response.status());
    Some(response)
}

async fn proxy_preview_request(
    state: AppState,
    headers: HeaderMap,
    method: Method,
    session_id: String,
    hostname: String,
    port: u16,
    path: Option<String>,
    query: PreviewProxyQuery,
    raw_query: Option<&str>,
    body: Bytes,
    header_mode: bool,
) -> Response<axum::body::Body> {
    let token = match extract_preview_auth_token(&headers, &query) {
        Some(token) => token,
        None => {
            return (StatusCode::UNAUTHORIZED, "Missing authorization token").into_response();
        }
    };

    if let Err((status, message)) = validate_access_token(&state, &token) {
        return (status, message).into_response();
    }

    let query_string = filtered_preview_query(raw_query);
    let upstream_url = build_upstream_preview_url(&hostname, port, path.as_deref(), &query_string);
    let upstream_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let mut upstream_headers = filter_request_headers(&headers);
    upstream_headers.insert(
        HeaderName::from_static("x-proxy"),
        HeaderValue::from_static("true"),
    );
    if let Ok(value) = HeaderValue::from_str(&port.to_string()) {
        upstream_headers.insert(HeaderName::from_static("x-proxy-port"), value);
    }
    if let Ok(value) = HeaderValue::from_str(&hostname) {
        upstream_headers.insert(HeaderName::from_static("x-proxy-hostname"), value);
    }

    let request = state
        .http_client
        .request(upstream_method, upstream_url)
        .headers(upstream_headers)
        .body(body.to_vec());

    let upstream_response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(
                "Preview proxy failed for session {} host {} port {}: {}",
                session_id,
                hostname,
                port,
                error
            );
            return (
                StatusCode::BAD_GATEWAY,
                format!("Preview proxy failed: {error}"),
            )
                .into_response();
        }
    };

    let status = upstream_response.status();
    let mut response_headers = HeaderMap::new();
    for (name, value) in upstream_response.headers().iter() {
        if name == header::CONTENT_LENGTH || name == header::TRANSFER_ENCODING || name == header::CONNECTION {
            continue;
        }
        if name == header::LOCATION {
            if let Ok(location) = value.to_str() {
                let rewritten = if header_mode {
                    rewrite_header_preview_location(location, &hostname, port)
                } else {
                    rewrite_preview_location(location, &session_id, &hostname, port)
                };
                if let Some(rewritten) = rewritten {
                    if let Ok(location_value) = HeaderValue::from_str(&rewritten) {
                        response_headers.append(header::LOCATION, location_value);
                    }
                    continue;
                }
            }
        }
        response_headers.append(name.clone(), value.clone());
    }
    append_preview_response_headers(
        &mut response_headers,
        query.access_token.as_deref(),
        if header_mode { "/" } else { "/api/agent/sessions/" },
        header_mode,
    );

    let bytes = match upstream_response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read preview response: {error}"),
            )
                .into_response();
        }
    };

    let mut response = Response::new(axum::body::Body::from(bytes));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    response
}

pub async fn preview_proxy_root(
    State(state): State<AppState>,
    headers: HeaderMap,
    method: Method,
    Path((session_id, hostname, port)): Path<(String, String, u16)>,
    Query(query): Query<PreviewProxyQuery>,
    uri: axum::http::Uri,
    body: Bytes,
) -> Response<axum::body::Body> {
    proxy_preview_request(
        state,
        headers,
        method,
        session_id,
        hostname,
        port,
        None,
        query,
        uri.query(),
        body,
        false,
    )
    .await
}

pub async fn preview_proxy_path(
    State(state): State<AppState>,
    headers: HeaderMap,
    method: Method,
    Path((session_id, hostname, port, path)): Path<(String, String, u16, String)>,
    Query(query): Query<PreviewProxyQuery>,
    uri: axum::http::Uri,
    body: Bytes,
) -> Response<axum::body::Body> {
    proxy_preview_request(
        state,
        headers,
        method,
        session_id,
        hostname,
        port,
        Some(path),
        query,
        uri.query(),
        body,
        false,
    )
    .await
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
    let instance_id = state.instance_id.clone();
    let port_scanner = state.port_scanner.clone();

    let stream = async_stream::stream! {
        let hello = serde_json::json!({
            "type": "server_hello",
            "instance_id": *instance_id,
        });
        yield Ok::<_, Infallible>(
            Event::default().data(serde_json::to_string(&hello).unwrap_or_default()),
        );

        for event in replay_events {
            if !is_global_event(&event.event_type) {
                continue;
            }
            let data = stream_event_json(&event);
            yield Ok::<_, Infallible>(
                Event::default().id(event.id.to_string()).data(data),
            );
        }

        // Send current port state so the client knows about open ports immediately
        {
            let ports_data = port_scanner.get_current_ports_event().await;
            let ports_event = StreamEvent {
                id: 0,
                session_id: String::new(),
                workspace_id: String::new(),
                event_type: "preview_state".to_string(),
                data: ports_data,
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            let data = stream_event_json(&ports_event);
            yield Ok::<_, Infallible>(Event::default().data(data));
        }

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if !is_global_event(&event.event_type) {
                        continue;
                    }
                    let val = strip_live_event(stream_event_value(&event));
                    let data = serde_json::to_string(&val).unwrap_or_default();
                    yield Ok::<_, Infallible>(
                        Event::default().id(event.id.to_string()).data(data),
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    yield Ok::<_, Infallible>(
                        Event::default().data(stream_lagged_json(n.into())),
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

pub async fn ws_stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<WsStreamQuery>,
) -> impl IntoResponse {
    let access_token = extract_token(&headers)
        .or_else(|| extract_ws_protocol_token(&headers))
        .or(params.access_token);
    ws.protocols(["pi-stream-v1"])
        .on_upgrade(move |socket| handle_ws_stream(socket, state, access_token, params.from))
}

// --- Per-Session Stream ---

fn collapse_buffered_events(events: Vec<StreamEvent>) -> Vec<StreamEvent> {
    let mut result: Vec<StreamEvent> = Vec::new();
    let mut last_msg_update: Option<StreamEvent> = None;

    for event in events {
        match event.event_type.as_str() {
            "message_start" => {
                if let Some(update) = last_msg_update.take() {
                    result.push(update);
                }
                result.push(event);
            }
            "message_update" => {
                if event.data.get("message").is_some() {
                    last_msg_update = Some(event);
                } else if last_msg_update.is_none() {
                    last_msg_update = Some(event);
                }
            }
            "message_end" => {
                if let Some(update) = last_msg_update.take() {
                    result.push(update);
                }
                result.push(event);
            }
            _ => {
                result.push(event);
            }
        }
    }

    if let Some(update) = last_msg_update.take() {
        result.push(update);
    }

    result
}

fn build_history_replay_events(
    messages: Vec<Value>,
    session_id: &str,
    workspace_id: &str,
    has_more: bool,
    oldest_entry_id: Option<String>,
) -> Vec<StreamEvent> {
    let now = chrono::Utc::now().timestamp_millis();
    let data = json!({
        "type": "history_messages",
        "messages": messages,
        "has_more": has_more,
        "oldest_entry_id": oldest_entry_id,
    });

    vec![StreamEvent {
        id: 0,
        session_id: session_id.to_string(),
        workspace_id: workspace_id.to_string(),
        event_type: "history_messages".to_string(),
        data,
        timestamp: now,
    }]
}

#[utoipa::path(
    get,
    path = "/api/stream/{session_id}",
    params(
        ("session_id" = String, Path, description = "Session ID to stream"),
        ("last_message_id" = Option<String>, Query, description = "Last message ID client has"),
    ),
    responses(
        (status = 200, description = "Per-session SSE event stream"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Session not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "agent"
)]
pub async fn session_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(params): Query<SessionStreamQuery>,
) -> impl IntoResponse {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::<String>::err(msg))).into_response();
    }

    let session_info = state.agent.get_session_info(&session_id).await;
    let workspace_id = session_info
        .as_ref()
        .map(|s| s.workspace_id.clone())
        .unwrap_or_default();

    let mut rx = state.agent.subscribe();

    let skip_history = params.last_message_id.as_deref() == Some("SKIP_HISTORY");
    let msg_limit = params.limit.unwrap_or(20);
    let before_cursor = params.before.clone();

    let (history_messages, has_more, oldest_entry_id) = if skip_history {
        (vec![], false, None)
    } else {
        let base = state.config.sessions_base_path();
        let sid = session_id.clone();
        let last_msg_id = params.last_message_id.clone();
        let before = before_cursor.clone();
        let result = tokio::task::spawn_blocking(move || {
            if last_msg_id.is_some() {
                let msgs = session::get_session_messages_after(&base, &sid, last_msg_id.as_deref())
                    .unwrap_or_default();
                session::PaginatedMessages { messages: msgs, has_more: false, oldest_entry_id: None }
            } else {
                session::get_session_messages_paginated(&base, &sid, msg_limit, before.as_deref())
                    .unwrap_or(session::PaginatedMessages { messages: vec![], has_more: false, oldest_entry_id: None })
            }
        })
        .await
        .unwrap();
        (result.messages, result.has_more, result.oldest_entry_id)
    };

    let history_events = build_history_replay_events(
        history_messages,
        &session_id,
        &workspace_id,
        has_more,
        oldest_entry_id,
    );

    let buffered_events = collapse_buffered_events(
        state.agent.get_buffered_session_events(&session_id).await,
    );
    let high_water_mark = buffered_events.last().map(|e| e.id).unwrap_or(0);

    let target_session_id = session_id.clone();

    let stream = async_stream::stream! {
        let hello = serde_json::json!({
            "type": "session_stream_hello",
            "session_id": target_session_id,
        });
        yield Ok::<_, Infallible>(
            Event::default().data(serde_json::to_string(&hello).unwrap_or_default()),
        );

        for event in history_events {
            let data = stream_event_json(&event);
            yield Ok::<_, Infallible>(
                Event::default().event("history").data(data),
            );
        }

        let history_done = serde_json::json!({"type": "history_done"});
        yield Ok::<_, Infallible>(
            Event::default().event("history_done").data(serde_json::to_string(&history_done).unwrap_or_default()),
        );

        for event in buffered_events {
            let data = stream_event_json(&event);
            yield Ok::<_, Infallible>(
                Event::default().id(event.id.to_string()).data(data),
            );
        }

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.session_id != target_session_id {
                        continue;
                    }
                    if !is_session_only_event(&event.event_type) {
                        continue;
                    }
                    if event.id <= high_water_mark {
                        continue;
                    }
                    let val = strip_live_event(stream_event_value(&event));
                    let data = serde_json::to_string(&val).unwrap_or_default();
                    yield Ok::<_, Infallible>(
                        Event::default().id(event.id.to_string()).data(data),
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    yield Ok::<_, Infallible>(
                        Event::default().data(stream_lagged_json(n.into())),
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

async fn handle_ws_session_stream(
    mut socket: WebSocket,
    state: AppState,
    session_id: String,
    access_token: Option<String>,
    last_message_id: Option<String>,
    before_cursor: Option<String>,
    msg_limit: u32,
) {
    let token = match access_token {
        Some(token) => token,
        None => {
            close_ws(
                socket,
                WS_CLOSE_UNAUTHORIZED,
                "Missing authorization token".to_string(),
            )
            .await;
            return;
        }
    };

    if let Err((status, msg)) = validate_access_token(&state, &token) {
        let close_code = if status == StatusCode::UNAUTHORIZED {
            WS_CLOSE_UNAUTHORIZED
        } else {
            WS_CLOSE_INTERNAL_ERROR
        };
        close_ws(socket, close_code, msg).await;
        return;
    }

    let session_info = state.agent.get_session_info(&session_id).await;
    let workspace_id = session_info
        .as_ref()
        .map(|s| s.workspace_id.clone())
        .unwrap_or_default();

    let hello = serde_json::json!({
        "type": "session_stream_hello",
        "session_id": session_id,
    });
    if !send_ws_batch(&mut socket, vec![hello]).await {
        return;
    }

    let mut rx = state.agent.subscribe();

    let skip_history = last_message_id.as_deref() == Some("SKIP_HISTORY");

    let (history_messages, has_more, oldest_entry_id) = if skip_history {
        (vec![], false, None)
    } else {
        let base = state.config.sessions_base_path();
        let sid = session_id.clone();
        let last_msg = last_message_id.clone();
        let before = before_cursor.clone();
        let result = tokio::task::spawn_blocking(move || {
            if last_msg.is_some() {
                let msgs = session::get_session_messages_after(&base, &sid, last_msg.as_deref())
                    .unwrap_or_default();
                session::PaginatedMessages { messages: msgs, has_more: false, oldest_entry_id: None }
            } else {
                session::get_session_messages_paginated(&base, &sid, msg_limit, before.as_deref())
                    .unwrap_or(session::PaginatedMessages { messages: vec![], has_more: false, oldest_entry_id: None })
            }
        })
        .await
        .unwrap();
        (result.messages, result.has_more, result.oldest_entry_id)
    };

    let history_events = build_history_replay_events(
        history_messages,
        &session_id,
        &workspace_id,
        has_more,
        oldest_entry_id,
    );

    let mut history_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
    for event in history_events {
        history_payloads.push(stream_event_value(&event));
        if history_payloads.len() >= WS_MAX_BATCH_EVENTS {
            if !send_ws_batch(&mut socket, history_payloads).await {
                return;
            }
            history_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
        }
    }
    if !history_payloads.is_empty() && !send_ws_batch(&mut socket, history_payloads).await {
        return;
    }

    let history_done = serde_json::json!({"type": "history_done"});
    if !send_ws_batch(&mut socket, vec![history_done]).await {
        return;
    }

    let buffered_events = collapse_buffered_events(
        state.agent.get_buffered_session_events(&session_id).await,
    );
    let high_water_mark = buffered_events.last().map(|e| e.id).unwrap_or(0);

    let mut buffered_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
    for event in buffered_events {
        buffered_payloads.push(stream_event_value(&event));
        if buffered_payloads.len() >= WS_MAX_BATCH_EVENTS {
            if !send_ws_batch(&mut socket, buffered_payloads).await {
                return;
            }
            buffered_payloads = Vec::with_capacity(WS_MAX_BATCH_EVENTS);
        }
    }
    if !buffered_payloads.is_empty() && !send_ws_batch(&mut socket, buffered_payloads).await {
        return;
    }

    let mut keepalive =
        tokio::time::interval(Duration::from_secs(WS_KEEPALIVE_SECS));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = keepalive.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Pong(_)))
                    | Some(Ok(Message::Text(_)))
                    | Some(Ok(Message::Binary(_))) => {}
                    Some(Err(_)) => break,
                }
            }
            result = rx.recv() => {
                let mut payloads = match result {
                    Ok(event) => {
                        if event.session_id != session_id {
                            continue;
                        }
                        if !is_session_only_event(&event.event_type) {
                            continue;
                        }
                        if event.id <= high_water_mark {
                            continue;
                        }
                        vec![strip_live_event(stream_event_value(&event))]
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        vec![stream_lagged_value(n.into())]
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };

                let closed = drain_ws_pending_payloads_filtered(&mut rx, &mut payloads, Some(&session_id));

                if !send_ws_batch(&mut socket, payloads).await {
                    break;
                }

                if closed {
                    break;
                }
            }
        }
    }
}

pub async fn ws_session_stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Query(params): Query<WsSessionStreamQuery>,
) -> impl IntoResponse {
    let access_token = extract_token(&headers)
        .or_else(|| extract_ws_protocol_token(&headers))
        .or(params.access_token);
    ws.protocols(["pi-stream-v1"])
        .on_upgrade(move |socket| {
            handle_ws_session_stream(socket, state, session_id, access_token, params.last_message_id, params.before, params.limit.unwrap_or(20))
        })
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
