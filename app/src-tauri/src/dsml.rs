//! P0-2 DSML 工具调用恢复（天枢 T5，两层网）。
//!
//! 背景：接反代网关（如 workbuddyapi2）时，网关可能把模型本应发出的
//! 结构化 tool_calls 压成正文里的一段标记文本再返回，或者直接弄丢。
//! 没有这层网，工具调用蒸发成纯文本、会话静默结束——用户只看到
//! 一段“我说完了”的正文，任务却没干。
//!
//! 网 #1：DSML 标记解析。DeepSeek 系网关用的格式：
//! ```text
//! <｜DSML｜tool_calls>
//!   <｜DSML｜invoke name="read_file">
//!     <｜DSML｜parameter name="path" string="true">/x/y.txt</｜DSML｜parameter>
//!   </｜DSML｜invoke>
//! </｜DSML｜tool_calls>
//! ```
//! （竖线可能是全角 ｜ 也可能是半角 |，两种都认。）
//! 另认三种同类标记：`<tool_call>`、`<function_calls>`、
//! `<invoke name="…">`、`<function=…>`。
//!
//! 网 #2：JSON 兜底。正文里裸露的 `{"name": "read_file", "arguments": {...}}`
//! 对象，解析出来执行。
//!
//! 两层网都跳过 Markdown 字面量区（围栏代码块与行内代码）：正文里
//! 举例子的代码不是调用，绝不能误执行。
//! 只恢复名字在工具表里的调用；未知工具、参数解析失败的直接丢弃。
//! 恢复出的调用带 `"type": "function"` 与合成 id，可直接走正常执行路径，
//! 不会触发 422（见 agent.rs 的 merge_tool_call_delta）。
//!
//! 触发条件（在 agent.rs 的每轮流式结束后）：结构化 tool_calls 为空，
//! 但正文非空。恢复出调用 → 当作正常工具调用执行；恢复不出来，
//! 但正文明显像在调用工具（`looks_like_tool_attempt`）→ 提醒模型
//! 用结构化调用重发一次（每轮最多一次提醒），还不出来就按正常
//! 结束——绝不无限重试。

use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

/// 一次恢复出来的工具调用。
#[derive(Debug, Clone, PartialEq)]
pub struct RecoveredCall {
    /// 工具名（已确认在工具表里）。
    pub name: String,
    /// 参数对象。
    pub arguments: Value,
    /// 哪层网恢复的："dsml" / "markup" / "json"，写进日志。
    pub source: &'static str,
}

/// 最多恢复几个调用（防正文里塞一堆标记把预算烧光）。
const MAX_RECOVERED: usize = 8;

static DSML_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<[｜|]DSML[｜|]tool_calls\s*>(.*?)</[｜|]DSML[｜|]tool_calls\s*>")
        .unwrap()
});
static DSML_INVOKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<[｜|]DSML[｜|]invoke\s+name="([^"]+)"\s*>(.*?)</[｜|]DSML[｜|]invoke>"#)
        .unwrap()
});
static DSML_PARAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?s)<[｜|]DSML[｜|]parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>(.*?)</[｜|]DSML[｜|]parameter>"#,
    )
    .unwrap()
});
static TOOL_CALL_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<tool_call>(.*?)</tool_call>").unwrap());
static FUNCTION_CALLS_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<function_calls>(.*?)</function_calls>").unwrap());
static INVOKE_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<invoke\s+name="([^"]+)"\s*>(.*?)</invoke>"#).unwrap()
});
static FUNCTION_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<function=([^ >]+)>(.*?)</function>").unwrap()
});

/// Markdown 字面量区：围栏代码块（```...```）与行内代码（`...`）。
/// 返回字节区间，恢复时跳过这些区间里的任何匹配。
fn markdown_literal_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < text.len() {
        if text[i..].starts_with("```") {
            let start = i;
            match text[i + 3..].find("```") {
                Some(end) => {
                    let close = i + 3 + end + 3;
                    ranges.push((start, close));
                    i = close;
                }
                None => {
                    ranges.push((start, text.len()));
                    break;
                }
            }
        } else if text[i..].starts_with('`') {
            let start = i;
            match text[i + 1..].find('`') {
                Some(end) => {
                    let close = i + 1 + end + 1;
                    ranges.push((start, close));
                    i = close;
                }
                None => i += 1,
            }
        } else {
            // 按字符步进，不按字节：中文、全角符号都是多字节，
            // 按字节步进会在字符中间切分而 panic。
            i += text[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        }
    }
    ranges
}

