#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

// ---------------------------------------------------------------------------
// Agent capabilities
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentCapability {
    Prompt,
    Steer,
    FollowUp,
    Abort,
    GetState,
    GetMessages,
    SetModel,
    CycleModel,
    GetAvailableModels,
    SetThinkingLevel,
    CycleThinkingLevel,
    SetSteeringMode,
    SetFollowUpMode,
    Compact,
    SetAutoCompaction,
    SetAutoRetry,
    AbortRetry,
    Bash,
    AbortBash,
    NewSession,
    SwitchSession,
    Fork,
    GetForkMessages,
    GetLastAssistantText,
    GetSessionStats,
    ExportHtml,
    SetSessionName,
    GetCommands,
    ExtensionUiResponse,
}

// ---------------------------------------------------------------------------
// Commands (input to agent)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub data: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone)]
pub enum StreamingBehavior {
    Steer,
    FollowUp,
}

#[derive(Debug, Clone)]
pub enum AgentCommand {
    Prompt {
        message: String,
        images: Option<Vec<ImageContent>>,
        streaming_behavior: Option<StreamingBehavior>,
    },
    Steer {
        message: String,
        images: Option<Vec<ImageContent>>,
    },
    FollowUp {
        message: String,
        images: Option<Vec<ImageContent>>,
    },
    Abort,
    GetState,
    GetMessages,
    SetModel {
        provider: String,
        model_id: String,
    },
    CycleModel,
    GetAvailableModels,
    SetThinkingLevel {
        level: String,
    },
    CycleThinkingLevel,
    SetSteeringMode {
        mode: String,
    },
    SetFollowUpMode {
        mode: String,
    },
    Compact {
        custom_instructions: Option<String>,
    },
    SetAutoCompaction {
        enabled: bool,
    },
    SetAutoRetry {
        enabled: bool,
    },
    AbortRetry,
    Bash {
        command: String,
    },
    AbortBash,
    NewSession {
        parent_session: Option<String>,
    },
    SwitchSession {
        session_path: String,
    },
    Fork {
        entry_id: String,
    },
    GetForkMessages,
    GetLastAssistantText,
    GetSessionStats,
    ExportHtml {
        output_path: Option<String>,
    },
    SetSessionName {
        name: String,
    },
    GetCommands,
    ExtensionUiResponse {
        id: String,
        value: Option<Value>,
        confirmed: Option<bool>,
        cancelled: Option<bool>,
    },
}

