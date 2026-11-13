//! P0-10：用量 / 缓存面板的后端。
//!
//! 数字全部来自服务商真实回报的 usage，绝不估算 token 数；花费是“估算”，
//! 按 DeepSeek 官方价目表算（2026-11-13 核实，多源一致），面板上会写明
//! 是估算、中转站实际价格可能不同。
//!
//! 官方价（USD / 1M tokens，2026-08-16 起峰谷两档，闲时 = 峰时一半）：
//! - deepseek-flash（V4.1 Flash）：输入未命中 0.30 / 0.15，输入命中 0.006 / 0.003，输出 1.20 / 0.60
//! - deepseek-v4-pro（V4 Pro）：输入未命中 1.32 / 0.66，输入命中 0.044 / 0.022，输出 3.96 / 1.98
//! - deepseek-chat（V3 旧价，无峰谷）：输入未命中 0.27，命中 0.07，输出 1.10
//! - deepseek-reasoner（R1 旧价，无峰谷）：输入未命中 0.55，命中 0.14，输出 2.19
//! - deepseek-v4-flash 是旧名，按官方说法走 V4.1 Flash 的价。
//! - 其他模型（Kimi / 千问 / OpenAI / 自定义）：没有收录价目，花费显示“—”，只显示 token 数。
//!
//! 峰时（UTC）：工作日 01:00–04:00 与 06:00–10:00（北京时间 09:00–12:00 与
//! 14:00–18:00）；其余时间一律闲时。中国法定节假日官方也算闲时，但本机
//! 没有节假日表，节假日会按峰时算、略有高估，面板脚注会写明。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 一条用量记录（一次 run 的合计，写盘时按请求时间定峰/闲）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    /// Unix 秒（请求结束时间）。
    pub ts: u64,
    pub model: String,
    pub prompt: u64,
    pub completion: u64,
    /// 缓存命中 tokens（服务商回报的 cached_tokens / prompt_cache_hit_tokens）。
    pub cached: u64,
    /// 按官方价目估算的花费（USD）；模型没收录价目时为 None。
    pub cost_usd: Option<f64>,
    /// 缓存省下的钱（命中部分按未命中价与命中价之差算）；没收录价目时为 None。
    pub saved_usd: Option<f64>,
}

/// 一组用量合计（面板上的一档）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UsageStats {
    pub prompt: u64,
    pub completion: u64,
    pub cached: u64,
    pub requests: u64,
    pub cost_usd: Option<f64>,
    pub saved_usd: Option<f64>,
}

impl UsageStats {
    pub fn add_record(&mut self, r: &UsageRecord) {
        self.prompt += r.prompt;
        self.completion += r.completion;
        self.cached += r.cached;
        self.requests += 1;
        if let Some(c) = r.cost_usd {
            *self.cost_usd.get_or_insert(0.0) += c;
        }
        if let Some(s) = r.saved_usd {
            *self.saved_usd.get_or_insert(0.0) += s;
        }
    }

    // 缓存命中率（0–1）由面板前端用 cached / prompt 现算，这里不重复提供，
    // 避免两处口径漂移；没有 prompt 时前端显示“—”。
}

/// 今日 / 近 7 天 / 近 30 天 / 本次启动四档。
#[derive(Debug, Clone, Serialize)]
pub struct UsageOverview {
    pub today: UsageStats,
    pub last7d: UsageStats,
    pub last30d: UsageStats,
    pub session: UsageStats,
}

/// 价目表一行：峰时价（USD / 1M tokens）；闲时 = 峰时一半（有峰谷的模型）。
/// flat=true 的旧模型没有峰谷，峰闲同价。
struct PriceRow {
    miss_peak: f64,
    hit_peak: f64,
    out_peak: f64,
    flat: bool,
}

