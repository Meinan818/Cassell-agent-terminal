# 卡塞尔专员终端 · 项目全面审计

审计日期：2026-11-14。基线：`engine/v2` / `a391689`。

## 0. 结论先行

1. **这不是空壳。** 对话、流式输出、DeepSeek 思考参数、DSML 工具恢复、文件读写、精确编辑、真终端、diff 审查、文件查看器、内置浏览器、目标循环、检查点/倒带、用量/缓存面板，代码里都有真实链路，`cargo test` 85/85 通过，前端构建通过。
2. **它也不是“成品”。** P1 的 18 项基本没接；Ultracode、工作流页、插件/MCP 页是诚实占位；压缩、Skills、记忆、worktree、定时任务都还没实现。
3. **最大的问题不是功能少，是地基不稳。** 会话只存在后端内存 + 前端 localStorage；工具结果还是字符串；审批只是单次 `bool`；shell 进程树杀不干净；事件没有 task id，切任务会写错会话；目标快照会把整个工作区（含 `.env`）复制到 AppData。
4. **权限模型骨架对，覆盖面漏。** “沙箱 × 审批”两把 dial、NORMA 收紧、删除确认、180 秒超时都实现得不错；但 `cmd /c rd`、`powershell Remove-Item`、`git clean -xfd` 能绕过删除检测，shell 不受沙箱限制，网络出口没有审批。
5. **前端体验有三处会直接坏数据/坏观感。** 每个流式 chunk 全量 `JSON.stringify` 整个任务列表写 localStorage；运行中切任务会把工具卡写进别的会话；工具卡靠反向解析展示文本，`write_file` 的长参数必然解析失败。
6. **当前分支没有经过 Windows 真机验收。** `engine/v2` 只过了编译和单测；浏览器子 webview、ConPTY 终端、60fps、安装包都还没在当前 HEAD 上跑过。
7. **下一步必须先把“可恢复、可审计、可安全执行”做出来，再谈 P1。** 否则功能越多，越难查、越容易丢数据。

## 1. 产品是什么

- 产品：龙族世界观下的卡塞尔学院专员 AI agent 桌面端，Windows 优先，Tauri 2 + React 19 + TypeScript + Rust。
- 模型：BYOK，OpenAI 兼容 `/chat/completions`，DeepSeek 为主，支持自定义反代；Key 存本地设置文件。
- 两种模式：**NORMA = Claude Cowork**（办公、文档、资料、整理）；**EVA = Claude Code**（工程、代码、终端、测试）。同一套运行时与记忆，任务绑定模式，不中途切换。
- 核心卖点：本地文件授权、可审查 diff、真终端、内置浏览器、目标自动续跑、DeepSeek 前缀缓存优化。

## 2. 当前现场

| 项 | 事实 |
|---|---|
| 当前分支 | `engine/v2`，HEAD `a391689` |
| 基线 | `origin/master` = `e40fea8`（0.1.9）；`origin/main` = `179340c`（0.1.8，GitHub 默认分支） |
| 领先 | 23 个提交，0 落后；未 Push |
| 版本 | 五处仍为 `0.1.9`，但代码相对已交付 0.1.9 改了 27 个文件（+1988/−563） |
| 后端 | Rust 约 9,000 行；`agent.rs` 1,557 行、`goal.rs` 1,441 行 |
| 前端 | 约 50,000 行；`App.tsx` 4,071 行、`App.css` 2,662 行、`RightPanel.tsx` 1,475 行、`Drawers.tsx` 1,435 行 |
| 测试 | `cargo test` 85/85；前端 0 测试、0 lint |
| 构建 | `npm run build` 通过；单包 JS 1,777.57 kB（gzip 445.59 kB） |
| 格式 | `cargo fmt --check` 116 处差异 / 20 文件；`cargo clippy` 27 条警告 |

## 3. 代码地图

### 3.1 后端（`app/src-tauri/src`）

