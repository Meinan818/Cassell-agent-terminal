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
    // Cap preview size. 按字符边界截断：固定字节下标可能落在汉字中间。
    if text.len() > 200_000 {
        Ok(format!(
            "{}…\n（仅预览前 200KB）",
            crate::text::truncate(&text, 200_000)
        ))
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

    // numstat: "<add>\t<del>\t<path>"（二进制用 "-"）。用 -z + quotePath=false
    // 避免 Git 把中文/空格路径做 C 风格引号转义；rename 记录形如
    // "add\tdel\t\0old\0new\0"。
    let numstat = git(
        &workdir,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "HEAD",
            "--numstat",
            "-z",
        ],
    )
    .await
    .unwrap_or_default();
    let mut stats: std::collections::HashMap<String, (u32, u32)> =
        std::collections::HashMap::new();
    let mut stats_known = std::collections::HashSet::new();
    let records: Vec<&str> = numstat.split('\0').collect();
    let mut i = 0;
    while i < records.len() {
        let rec = records[i];
        i += 1;
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let add = a.parse::<u32>().unwrap_or(0);
        let del = d.parse::<u32>().unwrap_or(0);
        let path = if p.is_empty() {
            // rename/copy：下一条是 old，再下一条是 new。
            let _old = records.get(i).copied().unwrap_or("");
            i += 1;
            let new = records.get(i).copied().unwrap_or("");
            i += 1;
            new.to_string()
        } else {
            p.to_string()
        };
        if path.is_empty() {
            continue;
        }
        stats.insert(path.clone(), (add, del));
        if a.parse::<u32>().is_ok() && d.parse::<u32>().is_ok() {
            stats_known.insert(path);
        }
    }
    // status --porcelain -z: "XY <path>\0"；rename 记录后面还有一条 old path。
    let status = git(
        &workdir,
        &[
            "-c",
            "core.quotePath=false",
            "status",
            "--porcelain",
            "-z",
            "--untracked-files=all",
        ],
    )
    .await
    .unwrap_or_default();
    let mut files: Vec<ReviewFile> = vec![];
    let records: Vec<&str> = status.split('\0').collect();
    let mut i = 0;
    while i < records.len() {
        let record = records[i];
        i += 1;
        if record.len() < 4 {
            continue;
        }
        let code = &record[0..2];
        let path = record[3..].to_string();
        if path.is_empty() {
            continue;
        }
        if code.contains('R') || code.contains('C') {
            // rename/copy 的旧路径单独占下一条记录，显示只用新路径。
            i += 1;
        }
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
pub async fn get_file_diff(workdir: String, path: String) -> Result<String, String> {
    if workdir.trim().is_empty() || !Path::new(&workdir).is_dir() {
        return Err("工作区目录不存在".to_string());
    }
    validate_worktree_relative_path(&path)?;
    // 直接以参数传给 git，不经过 cmd /C；否则带引号的相对路径在
    // Windows 上会被 cmd 重新解析，git 可能收到空路径并返回空 diff。
    git(
        &workdir,
        &["-c", "core.quotePath=false", "diff", "HEAD", "--", &path],
    )
    .await
}

#[tauri::command]
pub async fn revert_file(workdir: String, path: String) -> Result<String, String> {
    if workdir.trim().is_empty() || path.trim().is_empty() {
        return Err("参数不完整".to_string());
    }
    validate_worktree_relative_path(&path)?;
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
fn validate_worktree_relative_path(p: &str) -> Result<(), String> {
    if p.trim().is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    let path = Path::new(p);
    if path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::Prefix(_) | std::path::Component::RootDir))
    {
        return Err(format!("只接受工作区内的相对路径：{p}"));
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("路径不能越出工作区：{p}"));
    }
    Ok(())
}

fn validate_commit_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有要提交的文件".to_string());
    }
    for p in paths {
        validate_worktree_relative_path(p)?;
    }
    Ok(())
}

/// 已暂存的 rename 映射：new path -> old path。
/// `git commit --only` 只认命令行里列出的路径；如果只提交新路径，旧路径的
/// 删除会被留在暂存区，导致 HEAD 里旧文件复活。
async fn staged_rename_map(workdir: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let out = git(
        workdir,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--cached",
            "--name-status",
            "-z",
        ],
    )
    .await
    .unwrap_or_default();
    let records: Vec<&str> = out.split('\0').collect();
    let mut i = 0;
    while i < records.len() {
        let rec = records[i];
        i += 1;
        if !rec.starts_with('R') && !rec.starts_with('C') {
            continue;
        }
        let old = records.get(i).copied().unwrap_or("");
        i += 1;
        let new = records.get(i).copied().unwrap_or("");
        i += 1;
        if !new.is_empty() && !old.is_empty() {
            map.insert(new.to_string(), old.to_string());
        }
    }
    map
}

/// 暂存区里所有路径（rename 同时算 old 和 new）。
async fn staged_paths(workdir: &str) -> Vec<String> {
    let out = git(
        workdir,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--cached",
            "--name-status",
            "-z",
        ],
    )
    .await
    .unwrap_or_default();
    let records: Vec<&str> = out.split('\0').collect();
    let mut paths = Vec::new();
    let mut i = 0;
    while i < records.len() {
        let rec = records[i];
        i += 1;
        if rec.is_empty() {
            continue;
        }
        if rec.starts_with('R') || rec.starts_with('C') {
            let old = records.get(i).copied().unwrap_or("");
            i += 1;
            let new = records.get(i).copied().unwrap_or("");
            i += 1;
            if !old.is_empty() {
                paths.push(old.to_string());
            }
            if !new.is_empty() {
                paths.push(new.to_string());
            }
        } else {
            let path = records.get(i).copied().unwrap_or("");
            i += 1;
            if !path.is_empty() {
                paths.push(path.to_string());
            }
        }
    }
    paths
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
    let approved_count = paths.len();
    // rename 的旧路径删除也属于这次提交；先记下映射。
    let renames = staged_rename_map(&workdir).await;
    let mut approved: std::collections::HashSet<String> = paths.iter().cloned().collect();
    for p in &paths {
        if let Some(old) = renames.get(p) {
            approved.insert(old.clone());
        }
    }
    let args: Vec<&str> = paths.iter().map(|p| p.as_str()).collect();
    let mut add_args = vec!["add", "--"];
    add_args.extend(args.iter().copied());
    git(&workdir, &add_args).await?;

    // `git commit --only` 对 rename 的旧路径（工作区已不存在）无法匹配。
    // 改为：确认暂存区里的每一条都属于“已通过的文件 + rename 旧路径”，
    // 然后提交整个暂存区；有其它暂存改动就拒绝并提示用户，绝不悄悄提交。
    let staged = staged_paths(&workdir).await;
    if staged.is_empty() {
        return Err("没有可提交的改动".to_string());
    }
    let extras: Vec<&str> = staged
        .iter()
        .map(|p| p.as_str())
        .filter(|p| !approved.contains(*p))
        .collect();
    if !extras.is_empty() {
        return Err(format!(
            "暂存区还有未通过审查的改动：{}。请先在终端取消暂存（git restore --staged ...）后再提交。",
            extras.join("、")
        ));
    }
    let out = git(&workdir, &["commit", "-m", message.as_str()]).await?;
    let first_line = out.lines().next().unwrap_or("").trim().to_string();
    Ok(if first_line.is_empty() {
        format!("已提交 {} 个文件", approved_count)
    } else {
        format!("已提交 {} 个文件：{}", approved_count, first_line)
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
