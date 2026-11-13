# DeepSeek API 适配研究报告

**为卡塞尔专员终端（AI agent 桌面端）做 DeepSeek 适配做准备**
**研究日期：2026-11-12｜核实基准：DeepSeek 官方文档（api-docs.deepseek.com）+ 2026-10/11 月多家第三方核查**
**结论先行：DeepSeek 对 agent 是「便宜但有坑」的选择——缓存能把输入成本压到 2%，但模型名、思考强度、工具调用都有硬坑，必须在引擎层绕开，不能直接照搬 OpenAI 的写法。**

---

## 0. 结论先行（给没时间看全文的人）

| # | 结论 | 影响 |
|---|------|------|
| 1 | **`deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 退役，请求会直接失败。** 当前只有两个模型：`deepseek-flash`（DeepSeek-V4.1-Flash-1017）和 `deepseek-v4-pro`（DeepSeek-V4-Pro-0813）。思考不再是模型名，而是一个请求参数。 | 产品模型目录必须改；视觉稿里写的 `cn:deepseek-v4.1` / `cn:deepseek-v4.1-flash` 不是官方 ID（疑似反代网关的自定义名），直连 DeepSeek 时要映射到官方 ID，并对旧名做退役警告。 |
| 2 | **缓存是最大省钱杠杆。** 缓存命中输入价只有未命中的 **2%（Flash，50 倍差）/ 约 3.3%（Pro，30 倍差）**，且自动开启、零配置、零写入费。实测案例：某缓存优先 agent 做到 99.82% 命中率，日账单 $61 → $1.38。 | 用量面板必须显示缓存命中率与缓存省下的钱；引擎必须按「前缀冻结」规则组装请求，否则命中率上不去。 |
| 3 | **思考强度四档在 DeepSeek 上实际只有三档有效。** `reasoning_effort` 只有 `low` / `high` / `max`；「中」会被静默映射成「高」——视觉稿的 低/中/高/Max 里，中和高发出去是一样的。 | 思考强度选择器接 DeepSeek 时要特殊处理（见 §2.3）：要么只显示三档，要么明确标注「中 = 高」。 |
| 4 | **工具调用 + 思考模式有三个硬坑，不绕开就会 400 / 静默失效。** ① 带 `tools` 的请求必须把之前所有轮次的 `reasoning_content` 原样回传，缺了就 400；② 思考开启时 `tool_choice: "required"` / 指定函数名会 400，只能用 `auto`；③ 思考模式下 `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` 会被静默忽略。 | 这三条是引擎实现清单，不是可选项（见 §4、§5）。 |
| 5 | **没有服务端上下文压缩。** Chat Completions 没有 /compact 接口；压缩得在客户端自己做。官方开源 agent（DeepSeek Harness）的方案可直接抄：80% 触发、保留 16% 原文尾巴、工具结果先截断再摘要。 | 上下文仪表盘 + 自动压缩是产品自己要实现的功能（见 §3）。 |
| 6 | **高峰时段正好是北京时间白天工作时间。** 高峰 = 工作日 09:00–12:00、14:00–18:00（北京时间），费率翻倍；其余时间（晚上、周末、节假日）半价。 | 用量面板要显示当前峰/谷；定时任务建议默认排到低谷跑。 |
| 7 | **限流不按 RPM/TPM，按并发数。** Flash 2,500 并发、Pro 500 并发（按账号计，所有 Key 共享）；超了返回 429，可免费申请扩容。 | EVA 并行多智能体要设并发上限（Pro 只有 500，16 路并行没问题，但别无限制地铺）。 |
| 8 | **用户 07:44 提过的「dsh」很可能就是 DeepSeek Harness**——DeepSeek 官方开源的终端 coding agent（`dsh` 命令），它的缓存优先设计与压缩方案正是本报告 §3、§6 的参考实现。 | 建议向用户确认 dsh 是不是 DeepSeek Harness；若是，可直接把它作为 DeepSeek 原生 agent 行为的对标实现。 |

---

## 1. 模型与价格总表（2026-11-12 核实）

### 1.1 当前模型

| API 模型名 | 背后版本 | 定位 | 上下文 | 最大输出 | 图像输入 |
|---|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017（2026-10-17） | 默认主力：便宜、快、量大 | 1M token | 384K token | 支持 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813（2026-08-13） | 旗舰：复杂推理、多步分析、硬编码 | 1M token | 384K token | 不支持（纯文本） |

- 旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍被接受，按 Flash 价计费。
- `deepseek-chat` / `deepseek-reasoner` 已退役（2026-07-24 15:59 UTC），不再指向任何模型，请求会失败。
- 两模型均为 MoE 开源权重（MIT 协议）；Flash 约 552B 参数（输入 8B 激活 / 输出 16B 激活），Pro 为 1.6T 总量 / 49B 激活（不同来源数字略有出入，以官方为准）。

### 1.2 价格（美元 / 每 100 万 token）

| 模型 | 时段 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
|---|---|---|---|---|
| **deepseek-flash** | 低谷 | **$0.003** | $0.15 | $0.60 |
| **deepseek-flash** | 高峰 | **$0.006** | $0.30 | $1.20 |
| **deepseek-v4-pro** | 低谷 | **$0.022** | $0.66 | $1.98 |
| **deepseek-v4-pro** | 高峰 | **$0.044** | $1.32 | $3.96 |

- **高峰时段：01:00–04:00 和 06:00–10:00 UTC，周一至周五，不含中国法定节假日；其余全部是低谷。** 换算成北京时间（UTC+8）：高峰 = **工作日 09:00–12:00、14:00–18:00**；低谷 = 晚上、凌晨、周末、节假日全天。低谷价 = 高峰价的一半。
- 命中价 = 未命中价的 2%（Flash，50 倍差）/ 约 3.3%（Pro，30 倍差）。
- 另有 Search / Fetch（服务端联网工具，见 §4.5）：$0.75 / 每 1,000 次成功请求，2026-11-01（北京时间）起计费。
- 计费方式：预付费余额扣款，无月费；余额不足返回 402。

### 1.3 一个 agent 的成本算例（示意，非实测账单）

假设一个 agent 会话：每轮发送 50K 输入 token（系统提示词 + 工具定义 + 对话历史，基本可缓存），生成 2K 输出 token，每天 100 轮，用 Flash 低谷价：

| 情形 | 输入费用/天 | 输出费用/天 | 合计/天 |
|---|---|---|---|
| 无缓存（全部按未命中） | 5M × $0.15 = $0.75 | 0.2M × $0.60 = $0.12 | **$0.87** |
| 命中率 95% | 命中 4.75M × $0.003 = $0.014 + 未命中 0.25M × $0.15 = $0.038 | $0.12 | **$0.17** |

命中率 95% 时一天省约 80%。高峰时段数字翻倍，但比例不变。真实第三方案例（DeepSeek Reasonix，2026-05-01）：435M 输入 token、命中率 99.82%，日账单从 $61 压到 $1.38。

**结论：对 agent 这种「每轮重发全部历史」的用法，缓存命中率是账单的第一决定因素，比选哪个模型重要得多。**

---

## 2. 模型选择：哪个适合 agent 干活

### 2.1 默认分工建议

| 场景 | 推荐模型 | 原因 |
|---|---|---|
| 日常执行、工具调用、改代码、批量任务、EVA 并行子智能体 | **deepseek-flash** | 便宜 4.4 倍、快、并发上限高（2,500 vs 500）、支持图像输入；输出上限同为 384K |
| 复杂推理、多步规划、难的 bug、需要最强代码能力时 | **deepseek-v4-pro** | 旗舰能力；SWE-bench Verified 在 Think Max 下 80.6%（官方模型卡数据）；但贵 3.6 倍、并发上限只有 500、纯文本 |
| 升级策略 | Flash 默认，Pro 做「升级档」 | 遇到困难任务时单轮/单会话升级到 Pro（类似 Codex 的模型升级），不要全程用 Pro |

### 2.2 思考模式：不是模型，是参数

- 两个模型都支持思考模式，**默认开启，默认强度 `high`**。开关与强度是请求参数，不是模型名：
  - OpenAI 兼容格式：`extra_body={"thinking": {"type": "enabled"/"disabled"}}` + `reasoning_effort="low"/"high"/"max"`。
  - Anthropic 兼容格式：`reasoning: {"effort": "none"/"low"/"high"/"max"}`（`none` = 关闭思考）。
  - Responses API 格式：`output_config.effort`。
- 思考过程通过与 `content` 平级的 **`reasoning_content`** 字段返回；流式时同样随 chunk 返回。
- **思考 token 按输出 token 计费**（即思考越深，输出账单越高）。强度 `max` 时思考 token 量最大。
- 据 DeepSeek 文档，复杂 agent 请求（如 Claude Code / OpenCode 这类）会被自动按 `max` 处理——引擎侧若明确传了 `reasoning_effort`，以显式值为准。

### 2.3 思考强度四档的坑：中 = 高

官方映射表（`reasoning_effort` 请求值 → 实际生效值）：

| 请求值 | 实际生效 |
|---|---|
| minimal | low |
| low | low |
| **medium** | **high** |
| high | high |
| xhigh | high |
| max | max |
| ultra | max |

**视觉稿的思考强度是 低/中/高/Max 四档。接 DeepSeek 时，「中」和「高」发出去是同一个值（high），用户以为调低了、其实没有。** 建议：

- 方案 A（推荐）：DeepSeek 服务商下，强度选择器只显示三档：低 / 高 / Max，并在「高」旁标注「中档与高档相同」。
- 方案 B：保留四档，但「中」在 DeepSeek 下实际按 high 发送，UI 上用小字说明「DeepSeek 上中档 = 高档」。
- 无论哪种，**不要把「中」静默映射成 low**（那会改变用户意图且与官方映射不一致）。

### 2.4 思考模式下的采样参数会被静默忽略

官方原话：思考模式不支持 `temperature`、`presence_penalty`、`frequency_penalty`；设置了也不会报错，但**没有任何效果**。`top_p` 的行为分模型：

- `deepseek-flash`：仅思考模式下生效，有效范围 0.95–1.0（低于 0.95 按 0.95 处理）；非思考模式固定 1.0，设置被忽略。
- `deepseek-v4-pro`：思考模式下设置被忽略（开工具调用时固定 0.95，否则 1.0）；非思考模式下生效。

**产品建议：** 当思考开启时，设置页 / 模型面板里的 temperature / top_p / presence_penalty / frequency_penalty 应置灰并标注「思考模式下不生效」，而不是让用户调了个寂寞。关闭思考后恢复可用。

### 2.5 模型名映射问题（视觉稿现状）

视觉稿输入框与模型目录里写的是 `cn:deepseek-v4.1`、`cn:deepseek-v4.1-flash`。这两个**不是 DeepSeek 官方 API 的模型 ID**。`cn:` 前缀像是某个网关/反代（很可能是用户在用的 workbuddyapi2 之类）的路由前缀。产品落地时：

- 直连 DeepSeek（`https://api.deepseek.com`）时，模型 ID 必须用官方名 `deepseek-flash` / `deepseek-v4-pro`。
- 自定义服务商（反代）下，允许用户自己填模型 ID 字符串，不做白名单校验，但要在模型目录里标注该 ID 来自哪个服务商。
- 模型目录里对 `deepseek-chat` / `deepseek-reasoner` 做退役检测：用户若填了这两个名字，提示「已于 2026-07-24 退役，请求会失败」，并一键替换成 `deepseek-flash`（对应非思考）/ 思考参数。

