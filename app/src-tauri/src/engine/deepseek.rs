//! DeepSeek wire-level adaptations.
//!
//! Tianshu's DeepSeek work makes one thing clear: provider differences belong
//! in data/adapters, not in scattered `if` statements. Keep the rules here so
//! the conversation loop stays provider-agnostic.

use crate::settings::ProviderConfig;
use serde_json::{json, Value};

pub fn is_deepseek(provider: &ProviderConfig) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        provider.id, provider.name, provider.base_url, provider.env_key
    )
    .to_ascii_lowercase();
    haystack.contains("deepseek")
}

/// Official mapping: low=low, medium=high, high=high, xhigh=high, max=max.
/// Do not silently turn "medium" into low; that changes the user's intent.
pub fn reasoning_effort(effort: &str) -> &'static str {
    match effort {
        "low" => "low",
        "max" | "ultra" => "max",
        "medium" | "high" | "xhigh" => "high",
        _ => "high",
    }
}

/// Add DeepSeek-only request fields.
///
/// Thinking mode ignores temperature, presence_penalty and frequency_penalty;
/// omitting temperature is clearer than sending a value that has no effect.
pub fn apply_request_fields(body: &mut Value, provider: &ProviderConfig, effort: &str) -> bool {
    if !is_deepseek(provider) {
        return false;
    }
    if let Some(obj) = body.as_object_mut() {
        obj.insert(
            "reasoning_effort".to_string(),
            json!(reasoning_effort(effort)),
        );
        obj.remove("temperature");
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::ProviderConfig;

    fn provider(id: &str, name: &str, url: &str) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: name.to_string(),
            base_url: url.to_string(),
            env_key: if id == "relay" {
                "DEEPSEEK_API_KEY".to_string()
            } else {
                format!("{}_API_KEY", id.to_ascii_uppercase())
            },
            models: vec![],
            default_model: "deepseek-flash".to_string(),
            kind: "direct".to_string(),
            model_configs: Default::default(),
        }
    }

    #[test]
    fn deepseek_effort_mapping_matches_official_behavior() {
        assert_eq!(reasoning_effort("low"), "low");
        assert_eq!(reasoning_effort("medium"), "high");
        assert_eq!(reasoning_effort("high"), "high");
        assert_eq!(reasoning_effort("xhigh"), "high");
        assert_eq!(reasoning_effort("max"), "max");
    }

    #[test]
    fn deepseek_detection_is_provider_metadata_driven() {
        assert!(is_deepseek(&provider(
            "deepseek",
            "DeepSeek",
            "https://api.deepseek.com/v1"
        )));
        assert!(is_deepseek(&provider(
            "relay",
            "WorkBuddy",
            "http://127.0.0.1:8790/v1"
        )));
        assert!(!is_deepseek(&provider(
            "openai",
            "OpenAI",
            "https://api.openai.com/v1"
        )));
    }

    #[test]
    fn deepseek_request_omits_ineffective_temperature() {
        let p = provider("deepseek", "DeepSeek", "https://api.deepseek.com/v1");
        let mut body = json!({"temperature": 0.5, "model": "deepseek-flash"});
        assert!(apply_request_fields(&mut body, &p, "medium"));
        assert_eq!(body["reasoning_effort"], "high");
        assert!(body.get("temperature").is_none());
    }
}
