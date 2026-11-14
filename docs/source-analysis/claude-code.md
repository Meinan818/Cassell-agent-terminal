# Claude Code 产品与机制分析（闭源）

本机版本：`2.1.325`。

边界先说清：

- Claude Code **闭源**，不能声称读过它的 TypeScript 源码；
- 本报告的证据分三级：**[官方文档]**、**[本机二进制字符串]**、**[社区二手]**；
- 不复制任何私有提示词、代码或用户对话；
- 真实 API 黑盒实验未执行（需要预算）。

配套文件：

- [claude-code-reverse.md](./claude-code-reverse.md)：本机黑盒逆向方法与二进制证据；
- [claude-tools.md](./claude-tools.md)：44 个工具的输入字段与取舍。

## 1. 一句话结论

Claude Code 的成熟度不在“模型会写代码”，而在四层产品化：

1. **工具面完整且结构化**（44 个工具、88 个 I/O 接口）；
2. **权限与会话是运行时能力**（6 种权限模式、resume/branch/background/worktree）；
3. **上下文是可运营的资源**（CLAUDE.md/rules/auto memory、skills、autocompact、thrash 检测）；
4. **扩展面有明确产品边界**（skills、plugins、MCP、hooks、subagents、workflows、artifacts）。

对应到我们：**NORMA = Cowork，EVA = Code**。两者应共享记忆与会话，
但工具面和交互节奏不同；不要把 Claude Code 的所有功能都塞进一个模式。

## 2. 产品形态：Code 与 Cowork 是两种工作面

[官方文档] Claude 的产品线里，Claude Code 是终端/IDE 里的工程代理；
Cowork 是更通用的工作代理。Skills 文档明确写到技能可在 **Cowork 和 cloud
sessions** 中使用，说明两者共享技能与会话基础设施，但入口和默认工具面不同。

对我们的映射：

| Claude | 我们 | 共享 | 不共享 |
|---|---|---|---|
| Claude Code | EVA | 记忆、会话存储、模型配置、审批基础设施 | 终端/文件编辑优先的工具面 |
| Cowork | NORMA | 记忆、会话存储、模型配置 | 以文档/研究/多步任务为主的工具面 |

一个任务绑定一个模式；EVA 的 Ultracode/工作流是工程侧增强，不是第三模式。

## 3. 入口与运行形态

[官方文档 + CLI] 可确认的入口：

- `claude` 交互式终端；
- `claude -p` / `--output-format stream-json` 非交互；
- IDE 集成（VS Code/JetBrains）；
- 桌面端与 Web/cloud sessions；
- `--bg` / `--background` 后台会话；
- `--worktree` 把会话隔离到 git worktree；
- SDK（TypeScript/Python）与 Agent SDK。

这说明它不是“一个 CLI”，而是**同一运行时 + 多种外壳**。我们的 Tauri
桌面端也应该把引擎放在独立层，不让 UI 直接持有对话状态。

## 4. 核心循环与会话

### 4.1 session → turn → tool loop

[社区二手 + 二进制字符串] 一次会话包含多个 turn；每个 turn 内模型可以多次
调用工具，工具结果回注后继续采样，直到模型停止或触发上限。流式工具执行
允许在响应流未结束时提前启动只读工具；写工具需要独占。

[官方文档] Sessions 页面确认：

- `--resume` 恢复会话；
- `--fork-session` 从某条消息分叉；
- 后台会话可恢复；
- 会话选择器有项目范围；
- 会话可命名、导出、定位；
- 恢复会还原对话上下文，但不会自动恢复所有外部副作用。

### 4.2 会话存储

[本机结构] `~/.claude/projects/` 存项目会话，`file-history/` 存文件版本，
`shell-snapshots/` 存 shell 快照，`sessions/` 存会话索引。具体文件格式未逐字
解析，不能冒充已知协议。

### 4.3 可学 / 不学

| 机制 | 取舍 |
|---|---|
| resume + fork + 会话命名 | **P0 学**：我们的会话必须可恢复、可分叉 |
| 后台会话 | P1：先做单会话，后台作为下一层 |
| worktree 隔离 | P1：与我们的项目边界配合 |
| 会话导出 | P2：调试/评测有用 |
| 云端会话同步 | 不学：我们本地优先 |

## 5. 工具面

[官方类型] `sdk-tools.d.ts` 实际是 **44 个工具输入 + 44 个输出 = 88 个接口**，
不是“81 个工具”。完整字段见 [claude-tools.md](./claude-tools.md)。

按功能域分：

| 域 | 工具 |
|---|---|
| 文件/搜索 | FileRead、FileEdit、FileWrite、Glob、Grep、NotebookEdit |
| 执行 | Bash |
| 子代理/任务 | Agent、TaskStop、TaskCreate/Get/Update/List、Workflow |
| 计划/交互 | EnterPlanMode、ExitPlanMode、AskUserQuestion、TodoWrite |
| 网络 | WebFetch、WebSearch |
| MCP | ListMcpResources、RefreshMcpTools、Mcp、ReadMcpResourceDir、ReadMcpResource |
| 工作区/产出 | EnterWorktree、ExitWorktree、Projects、Artifact |
| 自动化 | CronCreate/Delete/List、ScheduleWakeup、RemoteTrigger、Monitor |
| 审查/反馈 | ReportFindings、SendFeedback、ProposeSkills、ProposeGoal |

