//! 龙族知识库接线（知识库 §40 四层喂法之第一层按需注入 + 第二层常驻速查）。
//!
//! 来源：`lore/龙族知识库.md`（研究母本在 `~/workspace/cassell-agent/lore/龙族知识库.md`，
//! 构建时用的这份是随仓库一起的副本；改母本后记得同步拷贝过来再构建）。
//! 全文用 `include_str!` 编进二进制，不在代码里再复制一份。
//!
//! 喂法：
//! - §0 核心常识速查常驻 system 消息最前面（冻结前缀的一部分，P0-1 会 formalize）。
//! - 用户问题命中龙族关键词时，按 §40 的关键词→章节映射表注入相关章节，
//!   最多注入两个映射组（"章"指映射表里的一行，如 §9–§11 是一组），追加在
//!   system 消息末尾并标明来源。
//! - 不问龙族问题时一个字都不喂，正常工作零影响。
//! - 匹配只看当前用户消息，不看历史，避免旧对话里的龙族词误触发。
//!
//! 关键词分两档 + 加权评分（P0-1，抄 dragonraja-site `eva.js` 的 `entryScore`
//! 设计，不抄代码原文）：强关键词单独触发；弱关键词（任务、细节、课程……这些日常
//! 词）只有在问题里同时出现任意强关键词时才算数，避免"帮我整理任务"这种
//! 正常工作问题误注入。诺玛/EVA 是助手自己的名字，不算关键词——用户叫一声
//! "诺玛，帮我写文档"不是在问龙族。
//!
//! 计分（每组独立算分，≥ 2.5 分才命中，取分最高的两个组；平局按表顺序）：
//! - 整句恰好等于某个强关键词 → +10（精确）
//! - 问题包含强关键词 → +3（≥3 字）或 +2（2 字）；关键词反过来包含问题
//!   （问题 ≥2 字）→ +1.2
//! - 别名命中 → +1.5（如"时零"是"时间零"的别名）
//! - 弱关键词命中 → +2（须有任意强信号在先）
//! - 长度加权：有命中时总分 += 2 × 命中字数 ÷ 问题字数（命中越长、问题越短，分越高）
//! - 强命中保底 2.5 分：单个短关键词在长问题里也不丢召回；分数仍用于排序。

use std::sync::OnceLock;

/// 知识库全文（构建时嵌进去）。
const LORE_MD: &str = include_str!("../../lore/龙族知识库.md");

/// 按需注入的标记行，写进 system 消息末尾，标明下面是知识库章节。
pub const LORE_MARKER: &str = "以下为龙族知识库相关章节，仅供回答龙族问题时参考：";

/// 诚实规则：放在冻结前缀里，每次请求都生效。
pub const HONESTY_RULES: &str = "龙族知识回答规则：回答龙族世界观问题时，优先依据本消息中的龙族知识库内容；知识库里没有的，就说不知道，不许编造。区分学院设定与产品设定：产品里 NORMA 是办公模式、EVA 是工程模式，这是功能分工；学院里诺玛是卡塞尔学院的秘书（中枢 AI）、EVA 是同一中枢的战争人格，不要混为一谈。";

/// 一节：编号 + 标题 + 正文（不含 `## §N` 标题行本身）。
struct Section {
    num: u32,
    title: String,
    body: String,
}

fn parse_sections() -> Vec<Section> {
    let mut sections = Vec::new();
    let mut cur: Option<Section> = None;
    for line in LORE_MD.lines() {
        if let Some(rest) = line.strip_prefix("## §") {
            // 形如 "## §10 言灵全表（序号表）"
            if let Some((num_str, title)) = rest.split_once(' ') {
                if let Ok(num) = num_str.trim().parse::<u32>() {
                    if let Some(s) = cur.take() {
                        sections.push(s);
                    }
                    // 标题去掉括号里的说明（如 §0 的"（常驻提示词用，约 800 字）"）
                    let title = title.split('（').next().unwrap_or(title).trim().to_string();
                    cur = Some(Section {
                        num,
                        title,
                        body: String::new(),
                    });
                    continue;
                }
            }
        }
        if let Some(s) = cur.as_mut() {
            s.body.push_str(line);
            s.body.push('\n');
        }
    }
    if let Some(s) = cur.take() {
        sections.push(s);
    }
    sections
}

static SECTIONS: OnceLock<Vec<Section>> = OnceLock::new();

fn sections() -> &'static [Section] {
    SECTIONS.get_or_init(parse_sections)
}

