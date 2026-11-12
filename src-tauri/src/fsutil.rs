//! Filesystem helpers: file listing / preview, and the review queue
//! (driven by real `git status` / `git diff` in the workdir).
//!
//! Review semantics (the user was explicit: nothing may silently vanish):
//! - "Accept" keeps the change and marks the file approved (it stays in
//!   the list with its new state).
//! - "Reject" reverts the file through git and marks it rejected (it also
//!   stays visible, with the revert result shown).
//! - "Accept all" marks every file approved and returns a completion
//!   summary (counts + stats + timestamp) for the UI to display.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn list_files(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = if path.trim().is_empty() {
        std::env::current_dir().map_err(|e| e.to_string())?
    } else {
        Path::new(&path).to_path_buf()
    };
    let mut entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("无法读取目录 {}：{e}", dir.display()))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".gitignore" {
                return None;
            }
            let ft = e.file_type().ok()?;
            Some(FileEntry {
                name,
                path: e.path().to_string_lossy().to_string(),
                is_dir: ft.is_dir(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取 {path}：{e}"))?;
    if bytes.contains(&0) {
        return Err("二进制文件，无法预览".to_string());
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    // Cap preview size.
    if text.len() > 200_000 {
        Ok(format!("{}…\n（仅预览前 200KB）", &text[..200_000]))
    } else {
        Ok(text)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewFile {
    pub path: String,
    /// modified | added | deleted | untracked | renamed
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub stats_known: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewState {
    pub is_git: bool,
    pub files: Vec<ReviewFile>,
    pub additions: u32,
    pub deletions: u32,
}

async fn git(workdir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("无法运行 git：{e}（请确认已安装 Git）"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn get_review(workdir: String) -> Result<ReviewState, String> {
    if workdir.trim().is_empty() || !Path::new(&workdir).is_dir() {
        return Err("工作区目录不存在，请先在设置里选择工作区".to_string());
    }
    // Not a git repo -> no diff-based review available.
    if git(&workdir, &["rev-parse", "--is-inside-work-tree"])
        .await
        .is_err()
    {
        return Ok(ReviewState {
            is_git: false,
            files: vec![],
            additions: 0,
            deletions: 0,
        });
    }

    // numstat: "<add>\t<del>\t<path>" (binary files use "-").
    // HEAD includes both staged and unstaged changes so the review panel does
    // not silently omit files already added to the index.
    let numstat = git(&workdir, &["diff", "HEAD", "--numstat"])
        .await
        .unwrap_or_default();
    let mut stats: std::collections::HashMap<String, (u32, u32)> =
        std::collections::HashMap::new();
    let mut stats_known = std::collections::HashSet::new();
    for line in numstat.lines() {
        let mut parts = line.split('\t');
        if let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) {
            let add = a.parse::<u32>().unwrap_or(0);
            let del = d.parse::<u32>().unwrap_or(0);
            stats.insert(p.to_string(), (add, del));
            if a.parse::<u32>().is_ok() && d.parse::<u32>().is_ok() {
                stats_known.insert(p.to_string());
            }
        }
    }
    // status --porcelain: "XY <path>" (untracked "??", staged "A ", etc.)
    let status = git(&workdir, &["status", "--porcelain"]).await.unwrap_or_default();
    let mut files: Vec<ReviewFile> = vec![];
    for line in status.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[0..2];
        let raw_path = line[3..].trim().to_string();
        // Renames look like "R  old -> new".
        let path = raw_path
            .split(" -> ")
            .last()
            .unwrap_or(&raw_path)
            .to_string();
        let status_str = if code.contains('?') {
            "untracked"
        } else if code.contains('A') {
            "added"
        } else if code.contains('D') {
            "deleted"
        } else if code.contains('R') {
            "renamed"
        } else {
            "modified"
        };
        let (add, del) = stats.get(&path).copied().unwrap_or((0, 0));
        let line_stats_known = code != "??" && stats_known.contains(&path);
        files.push(ReviewFile {
            path,
            status: status_str.to_string(),
            additions: add,
            deletions: del,
            stats_known: line_stats_known,
        });
    }
    let additions = files.iter().map(|f| f.additions).sum();
    let deletions = files.iter().map(|f| f.deletions).sum();
    Ok(ReviewState {
        is_git: true,
        files,
        additions,
        deletions,
    })
}

#[tauri::command]
pub async fn revert_file(workdir: String, path: String) -> Result<String, String> {
    if workdir.trim().is_empty() || path.trim().is_empty() {
        return Err("参数不完整".to_string());
    }
    // Tracked changes restore from HEAD. Untracked and staged new files have
    // no HEAD version, so remove them only after the UI's explicit confirmation.
    let status = git(&workdir, &["status", "--porcelain", "--", &path])
        .await
        .unwrap_or_default();
    let code = status.get(..2).unwrap_or("");
    if code == "??" {
        std::fs::remove_file(Path::new(&workdir).join(&path))
            .map_err(|e| format!("删除未追踪文件失败：{e}"))?;
        Ok(format!("已删除未追踪文件 {path}"))
    } else if code.starts_with('A') {
        git(&workdir, &["rm", "-f", "--", &path]).await?;
        Ok(format!("已删除新增文件 {path}"))
    } else {
        git(&workdir, &["checkout", "HEAD", "--", &path]).await?;
        Ok(format!("已还原 {path} 到 HEAD"))
    }
}
