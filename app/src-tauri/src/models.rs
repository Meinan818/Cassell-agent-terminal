//! P0-3 模型 ID 按“直连 / 反代”分别映射 + 压缩模型解耦（天枢 T6）。
//!
//! 背景：同一个模型在官方直连与中转站上的 ID 不一样——
//! 官方 V4.1-Flash 的真实 ID 是 `deepseek-flash`，
//! 中转站（workbuddyapi2 等）上是 `deepseek-v4-flash`。
//! 写死一个 ID，换条线就认不出来。
//!
//! 做法：每个服务商配一个 `kind`（`direct` 官方直连 / `relay` 中转站，
//! 默认 direct），发请求前按 kind 查映射表，把用户选的模型名
//! 翻译成这条线上的真实 ID；表里没有的（自定义模型、
//! 厂商已经是真实 ID 的）原样放行，不乱改。
//!
//! 压缩模型解耦：`compression_model` 是独立设置项（默认 deepseek-flash），
//! 改主模型、迁移退役 ID 都不碰它——天枢 4.0.4 还在修的事故就是
//! 压缩模型被一次迁移误改了。
//!
//! 退役 ID 迁移：`deepseek-v4` 已退役，读设置时迁到 `deepseek-flash`，
//! 并记一条日志；迁移只动主模型，不动压缩模型。

use crate::settings::ModelConfig;

/// 接入方式：`direct` 官方直连，`relay` 中转站。写错的一律按 direct。
pub fn access_kind(raw: &str) -> &'static str {
    if raw.trim().eq_ignore_ascii_case("relay") {
        "relay"
    } else {
        "direct"
    }
}

/// 官方直连线上的映射：用户选的名字 → 官方真实 ID。
const DIRECT_MAP: &[(&str, &str)] = &[
    ("deepseek-flash", "deepseek-flash"),
    ("deepseek-v4-pro", "deepseek-v4-pro"),
    ("v4.1-flash", "deepseek-flash"),
    ("v4-flash", "deepseek-flash"),
    ("4.1-flash", "deepseek-flash"),
    ("deepseek-4.1-flash", "deepseek-flash"),
    ("v4-pro", "deepseek-v4-pro"),
    ("deepseek-v4-flash", "deepseek-v4-flash"),
];

/// 中转站线上的映射：用户选的名字 → 中转站上的 ID。
/// 注意 `deepseek-flash` 在中转站上叫 `deepseek-v4-flash`——
//  两条线同名不同 ID，这就是映射表存在的意义。
const RELAY_MAP: &[(&str, &str)] = &[
    ("deepseek-flash", "deepseek-v4-flash"),
    ("deepseek-v4-pro", "deepseek-v4-pro"),
    ("v4.1-flash", "deepseek-v4-flash"),
    ("v4-flash", "deepseek-v4-flash"),
    ("4.1-flash", "deepseek-v4-flash"),
    ("deepseek-4.1-flash", "deepseek-v4-flash"),
    ("v4-pro", "deepseek-v4-pro"),
    ("deepseek-v4-flash", "deepseek-v4-flash"),
];

/// 已退役的 ID → 替代 ID。迁移时记日志，不静默换掉。
const RETIRED_MAP: &[(&str, &str)] = &[("deepseek-v4", "deepseek-flash")];

/// 按接入方式把用户选的模型名翻译成这条线上的真实 ID。
/// 表里没有的原样放行（自定义模型、厂商真实 ID 都不在表里）。
pub fn resolve_model(kind: &str, requested: &str) -> String {
    let name = requested.trim();
    if name.is_empty() {
        return name.to_string();
    }
    let table = if access_kind(kind) == "relay" {
        RELAY_MAP
    } else {
        DIRECT_MAP
    };
    for (alias, wire) in table {
        if *alias == name {
            return wire.to_string();
        }
    }
    // 大小写不敏感再试一次（用户手打的大小写常不准）。
    let lower = name.to_lowercase();
    for (alias, wire) in table {
        if alias.to_lowercase() == lower {
            return wire.to_string();
        }
    }
    // 已经是某条线上的真实 ID、或自定义模型：原样。
    name.to_string()
}

/// 退役 ID 迁移：返回 (迁移后的 ID, 迁移记录)。
/// 记录是 Some((旧, 新)) 时调用方记一条日志；没迁移返回 None。
pub fn migrate_model_id(id: &str) -> (String, Option<(String, String)>) {
    let name = id.trim();
    for (old, new) in RETIRED_MAP {
        if *old == name {
            return (new.to_string(), Some((old.to_string(), new.to_string())));
        }
    }
    (id.to_string(), None)
}

/// 压缩模型的默认值。主模型迁移、换线都不改这个值。
pub fn default_compression_model() -> String {
    "deepseek-flash".to_string()
}

pub const DEFAULT_MODEL_CONTEXT_WINDOW: usize = 524_288;
pub const DEFAULT_MODEL_MAX_TOKENS: usize = 65_536;

/// Infer a context window from a size suffix such as `-128k` / `-1m`.
/// The unit must be its own token so names like `kimi-k2` never match.
pub fn infer_model_context_window(model_id: &str) -> Option<usize> {
    for part in model_id
        .to_ascii_lowercase()
        .split(|c| matches!(c, '-' | '_' | '.' | '@' | ':'))
    {
        let (num, mul) = if let Some(n) = part.strip_suffix('k') {
            (n, 1024)
        } else if let Some(n) = part.strip_suffix('m') {
            (n, 1024 * 1024)
        } else {
            continue;
        };
        if let Ok(n) = num.parse::<usize>() {
            if n > 0 && n <= 4096 {
                return Some(n * mul);
            }
        }
    }
    None
}

