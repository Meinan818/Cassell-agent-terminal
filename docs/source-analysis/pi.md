# Pi 源码级分析

- 源码：`D:\卡塞尔学院\research-src\pi`
- 快照：`main` / `827383a`（2026-11-13）/ 4,546 个受控文件
- 许可：MIT
- 分析方式：只读源码与仓库内文档。**未运行** `npm run build` / `npm test`（本机没有装这套依赖），所以下文所有“已确认”都指源码证据，不代表跑通；需要跑起来的结论我单独标了“未验证”。

## 1. 摘要

Pi 可以一句话概括为：**一个刻意做小的 agent 内核，加一圈互相不糊在一起的包，再加一个把权限和安全边界甩给外面的安全观。**

三条结论：

1. **它的价值在包边界，不在功能数量。** `pi-ai`（模型与协议）、`pi-agent-core`（循环、事件、工具执行）、`pi-durable`（会话/任务/文档持久化）、`pi-coding-agent`（CLI、会话、扩展、工具）、`pi-tui`（终端渲染）五层各自独立；`packages/agent/src` 只有 6 个文件、2,315 行，是整个仓库里最值得逐行读的地方。
2. **它的工具协议是我们最该抄的部分。** 结构化 `AgentToolResult`（`content` / `details` / `structuredContent` / `usage` / `isError` / `terminate`）、`beforeToolCall` / `afterToolCall` 两个钩子、`sequential | parallel` 两种批量执行模式（还能按单个工具覆盖）、批量 `terminate` 提前收敛、`QueueMode`（`all` / `one-at-a-time`）两种插话投递方式。这套东西直接对应我们现在 `exec_tool(...) -> String` 的短板。
3. **它故意不做权限。** `SECURITY.md` 和 `packages/coding-agent/docs/security.md` 都明说：没有内置 sandbox、不会每次工具调用都问批准，安全边界交给容器 / 虚拟机 / 外部沙箱和“用户账号本身的权限”。这一条我们**不能照搬**——我们的 `engine/tool_pipeline.rs` 审批卡和 `sandbox.rs` 的 `SandboxLevel` / `ApprovalLevel` 恰恰是 Pi 缺的那块。

还有一条容易搞错的：Pi **默认不带** sub-agents 和 plan mode。这两个都在 `packages/coding-agent/examples/extensions/`（`subagent/`、`plan-mode/`）里当示例扩展，核心运行时里没有它们的调度。而我们的 plan 模式是写死在 `engine/tool_pipeline.rs`（`run_mode == "plan"` 时拦住写操作）里的。所以“Pi 有而我们没有”的前提不成立，不该拿 Pi 的最小功能集当我们功能表的基线。

## 2. 包清点

`packages/` 共 12 个包，全部锁定同一版本 `1.5.2`，用 npm workspaces 串起来（根 `package.json` 的 `workspaces`）。

| 包目录 | npm 名 | 入口 / 主要导出 | 职责 | 规模（src，行） |
|---|---|---|---|---|
| `ai` | `@earendil-works/pi-ai` | `src/index.ts`（core，注释声明 side-effect free） | 统一多 provider LLM API、模型目录、OAuth、图片与分类器 API | — |
| `agent` | `@earendil-works/pi-agent-core` | `src/index.ts` → `agent-loop.ts`、`agent.ts` | agent 循环、事件、工具执行、状态、队列 | 2,315 |
| `durable` | `@earendil-works/pi-durable` | `src/index.ts`（另有 18 个子路径导出） | 会话 / 任务 / 文档持久化运行时、harness、存储适配器 | 33,363 |
| `coding-agent` | `@earendil-works/pi-coding-agent` | `bin.pi = dist/bundle/cli.js`；`src/index.ts` 是 SDK | CLI、四种界面、会话管理、扩展、内置工具 | 71,386 |
| `tui` | `@earendil-works/pi-tui` | `src/index.ts`（无 `exports` 字段，走 `main`） | 差分渲染终端 UI 库与组件 | — |
| `chord` | `@earendil-works/chord` | `src/index.ts` + 26 个子路径 | 跨进程对象运行时：文档、增量、watch、SQLite、HTTP、workers、插件热重载、sync | — |
| `codemode` | `@earendil-works/pi-codemode` | `src/index.ts` | QuickJS-WASI 沙箱，唯一能力是调用注入的工具 | — |
| `mcp` | `@earendil-works/pi-mcp` | `src/index.ts`、`./oauth`、`./testing` | 独立 MCP 客户端（stdio / pipe / streamable-http / in-memory） | — |
| `telemetry` | `@earendil-works/pi-telemetry` | `src/index.ts`、`./render`、`./testing` | 厂商中立的 span / trace / metrics 契约，零依赖 | — |
| `schema` | `@earendil-works/pi-schema` | `src/index.ts`、`./formats` | JSON Schema（draft 2020-12 / 7）校验，编译成普通闭包、不用 `eval`，附类型构造器 | — |
| `env` | `@earendil-works/pi-env` | `src/index.ts` | SSH 远程执行环境：daemon 部署 + `RemoteExecutionEnv` 客户端 | — |
| `evals` | `@earendil-works/pi-evals` | `evals/*.eval.ts` + `src/` | vitest-evals 行为评测；带 docker 双镜像（`without_docs` / `with_docs`）算“文档增益” | — |

表中 `—` 表示本轮只核对了入口/职责，没有逐行统计；`chord/src` 实测约
56,461 行，和 `coding-agent` 是同一量级，不能因为“不是核心”就当成小包。

