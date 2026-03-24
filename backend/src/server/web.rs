use axum::{
    body::Bytes,
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, Uri},
    response::Response,
};

use crate::routes::agent::header_based_preview_proxy;
use crate::server::state::{ActivePreview, AppState};

const PREVIEW_SW_JS: &str = include_str!("../../../public/preview-sw.js");

pub async fn serve_preview_sw() -> Response<axum::body::Body> {
    Response::builder()
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("service-worker-allowed", "/")
        .body(axum::body::Body::from(PREVIEW_SW_JS))
        .unwrap()
}

fn extract_config_from_query(uri: &Uri) -> Option<ActivePreview> {
    let query = uri.query()?;
    let mut session = None;
    let mut hostname = None;
    let mut port = None;
    let mut token = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next()?;
        let val = kv.next().unwrap_or("");
        match key {
            "__pi_s" => session = Some(urlencoding::decode(val).unwrap_or_default().into_owned()),
            "__pi_h" => hostname = Some(urlencoding::decode(val).unwrap_or_default().into_owned()),
            "__pi_p" => port = Some(val.to_string()),
            "__pi_t" => token = Some(urlencoding::decode(val).unwrap_or_default().into_owned()),
            _ => {}
        }
    }
    Some(ActivePreview {
        session: session?,
        hostname: hostname.unwrap_or_else(|| "localhost".into()),
        port: port?,
        token: token.unwrap_or_default(),
    })
}

fn inject_preview_headers(headers: &mut HeaderMap, config: &ActivePreview) {
    if let Ok(v) = HeaderValue::from_str(&config.session) {
        headers.insert(HeaderName::from_static("x-pi-preview-session"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&config.hostname) {
        headers.insert(HeaderName::from_static("x-pi-preview-hostname"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&config.port) {
        headers.insert(HeaderName::from_static("x-pi-preview-port"), v);
    }
    if !config.token.is_empty() {
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", config.token)) {
            headers.insert(HeaderName::from_static("x-proxy-authorization"), v);
        }
    }
}

async fn try_preview_proxy(
    state: AppState,
    method: Method,
    uri: Uri,
    mut headers: HeaderMap,
    body: Bytes,
) -> Option<Response<axum::body::Body>> {
    if headers.get("x-pi-preview-session").is_some() {
        tracing::info!("[fallback] preview via headers: {} {}", method, uri);
        return header_based_preview_proxy(state, headers, method, uri, body).await;
    }

    let from_query = extract_config_from_query(&uri);
    let is_initial = from_query.is_some();

    let config = if let Some(cfg) = from_query {
        *state.active_preview.write().await = Some(cfg.clone());
        tracing::info!("[fallback] preview via query: {}:{} uri={}", cfg.hostname, cfg.port, uri);
        cfg
    } else {
        let stored = state.active_preview.read().await;
        match stored.as_ref() {
            Some(cfg) => {
                tracing::info!("[fallback] preview via stored config: {}:{} uri={}", cfg.hostname, cfg.port, uri);
                cfg.clone()
            }
            None => return None,
        }
    };

    inject_preview_headers(&mut headers, &config);

    let mut response = header_based_preview_proxy(state, headers, method, uri, body).await?;

    if is_initial {
        let ct = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if ct.contains("text/html") {
            let old_body = std::mem::replace(response.body_mut(), axum::body::Body::empty());
            if let Ok(bytes) = axum::body::to_bytes(old_body, 10 * 1024 * 1024).await {
                let html = String::from_utf8_lossy(&bytes);
                let script = format!(
                    r#"<script>if('serviceWorker' in navigator){{navigator.serviceWorker.register('/preview-sw.js',{{scope:'/'}}).then(function(r){{var w=r.active||r.installing||r.waiting;if(w)w.postMessage({{type:'SET_CONFIG',sessionId:'{}',hostname:'{}',port:'{}',accessToken:'{}'}})}})}}</script>"#,
                    config.session, config.hostname, config.port, config.token
                );
                let injected = if let Some(pos) = html.find("<head") {
                    if let Some(end) = html[pos..].find('>') {
                        let at = pos + end + 1;
                        format!("{}{}{}", &html[..at], script, &html[at..])
                    } else {
                        format!("{}{}", script, html)
                    }
                } else {
                    format!("{}{}", script, html)
                };
                response.headers_mut().remove(header::CONTENT_LENGTH);
                response.headers_mut().remove(HeaderName::from_static("content-encoding"));
                *response.body_mut() = axum::body::Body::from(injected.into_bytes());
            }
        }
    }

    Some(response)
}

#[cfg(not(debug_assertions))]
mod embed {
    use axum::{
        body::{Body, Bytes},
        extract::State,
        http::{header, HeaderMap, Method, StatusCode, Uri},
        response::{IntoResponse, Response},
    };
    use rust_embed::Embed;

    use super::try_preview_proxy;
    use crate::server::state::AppState;

    #[derive(Embed)]
    #[folder = "../dist"]
    struct WebAssets;

    pub async fn fallback_or_preview(
        State(state): State<AppState>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        if let Some(response) = try_preview_proxy(state, method.clone(), uri.clone(), headers, body).await {
            return response;
        }
        serve_web(uri).await.into_response()
    }

    async fn serve_web(uri: Uri) -> impl IntoResponse {
        let path = uri.path();
        let asset_path = if path == "/" { "index.html" } else { &path[1..] };

        match WebAssets::get(asset_path) {
            Some(content) => {
                let mime = mime_guess::from_path(asset_path).first_or_octet_stream();
                Response::builder()
                    .header(header::CONTENT_TYPE, mime.as_ref())
                    .body(Body::from(content.data.to_vec()))
                    .unwrap()
            }
            None => {
                let fallback = match WebAssets::get("index.html") {
                    Some(html) => html,
                    None => {
                        return Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body(Body::from("Web UI not bundled.\n"))
                            .unwrap();
                    }
                };
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(fallback.data.to_vec()))
                    .unwrap()
            }
        }
    }
}

#[cfg(debug_assertions)]
mod embed {
    use axum::{
        body::Bytes,
        extract::State,
        http::{HeaderMap, Method, StatusCode, Uri},
        response::{IntoResponse, Response},
    };

    use super::try_preview_proxy;
    use crate::server::state::AppState;

    pub async fn fallback_or_preview(
        State(state): State<AppState>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        if let Some(response) = try_preview_proxy(state, method, uri, headers, body).await {
            return response;
        }
        (StatusCode::NOT_FOUND, "Web UI only available in release builds.\n").into_response()
    }
}

pub use embed::fallback_or_preview;
