//! UTF-8 安全截断：所有"按字节上限截断"的地方都走这里，避免切在多字节
//! 字符中间导致 panic 或半截汉字。
//!
//! Rust 的 `str` 切片必须落在字符边界上；服务商错误信息、命令输出、文件预览
//! 都可能是中文，固定写 `&s[..600]` / `s.truncate(20_000)` 会在边界处 panic。

/// 把字节下标向下取到最近的字符边界；越界返回字符串长度。
pub fn floor_char_boundary(s: &str, mut index: usize) -> usize {
    if index >= s.len() {
        return s.len();
    }
    while index > 0 && !s.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// 取字符串前 `max_bytes` 字节以内的最大合法前缀。
/// 长度未超上限时原样返回；超了才在字符边界处截断。
pub fn truncate(s: &str, max_bytes: usize) -> &str {
    &s[..floor_char_boundary(s, max_bytes)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_unchanged() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello", 3), "hel");
    }

    #[test]
    fn chinese_never_splits_a_character() {
        let s = "你好世界";
        // "你好" = 6 字节；第 7 字节落在"世"字中间，必须退回到 6。
        assert_eq!(truncate(s, 7), "你好");
        assert_eq!(truncate(s, 6), "你好");
        assert_eq!(truncate(s, 8), "你好");
        // 边界正好也在合法位置时正常保留。
        assert_eq!(truncate(s, 9), "你好世");
        assert_eq!(truncate(s, 12), "你好世界");
    }

    #[test]
    fn overlong_index_is_clamped() {
        let s = "中文abc";
        assert_eq!(truncate(s, 999), "中文abc");
        assert_eq!(floor_char_boundary(s, 999), s.len());
    }
}
