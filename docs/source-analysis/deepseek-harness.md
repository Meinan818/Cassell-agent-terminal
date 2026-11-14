# DeepSeek Harness 源码级分析

源码：`D:\卡塞尔学院\research-src\deepseek-harness`
快照：`master` / `39163dd3`（Merge PR #8422，release dsh-0.2.2-rc.3 → master）
许可证：MIT
清点口径：`packages/` 下 53 个包组、382 个 package 目录（每个目录一个 `package.json`），`apps/` 6 个应用（cli、desktop、desktop-host、desktop-publisher、plugin-market-generator、web）。仓库文件数按 `git ls-files` 为 **21,632**。

> **版本边界：** 源码快照是 `0.2.2-rc.3`；本机安装是 `0.2.1-rc.2`。
> 本报告是源码快照分析，不能直接当作本机旧版行为。

证据标注约定：

- **【源码】**：我读了实现文件并核对到具体行为、默认值或调用顺序。
- **【文档】**：只读到 `docs/` 或包 README 的说明，未逐一读实现。
- **【源码+文档】**：两边都看，且一致。

---

## 0. 摘要

**先说结论：DSH 是两套东西叠在一起，必须分开评价。**

1. **产品形态层：Cordis 插件树。** 模型适配器、工具注册表、session log、agent loop 本身都是插件，运行时由 profile → bundle → patch 分层组合出插件树，没有"特权 core"可改（`docs/architecture.md` "Cordis" / "Profiles and bundles"；`packages/core/agent-loop/src/index.ts:290-291` 里 `AgentLoop extends Service`、`static inject = [...]`）。【源码+文档】
2. **数据层：严格事件溯源的 session log。** 一次交互的全部历史是一个 append-only 的 `SessionEvent` 序列，模型看到的消息历史由 `deriveMessages()` 从 log 派生，从不单独存储（`packages/core/session/src/types.ts:287` 的 `SessionEventMap`；`packages/core/session/src/index.ts:1079` 的 `deriveMessages()`）。【源码】
3. **这两层可以分开抄。** 第一层在 DSH 内部是有回报的（能力全可在配置层替换、HMR、插件市场），代价是所有跨模块推理都要先读"profile 层叠 + inject 声明 + 事件声明合并"。第二层没有这个代价，它只是数据结构和事件边界。

**硬结论（按你的明确要求写成不可动摇的一条）：**

> 我们**只学** session / turn / step / tool pipeline / compaction 的事件边界与数据模型；**不采用**插件树作为我们 engine 的核心架构。不引入 Cordis、不引入 profile/bundle/patch 层叠、不引入"一切皆插件"的服务注入与声明合并作为主干。DSH 的插件树只作为"他们为什么这么做、代价是什么"的参考案例存档。

理由（不是口味问题，是成本结构问题）：

- 插件树把**启动顺序**变成服务可用性推导（`inject` 等到服务存在才激活），把**模块边界**变成运行时 `ctx.<key>` 查表，把**类型扩展**变成 TypeScript 声明合并。读一个功能要先读三层 patch 才知道实际配置，静态推理成本高。
- 它的收益是"任何能力都能被替换"，而我们的 engine 需要的是"行为边界稳定、可回归测试、可审计"。这两件事的最优解不同：DSH 用插件树换可替换性，我们用固定模块 + 事件边界换可预测性。
- 事件边界那一层与插件树**没有强耦合**：`SessionEventMap`、`tool/call`→`tool/result` 的配对、turn/step 的 enclosure 规则，都可以在普通模块里独立实现（见第 5 节映射）。

**最值得抄的五件（按优先级）：**

| 优先级 | 要抄的东西 | 一句话理由 |
|---|---|---|
| P0 | append-only `SessionEvent` log + `deriveMessages()` 派生历史 | 唯一真相源；fork/resume/压缩/审计全部从同一份 log 推导 |
| P0 | turn/step/request/stream/tool 五级事件边界 + durable/live 分域 | 决定了"什么必须落盘、什么只是 UI 实时帧" |
| P0 | guarded tool pipeline（pre-execute 瀑布 → 单调 guard → approval → around → body → post-execute → finalize → result） | 策略可插拔但权限只减不增；参数不可重写 |
| P1 | compaction 用 `surfaceOp: replace` 遮挡历史而不是改历史 | 压缩后仍可完整回放，且工具调用/结果配对不破坏 |
| P1 | `assistant/message` 内嵌紧凑 timed stream、`assistant/attempt` 单独记录失败尝试 | 失败重试也不编造模型可见历史，但证据不丢 |

---

## 1. 包清点（packages/ 全量）

约定：核心组（core/session/compaction/context/llm/tools/sandbox/interaction/goal/plan/subagent/team/schedule/workflow/mcp/skill/browser-use/computer-use）逐包点名；外围组（client 74、experimental 65、util 24 等）按组说明职责并点名代表包，不逐包罗列 UI 面板。

### 1.1 分组总表