---

## 3. Prompt Caching：机制、计费、怎么提高命中率

### 3.1 是什么

DeepSeek 的「Context Caching on Disk」（磁盘上下文缓存）：**默认对所有用户开启，无需配置、无需改代码、无写入费用。** 每次请求会把输入前缀建成硬盘缓存；后续请求如果前缀与已存缓存重合，重合部分从缓存取，按缓存命中价计费。只影响输入侧，输出每次都重新生成。

### 3.2 命中规则（比「前缀相同」更严格）

缓存以独立的 **cache prefix unit（缓存前缀单元）** 为单位存储；只有当请求**完整匹配**一个已持久化的单元时才算命中。单元在三种时机持久化：

1. **请求边界**：每次请求产生两个单元——用户输入结束处一个、模型输出结束处一个。
2. **公共前缀检测**：系统检测到多个请求的公共前缀时，把该前缀存为独立单元。
3. **固定 token 间隔**：长输入/输出按固定间隔切分（间隔值官方未公布），避免长前缀因到不了结束位置而一直不可缓存。

官方示例的含义：
- 请求1 `A + B`，请求2 `A + B + C` → 命中 `A + B`（标准多轮对话情形：第二轮重发第一轮消息 + 回复，正好完整匹配第一轮输出结束处的单元，所以多轮对话天然容易命中）。
- 请求1 `A + B`，请求2 `A + C` → **不命中**（`A + C` 与已存单元 `A + B` 不完全匹配）；系统随后检测到公共前缀 `A` 并持久化，于是请求3 `A + D` 能命中 `A`。

