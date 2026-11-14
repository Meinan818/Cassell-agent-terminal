# 卡塞尔专员终端 · 下一阶段执行计划

制定日期：2026-11-14。
依据：[项目审计](./audit/PROJECT-AUDIT.md)、[前端审计](./audit/frontend.md)、[安全审计](./audit/security-data.md)、[构建审计](./audit/build-release.md)。

## 0.1 当前进度（2026-11-14）

已完成并本地提交：

- A4/A5 安全策略：删除命令包装绕过、敏感路径、网络出口审批；`engine/policy.rs` 单测覆盖 `cmd /c`、PowerShell、python、node、git clean/reset 等绕过样例。
- A1 事件 task_id：后端所有 agent 事件带任务 id，前端按发起任务写消息/工具卡/审批。
- A2 localStorage 节流：500ms 防抖 + 关闭前 flush + 配额提示。
- A3 工具卡结构化：事件直接传 `args`，卡片不再反解正文；空结果不再假装“执行中”。
- A6 进程树：`engine/process.rs` 在 Windows 超时后 `taskkill /F /T /PID`，不再只杀直接子进程。
- A7 快照安全：快照跳过 `.env`/私钥/凭据/设置文件；任务永久删除时清理检查点与快照。
- A8 倒带安全：不再删除快照外文件，避免误删用户新建文件。
- 旧 Codex CLI 引擎已移除（`codex.rs` 删除，`RunState` 独立到 `run_state.rs`）；产品只保留“配 base_url + API Key”的原生 HTTP 引擎。
- B 的一部分：`engine/session.rs` 目标会话落盘，重启后可继续。
- C1-C3：`ToolOutcome` 结构化结果（状态/错误/耗时进事件和 journal）；工具卡不再反解文本；审批支持“批准一次 / 本次会话允许 / 拒绝”，并按任务缓存会话级批准。
- D1/D2 第一版：上下文 token 估算 + 80% 触发；超预算时把旧消息归档到 `sessions/archive/`，活动上下文保留最近一段并插入确定性归档摘要。D3 的 CacheAdvisor 公式已落地并带单测，尚未接真实命中率遥测。
- 真实反代冒烟：本机 `127.0.0.1:7863/v1` + `cn:hy4free` 成功返回；中文请求解码后为“正常”，prompt 78 / completion 37 tokens，新请求 cached 0。密钥未写入仓库或日志。
- 模型能力表：DeepSeek 1M、Kimi 256k、Moonshot 8k/32k/128k、Qwen 128k、未知模型 128k 兜底；模型切换后上下文窗口和压缩阈值跟着换。输入框上方现在显示“上下文 x% / 窗口”。
- 按天枢 4.0.4 的做法补齐模型配置：每个模型可在设置里单独填写“上下文 / 最大输出”，留空时按模型名后缀（如 `-128k`、`-1m`）推断，再回落到 512K / 64K 默认；请求会带 `max_tokens`。本机 `cn:hy4free` 在 `max_tokens=65536` 下真实返回 `OK`。

下一步：D4（压缩模型接入），最后 E（Windows 验收/0.2.0）。

## 0. 总原则

1. **先修地基，再做功能。** 会话、工具结果、审批、上下文、进程树没打牢之前，不加 P1 大功能。
2. **只保留一套引擎。** 原生 Rust 引擎是唯一主引擎；旧 Codex CLI 驱动不再作为“备用引擎”暴露。
3. **一个任务一份可恢复会话。** 任务的消息、工具调用、审批、目标、检查点必须能从磁盘恢复，不能只靠内存 + localStorage。
4. **权限在运行时判断，不靠 prompt。** 删除、敏感路径、网络出口、进程执行都必须经过统一 policy。
5. **UI 冻结。** 视觉稿、开机七步、诺玛球、主题、动画、文案、布局不动；只做内部接线和必要的状态显示，任何可见变化先给方案。
6. **先本地 commit，Push 必须单独批准。** 每个里程碑有测试/真机证据再提交。

## 1. 0.2.0 的定义

**0.2.0 不是“功能更多”，是“引擎能放心用”。**

必须同时满足：

1. 任务/目标/工具调用/审批有唯一持久化会话，应用重启可恢复；
2. 工具结果结构化，UI 不再反解文本；
3. 删除/敏感路径/网络出口/进程树有统一安全策略；
4. 长会话有上下文预算和压缩，压缩可回溯；
5. `engine/v2` 在当前 Windows 真机上跑过完整流程；
6. 版本号升到 0.2.0，安装包可装可跑，SHA256 记录；
7. `cargo test` + `npm run build` + 真机冒烟全过。

