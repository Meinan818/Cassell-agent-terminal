//! P1-13 XiaoSi Compress2.0：先归档再压缩 + 按页召回（天枢 T16）。
//!
//! 用户最怕的是“压缩不可逆”——压完发现丢了关键信息找不回来。
//! 所以压缩之前先把原文原样归档，摘要里留一个密封的检查点，
//! 需要时按页把原文召回来看。
//!
//! 三条铁律（拆包证实的天枢做法，原样抄）：
//! 1. **先归档再压**：原文写进 `context/<task>/archives/<id>.json`，
//!    摘要只替换会话里的历史，归档文件永远不动。
//! 2. **检查点密封**：摘要末尾带 `<xiaosi-checkpoint>{json}</xiaosi-checkpoint>`，
//!    正好一对开闭标签、JSON 能解析、字段齐全才认；对不上就当没有检查点，
//!    摘要只当普通文本用，绝不凭它去删归档。
//! 3. **压缩期间历史变了就禁止替换**：动手前给要压的那段历史拍指纹
//!    （sha256）；摘要回来后重新算一遍，对不上就丢弃摘要、保留原文，
//!    记一条日志——绝不拿旧摘要覆盖新历史。
//!
//! 摘要本身：调压缩模型（独立字段 `compression_model`，P0-3 解耦过，
//! 迁移退役 ID 时不许悄悄改它；这里只按接入方式翻 wire ID，不做迁移）。
//! 摘要前缀固定写 `XiaoSi Compress2.0`（天枢的长摘要前缀），
//! 内容只保留决策、事实、数字、文件路径、失败与未决，不编造。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// 摘要前缀（天枢长摘要前缀原样）。
pub const COMPACT_PREFIX: &str = "XiaoSi Compress2.0";

/// 归档一页的消息条数（按页召回的页大小）。
pub const ARCHIVE_PAGE_SIZE: usize = 10;

/// token 估算：中文按字算、英文按词算的粗估（约 4 字符 1 token）。
/// 只用于“回收量够不够”的门槛判断，绝不显示成真实用量——
/// 真实用量永远只用服务商回报的 usage。
pub fn estimate_tokens(text: &str) -> u64 {
    ((text.chars().count() as u64) / 4).max(1)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 上下文数据的根目录：应用数据目录下的 context/（与检查点分开——
/// 归档属于对话本身，目标重启清检查点时不许顺手清掉归档）。
pub fn context_dir(data_dir: &Path, task_id: &str) -> PathBuf {
    data_dir
        .join("context")
        .join(crate::goal::sanitize_id_pub(task_id))
}

fn archives_dir(data_dir: &Path, task_id: &str) -> PathBuf {
    context_dir(data_dir, task_id).join("archives")
}

/// 一次归档的条目（index.json 里的一行 + 密封检查点里的内容）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    pub id: String,
    pub created_at: u64,
    pub message_count: usize,
    /// 页数（每页 ARCHIVE_PAGE_SIZE 条）。
    pub pages: usize,
    /// 被归档那段历史的 sha256（规范 JSON 的 hash）。
    pub source_hash: String,
    /// 归档时那轮的 prompt tokens（服务商实报；没有就是 0）。
    pub prompt_tokens_before: u64,
    /// 摘要字符数。
    pub summary_chars: usize,
}

/// 归档文件：一段历史的原文 + 条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFile {
    pub entry: ArchiveEntry,
    pub messages: Vec<Value>,
}

fn archive_path(data_dir: &Path, task_id: &str, id: &str) -> PathBuf {
    archives_dir(data_dir, task_id).join(format!("{id}.json"))
}

fn index_path(data_dir: &Path, task_id: &str) -> PathBuf {
    archives_dir(data_dir, task_id).join("index.json")
}