`apps/` 三个：`p2`（Web 桌面客户端）、`p2-mac`（Swift 壳）、`p3`（docs 站）。这三个是产品壳，不属于运行时，本次不展开。

几个包的要点（都能在源码里对到）：

- **`ai`**：`src/index.ts` 只导出 core，provider 工厂在 `@earendil-works/pi-ai/providers/*`，API 实现在 `api/*`，旧全局 API 在 `compat`。`src/providers/` 下是 **43 个 provider 实现 + 43 个模型目录**（97 个 `.ts` = 43 实现 + 43 个 `*.models.ts` + `all.ts` + 10 个支撑文件，`images/` 另算；openai、anthropic、google、bedrock、mistral、groq、xai、deepseek、moonshot、qwen、zai、github-copilot……）。`src/types.ts` 是协议中心：`AssistantMessage`、`ToolResultMessage`、`TranscriptContext`、`AssistantMessageEvent`、`Usage`、`StopReason`。口径见 `pi-appendix.md` §1.1。
- **`agent`**：六个文件——`agent-loop.ts`（循环与工具执行）、`agent.ts`（`Agent` 类：状态、队列、监听器、生命周期）、`types.ts`（全部公开类型与 `AgentEvent`）、`stream-fn.ts`（默认 stream 函数注入）、`proxy.ts`、`index.ts`。
- **`durable`**：`createSession(storage)` 起一个会话内核（文档 + 事务 + 提交 + watch），`harness/` 是上层（agent 文档、任务调度、工具任务、压缩任务、inbox），`storage/` 有 memory / jsonl / sqlite / indexeddb 四种后端，`env/` 接远程执行，`tools/` 是一套自带的 read/bash/edit/write 实现。
- **`coding-agent`**：`main.ts`（参数解析 + 模式选择）、`config.ts`（路径与环境变量）、`core/`（会话、设置、模型运行时、扩展、工具、压缩）、`modes/`（interactive / print / json / rpc）。`index.ts` 是 SDK 面，导出 400 多个符号。
- **`coding-agent/core` 四个产品级子系统**：`package-manager.ts`（2,656 行，npm 安装/升级、`PI_OFFLINE`、`PackageInstallFailure`）、`resource-loader.ts`（1,191 行，资源发现）、`skills.ts`（430 行，`SKILL.md` frontmatter/`parseFrontmatter`）、`export-html`（707 行）。这四项说明 Pi 不只是“最小 CLI”，还有包/扩展/技能/导出的完整边缘层。
- **`tui`**：纯渲染库，`tui-main-screen.ts` / `tui-alt-screen.ts` 是主屏与备用屏两套差分渲染器，另有原生修饰键模块、终端图片（`terminal-image.ts`）、OKLCH 配色、markdown（`marked` + `marked-cjk-friendly`）。
- **`codemode`**：`runtime/execution.ts` 的注释把设计讲得很干净——host 拥有工具表、调用记录、输出、deadline、abort，VM 只交换消息；VM 可跑在 worker 线程（`CodemodeSandbox`）、调用线程（`InlineCodemodeSandbox`）或远端 isolate（`RemoteCodemodeSandbox`）。
- **`mcp`**：`McpClient` + 传输层 + `protocol/`（JSON-RPC、content、tools）。工具命名统一为 `mcp__<server>__<tool>`（`src/naming.ts`），超长或撞名用 sha256 前 8 位兜底。
- **`schema` / `telemetry`**：都是“契约包”，零运行时依赖，专门给其他包当底座，不掺业务。
- **`env`**：`ssh.ts` / `connection.ts` / `remote-env.ts`，把执行环境抽象拉到 SSH 后面，daemon 走 `deployDaemon()`。
- **`evals`**：不是单元测试，是行为评测。`*.docs.eval.ts` 对比“给文档 / 不给文档”的任务完成率。
## 3. 关键调用链

### 3.1 CLI 启动链（`packages/coding-agent/src/main.ts`）

```text
main()
 ├─ parseArgs()                                  cli/args.ts
 ├─ resolveAppMode()                             main.ts:115        rpc | json | print | interactive
 ├─ runMigrations() / SettingsManager.create()   migrations.ts / core/settings-manager.ts
 ├─ createSessionManager()                       core/session-manager.ts
 ├─ createAgentSessionRuntime(createRuntime)     core/agent-session-runtime.ts   main.ts:929
 │    └─ createAgentSessionServices()            core/agent-session-services.ts（settings/model/resource）
 │    └─ createAgentSessionFromServices()        core/sdk.ts
 │         └─ new AgentSession({ agent, sessionManager, ... })
 │              └─ new Agent({ streamFn, convertToLlm, ... })   core/sdk.ts
 └─ 分流：runRpcMode() | new InteractiveMode().run() | runPrintMode()
```

模式判定很简单（`main.ts:115`）：`--mode rpc` → rpc，`--mode json` → json，`--print` 或 stdin/stdout 不是 TTY → print，否则 interactive。`--help`、`--list-models` 走“元数据命令”短路，不接管 stdout。

`config.ts` 是另一条必须知道的线：`APP_NAME` / `CONFIG_DIR_NAME` 从 `package.json` 的 `piConfig` 读（`config.ts:602-611`），配置目录 `~/.pi/agent`（可用 `PI_CODING_AGENT_DIR` 覆盖），里面固定有 `auth.json`、`models.json`、`settings.json`、`sessions/`、`tools/`、`prompts/`、`themes/`、`bin/`。也就是说 Pi 的配置是**约定目录**，不是一堆散装环境变量。

