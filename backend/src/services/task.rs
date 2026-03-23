use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, Mutex, RwLock};



use crate::models::*;
use crate::services::agent::StreamEvent;

const MAX_LOG_LINES: usize = 5000;

struct TaskInstance {
    id: String,
    label: String,
    command: String,
    workspace_id: String,
    #[allow(dead_code)]
    workspace_path: String,
    task_cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    source: String,
    status: TaskStatus,
    exit_code: Option<i32>,
    started_at: String,
    stopped_at: Option<String>,
    log_lines: Vec<String>,
    child_handle: Option<tokio::task::JoinHandle<()>>,
    kill_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Clone)]
pub struct TaskManager {
    tasks: Arc<RwLock<HashMap<String, TaskInstance>>>,
    broadcast_tx: broadcast::Sender<StreamEvent>,
    event_counter: Arc<std::sync::atomic::AtomicU64>,
    event_buffer: Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
}

impl TaskManager {
    pub fn new(
        broadcast_tx: broadcast::Sender<StreamEvent>,
        event_counter: Arc<std::sync::atomic::AtomicU64>,
        event_buffer: Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    ) -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            broadcast_tx,
            event_counter,
            event_buffer,
        }
    }

    /// Read .pi/tasks.json from a workspace path, then merge with auto-detected tasks
    pub fn read_tasks_config(workspace_path: &str) -> Result<TasksConfig, String> {
        let mut all_tasks: Vec<TaskDefinition> = Vec::new();

        // 1. Read .pi/tasks.json (explicit user tasks)
        let config_path = std::path::Path::new(workspace_path).join(".pi/tasks.json");
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read tasks config: {e}"))?;

            // Strip comments (// line comments) for JSON-with-comments support
            let stripped: String = content
                .lines()
                .map(|line| {
                    let trimmed = line.trim_start();
                    if trimmed.starts_with("//") {
                        ""
                    } else {
                        line
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");

            let config: TasksConfig = serde_json::from_str(&stripped)
                .map_err(|e| format!("Failed to parse tasks config: {e}"))?;

            for mut task in config.tasks {
                if task.source.is_empty() || task.source == "pi" {
                    task.source = "pi".to_string();
                }
                all_tasks.push(task);
            }
        }

        // 2. Auto-detect tasks from common project files
        let base = std::path::Path::new(workspace_path);
        let explicit_labels: std::collections::HashSet<String> =
            all_tasks.iter().map(|t| t.label.clone()).collect();

        // --- package.json (npm scripts) ---
        detect_npm_tasks(base, &explicit_labels, &mut all_tasks);

        // --- Makefile ---
        detect_make_tasks(base, &explicit_labels, &mut all_tasks);

        // --- Cargo.toml ---
        detect_cargo_tasks(base, &explicit_labels, &mut all_tasks);

        // --- docker-compose.yml / docker-compose.yaml ---
        detect_docker_compose_tasks(base, &explicit_labels, &mut all_tasks);

        // --- pyproject.toml (Python with scripts) ---
        detect_python_tasks(base, &explicit_labels, &mut all_tasks);

        // --- Rakefile (Ruby) ---
        detect_rake_tasks(base, &explicit_labels, &mut all_tasks);

        // --- Gradle ---
        detect_gradle_tasks(base, &explicit_labels, &mut all_tasks);

        // --- Deno (deno.json / deno.jsonc) ---
        detect_deno_tasks(base, &explicit_labels, &mut all_tasks);

        Ok(TasksConfig {
            version: "1.0".to_string(),
            tasks: all_tasks,
        })
    }

    /// List all task instances for a workspace
    pub async fn list_tasks(&self, workspace_id: &str) -> Vec<TaskInfo> {
        let tasks = self.tasks.read().await;
        tasks
            .values()
            .filter(|t| t.workspace_id == workspace_id)
            .map(task_instance_to_info)
            .collect()
    }

    /// List ALL task instances across all workspaces
    pub async fn list_all_tasks(&self) -> Vec<TaskInfo> {
        let tasks = self.tasks.read().await;
        tasks.values().map(task_instance_to_info).collect()
    }

    /// Get logs for a task
    pub async fn get_logs(&self, task_id: &str) -> Result<TaskLogs, String> {
        let tasks = self.tasks.read().await;
        let task = tasks.get(task_id).ok_or("Task not found")?;
        Ok(TaskLogs {
            id: task.id.clone(),
            label: task.label.clone(),
            lines: task.log_lines.clone(),
            total_lines: task.log_lines.len() as u32,
        })
    }

    /// Start a task
    pub async fn start_task(
        &self,
        label: &str,
        workspace_id: &str,
        workspace_path: &str,
        definition: &TaskDefinition,
    ) -> Result<TaskInfo, String> {
        // Check if already running with same label in same workspace
        {
            let tasks = self.tasks.read().await;
            for t in tasks.values() {
                if t.label == label
                    && t.workspace_id == workspace_id
                    && t.status == TaskStatus::Running
                {
                    return Err(format!("Task '{}' is already running", label));
                }
            }
        }

        let task_id = uuid::Uuid::new_v4().to_string();
        let cwd = definition
            .cwd
            .as_ref()
            .map(|c| {
                if std::path::Path::new(c).is_absolute() {
                    c.clone()
                } else {
                    std::path::Path::new(workspace_path)
                        .join(c)
                        .to_string_lossy()
                        .to_string()
                }
            })
            .unwrap_or_else(|| workspace_path.to_string());

        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(&definition.command);
        cmd.current_dir(&cwd);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Set up process group for clean killing on Unix
        #[cfg(unix)]
        {
            let std_cmd = cmd.as_std_mut();
            use std::os::unix::process::CommandExt;
            unsafe {
                std_cmd.pre_exec(|| {
                    libc::setsid();
                    Ok(())
                });
            }
        }

        if let Some(env_vars) = &definition.env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to start task: {e}"))?;

        let started_at = Utc::now().to_rfc3339();

        let source = definition.source.clone();

        let task = TaskInstance {
            id: task_id.clone(),
            label: label.to_string(),
            command: definition.command.clone(),
            workspace_id: workspace_id.to_string(),
            workspace_path: workspace_path.to_string(),
            task_cwd: definition.cwd.clone(),
            env: definition.env.clone(),
            source: source.clone(),
            status: TaskStatus::Running,
            exit_code: None,
            started_at: started_at.clone(),
            stopped_at: None,
            log_lines: vec![],
            child_handle: None,
            kill_tx: Some(kill_tx),
        };

        let info = TaskInfo {
            id: task_id.clone(),
            label: label.to_string(),
            command: definition.command.clone(),
            workspace_id: workspace_id.to_string(),
            status: TaskStatus::Running,
            exit_code: None,
            started_at,
            stopped_at: None,
            source,
        };

        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(task_id.clone(), task);
        }

        // Spawn background reader
        self.spawn_output_reader(task_id.clone(), workspace_id.to_string(), child, kill_rx);

        // Emit task_started event
        self.emit_task_event(
            &task_id,
            workspace_id,
            "task_started",
            &json!({
                "task_id": &info.id,
                "label": &info.label,
                "command": &info.command,
                "source": &info.source,
            }),
        )
        .await;

        Ok(info)
    }

    /// Stop a running task
    pub async fn stop_task(&self, task_id: &str) -> Result<TaskInfo, String> {
        let kill_tx = {
            let mut tasks = self.tasks.write().await;
            let task = tasks.get_mut(task_id).ok_or("Task not found")?;
            if task.status != TaskStatus::Running {
                return Err("Task is not running".to_string());
            }
            task.kill_tx.take()
        };

        if let Some(tx) = kill_tx {
            let _ = tx.send(());
        }

        // Give it a moment to process
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let tasks = self.tasks.read().await;
        let task = tasks.get(task_id).ok_or("Task not found")?;
        Ok(task_instance_to_info(task))
    }

    /// Restart a task (stop if running, then start again)
    pub async fn restart_task(
        &self,
        task_id: &str,
        workspace_path: &str,
    ) -> Result<TaskInfo, String> {
        let (label, workspace_id, command, task_cwd, env, source) = {
            let tasks = self.tasks.read().await;
            let task = tasks.get(task_id).ok_or("Task not found")?;
            (
                task.label.clone(),
                task.workspace_id.clone(),
                task.command.clone(),
                task.task_cwd.clone(),
                task.env.clone(),
                task.source.clone(),
            )
        };

        // Stop if running
        {
            let tasks = self.tasks.read().await;
            if let Some(task) = tasks.get(task_id) {
                if task.status == TaskStatus::Running {
                    drop(tasks);
                    let _ = self.stop_task(task_id).await;
                    // Wait a bit for process to die
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                }
            }
        }

        // Remove old task instance
        {
            let mut tasks = self.tasks.write().await;
            tasks.remove(task_id);
        }

        let definition = TaskDefinition {
            label: label.clone(),
            task_type: "shell".to_string(),
            command,
            group: None,
            is_background: Some(true),
            auto_run: None,
            cwd: task_cwd,
            env,
            source,
        };

        self.start_task(&label, &workspace_id, workspace_path, &definition)
            .await
    }

    /// Remove a stopped task from the list
    pub async fn remove_task(&self, task_id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.write().await;
        let task = tasks.get(task_id).ok_or("Task not found")?;
        if task.status == TaskStatus::Running {
            return Err("Cannot remove a running task. Stop it first.".to_string());
        }
        tasks.remove(task_id);
        Ok(())
    }

    fn spawn_output_reader(
        &self,
        task_id: String,
        workspace_id: String,
        mut child: tokio::process::Child,
        kill_rx: tokio::sync::oneshot::Receiver<()>,
    ) {
        let tasks = self.tasks.clone();
        let broadcast_tx = self.broadcast_tx.clone();
        let event_counter = self.event_counter.clone();
        let event_buffer = self.event_buffer.clone();

        let task_id_for_handle = task_id.clone();
        let handle = tokio::spawn(async move {
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            let task_id_stdout = task_id.clone();
            let task_id_stderr = task_id.clone();
            let tasks_stdout = tasks.clone();
            let tasks_stderr = tasks.clone();
            let broadcast_stdout = broadcast_tx.clone();
            let broadcast_stderr = broadcast_tx.clone();
            let counter_stdout = event_counter.clone();
            let counter_stderr = event_counter.clone();
            let buffer_stdout = event_buffer.clone();
            let buffer_stderr = event_buffer.clone();
            let ws_stdout = workspace_id.clone();
            let ws_stderr = workspace_id.clone();

            // Stdout reader
            let stdout_handle = if let Some(stdout) = stdout {
                Some(tokio::spawn(async move {
                    let reader = BufReader::new(stdout);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        append_log_line(&tasks_stdout, &task_id_stdout, &line).await;
                        emit_task_output(
                            &broadcast_stdout,
                            &counter_stdout,
                            &buffer_stdout,
                            &task_id_stdout,
                            &ws_stdout,
                            "stdout",
                            &line,
                        )
                        .await;
                    }
                }))
            } else {
                None
            };

            // Stderr reader
            let stderr_handle = if let Some(stderr) = stderr {
                Some(tokio::spawn(async move {
                    let reader = BufReader::new(stderr);
                    let mut lines = reader.lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        append_log_line(&tasks_stderr, &task_id_stderr, &line).await;
                        emit_task_output(
                            &broadcast_stderr,
                            &counter_stderr,
                            &buffer_stderr,
                            &task_id_stderr,
                            &ws_stderr,
                            "stderr",
                            &line,
                        )
                        .await;
                    }
                }))
            } else {
                None
            };

            // Wait for either kill signal or process exit
            tokio::select! {
                _ = kill_rx => {
                    // Kill the process group
                    #[cfg(unix)]
                    if let Some(pid) = child.id() {
                        unsafe {
                            libc::kill(-(pid as i32), libc::SIGTERM);
                        }
                        // Give it 2 seconds to terminate gracefully
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        let _ = child.kill().await;
                    }
                    #[cfg(not(unix))]
                    {
                        let _ = child.kill().await;
                    }
                    let _ = child.wait().await;

                    let mut tasks_w = tasks.write().await;
                    if let Some(task) = tasks_w.get_mut(&task_id) {
                        task.status = TaskStatus::Stopped;
                        task.exit_code = None;
                        task.stopped_at = Some(Utc::now().to_rfc3339());
                    }
                }
                status = child.wait() => {
                    let exit_code = status.ok().and_then(|s| s.code());
                    let mut tasks_w = tasks.write().await;
                    if let Some(task) = tasks_w.get_mut(&task_id) {
                        task.status = if exit_code == Some(0) {
                            TaskStatus::Stopped
                        } else {
                            TaskStatus::Failed
                        };
                        task.exit_code = exit_code;
                        task.stopped_at = Some(Utc::now().to_rfc3339());
                    }
                }
            }

            // Wait for output readers to finish
            if let Some(h) = stdout_handle {
                let _ = h.await;
            }
            if let Some(h) = stderr_handle {
                let _ = h.await;
            }

            // Emit task_stopped event
            let (status, exit_code) = {
                let tasks_r = tasks.read().await;
                if let Some(task) = tasks_r.get(&task_id) {
                    (task.status.clone(), task.exit_code)
                } else {
                    (TaskStatus::Stopped, None)
                }
            };

            let evt_id = event_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let data = json!({
                "type": "task_stopped",
                "task_id": task_id,
                "status": status,
                "exit_code": exit_code,
            });
            let stream_event = StreamEvent {
                id: evt_id,
                session_id: String::new(),
                workspace_id: workspace_id.clone(),
                event_type: "task_stopped".to_string(),
                data,
                timestamp: Utc::now().timestamp_millis(),
            };
            {
                let mut buf = event_buffer.lock().await;
                if buf.len() >= 10_000 {
                    buf.pop_front();
                }
                buf.push_back(stream_event.clone());
            }
            let _ = broadcast_tx.send(stream_event);
        });

        // Store the handle
        let tasks2 = self.tasks.clone();
        tokio::spawn(async move {
            let mut tasks_w = tasks2.write().await;
            if let Some(task) = tasks_w.get_mut(&task_id_for_handle) {
                task.child_handle = Some(handle);
            }
        });
    }

    async fn emit_task_event(
        &self,
        _task_id: &str,
        workspace_id: &str,
        event_type: &str,
        data: &serde_json::Value,
    ) {
        let evt_id = self
            .event_counter
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let stream_event = StreamEvent {
            id: evt_id,
            session_id: String::new(),
            workspace_id: workspace_id.to_string(),
            event_type: event_type.to_string(),
            data: data.clone(),
            timestamp: Utc::now().timestamp_millis(),
        };
        {
            let mut buf = self.event_buffer.lock().await;
            if buf.len() >= 10_000 {
                buf.pop_front();
            }
            buf.push_back(stream_event.clone());
        }
        let _ = self.broadcast_tx.send(stream_event);
    }
}

