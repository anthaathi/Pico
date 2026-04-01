use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::models::{PaginatedSessions, SessionDetail, SessionEntry, SessionHeader, SessionListItem, SessionTreeNode};

pub fn normalize_path(path: &str) -> String {
    normalize_cwd(path)
}

fn normalize_cwd(cwd: &str) -> String {
    let expanded = if cwd.starts_with('~') {
        if let Some(home) = std::env::var_os("HOME") {
            cwd.replacen('~', &home.to_string_lossy(), 1)
        } else {
            cwd.to_string()
        }
    } else {
        cwd.to_string()
    };

    let trimmed = expanded.trim().trim_end_matches('/');
    if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() }
}

fn cwd_to_dir_name(cwd: &str) -> String {
    let normalized = normalize_cwd(cwd);
    let inner = normalized.trim_start_matches('/');
    format!("--{}--", inner.replace('/', "-"))
}

pub fn list_sessions(
    base_path: &Path,
    cwd: &str,
    page: u32,
    limit: u32,
) -> PaginatedSessions {
    let empty = PaginatedSessions { items: Vec::new(), page, limit, total: 0, has_more: false };
    let dir_name = cwd_to_dir_name(cwd);
    let session_dir = base_path.join(&dir_name);

    if !session_dir.exists() {
        return empty;
    }

    let entries = match std::fs::read_dir(&session_dir) {
        Ok(e) => e,
        Err(_) => return empty,
    };

    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(true, |e| e != "jsonl") {
            continue;
        }
        if let Some(item) = parse_session_list_item(&path, cwd) {
            sessions.push(item);
        }
    }

    sessions.sort_by(|a, b| b.last_active.cmp(&a.last_active));

    let total = sessions.len() as u32;
    let offset = (page.saturating_sub(1)) * limit;
    let items: Vec<SessionListItem> = sessions
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    let has_more = offset + limit < total;

    PaginatedSessions { items, page, limit, total, has_more }
}

pub fn suggest_workspaces(base_path: &Path) -> Vec<String> {
    let dirs = match std::fs::read_dir(base_path) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut workspace_times: Vec<(String, std::time::SystemTime)> = Vec::new();

    for dir_entry in dirs.flatten() {
        if !dir_entry.file_type().map_or(false, |t| t.is_dir()) {
            continue;
        }

        let dir_path = dir_entry.path();
        let mut latest_time: Option<std::time::SystemTime> = None;
        let mut cwd_from_header: Option<String> = None;

        if let Ok(files) = std::fs::read_dir(&dir_path) {
            for file in files.flatten() {
                let fpath = file.path();
                if fpath.extension().map_or(true, |e| e != "jsonl") {
                    continue;
                }

                if let Ok(meta) = fpath.metadata() {
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    if latest_time.map_or(true, |lt| mtime > lt) {
                        latest_time = Some(mtime);
                    }
                }

                if cwd_from_header.is_none() {
                    if let Some(line) = read_first_line(&fpath) {
                        if let Ok(val) = serde_json::from_str::<Value>(&line) {
                            cwd_from_header = val.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string());
                        }
                    }
                }
            }
        }

        if let (Some(cwd), Some(mtime)) = (cwd_from_header, latest_time) {
            workspace_times.push((cwd, mtime));
        }
    }

    workspace_times.sort_by(|a, b| b.1.cmp(&a.1));
    workspace_times.dedup_by(|a, b| a.0 == b.0);
    workspace_times.truncate(10);
    workspace_times.into_iter().map(|(cwd, _)| cwd).collect()
}

pub fn get_session(base_path: &Path, cwd: &str, session_id: &str) -> Option<SessionDetail> {
    let file_path = find_session_file(base_path, cwd, session_id)?;
    parse_session_detail(&file_path)
}

pub fn get_session_entries(base_path: &Path, cwd: &str, session_id: &str) -> Option<Vec<SessionEntry>> {
    let file_path = find_session_file(base_path, cwd, session_id)?;
    let content = std::fs::read_to_string(&file_path).ok()?;

    let mut entries = Vec::new();
    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(line) {
            entries.push(value_to_entry(&val));
        }
    }

    Some(entries)
}

