//! Append-only run journal.
//!
//! This is the local equivalent of Codex rollouts, Claude session transcripts
//! and Tianshu session persistence: a small, inspectable trace of what the
//! engine actually did. It deliberately stores metadata and redacted argument
//! summaries, never API keys or full file contents.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
static SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEventKind {
    RunStarted {
        model: String,
        provider_id: String,
        mode: String,
        run_mode: String,
    },
    RoundStarted {
        round: u32,
    },
    ToolStarted {
        name: String,
        args: Value,
    },
    ToolFinished {
        name: String,
        output_chars: usize,
        duration_ms: u64,
    },
    ApprovalRequested {
        id: String,
        kind: String,
        label: String,
    },
    ApprovalResolved {
        id: String,
        allow: bool,
    },
    RetryScheduled {
        attempt: u32,
        status: Option<u16>,
        delay_ms: u64,
    },
    RunFinished {
        success: bool,
        cancelled: bool,
        stop_reason: String,
        prompt_tokens: Option<u64>,
        completion_tokens: Option<u64>,
    },
    RunFailed {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRecord {
    pub seq: u64,
    pub ts_ms: u64,
    pub task_id: String,
    pub event: EngineEventKind,
}

/// Keep a task id safe to use as a file name. Task ids come from the UI, so
/// never concatenate them into a path without this step.
pub fn sanitize_id(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len().min(80));
    for c in raw.chars().take(80) {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    if out.trim_matches('.').is_empty() {
        "default".to_string()
    } else {
        out
    }
}

/// Keep the journal useful without writing user content or credentials.
pub fn summarize_args(args: &Value) -> Value {
    let Some(obj) = args.as_object() else {
        return Value::Null;
    };
    let mut out = Map::new();
    for (key, value) in obj {
        let safe = if key.eq_ignore_ascii_case("content")
            || key.eq_ignore_ascii_case("api_key")
            || key.eq_ignore_ascii_case("token")
        {
            Value::String("<omitted>".to_string())
        } else if let Some(s) = value.as_str() {
            let mut short: String = s.chars().take(240).collect();
            if s.chars().count() > 240 {
                short.push('…');
            }
            Value::String(short)
        } else {
            value.clone()
        };
        out.insert(key.clone(), safe);
    }
    Value::Object(out)
}

fn journal_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cassell-agent"))
        .join("engine-journal")
}

fn journal_path(app: &AppHandle, task_id: &str) -> PathBuf {
    journal_dir(app).join(format!("task-{}.jsonl", sanitize_id(task_id)))
}

/// Best-effort append. A full disk or permission error must never fail a run.
pub fn append(app: &AppHandle, task_id: &str, event: EngineEventKind) -> Result<(), String> {
    let path = journal_path(app, task_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _guard = WRITE_LOCK.lock().map_err(|_| "journal lock poisoned")?;
    let record = EngineRecord {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        ts_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        task_id: task_id.to_string(),
        event,
    };
    let line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

/// Read the last `limit` records for a task. Invalid/partial lines are skipped
/// so a process crash during a write does not make the whole journal unreadable.
pub fn read(app: &AppHandle, task_id: &str, limit: usize) -> Result<Vec<EngineRecord>, String> {
    let path = journal_path(app, task_id);
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let take = limit.clamp(1, 500);
    let mut records: Vec<EngineRecord> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if records.len() > take {
        records.drain(..records.len() - take);
    }
    Ok(records)
}

#[tauri::command]
pub async fn read_engine_journal(
    app: AppHandle,
    task_id: String,
    limit: Option<usize>,
) -> Result<Vec<EngineRecord>, String> {
    read(&app, &task_id, limit.unwrap_or(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_id_cannot_escape_directory() {
        assert_eq!(sanitize_id("../x"), "___x");
        assert_eq!(sanitize_id("a/b"), "a_b");
        assert_eq!(sanitize_id(""), "default");
        assert_eq!(sanitize_id("..."), "___");
    }

    #[test]
    fn args_redact_content_and_truncate() {
        let long = "中".repeat(300);
        let args = serde_json::json!({
            "path": "a.txt",
            "content": "secret body",
            "command": long
        });
        let safe = summarize_args(&args);
        assert_eq!(safe["content"], "<omitted>");
        assert_eq!(safe["path"], "a.txt");
        assert!(safe["command"].as_str().unwrap().chars().count() <= 241);
        assert!(safe["command"].as_str().unwrap().ends_with('…'));
    }
}