fn task_instance_to_info(t: &TaskInstance) -> TaskInfo {
    TaskInfo {
        id: t.id.clone(),
        label: t.label.clone(),
        command: t.command.clone(),
        workspace_id: t.workspace_id.clone(),
        status: t.status.clone(),
        exit_code: t.exit_code,
        started_at: t.started_at.clone(),
        stopped_at: t.stopped_at.clone(),
        source: t.source.clone(),
    }
}

// ---------------------------------------------------------------------------
// Auto-detection helpers
// ---------------------------------------------------------------------------

fn make_def(label: &str, command: &str, source: &str, group: Option<&str>) -> TaskDefinition {
    TaskDefinition {
        label: label.to_string(),
        task_type: "shell".to_string(),
        command: command.to_string(),
        group: group.map(|g| g.to_string()),
        is_background: None,
        auto_run: None,
        cwd: None,
        env: None,
        source: source.to_string(),
    }
}

/// Detect npm/yarn/pnpm scripts from package.json
fn detect_npm_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let pkg_path = base.join("package.json");
    if !pkg_path.exists() {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&pkg_path) else { return };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else { return };
    let Some(scripts) = parsed.get("scripts").and_then(|v| v.as_object()) else { return };

    // Detect which package manager to use
    let runner = if base.join("pnpm-lock.yaml").exists() || base.join("pnpm-workspace.yaml").exists() {
        "pnpm run"
    } else if base.join("yarn.lock").exists() || base.join(".yarnrc.yml").exists() {
        "yarn run"
    } else if base.join("bun.lockb").exists() || base.join("bun.lock").exists() {
        "bun run"
    } else {
        "npm run"
    };

    let source = if runner.starts_with("pnpm") {
        "pnpm"
    } else if runner.starts_with("yarn") {
        "yarn"
    } else if runner.starts_with("bun") {
        "bun"
    } else {
        "npm"
    };

    for (name, value) in scripts {
        let label = format!("{source}: {name}");
        if skip.contains(&label) {
            continue;
        }
        let cmd_preview = value.as_str().unwrap_or("").to_string();
        let group = classify_npm_script(name);
        let mut def = make_def(&label, &format!("{runner} {name}"), source, group);
        // Show the actual script content as the command for display,
        // but run it through the package manager
        def.command = format!("{runner} {name}");
        let _ = cmd_preview; // actual script body is informational
        out.push(def);
    }
}