P1 的 18 项功能，0.2.0 之后按第 4 节顺序做。

## 2. 分支与发布策略

### 2.1 分支

- 当前 `engine/v2` 作为 0.2.0 开发线，**不再从旧 `p1` cherry-pick**；旧 `p1` 只作参考。
- 从 `engine/v2` 开 `release/0.2.0`；稳定后合回 `master`。
- `origin/main` 仍停在 0.1.8，GitHub 默认分支也是 `main`。发布前把默认分支切到 `master` 或把 `main` 快进到 `master`，不能让用户克隆到旧版。
- 每次里程碑：本地 commit；Push 前先 `git ls-remote` 核对远端，再向用户申请。

### 2.2 版本

- 建议直接升 **0.2.0**，不是 0.1.10：这次改的是引擎地基，不是小修补。
- 五处同步：`app/package.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock`、`app/src-tauri/tauri.conf.json`、`app/src/version.ts`。
- 安装器图标必须在 `tauri.conf.json` 的 `bundle.windows.nsis` 里构建期配置；**禁止再事后改安装包**（0.1.7 坏包的教训）。

## 3. 四个阶段

### 阶段 A：止血（先做，1 周内）

目标：不再写错会话、不再无声删文件、不再留孤儿进程。

| 任务 | 内容 | 主要文件 | 验收 |
|---|---|---|---|
| A1 | 所有 agent 事件带 `task_id`；前端按发起任务接收，不再用 `activeTaskIdRef` | `agent.rs`、`tool_pipeline.rs`、`App.tsx` | 运行中切任务，消息/工具卡/审批仍落在原任务 |
| A2 | localStorage 写入节流：500ms 防抖 + 运行结束 flush + 配额失败提示 | `App.tsx` | 长回复不卡；配额失败有提示 |
| A3 | `agent-tool` 直接带结构化 `args`；工具卡用 `toolStatus`，不再反解文本 | `agent.rs`、`App.tsx` | `write_file` 长参数显示正确路径；空结果不再“执行中” |
| A4 | 删除/破坏命令识别扩展：递归解析 `cmd /c`、`powershell -Command`、`python -c`、`bash -c`；加 `git clean -x`、`git reset --hard`、`rd/rmdir /s`、`robocopy /mir` 等 | `engine/policy.rs`、`sandbox.rs` | 单测覆盖所有绕过样例；默认档必须弹卡 |
| A5 | 敏感路径与网络出口审批：`.ssh`、`.env`、`*.pem`、`*.key`、`settings.json`、`curl/wget/Invoke-WebRequest/ssh/scp/git push` | `engine/policy.rs`、`tool_pipeline.rs` | 命中敏感路径/出口必须弹卡；审批卡显示目标 |
| A6 | 进程树终止：Windows Job Object；失败回退 `taskkill /F /T`；超时/取消都清理 | `engine/process.rs`（新）、`tool_pipeline.rs`、`shell.rs` | 起 `npm run dev` 后超时，node 孙进程全部结束 |
| A7 | 目标快照收窄：只备份候选写入文件；过滤 `.env*`、`*.pem`、`*.key`、`id_rsa*`、`.git-credentials`；删任务/清目标时清快照 | `goal.rs` | 不再复制整个工作区；清理后磁盘无残留 |
| A8 | 倒带安全：删除前列出清单；只删本会话产生的新增文件；不得删用户新建文件 | `goal.rs`、`RightPanel.tsx` | 用户手建文件在倒带后仍在 |

### 阶段 B：会话地基（1-2 周）

目标：一个任务一个 session，重启能续，工具调用不断。

| 任务 | 内容 | 主要文件 | 验收 |
|---|---|---|---|
| B1 | `SessionStore`：每任务 append-only JSONL 事件 + 可派生消息；保存 goal/审批/checkpoint 元数据 | `engine/session.rs`（新）、`engine/event.rs`（新） | 重启后 `deriveMessages()` 能还原完整上下文 |
| B2 | 启动加载会话索引；任务列表从后端读，localStorage 只做缓存 | `lib.rs`、`engine/session.rs`、`App.tsx` | 关闭应用再开，任务/目标/工具历史都在 |
| B3 | 普通对话也走后端会话，不再只传最近 10 条纯文本 | `agent.rs`、`App.tsx` | 20 轮以上对话上下文连续，工具结果不丢 |
| B4 | Resume / fork：恢复目标、复制分支、原会话不动 | `engine/session.rs`、`goal.rs` | 目标跑到一半杀进程，重启可继续；fork 后原任务不变 |
| B5 | 检查点与 session 统一：检查点引用 session seq，不再各自一套 | `goal.rs`、`engine/session.rs` | 倒带后消息/工具/文件一致 |

