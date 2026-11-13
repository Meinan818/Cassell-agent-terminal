//! P0-6 Goal 模式 + P0-7 检查点 / 倒带。
//!
//! 设计（对应总结文档 §2.2 X3、§3.2 T12/T15）：
//! - 目标是线程级持久对象：一次立项，引擎在后端自己一轮接一轮跑到底，
//!   中途不问用户要不要继续。8 轮只是内部单回合单位，对外不可见。
//! - 续跑带完整上下文：会话消息（含 tool_calls 与工具结果）存在后端，
//!   续跑直接接着用，模型不用重新读文件找进度——这是旧「继续」按钮
//!   只带文字历史的根本修复。
//! - 防死循环：总轮次预算 + 停滞检测（连续无进展 / 同一调用反复出现）。
//! - 完成要拿证据：改过文件必须验证过（重读改过的文件、或跑验证命令
//!   看到成功退出）才算交付；没验证就宣称完成时，运行时先提醒一次，
//!   再不验证就如实标成“已收尾（未验证）”，绝不假装验证过。
//! - 检查点存在应用数据目录（不在工作区里，不污染用户的项目和 git 状态）：
//!   每回合一个消息快照 + 每次写文件前一份版本化备份；倒带三粒度
//!   （只回对话 / 只回代码 / 两者都回），执行前由用户在界面上确认。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 内部单回合单位：每回合最多 8 轮工具调用。对外不可见，不写进界面文案。
pub const ROUNDS_PER_TURN: u32 = 8;
/// 普通对话的总预算：3 个回合。超了就停，如实告诉用户。
pub const NORMAL_ROUNDS_BUDGET: u32 = 24;
/// 目标模式的总预算：5 个回合。
pub const GOAL_ROUNDS_BUDGET: u32 = 40;
/// 连续这么多轮没有任何进展 → 判定卡住。
pub const STALL_ROUNDS: u32 = 3;
/// 同一个工具调用连续出现这么多次 → 判定在原地打转。
pub const REPEAT_CALLS: usize = 3;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Running,
    Paused,
    Done,
    Stuck,
    Budget,
}

impl GoalStatus {
    pub fn label(&self) -> &'static str {
        match self {
            GoalStatus::Running => "进行中",
            GoalStatus::Paused => "已暂停",
            GoalStatus::Done => "已完成",
            GoalStatus::Stuck => "卡住了",
            GoalStatus::Budget => "到预算上限了",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckItem {
    pub text: String,
    pub done: bool,
}

/// 一个目标的完整会话状态（放后端 RunState 的 goals 表里，按 task id 存）。
/// messages 是权威上下文：含 tool_calls 与工具结果，续跑直接用它。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalSession {
    pub id: String,
    pub text: String,
    pub mode: String,
    pub workdir: String,
    pub messages: Vec<Value>,
    pub status: GoalStatus,
    pub rounds_used: u32,
    pub rounds_budget: u32,
    pub turns_used: u32,
    /// 连续无进展的轮数（到 STALL_ROUNDS 就判卡住）。
    pub stall_rounds: u32,
    /// 最近一次成功写文件的全局轮号（0 = 没写过）。
    pub last_write_round: u32,
    /// 最近一次验证动作的全局轮号（重读改过的文件 / 验证命令退出码 0）。
    pub last_verify_round: u32,
    pub files_changed: Vec<String>,
    /// 读过的文件（算“进展”用：读新文件才算进展）。
    #[serde(default)]
    pub read_paths: HashSet<String>,
    /// 最近的工具调用（name, args 原文），判“同一调用反复出现”用。
    #[serde(default)]
    pub recent_calls: VecDeque<(String, String)>,
    pub checklist: Vec<CheckItem>,
    /// 改过但还没验证过的文件（交付时如实展示）。
    #[serde(default)]
    pub unverified_writes: Vec<String>,
    /// 已经为“没验证就宣称完成”提醒过模型一次。
    #[serde(default)]
    pub verification_nudged: bool,
    pub created_at: u64,
}

impl GoalSession {
    pub fn new(id: String, text: String, mode: String, workdir: String, budget: u32) -> Self {
        GoalSession {
            id,
            text,
            mode,
            workdir,
            messages: Vec::new(),
            status: GoalStatus::Running,
            rounds_used: 0,
            rounds_budget: budget,
            turns_used: 0,
            stall_rounds: 0,
            last_write_round: 0,
            last_verify_round: 0,
            files_changed: Vec::new(),
            read_paths: HashSet::new(),
            recent_calls: VecDeque::new(),
            checklist: Vec::new(),
            unverified_writes: Vec::new(),
            verification_nudged: false,
            created_at: now_secs(),
        }
    }