| 文件 | 行数 | 职责 | 现状 |
|---|---:|---|---|
| `agent.rs` | 1,557 | 原生 agent 主循环、SSE 解析、工具编排、目标循环 | 能跑，但仍是最大单体 |
| `goal.rs` | 1,441 | 目标状态、清单门、停滞检测、检查点/倒带、快照 | 功能多，职责混 |
| `dsml.rs` | 525 | 反代把 tool_calls 塞进正文时的恢复 | 有 12 个测试，较稳 |
| `fsutil.rs` | 514 | 文件浏览、审查、revert、commit | 有路径/安全问题 |
| `codex.rs` | 460 | 旧 Codex CLI 引擎 + `RunState` 定义 | **旧引擎仍在注册，但前端不用** |
| `browser.rs` | 424 | 内置浏览器子 webview、导航、截图 | Windows 优先；截图仅 Windows |
| `engine/tool_pipeline.rs` | 408 | 工具执行、审批卡、shell | 工具结果是 `String` |
| `pty.rs` | 389 | 每任务一个 PTY、快照回放 | Windows 测试覆盖少 |
| `settings.rs` | 309 | 设置读写、迁移、默认服务商 | API Key 明文 |
| `lore.rs` | 300 | 龙族知识库按需注入 | 有 7 个测试 |
| `sandbox.rs` | 288 | 沙箱/审批纯函数、路径边界 | 6 个测试，骨架好 |
| `usage.rs` | 275 | 用量台账、峰谷价、缓存节省 | 4 个测试 |
| `engine/journal.rs` | 214 | append-only JSONL 运行日志 | 只存元数据，不能重建上下文 |
| `models.rs` | 144 | 直连/反代模型 ID 映射、退役迁移 | 4 个测试 |
| `engine/tooling.rs` | 120 | 工具 schema | 7 个工具 |
| `engine/deepseek.rs` | 105 | DeepSeek effort/参数适配 | 3 个测试 |
| `engine/retry.rs` | 100 | 408/429/5xx 重试 | 2 个测试 |
| `engine/policy.rs` | 81 | 删除/灾难命令检测 | **可被包装绕过** |
| `engine/edit.rs` | 60 | 精确 old/new 替换 | 3 个测试 |
| `engine/context.rs` | 47 | 工具结果头 4096 + 尾 1024 裁剪 | 2 个测试 |

### 3.2 前端（`app/src`）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `components/sealTargets.ts` | 30,011 | 校徽粒子布点数据（静态资源） |
| `App.tsx` | 4,071 | 所有状态、事件监听、任务/项目、发送、目标、审查、设置接线 |
| `App.css` | 2,662 | 设计系统、主题、动效 |
| `RightPanel.tsx` | 1,475 | Inspector：审查/终端/文件/浏览器/插件/工作流 |
| `Drawers.tsx` | 1,435 | 设置、命令面板、档案库、帮助、用量 |
| `Boot.tsx` | 1,352 | 开机七步 + 粒子校徽 |
| `mark/useBallEngine.ts` | 1,346 | 诺玛球 14 态生命体 |
| `Composer.tsx` | 779 | 输入框、模式/强度/计划/目标 |
| `Sidebar.tsx` | 463 | 项目/任务/身份卡 |
| `types.ts` | 338 | 数据模型 |
| `commands.ts` | 335 | Cmd-K / `/` 命令注册表 |
| `BrowserPane.tsx` | 266 | 子 webview 位置同步 |
| `TerminalPane.tsx` | 160 | xterm.js PTY |

### 3.3 一次请求的真实数据流

```text
Composer 发送
  → App.runTurn（只带最近 10 条纯文本 history）
  → Tauri invoke("run_agent_native")
  → agent.rs 组装 system（冻结前缀 + 附录）、工具表、消息
  → SSE /chat/completions
  → agent-delta / agent-thinking / agent-tool / agent-tool-result
  → App 用 activeTaskIdRef 写当前任务
  → useEffect 每次 tasks 变化全量 JSON.stringify → localStorage
  → 结束后写 usage ledger + journal
```

关键断点：

- **后端有完整 tool_calls/tool 结果，但只存在 `GoalSession.messages` 或本次 run 的局部变量里**；
- **普通对话的历史只有前端最近 10 条纯文本**，工具调用/结果不回流给下一轮；
- **目标会话只存在 `RunState.goals` 内存**，重启后没有从检查点恢复的入口；
- **事件没有 task_id**，前端用“当前选中任务”接收，切任务会串。

## 4. 真正能用的功能（按代码链路判定）

