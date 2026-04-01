use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::Instant;
use utoipa::ToSchema;

use super::provider::{
    AgentCapability, AgentCommand, AgentProcessHandle, AgentProvider, AgentSessionConfig,
    AgentStreamEvent, CommandResponse, ExtensionUiRequestKind, SessionSnapshot,
    StreamingBehavior, TurnStats,
};

const MAX_BUFFER_SIZE: usize = 10_000;
const IDLE_TIMEOUT_SECS: u64 = 30 * 60;

// ---------------------------------------------------------------------------
// Public types (unchanged API surface for routes)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct StreamEvent {
    pub id: u64,
    pub session_id: String,
    pub workspace_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: Value,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AgentSessionInfo {
    pub session_id: String,
    pub session_file: String,
    pub workspace_id: String,
    pub cwd: String,
    pub model: Option<Value>,
    pub thinking_level: Option<String>,
    pub process_alive: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ActiveSessionSummary {
    pub session_id: String,
    pub session_file: String,
    pub workspace_id: String,
    pub cwd: String,
    pub process_alive: bool,
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

struct AgentSession {
    session_id: String,
    session_file: String,
    workspace_id: String,
    cwd: String,
    model: Option<Value>,
    thinking_level: Option<String>,
    pending_extension_ui_request: Option<Value>,
    handle: Option<Arc<dyn AgentProcessHandle>>,
    last_activity: Arc<Mutex<Instant>>,
    resume_lock: Arc<Mutex<()>>,
    extra_args: Vec<String>,
    provider_id: String,
    session_id_ref: Arc<StdMutex<String>>,
}

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AgentManager {
    sessions: Arc<RwLock<HashMap<String, AgentSession>>>,
    session_aliases: Arc<RwLock<HashMap<String, String>>>,
    event_counter: Arc<AtomicU64>,
    broadcast_tx: broadcast::Sender<StreamEvent>,
    event_buffer: Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    providers: Arc<RwLock<HashMap<String, Arc<dyn AgentProvider>>>>,
    default_provider_id: Arc<String>,
}

impl AgentManager {
    pub fn new(default_provider: Arc<dyn AgentProvider>) -> Self {
        let (tx, _) = broadcast::channel(4096);
        let default_id = default_provider.provider_id().to_string();
        let mut providers = HashMap::new();
        providers.insert(default_id.clone(), default_provider);

        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_aliases: Arc::new(RwLock::new(HashMap::new())),
            event_counter: Arc::new(AtomicU64::new(1)),
            broadcast_tx: tx,
            event_buffer: Arc::new(Mutex::new(std::collections::VecDeque::with_capacity(
                MAX_BUFFER_SIZE,
            ))),
            providers: Arc::new(RwLock::new(providers)),
            default_provider_id: Arc::new(default_id),
        }
    }

    pub fn default_provider_id(&self) -> String {
        self.default_provider_id.to_string()
    }

    #[allow(dead_code)]
    pub async fn register_provider(&self, provider: Arc<dyn AgentProvider>) {
        let id = provider.provider_id().to_string();
        self.providers.write().await.insert(id, provider);
    }

    #[allow(dead_code)]
    pub async fn list_providers(&self) -> Vec<String> {
        self.providers.read().await.keys().cloned().collect()
    }

    #[allow(dead_code)]
    pub async fn provider_capabilities(
        &self,
        provider_id: &str,
    ) -> Option<HashSet<AgentCapability>> {
        let providers = self.providers.read().await;
        providers.get(provider_id).map(|p| p.capabilities())
    }

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    pub async fn create_session_with_provider(
        &self,
        provider_id: &str,
        workspace_id: String,
        cwd: String,
        session_path: Option<String>,
        previous_key: Option<String>,
        resume_lock: Option<Arc<Mutex<()>>>,
        extra_args: Vec<String>,
    ) -> Result<AgentSessionInfo, String> {
        let provider = {
            let providers = self.providers.read().await;
            providers
                .get(provider_id)
                .cloned()
                .ok_or_else(|| format!("Unknown provider: {provider_id}"))?
        };

        let config = AgentSessionConfig {
            workspace_id: workspace_id.clone(),
            cwd: cwd.clone(),
            session_path,
            extra_args: extra_args.clone(),
        };

        let spawned = provider.spawn_session(config).await?;
        let snapshot = spawned.snapshot;

        let session = AgentSession {
            session_id: snapshot.session_id.clone(),
            session_file: snapshot.session_file.clone(),
            workspace_id: workspace_id.clone(),
            cwd: cwd.clone(),
            model: snapshot.model.clone(),
            thinking_level: snapshot.thinking_level.clone(),
            pending_extension_ui_request: None,
            handle: Some(spawned.handle),
            last_activity: Arc::new(Mutex::new(Instant::now())),
            resume_lock: resume_lock.unwrap_or_else(|| Arc::new(Mutex::new(()))),
            extra_args,
            provider_id: provider_id.to_string(),
            session_id_ref: Arc::new(StdMutex::new(snapshot.session_id.clone())),
        };

        let session_id_ref = session.session_id_ref.clone();

        {
            let mut sessions = self.sessions.write().await;
            if let Some(prev) = previous_key.as_ref() {
                sessions.remove(prev);
            }
            sessions.insert(snapshot.session_id.clone(), session);
        }

        if let Some(prev) = previous_key.as_ref() {
            if prev != &snapshot.session_id {
                self.repoint_aliases(prev, &snapshot.session_id).await;
            }
        }

        for event in &spawned.initial_events {
            self.update_pending_extension_ui_from_stream_event(
                &snapshot.session_id,
                event,
            )
            .await;
            self.emit_stream_event(&snapshot.session_id, &workspace_id, event)
                .await;
        }

        self.spawn_event_reader(
            session_id_ref,
            workspace_id.clone(),
            spawned.event_rx,
        );

        self.emit_active_sessions().await;

        Ok(AgentSessionInfo {
            session_id: snapshot.session_id,
            session_file: snapshot.session_file,
            workspace_id,
            cwd,
            model: snapshot.model,
            thinking_level: snapshot.thinking_level,
            process_alive: true,
        })
    }

    pub async fn touch_session(
        &self,
        session_id: &str,
        session_file: String,
        workspace_id: String,
        cwd: String,
    ) -> Result<AgentSessionInfo, String> {
        let resolved_id = self.resolve_session_id(session_id).await;
        let mut previous_key = None;
        let mut resume_lock = None;
        let mut extra_args = vec![];
        let mut provider_id = self.default_provider_id.to_string();

        let (workspace_id, cwd, session_file) = {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&resolved_id) {
                if session.handle.is_some()
                    && session
                        .handle
                        .as_ref()
                        .map(|h| h.is_alive())
                        .unwrap_or(false)
                {
                    *session.last_activity.lock().await = Instant::now();
                    return Ok(build_session_info(session));
                }
                previous_key = Some(resolved_id.clone());
                resume_lock = Some(session.resume_lock.clone());
                extra_args = session.extra_args.clone();
                provider_id = session.provider_id.clone();
                (
                    session.workspace_id.clone(),
                    session.cwd.clone(),
                    session.session_file.clone(),
                )
            } else {
                (workspace_id, cwd, session_file)
            }
        };

        let resume_lock_for_spawn = resume_lock.clone();
        let _resume_guard = if let Some(lock) = resume_lock.as_ref() {
            Some(lock.lock().await)
        } else {
            None
        };

        if previous_key.is_some() {
            let re_resolved = self.resolve_session_id(session_id).await;
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&re_resolved) {
                if session.handle.is_some()
                    && session
                        .handle
                        .as_ref()
                        .map(|h| h.is_alive())
                        .unwrap_or(false)
                {
                    *session.last_activity.lock().await = Instant::now();
                    return Ok(build_session_info(session));
                }
            }
            previous_key = Some(re_resolved);
        }

        self.create_session_with_provider(
            &provider_id,
            workspace_id,
            cwd,
            Some(session_file),
            previous_key,
            resume_lock_for_spawn,
            extra_args,
        )
        .await
    }

    pub async fn kill_session(&self, session_id: &str) -> Result<(), String> {
        let resolved_id = self.resolve_session_id(session_id).await;
        let handle = {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .remove(&resolved_id)
                .ok_or("Session not found")?;
            session.handle
        };
        self.clear_aliases(&resolved_id).await;
        if let Some(handle) = handle {
            handle.terminate().await;
        }
        self.emit_active_sessions().await;
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<ActiveSessionSummary> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .map(|s| ActiveSessionSummary {
                session_id: s.session_id.clone(),
                session_file: s.session_file.clone(),
                workspace_id: s.workspace_id.clone(),
                cwd: s.cwd.clone(),
                process_alive: s
                    .handle
                    .as_ref()
                    .map(|h| h.is_alive())
                    .unwrap_or(false),
            })
            .collect()
    }

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    pub async fn send_command(
        &self,
        session_id: &str,
        command: Value,
    ) -> Result<Value, String> {
        let (resolved_id, response_value) =
            self.send_command_core(session_id, &command, true).await?;

        let response = if response_value["success"].as_bool().unwrap_or(false) {
            CommandResponse::Success(
                response_value.get("data").cloned().unwrap_or(Value::Null),
            )
        } else {
            CommandResponse::Error(
                response_value["error"]
                    .as_str()
                    .unwrap_or("Unknown error")
                    .to_string(),
            )
        };

        if should_emit_agent_state(&command, &response) {
            if let Err(err) = self.emit_agent_state_event(&resolved_id).await {
                tracing::warn!(
                    "Failed to emit agent_state after command {}: {}",
                    command["type"].as_str().unwrap_or("unknown"),
                    err
                );
            }
        }

        Ok(response_value)
    }

    async fn send_command_core(
        &self,
        session_id: &str,
        command: &Value,
        emit_client_event: bool,
    ) -> Result<(String, Value), String> {
        let agent_command = json_to_agent_command(command)?;
        let (resolved_id, response) = self
            .send_typed_command(session_id, agent_command, emit_client_event)
            .await?;

        let response_value = match &response {
            CommandResponse::Success(data) => {
                json!({"success": true, "data": data})
            }
            CommandResponse::Error(err) => {
                json!({"success": false, "error": err})
            }
        };

        Ok((resolved_id, response_value))
    }

    pub async fn send_untracked_command(
        &self,
        session_id: &str,
        command: Value,
    ) -> Result<(), String> {
        let agent_command = json_to_agent_command(&command)?;
        let (resolved_id, handle, last_activity) =
            self.get_or_resume_handle(session_id).await?;

        self.emit_client_command_event(&resolved_id, &command).await;

        handle.send_untracked(agent_command).await?;

        *last_activity.lock().await = Instant::now();
        Ok(())
    }

    pub async fn refresh_session_state(
        &self,
        session_id: &str,
    ) -> Result<AgentSessionInfo, String> {
        let (session_info, _) = self.refresh_session_state_with_data(session_id).await?;
        Ok(session_info)
    }

    pub async fn get_pending_extension_ui_request(
        &self,
        session_id: &str,
    ) -> Option<Value> {
        let resolved_id = self.resolve_session_id(session_id).await;
        let sessions = self.sessions.read().await;
        sessions
            .get(&resolved_id)
            .and_then(|session| session.pending_extension_ui_request.clone())
    }

    pub async fn clear_pending_extension_ui_request(&self, session_id: &str) {
        let resolved_id = self.resolve_session_id(session_id).await;
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(&resolved_id) {
            session.pending_extension_ui_request = None;
        }
    }

    pub async fn emit_agent_state(&self, session_id: &str) -> Result<(), String> {
        self.emit_agent_state_event(session_id).await
    }

    pub async fn emit_active_sessions(&self) {
        emit_active_sessions(
            &self.sessions,
            &self.broadcast_tx,
            &self.event_buffer,
            &self.event_counter,
        )
        .await;
    }

    pub fn broadcast_tx(&self) -> &broadcast::Sender<StreamEvent> {
        &self.broadcast_tx
    }

    pub fn event_counter(&self) -> &Arc<AtomicU64> {
        &self.event_counter
    }

    pub fn event_buffer(&self) -> &Arc<Mutex<std::collections::VecDeque<StreamEvent>>> {
        &self.event_buffer
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StreamEvent> {
        self.broadcast_tx.subscribe()
    }

    pub async fn get_buffered_events(&self, from_id: Option<u64>) -> Vec<StreamEvent> {
        let buffer = self.event_buffer.lock().await;
        match from_id {
            Some(from) => buffer.iter().filter(|e| e.id > from).cloned().collect(),
            None => vec![],
        }
    }

    pub async fn get_buffered_session_events(
        &self,
        session_id: &str,
        from_event_id: Option<u64>,
        from_delta_event_id: Option<u64>,
    ) -> Vec<StreamEvent> {
        let mut buffer = self.event_buffer.lock().await;
        get_buffered_events_for_session(
            buffer.make_contiguous(),
            session_id,
            from_event_id,
            from_delta_event_id,
        )
    }

    pub fn start_idle_cleanup_task(&self) {
        let manager = self.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let mut to_kill: Vec<String> = Vec::new();
                {
                    let sessions_read = manager.sessions.read().await;
                    for (id, session) in sessions_read.iter() {
                        if session.handle.is_some() {
                            let last = *session.last_activity.lock().await;
                            if last.elapsed().as_secs() > IDLE_TIMEOUT_SECS {
                                tracing::info!("Killing idle session: {id}");
                                to_kill.push(id.clone());
                            }
                        }
                    }
                }

                for id in to_kill {
                    if let Err(err) = manager.stop_session_process(&id, false).await {
                        tracing::warn!("Failed to stop idle session {id}: {err}");
                        continue;
                    }
                    manager
                        .emit_raw_event(
                            &id,
                            "session_idle_timeout",
                            &json!({"type": "session_idle_timeout"}),
                        )
                        .await;
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // Internal: command execution
    // -----------------------------------------------------------------------

    async fn send_typed_command(
        &self,
        session_id: &str,
        command: AgentCommand,
        emit_client_event: bool,
    ) -> Result<(String, CommandResponse), String> {
        let (resolved_id, handle, last_activity) =
            self.get_or_resume_handle(session_id).await?;

        if emit_client_event {
            let json_cmd = command.to_json();
            self.emit_client_command_event(&resolved_id, &json_cmd)
                .await;
        }

        let response = handle.send_command(command).await?;

        *last_activity.lock().await = Instant::now();

        Ok((resolved_id, response))
    }

    async fn get_or_resume_handle(
        &self,
        session_id: &str,
    ) -> Result<(String, Arc<dyn AgentProcessHandle>, Arc<Mutex<Instant>>), String> {
        let resolved_id = self.resolve_session_id(session_id).await;

        let resume_lock = {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&resolved_id) {
                if let Some(ref handle) = session.handle {
                    if handle.is_alive() {
                        return Ok((
                            resolved_id,
                            Arc::clone(handle),
                            session.last_activity.clone(),
                        ));
                    }
                }
                session.resume_lock.clone()
            } else {
                return Err(
                    "Session not found. Create or touch a session first.".to_string()
                );
            }
        };

        let _resume_guard = resume_lock.lock().await;

        let (workspace_id, cwd, session_file, resume_lock, extra_args, provider_id) = {
            let sessions = self.sessions.read().await;
            let session = sessions
                .get(&resolved_id)
                .ok_or("Session not found after acquiring resume lock")?;
            if let Some(ref handle) = session.handle {
                if handle.is_alive() {
                    return Ok((
                        resolved_id,
                        Arc::clone(handle),
                        session.last_activity.clone(),
                    ));
                }
            }
            (
                session.workspace_id.clone(),
                session.cwd.clone(),
                session.session_file.clone(),
                session.resume_lock.clone(),
                session.extra_args.clone(),
                session.provider_id.clone(),
            )
        };

        tracing::info!("Auto-resuming dead session: {resolved_id}");
        self.create_session_with_provider(
            &provider_id,
            workspace_id,
            cwd,
            Some(session_file),
            Some(resolved_id.clone()),
            Some(resume_lock),
            extra_args,
        )
        .await?;

        let current_id = self.resolve_session_id(&resolved_id).await;
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(&current_id)
            .ok_or("Session not found after resume")?;
        let handle = session.handle.as_ref().ok_or("Process not running after resume")?;
        Ok((current_id, Arc::clone(handle), session.last_activity.clone()))
    }

    // -----------------------------------------------------------------------
    // Internal: event broadcasting
    // -----------------------------------------------------------------------

    fn spawn_event_reader(
        &self,
        session_id_ref: Arc<StdMutex<String>>,
        workspace_id: String,
        mut event_rx: tokio::sync::mpsc::UnboundedReceiver<AgentStreamEvent>,
    ) {
        let sessions = self.sessions.clone();
        let broadcast_tx = self.broadcast_tx.clone();
        let event_buffer = self.event_buffer.clone();
        let event_counter = self.event_counter.clone();

        tokio::spawn(async move {
            let mut is_streaming = false;

            while let Some(mut event) = event_rx.recv().await {
                let is_exit = matches!(event, AgentStreamEvent::SessionProcessExited);

                let current_session_id = session_id_ref.lock().unwrap().clone();

                let next_streaming = match &event {
                    AgentStreamEvent::AgentStart | AgentStreamEvent::TurnStart => true,
                    AgentStreamEvent::AgentEnd { .. }
                    | AgentStreamEvent::TurnEnd { .. }
                    | AgentStreamEvent::SessionProcessExited => false,
                    _ => is_streaming,
                };

                if matches!(&event, AgentStreamEvent::AgentEnd { .. }) {
                    let buf = event_buffer.lock().await;
                    let stats = compute_turn_stats_from_buffer(&buf, &current_session_id);
                    if let AgentStreamEvent::AgentEnd { ref mut turn_stats, .. } = event {
                        *turn_stats = stats;
                    }
                }

                update_pending_extension_ui(&sessions, &current_session_id, &event).await;

                let (event_type, data) = stream_event_to_json(&event);

                let evt_id = event_counter.fetch_add(1, Ordering::SeqCst);
                let stream_event = StreamEvent {
                    id: evt_id,
                    session_id: current_session_id.clone(),
                    workspace_id: workspace_id.clone(),
                    event_type,
                    data,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };

                {
                    let mut buf = event_buffer.lock().await;
                    if buf.len() >= MAX_BUFFER_SIZE {
                        buf.pop_front();
                    }
                    buf.push_back(stream_event.clone());
                }

                let _ = broadcast_tx.send(stream_event);

                if next_streaming != is_streaming {
                    is_streaming = next_streaming;
                    let state_data = serde_json::json!({
                        "type": "session_state",
                        "isStreaming": is_streaming,
                    });
                    let state_evt_id = event_counter.fetch_add(1, Ordering::SeqCst);
                    let state_event = StreamEvent {
                        id: state_evt_id,
                        session_id: current_session_id.clone(),
                        workspace_id: workspace_id.clone(),
                        event_type: "session_state".to_string(),
                        data: state_data,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    };
                    {
                        let mut buf = event_buffer.lock().await;
                        if buf.len() >= MAX_BUFFER_SIZE {
                            buf.pop_front();
                        }
                        buf.push_back(state_event.clone());
                    }
                    let _ = broadcast_tx.send(state_event);
                }

                if is_exit {
                    let exit_session_id = session_id_ref.lock().unwrap().clone();
                    tracing::info!("Agent process exited for session: {exit_session_id}");
                    {
                        let mut sessions_w = sessions.write().await;
                        if let Some(session) = sessions_w.get_mut(&exit_session_id) {
                            if session
                                .handle
                                .as_ref()
                                .map(|h| !h.is_alive())
                                .unwrap_or(true)
                            {
                                session.handle = None;
                            }
                        }
                    }
                    emit_active_sessions(
                        &sessions,
                        &broadcast_tx,
                        &event_buffer,
                        &event_counter,
                    )
                    .await;
                    break;
                }
            }
        });
    }

    async fn emit_stream_event(
        &self,
        session_id: &str,
        workspace_id: &str,
        event: &AgentStreamEvent,
    ) {
        let (event_type, data) = stream_event_to_json(event);
        self.emit_raw_event_with_workspace(session_id, workspace_id, &event_type, &data)
            .await;
    }

    async fn emit_raw_event(&self, session_id: &str, event_type: &str, data: &Value) {
        let workspace_id = self.workspace_id_for_session(session_id).await;
        self.emit_raw_event_with_workspace(session_id, &workspace_id, event_type, data)
            .await;
    }

    async fn emit_raw_event_with_workspace(
        &self,
        session_id: &str,
        workspace_id: &str,
        event_type: &str,
        data: &Value,
    ) {
        let evt_id = self.event_counter.fetch_add(1, Ordering::SeqCst);
        let stream_event = StreamEvent {
            id: evt_id,
            session_id: session_id.to_string(),
            workspace_id: workspace_id.to_string(),
            event_type: event_type.to_string(),
            data: data.clone(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let mut buf = self.event_buffer.lock().await;
        if buf.len() >= MAX_BUFFER_SIZE {
            buf.pop_front();
        }
        buf.push_back(stream_event.clone());
        drop(buf);
        let _ = self.broadcast_tx.send(stream_event);
    }

    async fn emit_client_command_event(&self, session_id: &str, command: &Value) {
        self.emit_raw_event(session_id, "client_command", command)
            .await;
    }

    async fn emit_agent_state_event(&self, session_id: &str) -> Result<(), String> {
        let (session_info, data) = self.refresh_session_state_with_data(session_id).await?;
        self.emit_raw_event(&session_info.session_id, "agent_state", &data)
            .await;
        Ok(())
    }

    async fn refresh_session_state_with_data(
        &self,
        session_id: &str,
    ) -> Result<(AgentSessionInfo, Value), String> {
        let (_, response_value) = self
            .send_command_core(session_id, &json!({"type": "get_state"}), false)
            .await?;

        if !response_value["success"].as_bool().unwrap_or(false) {
            let error = response_value["error"]
                .as_str()
                .unwrap_or("Unknown error");
            return Err(format!("get_state failed: {error}"));
        }

        let state_data = response_value
            .get("data")
            .cloned()
            .unwrap_or(Value::Null);

        let snapshot = parse_state_from_data(&state_data)?;

        let session_info = {
            let resolved_id = self.resolve_session_id(session_id).await;
            let mut sessions = self.sessions.write().await;
            let mut session = sessions
                .remove(&resolved_id)
                .ok_or("Session not found during state refresh")?;

            session.session_id = snapshot.session_id.clone();
            session.session_file = snapshot.session_file.clone();
            session.model = snapshot.model.clone();
            session.thinking_level = snapshot.thinking_level.clone();

            *session.session_id_ref.lock().unwrap() = snapshot.session_id.clone();

            let info = build_session_info(&session);
            sessions.insert(snapshot.session_id.clone(), session);

            if resolved_id != snapshot.session_id {
                drop(sessions);
                self.repoint_aliases(&resolved_id, &snapshot.session_id)
                    .await;
            }

            info
        };

        Ok((session_info, state_data))
    }

    // -----------------------------------------------------------------------
    // Internal: session process management
    // -----------------------------------------------------------------------

    async fn stop_session_process(
        &self,
        session_id: &str,
        remove_session: bool,
    ) -> Result<(), String> {
        let resolved_id = self.resolve_session_id(session_id).await;
        let handle = {
            let mut sessions = self.sessions.write().await;
            if remove_session {
                let session = sessions
                    .remove(&resolved_id)
                    .ok_or("Session not found")?;
                session.handle
            } else {
                let session = sessions
                    .get_mut(&resolved_id)
                    .ok_or("Session not found")?;
                session.handle.take()
            }
        };

        if remove_session {
            self.clear_aliases(&resolved_id).await;
        }

        if let Some(handle) = handle {
            handle.terminate().await;
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal: extension UI tracking
    // -----------------------------------------------------------------------

    async fn update_pending_extension_ui_from_stream_event(
        &self,
        session_id: &str,
        event: &AgentStreamEvent,
    ) {
        update_pending_extension_ui(&self.sessions, session_id, event).await;
    }

    // -----------------------------------------------------------------------
    // Internal: alias resolution
    // -----------------------------------------------------------------------

    async fn resolve_session_id(&self, session_id: &str) -> String {
        let aliases = self.session_aliases.read().await;
        let mut current = session_id.to_string();
        let mut seen = HashSet::new();
        while seen.insert(current.clone()) {
            match aliases.get(&current) {
                Some(next) => current = next.clone(),
                None => break,
            }
        }
        current
    }

    async fn repoint_aliases(&self, old_key: &str, new_key: &str) {
        let mut aliases = self.session_aliases.write().await;
        for target in aliases.values_mut() {
            if target == old_key {
                *target = new_key.to_string();
            }
        }
        aliases.insert(old_key.to_string(), new_key.to_string());
    }

    async fn clear_aliases(&self, session_id: &str) {
        let mut aliases = self.session_aliases.write().await;
        aliases.remove(session_id);
        aliases.retain(|alias, target| alias != session_id && target != session_id);
    }

    async fn workspace_id_for_session(&self, session_id: &str) -> String {
        let resolved_id = self.resolve_session_id(session_id).await;
        let sessions = self.sessions.read().await;
        sessions
            .get(&resolved_id)
            .map(|session| session.workspace_id.clone())
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Helpers: session info
// ---------------------------------------------------------------------------

fn build_session_info(session: &AgentSession) -> AgentSessionInfo {
    AgentSessionInfo {
        session_id: session.session_id.clone(),
        session_file: session.session_file.clone(),
        workspace_id: session.workspace_id.clone(),
        cwd: session.cwd.clone(),
        model: session.model.clone(),
        thinking_level: session.thinking_level.clone(),
        process_alive: session
            .handle
            .as_ref()
            .map(|h| h.is_alive())
            .unwrap_or(false),
    }
}

fn parse_state_from_data(data: &Value) -> Result<SessionSnapshot, String> {
    let session_id = data["sessionId"]
        .as_str()
        .ok_or("Missing sessionId in get_state")?
        .to_string();
    let session_file = data["sessionFile"]
        .as_str()
        .ok_or("Missing sessionFile in get_state")?
        .to_string();
    let model = data.get("model").cloned();
    let thinking_level = data["thinkingLevel"].as_str().map(|s| s.to_string());
    Ok(SessionSnapshot {
        session_id,
        session_file,
        model,
        thinking_level,
    })
}

// ---------------------------------------------------------------------------
// Helpers: extension UI state tracking
// ---------------------------------------------------------------------------

async fn update_pending_extension_ui(
    sessions: &Arc<RwLock<HashMap<String, AgentSession>>>,
    session_id: &str,
    event: &AgentStreamEvent,
) {
    let mut sessions = sessions.write().await;
    let Some(session) = sessions.get_mut(session_id) else {
        return;
    };

    match event {
        AgentStreamEvent::ExtensionUiRequest { id: _, request } => {
            if is_blocking_extension_ui_request(request) {
                let (_, raw_data) = stream_event_to_json(event);
                session.pending_extension_ui_request = Some(raw_data);
            }
        }
        AgentStreamEvent::TurnStart
        | AgentStreamEvent::MessageStart { .. }
        | AgentStreamEvent::MessageUpdate { .. }
        | AgentStreamEvent::MessageEnd { .. }
        | AgentStreamEvent::ToolExecutionStart { .. }
        | AgentStreamEvent::ToolExecutionUpdate { .. }
        | AgentStreamEvent::ToolExecutionEnd { .. }
        | AgentStreamEvent::TurnEnd { .. }
        | AgentStreamEvent::AgentEnd { .. }
        | AgentStreamEvent::SessionProcessExited => {
            session.pending_extension_ui_request = None;
        }
        _ => {}
    }
}

fn is_blocking_extension_ui_request(request: &ExtensionUiRequestKind) -> bool {
    matches!(
        request,
        ExtensionUiRequestKind::Select { .. }
            | ExtensionUiRequestKind::Confirm { .. }
            | ExtensionUiRequestKind::Input { .. }
            | ExtensionUiRequestKind::Editor { .. }
    )
}

// ---------------------------------------------------------------------------
// Helpers: agent state detection for post-command events
// ---------------------------------------------------------------------------

fn should_emit_agent_state(command: &Value, response: &CommandResponse) -> bool {
    if !response.is_success() {
        return false;
    }

    match command["type"].as_str() {
        Some("set_steering_mode") | Some("set_follow_up_mode") => true,
        Some("prompt") | Some("steer") | Some("follow_up") => command["message"]
            .as_str()
            .map(is_mode_slash_command)
            .unwrap_or(false),
        _ => false,
    }
}

fn is_mode_slash_command(message: &str) -> bool {
    let first = message.split_whitespace().next().unwrap_or_default();
    matches!(first, "/plan" | "/chat")
}

// ---------------------------------------------------------------------------
// JSON <-> typed conversions
// ---------------------------------------------------------------------------

fn json_to_agent_command(json: &Value) -> Result<AgentCommand, String> {
    let cmd_type = json["type"]
        .as_str()
        .ok_or("Command must have a 'type' field")?;

    match cmd_type {
        "prompt" => Ok(AgentCommand::Prompt {
            message: json["message"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            images: json
                .get("images")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
            streaming_behavior: json
                .get("streamingBehavior")
                .and_then(|v| v.as_str())
                .and_then(|s| match s {
                    "steer" => Some(StreamingBehavior::Steer),
                    "followUp" => Some(StreamingBehavior::FollowUp),
                    _ => None,
                }),
        }),
        "steer" => Ok(AgentCommand::Steer {
            message: json["message"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            images: json
                .get("images")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
        }),
        "follow_up" => Ok(AgentCommand::FollowUp {
            message: json["message"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            images: json
                .get("images")
                .and_then(|v| serde_json::from_value(v.clone()).ok()),
        }),
        "abort" => Ok(AgentCommand::Abort),
        "get_state" => Ok(AgentCommand::GetState),
        "get_messages" => Ok(AgentCommand::GetMessages),
        "set_model" => Ok(AgentCommand::SetModel {
            provider: json["provider"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            model_id: json["modelId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        }),
        "cycle_model" => Ok(AgentCommand::CycleModel),
        "get_available_models" => Ok(AgentCommand::GetAvailableModels),
        "set_thinking_level" => Ok(AgentCommand::SetThinkingLevel {
            level: json["level"].as_str().unwrap_or_default().to_string(),
        }),
        "cycle_thinking_level" => Ok(AgentCommand::CycleThinkingLevel),
        "set_steering_mode" => Ok(AgentCommand::SetSteeringMode {
            mode: json["mode"].as_str().unwrap_or_default().to_string(),
        }),
        "set_follow_up_mode" => Ok(AgentCommand::SetFollowUpMode {
            mode: json["mode"].as_str().unwrap_or_default().to_string(),
        }),
        "compact" => Ok(AgentCommand::Compact {
            custom_instructions: json
                .get("customInstructions")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "set_auto_compaction" => Ok(AgentCommand::SetAutoCompaction {
            enabled: json["enabled"].as_bool().unwrap_or(false),
        }),
        "set_auto_retry" => Ok(AgentCommand::SetAutoRetry {
            enabled: json["enabled"].as_bool().unwrap_or(false),
        }),
        "abort_retry" => Ok(AgentCommand::AbortRetry),
        "bash" => Ok(AgentCommand::Bash {
            command: json["command"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        }),
        "abort_bash" => Ok(AgentCommand::AbortBash),
        "new_session" => Ok(AgentCommand::NewSession {
            parent_session: json
                .get("parentSession")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "switch_session" => Ok(AgentCommand::SwitchSession {
            session_path: json["sessionPath"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        }),
        "fork" => Ok(AgentCommand::Fork {
            entry_id: json["entryId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        }),
        "get_fork_messages" => Ok(AgentCommand::GetForkMessages),
        "get_last_assistant_text" => Ok(AgentCommand::GetLastAssistantText),
        "get_session_stats" => Ok(AgentCommand::GetSessionStats),
        "export_html" => Ok(AgentCommand::ExportHtml {
            output_path: json
                .get("outputPath")
                .and_then(|v| v.as_str())
                .map(String::from),
        }),
        "set_session_name" => Ok(AgentCommand::SetSessionName {
            name: json["name"].as_str().unwrap_or_default().to_string(),
        }),
        "get_commands" => Ok(AgentCommand::GetCommands),
        "extension_ui_response" => Ok(AgentCommand::ExtensionUiResponse {
            id: json["id"].as_str().unwrap_or_default().to_string(),
            value: json.get("value").cloned(),
            confirmed: json.get("confirmed").and_then(|v| v.as_bool()),
            cancelled: json.get("cancelled").and_then(|v| v.as_bool()),
        }),
        _ => Err(format!("Unknown command type: {cmd_type}")),
    }
}

async fn emit_active_sessions(
    sessions: &Arc<RwLock<HashMap<String, AgentSession>>>,
    broadcast_tx: &broadcast::Sender<StreamEvent>,
    event_buffer: &Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    event_counter: &Arc<AtomicU64>,
) {
    let active_ids: Vec<String> = {
        let sessions = sessions.read().await;
        sessions
            .values()
            .filter(|s| s.handle.as_ref().map(|h| h.is_alive()).unwrap_or(false))
            .map(|s| s.session_id.clone())
            .collect()
    };

    let data = serde_json::json!({
        "type": "active_sessions",
        "session_ids": active_ids,
    });

    let evt_id = event_counter.fetch_add(1, Ordering::SeqCst);
    let stream_event = StreamEvent {
        id: evt_id,
        session_id: String::new(),
        workspace_id: String::new(),
        event_type: "active_sessions".to_string(),
        data,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    {
        let mut buf = event_buffer.lock().await;
        if buf.len() >= MAX_BUFFER_SIZE {
            buf.pop_front();
        }
        buf.push_back(stream_event.clone());
    }
    let _ = broadcast_tx.send(stream_event);
}

fn stream_event_to_json(event: &AgentStreamEvent) -> (String, Value) {
    event.to_json()
}

fn compute_turn_stats_from_buffer(buffer: &std::collections::VecDeque<StreamEvent>, session_id: &str) -> Option<TurnStats> {
    use std::collections::HashSet;

    let mut files_edited = HashSet::new();
    let mut files_created = HashSet::new();
    let mut lines_added: u32 = 0;
    let mut lines_removed: u32 = 0;

    let mut agent_start_ts: Option<i64> = None;
    let turn_events: Vec<&StreamEvent> = {
        let mut events = Vec::new();
        for evt in buffer.iter().rev() {
            if evt.session_id != session_id {
                continue;
            }
            if evt.event_type == "agent_start" {
                agent_start_ts = Some(evt.timestamp);
                break;
            }
            events.push(evt);
        }
        events.reverse();
        events
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    let duration_ms = agent_start_ts.map(|ts| now_ms - ts).unwrap_or(0);

    let mut tool_call_paths: HashMap<String, String> = HashMap::new();
    let mut tool_call_content: HashMap<String, String> = HashMap::new();
    for evt in &turn_events {
        if evt.event_type == "tool_execution_start" {
            let data = &evt.data;
            let call_id = data.get("toolCallId").and_then(|v| v.as_str()).unwrap_or("");
            if call_id.is_empty() { continue; }
            let path = extract_path_from_args(data);
            if !path.is_empty() {
                tool_call_paths.insert(call_id.to_string(), path);
            }
            if let Some(content) = extract_content_from_args(data) {
                tool_call_content.insert(call_id.to_string(), content);
            }
        }
    }

    for evt in &turn_events {
        if evt.event_type != "tool_execution_end" {
            continue;
        }
        let data = &evt.data;
        let tool_name = data.get("toolName").and_then(|v| v.as_str()).unwrap_or("");
        let is_error = data.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
        if is_error {
            continue;
        }
        let call_id = data.get("toolCallId").and_then(|v| v.as_str()).unwrap_or("");

        match tool_name {
            "edit" => {
                if let Some(path) = tool_call_paths.get(call_id) {
                    files_edited.insert(path.clone());
                }
                if let Some(diff) = data
                    .get("result")
                    .and_then(|r| r.get("details"))
                    .and_then(|d| d.get("diff"))
                    .and_then(|v| v.as_str())
                {
                    for line in diff.lines() {
                        if line.starts_with('+') && !line.starts_with("++") {
                            lines_added += 1;
                        }
                        if line.starts_with('-') && !line.starts_with("--") {
                            lines_removed += 1;
                        }
                    }
                }
            }
            "write" => {
                if let Some(path) = tool_call_paths.get(call_id) {
                    files_created.insert(path.clone());
                }
                if let Some(content) = tool_call_content.get(call_id) {
                    lines_added += content.lines().count() as u32;
                }
            }
            _ => {}
        }
    }

    Some(TurnStats {
        files_edited: files_edited.len() as u32,
        files_created: files_created.len() as u32,
        lines_added,
        lines_removed,
        duration_ms,
    })
}

fn extract_path_from_args(data: &Value) -> String {
    if let Some(args) = data.get("args") {
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            return path.to_string();
        }
    }
    let args_str = data.get("args").and_then(|v| v.as_str()).unwrap_or("");
    if let Ok(parsed) = serde_json::from_str::<Value>(args_str) {
        if let Some(path) = parsed.get("path").and_then(|v| v.as_str()) {
            return path.to_string();
        }
    }
    String::new()
}

fn extract_content_from_args(data: &Value) -> Option<String> {
    if let Some(args) = data.get("args") {
        if let Some(content) = args.get("content").and_then(|v| v.as_str()) {
            return Some(content.to_string());
        }
    }
    let args_str = data.get("args").and_then(|v| v.as_str())?;
    let parsed: Value = serde_json::from_str(args_str).ok()?;
    parsed.get("content").and_then(|v| v.as_str()).map(|s| s.to_string())
}

const SESSION_ONLY_EVENT_TYPES: &[&str] = &[
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "turn_start",
    "auto_compaction_start",
    "auto_compaction_end",
    "auto_retry_start",
    "auto_retry_end",
];

pub fn is_global_event(event_type: &str) -> bool {
    !SESSION_ONLY_EVENT_TYPES.contains(&event_type)
}

pub fn is_session_only_event(event_type: &str) -> bool {
    SESSION_ONLY_EVENT_TYPES.contains(&event_type)
}

fn is_replay_delta_event(event_type: &str) -> bool {
    event_type == "message_update" || event_type == "tool_execution_update"
}

pub fn get_buffered_events_for_session(
    events: &[StreamEvent],
    session_id: &str,
    from_event_id: Option<u64>,
    from_delta_event_id: Option<u64>,
) -> Vec<StreamEvent> {
    let session_events: Vec<&StreamEvent> = events
        .iter()
        .filter(|e| e.session_id == session_id && is_session_only_event(&e.event_type))
        .collect();

    let last_boundary = session_events
        .iter()
        .rposition(|e| {
            e.event_type == "turn_end"
                || e.event_type == "agent_end"
        });

    let relevant = match last_boundary {
        Some(idx) => &session_events[idx + 1..],
        None => session_events.as_slice(),
    };

    relevant
        .iter()
        .filter(|event| {
            let event = **event;
            let after_general = from_event_id.is_none_or(|from| event.id > from);
            let after_delta = is_replay_delta_event(&event.event_type)
                && from_delta_event_id.is_some_and(|from| event.id > from);
            after_general || after_delta
        })
        .cloned()
        .cloned()
        .collect()
}