fn load_index(data_dir: &Path, task_id: &str) -> Vec<ArchiveEntry> {
    match std::fs::read_to_string(index_path(data_dir, task_id)) {
        Ok(t) => serde_json::from_str(&t).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_index(data_dir: &Path, task_id: &str, entries: &[ArchiveEntry]) -> Result<(), String> {
    let dir = archives_dir(data_dir, task_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建归档目录失败：{e}"))?;
    let text = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(index_path(data_dir, task_id), text).map_err(|e| format!("写归档索引失败：{e}"))?;
    Ok(())
}

fn canonical_json(messages: &[Value]) -> String {
    serde_json::to_string(messages).unwrap_or_default()
}

/// 把一段历史原文归档。返回条目（先写文件、再写索引；索引失败不拦，
/// 文件本身已在，list 时扫目录也能找回来——见 list_archives 的兜底）。
pub fn archive_messages(
    data_dir: &Path,
    task_id: &str,
    messages: &[Value],
    prompt_tokens_before: u64,
    summary_chars: usize,
) -> Result<ArchiveEntry, String> {
    let dir = archives_dir(data_dir, task_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建归档目录失败：{e}"))?;
    let created_at = now_secs();
    let id = format!(
        "{created_at}-{message_count}",
        message_count = messages.len()
    );
    let source_hash = crate::frozen::sha256_hex(&canonical_json(messages));
    let pages = messages.len().div_ceil(ARCHIVE_PAGE_SIZE);
    let entry = ArchiveEntry {
        id: id.clone(),
        created_at,
        message_count: messages.len(),
        pages: pages.max(1),
        source_hash,
        prompt_tokens_before,
        summary_chars,
    };
    let file = ArchiveFile {
        entry: entry.clone(),
        messages: messages.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(archive_path(data_dir, task_id, &id), text)
        .map_err(|e| format!("写归档文件失败：{e}"))?;
    let mut entries = load_index(data_dir, task_id);
    entries.push(entry.clone());
    let _ = save_index(data_dir, task_id, &entries);
    Ok(entry)
}

/// 列出该对话的全部归档（按时间升序）。索引丢了就扫目录兜底重建。
pub fn list_archives(data_dir: &Path, task_id: &str) -> Vec<ArchiveEntry> {
    let mut entries = load_index(data_dir, task_id);
    if entries.is_empty() {
        // 索引丢了/损坏：扫目录，从文件里把条目读回来。
        if let Ok(rd) = std::fs::read_dir(archives_dir(data_dir, task_id)) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) != Some("json") {
                    continue;
                }
                if p.file_name().and_then(|n| n.to_str()) == Some("index.json") {
                    continue;
                }
                if let Ok(t) = std::fs::read_to_string(&p)
                    && let Ok(f) = serde_json::from_str::<ArchiveFile>(&t)
                {
                    entries.push(f.entry);
                }
            }
            entries.sort_by_key(|e| e.created_at);
            if !entries.is_empty() {
                let _ = save_index(data_dir, task_id, &entries);
            }
        }
    }
    entries
}

/// 按页召回原文（page 从 0 开始）。返回该页的消息 + 总页数。
/// 召回前先查 ghost 注册表（见 advisor::ghost_check）：命中幽灵 = 当初逐错了。
pub fn recall_page(
    data_dir: &Path,
    task_id: &str,
    archive_id: &str,
    page: usize,
) -> Result<(Vec<Value>, usize), String> {
    let text = std::fs::read_to_string(archive_path(data_dir, task_id, archive_id))
        .map_err(|_| format!("找不到归档 {archive_id}"))?;
    let file: ArchiveFile =
        serde_json::from_str(&text).map_err(|e| format!("归档文件损坏：{e}"))?;
    let total_pages = file.entry.pages;
    let start = page * ARCHIVE_PAGE_SIZE;
    if start >= file.messages.len() {
        return Ok((Vec::new(), total_pages));
    }
    let end = (start + ARCHIVE_PAGE_SIZE).min(file.messages.len());
    Ok((file.messages[start..end].to_vec(), total_pages))
}

/// 密封检查点：摘要末尾带的 `<xiaosi-checkpoint>{json}</xiaosi-checkpoint>`。
/// json 里是归档条目的关键字段（够校验，不含原文）。
pub fn seal_checkpoint(entry: &ArchiveEntry) -> String {
    let payload = json!({
        "v": 1,
        "archive_id": entry.id,
        "message_count": entry.message_count,
        "pages": entry.pages,
        "source_hash": entry.source_hash,
        "created_at": entry.created_at,
    });
    format!(
        "<xiaosi-checkpoint>{}</xiaosi-checkpoint>",
        serde_json::to_string(&payload).unwrap_or_default()
    )
}

/// 校验密封检查点：正好一对开闭标签、JSON 能解析、字段齐全才认。
/// 对不上返回 None——摘要只当普通文本用，绝不凭它删归档。
pub fn validate_checkpoint(text: &str) -> Option<Value> {
    let open = "<xiaosi-checkpoint>";
    let close = "</xiaosi-checkpoint>";
    if text.matches(open).count() != 1 || text.matches(close).count() != 1 {
        return None;
    }
    let start = text.find(open)? + open.len();
    let end = text.find(close)?;
    if end < start {
        return None;
    }
    let payload: Value = serde_json::from_str(&text[start..end]).ok()?;
    let obj = payload.as_object()?;
    if obj.get("v")?.as_u64()? != 1 {
        return None;
    }
    for key in ["archive_id", "message_count", "source_hash", "created_at"] {
        if !obj.contains_key(key) {
            return None;
        }
    }
    Some(payload)
}

/// 要压的那段历史的指纹（规范 JSON 的 sha256）。压缩前后各算一次，
/// 对不上 = 压缩期间历史变了，禁止替换。
pub fn history_fingerprint(messages: &[Value]) -> String {
    crate::frozen::sha256_hex(&canonical_json(messages))
}

/// 压缩摘要的系统提示：只保留决策、事实、数字、路径、失败与未决，不编造。
/// 摘要是给模型自己下轮看的，不是给用户读的散文——结构固定、信息密度优先。
pub fn summary_system_prompt() -> String {
    "你是一个对话历史压缩器。把下面这段对话历史压缩成一份结构化摘要，供同一会话的模型在下一轮继续工作时阅读。只保留对继续工作有用的信息，不编造、不推测、不美化。\n格式固定如下（没有的段落就写“无”，不要删段落）：\n## 目标\n## 已完成\n## 进行中\n## 关键事实（文件路径、函数名、数字、配置、决定，一个事实一行）\n## 失败与未决\n## 用户偏好\n要求：人名、地名、文件路径、数字、专有名词原样保留；闲聊、寒暄、重复确认全部丢掉；摘要控制在 1200 字以内。直接输出摘要正文，不要加开场白。".to_string()
}

/// 调压缩模型，把一段历史压成摘要（非流式，一次请求）。
/// 用 settings.compression_model（独立字段）；只按接入方式翻 wire ID，
/// 绝不做退役迁移——天枢 4.0.4 还在修的事故就是压缩模型被迁移误改。
/// 失败时返回 Err（调用方不压、继续跑，绝不拿空摘要顶替历史）。
pub async fn summarize_history(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    wire_compression_model: &str,
    messages: &[Value],
) -> Result<String, String> {
    let mut text_parts: Vec<String> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        let content = match m.get("content") {
            Some(Value::String(s)) => s.clone(),
            Some(v) => serde_json::to_string(v).unwrap_or_default(),
            None => String::new(),
        };
        if content.trim().is_empty() {
            continue;
        }
        // 工具调用只留名字和参数摘要，不把大段工具结果塞进压缩请求。
        if let Some(calls) = m.get("tool_calls").and_then(|c| c.as_array()) {
            for c in calls {
                if let Some(name) = c.pointer("/function/name").and_then(|n| n.as_str()) {
                    text_parts.push(format!("[调用工具 {name}]"));
                }
            }
        }
        text_parts.push(format!("{role}：{content}"));
    }
    let history_text = text_parts.join("\n");
    if history_text.trim().is_empty() {
        return Err("要压缩的历史是空的".to_string());
    }
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = json!({
        "model": wire_compression_model,
        "messages": [
            {"role": "system", "content": summary_system_prompt()},
            {"role": "user", "content": history_text},
        ],
        "temperature": 0.2,
        "max_tokens": 2000,
        "stream": false,
    });
    let resp = client
        .post(&url)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("压缩请求发送失败：{e}"))?;
    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let short = if raw.len() > 300 { &raw[..300] } else { &raw };
        return Err(format!("压缩模型返回 {status}：{short}"));
    }
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("压缩响应解析失败：{e}"))?;
    let summary = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if summary.is_empty() {
        return Err("压缩模型返回了空摘要".to_string());
    }
    Ok(summary)
}