fn classify_npm_script(name: &str) -> Option<&'static str> {
    match name {
        "build" | "compile" | "bundle" => Some("build"),
        "test" | "test:unit" | "test:e2e" | "test:integration" => Some("test"),
        "dev" | "start" | "serve" | "watch" => Some("dev"),
        "lint" | "format" | "check" | "typecheck" => Some("lint"),
        "clean" | "prebuild" | "postbuild" => Some("build"),
        _ => None,
    }
}

/// Detect targets from Makefile / GNUmakefile / makefile
fn detect_make_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let names = ["Makefile", "GNUmakefile", "makefile"];
    let makefile = names.iter().map(|n| base.join(n)).find(|p| p.exists());
    let Some(mf) = makefile else { return };
    let Ok(content) = std::fs::read_to_string(mf) else { return };

    for line in content.lines() {
        // Match lines like "target: deps" or "target:" but skip .PHONY, variables, comments, etc.
        if line.starts_with('\t') || line.starts_with('#') || line.starts_with('.') || line.starts_with(' ') {
            continue;
        }
        if let Some(colon_pos) = line.find(':') {
            let target = line[..colon_pos].trim();
            // Skip if it contains =, %, or looks like a variable
            if target.is_empty()
                || target.contains('=')
                || target.contains('%')
                || target.contains('$')
                || target.contains(' ')
            {
                continue;
            }
            let label = format!("make: {target}");
            if skip.contains(&label) {
                continue;
            }
            out.push(make_def(&label, &format!("make {target}"), "make", None));
        }
    }
}