/// §0 核心常识速查（常驻），返回 "## §0 核心常识速查\n<正文>"。
pub fn core_quick_ref() -> String {
    match sections().iter().find(|s| s.num == 0) {
        Some(s) => format!("## §0 {}\n{}", s.title, s.body.trim_end()),
        None => String::new(),
    }
}

/// 一组映射：强关键词 / 弱关键词 / 别名 / 注入的章节号（§40 映射表）。
/// 表顺序只在分相同是平局次序；实际命中按加权分排序。
struct LoreGroup {
    strong: &'static [&'static str],
    weak: &'static [&'static str],
    aliases: &'static [&'static str],
    sections: &'static [u32],
}

const LORE_GROUPS: &[LoreGroup] = &[
    // 言灵 → §9–§11
    LoreGroup {
        strong: &[
            "言灵", "时间零", "君焰", "王权", "审判", "镰鼬", "戒律", "不要死", "梦貘", "刹那", "炽", "炽日",
            "吸血镰", "阴流", "莱茵", "镜瞳", "血系结罗", "烛龙", "湿婆业舞", "皇帝", "王选之侍", "黑日", "神谕",
        ],
        weak: &[],
        aliases: &["时零"],
        sections: &[9, 10, 11],
    },
    // 龙族起源 / 世界观 → §1–§4、§19（"龙文""世界树"已移出，见表末尾龙文组 → §5）
    LoreGroup {
        strong: &[
            "龙族起源", "黑王", "白王", "四大君主", "龙王", "龙血", "龙化", "死侍",
            "奥丁", "尼德霍格", "伊邪那美", "初代种", "龙族",
        ],
        weak: &[],
        aliases: &["老唐"],
        sections: &[1, 2, 3, 4, 19],
    },
    // 血统 → §6–§8（§5 是"龙文与世界树"，已移出本组）
    LoreGroup {
        strong: &[
            "血统", "爆血", "3E考试", "3E 考试", "临界血限", "黄金瞳", "灵视", "龙血比例", "血统精炼",
            "血统评级",
        ],
        weak: &["S级", "S 级", "A级", "A 级"],
        aliases: &[],
        sections: &[6, 7, 8],
    },
    // 炼金术 → §12–§18
    LoreGroup {
        strong: &[
            "炼金术", "炼金矩阵", "活灵", "七宗罪", "贤者之石", "炼金领域", "龙骨十字", "炼金武器",
        ],
        weak: &[],
        aliases: &[],
        sections: &[12, 13, 14, 15, 16, 17, 18],
    },
    // 尼伯龙根 → §19
    LoreGroup {
        strong: &["尼伯龙根", "0号高架路", "0 号高架路", "青铜城", "阿瓦隆"],
        weak: &["地铁站"],
        aliases: &[],
        sections: &[19],
    },
    // 卡塞尔学院 → §20–§24（诺玛/EVA 是助手自己的名字，不算关键词）
    LoreGroup {
        strong: &[
            "卡塞尔学院", "卡塞尔", "昂热", "执行部", "装备部", "守夜人", "英灵殿", "冰窖",
            "瓦特阿尔海姆", "希尔伯特", "弗拉梅尔",
        ],
        weak: &["图书馆"],
        aliases: &[],
        sections: &[20, 21, 22, 23, 24],
    },
    // 组织 → §25–§29
    LoreGroup {
        strong: &["秘党", "校董会", "蛇岐八家", "猛鬼众", "猎人网站", "加图索家族"],
        weak: &[],
        aliases: &[],
        sections: &[25, 26, 27, 28, 29],
    },
    // 人物 → §30–§31、§35
    LoreGroup {
        strong: &[
            "路明非", "楚子航", "恺撒", "诺诺", "陈墨瞳", "夏弥", "芬格尔", "绘梨衣", "上杉绘梨衣",
            "源稚生", "昂热", "路鸣泽", "赫尔佐格",
        ],
        weak: &[],
        aliases: &["小魔鬼", "酒德麻衣", "薯片妞"],
        sections: &[30, 31, 35],
    },
    // 时间线 / 剧情 → §32–§34
    LoreGroup {
        strong: &[
            "时间线", "大事件", "剧情", "战役", "青铜计划", "龙渊计划", "夏之哀悼", "黑天鹅港",
        ],
        weak: &["任务"],
        aliases: &[],
        sections: &[32, 33, 34],
    },
    // 名场面 / 名台词 → §36
    LoreGroup {
        strong: &["名场面", "名台词", "小怪兽", "奥特曼"],
        weak: &["台词"],
        aliases: &[],
        sections: &[36],
    },
    // 课程 / 日常 → §24、§37
    LoreGroup {
        strong: &["自由一日", "学院之星", "守夜人讨论区"],
        weak: &["课程", "社团", "食堂", "校规"],
        aliases: &[],
        sections: &[24, 37],
    },
    // 冷知识 → §38、§53（§53 同人污染清单：答冷知识时须有"同人剔除"依据）
    LoreGroup {
        strong: &["冷知识"],
        weak: &["细节", "彩蛋"],
        aliases: &[],
        sections: &[38, 53],
    },
    // 龙文与世界树 → §5（§5 标题就是"龙文与世界树"；从龙族起源组移出）
    LoreGroup {
        strong: &["龙文", "世界树"],
        weak: &[],
        aliases: &[],
        sections: &[5],
    },
    // 身份与权限 → §43（"切换/权限"放弱档，避免"切换到 EVA 模式"这类工作指令误触发）
    LoreGroup {
        strong: &[
            "黑卡", "白卡", "双黑卡", "权限表", "唤醒", "身份确认", "冒充", "越权",
        ],
        weak: &["切换", "权限"],
        aliases: &[],
        sections: &[43],
    },
    // Ⅴ/Ⅵ与超级补全 → §30、§33、§41、§47、§50、§53、§54
    // 节号核对（知识库实测）：路明非生日主口径 1991-07-17 在 §30（§54 只有口径辨析）；
    // "Ⅴ无结局/断更/Ⅵ不存在/六册/未完结/世界的重启/北极"专述在 §33（有"龙族Ⅵ——不存在官方龙族Ⅵ"
    // 专节）与 §50、§54；肯德基先生/集线器（Ⅴ ch7）在 §41，§54 有推断；§47 是编号速查与版本冲突；
    // §53 是同人污染清单（Ⅴ结局/Ⅵ标题属同人混淆高发区）。§39 常见问答与 §33/§54 内容重复，未单列。
    LoreGroup {
        strong: &[
            "结局", "断更", "Ⅵ", "北极", "集线器", "格陵兰", "肯德基", "青铜御座", "生日",
            "世界的重启", "六册", "未完结", "超级补全", "EVA 首现", "切换仪式", "Ⅴ断更",
            "言灵编号修订", "芬格尔推断",
        ],
        weak: &[],
        aliases: &[],
        sections: &[30, 33, 41, 47, 50, 53, 54],
    },
    // 梦貘 → §47（梦貘 91 与王权 91 重号的版本冲突说明在 §47；"梦貘"本身也在言灵组，两组并存）
    LoreGroup {
        strong: &["梦貘"],
        weak: &[],
        aliases: &[],
        sections: &[47],
    },
    // 芬格尔 → §41、§24（"芬格尔"已在人物组，两组同时命中是符合设计的：人物组给摘要、§41 给完整档案）
    LoreGroup {
        strong: &["芬格尔", "改诺玛编码", "炎魔诗人", "守夜人论坛"],
        weak: &[],
        aliases: &[],
        sections: &[41, 24],
    },
    // 诺玛/EVA 说话方式 → §42、§52（"权限不足/保密"放弱档，避免工作场景误触发）
    LoreGroup {
        strong: &["说话方式", "身份核查", "取信"],
        weak: &["权限不足", "保密"],
        aliases: &[],
        sections: &[42, 52],
    },
    // 任务流程 → §44
    LoreGroup {
        strong: &["任务流程", "N96", "CC1000", "安全港", "装备箱", "装备部发明"],
        weak: &[],
        aliases: &[],
        sections: &[44],
    },
    // 补遗 → §45–§51、§55（"时间线"也会命中剧情组 §32–§34，两组并存是符合设计的；
    // "伏笔"命中 §55 的 FW 表）
    LoreGroup {
        strong: &["人物全表", "地点", "体系", "组织", "物品", "时间线", "日常", "伏笔"],
        weak: &[],
        aliases: &[],
        sections: &[45, 46, 47, 48, 49, 50, 51, 55],
    },
];