fn in_literal(ranges: &[(usize, usize)], pos: usize) -> bool {
    ranges.iter().any(|(s, e)| pos >= *s && pos < *e)
}

/// 恢复成功后，把正文里的工具调用标记剥掉。
///
/// 标记已经变成结构化调用进历史了，正文再留着它只会：
/// ① 用户看到一堆原始标记，难看；
/// ② 模型在下一轮看到自己"写过"的标记，容易误判调用已经发过、
///    不再发结构化调用，任务就卡在"现在改。"这种空话上。
/// 只剥恢复网认的那几种标记块（且不在 Markdown 字面量区里的），
/// 模型自己的文字原样留着；剥完多余的空行压一压。
/// JSON 兜底恢复出来的裸 JSON 不在这里剥（没有明确的标记边界，
/// 剥错会吃掉正文）。
pub fn strip_tool_call_markup(content: &str) -> String {
    let ranges = markdown_literal_ranges(content);
    let mut cut: Vec<(usize, usize)> = Vec::new();
    for re in [&DSML_BLOCK, &TOOL_CALL_TAG, &FUNCTION_CALLS_TAG, &INVOKE_TAG, &FUNCTION_TAG] {
        for m in re.find_iter(content) {
            if !in_literal(&ranges, m.start()) {
                cut.push((m.start(), m.end()));
            }
        }
    }
    if cut.is_empty() {
        return content.to_string();
    }
    cut.sort_unstable();
    cut.dedup();
    let mut out = String::with_capacity(content.len());
    let mut pos = 0;
    for (s, e) in cut {
        if s < pos {
            continue;
        }
        out.push_str(&content[pos..s]);
        pos = e;
    }
    out.push_str(&content[pos..]);
    // 剥完剩下的连续空行压成最多一个空行，首尾空白去掉。
    let mut cleaned = String::with_capacity(out.len());
    let mut blanks = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 1 {
                cleaned.push('\n');
            }
        } else {
            blanks = 0;
            cleaned.push_str(line);
            cleaned.push('\n');
        }
    }
    cleaned.trim().to_string()
}
/// 顺序：DSML 标记 → 其他标记 → JSON 兜底；同名同参只留第一次。
pub fn recover_tool_calls(content: &str, known_tools: &[String]) -> Vec<RecoveredCall> {
    let mut out: Vec<RecoveredCall> = Vec::new();
    let ranges = markdown_literal_ranges(content);
    let known = |name: &str| known_tools.iter().any(|t| t == name);
    let push = |out: &mut Vec<RecoveredCall>, name: &str, args: Value, src: &'static str| {
        if out.len() >= MAX_RECOVERED || !known(name) || !args.is_object() {
            return;
        }
        let args_str = args.to_string();
        if out
            .iter()
            .any(|c| c.name == name && c.arguments.to_string() == args_str)
        {
            return;
        }
        out.push(RecoveredCall {
            name: name.to_string(),
            arguments: args,
            source: src,
        });
    };

    // —— 网 #1a：DSML 块里的 invoke + parameter ——
    for block in DSML_BLOCK.captures_iter(content) {
        let Some(m) = block.get(0) else { continue };
        if in_literal(&ranges, m.start()) {
            continue;
        }
        let inner = block.get(1).map(|g| g.as_str()).unwrap_or("");
        for inv in DSML_INVOKE.captures_iter(inner) {
            let name = inv.get(1).map(|g| g.as_str()).unwrap_or("");
            let body = inv.get(2).map(|g| g.as_str()).unwrap_or("");
            if let Some(args) = parse_dsml_invoke_body(body) {
                push(&mut out, name, args, "dsml");
            }
        }
    }

    // —— 网 #1b：其他标记 ——
    for cap in TOOL_CALL_TAG.captures_iter(content) {
        let Some(m) = cap.get(0) else { continue };
        if in_literal(&ranges, m.start()) {
            continue;
        }
        let inner = cap.get(1).map(|g| g.as_str()).unwrap_or("");
        if let Some((name, args)) = parse_call_json(inner) {
            push(&mut out, &name, args, "markup");
        }
    }
    for cap in FUNCTION_CALLS_TAG.captures_iter(content) {
        let Some(m) = cap.get(0) else { continue };
        if in_literal(&ranges, m.start()) {
            continue;
        }
        let inner = cap.get(1).map(|g| g.as_str()).unwrap_or("");
        // <function_calls> 里通常包着 <invoke name="…">json</invoke>。
        for inv in INVOKE_TAG.captures_iter(inner) {
            let name = inv.get(1).map(|g| g.as_str()).unwrap_or("");
            let body = inv.get(2).map(|g| g.as_str()).unwrap_or("");
            if let Some(args) = parse_json_args(body) {
                push(&mut out, name, args, "markup");
            }
        }
        if let Some((name, args)) = parse_call_json(inner) {
            push(&mut out, &name, args, "markup");
        }
    }
    for inv in INVOKE_TAG.captures_iter(content) {
        let Some(m) = inv.get(0) else { continue };
        if in_literal(&ranges, m.start()) {
            continue;
        }
        let name = inv.get(1).map(|g| g.as_str()).unwrap_or("");
        let body = inv.get(2).map(|g| g.as_str()).unwrap_or("");
        if let Some(args) = parse_json_args(body) {
            push(&mut out, name, args, "markup");
        }
    }
    for cap in FUNCTION_TAG.captures_iter(content) {
        let Some(m) = cap.get(0) else { continue };
        if in_literal(&ranges, m.start()) {
            continue;
        }
        let name = cap.get(1).map(|g| g.as_str()).unwrap_or("");
        let body = cap.get(2).map(|g| g.as_str()).unwrap_or("");
        if let Some(args) = parse_json_args(body) {
            push(&mut out, name, args, "markup");
        }
    }

    // —— 网 #2：JSON 兜底 ——
    for (name, args) in scan_json_calls(content, &ranges) {
        push(&mut out, &name, args, "json");
    }

    out
}