impl AgentCommand {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Prompt { message, images, streaming_behavior } => {
                let mut cmd = json!({"type": "prompt", "message": message});
                if let Some(imgs) = images {
                    cmd["images"] = serde_json::to_value(imgs).unwrap_or_default();
                }
                if let Some(b) = streaming_behavior {
                    cmd["streamingBehavior"] = json!(match b {
                        StreamingBehavior::Steer => "steer",
                        StreamingBehavior::FollowUp => "followUp",
                    });
                }
                cmd
            }
            Self::Steer { message, images } => {
                let mut cmd = json!({"type": "steer", "message": message});
                if let Some(imgs) = images { cmd["images"] = serde_json::to_value(imgs).unwrap_or_default(); }
                cmd
            }
            Self::FollowUp { message, images } => {
                let mut cmd = json!({"type": "follow_up", "message": message});
                if let Some(imgs) = images { cmd["images"] = serde_json::to_value(imgs).unwrap_or_default(); }
                cmd
            }
            Self::Abort => json!({"type": "abort"}),
            Self::GetState => json!({"type": "get_state"}),
            Self::GetMessages => json!({"type": "get_messages"}),
            Self::SetModel { provider, model_id } => json!({"type": "set_model", "provider": provider, "modelId": model_id}),
            Self::CycleModel => json!({"type": "cycle_model"}),
            Self::GetAvailableModels => json!({"type": "get_available_models"}),
            Self::SetThinkingLevel { level } => json!({"type": "set_thinking_level", "level": level}),
            Self::CycleThinkingLevel => json!({"type": "cycle_thinking_level"}),
            Self::SetSteeringMode { mode } => json!({"type": "set_steering_mode", "mode": mode}),
            Self::SetFollowUpMode { mode } => json!({"type": "set_follow_up_mode", "mode": mode}),
            Self::Compact { custom_instructions } => {
                let mut cmd = json!({"type": "compact"});
                if let Some(i) = custom_instructions { cmd["customInstructions"] = json!(i); }
                cmd
            }
            Self::SetAutoCompaction { enabled } => json!({"type": "set_auto_compaction", "enabled": enabled}),
            Self::SetAutoRetry { enabled } => json!({"type": "set_auto_retry", "enabled": enabled}),
            Self::AbortRetry => json!({"type": "abort_retry"}),
            Self::Bash { command } => json!({"type": "bash", "command": command}),
            Self::AbortBash => json!({"type": "abort_bash"}),
            Self::NewSession { parent_session } => {
                let mut cmd = json!({"type": "new_session"});
                if let Some(p) = parent_session { cmd["parentSession"] = json!(p); }
                cmd
            }
            Self::SwitchSession { session_path } => json!({"type": "switch_session", "sessionPath": session_path}),
            Self::Fork { entry_id } => json!({"type": "fork", "entryId": entry_id}),
            Self::GetForkMessages => json!({"type": "get_fork_messages"}),
            Self::GetLastAssistantText => json!({"type": "get_last_assistant_text"}),
            Self::GetSessionStats => json!({"type": "get_session_stats"}),
            Self::ExportHtml { output_path } => {
                let mut cmd = json!({"type": "export_html"});
                if let Some(p) = output_path { cmd["outputPath"] = json!(p); }
                cmd
            }
            Self::SetSessionName { name } => json!({"type": "set_session_name", "name": name}),
            Self::GetCommands => json!({"type": "get_commands"}),
            Self::ExtensionUiResponse { id, value, confirmed, cancelled } => {
                let mut cmd = json!({"type": "extension_ui_response", "id": id});
                if let Some(v) = value { cmd["value"] = v.clone(); }
                if let Some(c) = confirmed { cmd["confirmed"] = json!(c); }
                if let Some(c) = cancelled { cmd["cancelled"] = json!(c); }
                cmd
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Command responses
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum CommandResponse {
    Success(Value),
    Error(String),
}

impl CommandResponse {
    pub fn is_success(&self) -> bool {
        matches!(self, Self::Success(_))
    }

    pub fn into_result(self) -> Result<Value, String> {
        match self {
            Self::Success(v) => Ok(v),
            Self::Error(e) => Err(e),
        }
    }
}

// ---------------------------------------------------------------------------
// Shared data types (serde-derived)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolContent {
    pub content: Vec<ContentBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStats {
    pub files_edited: u32,
    pub files_created: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInfo {
    pub role: String,
    #[serde(default)]
    pub content: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Message delta types — all variants from RPC spec, serde-derived
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallPartial {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFull {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MessageDelta {
    #[serde(rename = "start")]
    Start,

    #[serde(rename = "text_start", rename_all = "camelCase")]
    TextStart {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "text_delta", rename_all = "camelCase")]
    TextDelta {
        delta: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "text_end", rename_all = "camelCase")]
    TextEnd {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "thinking_start", rename_all = "camelCase")]
    ThinkingStart {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "thinking_delta", rename_all = "camelCase")]
    ThinkingDelta {
        delta: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "thinking_end", rename_all = "camelCase")]
    ThinkingEnd {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<Value>,
    },

    #[serde(rename = "toolcall_start", rename_all = "camelCase")]
    ToolCallStart {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial: Option<ToolCallPartial>,
    },

    #[serde(rename = "toolcall_delta", rename_all = "camelCase")]
    ToolCallDelta {
        delta: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
    },

    #[serde(rename = "toolcall_end", rename_all = "camelCase")]
    ToolCallEnd {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_index: Option<u64>,
        tool_call: ToolCallFull,
    },

    #[serde(rename = "done")]
    Done {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<MessageInfo>,
    },

    #[serde(rename = "error")]
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<MessageInfo>,
    },
}

// ---------------------------------------------------------------------------
// Compaction types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactionReason {
    Threshold,
    Overflow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_kept_entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_before: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

// ---------------------------------------------------------------------------
// Extension UI request types — tagged by "method"
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method")]
pub enum ExtensionUiRequestKind {
    #[serde(rename = "select")]
    Select {
        title: String,
        options: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
    #[serde(rename = "confirm")]
    Confirm {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout: Option<u64>,
    },
    #[serde(rename = "input")]
    Input {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
    },
    #[serde(rename = "editor")]
    Editor {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefill: Option<String>,
    },
    #[serde(rename = "notify", rename_all = "camelCase")]
    Notify {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        notify_type: Option<String>,
    },
    #[serde(rename = "setStatus", rename_all = "camelCase")]
    SetStatus {
        status_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status_text: Option<String>,
    },
    #[serde(rename = "setWidget", rename_all = "camelCase")]
    SetWidget {
        widget_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        widget_lines: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        widget_placement: Option<String>,
    },
    #[serde(rename = "setTitle")]
    SetTitle {
        title: String,
    },
    #[serde(rename = "set_editor_text")]
    SetEditorText {
        text: String,
    },
}

// ---------------------------------------------------------------------------
// Stream events — serde-derived, tagged by "type"
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentStreamEvent {
    #[serde(rename = "agent_start")]
    AgentStart,

    #[serde(rename = "agent_end", rename_all = "camelCase")]
    AgentEnd {
        #[serde(default)]
        messages: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_stats: Option<TurnStats>,
    },

    #[serde(rename = "turn_start")]
    TurnStart,

    #[serde(rename = "turn_end", rename_all = "camelCase")]
    TurnEnd {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_results: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_stats: Option<TurnStats>,
    },

    #[serde(rename = "message_start")]
    MessageStart {
        message: MessageInfo,
    },

    #[serde(rename = "message_update", rename_all = "camelCase")]
    MessageUpdate {
        #[serde(rename = "assistantMessageEvent")]
        delta: MessageDelta,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<MessageInfo>,
    },

    #[serde(rename = "message_end")]
    MessageEnd {
        message: MessageInfo,
    },

    #[serde(rename = "tool_execution_start", rename_all = "camelCase")]
    ToolExecutionStart {
        tool_call_id: String,
        tool_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args: Option<Value>,
    },

    #[serde(rename = "tool_execution_update", rename_all = "camelCase")]
    ToolExecutionUpdate {
        tool_call_id: String,
        tool_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        partial_result: Option<ToolContent>,
    },

    #[serde(rename = "tool_execution_end", rename_all = "camelCase")]
    ToolExecutionEnd {
        tool_call_id: String,
        tool_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<ToolContent>,
        #[serde(default)]
        is_error: bool,
    },

    #[serde(rename = "auto_compaction_start")]
    AutoCompactionStart {
        reason: CompactionReason,
    },

    #[serde(rename = "auto_compaction_end", rename_all = "camelCase")]
    AutoCompactionEnd {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<CompactionResult>,
        #[serde(default)]
        aborted: bool,
        #[serde(default)]
        will_retry: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_message: Option<String>,
    },

    #[serde(rename = "auto_retry_start", rename_all = "camelCase")]
    AutoRetryStart {
        attempt: u32,
        max_attempts: u32,
        delay_ms: u64,
        error_message: String,
    },

    #[serde(rename = "auto_retry_end", rename_all = "camelCase")]
    AutoRetryEnd {
        success: bool,
        attempt: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        final_error: Option<String>,
    },

    #[serde(rename = "extension_error", rename_all = "camelCase")]
    ExtensionError {
        extension_path: String,
        event: String,
        error: String,
    },

    #[serde(rename = "extension_ui_request")]
    ExtensionUiRequest {
        id: String,
        #[serde(flatten)]
        request: ExtensionUiRequestKind,
    },

    #[serde(rename = "agent_state")]
    AgentState {
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "session_process_exited")]
    SessionProcessExited,