| 包组 | 包数 | 职责 | 代表包 |
|---|---:|---|---|
| `core` | 10 | **脊柱**：事件日志、提示词装配、工具注册与执行、Agent 接口与循环 | `session`、`system-prompt`、`tools`、`agent`、`agent-loop`、`scope`、`tool-executor-native`、`tool-executor-ptc`、`agent-default-model`、`agent-tool-presentation`(已弃用) |
| `session` | 22 | Session 之外的会话设施：格式版本与迁移链、持久化、投影、统计、标题 | `session-persistence-jsonl`、`session-format-v0-to-v1`…`v3-to-v4`、`session-projection`、`session-checkpoint-policy`、`working-directory`、`session-telemetry` |
| `session-query` | 3 | 跨会话查询（含 SQLite FTS5）与导出 | `session-query`、`session-query-sqlite`、`session-log-export` |
| `context` | 7 | **动态上下文贡献者**（进入 next request 的模型上下文） | `agent-instructions`(AGENTS.md/CLAUDE.md)、`time-context`、`session-reference`、`file-reference`、`file-reference-local`、`tmux-context`、`harness-dev-context` |
| `compaction` | 5 | 上下文压缩 seam 与实现 | `compaction`(seam)、`compaction-basic`(LLM 摘要)、`compaction-tool-result-pruner`、`compaction-image-offload`、`command-compact` |
| `spill` | 3 | 超长工具输出落盘，返回定位符 | `spill`(seam)、`spill-local`、`spill-policy` |
| `llm` | 9 | 模型消息/流协议与适配器 seam | `llm`、`llm-deepseek`、`llm-pi-ai`、`llm-retry`、`token-meter`、`deepseek-llm-api-extensions`、`llm-deepseek-account`、`llm-deepseek-api-key`、`plugin-package-inventory-deepseek` |
| `tools`(在 core) | — | 工具注册表 + 受护栏执行流水线 | 见 core |
| `sandbox` | 4 | 进程文件效果沙箱 | `sandbox`(seam)、`sandbox-local`(bwrap/landlock/seatbelt)、`sandbox-policy`、`sandbox-windows-acl` |
| `interaction` | 5 | 人机交互 seam：审批、提问、命令、权限预设 | `user-approval`、`user-questions`、`tool-ask-user`、`commands`、`permission-presets` |
| `guard` | 2 | 工具调用的横切护栏 | `repeat-tool-reminder`、`tool-call-timeout-policy` |
| `goal` | 4 | 同会话目标（事件溯源）+ 自动续轮驱动 | `goal`、`goal-round-driver`、`tool-goal`、`command-goal` |
| `plan` | 1 | 计划模式（软约束） | `plan-mode` |
| `subagent` | 9 | 子代理 seam 与 6 种后端 | `subagent`(seam)、`subagent-fork-in-process`、`subagent-spawn-in-process`、`subagent-acp`、`subagent-dsh-sdk`、`subagent-claude-code`、`subagent-codex`、`tool-subagent`、`tool-subagent-control` |
| `team` | 2 | 子代理树的共享任务 DAG | `agent-team`、`tool-agent-team` |
| `schedule` | 2 | Host 级持久定时任务（7 种时间语义） | `schedule`、`tool-schedule` |
| `workflow` | 3 | 模型写编排脚本起子代理 | `workflow`(seam)、`workflow-ptc`、`tool-workflow` |
| `mcp` | 3 | 外部 MCP 服务器接入 | `mcp-client`、`mcp-manager`、`mcp-resources` |
| `skill` | 5 | 技能发现与加载 | `skill`(seam)、`skill-filesystem`、`skill-office`、`tool-skill`、`tool-workspace-dependencies` |
| `browser-use` | 1 | 浏览器 provider 独占注册槽（provider 在 experimental） | `browser-use` |
| `computer-use` | 1 | 桌面操作 provider 独占注册槽 | `computer-use` |
| `credentials` | 4 | 凭据只存引用，值由 provider 持有 | `credentials`(seam)、`credentials-local`、`deepseek-account`、`authorization` |
| `settings` | 1 | 分层用户设置 seam | `settings` |
| `storage` | 4 | KV/domain 存储 hub | `storage`、`storage-domain`、`storage-json`、`storage-sqlite` |
| `fs` | 8 | 文件系统 seam 与护栏 | `fs`、`fs-local`、`fs-sandbox`、`fs-observation-policy`(读后写/版本护栏)、`fs-patch`、`tool-fs`、`tool-fs-search`、`tool-str-replace-editor` |
| `shell` | 10 | Shell 执行 seam 与工具 | `shell`、`bash-local`、`bash-sandbox`、`pwsh-local`、`pwsh-sandbox`、`tool-bash`、`tool-bash-persistent`、`tool-pwsh`、`tool-pwsh-persistent`、`shell-env` |
| `subprocess` | 3 | 子进程 seam（进程组、spill 输出、升级 kill） | `subprocess`、`subprocess-local`、`win32-process` |
| `terminal` | 2 | 持久 PTY seam | `terminal`、`terminal-bash` |
| `jobs` | 3 | 后台任务注册表 | `jobs`、`jobs-local`、`tool-jobs` |
| `lsp` | 3 | 语言服务导航 | `lsp`、`lsp-stdio`、`tool-lsp` |
| `ssh` | 5 | 远端执行世界（fs/subprocess/sandbox） | `ssh`、`fs-ssh`、`subprocess-ssh`、`sandbox-ssh`、`ssh-helper-runtime` |
| `ptc-runtime` | 2 | 程序化工具调用（PTC）执行运行时 | `ptc-runtime`、`ptc-runtime-node` |
| `web` | 5 | 联网搜索/抓取 seam | `web`、`web-deepseek-api`、`web-search-deepseek`、`web-fetch-http`、`tool-web` |
| `attachment` | 2 | 附件（图片）不可变存储 seam | `attachment`、`attachment-local` |
| `deliverables` | 3 | 交付物声明与工作区变更快照 | `tool-present`、`workspace-changes`、`deliverable-file-references` |
| `document` | 2 | Office 渲染/转换 | `office-kit`、`tool-office` |
| `todo` | 1 | 待办工具（直接写 session log） | `tool-todo` |
| `feedback` | 2 | 消息反馈 | `message-feedback`、`command-feedback` |
| `telemetry` | 1 | OTLP 通道 | `otel` |
| `identity` | 1 | 匿名用户 ID | `anonymous-user-id` |
| `preset` | 3 | Agent 预设（用 Cordis YAML 声明 agent 的子插件） | `agent-preset`、`agent-preset-registry`、`persona` |
| `extensions` | 4 | 运行期动态加载 Cordis 插件 | `tool-cordis`、`ui-cordis`、`cordis-host-runner`、`cordis-client-runner` |
| `boot` | 6 | 启动与配置面 | `app-boot`(profile/bundle/patch 装载)、`cmdline`、`config-editor`、`hmr`、`plugin-manager`、`plugin-market` |
| `bundle` | 6 | profile bundle 发行格式 | `base`、`web-app`、`headless`、`sdk-app`、`sdk-minimal`、`acp-app` |
| `api` | 9 | Host Remote（前端 RPC 契约与控制器） | `gateway`、`session-controller`、`settings-controller`、`terminal-controller`、`workspace-controller`、`workspace-files`、`job-controller`、`remote-access`、`remotes` |
| `host` | 11 | Web Host 侧基础设施 | `webserver`、`frontend-static`、`directory-picker*`×4、`authentication-*`×2、`open-in-app`、`plugin-inventory`、`product-telemetry-otel` |
| `client` | 74 | 浏览器端：连接、模块系统、资源、slot 渲染与 50+ UI 面板 | `web`(boot kernel)、`connection`、`modules`、`ui-renderer`、`ui-slots`、`ui-conversation`、`ui-chat`、`ui-tool`、`ui-trajectory`、`ui-settings*` |
| `sdk` | 3 | TS SDK + wire protocol + JSON-RPC server | `client`、`protocol`、`server` |
| `acp` | 1 | ACP 自动化服务器 | `acp` |
| `typert` | 4 | Remote 反射/代码生成/注册 | `generator`、`loader`、`protocol`、`registry` |
| `util` | 24 | 无依赖工具库 | `brand`、`error`、`timeout`、`deque`、`chunked-list`、`atomic-write`、`ripgrep`、`time`(Cron/RRULE)、`output-retention` |
| `test-support` | 8 | 测试基建 | `agent-loop-testkit`、`llm-mock-server`、`llm-replay`、`session-snapshot`、`tool-testkit` |
| `experimental` | 65 | 未定型能力（默认不装载） | `browser-use-*`×4、`cua-*`×5、`hooks-claude-code`/`hooks-codex`、`hook-protocol`、`forge*`×4、`liveshare*`、`timeline`、`tool-ralph`、`webworker-*`、`speech-to-text*`、`worktree` |

