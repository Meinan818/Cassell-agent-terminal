# Claude Code 本地黑盒逆向

目标：不依赖泄露源码，在本机对 Claude Code 做可复核的行为和接口分析。
边界：不复制私有代码/提示词，不绕过授权，不把任何内容外传；真实模型调用
会产生用量，未授权的调用不执行。

## 1. 本机事实

| 项目 | 值 |
|---|---|
| CLI 版本 | `2.1.325` |
| 主程序 | `E:\nodejs\node_modules\@anthropic-ai\claude-code\bin\claude.exe` |
| 主程序大小 | 372,461,728 bytes |
| SDK 类型文件 | `sdk-tools.d.ts` |
| SDK 类型行数 | 4,405 |
| SDK 类型大小 | 179,549 bytes |
| 公开工具输入/输出接口 | 88（44 个工具输入 + 44 个输出） |
| 本机数据目录 | `C:\Users\Lqx24\.claude` |

本机 `.claude` 顶层目录（只列结构，不读对话正文）：

```text
backups/ cache/ daemon/ file-history/ ide/ jobs/ plugins/ projects/
session-env/ sessions/ shell-snapshots/ skills/ telemetry/ tools/
settings.json
history.jsonl
daemon.log
daemon.status.json
```

目录规模（只统计，不读内容）：

| 目录 | 文件数 | 大小 |
|---|---:|---:|
| `projects` | 916 | 555,939,193 bytes |
| `file-history` | 890 | 19,334,092 bytes |
| `plugins` | 629 | 25,222,599 bytes |
| `skills` | 850 | 17,045,786 bytes |
| `shell-snapshots` | 10 | 26,195 bytes |
| `sessions` | 4 | 1,671 bytes |
| `cache` | 3 | 1,235,797 bytes |
| `backups` | 5 | 111,815 bytes |

这说明 Claude Code 在本地保存了大量项目历史、文件版本、插件/技能和 shell
快照；这些目录只能作为“功能存在”的证据，不能拿来读取用户的真实对话内容。

这说明 Claude Code 不只是“一个聊天循环”，至少还有：

- 会话目录；
- 项目目录映射；
- 文件历史；
- shell 快照；
- daemon/后台进程；
- jobs；
- plugins/skills；
- 备份和 telemetry。

`settings.json` 只有少量键（env、language、skipWebFetchPreflight、
skipWorkflowUsageWarning）；不读取或输出 env 值。

## 2. 公开工具面

`sdk-tools.d.ts` 的输入接口包括（共 44 个工具；逐项字段见
[claude-tools.md](./claude-tools.md)）：

```text
Agent Bash ExitPlanMode FileEdit FileRead FileWrite Glob Grep TaskStop
ListMcpResources RefreshMcpTools Mcp NotebookEdit ReadMcpResourceDir
ReadMcpResource ReportFindings TodoWrite WebFetch WebSearch AskUserQuestion
SendFeedback ClaudeDesign Projects EnterPlanMode TaskCreate TaskGet
TaskUpdate TaskList Workflow CronCreate CronDelete CronList ScheduleWakeup
RemoteTrigger ShowOnboardingRolePicker OfferChromeSetup ReadNotifications
Monitor ProposeSkills ProposeGoal Artifact PushNotification
EnterWorktree ExitWorktree
```

可直接学到的设计：

- `FileRead` 有 offset/limit/allow_large，不是一次吞完整文件。
- `FileEdit` 用 old_string/new_string，不是整文件覆盖。
- `Bash` 有 timeout、run_in_background、dangerouslyDisableSandbox。
- `Agent` 有 subagent_type、model、effort、run_in_background、isolation。
- `TaskCreate/Get/Update/List` 是独立任务状态工具。
- `AskUserQuestion`、`ExitPlanMode`、`EnterPlanMode` 是显式交互工具。
- `WebSearch`、`WebFetch`、`Monitor`、`Artifact`、`EnterWorktree` 各自独立。
- `CronCreate/List/Delete`、`ScheduleWakeup` 说明定时能力是引擎级，不是聊天脚本。

## 3. CLI 公开能力

`claude --help` 可确认：

- `--permission-mode`：`acceptEdits`、`auto`、`bypassPermissions`、`manual`、
  `dontAsk`、`plan`；
