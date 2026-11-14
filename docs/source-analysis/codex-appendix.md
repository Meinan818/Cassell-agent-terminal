# Codex 源码补读附录：任务生命周期 / Review / Delegate / ExecPolicy / Worktree / Hooks / ext 全部扩展

本文件是 `docs/source-analysis/codex.md` 的**补读附录**，只写 `codex.md` 没覆盖或只写了一句的深层实现。
不重复 `codex.md` 已有的调用链结论（turn 主循环、压缩、世界状态、沙箱选择等），只补可核对的事实、类型、行号和边界。

源码快照：`D:\卡塞尔学院\research-src\codex`，`main / 6ddb87e`。
本机 CLI 版本 `0.167.0-alpha.3.2` 与快照不同，本附录所有结论仅对 `6ddb87e` 成立。
行号均为该提交下的实际行号（用 `(Get-Content <file>).Count` 复核过文件总行数）。

---

## 1 `core/src/tasks/`：任务层不是"多几种 turn"，而是"任务对象 + turn 生命周期"

### 1.1 文件清单

| 文件 | 行数 | 角色 |
|---|---:|---|
| `codex-rs/core/src/tasks/mod.rs` | 1188 | `SessionTask` / `AnySessionTask` / `RunningTask` 装配、启动、收尾、中止 |
| `codex-rs/core/src/tasks/regular.rs` | 177 | 普通对话任务，含 steer 后重开采样 |
| `codex-rs/core/src/tasks/compact.rs` | 111 | 压缩任务（三条实现路径） |
| `codex-rs/core/src/tasks/review.rs` | 285 | `/review` 任务，内部起一个子 Codex 会话 |
| `codex-rs/core/src/tasks/user_shell.rs` | 473 | 用户 `!cmd` 直跑（不经模型） |
| `codex-rs/core/src/tasks/lifecycle.rs` | 121 | turn/thread 生命周期事件分发给扩展贡献者 |
| `codex-rs/core/src/tasks/admission.rs` | 134 | host 侧"准入"（并发/配额）后才真正跑 |
| `codex-rs/core/src/tasks/mod_tests.rs` | 806 | 9 个测试：turn 指标、模型切换用量、硬中止时序等 |
| `codex-rs/core/src/tasks/user_shell_tests.rs` | 62 | 仅 Unix，`/shell` 相关 |
| `codex-rs/core/src/state/turn.rs` | 322 | `TaskKind`（只有 3 个变体）、`RunningTask`、`PendingApproval::validate` |

### 1.2 `TaskKind` 只有三个变体

`core/src/state/turn.rs:75-80`：

```rust
pub(crate) enum TaskKind {
    Regular,
    Review,
    Compact,
}
```

`user_shell` **不是**第四种：`core/src/tasks/user_shell.rs:74-81` 的 `kind()` 返回 `TaskKind::Regular`，只把 span 名改成 `session_task.user_shell`。
所以"任务类型"和"业务种类"是两层：`TaskKind` 用于 steer 能力/生命周期语义判断，`span_name` 用于观测区分。

实证：`tasks/mod.rs:394` 只有 `TaskKind::Regular` 才写 turn 归因；`tasks/mod.rs:736-753` 只有普通 turn 才可能继续接纳输入。

### 1.3 `SessionTask` trait 的真实契约

`core/src/tasks/mod.rs:188-228`：

- `kind() -> TaskKind`
- `span_name() -> &'static str`
- `run(self: Arc<Self>, session, ctx, input, cancellation_token) -> SessionTaskResult`
- `abort(&self, session, ctx)`，默认空实现

关键点（不是文档，是代码强制）：

1. **返回值是 `CodexResult<Option<RegularTaskOutput>>`**（`mod.rs:83`）。只有普通任务会返回 `Some`，其语义是"本轮已经产出了终态回答，但可能还有待处理的 steer 输入"。
2. 返回 `Err` 且 details 是 `TurnAborted` 时，走 aborted-turn 收尾（`mod.rs:728-730`），不是普通错误。
3. `abort()` 里做的是"任务内部状态清理"，例如 review 会在这里补发 `ExitedReviewMode`（`tasks/review.rs:93-95`）。
4. `AnySessionTask`（`mod.rs:230-244`）只是把 async trait 对象化成 `BoxFuture`，没有额外语义。

### 1.4 `start_task` 的完整时序（`mod.rs:295-520`）

按代码顺序，这是 Codex `turn` 真正的"启动协议"：

1. 替换 executor 能力发现缓存（`:301-304`），必要时重新投影 MCP 清单（`:305-312`）。
2. 激活插件选择（`:313`）。
3. 记录 root turn id（`:316-318`）——继承来的 root 优先，后台工作归属它。
4. 观察 pending review 执行（`:322-326`），记录 turn 开始时间（`:328-334`）与起始 token 用量（`:335`）。
5. 建 `CancellationToken` 与 `Notify`（`:337-338`）。
6. 取 `turn_state`，同时判断 `turn_starts_closed()`（server draining）→ `NotSubmitted{ServerDraining}`（`:340-351`）。
7. 发出 `TurnStartPhase::BeforeTaskRegistration` 生命周期（`:353-358`）。
8. 再取一次 `active` 锁，二次判 draining（`:360-366`），并挂 outcome handoff（`:367-376`）。
9. 校验 `turn_state` 仍是同一个（`:377-384`），否则 `NotSubmitted{Superseded}`。
10. 把 mailbox 输入 drain 进本 turn 的 pending 队列（`:386-390`）。
11. 只有 `Regular` 才记录 turn 归因（`:392-396`）。
12. 若有 host 准入（`AgentRuntimeServices::Host`），输入先留在 `pending_initial_input`，等准入成功再取（`:397-408`）。
13. 建 tracing span，字段含 thread/turn/model/reasoning_effort 与 7 个 token 字段（`:417-431`）。
14. 任务体：先 `admission::admit`（如需要），再 `task.run(...)`（`:433-455`）。
15. 任务体之后是一个**循环**：flush rollout → `on_task_finished` → 若返回 `Some(requirements)` 表示"有 steer 输入要接着采样"，就用 `RegularTask::run_turns` 继续（`:456-493`）。
16. `tokio::spawn` + `AbortOnDropHandle`，装配 `RunningTask`（`:497-515`），返回 `Started{turn_id, root_turn_id}`。

**这一条最值得抄**：任务的"完成"不是终点，而是一个判定函数 `on_task_finished`；它决定"结束"还是"继续采样"。

### 1.5 `on_task_finished`（`mod.rs:721-1013`）的真实判定

判定顺序：

1. `Ok(output)` → 普通完成；`TurnAborted` → 标记中断；其他 `Err` → 任务错误（`:726-735`）。
2. `can_continue = regular_output.is_some() && terminal_error.is_none()`（`:736-737`）。
3. 若 `can_continue` 且该 turn 仍可接收 mailbox 投递、且 pending 队列非空 → **直接返回**，把控制权交回 `run_turns`（`:746-753`）。这是"同 turn 续跑"，不产生第二个 `TurnStarted`。
4. 否则把 task 从 active turn 取出、`handle.detach()`（不再 abort-on-drop）、记入 `finishing`（`:754-764`）。
5. 取消 git enrichment 任务（`:765-767`）。
6. 落 `run_hooks_and_record_inputs`（`:789-796`）——用户输入在这里才真正持久化。
7. 若任务从未准入（`unadmitted_task`），调用 `task.abort()` 回滚（`:797-801`）。
8. 记录 token 差值（每个字段 `.max(0)`，避免负数）并写入 span / analytics（`:851-909`）。
9. 决定 idle 原因：中断 / 失败 / 完成（`:934-943`）。
10. 发 `TurnAborted` 或 `TurnComplete`（含 `started_at/completed_at/duration_ms/time_to_first_token_ms`）（`:944-977`）。
11. 清理 active turn，必要时发 thread idle 生命周期，flush rollout，再尝试启动 pending 工作（`:984-1011`）。

### 1.6 中止路径：100ms 优雅窗口（`mod.rs:1051-1183`）

- 常量 `GRACEFULL_INTERRUPTION_TIMEOUT_MS = 100`（`:79`）。
- 先 `cancel()`（`:1066`），若开了 CodeModeInterrupt 还会打断活跃 cell（`:1067-1078`）。
- `select!` 等 `done.notified()` 或 100ms 超时；超时则 `invalidate_critical_path()`，避免为尚未收敛的依赖图报"完整耗时"（`:1084-1094`）。
- 然后 `handle.abort()` 并 `await`（`:1096-1098`）——注释写明"先 join 再冻结 timing"。
- 未落盘的用户输入在中断时会被记录，但**需要 submit hook 的用户输入会被跳过**（`admission.rs:108-131`），要求用户重新提交。
- 中断会写一条模型可见的中断标记（`ContextualUser` 或 `Developer`，取决于 multi-agent 版本）（`:1120-1139`），并在发 `TurnAborted` 前 flush，避免客户端读到旧历史。

### 1.7 四个任务实现的实际行为

**regular（`tasks/regular.rs`）**
- `RegularTaskOutput { last_agent_message, mcp_startup_requirements }`（`:29-32`）。
- 先发 `TurnStarted`（`:74`），再跑 `TurnStartPhase::RegularTaskStart` 与 startup prewarm（`:77-92`）——即"先让 UI 看到 turn 开始，再做预热"，避免首包被预热拖住。
- `run_turns` 循环：跑 `run_turn` → 若终端错误或没有待处理输入就返回 → 否则清空 `next_input` 再跑一轮（`:151-174`）。这就是 steer 的实现位置。

**compact（`tasks/compact.rs`）**
- 压缩是**独立 turn**：自己发 `TurnStarted(TaskKind::Compact)`（`:44`），自己开始 compaction 计时（`:36`）。
- 三条路径（`:53-96`）：
  1. `Feature::TokenBudget` 开启 → `compact_token_budget::run_manual_compact_task`
  2. provider 支持 `RemoteCompactionSupport::V2` → `compact_remote_v2::run_remote_compact_task`（metrics 标 `remote_v2`）
  3. 否则本地：把 `config.compact_prompt` 或内置 `SUMMARIZATION_PROMPT` 当作用户输入，跑 `compact::run_compact_task`（metrics 标 `local`）
