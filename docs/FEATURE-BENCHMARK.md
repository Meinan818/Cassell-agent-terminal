# 功能全面解剖：Codex / Claude Code / 天枢 / DeepSeek Harness

本文回答的不是“谁功能多”，而是：

1. 每个功能到底解决什么问题；
2. 哪些是成熟项目的共同能力，哪些是单家特色；
3. 哪些值得学、学到什么程度；
4. 哪些看起来厉害，但不适合卡塞尔。

## 0. 总结论

### 值得抄的

- 联网搜索拆成 `web_search`、`web_fetch`、浏览器调试三种不同工具；
- 工具结果结构化、可校验、可裁剪；
- 会话事件日志、恢复、fork；
- 权限和网络访问由运行时判断，不靠 prompt；
- 计划/目标/检查点/验证门；
- DeepSeek 的缓存优先、工具结果裁剪、前缀冻结；
- 只读审查员/验证员，而不是一上来就多智能体大会。

### 可以晚点做

- Skills、MCP、插件市场；
- worktree 并行；
- 定时任务；
- 后台子代理；
- 记忆和跨会话知识；
- 语音、图片、Computer Use。

### 不建议抄

- 天枢的星域体系：16 个星域、人格、角色分层和议会投票一律不采用；
- 多智能体议会默认开启；
- 云端任务、云端 Review、手机 Remote 作为本地产品核心；
- 绕过登录/验证码/反爬的浏览器控制；
- 把“联网”做成一个没有来源、没有证据的搜索按钮；
- 把未接线的 MCP/插件/星域开关做成看起来可用的假功能。

## 1. 对标版本

| 项目 | 本机版本 | 依据 |
|---|---|---|
| Codex CLI | 0.167.0-alpha.3.2 | `codex --help`、本机安装 |
| Claude Code | 2.1.325 | `claude --help`、`sdk-tools.d.ts` |
| 天枢 | 4.0.4 | `E:\Tianshu\rivet-runtime`、插件与公开报告 |
| DeepSeek Harness | 0.2.1-rc.2 | 本机安装、项目研究报告 |
| Pi | 未找到 | 本机没有命令或安装目录 |

闭源项目的内部实现不臆测；本文只把可验证的 CLI、公开类型、模块名和项目内
研究报告作为依据。

### 1.1 2026-11-14 外网复核

开启代理后重新做了 live 检查；结果如下：

| 来源 | 结果 | 读到的关键信息 |
|---|---|---|
| `https://claude.com/product/cowork` | HTTP 200 | 标题为 “Claude Cowork”，页面写明 Cowork 正在合并进 Claude 产品线；确认它是 Claude 的通用工作面 |
| `https://code.claude.com/docs/en/overview` | HTTP 200 | Claude Code 官方总览；导航列出 sessions、memory、skills、MCP、code review、workflows、computer use |
| `https://code.claude.com/docs/en/sessions` | HTTP 200 | 官方 session 文档：resume、branch、session picker、transcript 存储、worktree 会话 |
| `https://code.claude.com/docs/en/skills` | HTTP 200 | 官方 Skills：目录/名称、按需加载、权限预授权、Cowork/云会话可用 |
| `https://code.claude.com/docs/en/mcp` | HTTP 200 | 官方 MCP：stdio、HTTP、SSE、WebSocket、工具发现、超时与重连 |
| `https://code.claude.com/docs/en/code-review` | HTTP 200 | 官方 Code Review：多 agent 读 PR、验证 finding、按严重级别行内评论，不自动 approve/block |
| `https://code.claude.com/docs/en/memory` | 超时 | 本次未读到正文，不把记忆细节写成一手事实 |
| `https://github.com/openai/codex` | HTTP 200（GitHub API） | 135,224 stars，Apache-2.0；README 确认 CLI / Web / 桌面是不同入口 |
| `https://github.com/huiliyi37/Tianshu-harness` | HTTP 200（GitHub API） | 1,342 stars，Apache-2.0；CVM + DeepSeek V4 优化 |
| `https://github.com/deepseek-ai/deepseek-harness` | HTTP 200（GitHub API） | 280,708 stars，MIT；“Everything is a Plugin” |

