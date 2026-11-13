//! P1-1 CacheAdvisor：自适应延迟压缩 + 成本感知压缩档位（天枢 T2/T3）。
//!
//! 核心公式（天枢公开源码 + 拆包复核一致）：
//! ```text
//! protection = 命中率 × (1 - 压力) × 阶段乘数
//! protection ≥ 0.45 → 延迟压缩（缓存还热，先不压）
//! ```
//! - 命中率：最近的缓存命中率（服务商回报的 cached / prompt 的 EMA，
//!   没数据时按 1.0 算——新会话别急着压，保守优先）。
//! - 压力：上轮 prompt tokens / 上下文窗口。窗口未知时按 128K 估算，
//!   并在决策里标 `window_estimated: true`，仪表盘上会写明“按 128K 估算”。
//! - 阶段乘数（天枢原值）：explore 1 / plan 1.5 / execute 1 / verify 2 / deliver 0.5。
//!   校验/收尾阶段最护缓存（别在验证时把历史压没了），交付阶段最不护。
//!
//! 成本感知档位（T3）：按“计费 × 缓存”选策略。
//! - `cache-preserving`（DeepSeek 默认）：绝不重写冻结前缀，只压中间历史，
//!   且一次非强制压缩必须满足最小回收量（≥ max(8192 tokens, prompt 的 20%)），
//!   否则宁可不压——重写前缀的代价比省下的 token 贵。
//! - `balanced`：其他按 token 计费的服务商；最小回收量 max(4096, 10%)。
//! - `aggressive`：无缓存定价的服务商或用户显式指定；最小回收量 2048。
//!
//! 档位由设置 `compression_tier` 定（auto = 按服务商自动选）；
//! 显式指定时 auto 不生效。
//!
//! ghost 注册表：被压缩逐出的消息记一条“幽灵”（内容指纹 + 前 120 字摘要）。
//! 之后用户要召回的东西命中了某条幽灵 = 当初逐错了，记一次 ghost hit，
//! 仪表盘上如实展示（这是调节器的自我纠错信号，不藏着）。

use serde::{Deserialize, Serialize};

/// 模型上下文窗口（tokens）。只写有把握的数，查不到的返回 None，
///
/// 调用方按 128K 估算并标明——绝不在仪表盘上把估算当成实数。
/// - deepseek-flash（V4.1 Flash）：官方 1M 上下文（P0 验证时模型列表里就是 1M）。
/// - deepseek-v4-pro / deepseek-chat（V3.2）：V4/V3.2 系列 128K。
/// - deepseek-reasoner（R1）：64K。
/// - kimi-k2：256K。moonshot-v1-8k / v1-32k：按名字。
pub fn context_window(model: &str) -> Option<u64> {
    match model.trim() {
        "deepseek-flash" | "deepseek-v4-flash" | "deepseek-v4-flash-vision-exp" => Some(1_048_576),
        "deepseek-v4-pro" | "deepseek-chat" => Some(131_072),
        "deepseek-reasoner" => Some(65_536),
        "kimi-k2" => Some(262_144),
        "moonshot-v1-8k" => Some(8_192),
        "moonshot-v1-32k" => Some(32_768),
        _ => None,
    }
}

/// 窗口未知时的估算值（128K）。只用于压力计算，仪表盘上必须标明是估算。
pub const DEFAULT_WINDOW_ESTIMATE: u64 = 131_072;

/// 压缩档位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompressionTier {
    CachePreserving,
    Balanced,
    Aggressive,
}