最值得学的不是工具数量，而是三条约束：

1. 每个工具有明确输入 schema，模型不能自由发挥字段；
2. 高风险动作有显式危险参数（`dangerouslyDisableSandbox`、`discard_changes`、
   `force`、`allow_large`）；
3. 工具结果不是字符串，而是带状态、错误类型、副作用信息的结构。

## 6. 权限

[本机二进制 + CLI] 权限模式枚举：

```text
default  acceptEdits  plan  auto  bypassPermissions  dontAsk
```

[本机二进制] 工具调用结果有 12 种状态：

```text
ran                    approved_by_session
denied_by_rule         denied_by_user
asked_in_session       denied_by_session
ask_expired            ask_refused_no_surface
hook_blocked           validation_failed
duplicate_call         unrecognized
```

这说明权限不是“弹窗允许/拒绝”，而是：

- 规则快速路径（denied_by_rule）；
- 用户审批（denied_by_user / approved_by_session）；
- hook 阻断（hook_blocked）；
- 参数校验失败（validation_failed）；
- 会话内缓存与过期（asked_in_session / ask_expired）；
- 重复调用去重（duplicate_call）。

审批队列还有心跳、失联判定、超时和对账参数（见 reverse 报告 §7.5）。

对我们的映射：**P0 采用 12 态结果 + 审批心跳/超时/对账**。我们的
`tool_pipeline.rs` 现在只有成功/失败，无法解释“为什么没执行”。

## 7. 上下文与记忆

### 7.1 CLAUDE.md / rules / AGENTS.md

[官方文档] 项目记忆分三层：

- `CLAUDE.md`：项目说明、命令、约定；
- `.claude/rules/`：可拆分的规则文件；
- `AGENTS.md`：跨工具共享的指令文件，Claude Code 有兼容读取逻辑。

加载顺序、目录层级和团队管理都有明确规则；不是把所有文本拼进系统提示。

### 7.2 Auto memory

[官方文档 + 二进制] 自动记忆可开关，存储位置独立，支持组织/个人范围。
它不是“聊天摘要”，而是可检索、可清理的记忆条目。

### 7.3 压缩

[本机二进制] 相关开关：

```text
AUTO_COMPACT_WINDOW
COLD_COMPACT
IDLE_COMPACT_MIN_TOKENS
SLEEP_COMPACT
DISABLE_PRECOMPACT_SKIP
```

并且有明确的 thrash 检测：压缩后 3 个 turn 内又回满、连续 3 次，就判定
“Autocompact is thrashing”。这比只看阈值成熟。

对我们的映射：**P0 学 thrash 检测**；**P1 学 CLAUDE.md/rules 的分层加载**；
auto memory 先只做本地文件版，不接云。

## 8. Skills

[官方文档] Skills 是 `SKILL.md` + 支持文件，按需加载；有 bundled skills 和
用户/项目/插件来源；支持 Cowork 与 cloud sessions；可从 claude.ai 同步；
可配置调用权限和 frontmatter。

官方列出的 bundled skills 覆盖：

- `/doctor` 环境检查；
- 运行并验证应用；
- 提交前跑检查；
- Claude API 项目开发。

对我们的映射：**P0 学“只注入 name/description/location，正文按需 read”**。
这正是 Pi 附录 §4 的同一结论：技能正文不进系统提示，避免上下文膨胀。

## 9. 子代理与工作流

[官方文档] Subagents 是独立上下文、独立工具集的子会话；有模型、effort、
工具白名单、权限模式。Workflows 是更高一层的编排：

- 内置 workflow；
- 让 Claude 写 workflow；
- 运行前批准计划；
- 保存复用；
- 通过 plugin 分发；
- 批量审计/迁移/研究等模板；
- `ultracode` 让 Claude 自行决定是否用 workflow。

[本机二进制] 有并发/深度限制：

```text
MAX_CONCURRENT_SUBAGENTS
MAX_SUBAGENTS_PER_SESSION
MAX_SUBAGENT_SPAWN_DEPTH
SUBAGENT_MODEL / SUBAGENT_EFFORT
SUBAGENT_HISTORY / SUBAGENT_PROMPT_CACHE_TTL
WORKFLOW_MAX_CONCURRENT_AGENTS
```

对我们的映射：子代理必须是**有上限、有独立上下文、有工具白名单**的一等
能力。我们现在的子代理是“随便 spawn”，需要补并发/深度/预算闸门。

## 10. MCP、插件与 marketplace

[官方文档] MCP 支持四种传输：remote HTTP、remote SSE、local stdio、
remote WebSocket；可添加、授权、查看资源。插件是更大的分发单元：

- 插件可带 skills、hooks、commands、agents、MCP servers；
- 有 marketplace、安装 scope、组织管理；
- 插件内容在会话启动时加载，运行中不热插拔。

