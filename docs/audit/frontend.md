# 卡塞尔专员终端 · 前端架构只读审计

- 审计日期：2026-11-14
- 仓库：`D:\卡塞尔学院\repo`，分支 `engine/v2`
- 审计范围：`app/src`（React 19 + Vite 8 + Tauri 2 前端），对照 `app/src-tauri` 的事件与命令边界
- 审计性质：**只读**。本次唯一写入是本文件；没有改代码、配置或其他文档

---

## 0. 结论先行

1. **前端不是"一个页面"，是四层叠起来的一张网**：`App.tsx` 一个 4071 行的组件同时持有全部状态、全部事件监听、全部消息渲染和 533 行内联 CSS；`App.css` 又有 2662 行。真正的问题是**没有模块边界**，不是某个 bug。
2. **最贵的不是渲染，是持久化**：每收到一个流式增量就把**整个任务列表**（含全文、思考全文、工具结果）`JSON.stringify` 后写进 localStorage（`App.tsx:1656`）。一次长回答 = 几百次全量序列化 + 同步磁盘写。
3. **有一个会写错数据的真实缺陷**：事件回调用的是"当前选中任务"的 ref（`App.tsx:1969`），而这一轮跑的是另一个 taskId（`App.tsx:2302`）。**运行中切任务，工具卡会落到别的会话里**，正文增量则静默丢失。
4. **工具卡的信息来自"反向解析展示文本"**：参数被截到 200 字符再 `JSON.parse`（`App.tsx:2060-2068`），`write_file` 这种长参数必然解析失败 → 卡片只显示"调用工具 write_file"，路径显示"—"。这是结构问题，不是样式问题。
5. **启动包白扛 1.18MB**：`sealTargets.ts` 三万条粒子布点被 `Boot.tsx:3` 静态 import，即使"启动动画"关掉（`App.tsx:1627`）也照样进主 chunk。构建产物是**单个 1736 KB JS + 41 KB CSS**（`app/dist/assets`），没有任何代码分割。
6. **前端零测试、零 lint 配置**（`app/` 下没有 `.test.*`、没有 eslint/prettier），而后端有 87 个 `#[test]`。任何"顺手重构"现在都是无网走钢丝。
7. **视觉层是冻结区**：三栏结构、标题栏高度、侧栏 232px、对话区 760px、Inspector 360/480/720、四段内联 CSS、球与仪式的动画参数，未经明确授权都不能动。可以做的是**内部拆分**（拆文件、拆 hook、拆状态），只要不改 DOM 结构和 class 名。

---

## 1. 证据边界（先说清楚我看了什么、没看什么）

### 1.1 逐行读完

| 文件 | 行数 | 说明 |
|---|---|---|
| `app/src/App.tsx` | 4071 | 全文分 6 段读完 |
| `app/src/types.ts` | 338 | 全部类型与常量 |
| `app/src/components/commands.ts` | 335 | 命令注册表 |
| `app/src/components/diffUtils.ts` | 153 | 统一 diff 解析 |
| `app/src/components/GoalCard.tsx` | 185 | 目标卡 |
| `app/src/components/TerminalPane.tsx` | 160 | xterm + PTY |
| `app/src/components/BrowserPane.tsx` | 266 | 子 webview |
| `app/src/components/Mark.tsx` | 317 | 球的渲染层 |
| `app/src/components/Sidebar.tsx` | 463 | 侧栏 |
| `app/src/components/Composer.tsx` | 779 | 输入区 |
| `app/src/components/ConnectWizard.tsx` | 337 | 三步连接向导 |
| `app/src/lib/events.ts` | 118 | Codex CLI JSONL 解析（当前无引用） |
| `app/src/main.tsx`、`platform.ts`、`index.html`、`package.json`、`vite.config.ts` | — | 启动与构建 |

### 1.2 结构与关键段落读完（未逐行）

| 文件 | 行数 | 读到什么 |
|---|---|---|
| `app/src/components/RightPanel.tsx` | 1475 | props 全量、diff 加载/提交/文件浏览/预览/六个页签的渲染段；`DiffView` 内部逐行评论细节为抽样 |
| `app/src/components/Drawers.tsx` | 1435 | 四个导出的浮层 + 设置五组导航 + 权限/外观/用量全文段 |
| `app/src/components/Boot.tsx` | 1352 | 阶段常量、计时器、粒子画布（初始化/每帧/循环）、渲染入口 |
| `app/src/components/mark/useBallEngine.ts` | 1346 | tick 循环、订阅、`useBallEngine` 主体、`setPose` 位置、仪式与 spin effect |
| `app/src/components/TitleBar.tsx` | 230 | props、最大化状态同步、拖拽约定 |
| `app/src/App.css` | 2662 | 令牌层、主题两层过渡、布局、按钮、聊天区、输入区、媒体查询 |
| `docs/成品蓝图_v1.0.md` | — | 前端相关验收条目（P0-5/P0-9/P0-11 等） |
| `app/src-tauri/src/agent.rs`、`engine/tool_pipeline.rs` | 69KB / 18KB | `run_agent_native` 入口、history 拼装、`agent-*` 事件发射点、审批 180s 超时 |

### 1.3 明确没做

- 没有启动应用、没有真机点击走查、**没有实测帧率**。所有"性能"结论来自代码结构 + 构建产物体积（`app/dist/assets/index-2lyEm-by.js` = 1736 KB）。
- 没有读 `app/mockup/`、`app/lore/`、`app/tools/`、`app/src/components/mark/expressions.ts` 的完整参数表。
- `App.css` 未逐行（按令牌/布局/组件块抽样），`RightPanel.DiffView` 的并排渲染细节为抽样。
- 不涉及 Rust 引擎内部逻辑的评审（那是另一份审计的事）；本文只用到"事件名、payload、命令签名"这一层。

---

## 2. 组件与状态地图

### 2.1 一张表看全

