# 引擎全面解剖：Codex / Claude Code / 天枢 / DeepSeek Harness

本文是卡塞尔专员终端引擎重排前的对标底稿。目标不是照抄产品，而是把成熟
agent runtime 的共同骨架、各自独有的硬机制、以及不适合我们的部分分开。

## 0. 结论

四类项目共同证明了一件事：成熟 agent 的差距通常不在“会不会调用模型”，而在
下面七个运行时能力：

1. 工具协议是否结构化、可校验、可回放；
2. 权限是否在工具执行前统一判断，而不是散落在 prompt 里；
3. 会话和事件是否可持久化、恢复、审计；
4. 上下文是否有预算、裁剪、压缩和缓存策略；
5. 失败是否有分类、重试、停止和恢复；
6. 计划和目标是否由运行时持有，不依赖模型记忆；
7. 改动是否有检查点、验证证据和可回滚边界。

我们的引擎应该做成“小核心 + 适配器 + 策略”，而不是继续把功能堆进
`agent.rs`。本项目只借鉴机制，不复制闭源代码、品牌文案或界面。

## 1. 本机对标对象

| 项目 | 本机版本/位置 | 可观察到的形态 | 许可证/边界 |
|---|---|---|---|
| Codex CLI | `0.167.0-alpha.3.2`，`E:\nodejs\codex.cmd` | 开源 CLI，`exec`、`app-server`、`resume`、`fork`、`review`、`sandbox`、`mcp`、`plugin` 等命令 | Apache-2.0；适合作为架构和协议参考 |
| Claude Code | `2.1.325`，`E:\nodejs\node_modules\@anthropic-ai\claude-code` | 原生 CLI，提供 `--permission-mode`、`--autocompact`、`--max-budget-usd`、`--resume`、`--fork-session`、`--worktree`、`--agents`、`--bg` 等入口 | 闭源；只参考公开 CLI 和 `sdk-tools.d.ts`，不复制内部代码 |
| 天枢 | `4.0.4`，`E:\Tianshu\rivet-runtime` | 模块化 runtime；可见 `AgentLoop`、`tool-pipeline`、`path-grants`、`project-trust`、`plan-approval`、`goal-tracker`、`checkpoint`、`session-persist`、`prefix-budget`、`provider-health` 等模块 | 闭源分发；只借鉴公开模块边界和已有研究报告 |
| DeepSeek Harness | `0.2.1-rc.2`，`E:\dsh` | 官方 DeepSeek agent 参考实现；重点是可观察到的缓存优先和压缩思路 | 以公开资料和本机安装为准，未把内部代码当成本项目源码 |
| Pi | GitHub `earendil-works/pi` | 最小可扩展 harness；`pi-ai`、`pi-agent-core`、`pi-durable`、`pi-coding-agent`、`pi-tui` 分层 | MIT；本机没有安装，参考 GitHub README |
| Pi | 本机未找到 `pi` 命令或安装目录 | — | 暂不纳入，不凭空猜功能 |

说明：本报告基于本机 CLI 帮助、Claude 公开类型定义、天枢 runtime 的模块清单、
项目内已有研究报告；没有反编译闭源核心，也没有复制大段代码。

## 2. 通用能力对照