/// 一次压缩的结果（给前端展示 + 记台账用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionReport {
    pub archive_id: String,
    /// 压缩前消息条数（不含冻结 system）。
    pub messages_before: usize,
    /// 压缩后消息条数（不含冻结 system）。
    pub messages_after: usize,
    /// 压缩前那轮的 prompt tokens（服务商实报）。
    pub prompt_tokens_before: u64,
    /// 摘要字符数（估算用，不当真实用量）。
    pub summary_chars: usize,
    /// 归档页数。
    pub pages: usize,
    /// 密封检查点（摘要末尾那段，可校验）。
    pub checkpoint: String,
    /// 摘要正文（不含密封标签，展示用；前端压缩卡片直接显示它）。
    #[serde(default)]
    pub summary: String,
    /// 这次被逐出的消息在幽灵注册表里的条目（调用方记进状态）。
    #[serde(default)]
    pub ghosts: Vec<crate::advisor::GhostEntry>,
}

/// 读归档里的某一条原文（按归档内下标）。返回 (role, content, 指纹)，
/// 调用方拿指纹跟幽灵条目对一下，确认找回来的是同一条。
pub fn load_archive_message(
    data_dir: &Path,
    task_id: &str,
    archive_id: &str,
    index: usize,
) -> Result<(String, String, String), String> {
    let text = std::fs::read_to_string(archive_path(data_dir, task_id, archive_id))
        .map_err(|_| format!("找不到归档 {archive_id}"))?;
    let file: ArchiveFile =
        serde_json::from_str(&text).map_err(|e| format!("归档文件损坏：{e}"))?;
    let m = file
        .messages
        .get(index)
        .ok_or_else(|| format!("归档 {archive_id} 里没有第 {index} 条"))?;
    let role = m
        .get("role")
        .and_then(|r| r.as_str())
        .unwrap_or("")
        .to_string();
    let content = m
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let fingerprint = crate::advisor::ghost_fingerprint(&content);
    Ok((role, content, fingerprint))
}

