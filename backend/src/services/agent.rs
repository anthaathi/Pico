use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::{broadcast, oneshot, watch, Mutex, RwLock};
use tokio::time::Instant;
use utoipa::ToSchema;

const MAX_BUFFER_SIZE: usize = 10_000;
const IDLE_TIMEOUT_SECS: u64 = 30 * 60;
const COMMAND_TIMEOUT_SECS: u64 = 300;
const INIT_TIMEOUT_SECS: u64 = 30;
const SHUTDOWN_GRACE_SECS: u64 = 5;

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

struct PiProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pid: u32,
    instance_id: u64,
    exit_rx: watch::Receiver<bool>,
    session_id_ref: Arc<StdMutex<String>>,
}

struct AgentSession {
    session_id: String,
    session_file: String,
    workspace_id: String,
    cwd: String,
    model: Option<Value>,
    thinking_level: Option<String>,
    pending_extension_ui_request: Option<Value>,
    process: Option<PiProcess>,
    last_activity: Arc<Mutex<Instant>>,
    resume_lock: Arc<Mutex<()>>,
    extra_args: Vec<String>,
}

struct SessionSnapshot {
    session_id: String,
    session_file: String,
    model: Option<Value>,
    thinking_level: Option<String>,
}

#[derive(Clone)]
pub struct AgentManager {
    sessions: Arc<RwLock<HashMap<String, AgentSession>>>,
    session_aliases: Arc<RwLock<HashMap<String, String>>>,
    event_counter: Arc<AtomicU64>,
    process_counter: Arc<AtomicU64>,
    broadcast_tx: broadcast::Sender<StreamEvent>,
    event_buffer: Arc<Mutex<VecDeque<StreamEvent>>>,
    pi_binary: Arc<String>,
}