| 组件 | 行数 | 职责 | 关键 props | 关键内部状态 | 与 App 的耦合点 |
|---|---|---|---|---|---|
| `App` | 4071 | 全部业务状态、事件监听、消息渲染、浮层编排 | — | 31 个 `useState`、22 个 `useRef`、27 个 `useEffect`、31 个 `useCallback` | 它是所有东西的父节点 |
| `Boot` | 1352 | 开机七段仪式（粒子校徽 + 认证门） | `onDone` | `phase`/`exiting`/`sealGone`/`canvasGone`/`connected`/`logCount` | `App.tsx:3361` 按 `settings.boot_animation` 决定挂载；`onDone` → `handleBootDone`（`App.tsx:1331`） |
| `TitleBar` | 230 | 40px 自绘标题栏、拖拽区、窗口按钮、模式切换 | `mode`/`onModeChange`/`markState`/`gaze`/`ritual` | `maximized`、`winApi` | 模式切换只调 `App.handleModeChange`（`App.tsx:1817`），自己不碰 settings |
| `Sidebar` | 463 | 名册（诺玛/EVA）、新建任务、搜索入口、项目组、最近任务、身份卡 + 三个图标入口 | 18 个 props（`Sidebar.tsx:7-38`） | `editingId`/`editTitle`/`confirmDeleteId`/`editingProjectId`/`editProjectName` | 只读 `tasks`/`projects`，动作全部回调给 App |
| `Composer` | 779 | 输入框、附件、权限/模式/模型三组弹出层、执行/计划、目标开关、斜杠命令面板 | 14 个 props（`Composer.tsx:17-40`） | `text`/`popover`/`popClosing`/`focused`/`attachments`/`attachDir`/`attachFiles`/`attachFilter`/`customModel`/`modelLevel`/`slashIdx` | 发送走 `onSend`（App `handleSend`），配置改动走 `onPatch`（App `patchSettings`） |
| `GoalCard` | 185 | 目标进度条、清单、改过的文件、检查点与三种倒带 | `goal`/`running`/`showCheckpoints`/`onToggleCheckpoints`/`onResume`/`onEnd`/`onRewind` | 无（纯展示） | 挂在消息流顶部（`App.tsx:3551`），动作回到 App（`resumeGoal`/`endGoal`/`rewindGoal`） |
| `RightPanel`（Inspector） | 1475 | 六页签：审查/终端/文件/浏览器/插件/工作流 | 27 个 props（`RightPanel.tsx:38-93`） | `diffOpen`/`diffs`/`rejectStaged`/`commitMsg`/`commitBusy`/`commitNote`/`dir`/`entries`/`preview`/`imgData`/`modified`/`shownLines` | 审查状态与动作由 App 持有（`review`/`handleAcceptAll`/`doRevertFile`…），面板只负责呈现与两步确认 |
| `DiffView`（内部） | ~380 | 统一/并排 diff、逐行评论、hunk 折叠 | `text`/`filePath`/`panelWidth`/`onSendToAgent` | 由 `RightPanel` 传入；评论持久化在 `localStorage`（`RightPanel.tsx:130`） | `onSendToAgent` → App `handleSend` |
| `TerminalPane` | 160 | xterm.js 渲染 + 键盘 + 快照回放 | `sessionId`/`workdir` | `ready`、`termRef` | `sessionId` = 当前 taskId（`App.tsx:3923`） |
| `BrowserPane` | 266 | 地址栏/前进后退/刷新 + 原生子 webview 的几何同步 | `requested`/`onRequestedConsumed`/`covered` | `url`/`loading`/`hasPage` | `agent-open-browser` 事件 → `App.tsx:2152` → `browserRequest` prop |
| `Mark` + `useBallEngine` | 317 + 1346 | 球的生命体渲染与运动引擎 | `size`/`eva`/`state`/`gaze`/`fast`/`ritual`/`ringGap` | 引擎状态在 `eng.current`（`useBallEngine.ts:520`），每帧 `setPose`（`:792`） | App 的 `markState`/`gaze`/`ritual` 驱动全部球实例 |
| `Drawers` | 1435 | `SettingsModal`/`CommandPalette`/`ArchiveDrawer`/`HelpDrawer`/`UsageDrawer` + `DrawerShell` | 各自 props 见 §2.3 | 见 §2.3 | 全部由 App 的 `drawer`/`paletteOpen` 控制 |
| `ConnectWizard` | 337 | 选服务商 → 粘 Key → 测连通 → 拉模型 | `settings`/`onPatch`/`onTestConnection`/`onFetchModels`/`onClose`/`closing`/`onOpenSettings` | `step`/`selId`/`key`/`baseUrl`/`kind`/`showKey`/`testing`/`testRes`/`fetching`/`fetchRes` | 只在没配 Key 时由空态 CTA / gate 提示打开（`App.tsx:1390`） |
| `commands.ts` | 335 | Cmd-K 与 `/` 共用的命令注册表 | `CommandContext`（`commands.ts:19-50`） | 无状态 | App 传 25 个上下文动作进去（`App.tsx:3317-3353`） |
| `diffUtils.ts` | 153 | 解析 `git diff` 文本、并排配对、行定位键 | — | — | `RightPanel` 使用 |
| `lib/events.ts` | 118 | Codex CLI `--json` 行解析 | — | — | **当前无人引用（死代码）** |

### 2.2 App 的状态清单（31 个 useState）

分组看，它们其实只属于 7 个域。**这就是该拆的地方**（拆的时候不改 DOM，只搬状态）。

| 域 | 状态 | 位置 |
|---|---|---|
| 启动/壳 | `settings`、`boot`、`showShell` | `1322-1335` |
| 数据 | `tasks`、`projects`、`activeProjectId`、`activeTaskId` | `1336-1342` |
| 运行 | `running`、`markState`、`gaze`、`ritual`、`modeLine`、`runMode`(+ref)、`goalMode`(+ref)、`focusNonce` | `1343-1431` |
| 审查 | `review`、`reviewError`、`merge`、`pendingDelete`、`deliverablesByTask` | `1349-1429` |
| 浮层 | `drawer`、`inspector`、`inspectorWidth`、`paletteOpen`、`settingsNav`、`notice`、`wizardOpen`、`browserRequest`、`showCheckpoints` | `1352-1423` |
| 主题/外观 | `systemDark` | `1379` |
| 输入/提示 | `gateNotice`、`editingMsgId`、`editText`、`confirmDeleteMsgId`、`usageOverview`、`usageLoading`、`testing`、`testResult`、`codexInfo`、`showJump`、`hasNewMsg`、`authorizedDirs` | `1355-1448` |

**Ref 镜像模式**：`settingsRef/tasksRef/activeTaskIdRef/runningRef/projectsRef/activeProjectIdRef` 在每次渲染时直接赋值（`App.tsx:1480-1485`）。这是为了绕开闭包过期，属于可接受的临时手段，但它让"数据流"变成双向（state → ref → 事件回调 → state），也是 §5 P0-2 那个写错任务缺陷的根。

### 2.3 各组件职责细节（含耦合点）

#### Boot（`Boot.tsx:119`）