本地安装和旧研究报告不能代替最新官方事实；后续涉及会变化的接口、模型、套餐
和文档，要重新查官方页面。超时项明确标为未核实。

## 2. 功能总表

| 功能 | Codex | Claude Code | 天枢 | DeepSeek Harness | 我们的结论 |
|---|---|---|---|---|---|
| 对话/Agent Loop | 有 | 有 | AgentLoop | 有 | 必做 |
| 读取文件 | 有 | Read，支持分页/大文件 | 有 | 有 | 必做，补 offset/limit |
| 精确编辑 | patch/编辑工具 | Edit old/new | edit_file/hash_edit/apply_patch | 文件工具 | 必做，已开始 |
| 整文件写入 | 有 | Write | write_file | 有 | 保留，但限制使用 |
| 搜索/遍历代码 | grep/glob | Grep/Glob | grep/glob/ast_grep/repo_map | 有 | 必做，优先 grep |
| 终端 | 有，受 sandbox | Bash/PowerShell | bash/job | 有 | 必做，补进程树 |
| 联网搜索 | `--search`/web_search | WebSearch | web_search/web_fetch | 有/资料 | P1，先做来源与权限 |
| 网页抓取 | WebFetch/浏览器 | WebFetch | web_fetch | 有/资料 | P1 |
| 浏览器调试 | 有 | Chrome 集成/浏览器工具 | browser_debug/Playwright | 有 | P2，先本地浏览器 |
| Computer Use | 有（平台受限） | 有 | computer_use | 有/资料 | 暂缓，高风险 |
| Plan 模式 | `/plan` | EnterPlanMode | plan_submit/plan_close | 有 | 必做，不新增 UI |
| Goal 模式 | `/goal` | Task/Goal 工具 | goal_tracker | 有 | 保留并抽模块 |
| 会话恢复 | resume/fork/archive | resume/fork/session | session-persist | 有 | P1 |
| 上下文压缩 | compact/状态 | autocompact | CacheAdvisor/边界压缩 | 80% 触发 | P1，先裁剪后摘要 |
| 权限/沙箱 | sandbox×approval | permission-mode/tools | path grants/project trust | permission | 必做，统一 policy |
| 审查/变更 | review/diff | 文件历史/Review | review_changes/delivery gate | 有 | 保留并结构化 |
| 检查点/回滚 | Git 为主 | 文件历史 | checkpoint/rewind | 有/资料 | 保留并补预览 |
| 子代理 | 显式派生 | Agent 工具/后台 | Coordinator/Council/Galaxy | 有/资料 | P2，只做只读验证 |
| 星域/人格 | personality | 无对应 | 16 星域 | 无 | 不照搬，最多 3 个角色 |
| Worktree | 支持 | `--worktree` | 有 | 未见必须 | P2 |
| 后台任务 | 有 | background agents | jobs/workers | 有 | P2 |
| 定时任务 | Automations | Cron/ScheduleWakeup | 有调度模块 | 有 | P2 |
| Skills | 有 | 有 | bundled skills | 有/资料 | P2 |
| MCP | 有 | 有 | 有 | 有/资料 | P2 |
| 插件 | 有 | 有 | 插件目录 | 有 | P2 |
| Hooks | 有 | 有 | 运行时 hooks | 有/资料 | P2，少而精 |
| 记忆 | Memories/AGENTS | CLAUDE.md/记忆 | 统一记忆/信息素 | 有/资料 | 先做项目约束 |
| Office 文档 | 有限 | Skills/Artifacts | office-docx/xlsx/pdf/ppt 插件 | 有/资料 | P2 |
| 语音 | 有（平台） | 有 | whisper/audio | 有/资料 | P3 |
| 图片生成 | 有 | 有 | generate_image | 有/资料 | 不接收费前不碰 |
| 用量/成本 | 有 | max-budget/usage | token ledger/cache panel | 有 | 必做 |
| 云端/Remote | 有 | 有 | 桌面/云相关 | 有/资料 | 不抄 |

