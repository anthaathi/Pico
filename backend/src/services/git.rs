use std::path::PathBuf;
use std::process::Command;

use crate::models::{
    GitBranch, GitDiffResponse, GitFileEntry, GitFileDiffResponse, GitLogEntry, GitStashEntry,
    GitStatusResponse, GitWorktree,
};

fn expand_path(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    } else if path == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let expanded = expand_path(cwd);
    let output = Command::new("git")
        .args(args)
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

fn numstat_map(cwd: &str, args: &[&str]) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map = std::collections::HashMap::new();
    if let Ok(output) = git(cwd, args) {
        for line in output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let add = parts[0].parse::<u32>().unwrap_or(0);
                let del = parts[1].parse::<u32>().unwrap_or(0);
                map.insert(parts[2].to_string(), (add, del));
            }
        }
    }
    map
}

pub fn status(cwd: &str) -> Result<GitStatusResponse, String> {
    let branch = git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    let porcelain = git(cwd, &["status", "--porcelain=v1", "-b"])?;

    let staged_stats = numstat_map(cwd, &["diff", "--cached", "--numstat"]);
    let unstaged_stats = numstat_map(cwd, &["diff", "--numstat"]);

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    for line in porcelain.lines() {
        if line.starts_with("## ") {
            if let Some(ab) = line.split('[').nth(1) {
                let ab = ab.trim_end_matches(']');
                for part in ab.split(", ") {
                    if let Some(n) = part.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    }
                    if let Some(n) = part.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }

        if line.len() < 4 {
            continue;
        }

        let index = line.as_bytes()[0];
        let worktree = line.as_bytes()[1];
        let path = line[3..].to_string();

        if index == b'?' {
            untracked.push(path);
            continue;
        }

        if index != b' ' && index != b'?' {
            let (additions, deletions) = staged_stats.get(&path).copied().unwrap_or((0, 0));
            staged.push(GitFileEntry {
                path: path.clone(),
                status: status_char_to_string(index),
                additions,
                deletions,
            });
        }

        if worktree != b' ' && worktree != b'?' {
            let (additions, deletions) = unstaged_stats.get(&path).copied().unwrap_or((0, 0));
            unstaged.push(GitFileEntry {
                path,
                status: status_char_to_string(worktree),
                additions,
                deletions,
            });
        }
    }

    let is_clean = staged.is_empty() && unstaged.is_empty() && untracked.is_empty();

    let remote_url = git(cwd, &["remote", "get-url", "origin"])
        .ok()
        .filter(|u| !u.is_empty());

    Ok(GitStatusResponse {
        branch,
        is_clean,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        remote_url,
    })
}

pub fn branches(cwd: &str) -> Result<Vec<GitBranch>, String> {
    let output = git(
        cwd,
        &[
            "branch",
            "-a",
            "--format=%(HEAD)|%(refname:short)|%(upstream:short)",
        ],
    )?;

    let mut result = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() < 2 {
            continue;
        }

        let is_current = parts[0] == "*";
        let name = parts[1].to_string();
        let is_remote = name.starts_with("remotes/") || name.contains('/');
        let upstream = parts
            .get(2)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        result.push(GitBranch {
            name,
            is_current,
            is_remote,
            upstream,
        });
    }

    Ok(result)
}

pub fn log(cwd: &str, count: u32) -> Result<Vec<GitLogEntry>, String> {
    let count_str = format!("-{count}");
    let output = git(
        cwd,
        &[
            "log",
            &count_str,
            "--format=%H|%h|%an|%aI|%s",
            "--no-color",
        ],
    )?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() < 5 {
            continue;
        }
        entries.push(GitLogEntry {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            message: parts[4].to_string(),
        });
    }

    Ok(entries)
}

pub fn checkout(cwd: &str, branch: &str, create: bool) -> Result<String, String> {
    if create {
        git(cwd, &["checkout", "-b", branch])
    } else {
        git(cwd, &["checkout", branch])
    }
}

pub fn worktree_list(cwd: &str) -> Result<Vec<GitWorktree>, String> {
    let output = git(cwd, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = Vec::new();
    let mut path = String::new();
    let mut commit = String::new();
    let mut branch: Option<String> = None;
    let mut is_bare = false;

    for line in output.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            path = p.to_string();
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            commit = h[..7.min(h.len())].to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = Some(b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
        } else if line == "bare" {
            is_bare = true;
        } else if line.is_empty() && !path.is_empty() {
            worktrees.push(GitWorktree {
                path: path.clone(),
                branch: branch.take(),
                commit: commit.clone(),
                is_bare,
            });
            path.clear();
            commit.clear();
            is_bare = false;
        }
    }

    if !path.is_empty() {
        worktrees.push(GitWorktree {
            path,
            branch,
            commit,
            is_bare,
        });
    }

    Ok(worktrees)
}

