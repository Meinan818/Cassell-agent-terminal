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
/// 清单门提醒上限：文本轮结束时清单还没做完，最多提醒模型这么多次
/// “继续做，别停”；超过就判卡住（Stuck），不再假装做完了。
/// 上限外的终极兜底仍是 40 轮总预算与停滞检测。
pub const CHECKLIST_NUDGE_MAX: u32 = 2;

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
    /// 已经为“清单没做完就想结束”提醒过模型几次（到
    /// CHECKLIST_NUDGE_MAX 就判卡住，不再无限提醒）。
    #[serde(default)]
    pub checklist_nudged: u32,
    /// P0-1 冻结前缀（system 正文 + 工具定义表，会话内字节稳定）。
    /// 目标会话创建时建好并写进 frozen.json；续跑、倒带、应用重启后
    /// 读回来复用（hash 对上才用），会话中途改显示名/人设不改它——
    /// 冻结的就是冻结的，新会话才按新输入重建。
    #[serde(default)]
    pub frozen: Option<crate::frozen::FrozenPrefix>,
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
            checklist_nudged: 0,
            frozen: None,
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
        "edit_file" => result.starts_with("已编辑 "),
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
        "write_file" | "edit_file" => {
            let ok = result.starts_with("已写入 ") || result.starts_with("已编辑 ");
            if ok {
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

/// 列表项的写法种类：同一份清单只用一种写法；空行后写法变了就是新一段。
#[derive(Clone, Copy, PartialEq, Eq)]
enum ListKind {
    Checkbox,
    Dash,
    Star,
    Numbered,
}

fn is_numbered(t: &str) -> bool {
    if let Some(dot) = t.find(|c| c == '.' || c == ')') {
        let (num, rest) = t.split_at(dot);
        !num.is_empty()
            && num.chars().all(|c| c.is_ascii_digit())
            && rest.len() > 1
            && rest.as_bytes()[1] == b' '
    } else {
        false
    }
}

fn list_kind(t: &str) -> Option<ListKind> {
    if t.starts_with("- [ ]") || t.starts_with("- [x]") || t.starts_with("- [X]") {
        Some(ListKind::Checkbox)
    } else if t.starts_with("- ") {
        Some(ListKind::Dash)
    } else if t.starts_with("* ") {
        Some(ListKind::Star)
    } else if is_numbered(t) {
        Some(ListKind::Numbered)
    } else {
        None
    }
}

/// 一行是不是清单项的形状：- [ ] / - [x]、- 文本、* 文本、1. 文本。
fn is_list_line(t: &str) -> bool {
    list_kind(t).is_some()
}

/// 把一行清单项解析成 CheckItem；空项返回 None（不成项、不撑数）。
fn parse_checklist_line(t: &str) -> Option<CheckItem> {
    // - [ ] / - [x] 复选框。
    if let Some(rest) = t
        .strip_prefix("- [ ]")
        .or_else(|| t.strip_prefix("- [x]").or_else(|| t.strip_prefix("- [X]")))
    {
        let done = !t.starts_with("- [ ]");
        let item = rest.trim().to_string();
        return if item.is_empty() {
            None
        } else {
            Some(CheckItem { text: item, done })
        };
    }
    // - 文本 / * 文本（无复选框，未完成）。
    if let Some(rest) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
        let item = rest.trim().to_string();
        return if item.is_empty() {
            None
        } else {
            Some(CheckItem { text: item, done: false })
        };
    }
    // 1. 文本 / 1) 文本（数字列表，未完成）。
    if is_numbered(t) {
        if let Some(dot) = t.find(|c| c == '.' || c == ')') {
            let item = t[dot + 2..].trim().to_string();
            return if item.is_empty() {
                None
            } else {
                Some(CheckItem { text: item, done: false })
            };
        }
    }
    None
}

/// 从一轮的正文里解析“目标清单”块（模型按目标提示词在首轮列出）。
/// 找不到就返回空——没有清单就不显示，绝不编一个假的。
/// 接受的写法：- [ ] / - [x]（首选）、- 文本、* 文本、1. 文本——
/// 模型常写数字列表（实测任务 1 就是 1. 2. 3.），只认复选框会漏掉。
///
/// 清单块到哪结束：第一个非空、非列表项的行就是块尾（“路专员，做完了”
/// 之类的汇报正文、“**验证结果**”小节都到此为止）。旧实现只认 "## "
/// 标题才停，结果最终汇报里的“**验证结果** + 数字列表”被当成清单项
/// 吞进来（实测：清单 4/8 项、4 项“没做完”，活干完了还被判卡住）。
/// 空行本身不结束块——往后看一眼：下一行非空内容还是同种写法的列表项
/// 就继续（行距不算数）；写法变了（复选框清单后跟数字列表）或不是列表
/// 项，就是新一段，到此为止。
pub fn parse_checklist(text: &str) -> Vec<CheckItem> {
    let lines: Vec<&str> = text.lines().collect();
    let mut items = Vec::new();
    let mut in_block = false;
    let mut kind: Option<ListKind> = None;
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if !in_block {
            if t.starts_with("## ") && t.contains("目标清单") {
                in_block = true;
            }
            i += 1;
            continue;
        }
        if t.starts_with("## ") {
            break;
        }
        if t.is_empty() {
            // 空行：看下一行非空内容——还是同种写法的列表项就继续，
            // 写法变了或不是列表项就结束。
            let mut j = i + 1;
            while j < lines.len() && lines[j].trim().is_empty() {
                j += 1;
            }
            if j >= lines.len() {
                break;
            }
            let nt = lines[j].trim();
            let resumes = match kind {
                None => is_list_line(nt),
                Some(k) => list_kind(nt) == Some(k),
            };
            if nt.starts_with("## ") || !resumes {
                break;
            }
            i += 1;
            continue;
        }
        if !is_list_line(t) {
            break;
        }
        if kind.is_none() {
            kind = list_kind(t);
        }
        if let Some(item) = parse_checklist_line(t) {
            items.push(item);
        }
        i += 1;
    }
    items
}

