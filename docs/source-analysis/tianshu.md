# Tianshu 源码级分析

源码：`D:\卡塞尔学院\research-src\tianshu`
快照：`main` / `2d0b22e`（`sync: from dev repo (v3.37.4 stable rev45)`）
许可证：Apache-2.0（`package.json` 明示）
规模：仓库 4,599 个受管文件，`src/` 下 3,772 个 `.ts`/`.tsx`，约 65 万行

> **版本边界：** GitHub 公开源码是 `v3.37.4 stable rev45`，本机安装是
> `4.0.4`。本报告是**公开源码 v3.37.4** 的分析；4.0.4 只能结合本机 runtime
> 观察，不能把本报告当成 4.0.4 的源码结论。
>
> 4.0.4 安装包已经实际拆过：`docs/tianshu-4.0.4-拆包研究报告.md`（Tauri 2.12.4 +
> 292MB `rivet-runtime/` + `integrity.json` sha256 校验）。共鸣星域、极限思考、
> XiaoSi Compress2.0、XiaoSi Axiom、spawn-broker 等 4.0 机制以那份拆包报告
> 为准；本报告只覆盖公开源码里能核对的实现。

分析口径：以目录、类型、函数签名、模块头注释与少量测试为证据，不以 README 的功能陈述为准。
凡本文写"已验证"的，都给出了文件路径与函数名；凡未读到的，明确标注为未验证。

---

## 1. 摘要

先说结论：**天枢真正可移植的工程资产是"前缀缓存经济学"，不是它那套星域叙事。**

- 它的核心竞争力是一条闭环：**provider 缓存类型 → 压缩阈值 → 前缀预算 → 会话字节冻结 → 缓存命中率回灌阈值**。这条链在 `src/api/provider-profile.ts`、`src/compact/constants.ts`、`src/compact/compaction-profile.ts`、`src/prompt/prefix-budget.ts`、`src/prompt/engine.ts`、`src/cache/advisor.ts` 六处有真实代码支撑，且互相引用，不是文档口号。
- 第二块资产是**证据门**：`src/agent/delivery-gate-v2.ts` 把"改了哪些文件、这些文件有没有验证、验证是否失效"变成 GREEN/YELLOW/RED 三态；`src/agent/deliver-task.ts` 只负责安全提交，不再假装"提交=验证"。
- 第三块是**权限边界的分层**：`src/agent/approval-risk.ts`（命令风险）× `src/tools/path-grants.ts`（会话级越界授权）× `src/config/project-trust.ts`（项目内容不等于授权）。三者职责不重叠，这一点比它的检测规则本身更值得学。
- DeepSeek 专项做得比通用层更扎实：`exact-prefix + persistent` 被建模成数据而非 if 分支（`provider-profile.ts`），由此派生压缩延迟档（0.72/0.86/0.92/0.95）与 LLM 改写档（0.75/0.85），并额外加了一条"精度天花板"（大窗口 0.70）防止缓存策略把上下文拖过精度悬崖（`src/compact/constants.ts` 的 `precisionCeilingRatio`）。
- 体量与价值严重不匹配：`agent` 1,308 文件 23.6 万行、`tui` 532 文件 9.4 万行、`tools` 501 文件 8.6 万行；而真正决定缓存收益的 `cache` 只有 30 文件 2.1 千行、`compact` 30 文件 4.4 千行。**照搬体量是错的，照搬那 2 千行是对的。**
- 旧报告给出的实测数据（项目自述，不是我们复现）：5 个真实长会话、2,001 次请求、6.45 亿 input tokens，前缀缓存命中率 **99.3–99.6%**，账单 **¥880 → ¥20（省 97.7%）**。数据与拆解见 `docs/research/tianshu-deepseek-20261112/report.md`。
- 必须剔除的四项：16 星域、议会（council）、75 个 hooks 全量、信息素记忆（stigmergy）。它们占比很大，但都不是机制创新，是叙事与策略堆叠（详见 §5.2）。

一句话：**学它的"钱花在哪、前缀怎么不碎、证据怎么闭环"，不学它的"星座怎么命名"。**

---

## 2. 全量模块清点

### 2.1 `src/` 顶层模块总表（39 项，含 `__tests__`）

行数为该目录递归 `.ts`/`.tsx` 行数，**含** `__tests__`。

| 模块 | 文件 / 行数 | 归入分类 | 职责（源码可见） |
|---|---:|---|---|
| `agent` | 1308 / 236,239 | agent | 运行时主体：`loop.ts`(185KB)、`coordinator.ts`、`tool-pipeline.ts`、`turn-orchestrator.ts`、`compaction-controller.ts`、`advisory-bus.ts`、`approval-risk.ts`、`session-persist.ts`、`deliver-task.ts`；子目录 `council/`、`hooks/`(75 文件)、`worker-process/` |
| `api` | 162 / 30,856 | api | provider 适配与 wire 层：`openai-client.ts`(105KB)、`anthropic-client.ts`、`codex-client.ts`、`provider-profile.ts`、`continuation-prefix.ts`、`dsml-tool-calls.ts`、`error-classifier.ts`、`cost-model.ts` |
| `tools` | 501 / 85,705 | tools | 工具实现：`bash.ts`(1,137 行)、`edit.ts`、`apply-patch.ts`、`browser.ts`、`ast-grep.ts`、`path-grants.ts`、`sandbox-profile.ts`；子目录 `net/`、`computer-use/`、`web-fetch/`、`web-search/`、`browser-debug/`、`schedule/` |
| `server` | 381 / 76,013 | server | sidecar/HTTP：`session-manager.ts`(378KB)、`session-routes.ts`、`cron-scheduler.ts`、`cron-lock.ts`、`cron-tick.ts`、`cron-wiring.ts`、`task-registry.ts`、`trust-api.ts`、`session-persistence.ts` |
| `tui` | 532 / 93,685 | UI/desktop | 终端 UI：面板、审批卡渲染、`settings-persist.ts`、`starmap-constellation.ts` |
| `config` | 117 / 24,440 | 支撑（配置/权限） | 配置 schema、`project-trust.ts`、`pro-grant.ts`、路径解析、profile 持久化 |
| `prompt` | 82 / 14,625 | prompt | `engine.ts`(99,082 字节 / 1,668 行)、`volatile.ts`(74KB)、`static.ts`(45KB)、`block-policy.ts`、`prefix-budget.ts`、`frozen-anchors.ts`、`fingerprint.ts`、`frozen-snapshot.ts`、`field-habituation.ts` |
| `context` | 76 / 11,909 | 支撑（上下文） | `compact-policy.ts`、`pressure-monitor.ts`、`rounds.ts`、`claims.ts`、`stigmergy.ts`、`request-budget.ts`、`payload-diagnostic.ts` |
| `repo` | 47 / 7,992 | 支撑（仓库索引） | repo map / 依赖图 / 相关测试推荐 |
| `skills` | 46 / 7,545 | skills | 两级渐进披露技能加载（`skill-loader.ts`） |
| `memory` | 39 / 5,278 | memory | `unified-memory.ts`、`deep-recall`、`session-consolidation`、`memory-scrub`、`recall-efficacy` |
| `mcp` | 35 / 5,946 | mcp | MCP 连接、`policy.ts`（能力声明）、`server-approval.ts`、`workspace-policy.ts` |
| `utils` | 34 / 2,034 | 支撑 | 通用工具、pricing、safe-path |
| `auth` | 34 / 4,074 | 支撑（凭据） | OAuth/凭据作用域（`continuation-prefix` 的 `credentialScope` 依赖它） |
| `cache` | 30 / 2,121 | cache | `advisor.ts`、`usage-aggregator.ts`、`adaptive-threshold.ts`、`ghost-registry.ts`、`session-warmth.ts`、`behavior-learner.ts`、`billed-hit-rate.ts`、`recall-metrics.ts` |
| `compact` | 30 / 4,369 | compact | `compaction-profile.ts`、`constants.ts`(20,937B)、`micro.ts`、`stale-round.ts`、`semantic-prune.ts`、`context-collapse.ts`、`reclaim-estimate.ts`、`boundary-archive.ts`、`code-fold.ts`、`recall-marker.ts` |
| `platform` | 24 / 2,341 | 支撑（OS） | Windows 解码、shell 选择、路径语义 |
| `cli` | 23 / 2,337 | UI/desktop | `project-trust-prompt.ts` 等 CLI 入口 |
| `benchmark` | 22 / 2,309 | 支撑（评测） | `domain-bank.ts` 等 |
| `lsp` | 19 / 4,123 | lsp | `manager.ts`、`rpc.ts`、`typecheck-cache.ts`（跨进程 typecheck 闸门） |
| `workers` | 19 / 2,493 | agent（子代理） | worker 池 |
| `token-ledger` | 18 / 2,568 | token-ledger | `service.ts`、`store.ts`、`forum-sync.ts`（向论坛推送用量快照） |
| `hooks` | 16 / 1,865 | hooks（宿主侧） | `registry.ts`、`hooks-config.ts`、`user-hooks-runner.ts`、`hook-process.ts`、外部 hook RPC |
| `search` | 16 / 1,756 | 支撑（检索） | 语义/词法检索 |
| `plan` | 15 / 2,330 | plan | `plan-store.ts`、`plan-approval.ts`、`plan-fact-anchors.ts`、`completion-evidence.ts`、`plan-close.ts` |
| `plugins` | 14 / 2,707 | plugins | `plugin-loader.ts`、`manifest.ts`、`git-source.ts` |
| `recovery` | 13 / 834 | recovery | 崩溃恢复命令、问题关联、启动输出 |
| `constellation` | 10 / 1,163 | UI/desktop | 里程碑编年史（`schema.ts`/`store.ts`/`format.ts`），纯渲染层 |
| `bootstrap` | 9 / 1,399 | UI/desktop（启动） | 启动装配 |
| `storage` | 9 / 1,055 | 支撑（存储） | `maintenance-gate.ts`、历史保留 |
| `model` | 7 / 417 | 支撑（模型元数据） | 模型清单 |
| `artifact` | 6 / 1,259 | 支撑（内容外置） | ArtifactStore + 摘要 |
| `diagnostics` | 5 / 752 | 支撑（诊断） | 诊断导出 |
| `workflows` | 3 / 815 | workflows | `ecosystem-workflows.ts`(27KB)、`required-tools.ts` |
| `system` | 2 / 307 | 支撑（OS） | `user-idle.ts`（空闲探测） |
| `docs` | 2 / 40 | 支撑 | `doc-status.ts` |
| `failures` | 2 / 59 | 支撑 | 失败分类 |
| `commands` | 1 / 62 | UI/desktop | 命令注册占位 |
| `__tests__` | 52 / 6,391 | 测试 | 顶层跨模块测试 |