- `--allowedTools` / `--disallowedTools`；
- `--max-budget-usd`；
- `--autocompact`；
- `--append-system-prompt` / `--system-prompt` / `--system-prompt-snapshot`；
- `--resume`、`--fork-session`、`--session-id`；
- `--worktree`；
- `--agents`、`--bg`、`--background`；
- `--input-format stream-json`、`--output-format stream-json`；
- `--mcp-config`、`--plugin-dir`、`--plugin-url`；
- `--restricted`；
- `--fallback-model`。

这些都可以在我们自己的 CLI/引擎里做等价机制，但不复制其内部实现。

## 4. 社区二手结论（明确标注）

公开社区分析中最值得注意的说法：

- 工具定义是统一 schema，输入有校验。
- StreamingToolExecutor 可在响应流中提前执行工具。
- 只读工具可并行，写工具需要独占。
- 大工具结果会落盘，上下文只保留引用/摘要。
- 权限是规则快速路径 + 审批层，不只靠模型判断。

注意：这些是社区分析，不是我们亲手读到的 Claude 源码；不能当官方事实。

## 5. 黑盒实验矩阵

以下实验使用隔离临时目录，不使用用户项目、不读取真实 Key、不接触生产数据。

| 实验 | 命令/方式 | 观察点 | 状态 |
|---|---|---|---|
| 基础事件流 | `claude -p --output-format stream-json "..."` | event 类型、token/usage、结束原因 | 待授权真实调用 |
| 权限模式 | `--permission-mode plan/manual/acceptEdits` | 是否停、弹什么、工具是否执行 | 待授权 |
| 工具调用 | 让它读一个测试文件、改一个测试文件 | tool schema、结果结构、错误结构 | 待授权 |
| 会话恢复 | `--resume` / `--continue` | transcript 位置、恢复内容 | 待授权 |
| 分支会话 | `--fork-session` | 新 session id、原会话是否变 | 待授权 |
| worktree | `--worktree` | 工作区创建/清理、分支 | 待授权 |
| autocompact | `--autocompact` | 压缩触发、摘要行为 | 待授权 |
| 预算 | `--max-budget-usd` | 到上限时如何停 | 待授权 |

真实调用会消耗 Claude 用量；未得到明确预算前不执行。

## 6. 结论

Claude Code 的公开接口已经足够支撑我们做功能对标：

- 工具要结构化、可验证；
- 文件读取要分页；
- 编辑要精确替换；
- 权限要分模式、分工具；
- 会话要能恢复/分支；
- 上下文要能自动压缩；
- 任务、计划、worktree、cron、artifact 都应是独立工具/状态。

但闭源内部实现、真实提示词和行为细节，只能通过黑盒实验逐步补，不能写成
“源码级已验证”。

## 7. 内嵌字符串证据（2026-11-14 补）

### 7.1 方法与边界

Claude Code 的 `bin/claude.exe` 是 372,461,728 字节的 Bun 单文件程序。用
只读方式扫描其可打印字符串，可以读到未压缩的 JS 标识符、枚举、错误消息和
功能开关名。这一步**只分析程序自身**：

- 不读取 `projects/` 下的用户对话；
- 不读取 `settings.json` 的 env 值；
- 不调用模型、不消耗额度；
- 报告只记录结构、枚举和机制名，不复制代码或提示词原文。

证据等级：**[二进制字符串]**，比社区传闻硬，但仍不是“读到 TypeScript 源码”。

### 7.2 功能面规模

| 指标 | 数量 | 说明 |
|---|---:|---|
| `CLAUDE_CODE_*` 环境变量 | 920 | 功能开关、宿主信息、实验开关 |
| `CLAUDE_CODE_DISABLE_*` | 103 | 可关闭的功能面 |
| `tengu_*` 遥测事件名 | 3,750 | 含大量 A/B 实验名，不等于 3,750 个功能 |
| Hook 事件类型 | 18 | 见 7.3 |
| 权限模式 | 6 | 见 7.4 |