### 3.2 agent loop 主链（`packages/agent/src/agent-loop.ts`）

```text
Agent.prompt()                                   agent.ts:382
 └─ runWithLifecycle()                           agent.ts:517   建 AbortController，置 isStreaming
     └─ runAgentLoop(prompts, ctx, config, emit, signal, streamFn)   agent-loop.ts:111
         ├─ declareToolChanges()                 agent-loop.ts:342  工具增减 → system 消息
         ├─ emit agent_start / turn_start / message_start|end（初始消息）
         └─ runLoop()                            agent-loop.ts:172
             ├─ 外层 while(true)                  有 follow-up 就继续
             │   └─ 内层 while(hasMoreToolCalls || pendingMessages)
             │       ├─ prepareNextTurn(ctx)      压缩 / 系统提示 / 工具装载刷新
             │       ├─ 注入 prepared + queued 消息（message_start/end，入 context）
             │       ├─ prepareRequest(ctx)       虚拟模型路由、会话投影、阈值压缩
             │       ├─ streamAssistantResponse() agent-loop.ts:390
             │       │    ├─ transformContext → convertToLlm → normalizeContext
             │       │    ├─ getApiKey(provider)  短时 OAuth token 每轮重取
             │       │    └─ streamFn(model, TranscriptContext)
             │       │         → for await(AssistantMessageEvent): start / *_delta / done|error
             │       ├─ stopReason 为 error/aborted → finishTurn → turn_end → agent_end，退出
             │       ├─ 取 content 里的 toolCall → executeToolCalls()   agent-loop.ts:518
             │       ├─ 工具结果入 context 与 newMessages
             │       ├─ finishTurn(turn) → { action: "continue" | "end" | undefined }
             │       └─ emit turn_end；continue 则下一轮
             └─ 无工具、无 steering → getFollowUpMessages()，有则继续，无则 agent_end
```

几个细节值得记：

- 事件的“流”是 `EventStream<AgentEvent, AgentMessage[]>`，终止条件写死在 `createAgentStream()`（`agent-loop.ts:162`）：`type === "agent_end"`，终值取 `event.messages`。UI 只要订阅这一个流就能拿到全量。
- `stopReason === "length"` 时**不执行任何工具调用**：全部按失败处理（`failToolCallsFromTruncatedMessage`，`agent-loop.ts:488`）。理由写在注释里——流式 JSON 尽力修复后可能“能解析但内容被截断”，执行了更危险。这是个成本很低、收益明显的设计。
- 系统提示和工具声明都放在 transcript 的 system 消息里，不放在 `context.systemPrompt` / `context.tools`。工具增删靠 `declareToolChanges()` 算出 `toolsAdded` / `toolsRemoved` 差量，追加一条 system 消息；重放 transcript 就得到“当前提示 + 当前工具集”。

### 3.3 工具执行的三种路径

`executeToolCalls()`（`agent-loop.ts:518`）先判断：配置是 `sequential`，或者**这批里任何一个工具自己声明了 `executionMode: "sequential"`**，整批走串行；否则走并行。

- **串行**（`executeToolCallsSequential`，`:540`）：每个调用按 开始事件 → 预处理 → 执行 → 收尾 → 结束事件 → 结果消息 的顺序走完，再下一个。
- **并行**（`executeToolCallsParallel`，`:592`）：先**按顺序**逐个做预处理（`beforeToolCall` 只会顺序发生，所以审批不会一次冒出五个），把允许执行的那些包成 thunk，再 `Promise.all` 真并发。`tool_execution_end` 按**完成顺序**发出（谁先干完谁先报），但工具结果消息最后按 **assistant 原文顺序**发。这个“执行乱序、记录有序”对 UI 很友好。
- **嵌套调用**（`runToolCall`，`:814`）：导出给工具内部用（codemode 脚本里 `tools.xxx()` 就靠它），走完全相同的流程（参数准备、schema 校验、before/after 钩子），保证“权限检查对二级调用也生效”。它不抛异常，失败一律变成 `isError: true` 的结果。

单次调用的状态机：`prepareToolCall()`（`:708`）→ `executePreparedToolCall()`（`:824`，用 `performance.now()` 记 `durationMs`，`onUpdate` 回调把部分结果推成 `tool_execution_update`）→ `finalizeExecutedToolCall()`（`:862`，应用 `afterToolCall`）→ `createToolResultMessage()`（`:933`）。

`prepareToolCall` 的顺序讲究：`signal.aborted` 先判（已中止就跳过钩子，但仍产出一条 “Operation aborted” 结果；注释点名 issue #9986，不能有调用没结果）→ 找工具（找不到就 “Tool xxx not found”）→ `prepareArguments`（兼容层，把历史脏参数修成合规形状）→ `validateToolArguments`（schema 校验）→ `beforeToolCall`。

### 3.4 事件模型（`packages/agent/src/types.ts` 的 `AgentEvent`）

```text
agent_start
turn_start
  message_start | message_update（仅 assistant 流式）| message_end
  tool_execution_start | tool_execution_update | tool_execution_end
  （toolResult 也走一遍 message_start / message_end）
turn_end  { message, toolResults }
agent_end { messages }
```

约定写得很明确：