impl CompressionTier {
    pub fn label(&self) -> &'static str {
        match self {
            CompressionTier::CachePreserving => "cache-preserving",
            CompressionTier::Balanced => "balanced",
            CompressionTier::Aggressive => "aggressive",
        }
    }

    /// 该档位下一次非强制压缩的最小回收量（tokens）。
    /// cache-preserving 最严：重写一次前缀很贵，回收不够就别动手。
    pub fn min_reclaim_tokens(&self, prompt_tokens: u64) -> u64 {
        match self {
            CompressionTier::CachePreserving => (8_192).max(prompt_tokens / 5),
            CompressionTier::Balanced => (4_096).max(prompt_tokens / 10),
            CompressionTier::Aggressive => 2_048,
        }
    }

    /// 该档位下压缩后保留的尾部消息条数（最近的对话不动，模型还有“近记忆”）。
    pub fn tail_keep_messages(&self) -> usize {
        match self {
            CompressionTier::CachePreserving => 8,
            CompressionTier::Balanced => 6,
            CompressionTier::Aggressive => 4,
        }
    }
}

/// 按设置 + 服务商选档位。设置写错/空 = auto。
pub fn tier_for(setting: &str, provider_id: &str) -> CompressionTier {
    match setting.trim() {
        "cache-preserving" => CompressionTier::CachePreserving,
        "balanced" => CompressionTier::Balanced,
        "aggressive" => CompressionTier::Aggressive,
        _ => {
            // auto：DeepSeek 按 token 计费且缓存价差极大，用最护缓存的档；
            // 其他服务商默认 balanced（按 token 计费、缓存未知）。
            if provider_id.trim() == "deepseek" {
                CompressionTier::CachePreserving
            } else {
                CompressionTier::Balanced
            }
        }
    }
}

/// 会话阶段（天枢阶段乘数原值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    /// 普通闲聊 / 探索。
    Explore,
    /// 计划模式。
    Plan,
    /// 执行中（目标进行中、普通执行）。
    Execute,
    /// 校验/收尾（目标刚自然结束、正在验证）。
    Verify,
    /// 交付后（目标已完成）。
    Deliver,
}

impl Phase {
    pub fn multiplier(&self) -> f64 {
        match self {
            Phase::Explore => 1.0,
            Phase::Plan => 1.5,
            Phase::Execute => 1.0,
            Phase::Verify => 2.0,
            Phase::Deliver => 0.5,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Phase::Explore => "explore",
            Phase::Plan => "plan",
            Phase::Execute => "execute",
            Phase::Verify => "verify",
            Phase::Deliver => "deliver",
        }
    }
}

/// 延迟压缩的阈值（天枢原值）。
pub const PROTECTION_THRESHOLD: f64 = 0.45;

/// 摘要一次的成本估算（tokens）：摘要本身约 1200 字 + 提示词开销，
/// 估 1500。回收量 = 可压段估算 − 这个数。
pub const SUMMARY_COST_ESTIMATE: u64 = 1500;

/// 本轮会话处于哪个阶段（目标模式自动压缩的钩子用；纯函数，好测）。
/// 优先级：计划模式 > 校验中（有未验证的改动）> 刚交付完 > 执行中。
pub fn compression_phase(
    run_mode: &str,
    verification_nudged: bool,
    has_unverified_writes: bool,
    resumed_after_done: bool,
) -> Phase {
    if run_mode == "plan" {
        Phase::Plan
    } else if verification_nudged && has_unverified_writes {
        Phase::Verify
    } else if resumed_after_done {
        Phase::Deliver
    } else {
        Phase::Execute
    }
}

/// 预计回收量：可压段（system [0] 与尾部 tail_keep 条之外）的估算
/// tokens − 摘要成本；中间段不到 4 条 = 0（压不了）。
/// 纯函数，好测。
pub fn reclaim_estimate(messages: &[serde_json::Value], tail_keep: usize) -> u64 {
    let middle_len = messages.len().saturating_sub(1 + tail_keep);
    if middle_len < 4 {
        return 0;
    }
    let middle = &messages[1..1 + middle_len];
    let est: u64 = middle
        .iter()
        .map(|m| {
            crate::compact::estimate_tokens(
                m.get("content").and_then(|c| c.as_str()).unwrap_or(""),
            )
        })
        .sum();
    est.saturating_sub(SUMMARY_COST_ESTIMATE)
}

