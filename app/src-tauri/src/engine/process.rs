//! Child-process execution with a hard timeout.
//!
//! `kill_on_drop` only terminates the direct child. A shell command such as
//! `npm run dev` spawns a process tree, so on Windows we additionally run
//! `taskkill /F /T /PID <pid>` before dropping the child. The direct child is
//! still the one whose stdout/stderr we collect; the tree kill prevents orphan
//! Node/Cargo processes from holding ports or file locks.

use std::process::Output;
use std::time::Duration;
use tokio::process::Command;

pub enum RunOutput {
    Completed(Output),
    TimedOut,
}

pub async fn output_with_timeout(
    mut cmd: Command,
    timeout: Duration,
) -> Result<RunOutput, String> {
    cmd.stdin(std::process::Stdio::null());
    cmd.kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| format!("执行失败：{e}"))?;
    let pid = child.id();
    let fut = child.wait_with_output();
    tokio::pin!(fut);

    match tokio::time::timeout(timeout, &mut fut).await {
        Ok(Ok(output)) => Ok(RunOutput::Completed(output)),
        Ok(Err(e)) => Err(format!("执行失败：{e}")),
        Err(_) => {
            #[cfg(windows)]
            if let Some(pid) = pid {
                let mut kill = Command::new("taskkill");
                kill.args(["/F", "/T", "/PID", &pid.to_string()]);
                crate::hide_console(&mut kill);
                let _ = kill.output().await;
            }
            // Returning drops the pinned wait future; kill_on_drop is the
            // last-resort direct-child kill if taskkill itself failed.
            Ok(RunOutput::TimedOut)
        }
    }
}
