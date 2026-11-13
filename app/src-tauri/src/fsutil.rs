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
    /// 文件字节数；目录为 None（P0-11：列表行直接显示大小，不用先预览才知道）。
    pub size: Option<u64>,
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
            let is_dir = ft.is_dir();
            let size = if is_dir {
                None
            } else {
                e.metadata().ok().map(|m| m.len())
            };
            Some(FileEntry {
                name,
                path: e.path().to_string_lossy().to_string(),
                is_dir,
                size,
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

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 图片预览：把文件读成 data URL 交给前端 <img>。
/// 不走 asset 协议——工作区可能在 /tmp 这类应用沙箱外的路径，asset 协议
/// 够不着会 403，前端只能看到一个破图图标。5MB 上限，预览够用了。
#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取 {path}：{e}"))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("图片超过 5MB，暂不支持预览".to_string());
    }
    let mime = match Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", to_base64(&bytes)))
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
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(workdir)
        .stdin(Stdio::null());
    crate::hide_console(&mut cmd);
    let out = cmd
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

/// P0-11 diff 升级：提交已通过的变更（审查队列的提交入口）。
/// 只接受工作区内的相对路径；用 `git add -- <paths>` + `git commit -m`
/// 分两步走，不拼 shell 字符串，避免注入。这是用户在界面上点的显式
/// 操作（和“拒绝→还原”一样），不是 agent 的写操作，不走审批。
fn validate_commit_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有要提交的文件".to_string());
    }
    for p in paths {
        let path = Path::new(p);
        if path.is_absolute() {
            return Err(format!("只接受工作区内的相对路径：{p}"));
        }
        if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(format!("路径不能越出工作区：{p}"));
        }
        if p.trim().is_empty() {
            return Err("文件路径不能为空".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn commit_files(
    workdir: String,
    paths: Vec<String>,
    message: String,
) -> Result<String, String> {
    if workdir.trim().is_empty() || !Path::new(&workdir).is_dir() {
        return Err("工作区目录不存在".to_string());
    }
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("提交信息不能为空".to_string());
    }
    if message.len() > 500 {
        return Err("提交信息太长（最多 500 字符）".to_string());
    }
    validate_commit_paths(&paths)?;
    let args: Vec<&str> = paths.iter().map(|p| p.as_str()).collect();
    let mut add_args = vec!["add", "--"];
    add_args.extend(args.iter().copied());
    git(&workdir, &add_args).await?;
    let out = git(&workdir, &["commit", "-m", &message]).await?;
    let first_line = out.lines().next().unwrap_or("").trim().to_string();
    Ok(if first_line.is_empty() {
        format!("已提交 {} 个文件", paths.len())
    } else {
        format!("已提交 {} 个文件：{}", paths.len(), first_line)
    })
}

#[cfg(test)]
mod tests {
    use super::validate_commit_paths;

    #[test]
    fn commit_paths_reject_escapes() {
        assert!(validate_commit_paths(&[]).is_err());
        assert!(validate_commit_paths(&["../secret.txt".to_string()]).is_err());
        assert!(validate_commit_paths(&["/etc/passwd".to_string()]).is_err());
        assert!(validate_commit_paths(&["".to_string()]).is_err());
        assert!(validate_commit_paths(&["src/App.tsx".to_string()]).is_ok());
        assert!(validate_commit_paths(&["a/b/c.rs".to_string(), "README.md".to_string()]).is_ok());
    }
}
