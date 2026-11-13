# Codex 功能全量盘点与差距分析（截至 2026-11-12）

> 研究时间：2026-11-12（UTC 01:12 前后）。语言：中文。
> 首要信源：OpenAI 官方文档——现已迁移至 `learn.chatgpt.com`（`developers.openai.com/codex` 会重定向过去），另有官方 Cookbook / 官方博客 / GitHub `openai/codex` 所引内容。
> 证据分级：**✅ 已验证（official, live）**= 本次用 `browser_open` 在官方域名上亲眼读到；**◐ 二手（secondhand）**= 第三方页面自称“依据官方文档核对”，本次未在官方域名上复核；**⚠️ 未证实/冲突**= 无法确认或来源打架。凡标 ◐ / ⚠️ 的结论，落地前请以本机 `/` 菜单与官方文档复核——Codex 每周都在改名、改命令、退役模型。

## Summary（结论先行）

**Codex 到底是什么。** 一个名字、四种形态、同一套 agent：① ChatGPT 桌面 App 里的 Codex 模式（2026-07-09 原独立 Codex App 并入 ChatGPT 桌面 App，macOS / Windows / Linux 预览）；② 开源 Codex CLI（Rust，Apache-2.0，`github.com/openai/codex`，最新被引版本 v0.167.0，2026-11-05）；③ IDE 扩展（`openai.chatgpt`，VS Code / Cursor / Windsurf，JetBrains 与 Xcode 为内置集成）；④ Codex Cloud / Web（云端隔离环境跑任务、出 PR）＋手机 Remote（ChatGPT 移动 App 遥控本机）。另有 GitHub（`@codex review`）、Slack、Linear 集成。✅ 官方博客与 Learn 文档一致。

**用户天天用的两个模式，官方定性如下：**

| 用户叫法 | 官方名称 | 本质（一句话） | 入口 |
|---|---|---|---|
| 目标模式 | **Goal mode / Goals**（`/goal`） | 线程级持久目标：给一次“什么算完成、可验证、不可回退”的契约，Codex 在空闲时自动续跑、拿证据判定完成，可 pause / resume / clear | App 与 CLI 的 `/goal`；App 里目标激活后输入框上方出现进度条，条上有 pause / resume / edit / clear 按钮 ✅ |
| 计划模式 | **Plan mode**（`/plan`） | 先调查、提方案、问澄清问题，**改代码之前**让你先审 approach；是“怎么做”的模式，不是“做到什么为止” | App 与 CLI 的 `/plan [prompt]` ✅ |

官方推荐顺序就是 **`/plan` 先定路线 → `/goal` 再锁定终点**（“Plans answer ‘How should we approach this?’ Goals answer ‘What must be true before we are done?’”✅）。两者不是同一个东西，也不是 Ask / Auto 的别名（见 §4）。

**产品对照总评。** 卡塞尔专员终端（Tauri + React + Codex CLI 引擎，BYOK）已覆盖 Codex 的“聊天壳 + 权限盾 + 审查队列 + 右侧多面板 + 子代理展示 + 部分命令/菜单”这一层，**在 UI 精致度（圆角、动效、收藏、导航轨、上下文文件 Tab）和 BYOK 多模型上反超 Codex**；但缺的是 Codex 的**工作流纵深**：真正的 Plan / Goal 引擎、Side chat、会话 Fork、Worktree 并行隔离、定时任务（Automations）、Skills、Queue/Steer、Git Diff Pane 的逐块 stage/revert、以及权限的颗粒化（profiles / 白名单 / 自动审批）。最大的结构性差异是**云端**：Codex 的 Cloud / Code Review / Remote / Team Tasks 都依赖 OpenAI 账号与托管基础设施，BYOK 本地产品不应照搬。

**ADD 排行榜（西瓜→芝麻，详见 §18）：** 🍉 ① 真·Plan mode ② 真·Goal mode ③ Side chat ④ 会话 Fork 与 Esc-Esc 改写分叉 ⑤ Worktree 并行隔离 + Handoff ⑥ Queue / Steer ⑦ 定时任务 Automations + Triage ⑧ Skills（`SKILL.md` + `$` 调用）⑨ 权限颗粒化（profiles / 白名单 / Approve-for-me 自动审批 / `/approve`）⑩ 上下文仪表盘（用量指示 + 自动 compact + `/recap`）；中部：Git Diff Pane 逐块操作、inline diff 评论、`/review` 分支对比、终端输出进上下文、MCP OAuth 登录、Web Search、Hooks、文件预览、通知/防睡眠；芝麻：语音、图片生成、Pets 之外的新装饰、IDE 扩展、Cloud / PR 自动评审 / Remote 手机控、Computer Use。

---

## Findings

### 1. Codex 是什么：四种形态与账号体系 ✅

- **形态：** CLI（终端本地跑）、ChatGPT 桌面 App 内 Codex 模式、IDE 扩展、Codex Cloud（Web/桌面/CLI/手机均可发起）。✅ 官方博客 Remote 文与 Learn 文档一致；另有 GitHub Agent HQ / Slack / Linear 触发。◐
- **并入：** 独立 Codex App 于 2026-07-09 并入 ChatGPT 桌面 App（macOS、Windows；Linux 预览）；App 内 Chat / Work / Codex 三模式并列，可把 Codex 设为默认视图。◐（多家 2026-10 复核官方文档的第三方一致）
- **登录：** ChatGPT 账号登录（订阅用量）或 API Key（按 API 计费）。**API Key 登录无 Cloud 功能**（云任务、GitHub Review、Slack 等均不可用），部分 OAuth 插件受限。✅/◐（App features 镜像文 + 多家复核）
- **用量：** Codex 与 ChatGPT Work 共用同一用量池；Plus 等按 5 小时窗口估算消息数（如 Plus 上 GPT-6.1 Sol 约 15–160 条、Luna 350–3,000 条）。◐（Learn Pricing 页，索引）
- **Windows（用户主平台）：** ✅/◐ 官方文档称桌面 App 与 CLI 均原生跑 Windows：PowerShell + 原生 Windows 沙箱为默认，WSL2 仅在需要 Linux 工具链时选用；Win11 为推荐基线，Win10 ≥1809 为 best-effort；WSL1 自 0.115 起不再支持。原生沙箱三种实现：`mxc`（推荐，Win11 24H2 build 26100.9278 / 25H2 26200.9278，需 CLI ≥0.162.0）、`elevated`（需管理员装机）、`unelevated`（受限 token 弱回退）。早期“Windows 须走 WSL2”的说法已过时。
- **版本节奏：** CLI 约每周发版；本次可查的最新被引版本为 v0.167.0（2026-11-05，agent command center 未读提示、后端切换保留草稿、终端图片预览、可展开的 patch 详情）。◐

### 2. 目标模式（Goal mode）与计划模式（Plan mode）✅ —— 本次重点，已验证

