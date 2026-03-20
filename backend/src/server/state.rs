use std::sync::Arc;

use crate::config::AppConfig;
use crate::db::Database;
use crate::services::agent::AgentManager;
use crate::services::pairing::PairingManager;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: Arc<Database>,
    pub pairing: PairingManager,
    pub agent: AgentManager,
}