- `agent_end` 是最后一个事件，但 `Agent` 要等**所有 await 过的订阅回调 settle** 才算 idle（`agent.ts` 的 `isStreaming` 注释 + `runWithLifecycle`）。
- `message_update` 只对 assistant 消息发，载荷是原始 `AssistantMessageEvent`（`text_delta` / `thinking_delta` / `toolcall_delta` 等），转发时不做二次加工。
- `tool_execution_end` 带 `isError` 和 `durationMs`，但不含“结果消息”；结果消息是另一个 `message_start/end`。这样 UI 可以“执行完先给结束态”，再等消息落库。

### 3.5 `Agent` 类（`packages/agent/src/agent.ts`）

- 状态：`messages`、`tools`、`model`、`thinkingLevel`、`isStreaming`、`streamingMessage`、`pendingToolCalls`、`errorMessage`。`systemPrompt` 是只读派生值（从 transcript 首条 system 消息重放）。
- 队列：`PendingMessageQueue`（`agent.ts:149`），`peek()` / `drain()` 按 `QueueMode` 决定取 1 条还是全取。`steer()` 是“当前轮做完就来”，`followUp()` 是“agent 本来要停了再来”。
- 生命周期：`prompt()`（不能重入）、`continue()`、`abort()`、`waitForIdle()`、`reset()`（保留提示与工具基线）、`subscribe()`。
- 兜底：`handleRunFailure()`（`agent.ts:542`）把异常也包装成一条 `stopReason: "error" | "aborted"` 的 assistant 消息，并补发 `message_start/end`、`turn_end`、`agent_end`。所以**失败也有完整事件序列**，UI 不需要写“异常分支”。
### 3.6 `pi-ai` 的请求边界

- `TranscriptContext` 是带 brand 的类型，只有 `normalizeContext()` 能造（`packages/ai/src/types.ts`；它把 `systemPrompt` / `tools` 折叠进首条 system 消息）。目的是让“没归一的 Context”在类型层面就进不了 provider 代码。
- `SystemMessage` 支持 `content`、`sections`（按名字替换 / 删除，`null` 删除）、`toolsAdded`、`toolsRemoved`。这是“对话中途改提示、改工具集”的正规做法。
- `AssistantMessage` 自带 `api`、`provider`、`model`、`responseModel`、`usage`（含 `cost`）、`stopReason`（`pending | stop | length | toolUse | error | aborted | deferred`）、`errorMessage`、`durationMs`、`thinkingLevel`。所以“这条消息谁生成的、多少钱、为什么停”都在消息里，不靠旁路日志。
- 流协议：`start` → `*_start` / `*_delta` / `*_end` → `done` | `error`，并且约定“`done`/`error` 之前必须有 `start`”。`partial` 是**共享的活动对象**而不是快照：`*_start` 时该块为空，靠 `*_delta` 长出来，`*_end` 才是权威值。
- `ToolResultMessage` 里有 `details`、`usage`、`nestedCalls`（工具内部又调了哪些工具，留给会话记录、不给模型）、`isError`、`durationMs`。
- `stopReason: "deferred"` + `DeferredHandle` 是给“提交后过一会儿取结果”的批处理型 provider 留的口子，本地循环可以不实现。

### 3.7 `durable`：会话与任务的持久化内核

- `createSession(storage, options)`（`packages/durable/src/session/session.ts`）开一个会话内核：文档（`defineDoc`）、事务（`tx`）、提交（commit，带 seq、观察者、telemetry）、延迟落盘（`persistWithinMs`，默认 1,000 ms）、文档保留期（默认 10 分钟）。存储后端可换：`storage/memory`、`storage/jsonl`、`storage/sqlite`、`storage/indexeddb`。
- 上层 `harness` 才是“把 agent 跑起来”的那层：`AgentDoc`（`harness/agent.ts:47`，`kind: "pi.agent"`、`history: "rewindable"`、`fork: "asOf"`）、`Harness`、任务图（`task-graph.ts`）、调度器（`scheduler.ts`，148 KB，这块最重的文件）、工具任务（`tool.ts`，带 checkpoint 与 `replay: "never" | "safe"`）、压缩任务（`compaction.ts`）、收件箱（`inbox.ts`）、转录视图（`transcript.ts`）。
- 默认策略常量（`harness/agent.ts:23-41`）可以直接当参数基准：重试 3 次、基础退避 2,000 ms、最大 60,000 ms；压缩保留 16,384 token、保留最近 20,000 token、后台阈值 32,768；进度推送 100 ms、落盘 1,000 ms。
- 它和 `coding-agent` 是**两套并存**的实现：`coding-agent` 自己的会话是 JSONL 树（`core/session-manager.ts`），`durable` 是文档 + 提交模型。两条线都在仓库里活着，谁也没替谁。

### 3.8 `coding-agent` 的会话、压缩与扩展

- 会话是**树**：每条 entry 有 id 和 parent，当前 entry 决定活跃分支；`buildSessionProjection()` 把分支投影成模型可见消息。压缩不是删历史，而是插一条 `CompactionEntry` 摘要，后续请求用它替换旧消息，原始 entry 保留（`core/compaction/compaction.ts`：`contextTokens > contextWindow - reserveTokens`，默认 `reserveTokens: 16384`、`keepRecentTokens: 20000`）。
- `AgentSession`（`core/agent-session.ts`，170 KB）是胶水层，把 `Agent` 的钩子全包了一遍：
  - `_installAgentToolHooks()`（`:715`）把 `beforeToolCall` / `afterToolCall` 转给扩展的 `tool_call` / `tool_result` 处理器；
  - `_installAgentRequestProjection()`（`:850`）在每次请求前用会话投影替换消息、处理虚拟模型路由；
  - `_installAgentBoundaryHooks()`（`:949`）把 `finishTurn` 变成扩展的 `turn_end` 边界事件（可以返回 `continue` 让 agent 再来一轮）；
  - `_installAgentNextTurnRefresh()`（`:961`）在轮次之间做阈值压缩 + 系统提示 / 工具装载刷新。