其他要点：
- **尽力而为（best-effort），不保证 100% 命中。**
- 缓存构建需要数秒；闲置缓存会在**几小时到几天内自动清除**（无 TTL 可调）。
- 缓存按账号隔离；传 `user_id` 参数可按最终用户隔离缓存与调度（单用户桌面端可传固定值，保持缓存稳定）。

### 3.3 计费与用量字段

每次响应都带 `usage` 对象，关键字段：

| 字段 | 含义 |
|---|---|
| `prompt_cache_hit_tokens` | 本次命中缓存的输入 token 数，按命中价计费 |
| `prompt_cache_miss_tokens` | 未命中、需重新计算的输入 token 数，按未命中价计费 |
| `prompt_tokens` | 输入 token 总数 = 命中 + 未命中 |
| `prompt_tokens_details.cached_tokens` | 与 `prompt_cache_hit_tokens` 相同（OpenAI 风格字段，兼容读取） |
| `completion_tokens` | 输出 token 数（含思考 token），按输出价计费 |

**缓存命中率公式：`命中率 = prompt_cache_hit_tokens / (prompt_cache_hit_tokens + prompt_cache_miss_tokens)`。**

注意：流式请求时 usage 在最后一个 chunk 才到；首个新前缀请求命中数为 0 是正常的。