## 3. 重点功能逐个解剖

### 3.1 联网搜索（web_search）

**成熟项目怎么做**

- Codex：`--search` 打开服务端原生 `web_search` 工具；搜索由服务商执行，
  不是客户端模拟搜索。
- Claude Code：有 `WebSearchInput` / `WebFetchInput` 两个独立工具；网页内容
  抓取和搜索不是同一个工具。
- 天枢：工具白名单里同时有 `web_search`、`web_fetch`、`browser_debug`、
  `computer_use`，并且不同星域仍受权限/工具档限制。
- DeepSeek Harness：公开资料强调缓存优先和上下文预算；搜索结果也要按工具
  结果裁剪，不能整页塞回模型。

**该学什么**

1. 搜索和抓取分开：搜索返回结果列表，抓取返回单个页面正文。
2. 每条结果必须带标题、URL、摘要、抓取时间、来源类型。
3. 搜索结果进入上下文前先裁剪；网页正文过长时只保留标题、目录、关键段落。
4. 网络访问是独立权限，不能和“读本地文件”共用同一档。
5. 默认禁止携带浏览器登录态；不读取 Cookie、不自动登录。
6. 对 prompt injection 做隔离：网页内容只作为不可信资料，不能当系统指令。

**不要学什么**

- 不做“随便输入一句话就直接联网并在正文里编来源”的假搜索；
- 不做绕过登录/验证码/反爬的浏览器；
- 不在没有搜索 API 的情况下偷偷抓 Google/Bing 搜索结果页；
- 不让搜索工具访问本地文件或应用配置。

**什么时候做**

P1。先做 `web_search` 和 `web_fetch` 的 provider 接口、权限和来源展示；
没有可用搜索 provider 时，界面明确写“未配置搜索服务”，不假装可用。

### 3.2 浏览器与 Computer Use

**成熟项目怎么做**

- Codex/Claude：浏览器工具和 Computer Use 是两套东西；前者读页面，后者操作
  桌面/鼠标键盘。
- 天枢：`browser_debug` 与 `computer_use` 分开；浏览器依赖 Playwright，
  不是简单 iframe。
- 我们的现有内置浏览器是“子 webview 展示 + 地址栏 + 前进后退”，还不是
  真正的网页调试工具。

**该学什么**

- 浏览器工具应有：打开、导航、截图、读取 DOM/可访问性树、点击、输入、
  控制台错误、网络错误。
- 截图和 DOM 结果要结构化，不要只返回一张图。
- 默认独立 profile，不继承系统浏览器登录态。

**不要学什么**

- 不做无确认的自动登录、支付、发消息；
- 不做 stealth 反检测；
- 不把 Computer Use 作为默认能力。

**优先级**

浏览器读页面 P1；完整浏览器调试 P2；Computer Use P3 或不做。

### 3.3 天枢的“星域”

**它到底是什么**

天枢本机 `STAR_DOMAINS` 是 16 个认知姿态，不是 16 个模型，也不是 16 个独立
智能体：

| 星域 | 名称 | 角色 |
|---|---|---|
| tianshu | 天枢 | 全局统筹 |
| pojun | 破军 | 探索先锋 |
| tianfu | 天府 | 结构守护 |
| tianliang | 天梁 | 交付执行 |
| tianquan | 天权 | 方案审查 |
| tianji | 天机 | 前提质疑 |
| tianxuan | 天璇 | 跨域寻迹 |
| fu | 辅 | 认知调校 |
| wenqu | 文曲 | 代码美学 |
| kaiyang | 开阳 | 对账测量 |
| yaoguang | 瑶光 | 复现验证 |
| huagai | 华盖 | 长程守候 |
| qiming | 启明 | 根因洞察 |
| changgeng | 长庚 | 视觉终验 |
| qisha | 七杀 | 剪枝瘦身 |
| taiyi | 太一 | 极简中心 |