- 扩展不是插件进程，而是**同进程 TypeScript 模块**（`core/extensions/`，`docs/extensions.md` 158 KB）。事件面很大：`project_trust`、`resources_discover`、`session_*`（start/switch/fork/compact/tree/shutdown）、`context`、`before_provider_request`、`after_provider_response`、`provider_stream_event`、`before_agent_start`、`agent_start` / `agent_end` / `agent_settled`、`turn_start` / `turn_end`、`message_*`、`tool_execution_*`、`tool_call` / `tool_result`、`user_bash`、`input`。这是“把一切可干预点都变成事件”的极端版本。
- 内置工具只有四个：`read`、`bash`、`edit`、`write`（`DEFAULT_TOOL_NAMES`，`core/settings-manager.ts`），另有 `ls` / `grep` / `find` / PowerShell 变体。工具结果截断由工具自己负责：`DEFAULT_MAX_LINES = 2000`、`DEFAULT_MAX_BYTES = 50 * 1024`（`core/tools/truncate.ts`）。

### 3.9 四种界面入口

| 入口 | 源码 | 行为 |
|---|---|---|
| interactive | `modes/interactive/interactive-mode.ts`（260 KB）+ `pi-tui` | 全屏 TUI，订阅 `AgentSession` 事件渲染 |
| print | `modes/print-mode.ts` | 单发，只出最终文本；带信号处理、背压、子进程清理 |
| json | `modes/print-mode.ts` + `modes/json-event.ts` | 每条 agent 事件一行 JSONL |
| rpc | `modes/rpc/rpc-mode.ts` + `rpc-types.ts` + `rpc-client.ts` | stdin 收 JSONL 命令，stdout 出响应与事件 |
| SDK | `src/index.ts` + `core/sdk.ts` | 进程内 `createAgentSession()`，同一套 `AgentSession` |

RPC 命令清单在 `modes/rpc/rpc-types.ts:20-74`，可以当“程序化控制 agent 该提供哪些动作”的清单用：`prompt`（带 `streamingBehavior: "steer" | "followUp"`）、`steer`、`follow_up`、`abort`、`clear_queue`、`new_session`、`fork`、`clone`、`switch_session`、`get_state`、`set_model` / `cycle_model`、`set_thinking_level`、`set_steering_mode` / `set_follow_up_mode`、`compact` / `set_auto_compaction`、`set_auto_retry`、`bash` / `abort_bash`、`get_session_stats`、`export_html`、`get_entries` / `get_tree`。

### 3.10 TUI 与引擎的分离程度

`pi-tui` 完全不知道 agent 存在：它只提供 `TUI`、`VStack` / `HStack`、`ScrollView`、`Editor`、`Markdown`、`SelectList`、差分渲染（主屏 / 备用屏两套）、键位绑定、OKLCH 配色、终端图片。`coding-agent` 的 `modes/interactive/` 才是“怎么把事件画成界面”的部分。**引擎 → 事件 → UI** 这条线是单向的：`pi-tui` 里没有一处 import `pi-ai` 或 `pi-agent-core`，它的依赖只有 `get-east-asian-width`、`marked`、`marked-cjk-friendly`。
## 4. 功能矩阵

“优先级”是**对我们**的建议等级：P0 = 直接影响正确性 / 安全，P1 = 明显体验收益，P2 = 有余力再做，P3 = 记录备查。