pub fn get_session_messages_anywhere(base_path: &Path, session_id: &str) -> Option<Vec<Value>> {
    let file_path = find_session_file_anywhere(base_path, session_id)?;
    parse_session_messages(&file_path)
}

pub struct PaginatedMessages {
    pub messages: Vec<Value>,
    pub has_more: bool,
    pub oldest_entry_id: Option<String>,
}

pub fn get_session_messages_paginated(
    base_path: &Path,
    session_id: &str,
    limit: u32,
    before_entry_id: Option<&str>,
) -> Option<PaginatedMessages> {
    let file_path = find_session_file_anywhere(base_path, session_id)?;
    let content = std::fs::read_to_string(&file_path).ok()?;

    let mut all_messages: Vec<(Option<String>, Value)> = Vec::new();

    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }

        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if val.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }

        let Some(message) = val.get("message") else {
            continue;
        };

        let entry_id = val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());

        let mut msg = message.clone();
        if let Some(ref eid) = entry_id {
            if let Some(obj) = msg.as_object_mut() {
                if !obj.contains_key("id") && !obj.contains_key("entryId") {
                    obj.insert("entryId".to_string(), Value::String(eid.clone()));
                }
            }
        }

        all_messages.push((entry_id, msg));
    }

    // Stamp turn stats on ALL messages before paginating so
    // turns that span page boundaries still get stats.
    let mut all_values: Vec<Value> = all_messages.iter().map(|(_, msg)| msg.clone()).collect();
    stamp_turn_stats_on_messages(&mut all_values);
    // Write stamped values back.
    for (i, val) in all_values.into_iter().enumerate() {
        all_messages[i].1 = val;
    }

    let end_index = if let Some(before_id) = before_entry_id {
        all_messages.iter().position(|(eid, _)| eid.as_deref() == Some(before_id))
            .unwrap_or(all_messages.len())
    } else {
        all_messages.len()
    };

    let start_index = end_index.saturating_sub(limit as usize);
    let has_more = start_index > 0;

    let page: Vec<Value> = all_messages[start_index..end_index]
        .iter()
        .map(|(_, msg)| msg.clone())
        .collect();

    let oldest_entry_id = if !page.is_empty() {
        all_messages[start_index].0.clone()
    } else {
        None
    };

    Some(PaginatedMessages {
        messages: page,
        has_more,
        oldest_entry_id,
    })
}

fn is_diff_add_line(line: &str) -> bool {
    line.starts_with('+') && !line.starts_with("++")
}

fn is_diff_rm_line(line: &str) -> bool {
    line.starts_with('-') && !line.starts_with("--")
}