### 2.1.1 `src/` 之外的仓库层

上表只覆盖 `src/`。仓库根还有产品级内容，本轮尚未逐文件分析：

| 目录 | 文件数/体量 | 影响 |
|---|---:|---|
| `vscode-extension/` | 87 文件 / 695KB | 独立 VS Code 扩展和 webview UI |
| `plugins/` | 70 文件 | 插件/预设市场与插件样例 |
| `native/` | 2 文件 | `job-launch.c`、`job-hook-supervisor.h`，Windows Job 对象钩子 |
| `website/` | 63 文件 | 官网/文档站 |
| `scripts/` | 228 文件 | 构建、校验、迁移工具 |
| `docs/` | 302 文件 | 使用/架构/参考文档 |

因此本文是“`src/` 内核 + 部分顶层构建”的源码分析；VS Code 扩展、插件市场、native
进程钩子和官网仍未达到全仓逐文件覆盖。

### 2.2 按要求的 18 类归并

| 分类 | 包含 | 一句话判断 |
|---|---|---|
| agent | `agent`(+`agent/council`、`agent/hooks`)、`workers` | 真正的引擎，但顶层就有 505 个文件（含 75 个 hook、11 个 council 模块），经验型模块稀释了核心 |
| cache | `cache` | 小而关键：本项目最值钱的 2 千行 |
| compact | `compact`(+`context/compact-policy.ts`、`context/rounds.ts`) | 第二值钱：压缩经济学 |
| prompt | `prompt`(+`context/payload-diagnostic.ts`) | 第三值钱：字节级前缀控制 |
| api | `api`(+`auth`) | provider 数据化，DeepSeek 专项在这 |
| tools | `tools`(+`artifact`) | 宽度极大，深度集中在 `bash`/`edit`/`browser` |
| server | `server`(+`storage`) | sidecar 宿主，含定时调度与权限路由 |
| memory | `memory`(+`context/claims.ts`、`context/stigmergy.ts`) | 统一 JSONL + 失效封口，思路干净；信息素部分不学 |
| hooks | `hooks`(宿主 RPC 11 文件) + `agent/hooks`(75 文件) | 宿主侧 hook 协议可学；75 个内置 hook 不学 |
| lsp | `lsp` | typecheck 跨进程互斥是实用工程 |
| mcp | `mcp` | 能力声明驱动审批，值得学 |
| skills | `skills` | 两级渐进披露，值得学 |
| plugins | `plugins` | 插件清单/安装/来源校验 |
| workflows | `workflows` | 生态工作流声明，非核心 |
| plan | `plan` | 计划事实锚点 + 完成证据 |
| recovery | `recovery` | 崩溃后恢复入口，小而实用 |
| token-ledger | `token-ledger` | 本地台账 + 论坛同步（同步部分不学） |
| UI/desktop | `tui`、`cli`、`bootstrap`、`constellation`、`commands` | 9 万+行，产品化外壳，不移植 |

---

## 3. 关键调用链

### 3.1 单轮请求：前缀缓存路径（核心链）

```
turn-orchestrator.streamTurn
  -> PromptEngine.buildOaiRequest(messages, toolHistory, window)        src/prompt/engine.ts:551
      -> runResumePreflightOai(...)           修补孤儿 tool_call（不改良态字节）
      -> frozenPendingMerged 提交               边界提交必须先于消息循环
      -> FrozenAnchors.key(msg, occurrences)   (hash:index) 作为历史用户消息锚
      -> renderState.protects/render           FrozenRenderState（已发布字节优先）
      -> volatileBlock 交换（仅新用户边界）     append-only 语义
      -> buildDynamicAppendixParts -> <context-update seq mode="delta">
  -> openai-client 发送
  -> proveWirePrefix(body)                     src/api/continuation-prefix.ts
  -> cache-log.jsonl 落盘                       loop-factory.ts recordTurnCache
  -> CacheAdvisor.onTurnEnd(metrics)           src/cache/advisor.ts:64
```

关键事实（都能在代码里指认）：

- **历史消息必须字节不变**：一旦某条用户消息被渲染过，就存成 `FrozenAnchor{prefix, suffix}`（`src/prompt/frozen-anchors.ts`），后续每轮原样拼回。锚点键是 `sha256(content):occurrenceIndex`，所以用户连发两次"继续"不会互相覆盖。
- **side-path 必须彻底无状态**：压缩摘要、投机请求等走 `{ sidePath: true }`，禁止写 `cachedFreshForUser`、冻结快照、`firstUserKey`、T7 watermark。注释里给了事故编号（2026-07-05 prefix-divergence 探针发现），这是真实踩坑记录：`engine.ts:551-560`。
- **前缀探针**：`consumePrefixDivergence()` 对比本次与上次主请求的逐消息哈希，用来区分"客户端改字节"与"服务端落盘失败"——因为 `cache-log` 只有 token 数，分不出这两种 cacheRead 倒退。
- **T7 折叠水位**：`collapseWatermark` 只在每 50K token 台阶推进（`collapseTokenStep`），滑动边界会让每轮都重写请求字节、永久打碎缓存（`engine.ts:303-312`）。
- **appendix 上限有硬理由**：`appendixMaxChars = min(max(window×5%×4, 2000), 4×12000)`，即 48K 字符封顶（`engine.ts:647-653`）。注释说明旧上限 200K 是 `payload-diagnostic` 大载荷阈值的 16 倍，"每轮重建的 appendix 直接顶在前缀缓存尾部"。

### 3.2 压缩决策与执行

```
pressure-monitor(PressureResult)
  -> decideCompactTier(CompactPolicyInput)            src/context/compact-policy.ts:59
      -> tierForRatio(ratio, profile, recentHitRate, precisionCeiling)
  -> decideCompactAction({...input, profile})         同文件:130+
      -> llmActionRatiosFor(profile)                  per-token+exact-prefix -> 0.75/0.85
  -> CompactionController                              src/agent/compaction-controller.ts
      -> microCompactOai / compactStaleRoundsOai      纯变换（不碰 ArtifactStore）
      -> collectMicroArchiveCandidates -> archive      原文本外置，拿到 index->artifactId
      -> estimateReclaim -> buildReclaimDecision       src/compact/reclaim-estimate.ts
          未达 floor -> 放弃改写，保原字节
      -> buildCompactionSummaryRequest -> 摘要请求（side-path）
      -> commitCompactionHistory -> resetAppendixBaseline()
```

### 3.3 工具审批与权限

```
tool-pipeline.executeTool
  -> requiresUnconditionalApproval(name, input)        src/agent/approval-risk.ts:428
        request_path_access / computer_use.js_eval / browser_adopt / skill_runtime(source)
        -> 任何 allow 规则、sensorium 自动批准都不得豁免
  -> assessToolRisk(name, input, doomLoop, antibodies, sensorium, mcpCapability)
        -> none/low/medium/high + reasons[]（审批卡直接展示）
  -> bash.requiresApproval(params)                     src/tools/bash.ts:1161
        双视图检测：原始命令 + rtk 重写后命令 + normalizeBashCommand 去混淆
  -> 沙箱 wrapSandboxCommand -> 被拒 -> 可选"首触即授"重跑一次（显式声明重复副作用）
  -> server/approval-routes.ts + approval-snapshot.ts  -> 桌面端审批卡
```

### 3.4 交付与证据

```
run_tests / typecheck -> VerificationMetadata（executionId、stale、snapshotRef）
  -> verification-attribution.getEffectiveVerifications
        失效快照丢弃（staleSnapshotDropped / staleFingerprintDropped）
  -> createDeliveryGateV2 -> GREEN / YELLOW / RED + canDeliver
  -> deliver_task（src/agent/deliver-task.ts）
        ownership-scoped commit（scoped-git-commit）+ 敏感路径筛查
        -> recordDeliveryReceipt(真实 SHA -> delivery-receipt.json)
        回执明确写"本次未执行测试或审查"
```

### 3.5 会话持久化与恢复

```
appendOaiWithChecksum(msg, {flush})       src/agent/session-persist.ts:176
  -> appendChecksum(json)                 每行带校验和
  -> SessionBatchWriter.enqueueLine        zstd 帧 + 200ms 批 + 撕裂恢复
  -> transcriptWatermark++                （加载/追加/重写三处都要喂，注释点名过事故）
恢复：loadOai -> 校验和过滤 -> OAI 投影比对 -> 孤儿修复 -> 冻结快照 <id>.frozen.json
```

### 3.6 定时任务

```
CronScheduler.tick -> computeNextTrigger(task, now)     src/server/cron-tick.ts
  -> subscribeTaskDue(prompt, tools, agentId, meta)
  -> TaskRegistry.createTask({source:'cron', unattended, approvalMode, cwd})
  -> RuntimePool.acquire -> AgentLoop(maxTurns + AbortSignal + TurnHeartbeat)
  -> 结果回写 completed/failed/cancelled/timed_out
多进程：CronLock.acquire()，仅 owner 启动 scheduler；锁丢失立即 stop + 写门转 false
```

---

## 4. 功能矩阵（逐节：功能 / 源码证据 / 设计目的 / 可学性 / 优先级）

优先级定义：**P0** 直接影响我们的钱或正确性，尽快做；**P1** 结构性收益，排期做；**P2** 有余力再做；**不学** 明确不做。

### 4.1 DeepSeek 前缀缓存（provider 能力数据化）

**功能**
把"某 provider 的前缀缓存是什么形态"抽象成 5 个值：`exact-prefix` / `explicit-breakpoint` / `partial-prefix` / `block-kv` / `none`，再配 `persistent`、`minCacheTokens`、`cacheGranularity`、`ttlSeconds`。

