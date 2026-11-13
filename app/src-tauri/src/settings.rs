//! Settings: persisted locally as JSON in the app config dir.
//! API keys are stored in this file (plain text, MVP). A future version
//! should move them to the OS keychain. Never log keys, never send them
//! anywhere except as an env var to the Codex CLI child process.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    /// Display name, e.g. "DeepSeek".
    pub name: String,
    /// Responses-API base URL, e.g. "https://api.deepseek.com/v1".
    pub base_url: String,
    /// Env var name that carries the key, e.g. "DEEPSEEK_API_KEY".
    pub env_key: String,
    /// Model ids the user can pick from (free text also allowed).
    pub models: Vec<String>,
    pub default_model: String,
    /// 接入方式：`direct` 官方直连 / `relay` 中转站（P0-3）。
    /// 发请求前按这个查模型映射表；老设置文件里没有这个字段时默认 direct。
    #[serde(default = "default_access_kind")]
    pub kind: String,
}

fn default_access_kind() -> String {
    "direct".to_string()
}

fn default_true() -> bool {
    true
}

fn default_compression_tier() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionItem {
    pub id: String,
    pub name: String,
    pub kind: String, // "plugin" | "mcp"
    pub detail: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub provider_id: String,
    pub model: String,
    /// 思考强度：low | medium | high | xhigh | max。切换模式时会带上该模式的
    /// 默认强度（NORMA medium、EVA high），用户随后可改。
    pub effort: String,
    /// 模式： "norma"（通用工作 / Cowork）| "eva"（工程开发 / Code）。
    /// 与思考强度、Ultracode 各自独立。
    pub mode: String,
    /// Ultracode：高级工程工作流（多智能体并行、交叉验证、迭代）的独立开关。
    /// 当前引擎还是单智能体循环：开关只透传并记录，不假装已实现并行编排。
    pub ultracode: bool,
    /// 审批档位（P0-8）：always 每步问 | on-demand 按需问（默认）| never 从不问。
    /// 只管“何时停下问你”，不管“能碰什么”——那是沙箱的活。
    /// NORMA 模式下 never 收紧为 on-demand（诺玛没有 yolo 档）。
    pub approval: String,
    /// 删除确认： "always"（每次删文件都单独问，默认）| "never"（不再询问，直接执行）。
    /// 用户可在设置 → 权限里改；持久化在 settings.json。
    pub delete_confirm: String,
    /// 压缩模型：压缩历史时用的模型，和主模型分开配（P0-3）。
    /// 改主模型、迁移退役 ID 都不碰它。老设置文件里没有时默认 deepseek-flash。
    pub compression_model: String,
    /// P1-1：自动压缩开关。开着时目标模式由 CacheAdvisor 按公式决定
    /// 什么时候压；关了就只手动压（/compact 与仪表盘按钮）。
    /// 老设置文件里没有时默认开（P1 已立项，用户 2026-11-13 定 P0 打包同时做 P1）。
    #[serde(default = "default_true")]
    pub compression_enabled: bool,
    /// P1-1：压缩档位：auto（按服务商自动选，默认）| cache-preserving
    /// | balanced | aggressive。写错的按 auto。
    #[serde(default = "default_compression_tier")]
    pub compression_tier: String,
    /// 沙箱档位（P0-8）：read-only 只读 | workspace-write 读写工作区（默认）
    /// | danger-full-access 无边界（文件工具可读写工作区外的绝对路径）。
    /// 只管“技术上能碰什么”，不管“何时问你”——那是审批的活。
    /// NORMA 模式下无边界收紧为读写工作区（诺玛没有 yolo 档）。
    pub sandbox: String,
    /// light | dark
    pub theme: String,
    pub streaming: bool,
    pub boot_animation: bool,
    /// Working directory for agent runs.
    pub workdir: String,
    /// Codex CLI binary path. Empty = resolve "codex" from PATH.
    pub codex_path: String,
    /// 用户在「个人资料」里设置的显示名。空 = 界面显示占位称呼"专员"。
    /// 这是用户自己填的真实值，不是预设的人名。
    pub display_name: String,
    pub providers: Vec<ProviderConfig>,
    /// provider id -> API key. Kept out of logs and out of the UI after entry.
    pub api_keys: HashMap<String, String>,
    pub extensions: Vec<ExtensionItem>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider_id: "deepseek".to_string(),
            model: "deepseek-flash".to_string(),
            effort: "medium".to_string(),
            mode: "norma".to_string(),
            ultracode: false,
            approval: "on-demand".to_string(),
            delete_confirm: "always".to_string(),
            compression_model: crate::models::default_compression_model(),
            compression_enabled: true,
            compression_tier: "auto".to_string(),
            sandbox: "workspace-write".to_string(),
            theme: "light".to_string(),
            streaming: true,
            boot_animation: true,
            workdir: String::new(),
            codex_path: String::new(),
            display_name: String::new(),
            providers: default_providers(),
            api_keys: HashMap::new(),
            extensions: default_extensions(),
        }
    }
}