| 功能 | 证据 | 状态 |
|---|---|---|
| 对话 + 流式正文/思考 | `agent.rs` SSE、`App.tsx:2003-2163` | ✅ |
| DeepSeek effort/参数适配 | `engine/deepseek.rs` | ✅ |
| DSML 工具调用恢复 | `dsml.rs` + 12 测试 | ✅ |
| 瞬时错误重试 | `engine/retry.rs` | ✅ |
| 工具结果头尾裁剪 | `engine/context.rs` | ✅ |
| 冻结前缀 + appendix | `frozen.rs` + `goal.rs` | ✅（会话内） |
| 模型 ID 直连/反代映射 | `models.rs` | ✅ |
| 文件读取/列目录/写入/精确编辑 | `tool_pipeline.rs` + `edit.rs` | ✅ |
| 真 PTY 终端（每任务一个） | `pty.rs` + `TerminalPane` | ✅（Windows 待真机） |
| 内置浏览器子 webview | `browser.rs` + `BrowserPane` | ✅（Windows 待真机） |
| diff 审查、逐文件通过/拒绝、提交 | `fsutil.rs` + `RightPanel` | ✅ |
| 文件查看器/图片预览/已修改标记 | `fsutil.rs` + `RightPanel` | ✅ |
| 计划模式 + 确认执行 | `agent.rs` + `App.tsx:3206` | ✅（靠字符串识别） |
| 目标模式 + 清单门 + 停滞检测 | `goal.rs` + `GoalCard` | ✅（重启不可恢复） |
| 检查点/倒带（三粒度） | `goal.rs` + `GoalCard` | ✅（有删文件风险） |
| 沙箱 × 审批两把 dial | `sandbox.rs` + `tool_pipeline.rs` | ✅（覆盖面不足） |
| NORMA/EVA 任务绑定 | `modes.rs` + `types.ts` | ✅ |
| 用量/缓存/成本面板 | `usage.rs` + `Drawers` | ✅ |
| 开机仪式/诺玛球/主题 | `Boot.tsx`/`useBallEngine`/`App.css` | ✅ |

## 5. 半成品 / 占位（不能当卖点）

| 项 | 事实 | 证据 |
|---|---|---|
| Ultracode | 开关只透传并记录，引擎仍是单智能体 | `agent.rs` 注释、`Drawers.tsx:736` |
| 工作流页 | 只有任务名/工具名/用量，无分步耗时/每路状态 | `RightPanel.tsx:1373-1468` |
| 插件页 | 所有开关 `disabled`，文案写“全部未接入” | `RightPanel.tsx:1304-1371` |
| MCP | 只有设置占位，无客户端、无连接、无 OAuth | `settings.rs`、`RightPanel.tsx` |
| 上下文压缩 | 没实现；`compression_model` 字段没人消费 | `commands.ts:85` 注释、`types.ts:48` |
| 附件 | 只把路径拼进 prompt，不读内容、不走多模态 | `App.tsx:2602-2605` |
| 浏览器截图 | 后端有 `browser_screenshot`，前端零调用 | `browser.rs` vs `app/src` |
| Codex CLI 备用引擎 | 命令仍注册、设置页仍有入口，但前端从不 `run_agent` | `codex.rs`、`Drawers.tsx:642` |
| 交付物 | 只存在内存，刷新即失 | `App.tsx:1425-1427` |
| `Task.status/subSessions/seed` | 类型存在，无写入/无渲染 | `types.ts:164-167` |

## 6. 架构债务（按优先级）

### P0 — 先修，否则功能越多越危险

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| A1 | 会话没有唯一持久化存储；后端 `RunState.goals` 内存 + 前端 localStorage 双写 | `lib.rs:64`、`agent.rs:892`、`App.tsx:1656` | 重启丢目标；普通对话上下文只有 10 条；无法 resume/fork |
| A2 | 事件没有 task_id，前端用 `activeTaskIdRef` 接收 | `App.tsx:1951-1993` vs `agent.rs:661` | 运行中切任务，工具卡/增量/审批写错会话 |
| A3 | 工具结果只有 `String`，没有结构化 outcome | `tool_pipeline.rs:78` | UI 靠正则/文本反解；错误/拒绝/超时不可区分 |
| A4 | 审批只是 `request_approval -> bool`；无 run_id、无会话允许、无规则缓存 | `tool_pipeline.rs:9-60` | 无法实现“允许一次/本次会话/永远”；并发不安全 |
| A5 | 删除检测只看每段首 token，可被 `cmd /c`、PowerShell、python、git clean 绕过 | `engine/policy.rs` | 默认档删文件不弹卡，违反产品承诺 |
| A6 | shell 不受沙箱限制；提示词却说“工作区外碰不了” | `tool_pipeline.rs:329`、`agent.rs:871` | 可读 `.ssh`/`settings.json`，Key 进上下文 |
| A7 | 进程树只 `kill_on_drop` 直接子进程 | `tool_pipeline.rs:360`、`shell.rs:38` | `npm run dev` 超时留孤儿，端口/文件锁 |
| A8 | 目标快照复制整个工作区（含 `.env`/私钥），40 回合 40 份，无清理 | `goal.rs:603-684` | 隐私泄露、磁盘膨胀 |
| A9 | 倒带会删“快照里没有”的用户新文件 | `goal.rs:1004-1047` | 用户自己的文件被误删 |
| A10 | 前端每个流式 chunk 全量写 localStorage | `App.tsx:2015` → `:1656` | 长会话平方级卡顿，配额满静默丢历史 |
| A11 | 工具卡反向解析展示文本，`write_file` 长参数必然坏 | `App.tsx:768-778`、`:2060` | 路径显示“—”，状态永远“执行中” |

