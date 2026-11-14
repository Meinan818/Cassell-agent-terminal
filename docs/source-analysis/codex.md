# Codex（codex-rs）源码级分析

> 快照：`D:\卡塞尔学院\research-src\codex`，分支 `main`，提交 `6ddb87e`（2026-11-14），Apache-2.0
> 方法：直接读 `codex-rs/` 的目录、`lib.rs` 导出、类型/枚举、关键函数与测试文件名；不以 README 作为唯一依据
> 证据等级：**[源码]** 读到实现或导出；**[README]** 仅文档声明；**[未核实]** 未读到实现或未运行验证
> 实测规模：workspace members **207** 个（`codex-rs/Cargo.toml`）；`codex-rs` 顶层目录 **127** 个；`.rs` 文件 **6,036**；`#[test]`/`#[tokio::test]` 标记 **26,471** 处（正则统计）

## 0 摘要

1. Codex 不是"一个 CLI 文件 + 循环"，而是 **207 个 crate 的 Rust workspace**。真正的产品复杂度不在 prompt，而在 `core`（988 个文件 / 496,847 行）这一层把 **turn 循环、工具管线、审批、沙箱、上下文、压缩、持久化** 各自拆成了独立模块。
2. 最值得学的五个机制，按对我们的价值排序：
   - **压缩（compact）是一个独立生命周期**，不是"截断 + 摘要"：独立的 `TurnItem::ContextCompaction`、pre/post 钩子、替换整段 history、保留最近 N 条真实用户消息、写回窗口号/window_ids/response_id/model_hash 元数据（`core/src/compact.rs`）。
   - **工具调用是一条统一管线**：审批要求判定 → 首跑（沙箱内）→ 命中 sandbox denied → 按策略再审批 → **只升级重跑一次** → 埋 `sandbox_outcome`（`core/src/tools/orchestrator.rs` + `core/src/tools/sandboxing.rs`）。
   - **命令策略是独立 crate**，规则是 Starlark 写的 `prefix_rule(pattern=[...], decision="allow")` / `network_rule(...)`，且审批通过后可以**把用户批准的规则写回规则文件**（`codex-rs/execpolicy`，`core/src/exec_policy.rs:append_amendment_and_update`）。
   - **模型可见的"世界状态"分节管理**：每节有稳定 ID、typed snapshot、diff 渲染、补丁式更新，只在变化时把新片段发给模型（`core/src/context/world_state/mod.rs`）。
   - **持久化与"存储无关接口"分离**：`rollout`（JSONL + 压缩 + 索引）与 `thread-store`（`ThreadStore` trait，本地/内存两实现）分开，`ThreadId` 是唯一对外句柄。
3. 不值得照抄的：云任务/账号/计费/attestation、远程控制（remote control + 配对码）、realtime 语音链路、V8 Code Mode、Windows 提权沙箱（需要独立服务 + ACL 供给 + WFP 防火墙规则）、guardian 自动审批（需要独立审查模型 + 评分校准）。
4. 对我们的 `engine/`，P0 只有四条：**压缩生命周期**、**上下文 token 预算与截断分层**、**结构化命令规则（可写回）**、**会话 resume**。其余都是 P1/P2。
5. 我们已有的 `tool_pipeline.rs`（审批卡 + journal）方向与 Codex 一致，缺的是 **"审批结果缓存 + 沙箱拒绝后只重试一次 + 拒绝原因回给模型"** 这三个具体机制。
6. 产品级任务层不能漏：`core/src/tasks/` 用 `SessionTask`/`TaskKind` 把 regular、review、compact 三类任务分开；`user_shell`（会话内 `!` 直跑）是独立任务实现，但 `kind()` 仍返回 `Regular`，不是第四种 `TaskKind`（详见 `codex-appendix.md` §1.2）。另有 `codex review` 独立 review 线程（`cli/src/main.rs`、`core/src/session/review.rs`）。这说明 Codex 的 turn 不是一个单循环，而是“任务种类 + 子任务生命周期”的组合。

## 1 全量模块清点

### 1.1 体量最大的几个 crate（实测行数）

| crate / 目录 | rs 文件 | 行数 | 角色 |
|---|---:|---:|---|
| `tui` | 1,265 | 484,104 | 终端 UI（渲染/交互/主题） |
| `core` | 988 | 496,847 | 会话、turn、工具、上下文、压缩、审批、多代理 |
| `app-server` | 392 | 206,868 | JSON-RPC 服务端（本地/daemon/远控） |
| `ext`（18 个扩展 crate） | 355 | 85,301 | goal/memories/skills/mcp/guardian/image-gen 等 |
| `exec-server` | 204 | 68,721 | 执行后端（本地/远程环境、PTY、文件系统） |
| `core-plugins` | 101 | 48,975 | 插件运行时与内置插件 |
| `cli` | 109 | 41,555 | CLI 入口与子命令 |
| `thread-store` | 81 | 38,032 | 线程持久化抽象 + 本地实现 |
| `app-server-protocol` | 75 | 35,886 | 协议类型（v1/v2）+ TS/JSONSchema 导出 |
| `network-proxy` | 76 | 33,604 | 受管网络代理（域名允许/拒绝、凭据注入） |
| `protocol` | 93 | 32,576 | 跨 crate 的协议/模型类型 |
| `codex-mcp` | 72 | 31,791 | MCP 客户端、连接池、catalog |
| `state` | 73 | 28,730 | SQLite 状态库（threads/goals/memories/logs） |
| `windows-sandbox-rs` | 121 | 28,360 | Windows 沙箱后端（AppContainer/受限令牌/ACL/WFP） |
| `rollout` | 45 | 18,194 | 会话 JSONL 记录、压缩、索引、迁移 |
| `hooks` | 40 | 16,070 | 14 类钩子事件、命令/MCP 执行器 |
| `sandboxing` | 33 | 11,415 | 跨平台沙箱选择与命令改写（seatbelt/landlock/bwrap/Windows） |

### 1.2 127 个顶层目录（原始清单，供核对）

```text
agent-graph-store            agent-identity              agent-message-board-client
agent-message-board-host     agent-roles                 analytics
ansi-escape                  app-server                  app-server-client
app-server-daemon            app-server-protocol         app-server-protocol-noop-macros
app-server-test-client       app-server-transport        apply-patch
arg0                         async-utils                 attachment-store
aws-auth                     backend-client              bwrap
build-info                   chatgpt                     cli
cloud-client                 cloud-config                cloud-tasks
cloud-tasks-client           cloud-tasks-mock-client     code-mode
code-mode-host               code-mode-protocol          code-mode-runtime
codex-api                    codex-backend-openapi-models codex-client
codex-experimental-api-macros codex-home                  codex-mcp
collaboration-mode-templates config                      config-schema
connectors                   context-fragments           core
core-api                     core-plugin-common          core-plugins
diagnostics                  direct-tool-timing          docs
exec                         exec-server                 exec-server-cli
exec-server-protocol         execpolicy                  ext
external-agent-migration     features                    feedback
file-search                  file-system                 file-watcher
git-utils                    guardian-context            history
hooks                        http-client                 http-headers-helper
install-context              keyring-store               linux-sandbox
lmstudio                     login                       memories
mermaid                      message-board               message-board-mcp
message-history              model-provider              model-provider-info
models-manager               mxc-sandbox                 network-proxy
ollama                       otel                        otel-trace-websocket
plugin                       plugin-host                 process-hardening
prompts                      protocol                    realtime-webrtc
response-debug-context       responses-api-proxy         rmcp-client
rollout                      rollout-trace               runtime-agent-instance
sandboxing                   scripts                     secrets
shell-command                skills                      state
stdio-to-uds                 tcp-tunnel                  terminal-detection
test-binary-support          thread-manager-sample       thread-store
tools                        tui                         uds
user-verification            utils                       v8-poc
vendor                       voice-host                  websocket-auth
websocket-client             windows-sandbox-rs          windows-sandbox-service
workload-identity            worktree
```

### 1.3 按 12 类归并

