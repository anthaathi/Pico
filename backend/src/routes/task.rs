use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::models::*;
use crate::routes::auth::require_auth;
use crate::server::state::AppState;
use crate::services::task::TaskManager;

// ---------------------------------------------------------------------------
// GET /api/tasks/config/:workspace_id – read tasks.json for a workspace
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/tasks/config/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Tasks configuration", body = TasksConfig),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Workspace not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn get_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<TasksConfig>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let workspace = match state.db.get_workspace(&workspace_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err("Workspace not found")),
            )
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("DB error: {e}"))),
            )
        }
    };

    match TaskManager::read_tasks_config(&workspace.path) {
        Ok(config) => (StatusCode::OK, Json(ApiResponse::ok(config))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(e)),
        ),
    }
}

// ---------------------------------------------------------------------------
// GET /api/tasks/list/:workspace_id – list running/stopped tasks for a workspace
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/tasks/list/{workspace_id}",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Task instances", body = Vec<TaskInfo>),
        (status = 401, description = "Unauthorized"),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn list_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<Vec<TaskInfo>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let tasks = state.task_manager.list_tasks(&workspace_id).await;
    (StatusCode::OK, Json(ApiResponse::ok(tasks)))
}

// ---------------------------------------------------------------------------
// POST /api/tasks/start – start a task
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/tasks/start",
    request_body = StartTaskRequest,
    responses(
        (status = 200, description = "Task started", body = TaskInfo),
        (status = 401, description = "Unauthorized"),
        (status = 400, description = "Bad request", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn start_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StartTaskRequest>,
) -> (StatusCode, Json<ApiResponse<TaskInfo>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let workspace = match state.db.get_workspace(&req.workspace_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err("Workspace not found")),
            )
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("DB error: {e}"))),
            )
        }
    };

    let config = match TaskManager::read_tasks_config(&workspace.path) {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    };

    let definition = match config.tasks.iter().find(|t| t.label == req.label) {
        Some(d) => d.clone(),
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(ApiResponse::err(format!(
                    "Task '{}' not found in config",
                    req.label
                ))),
            )
        }
    };

    match state
        .task_manager
        .start_task(&req.label, &req.workspace_id, &workspace.path, &definition)
        .await
    {
        Ok(info) => {
            let scanner = state.port_scanner.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                scanner.scan_and_broadcast().await;
            });
            (StatusCode::OK, Json(ApiResponse::ok(info)))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

// ---------------------------------------------------------------------------
// POST /api/tasks/stop – stop a task
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/tasks/stop",
    request_body = TaskActionRequest,
    responses(
        (status = 200, description = "Task stopped", body = TaskInfo),
        (status = 401, description = "Unauthorized"),
        (status = 400, description = "Bad request", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn stop_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TaskActionRequest>,
) -> (StatusCode, Json<ApiResponse<TaskInfo>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.task_manager.stop_task(&req.task_id).await {
        Ok(info) => {
            let scanner = state.port_scanner.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                scanner.scan_and_broadcast().await;
            });
            (StatusCode::OK, Json(ApiResponse::ok(info)))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

// ---------------------------------------------------------------------------
// POST /api/tasks/restart – restart a task
// ---------------------------------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/tasks/restart",
    request_body = TaskActionRequest,
    responses(
        (status = 200, description = "Task restarted", body = TaskInfo),
        (status = 401, description = "Unauthorized"),
        (status = 400, description = "Bad request", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn restart_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<TaskActionRequest>,
) -> (StatusCode, Json<ApiResponse<TaskInfo>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    // Get the workspace path from the task's workspace_id
    let workspace_path = {
        let tasks = state.task_manager.list_all_tasks().await;
        let task = match tasks.iter().find(|t| t.id == req.task_id) {
            Some(t) => t,
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(ApiResponse::err("Task not found")),
                )
            }
        };
        match state.db.get_workspace(&task.workspace_id) {
            Ok(Some(w)) => w.path,
            _ => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(ApiResponse::err("Workspace not found")),
                )
            }
        }
    };

    match state
        .task_manager
        .restart_task(&req.task_id, &workspace_path)
        .await
    {
        Ok(info) => (StatusCode::OK, Json(ApiResponse::ok(info))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

// ---------------------------------------------------------------------------
// GET /api/tasks/:task_id/logs – get task logs
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/tasks/logs/{task_id}",
    params(("task_id" = String, Path, description = "Task instance ID")),
    responses(
        (status = 200, description = "Task logs", body = TaskLogs),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Task not found", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn get_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<TaskLogs>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.task_manager.get_logs(&task_id).await {
        Ok(logs) => (StatusCode::OK, Json(ApiResponse::ok(logs))),
        Err(e) => (StatusCode::NOT_FOUND, Json(ApiResponse::err(e))),
    }
}

// ---------------------------------------------------------------------------
// DELETE /api/tasks/remove/:task_id – remove a stopped task
// ---------------------------------------------------------------------------

#[utoipa::path(
    delete,
    path = "/api/tasks/remove/{task_id}",
    params(("task_id" = String, Path, description = "Task instance ID")),
    responses(
        (status = 200, description = "Task removed"),
        (status = 401, description = "Unauthorized"),
        (status = 400, description = "Bad request", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "tasks"
)]
pub async fn remove_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    match state.task_manager.remove_task(&task_id).await {
        Ok(()) => (
            StatusCode::OK,
            Json(ApiResponse::ok("Task removed".to_string())),
        ),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::err(e))),
    }
}

pub async fn scan_ports(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<String>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    state.port_scanner.scan_and_broadcast().await;
    (
        StatusCode::OK,
        Json(ApiResponse::ok("Port scan complete".to_string())),
    )
}