| 能力 | Codex | Claude Code | 天枢 | DeepSeek Harness | 我们的判断 |
|---|---|---|---|---|---|
| 基本 agent loop | 有，CLI/桌面/IDE 共用 | 有 | 有，`AgentLoop` | 有 | 必做：独立状态机 |
| 工具调用协议 | JSON 工具调用 + JSONL 事件 | 结构化 tool input/output | 工具流水线 + 统一注册 | 工具调用 + 结果裁剪 | 必做：工具定义/执行分离 |
| 文件编辑 | 读、写、patch/编辑 | Read/Edit/Write，支持精确替换 | 文件工具 + 所有权/检查点 | 文件工具 | 必做：增加 `edit_file`，不要只靠整文件覆盖 |
| 命令执行 | 受 sandbox/approval 控制 | Bash/PowerShell 工具，权限模式控制 | 终端工具 + 命令策略 | 终端工具 | 必做：进程树终止和统一权限 |
| 权限模型 | sandbox × approval；profiles/白名单 | `permission-mode`、allowed/disallowed tools、restricted | path grants、项目信任、审批模式 | permission prompt | 必做：统一 policy，不把权限写进 prompt |
| Plan 模式 | `/plan` | EnterPlanMode/ExitPlanMode | plan approval | 计划/目标相关工作流 | 必做，保留 |
| Goal 模式 | `/goal`，运行时持有 | Task/Goal 工具、后台任务 | goal tracker | goal/workflow | 必做，但先做单任务版本 |
| 会话恢复 | resume/fork/archive | resume/fork/session persistence | session-persist | session 相关 | 必做：先做 transcript + resume |
| 上下文压缩 | `/compact`、上下文状态 | autocompact、摘要 | CacheAdvisor、边界压缩 | 80% 触发 + 工具结果裁剪 | 必做：先裁剪，再摘要 |
| 前缀缓存 | 系统提示/工具定义稳定 | system prompt snapshot | frozen prefix + appendix | cache-first | 必做：已有 frozen，补指标和压缩 |
| 子代理/多代理 | 显式子代理，可并行 | Agent 工具、后台 agent | Coordinator/Worker、Council | 工具体系 | 暂缓：先把单 agent 做稳 |
| Worktree 隔离 | 支持 | `--worktree` | 有并行/工作区管理 | 未见必须 | P2：高风险但非核心 |
| Skills | `$skill-name`、本地目录 | Skills/插件/命令 | bundled skills | 扩展体系 | P2：先做工具协议 |
| MCP/插件 | MCP、plugins、hooks | MCP、plugins、hooks | plugins/MCP | 可扩展 | P2：先统一工具注册 |
| 定时任务 | Automations | Cron/ScheduleWakeup | 有调度相关模块 | 有工作流 | P2：先做后台任务基础 |
| 审查/变更 | 本地 diff/review/commit | 文件历史、review 工具 | delivery gate、review | 有变更流程 | 保留现有审查队列并结构化 |
| 用量/成本 | token/usage/额度 | max-budget-usd/usage | token ledger/cache panel | usage | 必做：缓存命中率和成本 |
| 记忆 | Memories/AGENTS | CLAUDE.md/记忆/技能 | 统一记忆 + pheromone | 记忆/上下文 | P2：先做项目约束，不做花哨记忆 |
| 云端/远程 | Cloud/Remote/app-server | Cloud/remote/Chrome | 桌面/云相关 | 云/本地 | 不抄：本地 BYOK 不需要 |

## 3. 各自独有功能

### 3.1 Codex 独有或领先

- **开源 CLI + 可观察的 app-server/exec 边界**：适合拿来做协议和事件设计的
  参考，不必把 CLI 当成产品依赖。
- **Goal + Plan 双模式**：Plan 回答“怎么做”，Goal 回答“什么算完成”；目标
  由 thread/runtime 持有，不靠模型记住。
- **sandbox × approval 两把独立旋钮**：技术上能碰什么和何时问用户，分开配置。
- **worktree 隔离、resume/fork/archive、queue/steer**：适合后续做多任务和并行。
- **skills/plugins/MCP/hooks/automations**：生态层完整，但依赖较多。

可学：goal/plan、approval 两轴、session fork、worktree、结构化 usage。
暂不学：Cloud、Remote、Codex 账号体系、桌面 UI 细节。

### 3.2 Claude Code 独有或领先

- **权限模式非常细**：`acceptEdits`、`auto`、`bypassPermissions`、`manual`、
  `dontAsk`、`plan`，另有 allowed/disallowed tools、`--restricted`。