- 错误处理很讲究：`TurnAborted` 原样上抛；`UsageLimitExceeded` 只通知扩展、不重复发 error（`:97-108`）。

**review（`tasks/review.rs`）**
- 不是把审查 prompt 塞进当前对话，而是**起一个子 Codex 会话**（`:75-86`）。详见第 2 节。

**user_shell（`tasks/user_shell.rs`）**
- 超时默认 1 小时（`:47`）。
- 两种模式（`:49-57`）：`StandaloneTurn` 自己发 `TurnStarted`；`ActiveTurnAuxiliary` 明确不发，避免同一 turn 出现两对 start/complete。
- 这是**显式全权限逃生口**：`permission_profile = Disabled`、`sandbox = None`，注释直接写"`/shell` is the explicit full-access escape hatch"（`:211-228`）。
- 输出无论成功失败都会落成一条 `user_shell_command_record_item` 记进历史（`:441-469`）；标准 turn 会 `ensure_rollout_materialized`，辅助模式走 `inject_no_new_turn`。

### 1.8 admission（`tasks/admission.rs`）

- 目的：**不阻塞提交分发器**地获取 host 执行容量（文件头注释 `:1-2`）。
- Review 任务不在这里发 `TurnStarted`，因为它要在子会话里转发（`:38-43`）。
- 准入成功后把 guard 挂到**当前 active turn 里那个 ptr 相同的 task**（`:56-63`），并校验未被取消——防止"取消/替换后的任务把许可装进新任务"。
- 这是多代理/多会话共用一套并发额度的实现点。

### 1.9 产品功能点与取舍

- 功能点：多任务种类、steer 续跑、优雅中断、压缩独立生命周期、review 独立会话、host 准入、turn 级 token/耗时指标。
- **学（P0）**：`TaskKind` 三分类 + "完成判定返回是否继续采样" + 压缩独立 turn。
- **学（P1）**：100ms 优雅中断 + 中断标记落历史 + `time_to_first_token_ms` 这类指标。
- **不学**：`AnySessionTask` 的 trait 对象化（我们单进程单 agent，用 enum 分发更简单）；`McpStartupRequirements`（我们没有 MCP 预热需求）。

---

## 2 Review：两条独立路径，且审查模型跑在受限制的子会话里

### 2.1 `core/src/session/review.rs`（179 行）：`spawn_review_thread`

`fn spawn_review_thread`（`:6-12`）做了这些事：

1. 取 review 模型：`config.review_model` 或父 turn 的模型（`:13-16`）。
2. 在线刷新模型列表（`RefreshStrategy::OnlineIfUncached`）（`:17-24`）。
3. **强制关掉三个功能**：`WebSearchRequest`、`WebSearchCached`、`Goals`（`:30-35`）。
4. 若 review 模型与父模型不同、且不支持当前 reasoning effort，则在支持的档位里取"中间偏上"一档（`(len-1)/2`）回退（`:47-60`）。
5. 构造独立 `TurnMetadataState`（含 sandbox tags、auto_review 开关）与 `review_turn_context`（`:118-141`）。
6. 用审查 prompt 作为**初始用户消息**（`:144-152`）。
7. 发 `EnteredReviewMode` 条目，让 UI 切模式（`:165-172`）。
8. `abort_all_tasks(Replaced)` 后 `start_task(..., ReviewTask::new())`（`:162-178`）。

代码里有一条自认的缺口（`:174-176`）：review 借 `spawn_task` 拿 `TurnComplete`，但不发父级 `TurnStarted`，所以生命周期不完全对称。

### 2.2 `core/src/tasks/review.rs`（285 行）：真正的审查执行

`start_review_conversation`（`:98-142`）构造子会话配置：

- `web_search_mode` 强制 `Disabled`（`:108-113`）。
- 关掉 `Feature::Collab` 与 `Feature::MultiAgentV2`（`:114-115`）——**审查代理不能再派生代理**。
- 把 `base_instructions` 换成 `REVIEW_PROMPT`，provenance 标 `Custom`（`:118-119`）。
- 审批策略钉死 `AskForApproval::Never`（`:120`）。
- 模型用 `review_model` 或父模型（`:122-126`）。
- 通过 `run_codex_thread_one_shot(..., SubAgentSource::Review, ...)` 起一次性子 Codex（`:127-139`）。

### 2.3 输出如何回到主流

`process_review_events`（`:144-185`）的事件过滤规则：

| 子会话事件 | 处理 |
|---|---|
| `AgentMessage` | 先缓存，等下一条 `AgentMessage` 到来才把上一条转发给父会话（保证只丢最后一条，用作结构化输出源） |
| `ItemCompleted(AgentMessage)` / `AgentMessageContentDelta` | 丢弃（避免 legacy 事件又触发一次 agent message） |
| `TurnComplete` | 取 `last_agent_message`，`parse_review_output_event` 解析后返回并结束 |
| `TurnAborted` | 返回 `None` |
| 其他 | 原样 `session.send_event` 转发 |

解析（`:192-207`）：先整段 JSON 反序列化成 `ReviewOutputEvent`；失败则截取第一个 `{` 到最后一个 `}` 再试；再失败就把整段文本塞进 `overall_explanation` 兜底。**不假设模型一定输出合法 JSON**。

`exit_review_mode`（`:211-285`）：
- 有输出 → `render_review_exit_success` + `render_review_output_text`；无输出 → 中断文案。
- 先记一条 user 消息（审查结论摘要）、再记一条 assistant 消息（结构化结论）到主历史。
- 发 `ExitedReviewMode` 条目（started + completed）。
- 最后 `ensure_rollout_materialized`，注释明确"审查可能发生在任何正常 turn 之前，所以要显式物化"（`:279-284`）。

### 2.4 取舍

- **学（P0）**：审查 = 子会话 + 受限工具 + 结构化输出契约 + 兜底解析；结论只回写"两三条"到主历史，不回写整个子会话。
- **学（P1）**：审查时关掉联网/多代理/goal。
- **不学**：把 `review_model` 做成独立配置项（我们没有多模型套餐，先复用会话模型）。
- **注意**：这条路径与 `codex review` CLI 子命令是两件事；后者在 `cli`，本附录未展开（见覆盖边界）。

---

## 3 `codex_delegate.rs`：内部委派协议 ≠ 多代理（multi-agents）

### 3.1 `run_codex_thread_interactive`（`:53-203`）

前置硬约束（`:67-76`）：

```rust
if config.permissions.approval_policy.value() != AskForApproval::Never {
    return Err(CodexErr::InvalidRequest("Codex delegates require approval policy `never`".into()));
}
```

即**委派出去的子代理永远不能弹审批**。这是"内部可信子会话"的设计前提。

装配差异（`Session::spawn` 参数，`:105-173`）：

| 参数 | 值 | 含义 |
|---|---|---|
| `attached_thread` | `false` | 不挂到 UI 线程列表 |
| `extensions` | `Isolated` → 空注册表；否则继承父 | 可完全隔离扩展 |
| `inherited_environments` | `Some(父环境快照)` | 共享 cwd/环境 |
| `inherited_exec_policy` | `Some(父命令策略)` | 规则继承，不能自己放宽 |
| `inherited_multi_agent_version` | `Disabled` | **子代理不能再派代理** |
| `fork_persistence` | `Copied` | 历史复制，不共享写 |
| `thread_source` | `GuardianReview` 或 `Subagent` | 观测区分 |

### 3.2 IO 桥接（`:206-231`、`:342-428`）

- `forward_session_io` 建两条通道：事件子→父、Op 父→子，各自带 child token（父取消会级联）。
- `forward_events` 过滤掉 4 类噪声：`TokenCount`、`SessionConfigured`、`McpStartupUpdate`、`McpStartupComplete`（`:361-369`）。
- 发送失败或取消时调 `shutdown_delegate`：先 `Op::Interrupt`、再 `Op::Shutdown`，最多 500ms 抽干事件，避免后台发送打到已关闭通道（`:382-398`）。

### 3.3 `run_codex_thread_one_shot`（`:237-340`）

- 复用 interactive，然后提交一次 turn（带 `parent_turn_id` / `root_turn_id`）（`:272-291`）。
- 桥接任务：收到 `TurnComplete` / `TurnAborted` 就发 `Op::Shutdown` 并 cancel 子 token（`:299-323`）。
- 返回的 `tx_sub` 是**已关闭**的通道（`drop(rx)`），明确"一次性用完，不允许再提交"（`:325-339`）。

### 3.4 与 multi-agents 的区别（有代码证据）

| 维度 | `codex_delegate` | multi-agents（V2） |
|---|---|---|
| 使用者 | 内部功能：review、guardian 等 | 模型通过工具主动派生 |
| 审批 | 强制 `Never`，不允许弹窗 | 继承会话审批策略 |
| 再派生 | 显式 `MultiAgentVersion::Disabled` | 允许，受并发上限约束 |
| UI 可见 | `attached_thread: false`，只转发事件 | 有 agent 路径/名称/花名册 |
| 代码位置 | `core/src/codex_delegate.rs` | `core/src/agent/control/spawn.rs`（1227 行）、`session/multi_agents.rs` |
| 模型提示 | 无"你是子代理"的协商层 | `session/multi_agents.rs` 只有提示词层：`effective_multi_agent_mode` 按 reasoning effort=Ultra 选 `Proactive`，否则 `ExplicitRequestOnly`（`:82-137`） |

**结论**：`codex_delegate` 是"函数调用式的一次性子会话"，multi-agents 是"有身份、有花名册、可通信的代理系统"。我们只抄前者，不抄后者。

---

## 4 `execpolicy`：`Decision` 四态的准确语义

### 4.1 枚举与序列化（`execpolicy/src/decision.rs`，30 行）

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    Allow,       // 可直接跑
    Prompt,      // 交给配置的 reviewer；approval_policy=never 时直接拒绝
    PromptUser,  // 必须一次全新的人工决定，绕过 reviewer
    Forbidden,   // 直接禁止
}
```

三个容易看错、但代码写死的点：

1. **`PromptUser` 的 wire 名是 `"prompt-user"`**（`:15` 的 `#[serde(rename = "prompt-user")]`），其它三个是 `allow`/`prompt`/`forbidden`。
2. **`Decision::parse` 不认 `prompt-user`**（`:21-30` 只匹配三个）。所以：
   - Starlark 规则文件里的 `prefix_rule(decision=...)` 无法表达 `PromptUser`（`parser.rs:358-361` 调 `Decision::parse`）。
   - `network_rule` 只多认一个 `deny` 别名（`parser.rs:253-258`）。
   - `PromptUser` 只从 **`requirements.toml` 的托管规则**进入：`config/src/requirements_exec_policy.rs:42-59`（kebab-case 反序列化），且该文件明确禁止 `allow`（`:85-88`，`AllowDecisionNotAllowed`）。