/// Detect standard cargo commands from Cargo.toml
fn detect_cargo_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    if !base.join("Cargo.toml").exists() {
        return;
    }
    let commands = [
        ("cargo: build", "cargo build", Some("build")),
        ("cargo: build --release", "cargo build --release", Some("build")),
        ("cargo: test", "cargo test", Some("test")),
        ("cargo: run", "cargo run", Some("dev")),
        ("cargo: check", "cargo check", Some("lint")),
        ("cargo: clippy", "cargo clippy", Some("lint")),
    ];
    for (label, cmd, group) in commands {
        if skip.contains(label) {
            continue;
        }
        out.push(make_def(label, cmd, "cargo", group));
    }
}

/// Detect docker-compose services
fn detect_docker_compose_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let names = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ];
    let compose_file = names.iter().map(|n| base.join(n)).find(|p| p.exists());
    if compose_file.is_none() {
        return;
    }
    let tasks = [
        ("docker compose: up", "docker compose up", Some("dev")),
        ("docker compose: up -d", "docker compose up -d", Some("dev")),
        ("docker compose: down", "docker compose down", None),
        ("docker compose: build", "docker compose build", Some("build")),
        ("docker compose: logs -f", "docker compose logs -f", None),
    ];
    for (label, cmd, group) in tasks {
        if skip.contains(label) {
            continue;
        }
        let mut def = make_def(label, cmd, "docker", group);
        if label.contains("up") || label.contains("logs") {
            def.is_background = Some(true);
        }
        out.push(def);
    }
}