### 1.2 核心组逐包（重点）

**`packages/core`（10）**

| 包 | 职责 | 关键文件 |
|---|---|---|
| `session` | append-only `SessionEvent` log + 内存 store + surface 投影（`ctx.sessions`） | `src/types.ts`(事件表)、`src/index.ts`(Session/SessionStore)、`src/surface.ts`(append/replace 折叠) |
| `system-prompt` | prompt section / 动态 context / tool schema 的注册与装配（`ctx.systemPrompt`） | `src/index.ts` |
| `tools` | 作用域工具注册表 + 受护栏执行流水线（`ctx.tools`） | `src/pipeline.ts`、`src/contracts.ts`、`src/schema.ts`、`src/presentation.ts` |
| `agent` | `Agent` 接口、活体注册表、initiator scope、`agent/*` 事件词表（`ctx.agents`） | `src/types.ts`、`src/index.ts`、`src/runtime-types.ts` |
| `agent-loop` | 默认驱动（`ctx.agentLoop`），实现 `AgentFactory` | `src/agent.ts`(turn/step)、`src/index.ts`(Service) |
| `scope` | per-agent 作用域注册原语（唯一非 service 包，纯库） | `src/index.ts` |
| `tool-executor-native` / `tool-executor-ptc` | 两种批量执行器：逐个原生调用 / `run_code` 程序内子调用 | `ptc.ts`、`run-code.ts` |
| `agent-default-model` | 跨入口共享默认模型选择 | `src/index.ts` |
| `agent-tool-presentation` | 已弃用的呈现选择器 | `src/index.ts` |

**`packages/compaction`（5）**

| 包 | 职责 |
|---|---|
| `compaction` | seam：`ctx.compaction` 的 `compactIfNeeded/compactNow/compactRegion` + `compaction/*` 事件声明 |
| `compaction-basic` | 实现：token-meter 驱动阈值 + LLM 摘要 + 保留尾部策略（默认 `thresholdRatio=0.8`、`retainRatio=0.16`，`src/config.ts:20,23`【源码】） |
| `compaction-tool-result-pruner` | 无模型的头/中/尾裁剪（Unicode code point 计），替换 `tool/result` 节点 |
| `compaction-image-offload` | 图片超预算时换成占位符并重试（`IMAGE_OFFLOAD_REQUIRED`） |
| `command-compact` | `/compact` 人工命令 |

**`packages/context`（7）**：`agent-instructions`（读 AGENTS.md/CLAUDE.md 进上下文）、`time-context`（当前/经过时间）、`session-reference`（跨会话快照引用，走 spill）、`file-reference`+`-local`（`@file` 语法与模糊索引）、`tmux-context`、`harness-dev-context`。它们都是"每个 step 的 durable user/message 上下文"，不是 session 事件私有格式。

**`packages/subagent`（9）**：seam `subagent`（`ctx.subagents`，命名 provider 注册表；`startActivation` 统一入口，能力标志在启动前校验）；后端 `fork-in-process`（父 log 前缀种子）、`spawn-in-process`（全新子 agent）、`acp`、`dsh-sdk`、`claude-code`、`codex`（后 4 个跨进程）；消费者 `tool-subagent`（委派）、`tool-subagent-control`（发消息/中断/发现）。

**`packages/goal`（4）**：`goal`（事件溯源的目标状态：`active|paused|blocked|complete`，每次变更是 `goal/change` 全量快照或清除墓碑）、`goal-round-driver`（把"目标续轮"做成 `agent/turn-stopping` / 收件箱轮次 attribution）、`tool-goal`、`command-goal`。

**`packages/llm`（9）**：`llm`（`Message`/`ContentBlock`/`StreamChunk`/`LlmAdapter`/`BlockAssembler` 的唯一定义处）、`llm-deepseek`（Messages 适配器）、`llm-pi-ai`（同一 seam 的第二实现，用于设计验证）、`llm-retry`（按 provider 的退避重试）、`token-meter`（可回放的 token 计量，压缩压力靠它）。

---

## 2. 关键调用链（源码确认）

### 2.1 启动：profile → bundle → patch → Loader

```text
dsh <profile>
  → app-boot: 载入环境层(.env) → 读 profile manifest(dsh.profile.bundles)
  → 逐个 bundle 取 dsh.bundle.patch（可多文件、有先后）拼成 patch 层
  → 依次应用：profile bundle 层 → profile 的 cordis.patch.yml → home 级 patch → --patch 覆盖
  → 对空 entry 列表执行 patch（insert 新行 / 按 id 替换某行整个 config）
  → Cordis Loader 按 inject 服务可用性激活插件
  → 必需行失败则整体 dispose 并非零退出
```