fn stamp_turn_stats_on_messages(messages: &mut [Value]) {

    let mut turn_start_idx: Option<usize> = None;

    let mut i = 0;
    while i < messages.len() {
        let role = messages[i].get("role").and_then(|v| v.as_str()).unwrap_or("");

        if role == "user" {
            turn_start_idx = Some(i);
            i += 1;
            continue;
        }

        let is_final_assistant = role == "assistant"
            && messages[i].get("stopReason").and_then(|v| v.as_str()) == Some("stop");

        if !is_final_assistant || turn_start_idx.is_none() {
            i += 1;
            continue;
        }

        let start = turn_start_idx.unwrap();
        let mut files_edited = HashSet::new();
        let mut files_created = HashSet::new();
        let mut lines_added: u32 = 0;
        let mut lines_removed: u32 = 0;

        for j in start..=i {
            let msg = &messages[j];
            let Some(content) = msg.get("content").and_then(|v| v.as_array()) else {
                continue;
            };
            for block in content {
                if block.get("type").and_then(|v| v.as_str()) != Some("toolCall") {
                    continue;
                }
                let tool_name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = block.get("arguments");
                let path_str = extract_path_from_block(block);
                if path_str.is_empty() {
                    continue;
                }

                match tool_name {
                    "edit" => {
                        files_edited.insert(path_str);
                        // Look for diff in toolResult (matched by toolCallId)
                        let tool_call_id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        for k in start..=i {
                            let tr = &messages[k];
                            if tr.get("role").and_then(|v| v.as_str()) != Some("toolResult") {
                                continue;
                            }
                            if tr.get("toolCallId").and_then(|v| v.as_str()) != Some(tool_call_id) {
                                continue;
                            }
                            if let Some(diff) = tr.get("details").and_then(|d| d.get("diff")).and_then(|v| v.as_str()) {
                                for line in diff.lines() {
                                    if is_diff_add_line(line) {
                                        lines_added += 1;
                                    }
                                    if is_diff_rm_line(line) {
                                        lines_removed += 1;
                                    }
                                }
                            }
                            break;
                        }
                    }
                    "write" => {
                        files_created.insert(path_str);
                        let content_str = if let Some(a) = args {
                            if a.is_object() {
                                a.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string()
                            } else if let Some(s) = a.as_str() {
                                serde_json::from_str::<Value>(s)
                                    .ok()
                                    .and_then(|v| v.get("content")?.as_str().map(|s| s.to_string()))
                                    .unwrap_or_default()
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };
                        if !content_str.is_empty() {
                            lines_added += content_str.lines().count() as u32;
                        }
                    }
                    _ => {}
                }
            }
        }

        let start_ts = messages[start].get("timestamp").and_then(|v| v.as_f64()).or_else(|| {
            messages[start].get("timestamp").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok())
        });
        let end_ts = messages[i].get("timestamp").and_then(|v| v.as_f64()).or_else(|| {
            messages[i].get("timestamp").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok())
        });

        if let Some(obj) = messages[i].as_object_mut() {
            if !files_edited.is_empty() || !files_created.is_empty() {
                obj.insert("turnFileStats".to_string(), serde_json::json!({
                    "filesEdited": files_edited.len(),
                    "filesCreated": files_created.len(),
                    "linesAdded": lines_added,
                    "linesRemoved": lines_removed,
                }));
            }

            if let (Some(s), Some(e)) = (start_ts, end_ts) {
                let dur = (e - s) as i64;
                if dur > 0 {
                    obj.insert("turnDurationMs".to_string(), serde_json::json!(dur));
                }
            }
        }

        turn_start_idx = None;
        i += 1;
    }
}

fn extract_path_from_block(block: &Value) -> String {
    let args = block.get("arguments");
    if let Some(a) = args {
        if a.is_object() {
            if let Some(p) = a.get("path").and_then(|v| v.as_str()) {
                return p.to_string();
            }
        } else if let Some(s) = a.as_str() {
            if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                if let Some(p) = parsed.get("path").and_then(|v| v.as_str()) {
                    return p.to_string();
                }
            }
        }
    }
    String::new()
}

pub fn get_session_tree(base_path: &Path, cwd: &str, session_id: &str) -> Option<Vec<SessionTreeNode>> {
    let entries = get_session_entries(base_path, cwd, session_id)?;

    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut entry_map: HashMap<String, &SessionEntry> = HashMap::new();
    let mut roots = Vec::new();

    for entry in &entries {
        entry_map.insert(entry.id.clone(), entry);
        if let Some(pid) = &entry.parent_id {
            children_map
                .entry(pid.clone())
                .or_default()
                .push(entry.id.clone());
        } else {
            roots.push(entry.id.clone());
        }
    }

    fn build_node(
        id: &str,
        entry_map: &HashMap<String, &SessionEntry>,
        children_map: &HashMap<String, Vec<String>>,
    ) -> SessionTreeNode {
        let entry = entry_map.get(id).unwrap();
        let children = children_map
            .get(id)
            .map(|ids| {
                ids.iter()
                    .map(|cid| build_node(cid, entry_map, children_map))
                    .collect()
            })
            .unwrap_or_default();

        SessionTreeNode {
            id: entry.id.clone(),
            entry_type: entry.entry_type.clone(),
            role: entry.role.clone(),
            timestamp: entry.timestamp.clone(),
            children,
        }
    }

    let tree: Vec<SessionTreeNode> = roots
        .iter()
        .map(|rid| build_node(rid, &entry_map, &children_map))
        .collect();

    Some(tree)
}