- 七段舞台由 `phase` 状态推进，`STAGE_MS=950`（`:66`），`exiting` 每段 950ms（`:196`）。
- 粒子段是**真 canvas**：`initParticles()`（`:400-523`）把 `SEAL_TARGETS.slice(0, N_CREST)` 转成三维目标点，再生成 3000 颗背景星（`:448`）；`drawParticles()`（`:545-642`）每帧 `ctx.drawImage` 逐粒子绘制，hero 粒子再叠一层 bloom（`:634-638`）；`loop` 用 `requestAnimationFrame`（`:644-657`）。
- 时间轴：成型 2.2–4.8s、锁定闪 4.8s、开始散开 6.5–8.0s（`:551-559`），`sealGone=6500ms`/`canvasGone=8000ms`（`:261-262`）。
- 耦合点：`App.tsx:3361` 只在 `boot && settings.boot_animation` 时挂载；`handleBootDone`（`App.tsx:1331`）先开壳再 150ms 卸 Boot，做交叉淡化。
- **性能事实**：布点表 30,000 条，但只用前 `N_CREST = 20000` 条（`Boot.tsx:386`、`:463`）→ 单帧最多 **20,000 次 `drawImage`**，外加 3,000 颗背景星（`:448`、`:580-590`）。这是开机一次性开销（约 8 秒），不常驻，但它是主 chunk 体积的主要来源。

#### Sidebar（`Sidebar.tsx:79`）

- 名册两项写死（`:126-151`），`norma`/`eva` 的副标题与状态点按 `mode`/`running` 推导；文案明确只说"工作中"，不说"并行中"（`:147`）。
- 任务列表只显示当前项目未归档任务（`:110-112`）；项目组与"最近"按模式换序（`norma` 最近在上，`eva` 项目在上，`:378-388`）。
- 重命名/删除都在本地状态里做两步确认（`:114-124`、`:257-297`）。
- 身份卡是纯展示（`:392-460`），三个图标入口回调 `onOpenDrawer`。
- 耦合点：**没有 running 的任务行标记**——侧栏看不到"哪个任务在跑"，只有名册和身份卡有状态点。

#### Composer（`Composer.tsx:51`）

- 输入框自增高到 184px 后内部滚动（`:93-98`）。
- 发送：`send()`（`:155-163`）→ `onSend` 返回 `false` 时**保留文字**（未配 Key 的拦截路径）。
- 三个弹出层 `model`/`perm`/`attach` + `mode`，关闭统一走 150ms 退场（`:180-189`）。
- 斜杠面板复用命令注册表（`:232-240`），只取前 8 条，方向键/回车/Esc 处理在 `onKeyDown`（`:329-357`）。
- 附件：`list_files` 拉目录（`:127-140`），选中只记**路径**（`:752-757`）；发送时被拼进 prompt 文本（`App.tsx:2602-2605`）。
- 耦合点：`settings` 全量传入（`App.tsx:3868`），任何设置改动都会重渲染 Composer；`markState`/`runMode`/`goalMode`/`focusNonce` 都是 App 的状态。

#### RightPanel / Inspector（`RightPanel.tsx:571`）

- 六页签常量 `VIEWS`（`:95-102`）；`review` 页签按模式改名为"交付/审查"（`:874`）。
- 审查：`loadDiff`（`:622-691`）——未追踪文件读全文合成 diff（`:631-658`），已追踪文件走 `run_shell("git diff HEAD -- <path>")`（`:660-663`）；用 `workdirRef` 丢弃跨工作区的迟到响应（`:636`）。
- 拒绝是两步：先 `rejectStaged` 本地标记（`:613`），"确认还原"才调 `onRejectFile`（`:693-697`），因为 App 那边会立刻 `revert_file` 不可逆（`App.tsx:2250-2261`）。
- 提交：`commit_files`（`:707-724`），只提交 `state==="approved"` 的文件（`:700-702`）。
- 文件页：`list_files` + `git status --porcelain -z` 求"已修改"集合（`:737-775`），换工作区清空 diff 缓存（`:777-783`），预览 300 行分页（`:104`、`:1264-1286`），图片走 `read_file_base64`（`:811`）。
- 插件页：**明确写"全部未接入"**，开关 `disabled`（`:1304-1371`）。
- 工作流页：只有任务名/状态/工具名列表/累计用量，"每步耗时"直接标注"未接入"（`:1401-1448`）。
- 耦合点：审查真状态在 App；面板只是视图 + 两步确认。

#### Drawers（`Drawers.tsx`）

- `DrawerShell`（`:69`）：右侧滑出 + Esc 监听 + `closing` 退场类。
- `SettingsModal`（`:137`）：五组左导航 `specialist/model/workstyle/permissions/appearance`（`:313-325`）；"查看中的服务商"与"生效服务商"分离（`:177-193`），避免点一下列表就切生效商；权限组有"守夜人模式"三档一键预设（`:749-784`）、审批三档、删除确认两档、沙箱三档，并**显式标注 NORMA 收紧规则**（`:822-827`、`:875-881`）。
- `CommandPalette`（`:973`）：输入过滤 + 上下键 + 回车执行（`:998-1001`），数据来自 App 的 `paletteItems`。
- `ArchiveDrawer`（`:1092`）/`HelpDrawer`（`:1188`）/`UsageDrawer`（`:1338`）：档案搜索+彻底删除、帮助与快捷键、用量四档。
- 耦合点：除用量总览（App `loadUsageOverview`，`App.tsx:1435`）外全部是纯展示 + `onPatch`。

#### Mark + useBallEngine

- `Mark` 只是渲染层（`Mark.tsx:61-310`）：球体、两只药丸眼、球面投影 `projectEye`（`:124-132`）、核验环（`:208-240`）、思考环带（`:242-271`）。眼神/呼吸/抖动全部来自 `pose`。
- `useBallEngine` 有一套**共享全局 tick**：`tickSubs` + `tickLoop`（`useBallEngine.ts:151-176`），所有球共用一个 rAF；`ensureTicking()` 只在有运动时订阅（`:557-566`），`setPose` 每帧写一次组件状态（`:792`）。
- 因为 `pose` 是 `Mark` 的局部 state，每帧重渲染的只是这颗球的小树，**不是整个 App**——这一点设计是对的（与 §5 P1-2 的 App 级 `gaze` 计时器不同）。
- `prefers-reduced-motion` 在引擎层（`:497-499`）、渲染层（`Mark.tsx:250`、`:287`）、CSS 层（`App.css:568`、`1392`、`2292`、`App.tsx:197`、`354`、`448`、`534`）都有兜底，四层都做了。
- 耦合点：`ritual` 由 App `handleModeChange` 派发（`App.tsx:1849`），1350ms 后清空（`:1851-1854`）；`gaze` 由 App 定时器驱动（`:1932-1948`）。

#### TitleBar（`TitleBar.tsx:32`）