### 3.4 如何提高命中率（引擎必须遵守的组装规则）

把每次请求看作「只追加的日志」：

1. **稳定内容放最前面，变化内容放最后。** 顺序：系统提示词 → 工具定义（tools）→ 检索到的文档/文件内容 → 用户最新消息。任何每轮都变的东西（时间戳、请求 ID、AB 标记）一律移到最后一条用户消息里。
2. **系统提示词逐字节固定。** 改一个标点都会让后续所有请求的前缀失效。引擎应缓存系统提示词的哈希，变化时在日志里告警。
3. **工具定义顺序与内容固定。** 工具 schema 的 JSON 键重排也会破坏前缀；工具列表一旦确定就不要每轮重新序列化（或做规范化排序后缓存）。
4. **对话历史只追加、不改写、不重排。** 不要改写、意译、重排 earlier turns；不要把历史重新格式化。
5. **长文档预分块。** 每轮换一个 500K token 文档等于没有可缓存前缀；应固定少量规范分块、按 ID 引用、顺序稳定。
6. **会话内复用同一前缀。** 多轮对话天然命中率高；新开会话、换模型、换系统提示词都会让缓存失效（新前缀从 0 开始）。

与 OpenAI / Anthropic 的对比：DeepSeek 是「自动开启 + 无写入费 + 无最小前缀说明（2024 年发布时称存储单元 64 token）」，但**没有** OpenAI 的 `prompt_cache_key`、Anthropic 的 `cache_control` 断点与 TTL 选择——控制力更弱，命中率低时只能靠重组 prompt 解决。

### 3.5 对 agent 意味着什么

agent 是缓存的最差场景也是最好场景：最差是因为每轮都要重发全部历史（系统提示词 + 工具定义 + 历史 + 工具结果）；最好是因为只要前缀稳定，这些重发内容几乎全部命中。第三方缓存优先 agent（Reasonix）的三区设计值得直接抄：

- **ImmutablePrefix（不可变前缀）**：会话开始时冻结系统提示词、工具定义、few-shot 示例，逐字节不变。
- **AppendOnlyLog（只追加日志）**：历史只增长，永不重排、重写、重序列化。
- **VolatileScratch（易变暂存区）**：推理过程与临时状态每轮重置，绝不进入缓存前缀。

---

## 4. 上下文管理：1M 上下文与压缩

### 4.1 容量

- 上下文窗口 **1M token**（两模型相同），最大输出 384K token。
- API 是无状态的：客户端每轮必须重发全部历史，DeepSeek 不替你存。

### 4.2 没有服务端压缩，压缩是客户端的活

DeepSeek 的 Chat Completions **没有提供服务端压缩接口**（没有 /compact、没有自动摘要参数）。上下文满了 API 会直接拒绝调用。压缩必须由 agent 引擎自己实现。

### 4.3 可直接抄的方案：DeepSeek Harness 的压缩机制

DeepSeek Harness（`dsh`，DeepSeek 官方开源终端 coding agent，见 §7）内置的压缩实现 `@deepseek-ai/dsh-compaction-basic`：

| 环节 | 做法 |
|---|---|
| 触发 | 当前上下文达到窗口约 **80%** 时自动触发（`thresholdRatio` 0.8，可配） |
| 先剪枝 | `dsh-compaction-tool-result-pruner` 先截断超大工具结果（保留头 4096 + 尾 1024 字符，超 50KB 的溢出到旁存储、留定位符）；剪完若低于阈值，**不调摘要** |
| 保留尾巴 | 保留约 **16%** 窗口的最新对话原文（`retainRatio` 0.16，可配）；不一定保留完整轮次，长轮次内的已关闭步骤也可压缩 |
| 摘要 | 一次结构化 LLM 摘要：重放与模型已见过的同一段对话前缀 + 压缩指令（这样摘要请求本身也能复用已缓存前缀）；递归滚动摘要 |
| 替换而非叠加 | 摘要**替换**掉被选中的历史区段，而不是再叠一份 |
| 手动触发 | `/compact` 命令（`dsh-command-compact`） |
| 可替换 | 压缩是可替换能力（`ctx.compaction`），每个上下文只能加载一个实现；社区已有无模型调用的近无损方案（`dsh-compaction-instant`：检查点只存原文 + 序号指针回指追加式会话日志，毫秒级、不占 KV 缓存） |