    #[serde(rename = "session_idle_timeout")]
    SessionIdleTimeout,

    #[serde(skip)]
    Unknown {
        event_type: String,
        data: Value,
    },
}

impl AgentStreamEvent {
    pub fn event_type(&self) -> &str {
        match self {
            Self::AgentStart => "agent_start",
            Self::AgentEnd { .. } => "agent_end",
            Self::TurnStart => "turn_start",
            Self::TurnEnd { .. } => "turn_end",
            Self::MessageStart { .. } => "message_start",
            Self::MessageUpdate { .. } => "message_update",
            Self::MessageEnd { .. } => "message_end",
            Self::ToolExecutionStart { .. } => "tool_execution_start",
            Self::ToolExecutionUpdate { .. } => "tool_execution_update",
            Self::ToolExecutionEnd { .. } => "tool_execution_end",
            Self::AutoCompactionStart { .. } => "auto_compaction_start",
            Self::AutoCompactionEnd { .. } => "auto_compaction_end",
            Self::AutoRetryStart { .. } => "auto_retry_start",
            Self::AutoRetryEnd { .. } => "auto_retry_end",
            Self::ExtensionError { .. } => "extension_error",
            Self::ExtensionUiRequest { .. } => "extension_ui_request",
            Self::AgentState { .. } => "agent_state",
            Self::SessionProcessExited => "session_process_exited",
            Self::SessionIdleTimeout => "session_idle_timeout",
            Self::Unknown { event_type, .. } => event_type,
        }
    }

    pub fn to_json(&self) -> (String, Value) {
        match self {
            Self::Unknown { event_type, data } => (event_type.clone(), data.clone()),
            _ => {
                let data = serde_json::to_value(self).unwrap_or(Value::Null);
                (self.event_type().to_string(), data)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Session config & snapshot
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub session_file: String,
    pub model: Option<Value>,
    pub thinking_level: Option<String>,
}

pub struct AgentSessionConfig {
    pub workspace_id: String,
    pub cwd: String,
    pub session_path: Option<String>,
    pub extra_args: Vec<String>,
}

// ---------------------------------------------------------------------------
// Spawned session result
// ---------------------------------------------------------------------------

pub struct SpawnedSession {
    pub snapshot: SessionSnapshot,
    pub handle: Arc<dyn AgentProcessHandle>,
    pub event_rx: mpsc::UnboundedReceiver<AgentStreamEvent>,
    pub initial_events: Vec<AgentStreamEvent>,
}

// ---------------------------------------------------------------------------
// Agent process handle (dyn-compatible via async_trait)
// ---------------------------------------------------------------------------

#[async_trait]
pub trait AgentProcessHandle: Send + Sync {
    async fn send_command(&self, command: AgentCommand) -> Result<CommandResponse, String>;
    async fn send_untracked(&self, command: AgentCommand) -> Result<(), String>;
    fn is_alive(&self) -> bool;
    async fn terminate(&self);
}

// ---------------------------------------------------------------------------
// Agent provider
// ---------------------------------------------------------------------------

#[async_trait]
pub trait AgentProvider: Send + Sync {
    async fn spawn_session(&self, config: AgentSessionConfig) -> Result<SpawnedSession, String>;
    fn provider_id(&self) -> &str;
    fn capabilities(&self) -> HashSet<AgentCapability>;
}
