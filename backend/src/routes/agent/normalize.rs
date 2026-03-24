use serde_json::{json, Value};

/// Normalize each command in a `get_commands` response so that both the new
/// `sourceInfo` object **and** the legacy flat fields (`source`, `location`,
/// `path`) are always present.  This keeps the backend compatible with old
/// and new pi agent versions alike.
pub fn normalize_commands_response(data: &mut Value) {
    let Some(commands) = data.get_mut("commands").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for cmd in commands {
        normalize_command(cmd);
    }
}

fn normalize_command(cmd: &mut Value) {
    let Some(obj) = cmd.as_object_mut() else {
        return;
    };

    let old_source = str_field(obj, "source");
    let old_location = str_field(obj, "location");
    let old_path = str_field(obj, "path");

    let si_source = nested_str_field(obj, "sourceInfo", "source");
    let si_scope = nested_str_field(obj, "sourceInfo", "scope");
    let si_path = nested_str_field(obj, "sourceInfo", "path");

    let source = si_source.or(old_source);
    let scope = si_scope.or(old_location);
    let path = si_path.or(old_path);

    obj.insert("sourceInfo".into(), json!({
        "source": source,
        "scope":  scope,
        "path":   path,
    }));

    set_if_absent(obj, "source", &source);
    set_if_absent(obj, "location", &scope);
    set_if_absent(obj, "path", &path);
}

fn str_field(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| v.as_str()).map(String::from)
}

fn nested_str_field(obj: &serde_json::Map<String, Value>, outer: &str, inner: &str) -> Option<String> {
    obj.get(outer)
        .and_then(|v| v.get(inner))
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn set_if_absent(obj: &mut serde_json::Map<String, Value>, key: &str, val: &Option<String>) {
    if !obj.contains_key(key) {
        match val {
            Some(s) => obj.insert(key.into(), Value::String(s.clone())),
            None => obj.insert(key.into(), Value::Null),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn old_format_gets_source_info_added() {
        let mut cmd = json!({
            "name": "fix-tests",
            "source": "prompt",
            "location": "project",
            "path": "/proj/.pi/prompts/fix-tests.md"
        });
        normalize_command(&mut cmd);

        let si = &cmd["sourceInfo"];
        assert_eq!(si["source"], "prompt");
        assert_eq!(si["scope"], "project");
        assert_eq!(si["path"], "/proj/.pi/prompts/fix-tests.md");

        assert_eq!(cmd["source"], "prompt");
        assert_eq!(cmd["location"], "project");
        assert_eq!(cmd["path"], "/proj/.pi/prompts/fix-tests.md");
    }

    #[test]
    fn new_format_gets_legacy_fields_added() {
        let mut cmd = json!({
            "name": "skill:brave",
            "sourceInfo": {
                "source": "skill",
                "scope": "user",
                "path": "/home/u/.pi/skills/brave/SKILL.md"
            }
        });
        normalize_command(&mut cmd);

        assert_eq!(cmd["source"], "skill");
        assert_eq!(cmd["location"], "user");
        assert_eq!(cmd["path"], "/home/u/.pi/skills/brave/SKILL.md");

        let si = &cmd["sourceInfo"];
        assert_eq!(si["source"], "skill");
        assert_eq!(si["scope"], "user");
        assert_eq!(si["path"], "/home/u/.pi/skills/brave/SKILL.md");
    }

    #[test]
    fn partial_old_fields() {
        let mut cmd = json!({
            "name": "session-name",
            "source": "extension"
        });
        normalize_command(&mut cmd);

        let si = &cmd["sourceInfo"];
        assert_eq!(si["source"], "extension");
        assert!(si["scope"].is_null());
        assert!(si["path"].is_null());

        assert_eq!(cmd["source"], "extension");
        assert!(cmd["location"].is_null());
        assert!(cmd["path"].is_null());
    }

    #[test]
    fn mixed_format_prefers_source_info() {
        let mut cmd = json!({
            "name": "test",
            "source": "extension",
            "location": "project",
            "path": "/old/path.ts",
            "sourceInfo": { "source": "skill" }
        });
        normalize_command(&mut cmd);

        let si = &cmd["sourceInfo"];
        assert_eq!(si["source"], "skill");
        assert_eq!(si["scope"], "project");
        assert_eq!(si["path"], "/old/path.ts");

        assert_eq!(cmd["source"], "extension");
        assert_eq!(cmd["location"], "project");
        assert_eq!(cmd["path"], "/old/path.ts");
    }

    #[test]
    fn no_provenance_at_all() {
        let mut cmd = json!({ "name": "bare" });
        normalize_command(&mut cmd);

        let si = &cmd["sourceInfo"];
        assert!(si["source"].is_null());
        assert!(si["scope"].is_null());
        assert!(si["path"].is_null());

        assert!(cmd["source"].is_null());
        assert!(cmd["location"].is_null());
        assert!(cmd["path"].is_null());
    }

    #[test]
    fn full_response_normalization() {
        let mut data = json!({
            "commands": [
                { "name": "a", "source": "prompt", "location": "user", "path": "/a.md" },
                { "name": "b", "sourceInfo": { "source": "skill", "scope": "project", "path": "/b" } }
            ]
        });
        normalize_commands_response(&mut data);

        assert!(data["commands"][0]["sourceInfo"].is_object());
        assert_eq!(data["commands"][1]["source"], "skill");
        assert_eq!(data["commands"][1]["location"], "project");
    }
}
