//! Context-shaping helpers inspired by DeepSeek Harness and Tianshu.
//!
//! Tool output is kept verbatim for the UI, but the model gets a bounded
//! head/tail view when the result is large. This prevents one noisy command
//! from eating the whole context and destroying prefix-cache value.

pub const TOOL_RESULT_HEAD_CHARS: usize = 4096;
pub const TOOL_RESULT_TAIL_CHARS: usize = 1024;

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
}