/// DSML invoke 体：先按 parameter 拼参数对象；一个 parameter 都没有时，
/// 把整段体当 JSON 参数对象解析（有的网关直接塞 JSON）。
fn parse_dsml_invoke_body(body: &str) -> Option<Value> {
    let mut obj = serde_json::Map::new();
    for p in DSML_PARAM.captures_iter(body) {
        let name = p.get(1).map(|g| g.as_str()).unwrap_or("");
        let is_string = p.get(2).map(|g| g.as_str()) == Some("true");
        let raw = p.get(3).map(|g| g.as_str()).unwrap_or("");
        let value = if is_string {
            Value::String(raw.to_string())
        } else {
            // string="false" 或没标：先当 JSON 解析，解析失败当字符串。
            serde_json::from_str::<Value>(raw.trim())
                .unwrap_or_else(|_| Value::String(raw.to_string()))
        };
        if !name.is_empty() {
            obj.insert(name.to_string(), value);
        }
    }
    if !obj.is_empty() {
        return Some(Value::Object(obj));
    }
    parse_json_args(body)
}

/// 一段文本当 JSON 解析成“参数对象”：
/// 裸参数对象 {"path": …}、或 {"name": …, "arguments": {...}} 包装。
fn parse_json_args(text: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(text.trim()).ok()?;
    if v.is_object() {
        if let Some(args) = v.get("arguments") {
            if args.is_object() {
                return Some(args.clone());
            }
            if let Some(s) = args.as_str() {
                let inner: Value = serde_json::from_str(s).ok()?;
                if inner.is_object() {
                    return Some(inner);
                }
            }
        }
        return Some(v);
    }
    None
}

