//! P0-1 冻结前缀 + appendixDelta（天枢 T1）。
//!
//! 思路：一次会话里，系统提示词正文 + 工具定义表是固定不变的——
//! 把它们冻成一个前缀（`FrozenPrefix`），之后每轮请求原样发送，
//! 字节一字不动；服务商的前缀缓存就能命中，只按增量计费。
//! 动态内容只走附录（appendixDelta）：按需注入的龙族章节、
//! 目标清单的运行时提示等，追加在冻结正文之后，绝不重写冻结部分。
//!
//! 校验：冻结时算一次 sha256，存在会话里；每次复用前重算一遍，
//! 对不上说明冻结内容被悄悄改过——重建边界并记一条日志，
//! 绝不带着被改过的前缀继续发。
//!
//! 继承：目标会话创建时冻结快照写进 `frozen.json`（检查点目录里，
//! 天枢叫 `.frozen.json`）；倒带 / 应用重启后读回来，hash 对上就
//! 用原样字节，不用按当前输入重拼。
//!
//! 注意：冻结的是 system 消息正文 + 工具定义，不包括用户消息与
//! 工具结果——那些是增量。普通对话（无目标会话）没有持久化的会话，
//! 每轮现建一个冻结前缀：一轮 8 次请求里前缀仍然稳定，缓存照样命中。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// 冻结前缀：一次会话里字节稳定的部分。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrozenPrefix {
    /// 冻结的 system 消息正文（人设 + §0 常驻 + 诚实规则 +
    /// 计划/目标纪律 + 工作区说明）。不含按需注入的龙族章节。
    pub system: String,
    /// 冻结的工具定义表（本会话的 run_mode + mode 决定）。
    pub tools: Value,
    /// sha256(system + "\n\x00" + tools 紧凑 JSON)，十六进制小写。
    pub hash: String,
}

/// 算 sha256，十六进制小写。
pub fn sha256_hex(data: &str) -> String {
    let mut h = Sha256::new();
    h.update(data.as_bytes());
    format!("{:x}", h.finalize())
}

impl FrozenPrefix {
    /// 建一个冻结前缀并算 hash。
    pub fn build(system: String, tools: Value) -> Self {
        let tools_json = serde_json::to_string(&tools).unwrap_or_default();
        let hash = sha256_hex(&format!("{system}\n\x00{tools_json}"));
        FrozenPrefix {
            system,
            tools,
            hash,
        }
    }

    /// 验 hash：冻结内容有没有被悄悄改过。
    pub fn verify(&self) -> bool {
        let tools_json = serde_json::to_string(&self.tools).unwrap_or_default();
        sha256_hex(&format!("{}\n\x00{}", self.system, tools_json)) == self.hash
    }

    /// 发请求时的 system 正文：冻结部分 + 附录（按需注入，可空）。
    /// 附录只追加在末尾，冻结部分一个字节都不动。
    pub fn with_appendix(&self, appendix: &str) -> String {
        if appendix.trim().is_empty() {
            self.system.clone()
        } else {
            format!("{}\n\n{}", self.system, appendix.trim())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> FrozenPrefix {
        FrozenPrefix::build(
            "你是诺玛。\n\n[规则]\n诚实。".to_string(),
            json!([{"type": "function", "function": {"name": "read_file"}}]),
        )
    }

    #[test]
    fn same_inputs_same_hash() {
        let a = sample();
        let b = sample();
        assert_eq!(a.hash, b.hash);
        assert_eq!(a.system, b.system);
        assert!(a.verify());
    }

    #[test]
    fn tampered_system_fails_verify() {
        let mut p = sample();
        p.system.push_str("偷偷加一句。");
        assert!(!p.verify());
    }

    #[test]
    fn tampered_tools_fails_verify() {
        let mut p = sample();
        p.tools = json!([{"type": "function", "function": {"name": "run_shell"}}]);
        assert!(!p.verify());
    }

    #[test]
    fn appendix_does_not_touch_frozen_part() {
        let p = sample();
        let with = p.with_appendix("龙族章节：时间零是 84 号言灵。");
        assert!(with.starts_with(&p.system));
        assert!(with.contains("时间零"));
        // 冻结部分本身没变，hash 还是对的。
        assert!(p.verify());
        // 空附录 = 原样。
        assert_eq!(p.with_appendix(""), p.system);
        assert_eq!(p.with_appendix("   \n  "), p.system);
    }
}
