//! Settings: persisted locally as JSON in the app config dir.
//! API keys are stored in this file (plain text, MVP). A future version
//! should move them to the OS keychain. Never log keys, never send them
//! anywhere except as an env var to the Codex CLI child process.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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
    /// 思考强度：low | medium | high | xhigh | max。独立设置，不随模式变化。
    pub effort: String,
    /// 模式： "norma"（通用工作 / Cowork）| "eva"（工程开发 / Code）。
    /// 与思考强度、Ultracode 各自独立。
    pub mode: String,
    /// Ultracode：高级工程工作流（多智能体并行、交叉验证、迭代）的独立开关。
    /// 当前引擎还是单智能体循环：开关只透传并记录，不假装已实现并行编排。
    pub ultracode: bool,
    /// auto | read-only
    pub approval: String,
    /// read-only | workspace-write | danger-full-access
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
            approval: "auto".to_string(),
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
        },
        ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            env_key: "OPENAI_API_KEY".to_string(),
            models: vec!["gpt-6.1".to_string(), "gpt-4o".to_string()],
            default_model: "gpt-6.1".to_string(),
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
    let mut settings = match settings_path(app) {
        Ok(path) => match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Settings>(&text).unwrap_or_default(),
            Err(_) => Settings::default(),
        },
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

impl Settings {
    pub fn provider(&self) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.id == self.provider_id)
    }
}
