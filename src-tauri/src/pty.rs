//! P0-11④ 真终端：每对话一个真 PTY。
//!
//! 前端 xterm.js 只负责渲染与键盘输入，shell 跑在后端 portable-pty 里：
//! 持续会话、交互程序（vim / top / dev server）都能跑，Ctrl+C、清屏、
//! 上下翻历史都是 shell 自己的行为，不是前端模拟的。
//!
//! - PTY 按会话 id 存（前端 task id，普通对话是 "default"），
//!   Inspector 终端页签切走再回来不会丢会话；前端重挂载时用
//!   `pty_snapshot` 把环形缓冲里的历史输出写回去。
//! - 输出进环形缓冲（上限 128KB），agent 的 `read_terminal` 工具
//!   读它——构建挂了，问一句就能让 agent 读终端输出找错。
//! - Windows 上 portable-pty 走 ConPTY，没有可见控制台窗口，
//!   不会把之前 CREATE_NO_WINDOW 修好的闪屏又带回来。

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// 环形缓冲上限（字节）：超出后从头丢掉最旧的输出。
const OUTPUT_CAP: usize = 128 * 1024;
/// 前端/工具读快照时最多返回的字符数。
const SNAPSHOT_CHARS: usize = 32_000;

pub struct PtySession {
    id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// 写端只能取一次（take_writer），spawn 时取出来存在这里；
    /// 前端每一次按键都经它写进 PTY。
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>,
    output: Mutex<Vec<u8>>,
}

pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PtySpawned {
    /// true = 本次新建了一个 PTY；false = 会话已存在，直接复用。
    pub created: bool,
    pub id: String,
}

fn shell_program() -> String {
    #[cfg(windows)]
    {
        "cmd".to_string()
    }
    #[cfg(not(windows))]
    {
        match std::env::var("SHELL") {
            Ok(s) if !s.trim().is_empty() => s,
            _ => "sh".to_string(),
        }
    }
}

/// 新建（或复用）一个 PTY 会话。幂等：会话已存在且子进程还活着时
/// 直接返回 created=false，前端用快照回填即可。
#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    workdir: String,
    cols: u16,
    rows: u16,
) -> Result<PtySpawned, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("会话 id 为空".to_string());
    }
    {
        let sessions = state.sessions.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
        if let Some(s) = sessions.get(&id) {
            let alive = {
                let mut child = s.child.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
                match child.as_mut() {
                    Some(c) => matches!(c.try_wait(), Ok(None)),
                    None => false,
                }
            };
            if alive {
                return Ok(PtySpawned { created: false, id });
            }
        }
    }
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|e| format!("打不开 PTY：{e}"))?;
    let mut cmd = CommandBuilder::new(shell_program());
    if !workdir.trim().is_empty() {
        cmd.cwd(&workdir);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("起 shell 失败：{e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("拿 PTY 写端失败：{e}"))?;
    let session = Arc::new(PtySession {
        id: id.clone(),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(Some(child)),
        output: Mutex::new(Vec::new()),
    });
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "PTY 状态锁坏了".to_string())?;
        sessions.insert(id.clone(), session.clone());
    }
    // 读线程：把 PTY 输出写进环形缓冲，同时发事件给前端。
    let app2 = app.clone();
    let session2 = session.clone();
    std::thread::spawn(move || {
        let mut reader = match session2.master.lock().unwrap().try_clone_reader() {
            Ok(r) => r,
            Err(_) => return,
        };
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    {
                        let mut out = session2.output.lock().unwrap();
                        out.extend_from_slice(chunk);
                        if out.len() > OUTPUT_CAP {
                            let drop = out.len() - OUTPUT_CAP;
                            out.drain(..drop);
                        }
                    }
                    let text = String::from_utf8_lossy(chunk).into_owned();
                    let _ = app2.emit(
                        "pty-output",
                        serde_json::json!({ "id": session2.id, "data": text }),
                    );
                }
                Err(_) => break,
            }
        }
        let code = {
            let mut child = session2.child.lock().unwrap();
            match child.as_mut() {
                Some(c) => c.try_wait().ok().flatten().map(|s| s.exit_code()),
                None => None,
            }
        };
        let _ = app2.emit(
            "pty-exited",
            serde_json::json!({ "id": session2.id, "code": code }),
        );
    });
    Ok(PtySpawned { created: true, id })
}