另有共识做法（各家 agent 对比）：触发点普遍在窗口 80% 左右；最新尾巴原文保留；摘要是独立模型调用、有独立预算（如 Harness 给摘要 8192 token）；压缩后原始记录应保留在磁盘日志里（Harness 强制「模型可见 ⟺ 已记录」不变式，压缩只是日志上的一层投影，原始事件都在）。

### 4.4 给产品的上下文功能建议

- 上下文仪表盘：当前用量 / 1M（进度条 + 百分比），接近 80% 时变色提醒。
- 自动压缩：达到 80% 先剪工具结果、再摘要，压缩前在界面上留一条记录（「已压缩 ×× 轮对话为摘要，可查看」），原始记录保留在本地日志。
- 手动 `/compact` 命令（与 Codex 的斜杠命令体系一致）。
- 压缩摘要请求复用主 agent 已缓存的前缀（按 Harness 的做法），避免压缩本身产生大额未命中费用。

---

## 5. 工具调用（Function Calling）

### 5.1 支持程度

- OpenAI 兼容的 `tools` 数组 + JSON Schema，在 `POST /chat/completions`（`https://api.deepseek.com`）上可用；**两个当前模型都支持，且思考模式下也支持**（自 DeepSeek-V3.2 起）。
- 工具数量上限：与 OpenAI 惯例一致，最多 **128 个**工具（第三方 CLI 文档口径；官方未在公开页单独列出该数字，引擎侧按 128 做上限提示即可）。
- 另有 Anthropic 兼容面（`https://api.deepseek.com/anthropic`），工具走 Anthropic 的 tools 格式；以及 Responses API（OpenAI 兼容，支持存储状态、`previous_response_id`、后台运行）。
- 模型只「提议」调用，不执行；执行与安全检查是客户端的责任（权限/沙箱仍由产品自己管）。

### 5.2 三个硬坑（引擎实现清单）

**坑 1：`reasoning_content` 必须回传，否则 400（官方思考模式指南原话）。**
- 请求**带 `tools` 参数**时，之前所有轮次的 `reasoning_content` 必须在后续所有请求里原样回传——即使是模型没有调工具的轮次也不例外。没正确回传，API 返回 **400**。
- 请求**不带 `tools`** 时，`reasoning_content` 不需要回传；即使传了也会被忽略，不并入上下文。
- 正确做法：把 `response.choices[0].message` 整个对象追加到 messages 列表（它自带 content + reasoning_content + tool_calls），不要只取 content。agent 循环每轮都带 tools，所以**每轮都必须回传**。
- 注意：`reasoning_content` 也会计入输入 token（它在上下文里占位置），压缩时要把它和 content 一起算进去。

**坑 2：思考开启时不能强制调工具，否则 400。**
- 思考是默认开启的；此时 `tool_choice: "required"` 或指定某个函数名会返回 **HTTP 400**（`unsupported_parameter`）。这会弄坏 LangChain / CrewAI 这类默认强制调工具的绑定。
- 引擎必须：工具调用一律用 `tool_choice: "auto"`（让模型自己决定）；如果某步确实需要强制调某个工具，先把思考关掉（`thinking: {"type": "disabled"}`）再发。

**坑 3：思考模式下采样参数被静默忽略。**
- 见 §2.4：`temperature` / `presence_penalty` / `frequency_penalty` 在思考模式下设了也无效，且不报错。产品应在思考开启时置灰这些控件。

### 5.3 可靠性与校验

- 工具调用偶尔会出现幻觉：参数名写错、调用不存在的工具（第三方 agent 实测反馈；OpenClaw 靠重试兜底）。引擎侧要做：参数 JSON 校验 → 失败时把错误以 tool 结果回传给模型重试 → 多次失败则停下并提示用户，不要无限循环。
- **Strict 模式（Beta，仅工具调用）**：走 `https://api.deepseek.com/beta`，每个 function 都设 `"strict": true`，且每个 object 的全部属性进 `required`、`additionalProperties: false`；支持的类型：object / string / number / integer / boolean / array / enum / anyOf；string 可用 `pattern` / `format`（email、uuid 等），但**不能用** `minLength` / `maxLength`；array 不能用 `minItems` / `maxItems`。非法 schema 会在模型运行前就报错（这反而是好事：早发现）。注意：不要把全部流量都切到 `/beta`，只在需要强校验的调用上用。
- **不要把 `tools` 和 `response_format: json_object` 叠加当「双保险」**：官方建议二选一——要调外部动作就用 tools（结构由函数参数 schema 定），只要结构化文本就用 JSON Output。