pub fn worktree_add(
    cwd: &str,
    wt_path: &str,
    branch: Option<&str>,
    new_branch: Option<&str>,
) -> Result<String, String> {
    let mut args = vec!["worktree", "add"];

    if let Some(nb) = new_branch {
        args.push("-b");
        args.push(nb);
    }

    args.push(wt_path);

    if let Some(b) = branch {
        args.push(b);
    }

    git(cwd, &args)
}

pub fn worktree_remove(cwd: &str, wt_path: &str, force: bool) -> Result<String, String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(wt_path);
    git(cwd, &args)
}

pub fn diff(cwd: &str, staged: bool) -> Result<GitDiffResponse, String> {
    let diff_output = if staged {
        git(cwd, &["diff", "--cached"])?
    } else {
        git(cwd, &["diff"])?
    };

    let stats_output = if staged {
        git(cwd, &["diff", "--cached", "--stat"]).unwrap_or_default()
    } else {
        git(cwd, &["diff", "--stat"]).unwrap_or_default()
    };

    let numstat = if staged {
        git(cwd, &["diff", "--cached", "--numstat"]).unwrap_or_default()
    } else {
        git(cwd, &["diff", "--numstat"]).unwrap_or_default()
    };
    let files_changed = numstat.lines().filter(|l| !l.is_empty()).count() as u32;

    Ok(GitDiffResponse {
        diff: diff_output,
        stats: stats_output,
        files_changed,
    })
}

pub fn diff_file(cwd: &str, path: &str, staged: bool) -> Result<GitFileDiffResponse, String> {
    let diff_output = if staged {
        git(cwd, &["diff", "--cached", "--", path])?
    } else {
        git(cwd, &["diff", "--", path])?
    };

    Ok(GitFileDiffResponse {
        path: path.to_string(),
        diff: diff_output,
    })
}

pub fn stash_list(cwd: &str) -> Result<Vec<GitStashEntry>, String> {
    let output = git(cwd, &["stash", "list", "--format=%gd|%gs"])?;

    let mut entries = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(2, '|').collect();
        if parts.len() < 2 {
            continue;
        }
        let idx_str = parts[0]
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .unwrap_or("0");
        let index: u32 = idx_str.parse().unwrap_or(0);
        entries.push(GitStashEntry {
            index,
            message: parts[1].to_string(),
        });
    }

    Ok(entries)
}

pub fn stash_push(cwd: &str, message: Option<&str>) -> Result<String, String> {
    let mut args = vec!["stash", "push"];
    if let Some(m) = message {
        args.push("-m");
        args.push(m);
    }
    git(cwd, &args)
}

pub fn stash_apply(cwd: &str, index: u32, pop: bool) -> Result<String, String> {
    let stash_ref = format!("stash@{{{index}}}");
    let cmd = if pop { "pop" } else { "apply" };
    git(cwd, &["stash", cmd, &stash_ref])
}

pub fn stash_drop(cwd: &str, index: u32) -> Result<String, String> {
    let stash_ref = format!("stash@{{{index}}}");
    git(cwd, &["stash", "drop", &stash_ref])
}

pub fn stage(cwd: &str, paths: &[String]) -> Result<String, String> {
    let args: Vec<&str> = std::iter::once("add").chain(paths.iter().map(|s| s.as_str())).collect();
    git(cwd, &args)
}

pub fn unstage(cwd: &str, paths: &[String]) -> Result<String, String> {
    let args: Vec<&str> = std::iter::once("restore")
        .chain(std::iter::once("--staged"))
        .chain(paths.iter().map(|s| s.as_str()))
        .collect();
    git(cwd, &args)
}

pub fn discard(cwd: &str, paths: &[String]) -> Result<String, String> {
    let args: Vec<&str> = std::iter::once("checkout")
        .chain(std::iter::once("--"))
        .chain(paths.iter().map(|s| s.as_str()))
        .collect();
    git(cwd, &args)
}

pub fn commit(cwd: &str, message: &str) -> Result<String, String> {
    git(cwd, &["commit", "-m", message])
}

fn status_char_to_string(c: u8) -> String {
    match c {
        b'M' => "modified".to_string(),
        b'A' => "added".to_string(),
        b'D' => "deleted".to_string(),
        b'R' => "renamed".to_string(),
        b'C' => "copied".to_string(),
        b'U' => "unmerged".to_string(),
        b'T' => "typechange".to_string(),
        _ => format!("{}", c as char),
    }
}