pub fn default_providers() -> Vec<ProviderConfig> {
    vec![
        ProviderConfig {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            env_key: "DEEPSEEK_API_KEY".to_string(),
            models: vec!["deepseek-flash".to_string(), "deepseek-v4-pro".to_string()],
            default_model: "deepseek-flash".to_string(),
            kind: "direct".to_string(),
        },
        ProviderConfig {
            id: "kimi".to_string(),
            name: "Kimi".to_string(),
            base_url: "https://api.moonshot.ai/v1".to_string(),
            env_key: "MOONSHOT_API_KEY".to_string(),
            models: vec![
                "kimi-k2".to_string(),
                "moonshot-v1-8k".to_string(),
                "moonshot-v1-32k".to_string(),
            ],
            default_model: "kimi-k2".to_string(),
            kind: "direct".to_string(),
        },
        ProviderConfig {
            id: "qwen".to_string(),
            name: "千问".to_string(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            env_key: "DASHSCOPE_API_KEY".to_string(),
            models: vec![
                "qwen-plus".to_string(),
                "qwen-turbo".to_string(),
                "qwen-max".to_string(),
            ],
            default_model: "qwen-plus".to_string(),
            kind: "direct".to_string(),
        },
        ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            env_key: "OPENAI_API_KEY".to_string(),
            models: vec!["gpt-6.1".to_string(), "gpt-4o".to_string()],
            default_model: "gpt-6.1".to_string(),
            kind: "direct".to_string(),
        },
    ]
}

pub fn default_extensions() -> Vec<ExtensionItem> {
    vec![
        ExtensionItem {
            id: "figma".to_string(),
            name: "Figma".to_string(),
            kind: "plugin".to_string(),
            detail: "设计稿读取与标注".to_string(),
            enabled: true,
        },
        ExtensionItem {
            id: "github".to_string(),
            name: "GitHub".to_string(),
            kind: "plugin".to_string(),
            detail: "仓库、PR 与 Issue".to_string(),
            enabled: true,
        },
        ExtensionItem {
            id: "browser-control".to_string(),
            name: "浏览器控制".to_string(),
            kind: "plugin".to_string(),
            detail: "打开页面并验证渲染".to_string(),
            enabled: true,
        },
        ExtensionItem {
            id: "db-query".to_string(),
            name: "数据库查询".to_string(),
            kind: "plugin".to_string(),
            detail: "只读 SQL 查询".to_string(),
            enabled: false,
        },
        ExtensionItem {
            id: "filesystem".to_string(),
            name: "filesystem".to_string(),
            kind: "mcp".to_string(),
            detail: "stdio · 本地文件访问".to_string(),
            enabled: true,
        },
        ExtensionItem {
            id: "github-mcp".to_string(),
            name: "github-mcp".to_string(),
            kind: "mcp".to_string(),
            detail: "stdio · GitHub API".to_string(),
            enabled: true,
        },
        ExtensionItem {
            id: "cassell-kb".to_string(),
            name: "学院知识库".to_string(),
            kind: "mcp".to_string(),
            detail: "远程 · 学院档案与制度".to_string(),
            enabled: false,
        },
    ]
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    match settings_path(app) {
        Ok(path) => load_settings_from_file(&path),
        Err(_) => Settings::default(),
    }
}