- 40px 自绘标题栏；整条拖拽区用 `data-tauri-drag-region="deep"`，模式切换器与窗口按钮显式 `false`（`:20-27` 注释即契约）。
- 最大化状态在 `resize` 时重读（`:52-74`），双击标题栏交给 Tauri `drag.js`（`:25-27`），不重复挂 `onDoubleClick`。
- 耦合点：模式切换只调 `onModeChange`，不自己改 settings。

#### TerminalPane / BrowserPane

- 终端：`pty_spawn` 幂等（切页签不丢 shell）→ `pty_snapshot` 回放历史 → **快照写完才接 `pty-output` 直播**（`TerminalPane.tsx:71-99`，避免重复写同一行）；`ResizeObserver` → `pty_resize`（`:107-110`）；卸载只 `dispose()` 本地 xterm，不杀 PTY。
- 浏览器：原生子 webview 不参与 DOM 层叠，位置/显隐全部手工同步（`BrowserPane.tsx:47-64`、`:169-185`）；入口动画期间补 4 次对齐（`:131-143`）；`covered` 为真时先 `browser_hide`（`:118-127`），否则原生层会盖住抽屉/命令面板。
- 两者都以"当前 taskId"为会话键（`App.tsx:3923`）——切任务即切终端，符合 P0-11④ 的设计。

#### commands.ts / diffUtils.ts

- 命令注册表分 8 组：任务 → 项目 → 模式 → 设置 → 审查 → 外观 → 系统 → 危险操作（`commands.ts:129-282`）；`危险操作` 单列垫底是刻意的（`:269-271`）。
- 命令面板与斜杠面板**共用同一份注册表**（`getCommands`，`:331-335`），任务跳转是动态命令，搜标题+项目名+首条用户消息（`:294-316`）。
- `parseUnifiedDiff`（`diffUtils.ts:31-99`）对元信息行跳过、对无 `@@` 头的行自建 hunk（`:64-70`）、对 `\ No newline` 跳过（`:86-88`）；`sideBySideRows`（`:110-143`）把连续 del + 后随 add 按序配对。

---

## 3. 数据流

### 3.1 一次"发送"到底发生了什么

```
[Composer] 用户回车
  └─ send()                                  Composer.tsx:155
      └─ onSend(body, attachments)           → App.handleSend
          ├─ 无 Key → setGateNotice 并 return false        App.tsx:2549-2561
          ├─ running → return false                        App.tsx:2548
          ├─ 无 activeTask → 建 Task（项目归属、模式绑定、模式自我介绍）  App.tsx:2564-2600
          ├─ attachments 拼进 prompt 文本                  App.tsx:2602-2605
          ├─ 同步插入 userMsg / evaNote / assistantMsg(streaming)     App.tsx:2607-2636
          ├─ 设 streamMsgIdRef / running / markState / runStartRef     App.tsx:2638-2646
          └─ requestAnimationFrame(() => runTurn(...))      App.tsx:2648-2650
```

`requestAnimationFrame` 这一层是刻意的：**先让用户气泡上屏**，再启动后端，输入路径上不能有阻塞（`App.tsx:2540-2543` 注释）。

### 3.2 runTurn：一轮的完整生命周期（`App.tsx:2302-2538`）

```
读 ref（settings/runMode/authorized/task）                      2310-2326
目标上下文判定：续跑 / 新立目标 / 不立目标                       2319-2326
新目标先写乐观 GoalState（rounds_budget:40）                    2327-2345
历史拼装：最近 10 条、只取 user 与"无 kind 的 assistant 纯文本"  2346-2360
invoke("run_agent_native", { req: {...} })                     2362-2393
  ├─ 成功后：goalId 存在 → list_checkpoints_cmd 回填检查点       2396-2411
  │            目标终态 → 关掉目标开关                          2412-2419
  ├─ 写回：goal 摘要 + think 收尾 + assistant 文本/usage/plan/limitNotice  2421-2492
  ├─ 球：cancelled→stopped / 成功→done（>60s 用 long-task-done）   2493-2505
  ├─ refreshReview()                                           2506
  ├─ catch：把气泡改成 kind:"error" + "启动失败：…"              2507-2529
  └─ finally：清三个 msgIdRef、setRunning(false)                 2530-2535
```

### 3.3 事件流：后端 → 前端 → 消息

全部 7 个监听注册在同一个 `useEffect`（`App.tsx:2003-2163`），依赖 `[pushMsg, insertThinkMsg, updateMsgText]` 三个稳定回调，卸载时逐个 `unlisten`（`:2159-2162`）。

| 事件 | 后端发射点 | 前端处理 | 落到哪 |
|---|---|---|---|
| `agent-delta` | `agent.rs:547`（每个 SSE chunk） | 追加到 `streamMsgIdRef` 指向的气泡（`App.tsx:2015-2020`） | 当前任务最后一条 assistant |
| `agent-thinking` | `agent.rs:540` | 首段到达时**新建 think 消息并插到流式气泡前面**（`App.tsx:2023-2040`，`insertThinkMsg` `:1979`） | 独立 `kind:"think"` 卡片 |
| `agent-tool` | `agent.rs:661` | 新建 `kind:"tool"` 消息，正文 = `调用工具：name（args JSON 前 200 字）`（`App.tsx:2043-2074`） | 记 `lastToolMsgIdRef` |
| `agent-tool-result` | `agent.rs:708-711` | 追加 `\n→ 结果前 400 字…（已截断）`（`App.tsx:2077-2105`）；`write_file` 成功顺带记交付物（`:2086-2103`） | 同一条工具消息 |
| `agent-approval-request` | `tool_pipeline.rs:40-43` | 追加 `kind:"perm"` + `requestId`（`App.tsx:2110-2126`） | 审批卡，按钮调 `resolve_approval`（`:3200`） |
| `agent-goal-progress` | `agent.rs:1121/1145/1211` | 仅当 `payload.id === 当前 activeTaskId` 时更新 `task.goal`（`App.tsx:2131-2148`） | 目标卡实时刷新 |
| `agent-open-browser` | `tool_pipeline.rs:384` | 切到 Inspector 浏览器页并下发 URL（`App.tsx:2152-2157`） | BrowserPane |
| `agent-event` / `agent-log`（Codex CLI 通道） | `codex.rs:260/272` | **前端无监听**（只有 `lib/events.ts` 那个解析器，且无人引用） | — |

事件 → 消息的三条写入原语：

- `updateMsgText(id, fn)`（`App.tsx:1951-1966`）：按 **id** 找气泡改文本，不依赖"最后一条"。
- `pushMsg(msg)`（`:1968-1976`）：追加到当前任务。
- `insertThinkMsg(msg)`（`:1979-1997`）：插到流式气泡之前。

> 三个原语都读 `activeTaskIdRef.current`，而不是"本轮 taskId"。这就是 §5 P0-2 的根因。