#### Goal mode（目标模式）✅
- **官方定义：** “Goals are persistent objectives in Codex that keep a thread working toward a defined outcome across turns.”（Cookbook 原文）目标文本同时是**第一条指令和完成标准**，Codex 用它决定下一步、判定是否做完。
- **命令：** `/goal <objective>` 设定；`/goal` 查看当前目标；`/goal pause` / `/goal resume` / `/goal clear` 管理生命周期。✅（Cookbook + App slash 表双重验证；`/goal edit` 仅见于二手来源，官方 Cookbook 未列，App 里由进度条上的 edit 按钮承担——见下。）
- **UI 位置：** App 里目标激活后，**输入框上方出现进度行**，显示进度，行内按钮可 pause / resume / edit / clear；跑目标期间仍可发 follow-up steering。✅（Learn slash 页）
- **行为：** 目标激活后，Codex 可 inspect 代码、跑命令、改代码、跑测试，**直到触及停止条件**才停：成功、pause、clear、中断、预算上限、需用户输入的 blocker。续跑只在**线程空闲、无排队输入、无其他待处理工作**时触发；**纯 Plan 工作不触发续跑**；一次续跑若未调任何工具，则抑制下一次自动续跑（防空转）。**完成必须拿证据判定**（文件、测试、benchmark、产物），不是“模型觉得大概做完了”。预算耗尽 ≠ 完成，应停下并汇总进度与 blocker。✅（Cookbook 架构节）
- **作用域：** **线程级持久状态**，不是全局记忆、不是项目指令。目标属于产生它的那个 thread（含已看的文件、跑过的命令、diff、日志、推理轨迹）；`codex resume` 恢复线程时可酌情恢复目标。✅
- **写好目标的六要素：** Outcome（终态）＋ Verification surface（测试/benchmark/产物等证据面）＋ Constraints（不可回退项）＋ Boundaries（可用文件/工具/资源）＋ Iteration policy（每轮后如何选下一步）＋ Blocked stop condition（何时停并报告 blocker）。官方推荐模板：`/goal <终态> verified by <证据> while preserving <约束>. Use <边界>. Between iterations, <选下一步的方法>. If blocked…, <报告内容>`。好例子：`/goal Reduce p95 checkout latency below 120 ms, verified by the checkout benchmark, while keeping the correctness suite green…`；弱例子：`/goal Improve performance`。✅
- **限制：** 目标文本非空、**≤ 4,000 字符**（超长请把细节放文件里、目标中引用文件）。◐（多家 slash 参考一致；官方 Cookbook 未写数字）
- **版本：** Goals 自 Codex **0.128.0** 起可用。✅（Cookbook）早期为实验特性（`[features] goals = true` 或 `/experimental` 开启）；◐ 二手称 2026-05-21 已脱离实验态并登陆 App / IDE / CLI——该日期未在官方页复核。
- **推荐工作流：** 先 `/plan` 探路定方案，方案认可后再 `/goal` 锁定终点；目标难一次写清时，先让 Codex 帮你起草再收紧。✅

#### Plan mode（计划模式）✅
- **官方定义：** `/plan` 切换 Plan mode，Codex 在改代码前**先调查并提出执行方案**，需要时追问澄清问题；适用于任务不明确、有风险、跨多系统时。✅（Learn slash 页 + Prompting 页 + Remote 博客三处一致）
- **命令：** `/plan [prompt]`，可带 inline 首条规划请求（支持粘贴内容与图片 ◐）。任务运行中 `/plan` 暂时不可用。◐
- **与 Goal 的分工：** Plan 回答“怎么做”，Goal 回答“做到什么算完”。✅
- **配置：** ◐ `plan_mode_reasoning_effort` 可在 `config.toml` 中单独设 Plan 模式的思考强度；`/model` 之后也有独立入口（多家配置参考一致，未在官方页亲眼复核）。

#### 与“Ask / Auto”的关系 —— 澄清一个常见混淆
- Codex **没有名为 `/ask` 的模式命令**。用户语境里的“Ask mode”对应两处东西：① IDE 扩展的 **Chat 模式**（只读讨论，不改文件 ◐）；② 权限档位 **Ask for approval**（见 §5）。不要把“Ask”做成与 Plan / Goal 并列的第四种 agent 模式。
- “Auto mode”同样不是独立 agent 模式，而是权限预设 **Auto**（CLI，默认）≈ App/IDE 的 **Approve for me**（自动审批，见 §5）。

### 3. 会话 / 对话管理 ✅◐

| 能力 | Codex 行为 | 证据 |
|---|---|---|
| 新建 | `/new`（同工作区开空白聊天，终端不清屏）；`/clear`（清终端＋开新聊天）；`/chat`（开无项目聊天）；`/project`（为新聊天选项目） | ✅ App slash 表；◐ CLI 表 |
| 恢复 | `codex resume`（选择器）/ `codex resume --last` / `--all`（跨目录）/ 按 ID；会话内 `/resume`；`codex exec resume --last`（非交互） | ◐ 多家一致；CLI 官方命令参考被引 |
| 会话存储 | CLI 会话以 JSONL rollout 存于 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | ◐ |
| Fork / 分支 | `/fork` 把当前对话复制为新对话（新 ID，原 transcript 不动）；`codex fork [SESSION]` 可 fork 已保存会话；`/fork` 在 App 里可 fork 到新本地聊天**或新 worktree**；`Esc Esc`（空输入框连按两次 Esc）进入“编辑上一条消息并从该点 fork” | ✅ App slash 表（fork 含 worktree）；◐ CLI 表 |
| Side chat | 见 §4 | ✅ |
| 重命名 / 置顶 / 归档 / 删除 | `/rename`、`/pin`（App）、`/archive`（归档当前聊天；CLI 归档后退出 TUI，`codex unarchive <SESSION>` 恢复）、`/delete`（◐ CLI 新命令：永久删除会话及其派生后代） | ✅（rename/pin/archive）；◐（delete） |
| 列表管理 | Remote 博客：pin 活跃聊天、按 outcome 重命名、积极归档、浏览已归档聊天；通知可直达对应聊天；`/agents`（◐ CLI 新版 agent command center：按状态筛选会话、从中心开 worktree 会话、未读结果提示、任务置顶） | ✅（Remote）；◐（/agents） |
| 导出 / 回顾 | `/export`（存为/复制为 Markdown）、`/recap`（只摘要不压缩上下文） | ◐（2026-10-30 delta） |
| 跨端同步 | App 与 IDE 扩展同项目自动同步：App 里出现 IDE context 选项（Auto context 跟踪正在看的文件），两边互相可见对方线程 | ◐（App features 镜像文） |
| 搜索 | CLI 0.156 起全屏 TUI 支持 transcript 搜索；0.166 起键盘选取/搜索 transcript | ◐ |

**产品对照：** 产品已有左侧 recents 与“创建分支”菜单，但**缺少 pin / rename / archive 的完整三件套、缺少恢复选择器、缺少导出/回顾**。注意“创建分支”在 Codex 语境里是**聊天 fork**，不是 git branch——产品需在 UI 文案上把“会话分支（fork）”与“git 分支切换”分开，否则用户会混淆（产品侧栏已有 git 分支切换）。

### 4. 模式体系总览 ✅◐

| 模式/档位 | 含义 | 入口 |
|---|---|---|
| Plan mode | 先出方案再改代码（§2） | `/plan` ✅ |
| Goal mode | 持久目标续跑到证据完成（§2） | `/goal` ✅ |
| Chat 模式（IDE） | 只读：读文件、回答、不改文件 | IDE 模式切换 ◐ |
| Agent 模式（IDE，默认） | 读＋改＋在工作区内跑命令 | IDE 模式切换 ◐ |
| Agent (Full Access)（IDE） | 不停顿审批，全文件系统＋网络 | IDE 模式切换 ◐ |
| Auto（CLI 预设，默认） | 工作区内自由读写跑命令，出界/联网才问 | `/permissions`、Shift+Tab 循环 ◐ |
| Read Only（CLI 预设） | 只读＋回答，编辑/有副作用命令均需批 | 同上 ◐ |
| Full Access（CLI 预设） | 无沙箱、无提示，全机 | 同上 ◐ |
| Ask for approval / Approve for me / Full access（App/IDE 标签） | 与上三档同义的不同叫法；另有 Automatic review（工作区可用时出现在权限选择器） | 输入框下权限控件 ✅/◐ |
| Fast / Ultrafast（速度档） | 目录提供的 Fast 服务层（约 1.5× 速度、2× 用量）；Ultrafast 仅 Pro $500 / 合规 Enterprise/Edu，GPT-6.1 Sol / Astra | `/fast [on\|off\|status]` ✅；Ultrafast ◐ |
| Chat / Work / Codex（App 顶层） | App 内三种模式：日常问答 / 跨源任务 / 代码 | App 切换 ◐ |

- **执行位置三档（App 新建聊天时选）：Local（当前项目目录）/ Worktree（隔离 Git worktree）/ Cloud（已发布云环境）。**✅（App features）
- **Handoff：** Local ↔ Worktree 之间迁移聊天，Codex 代办 Git 步骤。◐
- **运行中改向：** **Steer**（把消息注入当前 run，改方向）vs **Queue**（等当前 run 结束再作为下一 turn 发送）；App 默认可在 Settings > General > Follow-up behavior 设；排队消息显示在输入框上方，可编辑、重排、删除；CLI 里运行中按 Enter = steer、Tab = queue。✅（Prompting 页）
- **语音：** App 里按住 `Ctrl+M` 对着输入框说话（转写后可编辑再发）；CLI 0.155 起实验性 `/voice`（WebRTC、实时 transcript），0.156 起默认开启，F8 开关，`/voice settings` 选声音。◐（App features + changelog 二手）
- **个性：** ◐ `/personality`（friendly / pragmatic / none，模型支持时才出现）。

