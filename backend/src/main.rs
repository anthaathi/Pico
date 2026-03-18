mod app;
mod config;
mod db;
mod models;
mod routes;
mod services;
mod web;

use std::io::Write;
use std::sync::Arc;

use axum::http::header;
use axum::routing::{any, delete, get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::app::AppState;
use crate::config::AppConfig;
use crate::db::Database;
use crate::services::agent::AgentManager;
use crate::services::connection::ConnectionInfo;
use crate::services::pairing::PairingManager;
use crate::services::runtime;

const QR_ROTATE_MINUTES: u64 = 5;

#[derive(OpenApi)]
#[openapi(
    paths(
        routes::health::healthz,
        routes::health::version,
        routes::auth::login,
        routes::auth::logout,
        routes::auth::check_session,
        routes::auth::refresh,
        routes::auth::pair,
        routes::package::status,
        routes::package::install,
        routes::package::update,
        routes::package::logs,
        routes::workspace::list,
        routes::workspace::get,
        routes::workspace::create,
        routes::workspace::update,
        routes::workspace::delete,
        routes::workspace::archive,
        routes::workspace::unarchive,
        routes::workspace::suggest_workspaces,
        routes::workspace::sessions_list,
        routes::workspace::sessions_get,
        routes::workspace::sessions_tree,
        routes::workspace::sessions_leaf,
        routes::workspace::sessions_children,
        routes::workspace::sessions_branch,
        routes::workspace::sessions_delete,
        routes::fs::complete,
        routes::fs::list,
        routes::fs::read,
        routes::fs::write,
        routes::fs::mkdir,
        routes::fs::delete,
        routes::git::status,
        routes::git::branches,
        routes::git::log,
        routes::git::checkout,
        routes::git::worktree_list,
        routes::git::worktree_add,
        routes::git::worktree_remove,
        routes::git::diff,
        routes::git::diff_file,
        routes::git::stash_list,
        routes::git::stash_push,
        routes::git::stash_apply,
        routes::git::stash_drop,
        routes::git::stage,
        routes::git::unstage,
        routes::git::discard,
        routes::git::commit,
        routes::agent::create_session,
        routes::agent::runtime_status,
        routes::agent::touch_session,
        routes::agent::kill_session,
        routes::agent::list_sessions,
        routes::agent::stream,
        routes::agent::prompt,
        routes::agent::steer,
        routes::agent::follow_up,
        routes::agent::abort,
        routes::agent::get_state,
        routes::agent::get_messages,
        routes::agent::new_session,
        routes::agent::set_model,
        routes::agent::cycle_model,
        routes::agent::get_available_models,
        routes::agent::set_thinking_level,
        routes::agent::cycle_thinking_level,
        routes::agent::set_steering_mode,
        routes::agent::set_follow_up_mode,
        routes::agent::compact,
        routes::agent::set_auto_compaction,
        routes::agent::set_auto_retry,
        routes::agent::abort_retry,
        routes::agent::bash,
        routes::agent::abort_bash,
        routes::agent::get_session_stats,
        routes::agent::export_html,
        routes::agent::switch_session,
        routes::agent::fork,
        routes::agent::get_fork_messages,
        routes::agent::get_last_assistant_text,
        routes::agent::set_session_name,
        routes::agent::get_commands,
        routes::agent::extension_ui_response,
        routes::custom_models::get_custom_models,
        routes::custom_models::save_custom_models,
    ),
    components(schemas(
        models::HealthResponse,
        models::VersionResponse,
        models::LoginRequest,
        models::AuthTokensResponse,
        models::RefreshRequest,
        models::LogoutRequest,
        models::SessionInfo,
        models::PackageStatus,
        models::OperationLog,
        models::OperationResult,
        models::ErrorBody,
        models::Workspace,
        models::WorkspaceStatus,
        models::CreateWorkspaceRequest,
        models::UpdateWorkspaceRequest,
        models::PairRequest,
        models::PathCompletion,
        models::FsEntry,
        models::FsListResponse,
        models::FsReadResponse,
        models::FsWriteRequest,
        models::FsDeleteRequest,
        models::FsMkdirRequest,
        models::SessionListItem,
        models::PaginatedSessions,
        models::SessionHeader,
        models::SessionEntry,
        models::SessionDetail,
        models::SessionTreeNode,
        models::GitStatusResponse,
        models::GitFileEntry,
        models::GitBranch,
        models::GitLogEntry,
        models::GitWorktree,
        models::GitCheckoutRequest,
        models::GitWorktreeAddRequest,
        models::GitWorktreeRemoveRequest,
        models::GitDiffResponse,
        models::GitFileDiffResponse,
        models::GitStashEntry,
        models::GitPathsRequest,
        models::GitCommitRequest,
        models::GitStashApplyRequest,
        models::agent::CreateAgentSessionRequest,
        models::agent::RuntimeDependencyStatus,
        models::agent::AgentRuntimeStatus,
        models::agent::TouchAgentSessionRequest,
        models::agent::AgentSessionIdRequest,
        models::agent::AgentSessionCommandResponse,
        models::agent::AgentPromptRequest,
        models::agent::ImageContent,
        models::agent::AgentMessageRequest,
        models::agent::AgentSetModelRequest,
        models::agent::AgentSetThinkingRequest,
        models::agent::AgentSetModeRequest,
        models::agent::AgentCompactRequest,
        models::agent::AgentSetBoolRequest,
        models::agent::AgentBashRequest,
        models::agent::AgentExportHtmlRequest,
        models::agent::AgentSwitchSessionRequest,
        models::agent::AgentForkRequest,
        models::agent::AgentSetSessionNameRequest,
        models::agent::AgentNewSessionRequest,
        models::agent::AgentExtensionUiResponseRequest,
        services::agent::AgentSessionInfo,
        services::agent::ActiveSessionSummary,
        services::agent::StreamEvent,
        routes::custom_models::CustomModelsConfig,
        routes::custom_models::CustomProvider,
        routes::custom_models::CustomModelEntry,
        routes::custom_models::SaveCustomModelsRequest,
    )),
    modifiers(&SecurityAddon),
    tags(
        (name = "system", description = "Health and version"),
        (name = "auth", description = "Authentication and pairing"),
        (name = "package", description = "NPM package management"),
        (name = "workspaces", description = "Workspace/project management"),
        (name = "sessions", description = "Pi session management (per workspace)"),
        (name = "filesystem", description = "Filesystem path autocomplete"),
        (name = "git", description = "Git repository operations"),
        (name = "agent", description = "Pi coding agent RPC management"),
        (name = "custom-models", description = "Custom model provider configuration"),
    ),
    info(
        title = "Pi Server",
        version = "0.1.0",
        description = "Management server for pi-coding-agent: auth, package management, and workspace control"
    )
)]
struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::Http::new(
                        utoipa::openapi::security::HttpAuthScheme::Bearer,
                    ),
                ),
            );
        }
    }
}