| 类别 | 主要 crate / 目录 | 关键入口（源码） |
|---|---|---|
| 运行 | `core`（`session/`、`tasks/`、`thread_manager.rs`、`codex_thread.rs`）、`exec`、`exec-server*`、`cli`、`shell-command`、`process-hardening`、`arg0`、`features`、`config*`、`models-manager`、`model-provider*`、`prompts`、`codex-home`、`utils/*` | `core/src/session/turn.rs:run_turn`、`core/src/thread_manager.rs`、`cli/src/main.rs` 的 `Subcommand` |
| 工具 | `tools`（schema 层）、`apply-patch`、`file-search`、`file-system`、`code-mode*`、`response-debug-context`、`core/src/tools/*`、`core/src/unified_exec/*` | `core/src/tools/spec_plan.rs:build_tool_router`、`core/src/tools/registry.rs:dispatch_any_with_state` |
| 权限 | `sandboxing`、`linux-sandbox`、`bwrap`、`mxc-sandbox`、`windows-sandbox-rs`、`windows-sandbox-service`、`execpolicy`、`network-proxy`、`secrets`、`keyring-store`、`process-hardening`、`core/src/exec_policy.rs` | `sandboxing/src/manager.rs`、`execpolicy/src/parser.rs`、`core/src/tools/orchestrator.rs:run` |
| 会话 | `rollout`、`thread-store`、`history`、`state`、`message-history`、`attachment-store`、`core/src/session/*`、`core/src/session_prefix.rs` | `thread-store/src/store.rs:ThreadStore`、`rollout/src/recorder.rs`、`history/src/lib.rs:InitialHistory` |
| 上下文/压缩 | `context-fragments`、`core/src/context/*`、`core/src/context_manager/*`、`core/src/compact*.rs`、`core/src/agents_md.rs`、`memories*`、`ext/memories`、`codex-home` | `core/src/context/world_state/mod.rs`、`core/src/compact.rs`、`core/src/session/context_window.rs` |
| 扩展 | `codex-mcp`、`rmcp-client`、`plugin`、`plugin-host`、`core-plugin-common`、`core-plugins`、`ext/extension-api`、`skills`、`hooks`、`connectors`、`message-board*`、`collaboration-mode-templates` | `ext/extension-api/src/lib.rs`、`skills/src/lib.rs`、`hooks/src/lib.rs` |
| 多代理 | `agent-roles`、`agent-identity`、`agent-graph-store`、`agent-message-board-*`、`runtime-agent-instance`、`core/src/agent/*`、`ext/agent`、`message-board*` | `core/src/agent/control/spawn.rs`、`core/src/tools/handlers/multi_agents_spec.rs` |
| 工作区 | `worktree`、`file-watcher`、`file-search`、`git-utils`、`utils/git-discovery`、`core/src/environment_selection.rs`（2,556 行）、`exec-server` 的 environment 模块 | `worktree/src/lib.rs:WorktreeManager`、`core/src/environment_selection.rs` |
| 观测 | `analytics`、`otel`、`otel-trace-websocket`、`rollout-trace`、`direct-tool-timing`、`diagnostics`、`core/src/turn_timing.rs`、`state/src/log_db.rs` | `otel/src/lib.rs:SessionTelemetry`、`analytics/src/lib.rs:CodexCompactionEvent` |
| UI/协议 | `app-server`、`app-server-protocol`、`app-server-transport`、`app-server-client`、`app-server-daemon`、`tui`、`protocol`、`exec-server-protocol`、`code-mode-protocol`、`ansi-escape`、`mermaid` | `app-server-protocol/src/protocol/common.rs`（`client_request_definitions!`）、`app-server/src/message_processor.rs` |
| 云/远控 | `cloud-client`、`cloud-config`、`cloud-tasks*`、`backend-client`、`codex-client`、`codex-api`、`chatgpt`、`login`、`aws-auth`、`workload-identity`、`websocket-auth`、`tcp-tunnel`、`external-agent-migration`、`realtime-webrtc`、`voice-host`、`responses-api-proxy`、`ollama`、`lmstudio` | `app-server-protocol/src/protocol/v2/remote_control.rs`、`cloud-tasks/src/lib.rs`、`app-server-daemon/src/lib.rs` |
| 安全 | `guardian-context`、`ext/guardian-reviewer`/`guardian-v2`/`guardian-v3`、`core/src/guardian/*`、`user-verification`、`secrets`、`keyring-store`、`core/src/safety.rs`、`core/src/attestation.rs`、`core/src/cyber_access_program.rs` | `core/src/guardian/mod.rs`、`core/src/safety.rs:assess_patch_safety`、`core/src/session_prefix.rs` |

### 1.4 测试证据（只引文件名与体量，不逐行读）

`core/tests/suite/` 下的集成测试是理解行为边界最快的地方，实测行数：

| 测试文件 | 行数 | 覆盖主题 |
|---|---:|---|
| `tests/suite/compact.rs` | 6,079 | 压缩触发/替换/保留/失败回退 |
| `tests/suite/compact_remote.rs` | 1,815 | 远端压缩协议与回退 |
| `tests/suite/hooks.rs` | 5,847 | 14 类钩子的匹配与阻断语义 |
| `tests/suite/approvals.rs` | 4,689 | 审批决策矩阵 |
| `tests/suite/unified_exec.rs` | 3,633 | PTY 会话、yield 时间、stdin 审批 |
| `tests/suite/network_approval.rs` | 3,729 | 域名级网络审批 |
| `tests/suite/guardian_review.rs` | 3,403 | 自动审批审查会话 |
| `tests/suite/step_settings.rs` | 3,119 | 每步设置解析 |
| `tests/suite/exec_policy.rs` | 1,151 | 规则匹配与 amendment |
| `tests/suite/multi_agent_mode.rs` | 678 | 多代理模式开关 |
| `tests/suite/tool_parallelism.rs` | 377 | 并行工具调用与取消 |

单测文件同样密集：`core/src/session/tests.rs` 12,794 行、`core/src/config/config_tests.rs` 13,155 行、`core/src/agent/control_tests.rs` 5,967 行、`core/src/tools/spec_plan_tests.rs` 3,244 行、`core/src/mcp_tool_call_tests.rs` 3,657 行。**[源码]**

## 2 关键调用链

### 2.1 从入口到 turn 主循环

```text
cli/src/main.rs (Subcommand::{Exec,AppServer,Resume,Mcp,...})
  → core::ThreadManager (thread_manager.rs, 3,174 行)
      → Session::spawn / initialize (session/mod.rs:658 / :699)
          → CodexThread (codex_thread.rs, 1,438 行；start_or_steer_turn :555, steer_turn :709)
              → session::turn::run_turn (session/turn.rs:217)
                  → 前压缩：run_pre_sampling_compact (:1552) / maybe_run_previous_model_inline_compact (:1596)
                  → 记录世界状态：record_step_world_state_if_changed
                  → run_sampling_request (:1895) → 流式事件 → 工具调用
                  → 后处理：context_window_token_status → async_compaction::maybe_start
                            → 需要续跑时 run_auto_compact (:1687) 或投递 pending input
```

要点（[源码]）：`run_turn` 内是一个 `loop {}`，判断"是否需要下一轮"来自 `SamplingRequestResult.needs_follow_up`（模型要求继续调工具）**或** `has_pending_input`（用户中途插话）。压缩按 `CompactionPhase::{PreTurn,MidTurn,PostTurn,StandaloneTurn}` 四相位触发，`run_auto_compact` 里再按 provider 能力分流到 `TokenBudget` / `RemoteCompactionSupport::V2` / 本地 `compact.rs`。

### 2.2 单个工具调用的完整链路

```text
ToolRouter::build_tool_call (tools/router.rs:278)
  → ToolCallRuntime::handle_tool_call (tools/parallel.rs:108)
      → ToolRegistry::dispatch_any_with_state (tools/registry.rs:760)
          → 计账 active_turn.tool_calls++
          → 解析 live environment / 校验 payload 类型
          → apply_pre_tool_use (PreToolUse 钩子；可 Blocked/Failed/Cancelled)
          → 可选 review_native_tool_call（原生工具二次审查）
          → notify_tool_start
          → 工具.run → ToolOrchestrator::run (tools/orchestrator.rs:125)
              ① approval：ExecApprovalRequirement::{Skip|NeedsApproval|NeedsHumanApproval|Forbidden}
                 （tools/sandboxing.rs:160；默认值由 default_exec_approval_requirement:204 推导）
              ② sandbox_override_for_first_attempt (:257) → 选沙箱 SandboxManager::select_initial
              ③ run_attempt → 失败且 details == SandboxErr::Denied 时：
                   - 不允许/不可升级 → 直接返回 denial（保留原始输出）
                   - 允许 → 重新 request_approval(retry_reason) → 只在 SandboxType::None 重跑一次
                   - 埋 otel.sandbox_outcome("denied"|"escalated")
          → run_post_tool_use 钩子 → notify_tool_finish
```

审批要求的来源顺序（[源码]）：`tool.exec_approval_requirement(req)`（沙箱型工具走 `ExecPolicyManager::create_exec_approval_requirement_for_command_platform`）→ 否则 `default_exec_approval_requirement(policy, filesystem_policy)`。`AskForApproval::{Never,OnRequest,UnlessTrusted,Granular}` 与 `Granular{sandbox_approval, rules}` 两级开关是分开的。

### 2.3 上下文组装：prefix / 分节世界状态

```text
Session::capture_step_context_with_required_mcp_servers
  → Session::build_world_state_for_step → WorldState 各 section.render_diff(previous_snapshot)
      → SectionTransition { snapshot: Option<Value>, updates: Vec<WorldStateUpdate> }
      → Placement::{Prefix, Standalone, Mergeable}（split_prefix_updates 拆分）
  → ContextManager::record_annotated_items（带 CodexHarnessMetadata 的 history）
  → ContextManager::for_prompt → 模型请求
```

[源码] `WorldStateSection` trait（`core/src/context/world_state/mod.rs`）要求：`const ID: &'static str`（写进 rollout，必须稳定）、`type Snapshot`（只存比较所需数据、不能序列化成 null）、`render_diff(previous) -> SectionTransition`。示例实现 `AgentsMdState`（`context/world_state/agents_md.rs`）在 AGENTS.md 变更时发 "These AGENTS.md instructions replace all previously provided..." 这样的显式替换声明，而不是靠模型猜。