| # | 功能 | 源码证据 | 用途 | 可学 | 优先级 |
|---|---|---|---|---|---|
| 1 | agent 事件流（`AgentEvent` union + `EventStream`） | `agent/src/types.ts`、`agent-loop.ts:162` | UI 只订阅一个流就能画全过程；失败也有完整序列 | 是 | P0 |
| 2 | 串行 / 并行两种批量执行 | `agent-loop.ts:518,540,592` | 只读工具真并发，写与命令必须串行；结果消息仍按原文顺序 | 是 | P1 |
| 3 | 单工具 `executionMode` 覆盖 | `types.ts` 的 `AgentTool.executionMode`，判断在 `:526` | 一个“必须独占”的工具就能把整批降级为串行 | 是 | P2 |
| 4 | `QueueMode`（`all` / `one-at-a-time`） | `types.ts`、`agent.ts:149-180`，默认 `one-at-a-time`（`:255`） | 用户连打三条时，是合成一轮还是逐条来，可配置 | 是 | P1 |
| 5 | `steer` / `followUp` 双队列 | `agent.ts:308,313`、`agent-loop.ts:304,311` | “边跑边插话”和“跑完再说”分开 | 是 | P1 |
| 6 | `beforeToolCall`（`block` / `reason` / `terminate`） | `types.ts`、`agent-loop.ts:737-765` | 审批、路径闸、风险策略都挂这里；被拦时回一条错误工具结果而不是静默跳过 | 是 | P0 |
| 7 | `afterToolCall`（字段级替换 + `structuredContent` 联动丢弃） | `types.ts`、`agent-loop.ts:873-905` | 结果改写、图片归一、脱敏、截断集中一处 | 是 | P1 |
| 8 | 结构化 `AgentToolResult` | `types.ts`、`agent-loop.ts:933` | `content` 给模型、`details` 给 UI、`structuredContent` 给程序、`usage` 给计量、`isError`/`terminate` 给控制流 | 最该学 | P0 |
| 9 | 批量 `terminate` | `agent-loop.ts:690` | 只有**全部**结果都标 `terminate` 才提前收敛，避免一条工具越权叫停 | 是 | P2 |
| 10 | abort 贯穿到工具 | `:718`（先判 aborted）、`:623`、`:747` | 中止后每个调用仍有结果，不留“没有结果的调用” | 是 | P1 |
| 11 | `stopReason === "length"` 全量失败 | `agent-loop.ts:276,488` | 被截断的参数绝不执行，避免半截命令 | 是 | P1 |
| 12 | 工具装载差量（system 消息 `toolsAdded` / `toolsRemoved`） | `agent-loop.ts:342`、`ai/src/types.ts` 的 `SystemMessage` | 换模式 / 换工具集不用重建上下文 | 学思路 | P2 |
| 13 | `prepareRequest` / `prepareNextTurn` / `finishTurn` 三钩子 | `types.ts`、`agent-loop.ts:194,228,295` | 压缩、路由、提示刷新、扩展“再来一轮”都挂这里 | 是 | P1 |
| 14 | 多 provider 统一协议 | `ai/src/providers/*`（43 个 provider 实现）、`api/*`、`types.ts` 的 `KnownApi` | 一套消息 / 事件 / usage，换模型不改上层 | 只学接口 | P2 |
| 15 | 模型目录 + 能力元数据 | `ai/src/providers/*.models.ts`、`Model.inputLimits` | 上下文窗口、图片上限、thinking 等级都来自目录 | 学思路 | P2 |
| 16 | usage / cost 挂在消息上 | `ai/src/types.ts` 的 `AssistantMessage.usage` | 计量不靠旁路日志拼 | 是 | P1 |
| 17 | `deferred` 停止原因 | `ai/src/types.ts` 的 `DeferredHandle` | 批处理型 provider 异步取结果 | 用不上 | P3 |
| 18 | durable 会话内核（文档 + 事务 + 提交 + watch） | `durable/src/session/session.ts`、`documents.ts` | 多端一致、可回放、可 fork | 结构可学，实现别搬 | P2 |
| 19 | 会话 JSONL 树 + 投影 | `coding-agent/src/core/session-manager.ts` | 分支、fork、回退、压缩都基于不可变 entry | 学思路 | P2 |
| 20 | 压缩为“插摘要 entry” | `core/compaction/compaction.ts` | 不删历史，只改模型可见投影 | 是 | P2 |
| 21 | 扩展事件总线（40+ 事件） | `core/extensions/types.ts` | 一切可干预点事件化 | 只要三五个 | P3 |
| 22 | MCP 客户端（独立包、零 pi 依赖） | `mcp/src/client.ts`、`transports/*` | 工具生态接入 | 可单独引用 | P3 |
| 23 | codemode（QuickJS，仅暴露工具） | `codemode/src/runtime/execution.ts` | 模型写代码批量调工具，能力面收敛 | 学设计 | P3 |
| 24 | print / json / rpc / sdk 四入口 | `modes/*`、`core/sdk.ts` | 同一引擎多种外壳 | 我们已有等价物 | P3 |
| 25 | TUI 与引擎彻底分离 | `tui/src/index.ts` 无 agent import | 渲染是可复用的纯库 | 前端已定版 | P3 |
| 26 | project trust（项目资源加载前先问） | `core/project-trust.ts`、`docs/security.md` | 防“clone 下来就执行扩展” | 概念可学 | P2 |
| 27 | 无内置权限系统 | `SECURITY.md`、`docs/security.md`、`docs/how-pi-works.md` | 安全边界外置 | 不学 | — |
| 28 | 不自带 sub-agents / plan mode | `examples/extensions/subagent/`、`examples/extensions/plan-mode/` | 示例扩展，不在核心 | 不当基线 | — |

## 5. 可学 / 不可学

### 5.1 该学的（按我们的顺序）

1. **结构化工具结果 + 两个钩子。** 投入产出比最高的一块。现在我们的工具返回 `String`，“成功 / 失败 / 给 UI 的细节 / 给程序的字段”全糊在一段中文里，`engine/tool_pipeline.rs` 里每个 handler 还得自己判断要不要审批、路径对不对。Pi 的做法是：结果是结构体，策略在钩子里，handler 只管干活。
2. **事件模型，尤其是“失败也有完整序列”。** `handleRunFailure()` 把异常兜成一条 assistant 消息 + 完整事件，UI 就不用写“如果崩了怎么办”。我们 `journal.rs` 现在只有 `run_started / round_started / tool_started / tool_finished / approval_* / retry_scheduled / run_finished / run_failed`，缺 message 级与工具进度级。
3. **并行只做“只读 + 显式声明”。** Pi 默认是 `parallel`，但允许单工具强制整批串行——“保守的默认 + 明确的例外”比“一律并行”安全。我们可以更保守：默认串行，只读工具白名单并行。
4. **`length` 截断一律不执行。** 成本几乎为零，收益是避免“参数过半就动手”。
5. **差量声明工具集。** 不重建上下文，只追加一条“新增 / 移除工具”的系统消息。
6. **两种排队语义。** `steer` / `followUp` 分开是产品级细节：用户“打断纠正”和“排个活”是两种意图，混在一起要么打断太狠，要么永远插不进去。
7. **会话与投影分离。** 存不可变 entry 树，发投影。压缩、fork、回退、分享全都自然成立。

