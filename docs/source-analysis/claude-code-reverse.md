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
| 公开工具输入/输出接口 | 81 |
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

`sdk-tools.d.ts` 的输入接口包括：

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
