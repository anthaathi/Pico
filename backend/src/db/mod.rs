use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::Mutex;
use uuid::Uuid;

use crate::models::{OperationLog, Workspace, WorkspaceStatus};
use crate::models::mode::AgentMode;

#[derive(Debug, Clone)]
pub struct AuthSessionRecord {
    pub id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_at: DateTime<Utc>,
    pub refresh_expires_at: DateTime<Utc>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();

        // V0: original schema (tables use IF NOT EXISTS so this is idempotent)
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                access_token TEXT NOT NULL UNIQUE,
                refresh_token TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                access_expires_at TEXT NOT NULL,
                refresh_expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS operation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation TEXT NOT NULL,
                status TEXT NOT NULL,
                output TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                color TEXT,
                workspace_enabled INTEGER NOT NULL DEFAULT 1,
                startup_script TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;

        // Versioned migrations using PRAGMA user_version
        let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version < 1 {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS agent_modes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    model TEXT,
                    thinking_level TEXT,
                    extensions TEXT NOT NULL DEFAULT '[]',
                    skills TEXT NOT NULL DEFAULT '[]',
                    extra_args TEXT NOT NULL DEFAULT '[]',
                    is_default INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS session_modes (
                    session_id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                PRAGMA user_version = 1;
                ",
            )?;
        }