### 5.2 不该学的

1. **没有权限系统。** `SECURITY.md` 原文：“It's the responsibility of the user to monitor its operations or to contain it within a container, virtual machine or other Sandbox solution.” `docs/security.md` 更直白：“it does not ask for approval before every tool call.” 这在 CLI 自助工具里是合理取舍（用户自己承担），在桌面应用里不行——我们的用户不会为了改个文件去开容器。我们的 `sandbox.rs` + 审批卡是**必须保留的差异**，不是待补齐的债。
2. **把“最小功能集”当功能表。** 没有 sub-agents、没有 plan mode、没有 goal、没有 checkpoint 倒带，全靠扩展补。我们的 `goal.rs`、plan 模式、checkpoint 是产品必需，不是“多余复杂度”。
3. **`chord` 那套跨进程对象运行时。** 设计很讲究（文档、增量、watch、sync、插件热重载），但它是为“同一份会话在终端 / 网页 / 多设备上同构”服务的。我们没有那个场景，抄进来只会变成第二套状态管理。
4. **43 个 provider 的实现。** 我们只需要接口 + 能力表 + 一两个 adapter。
5. **同进程 TypeScript 扩展 + 40 个事件。** 它靠“同进程”换来极强可塑性，代价是扩展等于全权限（`SECURITY.md` 自己也认了）。我们要做插件的话，事件面必须小、权限面必须显式。
6. **`p2` / `p2-mac` / `p3` 与整个交互层。** 前端已定版，不碰。

### 5.3 灰区（先记录，别急着做）

- **`durable` 的文档 + 提交模型**：思想好（会话是文档、提交可 watch、可回放），但 Rust 侧我们已经有 `journal.rs` 的 append-only JSONL。真要升级，应该是“在 JSONL 之上加 entry 树 + 投影”，而不是引入一整套文档内核。
- **project trust**：概念该有（项目里的配置 / 扩展不能一 clone 就执行），但我们没有“项目级可执行扩展”这种攻击面，优先级低于审批与路径闸。
- **codemode**：确实省 token、也确实收敛能力面，但要先有稳定的工具协议才谈得上“批量调工具”。
## 6. 对我们 engine 的映射

现状（`app/src-tauri/src/`）：

```text
engine/journal.rs        运行事件 JSONL（EngineEventKind）
engine/retry.rs          408/429/5xx/超时 有上限重试
engine/deepseek.rs       DeepSeek reasoning_effort 与参数适配
engine/context.rs        工具结果头尾裁剪
engine/modes.rs          NORMA/Cowork 与 EVA/Code 的 profile
engine/tooling.rs        tool_definitions(run_mode, mode)
engine/policy.rs         destructive_command / catastrophic_command
engine/tool_pipeline.rs  审批卡 + exec_tool(...) -> String
agent.rs                 对话循环、流式解析、工具编排
sandbox.rs               SandboxLevel / ApprovalLevel / join_path
goal.rs                  目标、检查点、倒带
```

逐项映射：

| Pi 的机制 | 我们的落点 | 建议动作 | 优先级 |
|---|---|---|---|
| `AgentToolResult` 结构体 | `engine/tool_pipeline.rs` 的 `exec_tool -> String` | 改成 `ToolOutcome { ok: bool, content: String, details: Value, structured: Option<Value>, duration_ms: u64 }`；所有 handler 统一返回它，中文提示保留在 `content` | **P0** |
| `beforeToolCall` | 现有的授权闸 / 路径闸 / 风险闸 / 审批卡（都在 `exec_tool` 内部） | 抽成 `pre_exec(tool, args) -> Allow \| Block { reason }` 链，顺序固定：授权 → 路径（`sandbox::join_path`）→ 风险（`policy::*`）→ 审批（`request_approval`）；handler 里不再出现任何判断 | **P0** |
| `isError` 区分 | 现在的“读取失败：…”“当前是只读模式…”都是普通文本 | `ToolOutcome.ok = false`，UI 才敢用红色，模型才知道要换个法子 | **P0** |
| 失败也有完整事件序列 | `journal.rs` 的 `run_failed` | 保证任何路径（含异常、取消、审批超时）都落一条终态；`run_finished { cancelled, stop_reason }` 已有，补齐失败前已发生的工具结果引用 | **P0** |
| `afterToolCall` | 无 | 加 `post_exec`：图片归一、长输出二次截断、敏感串脱敏集中处理 | P1 |
| `agent_start` / `turn_start` / `tool_execution_update` | `journal.rs` 只有 round / tool 级 | 增加 `tool_progress { name, partial }`（长命令流式回显）与 message 级事件，UI 不再靠轮询猜状态 | P1 |
| `sequential \| parallel`（只读并行） | 全串行 | 给 `tooling.rs` 的工具定义加 `exec_mode` 字段；只读类（`read_file` / `list_dir` / `grep`）可并行，`write_file` / `edit` / `run_command` 强制串行；一个串行工具即降级整批 | P1 |
| `QueueMode` + `steer` / `followUp` | 无（跑的时候只能等或取消） | 用户中途说话：默认 `one-at-a-time` 的 `steer`，在工具批次之间注入；纯排队用 `followUp` | P1 |
| `finishTurn` 的 `continue \| end` | `agent.rs` 轮次控制隐式 | 显式二值决策，避免 UI 用“没有新事件了”推断结束 | P1 |
| `stopReason === "length"` 不执行 | 未确认有防护 | 解析出 toolCall 后先看 stop_reason，`length` 时全部返回失败并提示重发 | P1 |
| `usage` / `cost` 挂在消息上 | `usage.rs` 已有汇总 | 把单条 assistant 消息的 usage 一并写进 journal，便于按轮排查 | P1 |
| 工具装载差量（system 消息） | `modes.rs` + `tooling.rs` 固定集合 | 切模式时用一条 system 消息声明 `+tool` / `-tool`，而不是重建上下文 | P2 |
| 会话 entry 树 + 投影 | 会话在前端 / 内存 | 引入 `session/`：entry 带 `parent_id`，`projection()` 产出模型可见消息；配合 `goal.rs` 的 checkpoint | P2 |
| 压缩“插摘要 entry”（16,384 / 20,000） | `engine/context.rs` 只做头尾裁剪 | 加“摘要 entry 替换旧消息”，原始 entry 保留；阈值抄 Pi 的默认值做起点 | P2 |
| `terminate` 提前收敛 | 无 | 灾难命令（`catastrophic_command` 命中）后整批收敛并停轮 | P2 |
| 多 provider 接口 + 能力表 | `engine/deepseek.rs` 单点 | 抽 `Provider` trait（请求 / 流事件 / usage / 能力），DeepSeek 只做一个实现 | P2 |
| RPC / JSONL 无头入口 | Tauri command | 加一个 stdout JSONL 模式，方便脚本与评测复用同一引擎 | P3 |
| MCP / codemode | 无 | 先不接；要接时 `pi-mcp` 是独立包，可直接参考协议层 | P3 |

