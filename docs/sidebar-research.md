# 三家侧边栏生态研究报告：Codex / Claude / 天枢

> 研究日期：2026-11-13
> 起因：用户亲口说 Codex 的侧边栏超级好用，Claude 和天枢的侧边栏也很强大；卡塞尔现在的 Inspector 点文件、点网址都是往外跳，很离谱。
> 写法：大白话，每个结论写来源，没来源的写"未证实"，不编造。
> 总原则：三家都保持质疑，一个都不盲信——功能先推理可不可行、对卡塞尔合不合适，想通了才建议抄。

---

## §0 一句话结论

三家的侧边栏其实是同一个东西的不同叫法：**"对话之外的第二个工作台"**。

- 左边栏管"去哪"：项目、会话、任务、插件入口。
- 右边栏管"干活"：文件、终端、浏览器、diff，四块拼在一起，让"改代码 → 看结果 → 改回来"这个循环不用离开应用。
- 用户说 Codex"超级好用"，好用的根子就一句话：**整个循环都在一个窗口里完成**。改完不用切编辑器看 diff，跑起来不用切浏览器看效果，出错不用切终端看日志——点一下，面板就在右边。

卡塞尔现在的问题不是"少一个按钮"，而是**循环是断的**：Inspector 里"浏览器"只是一个输入框，点开就跳系统浏览器；"文件"只是纯文本预览，没有高亮、不能改；"终端"只是一行输入框，不是一个真终端；diff 只是纯文本着色，没有并排、不能逐行评论。等于右边栏只有壳，没有工作台。

---

## §1 三家侧边栏逐项对照表

### 1.1 左边栏（管"去哪"）

| 功能 | Codex | Claude（Code 页签） | 天枢 |
|---|---|---|---|
| 项目列表 | 有：项目连文件夹，悬停项目出"新建对话"按钮；点项目名切换项目 | 有：会话按项目分组 | 有：项目列表、全部项目；会话绑定工作目录 |
| 会话列表 | 有：多对话并行，可 pin、归档、重命名；长任务跑着可以去别的对话，回来继续 | 有：多会话并行侧栏，支持筛选、分组、归档；Ctrl+点会话开分屏，两个会话并排看 | 有：多会话标签栏，独立 cwd + 模型 + 审批模式；可 popout 成独立窗口 |
| 并行隔离 | 有：每个对话可选本地 checkout 或独立 worktree | 有：每个会话自动独立 Git worktree（可配分支前缀） | 未证实（文档没提 worktree） |
| 定时任务/自动化 | 有：侧栏有 scheduled tasks 入口 | 有：本地 GUI 定时任务（Code 页签） | 有：Automations 面板（左侧栏功能面板之一） |
| 插件 / MCP 入口 | 有：侧栏 Plugins，含 MCP、skills、apps | 有：MCP 接入（设置里），skills | 有：Skills / Hooks 管理面板 |
| 收件箱 / Triage | 有：GitHub PR inspector（审 PR 的地方） | 有：PR 监控状态栏（gh CLI 轮询，Auto-fix / Merge when ready） | 有：Inbox 收件箱面板 |
| 设置入口 | 有：侧栏进设置（General/权限/Git/Worktrees/浏览器/Computer Use/用量） | 有 | 有 |

### 1.2 右边栏（管"干活"）

| 功能 | Codex | Claude（Code 页签） | 天枢 |
|---|---|---|---|
| 文件浏览 | 有：Files 面板，点开文件不用切编辑器；定位是"快速看一眼、对照着看"，长编辑还是回编辑器 | 有：File 面板，点对话/diff 里的文件路径就打开，可手改、点 Save 写回（Local/SSH 会话） | 有：文件树（来自会话工作目录）+ @file 预览（右侧抽屉，语法高亮 + 行号）；支持的文档可进"阅读"模式批注 |
| 文件富预览 | 有：PDF、电子表格、幻灯片、文档的富预览（2026-04 更新的 Expanded Sidebar） | 有：浏览器预览面板能开 HTML、PDF、图片、视频 | 有：阅读模式（文档、网页） |
| diff 审查 | 有：Review 面板，绿红计数、统一/并排两种视图切换、逐行评论、stage/revert/commit/push/开 PR、让 Codex 拟提交信息、`/review` 另派审查员 | 有：Diff 面板，`+N -N` 指示、左侧文件列表 + 右侧并排改动、点行写评论、Cmd/Ctrl+Enter 一次提交、Review code 按钮 | 有：Changes 改动审查面板；检查点回滚在 Review 面板"回滚点"标签 |
| 终端 | 有：每个对话一个终端，绑项目/worktree；另有 Open 按钮把项目丢给外部编辑器/终端（VS Code、Cursor、Zed、Ghostty、iTerm2、Warp） | 有：集成终端面板 | 有：集成终端（xterm.js + Rust portable-pty），Ctrl+J 唤出 |
| 内置浏览器 | 有：Electron `<webview>`，独立 profile；`@Browser` 唤起；标注模式（点元素、写"字放大"）；开发者模式可看 DOM/控制台/网络/性能；agent 能自己开本地服务验证 | 有：Browser 面板，`.claude/launch.json` 配 dev server；autoVerify 默认开：每次改完自动截图、查错、点界面、修；也能开静态 HTML/PDF/图片/视频 | 有：browser_debug 浏览器验证（frontend 档位才装这个工具）；阅读模式用桌面 Chromium 直接浏览网页；Computer Use 走 CDP 直连系统 Chrome |
| 计划/任务视图 | 有：Plan 模式、Goal 模式在 composer 里；summary pane 跟踪 agent 的计划、来源、产物 | 有：Plan、Tasks、Subagent 三个面板（可拖拽排列） | 有：GoalBar（目标进度条，暂停/继续/取消）；Delegation 委派舰队面板 |
| 诊断/仪表盘 | 有：Usage 页面（用量与限额） | 有：CI 状态栏（轮询 GitHub checks） | 有：Cockpit 驾驶舱（8 个 tab：Summary/Safety/Verify/Model/Context/Trace/MCP/Advisory，2 秒轮询）；GlanceBar 状态栏（git 分支、模型、缓存命中率、上下文占比、本轮 cost……） |