### P1 — 引擎稳定后做

- `agent.rs`/`goal.rs`/`App.tsx` 三个单体拆分；
- API Key 迁 Windows 凭据管理器；
- `fsutil::read_file` 任意路径收紧；
- Codex CLI 旧引擎去留；
- 目标/检查点清理策略；
- 浏览器截图接线；
- 前端 0 测试、0 lint；
- bundle 1.78MB 代码分割；
- `cargo fmt`/CI 门禁；
- 版本号与安装器图标。

### P2 — 卫生/体验

- `cargo clippy` 27 条；
- 便携版停在 0.1.6；
- usage ledger 全量重写；
- PTY 会话无上限；
- `withGlobalTauri` + `unsafe-inline`；
- 主题硬编码色；
- 无 git tag、无 publisher 元数据。

## 7. 安全与数据边界（摘要）

详细见 [security-data.md](./security-data.md)。三条 P0：

1. **删除命令绕过**：`cmd /c rd /s /q`、`powershell Remove-Item`、`git clean -xfd`、`python -c` 等默认不弹卡。
2. **shell 不受沙箱限制**：文件工具锁在工作区，终端命令仍是完整用户权限；可读 `%APPDATA%\com.cassell.agent\settings.json`（明文 Key）。
3. **无网络出口管控**：`curl`/`Invoke-WebRequest`/浏览器打开都属常规动作，prompt injection 可外带文件内容。

## 8. 构建与发布（摘要）

详细见 [build-release.md](./build-release.md)。三条 P0：

1. **版本撞车**：代码已变 27 文件（+1988/−563），版本仍 0.1.9。
2. **安装器图标没有构建期方案**：`bundle` 无 `windows.nsis`，只能出 NSIS 默认蓝图标；历史事后打图标补丁造过坏包。
3. **`engine/v2` 从未 Windows 真机运行**：只过编译/单测；浏览器、ConPTY、60fps 都未验收。

## 9. 前端（摘要）

详细见 [frontend.md](./frontend.md)。三个 P0：

1. 每个流式 chunk 全量 `JSON.stringify(tasks)` 写 localStorage；
2. 运行中切任务，工具卡/流式增量写错会话；
3. 工具卡反向解析展示文本，长参数必然坏。

## 10. 与蓝图/P1/P2 的差距

| 层 | 蓝图状态 | 代码事实 |
|---|---|---|
| P0 11 项（14 行） | 文档写 13/14，浏览器待 Windows | 代码全部有；真机验收未完成 |
| P1 18 项 | 全部“下一版” | 除用量面板/审查队列的部分壳，基本未做 |
| P2 10 项 | 全部“以后” | 未做；Ultracode/工作流/插件是诚实占位 |
| CLI | Rust + Ratatui 已定 | 代码未开工 |

## 11. 结论：先修什么、后做什么

**先修“正确性和安全”，再修“体验和功能”。**

顺序建议：

1. 会话唯一存储 + task_id 事件 + 工具结果结构化（A1/A2/A3）；
2. 审批/删除/沙箱/网络/进程树（A4-A7）；
3. 压缩/上下文预算 + 目标快照/倒带安全（A8/A9 + 上下文）；
4. 前端 localStorage/工具卡（A10/A11）；
5. Windows 真机验收 + 0.2.0 出包；
6. 再按 P1 顺序做 Skills、记忆、Queue/Steer、Worktree、定时任务、Side chat/Fork。

**不能动**：视觉稿、开机七步、诺玛球、主题、动画参数、文案口径、UI 结构；任何可见变化先给方案再改。

## 12. 证据边界

- 本审计是**源码 + 构建 + 单测**级；没有在 Windows 真机上跑完整交互，也没有跑真实 DeepSeek 端到端。
- 子审计各自列了未验证项：前端视觉/性能、删除/审批真机、安装包构建。
- `cargo test` 85/85 是当前 HEAD 的事实；不代表安装包可装、浏览器可嵌、终端不闪。
- 所有 `file:line` 以当前 `engine/v2` / `a391689` 为准，后续改动需重新核对。