/// 幽灵注册：被逐出的每一条都记一条（摘要、指纹、归档位置），
/// 之后用户问到其中内容就算逐错了、可以按位置把原文找回来。
/// 纯函数，好测。
pub fn build_ghosts(
    middle: &[Value],
    archive_id: &str,
    evicted_at: u64,
) -> Vec<crate::advisor::GhostEntry> {
    middle
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let content = m
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let excerpt: String = content.chars().take(120).collect();
            crate::advisor::GhostEntry {
                fingerprint: crate::advisor::ghost_fingerprint(&content),
                excerpt,
                evicted_at,
                recalled: false,
                archive_id: archive_id.to_string(),
                page: i / ARCHIVE_PAGE_SIZE,
                index: i,
            }
        })
        .collect()
}

/// 压缩一次的参数（9 个，打包成结构体，调用处不用每次数一遍）。
/// `messages`：目标模式是完整会话（含冻结 system 在 [0]）；
/// 临时会话是没有 system 的纯历史，由 compact_ephemeral_messages 在
/// 前面补一条占位 system 再调 compact_messages。
pub struct CompactParams<'a> {
    pub data_dir: &'a Path,
    pub task_id: &'a str,
    pub messages: &'a [Value],
    pub tail_keep: usize,
    pub prompt_tokens_before: u64,
    pub client: &'a reqwest::Client,
    pub base_url: &'a str,
    pub key: &'a str,
    pub wire_compression_model: &'a str,
}

/// 压缩一段历史：归档 → 摘要 → 指纹复核 → 替换。
/// messages 是完整会话消息（含冻结 system 在 [0]）；返回新消息列表 + 报告。
/// - 冻结 system（[0]）永远不动；尾部最近 tail_keep 条不动；只压中间。
/// - 中间少于 4 条 = 没什么可压，直接返回 Err("没什么可压")，调用方跳过。
/// - 摘要回来后复核指纹：中间段变了就 abort，返回 Err，原文原样保留。
pub async fn compact_messages(
    p: CompactParams<'_>,
) -> Result<(Vec<Value>, CompactionReport), String> {
    let CompactParams {
        data_dir,
        task_id,
        messages,
        tail_keep,
        prompt_tokens_before,
        client,
        base_url,
        key,
        wire_compression_model,
    } = p;
    if messages.len() < 2 {
        return Err("历史太短，没什么可压".to_string());
    }
    // [0] 是冻结 system，不动；尾部 tail_keep 条不动；中间是可压段。
    let tail_start = messages.len().saturating_sub(tail_keep).max(1);
    if tail_start <= 1 {
        return Err("历史太短，没什么可压".to_string());
    }
    let middle = &messages[1..tail_start];
    if middle.len() < 4 {
        return Err("可压的中间段不到 4 条，没什么可压".to_string());
    }
    // 1. 动手前拍指纹。
    let fingerprint_before = history_fingerprint(middle);
    // 2. 摘要（调模型）。这一步花一次压缩模型请求。
    let summary = summarize_history(client, base_url, key, wire_compression_model, middle).await?;
    // 3. 复核：中间段指纹没变才继续；变了 = 压缩期间历史变了，禁止替换。
    if history_fingerprint(middle) != fingerprint_before {
        return Err("压缩期间历史发生变化，禁止替换（原文已保留）".to_string());
    }
    // 4. 归档原文。
    let entry = archive_messages(
        data_dir,
        task_id,
        middle,
        prompt_tokens_before,
        summary.chars().count(),
    )?;
    let checkpoint = seal_checkpoint(&entry);
    // 密封自检：刚封出来的检查点必须能被自己的校验认出来，否则是 seal
    // 的格式 bug——这次不压，原文原样保留，绝不把坏密封写进历史。
    if validate_checkpoint(&checkpoint).is_none() {
        return Err("密封检查点自检失败：刚封出来的检查点校验不通过".to_string());
    }
    // 5. 拼新历史：[冻结 system] + [摘要 system 消息] + [尾部]。
    let summary_msg = json!({
        "role": "system",
        "content": format!("{COMPACT_PREFIX} 摘要（此前 {n} 条消息的原文已归档，可按页召回；不要凭空编造归档里的细节，需要时用召回）：\n{summary}\n{checkpoint}",
            n = middle.len(), summary = summary),
    });
    let mut new_messages: Vec<Value> = Vec::with_capacity(2 + messages.len() - tail_start);
    new_messages.push(messages[0].clone());
    new_messages.push(summary_msg);
    new_messages.extend_from_slice(&messages[tail_start..]);
    // 幽灵注册：被逐出的每一条都记一条（摘要、指纹、归档位置），
    // 之后用户问到其中内容就算逐错了、可以按位置把原文找回来。
    let ghosts = build_ghosts(middle, &entry.id, entry.created_at);
    let report = CompactionReport {
        archive_id: entry.id,
        messages_before: messages.len() - 1,
        messages_after: new_messages.len() - 1,
        prompt_tokens_before,
        summary_chars: summary.chars().count(),
        pages: entry.pages,
        checkpoint,
        summary: summary.clone(),
        ghosts,
    };
    Ok((new_messages, report))
}