**源码证据**
- `src/api/provider-profile.ts`：`CacheType` 联合类型；`PROFILES` 表里 `deepseek: {cacheType:'exact-prefix', persistent:true, minCacheTokens:64}`，`openai/codex: partial-prefix, granularity 128, ttl 600`，`anthropic/google: explicit-breakpoint`，`vllm: block-kv`。注释记录了真实事故：`deepseek-spark` 曾漏配，回落到 `none`，压缩档位从 73/87/93% 掉到 51/71/85%，并关闭了持久前缀的延迟保护。
- `src/api/native-continuation.ts`（`NativeCacheAnnotation`、`isValidNativeProof`）、`src/api/continuation-prefix.ts`。
- `src/cache/behavior-learner.ts`：运行时反推——若每次 `prefixChanged` 都 `cacheRead === 0`，判 `exact-prefix`；仅当静态 profile 是 `none` 且发现置信度 >0.6 时才覆盖策略（`advisor.getCompactStrategy()`）。

**设计目的**
同一份压缩/延迟逻辑要服务 10+ provider，**差异必须落在数据表，不落在调用点 if**。这正好对应我们 `deepseek.rs` 现在的做法（provider 元数据驱动），但天枢把维度补全了：不只"是不是 DeepSeek"，还有"缓存持不持久、粒度多少、最小命中多少 token"。

**可学**
是。做法便宜（一张表 + 一个类型），收益直接（阈值不再写死）。

**优先级：P0**。我们 `settings.rs` 的 `ProviderConfig` 增加 `cache_kind`/`persistent`/`min_cache_tokens` 三个字段即可，不动对话循环。

### 4.2 CacheAdvisor：延迟压缩的显式权衡公式

**功能**
在"现在压缩"与"等一轮再压缩"之间做决策，并把每次决策写进只读账本。

**源码证据**（`src/cache/advisor.ts`）

```ts
const pressure = min(1, max(0, estimatedTokens / contextWindow))
const protection = recentHitRate * (1 - pressure)
if (protection >= 0.45) -> delay                                  // reason:'protection'
if (warmth === 'hot' && tier <= 1 && pressure < 0.5) -> delay      // 'warmth-hot'
否则 allow                                                         // 'pressure-allow'
tier >= 3 -> 永不延迟（'reactive-tier'）
```

- `PHASE_MULTIPLIERS = {explore:1.0, plan:1.5, execute:1.0, verify:2.0, deliver:0.5}` 用于 `getArtifactThreshold`。
- `DelayCompactDecision` 带 `event:'compact_delay_decision'`，注释明确 "observe-only, never affects the decision"，且 `emitDelayDecision` 包 try/catch。
- 支撑件：`session-warmth.ts`（hot<60s / warm<ttl(默认1h) / cold；cold 时允许机会性压缩）、`ghost-registry.ts`（被驱逐后又读回来的比例 = 驱逐策略质量）、`adaptive-threshold.ts`（hitRate≥0.8 阈值 +100，<0.3 减 100，近期 ghost 命中≥2 则 +200/+400，且大窗口按 `pruneThresholds.minChars` 缩放上下界，避免 1M 窗口被训成 4K 上限）、`recall-metrics.ts`（召回统计，明确不回灌阈值）。

**设计目的**
把"压缩会毁掉整段前缀 -> miss 成本正比于 hitRate"和"越接近上限越危险"写成一个乘法。`1 - pressure` 那一项就是"余量价值"：压力高时即使缓存全热也放行（注释：1M 下 OOM 风险大于重建成本）。
`shouldDelayCompact` 里还有一段自承的边界：`protection >= 0.45` 在完美命中率下也只能撑到 pressure 约 0.55，所以它管不住 0.60 那种早触发——这条缺陷后来由 `CACHE_PRESERVING_LLM_ACTION_RATIOS (0.75/0.85)` 补上（`context/compact-policy.ts` 注释点名）。**这正是"两个机制各管一件事"的示范。**

**可学 / 不可学**
公式本身可学（3 行）；`ghost-registry` + `adaptive-threshold` 的字符级阈值在 Rust 侧意义不大（我们是字节/字符预算，不做 inline/artifact 分流），**只学公式与"决策账本"**。

**优先级：P1**。前提是 §4.4 的档位先落地，否则没有 `tier` 可延迟。

### 4.3 usage-aggregator：两种命中率，一个不能少

**功能**
扫 `<sessionsRoot>/<sid>/cache-log.jsonl`，按天 × 模型 × provider 聚合 token/成本/节省，并同时给出两个命中率。

**源码证据**（`src/cache/usage-aggregator.ts`）
- `hitRate = 求和 cacheRead / 求和 input` **仅主请求行**——回答"我们自己的回合制缓存效率如何"。
- `billedHitRate = 求和 cacheRead / 求和 input` **所有计费行**（含 `side_path`、`stream_attempt_aborted`）——回答"账单上实际是多少"。
- 注释给出理由：side-path/重试变多而命中率差时，成本上涨但 `hitRate` 不动，**两个数的差就是回归的唯一可见处**；并有 `billed-hit-rate-regression.test.ts` 用同一 fixture 钉住两者等价性。
- `isBilledCacheLogEvent()` 与 `attemptDedupeKey(provider×model×requestId×attemptId)` 被标注为**单一事实源**，审计脚本必须 import，不许自写过滤（注释记录了 2026-10-02 审计脚本自称"同口径"却漏 retry 行的事故）。
- `savings = 求和 cacheRead × (missPrice - hitPrice)`；窗口按文件 mtime 预筛（追加型日志，早于窗口的文件不可能有窗口内行）。

**设计目的**
把"效率指标"和"账单指标"分开，避免用一个数字回答两个问题。

**可学**
是，而且成本极低。我们 `usage.rs` 现在只有 `prompt/completion/cache_hit` 合计，缺 side-path 维度与"两种命中率"。

**优先级：P0**（读侧）。加一个 `side_path` 标记 + 两个比率函数即可，不需要动发送路径。

### 4.4 compaction-profile：billing × cache 两轴

**功能**
给定窗口大小、计费模型、缓存形态，算出"这次改写至少回收多少 token 才值得做"（reclaim floor）。

**源码证据**（`src/compact/compaction-profile.ts`）

| profile | minReclaimTokens | minReclaimRatio |
|---|---|---|
| small/medium + per-token + exact-prefix | `max(8192, floor(window×0.03))` | 0.03 |
| large(>=500K) + per-token + exact-prefix | `max(32768, floor(window×0.05))` | 0.05 |
| subscription 或 cache none/partial | `max(4096, floor(window×0.01))` | 0.01 |

文件头注释把两轴讲清了：`billing` 决定"重建前缀要不要真花钱"，`cache` 决定"改写会不会毁掉前缀"。并明确写了设计边界：floor **不**依赖档位比例，因为它回答的是另一个问题（"这个候选值不值得提交"），而不是"要不要尝试压缩"。
另有两处工程细节值得记：
- `effectiveInputBudget` 第一版直接等于窗口，**不减 max_tokens**，因为"输入窗口 = 总窗口 - 输出预留"这个契约在自家 provider 上未验证；`outputReserveTokens` 留作显式扩展点。
- 聚合器（SiliconFlow 等）profile 默认 `none` 但能力声明 `deepseek-native` 时，按模型族放行 `exact-prefix`，未知族降级 `partial`——"宁可少保护，不保护一个可能不存在的缓存"。

**配套档位**（`src/compact/constants.ts`）

```
STRATEGY_POLICY_RATIOS:
  cache-preserving: watch .72 / compact .86 / reactive .92 / ceiling .95
  balanced:         .60 / .78 / .88 / .95
  aggressive:       .50 / .70 / .84 / .95
adaptiveCompactPolicyRatios: hitRate>=0.85 -> watch +.05, compact +.03, reactive +.02
                             hitRate<0.30  -> watch -.10, compact -.08, reactive -.05
precisionCeilingRatio: >=500K -> 0.70；>=200K -> 0.55；否则 1（不设）
LLM ladder: per-token+exact-prefix -> 0.75/0.85；其它 -> 0.60/0.75
```

两个已被修复的反模式写在注释里，值得直接抄：
1. `Math.min(watch, 500K)` 这种"胶囊上限"会把 1M 窗口的 watch 从 72% 拖到 50%，把"永不早于"语义倒转。
2. `precisionCeiling` 必须是**地板**不能是"兜底分支"，否则 0.70 天花板低于 0.72 watch 时会出现 0.71 压缩、0.75 只看——档位非单调。

**设计目的**
让"省下的钱"和"重建的钱"在同一坐标系里比较；同时用精度天花板兜住"缓存策略把上下文拖过精度悬崖"。

**可学**
是。这是全仓库最值得抄的一个文件（185 行，纯函数，零 IO，注释写着 "never touches the session, never calls an API, never reads process state"）。

**优先级：P0**。

### 4.5 compact 执行层：只替换内容，不拼接消息

**功能**
六级动作：`stale-round` / `micro` / `partial-llm` / `full-llm` / `session-split` / `checkpoint`。

**源码证据**
- `src/compact/semantic-prune.ts` 头注释给出**硬约束**："All pruning replaces message CONTENT in place — never splices messages out. Splicing shifts all subsequent message indices, busting the exact-prefix cache."
- `src/compact/context-collapse.ts`：把 2000 字符 grep 结果压成 "grep 'foo' in src/ -> 14 matches across 8 files"（约 40 倍压缩）。
- `src/compact/reclaim-estimate.ts`：改写候选必须证明回收量达到 floor，否则保留原字节；注释给了事故数字——"只回收 617–1,701 token（甚至让输入变大），却把 20 万 token 热前缀打碎"。
- `src/compact/boundary-archive.ts`：micro/stale 是纯变换，归档由外部注入回调完成；**归档失败的消息不进 map -> 变换保留原文（fail-open 到占内存，绝不 fail-closed 到不可恢复）**。
- `src/compact/micro.ts`：`CACHE_ANCHOR_MESSAGES` 保证头部锚点消息不动；`estimateOaiTokens` 与档位规划共用同一估算器。
- `src/compact/code-fold.ts`：大源码文件折叠成签名骨架（正则 + 花括号深度，不依赖 AST），未知语言回退 head+tail。
- `src/compact/staleness-detect.ts` / `recall-marker.ts`：压缩后的历史仍可通过 `read_section(artifactId)` 召回，召回块在"近场"保留原文、过期后折成一行指针（`foldAgedRecallBlocks`）。

**设计目的**
压缩的唯一目标是"释放 token 而不破坏前缀字节结构"，因此手段被限制在三种：内容替换、外置归档、尾部追加。任何"删一条消息"的做法都被排除。

