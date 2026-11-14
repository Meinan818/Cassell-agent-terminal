//! Structured tool outcome.
//!
//! The old pipeline returned a bare `String`; the UI then guessed whether a
//! result was running, done, or an error from text patterns. This type keeps
//! the display text but adds explicit status, error flag and timing so the
//! event stream and journal can answer "what happened" without regexes.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ToolStatus {
    Ran,
    ApprovedBySession,
    DeniedByRule,
    DeniedByUser,
    AskedInSession,
    DeniedBySession,
    AskExpired,
    AskRefusedNoSurface,
    HookBlocked,
    ValidationFailed,
    DuplicateCall,
    TimedOut,
    Error,
    Unrecognized,
}

impl ToolStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolStatus::Ran => "ran",
            ToolStatus::ApprovedBySession => "approved_by_session",
            ToolStatus::DeniedByRule => "denied_by_rule",
            ToolStatus::DeniedByUser => "denied_by_user",
            ToolStatus::AskedInSession => "asked_in_session",
            ToolStatus::DeniedBySession => "denied_by_session",
            ToolStatus::AskExpired => "ask_expired",
            ToolStatus::AskRefusedNoSurface => "ask_refused_no_surface",
            ToolStatus::HookBlocked => "hook_blocked",
            ToolStatus::ValidationFailed => "validation_failed",
            ToolStatus::DuplicateCall => "duplicate_call",
            ToolStatus::TimedOut => "timed_out",
            ToolStatus::Error => "error",
            ToolStatus::Unrecognized => "unrecognized",
        }
    }

    pub fn is_error(self) -> bool {
        !matches!(self, ToolStatus::Ran | ToolStatus::ApprovedBySession)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolOutcome {
    pub content: String,
    pub status: ToolStatus,
    pub is_error: bool,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl ToolOutcome {
    pub fn classify(content: String, elapsed: Duration) -> Self {
        let status = classify_text(&content);
        Self {
            content,
            status,
            is_error: status.is_error(),
            duration_ms: elapsed.as_millis() as u64,
            details: None,
        }
    }
}

/// Transitional classifier for the existing handlers. New handlers should
/// construct `ToolOutcome` directly when they are touched; the status is still
/// explicit in every event instead of being inferred in the UI.
fn classify_text(text: &str) -> ToolStatus {
    let t = text.trim_start();
    if t.starts_with("用户没有批准") || t.starts_with("用户没有批准这次") {
        return ToolStatus::DeniedByUser;
    }
    if t.starts_with("未授权")
        || t.starts_with("计划模式")
        || t.starts_with("当前是只读")
        || t.starts_with("我是诺玛")
        || t.starts_with("这条命令太危险")
        || t.starts_with("这条命令会读取敏感路径")
        || t.starts_with("这条命令") && t.contains("已拒绝")
    {
        return ToolStatus::DeniedByRule;
    }
    if t.starts_with("命令超时") {
        return ToolStatus::TimedOut;
    }
    if t.starts_with("要打开的网址为空") {
        return ToolStatus::ValidationFailed;
    }
    if t.starts_with("未知工具") {
        return ToolStatus::Unrecognized;
    }
    if t.starts_with("执行失败")
        || t.starts_with("读取失败")
        || t.starts_with("写入失败")
        || t.starts_with("编辑失败")
        || t.starts_with("编辑写入失败")
        || t.starts_with("列表目录失败")
        || t.starts_with("列目录失败")
        || t.starts_with("读取文件失败")
    {
        return ToolStatus::Error;
    }
    ToolStatus::Ran
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_user_denial_and_rule_denial() {
        assert_eq!(
            classify_text("用户没有批准这次写入（a.txt 没动）。"),
            ToolStatus::DeniedByUser
        );
        assert_eq!(
            classify_text("当前是只读模式，不能改文件。"),
            ToolStatus::DeniedByRule
        );
        assert_eq!(
            classify_text("这条命令太危险了（删根目录），我拒绝执行：`rm -rf /`"),
            ToolStatus::DeniedByRule
        );
    }

    #[test]
    fn classifies_error_timeout_and_success() {
        assert_eq!(classify_text("读取失败：No such file"), ToolStatus::Error);
        assert_eq!(classify_text("命令超时（120 秒）"), ToolStatus::TimedOut);
        assert_eq!(classify_text("已写入 a.txt（3 字节）"), ToolStatus::Ran);
        assert_eq!(classify_text("终端还没有输出"), ToolStatus::Ran);
    }
}
