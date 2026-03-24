use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use crate::server::state::AppState;
use crate::db::AuthSessionRecord;
use crate::models::{
    ApiResponse, AuthTokensResponse, ErrorBody, LoginRequest, LogoutRequest, PairRequest,
    RefreshRequest,
};

fn auth_tokens_response(session: AuthSessionRecord) -> AuthTokensResponse {
    AuthTokensResponse {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        access_expires_at: session.access_expires_at,
        refresh_expires_at: session.refresh_expires_at,
    }
}

fn create_pairing_session(
    state: &AppState,
) -> (StatusCode, Json<ApiResponse<AuthTokensResponse>>) {
    match state.db.create_auth_session(
        &state.config.auth.username,
        state.config.auth.access_token_ttl_minutes,
        state.config.auth.refresh_token_ttl_days,
    ) {
        Ok(session) => (
            StatusCode::OK,
            Json(ApiResponse::ok(auth_tokens_response(session))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Session creation failed: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = AuthTokensResponse),
        (status = 401, description = "Invalid credentials", body = ErrorBody),
    ),
    tag = "auth"
)]
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> (StatusCode, Json<ApiResponse<AuthTokensResponse>>) {
    if req.username != state.config.auth.username {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::err("Invalid credentials")),
        );
    }

    let valid = bcrypt::verify(&req.password, &state.config.auth.password_hash).unwrap_or(false);
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::err("Invalid credentials")),
        );
    }

    match state.db.create_auth_session(
        &req.username,
        state.config.auth.access_token_ttl_minutes,
        state.config.auth.refresh_token_ttl_days,
    ) {
        Ok(session) => (
            StatusCode::OK,
            Json(ApiResponse::ok(auth_tokens_response(session))),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Session creation failed: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    request_body = Option<LogoutRequest>,
    responses(
        (status = 200, description = "Logged out"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: Option<Json<LogoutRequest>>,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let access_token = extract_token(&headers);
    let refresh_token = body.and_then(|Json(payload)| payload.refresh_token);

    if access_token.is_none() && refresh_token.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::err(
                "Missing authorization token or refresh token",
            )),
        );
    }

    let result = if let Some(token) = access_token {
        state.db.revoke_auth_session_by_access_token(&token)
    } else if let Some(token) = refresh_token {
        state.db.revoke_auth_session_by_refresh_token(&token)
    } else {
        Ok(())
    };

    match result {
        Ok(_) => (StatusCode::OK, Json(ApiResponse::ok("Logged out".to_string()))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Logout failed: {e}"))),
        ),
    }
}

#[utoipa::path(
    get,
    path = "/api/auth/session",
    responses(
        (status = 200, description = "Session valid"),
        (status = 401, description = "Session invalid or expired", body = ErrorBody),
    ),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
pub async fn check_session(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> (StatusCode, Json<ApiResponse<String>>) {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ApiResponse::err("Missing authorization token")),
            )
        }
    };

    match state.db.validate_access_token(&token) {
        Ok(Some(username)) => (
            StatusCode::OK,
            Json(ApiResponse::ok(format!("Session valid for user: {username}"))),
        ),
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::err("Session invalid or expired")),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Session check failed: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/refresh",
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Tokens refreshed", body = AuthTokensResponse),
        (status = 401, description = "Refresh token invalid or expired", body = ErrorBody),
    ),
    tag = "auth"
)]
pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> (StatusCode, Json<ApiResponse<AuthTokensResponse>>) {
    match state.db.rotate_auth_session(
        &req.refresh_token,
        state.config.auth.access_token_ttl_minutes,
        state.config.auth.refresh_token_ttl_days,
    ) {
        Ok(Some(session)) => (
            StatusCode::OK,
            Json(ApiResponse::ok(auth_tokens_response(session))),
        ),
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::err("Refresh token invalid or expired")),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err(format!("Token refresh failed: {e}"))),
        ),
    }
}

#[utoipa::path(
    post,
    path = "/api/auth/pair",
    request_body = PairRequest,
    responses(
        (status = 200, description = "Pairing accepted, auth tokens returned", body = AuthTokensResponse),
        (status = 400, description = "Invalid or expired QR ID", body = ErrorBody),
        (status = 408, description = "Pairing rejected by server operator", body = ErrorBody),
        (status = 409, description = "Another pairing request is already pending", body = ErrorBody),
    ),
    tag = "auth"
)]
pub async fn pair(
    State(state): State<AppState>,
    Json(req): Json<PairRequest>,
) -> (StatusCode, Json<ApiResponse<AuthTokensResponse>>) {
    if !state.pairing.validate_qr_id(&req.qr_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::err("Invalid or expired QR ID")),
        );
    }

    let (tx, rx) = tokio::sync::oneshot::channel();

    if !state.pairing.submit_pair_request(tx) {
        return (
            StatusCode::CONFLICT,
            Json(ApiResponse::err("Another pairing request is already pending")),
        );
    }

    tracing::info!("Pairing request received — waiting for terminal approval...");

    match rx.await {
        Ok(true) => {
            state.pairing.mark_paired();
            state.pairing.invalidate_qr_id();
            create_pairing_session(&state)
        }
        Ok(false) => (
            StatusCode::REQUEST_TIMEOUT,
            Json(ApiResponse::err("Pairing rejected by server operator")),
        ),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse::err("Pairing request cancelled")),
        ),
    }
}

pub fn extract_token(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .or_else(|| headers.get("x-proxy-authorization"))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

pub fn validate_access_token(
    state: &AppState,
    token: &str,
) -> Result<String, (StatusCode, String)> {
    state
        .db
        .validate_access_token(token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Auth check failed: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Session invalid or expired".to_string()))
}

pub async fn require_auth(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<String, (StatusCode, String)> {
    let token = extract_token(headers)
        .ok_or((StatusCode::UNAUTHORIZED, "Missing authorization token".to_string()))?;

    validate_access_token(state, &token)
}