3. **`Ord` 派生顺序 = 严格程度**：`Allow < Prompt < PromptUser < Forbidden`。多条规则命中时取 `.max()`（`policy.rs:585-591`）。即"最严格者胜"，不是"最后一条胜"。

### 4.2 `Evaluation` 聚合（`policy.rs:571-592`）

```rust
pub struct Evaluation { pub decision: Decision, pub matched_rules: Vec<RuleMatch> }
let decision = matched_rules.iter().map(RuleMatch::decision).max().unwrap();
```

`RuleMatch` 有两种（`rule.rs:77-97`）：`PrefixRuleMatch{matched_prefix, decision, resolved_program, justification, ...}` 与 `HeuristicsRuleMatch{command, decision}`。
`is_match()` 只在**至少一条非启发式规则**命中时为真（`policy.rs:578-583`），用于区分"规则判定"和"启发式兜底"。

### 4.3 `PromptUser` 在核心侧怎么变成审批要求

`core/src/exec_policy.rs:423-509`：

- `Forbidden` → `ExecApprovalRequirement::Forbidden{reason}`。
- `Prompt | PromptUser`：
  - 先算 `prompt_is_rule`（是否由显式规则驱动）。
  - 若当前策略会拒绝 prompt（例如 `never`），转成 `Forbidden`。
  - **`PromptUser` 且未被拒绝** → `NeedsHumanApproval{reason}`（`:470-474`）。
  - `Prompt` → `NeedsApproval{reason, proposed_execpolicy_amendment}`（`:475-492`）。
- `Allow` → `Skip{bypass_sandbox}`，但 `bypass_sandbox` 只有"每一段拆开的命令都被显式 allow 规则命中"才为真（`:495-508`）。

`derive_prompt_reason`（`:1132-1166`）会把文案从 "approval" 改成 "human approval"，并附上规则的 `justification`。**这是"为什么弹窗"可解释性的来源**。

### 4.4 规则写回（`execpolicy/src/amend.rs`，342 行）

- `blocking_append_allow_prefix_rule`（`:65-81`）：把前缀 token 序列化成 JSON 字符串数组，生成
  `prefix_rule(pattern=["git", "status"], decision="allow")`，追加到规则文件。
- `blocking_append_network_rule`（`:85-130`）：生成 `network_rule(host=..., protocol=..., decision=..., justification=...)`；**`PromptUser` 在这里被拒绝**（`:109-113`）。
- 追加实现（`:132-150`）：建目录 → 打开文件 → 加 advisory lock → 若末尾缺换行先补 → 写入。
- 明确标注是阻塞 I/O + advisory lock，async 上下文要 `spawn_blocking`（`:63-64`）。

### 4.5 规则语法（`parser.rs`，475 行）

- 用 Starlark 方言解析，开了 f-string（`:57-60`）。
- 两个内置函数：`prefix_rule(...)`（`:349`）、`network_rule(...)`（`:412`）。
- `prefix_rule` 支持 `match` / `not_match` 示例，并在解析期自校验（`parser.rs:145-147` 调 `validate_*_examples`）。
- `justification` 不允许空串（`:363-369`）。
- 网络规则 host 必须是具体主机，禁止通配（`amend.rs:325-340` 有测试）。

### 4.6 产品功能点与取舍

- 功能点：四态决策、最严格者胜、规则可写回、示例自校验、网络规则独立、`PromptUser` 留给托管策略。
- **学（P0）**：枚举四态 + `max()` 聚合 + "allow 才能 bypass sandbox，且必须每段都 allow"。
- **学（P1）**：批准后写回规则文件（形成可审计的授权累积）+ 禁止把 `bash -c`/`python -c` 做成可复用前缀（`core/src/exec_policy.rs:64 BANNED_PREFIX_SUGGESTIONS`，`codex.md` 已引）。
- **不学**：Starlark 解析器（我们用一个 JSON/TOML 规则表就够，引入 Starlark 是纯成本）。

---

## 5 `worktree`：受管 worktree 的完整契约

### 5.1 文件清单

| 文件 | 行数 |
|---|---:|
| `codex-rs/worktree/src/lib.rs` | 410 |
| `codex-rs/worktree/src/git.rs` | 228 |
| `codex-rs/worktree/src/paths.rs` | 46 |
| `codex-rs/worktree/src/metadata.rs` | 91 |
| `codex-rs/worktree/src/settings.rs` | 92 |
| `codex-rs/worktree/src/git_tests.rs` | 177（测试） |
| `codex-rs/worktree/tests/worktree.rs` | 898（集成测试，未逐行读） |
| `codex-rs/worktree/tests/settings.rs` | 66（测试，未逐行读） |

### 5.2 创建（`lib.rs:62-166`）

1. `settings.root` 必须是绝对路径（`:63-65`）。
2. 规范化 `source_cwd`，求仓库根，算相对子目录（`:67-72`）。**保留"在仓库子目录里发起"**，不是一律回仓库根。
3. 解析 base：`"<base>^{commit}"`，默认 `HEAD`（`:76-85`）。
4. 分配目录（`:86`）。
5. `git worktree add --detach --no-checkout <path> <sha>`（`:88-99`）——先不 checkout，避免立刻触发过滤器。
6. 写目标自己的 `config.worktree` 的 `core.worktree`，再 `git --work-tree=. reset --hard --no-recurse-submodules <sha>`（`:107-141`）——先发现目标侧 filter 再物化文件。
7. 校验 cwd 在 root 内且存在（`is_safe_worktree_cwd`，`:364-369`）；失败回滚（`:148-156`）。
8. 返回 `ManagedWorktree{root, cwd, source_root, source_cwd, head_sha, branch: None}`（`:158-165`）。

任何一步失败都 `remove_worktree(--force)` 回滚（`:142-146`、`:349-362`），并删除空桶。

### 5.3 目录布局（`paths.rs`）

- 桶名是 UUID 的前 4 位十六进制，下一层是仓库名：`<root>/<4hex>/<repo>`（`:25-30`）。
- 最多尝试 `u16::MAX+1` 次（`:25`），全忙则报错。
- macOS 下写 `.metadata_never_index` 关 Spotlight（`:17-23`）。
- `has_managed_layout` 强校验"正好两层 + 桶名 4 位 hex"（`lib.rs:383-398`），防止把用户随便一个 worktree 当受管目录。

### 5.4 列出（`lib.rs:168-272`）：防御性极强

逐个 worktree 校验：
1. `worktree list --porcelain -z` 解析，字段以 NUL 分隔（`:178-206`）。
2. root 与 bucket 都必须是真实目录（`:214-219`）。
3. `.git` 必须是文件（linked worktree 标志）（`:221-222`）。
4. 必须符合受管布局（`:223`）。
5. `--git-common-dir` 必须等于源仓库的 common dir（`:226-229`）。
6. 管理目录里的 `gitdir` 反向指针必须指回本 checkout 的 `.git`（`:232-252`）——防止"别人的 checkout 占了残留注册路径"。
7. cwd 必须安全（`:253-256`）。

### 5.5 归属元数据（`metadata.rs`）

- 文件：`<git-path>/codex-thread.json`，内容 `{version:1, ownerThreadId}`，`deny_unknown_fields`（`:19-27`）。
- `bind_thread`：已存在且同一 thread → 幂等返回；不同 thread → 报错（`:49-59`）。
- 写入用 `NamedTempFile` + `persist_noclobber`（`:61-85`）——原子且不覆盖；竞争的 `AlreadyExists` 会重读确认。

### 5.6 删除（`lib.rs:284-329`）

- 必须是本仓库的受管 worktree（`:286-295`）。
- 不能在待删 worktree 内部执行（`:301-303`）。
- 有 ignored 本地文件就拒绝（`:304-317`）。
- 然后 `git worktree remove`，删空桶。

### 5.7 git 调用加固（`git.rs`）

- 清掉 16 个继承的 Git 选择器环境变量（`GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_CONFIG*`、`GIT_COMMON_DIR` 等，`:146-165`）。
- `-c core.hooksPath=NUL`（Windows）或 `/dev/null`（`:27`、`:171`）。
- 关 `core.fsmonitor`、`attr.tree`、`core.attributesFile`；`GIT_LFS_SKIP_SMUDGE=1`；`GIT_TERMINAL_PROMPT=0`（`:172-179`）。
- working-tree 操作还会把仓库配置的 clean/smudge/process filter 全部置空、`required=false`（`:41-52`、`:184-216`）。
- 这是"跑 git 但不执行仓库自定义代码"的完整做法。

### 5.8 取舍

- 功能点：受管目录布局、base sha 绑定、归属线程、防御性列举、删除保护、git 调用加固。
- **学（P2，但 git 加固可提前到 P1）**：`git.rs` 的环境清理 + hooks/fsmonitor/filter 关闭——这对"我们自己的引擎跑 git 命令"直接有用，且与 UI 无关。
- **学（P2）**：`codex-thread.json` 归属 + `persist_noclobber` 原子绑定。
- **不学**：桶式目录布局（单机单用户，直接 `<worktree-root>/<thread-id>` 更直观）；自动清理（`settings.rs:16` 默认保留 15 个，需要额外生命周期治理，先不做）。

---

## 6 `hooks`：14 类事件、两种执行器、一套失败语义

### 6.1 事件清单（`hooks/src/lib.rs:29-61`）

14 个事件名（原样）：

```text
PreModelRequest, PostModelRequest, PreToolUse, PermissionRequest, PostToolUse,
PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit,
SubagentStart, SubagentStop, Stop, Interrupt
```