证据：`docs/architecture.md`#profiles-and-bundles；`packages/boot/app-boot/README.md`（含 `installFailLoud`、`--dump-config`、`skippedBundles`、`compatibility.json` 版本豁免）；`packages/bundle/base/cordis.patch.yml`（549 行，一行一个插件，注释明确"行顺序不承载加载语义，激活由服务可用性驱动"）。【源码+文档】

**评价**：这套机制解决的是"同一份代码发行 5 种产品形态 + 用户可改"。我们不需要多形态发行，不需要用户改插件树，所以整层不值得抄。唯一可借用的概念是"**分层配置 + 每层只声明差异**"，这在普通配置文件里就能做。

### 2.2 turn 主循环（`packages/core/agent-loop/src/agent.ts:333-435`）【源码】

```text
turn():                       // turn = 0..N 个 step
  append('turn/start', {turn})
  while true:
    decision = preStep(target, {turn, step})           // 认领 inbox，跑 agent/pre-step 瀑布
    if decision.kind === 'reject': turnEnds = blocked; return false
    if 首步且 messages 为空:  turnEnds = completed; return false   // 空 turn，不产生 step
    append('step/start', {turn, step})
    try:  stepEnd = step(decision)                     // 见 2.3
    finally: append('step/end', {turn, step})
    decision.toolSet.dispose()                          // 本 step 的工具准入集合关闭
    if 无 owed work && inbox.nextStep 空:
        await dispatch.serial('agent/turn-stopping', {turn, signal})
        若监听器没有 steer 新工作 → break
    target = 'next-step'
  catch: 取消 → turnEnds = {aborted, reason}; 其他 → {error, LlmFailure}
  finally: append('turn/end', {turn, reason})           // max-tokens 具有粘性，后续成功步不能降级
```

注意三个真实存在的行为细节：step 失败时会**补记未落盘的 tool/result**（`ToolCallRecovery`，`agent.ts:379-390`）；`max-tokens` 一旦出现，整轮都记 `max-tokens`；turn 边界不强制 flush，持久化检查点在 `session-checkpoint-policy`。

### 2.3 step 内部：请求装配 → 流式 → 工具（`agent.ts:441-620`）【源码】

```text
step(decision):
  renderedPrompt = renderPrompt(assembly)
  loop:
    prepareRequest()                    // 绑定 adapter；取消则系统提示与被接受用户消息都不提交
    systemPrompt.refreshContext()       // 刷新运行时上下文（时间、AGENTS.md 等）
    systemPrompt.project()              // 产出 system/message 的替换/追加，append 到 log
    append('user/message', ...)         // 首次尝试才提交被认领消息 + 运行时上下文快照
    request = buildRequest(...)         // append('request/header', {reason:'change'|'series'}) 等
    live = new AssistantStreamAttempt(...)   // 实时帧 agent/assistant-stream
    for await chunk of llm.stream(request): live.push(chunk)
    finish 为 error/aborted:
        append('assistant/attempt', {stream})            // 失败尝试也留着证据
        action = waterfall('agent/request-error', ...)   // 监听器可返回 retry
        retry → continue（不重复 assembly / pre-step）
    正常:
        append('assistant/message', {message, stream, usage})
        max-tokens → 返回 max-tokens
        无 tool-call → 返回 completed
        await ctx.tools.execute({calls, signal, agent, log:{turn,step}, toolSet})
        additionalContexts → 塞回 inbox.nextStep（下一 step 才可见）
```

### 2.4 工具执行流水线（`packages/core/tools/src/pipeline.ts`）【源码+文档】

```text
executor.execute(batch)                      // 原生 executor 或 PTC executor
 → 每个调用：物化并深冻结参数（不可重写）、分配 token
 → tools/pre-execute（瀑布，返回 PreToolDecision: allow|deny|cancel|ask）
 → ask → ctx.approval.request()：只接受 allowed-once，其余一律拒绝（fail-closed）
 → checkGuards（单调护栏：返回值只有"拒绝原因/结构化错误"或 undefined，**没有 allow**）  // pipeline.ts:214
 → tools/execute（around 包装：超时、重试、指标）
 → 工具 body（fs/* 事件做读写护栏，工具自有事件如 todo/write）
 → projectContent（执行准备内容）
 → tools/post-execute（accept 内容 / accept 值 / block 反馈；二者不可同时替换）
 → finalizeContent（同步、必须不抛、只改 content）
 → tools/result（同步通知，收到已冻结的最终结果）
 → append('tool/result')，批量结束后把 additionalContexts 作为 user/message 追加
```

护栏的语义设计值得逐条抄：**guard 没有 allow 分支**（后来者无法把拒绝翻回允许）；**参数在进入策略前就深冻结**（历史、审计、UI、执行必须一致，所以禁止策略层改写参数）；审批只能一次性放行；管线快照失败会被归一化成 `isError` 而不是抛出去打断回合。

### 2.5 压缩链（`docs/subsystems/compaction.md` + `packages/compaction/*`）【源码+文档】

```text
触发：agent/pre-step（对已提交 request header 施压）/ agent/request（目标变更）
     / agent/request-error（确认 CONTEXT_WINDOW_EXCEEDED 后）
 → compaction-basic: 可选先跑 tool-result-pruner（无模型裁剪） → ctx.tokenMeter 重测
 → compactRegion 选一段 surface 区间（必须保持 tool call/result 配对）
 → append('compaction/start')                    // 锁：先落锁，最后解锁
 → 摘要（走 ctx.llm.stream，记录 provider/model/usage）
 → append('compaction/summary')                  // 记录被遮挡区间与 seq 列表
 → append('user/message', {surfaceOp:{op:'replace', startSeq, endSeq}})   // 唯一的 surface 改写
 → append('compaction/end')
```

