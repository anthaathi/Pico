use axum::routing::{any, delete, get, post};
use axum::Router;

use crate::server::state::AppState;
use crate::routes;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .merge(auth_routes())
        .merge(package_routes())
        .merge(workspace_routes())
        .merge(fs_routes())
        .merge(git_routes())
        .merge(agent_routes())
        .merge(chat_routes())
        .merge(custom_model_routes())
        .merge(task_routes())
}

fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(routes::auth::login))
        .route("/auth/logout", post(routes::auth::logout))
        .route("/auth/session", get(routes::auth::check_session))
        .route("/auth/refresh", post(routes::auth::refresh))
        .route("/auth/pair", post(routes::auth::pair))
}

fn package_routes() -> Router<AppState> {
    Router::new()
        .route("/package/status", get(routes::package::status))
        .route("/package/install", post(routes::package::install))
        .route("/package/update", post(routes::package::update))
        .route("/package/logs", get(routes::package::logs))
}

fn workspace_routes() -> Router<AppState> {
    Router::new()
        .route("/workspaces", get(routes::workspace::list))
        .route("/workspaces", post(routes::workspace::create))
        .route(
            "/workspaces/suggest",
            get(routes::workspace::suggest_workspaces),
        )
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
        .route(
            "/workspaces/{id}/sessions",
            get(routes::workspace::sessions_list),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}",
            get(routes::workspace::sessions_get),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}",
            delete(routes::workspace::sessions_delete),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}/tree",
            get(routes::workspace::sessions_tree),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}/leaf",
            get(routes::workspace::sessions_leaf),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}/children/{entry_id}",
            get(routes::workspace::sessions_children),
        )
        .route(
            "/workspaces/{id}/sessions/{session_id}/branch/{entry_id}",
            get(routes::workspace::sessions_branch),
        )
}

fn fs_routes() -> Router<AppState> {
    Router::new()
        .route("/fs/complete", get(routes::fs::complete))
        .route("/fs/list", get(routes::fs::list))
        .route("/fs/read", get(routes::fs::read))
        .route("/fs/write", post(routes::fs::write))
        .route("/fs/mkdir", post(routes::fs::mkdir))
        .route("/fs/delete", delete(routes::fs::delete))
}

fn git_routes() -> Router<AppState> {
    Router::new()
        .route("/git/status", get(routes::git::status))
        .route("/git/repos", get(routes::git::nested_repos))
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
}

fn agent_routes() -> Router<AppState> {
    Router::new()
        .route("/agent/sessions", post(routes::agent::create_session))
        .route("/agent/sessions", get(routes::agent::list_sessions))
        .route(
            "/agent/runtime-status",
            get(routes::agent::runtime_status),
        )
        .route(
            "/agent/sessions/{session_id}/touch",
            post(routes::agent::touch_session),
        )
        .route(
            "/agent/sessions/{session_id}",
            delete(routes::agent::kill_session),
        )
        .route(
            "/agent/sessions/{session_id}/preview/{hostname}/{port}",
            any(routes::agent::preview_proxy_root),
        )
        .route(
            "/agent/sessions/{session_id}/preview/{hostname}/{port}/{*path}",
            any(routes::agent::preview_proxy_path),
        )
        .route("/stream", get(routes::agent::stream))
        .route("/ws/stream", get(routes::agent::ws_stream))
        .route("/stream/{session_id}", get(routes::agent::session_stream))
        .route("/ws/stream/{session_id}", get(routes::agent::ws_session_stream))
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
}

fn chat_routes() -> Router<AppState> {
    Router::new()
        .route("/chat/sessions", post(routes::chat::create_session))
        .route("/chat/sessions", get(routes::chat::list_sessions))
        .route(
            "/chat/sessions/{session_id}",
            delete(routes::chat::delete_session),
        )
        .route(
            "/chat/sessions/{session_id}/touch",
            post(routes::chat::touch_session),
        )
}

fn custom_model_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/custom-models",
            get(routes::custom_models::get_custom_models),
        )
        .route(
            "/custom-models",
            axum::routing::put(routes::custom_models::save_custom_models),
        )
}

fn task_routes() -> Router<AppState> {
    Router::new()
        .route("/tasks/config/{workspace_id}", get(routes::task::get_config))
        .route("/tasks/list/{workspace_id}", get(routes::task::list_tasks))
        .route("/tasks/start", post(routes::task::start_task))
        .route("/tasks/stop", post(routes::task::stop_task))
        .route("/tasks/restart", post(routes::task::restart_task))
        .route("/tasks/logs/{task_id}", get(routes::task::get_logs))
        .route("/tasks/remove/{task_id}", delete(routes::task::remove_task))
        .route("/ports/scan", post(routes::task::scan_ports))
}
