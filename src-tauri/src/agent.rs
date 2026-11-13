//! 原生 agent 引擎：应用自己直连模型服务商。
//!
//! 不再依赖外部命令行工具（codex / claude 等）。用户填好 Key 就能用：
//! 应用把对话发给服务商的 OpenAI 兼容接口，把答复流式推回界面。
//!
//! 支持的工具有限但真实：读文件、列目录、跑命令、改文件。
//! 工具调用走标准的 function calling 协议；没有工具调用时就是普通对话。
//! 报告真实用量（服务商返回的 usage），不再估算。

use crate::codex::RunState;
use crate::settings::{load_settings, Settings};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

/// 审批请求自增序号（生成唯一请求 id，不引入新依赖）。
static APPROVAL_SEQ: AtomicU64 = AtomicU64::new(0);

/// 一次运行的请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRequest {
    pub prompt: String,
    pub model: String,
    pub provider_id: String,
    pub effort: String,
    pub approval: String,
    pub sandbox: String,
    pub workdir: String,
    /// Agent mode: "norma" (general work) | "eva" (engineering).
    /// Independent from effort and ultracode.
    #[serde(default)]
    pub mode: String,
    /// Ultracode switch. The current engine is a single-agent loop: the flag
    /// is accepted and recorded, but no multi-agent orchestration is performed.
    #[serde(default)]
    pub ultracode: bool,
    /// 运行模式： "execute"（执行，默认）| "plan"（计划：只调查不写文件）。
    /// 由前端的 计划/执行 切换传入。
    #[serde(default = "default_run_mode")]
    pub run_mode: String,
    /// 本轮是否已获本会话的文件夹授权。false 时所有文件工具一律拒绝，
    /// 前端必须先让用户选文件夹（或授权当前文件夹）才能读写。
    /// 注意：这不是 settings.workdir 的翻版——workdir 只是"记住的上次目录"，
    /// 授权是"本会话用户明确同意"，两者分开才有意义。
    #[serde(default)]
    pub authorized: bool,
    /// 删除确认设置： "always"（每次删都问，默认）| "never"（不再询问）。
    /// 由设置页传入；引擎据此决定删文件类命令要不要走审批卡。
    #[serde(default = "default_delete_confirm")]
    pub delete_confirm: String,
    /// 用户显示名（界面设置）。空 = 默认“路专员”。
    #[serde(default)]
    pub display_name: String,
    /// 历史消息：[{role, content}]
    pub history: Option<Vec<ChatMsg>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentResult {
    pub success: bool,
    /// 用户点了停止（不是失败）。前端据此只收尾，不报“任务失败”。
    pub cancelled: bool,
    /// 模型返回的完整文本
    pub text: String,
    /// 服务商回报的真实用量（没有就是 None，不估算）
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    /// 本轮实际执行过的工具调用记录
    pub tools_run: Vec<String>,
}

/// 显示名取首字 + “专员”（如“路明非”→“路专员”）；没填就用默认“路专员”。
fn title_for(display_name: &str) -> String {
    let name = display_name.trim();
    if name.is_empty() {
        return "路专员".to_string();
    }
    let first = name.chars().next().unwrap_or('路');
    format!("{first}专员")
}

fn cancelled_result(
    text: String,
    tools_run: Vec<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
) -> AgentResult {
    AgentResult {
        success: false,
        cancelled: true,
        text: if text.trim().is_empty() {
            "（已停止）".to_string()
        } else {
            text
        },
        prompt_tokens,
        completion_tokens,
        total_tokens,
        tools_run,
    }
}

fn default_run_mode() -> String {
    "execute".to_string()
}

fn default_delete_confirm() -> String {
    "always".to_string()
}