### 2.4 压缩链路

```text
触发：context_window::context_window_token_status → token_limit_reached
      | async_compaction 候选就绪 | 用户手动压缩 (Manual) | 模型 comp_hash 变化
  → compact::run_inline_auto_compact_task / run_compact_task (Manual)
      → run_compact_task_inner
          → PreCompact 钩子（Stopped → TurnAborted）
          → run_compact_task_inner_impl
              → 以 SUMMARIZATION_PROMPT（或 config.compact_prompt）发起一次普通模型请求
              → 遇 ContextWindowExceeded：history.remove_first_item() 并从头部重试（保前缀缓存）
              → summary = SUMMARY_PREFIX + 末条 assistant 消息
              → build_compacted_history：保留 always-retained 项 + 最近 user 消息（预算 20,000 token）
              → 重新注入 prefix + 世界状态（assemble_compaction_history）
              → Session::replace_compacted_history(metadata{window_number, window_ids,
                    compaction_response_id, compaction_model_hash, input_goal_ids})
          → PostCompact 钩子
  → 埋 CodexCompactionEvent（strategy = Memento, phase, trigger, reason, tokens before/after）
```

### 2.5 会话持久化与恢复

```text
RolloutRecorder（rollout/src/recorder.rs, 2,151 行）→ JSONL 行 = {timestamp, ordinal, item}
  → compression.rs（1,317 行）：zstd 压缩 + 可读原始 JSONL 物化
  → list.rs / session_index.rs / state_db.rs：索引、按 id/name 查找、SQLite 元数据
  → thread-store::ThreadStore trait：存储无关；本地实现 local/mod.rs (2,287 行)
       - read_thread.rs、rollout_lineage.rs、thread_history/*（分页、搜索、realtime 订阅）
       - rollout_migration.rs (1,363 行)：旧格式迁移 + 回滚计划
  → history::InitialHistory::{New, Resumed, Forked} → Session::record_initial_history
```

### 2.6 多代理派发

```text
模型调 multi_agent_v1.spawn_agent（tools/handlers/multi_agents/{spawn,send_input,wait,close_agent}.rs）
  → agent::control::spawn::LocalAgentControl（control/spawn.rs, 1,227 行）
      → 角色应用 agent/role.rs:apply_role_to_config（只做"受限覆盖"，不能扩大父会话权限）
      → child_config 派生、fork 历史（prepare_forked_history）、昵称分配（assets/agent/agent_names.txt）
      → 注册到 agent/registry.rs（383 行）+ agent-graph-store（父子关系）
      → 完成时用 session_prefix::format_inter_agent_completion_message 生成"用户角色但不是用户意图"的完成消息
```

## 3 功能矩阵

图例：**P0** 当前硬缺口且可 1–2 天独立落地；**P1** 明显提升可靠性/可观测但不阻塞功能；**P2** 规模化后才需要；**不做** 与产品形态冲突或成本远超收益。

### 3.1 运行

#### 3.1.1 Turn 主循环（`session/turn.rs:run_turn`）— P0
- 是什么：一个 turn 内包含"前置压缩 → 记上下文 → 采样 → 工具 → 判断续跑 → 压缩/继续"的完整闭环，直到不需要 follow-up 或达到 token 上限。
- 证据：`core/src/session/turn.rs:217,1552,1687,1895`；`SamplingRequestResult{needs_follow_up, mailbox_preempted, last_agent_message}`；`model_needs_follow_up || has_pending_input` 决定续跑。
- 能学：把"是否继续"变成显式返回值，而不是靠 handler 自己再发一次请求；每轮捕获一次 `StepContext`（模型、工具表、权限、环境）作为**同一次请求的唯一视图**，避免"上下文/工具/执行"三处各算一遍。
- 不能学：`Mailbox` 抢占、`pending_input` 延迟注入等多人协作语义，我们单窗口用不到。
- 优先级：P0（我们的 `agent.rs` 1,490 行里 loop 与工具执行仍耦合）。

#### 3.1.2 StepContext / TurnContext 双层快照 — P1
- 是什么：`TurnContext` 存跨步骤稳定状态，`StepContext` 存"这一步的模型/工具/环境/设置快照"，工具调用只读快照。
- 证据：`core/src/session/step_context.rs`（106 行）、`step_settings.rs`（314 行 + 472 行测试）、`core/src/tools/spec_plan.rs:build_tool_router`。
- 能学：工具执行时不再回查全局可变状态，避免"审批时看到的权限"与"执行时实际权限"不一致。
- 不能学：其 `settings` 解析链（多层 config 合并 + requirement 覆盖）对我们是过度设计。
- 优先级：P1。

#### 3.1.3 重试与错误分类（`responses_retry.rs`）— P1
- 是什么：只对瞬时错误做有上限重试，`RetryAfter` 支持服务端给定的截止时间；`CodexErrorDetails` 枚举区分 `ContextWindowExceeded / TurnAborted / Interrupted / UsageLimitReached / Sandbox{Denied}` 等。
- 证据：`core/src/responses_retry.rs`（200 行）、`core/src/compact_model_fallback.rs`、`core/src/compact.rs` 里 `Err(e) if matches!(e.details(), ContextWindowExceeded)` 分支。
- 能学：错误先分类再决定"重试 / 压缩 / 终止 / 回给模型"，我们的 `retry.rs`（91 行）目前只有状态码判断。
- 不能学：provider 级 `stream_max_retries()`、sticky routing、websocket 增量请求跟踪。
- 优先级：P1。

### 3.2 工具

#### 3.2.1 工具注册表与执行面（`tools/registry.rs`、`tools` crate）— P0
- 是什么：`ToolSpec::{Function, Namespace, ToolSearch, WebSearch, Freeform}`（`tools/src/tool_spec.rs:22`）+ `ToolExposure::{Direct, Deferred, DeferredModelOnly, DirectModelOnly, CodeModeOnly, Hidden}`（`tools/src/tool_executor.rs:51`）+ `CoreToolRuntime` trait（`core/src/tools/registry.rs:65`）把"规格、暴露面、执行、钩子、遥测、diff"叠在一个 trait 上。
- 证据：上述路径；`dispatch_any_with_state`（registry.rs:760）是唯一派发入口；`ToolRegistry::{register_trusted, register_external, record_collision}` 区分内置工具与第三方工具，命名冲突显式记录。
- 能学：① 内置工具与 MCP/动态工具走**同一接口**，但用 `is_third_party_tool()` 区分严格策略；② 工具名带 namespace（`ToolName{namespace,name}`），避免 `mcp__server__tool` 字符串拼接。
- 不能学：`ToolSearch` BM25 检索式工具发现、Code Mode 嵌套暴露，属于规模化后才需要。
- 优先级：P0（我们 `tooling.rs` 117 行只有 schema 表）。

#### 3.2.2 并行工具调用与取消（`tools/parallel.rs`）— P1
- 是什么：按 `router.tool_supports_parallel(&call)` 决定并行；每个调用独立 `CancellationToken`，取消后仍会写回一条 `aborted_response`（含耗时），保证 transcript 里每个 call_id 都有输出。
- 证据：`core/src/tools/parallel.rs:108,167,493,504`；测试 `core/tests/suite/tool_parallelism.rs`（377 行）、`parallel_trace_tests.rs`。
- 能学：**取消也要产出结果项**，否则下一轮模型请求会缺 tool_result 导致协议错误。这是我们可以直接补的健壮性点。
- 不能学：`ToolBatchTiming`、关键路径失效判定等精细计时。
- 优先级：P1。

#### 3.2.3 统一执行（unified_exec / PTY 会话）— P1
- 是什么：`UnifiedExecProcessManager` 管理最多 64 个交互进程，输出上限 1 MiB / 10,000 token，`yield_time_ms` 夹在 250–30,000ms（Windows 首包最低 10,000ms），支持 `write_stdin`、后台终端列出/终止。
- 证据：`core/src/unified_exec/mod.rs`（常量与 `ProcessStore`）、`process_manager.rs`（1,807 行）、`stdin_approval.rs`（284 行）、`tools/handlers/unified_exec/{exec_command,write_stdin,preparation}.rs`。
- 能学：输出上限、yield 时间下限、进程复用（同 session 续写 stdin）三件套；我们的 `pty.rs`（370 行）已有 PTY，缺"输出上限 + 会话保留 + 显式 kill"。
- 不能学：`mxc-sandbox` 支撑的 Windows 进程内沙箱、`command_sessions` 世界状态节。
- 优先级：P1。

#### 3.2.4 结构化补丁（apply-patch）— P1
- 是什么：独立 crate 解析 `*** Begin Patch` 方言，逐 hunk 校验（`seek_sequence` 容错定位），产出 `AppliedPatch` 与 unified diff；同时有流式解析器供 UI 增量显示。
- 证据：`apply-patch/src/{parser.rs,file_update.rs,seek_sequence.rs,streaming_parser.rs,invocation.rs}`；`core/src/tools/handlers/apply_patch.rs`（602 行）。
- 能学：补丁要先"解析成结构"再"按上下文匹配定位"，失败要给明确原因（`ParseError` 枚举），不要靠正则替换字符串。
- 不能学：其 freeform 工具协议与 `legacy_apply_patch_exec_command_warning` 迁移逻辑。
- 优先级：P1（我们 `engine/edit.rs` 55 行）。