### 5. 权限与沙箱 ✅◐

- **两把独立 dial：** `sandbox_mode`（技术上能碰什么：写哪里、能否联网）× `approval_policy`（何时停下问你）。✅ 概念见 App features 镜像文；细节值见二手。
- **sandbox_mode 三档：** `read-only`（只读文件、只读沙箱跑命令）/ `workspace-write`（读写工作区、跑常规命令；命令联网默认关，需 `network_access = true` 开）/ `danger-full-access`（无文件与网络边界）。◐
- **approval_policy：** `on-request`（默认：模型判断何时问；沙箱内放行）/ `never`（永不问，失败直接回模型）/ `granular`（细表）。`untrusted` 已移除；`on-failure` 只是 `on-request` 的别名。◐
- **预设组合：** Read Only = read-only + on-request；Auto（默认）= workspace-write + on-request；Full Access = danger-full-access + never。◐
- **自动审批（Approve for me）：** workspace-write + on-request，但符合条件的审批请求走**自动评审**（automatic review）而非等你点；CLI 对应 `--approve-for-me`（别名 `--not-so-yolo`）。`--full-auto` 已于 0.154.0（2026-09）移除，旧教程会失效。◐
- **危险旗：** `--dangerously-bypass-approvals-and-sandbox`（别名 `--yolo`）= never + danger-full-access，官方警告仅限隔离 VM/容器。◐
- **颗粒化：** ◐ `~/.codex/rules/default.rules` 的 `prefix_rule`（`decision = "allow"`）可把常用命令加入白名单；`--add-dir` 增加可写根目录；命名 permission profiles（`/permissions` 内选）；`/approve` 对一次被自动评审拒绝的动作做一次性重试。`/sandbox-add-read-dir`（仅 Windows）→ 新版改为 `/setup-default-sandbox`。◐
- **子代理继承：** 子代理继承父会话的沙箱与权限模式；自定义 agent 文件里写 sandbox/approval 不生效。✅（Subagents 官方页）
- **审批粒度（App/Remote）：** approve once / for this session（chat-scoped）/ 更广范围；Remote 上可按命令、文件改动、网络、连接工具逐项批。✅（Remote 博客）
- **定时任务权限：** Scheduled tasks 以默认沙箱设置无人值守运行；Full access 下后台定时任务“风险更高”。◐

**产品对照：** 产品已有“permission shield（Auto / read-only）＋ sandbox 三档”，与 Codex 预设层对齐；缺的是 **Approve-for-me 自动审批、命名 profiles、白名单规则、`/approve` 一次性重试、审批作用域（once/session）**。

### 6. 思考 / 努力级别与模型 ✅◐

- **模型（2026-11 现行，Learn Models 页 ✅/◐）：** `gpt-6-astra`（最强、最难端到端工作）、`gpt-6.1-sol`（近 Astra、低成本，**多数工作推荐默认**，Codex/Work 默认上下文 500k tokens）、`gpt-6.1-terra`（快、写作/视觉理解/computer use）、`gpt-6-luna`（最省、聚焦可重复任务）；GPT-5.6 Sol/Terra/Luna 过渡期仍可用。退役：GPT-5.5（2026-10-14，ChatGPT 登录）、GPT-5.4/mini（2026-08-31）、GPT-5.3-Codex-Spark（2026-09-14）。
- **努力级别：** `low` / `medium` / `high` / `xhigh` / `max` / `ultra`。✅（Subagents 官方页列出 ultra/max/xhigh/high/medium/low 六档；Learn Models 页称 Luna 最高到 Max、不支持 Ultra）。各模型默认努力不同（Sol low、Luna high、Astra low——◐ 二手说法，各来源默认值有出入，以本机选择器为准）。**`ultra` 的语义官方未展开**；◐ 二手称其为客户端编排档（max ＋ 自动派生子代理），API 侧不存在——**列为未证实**。
- **入口：** App 输入框下模型＋思考控制（`/model`、`/reasoning`）；CLI `/model` 后选模型再进 More reasoning…；`config.toml` 的 `model` / `model_reasoning_effort` / `plan_mode_reasoning_effort`。✅/◐
- **速度档：** `/fast`（见 §4）。✅
- **产品对照：** 产品模型选择器（DeepSeek/Kimi/Qwen/OpenAI，BYOK）＋ low/medium/high/Max 四档，已覆盖 Codex 的档位思想；Codex 的 `xhigh` 与 `ultra` 在 BYOK 模型上无对应物——**不要硬抄档位名**，应把“Max”映射为各 vendor 的最大努力（如 DeepSeek 的 deep thinking），并在 UI 注明映射关系。Codex 的模型是 OpenAI 封闭目录，产品 BYOK 是差异化优势。

### 7. Subagents / 并行 / 后台任务 ✅◐

- **定义：** 子代理 = 被派去处理特定任务的代理，在**自己的 agent thread**里跑，带独立上下文，只把**摘要**返给主线程；主线程 giữ需求、决策与最终交付。✅（Subagents 官方页）
- **触发：** **只在明确要求时派生**（“spawn two agents”、“delegate in parallel”、“one agent per point”），或 AGENTS.md / skill 指示要求时；不会自动拆分。✅
- **内置角色：** `default`（通用编排）、`worker`（执行重：实现与修复）、`explorer`（只读：代码库勘察）。✅
- **自定义：** TOML 文件（`~/.codex/agents/` 个人 / `.codex/agents/` 项目），必填 `name` / `description` / `developer_instructions`，可配自有模型与努力、可关能力、可关单个 skill。✅ 全局 `[agents]`：`enabled`（默认 true）、`max_concurrent_threads_per_session`（旧别名 `max_threads`，默认 6 ◐）、`default_subagent_model` / `default_subagent_reasoning_effort`、`interrupt_message`（默认 true）。✅
- **查看：** App / CLI / IDE 均展示子代理 thread，可点开检查其工作与返回摘要；CLI 用 `/agent`（旧）→ 新版 `/agents`（command center）与 `/subagents` 切换活动子代理线程。✅/◐
- **批量：** ◐ `spawn_agents_on_csv` 工具：一行 CSV 派一个 worker（`job_max_runtime_seconds` 超时）。
- **成本与禁忌：** 每个子代理都独立消耗 token，并行 ≠ 免费；读重任务优先并行，写重并行易冲突、协调成本高。✅
- **后台终端：** ◐ CLI `/ps`（列后台终端＋最近输出）、`/stop`（别名 `/clean`，停掉全部后台终端）；后台终端在 `unified_exec` 下出现。长命令可后台跑。
- **EVA 对标：** 产品的 EVA mode（ultracode 式并行多智能体编排开关）**在概念上超出 Codex 原生能力**：Codex 没有常驻“编排模式”开关，编排靠 prompt 显式触发＋ TOML 自定义 agent；产品若把 EVA 做成一键开关＋可视化树，是差异化点。反向差距：Codex 的**自定义 agent 文件（TOML）与 per-agent 模型/努力**产品尚未提供（产品只有展示树）。

### 8. Skills、Plugins、Apps、MCP、Hooks ✅◐

