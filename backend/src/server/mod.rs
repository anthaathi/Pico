pub mod openapi;
pub mod router;
pub mod state;
pub mod web;

use std::sync::Arc;

use axum::http::header;
use axum::routing::{any, get};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::cli::Cli;
use crate::config::AppConfig;
use crate::db::Database;
use crate::routes;
use crate::services::agent::AgentManager;
use crate::services::provider::PiAgentProvider;
use crate::services::connection::ConnectionInfo;
use crate::services::pairing::PairingManager;
use crate::services::runtime;
use crate::terminal;

use self::openapi::ApiDoc;
use self::state::AppState;

const QR_ROTATE_MINUTES: u64 = 5;

pub async fn serve(cli: Cli, force_qr: bool) -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pi_server=debug,tower_http=debug".into()),
        )
        .init();

    let config_path = std::path::PathBuf::from(&cli.config);
    let mut config = AppConfig::load(Some(config_path))?;

    if let Some(port) = cli.port {
        config.server.port = port;
    }
    if let Some(host) = cli.host {
        config.server.host = host;
    }

    if config.auth.password_hash.is_empty() {
        tracing::error!(
            "No password_hash configured. Run `pi-server init` or `pi-server hash-password <pw>` to set one."
        );
        std::process::exit(1);
    }

    let startup_runtime_status = runtime::get_agent_runtime_status(&config);
    runtime::log_startup_runtime_status(&startup_runtime_status);

    let db = Database::new(&cli.db)?;

    let has_active_sessions = db.count_active_auth_sessions().unwrap_or(0) > 0;

    let conn_info = Arc::new(ConnectionInfo::gather(config.server.port));
    let pairing = PairingManager::new(QR_ROTATE_MINUTES);

    let server_id = config.server_id().to_string();

    if !has_active_sessions || force_qr {
        conn_info.print_qr(&pairing.current_qr_id(), &server_id);
    }

    let pi_binary = config.pi_binary();
    tracing::info!("Using pi binary: {pi_binary}");
    let pi_provider = Arc::new(PiAgentProvider::new(pi_binary));
    let agent = AgentManager::new(pi_provider);
    agent.start_idle_cleanup_task();

    let instance_id = Arc::new(uuid::Uuid::new_v4().to_string());
    tracing::info!("Server instance ID: {instance_id}");

    let state = AppState {
        config: Arc::new(config.clone()),
        db: Arc::new(db),
        pairing: pairing.clone(),
        agent,
        instance_id,
    };

    let app = build_app(state);

    if !has_active_sessions || force_qr {
        spawn_qr_rotation_task(pairing.clone(), Arc::clone(&conn_info), server_id);
        spawn_pairing_approval_task(pairing);
    }

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Starting pi-server on {addr}");
    tracing::info!("Swagger UI at http://{addr}/swagger-ui/");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn build_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers([
            header::ACCEPT,
            header::AUTHORIZATION,
            header::CACHE_CONTROL,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("last-event-id"),
            header::HeaderName::from_static("x-requested-with"),
        ]);

    Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(routes::health::healthz))
        .route("/version", get(routes::health::version))
        .nest("/api", router::api_routes())
        .fallback(any(web::serve_web))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

fn spawn_qr_rotation_task(
    pairing: PairingManager,
    conn_info: Arc<ConnectionInfo>,
    server_id: String,
) {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_secs(QR_ROTATE_MINUTES * 60));
        interval.tick().await;
        loop {
            interval.tick().await;
            if pairing.is_paired() {
                break;
            }
            let new_id = pairing.rotate();
            tracing::info!("QR ID rotated");
            conn_info.print_qr(&new_id, &server_id);
        }
    });
}

fn spawn_pairing_approval_task(pairing: PairingManager) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Some(req) = pairing.take_pending() {
                let accepted = terminal::prompt_terminal_approval().await;
                let _ = req.respond.send(accepted);
            }
        }
    });
}
