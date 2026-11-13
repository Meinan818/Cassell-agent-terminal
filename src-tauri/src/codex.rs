//! Codex CLI engine driver.
//!
//! The app shells out to the open-source Codex CLI (`openai/codex`, Apache 2.0)
//! and streams its `--json` (JSONL) events back to the frontend as Tauri
//! events. Nothing is simulated: a user message runs a real agent turn.
//!
//! Verified against codex-cli 0.164.0-alpha.9:
//! - `codex exec --json --skip-git-repo-check -m <model> -s <sandbox>
//!   -C <workdir> -c model_provider=<id>
//!   -c 'model_providers.<id>.name="<Name>"'
//!   -c 'model_providers.<id>.base_url="<url>"'
//!   -c 'model_providers.<id>.env_key="<ENV>"'
//!   -c 'model_providers.<id>.wire_api="responses"'
//!   -c model_reasoning_effort=<low|medium|high|xhigh>
//!   [--approve-for-me] <prompt>`
//! - Provider keys are passed ONLY as an env var on the child process
//!   (never on the command line). `api_key_env` / `api_key` are ignored by
//!   this Codex version; `env_key` is the accepted key name.
//! - `wire_api = "chat"` is removed in this version; only "responses"
//!   is supported. DeepSeek / Moonshot / Qwen all serve /v1/responses,
//!   so BYOK works through the Responses wire API.
//! - stdin MUST be null, otherwise `codex exec` blocks waiting for
//!   "additional input from stdin".

use crate::settings::{load_settings, Settings};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, oneshot};

