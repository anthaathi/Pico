use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::db::Database;
use crate::services::agent::AgentManager;
use crate::services::pairing::PairingManager;
use crate::services::port_scanner::PortScanner;
use crate::services::task::TaskManager;

#[derive(Clone, Debug)]
pub struct ActivePreview {
    pub session: String,
    pub hostname: String,
    pub port: String,
    pub token: String,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: Arc<Database>,
    pub pairing: PairingManager,
    pub agent: AgentManager,
    pub task_manager: TaskManager,
    pub port_scanner: Arc<PortScanner>,
    pub http_client: reqwest::Client,
    pub instance_id: Arc<String>,
    pub active_preview: Arc<RwLock<Option<ActivePreview>>>,
}