pub fn get_leaf(base_path: &Path, cwd: &str, session_id: &str) -> Option<SessionEntry> {
    let entries = get_session_entries(base_path, cwd, session_id)?;

    let has_children: std::collections::HashSet<String> = entries
        .iter()
        .filter_map(|e| e.parent_id.clone())
        .collect();

    entries
        .into_iter()
        .rev()
        .find(|e| !has_children.contains(&e.id))
}

pub fn get_children(
    base_path: &Path,
    cwd: &str,
    session_id: &str,
    parent_id: &str,
) -> Option<Vec<SessionEntry>> {
    let entries = get_session_entries(base_path, cwd, session_id)?;

    let children: Vec<SessionEntry> = entries
        .into_iter()
        .filter(|e| e.parent_id.as_deref() == Some(parent_id))
        .collect();

    Some(children)
}

pub fn get_branch(
    base_path: &Path,
    cwd: &str,
    session_id: &str,
    from_id: &str,
) -> Option<Vec<SessionEntry>> {
    let entries = get_session_entries(base_path, cwd, session_id)?;

    let entry_map: HashMap<String, &SessionEntry> = entries
        .iter()
        .map(|e| (e.id.clone(), e))
        .collect();

    let mut path = Vec::new();
    let mut current = Some(from_id);

    while let Some(id) = current {
        if let Some(entry) = entry_map.get(id) {
            path.push((*entry).clone());
            current = entry.parent_id.as_deref();
        } else {
            break;
        }
    }

    path.reverse();
    Some(path)
}

pub fn delete_session(base_path: &Path, cwd: &str, session_id: &str) -> bool {
    if let Some(file_path) = find_session_file(base_path, cwd, session_id) {
        std::fs::remove_file(file_path).is_ok()
    } else {
        false
    }
}

fn find_session_file(base_path: &Path, cwd: &str, session_id: &str) -> Option<PathBuf> {
    let dir_name = cwd_to_dir_name(cwd);
    let session_dir = base_path.join(&dir_name);

    if !session_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(&session_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(true, |e| e != "jsonl") {
            continue;
        }

        let first_line = read_first_line(&path)?;
        if let Ok(val) = serde_json::from_str::<Value>(&first_line) {
            if val.get("id").and_then(|v| v.as_str()) == Some(session_id) {
                return Some(path);
            }
        }
    }

    None
}

fn find_session_file_anywhere(base_path: &Path, session_id: &str) -> Option<PathBuf> {
    if !base_path.exists() {
        return None;
    }

    let directories = std::fs::read_dir(base_path).ok()?;
    for directory in directories.flatten() {
        if !directory.file_type().map_or(false, |t| t.is_dir()) {
            continue;
        }

        let files = match std::fs::read_dir(directory.path()) {
            Ok(files) => files,
            Err(_) => continue,
        };

        for entry in files.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "jsonl") {
                continue;
            }

            let Some(first_line) = read_first_line(&path) else {
                continue;
            };

            if let Ok(val) = serde_json::from_str::<Value>(&first_line) {
                if val.get("id").and_then(|v| v.as_str()) == Some(session_id) {
                    return Some(path);
                }
            }
        }
    }

    None
}

