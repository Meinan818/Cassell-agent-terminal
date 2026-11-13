//! P0-8：沙箱 × 审批，两把独立的 dial。
//!
//! 两把 dial 管的是两个不同的问题，分开设、互不干扰：
//! - 沙箱（技术上能碰什么）：只读 / 读写工作区 / 无边界。
//! - 审批（何时停下问你）：每步问 / 按需问 / 从不问。
//!
//! 旧设置的迁移（load_settings 里做，保证老设置文件行为不变）：
//! - approval "auto" → 按需问；"ask" → 每步问；"read-only" → 沙箱改只读、审批改按需问
//!   （旧 "read-only" 是审批字段在干沙箱的活，拆开后行为不变）。
//! - sandbox 只有三个合法值，未知值回落到读写工作区。
//!
//! NORMA 没有 yolo 档（蓝图验收）：办公模式下，无边界收紧为读写工作区、
//! 从不问收紧为按需问。收紧发生在引擎入口（effective_*），界面上的设置值
//! 不动，只提示用户“诺玛模式下已收紧”。

use std::path::{Path, PathBuf};

/// 沙箱档位（存在 settings.sandbox 里的原始字符串）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxLevel {
    /// 只能读文件、列目录；写文件、执行命令一律拒绝。
    ReadOnly,
    /// 读写工作区内的文件；执行命令（工作区内）；工作区外路径拒绝。
    WorkspaceWrite,
    /// 文件工具可读写工作区外的绝对路径；灾难命令（删根）仍然永远拒绝。
    /// 只在 EVA 模式生效，NORMA 下收紧为读写工作区。
    FullAccess,
}

/// 审批档位（存在 settings.approval 里的原始字符串）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalLevel {
    /// 每次写文件、每次执行命令都先弹审批卡问你。
    Always,
    /// 只在危险操作时问：删除类命令按删除确认设置；常规写文件、执行命令直接放行。
    OnDemand,
    /// 什么都不问（包括删除命令）；灾难命令仍然永远拒绝。
    /// 只在 EVA 模式生效，NORMA 下收紧为按需问。
    Never,
}

pub fn parse_sandbox(s: &str) -> SandboxLevel {
    match s {
        "read-only" => SandboxLevel::ReadOnly,
        "danger-full-access" => SandboxLevel::FullAccess,
        // "workspace-write" 与一切未知值：默认读写工作区（安全回落）。
        _ => SandboxLevel::WorkspaceWrite,
    }
}

pub fn parse_approval(s: &str) -> ApprovalLevel {
    match s {
        "always" => ApprovalLevel::Always,
        "never" => ApprovalLevel::Never,
        // "on-demand" 与一切未知值：默认按需问（安全回落）。
        _ => ApprovalLevel::OnDemand,
    }
}

/// 旧审批值迁移：返回（新审批值，是否要把沙箱改成只读）。
/// "read-only" 是旧字段在干沙箱的活——拆开后沙箱改只读、审批改按需问，
/// 行为与旧版一致。
pub fn migrate_approval(old: &str) -> (&'static str, bool) {
    match old {
        "auto" => ("on-demand", false),
        "ask" => ("always", false),
        "read-only" => ("on-demand", true),
        "always" | "on-demand" | "never" => (match old {
            "always" => "always",
            "never" => "never",
            _ => "on-demand",
        }, false),
        _ => ("on-demand", false),
    }
}

/// NORMA 没有 yolo 档：办公模式下无边界收紧为读写工作区。
pub fn effective_sandbox(mode: &str, sandbox: SandboxLevel) -> SandboxLevel {
    if mode == "norma" && sandbox == SandboxLevel::FullAccess {
        SandboxLevel::WorkspaceWrite
    } else {
        sandbox
    }
}

/// NORMA 没有 yolo 档：办公模式下从不问收紧为按需问。
pub fn effective_approval(mode: &str, approval: ApprovalLevel) -> ApprovalLevel {
    if mode == "norma" && approval == ApprovalLevel::Never {
        ApprovalLevel::OnDemand
    } else {
        approval
    }
}