- **Skills（Agent Skills 标准）：** `SKILL.md` 目录包（YAML front matter `name` + `description` ＋ Markdown 指令 ＋ 可选 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`）。**渐进披露**：先只加载 name/description，触发时才注入全文。位置：`.agents/skills/`（项目，从 cwd 向上扫到 repo root）、`~/.agents/skills/`（用户）、`/etc/codex/skills/`（系统）。调用：`$skill-name`、` /skills` 浏览、或按 description 隐式匹配。内置：`$plan`、`$skill-creator`（手把手建 skill）、`$skill-installer`、`$imagegen`、`$plugin-creator`、`hatch-pet`。✅（Learn slash 页提及 `$` 与 Skills & Plugins；细节 ◐）
- **Plugins：** `.codex-plugin/plugin.json` 打包 skills + app 集成 + MCP 服务器为可安装包；市场（marketplace）系统：`codex plugin marketplace add|upgrade|remove`（GitHub 简写、git URL、本地目录），`.agents/plugins/marketplace.json` 钉版本；`/plugins` 浏览/开关（Space 切换启用）。**IDE 扩展不支持 plugins。**◐
- **Apps / Connectors（`$app-slug` / `@`）：** 插件目录里的连接器（Gmail、Google Drive、Slack、GitHub、Linear、Sora、Playwright、Codex Security 等 ◐）；App 里 `@` 选插件，CLI 里 `/apps` 浏览并以 `$app-slug` 插入 composer。✅（Prompting 页提及 `@` 选插件）
- **MCP：** 三端（App/CLI/IDE）**共享同一 MCP 配置**，一处配好三处可用。✅（App features）传输：stdio 子进程 ＋ Streamable HTTP；OAuth（`codex mcp login <name>`，可带 `--scopes`）；命令：`codex mcp add|get|list|login|logout|remove`；配置在 `config.toml` 的 `[mcp_servers.*]`。◐ 另有 MCP Apps（resource 读取、elicitation、文件参数上传）、并行工具调用开关、以及**把 Codex 自身暴露为 MCP server**的 `codex mcp-server`（已标记 deprecated ◐）。
- **Hooks：** ◐ 生命周期钩子（`.codex/hooks.json` 或 `~/.codex/hooks.json` 或 config 内 `[hooks]`），需 `[features] hooks = true`（旧 `codex_hooks` 已弃用）；事件约 10–12 个：`SessionStart`（startup/resume/clear/compact）、`SessionEnd`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`、`Interrupt`（各来源计数 10 vs 12 不一致，**未证实**）；项目级 hooks 仅在项目受信（trusted）时加载；`/hooks` 可查看/信任/禁用；**有来源称 Hooks 暂不支持 Windows**（未证实，对 Windows 产品是关键待核项）。
- **AGENTS.md：** 项目指令文件，层级发现（cwd → repo root 拼接），默认 **32 KiB 上限**（`project_doc_max_bytes`）；`AGENTS.override.md` 个人覆盖；`~/.codex/AGENTS.md` 全局。`/init` 生成脚手架。`## Code Review Rules` 小节可指导 PR 评审。✅/◐
- **Memories：** ◐/✅ 跨会话记忆（稳定偏好、项目约定、 recurring 模式、已知坑），`/memories` 配置当前聊天能否使用/生成记忆；App features 称“where available”——可用性因账号/工作区而异。
- **配置分层：** `~/.codex/config.toml`（用户）＋ `.codex/config.toml`（项目，仅受信时加载）＋ profile（`--profile`，IDE 不支持 ◐）＋ `/etc/codex/config.toml`（系统）；另有企业 `requirements.toml` 上限与信任（trust）机制。◐

**产品对照：** 产品右侧已有 plugins/MCP 面板与 `/mcp`，但缺 **Skills 体系（最大缺口之一）**、缺 MCP OAuth 登录流、缺 marketplace/插件打包、缺 Hooks。产品 `/init` 与“init AGENTS.md”菜单已对齐。

### 9. 定时任务 / Scheduled Tasks / Automations ✅◐

- **两种自动化（App）：** **Standalone automations**（cron 式独立运行，如每日 triage）与 **Thread automations**（附着在单个 thread 上的心跳式定时唤醒，保留 thread 上下文，适合长期工作巡检/追问循环）。✅（App features）
- **创建：** 左侧 Scheduled/Automations 页选项目、prompt、频率、运行环境（本地项目或专用后台 worktree）；也可直接在聊天里用自然语言说“每周五早上 7 点跑这个”。◐
- **运行条件：** 本地任务要求**电脑开着、App 在运行**；跑在后台 worktree 时不碰你正在改的文件；以默认沙箱设置无人值守运行。✅/◐
- **结果：** 结果进 **Triage inbox**；无结果的运行自动归档。◐
- **云端定时：** Team Tasks 在云端跑；ChatGPT Web/移动端另有事件触发任务（App/CLI/IDE 扩展内没有事件触发）。◐
- **等价物：** CLI 没有 Automations UI，等价物是 `codex exec` + 外部 cron / GitHub Actions / Codex SDK；Codex 也**没有 Claude Code 的 `/loop`**，官方替代就是 Automations + `/goal` + shell 循环。◐
- **产品对照：** 产品完全没有定时任务。这是 Codex 桌面端最具区分度的功能之一（用户每天用 Codex，定时巡检/日报/依赖检查是高频场景），且实现不需要云端（本地 cron + 后台 worktree 即可起步）。

### 10. 代码审查 / Diff ✅◐

- **本地 `/review`：** 评审未提交改动、某次 commit、或与 base branch 的对比；**不改工作树**，只出发现（行为变化、缺失测试优先）。可用 `review_model` 单独指定评审模型。✅（App slash 表）/◐
- **Diff：** CLI `/diff`（git diff，含 untracked 文件）；App **Diff Pane**：Git diff 展示、可对行加 inline comment 让 Codex 处理、可**按 chunk/按文件 stage 或 revert**、可 commit / push / 创建 PR；IDE 里 diff 在编辑器内嵌展示、可部分保留修改。✅/◐
- **云端 Code Review（DevDay 2026-09-29）：** 桌面 App 内 Code Review 面板（PR 描述、改动文件、评论、checks）；GitHub 自动评审（新 PR 从 draft 转 ready 即审，或 `@codex review` 手动触发，`@codex security review` 为研究预览，仅标 P0/P1）；自动评审开关在 `chatgpt.com/settings/code-review`；GitLab MR 支持为预览/beta；评审规则写进就近的 `AGENTS.md` 的 `## Code Review Rules`。◐
- **Codex Security Cloud：** 研究预览（Pro/Business/Enterprise/Edu），扫描 GitHub 仓库、盯新提交、准备修复。◐
- **产品对照：** 产品已有 review queue（按文件 approve/reject、merge + undo）与 `/review`、`/diff`，**已超过 Codex 本地评审的交互深度**（Codex 本地无“逐文件 approve/reject 合并流”）；缺的是 **逐 chunk stage/revert、inline diff 评论回传、分支对比评审、云端 PR 自动评审**（后者需 GitHub 集成，暂不建议）。

### 11. 上下文管理 ✅◐

- **`/compact`：** 把早期 turns 摘要成精简版，释放 context token，保留关键点；可自动触发（长会话触及上限时自动 compact，据二手称最长可连续跑约 7 小时）；压缩前官方建议先把“目标/已完成/决策/改动文件/验证证据/blocker/下一步”写成检查点文件。✅（Remote 博客 + App slash 表）
- **`/status`：** 显示会话 ID、模型、审批策略、可写根目录、token 用量、上下文用量、费率/剩余额度。✅
- **用量可见性：** Remote 有“可选的 context indicator，常驻 composer 显示剩余上下文”；CLI 有 `/statusline` 自定义 footer（模型、上下文、git 分支、token、会话等）。✅/◐
- **`/recap`：** ◐ 只摘要、不压缩（与 `/compact` 区分）。
- **上下文附加：** `@path` 自动补全、` /mention <path>` 附加文件/文件夹、` /ide [text]` 拉 IDE 上下文、拖图片进 composer（Shift＋拖 = 加入上下文）、选中 transcript 文字 → Ask in side chat。✅/◐
- **上下文窗口：** 官方不承诺统一数字；`model_context_window` 可配（◐ 有来源称 GPT-5.6 Sol 可配到 1M）。以 `/status` 为准。
- **产品对照：** 产品已有“压缩 context”菜单、`/compact`、顶部上下文文件 Tab；缺 **常驻上下文用量指示、自动 compact 阈值提示、`/status` 的用量/限额展示、`/recap`**。

### 12. 检查点 / Rewind / Undo ⚠️（冲突，未证实）

- **共识（多家二手）：** Codex **没有 `/rewind`**，没有“恢复文件到检查点”的命令；官方建议是**用 Git 做检查点**（任务前后各 commit 一次），文件回滚靠 Git。`Esc Esc` 只是编辑上一条消息并 fork 聊天，不改文件、不改历史。◐
- **冲突点：** 另一二手来源（codex.danielvaughan.com，2026-04-13）称存在 `codex session checkpoints <id>` 与 `codex --resume <id> --from-checkpoint N` / `--fork … --from-checkpoint N`，且有自动检查点（重要编辑后、破坏性操作前）与 `auto_checkpoint_interval` 配置。**该说法未在官方文档页上复核，且与“无 rewind”共识直接冲突，列为 ⚠️ 未证实——不要写进产品对标，也不要据此立项。**
- **产品对照：** 产品的 review queue“merge flow with undo”在**文件回滚**上已超过 Codex；建议保留并强化（把 undo 与 git checkpoint 结合），而非去补一个 Codex 自己都没有的 rewind。