### 3.4 消息 → 任务 → localStorage

```
setTasks(...)  (任何写入)
  └─ useEffect([tasks])                                  App.tsx:1656-1662
      └─ localStorage.setItem("cassell.tasks.v1", JSON.stringify(tasks))
          └─ 失败静默 catch（配额满 = 用户以为存了，其实没存）
```

持久化清单（7 个 key）：

| key | 写入方 | 时机 |
|---|---|---|
| `cassell.tasks.v1` | `App.tsx:1658` | **每次 tasks 变化**（含每个流式增量） |
| `cassell.projects.v1` | `App.tsx:1667` | projects 变化 |
| `cassell.active-project.v1` | `App.tsx:1676/1678` | 当前项目变化 |
| `cassell.inspector-width.v1` | `App.tsx:1687` | 宽度三档切换 |
| `cassell.theme` | `App.tsx:1590` | 主题变化（仅镜像，事实来源是 Rust 设置文件） |
| `cassell-diff-comments-v1` | `RightPanel.tsx:144-150` | 逐行评论变化 |
| `cassell-diff-mode` | `RightPanel.tsx:204` 附近 | 统一/并排切换 |

Settings 不走 localStorage：`patchSettings` 防抖 400ms 后 `invoke("save_settings")`（`App.tsx:1694-1704`），存档在 Rust 侧。

### 3.5 跨轮上下文：现在的"记忆"有多短

- 前端只取 **最近 10 条**，且只收 `role==="user"` 或 `role==="assistant" && !m.kind` 的**纯文本**（`App.tsx:2346-2360`）——工具调用、工具结果、思考过程**全部不进下一轮历史**。
- 后端再 `take(20)` 兜一层（`agent.rs:882-886`）。
- 也就是说：**跨轮记忆 = 10 条纯文本**。同一轮内的 8 轮工具循环是完整上下文（`agent.goal` 循环里 tool 消息会 push 进 messages，`agent.rs:718-722`），但一轮结束后就断了。
- 目标模式（goal）是例外：会话缓存在 `state.goals` 里，续跑带完整上下文（`agent.rs:895-914`）。

### 3.6 项目 / 工作区 / 授权的三件套

- 一个项目 = 一个文件夹（`Project{id,name,path}`，`types.ts:185-189`）。
- **`settings.workdir` 是"当前项目路径"的镜像**：切项目 = `patchSettings({workdir})`，审查/终端/文件/引擎全部读它（`App.tsx:3093-3106` 注释即契约）。
- 授权是**会话级内存 Set**（`App.tsx:1409`），不持久化；选文件夹/换目录就授权（`:3082-3088`）；未授权时 Composer 上方有常驻提示（`:3832-3866`）。
- 首次升级迁移逻辑在 `projectSeededRef` 那段（`:1734-1777`），只跑一次。

---

## 4. 功能状态表（按代码判，不按注释判）

判定口径：

- **已实现** = 前端有交互、后端有命令/事件、有真实数据来源，端到端闭环。
- **部分实现** = 链路通但关键能力缺失，或只在内存/单会话有效，或文案自己承认"未接入"。
- **占位未接入** = 有 UI 或类型，但没有真实行为（开关禁用、命令没被调用、字段没人读）。

### 4.1 已实现

| 功能 | 前端证据 | 后端证据 |
|---|---|---|
| 任务 CRUD + 归档/恢复/彻底删除 + 重命名 | `App.tsx:2789-2798`、`:2960-2973`、`Sidebar.tsx:114-312` | 纯前端数据 |
| 项目 CRUD + 切换 + 目录绑定 | `App.tsx:3093-3143`、`Sidebar.tsx:155-216` | `pick_folder` 命令 |
| localStorage 持久化（任务/项目/宽度） | `App.tsx:1656-1691` | — |
| 发送 → 原生引擎 → 流式正文/思考/工具/结果 | `App.tsx:2545-2654`、`:2003-2163` | `run_agent_native`、`agent-delta/thinking/tool/tool-result` |
| 取消运行（含把流式气泡标记"已停止"） | `App.tsx:2656-2678` | `cancel_run` |
| 真审批卡（批准/拒绝/稍后=拒绝，决定后不可撤销） | `App.tsx:1122-1236`、`:3200-3204` | `agent-approval-request` + `resolve_approval`，180s 超时按拒绝（`tool_pipeline.rs:44-53`） |
| 审查队列：逐文件通过/拒绝（两步）、统一/并排 diff、逐行评论 | `RightPanel.tsx:885-1183`、`DiffView` | `get_review`、`revert_file`、`run_shell(git diff)` |
| 提交已通过文件 | `RightPanel.tsx:699-724` | `commit_files`（git add + commit，不拼 shell） |
| 文件浏览 + 文本高亮预览 + 图片预览 + 已修改标记 | `RightPanel.tsx:737-827`、`:1189-1294` | `list_files`、`read_file`、`read_file_base64` |
| 真 PTY 终端（每任务一个，快照回放） | `TerminalPane.tsx:30-121` | `pty_spawn/write/resize/snapshot`、`pty-output/exited` |
| 内置浏览器（原生子 webview，位置/显隐同步） | `BrowserPane.tsx:37-266` | `browser_open/show/hide/set_rect/back/forward/reload/current/close` |
| 目标模式：进度/清单/改过文件/三种倒带 | `GoalCard.tsx:13-185`、`App.tsx:2683-2785` | `agent-goal-progress`、`list_checkpoints_cmd`、`rewind_checkpoint_cmd`、`clear_goal_cmd` |
| 计划模式：产出方案 + "确认执行/修改方案" | `App.tsx:2454-2460`、`:3207-3241`、`:3744-3763` | `run_mode: "plan"` 由引擎限制工具面 |
| 用量：每条回复 usage + 本对话累计 + 今日/7天/30天/本次启动 | `App.tsx:3283-3294`、`Drawers.tsx:1338-1434` | `get_usage_stats` |
| 命令面板 Cmd-K + 斜杠命令（同一注册表） | `commands.ts:331`、`App.tsx:3317-3353`、`Composer.tsx:232-319` | — |
| 消息操作：复制/重试/编辑重发/删除（两步确认） | `App.tsx:2839-2957`、`:3605-3649`、`:3709-3741` | 走同一条 `run_agent_native` |
| 设置：五组（专员/模型/工作方式/权限/外观） | `Drawers.tsx:137-967` | `save_settings`、`test_provider`、`list_models` |
| 连接向导（错误翻译成人话） | `ConnectWizard.tsx:11-30`、`:48-337` | 同上 |
| 主题三态 + View Transition 圆形揭示 + 全站颜色交叉淡化 | `App.tsx:1493-1597`、`App.css:115-152` | 主题偏好在设置文件 |
| 模式切换仪式（1350ms 分拍，防重入） | `App.tsx:1801-1857`、`App.tsx:290-354` CSS | — |
| 球的 14 态生命体 + 凝视 + 眨眼 + 仪式包络 | `Mark.tsx`、`useBallEngine.ts` | — |
| 开机仪式（七段 + 粒子校徽） | `Boot.tsx:119-1352` | — |