/// 工具定义：只暴露真实实现的能力，不做样子。
///
/// 工具表随运行模式与身份变化（这是 P0-5/P0-9 的后端 enforcement，
/// 不是前端文字游戏）：
/// - 计划模式：只有 read_file / list_dir，写与执行一律不暴露；
/// - NORMA：读 + 写文档，没有 run_shell（办公不跑终端，见调研 §4.1 硬禁）；
/// - EVA 执行模式：四项全有。
fn tool_definitions(run_mode: &str, mode: &str) -> Value {
    let mut tools = vec![
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取工作区里一个文件的完整内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "相对工作区的文件路径"}
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "列出工作区里某个目录下的文件与子目录。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "相对工作区的目录路径，留空表示根目录"}
                    }
                }
            }
        }),
    ];
    if run_mode == "plan" {
        return Value::Array(tools);
    }
    tools.push(json!({
        "type": "function",
        "function": {
            "name": "write_file",
            "description": if mode == "eva" {
                "向工作区写入/覆盖一个文件。用于改代码。"
            } else {
                "向工作区写入/覆盖一个办公文档（Markdown/纯文本等）。"
            },
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对工作区的文件路径"},
                    "content": {"type": "string", "description": "要写入的完整内容"}
                },
                "required": ["path", "content"]
            }
        }
    }));
    if mode == "eva" {
        tools.push(json!({
            "type": "function",
            "function": {
                "name": "run_shell",
                "description": "在工作区目录下执行一条命令并返回输出。用于跑测试、看构建结果。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "要执行的命令"}
                    },
                    "required": ["command"]
                }
            }
        }));
    }
    Value::Array(tools)
}

/// 删文件类命令的识别（大小写不敏感；按 && / || / ; / | 拆段逐段判断）。
/// 返回命中的命令名（如 "rm"），没有命中返回 None。
/// 覆盖：rm / del / erase / rmdir / rd / Remove-Item / git clean -f / git rm。
fn destructive_command(cmd: &str) -> Option<&'static str> {
    let lower = cmd.to_ascii_lowercase();
    for seg in lower
        .split(|c| c == '&' || c == '|' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let mut toks = seg.split_whitespace();
        let first = toks.next().unwrap_or("");
        // "sudo rm ..." 也算 rm（Linux 下的写法）。
        let first = if first == "sudo" {
            toks.next().unwrap_or("")
        } else {
            first
        };
        match first {
            "rm" => return Some("rm"),
            "del" => return Some("del"),
            "erase" => return Some("erase"),
            "rmdir" => return Some("rmdir"),
            "rd" => return Some("rd"),
            "remove-item" => return Some("Remove-Item"),
            "git" => {
                let sub = toks.next().unwrap_or("");
                if sub == "clean" && toks.any(|t| t.starts_with("-f")) {
                    return Some("git clean -f");
                }
                if sub == "rm" {
                    return Some("git rm");
                }
            }
            _ => {}
        }
    }
    None
}

/// 灾难性删根：rm -rf /、rm -rf ~、rm -rf C:\ 这类——无论删除确认设置
/// 如何一律拒绝，不走审批卡（批了也不该执行）。
fn catastrophic_command(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    for seg in lower
        .split(|c| c == '&' || c == '|' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let mut toks = seg.split_whitespace();
        let first = toks.next().unwrap_or("");
        let first = if first == "sudo" {
            toks.next().unwrap_or("")
        } else {
            first
        };
        if first != "rm" {
            continue;
        }
        let rest: Vec<&str> = toks.collect();
        let has_rf = rest
            .iter()
            .any(|t| *t == "-rf" || *t == "-fr" || *t == "-r" || *t == "-f");
        if !has_rf {
            continue;
        }
        let targets_root = rest.iter().any(|t| {
            matches!(*t, "/" | "/*" | "~" | "~/" | "c:" | "c:/" | "c:\\" | "c:\\*")
        });
        if targets_root {
            return true;
        }
    }
    false
}

/// 路径安全检查：不允许跳出工作区
fn safe_join(workdir: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    let base = Path::new(workdir);
    if !base.is_dir() {
        return Err(format!("工作区不存在：{workdir}"));
    }
    let mut out = base.to_path_buf();
    for seg in rel.replace('\\', "/").split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err("路径不能包含 ..".to_string()),
            s => out.push(s),
        }
    }
    if !out.starts_with(base) {
        return Err("路径超出工作区范围".to_string());
    }
    Ok(out)
}