### 13. 终端 / 文件 / 浏览器面板 ✅◐

- **终端：** App 内置终端（作用域为当前项目/worktree，`Cmd+J` 开关；`Cmd+K` 是命令面板，不是清屏）；**Codex 可读取当前终端输出**（查 dev server 状态、失败构建）；本地环境可定义 action，在窗口顶部生成快捷按钮。CLI 有 `/ps`、`/stop` 后台终端与 `codex exec` 非交互。✅/◐
- **文件：** 文件树/改动文件摘要、按文件打开源码（语法高亮）、diff 展开/折叠、长行 wrap（移动端）。✅（Remote 博客）
- **浏览器：** App 内置浏览器：预览本地 dev server、文件预览、公开页（**不支持登录态、个人 profile、cookie、扩展、已有标签页**）；可对页面元素/区域加 **browser comments** 让 Codex 处理；**browser use** 让 Codex 直接操作页面（本地 dev server 与文件页）；设置里管 Browser 插件与允许/屏蔽网站。◐（App features）
- **Computer use：** 让 Codex 看屏、点按、输入，操作 macOS 应用（测桌面 App、复现 GUI bug 等）；**发布时不在 EEA/英国/瑞士提供**。◐
- **文件预览（非代码产物）：** 侧栏可预览 PDF、电子表格、文档、演示文稿；配合图片生成（`gpt-image-2`，`$imagegen`，用量约为普通 turn 的 3–5×）。✅/◐
- **产品对照：** 产品右侧已有 terminal / files / browser 三面板，与 Codex 面板结构对齐；待核：浏览器面板是“预览”还是“可操作（browser use）”？Codex 的 browser comments（圈元素提反馈）与“终端输出进上下文”是可抄的两个小功能。

### 14. 云端 vs 本地执行 ✅◐

| 执行位置 | 含义 | 适用 |
|---|---|---|
| Local | 本机当前项目目录，直接改你的 checkout | 日常手头工作 ✅ |
| Worktree | 本机隔离 Git worktree（`$CODEX_HOME/worktrees`，detached HEAD），多聊天并行不互踩 | 并行任务、后台任务 ✅/◐ |
| Cloud | 已发布云环境上的隔离 workspace；每任务独立 workspace；**电脑关机也继续跑**，Web/手机/桌面均可收结果 | 长任务、离线任务 ◐ |
| Remote host / SSH | 桌面 App 连 SSH 宿主机上的项目；手机 Remote 控 Mac/Windows 本机 | 多机用户 ✅（Remote 博客） |
| IDE 本地 / 云端委托 | 编辑器内本地跑，或委托给云环境、回编辑器预览 diff 再本地应用 | IDE 用户 ◐ |

- **云环境：** 一次准备（选 GitHub 仓库、Codex 装依赖测流程）、团队共享、每任务从已发布版本起隔离 workspace；网络与 secrets 按环境配置；不支持本地文件/进程/VPN/浏览器登录态。◐
- **产品对照：** 产品是纯本地 BYOK，**云端是结构性 DON'T ADD**（需账号、计费、托管沙箱、GitHub App，超出单机产品边界）。可抄的是 Worktree（本地即可实现）与“任务在后台继续、通知收结果”的体验。

### 15. IDE 扩展功能 ◐（二手，引用官方 IDE 文档 2026-10）

- 安装：`openai.chatgpt`（VS Code / Cursor / Windsurf / VS Code Insiders）；JetBrains 2025.3 起内置；Xcode 在 coding intelligence 里选 Codex。
- 三模式：Chat（只读）/ Agent（默认）/ Agent (Full Access)；权限控件在输入框下（Ask for approval / Approve for me / Full access / 命名 profiles）。
- 编辑器上下文自动包含打开的文件与选区（`/ide-context` 开关）；`@filename` 引用；就地 diff 评审（摘要＋聚焦 diff，可部分保留）；`/review`、`/plan`、`/local`、`/cloud`、`/cloud-environment`；云端委托（选环境、从 main 或本地改动出发、回编辑器预览 diff 再应用）。
- 与 CLI 共享 `~/.codex/config.toml`、AGENTS.md、MCP；**不支持 plugins 与 `--profile`**；编辑器专属 `chatgpt.*` 设置（如 `reviewDelivery`、`followUpQueueMode`）。
- **产品对照：** 产品是桌面 App 而非 IDE 插件，**IDE 扩展本身 DON'T ADD**；但“IDE context 同步”（App 感知编辑器正在看的文件）是 Codex App 的联动特性，若产品未来做 VS Code 伴生插件可再议。

### 16. 桌面 App 功能（side chat、后台任务、desktop companion）✅◐

- **并行多项目：** 一个窗口多项目、多 thread 并行；每个项目即一个代码库。✅
- **后台任务：** Automations（§9）＋ Worktree 后台聊天 ＋ Cloud 任务；通知（完成/需审批时推送，可设“始终发/永不发”）；**Prevent sleep while running** 开关。✅
- **Side chat：** `/side [question]` 开轻量临时对话，不打断主聊天；选中 transcript 文字 → **Ask in side chat**（选中段落成新对话的起始上下文）；主聊天拥有工作、side chat 负责理解工作；side chat 不可嵌套、review 模式内不可用。✅（Remote 博客 + Learn slash 页）
- **命令面板：** `Cmd+K` 打开命令面板。◐
- **Pop-out：** 把活动 thread 弹出为独立窗口，可移到正在工作的屏幕边、可置顶。◐
- **语音/听写：** 输入框 Dictate（✅ Prompting 页）、`Ctrl+M` 按住说话。◐
- **Desktop companion（Pets / 智能伙伴）：** 官方名 **Pets**（不是“smart companion”）。✅/◐
  - 2026-05-01 上线；内置 8 个：Codex、Dewey、Fireball、Hoots、Rocky、Seedy、Stacky、BSOD（另有 Null Signal、Astra 见于社区视频，名单不一 ⚠️）。
  - 浮在其他窗口之上，反映任务状态：**Running / Needs input / Ready / Blocked** 四态；底下有 mini 输入条，可发短消息。
  - 入口：Settings > Pets（新版称 Mini & Pets）、`/pet`（唤醒/收起）、右键 Hide；CLI 里 `/pets`（需支持图片的终端：iTerm2 3.6+ / Kitty / Sixel），`/pets off` 隐藏。
  - **Create your own pet**：Settings > Pets > Create，hatch-pet skill 生成 sprite（1536×1872 atlas，192×208 cell），存在本地 `.codex/pets/<name>/pet.json`，**不同步到 Web**；换宠物只改外观，不改任务行为；遵循系统 Reduce Motion。
  - **产品对照：** 产品“...”菜单里的“smart companion”与新会话空态的“living avatar mark”大概率就是对标 Pets 的实现——**功能上已对齐，名称建议与官方对齐为“桌面伙伴 / Pets”**，避免自造词；若现有实现只是静态头像＋问候语，则补“四态（运行中/需输入/就绪/受阻）联动”即可，**不值得大投入**（芝麻级装饰）。
- **Remote（手机）：** 见 §3 与 Remote 博客：手机是控制面，不是小终端。✅
- **其他小功能（官方 Remote 博客列为“小但影响大”）：** 编辑最新已发 prompt、保存/复制聊天内渲染图片、排队中 prompt 可见、通知直达聊天、浏览已归档聊天、diff 长行 wrap、Face ID/设备密码锁 App、composer 内联显示 skills/plugins、拍照直传进 prompt。✅

### 17. Slash 命令全表

#### A. 桌面 App（✅ 已验证，Learn 官方页，2026-11-12，28 条）