关键点：`compaction/*` 三个事件**都是 log-only**，不进 `SurfaceEventType`；真正替换历史的是那条 `user/message` 的 `replace`；`replace` 是"位置区间"而非数值区间，所以 `startSeq > endSeq` 是合法状态（`docs/subsystems/compaction.md` 的 `shadowedRange` 注释）；崩溃只会留下"有 start 无 end"的孤儿锁，可检测。`session/end-seed` 的存在正是为了让"打开但未关闭的区间"能被判定为上一生命周期的死锁，而不是当前正在压缩。

### 2.6 持久化与检查点（`packages/session/*`）【文档】

> 证据等级校正：本节原先标成【源码+文档】，但只读了 `docs/`/README，
> 没有逐一读 `packages/session/session-persistence-jsonl`、`session-format-*`
> 和 `packages/compaction/compaction/src/types.ts` 的实现。因此这里应降级为
> 【文档】；矩阵中同类持久化条目也按【文档】理解。

- `session-persistence`(seam) + `session-persistence-jsonl`：一代一个文件，`session.vN.jsonl[.zstd]`，提交后的代文件永不改名/替换/删除；迁移链 `v0→v1→…→v4` 一包一步（`packages/session/session-format-v3-to-v4` 等）。
- `session-checkpoint-policy`：在**模型请求前**、**顶层工具产生外部效果前**、**下一步开始前**做语义检查点；检查点失败则 fail-closed，adapter 与工具 body 不运行；未完成的 assistant 流保持 transient；被中断的工具调用恢复为"结果未知"，不自动重试。
- `Session.append` 在源头校验 `isJsonValue`（非无损 JSON 直接抛），保证 log 永远等于后端可持久化的内容（`docs/subsystems/session.md`#durability-contract）。

### 2.7 Apps 层

`apps/` 不是运行时核心，但决定实际交付形态：

| app | 作用 |
|---|---|
| `cli` | 终端入口 |
| `desktop` | Electron 桌面壳与 Web UI |
| `desktop-host` | 桌面宿主、profile 启动、IPC 生命周期 |
| `desktop-publisher` | 桌面发布 |
| `plugin-market-generator` | 插件市场生成 |
| `web` | Web 应用 |

这部分本轮只做目录级核对，未逐文件分析；不把它和 `packages/core` 的事件边界混在一起。

---

## 3. 功能矩阵

"类型"列：源码 = 我读了实现并核对；文档 = 只读文档/README；源码+文档 = 两边一致。
"可学"列：学 / 部分 / 不学。"优先级"：P0 立刻做，P1 本轮做，P2 以后，— 不做。

