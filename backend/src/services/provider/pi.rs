use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, oneshot, watch, Mutex};

use super::traits::*;

const COMMAND_TIMEOUT_SECS: u64 = 300;
const INIT_TIMEOUT_SECS: u64 = 30;
const SHUTDOWN_GRACE_SECS: u64 = 5;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

pub struct PiAgentProvider {
    pi_binary: String,
    node_binary: String,
}

impl PiAgentProvider {
    pub fn new(pi_binary: String, node_binary: String) -> Self {
        Self { pi_binary, node_binary }
    }
}

#[async_trait]
impl AgentProvider for PiAgentProvider {
    async fn spawn_session(
        &self,
        config: AgentSessionConfig,
    ) -> Result<SpawnedSession, String> {
        let pi_bin = &self.pi_binary;
        let cwd = expand_home(&config.cwd);

        tracing::info!(
            "Spawning pi: binary={pi_bin}, cwd={cwd}, session_path={:?}, extra_args={:?}",
            config.session_path,
            config.extra_args,
        );

        let mut cmd = tokio::process::Command::new(pi_bin);
        if let Some(node_dir) = std::path::Path::new(&self.node_binary).parent() {
            let current_path = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}:{current_path}", node_dir.display()));
        }
        cmd.env("PI_OFFLINE", "1");
        cmd.arg("--mode").arg("rpc");

        for arg in &config.extra_args {
            cmd.arg(arg);
        }

        if let Some(ref path) = config.session_path {
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
        let mut initial_raw_events: Vec<Value> = Vec::new();
        let mut line = String::new();

        let req_id = uuid::Uuid::new_v4().to_string();
        let get_state_cmd = json!({"type": "get_state", "id": req_id});
        {
            let mut stdin_lock = stdin.lock().await;
            write_json(&mut *stdin_lock, &get_state_cmd)
                .await
                .map_err(|e| {
                    let _ = tokio::spawn({
                        let mut rx = cleanup_exit_rx.clone();
                        async move { terminate_process_by_pid(pid, &mut rx).await }
                    });
                    e
                })?;
        }

        let state_response = match tokio::time::timeout(
            Duration::from_secs(INIT_TIMEOUT_SECS),
            read_until_response(&mut reader, &mut line, &req_id, &mut initial_raw_events),
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(err)) => {
                terminate_process_by_pid(pid, &mut cleanup_exit_rx).await;
                return Err(err);
            }
            Err(_) => {
                terminate_process_by_pid(pid, &mut cleanup_exit_rx).await;
                return Err("Timed out waiting for pi to respond".to_string());
            }
        };

        if !state_response["success"].as_bool().unwrap_or(false) {
            let error = state_response["error"]
                .as_str()
                .unwrap_or("Unknown error");
            terminate_process_by_pid(pid, &mut cleanup_exit_rx).await;
            return Err(format!("get_state failed: {error}"));
        }

        let snapshot = match parse_state_response(&state_response) {
            Ok(s) => s,
            Err(err) => {
                terminate_process_by_pid(pid, &mut cleanup_exit_rx).await;
                return Err(err);
            }
        };

        let initial_events: Vec<AgentStreamEvent> = initial_raw_events
            .into_iter()
            .filter_map(|v| parse_pi_event(&v))
            .collect();

        let (event_tx, event_rx) = mpsc::unbounded_channel();

        let reader_pending = pending.clone();
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

                        let raw = match serde_json::from_str::<Value>(trimmed) {
                            Ok(e) => e,
                            Err(_) => continue,
                        };

                        if raw["type"] == "response" {
                            if let Some(id) = raw.get("id").and_then(|v| v.as_str()) {
                                let mut pm = reader_pending.lock().await;
                                if let Some(tx) = pm.remove(id) {
                                    let _ = tx.send(raw);
                                    continue;
                                }
                            }
                        }

                        if let Some(event) = parse_pi_event(&raw) {
                            let _ = event_tx.send(event);
                        }
                    }
                }
            }

            {
                let mut pm = reader_pending.lock().await;
                for (_, tx) in pm.drain() {
                    let _ = tx.send(json!({
                        "type": "response",
                        "success": false,
                        "error": "Process exited"
                    }));
                }
            }

            let _ = event_tx.send(AgentStreamEvent::SessionProcessExited);
        });

        let handle = PiProcessHandle {
            stdin,
            pending,
            pid,
            exit_rx,
        };

        Ok(SpawnedSession {
            snapshot,
            handle: Arc::new(handle),
            event_rx,
            initial_events,
        })
    }

    fn provider_id(&self) -> &str {
        "pi"
    }

    fn capabilities(&self) -> HashSet<AgentCapability> {
        HashSet::from([
            AgentCapability::Prompt,
            AgentCapability::Steer,
            AgentCapability::FollowUp,
            AgentCapability::Abort,
            AgentCapability::GetState,
            AgentCapability::GetMessages,
            AgentCapability::SetModel,
            AgentCapability::CycleModel,
            AgentCapability::GetAvailableModels,
            AgentCapability::SetThinkingLevel,
            AgentCapability::CycleThinkingLevel,
            AgentCapability::SetSteeringMode,
            AgentCapability::SetFollowUpMode,
            AgentCapability::Compact,
            AgentCapability::SetAutoCompaction,
            AgentCapability::SetAutoRetry,
            AgentCapability::AbortRetry,
            AgentCapability::Bash,
            AgentCapability::AbortBash,
            AgentCapability::NewSession,
            AgentCapability::SwitchSession,
            AgentCapability::Fork,
            AgentCapability::GetForkMessages,
            AgentCapability::GetLastAssistantText,
            AgentCapability::GetSessionStats,
            AgentCapability::ExportHtml,
            AgentCapability::SetSessionName,
            AgentCapability::GetCommands,
            AgentCapability::ExtensionUiResponse,
        ])
    }
}