fn main() -> anyhow::Result<()> {
    if let Some(arg) = std::env::args().nth(1) {
        if arg == "--hash-password" {
            if let Some(pw) = std::env::args().nth(2) {
                let hash = bcrypt::hash(&pw, bcrypt::DEFAULT_COST)?;
                println!("password_hash = \"{hash}\"");
                return Ok(());
            } else {
                eprintln!("Usage: pi-server --hash-password <password>");
                std::process::exit(1);
            }
        }
        if arg == "init" {
            return run_init();
        }
    }

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async_main())
}

async fn async_main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pi_server=debug,tower_http=debug".into()),
        )
        .init();

    let config = AppConfig::load(None)?;

    if config.auth.password_hash.is_empty() {
        tracing::error!("No password_hash configured in config.toml. Run with --hash-password <password> to generate one.");
        std::process::exit(1);
    }

    let startup_runtime_status = runtime::get_agent_runtime_status(&config);
    runtime::log_startup_runtime_status(&startup_runtime_status);

    let db = Database::new("pi-server.db")?;
    let conn_info = Arc::new(ConnectionInfo::gather(config.server.port));
    let pairing = PairingManager::new(QR_ROTATE_MINUTES);

    let server_id = config.server_id().to_string();
    conn_info.print_qr(&pairing.current_qr_id(), &server_id);

    let pi_binary = config.pi_binary();
    tracing::info!("Using pi binary: {pi_binary}");
    let agent = AgentManager::new(pi_binary);
    agent.start_idle_cleanup_task();

    let state = AppState {
        config: Arc::new(config.clone()),
        db: Arc::new(db),
        pairing: pairing.clone(),
        agent,
    };

    let api_routes = Router::new()
        .route("/auth/login", post(routes::auth::login))
        .route("/auth/logout", post(routes::auth::logout))
        .route("/auth/session", get(routes::auth::check_session))
        .route("/auth/refresh", post(routes::auth::refresh))
        .route("/auth/pair", post(routes::auth::pair))
        .route("/package/status", get(routes::package::status))
        .route("/package/install", post(routes::package::install))
        .route("/package/update", post(routes::package::update))
        .route("/package/logs", get(routes::package::logs))
        .route("/workspaces", get(routes::workspace::list))
        .route("/workspaces", post(routes::workspace::create))
        .route("/workspaces/suggest", get(routes::workspace::suggest_workspaces))
        .route("/workspaces/{id}", get(routes::workspace::get))
        .route(
            "/workspaces/{id}",
            axum::routing::put(routes::workspace::update),
        )
        .route("/workspaces/{id}", delete(routes::workspace::delete))
        .route(
            "/workspaces/{id}/archive",
            post(routes::workspace::archive),
        )
        .route(
            "/workspaces/{id}/unarchive",
            post(routes::workspace::unarchive),
        )
        .route("/workspaces/{id}/sessions", get(routes::workspace::sessions_list))
        .route("/workspaces/{id}/sessions/{session_id}", get(routes::workspace::sessions_get))
        .route("/workspaces/{id}/sessions/{session_id}", delete(routes::workspace::sessions_delete))
        .route("/workspaces/{id}/sessions/{session_id}/tree", get(routes::workspace::sessions_tree))
        .route("/workspaces/{id}/sessions/{session_id}/leaf", get(routes::workspace::sessions_leaf))
        .route("/workspaces/{id}/sessions/{session_id}/children/{entry_id}", get(routes::workspace::sessions_children))
        .route("/workspaces/{id}/sessions/{session_id}/branch/{entry_id}", get(routes::workspace::sessions_branch))
        .route("/fs/complete", get(routes::fs::complete))
        .route("/fs/list", get(routes::fs::list))
        .route("/fs/read", get(routes::fs::read))
        .route("/fs/write", post(routes::fs::write))
        .route("/fs/mkdir", post(routes::fs::mkdir))
        .route("/fs/delete", delete(routes::fs::delete))
        .route("/git/status", get(routes::git::status))
        .route("/git/branches", get(routes::git::branches))
        .route("/git/log", get(routes::git::log))
        .route("/git/checkout", post(routes::git::checkout))
        .route("/git/worktrees", get(routes::git::worktree_list))
        .route("/git/worktrees", post(routes::git::worktree_add))
        .route("/git/worktrees", delete(routes::git::worktree_remove))
        .route("/git/diff", get(routes::git::diff))
        .route("/git/diff/file", get(routes::git::diff_file))
        .route("/git/stash", get(routes::git::stash_list))
        .route("/git/stash", post(routes::git::stash_push))
        .route("/git/stash/apply", post(routes::git::stash_apply))
        .route("/git/stash", delete(routes::git::stash_drop))
        .route("/git/stage", post(routes::git::stage))
        .route("/git/unstage", post(routes::git::unstage))
        .route("/git/discard", post(routes::git::discard))
        .route("/git/commit", post(routes::git::commit))
        .route("/agent/sessions", post(routes::agent::create_session))
        .route("/agent/sessions", get(routes::agent::list_sessions))
        .route("/agent/runtime-status", get(routes::agent::runtime_status))
        .route(
            "/agent/sessions/{session_id}/touch",
            post(routes::agent::touch_session),
        )
        .route(
            "/agent/sessions/{session_id}",
            delete(routes::agent::kill_session),
        )
        .route("/stream", get(routes::agent::stream))
        .route("/agent/prompt", post(routes::agent::prompt))
        .route("/agent/steer", post(routes::agent::steer))
        .route("/agent/follow-up", post(routes::agent::follow_up))
        .route("/agent/abort", post(routes::agent::abort))
        .route("/agent/state", post(routes::agent::get_state))
        .route("/agent/messages", post(routes::agent::get_messages))
        .route("/agent/new-session", post(routes::agent::new_session))
        .route("/agent/set-model", post(routes::agent::set_model))
        .route("/agent/cycle-model", post(routes::agent::cycle_model))
        .route("/agent/models", post(routes::agent::get_available_models))
        .route(
            "/agent/set-thinking",
            post(routes::agent::set_thinking_level),
        )
        .route(
            "/agent/cycle-thinking",
            post(routes::agent::cycle_thinking_level),
        )
        .route(
            "/agent/set-steering-mode",
            post(routes::agent::set_steering_mode),
        )
        .route(
            "/agent/set-follow-up-mode",
            post(routes::agent::set_follow_up_mode),
        )
        .route("/agent/compact", post(routes::agent::compact))
        .route(
            "/agent/set-auto-compaction",
            post(routes::agent::set_auto_compaction),
        )
        .route(
            "/agent/set-auto-retry",
            post(routes::agent::set_auto_retry),
        )
        .route("/agent/abort-retry", post(routes::agent::abort_retry))
        .route("/agent/bash", post(routes::agent::bash))
        .route("/agent/abort-bash", post(routes::agent::abort_bash))
        .route(
            "/agent/session-stats",
            post(routes::agent::get_session_stats),
        )
        .route("/agent/export-html", post(routes::agent::export_html))
        .route(
            "/agent/switch-session",
            post(routes::agent::switch_session),
        )
        .route("/agent/fork", post(routes::agent::fork))
        .route(
            "/agent/fork-messages",
            post(routes::agent::get_fork_messages),
        )
        .route(
            "/agent/last-assistant-text",
            post(routes::agent::get_last_assistant_text),
        )
        .route(
            "/agent/set-session-name",
            post(routes::agent::set_session_name),
        )
        .route("/agent/commands", post(routes::agent::get_commands))
        .route(
            "/agent/extension-ui-response",
            post(routes::agent::extension_ui_response),
        )
        .route("/custom-models", get(routes::custom_models::get_custom_models))
        .route(
            "/custom-models",
            axum::routing::put(routes::custom_models::save_custom_models),
        );

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

    let app = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(routes::health::healthz))
        .route("/version", get(routes::health::version))
        .nest("/api", api_routes)
        .fallback(any(web::serve_web))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let rotate_pairing = pairing.clone();
    let rotate_conn = Arc::clone(&conn_info);
    let rotate_server_id = server_id.clone();
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_secs(QR_ROTATE_MINUTES * 60));
        interval.tick().await;
        loop {
            interval.tick().await;
            if rotate_pairing.is_paired() {
                break;
            }
            let new_id = rotate_pairing.rotate();
            tracing::info!("QR ID rotated");
            rotate_conn.print_qr(&new_id, &rotate_server_id);
        }
    });

    // Background: poll for pending pair requests and prompt terminal
    let prompt_pairing = pairing.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if let Some(req) = prompt_pairing.take_pending() {
                let accepted = prompt_terminal_approval().await;
                let _ = req.respond.send(accepted);
            }
        }
    });

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Starting pi-server on {addr}");
    tracing::info!("Swagger UI at http://{addr}/swagger-ui/");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn run_init() -> anyhow::Result<()> {
    let config_path = std::path::PathBuf::from("config.toml");

    if config_path.exists() {
        eprintln!("config.toml already exists. Remove it first if you want to reinitialize.");
        std::process::exit(1);
    }

    println!("=== pi-server init ===");
    println!();

    let username = prompt_input("Username [admin]: ").unwrap_or_else(|| "admin".to_string());
    let password = prompt_password("Password: ");
    if password.is_empty() {
        eprintln!("Password cannot be empty.");
        std::process::exit(1);
    }

    let hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)?;

    let config = config::AppConfig {
        server: config::ServerConfig {
            port: 5454,
            host: "0.0.0.0".to_string(),
            server_id: None,
        },
        auth: config::AuthConfig {
            username,
            password_hash: hash,
            access_token_ttl_minutes: 15,
            refresh_token_ttl_days: 30,
            session_ttl_hours: None,
        },
        package: config::PackageConfig {
            name: "@mariozechner/pi-coding-agent".to_string(),
            install_command: None,
        },
        sessions: None,
        agent: None,
    };

    let mut final_config = config;
    if final_config.server.server_id.is_none() {
        final_config.server.server_id = Some(uuid::Uuid::new_v4().to_string());
    }

    let toml_str = toml::to_string_pretty(&final_config)?;
    std::fs::write(&config_path, &toml_str)?;

    println!();
    println!("config.toml created successfully.");
    println!("Run: ./pi-server");

    Ok(())
}