pub struct AdvisorInput {
    /// 最近的缓存命中率（0–1）；None = 还没数据，按 1.0 保守算。
    pub hit_rate: Option<f64>,
    /// 上轮 prompt tokens（= 当时发出去的上下文大小，服务商实报）。
    pub prompt_tokens: u64,
    /// 模型上下文窗口；None = 未知，按 128K 估算。
    pub window: Option<u64>,
    pub phase: Phase,
    pub tier: CompressionTier,
    /// 本次若压缩，预计能回收多少 tokens（可压部分 − 摘要成本的估算）。
    /// 调用方用 compact::estimate_tokens 算；0 = 没算过，按“够”处理。
    pub reclaim_estimate: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvisorDecision {
    /// true = 现在压；false = 延迟。
    pub compress: bool,
    /// 保护值（命中率 × (1−压力) × 阶段乘数）。
    pub protection: f64,
    /// 压力（prompt / 窗口，0–1）。
    pub pressure: f64,
    /// 决策用的命中率（没数据时为 1.0）。
    pub hit_rate: f64,
    /// 窗口是不是估算的（true 时仪表盘上写明）。
    pub window_estimated: bool,
    pub phase: String,
    pub tier: String,
    /// 人话原因（仪表盘上原样展示）。
    pub reason: String,
}

/// 按公式做一次决策。纯函数，好测。
pub fn decide(input: &AdvisorInput) -> AdvisorDecision {
    let window = input.window.unwrap_or(DEFAULT_WINDOW_ESTIMATE);
    let window_estimated = input.window.is_none();
    let pressure = (input.prompt_tokens as f64 / window as f64).clamp(0.0, 1.0);
    let hit_rate = input.hit_rate.unwrap_or(1.0).clamp(0.0, 1.0);
    let mult = input.phase.multiplier();
    let protection = hit_rate * (1.0 - pressure) * mult;
    let phase_label = input.phase.label().to_string();
    let tier_label = input.tier.label().to_string();

    if protection >= PROTECTION_THRESHOLD {
        return AdvisorDecision {
            compress: false,
            protection,
            pressure,
            hit_rate,
            window_estimated,
            phase: phase_label,
            tier: tier_label,
            reason: format!(
                "保护值 {protection:.2} ≥ {PROTECTION_THRESHOLD}（命中率 {hit_pct:.0}%、压力 {pressure_pct:.0}%、阶段 {phase} ×{mult}）：缓存还热，先不压",
                phase = input.phase.label(),
                hit_pct = hit_rate * 100.0,
                pressure_pct = pressure * 100.0,
            ),
        };
    }
    // 保护值已跌破阈值：再看回收量够不够。重写一次历史有成本，
    // 回收太少就不值得动——这是 T3 “最小回收量”的规矩。
    let min_reclaim = input.tier.min_reclaim_tokens(input.prompt_tokens);
    if input.reclaim_estimate > 0 && input.reclaim_estimate < min_reclaim {
        return AdvisorDecision {
            compress: false,
            protection,
            pressure,
            hit_rate,
            window_estimated,
            phase: phase_label,
            tier: tier_label,
            reason: format!(
                "保护值 {protection:.2} 已低于 {PROTECTION_THRESHOLD}，但预计回收约 {} tokens、不到该档位的最小回收量 {} tokens：这次不压，等历史再长一点",
                input.reclaim_estimate, min_reclaim
            ),
        };
    }
    AdvisorDecision {
        compress: true,
        protection,
        pressure,
        hit_rate,
        window_estimated,
        phase: phase_label,
        tier: tier_label,
        reason: format!(
            "保护值 {protection:.2} < {PROTECTION_THRESHOLD}（命中率 {hit_pct:.0}%、压力 {pressure_pct:.0}%、阶段 {phase} ×{mult}）：可以压缩",
            phase = input.phase.label(),
            hit_pct = hit_rate * 100.0,
            pressure_pct = pressure * 100.0,
        ),
    }
}

/// 幽灵注册表的一条：被压缩逐出的消息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostEntry {
    /// 内容 sha256（前 16 位 hex，够认出是哪条）。
    pub fingerprint: String,
    /// 前 120 字摘要（召回匹配用）。
    pub excerpt: String,
    /// 逐出时间（Unix 秒）。
    pub evicted_at: u64,
    /// 之后被召回过（= 当初逐错了）。
    pub recalled: bool,
    /// 所在的归档 id（召回原文用；老数据没有时为空）。
    #[serde(default)]
    pub archive_id: String,
    /// 在归档里的页号（每页 10 条）。
    #[serde(default)]
    pub page: usize,
    /// 在归档里的下标。
    #[serde(default)]
    pub index: usize,
}