/// 从一组消息里重算目标清单：取助手消息里最后一次出现的“## 目标清单”块。
/// 倒带时用：清单要跟着对话一起回到快照点当时的样子，不能留着未来回合的打勾状态。
/// 恢复后的对话里找不到清单块就返回空——没有清单就不显示，绝不编一个假的。
pub fn checklist_of(messages: &[Value]) -> Vec<CheckItem> {
    for m in messages.iter().rev() {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role != "assistant" {
            continue;
        }
        let text = match m.get("content") {
            Some(Value::String(s)) => s,
            _ => continue,
        };
        let items = parse_checklist(text);
        if !items.is_empty() {
            return items;
        }
    }
    Vec::new()
}

/// 交付门第二道：清单门。文本轮结束、要判 Done 之前，先看清单。
///
/// 背景（DSML_DROP 实测）：网关直接丢掉首轮全部 tool_calls 时，模型只回
/// 一句“收到、先看现场”就结束；旧交付门只查“改过没验证的文件”，丢调用
/// 时什么都没写、列表为空，于是 1/40 轮、清单 0/3 就判 Done——干一半就
/// 停，还假装做完了。清单门补的就是这一刀。
///
/// - 清单有未完成项 → 还没做完，不许 Done。
/// - 清单为空、且从没改过文件、没读过文件、本次调用里也没调过工具 →
///   目标根本没开始（只说了一声收到），不许 Done。
/// - 其余情况（清单全打勾；或没清单但确实干过活——改过文件/读过文件）
///   → 放行。
///
/// `tools_run_so_far` 是本次调用至今跑过的工具（外层循环累积的）：
/// 只要跑过任何工具，目标就算开始了。
///
/// 返回 Nudge(提醒文案) 时调用方把文案以 user 角色发给模型再续跑；
/// 提醒到上限还没动静时返回 Stuck(原因)，调用方判卡住、如实告诉用户，
/// 绝不判 Done。
pub enum ChecklistGate {
    Pass,
    Nudge(String),
    Stuck(String),
}