/// 往 PTY 里写键盘输入（xterm.js 的 onData 原样送过来，
/// 包括 Ctrl+C 的 0x03、回车 \r、粘贴的多行文本）。
#[tauri::command]
pub async fn pty_write(
    state: State<'_, PtyState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let session = get_session(&state, &id)?;
    let mut writer = session.writer.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
    use std::io::Write;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写 PTY 失败：{e}"))?;
    writer.flush().map_err(|e| format!("写 PTY 失败：{e}"))?;
    Ok(())
}

/// 前端尺寸变化时同步给 PTY（xterm.js 的 FitAddon 算出 cols/rows）。
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = get_session(&state, &id)?;
    let master = session.master.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY 改尺寸失败：{e}"))
}

/// 读环形缓冲的尾部（前端重挂载回填、agent 的 read_terminal 工具都走这里）。
#[tauri::command]
pub async fn pty_snapshot(state: State<'_, PtyState>, id: String) -> Result<String, String> {
    let session = get_session(&state, &id)?;
    let out = session.output.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
    let text = String::from_utf8_lossy(&out).into_owned();
    Ok(tail_chars(&text, SNAPSHOT_CHARS))
}

/// 杀掉子进程、关闭会话。前端一般不调（会话随对话留着），
/// 任务删除/应用退出时清理用。
#[tauri::command]
pub async fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "PTY 状态锁坏了".to_string())?;
        sessions.remove(&id)
    };
    if let Some(s) = session {
        let mut child = s.child.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
        if let Some(mut c) = child.take() {
            let _ = c.kill();
        }
    }
    Ok(())
}

/// agent 的 `read_terminal` 工具走这里：拿指定会话的最近输出。
/// 会话不存在（用户一次没打开过终端）时返回空串，工具层会报“终端还没有输出”。
pub fn snapshot_for_agent(app: &AppHandle, id: &str) -> String {
    let state = app.state::<PtyState>();
    let sessions = match state.sessions.lock() {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let Some(session) = sessions.get(id) else {
        return String::new();
    };
    let Ok(out) = session.output.lock() else {
        return String::new();
    };
    tail_chars(&String::from_utf8_lossy(&out), SNAPSHOT_CHARS)
}

fn get_session(state: &State<'_, PtyState>, id: &str) -> Result<Arc<PtySession>, String> {
    let sessions = state.sessions.lock().map_err(|_| "PTY 状态锁坏了".to_string())?;
    sessions
        .get(id)
        .cloned()
        .ok_or_else(|| format!("终端会话不存在：{id}"))
}

/// 保留字符串尾部最多 n 个字符（按字符切，不切半个汉字）。
fn tail_chars(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_string();
    }
    s.chars().skip(s.chars().count() - n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_chars_keeps_tail_only() {
        assert_eq!(tail_chars("abcdef", 3), "def");
        assert_eq!(tail_chars("你好世界", 2), "世界");
        assert_eq!(tail_chars("ab", 10), "ab");
    }

    /// 真 PTY：起一个 shell，echo 一行，等输出进缓冲，再确认快照能读到。
    /// 这是 P0-11④ 的核心回归：PTY 不是模拟的，输出必须真实流过。
    #[test]
    fn pty_echo_roundtrip() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("echo PTY-PING-123; sleep 0.2");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut buf = Vec::new();
        let mut tmp = [0u8; 1024];
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(5) {
            match reader.read(&mut tmp) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&tmp[..n]);
                    if String::from_utf8_lossy(&buf).contains("PTY-PING-123") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
        assert!(
            String::from_utf8_lossy(&buf).contains("PTY-PING-123"),
            "PTY 输出里没读到回显：{}",
            String::from_utf8_lossy(&buf)
        );
    }
}
