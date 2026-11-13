# TIANSHU（huiliyi37/Tianshu-harness）DeepSeek 优化研究

> 研究日期：2026-11-12 · 研究对象：[huiliyi37/Tianshu-harness](https://github.com/huiliyi37/Tianshu-harness)（v3.37.4，commit `2d0b22e`）
> 方法：克隆仓库（depth 50）通读 README、架构总览、CVM 实证与观测 Harness 文档，核对 `src/cache/`、`src/prompt/`、`src/compact/`、`src/api/`、`src/memory/`、`src/search/` 等核心源码
> 只做研究，未改任何代码。克隆在 `~/workspace/research_notes/tianshu-deepseek-20261112/repo`

---

## 0. 一句话结论

TIANSHU 是一个 **TypeScript 编写的编程 agent 运行时**，终端 TUI、桌面端（Tauri）、VS Code 插件共用同一个内核。它在模型与真实世界之间加了一层**认知执行环境 CVM**（Cognitive Virtual Machine），把目标、状态、证据、权限、终止条件从对话历史里拿出来交给运行时管理，并**对 DeepSeek V4 极度优化**。

对卡塞尔专员终端最有价值的不是它的功能清单，而是**一整套以「前缀缓存优先」为架构级承诺的工程**：5 个真实长会话 2,001 次请求、6.45 亿 input tokens，**前缀缓存命中率 99.3–99.6%，账单 ¥880 → ¥20（省 97.7%）**。本报告 §3 把这套机制拆到可直接抄的程度。

**项目名片**

| 项 | 值 |
|---|---|
| 仓库 | huiliyi37/Tianshu-harness（公开，Apache-2.0） |
| 版本 | v3.37.4（2026-10 口径）；1,333 stars / 101 forks / 1,074 commits |
| 创建 | 2026-06-09 |
| 规模 | `src/` 约 1,700 文件 / 35 万行；测试约 2,100 文件 / 2.3 万用例；75 个运行时 hook 模块；16 个内置星域 |
| 入口 | CLI `tianshu`（兼容别名 `rivet`，开发代号 Rivet）；数据目录 `~/.rivet` |
| 安装 | `npm install -g tianshu-harness`；Node.js 硬门槛 24.22.1+ / 26.12.1+；桌面端从 Releases 下（macOS `.dmg` / Windows `-setup.exe` / Linux `.AppImage`，Windows 依赖 WebView2） |
| 模型 | 内置 25 项服务商预设，会话内 `/model` 切换，也支持任意 OpenAI 兼容端点 |

**关于 dsh**：TIANSHU 代码里两处提到 `dsh`——重试可见性注为「dsh 式」、记忆回填注为「对齐 dsh memory-pipeline」。说明 **dsh 是独立项目，TIANSHU 对齐它**，两者不是同一个东西。结合此前结论，dsh 极可能是 DeepSeek Harness（官方开源终端 agent），`dsh-tianshu-build` 是 dsh 的 fork。建议向用户确认一次。

---

## 1. 它是什么、怎么用

**核心问题**：模型何以稳定地交付——目标不漂移、完成有证据、验证有闭环，不说「应该修好了」。同一套权重放进真实工程会话会被质疑就让步、只照字面执行、让局部信息压过全局目标、反复调用工具却没有推进。

**解法**：CVM 在模型与真实世界之间建一层认知执行环境：

- **任务契约**：每个任务有独立的 `TaskContract`（目标、范围、约束、成功标准），长会话的目标由运行时持有，不依赖模型「记得」。
- **提交、验证、审查分离的交付**：`deliver_task` 只做归属限定的安全提交（所有权、跨会话冲突、版本一致性不合格就拦下）；验证缺口如实披露但不阻断、也不冒充质量背书；定向验证用 `run_tests`（显式范围），独立审查用 `review_changes` 或 `/review`。
- **确定性监督外环**：75 个运行时 hook 模块分布在一个回合的五个阶段，配合 Sensorium 状态感知与收敛、空转检测，在模型输出与真实动作之间做观测和纠偏。

**上手**：首次启动自动打开 `/connect` 向导（选服务商、粘贴 API Key）。默认权限档是**自动**：低风险直接执行，高风险停下来问你。无头模式：`tianshu -p "…" `、`--stream-json`（NDJSON 事件流，输出内置脱敏）、`--goal "…" --budget 50`（目标驱动自主续跑）。

**常用入口**：`/model` 切换模型、`/permission` 三档权限（supervise / auto / yolo）、`/goal` 跨多轮目标、`/review` 审查、`/rewind` 倒带、`/handoff` 交接、`/cockpit` 驾驶舱、`/debug cache` 缓存诊断、`/usage` 本地 Token 账本、`/domain` 切换星域。

---

## 2. 架构：六层

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 0: Surfaces                                                  │
│  TUI: src/tui/engine/（纯 ANSI，零 React/Ink）· Desktop: desktop/    │
│  （Tauri/React）· VS Code/Cursor 插件 · Headless · Sidecar HTTP/SSE  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1: Agent Loop (src/agent/)                                   │
│  loop.ts → turn orchestration → tool-execution → completion         │
│  RuntimeHookPipeline（5 phases，条件装配 75 个 hook）                │
│  Coordinator / WorkerSession / Plan·Team·Council / DeliveryGate     │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: Context & Cognition (src/context/ + memory/)              │
│  CognitiveLedger · ClaimStore · Stigmergy · PressureMonitor         │
│  TaskContract · Antibody · ProjectMemory · UnifiedMemory            │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: Prompt & Compact (src/prompt/ + compact/ + cache/)        │
│  PromptEngine: static(frozen) + volatile + appendixDelta             │
│  Boundary compaction · CacheAdvisor · Request freezer               │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: Tools & Repo Intel (src/tools/ + repo/ + search/ + lsp/)  │
│  Kernel ≤26 工具 · EXTENDED（office/browser/computer_use）          │
│  Meridian 图 · Physarum · semantic/hybrid search · MCP · LSP        │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 5: API & Model (src/api/ + model/ + auth/)                   │
│  OpenAI-compat · Anthropic · Codex OAuth · FallbackStream           │
│  Provider presets · Capability cards · Adaptive worker routing      │
└─────────────────────────────────────────────────────────────────────┘
```

关键设计决策（直接引自架构总览，值得卡塞尔对照）：

1. **Prefix Cache 是架构级承诺**——不是事后优化；一切注入路径优先 appendix / reminder，避免翻写前缀。
2. **CVM**——hook + AdvisoryBus + CognitiveLedger，让模型看见并修正自身状态。
3. **条件装配 > 固定清单**——hook / 工具 / 星域能力均按 deps 与开关启用。
4. **Immutable + copy-on-write**——尤其 API 客户端变换层，防重入污染缓存 key。
5. **Fail-closed**——未知星域、路径逃逸、高危命令、敏感文件：拒绝并解释。
6. **测试与源码近 1:1**——事故修复必带回归测试。

**Agent Loop 每轮**：preTurn → Perception（流式接收模型输出）→ Tool Execution（每工具后 postTool）→ Compaction 决策（`runCompaction`；历史重写仅在 `turn===0`）→ postTurn → postSession。关键控制器：TurnHarness、EvidenceTracker、DeliveryGate、RepairPipeline（DeepSeek tool-JSON-in-content 修复）、wave-gate（计划分波）、GoalTracker。

**注意**：桌面端（`desktop/`）与部分高级实现不在公开仓（闭源边界），桌面实现细节以 `docs/desktop-guide.md` 为准，未逐行核对源码。

---

## 3. 缓存引擎（核心，重点）

### 3.1 设计原则：前缀缓存优先是架构级承诺

```
System = static.ts（会话内冻结） + volatile（动态区） + appendixDelta（跨回合增量）
```

- **系统提示词 + 工具定义在会话开始时冻结成字节稳定的前缀**，每次请求尽量落在服务商的前缀缓存上。命中率不是性能指标，是直接的账单折扣（v4-flash 命中 ¥0.02/百万 tokens，未命中 ¥1/百万，差 50 倍）。
- **动态上下文只走 appendixDelta**：跨回合增量块，字节稳定；量化在渲染层做。
- **AdvisoryBus 的纠偏注入走 system-reminder，不重写 `frozenBase` / `volatileBlock`**——提醒可以变，前缀不能动。这是整套纪律里最容易被抄错的一点。
- **压缩（历史重写）只发生在用户回合边界**（`turn === 0`），回合内绝不重写历史。
- **API 客户端的 `stream()` 对 request 的变换必须 copy-on-write**，防侧路重入双写污染缓存 key。
- Provider 目录里给 DeepSeek 的备注原文：`Exact-prefix cache: first 2 messages must remain stable for 99% hit rate`——**前两条消息必须保持稳定**，这是 99% 命中率的前提条件。

### 3.2 冻结机制具体怎么工作

核心在 `src/prompt/engine.ts`（PromptEngine，1,809 行）+ `src/prompt/frozen-snapshot.ts` + `src/api/continuation-prefix.ts`：

- **冻结快照 `.frozen.json`**：每个会话落盘一份冻结前缀快照。resume 时读回，经 `inheritFrozenFrom` 喂给新引擎，历史 user 消息恢复原始字节——**在服务商前缀缓存 TTL 内，resume 不再 byte-0 全 miss**（只在新 user 边界断尾）。
- **历史密封（ContinuationPrefixProof）**：每条历史消息带 sha256 哈希（`{hash, role, chars}`），逐条校验；坏文件/旧版本 → 降级为全量重建。
- **frozenBaseHash**：稳定冻结 volatile 块的 sha256。resume 时同 cwd/同配置必须匹配才能复用当前边界字节；不匹配说明配置变了，边界必须重建。
- **frozenUserMerged**：历史 user 消息的冻结合并内容（保前缀稳定），按 key + 索引取用；**回合内 appendix 修订先放在 `frozenPendingMerged`，到下一个 user 边界才合并**——回合内不碰已冻结部分。
- **永不冻结的东西**：已批准计划的指针（slug/title/path）、审批模式（会话中会翻转）等动态项，明确不进冻结区。
- **Read 去重、resume 缓存继承**：重复读文件去重，不让同样的内容以不同字节反复出现；`.frozen.json` 在每个 user 边界 + shutdown 时提交。
- **冻结快照提交不得依赖可被 `invalidateFreshCache()` 清空的守卫**（硬约束，防止快照丢了还以为还在）。

### 3.3 实测数据：5 个真实长会话（2026-08，DeepSeek V4）

来源：`docs/reference/observability-harness.md`，5 个真实工程会话（修 bug、做功能、执行重构计划），采样 2026-08-09 ~ 08-26，每个数字附 `jq` 复算命令。

| 会话 | 任务 | 模型 | 时长 | API 请求 | input tokens | 命中率 | 实际成本 | 无缓存成本 |
|------|------|------|------|---------|-------------|--------|---------|-----------|
| `c9774121` | 接手崩溃会话，执行重构计划 | v4-pro | 4.2 h | 412 | 116.2 M | 99.6% | ¥5.02 | ¥349.52 |
| `506a5e86` | 开源插件化 | v4-flash | 2.7 h | 348 | 89.0 M | 99.6% | ¥2.46 | ¥89.39 |
| `c170a6b1` | CLI 核心链路工程 | v4-flash | 18.9 h | 391 | 138.0 M | 99.6% | ¥3.56 | ¥138.43 |
| `11bf99ff` | 桌面端写文件服务中断根因排查 | v4-flash | 8.3 h | 621 | 259.6 M | 99.3% | ¥7.63 | ¥260.31 |
| `766a0961` | 桌面端卡顿 + 版本显示修复 | v4-flash | 3.4 h | 229 | 42.0 M | 99.5% | ¥1.29 | ¥42.32 |
| **合计** | — | — | **37.4 h** | **2,001** | **644.8 M** | — | **¥19.96** | **¥879.97** |

**主样本解剖（`c9774121`，4.2 小时）**：

- 上下文从 34K 涨到 512K（15 倍），稳态命中率反而从 92–99% 升到 99.7–100%。**上下文变长不摧毁命中率**，这正是前缀缓存工程的核心承诺。
- 15 次子会话（压缩、边界切换都会重置轮次计数）首轮命中率逐段爬升：69.2% → 83.3% → 94.0% → … → 98.3%。会话越往后，服务商缓存里已有的前缀越多，重建只需补增量。
- **15 次前缀重建的总代价只有 383K cacheCreate，占 116.2M 总 input 的 0.33%**。重建便宜，所以敢在边界主动压缩，而不是硬撑一个又臭又长的前缀。
- 首尾两行原始 cache-log 照贴：`turn 0: input 34389, cacheRead 23808, cacheCreate 10581, hitRate 69.2%` → `turn 15: input 510876, cacheRead 510720, cacheCreate 156, hitRate 100.0%`。
- 口径：命中率 = `cacheRead / input`（cache-inclusive），与官方账单口径一致；成本是刊例估算，非账单实扣。

**局限**：样本是 2026-08 的快照；不同任务/模型/时长的命中率会浮动，「稳态 95–99%」是长会话经验区间，冷启动短会话会低。

### 3.4 自适应缓存管理：CacheAdvisor（`src/cache/advisor.ts`）

五个子件协同，每回合结束（`onTurnEnd`）喂一次指标：

| 子件 | 作用 |
|---|---|
| `CacheBehaviorLearner` | 从每轮 cacheRead/cacheCreation/prefixChanged 推断服务商真实缓存行为：`exact-prefix` / `partial` / `unknown`，带置信度 |
| `GhostRegistry` | 记录被逐出的 artifact；之后若又有 `read_section` 读它，记一次 ghost 命中——用来衡量「逐出是不是逐错了」（逐出效率） |
| `AdaptiveThresholdController` | 按最近命中率反馈调阈值（artifact 阈值、错误阈值、陈旧预览字符数），界随上下文窗口缩放 |
| `SessionWarmthTracker` | 会话热度 hot/warm/cold（TTL），预测下轮是否还热；决定是否可 opportunistic compact |
| `RecallMetrics` | 观测被压缩进历史的 artifact 后来有没有被召回（只观测，不反哺阈值） |

**延迟压缩决策（`shouldDelayCompact`，可直接抄的公式）**：

```
protection = hitRate × (1 − pressure)，pressure = estimatedTokens / contextWindow
protection ≥ 0.45 → 延迟压缩（热缓存 + 低压力）
warmth = hot 且 tier ≤ 1 且 pressure < 0.5 → 延迟压缩
tier ≥ 3（reactive/ceiling）→ 永不延迟
压力升高时即使缓存全热也放行（1M 下 OOM 风险 > 重建成本）
```

注释原文的权衡写得很清楚：压缩后整段前缀作废 → miss 成本 ∝ hitRate（被缓存的输入占比）；压缩收益随窗口压力上升。无 pressure 上下文时的 legacy 回退：最近命中率 ≥ 0.8 就延迟；warmth hot 且 tier ≤ 1 也延迟。每一次延迟/放行决定都写进 decision ledger（只观测，不影响决策）。

**阶段乘数**（artifact 逐出阈值随任务阶段变）：explore 1.0、plan 1.5、execute 1.0、verify 2.0、deliver 0.5——验证阶段最舍不得逐出，交付阶段最敢逐出。

**策略自发现**（`getCompactStrategy`）：provider 静态画像说「无缓存」，但行为学习器以 >0.6 置信度观测到缓存 → 按 exact-prefix 走 `cache-preserving`，否则 `balanced`。画像是死的，观测是活的。

**诊断**：`/debug cache` 给命中率、未命中原因分析、每回合缓存历史；`getDiagnostic()` 一次吐出温度、发现的行为、ghost 命中率、当前阈值、自适应策略、最近命中率、召回摘要。

### 3.5 成本感知的压缩策略（`src/compact/compaction-profile.ts`）

两个正交经济轴决定回收下限：

- **计费轴**：按 token 计费的服务商，缓存 miss 重填是真金白银，重写必须回收够多才划算；订阅制只付延迟。
- **缓存轴**：持久 exact-prefix 缓存（DeepSeek/GLM/MiMo）会被任何历史重写摧毁；partial/none 缓存没什么可失去的。

策略档位（按上下文窗口占比）：

| 策略 | 适用 | watch | compact | reactive | ceiling |
|------|------|-------|---------|----------|---------|
| `cache-preserving` | 持久 exact-prefix 缓存（DeepSeek） | 0.72 | 0.86 | 0.92 | 0.95 |
| `balanced` | 其余 | 默认 | 默认 | 默认 | 0.95 |
| `aggressive` | 无缓存 | 0.50 | 0.70 | 0.84 | 0.95 |

**最小回收下限**：一次非强制重写必须至少回收 `minReclaimTokens` / `minReclaimRatio`，否则不值得做——先算账再动手。

**压缩动作梯度**（由轻到重）：`none` → `stale-round`（剪陈旧轮次：先剪工具结果，保留头尾）→ `micro`（堆驱动微压缩，命中即止）→ `partial-llm` → `full-llm`（一次 LLM 摘要）→ `session-split`（会话分裂）→ `checkpoint`。另有 `boundary-archive`（边界归档）、`code-fold`（代码折叠）、`semantic-prune`（语义剪枝）、`staleness-detect`（陈旧检测）等模块。1M 窗口且缓存健康时可延迟压缩。

### 3.6 用量观测：面板设计（可直接抄）

- **`/cache` 面板**（`src/tui/cache-panel-source.ts`）：渲染同步、聚合扫描与官方账单异步——「同步给出当前快照 + 后台补数据 + 数据到位回调重画」，两路数据各自 TTL 缓存（聚合 30 秒、官方 60 秒），避免每帧重扫 cache-log 或重打平台接口。周期三档：今日（本地零点起，不是滚动 24 小时）/ 7 天 / 30 天；最长回看 30 天。
- **官方账单快照**（`src/cache/deepseek-official-usage.ts`）：降级链——① `~/.rivet/deepseek-platform-auth.json` 在 → 平台 summary（今日/本月花费 + 余额）；② 平台不可用但有 DeepSeek API key → `/user/balance` 余额；③ 都没有 → 引导去桌面端登录。TUI 不做网页登录，只消费桌面端持久化的共享凭证；拉取永不抛错，面板拿到的总是可渲染的结果。
- **桌面端路由**（`src/server/cache-routes.ts`）：`GET /cache/usage?days=&scope=&cwd=`，把 usage-aggregator 包一层给跑在 webview 里、读不到 `~/.rivet/sessions/**` 的桌面端；官方 DeepSeek 按当前官方价格和每条请求的北京时间估算。
- **GlanceBar 状态栏**：输入框上方实时显示缓存命中率、上下文占比、本轮成本。
- **`/cockpit` Model 标签**：缓存命中率（input/cacheRead/cacheCreate）、推测解码命中、模型路由轨迹。
- **`/usage`**：本地 Token 账本（`src/token-ledger/`，另有 `forum-sync` 与 token 账本论坛同步）。
- **复算命令**（观测 Harness 文档附）：`jq` 从 `cache-log.jsonl` 直接算总体命中率与成本；`audit-usage-ledgers.ts` 双账本对账（meta.tokenUsage vs cache-log）；`prefix-budget.ts` 前缀预算审计；`analyze-compact-events.ts` 压缩事件审计。

---

## 4. DeepSeek 专属工程（wire 层）

### 4.1 模型 ID：官方名与中转名是两回事（印证 12:22 的 DeepSeek 报告）

`src/api/model-aliases.ts` 的注释写得非常明确：

> 官方 DeepSeek-V4.1-Flash 的实际模型名是 `deepseek-flash`。`deepseek-v4-flash` 仍是中转/方舟（火山引擎）上的独立 id。

别名映射（节选）：`v4-flash` → `deepseek-v4-flash`；`v4.1-flash` / `4.1-flash` / `deepseek-4.1-flash` → `deepseek-flash`；`v4-pro` → `deepseek-v4-pro`。另有 `go-ds4p` / `go-ds4f`、`cc-dsv4` 等网关短名。**结论：模型目录必须按「直连 / 反代」分别映射，不能只存一个 ID**——这与 12:22 DeepSeek 报告「视觉稿里的 `cn:deepseek-v4.1` 不是官方 ID」的结论互相印证。

### 4.2 思考（thinking）

- DeepSeek 的 thinking block：`{type: enabled} + reasoning_effort`；DeepSeek 风格是 thinking block 与 `reasoning_effort` 共存（只对接受两者的服务商）。
- `thinkingStallTimeoutMs`：DeepSeek 120 秒（GLM 420 秒）——服务端长时间不发 token 的失速判定阈值。
- `reasoning_content` 从 `delta.reasoning_content` 取；TUI 实时 thinking 链路：`onThinkingDelta` → `flushThink`（**仅靠 1000ms 定时器节流**）→ `setStreamingThinking`。历史教训：曾用 500 字符二次刷新阈值，导致末段 thinking 永久不刷（卡在 buf=817/lastFlushed=483，delta=334<500），修复是移除 500 阈值。见 `docs/debug-thinking-trace.md`。
- **内联推理标签剥离**（`src/api/inline-reasoning.ts`）：部分 DeepSeek 系中转把推理正文直接内联在 content 里、以 `</think>` 收尾；只认完整标签 `</?think\s*>` 剥掉；**流式增量过滤会扣住「可能是标签开头」的尾巴**，被拆到多个增量里的标签一个字符也漏不出去，代价是尾部最多几字节延迟。注意：它只剥标签、不搬移推理正文（把推理正文改判为 thinking 是另一个产品决策，需要配套的流式扣留策略）。
- 与 12:22 报告的硬坑对照：带 tools 必须原样回传之前所有轮次 `reasoning_content`（缺了就 400）；思考开启时 `tool_choice` 只能 `auto`；思考 token 按输出计费。

### 4.3 DSML 工具调用恢复（接反代时最容易踩的坑）

`src/api/dsml-tool-calls.ts`，有真实线上事故背书（2026-10-06 线上会话，182 条记录中 23 条命中）：

> DeepSeek 系网关/中转会把工具调用以标记文本塞进 content，而不是结构化 `tool_calls` 字段。openai-client 的 JSON 兜底（网 #1）只认 `{`/`[` 开头，于是这些调用蒸发成纯文本 → 本轮零 tool_call → 会话静默结束，用户看到「无缘无故停了」。

中转塞进来的形态（竖线为 U+FF5C 全角，部分网关用半角 `|`，两种都容忍）：

```
<｜DSML｜tool_calls>
  <｜DSML｜invoke name="edit_file">
    <｜DSML｜parameter name="file_path" string="true">lab.py</｜DSML｜parameter>
  </｜DSML｜invoke>
</｜DSML｜tool_calls>
```

恢复规则刻意收紧：只认「tool_calls 开标记 + 至少一个完整 invoke」，避免把模型在正文里复述标记（讨论该格式、贴日志）误判成真实调用；扫描时跳过 Markdown 字面量区段；剥掉标记区后周边散文照常展示。**这是两层网的设计**：网 #1 JSON 兜底 + 网 #2 DSML 恢复。对卡塞尔接 workbuddyapi2 这类反代时，这层恢复直接决定「工具调用会不会无缘无故丢」。

### 4.4 服务商缓存能力矩阵（`src/api/provider-catalog.ts`）

| 服务商 | 前缀缓存 | 备注 |
|---|---|---|
| DeepSeek | exact-prefix（持久） | 前 2 条消息必须稳定；thinking block + reasoning_effort；失速超时 120s |
| Kimi（Moonshot） | 无 | Kimi Code 会员订阅额度；K3/K2.8 有 low/high/max 三档 |
| GLM（智谱） | 隐式 exact-prefix | cached_tokens 在 prompt_tokens_details；1M 上下文；失速超时 420s |
| MiniMax | 无 | 用 `max_completion_tokens`；thinking `{type: adaptive} + reasoning_split` |
| MiMo API | exact-prefix（同 DeepSeek） | 按量计费端点 |
| OpenCode Go | 无 | reasoning 以 reasoning_content 到达，无需参数 |

`prefixCacheStrategy` 三档：`deepseek-native` / `anthropic-cache-control` / `none`。另有 `useMaxCompletionTokens`、`userAgent`、`sessionHeader` 等 wire 级差异配置——**每个服务商的 wire 规则是数据，不是 if-else**，值得卡塞尔的提供商页借鉴。

### 4.5 成本与限流（与 12:22 报告一致）

- 成本模型（`src/api/cost-model.ts`）：按刊例 + 北京时间峰谷估算；`verify-cache-hit-rate.ts` 可实测逐轮命中率（需 `DEEPSEEK_API_KEY`）。
- 官方账单：平台 summary（今日/本月花费 + 余额）+ `/user/balance` 降级链（见 §3.6）。
- 重试可见性注为「dsh 式」：429/503 的退避可持续 10–20 分钟（`maxTotalDurationMs`），要让用户看得见而不是静默卡住。

---

## 5. CVM 认知运行时（验证门与监督）

`docs/reference/cvm-cognitive-runtime.md` + `docs/reference/observability-harness.md` §2.5。理论根因叫 **Cognitive Anchor Collapse**：一个高显著性的局部信号让策略过度集中，全局目标和后续证据失去权重，行为向锚点坍缩。Prompt 是信息不是状态，本身也会变成新锚点，所以靠写更好的提示词治不了——要在概率认知外面加一层确定性监督。

**结构**：内环模型认知（reason → decide → act → observe）+ 外环运行时监督（observe → measure → evaluate → gate → verify → continue / correct / halt）。

| 层 | 机制 | 作用 |
|---|---|---|
| 1 · 信念宪法 | 星域信念块，写入静态提示词 | 零额外推理成本，在分析和建议阶段改变倾向 |
| 2 · Courage Hook | `preTurn` 阶段，阈值随星域变化 | 检测到连续让步时，注入带义务语义的纠偏指令 |
| 3 · Sensorium | 每回合由已有监控信号计算，不调用 LLM | 感知动量、压力、验证覆盖、复杂度、熟悉度、稳定性六个维度 |
| 4 · RuntimeHookPipeline | 75 个 hook 模块，五个阶段，按会话条件装配 | 收敛与 doom-loop 检测、证据追踪、交付门、编辑失败恢复等 |

**实测**（主样本 `c9774121`，`sensorium.jsonl`）：84 次 `cvm-vector-decision`——`gate-blocked` ×63（门禁拦截，如改动未验证就想交付）、`verification-debt` ×21（验证债务：检测到「改了文件 + 交付未验证」并注入纠偏）；219 次 `vitals-lite` 认知体检，doom-loop 等级全程 `none`；36 次 `runtime-hook-health`，最慢的 hook 可归因（`meridian-index` 26 次超慢阈值）。

**交付门（GREEN / YELLOW / RED）**：`deliver_task` 只做归属限定的安全提交（所有权、跨会话冲突、版本一致性不合格就拦下）；验证缺口如实披露但不阻断、也不冒充质量背书。定向验证 `run_tests`（显式范围，空参数只给范围预览），独立审查 `review_changes`（固定快照、只读 reviewer、发现持久化）。**提交不自动验证也不自动派审查**——审查只在用户发起时运行，分三档：L1 轻量（只做审查纪律提醒，不启动审查 worker）、L2 标准（1 个只读审查员，报告代码证据）、L3 Max（5 人只读编队：安全 / 生命周期 / 数据流 / 静默 / 接线）。审查不提交、不改代码、不跑测试；发现保存在本会话里。「代码审查未发现问题」不等于「测试已通过」。

**四类锚点**（诊断模型行为退化用的分类）：词汇锚点（「修复」一词就无视「不要改，只解释」去改代码）、语义锚点（「文件已存在」被当成整个任务的解释中心）、策略锚点（RLHF 先验丢弃高质量判断）、历史锚点（第 20 轮新证据被解释成第 3 轮旧假设的附属）。

---

## 6. 记忆系统（跨会话）

### 6.1 统一记忆（`src/memory/unified-memory.ts`）

- **单一 JSONL 日志**，存项目内 `.rivet/knowledge/memory.jsonl`（**随仓库走、可共享**；旧的 `~/.rivet/memory/<cwd-hash>/` 按 cwd 哈希定位，目录移动/换机即知识孤儿化——这个教训值得卡塞尔直接抄结论）。
- Schema v2（mempalace 时间窗 + 可迁移性）：`validFrom/validTo`（知识失效用封口，不删除）、`supersededBy`（被新条目取代的链式引用，召回只返回当前叶子）、`transferableTo`（适用范围）、`topic`（作用域元数据，供召回预过滤）。
- 记忆类型：fact / decision / constraint / preference / finding / user_constraint / user_preference / file_observation / verification_fact / failure_pattern / security_finding / worker_finding / project_rule 等。
- **自动注入只带约束类记忆；旧问题显式 recall，不劫持新任务**；自动记忆形成为 opt-in（默认关闭）。另有 `deep-recall`、`essence-gate`（精华门）、`observation-extractor`、`session-consolidation`、`memory-scrub`（脱敏）、`recall-efficacy`（召回效能评估）等模块。
- 记忆回填注为「对齐 dsh memory-pipeline」（`src/bootstrap.ts`）。

### 6.2 信息素记忆（Stigmergy）

借鉴生物信息素：agent 的行为足迹（这个文件改过了、那个测试跑过了、这条死路别走了）作为标记落在文件上，带强度和**半衰期**（文件级 7 天），用得多的文件越来越熟，陈旧标记自动消失——不用手工维护记忆文件。

主样本会话结束时 `pheromones.json` 共 42 条：`well-tested` ×28、`fragile` ×7（脆弱易碎，改动要格外小心）、`dead-end` ×2（此路不通）、`entry-point` ×1；另有 4 条 **virtue-signal（美德标记，半衰期 14 天）**——不只记错误，也记美德：`independent-judgment`（置信度充足时选择质疑而非附和）、`proactive-verification`（无人要求时主动跑测试）、`strategic-awareness`（重复操作后觉察并调整策略）、`cache-loyalty`（模型保护了前缀缓存的连续性——「信者，天枢之本也」）。**`cache-loyalty` 这个设计本身就说明：在这套系统里，保护缓存连续性被当成一种值得奖励的行为。**

信息素为**会话内**作用域；跨会话共享知识在项目内 `.rivet/knowledge/memory.jsonl`。

---

## 7. 检索（语义 + 图谱）

- **混合检索**（`src/search/hybrid-search.ts`）：BM25（词法）+ 向量（语义）用 **Reciprocal Rank Fusion（RRF，k=60）** 融合——不用分数归一化（BM25 与余弦分数量纲不可比），只用各自榜单里的名次：`rrf(item) = Σ 1/(k + rank)`。概念查询（"auth middleware" 与 `requireAuth` 无字面重叠）靠向量榜单浮现，精确查询靠 BM25 保精度。
- **切分**：tree-sitter chunk（`chunker-treesitter.ts`）+ `semantic-index` / `vector-index` / `text-index` / `embedding-provider`。
- **Meridian**（`src/repo/meridian-*`）：导入图 / 影响半径——改一个文件，知道会影响哪些文件。
- **Physarum**：文件访问偏好（信息素式路径强化），越走越熟的路径权重越高。
- **LSP 集成**：20+ 种语言服务器，跳转定义与查找引用作为 agent 工具，编辑后的诊断自动回注。本机装了才启用。

## 8. 多智能体编排与目标

| 命令 | 作用 |
|---|---|
| `/scout` | 只读并行侦察 |
| `/team` | 按文件分波并行施工（文件冲突感知调度） |
| `/council` | 多星域会诊，**只出计划**（多席位审查，可选反驳轮） |
| `/galaxy` | 按维度拆分并做全局审查 |
| `/goal <目标> --max N` | 跨多轮自主目标，持续迭代到达成或预算耗尽；输入框上方出现 GoalBar（迭代数 / 目标 / 已耗时 / 预算剩余，暂停 / 继续 / 取消按钮）；`/cancel-goal` 终止 |
| Plan Mode | 调研 → 结构化计划（带 Mermaid 图 + TDD 步骤，存到 `.rivet/plans/`）→ 审批 → 分波执行（wave-gate） |

**多模型委托**：WorkerProfile + WorkOrder → 独立无头会话；按任务类型自适应路由（capable / cheap 等）；批量聚合策略可配；议事会席位有 tierFloor（只抬升不降级）。**星域工具白名单是真实交集过滤器**（worker 工具与域 `toolWhitelist` 求交集）；太一域另通过默认 `toolPreset: "taiyi"` 装配 14 件最小工具档——最小工具集不是玩具（18.9 小时会话照样撑完 138M input）。

**星域**（16 个）：同一模型走进不同星域亮起不同工作倾向——系统提示词（方法论）、工具白名单、决策阈值（`courageThreshold`：破军 0.25 最敢闯、太一 0.95 最审慎、瑶光 0.7 要证据）三样真实改变。新会话默认钉定**启明**，不自动切换；`/domain auto` 才按任务关键词路由。星域不给模型加新能力，也不限制工具（白名单之外），只是把模型本来就有的一面放大。

## 9. 桌面端与 TUI（与卡塞尔对照的重点）

### 9.1 桌面端（Tauri + React，经 `src/server/` 会话池与 SSE）

**三种会话模式**（新建线程后，输入框左下 `+` 菜单首层切换，或 `Shift+Tab` 循环）：

| 模式 | 行为 |
|---|---|
| **Agent**（默认） | 直接读写文件、跑命令、自主完成编码 |
| **Plan** | 只读代码与调研，不写实现；产出带 Mermaid 图 + TDD 步骤的计划文档存到 `.rivet/plans/`，审批后再切回 Agent 执行 |
| **Ask** | 纯问答，不碰文件 |

**招牌特性**：

- **Cockpit 驾驶舱**：8 个 tab，2 秒轮询。Summary（模型、星域、token 用量、累计成本、turn 数）、Safety（doom loop 检测、风险信号、活跃 hook 告警）、Verify（验证状态：改动文件的 RED 闸门、证据门、交付就绪度）、Model（缓存命中率 input/cacheRead/cacheCreate、推测解码命中、模型路由轨迹）、Context（上下文占用、压缩状态、pinned anchors、压力指标）、Trace（本会话事件轨迹）、MCP（服务器与工具：连接状态、工具数、最近错误类）、Advisory（提醒投放统计：渲染 / 丢弃 / 采纳 / 忽略 / 挂起，含逐 key 效能与静音 key）。
- **SideChat 旁路提问**（`Cmd/Ctrl+;`）：不影响主任务的轻量会话；主线程跑长任务时临时问问题，不打断主 agent、不污染主上下文；独立会话，结束后即丢弃。入口很隐蔽（侧栏没有，只有快捷键）。
- **RewindOverlay 时间旅行**：回退到任一历史消息点（Plus 菜单 → 时间旅行，或 `Esc Esc`，或 `/rewind`），三种回退粒度三选一：仅对话 / 仅代码 / 对话 + 代码；代码模式有 per-message 精确预览，确认后才执行；运行中禁用。`/undo` 是轻量版（只撤销最近一次文件改动，`/undo preview N` 可预览第 N 步）。
- **GoalBar 自主目标**：见 §8。
- **个性化**：主题系统与 ThemeStudio、Glass 模式与壁纸、存储位置与清理、额外读写目录（PermissionDirs）。
- **进阶**：Mirror 镜像加速（GFW 用户）、Computer Use（GUI 自动化）、WSL 连接式运行时（Windows）、手机遥控审批、多会话并发、自动更新断点续传 + 来源校验 + 损坏自恢复、本地离线语音输入。

**检查点与回滚**：每回合首次修改前创建 Git 检查点，每次写入前版本化备份（`src/agent/checkpoint.ts`，含 OwnershipGuard 跨会话冲突防护、RollbackPreview、检查点索引）。

**权限与安全**：三档（supervise 每个高风险工具都弹确认 / auto 默认低风险直接执行高风险确认 / yolo 免审批但自动开启沙箱写边界、可回滚）；跳过确认不关闭底层防护：路径边界（拒绝 `..` 穿越）、项目信任门（未授信项目不加载 hooks、项目 MCP、项目记忆与技能）、敏感文件（`.env`、`credentials.*` 禁止读取和提交，落盘密钥 AES-256-GCM 信封）、破坏性命令（`rm -rf`、force push、`DROP`/`TRUNCATE` 需显式确认）、SSRF 防护（逐跳 DNS 解析，拦截私有 IP）。

### 9.2 TUI（自研，纯 ANSI 零依赖）

`src/tui/engine/`，零 React/Ink：GlanceBar 状态栏（缓存命中率、上下文占比、本轮成本）、流式中 `/steer` 打断（SteerBuffer 承接流式中输入）、命令面板、内联图片、受限终端纯文本模式。思考过程实时显示链路见 §4.2（`onThinkingDelta` → 1000ms 节流 flush）。

### 9.3 插件系统

- `plugins/`：hello-world、design、office-docx / office-excel / office-pdf / office-ppt、tianshu-imbridge（示例插件）。
- **MCP**：外部工具服务器以 `mcp__*` 进入同一审批链（`src/mcp/`）。
- **Skills**：可复用的工作流剧本，渐进披露，`tianshu skills` 统一管理。
- 加工具的约定：在 `src/tools/` 实现 `ToolDefinition` 和 executor，到 `src/tools/default-registry.ts` 注册，测试放 `src/tools/__tests__/`。
- **Kernel 工具预算 ≤26**：超出会触发认知过载退化（有 kernel-budget 测试把关）。Kernel 层如 read/write/edit/hash_edit、bash、job、grep/ast_grep/ast_edit、glob、diff、git、run_tests、todo、web_search/fetch、repo_map、plan_submit/close、skill；装配注入层如 delegate_task/batch、team_orchestrate、council_convene、deliver_task、memory/recall、repo_graph、semantic_search、browser_debug；EXTENDED（默认关）如办公套件、browser、computer_use（Pro 门控）。

---

## 10. 对照卡塞尔专员终端：值得借鉴的点（按优先级）

> 对照基准：卡塞尔专员终端视觉稿 v1（build 3bae4da2）+ 12:22 的 DeepSeek 适配报告。排序逻辑：对「DeepSeek 适配 + 缓存省钱 + 顶级体验」这三条主线贡献最大、且改动面可控的在前。

### P0——直接抄，价值最大

**P0-1 冻结前缀 + appendixDelta（命中率的根因，不是调参）**
整套抄：系统提示词与工具定义在会话开始时冻结成字节稳定的前缀；一切动态内容（提醒、纠偏、计划指针、审批模式）只走 appendix 增量块或 system-reminder，**绝不重写已冻结的前缀**；压缩（历史重写）只发生在用户回合边界；resume 时读回 `.frozen.json` 快照继承前缀（sha256 逐条密封校验，坏了就全量重建）。前两条消息必须保持稳定。卡塞尔现在是视觉稿阶段，正是把这条做进引擎设计的最便宜时机——等接了真模型再补就晚了。

**P0-2 CacheAdvisor 自适应延迟压缩（可直接落为公式）**
`protection = hitRate × (1 − pressure)`，`pressure = estimatedTokens / contextWindow`；`protection ≥ 0.45` 时延迟压缩；缓存热 + 压力低不压；压力高放行（1M 下 OOM 风险 > 重建成本）；tier ≥ 3 永不延迟。另配 ghost 注册表（被逐出的东西后来又被读到 = 逐错了，调阈值）与行为学习器（画像说无缓存、实测有缓存 → 按有缓存走）。这比「固定 80% 触发压缩」聪明得多，是 99% 命中率能长期维持的调节器。

**P0-3 成本感知的压缩策略档位**
按「计费（per-token / 订阅）× 缓存（exact-prefix / partial / none）」选策略；DeepSeek 用 `cache-preserving` 档（watch 0.72 / compact 0.86 / reactive 0.92 / ceiling 0.95，占上下文窗口比例）；一次非强制重写必须满足最小回收量（`minReclaimTokens` / `minReclaimRatio`）才值得做。压缩动作分梯度：陈旧轮次剪枝 → 微压缩 → 部分 LLM 摘要 → 全量 LLM 摘要 → 会话分裂。

**P0-4 用量 / 缓存面板（照着抄布局）**
- `/cache` 面板：今日（本地零点起）/ 7 天 / 30 天三档；命中率 + 缓存节省金额 + 峰谷拆分；同步快照 + 异步补数据（聚合 30 秒 TTL、官方 60 秒 TTL），避免每帧重扫日志。
- 官方账单降级链：平台 summary（今日/本月花费 + 余额）→ `/user/balance` 余额 → 引导去桌面端登录；拉取永不抛错。
- 桌面端经 sidecar 路由 `GET /cache/usage` 取数（webview 读不到会话目录）。
- GlanceBar 常驻命中率 + 上下文占比 + 本轮成本；`/debug cache` 诊断命中率与碎裂原因；`/cockpit` Model 标签看 input/cacheRead/cacheCreate 与模型路由轨迹。
- 与 12:22 报告 §8 的 P0 清单（用量面板缓存命中率 + 节省金额 + 峰谷拆分）完全对齐，可直接合并排开发。

**P0-5 DSML 工具调用恢复（接反代时的保命网）**
DeepSeek 系网关/中转会把 tool_calls 以 `<｜DSML｜tool_calls>` 标记文本塞进 content，而不是结构化 `tool_calls` 字段；没有这层恢复，调用会蒸发成纯文本、会话静默结束（真实事故：182 条记录中 23 条命中）。做两层网：网 #1 JSON 兜底 + 网 #2 DSML 标记解析（只认「开标记 + 至少一个完整 invoke」，跳过 Markdown 字面量区）。卡塞尔要接 workbuddyapi2 反代，这层直接决定工具调用丢不丢。

**P0-6 模型 ID 按「直连 / 反代」分别映射**
官方 V4.1-Flash 实际 ID 是 `deepseek-flash`；`deepseek-v4-flash` 是中转/火山引擎上的独立 ID。模型目录不能只存一个 ID，要按接入方式映射（印证 12:22 报告结论）。另：思考是 `{type: enabled} + reasoning_effort`，不是模型名的一部分。

**P0-7 思考过程展示的工程细节**
`reasoning_content` 经 `onThinkingDelta` → 1000ms 定时节流 flush 到 UI（不要加字符数阈值——他们曾因 500 字符阈值导致末段 thinking 永久不刷）；中转内联在 content 里的 `</think>` 标签要剥掉，流式增量要扣住「可能是标签开头」的尾巴防拆分漏网。思考开启时 `tool_choice` 只能 `auto`、带 tools 必须原样回传之前所有轮次 `reasoning_content`（缺了就 400）、思考 token 按输出计费——三条硬坑已在 12:22 报告中，引擎实现时逐条对照。

### P1——价值高，中等工作量

**P1-1 交付门分离（提交 / 验证 / 审查三权分立）**
`deliver_task` 只做安全提交（所有权、跨会话冲突、版本一致性），验证缺口如实披露但不阻断、不冒充质量背书；定向验证 `run_tests`（显式范围）；独立审查 `review_changes`（固定快照、只读 reviewer、发现持久化）。审查**只手动发起**，分三档：L1 轻量提醒、L2 单审查员、L3 五人编队（安全 / 生命周期 / 数据流 / 静默 / 接线）。「审查未发现问题」≠「测试已通过」——这句话值得写进卡塞尔的审查面板。

**P1-2 统一记忆（项目内 JSONL，随仓库走）**
记忆存项目内 `.rivet/knowledge/memory.jsonl`，不是按 cwd 哈希的全局目录（目录移动/换机即知识孤儿化）；Schema 带 `validFrom/validTo`（失效用封口，不删除）、`supersededBy` 链（召回只返回当前叶子）；**只自动注入约束类记忆，旧问题显式 recall，不劫持新任务**；自动记忆形成默认关闭（opt-in）。卡塞尔的诺玛记忆库五层（人物/地点/制度/事件/专员档案）可直接套这套存储与召回纪律。

**P1-3 信息素记忆（不用手工维护的记忆文件）**
文件级行为标记带 7 天半衰期（well-tested / fragile / dead-end / entry-point），用得多的文件越来越熟，陈旧标记自动消失；另有美德标记（14 天）：独立判断、主动验证、策略觉察、**cache-loyalty（保护前缀缓存连续性）**。对卡塞尔来说，这是「记忆库自动长出来」的机制，比让用户手写记忆文件省事得多。

**P1-4 混合检索 RRF + 图谱**
BM25 + 向量用 Reciprocal Rank Fusion（k=60）融合；Meridian 导入图/影响半径（改一个文件知道会影响谁）；LSP 诊断回流（改完自动把诊断喂回模型）。卡塞尔的「学院知识库」MCP 与文件检索可按这个组合做。

**P1-5 检查点与回滚（真后悔药）**
每回合首次修改前 Git 检查点、每次写入前版本化备份；Rewind 三粒度（仅对话 / 仅代码 / 两者）+ per-message 精确预览，确认后才执行；`/undo` 是轻量版（只撤销最近一次文件改动）。卡塞尔已有 Esc-Esc 回退 + 检查点概念，TIANSHU 的「三粒度 + 预览」是更完整的形态。

**P1-6 多智能体编排（与 EVA / ultracode 对照）**
`/scout` 只读并行侦察、`/team` 按文件分波并行施工、`/council` 多域会诊只出计划、`/galaxy` 按维度拆分 + 全局审查；worker 按任务类型自适应路由（capable / cheap）；议事会席位 tierFloor 只抬升不降级。EVA 的并行编排可按这四个原语拆，比现在写死的「3 个智能体」更像 ultracode 的动态编排。

**P1-7 Plan / Ask / Agent 三模式**
输入框左下 Plus 菜单或 `Shift+Tab` 切换；Plan 只调研不写实现，产出带 Mermaid 图 + TDD 步骤的计划文档（存 `.rivet/plans/`），审批后再执行；Ask 纯问答不碰文件。卡塞尔已有真 Plan 模式与 Goal 模式，Ask 模式（只读问答）是补齐项。

### P2——长期 / 锦上添花

**P2-1 CVM 监督外环（轻量版先行）**
75 hook 五阶段流水线 + Sensorium 六维体检（动量/压力/验证覆盖/复杂度/熟悉度/稳定性，不调 LLM）+ doom-loop 检测 + 验证债务拦截。卡塞尔先做轻量版：验证债务（改了文件没跑验证就想交付）、空转检测、交付门三件就够；全量 75 hook 太重。

**P2-2 星域（只借机制，不借包装）**
16 套可切换认知纪律（提示词后缀 / 工具白名单 / 勇气阈值），不是角色扮演皮肤。卡塞尔可借「可切换工作纪律」机制（如严谨模式/快速模式），但北斗七星、碑文、创始记忆这类玄学包装与龙族语境不搭，不要照搬。

**P2-3 Cockpit 驾驶舱**
8 面板运行时仪表（Summary / Safety / Verify / Model / Context / Trace / MCP / Advisory），2 秒轮询。可作为卡塞尔「用量 / 上下文 / 验证」仪表盘的参考形态，平时收起来、诊断时打开。

**P2-4 SideChat**
`Cmd/Ctrl+;` 轻量旁路提问，不打断主任务、不污染主上下文，结束即丢弃。卡塞尔已有 Side chat 概念，TIANSHU 的「结束即丢弃 + 入口只有快捷键」是更克制的形态。

**P2-5 插件与工具预算**
MCP 走同一审批链；Skills 渐进披露；kernel 工具预算 ≤26（防认知过载，超了会退化，有测试把关）。卡塞尔加工具时也应设预算上限，而不是无限加。

**P2-6 TUI 细节**
GlanceBar 常驻状态栏 + 流式中 `/steer` 打断（SteerBuffer 承接流式中输入）。卡塞尔是桌面端，形态不同，但「常驻状态栏 + 流式可打断」两个机制值得借。

---

## 11. 不建议照搬的点

- **星域玄学包装**（北斗七星、碑文、创始记忆、星图叙事）与卡塞尔的龙族语境不搭；只借「可切换工作纪律」机制。
- **CVM 全量 75 hook**——太重，卡塞尔先做轻量版（验证债务、空转检测、交付门）。
- **桌面端闭源部分不在公开仓**（`desktop/` 不在仓库内），桌面实现细节无法直接参考，以桌面端指南为准。
- **它的 TUI 是终端产品**，卡塞尔是桌面端；交互形态不同，只借机制不借形态。
- **16 星域的默认钉定逻辑**（新会话默认启明、不自动切换）与卡塞尔「平时只有诺玛、开关才变 EVA」的二元模式不同，不要混淆。

---

## 12. 未核实 / 注意事项

- 实测数据是 2026-08 的快照（5 个会话、DeepSeek V4），命中率会随任务/模型/时长浮动；冷启动短会话会低。「稳态 95–99%」是长会话经验区间。
- 成本是刊例估算，非账单实扣；不含优惠、赠送额度与阶梯价；当前 DeepSeek 已采用分时价格，新会话成本估算以官方价格文档为准。
- 桌面端实现不在公开仓，桌面相关细节以桌面端指南为准，未逐行核对源码。
- dsh 与 TIANSHU 的关系：代码中两处提到 dsh（重试可见性「dsh 式」、记忆回填「对齐 dsh memory-pipeline」），说明 dsh 是独立项目、TIANSHU 对齐它；`dsh-tianshu-build` 是 dsh 的 fork。dsh 极可能是 DeepSeek Harness 本体，需向用户确认。
- 本报告只做研究，未改任何代码。

---

## 来源

- 仓库：https://github.com/huiliyi37/Tianshu-harness（v3.37.4，commit `2d0b22e0b3554686e1e4131f8bdc568ef768e060`）
- README：`repo/README.md`（缓存实测、星域、能力表、权限与安全）
- 架构总览：`repo/docs/architecture-overview.md`（六层架构、Prompt Engine、关键设计决策）
- 观测 Harness：`repo/docs/reference/observability-harness.md`（5 会话实测、复算命令、数据落点）
- CVM：`repo/docs/reference/cvm-cognitive-runtime.md`
- 桌面端指南：`repo/docs/desktop-guide.md`（Plan/Ask/Agent、Cockpit、SideChat、Rewind、GoalBar）
- 缓存源码：`repo/src/cache/advisor.ts`、`repo/src/cache/billed-hit-rate.ts`、`repo/src/cache/deepseek-official-usage.ts`、`repo/src/cache/types.ts`
- 提示词引擎：`repo/src/prompt/engine.ts`、`repo/src/prompt/frozen-snapshot.ts`、`repo/src/prompt/static.ts`
- 压缩：`repo/src/compact/compaction-profile.ts`、`repo/src/compact/constants.ts`
- DeepSeek wire：`repo/src/api/provider-catalog.ts`、`repo/src/api/model-aliases.ts`、`repo/src/api/dsml-tool-calls.ts`、`repo/src/api/inline-reasoning.ts`、`repo/src/api/continuation-prefix.ts`
- 记忆：`repo/src/memory/unified-memory.ts`；检索：`repo/src/search/hybrid-search.ts`；用量面板：`repo/src/tui/cache-panel-source.ts`、`repo/src/server/cache-routes.ts`
- 思考显示：`repo/docs/debug-thinking-trace.md`
- 对照基准：卡塞尔专员终端视觉稿 v1 + `~/workspace/research_notes/deepseek-api-adaptation-20261112/report.md`（12:22 DeepSeek 适配报告）