pub fn checklist_gate(session: &GoalSession, tools_run_so_far: &[String]) -> ChecklistGate {
    let undone: Vec<&CheckItem> = session.checklist.iter().filter(|i| !i.done).collect();
    let never_started = session.checklist.is_empty()
        && session.files_changed.is_empty()
        && session.read_paths.is_empty()
        && tools_run_so_far.is_empty();
    if undone.is_empty() && !never_started {
        return ChecklistGate::Pass;
    }
    if session.checklist_nudged >= CHECKLIST_NUDGE_MAX {
        let reason = if never_started {
            format!(
                "目标还没开始动手（没有清单、没读过文件、没改过文件），提醒了 {CHECKLIST_NUDGE_MAX} 次还是只回文字不干活，我先停下来了。再发一次消息让我重新试，或看一眼是不是网关把工具调用弄丢了。"
            )
        } else {
            let names: Vec<&str> = undone.iter().take(3).map(|i| i.text.as_str()).collect();
            format!(
                "目标清单还有 {} 项没做完（{}），提醒了 {CHECKLIST_NUDGE_MAX} 次还是只回文字不干活，我先停下来了。看一眼做到哪了、给点提示，我再接着做。",
                undone.len(),
                names.join("、")
            )
        };
        return ChecklistGate::Stuck(reason);
    }
    if never_started {
        ChecklistGate::Nudge(
            "（系统提醒：你刚才只说了一声收到，还没开始动手。按目标要求先列出“目标清单”（## 目标清单，2–5 条，每条用“- [ ] ”开头），然后立刻开始读文件、改文件，不要只回文字。）"
                .to_string(),
        )
    } else {
        let names: Vec<&str> = undone.iter().take(3).map(|i| i.text.as_str()).collect();
        ChecklistGate::Nudge(format!(
            "（系统提醒：目标清单还有 {} 项没做完：{}。别停，继续把它们做完；做完一项就把清单里那一项改成“- [x] ”，最后附上打勾后的完整清单再汇报。）",
            undone.len(),
            names.join("、")
        ))
    }
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

/// 工作区快照里的单个文件（相对路径 + 大小 + 内容哈希）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotFile {
    pub path: String,
    pub size: u64,
    pub hash: u64,
}

/// 一回合结束时的工作区快照清单。快照存在 `snap/<turn:03>/`（文件按相对
/// 路径原样放），清单在 `snap/<turn:03>.json`。
/// 快照是倒带的主力：模型用 `run_shell`（sed、echo >、tee…）改文件时，
/// 写前备份根本看不到，只有快照能兜住。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotManifest {
    pub turn: u32,
    pub files: Vec<SnapshotFile>,
    /// 拍满了才算完整；超上限被截断时为 false，倒带只恢复、不删文件。
    pub complete: bool,
}

/// 快照上限：单个文件 1MB、最多 2000 个文件、总共 50MB。超了就截断
/// （清单标 complete=false），不让大项目把磁盘撑爆。
const SNAP_MAX_FILE_BYTES: u64 = 1_048_576;
const SNAP_MAX_FILES: usize = 2000;
const SNAP_MAX_TOTAL_BYTES: u64 = 50_000_000;
/// 快照跳过的目录（依赖与构建产物，倒带不该碰它们）。
const SNAP_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    ".cache",
    ".idea",
    ".vscode",
];

