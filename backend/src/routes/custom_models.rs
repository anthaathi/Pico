use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use utoipa::ToSchema;

use crate::app::AppState;
use crate::models::ApiResponse;
use crate::routes::auth::require_auth;

fn models_json_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    PathBuf::from(home).join(".pi/agent/models.json")
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CustomModelEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Vec<String>>,
    #[serde(rename = "contextWindow", skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CustomProvider {
    #[serde(rename = "baseUrl", skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default)]
    pub models: Vec<CustomModelEntry>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CustomModelsConfig {
    #[serde(default)]
    pub providers: std::collections::HashMap<String, CustomProvider>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveCustomModelsRequest {
    pub providers: std::collections::HashMap<String, CustomProvider>,
}

#[utoipa::path(
    get,
    path = "/api/custom-models",
    responses(
        (status = 200, description = "Custom models config"),
    ),
    security(("bearer_auth" = [])),
    tag = "custom-models"
)]
pub async fn get_custom_models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<ApiResponse<CustomModelsConfig>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let path = models_json_path();
    let config = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<CustomModelsConfig>(&content) {
                Ok(config) => config,
                Err(_) => CustomModelsConfig {
                    providers: std::collections::HashMap::new(),
                },
            },
            Err(_) => CustomModelsConfig {
                providers: std::collections::HashMap::new(),
            },
        }
    } else {
        CustomModelsConfig {
            providers: std::collections::HashMap::new(),
        }
    };

    (StatusCode::OK, Json(ApiResponse::ok(config)))
}

#[utoipa::path(
    put,
    path = "/api/custom-models",
    request_body = SaveCustomModelsRequest,
    responses(
        (status = 200, description = "Saved"),
    ),
    security(("bearer_auth" = [])),
    tag = "custom-models"
)]
pub async fn save_custom_models(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SaveCustomModelsRequest>,
) -> (StatusCode, Json<ApiResponse<Value>>) {
    if let Err((code, msg)) = require_auth(&state, &headers).await {
        return (code, Json(ApiResponse::err(msg)));
    }

    let path = models_json_path();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiResponse::err(format!("Failed to create directory: {e}"))),
                );
            }
        }
    }

    let config = CustomModelsConfig {
        providers: req.providers,
    };

    match serde_json::to_string_pretty(&config) {
        Ok(json) => match std::fs::write(&path, json) {
            Ok(_) => (StatusCode::OK, Json(ApiResponse::ok(serde_json::json!({"saved": true})))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::err(format!("Failed to write models.json: {e}"))),
            ),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Failed to serialize: {e}"))),
        ),
    }
}