### 阶段 C：工具与审批协议（1 周）

目标：工具结果不再是字符串，审批不再是 bool。

| 任务 | 内容 | 主要文件 | 验收 |
|---|---|---|---|
| C1 | `ToolOutcome`：`content/details/structured_content/is_error/usage/terminate/duration_ms/status` | `engine/outcome.rs`（新）、`tool_pipeline.rs` | 每个工具返回结构化结果，UI 能显示成功/拒绝/超时/错误 |
| C2 | 12 态工具结果：ran / approved_by_session / denied_by_rule / denied_by_user / ask_expired / hook_blocked / validation_failed / duplicate_call / unrecognized 等 | `engine/outcome.rs`、`tool_pipeline.rs` | 单测覆盖每态；日志可区分“为什么没执行” |
| C3 | 审批状态机：`allow-once` / `allow-session` / `deny`；带 `run_id/task_id`；超时/取消/断线；审批缓存按会话 | `engine/approval.rs`（新）、`lib.rs`、`tool_pipeline.rs` | 不再重复弹同意请求；跨任务不串 |
| C4 | pre/post tool hooks：PreToolUse 可阻断并回传原因；PostToolUse 只观察 | `engine/tool_pipeline.rs`、`tooling.rs` | 删除/敏感路径/命令策略可挂 hook；hook 失败 fail-closed |
| C5 | 只读工具并行、写工具串行（先只对 `read_file/list_dir` 试点） | `agent.rs`、`tool_pipeline.rs` | 同轮多个读取并行；写操作不并发 |

### 阶段 D：上下文与压缩（1 周）

目标：长会话不爆、不蠢、不丢原文。

| 任务 | 内容 | 主要文件 | 验收 |
|---|---|---|---|
| D1 | token 预算分层：冻结前缀 / 附录 / 历史 / 工具结果 / 保留尾部 | `engine/context.rs`、`agent.rs` | 超预算先裁剪工具结果，再压历史 |
| D2 | `engine/compact.rs`：归档原文 + 摘要替换；压缩期间历史变了禁止替换 | 新模块、`agent.rs`、`settings.rs` | 压缩可回溯；会话继续可用 |
| D3 | CacheAdvisor 简化版：`protection = hitRate × (1 − pressure)`，≥0.45 延迟压缩；压缩后 3 轮内回满连续 3 次判 thrash | `engine/compact.rs` | 不频繁压缩；thrash 有日志/提示 |
| D4 | `compression_model` 真正使用；压缩模型与主模型解耦 | `agent.rs`、`settings.rs` | 改主模型不动压缩模型 |
| D5 | 上下文仪表盘：composer 显示剩余/占比；接近阈值提示 | `Composer.tsx`、`Drawers.tsx` | 不改布局，只加一行状态 |

### 阶段 E：Windows 验收与 0.2.0（2-3 天）

| 任务 | 内容 | 验收 |
|---|---|---|
| E1 | 当前 HEAD `tauri dev` 真机跑：对话、DeepSeek、Plan、Goal、审查、终端、浏览器、设置、模式切换 | 全流程无崩溃；截图/日志留证 |
| E2 | 版本升 0.2.0，五处一致；`bundle.windows.nsis` 配安装器图标 | 版本一致；安装包图标正确 |
| E3 | `npx tauri build` 出 NSIS；7z test；SHA256；真机安装/卸载 | 可装可跑；记录哈希 |
| E4 | 冒烟脚本 + CI（至少 `cargo test` + `npm run build`） | 每次提交自动跑 |

## 4. P1 功能顺序（0.2.0 之后）

先做能形成复利的，不做“看起来厉害”的。

| 顺序 | 功能 | 理由 |
|---:|---|---|
| 1 | Skills（`SKILL.md` 渐进披露） | 成本低、复用高；与现有 7 个工具直接配合 |
| 2 | 统一记忆（项目内 JSONL，只自动注入约束） | 为 NORMA/EVA 共用记忆打底 |
| 3 | Queue / Steer（运行中排队/改向） | 日常高频，直接改善长任务体验 |
| 4 | Worktree 并行隔离 + Handoff | 多任务不互踩；纯本地 git |
| 5 | 定时任务 + Triage 收件箱 | 办公场景价值高；本地版明确“关机不跑” |
| 6 | Side chat + 会话 Fork | 问小问题不污染主上下文 |
| 7 | 权限颗粒化（命名 profile/白名单/approve-for-me） | 减少打断，建立在 C3 之上 |
| 8 | 交付门三权分立（提交/验证/审查） | 把现有 Goal 验证逻辑产品化 |
| 9 | 上下文仪表盘/`/recap` | 与 D1-D5 接 |
| 10 | 极限思考研究态（写锁协议） | 研究/写入互斥；先只读试点 |
| 11 | 混合检索 RRF + 影响半径 | 代码库大了才值 |
| 12 | 审查队列 Triage 化 | 多任务后再做 |