| 功能 | 证据路径 | 类型 | 用途 | 可学 | 优先级 |
|---|---|---|---|---|---|
| Cordis 插件树（一切皆插件） | `docs/architecture.md`#cordis；`packages/core/agent-loop/src/index.ts:290` | 源码+文档 | 所有能力可在配置层替换、HMR、插件市场 | **不学**（作为核心） | — |
| profile / bundle / patch 层叠 | `docs/architecture.md`#profiles-and-bundles；`packages/boot/app-boot/README.md`；`packages/bundle/base/cordis.patch.yml`(549 行) | 源码+文档 | 一套代码发行 web/headless/sdk/acp/sdk-minimal 五种形态 | 部分（只借"分层只写差异"的想法） | P2 |
| append-only `SessionEvent` log | `packages/core/session/src/types.ts:287`；`index.ts:809,858` | 源码 | 唯一真相源，一切派生 | 学 | **P0** |
| `deriveMessages()` 派生历史 | `packages/core/session/src/index.ts:1079` | 源码 | 模型历史不算第二份存储；重放 = 重新派生 | 学 | **P0** |
| surface + `surfaceOp`（append/replace） | `packages/core/session/src/types.ts:447-478`；`surface.ts:91-105,290` | 源码 | 压缩只"遮挡"不改历史，回放仍完整 | 学 | **P0** |
| 14 个核心事件（turn/step/request/assistant/attempt/tool/system/user/developer/end-seed；含 `developer/message` 与 `request/context`） | `types.ts:287-435` | 源码 | durable 事实与 live 扩展点分离 | 学 | **P0** |
| `request/header`（调用配置 + 工具 schema 快照） | `types.ts:246,398`；`docs/subsystems/session.md`#the-request-header-event-requestheader | 源码+文档 | 让"每次请求是 log 的纯函数"，resume/fork 可精确重建 | 学 | **P0** |
| `assistant/message` 内嵌紧凑 timed stream | `types.ts:349`；`packages/llm/llm` 的 `AssistantStreamAccumulator`/`expandAssistantStream` | 源码+文档 | 一次落盘既有内容又有逐 delta 证据；record 级读取 O(records) | 学 | **P1** |
| `assistant/attempt`（失败/重试/取消也留证据） | `agent.ts:528-552`；`types.ts:363` | 源码 | 不编造模型可见历史，但重试链可审计 | 学 | **P1** |
| turn/step 循环与 enclosure 规则 | `agent.ts:333-435,441-620`；`docs/subsystems/session.md`#execution-enclosure-and-standalone-events | 源码+文档 | "turn 只包一次模型循环，不是整个 session" | 学 | **P0** |
| `TurnEndReason` 完整枚举 | `types.ts:206-238` | 源码 | completed/aborted/blocked/error/max-tokens/interrupted/forked 七态，max-tokens 粘性 | 学 | **P0** |
| guarded tool pipeline | `packages/core/tools/src/pipeline.ts:187-430`；`docs/tool-execution-pipeline.md` | 源码+文档 | 策略可插拔但权限只减 | 学 | **P0** |
| 单调 `ToolGuard`（无 allow 返回值） | `docs/subsystems/tools.md`#execution-extensible-waterfalls-plus-monotonic-policy；`pipeline.ts:214` | 源码+文档 | 监听器顺序不能把拒绝翻回允许 | 学 | **P0** |
| 参数进入策略前深冻结、不可重写 | `docs/subsystems/tools.md`（`ToolExecution`/`ToolDispatchExecution`） | 文档 | 历史/审计/UI/执行必须一致 | 学 | P0 |
| `ctx.approval` 一次性放行 + fail-closed | `packages/interaction/user-approval`；`pipeline.ts:442-492` | 源码+文档 | 只有 `allowed-once` 放行，缺失/异常一律拒绝 | 学 | P0 |
| `approval/asked` / `approval/decided` 审计对 | `docs/subsystems/approval.md` | 文档 | 审批可回放 | 学 | P0 |
| 审批策略 `ask`/`never` 作为会话事件 | `docs/subsystems/approval.md`（`approval/policy`） | 文档 | 策略写入 log，重放可重建 | 学 | P1 |
| sandbox 三模式 + enforcement 报告 | `docs/subsystems/sandbox.md`；`packages/sandbox/sandbox-local`(bwrap/landlock/seatbelt/win-acl) | 源码+文档 | 文件效果口径；`partial` 不许当 `full` | 学（模式与上报） | P1 |
| 凭据只存引用（`CredentialRef`） | `docs/subsystems/credentials.md`；`packages/credentials/credentials` | 源码+文档 | 配置里只有环境变量名，值由 provider 持有，按操作解析 | 学 | P1 |
| compaction 三事件 + 锁 | `docs/subsystems/compaction.md`；`packages/compaction/compaction/src/types.ts` | 源码+文档 | start/summary/end 括号，崩溃留可检测孤儿锁 | 学 | P1 |
| compaction 阈值/保留策略 | `packages/compaction/compaction-basic/src/config.ts:20,23`（0.8 / 0.16） | 源码 | 压力触发线 + 保留尾部比例 | 学（数值仅参考） | P1 |
| tool-result pruner（无模型裁剪） | `packages/compaction/compaction-tool-result-pruner` | 源码+文档 | 先做零成本裁剪，再考虑摘要 | 学 | P1 |
| image offload（超预算换占位符 + 重试） | `docs/subsystems/compaction.md`#image-offload；`LlmFailure.offloadImages` | 文档 | 图片历史按 routed request 计价 | 部分（我们主用文本） | P2 |
| spill（大输出落盘 + locator + 取回提示） | `docs/subsystems/spill.md`；`packages/spill/*` | 源码+文档 | 工具结果不整段进上下文 | 学 | P1 |
| token meter（可回放计量） | `docs/subsystems/token-meter.md`；`packages/llm/token-meter` | 文档 | 压缩压力、保留决策都依赖它 | 学 | P1 |
| checkpoint policy（请求前/副作用前 flush） | `packages/session/session-checkpoint-policy/README.md` | 文档 | 崩溃不丢请求与工具副作用；失败 fail-closed | 学 | P0 |
| 持久化代文件 + 迁移链 | `docs/architecture.md`#session-log；`packages/session/session-format-*` | 源码+文档 | 格式演进不改已提交文件 | 部分（分版本 + 只读旧版） | P1 |
| session projections | `packages/session/session-projection`；`docs/subsystems/session-projection.md` | 文档 | 从 log 折叠出 UI/业务视图，无第二份真相 | 学（概念） | P2 |
| 子代理 seam（能力标志 + 6 后端） | `docs/subsystems/subagent.md`；`packages/subagent/*` | 源码+文档 | 统一 `startActivation`，跨进程/同进程可换 | 部分（先做同进程） | P2 |
| Agent Teams 共享任务 DAG | `docs/subsystems/agent-team.md`；`packages/team/agent-team` | 文档 | 任务快照 + revision CAS + blockedBy 无环 | 部分（任务板思路） | P2 |
| plan mode（软约束） | `docs/subsystems/plan.md`；`packages/plan/plan-mode` | 源码+文档 | 计划是 log 状态 + 提示词 section，不是硬权限 | 学 | P2 |
| goal + goal-round-driver | `docs/subsystems/goal.md`；`packages/goal/goal-round-driver/src/index.ts` | 源码+文档 | 自动续轮用事件 attribution，不用定时器硬推 | 学 | P1 |
| schedule（Host 级 7 种时间语义） | `docs/subsystems/schedule.md`；`packages/schedule/*` | 文档 | 定时任务与 session 激活解耦 | 部分 | P2 |
| workflow（模型写编排脚本起子代理） | `docs/subsystems/workflow.md`；`packages/workflow/*` | 文档 | 编排是脚本 + 子代理 seam，不是新循环 | 部分 | P2 |
| MCP | `docs/subsystems/mcp.md`；`packages/mcp/*` | 文档 | 外部工具进同一注册表与同一流水线 | 部分 | P2 |
| skills | `docs/subsystems/skills.md`；`packages/skill/*` | 文档 | 技能是可加载指令，不是事件 | 部分 | P2 |
| browser-use / computer-use | `docs/subsystems/browser-use.md`、`computer-use.md` | 文档 | provider 只占一个注册槽，会话持有资源 | 不学（我们已有 browser.rs/pty.rs） | — |
| Typert / Remote / Web 客户端 | `packages/typert/*`、`packages/api/*`、`packages/client/*`(74) | 文档 | 类型驱动的前后端 RPC | 不学 | — |
| 运行期动态插件（extensions） | `docs/subsystems/extensions.md`；`packages/extensions/*` | 文档 | 模型可写插件并热装载 | 不学 | — |
| hooks 桥（Claude Code / Codex 协议兼容） | `packages/experimental/hook-protocol`、`hooks-*` | 文档 | 复用别人生态的 hook 配置 | 部分（事件点对齐即可） | P2 |

---

## 4. 可学 / 不可学

### 4.1 硬结论：只学事件边界，不采用插件树

**不采用 Cordis 插件树作为我们 engine 的核心。** 具体不引入：

1. **服务注入决定启动顺序**（`static inject = [...]`，服务存在才激活）。我们的启动顺序应该是显式的、可读的 `main`，而不是由依赖图推导。
2. **profile / bundle / patch 层叠配置**。任何一行实际配置要跨 3 层 patch 才能确定，这对我们是纯成本。
3. **声明合并扩展类型**（`declare module` 往 `SessionEventMap` 加事件）。我们的事件枚举应当集中定义、集中校验。
4. **HMR / 插件市场 / 运行期装载**（`packages/boot/hmr`、`plugin-manager`、`extensions`）。这不是我们当前要解决的问题。
5. **"每个能力都要三件套（Definition/Provider/Consumer）"的强制**。只在真正会换实现的地方做 seam（模型、沙箱、审批），不为统一而统一。