/// 临时会话（普通对话，前端自己管消息、后端没有冻结 system）的手动压缩。
/// 前面补一条占位 system 让 compact_messages 的“[0] 不动”规则照常工作，
/// 返回时再把占位去掉：返回的新历史 = [摘要 system 消息] + [尾部原文]。
/// 前端据此替换本地消息列表。
pub async fn compact_ephemeral_messages(
    p: CompactParams<'_>,
) -> Result<(Vec<Value>, CompactionReport), String> {
    let mut messages = vec![json!({"role": "system", "content": "（临时会话，无冻结前缀）"})];
    messages.extend_from_slice(p.messages);
    let (new_messages, report) = compact_messages(CompactParams {
        messages: &messages,
        ..p
    })
    .await?;
    Ok((new_messages[1..].to_vec(), report))
}

/// 每对话的上下文状态（context/<task>/state.json），仪表盘与调节器共用。
/// 数字全部来自服务商实报的 usage；没有跑过就是空状态，绝不编默认值。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContextState {
    pub task_id: String,
    #[serde(default)]
    pub model: String,
    /// 上轮用的服务商 id（档位 auto 时按它选）。
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub last_prompt_tokens: u64,
    #[serde(default)]
    pub last_cached_tokens: u64,
    /// 最近命中率的 EMA（新数据权重 0.3）；None = 还没跑过。
    #[serde(default)]
    pub hit_rate_ema: Option<f64>,
    #[serde(default)]
    pub last_decision: Option<crate::advisor::AdvisorDecision>,
    #[serde(default)]
    pub ghost_hits: u64,
    #[serde(default)]
    pub ghosts: Vec<crate::advisor::GhostEntry>,
    #[serde(default)]
    pub archives: Vec<String>,
    #[serde(default)]
    pub updated_at: u64,
}

fn state_path(data_dir: &Path, task_id: &str) -> PathBuf {
    context_dir(data_dir, task_id).join("state.json")
}

pub fn load_context_state(data_dir: &Path, task_id: &str) -> ContextState {
    match std::fs::read_to_string(state_path(data_dir, task_id)) {
        Ok(t) => serde_json::from_str(&t).unwrap_or_default(),
        Err(_) => ContextState {
            task_id: task_id.to_string(),
            ..Default::default()
        },
    }
}