P2 仍按蓝图：ULTRACODE 完整编排、CVM 轻量外环、信息素记忆、Cockpit、插件中心、桌宠分级、Windows 自愈、Computer Use、自动选边、MCP marketplace。

## 5. 第一批任务（现在就可以开工）

按顺序做，不并行改同一块：

1. **A4 + A5 安全策略**（`engine/policy.rs`、`tool_pipeline.rs`）——先把“删文件不弹卡/读 Key 不弹卡/联网不弹卡”堵住。
2. **A1 事件 task_id**（`agent.rs` → `App.tsx`）——先把“切任务写错会话”修掉。
3. **A2 + A3 前端持久化与工具卡**（`App.tsx`）——先把卡顿/错误展示修掉。
4. **A6 进程树**（`engine/process.rs`）——先保证停得干净。
5. **A7 + A8 快照/倒带安全**（`goal.rs`）——先保证不复制/不误删用户文件。
6. **B1-B5 SessionStore/resume**（新模块）——地基。
7. **C1-C3 ToolOutcome/审批状态机**——协议。
8. **D1-D5 上下文/压缩**——长会话。
9. **E1-E4 Windows 验收/0.2.0**——收口。

每一项都要：先写失败用例/复现 → 最小修改 → 单测 → 真机冒烟 → commit。没有证据不算完成。

## 6. 验证矩阵

| 层 | 必须验证 |
|---|---|
| Rust 单测 | `cargo test` 全过；新增安全/会话/审批/压缩用例 |
| 前端构建 | `npm run build` 全过；无新增 TS 错误 |
| 前端冒烟 | 新建任务、发送、切任务、审批、审查、终端、浏览器 |
| 会话 | 杀进程重启后恢复；fork 后原任务不变 |
| 安全 | `cmd /c rd`、PowerShell、python、git clean、敏感路径、curl、进程树 |
| DeepSeek | 真模型一轮；缓存命中/usage 数字；思考回传不 400 |
| Windows | 安装包可装、可跑、可卸载；浏览器嵌入；终端不闪；60fps |

## 7. 明确不做（这一阶段）

- 不做 16 星域、人格、议会、星域投票；
- 不做 DSH 插件树、Cordis、profile/bundle/patch；
- 不做云端任务、远程控制、手机遥控；
- 不做 Computer Use 默认开启；
- 不做插件市场/MCP OAuth；
- 不做 UI 重设计、换皮、改布局；
- 不在会话/审批/压缩没稳之前做 Ultracode 编排。

## 8. 需要用户拍板的 4 件事（有推荐）

| # | 问题 | 我的推荐 |
|---|---|---|
| 1 | EVA 的 shell 权限：任意命令 + 敏感路径/网络审批，还是命令白名单 | **任意命令 + 敏感路径/网络审批**；白名单作为后续可选 profile，避免一上来把日常 `npm install`/`git` 全拦住 |
| 2 | 哪些网络命令免问 | 先全部问一次，支持“本次会话允许”；后续把 `npm install`、`git fetch/pull` 做成可配置白名单 |
| 3 | API Key 是否迁 Windows 凭据管理器 | **迁**；一次性迁移，先备份、可回滚；设置页只显示脱敏尾号 |
| 4 | 旧 Codex CLI 引擎是否保留 | **不保留为可选引擎**；从设置页移除入口，代码归档/删除。原生引擎是唯一主引擎 |

版本号我建议直接 **0.2.0**；安装器图标我建议先配 `bundle.windows.nsis`，不配就不出包。

## 9. 完成标准（0.2.0）

以下全部满足才算完成，少一条都不算：

- [ ] 重启应用后任务/目标/工具调用完整恢复；
- [ ] 运行中切任务不串消息；
- [ ] 工具卡显示真实参数和真实状态；
- [ ] 删除/敏感路径/网络出口默认会问；
- [ ] 超时/取消后无孤儿进程；
- [ ] 倒带不删用户新建文件、不复制整个工作区；
- [ ] 长会话能压缩、原文可回溯；
- [ ] `cargo test` + `npm run build` + clippy 无阻断；
- [ ] Windows 真机全流程通过；
- [ ] 0.2.0 安装包可装可跑，SHA256 记录；
- [ ] 文档、版本、安装包、README 一致；
- [ ] 未 Push 的内容按用户批准处理，不偷偷推送。