    /// 改过但还没验证的文件列表（按 last_write/last_verify 轮号算）。
    pub fn refresh_unverified(&mut self) {
        if self.last_write_round > self.last_verify_round {
            let mut v: Vec<String> = self.files_changed.clone();
            v.retain(|_| true);
            self.unverified_writes = v;
        } else {
            self.unverified_writes.clear();
        }
    }

    pub fn summary(&self) -> Value {
        json!({
            "id": self.id,
            "text": self.text,
            "status": format!("{:?}", self.status).to_lowercase(),
            "status_label": self.status.label(),
            "rounds_used": self.rounds_used,
            "rounds_budget": self.rounds_budget,
            "turns_used": self.turns_used,
            "files_changed": self.files_changed,
            "checklist": self.checklist,
            "unverified_writes": self.unverified_writes,
        })
    }
}

/// 一次工具调用算不算“进展”：写文件成功、跑了命令、读了没读过的文件才算。
/// 读同一个文件、列同一个目录不算——模型原地打转时这两项最常见。
/// 失败的结果（未授权、读不到）也不算进展，否则模型会换着文件空读烧预算。
pub fn is_progress(
    session: &GoalSession,
    tool_name: &str,
    args: &Value,
    result: &str,
) -> bool {
    match tool_name {
        "write_file" => result.starts_with("已写入 "),
        "run_shell" => result.contains("[退出码 "),
        "read_file" => {
            if result.starts_with("未授权") || result.starts_with("读取失败") {
                return false;
            }
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            !p.is_empty() && !session.read_paths.contains(p)
        }
        "list_dir" => {
            if result.starts_with("未授权") || result.starts_with("列目录失败") {
                return false;
            }
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            !session.read_paths.contains(&format!("dir:{p}"))
        }
        _ => false,
    }
}

/// 把一轮的工具调用记进会话：更新读过的文件、重复调用检测、写文件记录。
/// 返回本轮有没有进展。
pub fn record_tool_call(
    session: &mut GoalSession,
    tool_name: &str,
    args: &Value,
    result: &str,
) -> bool {
    let progress = is_progress(session, tool_name, args, result);
    match tool_name {
        "read_file" => {
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if !p.is_empty() {
                session.read_paths.insert(p.to_string());
            }
            // 重读改过的文件 = 验证动作。
            if session.files_changed.iter().any(|f| f == p) {
                session.last_verify_round = session.rounds_used;
            }
        }
        "list_dir" => {
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            session.read_paths.insert(format!("dir:{p}"));
        }
        "write_file" => {
            if result.starts_with("已写入 ") {
                let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if !p.is_empty() && !session.files_changed.contains(&p.to_string()) {
                    session.files_changed.push(p.to_string());
                }
                session.last_write_round = session.rounds_used;
            }
        }
        "run_shell" => {
            // 退出码 0 的命令 = 验证动作（跑测试、跑检查都算）。
            if result.contains("[退出码 0]") {
                session.last_verify_round = session.rounds_used;
            }
        }
        _ => {}
    }
    let args_str = args.to_string();
    session.recent_calls.push_back((tool_name.to_string(), args_str));
    while session.recent_calls.len() > REPEAT_CALLS {
        session.recent_calls.pop_front();
    }
    session.refresh_unverified();
    progress
}

/// 同一个工具调用（含参数）连续出现 REPEAT_CALLS 次 → 原地打转。
pub fn is_repeating(session: &GoalSession) -> bool {
    if session.recent_calls.len() < REPEAT_CALLS {
        return false;
    }
    let first = &session.recent_calls[0];
    session.recent_calls.iter().all(|c| c == first)
}

/// 从一轮的正文里解析“目标清单”块（模型按目标提示词在首轮列出）。
/// 找不到就返回空——没有清单就不显示，绝不编一个假的。
pub fn parse_checklist(text: &str) -> Vec<CheckItem> {
    let mut items = Vec::new();
    let mut in_block = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("## ") && t.contains("目标清单") {
            in_block = true;
            continue;
        }
        if in_block && t.starts_with("## ") {
            break;
        }
        if !in_block {
            continue;
        }
        if let Some(rest) = t.strip_prefix("- [ ]").or_else(|| t.strip_prefix("- [x]").or_else(|| t.strip_prefix("- [X]"))) {
            let done = !t.starts_with("- [ ]");
            let item = rest.trim().to_string();
            if !item.is_empty() {
                items.push(CheckItem { text: item, done });
            }
        }
    }
    items
}

