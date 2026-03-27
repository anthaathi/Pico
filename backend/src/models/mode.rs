use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentMode {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub extensions: Vec<String>,
    pub skills: Vec<String>,
    pub extra_args: Vec<String>,
    pub is_default: bool,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateAgentModeRequest {
    pub name: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub skills: Option<Vec<String>>,
    pub extra_args: Option<Vec<String>>,
    pub is_default: Option<bool>,
    pub sort_order: Option<i32>,
}

impl AgentMode {
    pub fn to_cli_args(&self) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(ref model) = self.model {
            if !model.is_empty() {
                args.push("--model".to_string());
                args.push(model.clone());
            }
        }

        if let Some(ref level) = self.thinking_level {
            if !level.is_empty() {
                args.push("--thinking".to_string());
                args.push(level.clone());
            }
        }

        for ext in &self.extensions {
            if !ext.is_empty() {
                args.push("--extension".to_string());
                args.push(ext.clone());
            }
        }

        for skill in &self.skills {
            if !skill.is_empty() {
                args.push("--skill".to_string());
                args.push(skill.clone());
            }
        }

        args.extend(self.extra_args.clone());

        args
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateAgentModeRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub skills: Option<Vec<String>>,
    pub extra_args: Option<Vec<String>>,
    pub is_default: Option<bool>,
    pub sort_order: Option<i32>,
}