### 5.4 JSON 输出

- Chat Completions 只支持 `response_format={"type": "json_object"}`；**不支持 `json_schema`**（传了会被 400 拒绝，提示该类型不可用）。系统或用户提示词里必须包含 `json` 这个词，并给出期望字段示例；`max_tokens` 要设够，避免 `finish_reason=length` 截断在 JSON 中间；偶尔会返回空 `content`，要重试。
- 有效 JSON 率实测：V4 Pro 约 98.5%、V4 Flash 约 96.8%（第三方 AIWave 2026-09-27 实测），属于「部分保证」——**客户端必须自己解析校验**（Pydantic / Zod 一类），不要信裸 JSON。
- 需要硬 schema 保证时：优先用 Responses API 的 `text.format`（支持 strict）；或把 schema 放进工具定义里走工具调用；或在提示词里描述 schema + 客户端校验。
- 注意：Responses API 与 Chat Completions 的能力有差异（Responses 支持 `text.format` strict；Chat Completions 不支持 `json_schema`）。

### 5.5 服务端内置工具：Search / Fetch（DeepSeek Harness）

- DeepSeek 提供服务端 Search 与 Fetch 工具调用（通过 DeepSeek Harness、Claude Code、Codex 调用时），$0.75 / 每 1,000 次成功请求，2026-11-01（北京时间）起计费，此前免费。
- 对产品的意义：如果引擎要给 agent 联网搜索能力，可以直接用 DeepSeek 的服务端 Search/Fetch（按次计费），而不必自己接搜索 API；用量面板里要把 Search/Fetch 的调用次数与费用单独列出来（它不走 token 计费）。

---

## 6. 其它 DeepSeek 特有能力

### 6.1 推理过程展示（`reasoning_content`）

- 思考过程是独立字段，可流式返回；产品可以像 Claude 的「显示思考过程」开关一样，把思考过程做成可折叠的展示（默认折叠/摘要显示，点开看全文）。
- 思考内容不适合当作最终答案引用；多轮回传规则见 §5.2 坑 1。

### 6.2 三种 API 形态

| 形态 | 地址 / 格式 | 特点 |
|---|---|---|
| Chat Completions（OpenAI 兼容） | `https://api.deepseek.com` | 主力；OpenAI SDK 改 base_url 即用 |
| Anthropic 兼容 | `https://api.deepseek.com/anthropic` | Anthropic SDK 格式；`reasoning.effort` 控思考 |
| Responses API（OpenAI 兼容） | DeepSeek 官方提供 | 存储状态、`previous_response_id`、后台运行；`text.format` 支持 strict 结构化输出 |

### 6.3 限流与错误码

| 项目 | 内容 |
|---|---|
| 限流模型 | **无 RPM / TPM**；按并发数：Flash 2,500、Pro 500（按账号计，所有 Key 共享）；`user_id` 参数可按最终用户隔离并发与缓存 |
| 429 Rate Limit Reached | 超并发；响应带 retry-after，按指数退避重试；可免费申请扩容 |
| 402 Insufficient Balance | 余额不足；充值后继续，无免费兜底 |
| 503 Server Overloaded | 高峰期过载；等一会重试 |
| 400 | 常见原因：`reasoning_content` 未回传（带 tools 时）、思考开启时强制调工具、传了不支持的 `response_format` 类型 |

### 6.4 视觉能力

- `deepseek-flash`（V4.1 Flash）支持图像输入；`deepseek-v4-pro` 纯文本。模型目录的能力标签要区分这一点（截图/图片理解走 Flash）。

---

## 7. DeepSeek Harness（dsh）：值得对标的实现

- **DeepSeek Harness** 是 DeepSeek 官方开源的终端 coding agent（命令 `dsh`），与 Codex CLI / Claude Code 同类。用户 2026-11-12 07:44 提过「Claude Code、Codex、dsh 都开源、有框架用」——**dsh 极可能就是 DeepSeek Harness**（此前记为「所指不明」，现可向用户确认）。
- 它是 DeepSeek 原生 agent 行为的参考实现，尤其值得抄的三点：
  1. **缓存优先的请求组装**（§3.5 的三区设计）；
  2. **压缩机制**（§4.3：80% 触发、16% 保留、工具结果剪枝、摘要复用缓存前缀）；
  3. **可替换的压缩能力**（`ctx.compaction`，一个上下文只加载一个实现，可换社区的近无损方案）。