**可学**
是，但要挑：`semantic-prune` + `context-collapse` + `reclaim-estimate` + `boundary-archive` 是一组（P0/P1）；`code-fold` 是锦上添花（P2，我们若已有 tree-sitter，更该用它而不是正则）。

**优先级：P0（reclaim gate）/ P1（语义压缩）/ P2（code-fold）**。

### 4.6 prefix budget：把"注意力花在哪"量化

**功能**
把冻结前缀拆成 `brake`（护栏）/ `reference`（参考）/ `tools`（工具 schema）/ `appendix`（每轮动态）四类，输出字符/token/占比表。

**源码证据**（`src/prompt/prefix-budget.ts`，114 行）
- `estimateTokens = ceil(text.length / 4)`，注释说明与 `context/rounds.ts`、`payload-diagnostic.ts` 同口径，"中文密集内容会低估，跨块对比时口径一致即可"。
- `totalChars` 明确**排除 appendix**（"appendix 每轮重算，不属于前缀"）。
- `formatBudgetReport` 输出等宽表格，CLI 与 TUI `/prefix-budget` 共用同一口径。
- 分类语义由 `src/prompt/block-policy.ts` 定义，且**只有 reference 类有开关**：`PromptBlockToggles = {seedCapsule, knowledgeManifest, codebaseIndex, projectMemory, historicalLessons}`；brake 类（rules / delivery-contract / workflow / security / 星域 volatileBlock）**没有开关**，注释给的理由是生产观测：V3.1 把胶囊正文撤成按需召回，同日回滚，"护栏起作用的时刻正是 agent 没意识到自己跑偏时，它不会想到去 recall"。
- `FROZEN_BLOCK_CAPS`（projectInstructions 8000 / projectMemory 3000 / knowledgeManifest 2200 / codebaseIndex 4000）住在策略层而非渲染层，lean/full 相对 standard 缩放；默认必须返回与历史逐字节一致的 standard，由 `__tests__/block-policy.test.ts` 钉住。
- `src/prompt/engine-prefix-budget.ts` 把实际渲染路径（同一套按节选取、同一 cap）复用于报告，"否则报告写的收录章节与真实前缀对不上"。

**设计目的**
让"前缀膨胀"可归因：谁占了多少字符，cap 砍掉了百分之几，护栏/参考资料各占多少。没有这张表，任何"精简"都是盲改。

**可学**
是，而且**必须先做**——没有度量就没法验证冻结前缀的收益。

**优先级：P0**（度量）/ P1（block policy 三分法）。

### 4.7 prompt/engine：会话字节的账本

**功能**
把"一次请求的 messages 数组"当成需要长期维护的字节契约：历史不变、尾部追加、边界提交、快照可恢复。

**源码证据**（`src/prompt/engine.ts`，1,668 行 / 99,082 字节）
- **三类状态**：`frozenBase` / `volatileBlock`（冻结的易变块）/ `cachedAppendix`（每轮重算，排在最后）。volatile 只在新用户边界交换（`rebuildFrozenBase` 延迟交换），同一用户消息内的多轮工具调用继续用旧 stable volatileBlock，"exact-prefix 缓存得以保留"。
- **`FrozenRenderState` + `FrozenAnchors`**：`anchorKey = sha256(content):index`；`liveAnchors` 每轮重算；`firstUserKey` 是 byte-0 锚点，**从驱逐中排除**（注释：删了它 -> 首条用户消息会用当前 volatileBlock 重建 -> 0% 命中）。
- **快照导出/继承**：`exportFrozenSnapshot()` / `withFrozenSnapshot()` / `FrozenSnapshotData`（落 `<id>.frozen.json`），`/cd` 与 resume 都靠它"用原样字节重放历史用户消息"。
- **`append-only` delta**：`<context-update seq="N" mode="delta">` 只发变化子块；无变化时发自闭合 `<context-update seq="N"/>`（`engine.ts:1496-1513`）。历史重写/压缩后必须 `resetAppendixBaseline()` 强制下一次发全量。
- **`PromptEngineConfig.prefixCache`** 注释："'deepseek-native' enables immediate promotion of session-constant fields (star-domain) to skip habituation warm-up"——即 DeepSeek 下会话常量直接进冻结区，不等习惯化。
- **`assertPublishedSourceHistory` / `proveRewindHistory` / `ContinuationPrefixError`**：发送前必须证明"已发布历史"未被改动，否则拒发（见 §4.12）。
- 单测面（`src/prompt/__tests__/`，47 个文件）本身就是规格书：`engine-cache-stability.test.ts`、`prefix-divergence.test.ts`、`frozen-lifecycle.test.ts`、`volatile-cache.test.ts`、`goal-anchor-cache-safety.test.ts`、`skill-cache-safety.test.ts`、`published-render.test.ts`。文件名即不变量清单。

**设计目的**
把"prompt 拼接"从字符串操作升级为**有版本、有校验、可回放的字节账本**。代价是复杂度（1,668 行），收益是 95–99% 命中率在长会话里不衰减。

**可学**
核心三件事可学：① 历史锚点（内容哈希 + 出现序号）；② 边界提交（只在真用户消息处提交 pending）；③ appendix 尾部 delta。**整套 1,668 行不要照搬**——其中大量分支是"星域 / 计划 / 技能 / CVM / companion"等本项目特有的注入源。

**优先级：P0（锚点 + 边界提交 + delta）/ P1（快照落盘与继承）**。

---

### 4.8 approval-risk：风险是分维度的，不是一档

**功能**
把"要不要问用户"拆成四张正交表 + 一个分级器。

**源码证据**（`src/agent/approval-risk.ts`，725 行）
- `DANGEROUS_BASH_PATTERNS`：破坏数据（rm -rf / Remove-Item -Recurse / del /s / find -delete / shred / truncate table / git reset --hard / git clean / force-push 三种等价形态 / 下载即执行 curl|sh 与 iwr|iex / 全局安装）。
- `AVAILABILITY_HAZARD_PATTERNS`：**不破坏数据但夺走操作者控制权**（P/Invoke user32、SetCursorPos、SendInput、pyautogui、osascript keystroke、CGEventPost、xdotool）。注释明确"威胁模型与'破坏数据'是两回事，决策理由必须不同（是否允许它占用我的键鼠）"。
- `INPUT_SYNTHESIS_PATTERNS` / `FOREGROUND_ONLY_HAZARD_PATTERNS`：把上面的表再切出一个子集，用于"执行期让出监控"——因为合成键鼠会重置系统 idle 计时器，监控会把正在干活的命令误杀（注释给了实测数字：idle 216020->219715ms 基线，一次 CGEventPost 后立刻读到 67ms）。这两张表是**子集关系，由守卫测试钉住**。
- `SAFE_WRITE_PATTERNS` / `RISKY_WRITE_PATTERNS`：低风险写命令可在无沙箱环境自动放行，但**必须叠加 `hasOutOfWorkspaceWriteTarget`**（目标在 cwd 外仍回人工）。
- `requiresUnconditionalApproval()`：`request_path_access`、`computer_use.js_eval / browser_adopt`、`skill_runtime(prepare, buildPolicy:source)` 永远需要审批，连 allow 规则也不能豁免；只有 yolo 档可跳，且注释说明 yolo 的安全网是 checkpoint + rollback，不是 prompt。
- `assessToolRisk()`：`none/low/medium/high` + `reasons[]`，path traversal（绝对路径或 `..`）单独提级，`CONFIDENCE_THRESHOLDS = {autoApproveConfidence: 0.8, escalateConfidence: 0.3}`。
- `normalizeBashCommand` + `testBoth(pattern, cmd)`：**双视图检测**用于对抗 `${IFS}`、续行、字符转义、`git "a"dd` 这类"语义不变但文本认不出"的混淆。这个设计有明确事故来源（PR #410/#467/#494 的注释）。

**设计目的**
审批疲劳与安全是同一枚硬币：问太多用户会盲点"批准"，问太少会静默破坏。分维度建表 = 每个维度只问该维度的问题，并在审批卡上给出可读理由。

**可学**
是。我们 `engine/policy.rs` 现在只有 `destructive_command` / `catastrophic_command` 两张小表，缺：可用性危害维度、归一化双视图、无条件审批层、外部写目标叠加判断。

**优先级：P0（双视图 + 外部写目标）/ P1（可用性危害维度）**。

### 4.9 action-intent-detector：宣布了行动却没发工具调用

**功能**
检测"模型说'接下来我会改 X'但本轮没有任何工具调用（或只调了只读工具）"，用于注入一次提醒或延长回合。

**源码证据**（`src/agent/action-intent-detector.ts`，383 行）
- 三张动词表分离：`WRITE_VERB_STEMS`（写侧）/ `IMPERATIVE_EXTRA`（句首祈使）/ `TOOL_VERB_STEMS`（工具轮），注释说明三处原本各写一份，实测抓到漂移（"部署/构建/安装"只在祈使表，导致同一句"接下来部署到 staging"两条闸门结果相反），后收敛为单一来源。
- 名词性豁免靠正则负向前瞻：`更新(?!说明|日志|记录|内容|公告|历史|列表|详情|检查)`；`提交` 用前后文双向判别（`(?<![近史前轮本已的录笔次码该首每笔条这那])提交(?!记录|日志|...)`），注释给了误报现场（"现在读核心文档…最近提交又提到 3.15.0"被判写侧承诺）。
- `TOPIC_STATEMENT_RE`：句首动词接名词化后缀或"…的 + 抽象中心语"时判为陈述句，注释说明按"距离 8 字符内有『的』"判断会把"更新配置的默认值"这类真祈使句全部吞掉，所以改看中心语白名单。
- 消费方：`turn-orchestrator.ts` 的 `hasActionIntent` / `hasWriteActionIntent` + `turnUsedOnlyReadTools`。

**设计目的**
解决"会话静默结束"这个真实失败模式：模型宣布了动作、文字上像完成任务，但没有实际调用工具。

**可学 / 不可学**
机制值得学（"承诺词 + 写侧动词 + 无写工具"三条件），**但这套中文正则的调参过程不该复制**——它是逐案修补的产物，注释里能数出十几个 case 编号。我们更该做的是：协议层强制"声明动作必须伴随 tool_call"，而不是事后猜文本。

**优先级：P2**（先用硬约束，再考虑文本兜底）。

### 4.10 advisory-bus：把纠偏信号做成可核销的投递

