//! A small local shell for the terminal tab: runs the user's own command
//! in the workdir and returns stdout / stderr / exit code. 30s timeout.

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

#[tauri::command]
pub async fn run_shell(command: String, workdir: String) -> Result<ShellResult, String> {
    if command.trim().is_empty() {
        return Err("命令为空".to_string());
    }
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };
    if !workdir.trim().is_empty() {
        cmd.current_dir(&workdir);
    }
    crate::hide_console(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 超时后丢弃 output future 时，连带结束子进程，避免 git 等命令
        // 卡住后在后端留下孤儿进程。
        .kill_on_drop(true);

    let run = cmd.output();
    match tokio::time::timeout(std::time::Duration::from_secs(30), run).await {
        Ok(Ok(out)) => Ok(ShellResult {
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            code: out.status.code(),
        }),
        Ok(Err(e)) => Err(format!("执行失败：{e}")),
        Err(_) => Err("命令超时（30 秒）".to_string()),
    }
}