**只学这四类事件边界**（与插件树无关，可独立实现）：

- **session 层**：append-only log、`deriveMessages()`、surface + `replace`、`request/header` 快照、`assistant/attempt`。
- **turn/step 层**：turn 的开启条件（第一条输入被认领前）、关闭条件（没有 owed work）、step = 一次模型调用 + 它请求的工具；`turn/end` 的七种 reason；max-tokens 粘性；失败步补记未落盘的工具结果。
- **tool pipeline 层**：pre-execute 瀑布 → 单调 guard → approval(ask/allow-once) → around(超时) → body → project → post-execute(accept/block) → finalize → result 通知；参数不可重写；denied 也产出 `tool/result`（模型能看到拒绝原因）。
- **compaction 层**：start/summary/end 锁 + `user/message` 的 `replace` 遮挡 + 工具调用/结果配对校验 + 触发点绑在 `agent/pre-step` / `request-error`。

### 4.2 值得单独抄的"反直觉"设计

| 设计 | 为什么反直觉 | 为什么对 |
|---|---|---|
| guard 没有 allow 返回值 | 一般策略接口会返回 allow/deny | 监听器顺序就无法把拒绝翻回允许；拒绝是单调的 |
| 参数在策略前就冻结、禁止重写 | 一般 hook 喜欢"改写参数" | 历史、UI、审计、执行必须一致；要改就让模型重发 |
| 审批只给一次性放行 | 一般会缓存"以后都允许" | 缓存放行等于把权限交给上一次点击 |
| `max-tokens` 是整轮 reason，且粘性 | 一般只记在 step 上 | 用户需要区分"正常结束"与"被截断" |
| 失败的 assistant 流也落盘（`assistant/attempt`） | 一般失败就丢 | 重试链、token 计费、故障复盘都要证据 |
| 压缩用 replace 遮挡而不是删历史 | 一般直接改历史 | 回放完整、可审计、可对比压缩前后 |
| turn 边界不强制 flush | 一般"回合结束就存盘" | flush 是策略插件的职责，位置更精确（请求前/副作用前） |
| `session/end-seed` 边界标记 | 看起来很怪 | 用来区分"上一生命周期没关的锁"和"现在正在持锁"，否则孤儿锁无法判定 |

### 4.3 明确不为所动的部分

- **UI/渲染生态**（74 个 client 包、slot 体系、dock 布局）：与我们的前端哲学无关，不读不抄。
- **实验包**（65 个）：默认不装载，接口不稳，只作为"他们试过什么"的清单。
- **Remote/Typert**：类型驱动的 RPC 生成，收益在大型多端团队，我们的 Tauri command 已经够用。

---

## 5. 映射到我们 engine

现状（我读到的我们这边）：`app/src-tauri/src/engine/journal.rs` 的 `EngineEventKind` 目前是 **run_started / round_started / tool_started / tool_finished / approval_requested / approval_resolved / retry_scheduled / run_finished / run_failed**，且注释明确"只存元数据和脱敏参数摘要，绝不存 API key 或完整文件内容"。`docs/ENGINE-V2.md` 的硬规则也写了"日志不写完整文件内容或完整命令输出"。

也就是说：**我们的 journal 目前是 trace，不是 source of truth**。它无法重建"模型看到了什么"，所以 resume/fork/压缩/审计都只能靠 UI 状态或重放模型调用。这是与 DSH 最大的结构性差距。

处理这个冲突的办法：**在本地磁盘把 log 分成两层**

- **可重建层（source of truth，本地私有）**：模型可见内容必须完整（user/assistant/tool 的结果内容），这层允许大；它只在 `$APP_DATA/sessions/<task>/` 下，不上传、不进 UI 日志、不发给第三方。
- **可分享层（脱敏 trace）**：现有 `journal.rs` 的行为保持不变，继续用于 UI 时间线、bug 报告、上传/导出。

两者从同一 append 点写出，派生规则只有一份（对应 DSH 的 `deriveMessages`）。这样既不违反我们"不写完整文件内容到日志"的安全规则（那条规则的对象是可分享日志），又拿到了可重建性。

### 5.1 事件映射表

| DSH 事件 | 我们现在 | 建议动作 | 优先级 |
|---|---|---|---|
| `turn/start` `turn/end{reason}` | `RunStarted` / `RunFinished{stop_reason}`（不等价：我们没有 turn 概念） | 引入 turn 边界；`stop_reason` 换成七态枚举（completed/aborted/blocked/error/max-tokens/interrupted/forked） | P0 |
| `step/start` `step/end` | `RoundStarted`（只有 start） | 补 `round_ended`，round 定义为"一次模型调用 + 它请求的工具" | P0 |
| `user/message` | 无（只在内存） | 新增：模型可见用户输入 + 注入上下文（含 source 区分人工/系统/目标续轮） | P0 |
| `assistant/message` | 无（只有 `usage` 在 run_finished） | 新增：内容 + provider/model + **紧凑 timed stream** | P0 |
| `assistant/attempt` | 无 | 新增：失败/重试/取消的流证据 | P1 |
| `tool/call` | `ToolStarted{name,args}` | 补 `call_id`，并让参数快照**可重建**（脱敏只作用于可分享层） | P0 |
| `tool/result` | `ToolFinished{output_chars}` | 改为 `{call_id, content, is_error, meta}`：模型看到的就是它 | P0 |
| `request/header` | 无 | 新增：provider/model/effort/max_tokens + 工具 schema 快照（resume 后请求必须可重建） | P0 |
| `system/message` | 无（system prompt 现场拼） | 新增：system prompt 作为 surface 节点落盘（变更才追加/替换） | P1 |
| `approval/asked` `approval/decided` | `ApprovalRequested` / `ApprovalResolved{allow}` | 补请求 id 配对、一次性放行语义、拒绝码（rejected/cancelled/unavailable） | P0 |
| `compaction/start` `summary` `end` | 无（`engine/context.rs` 只做头尾裁剪） | 新增三事件 + replace 遮挡 | P1 |
| `spill`（非事件，服务） | 无 | 大结果落盘 + locator + 取回提示，替换"直接截断" | P1 |
| `goal/change` | `goal.rs` 自有实现（57KB） | 对齐 `phase`+`revision` CAS + round attribution，避免与 journal 双写 | P1 |
| `plan/mode` | 无 | 若要计划模式，做成 log 状态 + prompt section | P2 |
| `team/task`、`subagent/*` | 无 | 先只做同进程子代理 + 任务板 | P2 |