这说明 Claude Code 的真实复杂度不在“一个聊天循环”，而在**大量功能面 +
统一开关治理**。920 个环境变量里很多是内部实验/宿主适配，不能照搬；但它
暴露了功能版图：artifact、auto mode、memory、subagent、plugin/skill、
MCP serve、web、compact、worktree、plan v2、background/cron。

### 7.3 Hook 事件全集

从字符串中可确认的 hook 事件：

```text
PreToolUse            PostToolUse           PostToolUseFailure
UserPromptSubmit      SessionStart          SessionEnd
Stop                  SubagentStop          PreCompact
PostCompact           Notification          PermissionRequest
Setup                 TeammateIdle          TaskCompleted
ConfigChange          WorktreeCreate        WorktreeRemove
```

其中 `PreToolUse` / `PermissionRequest` 的 hook 加载失败会导致**同一文档里
相邻的权限声明一起不生效**（字符串原文明确说：不能加载的 guard hook 可能
正是保护旁边权限声明的，修好或删除前整块不应用）。这是一个重要的安全设计：
**hook 加载失败必须 fail-closed，而不是跳过。**

### 7.4 权限模式

枚举值：

```text
default  acceptEdits  plan  auto  bypassPermissions  dontAsk
```

比公开 `--help` 多出 `auto` 与 `dontAsk` 的准确定位：

- `auto` 不是“无脑放行”，字符串里存在 `AUTO_MODE_CLASSIFIER_*`、
  `AUTO_MODE_OUTCOME_CODES`、`AUTO_MODE_TIER` 等一整套分类器开关；
- `dontAsk` 是独立模式，不是 `bypassPermissions` 的别名。

### 7.5 工具调用结果状态机（最值得学）

Claude Code 的远程/本地工具宿主把一次调用归入 12 种结果，而不是简单的
成功/失败：

```text
ran                    approved_by_session
denied_by_rule         denied_by_user
asked_in_session       denied_by_session
ask_expired            ask_refused_no_surface
hook_blocked           validation_failed
duplicate_call         unrecognized
```

每态还带三个维度：`kind`（completed/route/error）、`bucket`
（ok/sad/bad/none）、`sessionDenial`（是否属于会话级拒绝）、`phase`
（call/route）。这解释了一个成熟引擎为什么要区分：

- 规则拒绝（`denied_by_rule`）和用户拒绝（`denied_by_user`）不是一回事；
- hook 拦截（`hook_blocked`）要单独记账；
- 审批过期（`ask_expired`）要能触发重新询问，而不是当成失败；
- 会话内已批准（`approved_by_session`）要能复用，避免重复弹窗。

审批队列本身也有一组可对账的默认值（字符串常量）：

| 参数 | 默认/范围 | 作用 |
|---|---|---|
| `progress_interval_ms` | 20,000（1s–120s） | 等待审批期间的心跳间隔 |
| `progress_misses` | 2（1–10） | 连续丢心跳几次判定宿主失联 |
| `max_ask_ms` | 120,000 | 单次审批最长等待 |
| `reconcile_ms` | 30,000（5s–120s） | 对账周期 |
| `caller_sessions_max` | 256 | 并发调用方会话上限 |
| `pending_asks_max` | 64 | 待审批队列上限 |
| `queue_depth` | 0–256 | 排队深度 |

这套“心跳 + 失联判定 + 超时 + 对账”的结构，比只做一个 `approve/deny`
弹窗完整得多，直接可用于我们的审批流水线。

### 7.6 上下文压缩

字符串里可确认的压缩相关开关：

```text
CLAUDE_CODE_AUTO_COMPACT_WINDOW
CLAUDE_CODE_COLD_COMPACT
CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS
CLAUDE_CODE_SLEEP_COMPACT
CLAUDE_CODE_SLEEP_COMPACT_AFTER_MS
CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP
```

还有一条明确的 thrash 检测文案：

> Autocompact is thrashing: the context refilled to the limit within 3 turns
> of the previous compact, 3 times in a row.

这说明它不只看“超没超限”，还检测**压缩后迅速回涨**的病态循环。我们的
`compact` 目前只看阈值，缺这一层。

### 7.7 子代理与团队

可确认的开关/上限：