每个星域主要包含：人格提示词、关键词、决策风格、勇气阈值、工具白名单、
UI persona。本机的 `trace-lab` 真实试验也说明：星域能提供不同视角，但出现过
超时和聚合失败，不能把“多星域同意”当成正确性证据。

**该学什么**

- 把“探索 / 实现 / 验证”三种认知姿态做成可选角色；
- 验证角色只读、不能改代码、不能自己给自己盖章；
- 角色输出要带证据路径和“不能推出什么”。

**不要学什么**

- 不把 16 个星域全部塞进 UI；
- 不让星域自动改写系统提示词或绕过工具权限；
- 不默认开多智能体议会；
- 不把星域投票当事实。

**我们的决定**

不采用天枢星域体系，也不做 16 个星域、星域投票或额外人格层。

卡塞尔现有的 NORMA 和 EVA 必须保留，并且对标关系固定为：

- **NORMA = Claude Cowork**：日常通用工作、资料、文档、研究、整理、执行；
- **EVA = Claude Code**：工程开发、代码、终端、测试、审查；
- 两者是同一产品的两种模式，共用记忆，任务绑定模式；
- EVA 的 Ultracode 是工程侧增强，不是第三模式。

复杂任务只在工具权限和流程上区分“只读检查 / 执行修改 / 验收”；不再新增
星域 UI、星域提示词或议会。

### 3.4 记忆

**成熟项目**

- Codex：AGENTS.md、Memories，项目规则和跨会话记忆分开。
- Claude：CLAUDE.md、Skills、项目/用户设置分层。
- 天枢：统一记忆 + 信息素 + 项目规则；自动注入有边界，不把所有内容都塞进
  每轮上下文。

**该学什么**

- 项目约束（必须遵守）和用户偏好（可选）分开；
- 记忆有失效时间/来源/作用域；
- 只自动注入短约束，长记忆按需召回；
- 记忆写入必须脱敏，不保存密钥和隐私内容。

**不要学什么**

- 不做“什么都记”的黑盒记忆；
- 不用信息素/神秘概念包装普通项目笔记；
- 不把记忆写入和代码改动混成一个权限。

**优先级**

P1 先做项目级约束；跨会话记忆 P2。

### 3.5 Skills / MCP / 插件 / Hooks

**共同规律**

- Skills 是“按需加载的说明书 + 脚本/资源”；
- MCP 是外部工具服务；
- 插件负责把工具、技能、连接器打包；
- Hooks 是运行生命周期上的确定性回调。

**该学什么**

- 先统一工具注册，再谈插件；
- Skill 只加载名称和描述，命中后才加载正文；
- MCP 服务器要有连接状态、工具列表、超时和权限；
- Hook 只做少量关键节点：PreToolUse、PostToolUse、SessionStart、RunEnd。

**不要学什么**

- 不做插件市场 UI；
- 不做“开关已打开但服务器未接线”的假状态；
- 不让 MCP 工具绕过主权限策略。

**优先级**

MCP 和 Skills 在 P2；先完成工具协议和会话存储。

### 3.6 子代理 / 议会 / Galaxy

**成熟项目**

- Codex：显式派生，子代理有独立上下文，只回摘要；
- Claude：Agent 工具、后台 agent、worktree 隔离；
- 天枢：Coordinator/Worker、议会、Galaxy 多种编排。

**该学什么**

- 子代理只做可并行的只读工作：搜索、代码勘察、验证、审查；
- 主线程保留目标、决策和最终交付；
- 写操作要 worktree 隔离，否则会互相踩文件；
- 每个子代理的结果要带证据和风险。

**不要学什么**

- 不默认自动派生；
- 不让多个子代理同时写同一工作区；
- 不把多个模型投票当成事实；
- 不把复杂编排暴露成主路径。

**优先级**

等单 agent 稳定后再做；先做只读 verifier。

### 3.7 定时任务 / 后台任务 / Worktree

