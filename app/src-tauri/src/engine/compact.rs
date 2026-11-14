//! Context compaction: archive old messages, keep a bounded recent window and
//! insert an extractive summary.
//!
//! This is the first deterministic version. It does not call a model, so it is
//! safe/fast and can run before every request. The archived original is written
//! by `engine::session::archive_messages`; a future version can replace the
//! extractive summary with a `compression_model` summary without changing the
//! call site.

use crate::engine::context::{estimate_message_tokens, estimate_messages_tokens};
use serde_json::{json, Value};

pub const COMPACT_TRIGGER_RATIO: f64 = 0.80;
pub const COMPACT_KEEP_RATIO: f64 = 0.45;

pub struct CompactResult {
    pub removed: Vec<Value>,
    pub summary: String,
    pub before_tokens: usize,
    pub after_tokens: usize,
}

/// CacheAdvisor's core trade-off: protect a warm prefix while context pressure
/// is low; let compaction run once pressure grows. Kept pure so it can be
/// tested and later fed by real hit-rate metrics.
#[allow(dead_code)] // wired to real hit-rate telemetry after the context meter lands
pub fn cache_protection(hit_rate: f64, pressure: f64) -> f64 {
    hit_rate.clamp(0.0, 1.0) * (1.0 - pressure.clamp(0.0, 1.0))
}

#[allow(dead_code)]
pub fn should_delay_compaction(hit_rate: f64, pressure: f64) -> bool {
    cache_protection(hit_rate, pressure) >= 0.45
}

fn role_of(message: &Value) -> &str {
    message.get("role").and_then(|v| v.as_str()).unwrap_or("")
}

fn summarize_removed(messages: &[Value]) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    for m in messages {
        let role = role_of(m);
        let text = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let line = if !text.trim().is_empty() {
            let short: String = text.trim().chars().take(180).collect();
            format!("- {role}: {short}")
        } else if m.get("tool_calls").is_some() {
            format!("- {role}: [工具调用]")
        } else if role == "tool" {
            "- tool: [工具结果已归档]".to_string()
        } else {
            continue;
        };
        if out.chars().count() + line.chars().count() > 1800 {
            out.push_str("\n- …（更早内容已归档）");
            break;
        }
        out.push_str(&line);
        out.push('\n');
        count += 1;
        if count >= 40 {
            out.push_str("- …（更早内容已归档）");
            break;
        }
    }
    if out.trim().is_empty() {
        "（较早的对话已归档。）".to_string()
    } else {
        out
    }
}

/// Compact only if the estimated messages exceed 80% of the window. The cut is
/// moved forward to a `user` message so a kept tool result never loses its
/// preceding assistant/tool-call pair.
pub fn compact_messages(messages: &mut Vec<Value>, window_tokens: usize) -> Option<CompactResult> {
    if messages.len() < 8 || window_tokens == 0 {
        return None;
    }
    let before_tokens = estimate_messages_tokens(messages);
    let trigger = (window_tokens as f64 * COMPACT_TRIGGER_RATIO) as usize;
    if before_tokens < trigger {
        return None;
    }

    let keep_budget = (window_tokens as f64 * COMPACT_KEEP_RATIO) as usize;
    let mut acc = 0usize;
    let mut cut = messages.len();
    for i in (1..messages.len()).rev() {
        acc += estimate_message_tokens(&messages[i]);
        if acc > keep_budget {
            cut = i;
            break;
        }
    }
    while cut < messages.len() && role_of(&messages[cut]) != "user" {
        cut += 1;
    }
    if cut <= 1 || cut >= messages.len() {
        return None;
    }

    let removed: Vec<Value> = messages.drain(1..cut).collect();
    let summary = summarize_removed(&removed);
    let note = format!(
        "【较早对话的归档摘要】\n{summary}\n（完整原文已归档；需要细节时请让用户提供对应片段。）"
    );
    messages.insert(1, json!({"role": "user", "content": note}));
    let after_tokens = estimate_messages_tokens(messages);
    Some(CompactResult {
        removed,
        summary,
        before_tokens,
        after_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(i: usize) -> Vec<Value> {
        vec![
            json!({"role": "user", "content": format!("用户消息 {i} {}", "内容".repeat(120))}),
            json!({"role": "assistant", "content": format!("助手回复 {i} {}", "回复".repeat(120))}),
        ]
    }

    #[test]
    fn compacts_long_history_at_user_boundary() {
        let mut messages = vec![json!({"role": "system", "content": "system"})];
        for i in 0..20 {
            messages.extend(turn(i));
        }
        let result = compact_messages(&mut messages, 800).expect("should compact");
        assert!(!result.removed.is_empty());
        assert!(result.after_tokens < result.before_tokens);
        assert_eq!(role_of(&messages[0]), "system");
        assert_eq!(role_of(&messages[1]), "user");
        assert!(messages[1]["content"].as_str().unwrap().contains("归档摘要"));
    }

    #[test]
    fn leaves_short_history_alone() {
        let mut messages = vec![json!({"role": "system", "content": "system"})];
        messages.extend(turn(0));
        assert!(compact_messages(&mut messages, 1_000_000).is_none());
    }

    #[test]
    fn cache_advisor_formula() {
        assert!(should_delay_compaction(0.9, 0.3));
        assert!(!should_delay_compaction(0.9, 0.9));
        assert!(!should_delay_compaction(0.2, 0.1));
    }
}
