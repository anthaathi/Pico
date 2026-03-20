use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use crate::server::state::AppState;
use crate::models::{ApiResponse, ErrorBody, OperationLog, OperationResult, PackageStatus};
use crate::routes::auth::require_auth;
use crate::services::package;

#[utoipa::path(
    get,
    path = "/api/package/status",
    responses(
        (status = 200, description = "Package status", body = PackageStatus),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "package"
)]
pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<PackageStatus>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let pkg_status = tokio::task::spawn_blocking({
        let config = state.config.package.clone();
        move || package::get_status(&config)
    })
    .await
    .unwrap();

    (StatusCode::OK, Json(ApiResponse::ok(pkg_status)))
}

#[utoipa::path(
    post,
    path = "/api/package/install",
    responses(
        (status = 200, description = "Install result", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "package"
)]
pub async fn install(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let result = tokio::task::spawn_blocking({
        let config = state.config.package.clone();
        move || package::install(&config)
    })
    .await
    .unwrap();

    let status_str = if result.success { "success" } else { "failed" };
    let _ = state.db.log_operation("install", status_str, &result.output);

    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

#[utoipa::path(
    post,
    path = "/api/package/update",
    responses(
        (status = 200, description = "Update result", body = OperationResult),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "package"
)]
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<OperationResult>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let result = tokio::task::spawn_blocking({
        let config = state.config.package.clone();
        move || package::update(&config)
    })
    .await
    .unwrap();

    let status_str = if result.success { "success" } else { "failed" };
    let _ = state.db.log_operation("update", status_str, &result.output);

    (StatusCode::OK, Json(ApiResponse::ok(result)))
}

#[utoipa::path(
    get,
    path = "/api/package/logs",
    params(
        ("limit" = Option<i64>, Query, description = "Number of log entries to return (default: 50)")
    ),
    responses(
        (status = 200, description = "Operation logs", body = Vec<OperationLog>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "package"
)]
pub async fn logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<LogsQuery>,
) -> (StatusCode, Json<ApiResponse<Vec<OperationLog>>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let limit = params.limit.unwrap_or(50);
    match state.db.get_operation_logs(limit) {
        Ok(logs) => (StatusCode::OK, Json(ApiResponse::ok(logs))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to fetch logs: {e}"))),
        ),
    }
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct LogsQuery {
    pub limit: Option<i64>,
}