**明确不做的**：不要为了“对齐 Pi”去删审批、删只读模式、删 plan 模式；不要引入 `chord` / 文档提交内核；不要把 TUI 换成 `pi-tui`。

一句话收口：**Pi 教我们的是“把工具结果做成结构、把策略做成钩子、把状态做成事件”，不是“把功能做少”。**

## 7. 实际读过的关键文件

运行时源码（`D:\卡塞尔学院\research-src\pi`）：

- `packages/agent/src/agent-loop.ts`（全文，952 行）
- `packages/agent/src/types.ts`（全文）
- `packages/agent/src/agent.ts`（全文）
- `packages/agent/src/index.ts`、`packages/agent/src/stream-fn.ts`（导出面与默认 stream 注入）
- `packages/ai/src/index.ts`、`packages/ai/src/types.ts`（`SystemMessage` / `AssistantMessage` / `ToolResultMessage` / `TranscriptContext` / `AssistantMessageEvent` 段）
- `packages/ai/package.json`；`packages/ai/src/providers/`、`packages/ai/src/api/`（目录级清点）
- `packages/durable/src/index.ts`；`packages/durable/src/harness/agent.ts`（前 120 行）；`packages/durable/src/session/session.ts`（`createSession` 与文件头）；`packages/durable/src/`（目录级清点）
- `packages/coding-agent/src/main.ts`（启动链与模式分流，重点 115、702-712、793-1065）
- `packages/coding-agent/src/config.ts`（路径与环境变量段，595-681）
- `packages/coding-agent/src/index.ts`（SDK 导出面）
- `packages/coding-agent/src/core/agent-session.ts`（关键段 480-1000：钩子安装与事件投影）
- `packages/coding-agent/src/core/sdk.ts`（`CreateAgentSessionOptions`）
- `packages/coding-agent/src/core/settings-manager.ts`（`DEFAULT_TOOL_NAMES`）
- `packages/coding-agent/src/core/tools/truncate.ts`（截断阈值）
- `packages/coding-agent/src/core/compaction/compaction.ts`（阈值与保留策略）
- `packages/coding-agent/src/core/session-manager.ts`（entry 联合类型与 `SessionProjection`）
- `packages/coding-agent/src/core/extensions/types.ts`（`ExtensionAPI`、`ExtensionEvent`）
- `packages/coding-agent/src/modes/print-mode.ts`、`packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `packages/tui/src/index.ts`（导出面）
- `packages/mcp/src/index.ts`、`packages/mcp/src/naming.ts`、`packages/mcp/src/transports/`（目录级）
- `packages/codemode/src/index.ts`、`packages/codemode/src/runtime/execution.ts`、`packages/codemode/src/runtime/inline.ts`
- `packages/schema/src/index.ts`、`packages/telemetry/src/index.ts`、`packages/env/src/index.ts`、`packages/evals/README.md`
- 根 `package.json`、`SECURITY.md`、各包 `package.json`

仓库内文档（作为交叉核对，不是主要依据）：

- `packages/coding-agent/docs/security.md`、`packages/coding-agent/docs/how-pi-works.md`、`packages/coding-agent/docs/containerization.md`（提及）
- `packages/coding-agent/examples/extensions/subagent/README.md`、`packages/coding-agent/examples/extensions/plan-mode/README.md`

对照我们自己的代码（只读，未修改）：

- `app/src-tauri/src/engine/mod.rs`、`engine/journal.rs`、`engine/tool_pipeline.rs`、`engine/tooling.rs`、`engine/policy.rs`
- `app/src-tauri/src/sandbox.rs`（`SandboxLevel` / `ApprovalLevel` / `join_path`）
- `docs/ENGINE-V2.md`

**本次唯一修改的文件**：`D:\卡塞尔学院\repo\docs\source-analysis\pi.md`（覆盖原有占位版）。未提交、未推送，未改动 `research-src` 下任何内容。