### 1.3 侧边栏"生态"（插进侧边栏的东西）

"生态"指的是：侧边栏不只是一排按钮，它是各种能力的入口集合。三家都往侧边栏里塞了同一类东西，只是名字不同：

| 生态能力 | Codex | Claude | 天枢 |
|---|---|---|---|
| Skills（可复用剧本） | 有：Skills 列表，`SKILL.md` 文件夹 | 有：Skills（同 CLI 的那套） | 有：Skills 管理面板 |
| MCP（接外部工具） | 有：Settings > Plugins > MCPs | 有 | 有：MCP 面板（Cockpit 里一个 tab） |
| 定时任务 | 有：scheduled tasks | 有：本地定时任务 | 有：Automations + `/schedule` |
| GitHub | 有：PR inspector、自动代码审查、开 PR | 有：PR 监控 + Auto-fix/Merge | 有：Git / GitHub 面板 |
| 电脑操作 | 有：Computer Use 插件（macOS/Windows，区域限制） | 有：Computer Use（研究预览，Pro/Max，Team/Enterprise 没有） | 有：Computer Use（Pro 功能，CDP 直连系统 Chrome；Windows 走 COM 自动化） |
| 语音 | 有：语音听写 | 未证实 | 有：麦克风语音输入（本地 whisper.cpp，离线） |
| 手机遥控 | 有：ChatGPT 手机 app 继续桌面会话（Dispatch） | 有：手机继续会话 | 有：手机扫码看进度、批审批 |

---

## §2 Codex 侧边栏深度拆解（用户最看重的，写细）

来源：Flavio Copes《The complete guide to Codex》（flaviocopes.com/codex/，2026-11-05 更新，截图 2026-09）；csarko.sh《How Codex embeds its browser》；VentureBeat 2026-04 Codex 桌面端更新报道；actuallylearnai.com《Codex: The Complete Guide》。

### 2.1 整体布局：三栏 + 底部输入框

- **左栏**：项目和对话。还有插件、定时任务、设置。悬停项目出现"新建对话"按钮。点项目名（输入框上方）可以切换项目、加项目、不带项目开对话。
- **中间**：对话本身。Codex 在这里解释在干什么、问问题、贴命令输出、汇报结果。
- **右栏**：工作面板。文件、终端、内置浏览器、Git diff 都在这里，按需开、按需关。
- **底部**：输入框。除了写字，还能：贴文件/图片、选模型和思考档位、选项目/环境/分支、改"不用问就能干什么"（权限）。

作者的原话很能说明问题："I like the app because I can stay in one place from the first prompt to the final review."（从第一句提示词到最后 review，全程不用离开这个应用。）以及："I want the whole loop in one window: plan, change, terminal, browser, diff, commit."（整个循环要在一个窗口里：计划、改、终端、浏览器、diff、提交。）

### 2.2 左栏细拆：项目 × 对话，两级组织

- **项目 = 一个文件夹**。Codex 会列出你最近用过的 Git 仓库，也可以从磁盘任选文件夹。
- **对话 = 一次任务**。一个修登录 bug 的对话只放登录 bug 的事，换依赖升级就另开对话。
- 对话可以**重命名、pin（置顶）、归档**。归档只是从活动列表拿掉，不删记录。
- 长任务跑着的时候，**可以去别的对话，Codex 跑完或需要你决定的时候发系统通知**，回来继续。
- 每个对话可以选**本地 checkout 还是独立 worktree**：个人小项目直接在本地改，团队项目用分支 + PR。

好用在哪：**任务之间不串味**。一个对话就是一个工作现场，回来的时候现场还在，不用重新讲上下文。

### 2.3 右栏细拆之一：Files 面板（文件）

- 入口：面板菜单里选 **Files**。
- 作用原文："The desktop app has a file panel for quickly opening files without switching to an editor."（快速打开文件，不用切编辑器。）
- 作者的使用场景：**一边看解释、一边看文件**，或者**拿改过的文件和邻居文件对照**。
- 诚实边界作者自己说了：**长编辑还是回全功能编辑器**。Files 面板不是要取代编辑器，它是"看一眼"的地方。
- 也可以在输入框里**贴文件**（attach），让 Codex 知道这个文件重要；不知道从哪下手就让它自己搜仓库。

好用在哪：**看文件不需要"离开"**。在 Codex 里问"这个函数干啥的"，顺手点开文件看一眼，再问下一句，思路不断。