```text
MAX_CONCURRENT_SUBAGENTS        MAX_SUBAGENTS_PER_SESSION
MAX_SUBAGENT_SPAWN_DEPTH       SUBAGENT_MODEL / SUBAGENT_EFFORT
SUBAGENT_HISTORY               SUBAGENT_PROMPT_CACHE_TTL
EXPERIMENTAL_AGENT_TEAMS       EXPERIMENTAL_OBSERVER_AGENTS
WORKFLOW_MAX_CONCURRENT_AGENTS WORKFLOW_SIZE_WARNING_AGENTS
```

结论：子代理在 Claude Code 里是**有并发上限、嵌套深度、独立模型/effort、
历史与缓存策略**的一等能力，不是“随便 spawn 一个”。

### 7.8 Web 搜索与联网

```text
WEB_SEARCH_REFILLS_PER_HOUR      MAX_WEB_SEARCHES_PER_SESSION
WEBSEARCH_CITATIONS              WEB_SEARCH_FAST_ARG
WEBFETCH_CACHE_TTL_MS            WEBFETCH_DEADLINE_MS
WEBFETCH_USE_CCR_PROXY           WEB_SEARCH_USE_CCR_PROXY
DISABLE_WEB_FETCH
```

说明联网搜索不是“调一个 API”，而是有**每小时配额、会话总量上限、引用、
缓存 TTL、截止时间、代理路由**的受管能力。天枢的 `tools/browser` 与
Claude 的 WebSearch/WebFetch 可以对照学，但不要把“能搜索”当成“有搜索
产品能力”。

### 7.9 Artifact 体系

`CLAUDE_CODE_ARTIFACT_*` 有 40 多个开关，覆盖：发布、预览、分享、评论、
版本、类型目录、MCP 接入、自动打开、数据库、资源基址。这说明 Artifact
不是“生成一个 HTML 文件”，而是**带版本、评论、分享和预览宿主的产品级
发布系统**。

对我们的意义：星域项目如果要做“可视化产物”，可以学它的**版本 + 预览 +
评论**边界，但不要学它的云端发布链路和几十个内部开关。

### 7.10 Auto Mode

`AUTO_MODE_*` 有 27 个开关，包括分类器重叠、编辑移除、Git 状态、仓库可见性、
远程浏览器、线程规则、温度、层级。可以判断：Claude Code 的自动模式是
**“分类器 + 规则 + 上下文分级”**，不是简单的 `--yes`。

### 7.11 记忆

```text
POST_TURN_MEMORY            POST_TURN_MEMORY_CONFIG
MEMORY_API_BASE_URL         MEMORY_API_TOKEN
DISABLE_AUTO_MEMORY         DISABLE_ORG_MEMORY
```

记忆在 Claude Code 里是**每轮后写入 + 可关闭 + 分组织/个人**的独立服务，
不是塞进系统提示的一段文本。

### 7.12 对 NORMA / EVA 的取舍

| 机制 | 采用 | 理由 |
|---|---|---|
| 12 态工具结果 | **P0 采用** | 我们目前只有成功/失败，无法区分规则拒绝、用户拒绝、hook 拦截、超时 |
| 审批心跳 + 对账 + 超时 | **P0 采用** | 解决“弹窗一直挂着”“宿主失联不知道” |
| 6 种权限模式 | P1 采用精简版 | 先做 default/plan/acceptEdits/dontAsk 四档，auto/bypass 不做 |
| 压缩 thrash 检测 | **P0 采用** | 防止压缩后立刻回涨的死循环 |
| 子代理并发/深度上限 | P1 采用 | 我们现在是无限 spawn，必须加闸 |
| Web 配额/缓存/TTL | P1 采用 | 联网搜索必须有预算，否则会话失控 |
| Artifact 云端发布 | 不采用 | 产品形态不同，且需要云服务 |
| Auto Mode 分类器 | 不采用 | 成本高、误判风险大，我们用显式审批 |
| 920 个环境变量式治理 | 不采用 | 内部实验开关，不适合我们的规模 |

### 7.13 证据缺口

- 以上来自二进制字符串，**不能证明运行时一定走这条分支**；
- 工具 schema 的完整字段仍以 `sdk-tools.d.ts` 为准；
- 未执行真实 API 黑盒实验（需要预算）；
- 不声称读过 Claude Code 源码。