/// 审批决策表（纯函数，可单测）：这次工具调用要不要先弹审批卡。
/// - kind "write" = 写文件；"shell" = 执行命令；"delete" = 删除类命令。
/// - delete_confirm 只在按需问档管删除命令；每步问档里写/命令的卡已经问过，
///   删除命令不再问第二遍；从不问档里什么卡都不弹。
pub fn needs_approval(
    approval: ApprovalLevel,
    kind: &str,
    destructive: bool,
    delete_confirm: &str,
) -> bool {
    match approval {
        // 每步问：写文件、执行命令都问；删除命令不再问第二遍
        // （整条命令的卡已经问过，destructive=true 时返回 false）。
        ApprovalLevel::Always => (kind == "write" || kind == "shell") && !destructive,
        ApprovalLevel::OnDemand => {
            destructive && kind == "shell" && delete_confirm != "never"
        }
        ApprovalLevel::Never => false,
    }
}

/// 文件工具的路径解析：沙箱档位决定边界。
/// - 只读 / 读写工作区：沿用旧 safe_join——相对路径落在工作区内，`..` 拒绝。
/// - 无边界：绝对路径直接放行（仍做词法归一、拒绝 NUL）；相对路径仍落在工作区内。
pub fn join_path(workdir: &str, rel: &str, sandbox: SandboxLevel) -> Result<PathBuf, String> {
    if sandbox == SandboxLevel::FullAccess {
        let p = Path::new(rel);
        if p.is_absolute() {
            return Ok(normalize_lexical(p));
        }
    }
    safe_join(workdir, rel)
}

/// 旧 safe_join：相对路径必须落在工作区内，`..` 一律拒绝。
/// 绝对路径：落在工作区内就直接用（词法归一），落在工作区外就拒绝——
/// 旧实现是把绝对路径当相对路径拼进工作区，读不到时只报“No such file”，
/// 模型还得分辨“文件不存在”还是“路径越界”，实测已证实会误导。
pub fn safe_join(workdir: &str, rel: &str) -> Result<PathBuf, String> {
    let base = Path::new(workdir);
    if !base.is_dir() {
        return Err(format!("工作区不存在：{workdir}"));
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        let norm = normalize_lexical(p);
        if norm.starts_with(base) {
            return Ok(norm);
        }
        return Err("路径超出工作区范围".to_string());
    }
    let mut out = base.to_path_buf();
    for seg in rel.replace('\\', "/").split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err("路径不能包含 ..".to_string()),
            s => out.push(s),
        }
    }
    if !out.starts_with(base) {
        return Err("路径超出工作区范围".to_string());
    }
    Ok(out)
}