/// 这条相对路径要不要进快照：跳过重型目录与隐藏目录（.cache 这类），
/// 隐藏文件本身（如 .gitignore）照常进。
fn snap_wanted(rel: &Path, is_dir: bool) -> bool {
    for c in rel.components() {
        let s = c.as_os_str().to_string_lossy();
        if SNAP_SKIP_DIRS.contains(&s.as_ref()) {
            return false;
        }
        if is_dir && s.starts_with('.') {
            return false;
        }
    }
    true
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

fn snap_dir(app: &AppHandle, goal_id: &str, turn: u32) -> PathBuf {
    checkpoints_dir(app, goal_id)
        .join("snap")
        .join(format!("{turn:03}"))
}

fn snap_manifest_path(app: &AppHandle, goal_id: &str, turn: u32) -> PathBuf {
    checkpoints_dir(app, goal_id)
        .join("snap")
        .join(format!("{turn:03}.json"))
}

/// 清掉一个目标的全部检查点（另起新目标时，旧目标的快照不能混进来）。
pub fn clear_checkpoints(app: &AppHandle, goal_id: &str) {
    let _ = std::fs::remove_dir_all(checkpoints_dir(app, goal_id));
}

/// 给工作区拍一张快照（turn 0 = 目标开始前的基线，turn N = 第 N 回合结束时）。
/// 返回清单；拍的过程中出错不致命（调用方记日志、继续跑），倒带时没有
/// 快照就回退到写前备份的老办法。
pub fn snapshot_workdir(
    app: &AppHandle,
    goal_id: &str,
    turn: u32,
    workdir: &str,
) -> Result<SnapshotManifest, String> {
    let root = Path::new(workdir);
    let out_dir = snap_dir(app, goal_id, turn);
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("建快照目录失败：{e}"))?;
    let mut files: Vec<SnapshotFile> = Vec::new();
    let mut total: u64 = 0;
    let mut complete = true;
    // 手写递归走目录（不用 walkdir 依赖）：先目录后文件，顺序稳定。
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        entries.sort();
        for path in entries {
            let rel = match path.strip_prefix(root) {
                Ok(r) => r.to_path_buf(),
                Err(_) => continue,
            };
            let md = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.file_type().is_symlink() {
                continue;
            }
            if md.is_dir() {
                if snap_wanted(&rel, true) {
                    stack.push(path);
                }
                continue;
            }
            if !md.is_file() || !snap_wanted(&rel, false) {
                continue;
            }
            if md.len() > SNAP_MAX_FILE_BYTES {
                complete = false;
                continue;
            }
            if files.len() >= SNAP_MAX_FILES || total + md.len() > SNAP_MAX_TOTAL_BYTES {
                complete = false;
                continue;
            }
            let bytes = match std::fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let dest = out_dir.join(&rel);
            if let Some(parent) = dest.parent() {
                if std::fs::create_dir_all(parent).is_err() {
                    continue;
                }
            }
            if std::fs::write(&dest, &bytes).is_err() {
                continue;
            }
            total += md.len();
            files.push(SnapshotFile {
                path: rel.to_string_lossy().replace('\\', "/"),
                size: md.len(),
                hash: hash_bytes(&bytes),
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let manifest = SnapshotManifest {
        turn,
        files,
        complete,
    };
    let text = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(snap_manifest_path(app, goal_id, turn), text)
        .map_err(|e| format!("写快照清单失败：{e}"))?;
    Ok(manifest)
}

fn load_snapshot_manifest(app: &AppHandle, goal_id: &str, turn: u32) -> Option<SnapshotManifest> {
    let text = std::fs::read_to_string(snap_manifest_path(app, goal_id, turn)).ok()?;
    serde_json::from_str(&text).ok()
}

/// 两张快照之间变了哪些文件（新增、内容变了、删了）：相对路径列表。
fn snapshot_diff(prev: &SnapshotManifest, cur: &SnapshotManifest) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let prev_map: HashMap<&str, u64> =
        prev.files.iter().map(|f| (f.path.as_str(), f.hash)).collect();
    for f in &cur.files {
        match prev_map.get(f.path.as_str()) {
            Some(h) if *h == f.hash => {}
            _ => out.push(f.path.clone()),
        }
    }
    let cur_set: std::collections::HashSet<&str> =
        cur.files.iter().map(|f| f.path.as_str()).collect();
    for f in &prev.files {
        if !cur_set.contains(f.path.as_str()) {
            out.push(f.path.clone());
        }
    }
    out.sort();
    out.dedup();
    out
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

/// P0-1：冻结快照存取（天枢的 `.frozen.json` 做法）。
/// 目标会话创建时把冻结前缀写进检查点目录；倒带 / 应用重启后读回来，
/// hash 对上就用原样字节，不用按当前输入重拼；读不到 / 对不上返回 None，
/// 调用方按当前输入重建（下一轮 run 时）。
pub fn save_frozen(
    app: &AppHandle,
    goal_id: &str,
    frozen: &crate::frozen::FrozenPrefix,
) -> Result<(), String> {
    let dir = checkpoints_dir(app, goal_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建检查点目录失败：{e}"))?;
    let text = serde_json::to_string_pretty(frozen).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("frozen.json"), text).map_err(|e| format!("写冻结快照失败：{e}"))?;
    Ok(())
}

pub fn load_frozen(app: &AppHandle, goal_id: &str) -> Option<crate::frozen::FrozenPrefix> {
    let p = checkpoints_dir(app, goal_id).join("frozen.json");
    let text = std::fs::read_to_string(&p).ok()?;
    let frozen: crate::frozen::FrozenPrefix = serde_json::from_str(&text).ok()?;
    if frozen.verify() {
        Some(frozen)
    } else {
        eprintln!("[frozen] {goal_id} 的 frozen.json hash 对不上，丢弃、按当前输入重建");
        None
    }
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

/// 每回合结束写一个检查点：消息快照 + 摘要 + 工作区快照。
/// 快照 diff 算出本回合真正改了哪些文件（含 run_shell 的改动），并进
/// files_changed、记 last_write_round——交付门与目标卡片终于能看到
/// shell 改动了（以前只认 write_file，sed 改的全漏掉）。
pub fn write_checkpoint(
    app: &AppHandle,
    session: &mut GoalSession,
    summary: &str,
) -> Result<CheckpointMeta, String> {
    let dir = checkpoints_dir(app, &session.id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建检查点目录失败：{e}"))?;
    // 先拍快照、算 diff，再写 meta，这样 meta.files_changed 就是本回合
    // 结束时的真实改动列表。
    if !session.workdir.trim().is_empty() {
        match snapshot_workdir(app, &session.id, session.turns_used, &session.workdir) {
            Ok(cur) => {
                let prev_turn = session.turns_used.saturating_sub(1);
                let prev = load_snapshot_manifest(app, &session.id, prev_turn)
                    .or_else(|| load_snapshot_manifest(app, &session.id, 0));
                if let Some(prev) = prev {
                    let changed = snapshot_diff(&prev, &cur);
                    if !changed.is_empty() {
                        for p in changed {
                            if !session.files_changed.contains(&p) {
                                session.files_changed.push(p);
                            }
                        }
                        session.last_write_round = session.rounds_used;
                        session.refresh_unverified();
                    }
                }
            }
            Err(e) => eprintln!("[goal] 回合快照失败：{e}"),
        }
    }
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

/// 倒带回第 N 回合时的代码状态。优先用快照：第 N 回合结束时的快照里
/// 有什么就恢复成什么；工作区里现在有、快照里没有的文件（第 N 回合
/// 之后新建的）删掉；第 N 回合之后没动过的文件保持原样。
/// 没有快照的老检查点，回退到写前备份的老办法（只认 write_file）。
/// 返回实际恢复/删除的文件列表。
pub fn rewind_code(app: &AppHandle, goal_id: &str, workdir: &str, turn: u32) -> Result<Vec<String>, String> {
    if let Some(snap) = load_snapshot_manifest(app, goal_id, turn) {
        return rewind_code_from_snapshot(app, goal_id, workdir, turn, &snap);
    }
    let manifest = load_manifest(app, goal_id);
    if manifest.writes.is_empty() {
        return Err(format!(
            "第 {turn} 回合没有快照，也没有写前备份，恢复不了代码。\
            （这次运行里模型可能只用 shell 改文件，而检查点是旧版格式。）"
        ));
    }
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

/// 用快照倒带：先把快照里的文件逐个恢复，再删掉快照里没有、工作区里
/// 有的文件（第 N 回合之后新建的）。快照不完整时（超上限被截断）只
/// 恢复、不删——宁可少删一个，不误删。
fn rewind_code_from_snapshot(
    app: &AppHandle,
    goal_id: &str,
    workdir: &str,
    turn: u32,
    snap: &SnapshotManifest,
) -> Result<Vec<String>, String> {
    let root = Path::new(workdir);
    let snap_root = snap_dir(app, goal_id, turn);
    let mut restored: Vec<String> = Vec::new();
    for f in &snap.files {
        let src = snap_root.join(&f.path);
        let bytes = std::fs::read(&src).map_err(|e| format!("读快照失败 {}：{e}", f.path))?;
        let target = root.join(&f.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| format!("恢复文件失败 {}：{e}", f.path))?;
        restored.push(format!("{}（恢复到第 {turn} 回合）", f.path));
    }
    if snap.complete {
        // 删第 N 回合之后新建的文件：现在工作区里有、快照里没有的。
        // 只对快照规则内的文件动手（重型目录、大文件本来就不进快照，不碰）。
        let in_snap: std::collections::HashSet<&str> =
            snap.files.iter().map(|f| f.path.as_str()).collect();
        let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let rd = match std::fs::read_dir(&dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for entry in rd.flatten() {
                let path = entry.path();
                let rel = match path.strip_prefix(root) {
                    Ok(r) => r.to_path_buf(),
                    Err(_) => continue,
                };
                let md = match std::fs::symlink_metadata(&path) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if md.file_type().is_symlink() {
                    continue;
                }
                if md.is_dir() {
                    if snap_wanted(&rel, true) {
                        stack.push(path);
                    }
                    continue;
                }
                if !md.is_file() || !snap_wanted(&rel, false) {
                    continue;
                }
                if md.len() > SNAP_MAX_FILE_BYTES {
                    continue;
                }
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if !in_snap.contains(rel_str.as_str()) {
                    if std::fs::remove_file(&path).is_ok() {
                        restored.push(format!("{rel_str}（第 {turn} 回合后新建的，已删除）"));
                    }
                }
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
            // P0-1：冻结前缀跟着对话一起回到快照点——读回 frozen.json，
            // hash 对上就用原样字节；读不到/对不上就留空，下一轮按当前输入重建。
            session.frozen = load_frozen(&app, &goal_id);
            // 清单跟着对话一起回到快照点：从恢复后的消息里重算，
            // 找不到清单块就清空——不留未来回合的打勾状态，也不编假数据。
            session.checklist = checklist_of(&session.messages);
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
    fn checklist_parses_numbered_list() {
        // 实测：模型常把清单写成数字列表（任务 1 就是 1. 2. 3.），不能漏。
        let text = "先看现场：\n## 目标清单\n1. 读取四个目标文件\n2. 把 VERSION=1 改成 VERSION=2\n3. 跑 grep 检查并汇报\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].text, "读取四个目标文件");
        assert!(!items.iter().any(|i| i.done));
        // 数字列表后面跟了别的 ## 段就停。
        let text2 = "## 目标清单\n- 把 A 改成 B\n## 其他\n- 不算\n";
        assert_eq!(parse_checklist(text2).len(), 1);
    }

    #[test]
    fn checklist_missing_is_empty_not_fake() {
        assert!(parse_checklist("没有清单，就是普通回复。").is_empty());
    }

    #[test]
    fn checklist_of_uses_latest_block() {
        let msgs = vec![
            json!({"role": "assistant", "content": "先说计划：\n## 目标清单\n- [ ] 做 A\n- [ ] 做 B\n"}),
            json!({"role": "assistant", "content": "做完一半：\n## 目标清单\n- [x] 做 A\n- [ ] 做 B\n"}),
        ];
        let items = checklist_of(&msgs);
        assert_eq!(items.len(), 2);
        assert!(items[0].done);
        assert!(!items[1].done);
    }

    #[test]
    fn checklist_of_empty_when_no_block() {
        let msgs = vec![json!({"role": "assistant", "content": "普通回复，没有清单。"})];
        assert!(checklist_of(&msgs).is_empty());
    }

    #[test]
    fn checklist_stops_at_report_prose() {
        // 实测假卡住的根因：最终汇报里清单后面跟了“**验证结果** + 数字列表”，
        // 旧解析只认 "## " 才停，把 4 条验证步骤也算成未完成清单项（4/8 项）。
        let text = "先说结论：\n## 目标清单\n- [x] 读 start.txt 确认链条要求\n- [x] 把四个文件的 VERSION 改成 2\n- [x] 运行 grep 验证\n- [x] 重新读取四个文件确认落盘\n\n路专员，链条走完，全部验证通过。\n\n**验证结果**：\n1. `grep -rn VERSION` 输出四行均为 VERSION=2，退出码 0。\n2. 严格逐文件断言 PASS，退出码 0。\n3. `grep -c \"VERSION=1\"` 均为 0，无残留。\n4. read_file 逐份重读，内容与预期一致。\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 4);
        assert!(items.iter().all(|i| i.done));
    }

    #[test]
    fn checklist_stops_at_numbered_list_after_blank() {
        // 清单后只隔空行、直接跟数字列表：也不算进清单。
        let text = "## 目标清单\n- [x] 做 A\n\n1. 验证步骤一\n2. 验证步骤二\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "做 A");
    }

    #[test]
    fn checklist_keeps_blank_lines_between_items() {
        // 清单项之间隔空行（行距），下一行还是列表项：继续算。
        let text = "## 目标清单\n- [ ] 做 A\n\n- [ ] 做 B\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn checklist_stops_at_prose_mid_block() {
        // 清单列到一半、后面跟汇报正文：只取正文前面的项。
        let text = "## 目标清单\n- [ ] 读 start.txt 确认链条要求\n- [ ] 把 VERSION 改成 2\n\n先看起点。\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 2);
        assert!(!items.iter().any(|i| i.done));
    }

    #[test]
    fn checklist_contiguous_mixed_kinds_parse() {
        // 紧挨着、中间没空行：不同写法也算同一份清单（行距没断就是一块）。
        let text = "## 目标清单\n- [x] 做 A\n1. 做 B\n2. 做 C\n";
        let items = parse_checklist(text);
        assert_eq!(items.len(), 3);
        assert!(items[0].done);
    }

    // 清单门（P0-6 补洞）：DSML_DROP 场景——网关丢掉调用、模型只回一句
    // “收到”就结束时，旧门 1/40 轮、清单 0/3 判 Done；新门必须拦住。
    fn goal_with_checklist(items: Vec<(&str, bool)>) -> GoalSession {
        let mut s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        s.checklist = items
            .into_iter()
            .map(|(t, d)| CheckItem { text: t.into(), done: d })
            .collect();
        s
    }

    #[test]
    fn checklist_gate_passes_when_all_done() {
        let s = goal_with_checklist(vec![("改 VERSION", true), ("跑 grep 检查", true)]);
        assert!(matches!(
            checklist_gate(&s, &["write_file".to_string()]),
            ChecklistGate::Pass
        ));
    }

    #[test]
    fn checklist_gate_passes_when_no_checklist_but_work_done() {
        // 没列清单但确实改过文件：干完活的正常收尾，放行。
        let mut s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        s.files_changed.push("a.txt".into());
        assert!(matches!(
            checklist_gate(&s, &["write_file".to_string()]),
            ChecklistGate::Pass
        ));
    }

    #[test]
    fn checklist_gate_passes_when_research_only() {
        // 没清单、没改文件，但读过文件（纯调研/回答型目标）：放行，
        // 别把“查完了、结论是……”的正常收尾当成没开始。
        let mut s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        s.read_paths.insert("a.txt".into());
        assert!(matches!(
            checklist_gate(&s, &[]),
            ChecklistGate::Pass
        ));
    }

    #[test]
    fn checklist_gate_nudges_when_items_undone() {
        let s = goal_with_checklist(vec![("改 VERSION", true), ("跑 grep 检查", false)]);
        match checklist_gate(&s, &[]) {
            ChecklistGate::Nudge(text) => assert!(text.contains("跑 grep 检查")),
            other => panic!("应提醒继续做，实际是 {:?}", std::mem::discriminant(&other)),
        }
    }

    #[test]
    fn checklist_gate_nudges_when_never_started() {
        // DSML_DROP 首轮：没清单、没读没改、本回合没调工具。
        let s = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        match checklist_gate(&s, &[]) {
            ChecklistGate::Nudge(text) => assert!(text.contains("还没开始动手")),
            other => panic!("应提醒开始动手，实际是 {:?}", std::mem::discriminant(&other)),
        }
    }

    #[test]
    fn checklist_gate_stuck_after_cap() {
        let mut s = goal_with_checklist(vec![("改 VERSION", false)]);
        s.checklist_nudged = CHECKLIST_NUDGE_MAX;
        match checklist_gate(&s, &[]) {
            ChecklistGate::Stuck(reason) => assert!(reason.contains("改 VERSION")),
            other => panic!("到上限应判卡住，实际是 {:?}", std::mem::discriminant(&other)),
        }
        // 没开始的情况到上限也判卡住，不判 Done。
        let mut s2 = GoalSession::new("g".into(), "t".into(), "eva".into(), "/tmp".into(), 40);
        s2.checklist_nudged = CHECKLIST_NUDGE_MAX;
        assert!(matches!(
            checklist_gate(&s2, &[]),
            ChecklistGate::Stuck(_)
        ));
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

    #[test]
    fn snapshot_diff_sees_shell_edits() {
        // 快照 diff 是交付门与倒带看到 shell 改动的唯一途径：sed 改了文件
        // 内容（哈希变了）、新建了一个、删了一个，都要算出来。
        let prev = SnapshotManifest {
            turn: 0,
            files: vec![
                SnapshotFile { path: "a.txt".into(), size: 3, hash: 11 },
                SnapshotFile { path: "b.txt".into(), size: 3, hash: 22 },
                SnapshotFile { path: "gone.txt".into(), size: 3, hash: 33 },
            ],
            complete: true,
        };
        let cur = SnapshotManifest {
            turn: 1,
            files: vec![
                SnapshotFile { path: "a.txt".into(), size: 3, hash: 11 },
                SnapshotFile { path: "b.txt".into(), size: 3, hash: 99 },
                SnapshotFile { path: "new.txt".into(), size: 3, hash: 44 },
            ],
            complete: true,
        };
        let diff = snapshot_diff(&prev, &cur);
        assert_eq!(diff, vec!["b.txt", "gone.txt", "new.txt"]);
    }

    #[test]
    fn snap_skips_heavy_dirs() {
        assert!(!snap_wanted(Path::new("node_modules/x.js"), false));
        assert!(!snap_wanted(Path::new(".git/config"), false));
        assert!(!snap_wanted(Path::new("target"), true));
        assert!(snap_wanted(Path::new("src/main.rs"), false));
        assert!(snap_wanted(Path::new(".gitignore"), false));
    }
}