pub fn ghost_fingerprint(content: &str) -> String {
    let hash = crate::frozen::sha256_hex(content);
    hash[..16].to_string()
}

/// 召回时先查幽灵：query 命中某条幽灵的摘要（子串匹配）= 逐错了。
/// 命中时把那条标 recalled，返回它在表里的下标；调用方据此把原文找
/// 回来、记一次 ghost hit。没命中返回 None。
pub fn ghost_check(ghosts: &mut [GhostEntry], query: &str) -> Option<usize> {
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    for (i, g) in ghosts.iter_mut().enumerate() {
        if g.recalled {
            continue;
        }
        if g.excerpt.contains(q) || q.contains(g.excerpt.as_str()) {
            g.recalled = true;
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(hit: Option<f64>, prompt: u64, window: Option<u64>, phase: Phase) -> AdvisorInput {
        AdvisorInput {
            hit_rate: hit,
            prompt_tokens: prompt,
            window,
            phase,
            tier: CompressionTier::CachePreserving,
            reclaim_estimate: 0,
        }
    }

    #[test]
    fn hot_cache_delays() {
        // 命中率 99%、压力 10%：protection = 0.99×0.9 = 0.891 ≥ 0.45，不压。
        let d = decide(&input(Some(0.99), 100_000, Some(1_048_576), Phase::Execute));
        assert!(!d.compress);
        assert!((d.protection - 0.891).abs() < 0.01);
    }

    #[test]
    fn cold_cache_and_high_pressure_compresses() {
        // 命中率 20%、压力 80%：protection = 0.2×0.2 = 0.04 < 0.45，压。
        let d = decide(&input(Some(0.20), 838_860, Some(1_048_576), Phase::Execute));
        assert!(d.compress);
        assert!(!d.window_estimated);
    }

    #[test]
    fn verify_phase_protects_most() {
        // 同样 50% 命中、50% 压力：execute 保护值 0.25（压），
        // verify ×2 → 0.5（不压）。验证时别动历史。
        let d_exec = decide(&input(Some(0.5), 524_288, Some(1_048_576), Phase::Execute));
        assert!(d_exec.compress);
        let d_verify = decide(&input(Some(0.5), 524_288, Some(1_048_576), Phase::Verify));
        assert!(!d_verify.compress);
        assert!((d_verify.protection - 0.5).abs() < 1e-9);
    }

    #[test]
    fn deliver_phase_protects_least() {
        // 命中率 90%、压力 10%：deliver ×0.5 → 0.405 < 0.45，压（收尾了）。
        let d = decide(&input(Some(0.9), 100_000, Some(1_048_576), Phase::Deliver));
        assert!(d.compress);
    }

    #[test]
    fn no_data_assumes_warm_and_estimates_window() {
        // 没跑过：命中率按 1.0、窗口按 128K 估算，保护值高，不压。
        let d = decide(&input(None, 10_000, None, Phase::Explore));
        assert!(!d.compress);
        assert!(d.window_estimated);
        assert!((d.hit_rate - 1.0).abs() < 1e-9);
    }

    #[test]
    fn min_reclaim_blocks_tiny_compression() {
        // 保护值已破，但预计只回收 1000 tokens（cache-preserving 最小 8192）：不压。
        let mut i = input(Some(0.1), 100_000, Some(1_048_576), Phase::Execute);
        i.reclaim_estimate = 1_000;
        let d = decide(&i);
        assert!(!d.compress);
        assert!(d.reason.contains("最小回收量"));
        // 回收够了就压。
        i.reclaim_estimate = 50_000;
        assert!(decide(&i).compress);
    }

    #[test]
    fn tier_selection() {
        assert_eq!(
            tier_for("auto", "deepseek"),
            CompressionTier::CachePreserving
        );
        assert_eq!(tier_for("auto", "kimi"), CompressionTier::Balanced);
        assert_eq!(
            tier_for("aggressive", "deepseek"),
            CompressionTier::Aggressive
        );
        assert_eq!(
            tier_for("写错了", "deepseek"),
            CompressionTier::CachePreserving
        );
        // 档位参数：cache-preserving 尾部留 8 条、最小回收 8192 起。
        assert_eq!(CompressionTier::CachePreserving.tail_keep_messages(), 8);
        assert_eq!(
            CompressionTier::CachePreserving.min_reclaim_tokens(10_000),
            8_192
        );
        assert_eq!(
            CompressionTier::CachePreserving.min_reclaim_tokens(100_000),
            20_000
        );
    }

    #[test]
    fn ghost_registry_marks_mistakes() {
        let mut ghosts = vec![GhostEntry {
            fingerprint: ghost_fingerprint("把校验规则抽成函数"),
            excerpt: "把校验规则抽成函数".to_string(),
            evicted_at: 1,
            recalled: false,
            archive_id: "a1".to_string(),
            page: 0,
            index: 3,
        }];
        // 命中摘要里的词 = 逐错了，返回下标。
        assert_eq!(ghost_check(&mut ghosts, "校验规则"), Some(0));
        assert!(ghosts[0].recalled);
        // 标过的不重复记。
        assert_eq!(ghost_check(&mut ghosts, "校验规则"), None);
        // 没命中。
        assert_eq!(ghost_check(&mut ghosts, "食堂吃什么"), None);
    }

    #[test]
    fn context_windows_known() {
        assert_eq!(context_window("deepseek-flash"), Some(1_048_576));
        assert_eq!(context_window("deepseek-v4-pro"), Some(131_072));
        assert_eq!(context_window("kimi-k2"), Some(262_144));
        assert_eq!(context_window("gpt-5"), None);
    }

    #[test]
    fn compression_phase_priority() {
        // 计划模式优先于一切。
        assert_eq!(
            compression_phase("plan", true, true, true),
            Phase::Plan
        );
        // 校验中（有未验证的改动）优先于交付后。
        assert_eq!(
            compression_phase("chat", true, true, true),
            Phase::Verify
        );
        // 校验提醒过、但改动已全部验证 = 不是校验阶段。
        assert_eq!(
            compression_phase("chat", true, false, true),
            Phase::Deliver
        );
        // 刚交付完。
        assert_eq!(
            compression_phase("chat", false, false, true),
            Phase::Deliver
        );
        // 默认执行中。
        assert_eq!(
            compression_phase("chat", false, false, false),
            Phase::Execute
        );
    }

    #[test]
    fn reclaim_estimate_counts_middle_only() {
        use serde_json::json;
        // system + 6 条长消息（每条 4000 字符 ≈ 1000 tokens）+ 尾部 2 条。
        let mut msgs = vec![json!({"role": "system", "content": "sys"})];
        for _ in 0..8 {
            msgs.push(json!({"role": "user", "content": "x".repeat(4000)}));
        }
        // tail_keep=2：中间 = 8-2 = 6 条，估 6000 − 1500 = 4500。
        assert_eq!(reclaim_estimate(&msgs, 2), 4500);
        // 中间不到 4 条 = 0（system + 3 条中间 + 2 条尾部）。
        let short = msgs[..6].to_vec();
        assert_eq!(reclaim_estimate(&short, 2), 0);
    }
}
