//! Context-shaping helpers inspired by DeepSeek Harness and Tianshu.
//!
//! Tool output is kept verbatim for the UI, but the model gets a bounded
//! head/tail view when the result is large. This prevents one noisy command
//! from eating the whole context and destroying prefix-cache value.

pub const TOOL_RESULT_HEAD_CHARS: usize = 4096;
pub const TOOL_RESULT_TAIL_CHARS: usize = 1024;

/// Conservative context windows. DeepSeek V4.1 exposes 1M; other BYOK
/// providers get a safer 128k default until the model catalog carries a
/// per-model window.
pub fn context_window_tokens(model: &str) -> usize {
    if model.to_ascii_lowercase().contains("deepseek") {
        1_000_000
    } else {
        128_000
    }
}

/// Rough token estimate: CJK characters count as one token, other printable
/// characters as roughly four per token. It is only used for budget decisions,
/// never for billing or display of "real" usage.
pub fn estimate_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut other = 0usize;
    for c in text.chars() {
        if (c as u32) >= 0x2E80 {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    cjk + other.div_ceil(4)
}

pub fn estimate_message_tokens(message: &serde_json::Value) -> usize {
    let mut total = 4; // role/separator overhead
    if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
        total += estimate_tokens(text);
    }
    if let Some(calls) = message.get("tool_calls") {
        total += estimate_tokens(&calls.to_string());
    }
    total
}

pub fn estimate_messages_tokens(messages: &[serde_json::Value]) -> usize {
    messages.iter().map(estimate_message_tokens).sum()
}

/// Keep the beginning and end of a large tool result. Character-based slicing
/// is intentional: byte slicing can split a Chinese character.
pub fn prune_tool_result(text: &str) -> String {
    let count = text.chars().count();
    let budget = TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS;
    if count <= budget {
        return text.to_string();
    }
    let head: String = text.chars().take(TOOL_RESULT_HEAD_CHARS).collect();
    let tail: String = text
        .chars()
        .skip(count - TOOL_RESULT_TAIL_CHARS)
        .collect();
    format!(
        "{head}\n\n…[工具结果中间省略 {} 字符，完整内容仍在界面]…\n\n{tail}",
        count - budget
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_result_is_unchanged() {
        assert_eq!(prune_tool_result("ok"), "ok");
    }

    #[test]
    fn large_result_keeps_head_tail_and_does_not_split_chinese() {
        let text = "中".repeat(6000);
        let pruned = prune_tool_result(&text);
        assert!(pruned.starts_with("中"));
        assert!(pruned.ends_with("中"));
        assert!(pruned.contains("省略 880 字符"));
        assert!(pruned.chars().count() < 6000);
    }

    #[test]
    fn token_estimate_is_conservative_for_chinese() {
        assert!(estimate_tokens("你好世界") >= 4);
        assert!(estimate_tokens("hello world") >= 2);
        assert_eq!(context_window_tokens("deepseek-flash"), 1_000_000);
        assert_eq!(context_window_tokens("gpt-6.1"), 128_000);
    }
}
