//! Product mode profiles.
//!
//! The product has exactly two modes: NORMA is the Claude Cowork-like general
//! work surface, EVA is the Claude Code-like engineering surface. They share
//! one runtime and one memory store; only the tool surface and defaults differ.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModeProfile {
    pub id: &'static str,
    pub label: &'static str,
    pub is_code: bool,
    pub can_run_shell: bool,
    pub can_use_browser: bool,
    pub can_read_terminal: bool,
}

pub const NORMA: ModeProfile = ModeProfile {
    id: "norma",
    label: "NORMA / Cowork",
    is_code: false,
    can_run_shell: false,
    can_use_browser: false,
    can_read_terminal: false,
};

pub const EVA: ModeProfile = ModeProfile {
    id: "eva",
    label: "EVA / Code",
    is_code: true,
    can_run_shell: true,
    can_use_browser: true,
    can_read_terminal: true,
};

pub fn profile(mode: &str) -> ModeProfile {
    if mode == "eva" { EVA } else { NORMA }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norma_keeps_cowork_surface() {
        let p = profile("norma");
        assert_eq!(p, NORMA);
        assert!(!p.is_code);
        assert!(!p.can_run_shell);
        assert!(!p.can_use_browser);
        assert!(!p.can_read_terminal);
    }

    #[test]
    fn eva_keeps_code_surface() {
        let p = profile("eva");
        assert_eq!(p, EVA);
        assert!(p.is_code);
        assert!(p.can_run_shell);
        assert!(p.can_use_browser);
        assert!(p.can_read_terminal);
    }
}