| 命令 | 作用 |
|---|---|
| `/approve` | 自动评审拒绝后，批准一次重试 |
| `/archive` | 归档当前聊天 |
| `/chat` | 无项目时先选聊天再开新聊天 |
| `/cloud` | 切到云端跑（可用时） |
| `/cloud-environment` | 选云环境 |
| `/compact` | 压缩当前聊天上下文 |
| `/fast` | 开/关目录提供的 Fast 档（可用时） |
| `/feedback` | 反馈对话框，可附日志 |
| `/fork` | 复制本地聊天为新本地聊天或 worktree |
| `/goal` | 设持久目标；先用 `/plan` 打磨 |
| `/ide-context` | 开/关共享 IDE 上下文 |
| `/init` | 为当前项目生成 AGENTS.md 脚手架 |
| `/local` | 在选定本地项目跑 |
| `/mcp` | 打开 MCP 状态，看已连服务器 |
| `/memories` | 配置聊天能否使用/生成记忆（可用时） |
| `/model` | 选当前聊天模型 |
| `/new` | 同本地工作区开空白聊天（可用时） |
| `/pet` | 唤醒/收起桌面宠物 |
| `/pin` | 置顶/取消置顶当前聊天（可用时） |
| `/plan` | 开关 plan mode（多步规划） |
| `/project` | 为新聊天选项目 |
| `/reasoning` | 选当前聊天思考强度 |
| `/rename` | 重命名当前聊天 |
| `/review` | 进代码评审模式（未提交改动或对 base branch） |
| `/side` | 开临时 side chat，不打断主聊天 |
| `/status` | 显示聊天 ID、上下文用量、费率限制 |
| `/usage` | 打开用量与计费设置（ChatGPT 登录可用时） |
| `/worktree` | 在新 Git worktree 里跑 |

另：`$` 显式调用 skill；已启用 skill 出现在 slash 列表；自定义 prompt 显示为 `/prompts:<name>`。✅

#### B. CLI（◐ 二手，2026-06 基表 40+ 条 ＋ 2026-10-30 增量，官方 CLI 命令页本次只返回占位，未能全文验证）

基表：`/permissions /ide /keymap /vim /sandbox-add-read-dir（仅 Windows）/agent /apps /plugins /hooks /clear /archive /compact /copy /diff /exit /experimental /approve /memories /skills /feedback /init /logout /mcp [verbose] /mention /model /fast /plan /goal /personality /ps /stop（别名 /clean）/fork /side（别名 /btw）/raw /resume /new /quit /review /status /debug-config /statusline /title /theme`。
2026-10-30 增量：`/agent` → **`/agents`**（agent command center）＋ **`/subagents`**；新增 `/rename /delete（永久删除会话及派生后代）/recap（摘要不压缩）/export（存 Markdown）/app（在桌面 App 继续）/worktree /cd /pwd（别名 /cwd）/import（迁移 Claude Code / Cursor 配置与聊天）/daemon /usage /pets（别名 /pet）/tui（scrollback/全屏）/warnings`；`/mcp login <name>`；`/experimental` 增加 Network proxy、Prevent sleep；`/setup-default-sandbox`（Windows）取代 `/sandbox-add-read-dir` 的列出位置。另有 `/voice`、`/voice settings`、`/presets`（10 个编号槽位，0.164 ◐）。
**CLI 顶层子命令（◐，54 个，被引自官方 CLI 参考）：** `codex`、`codex exec`（`codex e`）、`codex resume`、`codex fork`、`codex unarchive`、`codex cloud`（实验态）、`codex apply`（稳定）、`codex mcp …`、`codex plugin …`、`codex login`、`codex doctor`（`--network-only`）、`codex queue`（`--resume`）、`codex session …`、`codex features …`（如 `codex features enable goals`）、`codex app`（拉起桌面 App）、`codex app-server`（实验态）等。

#### C. 产品现有 palette 对照
产品已有：`/model /review /diff /compact /init /branch /agents /mcp /status /clear /help`。
- **已对齐：** model / review / diff / compact / init / mcp / status / clear。
- **命名注意：** 产品的 `/branch` 在 Codex 侧对应 **`/fork`**（聊天分支），不是 git branch；`/agents` 在 Codex 新版里是 command center（浏览/切换聊天），旧版是切换子代理线程（现为 `/subagents`）——产品需确认自己的 `/agents` 语义与哪边一致。
- **缺失（按重要度）：** `/plan`、`/goal`、`/side`、`/fork`、`/archive`、`/rename`、`/pin`、`/new`、`/local`、`/worktree`、`/cloud`（若不做云则不加）、`/reasoning`、`/fast`（BYOK 无目录档则不加）、`/usage`、`/export`、`/recap`、`/feedback`、`/memories`、`/skills`、`/plugins`、`/hooks`、`/mention`、`/ide`、`/copy`、`/personality`、`/theme`、`/logout`、`/quit`。

#### D. “...” 更多菜单（产品清单 vs Codex）
产品“...”菜单已有：MCP、side chat、create branch、init AGENTS.md、compress context、feedback、archive、smart companion、permanently delete、status、goals。
- 与官方 App slash 表**逐项可映射**：MCP=`/mcp` ✅、side chat=`/side` ✅、create branch≈`/fork` ✅（建议改名“Fork 聊天/创建分支会话”以区别 git 分支）、init AGENTS.md=`/init` ✅、compress context=`/compact` ✅、feedback=`/feedback` ✅、archive=`/archive` ✅、smart companion≈`/pet`（Pets）✅/◐、permanently delete≈`/delete` ◐、status=`/status` ✅、goals=`/goal` ✅。
- **结论：菜单项本身已与 Codex 对齐，差距不在“有没有入口”，而在“入口背后是不是真功能”**（尤其是 goals / side chat / create branch 三项——若目前只是占位菜单，优先级见 §18 前三名）。

### 18. Gap Analysis — 与卡塞尔专员终端对照（ADD / DON'T ADD）

**判定口径：** 用户价值（每天用的 Windows 开发者是否高频受益）vs 复杂度（Tauri + React + Codex CLI 引擎、BYOK、无云端 infra 的约束）vs 契合度（是否符合“本地、BYOK、桌面终端”定位）。🍉=西瓜（大而必需）、🥜=中间、🌱=芝麻（锦上添花）。

#### 🍉 ADD 排行榜（先做这些）