/// 向界面发一次审批请求（审批卡），等用户点"批准"或"拒绝"。
/// 180 秒无人决定按拒绝处理（不挂住这一轮）；用户取消任务时也按拒绝处理。
/// 返回 true = 用户批准执行，false = 拒绝/超时/取消。
async fn request_approval(
    app: &AppHandle,
    state: &RunState,
    kind: &str,
    label: &str,
    detail: &str,
) -> bool {
    let id = format!(
        "appr-{}",
        APPROVAL_SEQ.fetch_add(1, Ordering::SeqCst)
    );
    let (tx, rx) = oneshot::channel::<bool>();
    {
        let mut map = state.approvals.lock().await;
        map.insert(id.clone(), tx);
    }
    let _ = app.emit(
        "agent-approval-request",
        json!({ "id": id, "kind": kind, "label": label, "detail": detail }),
    );
    let decided = tokio::time::timeout(Duration::from_secs(180), rx).await;
    // 无论结果如何，清理挂起表（已由 resolve_approval 取走时这里是空操作）。
    {
        let mut map = state.approvals.lock().await;
        map.remove(&id);
    }
    match decided {
        Ok(Ok(allow)) => allow,
        _ => false, // 超时，或发送端（取消）被丢弃
    }
}

/// 前端审批卡的按钮调用：批准/拒绝一次挂起的审批请求。
/// 返回 true = 该请求还在挂起并已被解析；false = 请求已超时/取消/解析过。
#[tauri::command]
pub async fn resolve_approval(
    state: State<'_, RunState>,
    id: String,
    allow: bool,
) -> Result<bool, String> {
    let tx = {
        let mut map = state.approvals.lock().await;
        map.remove(&id)
    };
    match tx {
        Some(tx) => {
            let _ = tx.send(allow);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 工具执行上下文：一次 run 内所有工具调用共享的权限状态。
struct ToolCtx<'a> {
    app: AppHandle,
    state: &'a RunState,
    workdir: String,
    sandbox: String,
    approval: String,
    run_mode: String,
    mode: String,
    authorized: bool,
    delete_confirm: String,
}

async fn exec_tool(ctx: &ToolCtx<'_>, name: &str, args: &Value, tools_run: &mut Vec<String>) -> String {
    // P0-4 授权闸：本会话未授权时，所有文件工具一律拒绝，绝不读盘、
    // 绝不编造内容。前端收到这条文本后会提示用户先选文件夹。
    if !ctx.authorized {
        return "未授权：请先在界面上选择文件夹并授权，授权后我才能读写这个文件夹里的文件。".to_string();
    }
    match name {
        "read_file" => {
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_join(&ctx.workdir, rel) {
                Ok(p) => match tokio::fs::read_to_string(&p).await {
                    Ok(s) => {
                        tools_run.push(format!("读取 {rel}"));
                        let capped: String = s.chars().take(40_000).collect();
                        if s.chars().count() > 40_000 {
                            format!("{capped}…（已截断）")
                        } else {
                            capped
                        }
                    }
                    Err(e) => format!("读取失败：{e}"),
                },
                Err(e) => e,
            }
        }
        "list_dir" => {
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_join(&ctx.workdir, rel) {
                Ok(p) => match tokio::fs::read_dir(&p).await {
                    Ok(mut rd) => {
                        let mut items = Vec::new();
                        while let Ok(Some(e)) = rd.next_entry().await {
                            let n = e.file_name().to_string_lossy().to_string();
                            let is_dir = e.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
                            items.push(if is_dir { format!("{n}/") } else { n });
                            if items.len() >= 300 {
                                items.push("…（还有更多，已截断）".into());
                                break;
                            }
                        }
                        items.sort();
                        tools_run.push(format!("列出 {}", if rel.is_empty() { "根目录" } else { rel }));
                        items.join("\n")
                    }
                    Err(e) => format!("列目录失败：{e}"),
                },
                Err(e) => e,
            }
        }
        "write_file" => {
            // P0-5 计划模式：写操作一律拦住，不落盘。
            if ctx.run_mode == "plan" {
                return format!(
                    "计划模式：我现在只调查、不写文件。{rel} 的改动已记进方案里，等你点「确认执行」后再动手。",
                    rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("")
                );
            }
            if ctx.sandbox == "read-only" || ctx.approval == "read-only" {
                return "当前是只读模式，不能改文件。".to_string();
            }
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            // 写前确认档位：先问用户，批了才写。
            if ctx.approval == "ask" {
                let ok = request_approval(
                    &ctx.app,
                    ctx.state,
                    "write",
                    &format!("写入文件 {rel}"),
                    &format!("要写入文件 {rel}，内容约 {} 字。", content.chars().count()),
                )
                .await;
                if !ok {
                    return format!("用户没有批准这次写入（{rel} 没动）。");
                }
            }
            match safe_join(&ctx.workdir, rel) {
                Ok(p) => {
                    if let Some(parent) = p.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    match tokio::fs::write(&p, content).await {
                        Ok(_) => {
                            tools_run.push(format!("写入 {rel}"));
                            format!("已写入 {rel}（{} 字节）", content.len())
                        }
                        Err(e) => format!("写入失败：{e}"),
                    }
                }
                Err(e) => e,
            }
        }
        "run_shell" => {
            let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            // P0-5 计划模式：不执行命令。
            if ctx.run_mode == "plan" {
                return format!(
                    "计划模式：我现在只调查、不执行命令。`{cmd}` 已记进方案里，等你点「确认执行」后再跑。"
                );
            }
            // P0-9 NORMA 硬禁：办公不跑终端。
            if ctx.mode == "norma" {
                return format!(
                    "我是诺玛，办公模式不跑终端命令。`{cmd}` 需要切到 EVA（工程模式）再跑。"
                );
            }
            if ctx.sandbox == "read-only" || ctx.approval == "read-only" {
                return "当前是只读模式，不能执行命令。".to_string();
            }
            // 灾难性删根：无论删除确认设置如何一律拒绝。
            if catastrophic_command(cmd) {
                return format!("这条命令太危险了（删根目录），我拒绝执行：`{cmd}`");
            }
            // 删文件类命令：按删除确认设置决定要不要单独问一次。
            if let Some(hit) = destructive_command(cmd) {
                if ctx.delete_confirm != "never" {
                    let ok = request_approval(
                        &ctx.app,
                        ctx.state,
                        "delete",
                        &format!("执行删除命令（{hit}）"),
                        &format!("要执行这条删除命令：`{cmd}`\n删除后文件无法直接恢复，确定要执行吗？"),
                    )
                    .await;
                    if !ok {
                        return format!("用户没有批准这条删除命令（没执行）：`{cmd}`");
                    }
                }
            }
            tools_run.push(format!("执行 `{cmd}`"));
            #[cfg(windows)]
            let out = {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/C", cmd]).current_dir(&ctx.workdir);
                crate::hide_console(&mut c);
                c.output().await
            };
            #[cfg(not(windows))]
            let out = tokio::process::Command::new("sh")
                .args(["-c", cmd])
                .current_dir(&ctx.workdir)
                .output()
                .await;
            match out {
                Ok(o) => {
                    let mut s = String::from_utf8_lossy(&o.stdout).to_string();
                    let err = String::from_utf8_lossy(&o.stderr).to_string();
                    if !err.trim().is_empty() {
                        s.push_str("\n[stderr]\n");
                        s.push_str(&err);
                    }
                    s.push_str(&format!("\n[退出码 {}]", o.status.code().unwrap_or(-1)));
                    if s.len() > 20_000 { s.truncate(20_000); }
                    s
                }
                Err(e) => format!("执行失败：{e}"),
            }
        }
        _ => format!("未知工具：{name}"),
    }
}

/// 把底层网络错误翻译成用户能看懂、且能据此行动的中文。
/// 原始英文（error sending request for url ...）对用户没有任何意义。
fn humanize_net_error(e: &reqwest::Error, base_url: &str) -> String {
    // 本地地址几乎总是"反代/中转没启动"
    let is_local = base_url.contains("127.0.0.1")
        || base_url.contains("localhost")
        || base_url.contains("0.0.0.0");

    if e.is_timeout() {
        return format!(
            "连接超时。这个地址没有在 60 秒内回应：{base_url}\n检查一下：① 这个服务是不是需要先启动？② 地址和端口有没有写错？"
        );
    }
    if e.is_connect() {
        if is_local {
            return format!(
                "连不上 {base_url}——这个地址上现在没有程序在运行。\n\n常见原因：\n· 本地反代（中转）没启动，先把它开起来\n· 端口写错了，确认一下它实际监听的端口\n\n它起来之后，再点一次测试就能通过。"
            );
        }
        return format!(
            "连不上 {base_url}。请检查网络、代理设置，以及这个地址是否正确。"
        );
    }
    if e.is_request() {
        return format!("请求没能发出去：{base_url}。如果是本地地址，先确认服务已启动。");
    }
    format!("连接 {base_url} 失败，请检查地址与服务状态。")
}

/// 把 effort 映射成合理的温度/上限（服务商不一定支持 reasoning 参数）
fn effort_temperature(effort: &str) -> f64 {
    match effort {
        "low" => 0.3,
        "medium" => 0.5,
        "high" => 0.7,
        "xhigh" | "max" => 0.8,
        // 旧版：ultra 曾是与 EVA 绑定的强度档，现已并入 xhigh，仅作兼容。
        "ultra" => 0.8,
        _ => 0.5,
    }
}

#[tauri::command]
pub async fn run_agent_native(
    app: AppHandle,
    state: State<'_, RunState>,
    req: AgentRequest,
) -> Result<AgentResult, String> {
    // Reset the cancel flag for this run; clear the running flag on every exit.
    state.native_cancel.store(false, Ordering::SeqCst);
    state.native_running.store(true, Ordering::SeqCst);
    let result = run_agent_native_inner(app, &state, req).await;
    state.native_running.store(false, Ordering::SeqCst);
    result
}

async fn run_agent_native_inner(
    app: AppHandle,
    state: &RunState,
    req: AgentRequest,
) -> Result<AgentResult, String> {
    let settings: Settings = load_settings(&app);
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("未找到服务商：{}", req.provider_id))?
        .clone();

    let key = settings
        .api_keys
        .get(&provider.id)
        .filter(|k| !k.trim().is_empty())
        .cloned()
        .ok_or_else(|| format!("还没有配置 {} 的 API Key", provider.name))?;

    let workdir = if req.workdir.trim().is_empty() {
        settings.workdir.clone()
    } else {
        req.workdir.clone()
    };
    // P0-4：没有工作区也不直接报错——用户还能正常聊天，只是文件工具
    // 会在 exec_tool 里以"未授权"拒绝，并由界面引导他选文件夹。
    // （旧行为是整轮报错，用户连问问题都不行。）

    // 组装消息
    // Ultracode 如实处理：当前引擎是单智能体循环，不假装并行编排；
    // 开关只记录下来（供后续多智能体工作流引擎使用），本轮仍按单智能体跑。
    if req.ultracode {
        eprintln!(
            "[agent] ultracode requested (mode={}, effort={}): single-agent engine, flag recorded; multi-agent orchestration not implemented yet",
            req.mode, req.effort
        );
    }
    let title = title_for(&req.display_name);
    // 身份名跟着显示名走，不要写死：用户在设置里改了显示名，提示词里
    // 的名字也要跟着变，否则会说"用户是路明非"却叫他"楚专员"，自相矛盾。
    // 专员编号 S2017-0117 是终端注册的操作员编号（跟账号走，不跟昵称走），
    // 改显示名也不变。
    let user_name = {
        let n = req.display_name.trim();
        if n.is_empty() {
            "路明非".to_string()
        } else {
            n.to_string()
        }
    };
    let persona = if req.mode == "eva" {
        format!("你是 EVA，卡塞尔学院的并行执行体，与诺玛共用同一套记忆。卡塞尔学院是一所秘密学院，专门培养混血种：体内流着龙族血统的人类，以屠龙为使命；血统以字母分级，S 级最高。用户是{user_name}，学院 S 级血统专员，专员编号 S2017-0117。称呼他「{title}」：在问候、开场、切换模式、新话题开始时自然地叫一声，平时正常说话，不用每句都挂在嘴边。你果断、直接、讲证据。面对复杂任务先拆解、核对后再交付。你的产出是可验证的改动：改了什么文件、测试结果如何，都要拿证据说话。你不写办公文档、不碰日程邮件——那是诺玛的活。")
    } else {
        format!("你是诺玛，卡塞尔学院的中枢 AI——学院的档案、任务、日程与情报都经你手。卡塞尔学院是一所秘密学院，专门培养混血种：体内流着龙族血统的人类，以屠龙为使命；血统以字母分级，S 级最高。用户是{user_name}，学院 S 级血统专员，专员编号 S2017-0117。称呼他「{title}」：在问候、开场、切换模式、新话题开始时自然地叫一声，平时正常说话，不用每句都挂在嘴边。你冷静、优雅、精确。你的产出是文档和结论：写文档、整理资料、查信息、理思路。先给结论再给步骤。你不改代码、不跑终端命令——用户要改代码时，请他切到 EVA。")
    };
    let plan_hint = if req.run_mode == "plan" {
        "你现在处于计划模式：只调查、不写文件、不执行命令。先读相关文件、理清现状，再产出一份结构化方案，格式固定为：\n## 目标\n## 发现\n## 步骤\n## 风险\n不要直接动手改文件，等用户确认方案后再执行。"
    } else {
        ""
    };
    let auth_hint = if !req.authorized {
        "\n当前工作区未授权：文件工具不可用。如果用户要你读写文件，请先请用户在界面上选择文件夹并授权，不要编造文件内容、不要猜文件里有什么。"
    } else {
        ""
    };
    // 龙族知识库接线（知识库 §40 四层喂法）：
    // 冻结前缀放最前面且固定不变——人设提示词 + §0 常驻速查 + 诚实规则，
    // 这样 DeepSeek 前缀缓存才能命中（P0-1 会 formalize 这套，先把位置放对）。
    // 按需注入的章节追加在 system 消息末尾；不问龙族问题时一个字都不喂。
    // 匹配只看当前用户消息，不看历史，避免旧对话里的龙族词误触发。
    let lore_tail = match crate::lore::build_lore_injection(&req.prompt) {
        Some(injection) => format!("\n\n{injection}"),
        None => String::new(),
    };
    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": format!("{persona}\n\n{}\n\n[龙族知识回答规则]\n{}\n\n{plan_hint}\n当前工作区：{}\n允许的操作：{}{auth_hint}{lore_tail}",
            crate::lore::core_quick_ref(),
            crate::lore::HONESTY_RULES,
            if req.authorized { workdir.as_str() } else { "未授权（请先选择文件夹）" },
            if req.sandbox == "read-only" { "只能读取，不能修改" } else { "可以读写文件并执行命令" })
    })];
    if let Some(h) = &req.history {
        for m in h.iter().rev().take(20).rev() {
            messages.push(json!({"role": m.role, "content": m.content}));
        }
    }
    messages.push(json!({"role": "user", "content": req.prompt}));

    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建连接失败：{e}"))?;

    let mut tools_run: Vec<String> = Vec::new();
    let mut final_text = String::new();
    let mut prompt_tokens = None;
    let mut completion_tokens = None;
    let mut total_tokens = None;

    // 最多 8 轮工具调用，避免死循环
    for _round in 0..8 {
        // 用户点了停止：立刻收尾，不再发下一轮请求
        if state.native_cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_result(
                final_text,
                tools_run,
                prompt_tokens,
                completion_tokens,
                total_tokens,
            ));
        }
        let body = json!({
            "model": req.model,
            "messages": messages,
            "temperature": effort_temperature(&req.effort),
            "tools": tool_definitions(&req.run_mode, &req.mode),
            "tool_choice": "auto",
            "stream": true,
            "stream_options": {"include_usage": true}
        });

        let resp = client
            .post(&url)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await
            .map_err(|e| humanize_net_error(&e, &provider.base_url))?;

        let status = resp.status();
        if !status.is_success() {
            // 错误响应不是流，直接读全文，把服务商的真实错误原样给出
            let raw = resp.text().await.unwrap_or_default();
            let short = if raw.len() > 600 { &raw[..600] } else { &raw };
            return Err(format!("服务商返回 {status}：{short}"));
        }

        /* 逐块读取 SSE：每收到一段文字就立刻推给界面，
           用户能看到字一个个出来，而不是等全部结束才蹦出来。 */
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut round_text = String::new();
        let mut tool_calls: Vec<Value> = Vec::new();

        'stream: loop {
            // 200ms 一问：让“停止”按钮在流式等待时也能立刻生效。
            // stream.next() 的 future 被 timeout 丢弃是安全的，不会丢数据。
            let chunk = match tokio::time::timeout(
                std::time::Duration::from_millis(200),
                stream.next(),
            )
            .await
            {
                Ok(c) => c,
                Err(_) => {
                    if state.native_cancel.load(Ordering::SeqCst) {
                        return Ok(cancelled_result(
                            final_text,
                            tools_run,
                            prompt_tokens,
                            completion_tokens,
                            total_tokens,
                        ));
                    }
                    continue;
                }
            };
            let Some(chunk) = chunk else {
                break 'stream;
            };
            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => return Err(format!("读取流式响应失败：{e}")),
            };
            buf.push_str(&String::from_utf8_lossy(&bytes));

            // SSE 以换行分隔行、空行分隔事件
            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf.drain(..=idx);
                if line.is_empty() || line.starts_with(':') { continue; }
                let Some(data) = line.strip_prefix("data:") else { continue; };
                let data = data.trim();
                if data == "[DONE]" { break 'stream; }
                let Ok(ev) = serde_json::from_str::<Value>(data) else { continue; };

                // 用量（最后一帧）
                if let Some(u) = ev.get("usage").filter(|u| !u.is_null()) {
                    prompt_tokens = u.get("prompt_tokens").and_then(|x| x.as_u64());
                    completion_tokens = u.get("completion_tokens").and_then(|x| x.as_u64());
                    total_tokens = u.get("total_tokens").and_then(|x| x.as_u64());
                }

                let Some(delta) = ev.pointer("/choices/0/delta") else { continue; };

                // 思考增量（推理模型走这个字段）→ 只推 thinking 事件，绝不进正文。
                // 多轮工具调用的中间轮次本来就只有思考 + 工具调用、没有正文，这是正常的；
                // 最终轮若也只有思考没有正文，正文留空走兜底，绝不把原始推理全文倒进正文。
                if let Some(piece) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                    if !piece.is_empty() {
                        let _ = app.emit("agent-thinking", json!({"text": piece}));
                    }
                }
                // 正文增量 → 立刻推给前端
                if let Some(piece) = delta.get("content").and_then(|c| c.as_str()) {
                    if !piece.is_empty() {
                        round_text.push_str(piece);
                        let _ = app.emit("agent-delta", json!({"text": piece}));
                    }
                }

                // 工具调用增量：按 index 累积
                if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                    for tc in tcs {
                        let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                        while tool_calls.len() <= idx { tool_calls.push(json!({})); }
                        let slot = &mut tool_calls[idx];
                        if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                            slot["id"] = json!(id);
                        }
                        if let Some(name) = tc.pointer("/function/name").and_then(|n| n.as_str()) {
                            slot["function"] = slot.get("function").cloned().unwrap_or(json!({}));
                            slot["function"]["name"] = json!(name);
                        }
                        if let Some(args) = tc.pointer("/function/arguments").and_then(|a| a.as_str()) {
                            let prev = slot.pointer("/function/arguments").and_then(|a| a.as_str()).unwrap_or("").to_string();
                            slot["function"] = slot.get("function").cloned().unwrap_or(json!({}));
                            slot["function"]["arguments"] = json!(prev + args);
                        }
                    }
                }
            }
        }

        let msg = json!({
            "role": "assistant",
            "content": if round_text.is_empty() { Value::Null } else { json!(round_text) },
            "tool_calls": if tool_calls.is_empty() { Value::Null } else { json!(tool_calls) }
        });

        /* 本轮的文字已经在流式阶段累积好，汇总进最终结果。
           注意：思考内容（reasoning_content）只走 agent-thinking，绝不进正文；
           中间轮次只有思考 + 工具调用时正文本来就是空的，这是正常的。 */
        if !round_text.trim().is_empty() {
            final_text.push_str(&round_text);
        }

        match if tool_calls.is_empty() { None } else { Some(tool_calls.clone()) } {
            Some(calls) => {
                messages.push(msg.clone());
                for call in calls {
                    let name = call.pointer("/function/name").and_then(|n| n.as_str()).unwrap_or("");
                    let args_str = call.pointer("/function/arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                    let args: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                    let _ = app.emit("agent-tool", json!({"name": name, "args": args}));
                    let ctx = ToolCtx {
                        app: app.clone(),
                        state,
                        workdir: workdir.clone(),
                        sandbox: req.sandbox.clone(),
                        approval: req.approval.clone(),
                        run_mode: req.run_mode.clone(),
                        mode: req.mode.clone(),
                        authorized: req.authorized,
                        delete_confirm: req.delete_confirm.clone(),
                    };
                    let result = exec_tool(&ctx, name, &args, &mut tools_run).await;
                    let _ = app.emit("agent-tool-result", json!({"name": name, "result": result}));
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.get("id").cloned().unwrap_or(json!("")),
                        "content": result
                    }));
                }
                continue;
            }
            _ => break,
        }
    }

    if final_text.trim().is_empty() {
        final_text = "（模型没有返回文字内容）".to_string();
    }

    Ok(AgentResult {
        success: true,
        cancelled: false,
        text: final_text,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        tools_run,
    })
}