fn price_row(model: &str) -> Option<PriceRow> {
    match model {
        "deepseek-flash" | "deepseek-v4-flash" | "deepseek-v4-flash-vision-exp" => {
            Some(PriceRow { miss_peak: 0.30, hit_peak: 0.006, out_peak: 1.20, flat: false })
        }
        "deepseek-v4-pro" => Some(PriceRow { miss_peak: 1.32, hit_peak: 0.044, out_peak: 3.96, flat: false }),
        // deepseek-v4-pro 退役后官方路由到 V4.1 Flash，按 Flash 价。
        "deepseek-v4" => Some(PriceRow { miss_peak: 0.30, hit_peak: 0.006, out_peak: 1.20, flat: false }),
        "deepseek-chat" => Some(PriceRow { miss_peak: 0.27, hit_peak: 0.07, out_peak: 1.10, flat: true }),
        "deepseek-reasoner" => Some(PriceRow { miss_peak: 0.55, hit_peak: 0.14, out_peak: 2.19, flat: true }),
        _ => None,
    }
}

/// 峰时判断（UTC）：工作日 01:00–04:00 或 06:00–10:00。
/// 用纯算术算 UTC 星期与小时，不引入 chrono 依赖。
pub fn is_peak(ts_unix: u64) -> bool {
    let secs_day = ts_unix % 86_400;
    let hour = secs_day / 3600;
    let in_window = (1..4).contains(&hour) || (6..10).contains(&hour);
    if !in_window {
        return false;
    }
    // 1970-01-01 是星期四；days_since_epoch % 7 == 0 → 周四。
    let days = ts_unix / 86_400;
    let weekday = (days + 4) % 7; // 0=周日 … 6=周六
    (1..=5).contains(&weekday)
}

/// 估算一次请求的花费与节省（USD）。模型没收录价目时返回 (None, None)。
pub fn estimate_cost(
    model: &str,
    prompt: u64,
    cached: u64,
    completion: u64,
    ts_unix: u64,
) -> (Option<f64>, Option<f64>) {
    let Some(row) = price_row(model) else {
        return (None, None);
    };
    let peak = !row.flat && is_peak(ts_unix);
    let factor = if peak { 1.0 } else { 0.5 };
    let miss_rate = row.miss_peak * factor;
    let hit_rate = row.hit_peak * factor;
    let out_rate = row.out_peak * factor;
    let miss_tokens = prompt.saturating_sub(cached);
    let cost = (miss_tokens as f64 * miss_rate
        + cached as f64 * hit_rate
        + completion as f64 * out_rate)
        / 1_000_000.0;
    let saved = cached as f64 * (miss_rate - hit_rate) / 1_000_000.0;
    (Some(cost), Some(saved))
}

/// 台账路径：应用配置目录下的 usage-ledger.json。
pub fn ledger_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("usage-ledger.json"))
}