### 2.4 右栏细拆之二：Review 面板（diff 审查）

这是 Codex 侧边栏里最值钱的一块，也是用户"超级好用"的感觉里占比最大的部分：

- Codex 干完活，打开 review 面板：**绿红两个计数**告诉你改了多少行，点计数看 diff。
- **两种视图可切换**：统一视图（像 git diff 那样上下排）和**并排视图**（新旧左右对照）。作者说并排适合仔细比对。
- **逐行评论**：点某一行写一句"这里不对，按 X 改"，Codex 只改那一处。
- **`/review` 另派审查员**：一个独立的 reviewer 只读 diff，给出按优先级排好的发现，不动你的工作树；可以在设置里让它跑在一个独立对话里，不污染干活的对话。
- **Git 操作全在面板里**：stage、revert、commit、push、开 PR，不用开终端敲 git；提交信息可以自己写，也可以让 Codex 拟一个。

好用在哪：**审查和改动在同一个地方**。看到哪行有问题，点那行说一句话，Codex 改完，diff 就地更新。不用在编辑器、终端、聊天窗口三个地方来回切。

### 2.5 右栏细拆之三：Terminal 面板（终端）

- 每个桌面对话**自带一个终端，绑在它的项目/worktree 上**。面板菜单里选 Terminal 打开。
- 用途：起开发服务器、跑 git 命令、看日志、自己试结果。
- **Codex 能读终端输出**：构建挂了，直接说"读终端输出，找第一个真正的错，修好它"。
- 想要独立终端时，点对话顶部的 **Open 按钮**，把项目（或 worktree）丢给外部编辑器/终端：VS Code、Cursor、Zed、Ghostty、iTerm2、Warp 等，可选。
- 2026-04 更新后支持**多终端标签页**，还有连远程 devbox 的 SSH（alpha）。

好用在哪：**终端是"这个任务的终端"**，不是随便一个 shell。它知道自己在哪个项目、哪个 worktree，输出能直接喂给 agent。

### 2.6 右栏细拆之四：内置浏览器（Browser）

这是 Codex 侧边栏里最"高级"的一块，也是技术上最难抄的一块：

- 入口：面板菜单里打开，或在提示词里写 `@Browser`。
- **独立 profile**：它有自己的浏览器身份，你平时 Chrome/Safari 的标签页、cookie、登录状态都不会带进来。需要真浏览器登录态的任务，用浏览器扩展连你的 Chrome/Edge/Brave/Opera/Vivaldi，在提示词里写 `@Chrome`。
- **agent 自己会用**：让它起开发服务器、打开 `http://localhost:4321/settings`，在桌面和手机宽度下验证表单。
- **标注模式（annotation mode）**：打开后**点页面上的元素，直接写"把这个字放大"**。不用写"那谁谁标题下面右边那块文字"，点一下就行。选中的元素连同你的话一起发给 Codex，改完再让它在运行中的页面上复查那个元素。作者说这是他最喜欢的功能之一。
- **开发者模式**：可以看 DOM、控制台、网络请求、性能数据。
- **技术实现**（来源：csarko.sh 的逆向分析）：Codex 是 Electron 应用，浏览器面板是 Electron 的 `<webview>` 标签——一个跑在独立 Chromium 进程里的"客人页面"，嵌在应用自己的窗口里；一个内置插件通过 Chrome DevTools Protocol（CDP）经本地 socket 驱动它（导航、跑脚本、读网络、截图）。所以 agent 能"开着浏览器干活"，不是只给你看个页面。

好用在哪：**"看到"和"改掉"之间没有翻译成本**。点一下元素就是一句话，改完马上在同一个页面上验证。不用截图、不用贴链接、不用描述"右边第二块"。

### 2.7 左栏的"生态入口"：插件、定时任务、Computer Use

- **插件**：Plugins 面板，里面是 skills、MCP 服务器、hooks、浏览器能力等。Computer Use 就是一个插件：装上、打开开关，macOS 上授权录屏和辅助功能，就能让 Codex 操作 macOS/Windows 应用（复现桌面 bug、改设置、跨应用干活）。但它是插件不是内置，步骤多，而且**有区域限制**（发布时 EU/UK 没有），Windows 上用前台输入，干活时你不能同时用电脑。
- **定时任务**：侧栏有 scheduled tasks 入口（日报、定时跑任务）。
- **富预览**（2026-04 更新的 Expanded Sidebar）：侧边栏能直接预览 PDF、电子表格、幻灯片、文档这些非代码文件；还有一个 **summary pane**（摘要面板），跟踪 agent 的计划、来源和产物。
- **GitHub PR inspector**：在应用里审 PR、回评论。

### 2.8 质疑与边界（按总原则，不盲目抄）

- **Computer Use 不要抄**：它是插件、区域受限、Windows 上抢前台；卡塞尔是 BYOK 本地产品，没有 OpenAI 的账号体系和云端，抄过来是个半吊子。等以后再说（P2-8 已有）。
- **Chrome 扩展那条路不要抄**：Codex 靠浏览器扩展连用户真 Chrome，代价是一个"能读改所有网站数据"的扩展。对卡塞尔来说，内置浏览器先做到"自己看页面"就够了，扩展以后再说。
- **内置浏览器的独立 profile 要学**：Codex 的浏览器不带用户 Chrome 的登录态，这一点是优点——干净、可复现、不泄露隐私。卡塞尔的内置浏览器也要独立 profile，不要复用系统浏览器。
- **Electron 方案不要抄**：Codex 用 Electron 所以自带 Chromium；卡塞尔是 Tauri，内置浏览器要走 WebView2 子 webview 的路（见 §5），不要为了抄而换框架。