### 3.3 权限

#### 3.3.1 SandboxManager 选择 + 命令改写 — P0（只学选择逻辑）
- 是什么：`get_platform_sandbox()` 单点决定本机后端（macOS seatbelt / Linux seccomp+landlock+bwrap / Windows restricted token 或 MXC）；`SandboxSelection::{Explicit, RequirePlatform}` 让"必须沙箱"显式化；`policy_transforms.rs`（634 行）负责把 `PermissionProfile` 变成可执行策略。
- 证据：`sandboxing/src/manager.rs`（`SandboxablePreference`、`get_platform_sandbox`、`SandboxTransformRequest`）、`sandboxing/src/lib.rs` 导出、`sandboxing/src/{launch.rs,policy_transforms.rs}`。
- 能学：**权限"文件系统 + 网络"两轴建模**（`PermissionProfile{file_system_sandbox_policy, network_sandbox_policy}`），以及"策略→命令"只在执行边界做一次转换。
- 不能学：seatbelt/landlock/bwrap 具体配置生成（我们 Windows 桌面进程没有这些原语）。
- 优先级：P0（拿建模与选择逻辑）；平台后端：不做。

#### 3.3.2 命令策略规则（execpolicy, Starlark）— P0
- 是什么：独立 crate，规则文件（`.rules`）是 Starlark：`prefix_rule(pattern=["git","status"], decision="allow")`、`network_rule(...)`；每条规则可带 match/not-match 示例做自校验（`rule.rs: validate_match_examples / validate_not_match_examples`）；`Policy::check_multiple_with_options` 对**管道拆段后的每段命令**求值。
- 证据：`execpolicy/src/{parser.rs,policy.rs,rule.rs,amend.rs,decision.rs}`；`core/src/exec_policy.rs:288 ExecPolicyManager`、`:366 create_exec_approval_requirement_for_parsed_commands`、`:519 append_amendment_and_update`、`:64 BANNED_PREFIX_SUGGESTIONS`（禁止把 `bash -c`、`python -c`、`rm` 等做成可复用前缀规则）。
- 能学：① 规则解析面是三态 `Decision::{Allow,Prompt,Forbidden}`，但枚举实际有第四个 `PromptUser`（需要新的人工决定）；未命中回退启发式；② **批准后把规则写回文件**，形成用户可审计的授权累积；③ 明确禁止"万能前缀"（这是被真实滥用的点）。
- 不能学：Starlark 解释器（多一个依赖 + 用户要学语法）；`RequirementsExecPolicy` 的托管策略合并。
- 优先级：P0（规则表 + 写回）；Starlark：不做（我们可直接用 TOML 规则）。

#### 3.3.3 审批要求四态与"重试只一次" — P0
- 是什么：`ExecApprovalRequirement::{Skip{bypass_sandbox}, NeedsApproval, NeedsHumanApproval, Forbidden}`；`NeedsHumanApproval` 表示每次执行都要人重新点（不允许"记住"）；`sandbox_override_for_first_attempt` 严格区分"允许命令"与"允许扩权"——命令白名单不能扩大文件系统权限。
- 证据：`core/src/tools/sandboxing.rs:160,204,242,257,298`；`orchestrator.rs` 第二段（denied → 重新审批 → `retry_sandbox_requested` → 仅一次重跑）。
- 能学：把"策略允许"和"沙箱开启"解耦；denied 时保留**原始输出**再附升级理由；`unsandboxed_execution_allowed()` 用"是否含 denied-read 路径"判断能否无沙箱跑（否则静默放大读权限）。
- 不能学：`Granular` 审批子开关矩阵（对我们用户是负担）。
- 优先级：P0。

#### 3.3.4 Windows 沙箱后端 — 不做（只读结论）
- 是什么：`windows-sandbox-rs` 做 AppContainer / 受限令牌 / 提权 runner / ACL 与 deny-read ACL / WFP 防火墙 / 独立沙箱用户与 setup 服务（`setup.rs` 2,568 行、`setup_provisioning.rs` 1,506 行、`acl.rs` 1,131 行、`wfp*.rs` 587 行、`identity.rs` 579 行、`elevated/runner_client.rs` 602 行），另有 `windows-sandbox-service`（36 文件 / 6,204 行）。
- 证据：上述路径 + `core/src/windows_sandbox.rs`（482 行，含 `WindowsSandboxLevelExt::from_config` 的 Elevated/RestrictedToken/Mxc 三档）。
- 能学：如果将来要做，**"沙箱用户 + 一次性 ACL + 服务化 setup"** 是唯一正经路径；诊断要落文件（`log_note` 到 `sandbox_dir`）。
- 不能学：现在不做——需要管理员权限、后台服务、防火墙规则，与我们"用户双击就用的桌面 App"冲突，且失败面极大。
- 优先级：不做。

#### 3.3.5 网络审批与受管代理 — P1
- 是什么：域名粒度的审批（`NetworkApprovalContext{host, protocol}`），批准后可写回 `network_rule` 并同步到运行时代理 allowlist。
- 证据：`core/src/tools/network_approval.rs`（1,365 行 + 985 行测试）、`core/src/network_policy_decision.rs`、`core/src/exec_policy.rs:apply_network_rule_and_persist`。
- 能学：网络权限按"主机"授权并落盘，比"允许联网"开关可用得多。
- 不能学：MITM 代理 + 凭据 broker（我们不做代理）。
- 优先级：P1。

### 3.4 会话

#### 3.4.1 Rollout JSONL 记录 — P0
- 是什么：每行 `{timestamp, ordinal, item}`，`RolloutItem` 覆盖 session_meta / turn / response_item / compacted / 事件；支持 zstd 压缩 + 需要时可物化回明文 JSONL。
- 证据：`rollout/src/lib.rs:{decode_rollout_line,parse_rollout_line,SESSIONS_SUBDIR}`、`recorder.rs`、`compression.rs`、`policy.rs:{should_persist_response_item,...}`。
- 能学：**先定"什么进日志、什么不进"**（`policy.rs` 就是这个白名单），再谈格式；ordinal 让顺序可恢复。
- 不能学：`rollout_migration`（1,363 行）与回滚计划（历史包袱）。
- 优先级：P0（我们的 `journal.rs` 200 行已接近，缺 ordinal 与保留策略）。

#### 3.4.2 ThreadStore 抽象 — P1
- 是什么：`ThreadStore` trait（`thread-store/src/store.rs`）以 `ThreadId` 为唯一句柄，暴露 create/append/read/list/fork/resume/revert/search/archive 等；有 `InMemoryThreadStore` 与 `LocalThreadStore` 两实现；`ThreadStoreResumePreparation` 用 `Box<dyn Any>` 把"已加载的历史与 writer"交回给 reopen，避免重复加载。
- 证据：`thread-store/src/{store.rs,lib.rs,in_memory.rs,local/mod.rs,local/read_thread.rs,local/thread_history/*}`。
- 能学：接口层只认 id；resume 时"准备态"复用；`PersistContext` 枚举区分"线程准备 / 常规 / 子代理派生 / turn 开始"四种持久化时机。
- 不能学：projects/sections/attachments/queue 等产品化实体（我们 UI 有自己的组织方式）。
- 优先级：P1。

#### 3.4.3 恢复、分叉与回退 — P0（只做 resume）
- 是什么：`InitialHistory::{New,Resumed,Forked}`，恢复时重放 rollout 并重建 token 用量、compaction checkpoint、世界状态 baseline；`thread_rollout_truncation::{truncate_rollout_after_turn_id, truncate_rollout_before_turn_id}` 支持按 turn 截断；`revert_thread.rs`、`paginated_fork.rs`。
- 证据：`core/src/session/mod.rs:record_initial_history`、`core/src/session/rollout_reconstruction.rs`（653 行）、`history/src/lib.rs`、`thread-store/src/local/{revert_thread.rs,paginated_fork.rs}`。
- 能学：恢复要恢复**四样东西**：历史项、token 用量基线、压缩检查点、世界状态快照；只重放消息会导致下一次压缩立刻触发。
- 不能学：回退到任意 turn + 分支线（成本高、与 UI 交互复杂）。
- 优先级：P0（只 resume）；fork/revert：P2。

#### 3.4.4 `session_prefix.rs`：模型可见但不属于用户意图的消息 — P1
- 是什么：子代理完成/错误/被 Guardian 中断时，生成"用户角色但标注为非用户意图"的消息；错误文本按 token 截断（1,000 token 上限、留 100 token 信封余量），并附固定"下一步该做什么"的指令。
- 证据：`core/src/session_prefix.rs:{COMPLETION_MESSAGE_MAX_TOKENS,format_inter_agent_completion_message,format_guardian_interruption_message,format_subagent_context_line}`。
- 能学：系统注入的消息要**限定 token 且带行动指引**，否则模型会反复重试失败子任务。
- 不能学：多代理语境（我们没有子代理）。
- 优先级：P1（对我们的"工具失败注入"同样适用）。