pub fn context_window_with_config(
    kind: &str,
    model: &str,
    config: Option<&ModelConfig>,
) -> usize {
    if let Some(n) = config.and_then(|c| c.context_window).filter(|n| *n > 0) {
        return n;
    }
    if let Some(n) = infer_model_context_window(model) {
        return n;
    }
    capabilities(&resolve_model(kind, model)).context_window
}

pub fn max_tokens_with_config(
    kind: &str,
    model: &str,
    config: Option<&ModelConfig>,
) -> usize {
    let context = context_window_with_config(kind, model, config);
    let configured = config.and_then(|c| c.max_tokens).filter(|n| *n > 0);
    configured
        .unwrap_or_else(|| capabilities(&resolve_model(kind, model)).max_output)
        .min(context)
        .max(1)
}

/// Per-model runtime capabilities. This is intentionally a small, explicit
/// table: context window and cache behavior must follow the selected model,
/// not one global constant. Unknown models get a safe 128k fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelCaps {
    pub context_window: usize,
    pub max_output: usize,
    /// "exact_prefix" for DeepSeek-style prefix caching, "none" otherwise.
    pub cache: &'static str,
    pub reasoning_effort: bool,
}

pub fn capabilities(model: &str) -> ModelCaps {
    let m = model.trim().to_ascii_lowercase();
    if m.contains("deepseek") {
        return ModelCaps {
            context_window: 1_000_000,
            max_output: 256_000,
            cache: "exact_prefix",
            reasoning_effort: true,
        };
    }
    if m.starts_with("moonshot-v1-8k") {
        return ModelCaps {
            context_window: 8_192,
            max_output: 8_192,
            cache: "none",
            reasoning_effort: false,
        };
    }
    if m.starts_with("moonshot-v1-32k") {
        return ModelCaps {
            context_window: 32_768,
            max_output: 32_768,
            cache: "none",
            reasoning_effort: false,
        };
    }
    if m.starts_with("moonshot-v1-128k") {
        return ModelCaps {
            context_window: 131_072,
            max_output: 131_072,
            cache: "none",
            reasoning_effort: false,
        };
    }
    if m.contains("kimi") {
        return ModelCaps {
            context_window: 262_144,
            max_output: 262_144,
            cache: "none",
            reasoning_effort: false,
        };
    }
    if m.contains("qwen") {
        return ModelCaps {
            context_window: 131_072,
            max_output: 65_536,
            cache: "none",
            reasoning_effort: false,
        };
    }
    ModelCaps {
        context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
        max_output: DEFAULT_MODEL_MAX_TOKENS,
        cache: "none",
        reasoning_effort: false,
    }
}

#[allow(dead_code)] // convenience for callers without an explicit model config
pub fn context_window(kind: &str, model: &str) -> usize {
    capabilities(&resolve_model(kind, model)).context_window
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_keeps_official_ids() {
        assert_eq!(resolve_model("direct", "deepseek-flash"), "deepseek-flash");
        assert_eq!(resolve_model("direct", "deepseek-v4-pro"), "deepseek-v4-pro");
        assert_eq!(resolve_model("direct", "v4.1-flash"), "deepseek-flash");
    }

    #[test]
    fn relay_maps_to_relay_ids() {
        // 同一个名字，两条线走不同 ID——这就是映射表要解决的。
        assert_eq!(resolve_model("relay", "deepseek-flash"), "deepseek-v4-flash");
        assert_eq!(resolve_model("relay", "v4.1-flash"), "deepseek-v4-flash");
        assert_eq!(resolve_model("relay", "deepseek-v4-pro"), "deepseek-v4-pro");
    }

    #[test]
    fn unknown_model_passes_through() {
        assert_eq!(resolve_model("direct", "my-custom-model"), "my-custom-model");
        assert_eq!(resolve_model("relay", "gpt-5"), "gpt-5");
        // 写错的 kind 按 direct。
        assert_eq!(resolve_model("whatever", "v4.1-flash"), "deepseek-flash");
        assert_eq!(access_kind("RELAY"), "relay");
        assert_eq!(access_kind(""), "direct");
    }

    #[test]
    fn retired_id_migrates_with_record() {
        let (migrated, record) = migrate_model_id("deepseek-v4");
        assert_eq!(migrated, "deepseek-flash");
        assert_eq!(
            record,
            Some(("deepseek-v4".to_string(), "deepseek-flash".to_string()))
        );
        let (same, none) = migrate_model_id("deepseek-flash");
        assert_eq!(same, "deepseek-flash");
        assert!(none.is_none());
    }

    #[test]
    fn context_window_follows_model() {
        assert_eq!(context_window("direct", "deepseek-flash"), 1_000_000);
        assert_eq!(context_window("direct", "kimi-k2"), 262_144);
        assert_eq!(context_window("direct", "moonshot-v1-8k"), 8_192);
        assert_eq!(context_window("direct", "unknown-model"), 524_288);
        // Relay maps the alias first, then reads the same capability table.
        assert_eq!(context_window("relay", "deepseek-flash"), 1_000_000);
    }

    #[test]
    fn model_config_override_and_suffix_inference_win() {
        let cfg = ModelConfig {
            context_window: Some(64_000),
            max_tokens: Some(8_000),
        };
        assert_eq!(
            context_window_with_config("direct", "unknown", Some(&cfg)),
            64_000
        );
        assert_eq!(
            max_tokens_with_config("direct", "unknown", Some(&cfg)),
            8_000
        );
        assert_eq!(
            context_window_with_config("direct", "glm-4.6-air-128k", None),
            131_072
        );
        assert_eq!(
            context_window_with_config("direct", "qwen-long-1m", None),
            1_048_576
        );
    }
}