### 4.2 部分实现（链路通，能力缺）

| 功能 | 现状 | 证据 | 差什么 |
|---|---|---|---|
| Ultracode | 开关只做透传与文案，引擎仍是单智能体循环 | `Composer.tsx:454-481`、`App.tsx:2374`、`EvaNote` `:679-681`、`RightPanel.tsx:1377/1396` | 无并行子代理编排、无每路状态/进度 |
| 工作流页 | 只有任务名、工具名列表、累计用量 | `RightPanel.tsx:1401-1468` | 无分步耗时（自己标注"未接入"）、无每路 token |
| NORMA 交付页 | 交付物只在内存里按任务记，刷新即失 | `App.tsx:1425-1427`、`:2086-2103`、`:3930` | 没持久化到 Task / 没并入审查数据 |
| 附件 | 只把路径拼进 prompt 文本 | `App.tsx:2602-2605`、`Composer.tsx:752-757` | 不读文件内容、不走多模态、界面没说明"只是路径" |
| 计划模式识别 | 靠 `## 目标` + `## 步骤` 字符串判断 | `App.tsx:2457-2460` | 模型换格式就没按钮（结构性脆弱） |
| 目标卡检查点折叠 | 全局一个 `showCheckpoints`，注释写"按任务记" | `App.tsx:1423`（注释）、`:3555` | 打开 A 的目标，B 也一起展开 |
| 审查 diff 读取 | 每个文件一次 `run_shell` + 字符串拼命令 | `RightPanel.tsx:112-116`、`:660-663` | 无取消、无缓存失效策略、路径含 `"` 会坏 |
| 用量花费 | 用 DeepSeek 官方价目估算，未收录模型显示"—" | `Drawers.tsx:1428-1431` | 换服务商就无价目（诚实但有限） |
| 主题 | `--accent` 等大部分走令牌，但仍有硬编码色 | `App.tsx:497/532`（`#dc2626`）、`:551/557`（`#7c9cc4`）、`:302/304/306`（rgba） | 令牌纪律不完整，浅/深色 danger 色值不一致 |

### 4.3 占位 / 未接入

| 项 | 事实 | 证据 |
|---|---|---|
| 插件页 | 文案直接写"全部未接入"，开关 `disabled`、`opacity .45` | `RightPanel.tsx:1304-1371` |
| MCP 服务器 | 同上，另注"下个版本完成" | `RightPanel.tsx:1340-1369` |
| `browser_screenshot` | 后端命令存在，**前端零调用** | `src-tauri` 有 `pub async fn browser_screenshot`；`app/src` 全库 grep 无引用 |
| `onToggleExtension` | 传进 RightPanel 但面板不用 | `App.tsx:3933-3939`、`RightPanel.tsx:88-92` |
| `lib/events.ts` | Codex CLI JSONL 解析器，**零引用** | `app/src` 全库 grep `parseAgentEvent` 无命中 |
| `Task.status` / `Task.subSessions` / `Task.seed` | 类型存在，无渲染/无写入 | `types.ts:164-167` |
| `agent-event` / `agent-log` 通道 | 后端在发，前端没监听 | `codex.rs:260/272` |
| 上下文压缩 | 命令面板里明确下架（注释），引擎侧有 `compression_model` 字段但前端无入口 | `commands.ts:85-86`、`types.ts:48-49` |

### 4.4 与 docs 验收条目的对照（只列不一致处）

对照 `docs/成品蓝图_v1.0.md` 的前端验收条目，**代码与文档基本一致**，只有三处需要登记：

1. 蓝图 §P0-6 写"检查点列表按任务记"，代码是全局 state（`App.tsx:1423`）。
2. 蓝图 §P0-11③ 浏览器验收含"截图验证后做"（`成品蓝图_v1.0.md:219`），后端已备 `browser_screenshot`，前端未接线 → 该验收项**停在"打开"这一半**。
3. 蓝图要求"没有假数据"（`FRONTEND-PHILOSOPHY.md:9`）：插件/MCP 列表来自 `settings.extensions` 的固定条目并全部标"未接入"，属于**诚实占位**，不违规；但"交付物"和"工作流每步耗时"两处说明文字比实际能力更乐观，建议后续统一口径。

---

## 5. 性能与可维护性风险（P0 / P1 / P2）

### P0（会写错数据、会明显卡、会影响正确性）

**P0-1 · 每个流式增量全量写 localStorage**

- 链路：`agent-delta`（每 chunk）→ `updateMsgText` → `setTasks`（`App.tsx:2015-2020`、`:1951-1966`）→ `useEffect([tasks])` → `JSON.stringify(tasks)` + `setItem`（`App.tsx:1656-1662`）。
- 代价：O(全部消息长度) 的序列化，**每个 chunk 一次**；答一次 3000 字 = 上百次全量序列化 + 同步写。消息越多越慢，是**平方级**体验退化。
- 次生灾害：配额满时 `catch {}` 静默（`:1659-1661`），用户以为历史存住了。
- 修法（不改 DOM）：持久化节流（如 500ms 防抖 + 运行结束时强制 flush）、按任务分片存储、或迁到后端 SQLite/JSONL（引擎侧已有 `journal.rs`）。

**P0-2 · 运行中切任务，工具卡落到别的会话**

- 事件三个原语读 `activeTaskIdRef.current`（`App.tsx:1952`、`:1969`、`:1980`），而这一轮属于 `runTurn` 的 `taskId`（`:2302`）。
- 切任务没有任何保护：`Sidebar` 的 `onSelectTask` 直接 `setActiveTaskId`（`App.tsx:3393`），运行中也能点。
- 后果：`pushMsg` 把工具卡追加到**新选中的任务**；`updateMsgText` 在错误的 task 里找不到 id → 静默丢增量；`handleCancel` 会给**当前任务**所有流式气泡加"（已停止）"（`:2662-2674`）。
- 修法：三个原语改收 `taskId` 参数（`runTurn` 已持有），事件回调闭包捕获本轮 taskId；或运行中禁止切任务并置灰。

**P0-3 · 工具卡靠"反向解析展示文本"，长参数必然坏**