/// 按路径读设置文件（与 load_settings 同一套解析 + 归一；P1 的泛型命令
/// 用它——命令只认目录、不认具体 Runtime，才能在 MockRuntime 下测）。
pub fn load_settings_from_file(path: &Path) -> Settings {
    let mut settings = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<Settings>(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    };
    // Older builds silently initialized the workspace from the process CWD.
    // Clear that implicit install/dev directory so an update never runs tasks
    // there by accident. A user-selected project folder remains untouched.
    if !settings.workdir.trim().is_empty() {
        let saved = PathBuf::from(&settings.workdir).canonicalize().ok();
        let cwd = std::env::current_dir().ok().and_then(|p| p.canonicalize().ok());
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .and_then(|p| p.canonicalize().ok());
        if saved.is_some() && (saved == cwd || saved == exe_dir) {
            settings.workdir.clear();
        }
    }
    // 旧版 effort "ultra"（曾与 EVA 绑定）改为 "xhigh"；未知值回落到 medium。
    // 旧版只有 eva 布尔值、没有 mode 字段的文件，mode 缺失为空串，归一为 norma。
    settings.effort = match settings.effort.as_str() {
        "low" | "medium" | "high" | "xhigh" | "max" => settings.effort.clone(),
        "ultra" => "xhigh".to_string(),
        _ => "medium".to_string(),
    };
    if settings.mode != "norma" && settings.mode != "eva" {
        settings.mode = "norma".to_string();
    }
    // P0-8 审批档位迁移（两把 dial 拆开）：旧 "auto"→按需问、"ask"→每步问、
    // "read-only"→沙箱改只读 + 审批改按需问（旧值是审批字段在干沙箱的活，
    // 拆开后行为不变）；未知值回落到按需问（安全优先）。
    // 沙箱档位归一：只有三个合法值，未知值回落到读写工作区。
    let (migrated, force_readonly) = crate::sandbox::migrate_approval(&settings.approval);
    if migrated != settings.approval {
        eprintln!("[sandbox] 审批档位已迁移：{} → {migrated}", settings.approval);
        settings.approval = migrated.to_string();
    }
    if force_readonly && settings.sandbox != "read-only" {
        eprintln!("[sandbox] 旧审批 read-only 已拆为沙箱只读");
        settings.sandbox = "read-only".to_string();
    }
    if !matches!(
        settings.sandbox.as_str(),
        "read-only" | "workspace-write" | "danger-full-access"
    ) {
        settings.sandbox = "workspace-write".to_string();
    }
    if settings.delete_confirm != "always" && settings.delete_confirm != "never" {
        settings.delete_confirm = "always".to_string();
    }
    // P0-3：接入方式归一（写错的按 direct）；退役模型 ID 迁移到替代 ID，
    // 只动主模型，压缩模型不碰。
    for p in settings.providers.iter_mut() {
        p.kind = crate::models::access_kind(&p.kind).to_string();
    }
    let (migrated, record) = crate::models::migrate_model_id(&settings.model);
    if let Some((old, new)) = record {
        eprintln!("[models] 模型 ID 已迁移：{old} → {new}（退役 ID，压缩模型未动）");
        settings.model = migrated;
    }
    if settings.compression_model.trim().is_empty() {
        settings.compression_model = crate::models::default_compression_model();
    }
    // P1-1：压缩档位归一（只有四个合法值，写错的按 auto）。
    if !matches!(
        settings.compression_tier.as_str(),
        "auto" | "cache-preserving" | "balanced" | "aggressive"
    ) {
        settings.compression_tier = "auto".to_string();
    }
    settings
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}
