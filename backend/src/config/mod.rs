use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_access_token_ttl_minutes() -> u64 {
    15
}

fn default_refresh_token_ttl_days() -> u64 {
    30
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub auth: AuthConfig,
    pub package: PackageConfig,
    pub sessions: Option<SessionsConfig>,
    pub agent: Option<AgentConfig>,
    pub chat: Option<ChatConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AgentConfig {
    pub pi_binary: Option<String>,
}

fn default_no_tools() -> bool {
    true
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatConfig {
    pub system_prompt: Option<String>,
    pub cwd: Option<String>,
    #[serde(default = "default_no_tools")]
    pub no_tools: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SessionsConfig {
    pub base_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
    pub server_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuthConfig {
    pub username: String,
    pub password_hash: String,
    #[serde(default = "default_access_token_ttl_minutes")]
    pub access_token_ttl_minutes: u64,
    #[serde(default = "default_refresh_token_ttl_days")]
    pub refresh_token_ttl_days: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_ttl_hours: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PackageConfig {
    pub name: String,
    pub install_command: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 5454,
                host: "0.0.0.0".to_string(),
                server_id: None,
            },
            auth: AuthConfig {
                username: "admin".to_string(),
                password_hash: String::new(),
                access_token_ttl_minutes: default_access_token_ttl_minutes(),
                refresh_token_ttl_days: default_refresh_token_ttl_days(),
                session_ttl_hours: None,
            },
            package: PackageConfig {
                name: "@mariozechner/pi-coding-agent".to_string(),
                install_command: None,
            },
            sessions: None,
            agent: None,
            chat: None,
        }
    }
}

impl AppConfig {
    pub fn pi_binary(&self) -> String {
        if let Some(path) = self.agent.as_ref().and_then(|a| a.pi_binary.as_ref()) {
            return path.clone();
        }
        if let Ok(output) = std::process::Command::new("which").arg("pi").output() {
            if output.status.success() {
                let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !resolved.is_empty() {
                    return resolved;
                }
            }
        }
        "pi".to_string()
    }

    pub fn sessions_base_path(&self) -> PathBuf {
        self.sessions
            .as_ref()
            .and_then(|s| s.base_path.as_ref())
            .map(|p| {
                let expanded = if p.starts_with('~') {
                    if let Some(home) = std::env::var_os("HOME") {
                        p.replacen('~', &home.to_string_lossy(), 1)
                    } else {
                        p.clone()
                    }
                } else {
                    p.clone()
                };
                PathBuf::from(expanded)
            })
            .unwrap_or_else(|| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
                PathBuf::from(home).join(".pi/agent/sessions")
            })
    }

    pub fn load(path: Option<PathBuf>) -> anyhow::Result<Self> {
        let config_path = path.unwrap_or_else(|| PathBuf::from("config.toml"));
        let mut config = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let raw: toml::Value = toml::from_str(&content)?;
            let config: AppConfig = toml::from_str(&content)?;

            let auth_table = raw.get("auth").and_then(|value| value.as_table());
            let has_legacy_ttl = auth_table.is_some_and(|table| table.contains_key("session_ttl_hours"));
            let has_access_ttl =
                auth_table.is_some_and(|table| table.contains_key("access_token_ttl_minutes"));
            let has_refresh_ttl =
                auth_table.is_some_and(|table| table.contains_key("refresh_token_ttl_days"));

            if has_legacy_ttl && !has_access_ttl && !has_refresh_ttl {
                tracing::warn!(
                    "config.toml uses deprecated auth.session_ttl_hours; using auth.access_token_ttl_minutes={} and auth.refresh_token_ttl_days={}",
                    config.auth.access_token_ttl_minutes,
                    config.auth.refresh_token_ttl_days
                );
            }

            config
        } else {
            AppConfig::default()
        };

        if config.server.server_id.is_none() {
            let id = uuid::Uuid::new_v4().to_string();
            config.server.server_id = Some(id);
            let content = toml::to_string_pretty(&config)?;
            std::fs::write(&config_path, content)?;
        }

        Ok(config)
    }

    pub fn server_id(&self) -> &str {
        self.server.server_id.as_deref().unwrap_or("unknown")
    }

    pub fn chat_cwd(&self) -> String {
        self.chat
            .as_ref()
            .and_then(|c| c.cwd.as_ref())
            .cloned()
            .unwrap_or_else(|| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
                format!("{home}/.pi/chat")
            })
    }

    pub fn chat_system_prompt(&self) -> Option<String> {
        self.chat.as_ref().and_then(|c| c.system_prompt.clone())
    }

    pub fn chat_no_tools(&self) -> bool {
        self.chat.as_ref().map(|c| c.no_tools).unwrap_or(true)
    }
}