/// Detect Python scripts from pyproject.toml
fn detect_python_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let pyproject = base.join("pyproject.toml");
    if !pyproject.exists() {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&pyproject) else { return };
    let Ok(parsed) = content.parse::<toml::Value>() else { return };

    // Detect scripts from [project.scripts] or [tool.poetry.scripts]
    let script_tables: Vec<&toml::value::Table> = [
        parsed.get("project").and_then(|v| v.get("scripts")).and_then(|v| v.as_table()),
        parsed.get("tool").and_then(|v| v.get("poetry")).and_then(|v| v.get("scripts")).and_then(|v| v.as_table()),
    ]
    .into_iter()
    .flatten()
    .collect();

    for table in &script_tables {
        for name in table.keys() {
            let label = format!("python: {name}");
            if skip.contains(&label) {
                continue;
            }
            out.push(make_def(&label, name, "python", None));
        }
    }

    // If there's a pyproject.toml, add common Python tasks
    let has_pytest = content.contains("pytest") || base.join("pytest.ini").exists();
    let has_ruff = content.contains("ruff");

    if has_pytest {
        let label = "pytest: test";
        if !skip.contains(label) {
            out.push(make_def(label, "pytest", "python", Some("test")));
        }
    }
    if has_ruff {
        let label = "ruff: check";
        if !skip.contains(label) {
            out.push(make_def(label, "ruff check .", "python", Some("lint")));
        }
    }
}