pub fn save_context_state(data_dir: &Path, state: &ContextState) -> Result<(), String> {
    let dir = context_dir(data_dir, &state.task_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建上下文目录失败：{e}"))?;
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(state_path(data_dir, &state.task_id), text)
        .map_err(|e| format!("写上下文状态失败：{e}"))?;
    Ok(())
}

/// 用一轮的实报 usage 更新命中率 EMA（新数据权重 0.3）。
pub fn update_hit_rate_ema(state: &mut ContextState, prompt: u64, cached: u64) {
    if prompt == 0 {
        return;
    }
    let rate = cached as f64 / prompt as f64;
    state.hit_rate_ema = Some(match state.hit_rate_ema {
        Some(old) => old * 0.7 + rate * 0.3,
        None => rate,
    });
    state.last_prompt_tokens = prompt;
    state.last_cached_tokens = cached;
}

/// 一次压缩完成后的记账：归档 id + 幽灵条目记进状态（best-effort，
/// 写盘失败只记日志，调用方绝不因此报错）。
pub fn record_compaction(data_dir: &Path, task_id: &str, report: &CompactionReport) {
    let mut state = load_context_state(data_dir, task_id);
    if !state.archives.contains(&report.archive_id) {
        state.archives.push(report.archive_id.clone());
    }
    state.ghosts.extend(report.ghosts.iter().cloned());
    state.updated_at = now_secs();
    if let Err(e) = save_context_state(data_dir, &state) {
        eprintln!("[compact] 记压缩台账失败：{e}");
    }
}

/// 一轮跑完的记账：模型、服务商、本轮实报用量（命中率 EMA）、顾问决策。
/// 写盘失败只记日志，不拦结果返回。
pub fn update_run_usage(
    data_dir: &Path,
    task_id: &str,
    provider_id: &str,
    model: &str,
    prompt: u64,
    cached: u64,
    decision: Option<crate::advisor::AdvisorDecision>,
) {
    let mut state = load_context_state(data_dir, task_id);
    state.model = model.to_string();
    state.provider_id = provider_id.to_string();
    update_hit_rate_ema(&mut state, prompt, cached);
    if let Some(d) = decision {
        state.last_decision = Some(d);
    }
    state.updated_at = now_secs();
    if let Err(e) = save_context_state(data_dir, &state) {
        eprintln!("[compact] 记上下文状态失败：{e}");
    }
}

/// 仪表盘一次要的数据（全部来自实报 usage 与顾问决策；没跑过就是空状态）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextStatus {
    pub task_id: String,
    /// 跑过至少一轮（有命中率数据）。
    pub has_data: bool,
    /// 上轮用的主模型（wire ID）。
    pub model: String,
    /// 上下文窗口（tokens）；None = 该模型上限未知，不编数字。
    pub window_tokens: Option<u64>,
    /// 窗口是不是估算的（true 时界面上写明）。
    pub window_estimated: bool,
    /// 上轮 prompt tokens（服务商实报）。
    pub prompt_tokens: u64,
    /// 上轮缓存命中 tokens（服务商实报）。
    pub cached_tokens: u64,
    /// 最近命中率 EMA（0–1）；没跑过为 None。
    pub hit_rate: Option<f64>,
    /// 上轮 prompt 占窗口的比例（0–1）；窗口未知时为 None。
    pub pressure: Option<f64>,
    /// 最近一次顾问决策（本轮开始时算的，供下次参考）。
    pub last_decision: Option<crate::advisor::AdvisorDecision>,
    /// 当前压缩档位（设置里的值，自动档已按服务商翻成具体档位）。
    pub tier: String,
    /// 自动压缩开关。
    pub compression_enabled: bool,
    /// 幽灵召回命中次数（= 压缩逐错的次数）。
    pub ghost_hits: u64,
    /// 幽灵注册表当前条数。
    pub ghost_count: usize,
    /// 归档列表（按创建时间倒序）。
    pub archives: Vec<ArchiveEntry>,
}

