//! Pure command-risk policy.
//!
//! Detection is intentionally conservative: a match asks for approval; it
//! does not by itself execute anything.

/// 删文件类命令的识别（大小写不敏感；按 && / || / ; / | 拆段逐段判断）。
/// 返回命中的命令名（如 "rm"），没有命中返回 None。
/// 覆盖：rm / del / erase / rmdir / rd / Remove-Item / git clean -f / git rm。
pub fn destructive_command(cmd: &str) -> Option<&'static str> {
    let lower = cmd.to_ascii_lowercase();
    for seg in lower
        .split(|c| c == '&' || c == '|' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let mut toks = seg.split_whitespace();
        let first = toks.next().unwrap_or("");
        // "sudo rm ..." 也算 rm（Linux 下的写法）。
        let first = if first == "sudo" {
            toks.next().unwrap_or("")
        } else {
            first
        };
        match first {
            "rm" => return Some("rm"),
            "del" => return Some("del"),
            "erase" => return Some("erase"),
            "rmdir" => return Some("rmdir"),
            "rd" => return Some("rd"),
            "remove-item" => return Some("Remove-Item"),
            "git" => {
                let sub = toks.next().unwrap_or("");
                if sub == "clean" && toks.any(|t| t.starts_with("-f")) {
                    return Some("git clean -f");
                }
                if sub == "rm" {
                    return Some("git rm");
                }
            }
            _ => {}
        }
    }
    None
}

/// 灾难性删根：rm -rf /、rm -rf ~、rm -rf C:\ 这类——无论删除确认设置
/// 如何一律拒绝，不走审批卡（批了也不该执行）。
pub fn catastrophic_command(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    for seg in lower
        .split(|c| c == '&' || c == '|' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let mut toks = seg.split_whitespace();
        let first = toks.next().unwrap_or("");
        let first = if first == "sudo" {
            toks.next().unwrap_or("")
        } else {
            first
        };
        if first != "rm" {
            continue;
        }
        let rest: Vec<&str> = toks.collect();
        let has_rf = rest
            .iter()
            .any(|t| *t == "-rf" || *t == "-fr" || *t == "-r" || *t == "-f");
        if !has_rf {
            continue;
        }
        let targets_root = rest.iter().any(|t| {
            matches!(*t, "/" | "/*" | "~" | "~/" | "c:" | "c:/" | "c:\\" | "c:\\*")
        });
        if targets_root {
            return true;
        }
    }
    false
}

