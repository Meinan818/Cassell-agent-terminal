//! Shared state for the native agent runtime.
//!
//! The old `codex.rs` driver (shelling out to the Codex CLI) has been removed:
//! the product is BYOK + OpenAI-compatible HTTP, so there is exactly one agent
//! engine (`agent.rs`). This module only owns the cross-command state.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use tokio::sync::{oneshot, Mutex};

pub struct RunState {
    /// Set by cancel_run; the native engine polls it while streaming.
    pub native_cancel: AtomicBool,
    /// True while a native run is in flight.
    pub native_running: AtomicBool,
    /// Pending interactive approvals: request id -> channel to resolve it.
    pub approvals: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
    /// Per-task, per-kind approvals chosen as "allow for this session".
    pub session_approvals: Mutex<HashSet<String>>,
    /// Goal sessions keyed by task id.
    pub goals: Mutex<HashMap<String, crate::goal::GoalSession>>,
    /// Process-local usage totals (the ledger handles cross-restart totals).
    pub session_usage: Mutex<crate::usage::UsageStats>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    AllowOnce,
    AllowSession,
    Deny,
}

impl ApprovalDecision {
    pub fn is_allowed(self) -> bool {
        matches!(self, ApprovalDecision::AllowOnce | ApprovalDecision::AllowSession)
    }
}

fn approval_key(task_id: &str, kind: &str) -> String {
    format!("{task_id}\u{0}{kind}")
}

impl RunState {
    /// Deny every pending approval so a stopped run never hangs on a decision
    /// that will never come.
    pub async fn deny_all_approvals(&self) {
        let mut map = self.approvals.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(ApprovalDecision::Deny);
        }
    }

    pub async fn remember_session_approval(&self, task_id: &str, kind: &str) {
        self.session_approvals
            .lock()
            .await
            .insert(approval_key(task_id, kind));
    }

    pub async fn has_session_approval(&self, task_id: &str, kind: &str) -> bool {
        self.session_approvals
            .lock()
            .await
            .contains(&approval_key(task_id, kind))
    }
}

#[tauri::command]
pub async fn cancel_run(state: State<'_, RunState>) -> Result<bool, String> {
    let mut stopped = false;
    if state.native_running.load(Ordering::SeqCst) {
        state.native_cancel.store(true, Ordering::SeqCst);
        stopped = true;
    }
    state.deny_all_approvals().await;
    Ok(stopped)
}