对我们的映射：MCP 客户端 **P1**；插件市场 **不做**。我们只需要“本地扩展
目录 + 清单 + 显式启用”，不要 DSH 式插件树。

## 11. Artifacts

[官方文档] Artifact 是把会话输出发布成可分享的页面/应用：

- 创建、更新、分享；
- 版本；
- 评论；
- 预览；
- 发布前询问（可配置）。

这不是“写一个 HTML 文件”，而是带版本和协作的产品能力。我们如果做可视化
产物，只学“预览 + 版本 + 显式发布”，不接云端分享链路。

## 12. Hooks

[官方文档 + 二进制] Hook 事件至少 18 种：

```text
PreToolUse PostToolUse PostToolUseFailure UserPromptSubmit
SessionStart SessionEnd Stop SubagentStop PreCompact PostCompact
Notification PermissionRequest Setup TeammateIdle TaskCompleted
ConfigChange WorktreeCreate WorktreeRemove
```

关键语义：

- matcher 可以是工具名、`Edit|Write` 这种管道分隔、或空匹配全部；
- exit 2 + stderr = 阻断并把原因给模型；
- 不能加载的 `PreToolUse`/`PermissionRequest` hook 会让同一文档里的权限
  声明一起不生效（fail-closed）；
- hook 可以注入上下文、改写工具输入。

对我们的映射：**P0 学 PreToolUse/PostToolUse 的阻断语义**；其余事件按需。

## 13. 联网、Computer Use、Code Review

### 13.1 联网

[本机二进制] WebSearch/WebFetch 有：

- 每小时搜索配额；
- 会话搜索总量上限；
- 域名允许/拒绝；
- 引用；
- 缓存 TTL、截止时间、代理路由。

**联网不是“有一个搜索按钮”，而是受管能力。** 我们的星域/搜索功能必须先有
配额、来源、缓存和失败降级，再谈“智能”。

### 13.2 Computer Use

[官方文档] Computer Use 让 Claude 从 CLI 操作图形界面：截图、鼠标、键盘、
窗口。它是高风险工具，必须有应用级授权、审批和可见状态。

我们的取舍：**不作为 1.0 核心**；如果做，先做“只读截图 + 应用白名单”，
写操作逐次审批。

### 13.3 Code Review

[官方文档] Code Review 用多个 agent 读 PR、验证 finding、按严重级别行内
评论，不自动 approve/block。这个“发现 → 验证 → 分级 → 人审”的流程，
比“让模型看一眼 diff”成熟得多。

对我们的映射：审查队列可以学它的 finding schema 和验证步骤（P1）。

## 14. 自动化

[官方文档 + 工具面] Cron、ScheduleWakeup、Monitor、PushNotification 说明
定时/监控是引擎级能力，不是聊天脚本。关键点：

- 任务有 ID、状态、持久化；
- 可列出、删除；
- 可单次唤醒；
- 可监控命令/URL/协议；
- 通知是独立通道。

我们的映射：**P1 做本地 cron + 任务状态**；不接远程触发。

## 15. 对 NORMA / EVA 的采用清单

| 能力 | 优先级 | 落点 | 说明 |
|---|---|---|---|
| 12 态工具结果 | **P0** | `engine/tool_pipeline.rs` | 先补状态枚举和事件序列 |
| 审批心跳/超时/对账 | **P0** | `engine/policy.rs` / 审批 UI | 解决挂起与失联 |
| 压缩 thrash 检测 | **P0** | `engine/context.rs` / 新 compact 模块 | 3 turn / 3 次规则 |
| 技能按需加载 | **P0** | `engine` + skills 目录 | 只注入 name/description/location |
| 会话 resume/fork | **P0** | `engine/journal.rs` + 会话存储 | 先本地 |
| 6 种权限模式精简为 4 种 | P1 | 设置/审批 | default/plan/acceptEdits/dontAsk |
| 子代理并发/深度上限 | P1 | `agent.rs` | 防止无限 spawn |
| Web 配额/缓存/域名 | P1 | 搜索工具 | 先有预算再有功能 |
| MCP 客户端 | P1 | 新模块 | stdio/HTTP 起步 |
| Cron/任务状态 | P1 | 新模块 | 本地持久化 |
| Artifact 预览/版本 | P2 | 产物模块 | 不做云分享 |
| Computer Use | P2/不做 | 独立工具 | 只读起步 |
| 插件市场 | 不做 | — | 只做本地扩展目录 |
| Auto Mode 分类器 | 不做 | — | 成本/误判风险高 |
| 云端会话/远程触发 | 不做 | — | 本地优先 |

## 16. 证据边界

- [官方文档] 的页面会更新；本报告写于 2026-11-14，具体行为以当时页面为准；
- [本机二进制] 只能证明字符串/枚举存在，不能证明运行时一定走该分支；
- 未执行真实 API 调用、未做权限模式黑盒实验；
- 未读 Claude Code 源码，不声称“源码级全量”；
- 不复制其提示词、代码或用户数据。
