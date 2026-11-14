# Claude Code 工具面全表

来源：本机 `2.1.325` 的 `sdk-tools.d.ts`（4,405 行，自动生成的 JSON Schema 类型）。
这是公开随包发布的接口定义，不是泄露源码。

口径校正：

- `ToolInputSchemas` 实际列出 **44 个工具输入接口**；
- `ToolOutputSchemas` 对应 **44 个输出接口**；
- 合计 **88 个接口定义**。此前写“81 个”是把去重后的接口数当成了工具数，
  两个口径都不准确，以本表为准。

## 1. 文件与搜索（6）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `FileRead` | `file_path, offset, limit, pages, allow_large` | 分页读、大文件显式开关 | **P0**：我们的 `read_file` 应补 offset/limit 与超大文件保护 |
| `FileEdit` | `file_path, old_string, new_string, replace_all` | 精确替换、默认拒绝多处匹配 | **P0**：已有 `edit.rs`，补 `replace_all` 的显式语义 |
| `FileWrite` | `file_path, content` | 整文件写 | P1：仅用于新建/明确覆盖 |
| `Glob` | `pattern, path` | 文件发现 | P1：用于工具前的文件定位 |
| `Grep` | `pattern, path, glob, output_mode, context, type, head_limit, offset, multiline` | 结果限制、上下文行、类型过滤 | **P0**：比我们现在的 grep 参数完整 |
| `NotebookEdit` | `notebook_path, cell_id, new_source, cell_type, edit_mode` | 结构化编辑，不整文件覆盖 | P2：我们不处理 notebook |

## 2. 执行（1）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `Bash` | `command, timeout, description, run_in_background, dangerouslyDisableSandbox` | 超时、后台、危险开关显式命名 | **P0**：补 `run_in_background` 与超时；`dangerouslyDisableSandbox` 只做审计不做默认 |

## 3. 子代理与任务（8）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `Agent` | `description, prompt, subagent_type, model, effort, run_in_background, name, team_name, mode, isolation` | 子代理有类型、模型、effort、隔离级别 | **P0**：我们的子代理目前没有统一 schema |
| `TaskStop` | `task_id, shell_id` | 统一停止后台任务 | P1 |
| `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` | 任务 ID、状态、依赖、owner | 任务是有状态的实体，不是 UI 临时列表 | **P1**：先做 `TaskCreate/Update/List` 三件套 |
| `Workflow` | 脚本、名称、描述、恢复运行 ID | 工作流可恢复 | P2 |
| `ExitPlanMode` / `EnterPlanMode` | `tool, prompt` / `subject, description, activeForm` | 计划模式是显式工具 | **P1**：我们已有 plan 概念，缺工具化 |

## 4. 交互与通知（5）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `AskUserQuestion` | `question, header, label, description, preview`（多组） | 结构化提问，不是自由文本 | **P0**：我们的审批/提问应有结构化 schema |
| `ShowOnboardingRolePicker` | `reason` | 首次使用引导 | 不采用 |
| `OfferChromeSetup` | — | 浏览器扩展引导 | 不采用 |
| `ReadNotifications` | — | 读取通知 | P2 |
| `PushNotification` | `message, status` | 主动通知 | P2 |
| `Monitor` | `description, timeout_ms, command, url, protocols` | 长时监控 + 超时 | P2 |

## 5. 网络（2）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `WebFetch` | `url, prompt, offset` | 抓取后由模型按 prompt 提取，支持分页 | **P0**：联网能力的最小闭环 |
| `WebSearch` | `query, allowed_domains, blocked_domains` | 域名白/黑名单在工具层 | **P0**：补域名限制与配额 |

## 6. MCP 资源（5）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `ListMcpResources` | `server` | 资源枚举 | P1 |
| `RefreshMcpTools` | `server` | 工具表热刷新 | P1 |
| `Mcp` | — | 通用 MCP 调用入口 | P1 |
| `ReadMcpResourceDir` | `server, uri` | 目录式资源 | P2 |
| `ReadMcpResource` | `server, uri` | 单资源读取 | P1 |

## 7. 工作区与产出（5）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `EnterWorktree` | `name, path` | 会话隔离到 worktree | P1 |
| `ExitWorktree` | `action, discard_changes` | 退出时显式处理未提交改动 | P1 |
| `Projects` | `path, content, local_path, present_to_user, query, n` | 项目注册与展示 | P2 |
| `Artifact` | `file_path, favicon, icon, limit, page_token, scope, title, description, label, url, prompt, force` | 发布产物的完整生命周期 | 不采用云端版，学“预览+版本” |
| `ClaudeDesign` | `operation` | 设计操作入口 | 不采用 |

## 8. 自动化与调度（6）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `CronCreate` | `cron, prompt, recurring, durable` | 持久化定时任务 | P1 |
| `CronDelete` / `CronList` | `id` / — | 管理与可见性 | P1 |
| `ScheduleWakeup` | `delaySeconds, reason, prompt, stop, noop` | 单次唤醒 | P1 |
| `RemoteTrigger` | `action, trigger_id, session_id, cursor` | 远程触发 | 不采用 |

## 9. 反馈与提案（4）

| 工具 | 关键输入 | 设计点 | 我们是否采用 |
|---|---|---|---|
| `ReportFindings` | `level, file, line, summary, failure_scenario, category, verdict, outcome` | 结构化审查结果，强制给失败场景 | **P1**：我们的审查队列应复用这个 schema |
| `SendFeedback` | `type, title, details, area, task_category` | 产品反馈 | 不采用 |
| `ProposeSkills` | 技能名、类型、目标、证据、SKILL.md 片段 | 技能提案 | P2 |
| `ProposeGoal` | `condition, ask_user` | 目标提案 | P2 |

## 10. 从工具面能看出的产品判断

1. **工具数量不是重点，边界才是。** 44 个工具里，真正支撑编码闭环的只有
   `FileRead/FileEdit/FileWrite/Glob/Grep/Bash` 六个；其余是任务、交互、
   调度、产出等“外围但产品化”的能力。
2. **每个高风险动作都有显式开关**：`dangerouslyDisableSandbox`、
   `discard_changes`、`force`、`allow_large`。危险不是隐藏参数，而是命名
   里就写着“危险”。
3. **结构化提问/审查是工具，不是提示词技巧**：`AskUserQuestion` 和
   `ReportFindings` 都有 schema，模型必须按字段输出。
4. **任务/工作流/定时器都是持久实体**，有 ID、状态、恢复入口。这比
   “在聊天里说一句稍后提醒我”可靠得多。

## 11. 覆盖边界

- 本表只解析输入字段，不包含每个字段的完整类型与约束；
- `McpInput`、`EnterPlanModeInput` 等空接口可能是联合类型/运行时构造，
  未展开；
- 输出接口的字段未逐项列出；
- 未执行任何真实工具调用。
