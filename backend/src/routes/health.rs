use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use crate::server::state::AppState;
use crate::models::{HealthResponse, VersionResponse};

const APP_NAME: &str = env!("CARGO_PKG_NAME");
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[utoipa::path(
    get,
    path = "/healthz",
    responses(
        (status = 200, description = "Service is healthy", body = HealthResponse),
    ),
    tag = "system"
)]
pub async fn healthz() -> (StatusCode, Json<HealthResponse>) {
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "ok".to_string(),
        }),
    )
}

#[utoipa::path(
    get,
    path = "/version",
    responses(
        (status = 200, description = "App name and version", body = VersionResponse),
    ),
    tag = "system"
)]
pub async fn version(
    State(state): State<AppState>,
) -> (StatusCode, Json<VersionResponse>) {
    (
        StatusCode::OK,
        Json(VersionResponse {
            name: APP_NAME.to_string(),
            version: APP_VERSION.to_string(),
            server_id: state.config.server_id().to_string(),
        }),
    )
}