        Ok(())
    }

    fn parse_rfc3339_utc(value: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
        Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
    }

    fn row_to_auth_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthSessionRecord> {
        let access_expires_at: String = row.get(3)?;
        let refresh_expires_at: String = row.get(4)?;

        Ok(AuthSessionRecord {
            id: row.get(0)?,
            access_token: row.get(1)?,
            refresh_token: row.get(2)?,
            access_expires_at: Self::parse_rfc3339_utc(&access_expires_at).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?,
            refresh_expires_at: Self::parse_rfc3339_utc(&refresh_expires_at).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?,
        })
    }

    pub fn create_auth_session(
        &self,
        username: &str,
        access_ttl_minutes: u64,
        refresh_ttl_days: u64,
    ) -> anyhow::Result<AuthSessionRecord> {
        let conn = self.conn.lock().unwrap();
        let session_id = Uuid::new_v4().to_string();
        let access_token = Uuid::new_v4().to_string();
        let refresh_token = Uuid::new_v4().to_string();
        let now = Utc::now();
        let access_expires_at = now + Duration::minutes(access_ttl_minutes as i64);
        let refresh_expires_at = now + Duration::days(refresh_ttl_days as i64);

        conn.execute(
            "INSERT INTO auth_sessions (
                id,
                username,
                access_token,
                refresh_token,
                created_at,
                access_expires_at,
                refresh_expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session_id,
                username,
                access_token,
                refresh_token,
                now.to_rfc3339(),
                access_expires_at.to_rfc3339(),
                refresh_expires_at.to_rfc3339(),
            ],
        )?;

        Ok(AuthSessionRecord {
            id: session_id,
            access_token,
            refresh_token,
            access_expires_at,
            refresh_expires_at,
        })
    }

    pub fn validate_access_token(&self, token: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let result = conn.query_row(
            "SELECT username FROM auth_sessions WHERE access_token = ?1 AND access_expires_at > ?2",
            params![token, now],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(username) => Ok(Some(username)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn rotate_auth_session(
        &self,
        refresh_token: &str,
        access_ttl_minutes: u64,
        refresh_ttl_days: u64,
    ) -> anyhow::Result<Option<AuthSessionRecord>> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let now = Utc::now();
        let session = tx
            .query_row(
                "SELECT id, access_token, refresh_token, access_expires_at, refresh_expires_at
                 FROM auth_sessions
                 WHERE refresh_token = ?1 AND refresh_expires_at > ?2",
                params![refresh_token, now.to_rfc3339()],
                Self::row_to_auth_session,
            )
            .optional()?;

        let Some(mut session) = session else {
            tx.commit()?;
            return Ok(None);
        };

        let next_access_token = Uuid::new_v4().to_string();
        let next_refresh_token = Uuid::new_v4().to_string();
        let next_access_expires_at = now + Duration::minutes(access_ttl_minutes as i64);
        let next_refresh_expires_at = now + Duration::days(refresh_ttl_days as i64);

        tx.execute(
            "UPDATE auth_sessions
             SET access_token = ?1, refresh_token = ?2, access_expires_at = ?3, refresh_expires_at = ?4
             WHERE id = ?5 AND refresh_token = ?6",
            params![
                next_access_token,
                next_refresh_token,
                next_access_expires_at.to_rfc3339(),
                next_refresh_expires_at.to_rfc3339(),
                session.id,
                refresh_token,
            ],
        )?;
        tx.commit()?;

        session.access_token = next_access_token;
        session.refresh_token = next_refresh_token;
        session.access_expires_at = next_access_expires_at;
        session.refresh_expires_at = next_refresh_expires_at;
        Ok(Some(session))
    }

    pub fn revoke_auth_session_by_access_token(&self, token: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM auth_sessions WHERE access_token = ?1",
            params![token],
        )?;
        Ok(())
    }

    pub fn revoke_auth_session_by_refresh_token(&self, token: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM auth_sessions WHERE refresh_token = ?1",
            params![token],
        )?;
        Ok(())
    }

    pub fn count_active_auth_sessions(&self) -> anyhow::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let count = conn.query_row(
            "SELECT COUNT(*) FROM auth_sessions WHERE refresh_expires_at > ?1",
            params![now],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(count)
    }

    pub fn log_operation(&self, operation: &str, status: &str, output: &str) -> anyhow::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO operation_logs (operation, status, output) VALUES (?1, ?2, ?3)",
            params![operation, status, output],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_operation_logs(&self, limit: i64) -> anyhow::Result<Vec<OperationLog>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, operation, status, output, created_at FROM operation_logs ORDER BY id DESC LIMIT ?1",
        )?;
        let logs = stmt
            .query_map(params![limit], |row| {
                Ok(OperationLog {
                    id: row.get(0)?,
                    operation: row.get(1)?,
                    status: row.get(2)?,
                    output: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(logs)
    }

    pub fn create_workspace(
        &self,
        name: &str,
        path: &str,
        color: Option<&str>,
        workspace_enabled: bool,
        startup_script: Option<&str>,
    ) -> anyhow::Result<Workspace> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO workspaces (id, name, path, color, workspace_enabled, startup_script, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)",
            params![id, name, path, color, workspace_enabled as i32, startup_script, now],
        )?;

        Ok(Workspace {
            id,
            name: name.to_string(),
            path: path.to_string(),
            color: color.map(|s| s.to_string()),
            workspace_enabled,
            startup_script: startup_script.map(|s| s.to_string()),
            status: WorkspaceStatus::Active,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_workspace(&self, id: &str) -> anyhow::Result<Option<Workspace>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, name, path, color, workspace_enabled, startup_script, status, created_at, updated_at
             FROM workspaces WHERE id = ?1",
            params![id],
            |row| Self::row_to_workspace(row),
        );
        match result {
            Ok(w) => Ok(Some(w)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn list_workspaces(&self, include_archived: bool) -> anyhow::Result<Vec<Workspace>> {
        let conn = self.conn.lock().unwrap();
        let sql = if include_archived {
            "SELECT id, name, path, color, workspace_enabled, startup_script, status, created_at, updated_at
             FROM workspaces ORDER BY created_at DESC"
        } else {
            "SELECT id, name, path, color, workspace_enabled, startup_script, status, created_at, updated_at
             FROM workspaces WHERE status = 'active' ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let workspaces = stmt
            .query_map([], |row| Self::row_to_workspace(row))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(workspaces)
    }

    pub fn update_workspace(
        &self,
        id: &str,
        name: Option<&str>,
        path: Option<&str>,
        color: Option<Option<&str>>,
        workspace_enabled: Option<bool>,
        startup_script: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Workspace>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        let exists: bool = conn
            .query_row("SELECT COUNT(*) FROM workspaces WHERE id = ?1", params![id], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)?;

        if !exists {
            return Ok(None);
        }

        if let Some(v) = name {
            conn.execute("UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = path {
            conn.execute("UPDATE workspaces SET path = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = color {
            conn.execute("UPDATE workspaces SET color = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = workspace_enabled {
            conn.execute("UPDATE workspaces SET workspace_enabled = ?1, updated_at = ?2 WHERE id = ?3", params![v as i32, now, id])?;
        }
        if let Some(v) = startup_script {
            conn.execute("UPDATE workspaces SET startup_script = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }

        drop(conn);
        self.get_workspace(id)
    }

    pub fn delete_workspace(&self, id: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    pub fn set_workspace_status(&self, id: &str, status: &WorkspaceStatus) -> anyhow::Result<Option<Workspace>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let status_str = match status {
            WorkspaceStatus::Active => "active",
            WorkspaceStatus::Archived => "archived",
        };
        let rows = conn.execute(
            "UPDATE workspaces SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status_str, now, id],
        )?;
        if rows == 0 {
            return Ok(None);
        }
        drop(conn);
        self.get_workspace(id)
    }

    fn row_to_workspace(row: &rusqlite::Row) -> rusqlite::Result<Workspace> {
        let status_str: String = row.get(6)?;
        let enabled: i32 = row.get(4)?;
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            workspace_enabled: enabled != 0,
            startup_script: row.get(5)?,
            status: if status_str == "archived" { WorkspaceStatus::Archived } else { WorkspaceStatus::Active },
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }

    // -----------------------------------------------------------------------
    // Agent Modes
    // -----------------------------------------------------------------------

    fn parse_json_string_array(raw: &str) -> Vec<String> {
        serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
    }

    fn row_to_agent_mode(row: &rusqlite::Row) -> rusqlite::Result<AgentMode> {
        let extensions_raw: String = row.get(5)?;
        let skills_raw: String = row.get(6)?;
        let extra_args_raw: String = row.get(7)?;
        let is_default_int: i32 = row.get(8)?;
        Ok(AgentMode {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            model: row.get(3)?,
            thinking_level: row.get(4)?,
            extensions: Self::parse_json_string_array(&extensions_raw),
            skills: Self::parse_json_string_array(&skills_raw),
            extra_args: Self::parse_json_string_array(&extra_args_raw),
            is_default: is_default_int != 0,
            sort_order: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    }

    pub fn create_agent_mode(
        &self,
        name: &str,
        description: Option<&str>,
        model: Option<&str>,
        thinking_level: Option<&str>,
        extensions: &[String],
        skills: &[String],
        extra_args: &[String],
        is_default: bool,
        sort_order: i32,
    ) -> anyhow::Result<AgentMode> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let extensions_json = serde_json::to_string(extensions)?;
        let skills_json = serde_json::to_string(skills)?;
        let extra_args_json = serde_json::to_string(extra_args)?;

        if is_default {
            conn.execute(
                "UPDATE agent_modes SET is_default = 0, updated_at = ?1 WHERE is_default = 1",
                params![now],
            )?;
        }

        conn.execute(
            "INSERT INTO agent_modes (id, name, description, model, thinking_level, extensions, skills, extra_args, is_default, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                name,
                description,
                model,
                thinking_level,
                extensions_json,
                skills_json,
                extra_args_json,
                is_default as i32,
                sort_order,
                now,
            ],
        )?;

        Ok(AgentMode {
            id,
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            model: model.map(|s| s.to_string()),
            thinking_level: thinking_level.map(|s| s.to_string()),
            extensions: extensions.to_vec(),
            skills: skills.to_vec(),
            extra_args: extra_args.to_vec(),
            is_default,
            sort_order,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_agent_mode(&self, id: &str) -> anyhow::Result<Option<AgentMode>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, name, description, model, thinking_level, extensions, skills, extra_args, is_default, sort_order, created_at, updated_at
             FROM agent_modes WHERE id = ?1",
            params![id],
            Self::row_to_agent_mode,
        );
        match result {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn list_agent_modes(&self) -> anyhow::Result<Vec<AgentMode>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, model, thinking_level, extensions, skills, extra_args, is_default, sort_order, created_at, updated_at
             FROM agent_modes ORDER BY sort_order ASC, created_at ASC",
        )?;
        let modes = stmt
            .query_map([], Self::row_to_agent_mode)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(modes)
    }

    pub fn update_agent_mode(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
        model: Option<Option<&str>>,
        thinking_level: Option<Option<&str>>,
        extensions: Option<&[String]>,
        skills: Option<&[String]>,
        extra_args: Option<&[String]>,
        is_default: Option<bool>,
        sort_order: Option<i32>,
    ) -> anyhow::Result<Option<AgentMode>> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        let exists: bool = conn
            .query_row("SELECT COUNT(*) FROM agent_modes WHERE id = ?1", params![id], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)?;

        if !exists {
            return Ok(None);
        }

        if let Some(v) = name {
            conn.execute("UPDATE agent_modes SET name = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = description {
            conn.execute("UPDATE agent_modes SET description = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = model {
            conn.execute("UPDATE agent_modes SET model = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = thinking_level {
            conn.execute("UPDATE agent_modes SET thinking_level = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }
        if let Some(v) = extensions {
            let json = serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string());
            conn.execute("UPDATE agent_modes SET extensions = ?1, updated_at = ?2 WHERE id = ?3", params![json, now, id])?;
        }
        if let Some(v) = skills {
            let json = serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string());
            conn.execute("UPDATE agent_modes SET skills = ?1, updated_at = ?2 WHERE id = ?3", params![json, now, id])?;
        }
        if let Some(v) = extra_args {
            let json = serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string());
            conn.execute("UPDATE agent_modes SET extra_args = ?1, updated_at = ?2 WHERE id = ?3", params![json, now, id])?;
        }
        if let Some(v) = is_default {
            if v {
                conn.execute(
                    "UPDATE agent_modes SET is_default = 0, updated_at = ?1 WHERE is_default = 1 AND id != ?2",
                    params![now, id],
                )?;
            }
            conn.execute("UPDATE agent_modes SET is_default = ?1, updated_at = ?2 WHERE id = ?3", params![v as i32, now, id])?;
        }
        if let Some(v) = sort_order {
            conn.execute("UPDATE agent_modes SET sort_order = ?1, updated_at = ?2 WHERE id = ?3", params![v, now, id])?;
        }

        drop(conn);
        self.get_agent_mode(id)
    }

    pub fn delete_agent_mode(&self, id: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM session_modes WHERE mode_id = ?1", params![id])?;
        let rows = conn.execute("DELETE FROM agent_modes WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // -----------------------------------------------------------------------
    // Session Modes
    // -----------------------------------------------------------------------

    pub fn set_session_mode(&self, session_id: &str, mode_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO session_modes (session_id, mode_id, created_at) VALUES (?1, ?2, ?3)",
            params![session_id, mode_id, now],
        )?;
        Ok(())
    }

    pub fn get_session_mode(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT mode_id FROM session_modes WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(mode_id) => Ok(Some(mode_id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Database;

    #[test]
    fn rotate_auth_session_invalidates_previous_tokens() {
        let db = Database::new(":memory:").expect("in-memory db");
        let session = db
            .create_auth_session("admin", 15, 30)
            .expect("create auth session");

        let username = db
            .validate_access_token(&session.access_token)
            .expect("validate access token");
        assert_eq!(username.as_deref(), Some("admin"));

        let rotated = db
            .rotate_auth_session(&session.refresh_token, 15, 30)
            .expect("rotate auth session")
            .expect("rotated session");

        assert_ne!(rotated.access_token, session.access_token);
        assert_ne!(rotated.refresh_token, session.refresh_token);

        let old_username = db
            .validate_access_token(&session.access_token)
            .expect("validate old access token");
        assert!(old_username.is_none());

        let current_username = db
            .validate_access_token(&rotated.access_token)
            .expect("validate rotated access token");
        assert_eq!(current_username.as_deref(), Some("admin"));

        let second_rotation = db
            .rotate_auth_session(&session.refresh_token, 15, 30)
            .expect("second rotation");
        assert!(second_rotation.is_none());
    }

    #[test]
    fn revoke_auth_session_by_refresh_token_removes_access_token() {
        let db = Database::new(":memory:").expect("in-memory db");
        let session = db
            .create_auth_session("admin", 15, 30)
            .expect("create auth session");

        db.revoke_auth_session_by_refresh_token(&session.refresh_token)
            .expect("revoke by refresh token");

        let username = db
            .validate_access_token(&session.access_token)
            .expect("validate revoked access token");
        assert!(username.is_none());
    }
}