**功能**
把五条独立纠偏通道（免疫投射、修复提示、错误笔记本、重复输出、死路信号）收敛成一个总线，并追踪"这条建议被采纳了吗"。

**源码证据**（`src/agent/advisory-bus.ts`，1,183 行）
- `AdvisoryEntry{key, priority, category, content, tier, ttl, expect?, immediate?, observe?, corroborates?, channel?, srClass?}`。
- `tier`：`constitutional`（`CONSTITUTIONAL_PRIORITY = 0.9`，**永不被截断**）/ `operational` / `informational`；每轮 `MAX_ADVISORIES_PER_TURN = 3`，每 category 最多 2 条。
- `AdvisoryExpectation`：`tool_appears` / `pattern_absent` / `withinTurns`——**每条提醒携带可观测的行为签名**，`postTurn` 由 `advisory-readback-hook` 核销为 adopted/ignored。
- 反习惯化：`HABITUATION_ESCALATE_STREAK=2`、`SILENCE_STREAK=3`、`SILENCE_RENDERS=4`；`holdout` 反事实抽样（`DEFAULT_HOLDOUT_RATE=0.1`）把"赢了渲染位但被静默扣留"的条目记入 shadow 桶。
- 三条通道：`bus`（附录块）/ `system-reminder`（追加到消息尾部，不重写历史）/ `status`（只进 TUI）；无 status sink 时回退 bus，"宁可占预算不静默消失"。

**设计目的**
提醒系统的真正问题是**噪音与失效**：说太多会被习惯化，说太少会漏。解法是给它账本（送达/采纳/shadow）、生命周期（observe -> 自愈撤销 -> 到期送达）和预算（每轮 3 条、每类 2 条）。

**可学 / 不可学**
**账本思路 P1 可学**（尤其"每条提醒带 expect 谓词"这一条）；**不建议学**它的规模——1,183 行 + 75 个 hook + 星域措辞适配器，维护成本远超收益。我们只需要：一个提醒队列 + 去重键 + 冷却 + "采纳判定"四件事。

**优先级：P2**。

### 4.11 dsml-tool-calls：网关把工具调用塞进正文时的恢复

**功能**
从 assistant 正文里解析 `<｜DSML｜tool_calls>` 文本形态，还原成结构化 tool_use。