- 另有第三方缓存优先 agent **Reasonix**（在 DeepSeek 官方文档里有专门介绍页），99.82% 命中率的实测案例即出自它。

---

## 8. 落到产品里的具体功能清单

按优先级排。P0 是 DeepSeek 适配必须有的（不做会错/会贵），P1 是体验加分，P2 是以后迭代。

### P0 — 引擎与计费正确性

| # | 功能 | 具体做法 |
|---|---|---|
| P0-1 | **模型目录修正** | 直连 DeepSeek 的模型 ID 改为官方名 `deepseek-flash` / `deepseek-v4-pro`；`deepseek-chat` / `deepseek-reasoner` 标记已退役并一键替换；`cn:deepseek-v4.1*` 这类自定义名只在自定义服务商（反代）下允许，并标注来源服务商；Flash 标「支持图像」，Pro 标「纯文本」。 |
| P0-2 | **思考强度映射修正** | DeepSeek 下强度只有低 / 高 / Max 三档有效；「中」与「高」相同——UI 要么只显示三档，要么在「中」旁标注「DeepSeek 上等于高」。 |
| P0-3 | **思考模式下置灰采样参数** | 思考开启时，temperature / top_p / presence_penalty / frequency_penalty 置灰 + 标注「思考模式下不生效」。 |
| P0-4 | **请求组装按缓存规则** | 系统提示词逐字节固定（哈希校验，变了就告警）；工具定义顺序与序列化固定；历史只追加不改写；时间戳等易变元数据移到最后一条消息；`user_id` 传固定值。目标：多轮对话命中率 90%+。 |
| P0-5 | **`reasoning_content` 回传** | 带 tools 的请求必须把之前所有轮次的 `reasoning_content` 原样回传（直接追加整条 message 对象）；缺了会 400。 |
| P0-6 | **tool_choice 永远 auto** | 思考开启时绝不发 `tool_choice: "required"` 或指定函数名；需要强制调工具时先关思考。 |
| P0-7 | **用量字段采集** | 每次请求记录 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` / `completion_tokens`（流式取最后一个 chunk 的 usage），存入 Token 账本。 |

### P0 — 用量面板（用户点名要的）

| # | 功能 | 具体做法 |
|---|---|---|
| P0-8 | **缓存命中率面板** | 用量页 / 状态栏显示：本次会话命中率、今日命中率、累计命中率（公式见 §3.3）；命中率低时给一句提示（如「系统提示词变了 3 次，命中率被拉低」）。 |
| P0-9 | **缓存节省金额** | 显示缓存省下的 token 数与费用：`节省 = 命中 token × (未命中单价 − 命中单价)`，按当前峰/谷价算；同时显示「若无缓存会花多少」做对比。 |
| P0-10 | **峰/谷标识与费用拆分** | 费用按高峰/低谷拆分显示；状态栏加一个「高峰/低谷」小标识（北京时间 09:00–12:00、14:00–18:00 工作日为高峰）；定时任务默认建议排到低谷。 |
| P0-11 | **单次会话费用** | 每条会话显示本次 token 与费用（输入命中/未命中/输出三段 + Search/Fetch 次数），而不是只有一个总数。 |
| P0-12 | **余额与限流提醒** | 402 余额不足时明确提示充值；429 时显示退避重试状态；Pro 并发 500 的提示（EVA 并行路数别超过上限）。 |

### P1 — 上下文与思考体验

| # | 功能 | 具体做法 |
|---|---|---|
| P1-1 | **上下文仪表盘** | 上下文用量 / 1M 进度条；到 80% 变色提醒；显示「预计还能聊约 × 轮」。 |
| P1-2 | **自动压缩（抄 Harness）** | 80% 触发：先剪工具结果（头 4096 + 尾 1024 字符，超 50KB 溢出旁存），再 LLM 摘要，保留 16% 原文尾巴；压缩前留记录、原始日志保留本地；支持 `/compact` 手动触发。 |
| P1-3 | **思考过程展示** | `reasoning_content` 流式显示为可折叠的「思考过程」行（默认折叠或只显示摘要），与「显示思考过程」开关联动。 |
| P1-4 | **模型自动升级** | Flash 默认；任务变难时单轮升级 Pro（或用户一键升级），并在用量里标出升级产生的额外费用。 |
| P1-5 | **JSON 输出兜底** | 需要结构化输出时用 `response_format: json_object` + 提示词里写清字段；客户端校验失败自动重试一次；绝不发 `json_schema`（会被 400）。 |

### P2 — 以后迭代

| # | 功能 | 具体做法 |
|---|---|---|
| P2-1 | **Strict 工具调用** | 需要强校验的场景走 `https://api.deepseek.com/beta` + 全员 `strict: true`（注意 schema 限制：不用 minLength/maxLength/minItems/maxItems）。 |
| P2-2 | **服务端 Search/Fetch** | 接 DeepSeek 的服务端联网搜索（$0.75/千次），用量里单独列支。 |
| P2-3 | **Responses API** | 需要存储状态 / 后台运行 / strict 结构化输出时切 Responses API；先核实服务端压缩在官方端点是否可用（见 §9）。 |
| P2-4 | **命中率优化建议** | 定期出一句诊断（如「本会话命中率 62%，主要原因是系统提示词改了 2 次」），帮用户把命中率养上去。 |