/// 拼仪表盘状态：状态文件 + 归档索引 + 设置（档位/开关）。
/// 数字只用实报的；没有数据就空着，绝不编。
pub fn build_context_status(
    data_dir: &Path,
    task_id: &str,
    settings: &crate::settings::Settings,
) -> ContextStatus {
    let state = load_context_state(data_dir, task_id);
    let model = if state.model.is_empty() {
        settings.model.clone()
    } else {
        state.model.clone()
    };
    let window = crate::advisor::context_window(&model);
    let pressure = window.map(|w| {
        if w == 0 {
            0.0
        } else {
            (state.last_prompt_tokens as f64 / w as f64).clamp(0.0, 1.0)
        }
    });
    let provider_id = if state.provider_id.is_empty() {
        settings.provider_id.clone()
    } else {
        state.provider_id.clone()
    };
    let tier = crate::advisor::tier_for(&settings.compression_tier, &provider_id);
    let mut archives = list_archives(data_dir, task_id);
    archives.sort_by_key(|a| std::cmp::Reverse(a.created_at));
    ContextStatus {
        task_id: task_id.to_string(),
        has_data: state.hit_rate_ema.is_some(),
        model,
        window_tokens: window,
        window_estimated: window.is_none(),
        prompt_tokens: state.last_prompt_tokens,
        cached_tokens: state.last_cached_tokens,
        hit_rate: state.hit_rate_ema,
        pressure,
        last_decision: state.last_decision,
        tier: tier.label().to_string(),
        compression_enabled: settings.compression_enabled,
        ghost_hits: state.ghost_hits,
        ghost_count: state.ghosts.len(),
        archives,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn msgs(n: usize) -> Vec<Value> {
        (0..n)
            .map(|i| {
                json!({"role": if i % 2 == 0 { "user" } else { "assistant" }, "content": format!("第 {i} 条消息内容，足够长一点的文本，方便估算。")})
            })
            .collect()
    }

    #[test]
    fn checkpoint_seal_roundtrip() {
        let entry = ArchiveEntry {
            id: "1-3".to_string(),
            created_at: 123,
            message_count: 3,
            pages: 1,
            source_hash: "abcdef0123456789".to_string(),
            prompt_tokens_before: 1000,
            summary_chars: 50,
        };
        let sealed = seal_checkpoint(&entry);
        assert!(sealed.starts_with("<xiaosi-checkpoint>"));
        assert!(sealed.ends_with("</xiaosi-checkpoint>"));
        let back = validate_checkpoint(&sealed).expect("密封的检查点必须能校验通过");
        assert_eq!(back.get("archive_id").and_then(|v| v.as_str()), Some("1-3"));
        assert_eq!(
            back.get("source_hash").and_then(|v| v.as_str()),
            Some("abcdef0123456789")
        );
    }

    #[test]
    fn checkpoint_validation_rejects_bad_shapes() {
        // 两对标签不认。
        let entry = ArchiveEntry {
            id: "1-3".to_string(),
            created_at: 123,
            message_count: 3,
            pages: 1,
            source_hash: "abcdef0123456789".to_string(),
            prompt_tokens_before: 1000,
            summary_chars: 50,
        };
        let sealed = seal_checkpoint(&entry);
        assert!(validate_checkpoint(&format!("{sealed}{sealed}")).is_none());
        // 缺闭标签不认。
        assert!(validate_checkpoint("<xiaosi-checkpoint>{}").is_none());
        // JSON 坏了不认。
        assert!(validate_checkpoint("<xiaosi-checkpoint>not json</xiaosi-checkpoint>").is_none());
        // 缺字段不认。
        assert!(validate_checkpoint("<xiaosi-checkpoint>{\"v\":1}</xiaosi-checkpoint>").is_none());
        // v 不是 1 不认。
        assert!(validate_checkpoint(
            "<xiaosi-checkpoint>{\"v\":2,\"archive_id\":\"x\",\"message_count\":1,\"source_hash\":\"h\",\"created_at\":1}</xiaosi-checkpoint>"
        )
        .is_none());
        // 纯文本没有检查点。
        assert!(validate_checkpoint("就是一段普通摘要，没有标签").is_none());
    }

    #[test]
    fn fingerprint_is_stable_and_sensitive() {
        let a = msgs(5);
        let b = msgs(5);
        assert_eq!(history_fingerprint(&a), history_fingerprint(&b));
        let mut c = msgs(5);
        c[2] = json!({"role": "assistant", "content": "改了一个字"});
        assert_ne!(history_fingerprint(&a), history_fingerprint(&c));
    }

    #[test]
    fn estimate_tokens_scales_with_length() {
        assert!(estimate_tokens("") >= 1);
        let short = estimate_tokens("你好");
        let long =
            estimate_tokens(&"你好世界这是一个比较长的句子，用来估算 token 数量。".repeat(20));
        assert!(long > short * 10);
    }

    #[test]
    fn hit_rate_ema_blends() {
        let mut s = ContextState::default();
        update_hit_rate_ema(&mut s, 1000, 900); // 0.9
        assert!((s.hit_rate_ema.unwrap() - 0.9).abs() < 1e-9);
        update_hit_rate_ema(&mut s, 1000, 500); // 0.5 → 0.9*0.7+0.5*0.3 = 0.78
        assert!((s.hit_rate_ema.unwrap() - 0.78).abs() < 1e-9);
        // prompt 为 0 不更新。
        update_hit_rate_ema(&mut s, 0, 0);
        assert!((s.hit_rate_ema.unwrap() - 0.78).abs() < 1e-9);
    }

    #[test]
    fn summary_prompt_is_fixed_shape() {
        let p = summary_system_prompt();
        assert!(p.contains("目标"));
        assert!(p.contains("关键事实"));
        assert!(p.contains("失败与未决"));
        assert!(p.contains("不编造"));
    }

    #[test]
    fn ghosts_carry_archive_position() {
        // 25 条被逐出的消息：第 0 条在 0 页第 0 位，第 10 条在 1 页第 10 位。
        let middle = msgs(25);
        let ghosts = build_ghosts(&middle, "arch-1", 999);
        assert_eq!(ghosts.len(), 25);
        assert_eq!(ghosts[0].archive_id, "arch-1");
        assert_eq!((ghosts[0].page, ghosts[0].index), (0, 0));
        assert_eq!((ghosts[10].page, ghosts[10].index), (1, 10));
        assert_eq!((ghosts[24].page, ghosts[24].index), (2, 24));
        // 指纹 = 内容的指纹，摘要不超过 120 字。
        assert_eq!(
            ghosts[3].fingerprint,
            crate::advisor::ghost_fingerprint("第 3 条消息内容，足够长一点的文本，方便估算。")
        );
        assert!(ghosts[3].excerpt.chars().count() <= 120);
        assert!(!ghosts[3].recalled);
    }

    /// 真模型集成测试（默认忽略）：compact_messages 全链路——真摘要 +
    /// 归档原文 + 密封检查点 + 幽灵注册。临时目录，不碰真实数据。
    /// 先起 relay：`python3 ~/workspace/p1-test/relay-p1.py`，
    /// 再跑 `cargo test --lib -- --ignored real_model`。
    /// 花的是用户 DeepSeek 官方账号的 flash 档 tokens（一次约几百）。
    #[tokio::test]
    #[ignore]
    async fn real_model_compact_messages_archives_and_seals() {
        let base = std::env::var("CASSELL_TEST_RELAY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8792/v1".to_string());
        if std::net::TcpStream::connect("127.0.0.1:8792").is_err() {
            panic!("relay 没起：先跑 python3 ~/workspace/p1-test/relay-p1.py");
        }
        let data_dir = std::env::temp_dir().join("cassell-p1-compact-test");
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).unwrap();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .unwrap();
        let mut history = vec![json!({"role": "system", "content": "你是测试助手。"})];
        history.push(json!({"role": "user", "content": "我们要给卡塞尔终端加一个上下文仪表盘，显示剩余上下文和缓存命中率。"}));
        history.push(json!({"role": "assistant", "content": "好的，仪表盘分三块：当前上下文、CacheAdvisor 决策、归档列表。先做后端的状态接口。"}));
        history.push(json!({"role": "user", "content": "后端状态接口做好了，get_context_status 返回 prompt、cached、hit_rate 和归档。"}));
        history.push(json!({"role": "assistant", "content": "前端仪表条已接上，≥70% 显示快满了，≥85% 挂现在压缩按钮。"}));
        history.push(json!({"role": "user", "content": "压缩档位定下来没有？DeepSeek 走保缓存，其他走均衡。"}));
        history.push(json!({"role": "assistant", "content": "定了，auto 档按服务商选；压缩模型和主模型分开配，迁移不碰它。"}));
        history.push(json!({"role": "user", "content": "归档按页召回，每页 10 条；摘要末尾留密封检查点。"}));
        history.push(json!({"role": "assistant", "content": "归档和检查点都好了，密封校验要求正好一对标签、JSON 能解析。"}));
        history.push(json!({"role": "user", "content": "先这样，继续做前端抽屉。"}));
        history.push(json!({"role": "assistant", "content": "抽屉里放当前上下文、顾问决策、归档列表和两个按钮。"}));
        history.push(json!({"role": "user", "content": "好，抽屉样式按前端理念来，不要线条、不要金色。"}));
        history.push(json!({"role": "assistant", "content": "收到，样式已按理念走，入口动画 300ms。"}));
        // system + 12 条，tail_keep=4 → 中间 8 条被压，剩下摘要 + 4 条尾巴。
        let (new_history, report) = compact_messages(CompactParams {
            data_dir: &data_dir,
            task_id: "test-task",
            messages: &history,
            tail_keep: 4,
            prompt_tokens_before: 900_000,
            client: &client,
            base_url: &base,
            key: "test-placeholder",
            wire_compression_model: "deepseek-flash",
        })
        .await
        .expect("压缩失败");
        assert_eq!(report.messages_before, 12);
        assert_eq!(report.messages_after, 5);
        assert_eq!(new_history.len(), 6);
        assert_eq!(report.pages, 1);
        assert_eq!(report.ghosts.len(), 8);
        // [0] 是原 system 不动，[1] 是摘要；摘要抓住主题。
        let summary = new_history[1]
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("");
        assert!(
            summary.starts_with("XiaoSi Compress2.0"),
            "摘要前缀不对：{summary}"
        );
        assert!(
            summary.contains("仪表盘") || summary.contains("目标"),
            "摘要没抓住主题：{summary}"
        );
        assert!(validate_checkpoint(&report.checkpoint).is_some());
        assert!(summary.contains("<xiaosi-checkpoint>"));
        // 归档文件真实存在，原文 8 条全在；尾部 4 条是原文。
        let archives = list_archives(&data_dir, "test-task");
        assert_eq!(archives.len(), 1);
        assert_eq!(archives[0].message_count, 8);
        let (page, total) = recall_page(&data_dir, "test-task", &report.archive_id, 0)
            .expect("召回失败");
        assert_eq!(total, 1);
        assert_eq!(page.len(), 8);
        assert!(page[0]
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .contains("上下文仪表盘"));
        assert_eq!(
            new_history[5]
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or(""),
            "收到，样式已按理念走，入口动画 300ms。"
        );
        let _ = std::fs::remove_dir_all(&data_dir);
    }
}