其中**只有 9 个事件支持 matcher**（`:51-61`）：`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`SubagentStart`、`SubagentStop`。
原因写在注释里（`:46-50`）：其余事件不针对某个工具/压缩触发/会话来源/结束原因派发，matcher 无意义。

`hook_event_key_label`（`:105-122`）给出持久化用的 snake_case 键；`hook_key`（`:125-135`）拼成 `"{source}:{event}:{group}:{handler}"`，用于"某个 hook 是否被用户启用/信任"的稳定标识。

### 6.2 `types.rs` 只是 legacy 通道（152 行）

- `HookFn`、`HookResult::{Success, FailedContinue, FailedAbort}`（`:12-30`）。
  - `FailedContinue`：记账后继续跑后续 hook，操作继续。
  - `FailedAbort`：不再跑后续 hook，操作中止。
- `HookPayload{session_id, cwd, client, triggered_at, hook_event}`（`:62-72`）。
- **`HookEvent` 只有一个变体 `AfterAgent`**（`:90-97`）。

这一点很容易误读：14 类事件的真正定义/派发不在 `types.rs`，而在 `hooks/src/events/*`；`types.rs` 只服务内部函数式 hook（`legacy_notify`）。

### 6.3 执行器：`ClaudeHooksEngine`（`engine/mod.rs:276-287`）

结构体名就叫 `ClaudeHooksEngine`，字段：

- `enabled`
- `handlers: Arc<Vec<ConfiguredHandler>>`（每个 turn 共享，executor overlay 才复制）
- `hook_entries: Arc<Vec<HookListEntry>>`（UI 列表）
- `warnings` / `required_load_errors`
- `command_runtime: CommandHookRuntime`
- `mcp_executor: Arc<dyn HookMcpExecutor>`

`ConfiguredHandler`（`:65-78`）字段：`builtin`、`plugin_trust`、`event_name`、`matcher`、`timeout_sec`、`status_message`、`additional_context_limit`、`source_path`、`source`、`display_order`、`kind`。

`ConfiguredHandlerKind`（`:149-160`）只有两种：`Command{command, env, async}`、`McpTool{server, tool, input}`。

执行模式（`:194-204`）：
- `ExecutorScoped` 永远 `Async`。
- `Command{async:true}` → `Async`。
- `Command{async:false}` / `McpTool` → `Sync`。

**只有 `Sync` 能施加控制效果**（`:207-209`）：阻断、改写输入、注入上下文。异步 hook 只能做事后副作用。

### 6.4 派发（`engine/dispatcher.rs`，683 行）

- `select_handlers_for_matcher_inputs`（`:41-78`）：同一个 handler 只检查一次，即使多个兼容别名都匹配正则（注释示例 `apply_patch|Write|Edit` 只跑一次）。
- `execute_handlers_with_metadata`（`:123-203`）：
  - async handler 交给 `command_runtime.schedule_async_hook`，不参与结果聚合。
  - sync handler 放进 `FuturesUnordered` 并行跑。
  - 结果按 `configured_order` 排序返回（报告稳定），但记录 `completion_order`（用于 PreToolUse 的"最后一次改写胜"）。
  - `should_block` 为真（且未 stop）时**不再执行 executor-scoped hooks**（`:176-200`）——被阻断的调用不触发清理 hook。
- `scope_for_event`（`:277-294`）：`SessionStart/SessionEnd/SubagentStart` 是 thread 级，其余 11 个是 turn 级。

### 6.5 失败语义（以 PreToolUse 为例，`events/pre_tool_use.rs`）

`parse_completed`（`:199-317`）的判定表：

| 情况 | status | 是否阻断 |
|---|---|---|
| `run_result.error` 非空 | `Failed` | 否 |
| exit 0 + 空 stdout | `Completed` | 否 |
| exit 0 + 合法 JSON + `block_reason` | `Blocked` | 是（并回填 reason 给模型） |
| exit 0 + 合法 JSON + `invalid_reason` | `Failed` | 否（不采纳其控制效果） |
| exit 0 + 合法 JSON + `updated_input` | `Completed` | 否（改写输入） |
| exit 0 + 看起来像 JSON 但解析失败 | `Failed` | 否 |
| **exit 2 + stderr 非空** | `Blocked` | 是（stderr 作为理由） |
| **exit 2 + stderr 为空** | `Failed` | 否（视为 hook 写错） |
| 其他非 0 | `Failed` | 否 |
| 无退出码 | `Failed` | 否 |

这条语义直接来自 Claude Code 的 hook 协议（exit 2 = block，stderr = 理由）。`delegate`/`engine` 里没有额外魔改。

聚合（`:119-137`）：任一 handler `should_block` 即整体阻断；`updated_input` 取**完成顺序最晚**的一条（`:153-171`）；阻断时不采纳任何改写。

`PreToolUseOutcome`（`:42-49`）四个输出：`should_block`、`block_reason`、`additional_contexts`、`updated_input`。

其他事件的 outcome 形状（`engine/output_parser.rs:1-73`）：
- `SessionStartOutcome{should_stop, stop_reason, additional_contexts}`
- `StopOutcome{should_stop, stop_reason, should_block, block_reason, continuation_fragments}`（`events/stop.rs`）
- `PermissionRequestOutcome{decision: Allow | Deny{message}}`
- `UniversalOutput{continue_processing, stop_reason, suppress_output, system_message}` 是所有命令 hook 输出共有的外壳。

### 6.6 发现与信任（`engine/discovery.rs`，1963 行）

- `DiscoveryMode::{Runtime, Listing}`（`:98-102`）。
- `discover_handlers`（`:118`）聚合四类来源：配置层 `config.toml` 的 `hooks` 表（`:433`）、`hooks.json`（`:390`，按文件夹去重）、托管 requirements（`:241`）、插件 hook sources（`:280`）。
- hook 身份用 `hook_hash`（`:981`）和 `hook_trust_status`（`:1000`）判断，配置里存的是 hash 而不是内容——插件更新后 hook 自动失效，需要重新信任。
- `required_load_errors` 与普通 `warnings` 分开：托管必需 hook 加载失败会让 `ensure_required_hooks_loaded` 返回错误（`:52-59`），即**托管 hook 失败是致命错误**，普通 hook 失败只是警告。

### 6.7 取舍

- 功能点：14 事件、matcher、sync/async 双执行器、命令与 MCP 两种 handler、exit-code 语义、上下文注入、输入改写、信任哈希、托管必需 hook。
- **学（P0）**：PreToolUse / PostToolUse / PermissionRequest / UserPromptSubmit / SessionStart / Stop 这 6 个事件 + exit 2 阻断语义 + "阻断时跳过清理 hook"。
- **学（P1）**：`additional_context` 注入与 `updated_input` 改写 + 信任哈希。
- **不学**：14 个全量事件（`PreModelRequest`/`PostModelRequest`/`PreCompact`/`PostCompact`/`SubagentStart`/`SubagentStop`/`Interrupt` 我们暂无可插入的产品位）+ MCP handler + executor-scoped hook。

---

## 7 `ext/` 全部 18 个扩展 crate：逐个看真实代码

统计口径：`src/**.rs` 非测试文件行数（不含 `tests/` 与 `*_tests.rs`）。目录级清单共 18 个，与 `codex-rs/ext/` 实际目录数一致。

### 7.1 `ext/agent` — `codex-agent-extension`，102 行 / 1 文件

- 入口：`src/lib.rs`。
- 关键类型：`AgentInvocation{config, prompt, parent_trace}`、`AgentRun{thread_id, turn_id, thread}`、`AgentRunner{thread_manager: Weak<ThreadManager>}`。
- 真实行为：`AgentRunner::start(parent_thread_id, invocation)` → `thread_manager.spawn_legacy_subagent(...)`（注释明确"分页父线程会被拒绝"）→ `thread.start_turn_if_idle` 提交 prompt 文本；空 prompt 直接 `InvalidRequest`；提交失败也报错。
- 产品功能：给"已解析好的子代理 prompt"提供一个最小启动器，落在 legacy 线程分叉上。
- 取舍：**不采用**。我们已有 EVA/Code 单模式会话，不需要 legacy 子代理线程栈。

### 7.2 `ext/agent-message-board` — `codex-agent-message-board-extension`，447 行 / 4 文件

- 入口：`src/lib.rs`（`BoardBackend`、`install`、`local_board_options`，命名空间 `agent_message_board`）。
- 真实行为：`src/extension.rs` 用工厂 `BoardFactory`（`Fn(&ThreadStartInput, SessionId, ThreadId) -> Option<Arc<dyn AgentMessageBoard>>`）按会话/线程身份打开 board，装上 `message_board_tools`；命名空间由 host 配置解析；**打开失败 → 工具不可用 + 发 warning，不阻塞会话**（文件头注释）。
- 产品功能：多代理之间的持久留言板（发布/订阅/历史）。
- 取舍：**不采用**。我们的 NORMA/EVA 是"两个模式共享记忆"，不是多代理群聊。

### 7.3 `ext/connectors` — `codex-connectors-extension`，74 行 / 2 文件

- 入口：`src/lib.rs` → `plugin_app.rs`。
- 真实行为：`PluginAppProvider::load(&ResolvedExecutorPlugin)` 从插件 manifest 的 `paths.apps`（Environment 定位器）读配置文本，`codex_connectors::parse_plugin_app_config` 解析成 `Vec<AppDeclaration>`；未声明 apps 返回空。
- 产品功能：把插件声明的"App / connector"注入 MCP 面。
- 取舍：**不采用**（我们是本地桌面引擎，不做 App 连接器市场）。

### 7.4 `ext/extension-api` — `codex-extension-api`，2795 行 / 26 文件

- 入口：`src/lib.rs`（导出全表）、`src/contributors.rs`（481 行，全部 trait）、`src/model_request.rs`、`src/tool_policy.rs`、`src/session_isolation.rs`、`src/turn_admission.rs`、`src/registry.rs`、`src/state.rs`、`src/capabilities/*`。
- 真实行为：定义一整套贡献者 trait，由 `ExtensionRegistryBuilder` 注册、`ExtensionRegistry` 分发：

| trait | 钩子 | 用途 |
|---|---|---|
| `McpServerContributor` | `contribute` / `selected_plugins` | 增删 MCP server |
| `ContextContributor` | `contribute_thread_context` / `contribute_turn_context` / `contribute_world_state` | 注入 prompt 片段与世界状态 |
| `ThreadLifecycleContributor` | `on_thread_start/ready/resume/idle/stop` | 线程生命周期 |
| `TurnLifecycleContributor` | `on_turn_start/stop/abort/error`、`on_item_completed`、`refresh_catalog_for_step` | turn 生命周期 |
| `TurnInputContributor` | `contribute` | 改写/追加用户输入 |
| `ConfigContributor` | `on_config_changed` | 配置热更新 |
| `TokenUsageContributor` | `on_token_usage` | 用量结算 |
| `SkillInvocationContributor` | `on_skill_invocation` | skill 隐式/显式调用 |
| `ToolContributor` | `prepare_for_step` / `tools` / `tools_for_step` | 工具注入（可按 step 变化） |
| `ToolLifecycleContributor` | `on_tool_dispatch/start/command_start/mcp_tool_result/finish/timing` | 工具生命周期与计时 |
| `ApprovalReviewContributor` | `decide` | 审批决策参与 |
| `TurnItemContributor` | `contribute` | UI 条目 |
| `ModelRequestContributor` / `ModelResponseInterceptor` | 请求/响应拦截 | 模型层拦截 |

  另有 `ToolPolicy`（工具暴露策略）、`SessionIsolation::{Inherit, Isolated}`、`TurnStartAdmission`、`ExtensionData`（分层 store：session/thread/turn/step）。
- 产品功能：**Codex 的"一切皆可扩展"底座**。`ext/` 其余 17 个 crate 全部是它的客户。
- 取舍：**借概念，不借体量**。我们只需要 3 个钩子：`on_tool_start` / `on_tool_finish` / `on_turn_finish`，加一个 `ToolPolicy` 过滤工具面。2795 行/26 文件的注册表体系对我们是纯债务（这与"不喜欢 DSH 一切皆插件"的判断一致：Codex 也是同一路线，只是做得更工程化）。

### 7.5 `ext/git-attribution` — `codex-git-attribution`，315 行 / 3 文件

- 入口：`src/lib.rs`，`install(registry, auth_manager, base_url, http_client_factory)`。
- 真实行为：实现 `ContextContributor::contribute_world_state`，产出一节世界状态，内容是"agent 创建 commit/PR 时如何署名"的策略。策略来自后端 `resolve_attribution_policy`，带三重保护：按 `auth_generation` 失效、失败后 `GitAttributionRetry{retry_at}` 退避、判定结果缓存在 `thread_store`。
- 产品功能：企业侧决定"AI 参与的提交要不要署名"，且失败时默认关闭（`enabled=false`）。
- 取舍：**不采用**（我们自己的记录规则是"不添加 AI 署名"，这条是相反的商业功能）。

### 7.6 `ext/goal` — `codex-goal-extension`，3445 行 / 11 文件

- 入口：`src/lib.rs`；核心文件 `spec.rs`（94 行，工具 schema）、`extension.rs`（625 行）、`runtime.rs`（647 行）、`accounting.rs`（636 行）、`tool.rs`（524 行）、`api.rs`（345 行）、`steering.rs`（139 行）。
- 三个工具（`spec.rs:9-11`）：`get_goal`、`create_goal`、`update_goal`。
- 状态只有三种（`spec.rs:60-93`）：`complete` / `blocked` / `paused`，且 prompt 文本把判定规则写死：
  - `paused` 必须用户明确要求；
  - `complete` 必须目标真的达成且无剩余必做项；
  - `blocked` 必须"同一阻塞连续 3 个 goal turn"且 agent 无法推进；
  - 预算耗尽**不能**当作完成。
- 真实行为：
  - `GoalExtension::on_thread_start` 建 `GoalRuntimeHandle` + `GoalAccountingState`，并把父线程的 accounting 传给子线程（`extension.rs:102-163`）——子代理消耗算进父目标预算。
  - `on_thread_idle` → `continue_if_idle()`（`runtime.rs:434-531`）：读持久化 goal，只有 `status == Active` 且无 continuation deferral 才 `start_turn_if_idle`，`turn_trigger = "goal"`。**这就是"目标没完成就自动接着干"的实现**。
  - 预算耗尽走 `usage_limit_active_goal_for_turn` / `BudgetLimitedGoalDisposition`（`accounting.rs:79`），并通过 `steering.rs::budget_limit_steering_item` 把提示注入当前 turn。
  - `api.rs::GoalService` 允许外部（host/UI）设置/清除目标，与 agent 工具走同一把 `goal_state_permit` 信号量（`runtime.rs:154-188`）。
- 产品功能：持久化目标 + token 预算 + 空闲自动续跑 + 预算耗尽优雅停止。
- 取舍：**P1 学"目标持久化 + 空闲续跑 + 预算会计"**（这是"持续推进"最直接的工程化答案）；**不学**它把 goal 做成独立扩展 crate 的分层（我们直接进 `engine/goal.rs`）；不学 `blocked` 三次审计这种 prompt 级纪律（我们写进自己的规则文档即可）。

### 7.7 `ext/guardian-reviewer` — `codex-guardian-reviewer`，5546 行 / 33 文件（含测试 7933 行）

- 入口：`src/lib.rs`（134 行，全是 `pub use`）；核心 `src/review.rs`（253 行，`ReviewHost` trait）、`src/assessment.rs`（109 行，输出契约）、`src/pool.rs`、`src/retry.rs`、`src/circuit_breaker.rs`、`src/deadline.rs`、`src/elicitation.rs`。
- 真实行为：
  - `ReviewHost`（`review.rs:35-84`）把"谁绑定动作、谁采证、谁执行决定"拆成 7 个方法：`permissions` / `servicing_turn` / `validate_action` / `prepare` / `attempt` / `cached_approval_is_current` / `emit` / `record_evidence` / `interrupt`。host 负责权威与副作用，reviewer 只负责判定。
  - 输出契约（`assessment.rs:13-22`、`:77-104`）：`risk_level ∈ {low, medium, high, critical}`，`outcome ∈ {allow, deny}`，另有可选 rationale；低风险允许直接输出 `{"outcome":"allow"}`。
  - 上限：`MAX_REVIEW_ATTEMPTS = 3`（`lib.rs:87`）、`REVIEW_TIMEOUT = 90s`（`lib.rs:89`）。
  - 熔断：`GuardianRejectionCircuitBreaker` + `AUTO_REVIEW_DENIAL_WINDOW_SIZE`（`lib.rs:72-75`），连续拒绝过多就停用自动审查。
  - 缓存审批必须 `cached_approval_is_current` 重新验证动作与历史生命周期（`review.rs:66-70`），防"旧审批套新动作"。
- 产品功能：把"要不要批准这次危险命令"交给一个结构化输出的审查模型。
- 取舍：**P2/不采用**。理由不是技术难，而是产品定位：我们自用、单用户，引入第二个审查模型只会增加延迟与额度消耗。但**要抄它的两个纪律**：① 审批缓存必须重新校验动作；② 拒绝次数要有熔断。

### 7.8 `ext/guardian-v2` — `codex-guardian-v2`，6359 行 / 30 文件（含测试 19434 行）

- 入口：`src/lib.rs`（18 行，只 `pub(crate) use extension::install`），两半：`src/async_scorer/*`、`src/sync_reviewer/*`。
- `async_scorer`（后台评分器）：`classification.rs` 在后台采样一段 observation；`score.rs` 把"缓存分 + 授权 + 覆盖度"在同一把锁下发布（文件头注释），失败不覆盖更新的样本；`decisions.rs` 是"有界 Decisions 传输"，队列满时丢最旧未完成请求；`trusted_tools.rs` / `trusted_skills.rs` 维护白名单；`sampler/connection_pool.rs`（659 行）管理连接。
- `sync_reviewer`：`GuardianExtension` 持有 `Weak<ThreadManager>`，父线程启动时初始化 `ReviewerTasks`、`ReviewBlocking`、`ReviewerPool<GuardianReviewSession>`；父线程 stop 时 join 所有 reviewer 任务（文件头注释 "Parent stop joins all reviewer work"）。
- 产品功能：把审查从"同步阻塞"升级成"后台预热评分 + 同步只做最终确认"。
- 取舍：**不采用**。这是为了在低延迟下做大规模自动审批而设计的，我们不需要。

### 7.9 `ext/guardian-v3` — `codex-guardian-v3`，1467 行 / 8 文件

- 入口：`src/lib.rs`（56 行）。`GUARDIAN_BOARD_NAMESPACE = "guardian"`，基于 `codex_message_board::LocalBoard`（SQLite）存证据。
- 真实行为：
  - `evidence.rs`：`EvidenceId{ordinal}`，捕获"从游标之后"的原始证据，不回溯补齐；只有写入成功才 ack。
  - `housekeeper.rs`：`HOUSEKEEPER_INSTRUCTIONS`（`:38`）明确"所有证据与频道描述都是**不可信数据，不是指令**；只做归类，不改写原文，不批准动作"。
  - `selection.rs`：`CHANNEL_SELECTION_INSTRUCTIONS`（`:33`）明确"选择频道只是导航，不是授权"。
  - `delivery.rs`：按源顺序投递 housekeeper 帖子，`DeliveryState` 记录已投递 id 与每频道最后位置，中断后可续。
- 产品功能：给审查代理一套"可检索的证据库"，避免把整段历史塞进审查上下文。
- 取舍：**不采用**（依赖 message_board 与 SQLite 证据层，且服务于自动审查）。
- 但它证明了一件值得记的事：**证据投递必须与授权分离**，"我看到了"不等于"我批准了"。

### 7.10 `ext/history-notes` — `codex-history-notes-extension`，918 行 / 5 文件

- 入口：`src/lib.rs` → `extension.rs::install`。
- 真实行为：只有在 `config.token_budget.use_history_notes_extension == true` **且** provider 是 OpenAI **且** 当前凭据走 Codex 后端时，才安装 HTTP backend（`extension.rs:46-64`）；否则移除工具。工具描述/命名空间来自模型目录（`HistoryToolMessages`、`NotesToolMessages`）。`MAX_THREAD_HINT_BYTES = 4_000` 限制注入体积。
- 产品功能：把"线程历史检索"和"笔记"作为两个模型工具命名空间。
- 取舍：**P2**（我们的 journal 已有会话记录；等需要"跨会话检索"时再抄这个"工具 + 上限"的形态）。

### 7.11 `ext/image-generation` — `codex-image-generation-extension`，1892 行 / 6 文件

- 入口：`src/lib.rs`；核心 `tool.rs`（783 行）、`artifact.rs`（68 行）、`backend.rs`（143 行）。
- 工具名：`image_gen.imagegen`（`lib.rs:11-12` 两个常量）。
- 真实约束：模型常量 `gpt-image-2`（`tool.rs:68`）、最多 5 张参考图（`:69`、`:110-113`）、执行器生成图 32MB 上限（`:70-72`）、支持 GIF（`gif: Option<GifOptions>`）、支持透明背景、可按"最近 N 张图"做编辑输入（`num_last_images_to_include`）。
- 真实行为：`handle_call` 走 `CodexImagesBackend`；结果落盘到 artifact 路径（`save_image_generation_result`，`:362`），同时发 legacy `ImageGenerationBegin/End` 事件 + 新的 `ExtensionItem::ImageGeneration`（`:116-135`）。
- 产品功能：模型可直接生成/编辑图片，产物是**文件**而非 base64 塞回上下文。
- 取舍：**P2**（我们生图走本机 Kitool 技能，不占用模型工具位）；但"产物落盘 + 只回路径"这条策略要抄。

### 7.12 `ext/items` — `codex-extension-items`，520 行 / 5 文件

- 入口：`src/lib.rs`。
- 真实行为：定义 `ExtensionItem` 枚举，serde tag 是 `kind`，三个变体：`image_gen.generation`、`clock.sleep`、`web.search`；`id()` 只暴露 id，不把变体字段泄漏给 core/rollout。crate 位置刻意放在 `codex-protocol` 之下，让 core 能承载扩展条目而不拥有它们的显示 schema。
- 产品功能：扩展自有 UI 条目的类型化通道。
- 取舍：**P2**（我们 UI 冻结，暂不加新条目类型；但"扩展条目要有命名空间 + 稳定 id"值得记）。

### 7.13 `ext/mcp` — `codex-mcp-extension`，1816 行 / 10 文件

- 入口：`src/lib.rs` → `HostedPluginRuntimeExtension`（实现 `McpServerContributor`）。
- 真实行为：`Feature::Apps` 关闭时返回 `McpServerContribution::Remove{name}`；开启时注入 `HostedApps` 配置（`hosted_plugin_runtime_mcp_server_config(chatgpt_base_url, apps_mcp_product_sku, originator)`）。另含 `plugin.rs`（468 行）、`stream_manager.rs`（269 行，`McpEventStreamManager`）、`cloud_plugin.rs`（272 行）。
- 产品功能：ChatGPT Apps / 插件市场的 MCP 接入。
- 取舍：**不采用**（云端 App 市场与我们本地自用目标无关）。

### 7.14 `ext/memories` — `codex-memories-extension`，2546 行 / 18 文件

- 入口：`src/lib.rs`（常量集中在这里）；核心 `extension.rs`（161 行）、`local/*.rs`、`tools/*.rs`。
- 四个工具（`lib.rs:18-22`）：`memories.add_ad_hoc_note`、`memories.list`、`memories.read`、`memories.search`。
- 硬上限（`lib.rs:11-16`）：list 默认/最大 2000 条；search 默认/最大 200 条；read 默认 20000 token；注入给模型的说明摘要上限 2500 token。
- 真实行为：
  - 只有 `Feature::MemoryTool && config.memories.use_memories` 且 `dedicated_tools` 为真才装工具（`extension.rs:46-53`、`:148-150`）。
  - 走"说明 + 工具"两段式：`build_memory_tool_developer_instructions` 生成说明注入为 `PromptFragment`（kind = `READ_INSTRUCTIONS_KIND`）；V2 会把说明按 8900 字节切片（`extension.rs:75-93`）。
  - backend 是本地目录：`codex_home/<memory_version.directory_name()>`（`extension.rs:152-158`），纯文件，不依赖数据库。
  - `search` 支持多 query、`match_mode`（any/all/window）、`path`、`cursor`、`context_lines`、`case_sensitive`、`normalized`（`tools/search.rs:28-42`），并声明 `supports_parallel_tool_calls() = true`（`:58-60`）。
  - 错误分两类（`tools/mod.rs:95-112`）：参数/路径类错误回给模型（`RespondToModel`），IO 错误直接 `Fatal`。
- 产品功能：本地文件式长期记忆 + 检索工具 + 明确的预算上限。
- 取舍：**P1 采用（与我们的记忆库天然对齐）**：`list/read/search` 三工具 + 多 query + context_lines + 明确上限；**不采用** `add_ad_hoc_note` 的"模型直接写记忆"（我们自己维护记忆文件，模型只读）。

### 7.15 `ext/multi-env-copy-file` — `codex-multi-env-copy-file`，198 行 / 3 文件

- 入口：`src/lib.rs` → `tool.rs`。
- 工具：`multi_env_copy_file`，参数 `source_environment_id`、`source_path`、`target_environment_id`、`target_path`（`tool.rs:21-33`）。
- 真实行为：流式拷贝，**字节不进模型上下文**；中断可能留下部分目标文件（文件头注释与描述文本都明说）。
- 产品功能：跨执行环境搬文件。
- 取舍：**不采用**（我们单机单环境）。

### 7.16 `ext/queue` — `codex-queue-extension`，659 行 / 2 文件

- 入口：`src/lib.rs` → `service.rs`。
- 真实行为：`QueuedItemService` 基于 `codex_thread_store::QueueStore` 做持久化队列（`MAX_QUEUE_ITEMS`），只接受用户输入（`QueueServiceError::InvalidInput`），校验长度上限（`InputTooLarge`）；`ThreadLifecycleContributor::on_thread_idle` 时把队列项提交为新 turn；`watch_external_messages` 监听外部消息。
- 产品功能：用户排队发消息，空闲自动开始下一条。
- 取舍：**P1 可抄"输入队列 + 空闲派发"**（我们的 NORMA 模式需要"任务队列"而不是"消息队列"，概念可复用）；**不采用**它的持久化存储层。

### 7.17 `ext/skills` — `codex-skills-extension`，14469 行 / 62 文件（含测试 23093 行）

- 入口：`src/lib.rs`（66 行）；核心 `extension.rs`（612 行）、`catalog.rs`（461 行）、`render.rs`（1117 行）、`world_state.rs`（229 行）、`world_state_catalogs.rs`（503 行）、`loader/*`、`provider/*`、`dynamic_skill_selector/*`（18 个文件）、`shadow_selection_experiment/*`。
- 三个工具（`tools/*.rs`）：`skills.list`、`skills.read`、`skills.installations`。
- 真实行为：
  - 线程上下文里注入"技能目录"片段（`extension.rs:198-256`），受 `config.include_instructions`、`omit_descriptions`、`max_context_tokens` 控制；渲染器是 `render_catalog(... SkillCatalogRenderPolicy::EXTENSION_COMPATIBLE.with_omitted_descriptions(...))`。
  - 每个 step 准备目录（`prepare_for_step`，`:270-283`），工具按 step 注入（`tools_for_step`，`:285-297`）——**技能列表可以随 step 变化**。
  - `SkillInvocationContributor` 处理隐式/显式调用（`:308+`）。
  - `dynamic_skill_selector/` 里有 8 种选择策略：`lru`、`lru_plus_lexical`、`lru_plus_character_routing`、`weighted_lexical`、`multi_query_lexical`、`fielded_bm25`、`routing_card_lexical`、`rrf_lexical_char`，外加 `character_ngram`。**这是"技能太多时怎么挑"的实验场**。
  - `shadow_selection_experiment/`（574 行）做"影子选择"：用另一套策略并行选中，只记录不生效，用于评估。
- 产品功能：技能发现 → 目录渲染 → 按需读取 → 调用记账，全链路。
- 取舍：**P1 采用"目录 + 按需 read"的形态**（我们已有技能目录，缺的是 `skills.list`/`skills.read` 两个工具和预算控制）；**不采用** 8 种检索策略与影子实验（我们技能数量少，文件名 + 描述关键词足够）。

### 7.18 `ext/web-search` — `codex-web-search-extension`，1012 行 / 6 文件

- 入口：`src/lib.rs`；核心 `tool.rs`（386 行）、`extension.rs`（240 行）、`history.rs`（210 行）、`schema.rs`（40 行）。
- 工具名：`web.run`（`tool.rs:48-49`，命名空间 `web`）。
- 真实行为：
  - 请求体是一个**命令联合体** `SearchCommands`（`codex-api/src/search.rs:32-69`）：`search_query`、`literature_search_query`、`image_query`、`open`、`click`、`find`、`screenshot`、`finance`、`weather`、`sports`、`time`、`response_length`。模型一次可以下多个动作。
  - 查询对象 `SearchQuery{q, recency(days), domains}`（`search.rs:71-84`）——**时效性与域名过滤在协议层**，不是提示词约束。
  - 走 `SearchClient`；当重定向策略要求拒绝或带账号路由头时，客户端固定打到 provider 的 `alpha/search` 路径（`tool.rs:122-145`）；并透传 turn 元数据头（`X_CODEX_TURN_METADATA_HEADER`）。
  - 模式映射（`extension.rs:87-93`）：`Disabled|Cached → external_web_access=false`；`Indexed → ExternalWebAccessMode::Indexed`；`Live → true`。设置里还有 `user_location`、`search_context_size ∈ {low,medium,high}`、`allowed_domains`（`:57-85`）。
  - 是否暴露 `literature_search_query` 由 provider 能力决定（`schema.rs:10-32` 直接从 schema 里删字段）。
  - `supports_parallel_tool_calls() = true`，`exposure = Direct`（`tool.rs:91-97`）。
- 产品功能：联网搜索 / 学术检索 / 打开页面 / 点击链接 / 页内查找 / 截图 / 金融天气体育时间等结构化查询。
- 取舍：**P1 采用"命令联合体 + recency/domains 参数 + 模式开关"**这套协议形状；**不采用**它绑定单一后端 `alpha/search`（我们没有这个后端，需要换成自建搜索服务或多provider 适配）。**不采用** `open/click/screenshot`（涉及浏览器自动化，风险与 UI 冻结冲突）。

### 7.19 18 个 crate 的一句话归纳

| crate | 一句话 | 我们 |
|---|---|---|
| `agent` | legacy 子代理启动器 | 不采用 |
| `agent-message-board` | 多代理留言板 | 不采用 |
| `connectors` | 插件 App 声明加载 | 不采用 |
| `extension-api` | 全量贡献者框架 | 借 3 个钩子 |
| `git-attribution` | 提交署名策略 | 不采用 |
| `goal` | 持久目标 + 预算 + 空闲续跑 | P1 |
| `guardian-reviewer` | 结构化输出审查 + 熔断 | P2/不采用（借纪律） |
| `guardian-v2` | 后台预评分 + 连接池 | 不采用 |
| `guardian-v3` | 证据库 + 频道检索 | 不采用 |
| `history-notes` | 历史/笔记工具 | P2 |
| `image-generation` | 生图工具 + 产物落盘 | P2 |
| `items` | 扩展 UI 条目类型 | P2 |
| `mcp` | Apps/插件 MCP 接入 | 不采用 |
| `memories` | 文件式记忆 + 检索工具 | P1 |
| `multi-env-copy-file` | 跨环境搬文件 | 不采用 |
| `queue` | 持久消息队列 + 空闲派发 | P1（借概念） |
| `skills` | 技能目录 + 按需读取 | P1 |
| `web-search` | 命令联合体联网检索 | P1（换后端） |

---

## 8 三个 core 文件：`shell_snapshot.rs` / `image_preparation.rs` / `turn_metadata.rs`

### 8.1 `core/src/shell_snapshot.rs`（1221 行）

**作用**：把用户 shell 的 alias/函数/环境一次性抓下来，写成可 `source` 的脚本；之后每条命令都在这份"快照"里执行，从而让模型跑的命令与用户手敲的行为一致（而不是每次都从干净环境起）。

**关键常量**（`:108-110`）：

```rust
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(10);
const SNAPSHOT_RETENTION: Duration = Duration::from_secs(60 * 60 * 24 * 3); // 3 天
const SNAPSHOT_DIR: &str = "shell_snapshots";
```

**关键类型**：
- `ShellSnapshot{config: Option<Arc<ShellSnapshotConfig>>, credential_broker}`（`:52-56`）；`disabled()` 让功能整体关闭。
- `ShellSnapshotFile{path, credentials, shell_environment_policy}`（`:75-79`）。
- `SnapshotCredentialBrokerState::{Starting, Inactive, Unavailable, Ready(NetworkProxy)}`（`:67-73`）。

**真实流程**：
1. `build()`：远端环境直接返回 `None`（`:164-166`）。
2. 生成路径 `<codex_home>/shell_snapshots/<session_id>.<nanos>.sh|ps1` 与临时路径（`:262-275`）。
3. `capture_snapshot()`：用 `snapshot_capture_script` 抓 declarations + 可选环境（`:594-602`）；是否 login shell 由 broker 配置决定（`:589-607`）。
4. 写临时文件 → `validate_snapshot()` 实际跑一遍验证（`:310-322`）→ `fs::rename` 原子发布（`:324-328`）。
5. 后台 `cleanup_stale_snapshots` 清理超期快照（`:280-286`、保留期见常量）。
6. 有 credential broker 时，快照里存的是**脱敏环境**，真正凭据在子进程准备阶段由 `restore_credentials()` 注入，并用 `CREDENTIAL_BROKER_ACTIVE_ENV_KEY` 标记（`:368-459`）。

**关键限制（必须记住）**：

```rust
if shell_type == ShellType::PowerShell || shell_type == ShellType::Cmd {
    bail!("Shell snapshot not supported yet for {shell_type:?}");   // :551-553
}
```

**Windows 上这个功能整体不可用**。所以对我们的 Windows 桌面引擎，不能照抄这条实现；要抄的是"原子发布 + 先验证再启用 + TTL 清理 + 凭据不落盘"这四条纪律。

**取舍**：P2（Windows 侧无法直接用）；如果将来做 PowerShell profile 捕获，可以复用它的"临时文件 → 验证 → rename"三步。

### 8.2 `core/src/image_preparation.rs`（547 行）

**作用**：所有进入模型的图片（用户消息里的、工具输出里的）在发出前统一预处理；失败时**降级成占位文本**而不是报错中断。

**占位文案**（`:39-45`）：
- `image content omitted because it could not be processed`
- `... exceeded the supported size limit; use a smaller image`
- `... detail 'low' is not supported; use 'high', 'original', or 'auto'`
- `... remote image URLs are not supported`

**关键类型/函数**：
- `ImagePreparationMode{unified_budget, decoder, replay}`（`:47-70`）；解码器 `PromptImageDecoder::{Sanitizer, Legacy}` 由 `Feature::SafeImageDecoder` 切换（`:72-78`）。
- `prepare_response_items(...)`（`:169-265`）：只处理 `Message`、`FunctionCallOutput`、`CustomToolCallOutput`；只有 user 消息会附带"图片被缩放"提示（`:188-213`）。
- `resize_image(...)`（`:496-543`）：http(s) 远程 URL 直接拒绝；非 data URL 原样放行；`detail=low` 拒绝；`high/auto/None → HIGH_DETAIL`；`original → ORIGINAL_DETAIL`。
- `prepare_image(...)`（`:425-494`）：只处理 inline 图；replay 模式下用历史里记录的 `ImageReplaySource{prepared_url_digest, detail, original_data_url}` 找回原图重新净化（`:267-298`）——**保证"模型当时看到的图"可重现**。
- 上传 `AttachmentStore`：成功返回 `Inline{bytes}` 或 `File{file_id}`，失败回退 `data:` URL（`:449-467`）。

**取舍**：P1（若我们支持图片输入）。要抄三点：① 预处理失败降级为文本占位；② 记录原图 + 摘要以支持重放；③ 上传失败回退内联而不是丢图。不抄 `unified_budget`（那是为 Responses Lite 的计费口径服务）。

### 8.3 `core/src/turn_metadata.rs`（626 行）

**作用**：一个 turn 的"身份 + 归属 + 环境"元数据容器，既用于发给模型的请求头/元数据，也用于分析埋点。

**关键字段**（`TurnMetadataState`，`:159-187`）：

- `cwd`、`session_id`、`thread_id`、`agent_name`
- `forked_from_thread_id`、`parent_thread_id`
- `parent_turn_id: OnceLock<String>`、`root_turn_id: OnceLock<String>`、`initiating_agent_path: OnceLock<AgentPath>`、`turn_trigger: OnceLock<String>`
- `subagent_header`、`subagent_kind`、`thread_source`
- `turn_id`、`sandbox_tags`
- `auto_review_enabled`、`node_repl_auto_review_required`、`node_repl_disabled`
- `enriched_workspaces`、`turn_started_at_unix_ms`
- `responses_api_metadata` / `responsesapi_client_metadata`
- `user_input_requested_during_turn: AtomicBool`
- `enrichment_task: Mutex<Option<AbortOnDropHandle<()>>>`、`git_enrichment_complete: watch::Sender<bool>`

**三个设计点**：

1. **血缘只能写一次**：`parent_turn_id` / `root_turn_id` / `turn_trigger` 都是 `OnceLock`，`set_*` 用 `let _ = ...set()` 忽略重复写入（`:361-396`）。防止后续代码覆盖归属。
2. **元数据模板分层**：`mcp_metadata_template()`（给外部 MCP，刻意不含配置元数据）与 `responses_metadata_template()`（给模型请求，含配置元数据）（`:450-514`）。工具请求里还会 `tool_namespaces_info = None`，并移除 `agent_name`/`parent_turn_id`/`root_turn_id`（`:305-328`）——**不同消费方看到不同元数据**。
3. **git 信息异步补充**：`spawn_git_enrichment_task`（`:538-569`）跑 `git_workspaces`（head sha、remote urls、has_changes），完成时 `send_replace(true)`；`wait_for_git_enrichment` 阻塞等；`cancel_git_enrichment_task` 中止并把信号置真（`:571-585`）。记忆场景用 1 秒超时兜底（`:45`、`:588-595`）。

**取舍**：P1（低成本高收益）。我们必须抄 `OnceLock` 式血缘 + `root_turn_id` 贯穿；`git enrichment` 可简化为一次同步 `git rev-parse`，不必这么重。

---

## 9 Codex 全功能清单（本附录证据范围内）

成熟度口径：
- **高**：有独立类型、失败路径、指标、测试。
- **中**：功能完整但边界靠约定/配置。
- **低**：实验性、feature gate、或明显 WIP。

| 功能 | 源码证据 | 成熟度 | 我们是否采用 |
|---|---|---|---|
| 任务种类分离（Regular/Review/Compact） | `core/src/state/turn.rs:75-80`、`core/src/tasks/*.rs` | 高 | **P0** |
| 完成判定 → 是同 turn 续跑还是结束 | `core/src/tasks/mod.rs:721-753` | 高 | **P0** |
| steer（同 turn 追加输入续采样） | `core/src/tasks/regular.rs:151-174` | 高 | **P0** |
| 100ms 优雅中断 + 硬 abort | `core/src/tasks/mod.rs:79`、`:1084-1098` | 高 | P1 |
| 中断标记写入历史 | `core/src/tasks/mod.rs:1120-1139` | 高 | P1 |
| 压缩作为独立 turn（3 条路径） | `core/src/tasks/compact.rs:44-96` | 高 | **P0** |
| 压缩失败不误报（UsageLimit 只通知扩展） | `core/src/tasks/compact.rs:97-108` | 高 | P1 |
| Review 作为子会话 + 受限工具 | `core/src/tasks/review.rs:98-142` | 高 | **P0** |
| Review 结构化输出 + 兜底解析 | `core/src/tasks/review.rs:192-207` | 高 | **P0** |
| Review 结论回写主历史（2 条） | `core/src/tasks/review.rs:211-285` | 高 | **P0** |
| Review 关闭联网/多代理/goal | `core/src/session/review.rs:30-35`、`tasks/review.rs:114-115` | 高 | P1 |
| 内部委派（approval=never、不可再派生） | `core/src/codex_delegate.rs:67-76`、`:170` | 高 | P1 |
| 委派 IO 桥 + 4 类噪声过滤 + 500ms 抽干 | `core/src/codex_delegate.rs:342-398` | 高 | P1 |
| 审批要求四态（含 PromptUser） | `execpolicy/src/decision.rs:7-19` | 高 | **P0** |
| 多规则最严格者胜 | `execpolicy/src/policy.rs:585-591` | 高 | **P0** |
| allow 才 bypass sandbox，且需每段 allow | `core/src/exec_policy.rs:495-508` | 高 | **P0** |
| 批准后规则写回文件 | `execpolicy/src/amend.rs:65-150` | 高 | P1 |
| 规则示例自校验 match/not_match | `execpolicy/src/parser.rs:145-147` | 高 | P2 |
| 网络规则（host+protocol+decision） | `execpolicy/src/rule.rs`、`policy.rs:296-315` | 高 | P1 |
| 受管 worktree 创建（detach + no-checkout + reset） | `worktree/src/lib.rs:62-166` | 高 | P2 |
| worktree 归属绑定（原子不覆盖） | `worktree/src/metadata.rs:49-85` | 高 | P2 |
| worktree 防御性列举（反查 gitdir 指针） | `worktree/src/lib.rs:214-256` | 高 | P2 |
| git 命令加固（清环境 + 禁 hooks/filter/fsmonitor） | `worktree/src/git.rs:142-216` | 高 | P1（可独立用） |
| worktree 自动清理 + 保留 N 个 | `worktree/src/settings.rs:16`、`:62-84` | 中 | 不采用 |
| 14 类 hook 事件 | `hooks/src/lib.rs:29-44` | 高 | 采用其中 6 类 |
| hook matcher（9 类事件） | `hooks/src/lib.rs:51-61`、`engine/dispatcher.rs:41-78` | 高 | P0（工具类） |
| sync/async 双执行器 | `hooks/src/engine/mod.rs:194-209` | 高 | P1 |
| exit 2 = 阻断语义 | `hooks/src/events/pre_tool_use.rs:268-299` | 高 | **P0** |
| 阻断时跳过清理 hook | `hooks/src/engine/dispatcher.rs:176-200` | 高 | P1 |
| hook 注入上下文 / 改写输入 | `hooks/src/events/pre_tool_use.rs:42-49`、`:153-171` | 高 | P1 |
| hook 信任哈希 + 托管必需 hook | `hooks/src/engine/discovery.rs:981-1023` | 高 | P1 |
| hook 输出 spill（超大输出落盘） | `hooks/src/engine/mod.rs:493-558`、`output_spill.rs` | 高 | P2 |
| 扩展贡献者框架（12+ trait） | `ext/extension-api/src/contributors.rs` | 高 | 只借 3 个钩子 |
| 持久目标 + 预算 + 空闲续跑 | `ext/goal/src/{spec,runtime,accounting}.rs` | 中 | **P1** |
| 目标预算耗尽优雅停止 + steering | `ext/goal/src/steering.rs`、`accounting.rs:79` | 中 | P1 |
| 本地文件式记忆 + 4 工具 | `ext/memories/src/{lib,extension,tools/*}.rs` | 高 | **P1** |
| 记忆检索多 query / 窗口 / 游标 | `ext/memories/src/tools/search.rs:28-42` | 高 | **P1** |
| 技能目录 + 按需读取 3 工具 | `ext/skills/src/tools/*.rs`、`extension.rs:198-297` | 高 | **P1** |
| 技能动态选择（8 种策略 + 影子实验） | `ext/skills/src/dynamic_skill_selector/*`、`shadow_selection_experiment/mod.rs` | 低（实验） | 不采用 |
| 联网搜索命令联合体 | `ext/web-search/src/tool.rs`、`codex-api/src/search.rs:32-69` | 高 | **P1**（换后端） |
| 搜索时效/域名过滤 | `codex-api/src/search.rs:71-84` | 高 | **P1** |
| 搜索模式（Disabled/Cached/Indexed/Live） | `ext/web-search/src/extension.rs:87-93` | 高 | **P1** |
| 生图工具 + 产物落盘 | `ext/image-generation/src/tool.rs:68-73`、`:362` | 高 | P2 |
| 扩展 UI 条目命名空间化 | `ext/items/src/lib.rs` | 高 | P2 |
| 图片预处理 + 失败占位 + 重放 | `core/src/image_preparation.rs:39-45`、`:267-298` | 高 | P1（若支持图片） |
| shell 快照（Windows 不支持） | `core/src/shell_snapshot.rs:551-553` | 中（仅 Unix） | 不采用（机制可借） |
| turn 血缘 OnceLock + 元数据分层 | `core/src/turn_metadata.rs:159-187`、`:450-514` | 高 | **P1** |
| git 信息异步补充 + 超时 + 可取消 | `core/src/turn_metadata.rs:538-585` | 高 | P1 |
| guardian 自动审查（三层） | `ext/guardian-reviewer/*`、`guardian-v2/*`、`guardian-v3/*` | 高 | 不采用（借纪律） |
| 审查路由/熔断/审批缓存重校验 | `ext/guardian-reviewer/src/{router,circuit_breaker,review}.rs` | 高 | P1（只借纪律） |
| 多代理花名册/通信 | `core/src/agent/control/spawn.rs`、`ext/agent-message-board` | 高 | 不采用 |
| 持久消息队列 + 空闲派发 | `ext/queue/src/service.rs` | 高 | P1（借概念） |
| 跨环境文件搬运 | `ext/multi-env-copy-file/src/tool.rs` | 高 | 不采用 |
| Apps/插件 MCP 接入 | `ext/mcp/src/lib.rs`、`ext/connectors/src/plugin_app.rs` | 高 | 不采用 |
| 提交署名策略 | `ext/git-attribution/src/lib.rs` | 高 | 不采用 |
| 历史/笔记工具 | `ext/history-notes/src/extension.rs` | 中 | P2 |

---

## 10 覆盖边界（必须原样保留）

### 10.1 本附录实际逐行读过的文件

`core/src/tasks/{mod,regular,compact,review,user_shell,lifecycle,admission}.rs`；`core/src/state/turn.rs`；`core/src/session/review.rs`；`core/src/codex_delegate.rs`；`core/src/exec_policy.rs`（仅 `:400-520`、`:1120-1200` 两段）；`execpolicy/src/{decision,lib,policy,parser,rule,amend}.rs`；`worktree/src/{lib,git,paths,metadata,settings}.rs`；`hooks/src/{types,lib}.rs`；`hooks/src/engine/{mod,dispatcher,discovery}.rs`（discovery 只读前 130 行 + 函数索引）；`hooks/src/events/pre_tool_use.rs`、`hooks/src/engine/output_parser.rs`（前 130 行）、`hooks/src/events/{stop,session_start}.rs`（结构体与注释）；`core/src/{shell_snapshot,image_preparation,turn_metadata}.rs`；`core/src/session/multi_agents.rs`；`config/src/requirements_exec_policy.rs`（前 90 行）；`codex-api/src/search.rs`（`SearchCommands` 定义）。

`ext/` 18 个 crate：每个都读了 `src/lib.rs` 全文；重点 crate 另外读了核心文件：`goal/{spec,extension,runtime,accounting}.rs`（部分）、`memories/{extension,tools/mod,tools/search,local/search,schema}.rs`（部分）、`skills/extension.rs`（部分）、`web-search/{tool,extension,schema}.rs`（部分）、`image-generation/tool.rs`（部分）、`guardian-reviewer/{lib,review,assessment}.rs`（部分）、`guardian-v2/{lib,async_scorer/mod,sync_reviewer/mod,score,classification,decisions}.rs`（结构）、`guardian-v3/{lib,evidence,housekeeper,selection,delivery}.rs`（头 40 行）、`history-notes/extension.rs`（部分）、`queue/service.rs`（前 70 行）、`agent-message-board/extension.rs`（前 60 行）、`connectors/plugin_app.rs`（全文）、`multi-env-copy-file/tool.rs`（前 60 行）、`extension-api/{lib,contributors}.rs`（trait 索引）、`items/lib.rs`（全文）、`mcp/lib.rs`（全文）、`agent/lib.rs`（全文）。

### 10.2 只做目录级登记 / 未逐行读

- `core/src/tasks/mod_tests.rs`（806 行）、`user_shell_tests.rs`（62 行）：只统计了测试名与数量（9 个 `#[test]/#[tokio::test]`），未逐行读断言。
- `worktree/tests/worktree.rs`（898 行）、`worktree/src/git_tests.rs`（177 行）、`settings.rs` 测试：只登记，未逐行。
- `hooks/src/engine/discovery.rs`（1963 行）：读前 130 行 + 函数索引 + 关键函数签名，未逐行读全部 sources 合并逻辑。
- `hooks/src/engine/command_runner.rs`（486 行）、`mcp_runner.rs`（176 行）、`schema.rs`（1178 行）、`output_spill.rs`（119 行）：只读签名/常量，未逐行。
- `hooks/src/events/*` 中除 `pre_tool_use` 外的 13 个事件文件：只读结构体定义与关键注释。
- `ext/guardian-v2` 的 `async_scorer/{sampler,connection_pool,transcript,trusted_tools,trusted_skills}.rs`、`guardian-v3` 的 `sampling.rs`/`retrieval_tools.rs`/`subscription_tools.rs`：只读文件头注释与导出，未逐行。
- `ext/skills` 的 `dynamic_skill_selector/` 18 个文件、`shadow_selection_experiment/`、`loader/*`、`provider/*`：只读策略名与导出，未逐行。
- `ext/goal` 的 `api.rs`、`tool.rs`、`analytics.rs`、`metrics.rs`、`events.rs`：只读签名，未逐行。
- `ext/memories` 的 `backend.rs`、`local/{ad_hoc_note,list,path,read}.rs`、`prompts.rs`、`metrics.rs`：只读签名。
- `codex-rs/cli`、`app-server*`、`tui`、`exec-server*`、`windows-sandbox-*`、`linux-sandbox`、`cloud-*`：本附录完全未展开。

### 10.3 明确不声称的事

1. 不声称读过 `codex-rs` 全仓每个文件（`README.md` 记录的仓内文件数是 10,336，该数字来自 README，本附录未独立复核）；本附录只覆盖上面列出的路径。
2. 不声称 `ext/guardian-v2`（含测试 19,434 行）与 `ext/skills`（含测试 23,093 行）已被完整理解；它们只到"结构 + 入口 + 核心机制"层级。
3. 不把测试文件里的断言当作产品行为；产品行为只引 `src/`。
4. README/注释只作辅助；凡与代码冲突，以代码为准（本附录已按此原则修正过 `Decision` 的 `parse` 与 `serde` 不一致之处）。