- 定时任务适合日报、巡检、依赖检查，但要求电脑开机、应用运行；
- 后台任务适合长命令，但必须能停、能看输出、能杀进程树；
- Worktree 适合并行写任务，但实现复杂，容易产生分支/合并/清理问题。

我们的顺序：先做后台任务和可停止的子进程，再考虑 worktree，最后才做定时
任务。不要在没解决进程管理前做“无人值守自动改代码”。

### 3.8 Office / Artifacts / 图片 / 语音

- Office 插件适合文档处理，但依赖重、格式兼容复杂，不是引擎核心；
- Artifacts 适合把长输出变成可查看文件，但要版本、来源、下载；
- 图片生成涉及收费和审核，必须用户明确要求；
- 语音转写依赖模型和麦克风权限，不能默认开启。

这些功能可以学交互和产物管理，但不建议现在做。

### 3.9 审查 / Diff / 检查点

这是我们已经领先的部分，不应为了“像 Codex”而推倒：

- 已有逐文件通过/拒绝、真实 git diff、中文路径、rename、未追踪文件；
- 应补：逐块 diff、行内评论、接受全部后的撤销、检查点预览；
- 不应把审查变成自动合并；用户必须能看到真实改动。

## 4. 功能取舍表

### 4.1 立即做（P0）

| 功能 | 为什么 | 验收 |
|---|---|---|
| 工具定义/执行分离 | 统一参数、权限、结果 | `tool-spec` + `tool-pipeline` 模块，测试通过 |
| `edit_file` | 避免整文件覆盖 | 精确 old/new 替换、重复匹配拒绝 |
| `grep`/`glob` | 不再靠整文件乱读 | 有路径/大小限制和结果裁剪 |
| 会话事件日志 | 可恢复、可审计 | 每次 run 有 start/tool/end/fail |
| 统一权限 policy | 沙箱/路径/审批一处判断 | 越界/删除/网络测试 |
| 进程树终止 | 超时不留孤儿进程 | 子进程+孙进程都停止 |
| DeepSeek 参数适配 | 思考强度真正生效 | low/medium/high/max 映射 |
| 工具结果裁剪 | 省上下文、保缓存 | 头尾裁剪测试 |

### 4.2 第二批（P1）

- `web_search` / `web_fetch`，带来源和网络权限；
- 会话持久化、resume、fork；
- 文件读取分页；
- 上下文预算和轻量压缩；
- 只读 verifier；
- 项目约束记忆；
- provider health / fallback。

### 4.3 以后（P2）

- Skills、MCP、插件；
- worktree；
- 后台任务；
- 定时任务；
- Office 文档；
- 不新增角色系统；保留 NORMA/EVA，需要审查时只使用一个不带人格的只读验收流程。

### 4.4 暂不做或不做

- 16 星域全部 UI 化；
- 多智能体议会默认开启；
- Cloud/远程/手机控制；
- Chrome 登录态/反爬；
- Computer Use 默认能力；
- 云端 Review；
- 图片/语音自动接入；
- 任何“看起来能用、实际没接线”的功能。

## 5. 建议产品路线

### v1 稳定线

对话、工具、审查、终端、浏览器、Plan/Goal、DeepSeek、用量、检查点。

### v2

工具协议重构、`edit_file`、`grep/glob`、会话恢复、上下文压缩、搜索来源、
只读验收流程（不叫星域、不建角色）。

### v3

Skills/MCP、worktree、后台任务、定时任务、记忆。

### 不进入路线

云端依赖、星域大礼包、无边界 Computer Use、自动登录/反爬。

## 6. 结论

成熟项目最值得学的不是“功能名字”，而是它们把功能放进什么边界：

- 搜索是独立工具，不是聊天里的神秘按钮；
- 星域是认知姿态，不是事实来源；
- 记忆是受控上下文，不是什么都记；
- 子代理是并行工具，不是自动真理；
- 浏览器是工具，不是权限后门；
- 计划、目标、验证和恢复必须由运行时持有。

卡塞尔应该做一个**小而硬的本地 agent runtime**，而不是把四家产品的所有功能
都搬进来。