---

## §3 Claude 侧边栏（Code 页签）拆解

来源：GeeksforGeeks《Claude Code in Claude Desktop》（2026-09-03）；ccleaks《Claude Code Desktop Guide: Worktrees, Parallel Sessions, Diffs》（2026-04-14 改版）；cloudroom.dev《Best Claude Code GUI (2026)》；ArchieCur/claude_code_field_guide（GitHub）；uniroute.app《Claude Code in Terminal vs Desktop App》。

### 3.1 整体：不是"侧边栏 + 面板"，是"可拖拽的多窗格工作区"

Claude Desktop 里有三个顶层入口：Chat（统一对话，含 Cowork）、Code、（Work）。Code 页签是一个图形化工作区，跑的和 CLI 同一个 Claude Code 引擎。

和 Codex 最大的不同：**Claude 没有"左栏 + 右栏"的固定分工，而是一组可以自由拖拽、弹出、并排的窗格**。官方说法是 8 个窗格，不会同时全显示，需要时自动打开：点文件路径开 File 窗格，审改动开 Diff 窗格。

8 个窗格：Chat（对话）、Diff、Browser、Terminal、File、Plan、Tasks、Subagent，另外 macOS 还有 iOS Simulator 窗格。

### 3.2 侧边栏：会话管理（2026-04-14 改版的重点）

- 改版标题就是"多会话 + 并行"，侧栏管所有会话：筛选、分组、归档。
- 每个会话**自动独立 Git worktree**（可配分支前缀），一个会话一个分支、一个文件状态、一个 review 窗格。
- **分屏**：按住 Cmd/Ctrl 点侧栏里的会话，并排打开两个会话盯着看。
- 快捷键：`Cmd/Ctrl+Shift+D` 开关 Diff，`Cmd/Ctrl+Shift+B` 开关 Browser。

### 3.3 File 窗格：能改的查看器

- 点对话或 diff 里的任意文件路径就打开。
- **可以手改，点 Save 写回**（Local 和 SSH 会话支持；云端会话未证实）。
- 这是 Claude 比 Codex 激进的一点：Codex 的 Files 面板定位是"看一眼"，长编辑回编辑器；Claude 的 File 窗格直接让你在里面改。

### 3.4 Diff 窗格：逐行评论 + 审查

- Claude 改完文件，会话工具栏出现 `+N -N` 指示，点开是左侧文件列表 + 右侧并排改动。
- 点任意一行写评论，写完按 `Cmd/Ctrl+Enter` 一次提交，Claude 读完所有评论一遍改掉，再出新 diff。
- 点 **Review code** 让 Claude 自己审一遍，评论留在同一个视图里。

### 3.5 Browser 窗格：自动验证是默认行为

- Claude 能起你的 dev server，在 Browser 窗格里打开。服务器配置存在 `.claude/launch.json`（runtimeExecutable、runtimeArgs、port、cwd、autoPort）。
- **autoVerify 默认开**：每次改完文件，自动截图、查错、点界面、发现问题就修，修完再验证——在你说话之前就跑完一轮。
- 也能直接开静态 HTML、PDF、图片、视频路径。
- 用户也可以直接在预览窗格里和运行中的应用交互。

### 3.6 和 Codex 的对比：谁强在哪

| 维度 | Codex 更强 | Claude 更强 |
|---|---|---|
| 布局 | 左右栏分工固定，上手快，"一个窗口走完循环" | 窗格自由拖拽、弹出、分屏，适合多任务并行盯着 |
| 文件 | Files 面板"看一眼"很克制，不抢编辑器的活 | File 窗格能直接改、能保存，省得切编辑器 |
| diff | Git 操作全在面板里（stage/commit/push/PR 一条龙） | 逐行评论 + 一次提交多条评论的交互更顺；Review code 按钮 |
| 浏览器 | 标注模式（点元素说话）是独一份 | autoVerify 默认开，改完自动验，不用人催 |
| 并行 | worktree 可选（本地改 or 独立分支） | 会话自动独立 worktree，零配置；分屏看两个会话 |
| 诊断 | Usage 页面 | CI 状态栏（轮询 GitHub checks，Auto-fix / Merge when ready） |

### 3.7 质疑与边界

- **"窗格自由拖拽"不要全抄**：Claude 的可拖拽多窗格很强大，但实现复杂、容易乱；卡塞尔的 Inspector 是固定浮层，先把"文件/终端/浏览器/diff 四个面板做扎实"，拖拽以后再说。
- **autoVerify 默认开：用户 2026-11-13 亲口定要开**：Claude 每次改完自动截图验证，想法是对的（改完就验）；用户说"autoVerify 很好用，我喜欢开"。BYOK 烧用户自己的 token 这个顾虑要跟用户说清楚，但用户拍板了就要做——默认开，设置里留开关能关。
- **PR 监控（Auto-fix / Merge when ready）不要抄**：它依赖 `gh` CLI + GitHub Actions，卡塞尔是本地 BYOK 产品，没有 GitHub 账号体系，抄过来接不上。

