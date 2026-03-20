#[cfg(not(debug_assertions))]
mod release_embed {
    use axum::{
        body::Body,
        http::{header, StatusCode, Uri},
        response::{IntoResponse, Response},
    };
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "../dist"]
    struct WebAssets;

    pub async fn serve_web(uri: Uri) -> impl IntoResponse {
        let path = uri.path();

        let asset_path = if path == "/" {
            "index.html"
        } else {
            &path[1..]
        };

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
                            .body(Body::from("Web UI not bundled. Run build:prod to include it.\n"))
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
mod release_embed {
    use axum::{http::StatusCode, response::IntoResponse, response::Response};

    pub async fn serve_web() -> Response {
        (StatusCode::NOT_FOUND, "Web UI is only available in release builds.\nBuild with: cargo build --release\n").into_response()
    }
}

pub use release_embed::serve_web;