// ---------------------------------------------------------------------------
// 检查点：磁盘布局（应用数据目录，不进工作区，不污染项目与 git 状态）
//   <app_data>/checkpoints/<goal_id>/turn-000.json   每回合的消息快照
//   <app_data>/checkpoints/<goal_id>/manifest.json   每次写文件前的备份清单
//   <app_data>/checkpoints/<goal_id>/files/<turn>-<seq>-<path>  备份内容
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointMeta {
    pub turn: u32,
    pub summary: String,
    pub files_changed: Vec<String>,
    pub rounds_used: u32,
    pub created_at: u64,
    /// 写这个检查点时的工作区（应用重启后会话不在内存里，倒带靠它找目录）。
    #[serde(default)]
    pub workdir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBackup {
    pub path: String,
    /// 备份文件名；None = 写之前文件不存在（倒带时要删掉它）。
    pub backup: Option<String>,
    pub existed: bool,
    pub turn: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CheckpointManifest {
    pub goal_id: String,
    #[serde(default)]
    pub writes: Vec<FileBackup>,
}

pub fn checkpoints_dir(app: &AppHandle, goal_id: &str) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cassell-agent"));
    base.join("checkpoints").join(sanitize_id(goal_id))
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn sanitize_path(rel: &str) -> String {
    rel.replace(['/', '\\'], "__")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn manifest_path(app: &AppHandle, goal_id: &str) -> PathBuf {
    checkpoints_dir(app, goal_id).join("manifest.json")
}

fn load_manifest(app: &AppHandle, goal_id: &str) -> CheckpointManifest {
    let p = manifest_path(app, goal_id);
    match std::fs::read_to_string(&p) {
        Ok(t) => serde_json::from_str(&t).unwrap_or(CheckpointManifest {
            goal_id: goal_id.to_string(),
            writes: Vec::new(),
        }),
        Err(_) => CheckpointManifest {
            goal_id: goal_id.to_string(),
            writes: Vec::new(),
        },
    }
}

fn save_manifest(app: &AppHandle, manifest: &CheckpointManifest) -> Result<(), String> {
    let dir = checkpoints_dir(app, &manifest.goal_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建检查点目录失败：{e}"))?;
    let text = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path(app, &manifest.goal_id), text)
        .map_err(|e| format!("写检查点清单失败：{e}"))?;
    Ok(())
}

/// 写文件之前先备份：只在目标模式下调，每次写都留一份版本化备份。
/// 目标是：倒带回第 N 回合时，代码能恢复到第 N 回合结束时的样子。
pub fn backup_before_write(
    app: &AppHandle,
    goal_id: &str,
    workdir: &str,
    rel: &str,
    turn: u32,
) -> Result<(), String> {
    let dir = checkpoints_dir(app, goal_id);
    let files_dir = dir.join("files");
    std::fs::create_dir_all(&files_dir).map_err(|e| format!("建备份目录失败：{e}"))?;
    let mut manifest = load_manifest(app, goal_id);
    let seq = manifest.writes.len();
    let target = Path::new(workdir).join(rel);
    let (backup, existed) = match std::fs::read(&target) {
        Ok(bytes) => {
            let name = format!("{turn:03}-{seq:03}-{}", sanitize_path(rel));
            std::fs::write(files_dir.join(&name), bytes)
                .map_err(|e| format!("写备份失败：{e}"))?;
            (Some(name), true)
        }
        Err(_) => (None, false),
    };
    manifest.writes.push(FileBackup {
        path: rel.to_string(),
        backup,
        existed,
        turn,
    });
    save_manifest(app, &manifest)
}

/// 每回合结束写一个检查点：消息快照 + 摘要。
pub fn write_checkpoint(
    app: &AppHandle,
    session: &GoalSession,
    summary: &str,
) -> Result<CheckpointMeta, String> {
    let dir = checkpoints_dir(app, &session.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建检查点目录失败：{e}"))?;
    let meta = CheckpointMeta {
        turn: session.turns_used,
        summary: summary.chars().take(120).collect(),
        files_changed: session.files_changed.clone(),
        rounds_used: session.rounds_used,
        created_at: now_secs(),
        workdir: session.workdir.clone(),
    };
    let payload = json!({ "meta": meta, "messages": session.messages });
    let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("turn-{:03}.json", meta.turn)), text)
        .map_err(|e| format!("写检查点失败：{e}"))?;
    Ok(meta)
}

pub fn list_checkpoints(app: &AppHandle, goal_id: &str) -> Result<Vec<CheckpointMeta>, String> {
    let dir = checkpoints_dir(app, goal_id);
    let mut out: Vec<CheckpointMeta> = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("turn-") || !name.ends_with(".json") {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(entry.path()) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Ok(meta) =
                    serde_json::from_value::<CheckpointMeta>(v.get("meta").cloned().unwrap_or(json!({})))
                {
                    out.push(meta);
                }
            }
        }
    }
    out.sort_by_key(|m| m.turn);
    Ok(out)
}