// ---------------------------------------------------------------------------
// Process handle
// ---------------------------------------------------------------------------

struct PiProcessHandle {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pid: u32,
    exit_rx: watch::Receiver<bool>,
}

#[async_trait]
impl AgentProcessHandle for PiProcessHandle {
    async fn send_command(&self, command: AgentCommand) -> Result<CommandResponse, String> {
        let json_cmd = command.to_json();

        let req_id = uuid::Uuid::new_v4().to_string();
        let mut cmd = json_cmd;
        cmd.as_object_mut()
            .ok_or("Command must be a JSON object")?
            .insert("id".to_string(), Value::String(req_id.clone()));

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(req_id.clone(), tx);

        if let Err(err) = write_json_locked(&self.stdin, &cmd).await {
            self.pending.lock().await.remove(&req_id);
            return Err(err);
        }

        match tokio::time::timeout(Duration::from_secs(COMMAND_TIMEOUT_SECS), rx).await {
            Ok(Ok(response)) => Ok(parse_command_response(response)),
            Ok(Err(_)) => {
                Err("Response channel closed (process may have crashed)".to_string())
            }
            Err(_) => {
                self.pending.lock().await.remove(&req_id);
                Err("Command timed out after 5 minutes".to_string())
            }
        }
    }

    async fn send_untracked(&self, command: AgentCommand) -> Result<(), String> {
        let json_cmd = command.to_json();
        write_json_locked(&self.stdin, &json_cmd).await
    }

    fn is_alive(&self) -> bool {
        !*self.exit_rx.borrow()
    }

    async fn terminate(&self) {
        let mut exit_rx = self.exit_rx.clone();
        terminate_process_by_pid(self.pid, &mut exit_rx).await;
    }
}

// ---------------------------------------------------------------------------
// Event parsing: pi RPC JSON -> AgentStreamEvent (via serde, with Unknown fallback)
// ---------------------------------------------------------------------------

fn parse_pi_event(raw: &Value) -> Option<AgentStreamEvent> {
    let event_type = raw.get("type")?.as_str()?;

    match serde_json::from_value::<AgentStreamEvent>(raw.clone()) {
        Ok(event) => Some(event),
        Err(e) => {
            tracing::debug!("Unknown or malformed event type={event_type}: {e}");
            Some(AgentStreamEvent::Unknown {
                event_type: event_type.to_string(),
                data: raw.clone(),
            })
        }
    }
}

fn parse_command_response(raw: Value) -> CommandResponse {
    if raw["success"].as_bool().unwrap_or(false) {
        let data = raw.get("data").cloned().unwrap_or(Value::Null);
        CommandResponse::Success(data)
    } else {
        let error = raw["error"]
            .as_str()
            .unwrap_or("Unknown error")
            .to_string();
        CommandResponse::Error(error)
    }
}

// ---------------------------------------------------------------------------
// Helpers: state parsing
// ---------------------------------------------------------------------------

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
    let thinking_level = data["thinkingLevel"].as_str().map(|s| s.to_string());
    Ok(SessionSnapshot {
        session_id,
        session_file,
        model,
        thinking_level,
    })
}

fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        format!("{}{}", home, &path[1..])
    } else {
        path.to_string()
    }
}

// ---------------------------------------------------------------------------
// Helpers: IO
// ---------------------------------------------------------------------------

async fn write_json(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let bytes = value.to_string();
    stdin
        .write_all(bytes.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to pi stdin: {e}"))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

async fn write_json_locked(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let mut guard = stdin.lock().await;
    write_json(&mut *guard, value).await
}

async fn read_until_response(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    line: &mut String,
    req_id: &str,
    initial_events: &mut Vec<Value>,
) -> Result<Value, String> {
    loop {
        line.clear();
        match reader.read_line(line).await {
            Ok(0) => {
                return Err("Pi process exited before responding".to_string());
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(event) => {
                        if event["type"] == "response"
                            && event.get("id").and_then(|v| v.as_str()) == Some(req_id)
                        {
                            return Ok(event);
                        }
                        initial_events.push(event);
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse pi output: {e}");
                    }
                }
            }
            Err(e) => {
                return Err(format!("Failed to read from pi: {e}"));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

async fn terminate_process_by_pid(pid: u32, exit_rx: &mut watch::Receiver<bool>) {
    if wait_for_exit(exit_rx, Duration::from_secs(0)).await {
        return;
    }

    signal_process(pid, SIGTERM);
    if wait_for_exit(exit_rx, Duration::from_secs(SHUTDOWN_GRACE_SECS)).await {
        return;
    }

    tracing::warn!("Escalating pi process {pid} to SIGKILL");
    signal_process(pid, SIGKILL);
    let _ = wait_for_exit(exit_rx, Duration::from_secs(SHUTDOWN_GRACE_SECS)).await;
}

async fn wait_for_exit(exit_rx: &mut watch::Receiver<bool>, timeout: Duration) -> bool {
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

#[cfg(unix)]
const SIGTERM: i32 = libc::SIGTERM;
#[cfg(unix)]
const SIGKILL: i32 = libc::SIGKILL;
#[cfg(windows)]
const SIGTERM: i32 = 15;
#[cfg(windows)]
const SIGKILL: i32 = 9;

#[cfg(unix)]
fn signal_process(pid: u32, signal: i32) {
    unsafe {
        libc::kill(pid as libc::pid_t, signal);
    }
}

#[cfg(windows)]
fn signal_process(pid: u32, _signal: i32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output();
}