- 写入时 `JSON.stringify(args).slice(0, 200)`（`App.tsx:2060-2068`），展示时用 `indexOf("（")` + `lastIndexOf("）")` 再 `JSON.parse`（`App.tsx:768-778`）。
- `write_file`/`edit_file` 的 args 含正文，几乎必然 > 200 字 → 解析失败 → `args={}` → 卡片退化成"调用工具 write_file"、路径显示"—"（`App.tsx:925-949`）。
- 附带：`running` 判定是 `result === ""`（`App.tsx:970`），**工具返回空结果时卡片永远显示"执行中"**；`ToolGroup` 同样用 `includes("\n→ ")` 判断（`:1069`）。
- 修法：事件 payload 直接带结构化 `args`（后端 `agent-tool` 已经有 `args` 字段！`agent.rs:661`），前端别再从文本反解；`running` 用显式状态位。

### P1（可维护性 / 长会话稳定性 / 首屏）

**P1-1 · 跨轮记忆只有 10 条纯文本**（`App.tsx:2346-2360`，后端 `agent.rs:882-886`）

- 工具结果、思考、被截断的正文都不进历史；长会话早期上下文丢失。
- 与"用户要的是能干活"，以及天枢/Codex 的会话记忆模型差距最大的一条。

**P1-2 · App 级 `gaze` 定时器每 0.9–3.2s 重渲染整棵树**

- `setGaze` 在 `App`（`App.tsx:1932-1948`），`gaze` 传给每一个 `Mark`（消息里每条 assistant 一个）。
- 整个 `app/src` 只用了一处 `useMemo`（`RightPanel.tsx:165`），消息列表是 `messages.map(...)` 内联渲染（`App.tsx:3564`），没有任何 `memo`。
- 30 条消息 + 打开一个工具分组时，每次 tick 都会重算全部节点。
- 修法：`gaze` 下沉到 `Mark` 自己（或 context + `memo`），消息行 `memo` 化（props 稳定后再接）。

**P1-3 · 启动包单块 1.7MB，其中 1.18MB 是开机粒子布点**

- `sealTargets.ts` 30,000 条（`sealTargets.ts:10` 起），被 `Boot.tsx:3` **静态 import**；`App.tsx:33` 又静态 import `Boot` → 无论 `boot_animation` 是否关闭（`App.tsx:1627`）、无论 Boot 是否挂载（`App.tsx:3361`），两块都进主 chunk。
- 构建产物：`app/dist/assets/index-2lyEm-by.js` = **1736 KB** 单文件（xterm + highlight.js/common + 30k 布点 + React）。
- `vite.config.ts` 没有 `build.rollupOptions.manualChunks`。
- 修法（不改视觉）：Boot 里改动态 `import()`；或把布点降到 4–6k（视觉上几乎无差别）+ 走 `fetch` 的静态 JSON；Inspector 的 xterm/hljs 也动态加载。

**P1-4 · 前端零测试、零 lint**

- `app/` 下无 `*.test.*`/`*.spec.*`，`package.json` 无 test/lint 脚本（只有 `dev/build/preview/tauri/app:build`）。
- 后端 87 个 `#[test]`，前端 0 —— 所有回归靠人眼。
- 修法：先给 `diffUtils.ts`、`commands.ts` 的 `matches/getCommands`、`App` 的纯函数式逻辑（历史拼装、limitNotice、plan 识别）补 vitest；这几块无 DOM 依赖，成本低收益高。

**P1-5 · 样式三层叠加，规则重复且互相覆盖**

- `App.css` 2662 行 + `App.tsx` 四段内联 `<style>`（`WAVE2_CSS` `:71-355`、`S7_CSS` `:364-449`、`AUDIT_CSS` `:456-536`、`P011_CSS` `:538-618`，共约 533 行）。
- 重复实例：`.sidebar` 宽 248px（`App.css:301`）被 `App.tsx:72` 改成 232px；`.w2-inspector` 定义两次（`App.tsx:227`、`:544`）；`.main` 的 `margin-right` 过渡写两次（`App.tsx:352`、`:545`）。
- 用 `.app` 前缀提权来压 `App.css`（`App.tsx:66-69` 注释自认），这类"优先级补丁"每加一次就多一层不可预测。
- 修法：**只搬不合并**——把四段内联 CSS 原样搬进独立 `.css` 文件并按 import 顺序保持覆盖关系；class 名一个都不改，零视觉风险。

**P1-6 · 无宽度断点**

- 全项目 `@media` 只有 `prefers-reduced-motion`（`App.css:568/1392/2292`）和 `max-height: 760px`（`App.tsx:332`）。
- 侧栏固定 232/248px、对话区 `max-width: 760px`（`App.css:469`）、Inspector 360/480/720 且 `max-width: 92vw`（`App.tsx:227-229`）。
- 窄窗（<1000px）时 720 档 Inspector + 侧栏会把对话区压到 300px 左右，虽无横向溢出，但可读性塌方。
- 结论：桌面应用可接受，但**要记为已知边界**，不要在小屏机器上做验收。

### P2（体验瑕疵 / 债务）

| 编号 | 问题 | 证据 |
|---|---|---|
| P2-1 | 消息列表无虚拟化、工具分组展开一次性全渲染；Boot 粒子段单帧最多 2 万次 `drawImage`（+3000 星） | `App.tsx:3564`、`:1094-1104`、`Boot.tsx:386`、`:597-639` |
| P2-2 | "在 Inspector 中查看 →"从工具卡跳到**终端**页签，那里是 PTY，不是这条工具的结果；完整结果其实只在后端 journal 里 | `App.tsx:3669`、`RightPanel.tsx:1185-1187` |
| P2-3 | 目标卡折叠状态全局共享（注释与实现不一致） | `App.tsx:1423`、`:3555` |
| P2-4 | NORMA 交付物刷新即失 | `App.tsx:1425`、`:3930` |
| P2-5 | 硬编码颜色绕过令牌（`#dc2626`、`#7c9cc4`、多处 rgba），浅/深色 danger 不一致 | `App.tsx:497/532/551/557/302-306` |
| P2-6 | 死代码：`lib/events.ts` 整文件、`Task.status/subSessions/seed`、未被使用的 `onToggleExtension` | 见 §4.3 |
| P2-7 | 浮层无焦点陷阱、无关闭后焦点归还；Inspector 是 `role="dialog"` 但非模态 | `Drawers.tsx:301-311`、`:1010-1015`、`RightPanel.tsx:836-840` |
| P2-8 | localStorage key 命名不统一（`cassell.*` 与 `cassell-diff-comments-v1`） | `App.tsx:57-63`、`RightPanel.tsx:130-131` |
| P2-9 | 配额/存储失败全部静默 | `App.tsx:1659`、`RightPanel.tsx:147` |
| P2-10 | `attachDir.split(/[\\/]/).slice(0,-1).join("/")` 等手工路径拼接散落多处（Composer / RightPanel / App 各一份），Windows/Unix 行为不一致风险 | `Composer.tsx:740`、`RightPanel.tsx:1201`、`App.tsx:825` |
| P2-11 | `parseToolArgs`/`humanToolSummary` 只认识 4 个工具名，其余一律"调用工具 name"；新增工具不会自动获得人话描述 | `App.tsx:786-810` |
| P2-12 | 通知条 3500ms 单条覆盖，连续操作时前一条丢失（无队列） | `App.tsx:1780-1784` |