/// 测试连通性：真发一条最小请求，返回真实结果，不编造。
#[derive(Debug, Clone, Serialize)]
pub struct ConnResult {
    pub ok: bool,
    pub detail: String,
}

#[tauri::command]
pub async fn test_provider(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<ConnResult, String> {
    let settings: Settings = load_settings(&app);
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "未选择服务商".to_string())?
        .clone();
    let key = match settings.api_keys.get(&provider.id) {
        Some(k) if !k.trim().is_empty() => k.clone(),
        _ => {
            return Ok(ConnResult {
                ok: false,
                detail: format!("还没填 {} 的 API Key", provider.name),
            })
        }
    };

    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let body = json!({
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 16,
        "stream": false
    });

    match client.post(&url).bearer_auth(&key).json(&body).send().await {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(ConnResult {
                    ok: true,
                    detail: format!("{} / {} 连通正常", provider.name, model),
                })
            } else {
                let short = if text.len() > 400 { &text[..400] } else { &text };
                Ok(ConnResult {
                    ok: false,
                    detail: format!("服务商返回 {status}：{short}"),
                })
            }
        }
        Err(e) => Ok(ConnResult {
            ok: false,
            detail: humanize_net_error(&e, &provider.base_url),
        }),
    }
}

/// 从服务商读取可用模型列表（OpenAI 兼容的 GET /models）。
/// 返回真实结果；拉不到就把服务商的真实错误交回去。
#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let settings: Settings = load_settings(&app);
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "未选择服务商".to_string())?
        .clone();
    let key = settings
        .api_keys
        .get(&provider.id)
        .filter(|k| !k.trim().is_empty())
        .cloned()
        .ok_or_else(|| format!("还没填 {} 的 API Key", provider.name))?;

    let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| humanize_net_error(&e, &provider.base_url))?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let short = if raw.len() > 300 { &raw[..300] } else { &raw };
        return Err(format!("服务商返回 {status}：{short}"));
    }

    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("响应解析失败：{e}"))?;
    let mut out: Vec<String> = Vec::new();
    if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                out.push(id.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// 打开系统原生文件夹选择对话框，返回用户选中的路径。
/// 这是桌面应用该有的体验：点一下就选，不用手打路径。
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("选择项目文件夹")
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });
    match rx.await {
        Ok(Some(p)) => {
            // FilePath 可能是本地路径或 URL，统一转成字符串路径
            let s = match p.into_path() {
                Ok(pb) => pb.to_string_lossy().to_string(),
                Err(e) => return Err(format!("选择结果无法转为路径：{e}")),
            };
            Ok(Some(s))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("打开选择框失败：{e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_names(v: &Value) -> Vec<String> {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|t| {
                        t.pointer("/function/name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn plan_mode_exposes_read_only_tools() {
        let names = tool_names(&tool_definitions("plan", "eva"));
        assert_eq!(names, vec!["read_file", "list_dir"]);
    }

    #[test]
    fn norma_has_no_shell() {
        let names = tool_names(&tool_definitions("execute", "norma"));
        assert!(names.contains(&"read_file".to_string()));
        assert!(names.contains(&"write_file".to_string()));
        assert!(!names.contains(&"run_shell".to_string()));
    }

    #[test]
    fn eva_execute_has_all_tools() {
        let names = tool_names(&tool_definitions("execute", "eva"));
        assert_eq!(
            names,
            vec!["read_file", "list_dir", "write_file", "run_shell"]
        );
    }

    #[test]
    fn destructive_detection() {
        assert_eq!(destructive_command("rm -f foo.txt"), Some("rm"));
        assert_eq!(destructive_command("rm -rf build && npm run build"), Some("rm"));
        assert_eq!(destructive_command("del C:\\temp\\a.txt"), Some("del"));
        assert_eq!(destructive_command("Remove-Item foo.txt"), Some("Remove-Item"));
        assert_eq!(destructive_command("git clean -fd"), Some("git clean -f"));
        assert_eq!(destructive_command("git rm old.txt"), Some("git rm"));
        assert_eq!(destructive_command("npm test"), None);
        assert_eq!(destructive_command("cargo build"), None);
        assert_eq!(destructive_command("ls -la"), None);
    }

    #[test]
    fn catastrophic_detection() {
        assert!(catastrophic_command("rm -rf /"));
        assert!(catastrophic_command("sudo rm -rf /"));
        assert!(catastrophic_command("rm -rf ~"));
        assert!(catastrophic_command("rm -rf C:\\"));
        assert!(!catastrophic_command("rm -rf /tmp/foo"));
        assert!(!catastrophic_command("rm -f /tmp/foo.txt"));
        assert!(!catastrophic_command("npm test"));
    }
}