/// 归一化：小写 + 去掉全部空白（全角空格也去），与关键词同一口径比较。
/// 中文通常无空格；"3E 考试"与"3E考试"归一后相同。
fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| !c.is_whitespace()).collect()
}

/// 命中阈值（P0-1）：一组得分 ≥ 2.5 才注入。
pub const SCORE_THRESHOLD: f64 = 2.5;

/// 一组对问题的加权分（P0-1，`entryScore` 设计）：精确 +10 / 包含 +3（≥3 字）
/// 或 +2（2 字）/ 反向包含 +1.2 / 别名 +1.5 / 弱关键词 +2（须有强信号在先）/
/// 再加长度加权 2 × 命中字数 ÷ 问题字数。返回 (得分, 是否有强信号)。
fn score_group(prompt_norm: &str, g: &LoreGroup, any_strong: bool) -> (f64, bool) {
    let q_len = prompt_norm.chars().count() as f64;
    if q_len == 0.0 {
        return (0.0, false);
    }
    let mut s = 0.0f64;
    let mut matched = 0usize;
    let mut strong_hit = false;
    for kw in g.strong {
        let k = norm(kw);
        if k.is_empty() {
            continue;
        }
        let k_len = k.chars().count();
        if prompt_norm == &k {
            s += 10.0;
            matched += k_len;
            strong_hit = true;
        } else if prompt_norm.contains(&k) {
            s += if k_len >= 3 { 3.0 } else { 2.0 };
            matched += k_len;
            strong_hit = true;
        } else if k.contains(prompt_norm) && prompt_norm.chars().count() >= 2 {
            // 问题是关键词的前缀/子串（如问"青铜"命中"青铜城"）
            s += 1.2;
            matched += prompt_norm.chars().count();
            strong_hit = true;
        }
    }
    for al in g.aliases {
        let a = norm(al);
        if !a.is_empty() && prompt_norm.contains(&a) {
            s += 1.5;
            matched += a.chars().count();
            strong_hit = true;
        }
    }
    if any_strong {
        for kw in g.weak {
            let k = norm(kw);
            if !k.is_empty() && prompt_norm.contains(&k) {
                s += 2.0;
                matched += k.chars().count();
            }
        }
    }
    if s > 0.0 {
        s += 2.0 * matched as f64 / q_len;
    }
    // 强命中保底 2.5 分：单个 2 字关键词放在长问题里时，2 + 长度加权可能
    // 略低于阈值（如"王权到底有什么用呢"），保底保证强关键词不丢召回；
    // 分数仍用于两组之间的排序。弱命中（无强信号）没有保底。
    if strong_hit && s < SCORE_THRESHOLD {
        s = SCORE_THRESHOLD;
    }
    (s, strong_hit)
}