fn load_checkpoint_messages(
    app: &AppHandle,
    goal_id: &str,
    turn: u32,
) -> Result<Vec<Value>, String> {
    let p = checkpoints_dir(app, goal_id).join(format!("turn-{turn:03}.json"));
    let text = std::fs::read_to_string(&p).map_err(|_| format!("找不到第 {turn} 回合的检查点"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("检查点损坏：{e}"))?;
    v.get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .ok_or_else(|| "检查点里没有消息快照".to_string())
}

/// 倒带回第 N 回合时的代码状态：对每个被改过的文件，取第 N 回合之后
/// 第一次写之前的备份（那份备份就是第 N 回合结束时的内容）；之后新建
/// 的文件（写之前不存在）删掉；第 N 回合之后没动过的文件保持原样。
/// 返回实际恢复/删除的文件列表。
pub fn rewind_code(app: &AppHandle, goal_id: &str, workdir: &str, turn: u32) -> Result<Vec<String>, String> {
    let manifest = load_manifest(app, goal_id);
    let mut by_path: HashMap<String, Vec<&FileBackup>> = HashMap::new();
    for w in &manifest.writes {
        by_path.entry(w.path.clone()).or_default().push(w);
    }
    let mut restored: Vec<String> = Vec::new();
    for (path, writes) in by_path.iter() {
        let mut sorted: Vec<&&FileBackup> = writes.iter().collect();
        sorted.sort_by_key(|w| w.turn);
        let Some(first_after) = sorted.iter().find(|w| w.turn > turn) else {
            continue;
        };
        let target = Path::new(workdir).join(path);
        match &first_after.backup {
            Some(name) => {
                let src = checkpoints_dir(app, goal_id).join("files").join(name);
                let bytes = std::fs::read(&src).map_err(|e| format!("读备份失败 {path}：{e}"))?;
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(&target, bytes).map_err(|e| format!("恢复文件失败 {path}：{e}"))?;
                restored.push(format!("{path}（恢复到第 {turn} 回合）"));
            }
            None => {
                // 写之前不存在 = 第 N 回合之后新建的，删掉。
                let _ = std::fs::remove_file(&target);
                restored.push(format!("{path}（第 {turn} 回合后新建的，已删除）"));
            }
        }
    }
    restored.sort();
    Ok(restored)
}

/// 快照消息转界面能显示的对话：只留用户消息和有文字的助手消息，
/// 按顺序排；工具调用与工具结果不进界面（它们是执行细节）。
/// 返回 (role, text) 列表。
pub fn transcript_of(messages: &[Value]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "system" || role == "tool" {
            continue;
        }
        let text = match m.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(_) => continue,
            None => continue,
        };
        if role == "assistant" && text.trim().is_empty() {
            continue;
        }
        if role != "user" && role != "assistant" {
            continue;
        }
        out.push((role.to_string(), text));
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri 命令
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptMsg {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewindResult {
    pub restored_files: Vec<String>,
    pub transcript: Vec<TranscriptMsg>,
    pub goal: Option<Value>,
}

#[tauri::command]
pub fn list_checkpoints_cmd(app: AppHandle, goal_id: String) -> Result<Vec<CheckpointMeta>, String> {
    list_checkpoints(&app, &goal_id)
}

#[tauri::command]
pub async fn rewind_checkpoint_cmd(
    app: AppHandle,
    state: tauri::State<'_, crate::codex::RunState>,
    goal_id: String,
    turn: u32,
    scope: String,
    // 应用重启后会话不在内存里时，靠这三个参数重建会话（前端从任务与设置里取）。
    goal_text: Option<String>,
    mode: Option<String>,
    workdir: Option<String>,
) -> Result<RewindResult, String> {
    // 工作区解析顺序：内存会话 > 前端传来的当前工作区 > 检查点元数据。
    let session_workdir = {
        let map = state.goals.lock().await;
        map.get(&goal_id).map(|s| s.workdir.clone())
    };
    let meta_workdir = list_checkpoints(&app, &goal_id).ok().and_then(|metas| {
        metas.iter().find_map(|m| {
            if m.workdir.is_empty() {
                None
            } else {
                Some(m.workdir.clone())
            }
        })
    });
    let workdir = session_workdir
        .or(workdir)
        .or(meta_workdir)
        .filter(|w| !w.trim().is_empty())
        .ok_or_else(|| {
            "找不到这个目标的工作区（会话不在内存里，检查点里也没有）。先打开这个目标所在的任务再倒带。".to_string()
        })?;
    let mut restored_files: Vec<String> = Vec::new();
    let mut transcript: Vec<TranscriptMsg> = Vec::new();
    let mut goal_summary: Option<Value> = None;
    if scope == "code" || scope == "both" {
        restored_files = rewind_code(&app, &goal_id, &workdir, turn)?;
    }
    if scope == "conversation" || scope == "both" {
        let messages = load_checkpoint_messages(&app, &goal_id, turn)?;
        transcript = transcript_of(&messages)
            .into_iter()
            .map(|(role, text)| TranscriptMsg { role, text })
            .collect();
        // 会话消息回到快照点：之后续跑从这里接着来，不是从旧的终点。
        // 会话不在内存里（应用重启过）就按快照重建一个（状态为已暂停）。
        let mut map = state.goals.lock().await;
        if !map.contains_key(&goal_id) {
            let fresh = GoalSession::new(
                goal_id.clone(),
                goal_text.clone().unwrap_or_default(),
                mode.clone().unwrap_or_else(|| "eva".to_string()),
                workdir.clone(),
                GOAL_ROUNDS_BUDGET,
            );
            map.insert(goal_id.clone(), fresh);
        }
        if let Some(session) = map.get_mut(&goal_id) {
            session.messages = messages;
            session.turns_used = turn;
            session.status = GoalStatus::Paused;
            // 轮数与文件记录回到快照点对应的值。
            if let Ok(metas) = list_checkpoints(&app, &goal_id) {
                if let Some(meta) = metas.iter().find(|m| m.turn == turn) {
                    session.rounds_used = meta.rounds_used;
                    session.files_changed = meta.files_changed.clone();
                }
            }
            session.refresh_unverified();
            goal_summary = Some(session.summary());
        }
    }
    Ok(RewindResult {
        restored_files,
        transcript,
        goal: goal_summary,
    })
}

#[tauri::command]
pub async fn clear_goal_cmd(
    _app: AppHandle,
    state: tauri::State<'_, crate::codex::RunState>,
    goal_id: String,
) -> Result<(), String> {
    let mut map = state.goals.lock().await;
    map.remove(&goal_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checklist_parses_items() {
        let text = "先说计划：\n## 目标清单\n- [ ] 把四个文件的 VERSION 改成 2\n- [x] 读 start.txt 摸清链条\n- [ ] 跑 grep 检查并汇报\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 3);
        assert!(!items[0].done);
        assert!(items[1].done);
        assert_eq!(items[2].text, "跑 grep 检查并汇报");
    }

    #[test]
    fn checklist_missing_is_empty_not_fake() {
        assert!(parse_checklist("没有清单，就是普通回复。").is_empty());
    }

    #[test]
    fn repeat_call_detected() {
        let mut s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        for _ in 0..2 {
            record_tool_call(&mut s, "read_file", &json!({"path": "a.txt"}), "内容");
        }
        assert!(!is_repeating(&s));
        record_tool_call(&mut s, "read_file", &json!({"path": "a.txt"}), "内容");
        assert!(is_repeating(&s));
    }

    #[test]
    fn progress_only_for_new_reads() {
        let mut s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        assert!(record_tool_call(&mut s, "read_file", &json!({"path": "a.txt"}), "内容"));
        assert!(!record_tool_call(&mut s, "read_file", &json!({"path": "a.txt"}), "内容"));
        assert!(record_tool_call(&mut s, "write_file", &json!({"path": "b.txt"}), "已写入 b.txt（10 字节）"));
        assert!(record_tool_call(&mut s, "run_shell", &json!({"command": "grep x"}), "ok\n[退出码 0]"));
    }

    #[test]
    fn transcript_drops_system_and_tools() {
        let messages = vec![
            json!({"role": "system", "content": "你是 EVA"}),
            json!({"role": "user", "content": "改 VERSION"}),
            json!({"role": "assistant", "content": null, "tool_calls": [{"id": "1"}]}),
            json!({"role": "tool", "tool_call_id": "1", "content": "ok"}),
            json!({"role": "assistant", "content": "改完了两个"}),
        ];
        let t = transcript_of(&messages);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0], ("user".to_string(), "改 VERSION".to_string()));
        assert_eq!(t[1], ("assistant".to_string(), "改完了两个".to_string()));
    }
}