| # | Codex 功能 | 产品现状 | 建议与做法 | 理由 |
|---|---|---|---|---|
| 1 | **Plan mode（真实现）** | palette 无 `/plan`；无 plan 模式 | **ADD 🍉**：`/plan` 开关＋ composer 模式态（输入框上 Plan 徽标）；Plan 下只调查不写文件、产出可审方案（含步骤/边界/待澄清问题），用户确认后转执行；`plan_mode_reasoning_effort` 独立配置 | 用户天天用、Codex 官方推荐工作流的第一步；实现主要是 prompt/模式态＋“只读约束”，不依赖云端；缺它则 `/goal` 也无从谈起 |
| 2 | **Goal mode（真实现）** | “...”有 goals 入口，功能深度未知（按占位计） | **ADD 🍉**：`/goal`＋进度条（pause/resume/edit/clear）＋线程级持久目标＋空闲续跑＋证据判定完成＋预算上限停跑；目标 ≤4,000 字符校验；先 `/plan` 后 `/goal` 的引导 | 用户天天用；Codex 最具代表性的长程能力；本地可实现（续跑循环＋状态机），是产品从“聊天壳”升级为“长程 agent”的关键 |
| 3 | **Side chat（真实现）** | “...”有 side chat 入口，功能深度未知 | **ADD 🍉**：`/side`＋选中文字“在 side chat 提问”；side chat 临时、轻量、不污染主上下文、不可嵌套；关闭即回主聊天 | 高频（问“这段报错什么意思”而不带偏主任务）；实现是 fork 的轻量变体，成本低于 fork；官方 Remote 博客列为核心心智模型 |
| 4 | **会话 Fork（真实现）＋ Esc-Esc 改写分叉** | 有 `/branch` 与“创建分支”菜单，但语义疑似 git 分支 | **ADD 🍉**：`/fork` 复制聊天为新 ID（原 transcript 不动）；`Esc Esc` 编辑上一条消息即从该点 fork；UI 文案区分“会话分支”与“git 分支” | 探索替代方案不丢原路，是 agent 对话的基本操作；产品已有分支切换 UI，改造成本低；命名不清会持续误导用户 |
| 5 | **Worktree 并行隔离 ＋ Handoff** | 侧栏有 git 分支切换＋git status，无 worktree | **ADD 🍉**：新建聊天选 Local / Worktree；每 worktree 聊天独立 checkout（`$CODEX_HOME/worktrees` 式托管）；Handoff 在 Local↔Worktree 间迁移；定时任务默认跑后台 worktree | 并行多任务不互踩是桌面端核心价值；产品已有“后台任务面板＋分支切换”，缺的只是隔离层；纯本地 git 能力，无需云端 |
| 6 | **Queue / Steer（运行中改向）** | 未列出 | **ADD 🍉**：运行中发消息可选 Queue（等本轮结束）或 Steer（注入本轮）；排队消息列在输入框上方，可编辑/重排/删除；默认行为放设置 | 每天高频：跑偏时立即纠偏 vs 追加任务；实现是消息队列＋中断注入，成本中等、体验收益极大；Codex 官方列为“最不直观但最高杠杆”的设置 |
| 7 | **定时任务 Automations ＋ Triage 收件箱** | 无 | **ADD 🍉**：左侧 Scheduled 页（项目＋prompt＋频率＋本地/worktree 环境）；Standalone（cron 新跑）＋ Thread（心跳唤醒、保留上下文）两种；结果进 Triage，未出结果自动归档；本地任务需 App 运行中（明示） | Codex 桌面端最具区分度的功能；本地 cron＋worktree 即可起步，无需云端；契合“每天用”的巡检/日报/依赖检查场景 |
| 8 | **Skills（`SKILL.md`＋`$` 调用）** | 无（只有 plugins/MCP 面板） | **ADD 🍉**：`.agents/skills/`＋`~/.agents/skills/` 扫描、渐进披露、`$name` 与 `/skills` 调用、隐式描述匹配；内置 `$skill-creator` 引导创建 | Codex 扩展性的主干道（官方称 skills 是“可重复工作流”的最佳载体）；纯 Markdown＋文件约定，实现成本低、复利高；缺它则用户沉淀不了工作流 |
| 9 | **权限颗粒化：profiles / 白名单 / Approve-for-me / `/approve`** | 只有 Auto/read-only 两档 shield | **ADD 🍉**：命名 permission profiles；常用命令白名单（prefix allow）；Approve-for-me 自动审批档；`/approve` 一次性重试；审批作用域（一次/本次会话）；网络开关 | 每天高频的打断来源；Codex 的“少问但安全”全靠这层；实现是规则表＋策略路由，不碰模型；是 Auto 档好用与否的分水岭 |
| 10 | **上下文仪表盘：用量指示＋自动 compact＋`/recap`** | 有压缩 context 菜单与 `/compact`，无可见用量 | **ADD 🍉**：composer 常驻上下文剩余指示；`/status` 展示用量/限额；近上限时提示 compact（自动 compact 阈值可配）；`/recap`（摘要不压缩） | 长会话变慢/变蠢的头号原因；实现小（token 计数＋阈值），但能显著减少“突然变蠢”的客诉 |

#### 🥜 ADD（第二梯队，值得做）

| Codex 功能 | 产品现状 | 建议与理由 |
|---|---|---|
| Git Diff Pane：逐 chunk stage/revert、inline diff 评论回传、commit/push/PR | review queue 只有按文件 approve/reject＋merge＋undo | **ADD 🥜**：Codex 的 diff 评审比产品更细（chunk 级＋行间评论）；在已有 review queue 上加 chunk 操作与行间评论，成本中等、评审体验跃升 |
| `/review` 分支对比（vs base branch / 某 commit） | 有 `/review`，范围未知 | **ADD 🥜**：明确评审范围选择器（未提交/base branch/指定 commit），评审不改工作树 |
| 会话管理补齐：`/rename /pin /archive /new /export /usage` | 只有 recents；“...”有 archive | **ADD 🥜**：pin＋rename＋archive 三件套＋导出 Markdown，都是小功能、高频整理需求 |
| 终端输出进上下文（Codex 读终端输出） | 有 terminal 面板，未知是否进上下文 | **ADD 🥜**：把终端输出（dev server、失败构建）作为可引用上下文，省去复制粘贴 |
| MCP OAuth 登录（`codex mcp login`）＋ MCP 状态详情 | 有 MCP 面板，登录流未知 | **ADD 🥜**：远程 MCP 大多要 OAuth；无登录流则一半 MCP 服务器接不上 |
| Web Search（缓存默认、live 可选） | 未列出 | **ADD 🥜**：查最新 API/报错必备；BYOK 下需接搜索 provider，可先做缓存档 |
| Hooks（生命周期钩子） | 无 | **ADD 🥜**：SessionStart/PreToolUse/PostToolUse 等 10 余事件，可做 lint 门禁与审计；但**先核 Windows 支持**（有来源称暂不支持 Windows ⚠️），且需信任机制 |
| 文件预览（PDF/表格/文档/演示） | files 面板，未知预览深度 | **ADD 🥜**：非代码产物的预览是 Codex App 的标配能力 |
| 通知＋防睡眠（Prevent sleep while running） | 未列出 | **ADD 🥜**：长任务＋定时任务的前提；实现小 |
| 编辑最新已发 prompt（prompt editing） | 未列出 | **ADD 🥜**：官方 Remote 博客列为高价值小功能；与 Esc-Esc fork 联动 |
| `/mention` / `@path` / 拖图片进 composer | 有顶部上下文文件 Tab，未知 `@`/`/mention` | **ADD 🥜**：把已有的上下文 Tab 与输入框的 `@` 引用打通 |
| `/fast` 式速度档 | 有 Max 思考档 | **ADD 🥜（有条件）**：仅当 BYOK provider 提供快速档时映射；不要虚构档位 |
| Plugins 打包与 marketplace（`.codex-plugin`＋市场源） | 有 plugins 面板 | **ADD 🥜**：在已有面板上加“打包/安装来源”即可；IDE 不支持 plugins，桌面端是正确落点 |
| 任务侧栏（plan / sources / artifacts / summary） | 有 process display 三模式＋show-thinking | **ADD 🥜**：把已有过程展示升级为结构化任务侧栏（计划、来源、产物、摘要） |

#### 🌱 ADD（芝麻，锦上添花）

| Codex 功能 | 建议与理由 |
|---|---|
| 语音输入 / Dictation（`Ctrl+M`、`/voice`） | **ADD 🌱**：有用但非每日必需；Windows 语音识别接入成本中等，排后 |
| `/personality`（friendly/pragmatic/none） | **ADD 🌱**：一句话配置，成本极低，可顺手做 |
| `/theme /vim /keymap /statusline /title /copy /raw` 等 TUI 定制 | **ADD 🌱**：多为 CLI 专属；桌面端只取 `/copy`、主题即可 |
| `/presets`（10 个编号槽位存常用 prompt） | **ADD 🌱**：小而美，适合高频 prompt 沉淀 |
| Pop-out 独立窗口＋置顶 | **ADD 🌱**：前端工作流加分，成本低 |
| Pets 四态联动（Running/Needs input/Ready/Blocked） | **ADD 🌱**：产品已有 living avatar / smart companion 入口，只需把状态与任务联动；纯装饰，别多投 |
| `/import`（迁移 Claude Code / Cursor 配置与聊天） | **ADD 🌱**：获客小工具，有空再做 |
| 图片生成（`gpt-image-2` / `$imagegen`） | **ADD 🌱（谨慎）**：BYOK 模型多不支持生图，且用量 3–5×；有明确需求再接 |

#### ⛔ DON'T ADD（明确不做，附理由）