---

## 9. 未核实 / 需要注意的事项

1. **V4 Pro 是否会被重路由到 Flash**：有 2026-09 的消息称 V4 Pro 流量将重路由到 V4.1 Flash 并按 Flash 价计费，但官方定价页仍单列 Pro 价格。两者说法不一致，**以官方定价页为准**，Pro 仍按上表价格列示；上线前再核对一次。
2. **Responses API 的服务端压缩**：第三方网关文档提到 Responses API 有 `context_management` 自动压缩，但**未核实 DeepSeek 官方端点是否提供**；在核实前，压缩一律按客户端方案（§4.3）做。
3. **工具数量上限 128**：来自第三方 CLI 文档口径（与 OpenAI 惯例一致），官方公开页未单独列出；引擎侧按 128 做上限提示即可，超了 DeepSeek 会报错再处理。
4. **价格会变**：DeepSeek 在 2026-08 改峰谷价、2026-09 调低 Flash 价、2026-10-17 换 Flash 版本但价格未变。产品里的价格表应做成可更新的配置（不要写死），并标注「以官方定价页为准」。
5. **「复杂 agent 请求自动按 max」**：多家指南称 DeepSeek 会把复杂 agent 请求自动按 `max` 处理；引擎侧显式传 `reasoning_effort` 时以显式值为准，不依赖该行为。
6. **dsh 的确认**：用户 07:44 提到的「dsh」最可能是 DeepSeek Harness；建议向用户确认一次，若是，可直接把它作为 DeepSeek 原生 agent 的对标实现来研究。

---

## 10. 资料来源

- DeepSeek 官方文档 Thinking Mode：https://api-docs.deepseek.com/guides/thinking_mode/（2026-11-12 直接读取；`reasoning_content` 回传规则、思考参数映射表、采样参数限制均出自此处）
- DeepSeek 官方文档 Context Caching、Models & Pricing（经多家 2026-10/11 核查引用）
- DeepSeek API Context Caching 指南解读：https://deepseekai.guide/api/deepseek-api-context-caching/（2026-11-12 读取；缓存前缀单元规则、计费示例、五条命中率规则）
- DeepSeek API Function Calling（V4）：https://deepseekai.guide/api/deepseek-api-function-calling/、https://deepseek.wang/en/api/deepseek-api-function-calling/
- DeepSeek API 定价（2026-10，多家交叉核对）：https://developer.puter.com/tutorials/deepseek-api-pricing/、https://tetrate.io/learn/ai/deepseek-api-pricing-enterprise-cost-governance、https://omidsaffari.com/blog/deepseek-pricing、https://www.lindy.ai/blog/deepseek-pricing
- 思考强度映射与三格式对照：https://omidsaffari.com/blog/reasoning-models、https://prompt-architects.com/blog/589-prompting-deepseeks-reasoning-models
- 限流（并发模型）：https://www.morphllm.com/llm-api、https://iadecider.com/articles/api-rate-limits-reference-2026、https://deepseek.ai/deepseek-api
- JSON 输出与强制工具调用限制：https://iadecider.com/articles/llm-api-feature-support-matrix-2026、https://deepseek.day/en/blog/deepseek-api-function-calling-json/、https://staging.tchavi.com/en/m/deepseek/deepseek-v4.1-flash
- 上下文压缩（DeepSeek Harness / Reasonix）：https://blog.yeyupiaoling.cn/article/1786987604796?lang=en、https://github.com/handyutils/sctxx/blob/HEAD/docs/DeepSeek-Harness-rolling-token-pressure-triggered-one-shot-structured-checkpoint%20-summarization-algorithm.md、https://matto.club/writing/how-coding-agents-work/how-compaction-works/、https://www.deepseekv4guide.org/guides/reasonix-deepseek

*价格与参数以 DeepSeek 官方文档为准；本文核实于 2026-11-12，DeepSeek 调价或改版后请以官方定价页重新核对。*