/// Detect Rake tasks from Rakefile
fn detect_rake_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let names = ["Rakefile", "rakefile", "Rakefile.rb"];
    let has_rake = names.iter().any(|n| base.join(n).exists());
    if !has_rake {
        return;
    }
    let defaults = [
        ("rake: default", "rake", None),
        ("rake: test", "rake test", Some("test")),
        ("rake: build", "rake build", Some("build")),
    ];
    for (label, cmd, group) in defaults {
        if skip.contains(label) {
            continue;
        }
        out.push(make_def(label, cmd, "rake", group));
    }
}

/// Detect Gradle tasks from build.gradle or build.gradle.kts
fn detect_gradle_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let has_gradle = base.join("build.gradle").exists() || base.join("build.gradle.kts").exists();
    if !has_gradle {
        return;
    }
    let wrapper = if base.join("gradlew").exists() { "./gradlew" } else { "gradle" };
    let tasks = [
        ("gradle: build", format!("{wrapper} build"), Some("build")),
        ("gradle: test", format!("{wrapper} test"), Some("test")),
        ("gradle: run", format!("{wrapper} run"), Some("dev")),
        ("gradle: clean", format!("{wrapper} clean"), None),
    ];
    for (label, cmd, group) in tasks {
        if skip.contains(label) {
            continue;
        }
        out.push(make_def(label, &cmd, "gradle", group));
    }
}

/// Detect Deno tasks from deno.json / deno.jsonc
fn detect_deno_tasks(
    base: &std::path::Path,
    skip: &std::collections::HashSet<String>,
    out: &mut Vec<TaskDefinition>,
) {
    let deno_file = ["deno.json", "deno.jsonc"]
        .iter()
        .map(|n| base.join(n))
        .find(|p| p.exists());
    let Some(path) = deno_file else { return };
    let Ok(content) = std::fs::read_to_string(&path) else { return };
    // Strip single-line comments for jsonc
    let stripped: String = content
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") { "" } else { line }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stripped) else { return };
    let Some(tasks_obj) = parsed.get("tasks").and_then(|v| v.as_object()) else { return };

    for (name, value) in tasks_obj {
        let label = format!("deno: {name}");
        if skip.contains(&label) {
            continue;
        }
        let cmd = format!("deno task {name}");
        let _ = value;
        out.push(make_def(&label, &cmd, "deno", classify_npm_script(name)));
    }
}

async fn append_log_line(
    tasks: &Arc<RwLock<HashMap<String, TaskInstance>>>,
    task_id: &str,
    line: &str,
) {
    let mut tasks_w = tasks.write().await;
    if let Some(task) = tasks_w.get_mut(task_id) {
        task.log_lines.push(line.to_string());
        if task.log_lines.len() > MAX_LOG_LINES {
            let excess = task.log_lines.len() - MAX_LOG_LINES;
            task.log_lines.drain(0..excess);
        }
    }
}

async fn emit_task_output(
    broadcast_tx: &broadcast::Sender<StreamEvent>,
    event_counter: &Arc<std::sync::atomic::AtomicU64>,
    event_buffer: &Arc<Mutex<std::collections::VecDeque<StreamEvent>>>,
    task_id: &str,
    workspace_id: &str,
    stream: &str,
    line: &str,
) {
    let evt_id = event_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let data = json!({
        "type": "task_output",
        "task_id": task_id,
        "stream": stream,
        "line": line,
    });
    let stream_event = StreamEvent {
        id: evt_id,
        session_id: String::new(),
        workspace_id: workspace_id.to_string(),
        event_type: "task_output".to_string(),
        data,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };
    {
        let mut buf = event_buffer.lock().await;
        if buf.len() >= 10_000 {
            buf.pop_front();
        }
        buf.push_back(stream_event.clone());
    }
    let _ = broadcast_tx.send(stream_event);
}