/// 各组得分（表顺序），供测试与调试用。
fn group_scores(prompt: &str) -> Vec<(usize, f64)> {
    let q = norm(prompt);
    // 先算一遍强信号：弱关键词只有在任意组有强命中时才计分。
    let any_strong = LORE_GROUPS.iter().any(|g| {
        g.strong.iter().any(|kw| {
            let k = norm(kw);
            !k.is_empty()
                && (q == k || q.contains(&k) || (k.contains(q.as_str()) && q.chars().count() >= 2))
        }) || g.aliases.iter().any(|al| {
            let a = norm(al);
            !a.is_empty() && q.contains(&a)
        })
    });
    LORE_GROUPS
        .iter()
        .enumerate()
        .map(|(i, g)| (i, score_group(&q, g, any_strong).0))
        .collect()
}

/// 命中的映射组：得分 ≥ 2.5 的组，按分从高到低取最多两个；平局按表顺序。
/// 弱关键词只有在问题里同时出现任意强关键词时才算数。
pub fn matched_groups(prompt: &str) -> Vec<usize> {
    let mut scored: Vec<(usize, f64)> = group_scores(prompt)
        .into_iter()
        .filter(|(_, s)| *s >= SCORE_THRESHOLD)
        .collect();
    // 按分降序；分相同按表顺序（sort_by 是稳定排序，先按表顺序排好）。
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(2);
    scored.into_iter().map(|(i, _)| i).collect()
}

/// 命中的章节号（按节号升序、去重），不命中为空。
pub fn matched_sections(prompt: &str) -> Vec<u32> {
    let mut nums: Vec<u32> = matched_groups(prompt)
        .iter()
        .flat_map(|&i| LORE_GROUPS[i].sections.iter().copied())
        .collect();
    nums.sort_unstable();
    nums.dedup();
    nums
}