---

## §4 天枢侧边栏拆解

来源：天枢官方 GitHub 仓库 huiliyi37/Tianshu-harness 的 docs/desktop-guide.md（桌面端用户指南，官方文档）；widechaos.cn《天枢使用文档》（第三方文档站，非官方）；拆包报告 ~/workspace/tianshu-research/tianshu-4.0.4-拆包研究报告.md（包结构与插件清单）。

### 4.1 整体：左侧功能面板（Ctrl/⌘+1…9 切换）

天枢桌面端（Tauri + React，经 sidecar HTTP/SSE 驱动同一 agent 内核）的左侧栏是一组**功能面板**，不是简单的会话列表：

| 面板 | 干什么 |
|---|---|
| Mission Control | 多会话控制台 |
| Inbox | 收件箱（待处理事项集中地） |
| Automations | 定时任务 |
| Skills / Hooks 管理 | 技能与钩子 |
| Git / GitHub | Git 与 GitHub |
| Changes | 改动审查 |
| Delegation | 委派舰队与团队波次 DAG（并行派生的可视化） |
| Cockpit | 驾驶舱（诊断仪表盘） |

另有：新项目、天枢助理、项目列表、全部项目、历史与文件、个人空间（来源：widechaos.cn，第三方文档）。

### 4.2 文件：文件树 + @file 预览 + 阅读模式

- "历史与文件"打开历史抽屉，可按标题筛选，切换会话、文件、成果。**文件树来自当前会话绑定的工作目录**。
- 点文件：支持的项目文档可以转到**阅读模式**打开，保留项目关联，继续按原文批注。
- **@file 文件预览**：消息里提到的文件可以点，**右侧抽屉展示文件内容（语法高亮 + 行号）**。这是天枢版的"点文件直接在应用里看"。
- 变更标记提示哪些文件被 agent 改过、有回退信息；要核对内容时进**差异查看**。
- 阅读模式还能直接浏览网页：输入地址打开，**在桌面 Chromium 里直接浏览网站**，登录只发生在网站自身。

### 4.3 浏览器：browser_debug 浏览器验证

- 天枢的浏览器能力叫 **browser_debug**：agent 用它验证页面。只在 frontend 工具档位才装这个工具（工具档位：minimal 36 件、frontend 37 件，多出来的就是 browser_debug）。
- Computer Use 走 **CDP 直连系统 Chrome**（不用另装浏览器），Windows 走 COM 自动化；是 Pro 功能。
- 桌面端 Settings → 集成 → 浏览器（截图）可以一键装 chromium（带安装日志）。

### 4.4 终端：真终端（xterm.js + Rust portable-pty）