/// 词法归一绝对路径（不碰磁盘）：`.` 丢掉，`..` 弹掉上一级，根目录之上不再弹。
fn normalize_lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            c => out.push(c.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        out.push("/");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sandbox_levels() {
        assert_eq!(parse_sandbox("read-only"), SandboxLevel::ReadOnly);
        assert_eq!(parse_sandbox("workspace-write"), SandboxLevel::WorkspaceWrite);
        assert_eq!(parse_sandbox("danger-full-access"), SandboxLevel::FullAccess);
        // 未知值回落到读写工作区，不回落到只读（别把老用户锁死）。
        assert_eq!(parse_sandbox("bogus"), SandboxLevel::WorkspaceWrite);
        assert_eq!(parse_sandbox(""), SandboxLevel::WorkspaceWrite);
    }

    #[test]
    fn parse_approval_levels() {
        assert_eq!(parse_approval("always"), ApprovalLevel::Always);
        assert_eq!(parse_approval("on-demand"), ApprovalLevel::OnDemand);
        assert_eq!(parse_approval("never"), ApprovalLevel::Never);
        assert_eq!(parse_approval("bogus"), ApprovalLevel::OnDemand);
    }

    #[test]
    fn migrate_legacy_approval() {
        assert_eq!(migrate_approval("auto"), ("on-demand", false));
        assert_eq!(migrate_approval("ask"), ("always", false));
        // 旧 read-only：沙箱改只读、审批改按需问，行为与旧版一致。
        assert_eq!(migrate_approval("read-only"), ("on-demand", true));
        assert_eq!(migrate_approval("always"), ("always", false));
        assert_eq!(migrate_approval("never"), ("never", false));
        assert_eq!(migrate_approval("bogus"), ("on-demand", false));
    }

    #[test]
    fn norma_has_no_yolo() {
        // NORMA：无边界收紧为读写工作区，从不问收紧为按需问。
        assert_eq!(
            effective_sandbox("norma", SandboxLevel::FullAccess),
            SandboxLevel::WorkspaceWrite
        );
        assert_eq!(
            effective_approval("norma", ApprovalLevel::Never),
            ApprovalLevel::OnDemand
        );
        // EVA：原样放行。
        assert_eq!(
            effective_sandbox("eva", SandboxLevel::FullAccess),
            SandboxLevel::FullAccess
        );
        assert_eq!(
            effective_approval("eva", ApprovalLevel::Never),
            ApprovalLevel::Never
        );
        // NORMA 的其他档位不动。
        assert_eq!(
            effective_sandbox("norma", SandboxLevel::ReadOnly),
            SandboxLevel::ReadOnly
        );
        assert_eq!(
            effective_approval("norma", ApprovalLevel::Always),
            ApprovalLevel::Always
        );
    }

    #[test]
    fn approval_decision_table() {
        // 每步问：写文件、执行命令都问；删除命令不问第二遍。
        assert!(needs_approval(ApprovalLevel::Always, "write", false, "always"));
        assert!(needs_approval(ApprovalLevel::Always, "shell", false, "always"));
        assert!(!needs_approval(ApprovalLevel::Always, "shell", true, "always"));
        // 按需问：常规写/命令不问；删除命令按删除确认设置。
        assert!(!needs_approval(ApprovalLevel::OnDemand, "write", false, "always"));
        assert!(!needs_approval(ApprovalLevel::OnDemand, "shell", false, "always"));
        assert!(needs_approval(ApprovalLevel::OnDemand, "shell", true, "always"));
        assert!(!needs_approval(ApprovalLevel::OnDemand, "shell", true, "never"));
        // 从不问：什么都不问。
        assert!(!needs_approval(ApprovalLevel::Never, "write", false, "always"));
        assert!(!needs_approval(ApprovalLevel::Never, "shell", true, "always"));
    }

    #[test]
    fn join_path_workspace_boundary() {
        let dir = std::env::temp_dir().join("cassell-sandbox-test");
        let _ = std::fs::create_dir_all(&dir);
        let base = dir.to_string_lossy().to_string();
        // 读写工作区：相对路径放行，`..` 拒绝。
        assert!(join_path(&base, "a/b.txt", SandboxLevel::WorkspaceWrite).is_ok());
        assert!(join_path(&base, "../escape.txt", SandboxLevel::WorkspaceWrite).is_err());
        // 读写工作区：工作区外的绝对路径明确拒绝（不是拼进工作区再报文件不存在）。
        let outside = join_path(&base, "/tmp/cassell-longtask/outside.txt", SandboxLevel::WorkspaceWrite);
        assert!(outside.is_err());
        assert_eq!(outside.unwrap_err(), "路径超出工作区范围");
        // 读写工作区：工作区内的绝对路径直接用。
        let inside_abs = format!("{}/a.txt", base);
        assert_eq!(
            join_path(&base, &inside_abs, SandboxLevel::WorkspaceWrite).unwrap(),
            PathBuf::from(&inside_abs)
        );
        // 无边界：绝对路径放行，`..` 词法归一。
        let out = join_path(&base, "/tmp/x/../y.txt", SandboxLevel::FullAccess).unwrap();
        assert_eq!(out, PathBuf::from("/tmp/y.txt"));
        // 无边界：相对路径仍落在工作区内。
        assert!(join_path(&base, "a.txt", SandboxLevel::FullAccess)
            .unwrap()
            .starts_with(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