### 3.5 上下文/压缩

#### 3.5.1 压缩生命周期（`compact.rs`）— P0
- 是什么：见 2.4；关键是"压缩 = 开新窗口 + 替换整段 history + 一条 memento + 元数据"，不是追加摘要。
- 证据：`core/src/compact.rs`（915 行）：`CompactedHistoryMetadata`、`build_compaction_replacement_history`、`assemble_compaction_history`、`build_compacted_history_with_limit`、`insert_initial_context_before_last_real_user_or_summary`、`drain_to_completed`；`COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000`；`SUMMARY_PREFIX` / `SUMMARIZATION_PROMPT` 来自 `codex-prompts`。
- 能学：① 压缩前把待处理的 pending 输入单独保留、压缩后按序插回（`compact_pending_input`）；② 超窗口时**从头删最早一项再试**（保 prefix 缓存），而不是整段重来；③ 压缩产物带 `compaction_response_id`/`model_hash`，便于审计与"换模型必须重压"。
- 不能学：remote_v2（1,468 行）依赖服务端压缩接口；多模态媒体预算（`compact_remote_v2_media*.rs`）。
- 优先级：P0。

#### 3.5.2 压缩触发与阈值（`session/context_window.rs`）— P0
- 是什么：一个函数返回结构化 `ContextWindowTokenStatus{active_context_tokens, auto_compact_scope_tokens, auto_compact_scope_limit, full_context_window_limit, base_window_tokens_remaining, token_limit_reached, turn_end_compaction_threshold_reached}`；支持 `AutoCompactTokenLimitScope::{Total, BodyAfterPrefix}`（只算 prefix 之后新增的部分）。
- 证据：`core/src/session/context_window.rs`（118 行，全文可读）、`core/src/state/auto_compact_window.rs`（219 行）。
- 能学：**阈值判断集中成一个纯函数并返回结构体**，调用点只读字段；区分"自动压缩阈值"与"模型硬上限"两个数。
- 不能学：`post_turn_percent`、fallback buffer 等多旋钮（对我们是配置负担）。
- 优先级：P0。

#### 3.5.3 世界状态分节 + 增量渲染 — P1
- 是什么：见 2.3。每节自带 `render_diff`，未变化则返回空 updates；`WorldStateHash` 用 sha1 指纹；`PreviousSectionState::{Absent,Unknown,Known}` 处理"历史里没有/有但没快照/有精确快照"三种情况。
- 证据：`core/src/context/world_state/mod.rs`（726 行 + 各 section 文件）、`context/world_state/{agents_md,permissions,tools,environment,model}.rs`、`context-fragments` crate。
- 能学：把"模型可见状态"当成**有版本的结构体**而不是拼字符串；变更时显式说明"替换/删除"。
- 不能学：20 多个 section 的细分（`plugins_instructions`、`collaboration_mode`、`realtime` 等我们不需要）。
- 优先级：P1。

#### 3.5.4 AGENTS.md 发现与预算 — P1
- 是什么：从 cwd 向上找 `AGENTS.md` / `AGENTS.override.md`，总预算 `project_doc_max_bytes`，并发探测上限 256，不可信项目直接跳过（`config.active_project.is_untrusted()`）。
- 证据：`core/src/agents_md.rs`（522 行，`candidate_filenames`、`LoadedAgentsMd`、`InstructionProvenance`）、`agents_md_manager.rs`（202 行）、`context/world_state/agents_md.rs`。
- 能学：① 用户指令有字节预算并明确提示如何调整；② 记录每条指令的来源路径（provenance）用于"为什么模型看到了这句"。
- 不能学：多层 override 合并策略（我们已有自己的 AGENTS 约定）。
- 优先级：P1。

#### 3.5.5 输出截断与 token 估算（`utils/output-truncation`、`context_manager/history.rs`）— P0
- 是什么：`TruncationPolicy::{Tokens,Bytes}` + `truncate_text/formatted_truncate_text/approx_token_count`；`ContextManager` 侧按 item 类型估算 token（文本按字节、base64 图片按引用字节、音频按时长、function output 单独估），并 `normalize_history` 修正不合法的历史序列。
- 证据：`core/src/context_manager/history.rs:1313 estimate_item_token_count, :1350 estimate_response_item_model_visible_bytes, :1189 normalize_history, :1227 trim_pre_turn_context_updates`；`core/src/tools/mod.rs:format_exec_output_for_model`（"Exit code / Wall time / Total output lines / Output" 四段式）。
- 能学：① 工具输出回给模型时统一成"元信息 + 截断正文"；② token 估算按内容类型分派；③ `normalize_history` 这类"修复不合法历史"的函数是长期稳定的关键。
- 不能学：`CodexHarnessMetadata`（compaction_output/retained sources）这套自研标注体系。
- 优先级：P0（我们 `context.rs` 只有 42 行）。

### 3.6 扩展

#### 3.6.1 Extension API（贡献者模型）— P1（借思想，不借体量）
- 是什么：`ExtensionRegistry` + 一组 contributor trait：`ContextContributor / ToolContributor / ToolLifecycleContributor / TurnLifecycleContributor / ThreadLifecycleContributor / ModelRequestContributor / ApprovalReviewContributor / McpServerContributor / SkillInvocationContributor / TurnInputContributor / ConfigContributor / TokenUsageContributor / MessageLifecycleContributor`，加 `WorldStateSectionContribution`、`ToolPolicy`、`TurnStartAdmission`、`SessionIsolation`。
- 证据：`ext/extension-api/src/lib.rs`（导出全表）、`contributors.rs`、`tool_policy.rs`、`state.rs:ExtensionData`。
- 能学：能力注入点按生命周期分 trait，扩展之间互不知道对方存在；`ExtensionData` 是类型化 KV（`turn_extension_data.insert::<T>`）而不是全局单例。
- 不能学：18 个扩展 crate 的完整注册流程（`core-plugins` 48,975 行）。
- 优先级：P1（我们只需要"工具前/后 + turn 前/后 + 压缩前/后"四个点）。

#### 3.6.2 Hooks（14 类事件）— P1
- 是什么：事件名固定为 `PreModelRequest / PostModelRequest / PreToolUse / PermissionRequest / PostToolUse / PreCompact / PostCompact / SessionStart / SessionEnd / UserPromptSubmit / SubagentStart / SubagentStop / Stop / Interrupt`；结果 `HookResult::{Success, FailedContinue, FailedAbort}`；执行器支持命令脚本与 MCP 调用两种后端，输出可注入额外 context。
- 证据：`hooks/src/lib.rs:{HOOK_EVENT_NAMES,HOOK_EVENT_NAMES_WITH_MATCHERS,hook_event_key_label}`、`hooks/src/engine/{dispatcher.rs,matcher.rs,command_runner.rs,mcp_runner.rs,output_parser.rs}`、`core/src/hook_runtime.rs`（1,344 行）、`core/src/tools/registry.rs:apply_pre_tool_use`（Blocked/Failed/Cancelled 三态）。
- 能学：钩子返回**三态**（继续 / 失败但继续 / 中止），PreToolUse 可"阻止并让模型看到原因"。
- 不能学：hook 的 MCP 后端、插件钩子信任指纹（`plugin_trust.rs`）。
- 优先级：P1（先做 PreToolUse / PostToolUse / PreCompact）。

#### 3.6.3 Skills（SKILL.md + frontmatter）— P1
- 是什么：`SkillMetadata{name,description,short_description,interface,dependencies,policy,path_to_skills_md,scope,plugin_id}`；`SkillPolicy{allow_implicit_invocation, products}`；`SkillDependencies{tools:[{type,value,transport,command,url,oauth_callback_port}]}`；系统技能以 `include_dir!` 内嵌后按指纹 marker 落地到 `CODEX_HOME/skills/.system`，指纹不变则跳过安装。
- 证据：`skills/src/{lib.rs,model.rs,parser.rs,selection.rs,invocation.rs,mentions.rs,loading.rs}`；`core/src/skills.rs`（328 行）、`core/src/mcp_skill_dependencies.rs`（483 行）。
- 能学：① 技能=目录 + frontmatter，可显式 `@` 提及也可隐式触发（`detect_implicit_skill_invocation_for_command`）；② 内嵌资源用指纹 marker 避免每次启动重写；③ 技能可声明它需要的工具依赖，启动时校验（`validate_required_skills`）。
- 不能学：云端技能冻结、技能市场。
- 优先级：P1。

#### 3.6.4 MCP 客户端 — P2（按需）
- 是什么：`codex-mcp`（31,791 行）做 catalog（`ResolvedMcpCatalog`）、连接池（`McpConnectionPool` + lease 元数据）、工具目录缓存、OAuth/elicitation、事件流（`McpResourceClient`）；`rmcp-client` 是底层协议实现；工具名带服务器命名空间并做暴露策略（`mcp_tool_exposure.rs`）。
- 证据：`codex-mcp/src/lib.rs`（导出全表）、`core/src/mcp.rs`（581 行）、`core/src/mcp_tool_call.rs`（2,729 行）、`core/src/session/mcp*.rs`。
- 能学：MCP 服务器是"可选启动 + 启动宽限窗口"（`DEFAULT_OPTIONAL_MCP_STARTUP_GRACE`），不能让它阻塞 turn；工具暴露要区分"注册"与"发给模型"。
- 不能学：OAuth/elicitation/事件流/多环境 MCP。
- 优先级：P2。