fn prompt_input(prompt: &str) -> Option<String> {
    print!("{}", prompt);
    std::io::stdout().flush().unwrap();
    let mut input = String::new();
    std::io::stdin().read_line(&mut input).ok()?;
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn prompt_password(prompt: &str) -> String {
    print!("{}", prompt);
    std::io::stdout().flush().unwrap();

    #[cfg(unix)]
    {
        let mut password = String::new();
        unsafe {
            let mut termios: libc::termios = std::mem::zeroed();
            let ret = libc::tcgetattr(libc::STDIN_FILENO, &mut termios);
            if ret != 0 {
                std::io::stdin().read_line(&mut password).ok();
                return password.trim().to_string();
            }
            let mut no_echo = termios;
            no_echo.c_lflag &= !(libc::ECHO);
            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &no_echo);

            std::io::stdin().read_line(&mut password).ok();

            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &termios);

            println!();
        }
        password.trim().to_string()
    }

    #[cfg(not(unix))]
    {
        let mut password = String::new();
        std::io::stdin().read_line(&mut password).ok();
        password.trim().to_string()
    }
}

async fn prompt_terminal_approval() -> bool {
    println!();
    println!("  ╔══════════════════════════════════════════╗");
    println!("  ║  PAIRING REQUEST from mobile device      ║");
    println!("  ║  Accept? (y/n):                          ║");
    println!("  ╚══════════════════════════════════════════╝");
    print!("  > ");

    use std::io::Write;
    std::io::stdout().flush().unwrap();

    let result = tokio::task::spawn_blocking(|| {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).ok();
        let trimmed = input.trim().to_lowercase();
        trimmed == "y" || trimmed == "yes"
    })
    .await;

    match result {
        Ok(accepted) => {
            if accepted {
                println!("  Pairing ACCEPTED");
            } else {
                println!("  Pairing REJECTED");
            }
            accepted
        }
        Err(_) => {
            println!("  Pairing FAILED (input error)");
            false
        }
    }
}