| Codex 功能 | 理由 |
|---|---|
| **Codex Cloud（云端执行、云环境、云端定时 Team Tasks）** | 需 OpenAI 账号、托管沙箱、计费、GitHub App 与多租户 infra；与 BYOK 本地定位根本冲突。本地 Worktree＋Automations 已覆盖 80% 价值 |
| **云端 PR 自动评审（`@codex review`、Automatic review、Code Review 面板）** | 需 GitHub/GitLab 集成与云端运行；产品已有本地 review queue 更强。最多做“本地分支对比评审” |
| **Codex Security Cloud（仓库扫描）** | 研究预览＋订阅门槛＋云端扫描，非单机产品范畴 |
| **Remote 手机遥控 / 移动 App** | 需账号同步、远程接入与移动端；与 Windows 桌面终端定位无关 |
| **IDE 扩展（VS Code / JetBrains / Xcode）** | 产品是桌面 App 不是编辑器插件；投入大、偏离主线。仅当未来做 VS Code 伴生时再议 |
| **Computer Use（操作 macOS 应用）** | macOS 专属、发布时不在 EEA/英国/瑞士；用户在 Windows 上，**完全不适用** |
| **Chrome 扩展 / Slack / Linear 触发** | ◐ 二手提及的周边集成；非核心编码流，投入产出比低 |
| **`/rewind` 式文件回滚** | Codex 自己都没有（靠 Git）；产品已有 merge＋undo 更强，不要反向抄一个不存在的功能 |
| **照搬 OpenAI 模型目录（Astra/Sol/Luna/Terra）与 `ultra` 档** | BYOK 产品的优势就是多 vendor；硬抄档位名会造成映射混乱。只借“模型＋独立思考强度＋plan 独立强度”的结构 |
| **Codex SDK / Agents API / GitHub Action** | 面向开发者的二次开发层，非终端产品功能 |

#### 产品已有、Codex 没有（保持优势，别丢）
消息收藏、消息导航轨、长消息折叠、上下文文件 Tab（顶部）、登录开场动画、浅/深主题＋全圆角＋grokbot 式动效、BYOK 多模型、EVA 并行编排开关——这些在官方 Codex 文档中**均无对应物**，是产品的差异化资产；其中 EVA 若补上 TOML 自定义 agent（§7），可形成“Codex 没有的一键编排”。

---

## Could not verify / 官方文档沉默或不清

1. **CLI 完整命令表（50+ 条）：** 官方 CLI 命令页（`learn.chatgpt.com/docs/developer-commands?surface=cli`）本次只返回占位文本（JS 驱动页），未能全文验证；§17-B 的 2026-10-30 增量（`/agents`、`/subagents`、`/delete`、`/recap`、`/export`、`/daemon`、`/import` 等）来自二手汇总（explainx），**以本机 `/` 菜单为准**。
2. **检查点恢复：** `codex session checkpoints` / `--from-checkpoint` 是否存在，来源直接冲突（§12），官方文档未证实。**不要据此立项。**
3. **`ultra` 思考档的准确语义：** 官方只列出该档位，未解释；“max＋自动派生子代理”系二手说法，未证实。
4. **Hooks 的事件数与 Windows 支持：** 事件数 10 vs 12 两说；有来源称暂不支持 Windows，未证实——对 Windows 产品是立项前必须核的点。
5. **Pets 内置名单：** 8 个（Codex/Dewey/Fireball/Hoots/Rocky/Seedy/Stacky/BSOD）为多方一致；Null Signal、Astra 是否在列，各来源不一。
6. **Goal 脱离实验态的日期：** 二手称 2026-05-21，官方 Cookbook 只写“自 0.128.0 起可用”，未写 GA 日期。
7. **`/goal edit` 子命令：** 二手有，官方 Cookbook 未列；App 里由进度条 edit 按钮承担，CLI 是否支持待核。
8. **模型默认努力值：** 各二手来源对 Sol/Luna/Astra 的默认值说法不一（low/high 互有出入），以本机选择器为准。
9. **“Ask mode”：** 官方无此命名；本报告按 IDE Chat 模式＋“Ask for approval”权限档解释，若用户所指另有他物，需再澄清。
10. **官方文档迁移：** `developers.openai.com/codex/*` 已重定向至 `learn.chatgpt.com`，旧 URL（如 `/codex/cli/slash-commands`）现为占位页、内链指向新 Learn 页；引用旧 URL 时请用新地址。

## Sources

**✅ 已验证（official, live）——2026-11-12 `browser_open` 亲读：**
- 桌面 App slash 命令全表（28 条）＋ Goal/Plan 定义：https://learn.chatgpt.com/codex/reference/slash-commands
- Goal 模式 Cookbook（含架构、状态机、六要素、0.128.0）：https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- Prompting（含 Goal mode、Steer/Queue、Dictate、`/plan`→`/goal`）：https://learn.chatgpt.com/codex/prompting#goal-mode
- Remote / 手机控制面（含 Queue/Steer、side chat、Plan vs Goal、inline review、pin/rename/archive）：https://developers.openai.com/blog/mastering-codex-remote-for-engineering
- Subagents 官方页（含内置角色、TOML 自定义、全局配置）：https://learn.chatgpt.com/docs/agent-configuration/subagents
- 旧 slash URL 的重定向占位页（证明文档已迁移）：https://developers.openai.com/codex/cli/slash-commands ；CLI 版占位页：https://learn.chatgpt.com/docs/developer-commands?surface=cli

**◐ 二手（third-party，索引读取 2026-11-12，自称依据官方文档核对）：**
- Codex App 功能全页（官方文档镜像）：https://doc.jarvisuni.com/openai/codex/app/features
- CLI slash 命令全参考（2026-10-30 增量）：https://explainx.ai/blog/codex-slash-commands-complete-reference-guide-2026
- 模型与努力级别：https://learn.chatgpt.com/docs/models （索引）、https://tools.benibix.com/blog/codex-model-and-reasoning-effort/ 、https://codex-sdk.hexdocs.pm/07-models-and-reasoning.html
- 权限与沙箱：https://petisland.dev/guides/codex-keeps-asking-for-approval/ 、https://agentscamp.com/guides/configuration/codex-sandbox-and-approvals 、https://automater.ai/intel/codex-approval-modes-sandbox/
- Windows 原生支持：https://itecsonline.com/post/how-to-install-codex-cli-on-windows-2026-guide 、https://khadim.tech/blog/codex-windows 、https://aftergradient.com/guides/codex-cli-windows
- IDE 扩展：https://kipt.me/guides/codex-ide-extension 、https://codex.danielvaughan.com/2026/04/01/codex-ide-extension-vs-code-jetbrains/ 、https://aftergradient.com/guides/codex-cli-vs-codex-app
- 桌面 App 合并与形态对比：https://www.agentastic.dev/compare/codex-app-vs-cli 、https://termdex.dev/tools/codex-app 、https://christopheralarcon.com/blog/how-to-use-codex/
- Cloud / Code Review / DevDay：https://endue.ai/blog/codex-devday-2026-updates/ 、https://apidog.com/blog/codex-devday-2026-updates/ 、https://agentbuildershq.com/blog/how-to-use-codex-cloud-and-codex-mobile
- Skills / Hooks / 配置：https://github.com/orchidautomation/pluxx/blob/HEAD/research/extension-systems/02-codex-cli.md 、https://github.com/dimsour/agent-blueprint-engine/blob/HEAD/docs/harness/codex.md 、https://github.com/shanraisshan/codex-cli-best-practice/blob/HEAD/README.md
- Subagents 二手补充：https://codex.danielvaughan.com/2026/03/26/codex-cli-subagents-toml-parallelism/ 、https://naizhengtan.github.io/codex-learning/lectures/12-subagents.html
- 会话/检查点（冲突来源）：https://codex.danielvaughan.com/2026/04/13/codex-cli-session-persistence-resume-fork-analytics/ （称有 checkpoint 命令）vs https://lab.devbymike.tech/en/agentes-ia/comparisons/context-management 、https://sessionboxer.talayolabs.com/blog/undo-coding-agent-changes/ （称无 rewind、无文件恢复）
- MCP / 子命令：https://www.developersdigest.tech/reference/codex/subcommands 、https://www.scriptbyai.com/codex-commands-cheat-sheet/
- Pets：https://desktamer.com/blog/codex-pets/ 、https://en.kocpc.com.tw/archives/24134 、https://arte.itlibra.com/en/articles/chatgpt-codex-pet-hide
- CLI 版本时间线：https://www.scriptbyai.com/codex-timeline/ 、https://ai-tldr.dev/tools/openai-codex-agent/
- 定时任务/Loop：https://originintelligence.ai/blog/agent-loops-deep-dive/ 、https://addyosmani.com/blog/loop-engineering/ （经由二手摘录）

**工作笔记：** `notes/source-01-official-slash-goal-plan.md`、`notes/source-02-official-subagents-models-app.md`、`notes/source-03-cli-ide-cloud-secondary.md`（各来源 URL、读取时间、验证级别同上）。