#### 3.6.5 Plugin 与 marketplace — 不做
- 是什么：`plugin`（manifest/加载/信任）+ `plugin-host`（独立进程 + 帧协议）+ `core-plugins` 运行时 + marketplace 协议方法。
- 证据：`plugin/src/{lib.rs,manifest.rs,provider.rs}`、`plugin-host/src/{process.rs,protocol.rs,framing.rs}`、`app-server-protocol/src/protocol/v2/plugin.rs`（977 行）。
- 能学：第三方代码如果要执行，**必须独立进程 + 明确协议**，不能在同进程内动态加载。
- 不能学：市场、分享、安装/卸载全链路。
- 优先级：不做。

### 3.7 多代理

#### 3.7.1 AgentControl + 角色继承 — P2
- 是什么：`AgentControl` 暴露 `spawn_agent / send_input / send_message / followup_task / resume_agent / wait_agent / list_agents / close_agent / interrupt_agent` 九个工具（`multi_agents_spec.rs`），底层 `LocalAgentControl` 管注册表、父子图、residency、mailbox、budget；`apply_role_to_config` 只允许"受限覆盖"（developer_instructions/model/effort/skills/features），注释写明 "never replace the parent session's authority"。
- 证据：`core/src/agent/control/{spawn.rs 1,227 行,api.rs 309 行,runtime.rs 539 行,residency.rs 333 行,mailbox.rs 116 行}`、`core/src/agent/{registry.rs,role.rs,types.rs}`。
- 能学：① 子代理**只能收缩不能扩张**父权限（`intersect_effective_permission_profiles`）；② 完成消息必须有 token 上限并区分"用户意图"；③ 子代理也要有独立 turn 与取消令牌。
- 不能学：mailbox 抢占、agent-graph-store、V1/V2 双版本兼容。
- 优先级：P2（若要"后台并行调研"，先做最简单版：一个独立子 turn + 结果摘要回注）。

### 3.8 工作区

#### 3.8.1 Worktree 管理 — P2
- 是什么：`WorktreeManager` 在 `settings.root` 下按桶分配目录，产出 `ManagedWorktree{root,cwd,source_root,source_cwd,head_sha,branch}`；`DEFAULT_WORKTREE_KEEP_COUNT` 控制保留数量。
- 证据：`worktree/src/lib.rs`、`worktree/src/{git.rs,paths.rs,settings.rs,metadata.rs}`（6 个源码文件 / 973 非空行，含空行 1,062 行）。
- 能学：worktree 的标识要包含 base sha 与分支名，否则"这个会话基于哪个版本"无法回答。
- 不能学：与 Codex Desktop 的目录契约。
- 优先级：P2。

#### 3.8.2 多环境（本地/远程执行器）— 不做
- 是什么：`exec-server`（68,721 行）+ `core/src/environment_selection.rs`（2,556 行）支持一次 turn 里多个环境，工具声明自己接受哪些环境。
- 证据：`core/src/environment_selection.rs`、`core/src/session/environment.rs`（413 行）、`exec-server/src/{environment*,client*,remote*}`。
- 能学：工具签名里带"环境能力"是必要抽象（我们只有单机，暂不需要）。
- 不能学：远程环境协商、能力发现、relay。
- 优先级：不做。

### 3.9 观测

#### 3.9.1 事件化遥测（`SessionTelemetry` + `analytics`）— P1
- 是什么：`SessionTelemetry` 提供 `tool_decision/tool_result/sandbox_outcome/user_prompt/turn_diff` 等语义化埋点；`analytics::CodexCompactionEvent` 是完整压缩事件（trigger/reason/phase/strategy/status/token 前后/耗时）。
- 证据：`otel/src/events/session_telemetry.rs`、`otel/src/lib.rs:{ToolDecisionSource,...}`、`analytics/src/{lib.rs,events.rs,facts.rs,reducer.rs}`。
- 能学：埋点按**语义事件**设计（一个压缩事件带十几个字段），而不是只打日志行；`ToolDecisionSource::{Config,User,AutomatedReviewer,Hook}` 让"谁批准的"可统计。
- 不能学：OTLP/Statsig 上报链路与脱敏管线。
- 优先级：P1（我们可先写进 journal，字段照此设计）。

#### 3.9.2 关键路径计时 — P2
- 是什么：`turn_timing.rs`（537 行）、`direct-tool-timing`、`utils/critical-path` 标记"这次 turn 的瓶颈是模型、工具还是审批"，`ToolTimingBoundary` 区分排队/执行/收尾。
- 证据：`core/src/turn_timing.rs`、`core/src/turn_timing/report.rs`、`direct-tool-timing/src/*`。
- 能学：把"等待审批的时间"与"工具执行时间"分开统计，否则无法判断该优化哪边。
- 不能学：`ToolBatchTiming` 等细分。
- 优先级：P2。

### 3.10 UI/协议

#### 3.10.1 app-server JSON-RPC 方法面 — P1（只借命名）
- 是什么：非严格 JSON-RPC 2.0（不发 `"jsonrpc"` 字段）；`ClientRequest` 由宏 `client_request_definitions!` 生成，方法名形如 `thread/start`、`turn/start`、`turn/steer`、`turn/interrupt`、`item/commandExecution/requestApproval`、`thread/compacted`；通知面 `thread/started`、`turn/started`、`item/started`、`item/completed`、`item/agentMessage/delta`、`turn/diff/updated`、`thread/tokenUsage/updated` 等。
- 证据：`app-server-protocol/src/protocol/common.rs`（4,477 行，macro + 方法表）、`rpc.rs`（`JSONRPCRequest{id,method,params,trace}`）、`app-server/src/{message_processor.rs,transport.rs,outgoing_message.rs}`、`app-server-transport`（stdio / websocket / control socket）。
- 能学：**服务端请求（审批）与客户端请求共用一条通道**；每个连接有 `initialized` / `experimental_api` / `opted_out_notification_methods` 状态；事件名用"名词 + 过去式"（`turn/started`），增量用 `/delta`。
- 不能学：daemon 自更新、managed install、远控配对（`app-server-daemon` 11,679 行）。
- 优先级：P1（只借命名与事件面，不引 app-server）。

#### 3.10.2 TUI — 不做
- 是什么：`tui` 1,265 文件 / 484,104 行（ratatui + crossterm fork）。
- 证据：`tui/` 目录规模；`ansi-escape`、`mermaid` crate。
- 能学：无（我们前端已定版）。
- 不能学：渲染细节、主题、键位。
- 优先级：不做。

### 3.11 云/远控

#### 3.11.1 remote control / cloud tasks — 不做
- 是什么：`remoteControl/{enable,disable,status,pairing}` 配对码 + `app-server-transport::start_remote_control`；`cloud-tasks` 把任务交给云端执行；`cloud-client`/`backend-client`/`codex-api` 是账号与后端 API。
- 证据：`app-server-protocol/src/protocol/v2/remote_control.rs`（182 行）、`app-server-daemon/src/{remote_control_client.rs,update_loop.rs}`、`cloud-tasks/src/lib.rs`、`cloud-client/`、`backend-client/`。
- 能学：如果要"手机看桌面任务"，配对码 + 一次性 installation_id 是标准做法。
- 不能学：整个链路（账号、计费、配额）。
- 优先级：不做。

### 3.12 安全

#### 3.12.1 Guardian 自动审批审查 — P2（不引入审查模型）
- 是什么：`AskForApproval::Granular` + `ApprovalsReviewer` 可把审批路由给一个**隔离的评审会话**（`GuardianReviewSession`），评审者拿"裁剪过的证据"（工具调用、上下文片段、预算）给出 allow/deny + 理由；`strict_auto_review` 下连 `Skip` 也要过审；反复被拒会中断 agent 并注入 "Tell the user this agent stopped after repeated Guardian denials"。
- 证据：`core/src/guardian/{mod.rs,review_session.rs 853 行,review.rs,decision.rs,input_budget.rs 412 行,request_budget.rs 209 行,prompt.rs}`、`ext/guardian-{reviewer,v2,v3}`、`guardian-context`。
- 能学：① 自动审批要有**输入预算**（不能把整段 transcript 塞给审查者）；② 拒绝要能"解释给用户并停止"，而不是无限重试；③ 评审与主会话权限隔离。
- 不能学：需要独立审查模型、评分校准（`score_authorization.rs`）、v2/v3 两代策略。
- 优先级：P2。