impl AgentManager {
    pub fn new(pi_binary: String) -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_aliases: Arc::new(RwLock::new(HashMap::new())),
            event_counter: Arc::new(AtomicU64::new(1)),
            process_counter: Arc::new(AtomicU64::new(1)),
            broadcast_tx: tx,
            event_buffer: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_BUFFER_SIZE))),
            pi_binary: Arc::new(pi_binary),
        }
    }

    pub async fn create_session(
        &self,
        workspace_id: String,
        cwd: String,
        session_path: Option<String>,
    ) -> Result<AgentSessionInfo, String> {
        self.spawn_and_register(workspace_id, cwd, session_path, None, None, vec![])
            .await
    }

    pub async fn create_chat_session(
        &self,
        workspace_id: String,
        cwd: String,
        system_prompt: Option<String>,
        no_tools: bool,
    ) -> Result<AgentSessionInfo, String> {
        std::fs::create_dir_all(&cwd)
            .map_err(|e| format!("Failed to create chat dir: {e}"))?;

        let mut extra_args = Vec::new();
        if no_tools {
            extra_args.push("--no-tools".to_string());
        }
        if let Some(prompt) = system_prompt {
            extra_args.push("--append-system-prompt".to_string());
            extra_args.push(prompt);
        }

        self.spawn_and_register(workspace_id, cwd, None, None, None, extra_args)
            .await
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
        let (workspace_id, cwd, session_file) = {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&resolved_id) {
                if session.process.is_some() {
                    *session.last_activity.lock().await = Instant::now();
                    return Ok(Self::build_session_info(session));
                }
                previous_key = Some(resolved_id.clone());
                resume_lock = Some(session.resume_lock.clone());
                extra_args = session.extra_args.clone();
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
                if session.process.is_some() {
                    *session.last_activity.lock().await = Instant::now();
                    return Ok(Self::build_session_info(session));
                }
            }
            previous_key = Some(re_resolved);
        }

        self.spawn_and_register(
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
        let process = {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .remove(&resolved_id)
                .ok_or("Session not found")?;
            session.process
        };
        self.clear_aliases(&resolved_id).await;
        if let Some(process) = process {
            Self::terminate_process(process).await;
        }
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
                process_alive: s.process.is_some(),
            })
            .collect()
    }

    pub async fn send_command(
        &self,
        session_id: &str,
        command: Value,
    ) -> Result<Value, String> {
        let (_, response) = self
            .send_command_internal(session_id, command, true)
            .await?;
        Ok(response)
    }

    pub async fn send_untracked_command(
        &self,
        session_id: &str,
        command: Value,
    ) -> Result<(), String> {
        let (resolved_id, stdin, _pending, last_activity) =
            self.get_or_resume_process(session_id).await?;

        self.emit_event(&resolved_id, "client_command", &command)
            .await;

        let write_result: Result<(), String> = {
            let mut stdin_guard = stdin.lock().await;
            let bytes = command.to_string();
            stdin_guard
                .write_all(bytes.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to pi stdin: {e}"))?;
            stdin_guard
                .write_all(b"\n")
                .await
                .map_err(|e| e.to_string())?;
            stdin_guard.flush().await.map_err(|e| e.to_string())
        };

        if let Err(err) = write_result {
            return Err(err);
        }

        *last_activity.lock().await = Instant::now();
        Ok(())
    }

    pub async fn refresh_session_state(
        &self,
        session_id: &str,
    ) -> Result<AgentSessionInfo, String> {
        let (session_info, _) =
            self.refresh_session_state_with_data(session_id).await?;
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

    pub fn subscribe(&self) -> broadcast::Receiver<StreamEvent> {
        self.broadcast_tx.subscribe()
    }

    pub async fn get_buffered_events(
        &self,
        from_id: Option<u64>,
    ) -> Vec<StreamEvent> {
        let buffer = self.event_buffer.lock().await;
        match from_id {
            Some(from) => buffer.iter().filter(|e| e.id > from).cloned().collect(),
            None => vec![],
        }
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
                        if session.process.is_some() {
                            let last = *session.last_activity.lock().await;
                            if last.elapsed().as_secs() > IDLE_TIMEOUT_SECS {
                                tracing::info!("Killing idle session: {id}");
                                to_kill.push(id.clone());
                            }
                        }
                    }
                }

                for id in to_kill {
                    if let Err(err) =
                        manager.stop_session_process(&id, false).await
                    {
                        tracing::warn!(
                            "Failed to stop idle session {id}: {err}"
                        );
                        continue;
                    }
                    let data = json!({"type": "session_idle_timeout"});
                    manager
                        .emit_event(&id, "session_idle_timeout", &data)
                        .await;
                }
            }
        });
    }

    async fn get_or_resume_process(
        &self,
        session_id: &str,
    ) -> Result<
        (
            String,
            Arc<Mutex<ChildStdin>>,
            Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
            Arc<Mutex<Instant>>,
        ),
        String,
    > {
        let resolved_id = self.resolve_session_id(session_id).await;
        let resume_lock = {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(&resolved_id) {
                if let Some(process) = &session.process {
                    return Ok((
                        resolved_id,
                        process.stdin.clone(),
                        process.pending.clone(),
                        session.last_activity.clone(),
                    ));
                }
                session.resume_lock.clone()
            } else {
                return Err(
                    "Session not found. Create or touch a session first."
                        .to_string(),
                );
            }
        };

        let _resume_guard = resume_lock.lock().await;

        let (workspace_id, cwd, session_file, resume_lock, extra_args) = {
            let sessions = self.sessions.read().await;
            let session = sessions
                .get(&resolved_id)
                .ok_or("Session not found after acquiring resume lock")?;
            if let Some(process) = &session.process {
                return Ok((
                    resolved_id,
                    process.stdin.clone(),
                    process.pending.clone(),
                    session.last_activity.clone(),
                ));
            }
            (
                session.workspace_id.clone(),
                session.cwd.clone(),
                session.session_file.clone(),
                session.resume_lock.clone(),
                session.extra_args.clone(),
            )
        };

        tracing::info!("Auto-resuming dead session: {resolved_id}");
        self.spawn_and_register(
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
        let process = session
            .process
            .as_ref()
            .ok_or("Process not running after resume")?;
        Ok((
            current_id,
            process.stdin.clone(),
            process.pending.clone(),
            session.last_activity.clone(),
        ))
    }

    async fn spawn_and_register(
        &self,
        workspace_id: String,
        cwd: String,
        session_path: Option<String>,
        previous_key: Option<String>,
        resume_lock: Option<Arc<Mutex<()>>>,
        extra_args: Vec<String>,
    ) -> Result<AgentSessionInfo, String> {
        let pi_bin = self.pi_binary.as_str();
        let cwd = if cwd.starts_with("~/") {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
            format!("{}{}", home, &cwd[1..])
        } else {
            cwd
        };

        tracing::debug!(
            "Spawning pi: binary={pi_bin}, cwd={cwd}, PATH={:?}",
            std::env::var("PATH").unwrap_or_default()
        );

        let mut cmd = tokio::process::Command::new(pi_bin);
        cmd.env("PI_OFFLINE", "1");
        cmd.arg("--mode").arg("rpc");

        for arg in &extra_args {
            cmd.arg(arg);
        }

        if let Some(ref path) = session_path {
            cmd.arg("--session").arg(path);
        }

        cmd.current_dir(&cwd);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::null());

        let mut child = cmd.spawn().map_err(|e| {
            format!("Failed to spawn pi (binary={pi_bin}, cwd={cwd}): {e}")
        })?;
        let pid = child.id().expect("child process has PID");
        let stdin = child.stdin.take().ok_or("Pi stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Pi stdout unavailable")?;
        let (exit_tx, exit_rx) = watch::channel(false);
        tokio::spawn(async move {
            let _ = child.wait().await;
            let _ = exit_tx.send(true);
        });
        let mut cleanup_exit_rx = exit_rx.clone();

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let mut reader = BufReader::new(stdout);
        let mut initial_events: Vec<Value> = Vec::new();
        let mut line = String::new();

        let req_id = uuid::Uuid::new_v4().to_string();
        let get_state_cmd = json!({"type": "get_state", "id": req_id});
        {
            let mut stdin_lock = stdin.lock().await;
            if let Err(e) = stdin_lock
                .write_all(get_state_cmd.to_string().as_bytes())
                .await
            {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err(format!("Failed to write get_state: {e}"));
            }
            if let Err(e) = stdin_lock.write_all(b"\n").await {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err(e.to_string());
            }
            if let Err(e) = stdin_lock.flush().await {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err(e.to_string());
            }
        }

        let state_response = match tokio::time::timeout(
            Duration::from_secs(INIT_TIMEOUT_SECS),
            async {
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => {
                            return Err(
                                "Pi process exited before responding"
                                    .to_string(),
                            );
                        }
                        Ok(_) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Value>(trimmed) {
                                Ok(event) => {
                                    if event["type"] == "response"
                                        && event
                                            .get("id")
                                            .and_then(|v| v.as_str())
                                            == Some(&req_id)
                                    {
                                        return Ok(event);
                                    }
                                    initial_events.push(event);
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "Failed to parse pi output: {e}"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            return Err(format!(
                                "Failed to read from pi: {e}"
                            ));
                        }
                    }
                }
            },
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(err)) => {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err(err);
            }
            Err(_) => {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err("Timed out waiting for pi to respond".to_string());
            }
        };

        if !state_response["success"].as_bool().unwrap_or(false) {
            let error = state_response["error"]
                .as_str()
                .unwrap_or("Unknown error");
            Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx).await;
            return Err(format!("get_state failed: {error}"));
        }

        let snapshot = match Self::parse_state_response(&state_response) {
            Ok(snapshot) => snapshot,
            Err(err) => {
                Self::terminate_process_by_pid(pid, &mut cleanup_exit_rx)
                    .await;
                return Err(err);
            }
        };
        let current_session_id =
            Arc::new(StdMutex::new(snapshot.session_id.clone()));
        let instance_id =
            self.process_counter.fetch_add(1, Ordering::SeqCst);

        let reader_sessions = self.sessions.clone();
        let reader_pending = pending.clone();
        let reader_broadcast = self.broadcast_tx.clone();
        let reader_buffer = self.event_buffer.clone();
        let reader_counter = self.event_counter.clone();
        let reader_instance_id = instance_id;
        let reader_session_id = current_session_id.clone();
        let reader_workspace_id = workspace_id.clone();

        let process = PiProcess {
            stdin,
            pending,
            pid,
            instance_id,
            exit_rx,
            session_id_ref: current_session_id,
        };
        let session = AgentSession {
            session_id: snapshot.session_id.clone(),
            session_file: snapshot.session_file.clone(),
            workspace_id: workspace_id.clone(),
            cwd: cwd.clone(),
            model: snapshot.model.clone(),
            thinking_level: snapshot.thinking_level.clone(),
            pending_extension_ui_request: None,
            process: Some(process),
            last_activity: Arc::new(Mutex::new(Instant::now())),
            resume_lock: resume_lock.unwrap_or_else(|| Arc::new(Mutex::new(()))),
            extra_args,
        };
        {
            let mut sessions = self.sessions.write().await;
            if let Some(previous_key) = previous_key.as_ref() {
                sessions.remove(previous_key);
            }
            sessions.insert(snapshot.session_id.clone(), session);
        }

        if let Some(previous_key) = previous_key.as_ref() {
            if previous_key != &snapshot.session_id {
                self.repoint_aliases(previous_key, &snapshot.session_id)
                    .await;
            }
        }

        for event in initial_events {
            Self::update_pending_extension_ui_request(
                &self.sessions,
                &snapshot.session_id,
                &event,
            )
            .await;
            self.emit_pi_event(&snapshot.session_id, event).await;
        }

        tokio::spawn(async move {
            let mut buf_line = line;
            loop {
                buf_line.clear();
                match reader.read_line(&mut buf_line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = buf_line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        let event = match serde_json::from_str::<Value>(trimmed)
                        {
                            Ok(e) => e,
                            Err(_) => continue,
                        };

                        if event["type"] == "response" {
                            if let Some(id) =
                                event.get("id").and_then(|v| v.as_str())
                            {
                                let mut pm = reader_pending.lock().await;
                                if let Some(tx) = pm.remove(id) {
                                    let _ = tx.send(event);
                                    continue;
                                }
                            }
                        }

                        let current_session_id = reader_session_id
                            .lock()
                            .unwrap()
                            .clone();
                        Self::update_pending_extension_ui_request(
                            &reader_sessions,
                            &current_session_id,
                            &event,
                        )
                        .await;

                        let evt_id =
                            reader_counter.fetch_add(1, Ordering::SeqCst);
                        let stream_event = StreamEvent {
                            id: evt_id,
                            session_id: current_session_id,
                            workspace_id: reader_workspace_id.clone(),
                            event_type: event["type"]
                                .as_str()
                                .unwrap_or("unknown")
                                .to_string(),
                            data: event,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                        };

                        let mut buf = reader_buffer.lock().await;
                        if buf.len() >= MAX_BUFFER_SIZE {
                            buf.pop_front();
                        }
                        buf.push_back(stream_event.clone());
                        drop(buf);
                        let _ = reader_broadcast.send(stream_event);
                    }
                }
            }

            let exit_session_id = reader_session_id.lock().unwrap().clone();
            tracing::info!(
                "Pi process exited for session: {}",
                exit_session_id
            );
            let mut sessions = reader_sessions.write().await;
            if let Some(session) = sessions.get_mut(&exit_session_id) {
                let should_clear = session
                    .process
                    .as_ref()
                    .map(|process| process.instance_id == reader_instance_id)
                    .unwrap_or(false);
                if should_clear {
                    session.process = None;
                }
            }
            drop(sessions);

            let evt_id = reader_counter.fetch_add(1, Ordering::SeqCst);
            let exit_event = StreamEvent {
                id: evt_id,
                session_id: exit_session_id,
                workspace_id: reader_workspace_id.clone(),
                event_type: "session_process_exited".to_string(),
                data: json!({"type": "session_process_exited"}),
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            let mut buf = reader_buffer.lock().await;
            if buf.len() >= MAX_BUFFER_SIZE {
                buf.pop_front();
            }
            buf.push_back(exit_event.clone());
            drop(buf);
            let _ = reader_broadcast.send(exit_event);
        });

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

    async fn send_command_internal(
        &self,
        session_id: &str,
        command: Value,
        emit_client_event: bool,
    ) -> Result<(String, Value), String> {
        let (resolved_id, response) = self
            .execute_command(session_id, command.clone(), emit_client_event)
            .await?;

        if Self::should_emit_agent_state(&command, &response) {
            if let Err(err) = self.emit_agent_state_event(&resolved_id).await {
                tracing::warn!(
                    "Failed to emit agent_state after command {}: {}",
                    command["type"].as_str().unwrap_or("unknown"),
                    err
                );
            }
        }

        Ok((resolved_id, response))
    }

    async fn execute_command(
        &self,
        session_id: &str,
        command: Value,
        emit_client_event: bool,
    ) -> Result<(String, Value), String> {
        let (resolved_id, stdin, pending, last_activity) =
            self.get_or_resume_process(session_id).await?;

        let req_id = uuid::Uuid::new_v4().to_string();
        let mut cmd = command.clone();
        cmd.as_object_mut()
            .ok_or("Command must be a JSON object")?
            .insert("id".to_string(), Value::String(req_id.clone()));

        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(req_id.clone(), tx);

        if emit_client_event {
            self.emit_event(&resolved_id, "client_command", &command)
                .await;
        }

        let write_result: Result<(), String> = {
            let mut stdin_guard = stdin.lock().await;
            let bytes = cmd.to_string();
            stdin_guard
                .write_all(bytes.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to pi stdin: {e}"))?;
            stdin_guard
                .write_all(b"\n")
                .await
                .map_err(|e| e.to_string())?;
            stdin_guard.flush().await.map_err(|e| e.to_string())
        };

        if let Err(err) = write_result {
            pending.lock().await.remove(&req_id);
            return Err(err);
        }

        *last_activity.lock().await = Instant::now();

        let response = match tokio::time::timeout(
            Duration::from_secs(COMMAND_TIMEOUT_SECS),
            rx,
        )
            .await
        {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(
                "Response channel closed (process may have crashed)"
                    .to_string(),
            ),
            Err(_) => {
                pending.lock().await.remove(&req_id);
                Err("Command timed out after 5 minutes".to_string())
            }
        }?;

        Ok((resolved_id, response))
    }

    fn build_session_info(session: &AgentSession) -> AgentSessionInfo {
        AgentSessionInfo {
            session_id: session.session_id.clone(),
            session_file: session.session_file.clone(),
            workspace_id: session.workspace_id.clone(),
            cwd: session.cwd.clone(),
            model: session.model.clone(),
            thinking_level: session.thinking_level.clone(),
            process_alive: session.process.is_some(),
        }
    }

    fn parse_state_response(response: &Value) -> Result<SessionSnapshot, String> {
        let data = response
            .get("data")
            .ok_or("Missing data in get_state response")?;
        let session_id = data["sessionId"]
            .as_str()
            .ok_or("Missing sessionId in get_state")?
            .to_string();
        let session_file = data["sessionFile"]
            .as_str()
            .ok_or("Missing sessionFile in get_state")?
            .to_string();
        let model = data.get("model").cloned();
        let thinking_level =
            data["thinkingLevel"].as_str().map(|s| s.to_string());
        Ok(SessionSnapshot {
            session_id,
            session_file,
            model,
            thinking_level,
        })
    }

    fn should_emit_agent_state(command: &Value, response: &Value) -> bool {
        if !response["success"].as_bool().unwrap_or(false) {
            return false;
        }

        match command["type"].as_str() {
            Some("set_steering_mode") | Some("set_follow_up_mode") => true,
            Some("prompt") | Some("steer") | Some("follow_up") => {
                command["message"]
                    .as_str()
                    .map(Self::is_mode_slash_command)
                    .unwrap_or(false)
            }
            _ => false,
        }
    }

    fn is_mode_slash_command(message: &str) -> bool {
        let first = message.split_whitespace().next().unwrap_or_default();
        matches!(first, "/plan" | "/chat")
    }

    async fn emit_agent_state_event(
        &self,
        session_id: &str,
    ) -> Result<(), String> {
        let (session_info, data) =
            self.refresh_session_state_with_data(session_id).await?;
        self.emit_event(&session_info.session_id, "agent_state", &data)
            .await;
        Ok(())
    }

    async fn refresh_session_state_with_data(
        &self,
        session_id: &str,
    ) -> Result<(AgentSessionInfo, Value), String> {
        let (resolved_id, response) = self
            .execute_command(
                session_id,
                json!({"type": "get_state"}),
                false,
            )
            .await?;

        if !response["success"].as_bool().unwrap_or(false) {
            let error = response["error"]
                .as_str()
                .unwrap_or("Unknown error");
            return Err(format!("get_state failed: {error}"));
        }

        let snapshot = Self::parse_state_response(&response)?;
        let state_data = response.get("data").cloned().unwrap_or(Value::Null);
        let session_info = {
            let mut sessions = self.sessions.write().await;
            let mut session = sessions
                .remove(&resolved_id)
                .ok_or("Session not found during state refresh")?;

            session.session_id = snapshot.session_id.clone();
            session.session_file = snapshot.session_file.clone();
            session.model = snapshot.model.clone();
            session.thinking_level = snapshot.thinking_level.clone();

            if let Some(process) = session.process.as_ref() {
                *process.session_id_ref.lock().unwrap() =
                    snapshot.session_id.clone();
            }

            let info = Self::build_session_info(&session);
            sessions.insert(snapshot.session_id.clone(), session);
            info
        };

        if resolved_id != snapshot.session_id {
            self.repoint_aliases(&resolved_id, &snapshot.session_id)
                .await;
        }

        Ok((session_info, state_data))
    }

    async fn stop_session_process(
        &self,
        session_id: &str,
        remove_session: bool,
    ) -> Result<(), String> {
        let resolved_id = self.resolve_session_id(session_id).await;
        let process = {
            let mut sessions = self.sessions.write().await;
            if remove_session {
                let session = sessions
                    .remove(&resolved_id)
                    .ok_or("Session not found")?;
                session.process
            } else {
                let session = sessions
                    .get_mut(&resolved_id)
                    .ok_or("Session not found")?;
                session.process.take()
            }
        };

        if remove_session {
            self.clear_aliases(&resolved_id).await;
        }

        if let Some(process) = process {
            Self::terminate_process(process).await;
        }

        Ok(())
    }

    async fn terminate_process(process: PiProcess) {
        let mut exit_rx = process.exit_rx.clone();
        Self::terminate_process_by_pid(process.pid, &mut exit_rx).await;
    }

    async fn terminate_process_by_pid(
        pid: u32,
        exit_rx: &mut watch::Receiver<bool>,
    ) {
        if Self::wait_for_exit(exit_rx, Duration::from_secs(0)).await {
            return;
        }

        Self::signal_process(pid, libc::SIGTERM);
        if Self::wait_for_exit(
            exit_rx,
            Duration::from_secs(SHUTDOWN_GRACE_SECS),
        )
        .await
        {
            return;
        }

        tracing::warn!("Escalating pi process {pid} to SIGKILL");
        Self::signal_process(pid, libc::SIGKILL);
        let _ = Self::wait_for_exit(
            exit_rx,
            Duration::from_secs(SHUTDOWN_GRACE_SECS),
        )
        .await;
    }

    async fn wait_for_exit(
        exit_rx: &mut watch::Receiver<bool>,
        timeout: Duration,
    ) -> bool {
        if *exit_rx.borrow() {
            return true;
        }
        tokio::time::timeout(timeout, async {
            loop {
                if *exit_rx.borrow() {
                    break;
                }
                if exit_rx.changed().await.is_err() {
                    break;
                }
            }
        })
        .await
        .is_ok()
    }

    fn signal_process(pid: u32, signal: libc::c_int) {
        unsafe {
            libc::kill(pid as libc::pid_t, signal);
        }
    }

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
        aliases.retain(|alias, target| {
            alias != session_id && target != session_id
        });
    }

    async fn emit_pi_event(&self, session_id: &str, event: Value) {
        let event_type =
            event["type"].as_str().unwrap_or("unknown").to_string();
        self.emit_event(session_id, &event_type, &event).await;
    }

    async fn emit_event(
        &self,
        session_id: &str,
        event_type: &str,
        data: &Value,
    ) {
        let workspace_id = self.workspace_id_for_session(session_id).await;
        let evt_id = self.event_counter.fetch_add(1, Ordering::SeqCst);
        let stream_event = StreamEvent {
            id: evt_id,
            session_id: session_id.to_string(),
            workspace_id,
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

    async fn workspace_id_for_session(&self, session_id: &str) -> String {
        let resolved_id = self.resolve_session_id(session_id).await;
        let sessions = self.sessions.read().await;
        sessions
            .get(&resolved_id)
            .map(|session| session.workspace_id.clone())
            .unwrap_or_default()
    }

    async fn update_pending_extension_ui_request(
        sessions: &Arc<RwLock<HashMap<String, AgentSession>>>,
        session_id: &str,
        event: &Value,
    ) {
        let mut sessions = sessions.write().await;
        let Some(session) = sessions.get_mut(session_id) else {
            return;
        };

        if Self::is_blocking_extension_ui_request(event) {
            session.pending_extension_ui_request = Some(event.clone());
            return;
        }

        if Self::should_clear_pending_extension_ui_request(event) {
            session.pending_extension_ui_request = None;
        }
    }

    fn is_blocking_extension_ui_request(event: &Value) -> bool {
        if event["type"] != "extension_ui_request" {
            return false;
        }

        matches!(
            event.get("method").and_then(|value| value.as_str()),
            Some("select" | "confirm" | "input" | "editor")
        )
    }

    fn should_clear_pending_extension_ui_request(event: &Value) -> bool {
        matches!(
            event.get("type").and_then(|value| value.as_str()),
            Some(
                "turn_start"
                    | "message_start"
                    | "message_update"
                    | "message_end"
                    | "tool_execution_start"
                    | "tool_execution_update"
                    | "tool_execution_end"
                    | "turn_end"
                    | "agent_end"
                    | "session_process_exited"
            )
        )
    }
}
