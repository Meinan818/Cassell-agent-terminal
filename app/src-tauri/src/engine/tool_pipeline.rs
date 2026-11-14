use crate::run_state::RunState;
use crate::engine::policy::{
    catastrophic_command, destructive_command, is_local_url, network_egress,
    sensitive_path_access,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

static APPROVAL_SEQ: AtomicU64 = AtomicU64::new(0);

/// 向界面发一次审批请求（审批卡），等用户点"批准"或"拒绝"。
/// 180 秒无人决定按拒绝处理（不挂住这一轮）；用户取消任务时也按拒绝处理。
/// 返回 true = 用户批准执行，false = 拒绝/超时/取消。
async fn request_approval(
    app: &AppHandle,
    task_id: &str,
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
    let _ = crate::engine::journal::append(
        app,
        task_id,
        crate::engine::journal::EngineEventKind::ApprovalRequested {
            id: id.clone(),
            kind: kind.to_string(),
            label: label.to_string(),
        },
    );
    let _ = app.emit(
        "agent-approval-request",
        json!({
            "id": id,
            "kind": kind,
            "label": label,
            "detail": detail,
            "task_id": task_id
        }),
    );
    let decided = tokio::time::timeout(Duration::from_secs(180), rx).await;
    // 无论结果如何，清理挂起表（已由 resolve_approval 取走时这里是空操作）。
    {
        let mut map = state.approvals.lock().await;
        map.remove(&id);
    }
    let allow = match decided {
        Ok(Ok(allow)) => allow,
        _ => false, // 超时，或发送端（取消）被丢弃
    };
    let _ = crate::engine::journal::append(
        app,
        task_id,
        crate::engine::journal::EngineEventKind::ApprovalResolved {
            id,
            allow,
        },
    );
    allow
}


/// 工具执行上下文：一次 run 内所有工具调用共享的权限状态。
pub(crate) struct ToolCtx<'a> {
    pub(crate) app: AppHandle,
    pub(crate) state: &'a RunState,
    pub(crate) workdir: String,
    pub(crate) sandbox: String,
    pub(crate) approval: String,
    pub(crate) run_mode: String,
    pub(crate) mode: String,
    pub(crate) authorized: bool,
    pub(crate) delete_confirm: String,
    /// P0-11④ 终端会话 id（= 前端 task id，缺省 "default"）。
    pub(crate) session_id: String,
}