#### 3.12.2 补丁安全评估（`safety.rs`）— P1
- 是什么：`assess_patch_safety(action, policy, permission_profile, matching)` 返回 `SafetyCheck::{AutoApprove,AskUser,Reject{reason}}`；区分"写到项目外"与"只读沙箱阻止写入"两种拒绝理由；空补丁直接拒绝。
- 证据：`core/src/safety.rs:17,71`、`core/src/safety_tests.rs`（494 行）。
- 能学：写文件类工具**执行前**先做一次纯函数式安全评估，结论带人话理由。
- 不能学：`PatchSandboxRoute::{ExecutorManaged,Platform}` 的分支。
- 优先级：P1（我们 `sandbox.rs` 269 行已有路径边界，缺"结论结构体 + 理由"）。

#### 3.12.3 凭据与密钥 — P1（只学纪律）
- 是什么：`secrets`、`keyring-store`、`utils/redacted-string`、`network-proxy` 的凭据 broker；日志侧有 `sanitize_metric_tag_value`。
- 证据：`secrets/`、`keyring-store/`、`utils/redacted-string/`、`otel/src/lib.rs:sanitize_metric_tag_value`。
- 能学：日志/指标入口统一脱敏函数；密钥只进 keyring，不进配置文件。
- 不能学：AWS workload identity / attestation。
- 优先级：P1。

## 4 可学 / 不可学

### 4.1 必须学（P0，补当前的洞）

| # | 机制 | Codex 证据 | 我们的缺口 |
|---|---|---|---|
| 1 | 压缩=新窗口+替换 history+元数据 | `core/src/compact.rs`、`session/context_window.rs` | 完全没有压缩，长任务必然爆窗 |
| 2 | 工具管线：审批缓存 / 拒绝后只重试一次 / 拒绝原因回给模型 | `core/src/tools/orchestrator.rs`、`tools/sandboxing.rs` | `tool_pipeline.rs` 有审批卡，但无升级重试与拒绝回传 |
| 3 | 结构化命令规则 + 批准后写回 | `execpolicy` crate、`core/src/exec_policy.rs` | `policy.rs` 78 行只有 3 个硬编码判断 |
| 4 | 会话 resume（历史+token 基线+检查点+世界状态） | `rollout`、`thread-store`、`history`、`session/rollout_reconstruction.rs` | `journal.rs` 只写不读 |

### 4.2 值得学但成本高（P1/P2）

- 世界状态分节 + 增量渲染（P1）
- PreToolUse/PostToolUse/PreCompact 钩子三态（P1）
- 并行工具 + 取消也产出结果项（P1）
- 语义化遥测事件（P1）
- 工具暴露面 `ToolExposure` + tool_search（P2）
- worktree（P2）、多代理（P2）、Guardian 式自动审查（P2）

### 4.3 明确不做

| 项 | 理由 |
|---|---|
| 云任务 / 账号 / 计费 / backend API | 我们是本地桌面应用，没有后端 |
| remote control / 配对码 / daemon 自更新 | 与"单机、双击即用"冲突 |
| realtime 语音（`realtime-webrtc`、`voice-host`） | 另有产品线规划，不在 engine 范围 |
| V8 Code Mode（`code-mode*`、`v8-poc`） | 需要在 JS 沙箱里跑工具编排，收益不等于复杂度 |
| Windows 提权沙箱（AppContainer/服务/ACL/WFP） | 需要管理员权限与后台服务，失败面极大 |
| TUI 渲染 | 前端已定版 |
| 插件市场 / marketplace | 无生态诉求 |
| 远端压缩 remote_v2 | 依赖服务端接口 |

### 4.4 判定依据（为什么这些"不学"不是偷懒）

1. 它们的收益都建立在**特定的分发形态**上：云/远控依赖账号体系；提权沙箱依赖服务化安装；Code Mode 依赖模型对该模式的专门训练。
2. 它们的成本不是代码量，而是**持续性运维**：`windows-sandbox-rs` 28,360 行里大半是 ACL/身份/firewall 的 provisioning 与卸载；`app-server-daemon` 11,679 行里大半是自更新与迁移。照抄只会得到一个更难维护的壳。
3. 我们真正缺的是**基础机制**（压缩、恢复、规则、预算），Codex 恰好把这些做得最扎实。

## 5 对我们 engine 的具体映射

现状（实测）：`app/src-tauri/src/engine/` 只有 10 个文件 —— `tool_pipeline.rs` 402 行、`journal.rs` 200 行、`tooling.rs` 117 行、`deepseek.rs` 96 行、`retry.rs` 91 行、`policy.rs` 78 行、`modes.rs` 55 行、`edit.rs` 55 行、`context.rs` **42 行**、`mod.rs` 13 行；外层 `agent.rs` 1,490 行、`goal.rs` 1,360 行、`sandbox.rs` 269 行、`pty.rs` 370 行。

### 5.1 P0 四项（建议顺序执行）

#### P0-1 压缩：新增 `engine/compact.rs`

| 项 | 内容 |
|---|---|
| 现状 | 无压缩。`context.rs` 42 行只做工具输出头尾裁剪；长会话只能靠用户手动新开 |
| 借 Codex | `core/src/compact.rs` 的生命周期与产物结构；`session/context_window.rs` 的阈值函数 |
| 具体做法 | ① `engine/context.rs` 拆出 `token_status()` 返回结构体（active/limit/reached）；② 新增 `compact.rs`：`should_compact(status)` → 用当前模型发一次摘要请求（prompt 常量 + 保留最近 N 条真实 user 消息，预算 20k token）→ 产出 `CompactionRecord{summary, window_id, source_turn_ids, model, created_at}`；③ 把 `RunState` 里的 history 整体替换为 `[summary] + 保留项`，并写 journal 事件 `context_compacted`；④ 压缩失败时不丢用户输入（先把 pending input 落 journal） |
| 不照抄 | 远端压缩、多模态预算、`CodexHarnessMetadata` |
| 验收 | 构造 30 轮大输出对话，触发压缩后：新请求 payload 只剩"摘要 + 最近 N 条"，journal 有一条 `context_compacted` 带压缩前后 token；压缩后追问"之前定了什么"能答对前 20 轮的关键决策 |

#### P0-2 上下文预算：`engine/context.rs` 扩成分层

| 项 | 内容 |
|---|---|
| 现状 | 42 行，只有截断函数 |
| 借 Codex | `utils/output-truncation` 的 `TruncationPolicy`；`context_manager/history.rs:estimate_item_token_count_with_audio` 的分类估算；`core/src/tools/mod.rs:format_exec_output_for_model` 的四段式输出 |
| 具体做法 | `context/truncate.rs`（Tokens/Bytes 两种策略 + 头尾保留）、`context/estimate.rs`（文本/图片引用/音频/JSON 分别估）、`context/sections.rs`（把"系统提示、AGENTS、工具表、工作计划"当独立节，各带 hash，变了才重发） |
| 不照抄 | `normalize_history` 的完整规则集（先只做"tool_call 必须有配对 tool_result"） |
| 验收 | 单条 2MB 命令输出进入上下文后，模型请求里该条不超过预算且保留头尾与 "Exit code/Wall time"；改一次 AGENTS.md 后，下一轮只多出一条"替换声明"而不是重发全部 |

#### P0-3 命令规则：`engine/policy.rs` 升级为规则表

| 项 | 内容 |
|---|---|
| 现状 | 78 行，`destructive_command` / `catastrophic_command`，字符串前缀匹配 |
| 借 Codex | `execpolicy` 的规则解析三态 + `PromptUser` 第四态 + `PrefixRule(pattern, decision)` + 规则自校验；`core/src/exec_policy.rs:BANNED_PREFIX_SUGGESTIONS`（禁止 `bash -c`/`python -c`/`rm` 这类可复用前缀）；`append_amendment_and_update` 的"批准即写回" |
| 具体做法 | ① 规则存 `~/.<app>/rules.toml`：`[[rule]] program="git" args_prefix=["push"] decision="prompt"`；② 求值顺序：显式规则 → 内置危险命令表 → 默认（写操作 prompt，读操作 allow）；③ 审批卡给"以后同类命令不再问"选项，勾选即追加规则并**回显将写入的那一行**；④ 对 `bash -c`/`cmd /c`/`powershell -Command`/`python -c` 一律不生成可复用规则，只允许"仅本次" |
| 不照抄 | Starlark 语法、`RequirementsExecPolicy` |
| 验收 | 批准 `git status` 后可复用规则生效（第二次不再弹卡）；批准 `rm -rf build` 时"以后都允许"必须不可选；规则文件被手改坏时启动降级为默认策略并给 warning 而非崩溃 |

#### P0-4 会话 resume：`engine/journal.rs` 双向化

| 项 | 内容 |
|---|---|
| 现状 | 200 行，只 append 事件；无读取、无 ordinal、无 token 基线 |
| 借 Codex | `rollout/src/lib.rs:{decode_rollout_line,parse_rollout_line}`、`recorder.rs` 的行结构、`policy.rs` 的"什么该写"、`thread_rollout_truncation` 的按 turn 截断、`session/rollout_reconstruction.rs` 的恢复四要素 |
| 具体做法 | ① 事件行加 `ordinal`（单调递增）与 `schema_version`；② 新增 `journal::load(task_id)` 返回 `Resumed{history, token_baseline, compaction_checkpoints, last_turn_id}`；③ `RunState` 从 resume 结果初始化而不是空；④ 崩溃恢复：末尾半行丢弃并记 warning |
| 不照抄 | 分叉/回退到任意 turn、SQLite 索引（我们先用目录扫描） |
| 验收 | 杀掉进程后重开同一任务：能继续对话、token 计数不透支、UI 历史一致；journal 末尾人为写半行后仍能启动并提示"丢弃了 1 条不完整记录" |

