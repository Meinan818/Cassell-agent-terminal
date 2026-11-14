//! Pure command-risk policy.
//!
//! Detection is intentionally conservative: a match asks for approval (or is
//! refused for catastrophic targets); it never executes anything by itself.
//!
//! The parser intentionally understands the common wrappers (`cmd /c`,
//! PowerShell `-Command`, `bash -c`, `python -c`, `node -e`) instead of only
//! looking at the first token. A model can otherwise hide `rd /s /q` or
//! `Remove-Item` inside a wrapper and bypass the "delete always asks" rule.

/// Split on the separators that can chain independent commands.
fn segments(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in cmd.chars() {
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => {
                quote = Some(c);
                cur.push(c);
            }
            '&' | '|' | ';' | '\n' | '\r' => {
                let trimmed = cur.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    let trimmed = cur.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_string());
    }
    out
}

/// A deliberately small tokenizer: quotes are stripped, whitespace separates.
/// It is only used for risk classification, never for execution.
fn tokens(seg: &str) -> Vec<String> {
    seg.split_whitespace()
        .map(|s| s.trim_matches(|c| c == '"' || c == '\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn base_name(token: &str) -> String {
    let name = token
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(token)
        .to_ascii_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

fn strip_privilege_prefix(toks: &mut Vec<String>) {
    while let Some(first) = toks.first() {
        let name = base_name(first);
        if name == "sudo" || name == "doas" {
            toks.remove(0);
        } else {
            break;
        }
    }
}

fn has_flag(toks: &[String], flags: &[&str]) -> bool {
    toks.iter().any(|t| {
        let t = t.to_ascii_lowercase();
        flags.iter().any(|f| t == *f)
    })
}

fn flag_index(toks: &[String], flags: &[&str]) -> Option<usize> {
    toks.iter().position(|t| {
        let t = t.to_ascii_lowercase();
        flags.iter().any(|f| t == *f)
    })
}

fn is_root_target(token: &str) -> bool {
    let t = token
        .trim_matches(|c| c == '"' || c == '\'')
        .to_ascii_lowercase();
    matches!(
        t.as_str(),
        "/" | "/*"
            | "~"
            | "~/"
            | "c:"
            | "c:/"
            | "c:\\"
            | "c:\\*"
            | "d:"
            | "d:/"
            | "d:\\"
            | "%systemdrive%"
            | "$env:systemdrive"
            | "$env:systemdrive\\"
    )
}

/// Classify one command segment, unwrapping the common shell wrappers.
fn classify_segment(seg: &str, depth: u8) -> Option<&'static str> {
    if depth > 4 {
        return None;
    }
    let mut toks = tokens(seg);
    strip_privilege_prefix(&mut toks);
    if toks.is_empty() {
        return None;
    }
    let cmd = base_name(&toks[0]);

    // Wrappers: classify the command inside them, not just the wrapper name.
    if cmd == "cmd" {
        if let Some(i) = flag_index(&toks, &["/c", "/k"]) {
            if i + 1 < toks.len() {
                return classify_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd == "powershell" || cmd == "pwsh" {
        if let Some(i) = flag_index(&toks, &["-command", "-c"]) {
            if i + 1 < toks.len() {
                return classify_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd == "bash" || cmd == "sh" || cmd == "zsh" {
        if let Some(i) = flag_index(&toks, &["-c"]) {
            if i + 1 < toks.len() {
                return classify_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd == "python" || cmd == "python3" || cmd == "py" {
        if let Some(i) = flag_index(&toks, &["-c"]) {
            let code = toks[i + 1..].join(" ").to_ascii_lowercase();
            if ["shutil.rmtree", "os.remove", "os.unlink", "path.unlink", "rmtree("]
                .iter()
                .any(|k| code.contains(k))
            {
                return Some("python -c 删除");
            }
        }
    }
    if cmd == "node" {
        if let Some(i) = flag_index(&toks, &["-e", "--eval"]) {
            let code = toks[i + 1..].join(" ").to_ascii_lowercase();
            if [".rmsync(", ".rm(", ".unlink(", "rimraf"]
                .iter()
                .any(|k| code.contains(k))
            {
                return Some("node -e 删除");
            }
        }
    }

    match cmd.as_str() {
        // File deletion / destruction. We are deliberately conservative:
        // even a single-file `rm` asks, because the model can batch paths.
        "rm" | "srm" | "shred" => Some("rm"),
        "del" | "erase" => Some("del"),
        "rmdir" | "rd" => Some("rd"),
        "remove-item" => Some("Remove-Item"),
        "format" => Some("format"),
        "diskpart" => Some("diskpart"),
        "vssadmin" if has_flag(&toks, &["delete"]) => Some("vssadmin delete"),
        "reg" if toks.get(1).map(|s| s == "delete").unwrap_or(false) => Some("reg delete"),
        "git" => {
            let sub = toks.get(1).map(String::as_str).unwrap_or("");
            match sub {
                "rm" => Some("git rm"),
                "clean" => {
                    let force = toks.iter().skip(2).any(|t| {
                        let t = t.to_ascii_lowercase();
                        t.starts_with('-') && (t.contains('f') || t.contains('x'))
                    });
                    if force {
                        Some("git clean -f")
                    } else {
                        None
                    }
                }
                "reset" if has_flag(&toks, &["--hard"]) => Some("git reset --hard"),
                "checkout" | "restore"
                    if toks.iter().skip(2).any(|t| t == "." || t == "--") =>
                {
                    Some("git checkout/restore .")
                }
                "stash"
                    if toks
                        .get(2)
                        .map(|s| s == "drop" || s == "clear")
                        .unwrap_or(false) =>
                {
                    Some("git stash drop")
                }
                _ => None,
            }
        }
        "robocopy" if has_flag(&toks, &["/mir", "/purge"]) => Some("robocopy /mir"),
        _ => None,
    }
}

/// Delete / destructive command detection. Returns a stable label for the
/// approval card (e.g. "rd", "git clean -f").
pub fn destructive_command(cmd: &str) -> Option<&'static str> {
    for seg in segments(cmd) {
        if let Some(hit) = classify_segment(&seg, 0) {
            return Some(hit);
        }
    }
    None
}

fn catastrophic_segment(seg: &str, depth: u8) -> bool {
    if depth > 4 {
        return false;
    }
    let mut toks = tokens(seg);
    strip_privilege_prefix(&mut toks);
    if toks.is_empty() {
        return false;
    }
    let cmd = base_name(&toks[0]);

    if cmd == "cmd" {
        if let Some(i) = flag_index(&toks, &["/c", "/k"]) {
            if i + 1 < toks.len() {
                return catastrophic_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd == "powershell" || cmd == "pwsh" {
        if let Some(i) = flag_index(&toks, &["-command", "-c"]) {
            if i + 1 < toks.len() {
                return catastrophic_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd == "bash" || cmd == "sh" || cmd == "zsh" {
        if let Some(i) = flag_index(&toks, &["-c"]) {
            if i + 1 < toks.len() {
                return catastrophic_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }

    match cmd.as_str() {
        "format" | "diskpart" => true,
        "vssadmin" => has_flag(&toks, &["delete"]),
        "rm" => {
            let recursive = toks.iter().any(|t| {
                let t = t.to_ascii_lowercase();
                t == "-rf" || t == "-fr" || t == "-r" || t == "--recursive"
            });
            recursive && toks.iter().skip(1).any(|t| is_root_target(t))
        }
        "rd" | "rmdir" => {
            let recursive = has_flag(&toks, &["/s", "-s", "--recursive"]);
            recursive && toks.iter().skip(1).any(|t| is_root_target(t))
        }
        "remove-item" => {
            let recursive = toks.iter().any(|t| {
                let t = t.to_ascii_lowercase();
                t == "-recurse" || t == "-r" || t == "--recursive"
            });
            recursive && toks.iter().skip(1).any(|t| is_root_target(t))
        }
        "robocopy" => {
            let mirror = has_flag(&toks, &["/mir", "/purge"]);
            mirror && toks.iter().skip(1).any(|t| is_root_target(t))
        }
        _ => false,
    }
}

/// Catastrophic delete: roots, drive roots, format/diskpart. Always refused,
/// even in the "never ask" approval mode.
pub fn catastrophic_command(cmd: &str) -> bool {
    segments(cmd)
        .iter()
        .any(|seg| catastrophic_segment(seg, 0))
}

/// Reading credentials or private data is always surfaced to the user in
/// on-demand mode. This is a substring check on purpose: the command may be
/// wrapped in quotes and passed through several shells.
pub fn sensitive_path_access(cmd: &str) -> Option<&'static str> {
    let lower = cmd.to_ascii_lowercase();
    const HITS: &[(&str, &str)] = &[
        (".ssh", "SSH 目录"),
        ("id_rsa", "SSH 私钥"),
        ("id_ed25519", "SSH 私钥"),
        (".git-credentials", "Git 凭据"),
        (".npmrc", "npm 凭据"),
        (".env", "环境变量文件"),
        (".pem", "私钥文件"),
        (".key", "私钥文件"),
        ("settings.json", "应用设置文件"),
        ("com.cassell.agent", "应用数据目录"),
        ("%appdata%", "AppData 目录"),
        ("$env:appdata", "AppData 目录"),
    ];
    HITS
        .iter()
        .find(|(needle, _)| lower.contains(needle))
        .map(|(_, label)| *label)
}

/// Network egress that can upload data. Package downloads / `git fetch` are
/// intentionally not listed here; they are network reads, not exports.
fn network_segment(seg: &str, depth: u8) -> Option<&'static str> {
    if depth > 4 {
        return None;
    }
    let mut toks = tokens(seg);
    strip_privilege_prefix(&mut toks);
    if toks.is_empty() {
        return None;
    }
    let cmd_name = base_name(&toks[0]);
    if cmd_name == "cmd" {
        if let Some(i) = flag_index(&toks, &["/c", "/k"]) {
            if i + 1 < toks.len() {
                return network_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd_name == "powershell" || cmd_name == "pwsh" {
        if let Some(i) = flag_index(&toks, &["-command", "-c"]) {
            if i + 1 < toks.len() {
                return network_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    if cmd_name == "bash" || cmd_name == "sh" || cmd_name == "zsh" {
        if let Some(i) = flag_index(&toks, &["-c"]) {
            if i + 1 < toks.len() {
                return network_segment(&toks[i + 1..].join(" "), depth + 1);
            }
        }
    }
    match cmd_name.as_str() {
        "curl" | "wget" => Some("curl/wget"),
        "invoke-webrequest" | "iwr" | "invoke-restmethod" | "irm" => {
            Some("PowerShell 网络请求")
        }
        "ssh" | "scp" | "sftp" | "ftp" | "nc" | "netcat" | "ncat" => Some("远程传输"),
        "git" if toks.get(1).map(|s| s == "push").unwrap_or(false) => Some("git push"),
        "npm" if toks.get(1).map(|s| s == "publish").unwrap_or(false) => Some("npm publish"),
        "pip" | "pip3" if toks.get(1).map(|s| s == "upload").unwrap_or(false) => {
            Some("pip upload")
        }
        "docker" if toks.get(1).map(|s| s == "push").unwrap_or(false) => Some("docker push"),
        _ => None,
    }
}

/// Network egress that can upload data. Package downloads / `git fetch` are
/// intentionally not listed here; they are network reads, not exports.
pub fn network_egress(cmd: &str) -> Option<&'static str> {
    segments(cmd)
        .iter()
        .find_map(|seg| network_segment(seg, 0))
}

/// True for local development URLs that the agent may open without a network
/// approval card. External URLs ask in on-demand mode.
pub fn is_local_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("http://localhost")
        || lower.starts_with("https://localhost")
        || lower.starts_with("http://127.0.0.1")
        || lower.starts_with("https://127.0.0.1")
        || lower.starts_with("http://[::1]")
        || lower.starts_with("https://[::1]")
        || lower.starts_with("http://0.0.0.0")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_wrapped_delete_commands() {
        let cases = [
            "cmd /c rd /s /q D:\\proj",
            "cmd.exe /c del C:\\proj\\a.txt",
            "powershell -Command \"Remove-Item -Recurse -Force .\"",
            "pwsh -c \"rm -rf build\"",
            "bash -c \"rm -rf build\"",
            "python -c \"import shutil; shutil.rmtree('build')\"",
            "node -e \"require('fs').rmSync('build',{recursive:true})\"",
        ];
        for cmd in cases {
            assert!(destructive_command(cmd).is_some(), "should detect: {cmd}");
        }
    }

    #[test]
    fn catches_git_destructive_commands() {
        for cmd in [
            "git clean -xfd",
            "git reset --hard",
            "git checkout -- .",
            "git restore .",
            "git stash drop",
            "git rm old.txt",
        ] {
            assert!(destructive_command(cmd).is_some(), "should detect: {cmd}");
        }
        assert!(destructive_command("git status --short").is_none());
        assert!(destructive_command("git clean -n").is_none());
    }

    #[test]
    fn catches_robocopy_mirror_and_windows_tools() {
        for cmd in [
            "robocopy C:\\src D:\\dst /mir",
            "format C:",
            "diskpart",
            "vssadmin delete shadows /all",
        ] {
            assert!(destructive_command(cmd).is_some(), "should detect: {cmd}");
        }
    }

    #[test]
    fn catastrophic_targets_are_refused() {
        for cmd in [
            "rm -rf /",
            "rm -rf C:\\",
            "cmd /c rd /s /q C:\\",
            "powershell -Command \"Remove-Item -Recurse -Force C:\\\"",
            "format C:",
            "diskpart",
        ] {
            assert!(catastrophic_command(cmd), "should refuse: {cmd}");
        }
        assert!(!catastrophic_command("rm -rf ./build"));
        assert!(!catastrophic_command("git clean -xfd"));
    }

    #[test]
    fn catches_sensitive_paths() {
        assert!(sensitive_path_access("type %APPDATA%\\com.cassell.agent\\settings.json").is_some());
        assert!(sensitive_path_access("Get-Content $env:USERPROFILE\\.ssh\\id_rsa").is_some());
        assert!(sensitive_path_access("cat .env").is_some());
        assert!(sensitive_path_access("cat src/main.rs").is_none());
    }

    #[test]
    fn catches_network_egress() {
        for cmd in [
            "curl https://example.com",
            "wget https://example.com/x",
            "Invoke-WebRequest https://example.com",
            "powershell -Command \"Invoke-WebRequest https://example.com\"",
            "cmd /c curl https://example.com",
            "git push origin main",
            "npm publish",
            "scp secrets.txt user@host:/tmp",
        ] {
            assert!(network_egress(cmd).is_some(), "should detect: {cmd}");
        }
        assert!(network_egress("npm install").is_none());
        assert!(network_egress("git status").is_none());
    }

    #[test]
    fn local_urls_are_allowed_without_network_prompt() {
        assert!(is_local_url("http://localhost:5173"));
        assert!(is_local_url("http://127.0.0.1:1420/"));
        assert!(!is_local_url("https://example.com"));
    }
}