/// 读台账（没有/损坏 = 空台账，不拦任务）。
pub fn load_ledger(app: &AppHandle) -> Vec<UsageRecord> {
    let Some(path) = ledger_path(app) else {
        return Vec::new();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Vec<UsageRecord>>(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 追加一条记录：超过 31 天的清掉，最多留 5000 条。写盘失败只记日志。
pub fn append_ledger(app: &AppHandle, record: UsageRecord) {
    let Some(path) = ledger_path(app) else {
        return;
    };
    let mut records = load_ledger(app);
    let cutoff = record.ts.saturating_sub(31 * 86_400);
    records.retain(|r| r.ts >= cutoff);
    records.push(record);
    if records.len() > 5000 {
        let drop = records.len() - 5000;
        records.drain(..drop);
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, serde_json::to_string(&records).unwrap_or_default()) {
        eprintln!("[usage] 写台账失败：{e}");
    }
}

/// 从台账算今日 / 近 7 天 / 近 30 天（按本地日期切“今日”：UTC+8 的自然日）。
pub fn overview_from_ledger(records: &[UsageRecord], now_unix: u64) -> (UsageStats, UsageStats, UsageStats) {
    // 北京时间自然日的起点（UTC+8）。
    let beijing_now = now_unix + 8 * 3600;
    let today_start = beijing_now - (beijing_now % 86_400) - 8 * 3600;
    let mut today = UsageStats::default();
    let mut last7d = UsageStats::default();
    let mut last30d = UsageStats::default();
    for r in records {
        if r.ts >= today_start {
            today.add_record(r);
        }
        if r.ts + 7 * 86_400 >= now_unix {
            last7d.add_record(r);
        }
        if r.ts + 30 * 86_400 >= now_unix {
            last30d.add_record(r);
        }
    }
    (today, last7d, last30d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-11-13 是星期五（UTC）。2026-11-13 02:00 UTC = 周五峰时。
    fn ts_utc(y: u64, m: u64, d: u64, h: u64) -> u64 {
        // 简化：只算 2026-11 月内的几天（11-13 周五、11-14 周六）。
        let base: u64 = 1_794_528_000; // 2026-11-13 00:00 UTC（周五）
        let day_off = match (m, d) {
            (11, 13) => 0,
            (11, 14) => 1,
            (11, 15) => 2,
            (11, 16) => 3,
            _ => 0,
        };
        let _ = y;
        base + day_off * 86_400 + h * 3600
    }

    #[test]
    fn peak_windows() {
        // 周五 02:00 UTC 在峰时窗内；05:00 不在；07:00 在；11:00 不在。
        assert!(is_peak(ts_utc(2026, 11, 13, 2)));
        assert!(!is_peak(ts_utc(2026, 11, 13, 5)));
        assert!(is_peak(ts_utc(2026, 11, 13, 7)));
        assert!(!is_peak(ts_utc(2026, 11, 13, 11)));
        // 周六 02:00 UTC 不是峰时（周末全是闲时）。
        assert!(!is_peak(ts_utc(2026, 11, 14, 2)));
        // 周一 02:00 UTC 是峰时。
        assert!(is_peak(ts_utc(2026, 11, 16, 2)));
    }

    #[test]
    fn cost_flash_peak_vs_offpeak() {
        // deepseek-flash：10k prompt（9k 命中）+ 1k 完成。
        // 峰时：1k×0.30 + 9k×0.006 + 1k×1.20 = 0.0003+0.000054+0.0012 = 0.001554 /1M…按百万算：
        // 实际：(1000×0.30 + 9000×0.006 + 1000×1.20)/1e6 = (300+54+1200)/1e6 = 0.001554
        let (cost, saved) = estimate_cost("deepseek-flash", 10_000, 9_000, 1_000, ts_utc(2026, 11, 13, 2));
        assert!((cost.unwrap() - 0.001554).abs() < 1e-9);
        // 省下：9000×(0.30−0.006)/1e6 = 0.002646
        assert!((saved.unwrap() - 0.002646).abs() < 1e-9);
        // 闲时正好一半。
        let (cost_off, _) = estimate_cost("deepseek-flash", 10_000, 9_000, 1_000, ts_utc(2026, 11, 13, 5));
        assert!((cost_off.unwrap() - 0.000777).abs() < 1e-9);
    }

    #[test]
    fn cost_unknown_model_is_none() {
        let (cost, saved) = estimate_cost("kimi-k2", 10_000, 9_000, 1_000, ts_utc(2026, 11, 13, 2));
        assert!(cost.is_none() && saved.is_none());
    }

    #[test]
    fn overview_windows() {
        let now = ts_utc(2026, 11, 13, 12); // 周五 12:00 UTC = 北京时间 20:00
        let mk = |ts: u64| UsageRecord {
            ts,
            model: "deepseek-flash".into(),
            prompt: 100,
            completion: 10,
            cached: 90,
            cost_usd: Some(0.001),
            saved_usd: Some(0.002),
        };
        let records = vec![
            mk(now - 3600),            // 今天
            mk(now - 3 * 86_400),      // 3 天前：进 7 天与 30 天
            mk(now - 10 * 86_400),     // 10 天前：只进 30 天
            mk(now - 40 * 86_400),     // 40 天前：都不进
        ];
        let (today, d7, d30) = overview_from_ledger(&records, now);
        assert_eq!(today.requests, 1);
        assert_eq!(d7.requests, 2);
        assert_eq!(d30.requests, 3);
        assert_eq!(d30.prompt, 300);
    }
}