/// 按需注入的章节正文（不命中返回 None）。
/// 返回格式：标记行 + 各节 "## §N 标题\n正文"，按节号升序、去重。
pub fn build_lore_injection(prompt: &str) -> Option<String> {
    let nums = matched_sections(prompt);
    if nums.is_empty() {
        return None;
    }
    let all = sections();
    let mut out = String::from(LORE_MARKER);
    let mut total = 0usize;
    for n in &nums {
        if let Some(s) = all.iter().find(|s| s.num == *n) {
            let body = s.body.trim_end();
            total += body.len();
            out.push_str(&format!("\n\n## §{} {}\n{}", s.num, s.title, body));
        }
    }
    eprintln!("[lore] inject sections {:?}, ~{} bytes", nums, total);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_sections() {
        let s = sections();
        assert_eq!(s.len(), 56, "应解析出 §0–§55 共 56 节");
        assert_eq!(s.first().unwrap().num, 0);
        assert_eq!(s.last().unwrap().num, 55);
    }

    #[test]
    fn core_quick_ref_is_resident() {
        let core = core_quick_ref();
        assert!(core.contains("黑王"));
        assert!(core.contains("时间零"));
        assert!(core.len() > 1000, "§0 约 800 字，不应为空");
    }

    #[test]
    fn lore_question_matches_spirit_words() {
        let groups = matched_groups("时间零是几号言灵？");
        assert_eq!(groups, vec![0]);
        let inj = build_lore_injection("时间零是几号言灵？").unwrap();
        assert!(inj.contains(LORE_MARKER));
        assert!(inj.contains("## §10"));
        assert!(inj.contains("时间零"));
    }

    #[test]
    fn two_groups_at_most() {
        // 君焰（言灵）+ 楚子航（人物）：两组都命中
        let groups = matched_groups("楚子航的君焰是几号言灵？");
        assert_eq!(groups.len(), 2);
        assert_eq!(groups, vec![0, 7]);
    }

    #[test]
    fn normal_work_question_matches_nothing() {
        assert!(matched_groups("帮我写一份本周工作周报").is_empty());
        assert!(matched_groups("把这段代码重构成一个函数").is_empty());
        assert!(build_lore_injection("帮我写一份本周工作周报").is_none());
    }

    #[test]
    fn addressing_norma_is_not_a_lore_question() {
        // 叫一声诺玛、问工作问题，不应误注入（诺玛/EVA 不算关键词）。
        assert!(matched_groups("诺玛，帮我写个文档").is_empty());
        assert!(matched_groups("EVA，帮我改一下这段代码").is_empty());
    }

    #[test]
    fn weak_keywords_need_a_strong_one() {
        // "任务""细节"单独出现不触发；配上强关键词才触发。
        assert!(matched_groups("帮我整理一下今天的任务").is_empty());
        assert!(matched_groups("注意一下这些细节").is_empty());
        assert!(!matched_groups("楚子航执行过哪些任务").is_empty());
    }

    // ---- P0-1 加权评分 ----
    #[test]
    fn exact_match_scores_ten_plus_length_bonus() {
        // 整句恰好等于关键词：精确 +10，长度加权 2×3÷3=2，共 12。
        let scores = group_scores("时间零");
        let s0 = scores.iter().find(|(i, _)| *i == 0).unwrap().1;
        assert!((s0 - 12.0).abs() < 1e-9, "group 0 exact score {s0}");
        assert_eq!(matched_groups("时间零"), vec![0]);
    }

    #[test]
    fn alias_hit_counts() {
        // "小魔鬼"是路鸣泽的别名：+1.5，长度加权 2×3÷5=1.2，共 2.7 ≥ 2.5。
        assert!(matched_groups("小魔鬼是谁").contains(&7));
        // "时零"是时间零的别名：+1.5，长度加权 2×2÷2=2，共 3.5。
        assert!(matched_groups("时零").contains(&0));
    }

    #[test]
    fn weak_only_below_threshold() {
        // "楚子航执行过哪些任务"：剧情组只有弱关键词"任务" +2，
        // 长度加权 2×2÷10=0.4，共 2.4 < 2.5，不命中；人物组命中。
        let groups = matched_groups("楚子航执行过哪些任务");
        assert_eq!(groups, vec![7]);
    }

    #[test]
    fn groups_ranked_by_score_not_table_order() {
        // "任务流程N96楚子航"：任务流程组（表第 18 组）6 + 2×7÷10 = 7.4，
        // 人物组（表第 7 组）3 + 0.6 = 3.6；分高的在前，哪怕表顺序在后。
        assert_eq!(matched_groups("任务流程N96楚子航"), vec![18, 7]);
    }

    #[test]
    fn reverse_contains_prefix_query() {
        // "青铜"是"青铜城"的子串：反向包含 +1.2，长度加权 2×2÷2=2，共 3.2。
        assert!(matched_groups("青铜").contains(&4));
    }

    #[test]
    fn foreshadowing_hits_section_55() {
        // "伏笔"命中补遗组，注入 §55 的 FW 表。
        let inj = build_lore_injection("路鸣泽的交易这条伏笔回收了吗？").unwrap();
        assert!(inj.contains("## §55"));
        assert!(inj.contains("FW_001"));
        assert!(inj.contains("CROSS_VOLUME_SETUP"));
    }
}