### 5.2 模块落点建议（不改现有目录结构）

| 能力 | 落点 | 说明 |
|---|---|---|
| 事件表与派生 | `engine/journal.rs` 拆分：`journal/event.rs`（枚举 + seq/ts 封装）→ `journal/derive.rs`（`derive_messages()`） | 保持 append-only + 单写锁，沿用现有 `WRITE_LOCK`/`SEQ` |
| 会话持久化 | 新增 `engine/session_store.rs` | 分代文件 + 只读旧版；`session-format` 思路但只需 1～2 个版本 |
| 请求组装 | 新增 `engine/request.rs` | 产出 `request_header`；模型路由沿用 `engine/deepseek.rs` |
| 流式 | `dsml.rs` / `frozen.rs` 之上加 `engine/stream.rs` | 记录 timed stream，产出 `assistant_message` |
| 工具流水线 | `engine/tool_pipeline.rs` + `engine/policy.rs` | 现有已是"统一执行入口"，补 guard 单调性 + post 决策 + `tool_result` 落盘 |
| 审批 | `engine/policy.rs` + `sandbox.rs` | fail-closed + 一次性放行 + 审计事件 |
| 沙箱 | `sandbox.rs` | 引入三模式与 `full/partial` 上报 |
| 压缩 | `engine/context.rs` 升级为 `engine/compact.rs` | replace 遮挡 + 配对校验 + 阈值触发 |
| 目标/续轮 | `goal.rs` | 用 turn-stopping 等价的钩子决定是否继续，不用定时器 |

### 5.3 落地顺序

1. **P0-a 事件表**：把 `journal.rs` 的枚举扩成"可重建"集合，先把 `tool_call/tool_result/request_header/user_message/assistant_message/turn/step` 落盘，加 `derive_messages()` 与一个测试：**给定一份 log，重建出的请求与运行时请求逐字段相等**。
2. **P0-b 流水线语义**：guard 改为单调（不可 allow）、审批 fail-closed 且只放一次、拒绝也要产出 `tool_result`（模型能看到原因）。
3. **P0-c 检查点**：请求前、顶层工具产生副作用前做 flush；flush 失败则不执行。
4. **P1-a 压缩**：`compaction/start|summary|end` + `replace` 遮挡 + 工具配对校验；先做无模型裁剪（tool-result pruner 思路），再做摘要。
5. **P1-b spill + token meter**：大结果落盘；token 计量可回放。
6. **P2**：子代理（同进程 fork/spawn）、任务板、workflow 脚本、MCP、skills —— 都在事件与流水线稳定之后。

---

## 6. 实际读过的关键文件

仓库内（`D:\卡塞尔学院\research-src\deepseek-harness`）：

文档：

- `docs/architecture.md`（全文）
- `docs/tool-execution-pipeline.md`（全文）
- `docs/subsystems/session.md`（第 1–300、300–560、690–890 行）
- `docs/subsystems/system-prompt.md`（全文）
- `docs/subsystems/core.md`（第 1–520、840–1140 行）
- `docs/subsystems/tools.md`（第 1–640 行）
- `docs/subsystems/llm-streaming.md`（第 160–340、340–460 行）
- `docs/subsystems/compaction.md`（全文）
- `docs/subsystems/spill.md`（全文）
- `docs/subsystems/plan.md`、`goal.md`、`agent-team.md`、`subagent.md`（前 90 行 + 目录结构）
- `docs/subsystems/sandbox.md`、`approval.md`、`credentials.md`、`mcp.md`、`skills.md`、`browser-use.md`、`computer-use.md`、`workflow.md`、`schedule.md`（各前 40–70 行）
- `docs/subsystems/README.md`（子系统索引）
- `docs/cordis-primer.md`（全文）
- 包 README：`packages/boot/app-boot/README.md`、`packages/preset/agent-preset/README.md`、`packages/session/session-checkpoint-policy/README.md`

源码：

- `packages/core/session/src/types.ts`（事件表、TurnEndReasonMap、surface 类型、EpochHeader）
- `packages/core/session/src/index.ts`（append、deriveMessages、end-seed）
- `packages/core/session/src/surface.ts`（surfaceOp 判定与 replace）
- `packages/core/agent-loop/src/agent.ts`（`turn()` 333–435、`step()` 441–620）
- `packages/core/agent-loop/src/index.ts`（AgentLoop Service、inject、maxParallelToolCalls）
- `packages/core/tools/src/index.ts`（ToolsService、inject）
- `packages/core/tools/src/pipeline.ts`（pre-execute / checkGuards / approval / tools/execute / finalizeContent / tools/result）
- `packages/compaction/compaction-basic/src/config.ts`（默认 0.8 / 0.16）
- `packages/goal/goal-round-driver/src/index.ts`（轮次 attribution）
- `packages/bundle/base/package.json`、`packages/bundle/base/cordis.patch.yml`（前三段）

清单统计：

- `packages/` 下 53 个包组（`workspace` 组未在分组总表单列）、382 个 package.json；全部包的 `name` + `description` 已导出并用于第 1 节表格。

工作区（`D:\卡塞尔学院\repo`，仅用于对齐映射，未修改）：

- `docs/ENGINE-V2.md`、`docs/ENGINE-BENCHMARK.md`（前 40 行）
- `app/src-tauri/src/engine/journal.rs`（`EngineEventKind` 定义与脱敏逻辑）
- `app/src-tauri/src/` 文件清单

## 7. 本次修改的文件

只改了一个文件：

- `D:\卡塞尔学院\repo\docs\source-analysis\deepseek-harness.md`（本文件，整篇重写）

未提交、未推送；未改动其他任何文件。