pub(crate) async fn exec_tool(ctx: &ToolCtx<'_>, name: &str, args: &Value, tools_run: &mut Vec<String>) -> String {
    // P0-4 授权闸：本会话未授权时，所有文件工具一律拒绝，绝不读盘、
    // 绝不编造内容。前端收到这条文本后会提示用户先选文件夹。
    if !ctx.authorized {
        return "未授权：请先在界面上选择文件夹并授权，授权后我才能读写这个文件夹里的文件。".to_string();
    }
    match name {
        "read_file" => {
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match crate::sandbox::join_path(
                &ctx.workdir,
                rel,
                crate::sandbox::parse_sandbox(&ctx.sandbox),
            ) {
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
            match crate::sandbox::join_path(
                &ctx.workdir,
                rel,
                crate::sandbox::parse_sandbox(&ctx.sandbox),
            ) {
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
            if crate::sandbox::parse_sandbox(&ctx.sandbox)
                == crate::sandbox::SandboxLevel::ReadOnly
            {
                return "当前是只读模式，不能改文件。".to_string();
            }
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            // P0-8 审批：每步问档，写文件前先弹审批卡问你，批了才写；
            // 按需问 / 从不问档直接写（删除类命令的确认在 run_shell 里另算）。
            if crate::sandbox::needs_approval(
                crate::sandbox::parse_approval(&ctx.approval),
                "write",
                false,
                &ctx.delete_confirm,
            ) {
                let ok = request_approval(
                    &ctx.app,
                    &ctx.session_id,
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
            match crate::sandbox::join_path(
                &ctx.workdir,
                rel,
                crate::sandbox::parse_sandbox(&ctx.sandbox),
            ) {
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
        "edit_file" => {
            if ctx.run_mode == "plan" {
                let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                return format!(
                    "计划模式：我现在只调查、不写文件。{rel} 的改动已记进方案里，等你点「确认执行」后再动手。"
                );
            }
            if crate::sandbox::parse_sandbox(&ctx.sandbox)
                == crate::sandbox::SandboxLevel::ReadOnly
            {
                return "当前是只读模式，不能改文件。".to_string();
            }
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let old_string = args
                .get("old_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let new_string = args
                .get("new_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let replace_all = args
                .get("replace_all")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if crate::sandbox::needs_approval(
                crate::sandbox::parse_approval(&ctx.approval),
                "write",
                false,
                &ctx.delete_confirm,
            ) {
                let ok = request_approval(
                    &ctx.app,
                    &ctx.session_id,
                    ctx.state,
                    "write",
                    &format!("编辑文件 {rel}"),
                    &format!(
                        "要编辑文件 {rel}：替换 {} 字为 {} 字。",
                        old_string.chars().count(),
                        new_string.chars().count()
                    ),
                )
                .await;
                if !ok {
                    return format!("用户没有批准这次编辑（{rel} 没动）。");
                }
            }
            match crate::sandbox::join_path(
                &ctx.workdir,
                rel,
                crate::sandbox::parse_sandbox(&ctx.sandbox),
            ) {
                Ok(p) => match tokio::fs::read_to_string(&p).await {
                    Ok(content) => {
                        match crate::engine::edit::replace_exact(
                            &content,
                            old_string,
                            new_string,
                            replace_all,
                        ) {
                            Ok(next) => match tokio::fs::write(&p, &next).await {
                                Ok(_) => {
                                    tools_run.push(format!("编辑 {rel}"));
                                    format!("已编辑 {rel}（{} 字节）", next.len())
                                }
                                Err(e) => format!("编辑写入失败：{e}"),
                            },
                            Err(e) => format!("编辑失败：{e}"),
                        }
                    }
                    Err(e) => format!("读取文件失败：{e}"),
                },
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
            if !crate::engine::modes::profile(&ctx.mode).can_run_shell {
                return format!(
                    "我是诺玛，办公模式不跑终端命令。`{cmd}` 需要切到 EVA（工程模式）再跑。"
                );
            }
            if crate::sandbox::parse_sandbox(&ctx.sandbox)
                == crate::sandbox::SandboxLevel::ReadOnly
            {
                return "当前是只读模式，不能执行命令。".to_string();
            }
            // 灾难性删根：无论删除确认设置如何一律拒绝。
            if catastrophic_command(cmd) {
                return format!("这条命令太危险了（删根目录），我拒绝执行：`{cmd}`");
            }
            // P0-8 审批决策表（needs_approval）：
            // - 每步问：整条命令先问一次，批了才跑；删除命令不再问第二遍。
            // - 按需问：常规命令直接跑，删除类命令按删除确认设置单独问。
            // - 从不问：什么卡都不弹。
            let approval = crate::sandbox::parse_approval(&ctx.approval);
            let destructive = destructive_command(cmd);
            let sensitive = sensitive_path_access(cmd);
            let network = network_egress(cmd);
            if crate::sandbox::needs_approval(approval, "shell", false, &ctx.delete_confirm) {
                let extra = match (sensitive, network) {
                    (Some(s), Some(n)) => format!("\n注意：这条命令涉及敏感路径（{s}）和网络出口（{n}）。"),
                    (Some(s), None) => format!("\n注意：这条命令涉及敏感路径（{s}）。"),
                    (None, Some(n)) => format!("\n注意：这条命令涉及网络出口（{n}）。"),
                    (None, None) => String::new(),
                };
                let ok = request_approval(
                    &ctx.app,
                    &ctx.session_id,
                    ctx.state,
                    "shell",
                    "执行命令",
                    &format!("要执行这条命令：`{cmd}`{extra}"),
                )
                .await;
                if !ok {
                    return format!("用户没有批准这条命令（没执行）：`{cmd}`");
                }
            } else if let Some(hit) = destructive {
                if crate::sandbox::needs_approval(approval, "shell", true, &ctx.delete_confirm) {
                    let ok = request_approval(
                        &ctx.app,
                        &ctx.session_id,
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
            } else if let Some(hit) = sensitive {
                // "从不问"档也不允许静默读取凭据；这是硬边界，避免
                // settings.json 里的 API Key 被读进上下文发给模型服务商。
                if approval == crate::sandbox::ApprovalLevel::Never {
                    return format!(
                        "这条命令会读取敏感路径（{hit}），当前是「从不问」档，已拒绝。改成按需问/每步问后再试：`{cmd}`"
                    );
                }
                let network_note = network
                    .map(|n| format!("\n同时涉及网络出口（{n}）。"))
                    .unwrap_or_default();
                let ok = request_approval(
                    &ctx.app,
                    &ctx.session_id,
                    ctx.state,
                    "sensitive",
                    &format!("访问敏感文件（{hit}）"),
                    &format!(
                        "这条命令可能读取凭据、私钥或应用设置：`{cmd}`\n敏感内容会进入模型上下文，确定要执行吗？{network_note}"
                    ),
                )
                .await;
                if !ok {
                    return format!("用户没有批准访问敏感路径（没执行）：`{cmd}`");
                }
            } else if let Some(hit) = network {
                if approval != crate::sandbox::ApprovalLevel::Never {
                    let ok = request_approval(
                        &ctx.app,
                        &ctx.session_id,
                        ctx.state,
                        "network",
                        &format!("发起网络请求（{hit}）"),
                        &format!(
                            "这条命令可能把数据发送到外部：`{cmd}`\n目标地址和命令输出会进入模型上下文，确定要执行吗？"
                        ),
                    )
                    .await;
                    if !ok {
                        return format!("用户没有批准网络请求（没执行）：`{cmd}`");
                    }
                }
            }
            tools_run.push(format!("执行 `{cmd}`"));
            let mut c = if cfg!(windows) {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/C", cmd]);
                c
            } else {
                let mut c = tokio::process::Command::new("sh");
                c.args(["-c", cmd]);
                c
            };
            c.current_dir(&ctx.workdir);
            crate::hide_console(&mut c);
            let out = crate::engine::process::output_with_timeout(
                c,
                std::time::Duration::from_secs(120),
            )
            .await;
            match out {
                Ok(crate::engine::process::RunOutput::Completed(o)) => {
                    let mut s = String::from_utf8_lossy(&o.stdout).to_string();
                    let err = String::from_utf8_lossy(&o.stderr).to_string();
                    if !err.trim().is_empty() {
                        s.push_str("\n[stderr]\n");
                        s.push_str(&err);
                    }
                    s.push_str(&format!("\n[退出码 {}]", o.status.code().unwrap_or(-1)));
                    if s.len() > 20_000 {
                        let cut = crate::text::floor_char_boundary(&s, 20_000);
                        s.truncate(cut);
                    }
                    s
                }
                Ok(crate::engine::process::RunOutput::TimedOut) => format!(
                    "命令超时（120 秒），已尝试终止整棵进程树：`{cmd}`"
                ),
                Err(e) => format!("执行失败：{e}"),
            }
        }
        "open_browser" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if ctx.run_mode == "plan" {
                return format!(
                    "计划模式：我现在只调查、不打开浏览器。`{url}` 已记进方案里，等你点「确认执行」后再打开。"
                );
            }
            if !crate::engine::modes::profile(&ctx.mode).can_use_browser {
                return format!(
                    "我是诺玛，办公模式不在内置浏览器里开页面。`{url}` 需要切到 EVA（工程模式）再开。"
                );
            }
            if url.trim().is_empty() {
                return "要打开的网址为空。".to_string();
            }
            let approval = crate::sandbox::parse_approval(&ctx.approval);
            // Localhost / 127.0.0.1 是开发验收主路径，不打断；外部网址
            // 可能把数据塞进 URL query 外带，按需问档先确认。
            if !is_local_url(url) && approval != crate::sandbox::ApprovalLevel::Never {
                let ok = request_approval(
                    &ctx.app,
                    &ctx.session_id,
                    ctx.state,
                    "network",
                    "打开外部网页",
                    &format!("要在应用内打开外部网页：`{url}`\n网页内容会进入上下文，确定要打开吗？"),
                )
                .await;
                if !ok {
                    return format!("用户没有批准打开外部网页：`{url}`");
                }
            }
            tools_run.push(format!("在内置浏览器打开 {url}"));
            // 前端接这个事件：切到 Inspector 浏览器页签，在子 webview 里打开。
            let _ = ctx
                .app
                .emit(
                    "agent-open-browser",
                    serde_json::json!({ "url": url, "task_id": ctx.session_id }),
                );
            format!("已在应用内置浏览器打开 {url}（应用内查看，不用跳系统浏览器）。")
        }
        "read_terminal" => {
            if ctx.run_mode == "plan" {
                return "计划模式：我现在只调查、不读终端。".to_string();
            }
            if !crate::engine::modes::profile(&ctx.mode).can_read_terminal {
                return "我是诺玛，办公模式不读终端。需要切到 EVA（工程模式）再读。".to_string();
            }
            tools_run.push("读取终端输出".to_string());
            let out = crate::pty::snapshot_for_agent(&ctx.app, &ctx.session_id);
            if out.trim().is_empty() {
                return "终端还没有输出（这个对话的终端一次没打开过，或者刚起还没出东西）。".to_string();
            }
            let mut s = out;
            if s.chars().count() > 8000 {
                s = s.chars().skip(s.chars().count() - 8000).collect();
            }
            format!("终端最近的输出：\n{s}")
        }
        _ => format!("未知工具：{name}"),
    }
}