- **会话控制完整**：`--resume`、`--fork-session`、`--session-id`、
  `--system-prompt-snapshot`。
- **预算和上下文控制**：`--max-budget-usd`、`--autocompact`、
  `--exclude-dynamic-system-prompt-sections`。
- **工具 schema 非常明确**：Read 支持 offset/limit/allow_large，Edit 使用
  old_string/new_string，工具输出带分页、截断、图片和 artifact 元数据。
- **后台/子代理**：Agent 工具、background agent、TaskCreate/Get/Update/List、
  Monitor、Cron、ScheduleWakeup。

可学：权限枚举、预算上限、结构化工具结果、edit_file、后台任务、上下文控制。
暂不学：Chrome/Cloud/远程控制、完整插件市场、闭源内部实现。

### 3.3 天枢独有或领先

- **缓存优先是架构级承诺**：冻结前缀、appendixDelta、压缩只在用户回合边界。
- **CVM 认知运行时**：目标契约、证据、权限、终止条件由运行时持有；用少量
  deterministic hooks 纠偏，而不是只靠提示词。
- **路径授权和项目信任**：path-grants、project-trust，把“能读什么、能写什么”
  从 UI 提示变成运行时门禁。
- **交付门和证据链**：delivery gate、verification debt、checkpoint、
  ownership guard。
- **DeepSeek 工程细节**：模型别名、reasoning_effort、reasoning_content 回传、
  DSML 恢复、前缀命中率、CacheAdvisor。
- **观测和回归**：缓存面板、token 账本、`/debug cache`、回归测试。

可学：缓存/前缀策略、path grants、项目信任、目标契约、交付门、checkpoint、
usage 账本、DeepSeek wire adapter。
暂不学：75 个 hook 全量照搬、CVM 全量理论包装、信息素记忆、复杂多智能体议会。

### 3.4 DeepSeek Harness 独有或领先

- **压缩工程最直接**：上下文约 80% 触发；先裁剪工具结果（头 4096 + 尾 1024），
  再决定是否调用摘要；保留约 16% 最新原文；摘要替换旧区段。
- **缓存优先的工具结果策略**：大输出不直接塞回模型。
- **可替换的 compaction 能力**：压缩不是写死在一个 loop 里，而是可替换模块。

可学：工具结果裁剪、80% 阈值、压缩替换而非叠加、原始日志保留。
暂不学：完整插件/Cordis 体系、官方 UI 细节。

### 3.5 Pi 独有或领先

- 最小核心，`pi-ai`、`pi-agent-core`、`pi-durable`、`pi-coding-agent`、
  `pi-tui` 分层清楚。
- `print`、JSON、RPC、SDK 多种入口，说明引擎和 UI 分离。
- 明确不自带权限系统，需要容器或外部沙箱；这一点不能照搬。

可学：包边界、agent core 与 TUI 分离、durable runtime。
不学：默认无权限边界、让用户自己组装基础能力。

## 4. 应该抄的机制与不该抄的机制

### 4.1 优先抄（P0）

| 机制 | 来源 | 为什么 | 落地位置 |
|---|---|---|---|
| 运行事件日志 | Codex/Claude/天枢 | 没有日志就无法恢复、审计、定位“为什么停了” | `engine/journal.rs`（已有） |
| 瞬时错误重试 | Codex/dsh | 429/5xx 不应该直接打断任务 | `engine/retry.rs`（已有） |
| 工具结果头尾裁剪 | dsh | 防止一条命令吃掉上下文 | `engine/context.rs`（已有） |
| DeepSeek 请求适配 | 天枢/DeepSeek 报告 | reasoning_effort/模型差异不能散落 | `engine/deepseek.rs`（已有） |
| 结构化工具定义 | Claude/Codex | 工具参数要可校验，不靠自然语言 | `engine/tool-spec.rs`（待拆） |
| 精确编辑工具 | Claude/Codex | 不要每个改动都覆盖整文件 | `engine/edit.rs`（待做） |
| 统一权限 policy | 天枢/Codex/Claude | 沙箱、审批、路径授权必须一处决策 | `engine/policy.rs`（待拆） |
| 进程树终止 | Codex/Claude | 超时不能只杀直接子进程 | `engine/process.rs`（待做） |
| 会话持久化/resume | Codex/Claude/天枢 | 当前只靠 localStorage，重启就断 | `engine/session.rs`（待做） |

