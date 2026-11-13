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
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};

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

/// 工具定义：只暴露真实实现的能力，不做样子。
fn tool_definitions() -> Value {
    json!([
        {
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
        },
        {
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
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "向工作区写入/覆盖一个文件。用于改代码。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "相对工作区的文件路径"},
                        "content": {"type": "string", "description": "要写入的完整内容"}
                    },
                    "required": ["path", "content"]
                }
            }
        },
        {
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
        }
    ])
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

async fn exec_tool(
    workdir: &str,
    sandbox: &str,
    name: &str,
    args: &Value,
    tools_run: &mut Vec<String>,
) -> String {
    match name {
        "read_file" => {
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_join(workdir, rel) {
                Ok(p) => match tokio::fs::read_to_string(&p).await {
                    Ok(s) => {
                        tools_run.push(format!("读取 {rel}"));
                        let capped = if s.len() > 40_000 { format!("{}…（已截断）", &s[..40_000]) } else { s };
                        capped
                    }
                    Err(e) => format!("读取失败：{e}"),
                },
                Err(e) => e,
            }
        }
        "list_dir" => {
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_join(workdir, rel) {
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
            if sandbox == "read-only" {
                return "当前是只读模式，不能改文件。".to_string();
            }
            let rel = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            match safe_join(workdir, rel) {
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
            if sandbox == "read-only" {
                return "当前是只读模式，不能执行命令。".to_string();
            }
            tools_run.push(format!("执行 `{cmd}`"));
            #[cfg(windows)]
            let out = {
                let mut c = tokio::process::Command::new("cmd");
                c.args(["/C", cmd]).current_dir(workdir);
                crate::hide_console(&mut c);
                c.output().await
            };
            #[cfg(not(windows))]
            let out = tokio::process::Command::new("sh")
                .args(["-c", cmd])
                .current_dir(workdir)
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
    if workdir.trim().is_empty() {
        return Err("还没有选择工作区。先告诉我项目文件夹在哪。".to_string());
    }

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
    let persona = if req.mode == "eva" {
        format!("你是 EVA，卡塞尔学院的并行执行体，与诺玛共用同一套记忆。称呼用户为{title}。面对复杂任务先拆解、核对后再交付，回答直接、有决断。")
    } else {
        format!("你是诺玛，卡塞尔学院的中枢 AI。称呼用户为{title}。回答简洁、准确，先给结论再给步骤。")
    };
    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": format!("{persona}\n\n当前工作区：{workdir}\n允许的操作：{}",
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
            "tools": tool_definitions(),
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
        let mut round_think = String::new();
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

                // 思考增量（推理模型走这个字段）→ 推成 thinking 事件
                if let Some(piece) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                    if !piece.is_empty() {
                        round_think.push_str(piece);
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
           有些推理模型只给 reasoning_content、不给 content：
           这种情况把思考内容作为答复交付，绝不留空白。 */
        if !round_text.trim().is_empty() {
            final_text.push_str(&round_text);
        } else if !round_think.trim().is_empty() {
            final_text.push_str(&round_think);
            let _ = app.emit("agent-delta", json!({"text": round_think}));
        }

        match if tool_calls.is_empty() { None } else { Some(tool_calls.clone()) } {
            Some(calls) => {
                messages.push(msg.clone());
                for call in calls {
                    let name = call.pointer("/function/name").and_then(|n| n.as_str()).unwrap_or("");
                    let args_str = call.pointer("/function/arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                    let args: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                    let _ = app.emit("agent-tool", json!({"name": name, "args": args}));
                    let result = exec_tool(&workdir, &req.sandbox, name, &args, &mut tools_run).await;
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