- 集成终端：`⌘/Ctrl+J` 或 `Ctrl+`` 唤出，**内嵌终端（xterm.js + Rust portable-pty）**，不用离开天枢就能跑命令。
- 这是三家里唯一在官方文档里写明终端技术栈的：前端 xterm.js，后端 Rust portable-pty。这对卡塞尔有直接参考价值（见 §5）。

### 4.5 招牌件：Cockpit、SideChat、Rewind、GoalBar

- **Cockpit 驾驶舱**：运行时仪表盘，8 个 tab 实时展示 agent 内部状态（2 秒轮询）：Summary（会话概览）、Safety（doom loop 检测）、Verify（验证状态）、Model（缓存命中率）、Context（上下文占用）、Trace（事件轨迹）、MCP、Advisory。入口在左侧栏"… 更多"菜单内的"驾驶舱"。官方定位："开发者向，普通用户日常用不到"。
- **SideChat 旁路提问**：`⌘/Ctrl+;` 打开一个不影响主任务的轻量会话，主线程跑长任务时临时问问题，不打断、不污染主上下文。入口很隐蔽（侧栏没有，只有快捷键）。
- **RewindOverlay 时间旅行**：回退到任一历史消息点，三种粒度（仅对话 / 仅代码 / 对话+代码），入口是 Plus 菜单、Esc Esc、`/rewind`。
- **GoalBar 自主目标**：`/goal` 启动后输入框上方出现状态条，显示迭代数/目标/耗时/预算剩余 + 暂停/继续/取消。
- **JobsDock / TodoDock 常驻抽屉**：后台任务停靠条（展开日志 / Kill / 在终端打开）、跨标签常驻 todo。
- **GlanceBar 状态栏**：输入框上方单行实时显示星域 glyph、git 分支、模型、推理强度、缓存命中率、上下文占比、本轮 cost、耗时、turn 计数、todo 徽章。

### 4.6 质疑与边界

- **Cockpit 的 8 个 tab 不要全抄**：官方自己都说"开发者向，普通用户日常用不到"。卡塞尔先把用量/缓存面板（P0-10）做出来，诊断仪表盘以后再说。抄一个"出问题时才打开"的诊断入口，不要抄一个常驻的 8 tab 仪表盘。
- **天枢的左侧栏功能太多**：8 个功能面板 + 项目列表 + 会话标签，信息密度很高；卡塞尔的用户是代码新手，侧栏要克制。先保证"文件/终端/浏览器/diff"四个干活的面板，再考虑 Inbox、Automations 这些。
- **阅读模式（文档批注）不要抄**：那是天枢"工作 + 阅读"双模式的产品形态，跟卡塞尔的"办公 + 工程"不是一回事。卡塞尔的文件查看器先服务代码和 diff，文档批注以后再说。
- **手机遥控、WSL 连接式运行时**：跟侧边栏关系不大，不抄。
- **值得抄的**：@file 预览（点消息里的文件，右侧抽屉出高亮预览）——这个交互很轻，卡塞尔可以直接学；集成终端的技术栈（xterm.js + portable-pty）——有现成路线，不用自己摸索。

---

## §5 卡塞尔的差距清单（我们现在缺什么，缺得有多离谱）

现状核实：`src/components/RightPanel.tsx`（Inspector）+ `src/App.tsx`，2026-11-13 实测代码。

Inspector 现在有 6 个页签：审查、终端、文件、浏览器、插件、工作流。浮层形态（fixed，360px，宽版 480px），默认不常驻，打开时不挤压对话区。

| 面板 | 现在有什么 | 三家有什么 | 差距有多大 |
|---|---|---|---|
| 文件 | 目录列表 + 点文件出**纯文本预览**（2000 行上限，无高亮、不能改、不能搜）；列表行连文件大小都没有（只有预览过才知道） | Codex：Files 面板快速看；Claude：File 窗格能改能保存；天枢：@file 抽屉高亮 + 行号 | **大**。只能看纯文本，等于记事本。没有高亮，没有行号常驻，没有编辑，没有"改过的文件"标记 |
| diff/审查 | 纯文本 diff 按行着色（+ 绿 − 红，400 行上限），逐文件点开看；审查队列是待批文件列表 | Codex：并排/统一切换、逐行评论、stage/commit/push/PR 全在面板；Claude：并排 + 逐行评论一次提交 | **大**。没有并排视图，没有逐行评论，没有 Git 操作（提交还得去终端敲），400 行就截断 |
| 终端 | 单行输入框 + 历史记录，输一行跑一行（走 onRunShell）；不是真终端：没有持续会话、没有交互程序（vim/top 都跑不了）、没有多标签 | 三家全是真终端：Codex 每对话一个终端；Claude 集成终端；天枢 xterm.js + portable-pty | **最大**。这不叫终端，叫"命令输入框"。跑 dev server、看日志这种持续输出的活干不了 |
| 浏览器 | 只有一个输入框，输网址 → 调 `openUrl` **跳系统浏览器**；应用内什么都没有 | 三家全是应用内嵌浏览器：Codex `<webview>` + 标注模式；Claude Browser 窗格 + autoVerify；天枢 desktop Chromium + browser_debug | **最离谱**。名义上有个"浏览器"页签，实际上是个"跳出去"按钮。用户原话"有点离谱"就是指这个 |
| 插件 | 插件/MCP 列表（开关） | 三家都有插件/MCP/skills 入口 | **小**。有列表，但没有"装插件、配 MCP"的完整流程（未证实，待核对） |
| 工作流 | 工作流页签（具体内容未核对） | Codex：Plan/Goal 在 composer；Claude：Plan/Tasks/Subagent 窗格；天枢：Delegation 委派舰队 | **待核对**。页签在，但不知道里面是什么 |
| 左侧栏 | 项目列表 + 最近任务（P0-9 刚改成只显示名字） | 三家左栏都有项目/会话/定时任务/插件入口 | **中**。左栏只有项目和任务，没有定时任务、插件、设置的快速入口 |
| 面板形态 | 浮层，360/480px，打开时盖住右侧 | Codex/Claude：常驻可调大小的窗格；天枢：左侧功能面板 + 标签栏 | **中**。浮层本身没问题（P2-21 已定），但 360px 对并排 diff 太窄；diff 需要更宽的形态 |

一句话：**六个页签里，四个干活的（文件、终端、浏览器、diff）全是"壳"**：有入口，没工作台。用户在 Codex 里"点文件直接看、改完直接审、跑起来直接在浏览器里验"的那个循环，在卡塞尔这里每一步都要跳出去。

---

## §6 落地建议：P0-11 具体要做什么

### 6.1 原则（先想清楚再动手）

1. **先补"循环"，再补"生态"**。文件 → diff → 浏览器 → 终端，这四个是"改代码 → 看结果 → 改回来"循环的四个点，先让循环转起来；插件、定时任务、Inbox 这些生态入口是下一步。
2. **先做到"看"，再做到"改"，再做到"agent 自己验"**。文件先做到高亮查看，再做到能改；浏览器先做到人能看页面，再做到 agent 能截图验证；不要一口吃成 Codex 的标注模式 + CDP。
3. **不要为了抄而换框架**。Codex 用 Electron 自带 Chromium，卡塞尔是 Tauri，内置浏览器走 WebView2 子 webview 的路（见 6.5）。
4. **独立 profile**：内置浏览器不用系统浏览器的登录态，干净、可复现、不泄露隐私（学 Codex 的优点）。

### 6.2 分四步，先做哪步后做哪步

#### 第 1 步：文件查看器（最急，1–2 天量级）

做到什么程度才算"对标"：
- 点文件列表、点对话里的文件路径、点 diff 里的文件，都在 Inspector 里打开查看器（不要跳出去）。
- 语法高亮（至少覆盖代码、Markdown、JSON、diff）、行号常驻。
- 大文件不卡：按需渲染/虚拟滚动，不要一次渲染几千行 DOM。
- 显示文件大小、修改状态（agent 改过的文件打标记，和 diff 联动）。
- 图片、PDF 直接预览（Codex 的富预览是这个意思；先做图片，PDF 后做）。

技术上怎么实现：
- 后端已有 `read_file` / `list_files` 命令，直接复用；补一个返回文件大小和二进制判断的命令（现在列表行没有大小，是因为 `list_files` 不返回 size）。
- 高亮用现成库（highlight.js 或 Prism，二选一，不要自己写高亮器）；diff 视图用 `diff` 这个 npm 包算差异、React 渲染（不要自己写 diff 算法）。
- 不要用 Monaco：太重，Inspector 只有 360–480px 宽，Monaco 的编辑器在这种窄浮层里不好用；查看器先用轻量高亮。

#### 第 2 步：diff 审查升级（和第 1 步一起做，1–2 天量级）

做到什么程度才算"对标"：
- 并排视图（新旧左右对照）+ 统一视图切换；现在只有统一纯文本。
- 逐行评论：点一行写一句话，提交后 agent 只改那一处（Claude 的做法）。
- 审查队列里的文件，点一下直接在查看器里打开对应 diff（不要只给纯文本）。
- 400 行截断取消或放宽到至少能看完一个文件的改动；超长 diff 分页或折叠。
- Git 操作先做最常用的两个：提交（写信息或让 agent 拟）、回退单个文件；push/开 PR 后做。

技术上怎么实现：
- 后端已有 diff 文本（git diff），前端用 `diff` 包或直接解析 git diff 输出做并排渲染；逐行评论是前端状态 + 一条发给 agent 的消息（复用现有对话通道，不用新协议）。
- 宽度问题：并排 diff 在 360px 里放不下。Inspector 加一档"超宽"（比如 720px）专供 diff 用，或 diff 时允许 Inspector 临时变宽；不要为了并排把全站布局改掉。

#### 第 3 步：内置浏览器（最难，单独做，3–5 天量级，含原型验证）

做到什么程度才算"对标"：
- 在 Inspector 里直接打开网页（本地 dev server 和外网都行），不用跳系统浏览器。
- 独立 profile（不带系统浏览器登录态），前进/后退/刷新/地址栏齐全。
- 点对话里的链接、点"在浏览器里打开"，都在应用内打开。
- agent 能让浏览器打开指定 URL（比如"起服务，在浏览器里打开 localhost:3000 验一下"）——先做到"打开"，截图验证后做。
- **v1 不做**：标注模式（点元素说话）、CDP 驱动。这些是第 4 步以后的事。**autoVerify 要做**：用户亲口定要开，默认开（每次改完自动截图验证），设置里留开关能关；BYOK 烧 token 的事跟用户说清楚就行。

技术上怎么实现（已核实，有来源）：
- **不要用 `<iframe>`**：很多网站禁 framing（X-Frame-Options），而且 iframe 里的页面 agent 够不着、也调不了 devtools。只能看个皮，没有"工作台"的价值。
- **正确路线：Tauri 2 的子 webview**。`Window::add_child` + `WebviewBuilder` 可以把一个 WebView2 子视图嵌进主窗口里（Windows 上就是 WebView2 控件，和主界面同一个窗口）。已核实：
  - API 真实存在（docs.rs：`tauri::window::Window::add_child`，`tauri::webview::WebviewBuilder`），但在 `unstable` 这个 Cargo feature 后面，需要开 feature 才能用。
  - 子 webview 是原生层、不是 DOM 孩子：位置、显示/隐藏、大小都要前端 JS 手动同步（窗口 resize、Inspector 开关、页签切换时都要同步位置）。
  - Windows 上有个坑：**同步的命令里创建 webview 会死锁**，必须用异步命令或单独线程创建（docs.rs 有明确警告）。
  - 独立 profile 是稳定功能：`WebviewBuilder::data_directory` 可以给浏览器子视图单独指定数据目录（不和主界面混）。
  - 先做原型：一个最小的"Inspector 里嵌一个子 webview 打开 example.com"的 demo，跑通定位/显隐/resize，再往里接地址栏和 agent 的"打开 URL"命令。原型不通就不要继续往下写。
- 备选路线（如果子 webview 原型卡住）：多个 `WebviewWindow` 拼成一个应用的样子（稳定 API，不用 `unstable`），但窗口管理复杂，只作备选。

#### 第 4 步：真终端（单独做，2–3 天量级）

做到什么程度才算"对标"：
- 真 PTY：持续会话、交互程序能跑（vim、top、dev server 持续输出）。
- 每对话一个终端（绑项目/worktree），不是全局一个 shell。
- agent 能读终端输出（构建挂了，问一句就能让它读输出找错）。

技术上怎么实现：
- 前端用 **xterm.js**（天枢官方文档写明的技术栈，也是业界标准），后端用 **portable-pty** 这个 Rust crate（天枢同款）。不要自己写终端模拟器。
- 注意：Windows 上 PTY 是 ConPTY，portable-pty 封装好了；但要和已有的 CREATE_NO_WINDOW 修复（子进程不闪终端）一起测，别把修好的闪屏又带回来。

### 6.3 验收标准（做到什么程度才算 P0-11 完成）

拿用户在 Codex 里的那个循环当验收用例，一步都不能跳出去：

1. 让 agent 改一个文件 → 在 Inspector 里点开文件，**高亮 + 行号**能看。
2. 在 Inspector 里打开 diff，**并排**能看，点某一行写"这里不对"，agent 只改那一处。
3. 让 agent 起 dev server → 在 Inspector 里打开 localhost，**页面在应用内**能看，不用跳系统浏览器。
4. 在 Inspector 的终端里跑 `npm test`，**持续输出**能看，挂了让 agent 读输出找错。
5. 全程**一次都不跳系统浏览器、不开外部编辑器、不开外部终端**。

### 6.4 不做的（这次明确不抄）

- 标注模式（点元素说话）：Codex 独一份，很好，但要 CDP + 元素定位，放在 P0-11 之后。
- Computer Use / Chrome 扩展：不要（见 §2.8）。
- Cockpit 式 8 tab 诊断仪表盘：不要（见 §4.6），用量面板是 P0-10 的事。
- 阅读模式（文档批注）：不要（见 §4.6），那是天枢双模式的产品形态。
- 窗格自由拖拽：Claude 的做法，实现复杂、容易乱；Inspector 固定浮层先做扎实，拖拽以后再说。

---

## §7 来源清单

**Codex**
- Flavio Copes《The complete guide to Codex》，flaviocopes.com/codex/，2026-11-05 更新（截图 2026-09）：桌面端布局、Files/Terminal/Browser/Review 面板、Plan/Goal、权限与沙箱。
- csarko.sh《How Codex embeds its browser, and what a Rust IDE can copy》：Electron `<webview>` + CDP over Unix socket + 独立 profile。
- VentureBeat《OpenAI drastically updates Codex desktop app…》（2026-04）：内置浏览器、Expanded Sidebar（PDF/表格/幻灯片富预览、summary pane）、多终端标签页、Remote SSH、GitHub PR inspector。
- actuallylearnai.com《Codex: The Complete Guide》：桌面端功能总览（并行对话、worktree、内置浏览器、artifact viewer、PR inspector）。

**Claude**
- GeeksforGeeks《Claude Code in Claude Desktop》，2026-09-03：Code 页签 8 个窗格、File/Diff/Browser 窗格、会话侧栏。
- ccleaks《Claude Code Desktop Guide: Worktrees, Parallel Sessions, Diffs》（2026-04-14 改版）：多会话侧栏、拖拽窗格、diff 逐行评论、Browser 预览 + autoVerify、PR 监控。
- cloudroom.dev《Best Claude Code GUI (2026)》：官方 GUI 对比、并行会话、diff、浏览器预览。
- ArchieCur/claude_code_field_guide（GitHub）：Desktop 与 CLI 的能力对照表、File 编辑器窗格、Diff 视图。
- uniroute.app《Claude Code in Terminal vs Desktop App》：Code 页签与 CLI 的逐项对照。

**天枢**
- huiliyi37/Tianshu-harness 官方仓库 docs/desktop-guide.md（桌面端用户指南）：功能面板（Mission Control/Inbox/Automations/Skills/Git/Changes/Delegation/Cockpit）、集成终端（xterm.js + Rust portable-pty）、@file 预览、Cockpit 8 tab、SideChat、Rewind、GoalBar、JobsDock/TodoDock。
- widechaos.cn《天枢使用文档》（第三方文档站，非官方）：左侧栏、文件树、阅读模式、差异查看、桌面 Chromium。
- ~/workspace/tianshu-research/tianshu-4.0.4-拆包研究报告.md（2026-11-13）：包结构、rivet-runtime、插件清单。

**Tauri 技术路线**
- docs.rs（tauri crate 文档）：`unstable` feature 开 multiwebview API；`Window::add_child`（desktop + unstable）；`WebviewBuilder::data_directory`（稳定）；Windows 同步命令创建 webview 会死锁，需异步命令。
- TED-H-com/multi-ai-chat-desktop 的 tauri-feasibility.md：多 webview 可行性验证（API 真实、unstable、原生层需手动定位/显隐/resize）。
- Kortex kortex-os 的 browser_b1_preflight_report.md：对 tauri 2.11.5 源码的核实（add_child 存在、feature 门、data_directory 稳定、with_webview 可拿原生 WebView2）。

**卡塞尔现状**
- `~/workspace/cassell-agent/app/src/components/RightPanel.tsx`（2026-11-13 直接读代码）：6 个页签、DiffView 纯文本着色（400 行上限）、Files 纯文本预览（2000 行上限）、Terminal 单行输入、Browser 调 `openUrl` 跳系统浏览器。
- `~/workspace/cassell-agent/app/src/App.tsx`：Inspector 为 fixed 浮层（360px/宽版 480px），默认不常驻。

**仍未证实**
- Codex Files 面板是否支持语法高亮、搜索：指南只写了"快速打开文件"，高亮与搜索未证实。
- Claude File 窗格在云端会话里是否可编辑：资料只确认 Local/SSH 支持。
- 天枢 Changes 面板的具体交互（是否支持逐行评论、并排）：官方文档只写了面板名，未证实。
- 天枢插件/MCP 的安装流程：未证实。
