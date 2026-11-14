//! Durable goal sessions.
//!
//! The in-memory `RunState.goals` map is only a cache. A completed/paused goal
//! must survive an app restart, otherwise "继续跑" silently starts a fresh
//! conversation. This module stores the latest `GoalSession` (messages,
//! checklist, frozen prefix, counters) as JSON in the app data directory.
//!
//! This is deliberately the smallest useful step toward a full event log:
//! append-only event sourcing can come later without changing the public
//! `save/load/delete` surface.

use crate::goal::GoalSession;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?
        .join("sessions");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建会话目录失败：{e}"))?;
    let safe = crate::engine::journal::sanitize_id(id);
    Ok(dir.join(format!("{safe}.json")))
}

pub fn save_goal(app: &AppHandle, session: &GoalSession) -> Result<(), String> {
    let path = session_path(app, &session.id)?;
    let text = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("写会话失败：{e}"))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("替换会话失败：{e}"));
    }
    Ok(())
}

pub fn load_goal(app: &AppHandle, id: &str) -> Option<GoalSession> {
    let path = session_path(app, id).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn delete_goal(app: &AppHandle, id: &str) {
    if let Ok(path) = session_path(app, id) {
        let _ = std::fs::remove_file(path);
    }
}

/// Persist messages removed by context compaction. This is the "archive
/// before compact" half of the contract: the active context may shrink, but
/// the original content remains on disk for audit/recovery.
pub fn archive_messages(
    app: &AppHandle,
    id: &str,
    messages: &[serde_json::Value],
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?
        .join("sessions")
        .join("archive");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建归档目录失败：{e}"))?;
    let safe = crate::engine::journal::sanitize_id(id);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{safe}-{ts}.json"));
    let text = serde_json::to_string_pretty(messages).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("写上下文归档失败：{e}"))
}
