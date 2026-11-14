//! Context compaction: archive old messages, keep a bounded recent window and
//! insert a summary.
//!
//! The first version uses an extractive summary. The agent can now replace it
//! with a `compression_model` summary; if that call fails, it falls back to the
//! extractive text. The archived original is always written by
//! `engine::session::archive_messages` before replacement.

use crate::engine::context::{estimate_message_tokens, estimate_messages_tokens};
use crate::settings::ProviderConfig;
use serde_json::{json, Value};

pub const COMPACT_TRIGGER_RATIO: f64 = 0.80;
pub const COMPACT_KEEP_RATIO: f64 = 0.45;

pub struct CompactResult {
    pub removed: Vec<Value>,
    pub summary: String,
    pub before_tokens: usize,
    pub after_tokens: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct CompactionPlan {
    pub cut: usize,
    pub before_tokens: usize,
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

pub fn extractive_summary(messages: &[Value]) -> String {
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

/// Decide where to cut. The cut is moved forward to a `user` message so a kept
/// tool result never loses its preceding assistant/tool-call pair.
pub fn plan_compaction(messages: &[Value], window_tokens: usize) -> Option<CompactionPlan> {
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
    Some(CompactionPlan {
        cut,
        before_tokens,
    })
}

pub fn apply_compaction(
    messages: &mut Vec<Value>,
    plan: CompactionPlan,
    summary: String,
) -> CompactResult {
    let removed: Vec<Value> = messages.drain(1..plan.cut).collect();
    let note = format!(
        "【较早对话的归档摘要】\n{summary}\n（完整原文已归档；需要细节时请让用户提供对应片段。）"
    );
    messages.insert(1, json!({"role": "user", "content": note}));
    let after_tokens = estimate_messages_tokens(messages);
    CompactResult {
        removed,
        summary,
        before_tokens: plan.before_tokens,
        after_tokens,
    }
}

/// Deterministic fallback used by tests and by the agent when the compression
/// model is not configured or its call fails.
#[allow(dead_code)]
pub fn compact_messages(messages: &mut Vec<Value>, window_tokens: usize) -> Option<CompactResult> {
    let plan = plan_compaction(messages, window_tokens)?;
    let preview: Vec<Value> = messages[1..plan.cut].to_vec();
    let summary = extractive_summary(&preview);
    Some(apply_compaction(messages, plan, summary))
}

fn flatten_for_summary(messages: &[Value]) -> String {
    let mut out = String::new();
    for m in messages {
        let role = role_of(m);
        let text = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let line = if !text.trim().is_empty() {
            let short: String = text.trim().chars().take(4000).collect();
            format!("[{role}] {short}\n")
        } else if m.get("tool_calls").is_some() {
            format!("[{role}] [工具调用]\n")
        } else {
            continue;
        };
        if out.chars().count() + line.chars().count() > 80_000 {
            out.push_str("…（更多内容已省略）\n");
            break;
        }
        out.push_str(&line);
    }
    out
}

/// Ask the configured compression model for a continuation-oriented summary.
/// Non-streaming and bounded: the caller falls back to `extractive_summary`
/// on any failure. The model/provider pair is explicitly passed in so the
/// summary can use a different model from the main conversation.
pub async fn summarize_with_model(
    client: &reqwest::Client,
    url: &str,
    key: &str,
    provider: &ProviderConfig,
    compression_model: &str,
    messages: &[Value],
) -> Result<String, String> {
    let input = flatten_for_summary(messages);
    if input.trim().is_empty() {
        return Err("没有可摘要的历史消息".to_string());
    }
    let wire_model = crate::models::resolve_model(&provider.kind, compression_model);
    let mut body = json!({
        "model": wire_model,
        "messages": [
            {"role": "system", "content": "你是上下文压缩器。把下面的旧对话压缩成供后续继续工作的摘要：保留目标、已完成事项、关键文件/命令、失败与未决问题、重要证据；不要编造，不要输出寒暄。用简体中文，控制在 1200 字以内。"},
            {"role": "user", "content": input}
        ],
        "stream": false,
        "temperature": 0.2,
        "max_tokens": 2048
    });
    crate::engine::deepseek::apply_request_fields(&mut body, provider, "low");
    let resp = crate::engine::retry::post_json_with_retry(client, url, key, &body, |_, _, _| {})
        .await
        .map_err(|e| format!("压缩模型请求失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("压缩模型返回 {}", resp.status()));
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|e| format!("压缩模型响应解析失败：{e}"))?;
    let summary = value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if summary.is_empty() {
        return Err("压缩模型返回空摘要".to_string());
    }
    Ok(summary)
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