pub struct RunState {
    pub child: tokio::sync::Mutex<Option<tokio::process::Child>>,
    /// Set by cancel_run; the native engine polls it while streaming.
    pub native_cancel: AtomicBool,
    /// True while a native run is in flight.
    pub native_running: AtomicBool,
    /// Pending interactive approvals: request id -> channel to resolve it.
    /// The native engine registers here when a write/delete needs the user's
    /// explicit confirmation; `resolve_approval` (UI) or cancel/timeout
    /// resolves it. Entries are removed exactly once, by whoever resolves.
    pub approvals: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl RunState {
    /// Deny every pending approval (used by cancel_run so a stopped run
    /// never hangs waiting for a decision that will never come).
    pub async fn deny_all_approvals(&self) {
        let mut map = self.approvals.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(false);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRequest {
    pub prompt: String,
    pub model: String,
    pub provider_id: String,
    pub effort: String,
    pub approval: String,
    pub sandbox: String,
    pub workdir: String,
    pub eva: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunResult {
    pub thread_id: Option<String>,
    pub exit_code: Option<i32>,
    pub success: bool,
}

const NORMA_PERSONA: &str = "你是诺玛，卡塞尔学院的中枢 AI。称呼用户为路专员。回答简洁、准确，先给结论再给步骤。";
const EVA_PERSONA: &str = "你是 EVA，卡塞尔学院的并行执行体，与诺玛共用同一套记忆。称呼用户为路专员。面对复杂任务先拆解成可并行的子任务、交叉核查后再交付，回答直接、有决断。";

fn effort_to_codex(effort: &str) -> &'static str {
    match effort {
        "low" => "low",
        "medium" => "medium",
        "high" => "high",
        "xhigh" => "xhigh",
        "max" => "xhigh",
        // 旧版：ultra 曾是与 EVA 绑定的强度档，现已并入 xhigh，仅作兼容。
        "ultra" => "xhigh",
        _ => "medium",
    }
}

fn codex_binary(settings: &Settings) -> String {
    if settings.codex_path.trim().is_empty() {
        "codex".to_string()
    } else {
        settings.codex_path.clone()
    }
}

/// Build the `codex exec` command for a run. Returns the command plus the
/// env var (name, value) carrying the provider API key, if one is set.
fn build_codex_command(
    settings: &Settings,
    req: &RunRequest,
) -> Result<(Command, Option<(String, String)>), String> {
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("unknown provider: {}", req.provider_id))?;

    let workdir = if req.workdir.trim().is_empty() {
        settings.workdir.clone()
    } else {
        req.workdir.clone()
    };
    if !workdir.trim().is_empty() && !Path::new(&workdir).is_absolute() {
        return Err("工作区必须填写完整路径，不能使用相对路径。".to_string());
    }
    if !workdir.trim().is_empty() && !Path::new(&workdir).is_dir() {
        return Err(format!("工作区目录不存在：{workdir}"));
    }

    let persona = if req.eva { EVA_PERSONA } else { NORMA_PERSONA };
    let full_prompt = format!("[身份设定] {persona}\n\n[任务]\n{}", req.prompt);

    let mut cmd = Command::new(codex_binary(settings));
    crate::hide_console(&mut cmd);
    cmd.arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        .arg("-m")
        .arg(&req.model)
        .arg("-s")
        .arg(&req.sandbox)
        .arg("-c")
        .arg(format!("model_provider={}", provider.id))
        .arg("-c")
        .arg(format!(
            "model_providers.{}.name=\"{}\"",
            provider.id, provider.name
        ))
        .arg("-c")
        .arg(format!(
            "model_providers.{}.base_url=\"{}\"",
            provider.id, provider.base_url
        ))
        .arg("-c")
        .arg(format!(
            "model_providers.{}.env_key=\"{}\"",
            provider.id, provider.env_key
        ))
        .arg("-c")
        .arg(format!(
            "model_providers.{}.wire_api=\"responses\"",
            provider.id
        ))
        .arg("-c")
        .arg(format!(
            "model_reasoning_effort={}",
            effort_to_codex(&req.effort)
        ));
    if !workdir.trim().is_empty() {
        cmd.arg("-C").arg(&workdir);
    }
    if req.approval == "auto" {
        cmd.arg("--approve-for-me");
    }
    cmd.arg(full_prompt);
    // stdin must be null: otherwise codex waits for "additional input".
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let key_env = settings
        .api_keys
        .get(&provider.id)
        .filter(|k| !k.trim().is_empty())
        .map(|k| (provider.env_key.clone(), k.clone()));

    Ok((cmd, key_env))
}

#[tauri::command]
pub async fn run_agent(
    app: AppHandle,
    state: State<'_, RunState>,
    req: RunRequest,
) -> Result<RunResult, String> {
    let settings = load_settings(&app);
    let workdir = if req.workdir.trim().is_empty() {
        settings.workdir.as_str()
    } else {
        req.workdir.as_str()
    };
    if workdir.trim().is_empty() {
        return Err("还没有选择工作区。请先到「设置 → 运行时与环境」填写项目文件夹路径。".to_string());
    }
    if !Path::new(workdir).is_absolute() {
        return Err("工作区必须填写完整路径，不能使用相对路径。".to_string());
    }
    if !Path::new(workdir).is_dir() {
        return Err(format!("工作区目录不存在：{workdir}"));
    }
    let (mut cmd, key_env) = build_codex_command(&settings, &req)?;
    if let Some((k, v)) = key_env {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "无法启动 Codex CLI（{}）：{e}。请先安装：npm install -g @openai/codex",
            codex_binary(&settings)
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Codex 输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Codex 日志".to_string())?;

    {
        let mut slot = state.child.lock().await;
        *slot = Some(child);
    }

    // Stream stdout (JSONL) as `agent-event`, stderr as `agent-log`.
    let app_out = app.clone();
    let out_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut thread_id: Option<String> = None;
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if thread_id.is_none() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if v.get("type").and_then(|t| t.as_str()) == Some("thread.started") {
                        thread_id = v
                            .get("thread_id")
                            .and_then(|t| t.as_str())
                            .map(|s| s.to_string());
                    }
                }
            }
            let _ = app_out.emit("agent-event", line);
        }
        thread_id
    });

    let app_err = app.clone();
    let err_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app_err.emit("agent-log", line);
        }
    });

    // Wait for the child to exit by polling try_wait() so cancel_run can
    // still take the lock and kill the child in between polls.
    let exit_code: Option<i32>;
    loop {
        let mut slot = state.child.lock().await;
        match slot.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    exit_code = status.code();
                    *slot = None;
                    break;
                }
                Ok(None) => {
                    drop(slot);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(e) => {
                    *slot = None;
                    return Err(format!("等待 Codex 退出失败：{e}"));
                }
            },
            // Child was taken by cancel_run.
            None => {
                exit_code = None;
                break;
            }
        }
    }

    let thread_id = out_task.await.unwrap_or(None);
    let _ = err_task.await;

    let success = exit_code == Some(0);
    Ok(RunResult {
        thread_id,
        exit_code,
        success,
    })
}