fn parse_session_list_item(path: &Path, cwd: &str) -> Option<SessionListItem> {
    let first_line = read_first_line(path)?;
    let header: Value = serde_json::from_str(&first_line).ok()?;

    let id = header.get("id")?.as_str()?.to_string();
    let timestamp = header.get("timestamp")?.as_str()?.to_string();
    let version = header.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32;

    let content = std::fs::read_to_string(path).ok()?;
    let mut first_message = None;
    let mut message_count: u32 = 0;
    let mut session_name = None;

    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let val: Value = serde_json::from_str(line).ok()?;
        let entry_type = val.get("type")?.as_str()?;

        if entry_type == "message" {
            message_count += 1;
            if first_message.is_none() {
                if let Some(msg) = val.get("message") {
                    if msg.get("role").and_then(|r| r.as_str()) == Some("user") {
                        first_message = msg
                            .get("content")
                            .and_then(|c| {
                                if c.is_string() {
                                    Some(c.as_str().unwrap().to_string())
                                } else if c.is_array() {
                                    c.as_array().and_then(|arr| {
                                        arr.iter().find_map(|item| {
                                            if item.get("type")?.as_str()? == "text" {
                                                item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                                            } else {
                                                None
                                            }
                                        })
                                    })
                                } else {
                                    None
                                }
                            });
                    }
                }
            }
        } else if entry_type == "session_info" {
            session_name = val.get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
        }
    }

    let display_name = session_name.or_else(|| {
        first_message.as_ref().map(|m| {
            if m.len() > 100 {
                let end = m.floor_char_boundary(100);
                format!("{}...", &m[..end])
            } else {
                m.clone()
            }
        })
    });

    let last_active = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(SessionListItem {
        id,
        cwd: cwd.to_string(),
        created_at: timestamp,
        last_active,
        version,
        display_name,
        message_count,
        file_path: path.to_string_lossy().to_string(),
    })
}

fn parse_session_detail(path: &Path) -> Option<SessionDetail> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut lines = content.lines();

    let header_line = lines.next()?;
    let header_val: Value = serde_json::from_str(header_line).ok()?;

    let header = SessionHeader {
        version: header_val.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
        id: header_val.get("id")?.as_str()?.to_string(),
        timestamp: header_val.get("timestamp")?.as_str()?.to_string(),
        cwd: header_val.get("cwd")?.as_str()?.to_string(),
        parent_session: header_val.get("parentSession").and_then(|v| v.as_str()).map(|s| s.to_string()),
    };

    let mut entries = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(line) {
            entries.push(value_to_entry(&val));
        }
    }

    Some(SessionDetail { header, entries })
}

fn parse_session_messages(path: &Path) -> Option<Vec<Value>> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut messages = Vec::new();

    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }

        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if val.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }

        if let Some(message) = val.get("message") {
            messages.push(message.clone());
        }
    }

    Some(messages)
}

fn value_to_entry(val: &Value) -> SessionEntry {
    let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let parent_id = val.get("parentId").and_then(|v| v.as_str()).map(|s| s.to_string());
    let timestamp = val.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let role = val
        .get("message")
        .and_then(|m| m.get("role"))
        .and_then(|r| r.as_str())
        .map(|s| s.to_string());

    let preview = extract_preview(val, &entry_type);

    SessionEntry {
        id,
        parent_id,
        entry_type,
        role,
        timestamp,
        preview,
        raw: val.clone(),
    }
}

fn extract_preview(val: &Value, entry_type: &str) -> Option<String> {
    match entry_type {
        "message" => {
            let msg = val.get("message")?;
            let content = msg.get("content")?;
            let text = if content.is_string() {
                content.as_str().map(|s| s.to_string())
            } else if content.is_array() {
                content.as_array().and_then(|arr| {
                    arr.iter().find_map(|item| {
                        if item.get("type")?.as_str()? == "text" {
                            item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                })
            } else {
                None
            };
            text.map(|t| {
                if t.len() > 200 {
                    let end = t.floor_char_boundary(200);
                    format!("{}...", &t[..end])
                } else {
                    t
                }
            })
        }
        "compaction" => val.get("summary").and_then(|s| s.as_str()).map(|s| s.to_string()),
        "branch_summary" => val.get("summary").and_then(|s| s.as_str()).map(|s| s.to_string()),
        "model_change" => {
            let provider = val.get("provider").and_then(|v| v.as_str()).unwrap_or("?");
            let model = val.get("modelId").and_then(|v| v.as_str()).unwrap_or("?");
            Some(format!("{provider}/{model}"))
        }
        "session_info" => val.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()),
        _ => None,
    }
}

fn read_first_line(path: &Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    Some(line.trim().to_string())
}