**源码证据**（`src/api/dsml-tool-calls.ts`，112 行）
- 命中条件刻意收紧：**必须有 `tool_calls` 开标记 + 至少一个完整 `invoke`**，避免把"模型在正文里讨论该格式/贴日志"误判为真实调用。
- 容忍全角 `｜`(U+FF5C) 与半角 `|` 两种竖线。
- `markdownLiteralRanges()`：跳过代码块（``` / ~~~）、缩进块、引用块、行内 code，**只在非字面量区扫描协议信封**，且删除时按原偏移切片，"不因一处标记丢失整段散文"。
- 返回 `null` 表示未命中，调用方保持原文不变（不改字节 -> 不破坏缓存）。

**设计目的**
真实线上事故：DeepSeek 系网关把工具调用写成文本，`openai-client` 的 JSON 兜底只认 `{`/`[` 开头，于是这些调用"蒸发成纯文本 -> 本轮零 tool_call -> 会话静默结束"。注释给了样本量：182 条记录中 23 条命中。

**可学**
是，且我们有对应位置（`dsml.rs`，21KB，已经在做同类事）。值得补的是两个细节：**Markdown 字面量跳过**、**删除时保留周边散文**。

**优先级：P1**。

### 4.12 continuation-prefix：发送前的字节证据

**功能**
为每次请求生成"前缀证明"：逐消息哈希 + `toolsHash` + `optionsHash` + `provider/model/endpointHash`，并在下次发送前断言未变。

**源码证据**（`src/api/continuation-prefix.ts`，199 行）
- `ContinuationPrefixProof{version, cacheGenerationId, credentialScope, provider, model, requestId, endpointHash, optionsHash, toolsHash, messages:[{hash,chars,role}], canonicalSource?, nativeTail?, nativeCacheLayout?}`。
- `proveWirePrefix(body, provider, requestId, endpoint)`：对**最终传输体**（所有发送时变换之后）哈希，"No content or headers"。
- `assertContinuationPrefix(previous, next)`：provider/model/endpoint 变 -> `'binding'`；toolsHash 变 -> `'tools'`；逐消息首个不同下标 -> 该下标；optionsHash 变 -> `'options'`；任一命中即抛 `ContinuationPrefixError`，**请求不发送**。
- `isCompleteExecutionSnapshot()`：`version===2` 且 `hash(options) === optionsHash` 且 `isValidNativeProof`，缺一项即视为不完整快照（防止用残缺证据"恢复连续性"）。
- `wireOptions()` 覆盖 `thinking / reasoning_effort / tool_choice / temperature / max_tokens / service_tier ...` 以及所有未知字段的哈希（`extraFields`）——**任何影响输出的字段变动都会让证据失效**。

**设计目的**
把"前缀缓存命中"从"祈祷 provider 复用"变成"本地可证明"：缓存 miss 时能立刻区分是 binding 变、tools 变还是某条消息变。

**可学 / 不可学**
证据结构（P1）可学，尤其在多 provider、多 endpoint、中转站的现实里。**不要学 `version 1|2` 双版本兼容 + `recoverLegacyPreflightSource` 这类历史包袱**——那是它自己演进欠下的债。

**优先级：P1**。

### 4.13 tools/bash：一个工具里的六个子系统

**功能**
执行 shell，但同时承担：结果分级、沙箱包装、让出监控、长跑后台化、验证复用、脚本事务、输出外置、非零码语义。

**源码证据**（`src/tools/bash.ts`，1,137 行）
- `isExecFailure(exitCode)`：只把 127（未找到）/126（不可执行）/>128（被信号杀）判为真 error；grep=1、diff=1、测试非零、lint 非零都是**正常语义结果**。注释解释：一律打成 isError 会让 immune/dead-end/doom-loop 放大成 error 风暴，把模型推入退化态。
- `BoundedRawSpool`（8MB 上限、head-retaining）：模型预览截断到 24KB 尾，但**持久化不得用同一个截断缓冲**——旧实现把头部静默丢了还声称"完整输出在 rawPath"。
- `SUCCESS_INLINE_LINES = 20`：成功且不超过 20 行全量返回，否则只回头部摘要 + artifact 引用。
- `maybeYieldForUserActivity()`：命中可用性危害签名且用户刚操作过键鼠 -> 不执行；"用户刚点过批准"不算"正在用本机"。
- 沙箱拒绝后的 learn/skip 档"首触即授"重跑**一次**，并在结果里显式声明"首次执行在被拒前产生的副作用可能已重复发生"（非幂等副作用不隐瞒）。
- `requiresApproval()` 检查**双视图**：`rawCommand` + `rtkRewrite()` 展开后的命令（"rtkRewrite may expand aliases/macros into dangerous commands that the raw form does not match"）。
- `write_files` 显式文件事务（1–50 个仓内文件，前台且 timeout<=120s），失败后**仅在进程停止 + claim + 版本均匹配时恢复**。

**设计目的**
bash 是最大的风险面与最大的噪音源。它把"正确性（退出码语义）""可恢复性（spool/artifact）""人身安全（让出）""授权（双视图）"拆成独立关注点，各自可控。

**可学**
是，但按块学：`isExecFailure` 语义（P0，容易做错且影响大）、`BoundedRawSpool` 头部保留（P0）、双视图检测（P0）、让出监控（P2，取决于我们是否有 GUI 输入注入面）。

**优先级：P0（前三项）**。

### 4.14 tools/browser：新攻击面的默认拒绝

**功能**
无头浏览器验证（截图/取文本/点击），但把安全做到"每请求"粒度。

**源码证据**（`src/tools/browser.ts`，288 行）
- `requiresApproval: () => true` —— **强制**，每个动作都过审批。
- allowlist **空 = 全拒**（fail-closed），默认来自 `RIVET_BROWSER_ALLOWLIST`。
- **逐请求拦截**：`driver.route('**/*', createBrowserRequestGuard(...))` 必须在 `goto` 之前挂上，覆盖主文档 + 重定向 + iframe + 子资源。注释给出事故编号 #213：只校验初始 URL 会被 302 / `<iframe>` / 页面内 `fetch()` 打穿到 `127.0.0.1` 或云元数据服务。
- **指名信任 vs 继承信任**：`isHostExplicitlyListed`（精确匹配）跳过私网预检——本地/内网模型服务（`127.0.0.1:11434`、`192.168.x.x`）是正当目标；后缀匹配的子域是"继承的信任"，仍做 `resolveAndAssertPublic` 私网预检。
- scheme 白名单：仅 http/https；`data:/blob:/about:` 视为无网络请求放行；其余阻断。
- 驱动未提供 `route` -> 直接拒绝（"无法拦截重定向/iframe/子资源的内网访问"）。
- Playwright **惰性加载** + 可注入 `driverFactory`，因此安全逻辑可用假驱动单测。

**设计目的**
浏览器是"任意 URL + 任意 DOM"的双重不可控面。解法不是加提示词，而是：每条子请求都重新判、信任分两级、驱动能力缺失即拒绝。

**可学**
是，尤其"逐请求拦截"和"指名信任/继承信任"两级。我们 `browser.rs`（16KB）需要核对是否只校验了初始 URL。

**优先级：P0（若开放浏览器能力）/ P2（若仅本地调试）**。

### 4.15 memory/unified-memory：失效不删除

**功能**
单一 JSONL 承载跨会话观察/决策/约束，带时间窗、取代链、可迁移范围。

**源码证据**（`src/memory/unified-memory.ts`，588 行）
- 存储位置从 `~/.rivet/memory/<cwd-hash>/` **迁到项目内** `.rivet/knowledge/memory.jsonl`，理由写明："目录移动/换机即知识孤儿化"；旧目录保留为只读兼容层（dual-read）。
- Schema v2：`validFrom/validTo`（封口而非删除）、`supersededBy`（召回只返回当前叶子）、`transferableTo`（"回答不了'可迁移到哪'的知识不配准入"）、`topic`（召回预过滤）。
- `appendMemoryEntry()` **写入前 scrub**：`scrubMemoryText` 返回 `null` 表示"整条几乎只剩敏感片段" -> 整条丢弃（fail-closed 不落盘）；`evidence` 同理但只丢字段本身。注释点名上游三个调用方都不 scrub。
- `supersedeMemoryEntry()`：旧条目标 `validTo + supersededBy + status='expired'`，**不删除**（"知识失效是迭代，不是遗忘"）。
- `pruneMemoryStore()`：只移除"已封口且距封口超过 retentionDays"的历史，current 条目与取代链叶子永不删；并压缩到 `maxFileBytes`。
- 写入走 `project-memory-writer` 的锁协议，且受 `projectStateAllowed(cwd)` 门控（未授信项目不注入）。

**设计目的**
记忆系统的两个失败模式是"污染"（敏感信息落盘 -> 回灌 prompt）与"僵化"（旧结论永远正确）。它用 scrub 防前者、用封口链防后者。

**可学**
是。`supersededBy` 链 + `validTo` 封口 + 写入前 scrub 三点都是低成本高收益。

**优先级：P1**。不建议学它的 kind 枚举（20+ 种，含 dream/essence-gate 等本项目特有来源）。

### 4.16 server/cron-*：定时任务的三个真实坑

**功能**
持久化定时/事件触发任务，串到 TaskRegistry -> RuntimePool -> AgentLoop。

**源码证据**
- `src/server/cron-tick.ts`（`computeNextTrigger`）：cron 的基准是 `lastTriggeredAt ?? createdAt`，**不是 `now`**。注释给出原因："next 是基于 now 算的话 `next <= now` 永远不成立，cron 任务从不触发"。`oneshot` 过期返回 `now`（"补跑一次"）；事件触发类型一律返回 `null`（不参与 tick）。
- 日匹配规则实现标准语义：dom 与 dow 同时受限时**任一匹配即触发**；dow 接受 0–7，7 视同 0。
- `src/server/cron-scheduler.ts`：原子写（tmp+rename）持久化 `.rivet/scheduled_tasks.json`；`CronSchedulerWriteGate` + `SchedulerWriteDeniedError`——锁丢失后写门立即转 false。
- `src/server/cron-wiring.ts`：锁丢失 -> `scheduler.stop()` + `stopEventTriggers()`（"避免 watcher 回调把异常抛进事件循环"）；`unattended` 由 `reviewPolicy × triggerCount` 决定（`FIRST_RUNS_TRUST_THRESHOLD = 3`：前 3 次人工审批）；空数组 `allowedTools` 保留"空=无工具"与 `undefined=默认全量"的区别。

**设计目的**
调度器最容易在"时间基准""多进程重复执行""无人值守审批"三处出错，这三处它都有显式处理。

**可学**
是。我们 `goal.rs` 已有轮次预算与停滞检测，但没有墙钟调度；若要做"定时目标"，这三条坑值得直接照抄。

**优先级：P2**（当前不是我们的主路径）。

### 4.17 path grants + project trust：两层边界

**功能**
- `path-grants`：会话级"越界授权"，把 workspace-only 边界临时放宽到某个目录子树。
- `project-trust`：仓库内容（含 `.rivet/hooks.json`、`.rivet-config.json`）**不能自己给自己授权**。

**源码证据**
- `src/tools/path-grants.ts`
  - `PathGrant{root, mode:'read'|'write', grantedAt, persisted?, scope?}`；`write` 蕴含 `read`。
  - **`scope` 字段**：sidecar 一个进程托管多会话，未加 scope 的交互授权会在 workspace A 批准后静默授权 workspace B。这是修过的真实漏洞（注释把契约写在文件头："a grant for project A must not leak into project B"）。
  - 双向 symlink 归一化后再做包含判断（`canonicalize` 走到最近存在的祖先再 realpath 拼回尾部），防止通过符号链接子目录逃出。
  - 默认注入的 scope-less grant 只有三类：配置里的 `additionalDirs`、依赖缓存读授权、rivet 运行时目录——"user- or tool-level by design"。
- `src/config/project-trust.ts`
  - 授信状态存 `<rivetHome>/project-trust.json`，按 `realpath` 键控，**永不写进仓库目录**。
  - `RIVET_TRUST_PROJECT` 环境变量优先级高于信任文件（`'1'` 授信 / `'0'` 强制未授信，用于 CI 与审计）。
  - 未授信时：项目 hooks 不执行；`stripUntrustedProjectKeys` 剥离安全敏感键；`projectSurfaceAllowed(cwd, surface)` 逐面（skills/rules/commands/playbook/presence/agents/plans/capsules）判定。
  - 缺文件/坏文件 -> 按未授信处理（fail-closed）。

**设计目的**
把"能写哪里"（能力）与"谁说了算"（授权来源）分开：capability 可以临时放宽，但授权必须来自人，不能来自被读取的内容。

**可学**
是，这是安全模型里最常被忽略的一层——**别让仓库里的文件给自己开权限**。

**优先级：P0（project trust 概念）/ P1（path grants + scope）**。

### 4.18 delivery gate + checkpoint：证据与可回退

**功能**
- `DeliveryGateV2`：三态交付门。
- `checkpoint`：git 层面的可回退点 + 诚实告知不可回退的副作用。

**源码证据**
- `src/agent/delivery-gate-v2.ts`（35KB）
  - `GREEN`（owned files verified）/ `YELLOW`（external blockers，但 owned verified，可带条件交付）/ `RED`（owned failures 或 unverified owned）。
  - 丢弃计数按病因分开：`staleSnapshotDropped`（snapshotRef 过期）vs `staleFingerprintDropped`（工作区指纹变化），并解释两类病因："① 仓内再编辑（良性多数）；② 指纹不可计算（敏感路径/非 git 工作区/越界 owned 路径）"。
  - `outOfRootFingerprintPaths`：越界路径清单，让 `deliver_task` 能输出"越界 -> 旧台账指纹不可计算 -> 移入仓内重跑验证"的**可行动指引**，而不是 "no tests were run" 的误导。
  - `filterExternalNoise()`：`.test-tmp/`、`node_modules/`、dist 等噪音目录 + `git check-ignore --stdin` 批量过滤，"67 个未跟踪 .test-tmp 文件淹没 GREEN/YELLOW 信号"是它的起因。
- `src/agent/delivery-gate.ts`（2.3KB，旧版）：`buildDeliveryGate(state)` 更朴素，`modified.length===0` 直接 verified。
- `src/agent/deliver-task.ts`（B1-8）：契约分离——"本工具收敛为纯安全提交……不再执行验证、不再触发审查、不再物化候选快照"。成功回执明确写"本次未执行测试或审查"。
- `src/agent/checkpoint.ts`（20KB）
  - `CheckpointData{version:2, hash, preExistingDirtyFiles, preExistingUntrackedFiles, agentTouchedFiles, unrevertableEffects?, confirmationToken?}`。
  - **`unrevertableEffects`**：把 bash 里不可回退的副作用（API 调用、DB 写、publish、push、基础设施变更）记进检查点，回滚预览里如实说明"文件回滚不能撤销这些"。这是"诚实"落到数据结构的典范。
  - `OwnershipGuard`：并行会话同分支时，别人独占的文件既不算我的、也不被我回滚（`isOwnedByOther`），并先 `reapStaleClaims()` 免得崩溃的会话永久阻塞回滚。
  - 检查点文件存 `rivetHome()`，**不在工作区**（不污染用户 git 状态）。

**设计目的**
"完成"必须有证据，"回退"必须诚实。这两件事分开做：gate 管"能不能声称完成"，checkpoint 管"回到哪里、什么回不去"。

**可学**
是。我们 `goal.rs` 已有"完成要拿证据"的雏形（重读改过的文件 / 看验证命令退出码），缺：三态门、失效验证的丢弃计数、不可回退副作用的记录。

**优先级：P0（三态门 + 不可回退清单）/ P1（ownership guard）**。

### 4.19 session persist：追加、校验、水位

**功能**
会话转录的追加写、校验和、zstd 批处理、水位对齐、冻结快照持久化。

**源码证据**（`src/agent/session-persist.ts`，52KB）
- `appendChecksum(line)` 每行带校验和；`verifyLines()` 读时过滤坏行。
- `SessionBatchWriter`：zstd 帧 + 200ms 批 + **撕裂帧恢复**（`scanZstdFrames(onDisk).tornStart`）；`captureReadSnapshot()` 让同进程读者能看到还没落盘的尾批（"append() 之后接 loadOai() 不 flush 也合法"）。
- **`transcriptWatermark` 的定义写在注释里**："转录里当前有多少条 OAI 消息"，并明确三处必须同步：加载（对齐真实条数，含未落盘尾巴）、追加（+1）、历史重写（落到重写后条数，会变小）。注释记录旧实现只统计"本实例 append 过多少"，重新加载 2 条历史时是 0，"与恢复端的条数根本不是一个口径，观测门因此形同虚设"。
- `appendOaiWithChecksum(msg, {flush:true})`：对持久性关键的记录（assistant tool_calls / tool 结果 / 用户轮）强制 flush，"硬崩不能丢了已完成的工具结果，而它的磁盘副作用还在"。
- `readTranscriptText(requireComplete)`：要求完整时，若还有未 drain 的写入或撕裂帧 -> **抛错**，不返回半截数据。
- 冻结快照：`FrozenSnapshotWriter.queue/commit/drain` + `parseFrozenSnapshotData`（形状非法静默忽略）。

**设计目的**
agent 的崩溃语义很差：工具已经把磁盘改了，转录却没记下。所以持久化必须"证据先落盘、再发布"。这也解释了 `PromptEngine.setHistoryDurabilityBarrier()` 的存在：**发布前的耐久栅栏**。

**可学**
是。最低配版本：追加写 + 每行校验 + 关键记录同步 flush + 明确的"条数水位"定义。

**优先级：P0（append + checksum + flush 语义）/ P1（zstd 批处理与撕裂恢复）**。

### 4.20 外围：lsp / mcp / skills / plugins / workflows / plan / recovery / token-ledger

| 子项 | 源码证据 | 值得学的一点 | 优先级 |
|---|---|---|---|
| `lsp` | `src/lsp/manager.ts`、`typecheck-cache.ts` | `didOpen/didChange` **必须发真实文本**：注释给了实测（sourcekit-lsp 收空 text 时 `definition` 1.4s 返回空数组）；读不到就跳过通知而不是发空——"发空文本会把 server 的文档缓冲清成空，比内容略旧更坏"。跨进程 typecheck 用锁 + 缓存避免重复跑。 | P2 |
| `mcp` | `src/mcp/policy.ts`、`server-approval.ts`、`workspace-policy.ts` | 用 MCP **声明的 capability** 驱动审批（`declaredCapability` 传进 `assessToolRisk`），未声明按 `unknown` fail-closed。 | P1 |
| `skills` | `src/skills/skill-loader.ts` | 两级渐进披露：Tier1 只注入 name+description（进动态附录，缓存安全），Tier2 全文按需 `skill` 工具加载，"替换旧的'每轮注入全文'模式，其 4000/8000 字符预算导致静默截断"。 | P1 |
| `plugins` | `plugin-loader.ts`、`manifest.ts`、`git-source.ts` | 插件 manifest + 来源校验 + 预设 | P2 |
| `workflows` | `ecosystem-workflows.ts`(27KB) | 生态工作流只是提示词模板，无机制 | 不学 |
| `plan` | `plan-fact-anchors.ts`、`completion-evidence.ts` | "计划事实锚点"（计划里的每个事实要能回溯到证据）+ 完成证据 | P1 |
| `recovery` | `commands.ts`、`questions.ts` | 崩溃后恢复入口与问题关联，小而实用 | P2 |
| `token-ledger` | `service.ts`、`forum-sync.ts` | 本地台账按 `provider×model×day×hour` 折叠；**论坛同步部分不学**（把用量推给外部服务） | 本地部分 P2，同步不学 |

---

## 5. 可学 / 不可学

### 5.1 值得学（按优先级）

**P0（直接影响钱或正确性）**

1. **compaction-profile 双轴 reclaim floor**（`compact/compaction-profile.ts`，185 行纯函数）。
2. **压缩档位与精度天花板**（`compact/constants.ts`：0.72/0.86/0.92/0.95 + 大窗口 0.70）。
3. **reclaim gate**（`compact/reclaim-estimate.ts`）：改写必须证明回收量，否则保原字节。
4. **前缀预算度量**（`prompt/prefix-budget.ts` + `block-policy.ts` 三分法）。
5. **历史锚点 + 边界提交 + 尾部 delta**（`prompt/engine.ts` 的三件事，不是全套）。
6. **退出码语义**（`tools/bash.ts` `isExecFailure`）：非零不等于失败。
7. **双视图命令检测**（`approval-risk.ts` `normalizeBashCommand` + `testBoth`）。
8. **project trust：仓库内容不构成授权**（`config/project-trust.ts`）。
9. **三态交付门 + 不可回退副作用清单**（`delivery-gate-v2.ts` + `checkpoint.ts`）。
10. **session 追加 + 校验 + 关键记录 flush + 水位定义**。

**P1（结构性）**

11. **provider 缓存能力数据化**（`provider-profile.ts`）——虽然便宜，但依赖 P0 的档位才能发挥。
12. **CacheAdvisor `protection` 公式 + 决策账本**（3 行公式 + 只读 ledger）。
13. **两种命中率**（`usage-aggregator.ts` 的 `hitRate` vs `billedHitRate`）。
14. **语义压缩（context-collapse / semantic-prune）+ 边界归档 fail-open**。
15. **path grants 的 scope 概念**。
16. **skills 两级披露**、**MCP 能力声明驱动审批**。
17. **continuation-prefix 证据结构**（只取 `messages/tools/options` 三哈希）。
18. **DSML 恢复的 Markdown 字面量跳过**。
19. **unified-memory 的 supersededBy 链 + 写入前 scrub**。

**P2（有余力）**

20. action-intent 检测（先用协议硬约束代替）、advisory 账本、cron 的三个坑、code-fold、lsp didOpen、plan 事实锚点。

### 5.2 明确不学

**① 16 星域（含"星域只是认知姿态"的事实陈述）**

事实：`src/agent/star-domain-data.ts`（93KB）里 `STAR_DOMAINS` 恰好 16 个（天枢/破军/天府/天梁/天权/天机/天璇/辅/文曲/开阳/瑶光/华盖/启明/长庚/七杀/太一）。它的数据结构是：`{id, name, alias, motto, volatileBlock, decisionStyle, courageThreshold, keywords, toolWhitelist, mainToolTier, toolPreset, systemPromptSuffix, uiPersona}`。

**它确实是"认知姿态"**：真正进 prompt 的只有 `volatileBlock`，16 个域实测 262–863 字符（天枢 371、均值 420）；`systemPromptSuffix` 是"域详情展示用的完整叙事"，字段注释写明"模型实际注入使用 volatileBlock"，16 个域 358–1,860 字符，只给 UI 看。其余字段：`decisionStyle` 是 `'bold'|'cautious'|'methodical'` 枚举；`courageThreshold` 是 0–1 的数；`keywords` 用于关键词路由（`star-domain-registry.ts`）；`uiPersona` 只影响终端分隔线与配色（`constellation/format.ts` 明确 "NEVER fed back into the model context"）。**没有任何一行代码因为"域"而改变压缩、缓存、工具执行或证据逻辑。**

唯一的机制性成分是 `toolWhitelist` / `mainToolTier` / `toolPreset`——即"这个域能用哪些工具"，那是工具裁剪，与"星"无关，任何 `preset` 名字都能表达。

**结论：不采用。** 理由三条：

1. **收益不可验证**：人格化提示词的效果无法用测试钉住，只能靠体感；而它占了 prompt 前缀的一大块（`engine-prefix-budget.ts` 把 `star-domain volatileBlock` 归为 `brake` 类，即"永不截断"），是实打实的缓存成本。
2. **成本确定**：93KB 数据 + 关键词路由 + 自动池/手工切换/委派兜底（`DEFAULT_DOMAIN='tianquan'`、`DELEGATION_FALLBACK_AUTHORITY='tianliang'`）+ 域感知的 advisory 预算（`advisoryBudgetForDomain`），一整套维护面。
3. **与我们的产品语义冲突**：我们的用户要的是"能干活、说真话"，不是"换个人格"。

如果要吸收，最多吸收一个降级版本：**"任务形状"标签（探查/实施/验证/交付）-> 只影响提醒措辞与默认工具集**，不写进系统提示，不作为身份。

**② 议会（council）**

`src/agent/council/` 11 个模块（`council-orchestrator.ts` 23KB、`council-plan.ts`、`council-seal.ts`、`council-qliphoth.ts` 等）+ `src/tools/council-convene.ts`（36KB）+ 10 个测试文件。本质是"多角色 LLM 讨论 -> 产出计划/封印"，即多代理评审。**不学**：多代理成本成倍上升，收益无法证明优于"一个模型 + 一次审查"，且 `council-qliphoth`（逆位/失败面）之类概念增加了不可测试的语义层。

**③ 75 个 hooks 全量**

`src/agent/hooks/` 恰好 75 个 `.ts`（`advisory-readback-hook`、`anchor-break-scout-hook`、`courage-hook`、`dream-hook`、`cognitive-capsule-router`、`consistency-check-hook` 等）。**不学**：这是"每条经验长一个 hook"的堆积模式，彼此通过 advisory bus 竞争每轮 3 个渲染位。可学的是**宿主侧 hook 协议**（`src/hooks/`：`registry.ts`、`hooks-config.ts`、`hook-process.ts`、`external-hook-host.ts`、`hook-frames.ts`、`hook-host-rpc.ts`——外部进程 hook + 帧协议 + 配置），那是一个干净的扩展点，而不是 75 条内置经验。

**④ 信息素记忆（stigmergy）**

`src/context/stigmergy.ts`（11.5KB）、`src/agent/pheromone-map.ts`、`src/agent/hooks/stigmergy-hook.ts`、"死路信号"作为 advisory 第 5 通道。**不学**：它把"路径被反复尝试后留下痕迹"隐喻成信息素，实现上是"信号表 + 衰减"，与 §4.15 的统一记忆条目 + `repeatCount` 高度重叠，却多了一层隐喻与一套独立衰减参数。要"死路不重走"，用记忆里的 `failure_pattern` + `repeatCount` 就够。

**⑤ 其它不学**

- **CVM（认知运行时）理论包装**：`cognitiveProjection`、`companionPresence`、`cognitiveEphemeral`、`field-habituation` 等概念在 `PromptEngine` 里占了大量字段与注入源，收益无法证伪；真正的机制（锚点/提交/delta）与这些名字无关。
- **token-ledger 论坛同步**：把用量快照推到外部 endpoint。
- **TUI 9.4 万行**：产品化外壳，不移植。
- **1,668 行 `PromptEngine` 全文**：只取三件事（见 §5.1 第 5 条）。

### 5.3 学它的代价（诚实标注）

- 天枢的复杂度分配是失衡的：`agent` 23.6 万行 vs `cache` 2.1 千行。**它自己也没能控制住"经验长成 hook"**。我们抄的时候必须反向操作：机制进类型与纯函数，经验进文档与测试，不进代码路径。
- `PromptEngine` 的注释密度极高（大量"事故编号 + 日期 + 回归测试名"），这是它最值钱的部分之一，也是最难维护的部分。我们的等价物应该是**测试名 + CHANGELOG 条目**，不是正文注释。
- 它的很多设计是**为 1M 窗口 + 按量计费 + 中转站**这一具体环境优化的（`precisionCeilingRatio` 只对 200K 以上生效、`pruneThresholds` 在 500K 以上才放宽到 150K 字符）。我们的默认窗口若更小，这些数值必须重算，不能直接搬。

---

## 6. 对我们 engine 的映射

现状（`D:\卡塞尔学院\repo\app\src-tauri\src`）：

| 现有模块 | 已做的事 | 与天枢的对应 |
|---|---|---|
| `frozen.rs` | `FrozenPrefix{system, tools, hash}` + `with_appendix()`，冻结 system+tools，动态内容走 appendix | 对应 `PromptEngine` 的 frozen/appendix 二分，但**没有历史锚点、没有边界提交、没有快照落盘** |
| `agent.rs` | 原生 agent loop、`system_with_appendix` 拼装、流式 usage（`prompt_cache_hit_tokens`） | 对应 `loop.ts`/`turn-orchestrator.ts` 的极小内核 |
| `engine/context.rs` | `prune_tool_result()` head 4096 + tail 1024（按字符切，不切中文字节） | 对应 `compact/stale-round.ts` 的最简版；**无 reclaim gate、无语义压缩、无归档** |
| `engine/policy.rs` | `destructive_command` / `catastrophic_command`，按 `&&`、`||`、`;`、`|` 分段判断 | 对应 `approval-risk.ts` 的 `DANGEROUS_BASH_PATTERNS` 子集；**无双视图、无可用性危害、无外部写目标判断** |
| `engine/tool_pipeline.rs` | 审批卡 + 180s 超时按拒绝 + journal 记录 | 对应 `tool-pipeline.ts` 的审批入口；**无 `requiresUnconditionalApproval` 层** |
| `sandbox.rs` | 沙箱 × 审批两把独立 dial（ReadOnly/WorkspaceWrite/FullAccess × Always/OnDemand/Never），NORMA 收紧 | 对应天枢 sandbox + approval 分离；**无 path grants（越界只能拒，不能临时授权）** |
| `goal.rs` | 目标持久 + 轮次预算 + 停滞检测 + 检查点/倒带三粒度 + "完成要拿证据" | 对应 `checkpoint.ts` + `delivery-gate.ts`；**缺少三态门、失效验证丢弃计数、不可回退副作用** |
| `usage.rs` | 真实 usage + 按 DeepSeek 官方价目（含峰谷）算成本 + 今日/7d/30d 台账 | 对应 `usage-aggregator.ts` 的**单一口径**；缺 `side_path` 维度与 `billedHitRate` |
| `engine/journal.rs` | append-only run journal（元数据 + 脱敏参数），不复述内容 | 对应 `session-persist.ts` 的思路；**无校验和、无 zstd 批、无水位、无转录恢复** |
| `engine/deepseek.rs` | provider 元数据驱动（`is_deepseek`）+ `reasoning_effort` 映射 + 思考模式去 temperature | 对应 `provider-profile.ts` 的**极简版**（只有"是不是 DeepSeek"，没有缓存维度） |
| `dsml.rs` | DSML 文本工具调用恢复 | 对应 `api/dsml-tool-calls.ts` |
| `browser.rs` | 浏览器工具 | 需核对是否逐请求拦截（天枢 #213 的教训） |

### 6.1 建议动作

**P0-1 新建 `engine/compact.rs` + `engine/compact_profile.rs`（纯函数，无 IO）**

- 照抄两轴模型：`billing: PerToken|Subscription` × `cache: None|Partial|ExactPrefix` -> `(min_reclaim_tokens, min_reclaim_ratio)`。
- 档位：`cache-preserving 0.72/0.86/0.92/0.95`、`balanced 0.60/0.78/0.88/0.95`、`aggressive 0.50/0.70/0.84/0.95`；`precision_ceiling`：500K 以上 0.70，200K 以上 0.55，否则无。
- 单调性单测必须写：`ratio` 递增时 `tier` 不得下降（天枢为此改过一次 bug）。
- 准入条件：`provider` 配置先有 `cache_kind`/`persistent`（P0-2），否则档位无从选择。

**P0-2 `settings.rs::ProviderConfig` 增字段**

```rust
pub cache_kind: String,      // "exact-prefix" | "explicit-breakpoint" | "partial-prefix" | "none"
pub persistent: bool,
pub min_cache_tokens: u64,   // DeepSeek 64
```

落到一个 `fn provider_cache_profile(&ProviderConfig) -> CacheProfile`，**不要在对话循环里写 `if provider == "deepseek"`**。

**P0-3 `frozen.rs` 增加历史锚点与边界提交**

- `HashMap<AnchorKey, FrozenAnchor{prefix, suffix}>`，键 = `sha256(用户消息内容) + 出现序号`。
- 只在"真用户新消息"处提交 pending 追加块；同一用户消息内的多轮工具调用沿用旧块。
- 单测：同一用户消息连跑 3 轮工具调用后，前 N-1 条请求的 `system` + 历史字节完全一致（可直接复用现有 `frozen.rs` 的 sha256 断言风格）。

**P0-4 `context.rs` 升级为"证据化裁剪"**

- 保留 head/tail，但增加：① 裁剪前算 `reclaimed_tokens/before_tokens`；② 低于 floor 就不裁；③ 被裁原文本存 artifact（我们已有界面的完整展示），返回引用标记。
- 退出码语义：新增 `fn is_exec_failure(code: i32) -> bool`（127/126/大于 128），别把 grep=1 当错误。

**P0-5 `engine/policy.rs` 补三层**

- `normalize_command()`（去 `$IFS`、续行、字符转义、引号拼接）+ 对原始/归一化**双视图**匹配。
- 外部写目标判定：写类命令 + 目标路径在 workspace 外 -> 升到需审批。
- 无条件审批层：`request_path_access`、`browser.js_eval`、源码构建安装等"任何 allow 规则都不能豁免"的集合（可先留空表 + 接口）。

**P0-6 `goal.rs` 的完成判定升级为三态门**

- `Green / Yellow / Red`：改了文件后必须有一次"在这批字节上"通过的验证（验证后文件又改动 = 失效，丢弃并重跑）。
- 新增 `unrevertable: Vec<String>`：把 curl/POST/publish/push 类副作用记进检查点，倒带时如实说明"这些回不去"。

**P1-1 `engine/cache_advisor.rs`（公式 + 决策日志）**

```rust
let pressure = (est_tokens as f64 / window as f64).clamp(0.0, 1.0);
let protection = recent_hit_rate * (1.0 - pressure);
let delay = tier < 3 && (protection >= 0.45 || (warmth_hot && tier <= 1 && pressure < 0.5));
```

每次决策写一行 journal（`engine/journal.rs` 已有 `EngineEventKind`，加一个变体即可），只读不回灌。

**P1-2 `usage.rs` 加 `side_path` 与两个命中率**

- `UsageRecord` 增 `side_path: bool`；`hit_rate`（仅主请求）/ `billed_hit_rate`（全部计费行）分开算。
- 面板同时显示两个数，差值就是回归信号。

**P1-3 前缀预算表**

- 一个 `prefix_budget()` 返回 `Vec<Part{name, category, chars, approx_tokens}>`，category = `Brake|Reference|Tools|Appendix`；`total` 不含 Appendix。
- 先做成调试面板/命令，再谈裁剪策略。**有了表才允许优化**。

**P1-4 project trust**

- `.kassel/`（或我们的等价目录）里的 hooks/配置**默认不生效**，除非 `project-trust.json`（存应用数据目录，realpath 键控）里有记录，或显式 env 覆盖。

**P1-5 path grants**

- `grant(root, mode, scope)`，双向 canonicalize 后判包含；`write` 蕴含 `read`；grant 必须带 `scope`（工作区 canonical 路径），防多会话串权。

**P2**

- DSML 的 Markdown 字面量跳过；技能两级披露；MCP 能力声明驱动审批；LSP didOpen 真实文本；cron 三坑（若做定时目标）。

### 6.2 明确不做

- 不引入星域/人格化系统提示：`frozen.rs` 的 `system` 保持"规则 + 工具契约 + 工作区说明"，不写身份叙事。
- 不引入 council 多代理评审。
- 不把"经验"做成 75 个 hook 函数：经验进 `docs/` 与测试，代码只留机制。
- 不引入信息素/信号表：死路用记忆条目的 `repeat_count` 表达。
- 不移植 `PromptEngine` 的 1,668 行：只取锚点 / 边界提交 / delta 三件事。
- 不做用量外推同步。

---

## 7. 附：实际读过的关键文件

**必读清单（逐行或大段读）**

```
src/cache/advisor.ts
src/cache/adaptive-threshold.ts
src/cache/session-warmth.ts
src/cache/behavior-learner.ts
src/cache/ghost-registry.ts
src/cache/billed-hit-rate.ts
src/cache/usage-aggregator.ts
src/compact/compaction-profile.ts
src/compact/constants.ts
src/compact/micro.ts
src/compact/stale-round.ts
src/compact/semantic-prune.ts
src/compact/context-collapse.ts
src/compact/reclaim-estimate.ts
src/compact/boundary-archive.ts
src/compact/code-fold.ts
src/context/compact-policy.ts
src/prompt/prefix-budget.ts
src/prompt/engine-prefix-budget.ts
src/prompt/block-policy.ts
src/prompt/engine.ts
src/prompt/volatile.ts
src/prompt/frozen-anchors.ts
src/prompt/fingerprint.ts
src/api/provider-profile.ts
src/api/cost-model.ts
src/api/dsml-tool-calls.ts
src/api/continuation-prefix.ts
src/agent/approval-risk.ts
src/agent/action-intent-detector.ts
src/agent/advisory-bus.ts
src/agent/checkpoint.ts
src/agent/delivery-gate.ts
src/agent/delivery-gate-v2.ts
src/agent/delivery-receipt.ts
src/agent/deliver-task.ts
src/agent/session-persist.ts
src/agent/compaction-controller.ts
src/agent/turn-orchestrator.ts
src/agent/star-domain.ts
src/agent/star-domain-data.ts
src/constellation/format.ts
src/constellation/milestone.ts
src/config/project-trust.ts
src/tools/bash.ts
src/tools/browser.ts
src/tools/path-grants.ts
src/memory/unified-memory.ts
src/server/cron-tick.ts
src/server/cron-wiring.ts
src/server/cron-scheduler.ts
src/lsp/manager.ts
src/skills/skill-loader.ts
src/token-ledger/service.ts
package.json
```

**仅读头部/导出与调用点（作为佐证，未逐行）**

```
src/prompt/static.ts
src/context/stigmergy.ts
src/agent/hooks/*（75 个文件清点与抽样）
src/agent/council/*（11 个模块清点）
src/mcp/policy.ts
src/tools/artifact-threshold.ts
src/server/session-persistence.ts
src/server/session-manager.ts
src/prompt/__tests__/*（按文件名清点 47 个用例）
```

**对比读（我们的仓库）**

```
app/src-tauri/src/agent.rs
app/src-tauri/src/goal.rs
app/src-tauri/src/sandbox.rs
app/src-tauri/src/frozen.rs
app/src-tauri/src/usage.rs
app/src-tauri/src/dsml.rs
app/src-tauri/src/browser.rs
app/src-tauri/src/engine/mod.rs
app/src-tauri/src/engine/context.rs
app/src-tauri/src/engine/policy.rs
app/src-tauri/src/engine/journal.rs
app/src-tauri/src/engine/tool_pipeline.rs
app/src-tauri/src/engine/deepseek.rs
```

**本次唯一修改文件**

```
D:\卡塞尔学院\repo\docs\source-analysis\tianshu.md
```