### 5.2 P1（在 P0 之后按需）

| 映射 | Codex 参照 | 落点 | 验收 |
|---|---|---|---|
| 工具前/后钩子（三态） | `hooks/src/lib.rs` 14 事件、`tools/registry.rs:apply_pre_tool_use` | `engine/tool_pipeline.rs` | 配置 PreToolUse 脚本拦截 `rm`，模型收到"被 hook 阻止：原因"并可改方案 |
| 并行工具 + 取消产出 | `tools/parallel.rs:aborted_response` | `tool_pipeline.rs` | 同时发起 3 个读文件工具全并行；取消后每个 call_id 都有结果项 |
| 拒绝原因回传 | `orchestrator.rs` 的 `build_denial_reason_from_output` | `tool_pipeline.rs` | 拒绝后模型看到"为什么被拒 + 建议"，而不是泛化失败 |
| 语义化遥测 | `analytics::CodexCompactionEvent`、`SessionTelemetry::tool_decision` | `journal.rs` 事件枚举 | 一次 turn 的事件序列能回答"谁批准的、耗时在哪、压缩几次" |
| 输出上限与会话保留 | `unified_exec` 常量与 `ProcessStore` | `pty.rs` | 单终端输出超 1MiB 被截断且提示；同 session 可继续 write_stdin |
| 补丁安全评估 | `core/src/safety.rs:assess_patch_safety` | `sandbox.rs` | 写项目外文件时给出 `Reject{reason}` 并显示理由；空补丁直接拒绝 |
| 技能目录（可选） | `skills/src/model.rs` frontmatter 模型 | 新 `engine/skills.rs` | 放一个 `SKILL.md` 后能被列出并按需注入 |

### 5.3 P2 / 不做

- P2：worktree 隔离（`worktree/src/lib.rs:ManagedWorktree` 字段可直接用作会话元数据）；多代理（先做"一个子 turn + 摘要回注"，只借 `AgentControl` 的九工具语义与 `apply_role_to_config` 的"只收缩"原则）；tool_search（`ToolExposure::Deferred` + BM25）。
- 不做：见 4.3，逐条有理由。

### 5.4 不建议照抄的细节（容易被误学）

1. **不要**把 `CodexErrorDetails` 的二十多个分支照搬——我们只需要 `Transient / Auth / ContextWindow / Rejected / Cancelled / Fatal` 六类。
2. **不要**照抄 `StepSettings` 的多层配置合并；我们的 `settings.rs`（298 行）已经够用。
3. **不要**为了"像 Codex"而引入 `tool_search`、`namespace` 工具命名——单机工具集小于 20 个时，namespace 只增加认知负担。
4. **不要**把审批缓存做成全局 map：Codex 的 `ApprovalStore` 作用域是 turn/session（`tools/sandboxing.rs:46`），并要求"命令 + cwd + 权限档"三元组命中才算复用。

## 6 证据等级说明

**[源码]（本次实际读到实现或导出，可复现）**

- `codex-rs/Cargo.toml` workspace members 207；`core`/`tui`/`app-server` 等行数为逐文件统计。
- `core/src/compact.rs`、`compact_remote_v2.rs`、`session_prefix.rs`、`session/turn.rs`、`session/mod.rs`、`session/context_window.rs`、`context_manager/history.rs`、`context/world_state/mod.rs`、`context/world_state/agents_md.rs`、`agents_md.rs`。
- `core/src/exec_policy.rs`（函数清单与 `ExecPolicyManager` 实现）、`core/src/tools/{mod,registry,router,parallel,orchestrator,sandboxing,spec_plan}.rs`、`core/src/tools/handlers/{tool_search.rs,multi_agents_spec.rs}`、`core/src/unified_exec/mod.rs`、`core/src/safety.rs`、`core/src/guardian/mod.rs`、`core/src/windows_sandbox.rs`、`core/src/shell_snapshot.rs`、`core/src/agent/{types.rs,role.rs}`、`core/src/agent/control/spawn.rs`、`core/src/lib.rs`（全部导出）。
- `sandboxing/src/{lib,manager}.rs`、`execpolicy/src/{lib,parser,amend}.rs`、`windows-sandbox-rs/src/lib.rs`。
- `rollout/src/{lib,state_db}.rs`、`thread-store/src/{lib,store}.rs`、`history/src/lib.rs`（导出）、`state/src/` 目录结构。
- `app-server-protocol/src/{lib,rpc}.rs`、`app-server-protocol/src/protocol/{common.rs,v2/mod.rs,v2/remote_control.rs,v2/thread.rs}`、`app-server/src/{message_processor,transport}.rs`、`app-server-daemon/src/lib.rs`。
- `skills/src/{lib,model}.rs`、`hooks/src/{lib,types}.rs`、`codex-mcp/src/lib.rs`、`ext/extension-api/src/lib.rs`、`ext/{goal,memories,web-search}/src/lib.rs`、`plugin/src/lib.rs`、`tools/src/{tool_spec,tool_executor}.rs`。
- `worktree/src/lib.rs`、`otel/src/lib.rs`、`analytics/src/lib.rs`、`exec-server/src/lib.rs`、`apply-patch/src/lib.rs`、`cli/src` 子命令表。

**[README]（仅文档声明，未作为结论依据）**

- 根 `README.md`、`codex-rs/docs/{bazel.md,protocol_v1.md}` 未逐条核对；本报告的功能结论全部落在源码路径上。

**[未核实]**

- 远端压缩（`compact_remote_v2`）服务端行为与协议细节：只读到客户端调用与回退分支，未读到服务端。
- Windows 沙箱实际拦截效果：只读到 ACL/WFP/AppContainer 的实现与诊断代码，未在本机运行验证。
- Code Mode（V8）运行时行为：只读到 `code-mode*` crate 边界与 host 生命周期，未读到 JS 侧实现细节。
- Guardian 审查质量：只读到审查会话、预算与决策逻辑，未读到评审模型与评分校准数据。
- realtime 语音链路能否本地端到端运行：只读到 crate 与协议类型。
- 所有"能学/不能学"判断是我方工程结论，不是 Codex 的官方设计意图。

## 7 本次读过的关键文件

源码（按类别）：

```text
codex-rs/Cargo.toml
core/src/lib.rs                                    core/src/compact.rs
core/src/compact_remote_v2.rs                      core/src/session_prefix.rs
core/src/session/turn.rs                           core/src/session/mod.rs
core/src/session/context_window.rs                 core/src/codex_thread.rs
core/src/context_manager/{mod.rs,history.rs}       core/src/context/world_state/{mod.rs,agents_md.rs}
core/src/agents_md.rs                              core/src/exec_policy.rs
core/src/tools/{mod.rs,registry.rs,router.rs,parallel.rs,orchestrator.rs,sandboxing.rs,spec_plan.rs}
core/src/tools/handlers/{tool_search.rs,multi_agents_spec.rs}
core/src/unified_exec/mod.rs                       core/src/safety.rs
core/src/guardian/mod.rs                           core/src/windows_sandbox.rs
core/src/shell_snapshot.rs                         core/src/agent/{types.rs,role.rs}
core/src/agent/control/spawn.rs
sandboxing/src/{lib.rs,manager.rs}                 execpolicy/src/{lib.rs,parser.rs,amend.rs}
windows-sandbox-rs/src/lib.rs
rollout/src/{lib.rs,state_db.rs}                   thread-store/src/{lib.rs,store.rs}
app-server/src/{message_processor.rs,transport.rs}
app-server-protocol/src/{lib.rs,rpc.rs}
app-server-protocol/src/protocol/{common.rs,v2/mod.rs,v2/remote_control.rs,v2/thread.rs}
app-server-daemon/src/lib.rs
skills/src/{lib.rs,model.rs}                       hooks/src/{lib.rs,types.rs}
codex-mcp/src/lib.rs                               ext/extension-api/src/lib.rs
ext/{goal,memories,web-search}/src/lib.rs          plugin/src/lib.rs
tools/src/{tool_spec.rs,tool_executor.rs}          worktree/src/lib.rs
otel/src/lib.rs                                    analytics/src/lib.rs
exec-server/src/lib.rs                             apply-patch/src/lib.rs
cli/src（子命令枚举）
```

测试（只统计规模，未逐行读）：

```text
core/tests/suite/{compact.rs,compact_remote.rs,hooks.rs,approvals.rs,unified_exec.rs,
                  network_approval.rs,guardian_review.rs,step_settings.rs,exec_policy.rs,
                  multi_agent_mode.rs,tool_parallelism.rs}
core/src/session/tests.rs        core/src/config/config_tests.rs
core/src/agent/control_tests.rs  core/src/tools/spec_plan_tests.rs
core/src/mcp_tool_call_tests.rs
```
