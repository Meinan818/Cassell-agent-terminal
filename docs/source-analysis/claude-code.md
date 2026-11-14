# Claude Code 分析（闭源，非源码级）

本机：`2.1.325`，`E:\nodejs\node_modules\@anthropic-ai\claude-code`  
边界：Claude Code 是闭源产品，不能声称做过内部源码全量审阅。

## 1. 可验证材料

- 官方 CLI `claude --help`：权限模式、resume/fork、worktree、autocompact、
  max-budget、agents、background、plugins、MCP、hooks、工具白名单等。
- 官方 `sdk-tools.d.ts`：公开工具输入/输出 schema。
- 官方文档：sessions、skills、MCP、code-review、workflows、memory 等页面。
- 社区逆向分析：Kirshatrov 的《Reverse engineering Claude Code》、Victor Antos
  的《Claude Code Internals》（后者分析对象涉及泄露源码，只能作为二手架构参考）。

## 2. 可确认的工具面

`sdk-tools.d.ts` 列出的工具包括：

`Agent`、`Bash`、`ExitPlanMode`、`FileEdit`、`FileRead`、`FileWrite`、`Glob`、
`Grep`、`TaskStop`、MCP 资源/工具、`NotebookEdit`、`WebFetch`、`WebSearch`、
`AskUserQuestion`、`TodoWrite`、`TaskCreate/Get/Update/List`、`Workflow`、
`CronCreate/Delete/List`、`ScheduleWakeup`、`Monitor`、`Artifact`、
`EnterWorktree/ExitWorktree` 等。

工具 I/O 是结构化的：Read 支持 offset/limit/allow_large，Edit 使用
`old_string`/`new_string`，结果带分页、截断、图片或 artifact 元数据。

## 3. 社区分析中值得注意的工程点

- 流式工具执行：工具可以在响应流中提前执行。
- 只读工具可并行，写工具需要独占。
- 大工具结果可落盘，上下文只保留引用/摘要。
- 权限是规则快速路径 + 审批层，不是模型自己判断。

这些是社区二手分析，不是官方源码事实；不要复制其提示词或代码。

## 4. 取舍

**学：**

- 工具 schema 的完整性和结构化结果；
- 权限模式 / allowed-tools / restricted；
- session/resume/fork；
- 预算、autocompact、工具结果落盘；
- 官方 sessions/skills/MCP/code-review 的产品边界。

**不学：**

- 闭源内部实现和泄露源码；
- Chrome/Cloud/Remote 的依赖；
- 把 Claude 的 UI/文案直接搬过来。

## 5. 结论

Claude Code 可以作为“产品能力和工具交互”的最高参考，但不能做源码级全量
审阅；本报告明确把它标为公开接口 + 社区分析，不冒充源码结论。