### 4.2 第二批（P1）

- Plan/Goal 状态机：把现有目标循环从 `agent.rs` 抽出。
- checkpoint：保留现有写前备份，增加变更归属和恢复预览。
- 上下文预算和压缩：先推 80% 阈值、工具结果裁剪，再加 LLM 摘要。
- provider health/fallback：记录每个服务商的成功率和错误类型。
- 结构化 usage/cache：prompt hit/miss、成本、节省、峰谷。
- 搜索工具：grep/glob，避免整文件乱读。
- 文件读取分页：offset/limit/allow_large。

### 4.3 暂缓（P2）

- worktree 并行隔离。
- Skills/MCP/plugins/hooks。
- 定时任务 Automations。
- 子代理/协调者/多智能体议会。
- 跨会话记忆/信息素。
- 远程控制/Cloud/Chrome/Computer Use。

### 4.4 明确不要抄

- 云账号、云任务、云 Code Review 作为本地 BYOK 产品的必需依赖；
- 把 75 个 hook 或 CVM 全部包装照搬；
- 照抄 UI 布局、颜色、动画和品牌文案；
- 把未接线的功能做成看起来可用的开关；
- 用 prompt 假装权限已生效；
- 没有证据时自动判定任务完成；
- 把闭源项目的大段实现直接复制进本项目。

## 5. 我们自己的模块图

```text
engine/
  event.rs       统一事件类型（run/tool/approval/error）
  journal.rs     JSONL 事件日志（已有）
  provider.rs    服务商能力/模型/错误分类
  deepseek.rs    DeepSeek wire 适配（已有）
  retry.rs       瞬时错误重试（已有）
  context.rs     上下文裁剪（已有）
  tool-spec.rs   工具 schema + 名称/风险等级
  tool-pipeline.rs 工具执行、超时、结果结构
  policy.rs      路径授权、审批、删除策略
  edit.rs        精确 old/new 替换
  session.rs     transcript、resume、fork、元数据
  checkpoint.rs  写前备份、归属、恢复
  compaction.rs  阈值、摘要、归档
```

`agent.rs` 最终只保留：

- 一次 run 的状态机；
- 模型请求循环；
- 工具调用与事件编排；
- 停止/继续/失败处理。

## 6. 迁移顺序

1. **不改变行为**地拆出 `tool-spec`、`policy`、`tool-pipeline`。
2. 加 `edit_file`、`read_file` 分页、`grep/glob`，补工具结果结构。
3. 加 session store，前端仍读原任务数据，后端先做镜像。
4. 接 checkpoint 与 resume，再让前端可选择恢复。
5. 接 compaction 和 cache advisor，先在目标会话启用。
6. 最后才接 Skills/MCP/worktree/automations。

每一步的门槛：编译通过、现有测试通过、至少一个真实交互场景通过、没有
未说明的 UI 变化。没有这三项，不进入下一步。

## 7. 本轮已完成的骨架

- `engine/journal.rs`：运行、轮次、工具、审批、重试、缓存/成本记录。
- `engine/retry.rs`：408/429/5xx/连接超时重试。
- `engine/deepseek.rs`：DeepSeek 检测、`reasoning_effort`、思考模式参数适配。
- `engine/context.rs`：工具结果头部/尾部裁剪。
- 稳定线 0.1.9 的 Windows 路径、PTY 测试、审查队列修复。

下一步不是继续加功能，而是按第 6 节顺序拆 `agent.rs`。