---

## 6. 冻结区与可安全拆分的边界

### 6.1 不能动（用户已冻结视觉；未获明确授权一律不改）

依据：`docs/FRONTEND-PHILOSOPHY.md` 九条铁律 + 用户 2026-11-13 明确口径 + 蓝图 `成品蓝图_v1.0.md:331`。

| 类别 | 具体对象 | 证据 |
|---|---|---|
| 布局骨架 | 三栏（侧栏 / 主区 / Inspector 浮层）+ 40px 自绘标题栏；`.w6-shell` 包裹关系 | `App.tsx:3378-3392`、`:337-355` CSS |
| 尺寸 | 侧栏 232px、对话/输入区 760px、Inspector 360/480/720、聊天内边距 24px | `App.tsx:72-75`、`App.css:469`、`:692`、`App.tsx:227-229` |
| 色彩与令牌 | `--bg-rail/--bg-canvas/--bg-panel/--accent…` 全套值、无金色、无 1px 框线、无照片 | `App.css:35-113`、`FRONTEND-PHILOSOPHY.md:2-5` |
| 字体 | Inter + Noto Sans SC、等宽栈、字号梯度 | `App.css:44-47` |
| 动效参数 | 150/180/200/240/260/300/450/550/700/1350ms 各自动画与缓动；`--spring`/`--ease`/`--ease-exp` | `App.css:36-38`、`App.tsx:1331-1334`、`:1278-1319`、`:1817-1857` |
| 球的几何 | 眼中心 39%、眼宽 20%、间距 28%、倾角 14°、核验环、呼吸波形 | `useBallEngine.ts:58-65`、`Mark.tsx:108-186` |
| 开机仪式 | 七段顺序、950ms/段、粒子校徽、纯黑底 | `Boot.tsx:66-67`、`:644-657`、`:666-678` |
| 组件 class 名 | 全部 `.w2-*` / `.s7-*` / `.dv-*` / `.msg*` / `.goal-*` / `.rp-*` | CSS 与 TSX 一对一绑定 |
| 文案口径 | "单智能体、未并行"等诚实措辞；NORMA 收紧规则说明 | `RightPanel.tsx:1311`、`Drawers.tsx:822-827` |

### 6.2 可以安全做（内部拆分，不改 DOM/class/尺寸/动效）

| 动作 | 怎么做 | 风险 |
|---|---|---|
| 把 4 段内联 CSS 搬成 `.css` 文件 | 原样复制，import 顺序保持（晚于 `App.css`），class 名零改动 | 低（可 diff 验证字节一致） |
| 从 `App.tsx` 抽出纯展示组件 | `ToolCard`/`ToolGroup`/`ThinkBlock`/`PermCard`/`ErrorCard`/`EvaNote`/`L1Mark`/`useOverlayExitValue` 已经在文件内定义（`App.tsx:654-1319`），搬到 `components/chat/` 即可 | 低 |
| 抽出事件层 | 把 `App.tsx:2003-2163` 的 7 个监听收进 `useAgentEvents(taskId, handlers)` | 中（顺带修 P0-2） |
| 抽出持久化层 | `useTaskPersistence(tasks)`：节流 + flush + 配额提示 | 中（顺带修 P0-1） |
| 抽出对话运行时 | `runTurn`/`handleSend`/`resumeGoal`/`rewindGoal` 收进 `useConversation()`，状态仍是 App 的，先只搬函数 | 中 |
| 类型化工具事件 | 给 `agent-tool` payload 加 `args: Record<string,unknown>` 透传，`ChatMsg` 增 `toolArgs`/`toolStatus` 字段 | 中（顺带修 P0-3） |
| 拆状态域 | 按 §2.2 的 7 个域拆 context（Task/Project 域优先），先只拆读，再拆写 | 中高，建议分 3 步 |
| 补前端测试 | vitest 覆盖 `diffUtils`、`commands`、历史拼装、plan 判定 | 低 |
| 动态加载重资源 | Boot 的 `SEAL_TARGETS`、RightPanel 的 `highlight.js`、TerminalPane 的 xterm | 中（首帧时序要验） |

**做这些事时的硬约束**：

1. 不改任何可见像素：class 名、DOM 层级、尺寸、颜色、动效时长都不动。
2. 不合并/重写 CSS 规则（只搬家），否则"看起来一样"没有保证。
3. 每次改动跑 `npm run build`（现在唯一的前端门禁）+ 手动过一遍：发送一轮、开 Inspector 六页签、切换模式、切任务。
4. 权限语义（180s 审批超时、NORMA 收紧、删除确认）属于后端契约，前端重构不得顺手改。

---

## 7. 下一步建议（按收益/风险排序，仅供规划，不含实施）

1. **P0-2 修正确性**（最小改动、最高价值）：三个消息原语收 `taskId`；或运行中禁切任务。
2. **P0-1 持久化节流**：500ms 防抖 + 运行结束 flush + 配额失败提示（一次改动，长会话立刻变稳）。
3. **P0-3 结构化工具事件**：后端已经有 `args`，前端停止反解文本；顺带修"空结果永远执行中"。
4. **P1-3 动态加载**：Boot 布点与 xterm/hljs 拆出去，首屏立刻瘦身（视觉零变化）。
5. **P1-5 CSS 搬家**：纯机械动作，为后续所有 UI 改动降风险。
6. **P1-4 测试网**：先覆盖无 DOM 依赖的三块纯逻辑。
7. **P1-1 跨轮记忆**：和引擎侧的会话日志（`journal.rs` + 目标会话缓存）一起做，属于架构级改动，单独排期。

---

## 附：本次审计的自我限制

- 本文所有 `file:line` 均来自本次实际打开的文件；没有引用任何未经打开的内容。
- "已实现/部分实现/占位"的判定以**代码行为**为准：凡是注释里写了但代码里没有的，一律按代码判（例如 `App.tsx:1423` 的"按任务记"）。
- 性能结论是**结构推断 + 产物体积**，不是帧率实测；真正定级前建议在一台目标机器上跑 30 条消息 + 8 个工具分组的会话看一次。