#[tauri::command]
pub async fn cancel_run(state: State<'_, RunState>) -> Result<bool, String> {
    let mut stopped = false;
    // Native engine: raise the flag; the streaming loop polls it every 200ms.
    if state.native_running.load(Ordering::SeqCst) {
        state.native_cancel.store(true, Ordering::SeqCst);
        stopped = true;
    }
    // Any write/delete waiting on the user's confirmation is denied, so the
    // run never hangs on a decision that will never come.
    state.deny_all_approvals().await;
    // Codex CLI child process, if any.
    let mut slot = state.child.lock().await;
    if let Some(child) = slot.as_mut() {
        child
            .kill()
            .await
            .map_err(|e| format!("停止任务失败：{e}"))?;
        *slot = None;
        stopped = true;
    }
    Ok(stopped)
}

#[tauri::command]
pub async fn check_codex(app: AppHandle) -> Result<CodexInfo, String> {
    let settings = load_settings(&app);
    let bin = codex_binary(&settings);
    let mut cmd = Command::new(&bin);
    cmd.arg("--version").stdin(Stdio::null());
    crate::hide_console(&mut cmd);
    let out = cmd.output().await;
    match out {
        Ok(o) if o.status.success() => Ok(CodexInfo {
            found: true,
            path: bin,
            version: String::from_utf8_lossy(&o.stdout).trim().to_string(),
        }),
        Ok(o) => Ok(CodexInfo {
            found: false,
            path: bin,
            version: format!(
                "codex --version 退出码 {:?}：{}",
                o.status.code(),
                String::from_utf8_lossy(&o.stderr)
            ),
        }),
        Err(e) => Ok(CodexInfo {
            found: false,
            path: bin,
            version: format!("未找到 Codex CLI：{e}。请先安装：npm install -g @openai/codex"),
        }),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexInfo {
    pub found: bool,
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub detail: String,
}

/// Minimal connectivity test: run one tiny agent turn with the configured
/// provider/model and report whether the API answered. Consumes one real
/// API call; only run when the user presses "测试连通".
#[tauri::command]
pub async fn test_connection(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<TestResult, String> {
    let settings = load_settings(&app);
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "未选择服务商".to_string())?
        .clone();
    if settings
        .api_keys
        .get(&provider.id)
        .map(|k| k.trim().is_empty())
        .unwrap_or(true)
    {
        return Ok(TestResult {
            ok: false,
            detail: format!("未填写 {} 的 API Key", provider.name),
        });
    }
    let req = RunRequest {
        prompt: "Reply with exactly: OK".to_string(),
        model: model.clone(),
        provider_id: provider.id.clone(),
        effort: "low".to_string(),
        approval: settings.approval.clone(),
        sandbox: "read-only".to_string(),
        // A connection check only tests the selected model; it must not depend
        // on the user's project folder or run from that folder.
        workdir: std::env::temp_dir().to_string_lossy().into_owned(),
        eva: false,
    };
    let (mut cmd, key_env) = build_codex_command(&settings, &req)?;
    if let Some((k, v)) = key_env {
        cmd.env(k, v);
    }
    let run = async {
        let out = cmd.output().await.map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let ok = out.status.success();
        Ok::<(bool, String), String>((ok, stdout))
    };
    match tokio::time::timeout(std::time::Duration::from_secs(90), run).await {
        Ok(Ok((true, _))) => Ok(TestResult {
            ok: true,
            detail: format!("{} / {} 连通正常", provider.name, model),
        }),
        Ok(Ok((false, stdout))) => {
            // Surface the last error line so the user sees the real reason.
            let last = stdout
                .lines()
                .rev()
                .find(|l| l.contains("error") || l.contains("failed"))
                .unwrap_or("调用失败，请检查 Key 与模型名")
                .to_string();
            Ok(TestResult {
                ok: false,
                detail: last,
            })
        }
        Ok(Err(e)) => Ok(TestResult {
            ok: false,
            detail: format!("启动失败：{e}"),
        }),
        Err(_) => Ok(TestResult {
            ok: false,
            detail: "连接超时（90 秒），请检查网络与 Key".to_string(),
        }),
    }
}