/// `{"name": "read_file", "arguments": {...}}` 这种完整调用对象 → (名字, 参数)。
/// 参数优先取 arguments/parameters 字段；没有包装时把 name/tool/function
/// 键去掉、剩下字段当参数（有的网关直接把参数平铺在 name 旁边）。
fn parse_call_json(text: &str) -> Option<(String, Value)> {
    let v: Value = serde_json::from_str(text.trim()).ok()?;
    let obj = v.as_object()?;
    let name = obj
        .get("name")
        .or_else(|| obj.get("tool"))
        .or_else(|| obj.get("function"))
        .and_then(|n| n.as_str())?
        .to_string();
    if let Some(args) = obj.get("arguments").or_else(|| obj.get("parameters")) {
        if args.is_object() {
            return Some((name, args.clone()));
        }
        if let Some(s) = args.as_str() {
            let inner: Value = serde_json::from_str(s).ok()?;
            if inner.is_object() {
                return Some((name, inner));
            }
        }
    }
    let mut rest = obj.clone();
    rest.remove("name");
    rest.remove("tool");
    rest.remove("function");
    Some((name, Value::Object(rest)))
}

/// 扫描正文里所有大括号对象，找出带 name + arguments/parameters 的调用。
/// 跳过 Markdown 字面量区；只认“对象里直接带 name 字段”的 JSON，
// 避免把普通嵌套对象当调用。
fn scan_json_calls(content: &str, ranges: &[(usize, usize)]) -> Vec<(String, Value)> {
    let bytes = content.as_bytes();
    let mut out = Vec::new();
    let mut attempts = 0;
    let mut i = 0;
    while i < bytes.len() && attempts < 200 {
        if bytes[i] != b'{' || in_literal(ranges, i) {
            i += 1;
            continue;
        }
        attempts += 1;
        // 找配对的右括号（认字符串与转义）。
        let mut depth = 0i32;
        let mut in_str = false;
        let mut esc = false;
        let mut j = i;
        while j < bytes.len() {
            let c = bytes[j];
            if in_str {
                if esc {
                    esc = false;
                } else if c == b'\\' {
                    esc = true;
                } else if c == b'"' {
                    in_str = false;
                }
            } else if c == b'"' {
                in_str = true;
            } else if c == b'{' {
                depth += 1;
            } else if c == b'}' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            j += 1;
        }
        if depth == 0 && j < bytes.len() {
            if let Ok(slice) = std::str::from_utf8(&bytes[i..=j]) {
                // 快速过滤：没 name 字段的就不是调用对象。
                if slice.contains("\"name\"") || slice.contains("\"tool\"") {
                    if let Some((name, args)) = parse_call_json(slice) {
                        out.push((name, args));
                    }
                }
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    out
}

/// 正文是不是“明显想调用工具、但结构化调用没发出来”：
/// 含 DSML/标记/调用 JSON 的蛛丝马迹。恢复失败时用它决定要不要
/// 提醒模型重发（每轮最多一次）。
pub fn looks_like_tool_attempt(content: &str) -> bool {
    content.contains("DSML")
        || content.contains("<invoke")
        || content.contains("<tool_call")
        || content.contains("<function")
        || ((content.contains("\"name\""))
            && (content.contains("\"arguments\"") || content.contains("\"parameters\"")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known() -> Vec<String> {
        vec![
            "read_file".to_string(),
            "write_file".to_string(),
            "run_shell".to_string(),
            "list_dir".to_string(),
        ]
    }

    #[test]
    fn dsml_fullwidth_recovers() {
        let text = "我先读一下文件：\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name=\"read_file\">\n<｜DSML｜parameter name=\"path\" string=\"true\">/tmp/x.txt</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>";
        let calls = recover_tool_calls(text, &known());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "/tmp/x.txt");
        assert_eq!(calls[0].source, "dsml");
    }

    #[test]
    fn dsml_ascii_pipe_recovers() {
        let text = "<|DSML|tool_calls><|DSML|invoke name=\"list_dir\"><|DSML|parameter name=\"path\" string=\"true\">/tmp</|DSML|parameter></|DSML|invoke></|DSML|tool_calls>";
        let calls = recover_tool_calls(text, &known());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_dir");
        assert_eq!(calls[0].arguments["path"], "/tmp");
    }

    #[test]
    fn dsml_non_string_param_parses_json() {
        let text = "<｜DSML｜tool_calls><｜DSML｜invoke name=\"write_file\"><｜DSML｜parameter name=\"path\" string=\"true\">/tmp/a.txt</｜DSML｜parameter><｜DSML｜parameter name=\"content\" string=\"false\">{\"x\": 1}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>";
        let calls = recover_tool_calls(text, &known());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].arguments["content"]["x"], 1);
    }

    #[test]
    fn markup_invoke_and_tool_call_recover() {
        let text = "<invoke name=\"read_file\">{\"path\": \"/tmp/b.txt\"}</invoke> 还有 <tool_call>{\"name\": \"list_dir\", \"arguments\": {\"path\": \"/tmp\"}}</tool_call>";
        let calls = recover_tool_calls(text, &known());
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().any(|c| c.name == "read_file"));
        assert!(calls.iter().any(|c| c.name == "list_dir"));
    }

    #[test]
    fn json_fallback_recovers_bare_object() {
        let text = "我来读文件：{\"name\": \"read_file\", \"arguments\": {\"path\": \"/tmp/c.txt\"}}";
        let calls = recover_tool_calls(text, &known());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].source, "json");
        assert_eq!(calls[0].arguments["path"], "/tmp/c.txt");
    }

    #[test]
    fn markdown_code_fence_is_not_a_call() {
        let text = "示例代码：\n```json\n{\"name\": \"run_shell\", \"arguments\": {\"command\": \"rm -rf /\"}}\n```\n上面只是例子，不要执行。";
        let calls = recover_tool_calls(text, &known());
        assert!(calls.is_empty(), "围栏里的代码不是调用：{calls:?}");
    }

    #[test]
    fn inline_code_is_not_a_call() {
        let text = "比如 `{\"name\": \"read_file\", \"arguments\": {\"path\": \"/tmp\"}}` 这种写法。";
        let calls = recover_tool_calls(text, &known());
        assert!(calls.is_empty());
    }

    #[test]
    fn unknown_tool_is_dropped() {
        let text = "<｜DSML｜tool_calls><｜DSML｜invoke name=\"delete_everything\"><｜DSML｜parameter name=\"path\" string=\"true\">/</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>";
        assert!(recover_tool_calls(text, &known()).is_empty());
    }

    #[test]
    fn looks_like_attempt_flags_markers() {
        assert!(looks_like_tool_attempt("想调用 <｜DSML｜tool_calls> 但没发出来"));
        assert!(looks_like_tool_attempt(
            "{\"name\": \"read_file\", \"arguments\": {\"path\": \"/tmp\"}}"
        ));
        assert!(!looks_like_tool_attempt("今天天气不错，改完了。"));
    }

    #[test]
    fn strip_removes_dsml_block_keeps_prose() {
        let text = "路专员，我来执行这个链条任务。先检查工作区。\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name=\"list_dir\">\n<｜DSML｜parameter name=\"path\" string=\"true\">/tmp</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>\n\n目标清单：\n- [ ] 读 start.txt";
        let out = strip_tool_call_markup(text);
        assert!(!out.contains("DSML"), "标记应被剥掉：{out}");
        assert!(out.contains("先检查工作区"), "模型自己的文字要留着：{out}");
        assert!(out.contains("目标清单"), "标记后面的文字要留着：{out}");
    }

    #[test]
    fn strip_leaves_code_fence_example_alone() {
        let text = "示例：\n```xml\n<｜DSML｜tool_calls><｜DSML｜invoke name=\"read_file\"></｜DSML｜invoke></｜DSML｜tool_calls>\n```\n上面只是例子。";
        let out = strip_tool_call_markup(text);
        assert!(out.contains("DSML"), "围栏里的例子不是调用，不剥：{out}");
    }

    #[test]
    fn strip_plain_text_unchanged() {
        let text = "今天天气不错，改完了。";
        assert_eq!(strip_tool_call_markup(text), text);
    }
}
