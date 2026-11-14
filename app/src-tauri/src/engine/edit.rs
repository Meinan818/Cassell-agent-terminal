//! Exact-string file editing.
//!
//! Claude Code and Codex both prefer precise replacements over rewriting a
//! whole file. This small helper keeps that safety property testable without
//! coupling it to Tauri or the agent loop.

pub fn replace_exact(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<String, String> {
    if old_string.is_empty() {
        return Err("old_string 不能为空".to_string());
    }
    if old_string == new_string {
        return Err("old_string 和 new_string 相同，没有改动".to_string());
    }
    let occurrences = content.matches(old_string).count();
    if occurrences == 0 {
        return Err("没有找到要替换的 old_string".to_string());
    }
    if occurrences > 1 && !replace_all {
        return Err(format!(
            "old_string 出现了 {occurrences} 次；请缩小范围，或明确设置 replace_all"
        ));
    }
    Ok(if replace_all {
        content.replace(old_string, new_string)
    } else {
        content.replacen(old_string, new_string, 1)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_one_exact_occurrence() {
        assert_eq!(
            replace_exact("alpha beta", "beta", "gamma", false).unwrap(),
            "alpha gamma"
        );
    }

    #[test]
    fn refuses_ambiguous_replacement() {
        assert!(replace_exact("a a", "a", "b", false).is_err());
        assert_eq!(replace_exact("a a", "a", "b", true).unwrap(), "b b");
    }

    #[test]
    fn handles_chinese_without_byte_slicing() {
        assert_eq!(
            replace_exact("你好世界", "世界", "专员", false).unwrap(),
            "你好专员"
        );
    }
}
