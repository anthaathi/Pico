use std::path::Path;
use std::process::Command;

use crate::config::AppConfig;
use crate::models::agent::{AgentRuntimeStatus, RuntimeDependencyStatus};

pub fn get_agent_runtime_status(config: &AppConfig) -> AgentRuntimeStatus {
    let node_bin = config.node_binary();
    let node = inspect_binary(&node_bin, None);

    let node_dir = std::path::Path::new(&node_bin)
        .parent()
        .map(|p| p.to_string_lossy().to_string());
    let pi = inspect_binary(&config.pi_binary(), node_dir.as_deref());

    AgentRuntimeStatus {
        ready: node.installed && pi.installed,
        can_install_pi: node.installed && !pi.installed,
        node,
        pi,
    }
}

pub fn get_runtime_prerequisite_error(status: &AgentRuntimeStatus) -> Option<String> {
    if !status.node.installed {
        return Some(
            "Node.js is not installed. Install it from https://nodejs.org or set [paths].node in config.toml"
                .to_string(),
        );
    }

    if !status.pi.installed {
        return Some(
            "pi-coding-agent is not installed. Run: npm install -g @mariozechner/pi-coding-agent — or set [paths].pi in config.toml"
                .to_string(),
        );
    }

    None
}

pub fn log_startup_runtime_status(status: &AgentRuntimeStatus) {
    if status.node.installed {
        tracing::info!(
            "Node.js available: version={} path={}",
            status.node.version.as_deref().unwrap_or("unknown"),
            status.node.path.as_deref().unwrap_or("unresolved")
        );
    } else {
        tracing::warn!(
            "Node.js missing: {}",
            status
                .node
                .details
                .as_deref()
                .unwrap_or("Failed to resolve the node binary")
        );
    }

    if status.pi.installed {
        tracing::info!(
            "Pi available: version={} path={}",
            status.pi.version.as_deref().unwrap_or("unknown"),
            status.pi.path.as_deref().unwrap_or("unresolved")
        );
    } else {
        tracing::warn!(
            "Pi missing: {}",
            status
                .pi
                .details
                .as_deref()
                .unwrap_or("Failed to resolve the pi binary")
        );
    }
}

fn inspect_binary(command: &str, extra_path_dir: Option<&str>) -> RuntimeDependencyStatus {
    let resolved_path = resolve_binary_path(command);
    let configured_path = if command.contains('/') || command.contains('\\') {
        Some(command.to_string())
    } else {
        None
    };

    let mut cmd = Command::new(command);
    cmd.arg("--version");
    if let Some(dir) = extra_path_dir {
        let current_path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{dir}:{current_path}"));
    }

    match cmd.output() {
        Ok(output) if output.status.success() => RuntimeDependencyStatus {
            command: command.to_string(),
            installed: true,
            version: extract_version(&output.stdout, &output.stderr),
            path: resolved_path.or(configured_path),
            details: None,
        },
        Ok(output) => {
            let details = extract_details(&output.stdout, &output.stderr)
                .unwrap_or_else(|| format!("`{command} --version` exited with {}", output.status));
            RuntimeDependencyStatus {
                command: command.to_string(),
                installed: false,
                version: None,
                path: resolved_path.or(configured_path),
                details: Some(details),
            }
        }
        Err(error) => RuntimeDependencyStatus {
            command: command.to_string(),
            installed: false,
            version: None,
            path: resolved_path.or(configured_path),
            details: Some(format!("Failed to run `{command}`: {error}")),
        },
    }
}

fn extract_version(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    first_non_empty_line(stdout).or_else(|| first_non_empty_line(stderr))
}

fn extract_details(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    first_non_empty_line(stderr).or_else(|| first_non_empty_line(stdout))
}

fn first_non_empty_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn resolve_binary_path(command: &str) -> Option<String> {
    let path = Path::new(command);
    if path.components().count() > 1 {
        return Some(path.to_string_lossy().into_owned());
    }

    let output = Command::new("which").arg(command).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved.is_empty() {
        None
    } else {
        Some(resolved)
    }
}
