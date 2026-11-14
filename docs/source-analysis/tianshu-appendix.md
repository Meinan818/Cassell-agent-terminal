# 天枢（Tianshu）src/ 之外源码补读附录

> 对象：`D:\卡塞尔学院\research-src\tianshu`，分支 `main`，HEAD `2d0b22e`
> （提交信息 `sync: from dev repo (v3.37.4 stable rev45)`）。
> 这是 **v3.37.4 的公开源码快照**，不是本机安装的 4.0.4。
> 4.0.4 运行时（Tauri 2.12.4 + `rivet-runtime/`）的拆包证据见
> `docs/tianshu-4.0.4-拆包研究报告.md`；本附录不重复 4.0 闭源机制。
> 主报告 `docs/source-analysis/tianshu.md` 只覆盖 `src/` 下模块；本附录补 B 面：
> 编辑器扩展、插件目录、Windows 原生 helper、computer-use 桩、worker 子进程、官网、脚本与安装/更新链路。

统计口径（`git ls-files` 实测）：

| 范围 | 文件数 | 行数 |
|---|---:|---:|
| 仓库受管文件合计 | 4599 | — |
| `src/**/*.ts` | 3772 | — |
| `vscode-extension/` | 87 | 14117 |
| `plugins/` | 70 | 12745 |
| `native/` | 3 | 466 |
| `website/` | 63 | 7646 |
| `scripts/` | 228 | 26589 |
| `src/tools/computer-use/` | 4 | 418 |
| `src/agent/worker-process/` | 5 | 1304 |

非 `src/` 受管文件共 **819** 个（`git ls-files` 实测），分布为：
`docs/` 295（天枢自己的设计与计划文档，本次不读）、`scripts/` 228（选读）、
`vscode-extension/` 87、`plugins/` 70、`website/` 63、`prompts/` 11、`.github/` 11、
`native/` 3、`completions/` 4、其余零星 27 个（根配置、`latest.json`、`benchmark/` 等）。
本附录覆盖范围：扩展 87 + 插件 70 + native 3 + computer-use 4 + worker-process 5 +
官网 63 + 脚本中 23 个产品相关文件 = **255 个文件**；其中扩展的 23 个测试文件、
插件的 24 个测试/锁文件只读用例名与结构（见 §10.2）。**不覆盖** `docs/` 与 `prompts/`。

**本快照缺失两块关键私有件**（实测 `Test-Path` 均为 False）：

- `desktop/`：Tauri 桌面壳、客户端自动更新器、`desktop/src-tauri/` 全部 Rust 代码不在公开仓。
- `src/pro/`：`computer_use` 的真实执行实现（驱动、无障碍树、CDP）被 `sync-to-public.sh --exclude 'pro/'` 剔除。

因此凡涉及"客户端 updater 真行为""GUI 自动化真实现"的结论，本附录一律标注为**不可核对**，不做源码级断言。

---

## 1. `vscode-extension/`（87 文件 / 14117 行）

### 1.1 文件清单

**入口与构建**

| 文件 | 行数 |
|---|---:|
| `src/extension.ts` | 368 |
| `esbuild.mjs` | 43 |
| `package.json` | 286 |
| `tsconfig.json` | 20 |
| `src/vscode-proposed.d.ts` | 67 |
| `README.md` / `CHANGELOG.md` | 76 / 76 |

**`src/sidecar/`（与内核通信 + 进程生命周期）**

| 文件 | 行数 |
|---|---:|
| `launcher.ts` | 565 |
| `client.ts` | 419 |
| `protocol.ts` | 214 |
| `runtime-downloader.ts` | 176 |
| `cli-command.ts` | 44 |
| `session-catalog.ts` | 43 |
| `token-ledger.ts` | 51 |
| `runtime-versions.ts` | 17 |
| `stream-accept.ts` | 9 |

**`src/chat/`（原生 Chat 视图接入）**

| 文件 | 行数 |
|---|---:|
| `participant.ts` | 418 |
| `turn-events.ts` | 223 |
| `human-interaction.ts` | 136 |
| `model-provider.ts` | 100 |
| `permission-bridge.ts` | 99 |
| `turn-timeout.ts` | 66 |
| `chat-parts.ts` | 47 |
| `human-forms.ts` | 41 |
| `subscription-gate.ts` | 41 |

**`src/delegation/`（客户端工具委托 E4）**

| 文件 | 行数 |
|---|---:|
| `executor.ts` | 398 |
| `diff-decorations.ts` | 106 |
| `codelens.ts` | 30 |
| `pending-policy.ts` | 7 |

**`src/scm/`、`src/shared/`、`src/views/`**

| 文件 | 行数 |
|---|---:|
| `scm/commit-message.ts` | 123 |
| `scm/source-control.ts` | 92 |
| `scm/change-mapping.ts` | 44 |
| `shared/session-state-reducer.ts` | 120 |
| `views/cockpit-provider.ts` | 593 |
| `views/changes-view.ts` | 162 |
| `views/token-ledger-bridge.ts` | 99 |
| `views/status-bar.ts` | 59 |
| `views/launcher-view.ts` | 23 |

**`webview-ui/src/`（React 座舱）**

| 文件 | 行数 |
|---|---:|
| `App.tsx` | 2159 |
| `model.ts` | 335 |
| `styles.ts` | 215 |
| `slash-local.ts` | 156 |
| `TokenLedgerPanel.tsx` | 124 |
| `bridge.ts` | 112 |
| `settings-form.ts` | 47 |
| `session-drafts.ts` | 31 |
| `markdown.ts` | 30 |
| `rewind-point.ts` | 29 |
| `session-list.ts` | 27 |
| `image-paste.ts` | 21 |
| `history-window.ts` | 9 |
| `main.tsx` | 8 |

**`tests/`（23 个文件，只读用例名与关键断言，未逐行）**：`host-lifecycle.test.ts` 1043 行、
`frontend-regressions.test.ts` 833、`daemon-lease.test.ts` 684、`model.test.ts` 252、
`chat-turn.test.ts` 189、`slash-local.test.ts` 111、`chat-permission-bridge.test.ts` 109 等。

### 1.2 入口与关键符号

| 位置 | 符号 | 作用 |
|---|---|---|
| `src/extension.ts:72` | `activate()` | 装配全部子系统，唯一入口 |
| `src/extension.ts:66` | `resolveSidecarDataDir()` | 每窗口独立会话库，避免与桌面端抢 `sidecar.lock` |
| `src/extension.ts:257` | `ensureClient()` | 单飞启动 + 崩溃自愈（退避 1s/3s/9s） |
| `src/extension.ts:54/56` | `MAX_RESTART_ATTEMPTS` / `STABLE_UPTIME_MS` | 最多重启 3 次；稳定 60s 后计数清零 |
| `src/extension.ts:351` | `disposeSidecar()` | 代际作废 + 强杀/保活二选一 |
| `src/sidecar/launcher.ts:451` | `launchSidecar()` | 先试接管租约，再 spawn `serve --port` |
| `src/sidecar/launcher.ts:156` | `waitHealthy()` | `/readyz` 20s 轮询 + `readiness: failed` 立即分类失败 |
| `src/sidecar/launcher.ts:213/252` | `readDaemonLease()` / `writeDaemonLease()` | 租约读写（`0600`、临时名 + rename） |
| `src/sidecar/launcher.ts:372` | `tryAttachExistingDaemon()` | Reload 秒级重连，`pid` + `instanceId` 双校验 |
| `src/sidecar/launcher.ts:336` | `killPidTree()` | Windows `taskkill /PID <pid> /T /F` |
| `src/sidecar/client.ts:29` | `class SidecarClient` | REST + SSE 薄客户端 |
| `src/sidecar/client.ts:398/449` | `subscribe()` / `consumeSse()` | `since=lastSeq` 续传、退避上限 10s、按 `seq` 去重 |
| `src/sidecar/runtime-downloader.ts:138/48` | `ensureRuntime()` / `ENDPOINTS` | 无 CLI 时自举运行时（CF 镜像 → GitHub） |
| `src/sidecar/cli-command.ts:18` | `resolveCliCommand()` | 解析 Windows npm shim，避免 prompt 进 `cmd.exe` |
| `src/views/cockpit-provider.ts:63/124/501` | `CockpitProvider` / `onMessage` / `attachSession` | webview ↔ 宿主桥，事件逐条转发 |
| `src/chat/participant.ts:56/249` | `TianshuChatParticipant` / `runRequest` | `@tianshu` 一轮一会话 |
| `src/chat/participant.ts:103` | `dispatch()` | SSE 事件 → Chat 视图（工具两段式、审批、用量） |
| `src/delegation/executor.ts:27/153/301` | `DelegationExecutor` / `handleApplyEdit` / `handleTerminalExec` | 编辑器内落地 |
| `src/views/changes-view.ts` | `BaseContentProvider` + `tianshu.openDiff` + `tianshu.rollback` | 基线↔工作区双栏 diff、双步回滚 |
| `webview-ui/src/App.tsx:60` | `App()` | 座舱全部状态与面板 |
| `webview-ui/src/model.ts:83` | `reduceEvent()` | SSE → 可渲染消息模型（纯函数） |
| `webview-ui/src/slash-local.ts:85` | `resolveComposerSlash()` | 斜杠命令本地分流，避免 `/prompt` 400 |

### 1.3 真实行为（按链路）

**① 职责边界是硬约束，不是口号。** `src/extension.ts:1-5` 头注释写死："插件内不实现任何
agent 逻辑，一切智能在 sidecar 内核；本文件只做 sidecar 生命周期 + 座舱视图装配。"
`scm/commit-message.ts` 也重复同一条红线（`rivet -p --json` headless 生成，插件只透传）。

**② sidecar 启动是"三级探测 + 租约接管"。** 顺序为：设置里的 `cliPath` → PATH 上的
`rivet` → 自举运行时下载（`runtime-downloader.ts:138`）。启动不执行 `--version` 探活，
因为 CLI 有 TTY 守卫（`launcher.ts` 头注释实测：非 TTY 下 `--version` exit 1），
直接 spawn `serve` 再打 `/readyz`。健康检查把 `readiness: failed` 的失败码
（如 `data-dir-locked`）映射成专门的 `SidecarLaunchError.reason`（`launcher.ts:93-120`），
避免"锁冲突被报成 20s 超时"。

**③ Reload Window 不断连靠租约文件。** `launcher.ts:213` 读租约时强校验：只接受
`http://127.0.0.1:<port>` 环回地址与 16–128 位十六进制 token（防御租约投毒）；
接管前用 `/readyz` 拿 `instanceId` 与 `pid` 双比对（`probeDaemon`），
不匹配即拒绝接管（`launcher.ts:372` 起）。删租约用 tombstone 重命名 +
`linkSync` 回滚（`removeDaemonLease`），保证不会误删"新实例刚写入的租约"——
这套竞态处理在 `daemon-lease.test.ts` 里有 19 条用例，其中 17 条直接针对租约竞态。

**④ IPC 只有两路：REST 与 SSE。** 无自定义 socket、无 IPC 端口协商。
协议类型是**编译期单一事实源**：`src/sidecar/protocol.ts:1-40` 从内核
`../../../src/server/protocol.ts` 做 type-only 导入，并用
`_AssertKnownEventTypesInCanonicalProtocol` 强制 `KnownEventType` 必须是
`SessionEventType` 的子集——手抄漂移会在 `tsc` 阶段直接报错。
SSE 侧 `stream-accept.ts:9` 单独处理 `seq === 0` 的元事件（`replay_window`/
`job_snapshot`）：放行且不推进 `lastSeq`。

**⑤ 座舱是"薄桥"，token 不进 webview。** `cockpit-provider.ts:1-12` 明写选宿主桥
而非 webview 直连的原因：规避 CSP/CORS 面（sidecar 未开 CORS，webview 源是
`vscode-webview://`），token 留在扩展宿主。webview HTML 用 nonce CSP
（`renderHtml`），`enableScripts` + `localResourceRoots` 限定到 `dist/` 与 `media/`。

**⑥ 原生 Chat 的四个真问题都被单独拆了模块。** 这些是产品级经验，值得逐条抄思路：

- 订阅泄漏：`subscribe()` 的取消只阻止重连、不中止在途流，per-turn 订阅会让同一事件成倍
  重复（`subscription-gate.ts` 头注释：lsof 实测多连接重复投递）→ 用"单例 + 代际"作废旧回调。
- 静默超时误伤：审批等待不是 sidecar 静默，照常计时会把"允许一次"的恢复输出丢成无主轮
  → `turn-timeout.ts` 审批挂起期间 `pause()`，全部完结后开新窗口。
- 权限档位半接：chat UI 的 `autoApprove`/`autopilot` 曾对 sidecar 完全无效 →
  `permission-bridge.ts` 做单向映射 + 捕获原档（`default` 还原），且要求 sidecar 确认后才提交状态。
- 上下文圆环口径错：`turn_complete.usage` 是**会话累计**，直接当上下文占用会显示
  276.0K 这种假数（`turn-events.ts` 注释实测）→ `contextTokens` 优先，`output` 由
   participant 差分（`participant.ts` 的 `dispatch` usage 分支）。

**⑦ 工具委托（E4）是"内核决策、客户端落地"。** `executor.ts:64` 先探协议版本
（`x-tianshu-protocol`，`client.ts:384`），低于 1 直接禁用委托并提示升级；
再探测终端 Shell Integration，可用才把 `terminal_exec` 注册进能力槽（25s 心跳续租）。
`apply_edit` 落地流程为：`WorkspaceEdit` 替换全文 → `save()` → 失败则回滚并报错 →
成功则算行级增删范围 + 红绿装饰 + CodeLens；用户拒绝时**先校验文件未被改动**，
被改过就保留现状并回报 `rejection conflict`（`executor.ts:262` 附近），
不强行覆盖用户编辑。`pending-policy.ts:7` 把自动接受超时设为 `0`——只等人工点 CodeLens。

**⑧ 变更审查与回滚是两条独立通路。** Explorer 树（`changes-view.ts`）与原生 SCM
（`source-control.ts:92`）读同一个 `GET /sessions/:id/git/working-tree`，都去抖 800ms；
diff 左栏是 `tianshu-base:` 自定义 scheme 按需拉 `git/file-base`，删除文件用
`empty=1` 空右栏。回滚走 server 的双步协议：`rollback/preview` 拿 `confirmationToken`
→ 用户二次确认 → `POST rollback`——客户端不做任何 git plumbing。

**⑨ 密钥处理有明确白名单。** `views/token-ledger-bridge.ts` 逐字段重建快照
（`safeTotals` + 显式挑字段），注释写明"即使内核返回多余字段，也不能把 key 或原始
错误串带进 webview"；`setTokenLedgerKey` 走 `vscode.window.showInputBox({password:true})`，
密钥不落 webview 状态。`frontend-regressions.test.ts` 里有 14 条 Token 账本相关用例（全文件 33 条）。

### 1.4 产品功能点（扩展侧对外可感知）

座舱对话（流式/思考折叠/工具卡/审批卡）· 运行中排队与"立即插话" · Ask 只读模式 ·
Plan 模式与计划审批卡 · 退到这里（含可选回滚文件）· 编辑器内红绿 diff + 接受/拒绝 CodeLens ·
可见终端执行 · `Ctrl/Cmd+K` 行内编辑 · 变更审查树 + 原生双栏 diff + 双步回滚 ·
原生 SCM 变更面板 + 一键生成中文提交语 · `@file` 提及与拖拽 · 图片粘贴（≤4 张、1.5MB）·
会话列表/搜索/改名/归档/永久删除/隔离 worktree · 首启 provider 引导（预设 + 自定义端点）·
默认权限/默认模型/默认星域/检查点轮数设置 · Token 账本（本机默认、显式同步）·
状态栏内核态与待审批计数 · 自举运行时（sha256 校验、双端点、版本回退）·
崩溃自动重启 + 断线重连提示。

### 1.5 可学 / 不学

**可学（优先级高）**

1. **协议 SSOT 的编译期门禁**：插件从内核 type-only 导入 + 子集断言，比"两边手写 DTO"可靠得多。
2. **租约 + 代际双机制**：Reload 复用一个 daemon（`pid`+`instanceId` 双校验），
   同时所有订阅走代际作废——这两个问题我们必然也会遇到。
3. **`/readyz` 语义化失败码**：把 `data-dir-locked` 和 `health-timeout` 分开，
   用户看到的提示才是可行动的。
4. **审批感知的超时守卫**：把"等模型"和"等人"分开计时。
5. **委托落地的人审边界**：拒绝前校验文件是否被改过，并回报冲突而不是覆盖。
6. **webview 不持有 token**：宿主桥 + CSP nonce，是成本最低的正确姿势。

**不学**

1. **座舱 2159 行单文件 `App.tsx`**：状态（sessions/model/domain/plan/cockpit/rewind/
   ledger/slash/draft/image）全在一个组件树里，靠 `useRef` 打补丁维持一致性；
   这是它自己的技术债，不要照搬。
2. **`webview-ui` 与 `src` 共用类型但各自维护镜像结构**（`bridge.ts` 里又抄一遍
   `CockpitSnapshot`/`ModelEntry`）：应直接从共享包导入。
3. **测试量集中在宿主桥**（`host-lifecycle.test.ts` 1043 行）而非端到端：
   它证明了桥的严谨，也说明端到端验收仍靠人。我们不要把"单测覆盖率"当验收。

---

## 2. `plugins/`（70 文件 / 12745 行）+ `src/plugins/` 加载器

### 2.1 文件清单

| 插件 | 文件 | 行数 |
|---|---|---:|
| `design/` | `index.js` / `lib/browser.js` / `lib/chrome.js` / `lib/diff.js` / `lib/palette.js` / `lib/preview.js` / `lib/responsive.js` / `package.json` / `skills/design-prototype/SKILL.md` | 269 / 86 / 45 / 40 / 98 / 22 / 65 / 26 / 49 |
| `hello-world/` | `index.js` / `package.json` | 21 / 17 |
| `office-docx/` | `index.js` / `package.json` / `skills/SKILL.md` / `test/smoke.mjs` | 151 / 23 / 27 / 46 |
| `office-excel/` | `index.js` / `package.json` / `skills/SKILL.md` / `test/smoke.mjs` | 368 / 26 / 33 / 148 |
| `office-pdf/` | `index.js` / `fonts.js` / `package.json` / `skills/SKILL.md` / `test/smoke.mjs` | 330 / 63 / 36 / 31 / 90 |
| `office-ppt/` | `index.js` / `package.json` / `skills/SKILL.md` / `test/smoke.mjs` | 346 / 26 / 39 / 95 |
| `tianshu-imbridge/` | `index.js` / `lib/bridge.mjs` / `lib/command.mjs` / `lib/command-handlers.mjs` / `lib/command-hints.mjs` / `lib/history.mjs` / `lib/reply.mjs` / `lib/serve-client.mjs` / `lib/session-map.mjs` / `lib/sessions.mjs` / `lib/tianshu.mjs` / `lib/transcript.mjs` / `lib/workspaces.mjs` / `lib/qq/{authorization,config,connection}.mjs` / `README.md` | 291 / 463 / 164 / 195 / 54 / 93 / 58 / 338 / 48 / 178 / 148 / 183 / 172 / 27+65+255 / 105 |
| 各插件 | `package-lock.json`（6 个，共 3895 行）与 `test/` 下 18 个用例文件（imbridge 14 个约 3321 行 + 四个 office smoke 379 行） | — |

内核侧加载器（本次同读，因为它决定"插件是什么"）：

| 文件 | 行数 |
|---|---:|
| `src/plugins/plugin-loader.ts` | 462 |
| `src/plugins/plugin-installer.ts` | 374 |
| `src/plugins/manifest.ts` | 129 |
| `src/plugins/git-source.ts` | 160 |
| `src/plugins/plugin-presets.ts` | 59 |
| `src/server/plugin-api.ts` | 321 |
| `src/server/plugin-session-cache.ts` | 152 |

### 2.2 清单格式（manifest）

插件就是 **npm 包**：`package.json` 里挂一个 `"tianshu"` 字段，用 zod 校验
（`manifest.ts:96-125`，`pluginManifestSchema`）：

| 字段 | 必填 | 语义 |
|---|---|---|
| `name` | 是 | **同时是安装目录名**，正则 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（阻断路径穿越，`manifest.ts:29`） |
| `version` / `description` | 是 | 市场展示 |
| `entry` | 是 | 编译后 JS 入口，相对插件根 |
| `tools[]` | 是 | `{name, description}`，用于市场预览与**冲突检测** |
| `permissions` | 是 | `{fs?, net?, shell?}`，**声明性元数据，运行时不强制** |
| `skills[]` / `hooks[]` / `commands[]` | 否 | 贡献 SKILL.md 目录 / 事件钩子脚本 / 斜杠命令 md |
| `minCoreVersion` | 否 | semver 范围（v1 advisory） |

`permissions` 的定位在源码里被反复钉死（`manifest.ts:34-56`）：

> "Plugins load via dynamic import() into the core process and run with the full
> privileges of that process… Declaring `{ net: false }` does NOT stop a plugin from
> opening a socket. **Install = trust**."

并且 `PLUGIN_PERMISSIONS_NOTICE` 会随安装预检响应一起返回（`plugin-api.ts:283-290`，
字段 `permissionsEnforced: false`）——不制造"沙箱"的假安全感。

### 2.3 安装 / 加载机制

**加载（`plugin-loader.ts:104` `initializePlugins`）** 是**扁平目录扫描**：

1. 扫 `~/.rivet/plugins/*`（只取目录）→ 读 `package.json` → 取 `tianshu` 字段 → zod 校验
   （非法 manifest = `skipped_invalid_manifest`，不阻断启动）。
2. `entry` 路径先做词法校验（`resolve` 后必须在 `pluginDir` 内），再做 **realpath 校验**
   （防插件目录里的符号链接指向外部；见 `plugin-loader.ts` 的 entry 决议段，注释引 issue #119 先例）。
3. `await import(pathToFileURL(entry))`，模块必须导出 `tools: Tool[]`。
4. **ABI 适配层**（`wrapPluginTool`）：内核流水线传的是 `params.input` 嵌套参数，插件按扁平
   `params.file_path` 读——包装器负责拆包，否则"单测绿、真实会话全 undefined"。
5. **路径安全**：所有路径类参数名（`file_path`/`destination_path`/`output_path`…）先过
   `validatePathSafe(cwd, value, mode)`，并用**规范化后的绝对路径替换**原值
   （插件按 `process.cwd()` 解析相对路径会造成跨会话串味）。
   注意：这是**路径归一化，不是权限边界**（源码明写 issue #216）。
6. **冲突检测**：任一工具名与既有注册表重名 → **整个插件被拒**（`skipped_conflict`）。
7. 加载 skills（同名跳过、不否决插件）、hooks（解析为绝对路径，留在内存不写
   `.rivet/hooks.json`，删插件即消失）、commands（同名先到先得）。
8. **让位机制** `PLUGIN_TOOL_SUPPRESS_MAP`（`plugin-loader.ts:133`）：`office-pdf` 抢
   `create_pdf`、`office-excel` 抢 `create_spreadsheet`、`office-ppt` 抢
   `create_presentation`——原生格式工具取代内置 HTML 降级实现。

**安装（`plugin-installer.ts:installFromLocal`）**：校验 manifest → `cpSync` 到
`~/.rivet/plugins/<name>/` → `npm install --ignore-scripts --omit=dev`（明确禁止
postinstall 执行）→ git 源写 `.tianshu-origin.json` 溯源。`removePlugin` 先过
`PLUGIN_NAME_PATTERN` 再递归删。git 安装走 `git-source.ts`：URL scheme 白名单
（https/http/ssh/git+ssh/file）+ `isSafeGitRef` + `clone --depth 1` 到临时目录 +
GitHub 镜像回退。

**生效时机是"下一个会话"**。`plugin-session-cache.ts` 的注释把原因写清楚了：
serve 的 `buildSessionStores` 是同步装配，`initializePlugins` 是异步，于是做
"启动暖场一次 → 每会话同步合入快照"；安装/启停/卸载后 `invalidatePluginToolsCache`
重建。TUI 侧对应 `bootstrap.ts:2434` 的 `beginExtraRegistration()` /
`endExtraRegistration()` 包住异步注册——注释写明这是**缓存碎裂根修**：晚到的工具变化
必须在 user 边界断尾，不能中途碎前缀（`bootstrap.ts:2420-2440`）。

**"市场"是静态目录，不是注册中心**：`plugin-presets.ts:59` 只有 4 条
（office-pdf / office-excel / office-ppt / design），`installPath` 指向仓库内
`plugins/…`，安装方式是本地路径。`hello-world` 是流水线探针，**故意不进 presets**。
`stage-plugins.js` 打包时剥掉 `node_modules`/测试/lockfile，随 Tauri
`resources/plugins-staged` 一起分发，装插件时才 `npm install`。

### 2.4 各插件真实行为

**`design/`（对标 Codex Product Design）**：4 个工具
`ui_preview`（多视口截图，输出 PNG data URL 给模型看）、`ui_diff`
（pixelmatch 像素级对比 + 原子写 diff 图）、`ui_palette`（取主色 → CSS 变量 +
Tailwind 片段，PNG only）、`ui_responsive_audit`（三视口注入 IIFE 审计脚本，查
横向溢出 / <44px 触控目标 / <12px 字号）。关键工程细节：**依赖懒加载**
（`importLib`）——`node_modules` 缺失时插件仍能注册，且每个工具给可执行错误提示；
Chrome 走系统安装探测（`lib/chrome.js`，支持 `CHROME_PATH`）。

**`office-*`**：原生格式替换 HTML 降级实现。docx（docx + mammoth，读回截断 8000 字）、
xlsx（exceljs，公式以 `=SUM(...)` 显示并带 `result`、`max_rows` 200/500 +
续读 `range_start` 提示）、pdf（pdfkit，CJK 字体按平台候选解析，找不到**显式警告**而不是
静默乱码；页码"第 X 页 / 共 Y 页"）、pptx（pptxgenjs 生成 + jszip 读 XML，
单页 XML 上限 50MiB 防正则回溯卡死，整包上限 100MiB）。
共性纪律：`requiresApproval()` 全为 `false`、`isConcurrencySafe` 按写/读区分、
原子写用"同目录临时文件 + rename"（注释解释为何不用 `os.tmpdir()`：跨文件系统 EXDEV）。

**`tianshu-imbridge/`（QQ 直连）**：唯一非办公类插件，也是设计最完整的一个。
- 双模式：`serve-native`（插件跑在 serve 进程内，能读 token/port → 用桌面端原生会话，
  每个 QQ 对话线绑定一个会话）与 `headless` 降级（单次调用 + 客户端历史注入）。
  `lib/serve-client.mjs` 把实测契约写进注释（`POST /sessions` → `GET /events?since=N`，
  `turn_complete` 带 grace 宽限以吸收"自动补救轮"）。
- 命令层 `/workspacelist` `/workspace` `/sessions` `/session` `/history` `/help`
  **本地处理、零模型调用**。
- 审批与提问转发到 QQ，回复"批准/拒绝"回决；词表**整句精确匹配**不做包含匹配
  （`lib/bridge.mjs:parseApprovalReply`），避免普通聊天里的"取消"被当成决定。
- 安全默认被**从"放行一切私聊"改成"未配置 owner 一律拒收"**
  （`lib/qq/authorization.mjs:5-15` 注释直接写旧行为不安全），群聊不再豁免——
  "mention gate 管不了谁 @"。凭据只从 `<RIVET_HOME>/imbridge/config.json` 或环境变量读，
  日志只出脱敏 appId。
- 入口纪律：顶层只做轻量初始化，重依赖全部 lazy-import（注释：顶层 import 链失败会让
  整个插件被静默跳过）。

### 2.5 结论：不是 DSH 式插件树

判定依据（全部来自本仓代码）：

1. **没有服务容器 / 依赖注入**：插件模块只导出 `tools` 数组（+可选 skills/hooks/commands），
   不注册 service、不取 `ctx`、不参与生命周期回调。`plugin-loader.ts` 只有
   import + 注册工具。
2. **没有插件间依赖解析**：无拓扑排序、无版本协商、无 `plugin 依赖 plugin`。
   唯一的相互作用是"工具重名 → 后到者整插件被拒"。
3. **没有运行时热插拔**：注释与路由都明确"available on next session start"；
   会话中途变化被 `beginExtraRegistration/endExtraRegistration` 收口到 user 边界。
4. **没有权限沙箱**：`permissions` 明写 advisory、`permissionsEnforced: false`。
5. **分发模型是"目录 + npm 包"**，市场是静态 preset 列表，不是运行时服务树。

它更接近"**工具包目录约定**"：一个进程内 `import()` 的 `tools` 数组，加三条可选贡献点。
这与 DSH 的"一切皆插件 / Cordis 服务树"是两种不同的东西。

### 2.6 可学 / 不学

**可学**

1. **manifest 的 `name` 即目录名的正则约束**（安装 + 卸载两处都校验），是防穿越的最低成本做法。
2. **realpath 二次校验**：词法层过了还要防符号链接逃逸。
3. **ABI 适配层**：把"内核参数形状"和"插件作者心智"解耦，且不加到插件侧。
4. **路径参数规范化替换**（不是校验后放行，而是替换成绝对路径）——解决 `process.cwd()` 陷阱。
5. **"让位机制"**：原生实现取代降级实现，而不是共存两套同名能力。
6. **诚实的权限声明**：明确写"不强制"，比假装有沙箱好。
7. **imbridge 的安全默认反转**：未知配置 = 拒收，而不是放行。

**不学**

1. **工具重名整插件拒绝**：对第三方插件合理，对自研内置能力太脆（一个名字冲突废掉整包）。
   我们应改成逐项拦截 + 明确告警（内核 `partitionPluginTools` 已经是这个思路，可统一）。
2. **静态 preset 当"市场"**：没有版本、评分、更新通道；`hello-world` 这种探针包留在
   产品目录里也是噪音。
3. **没有卸载回滚 / 依赖清理**：`removePlugin` 直接 `rmSync`，不处理被其他插件共享的依赖。
4. **`design`/`office-*` 把 Node 依赖装进用户数据目录**：体积与供应链风险都在用户侧，
   我们需要"内置优先、外装可选"的分层。

---

## 3. `native/`（3 文件 / 466 行）

### 3.1 文件清单

| 文件 | 行数 | 说明 |
|---|---:|---|
| `job-launch.c` | 200 | Job Object 持有者 helper（issue #144 本体修复） |
| `job-hook-supervisor.h` | 220 | hook 协议 v1 的 supervisor 模式（被 `.c` include） |
| `build-windows.bat` | 46 | 用 vswhere + vcvarsall 编译，输出隔离到 `win32-<arch>/` |

### 3.2 `job-launch.c` 真实行为

文件头注释直接写了它存在的**唯一理由**（`job-launch.c:3-25`）：Windows + Git Bash 下
`nohup node ... &` 会逃过 `taskkill /T`（Win32 父链在 `nohup` 处断开，已实测），
而且**"先 spawn 壳、再 assign 进作业"实测无效**——MSYS 只认"出生就在作业里"。

所以它只做四步（外加一个 watchdog）：

1. `CreateJobObjectW` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
2. `AssignProcessToJobObject(g_job, GetCurrentProcess())`——**先把自己放进作业**
3. `CreateProcessW` 真正的命令，**继承自己的 std 句柄**（零 stdio 中转，管道与退出码语义不变）
4. `WaitForSingleObject` 子进程 → 用自己的退出码退出；进程退出即关闭最后一个 job 句柄 →
   `KILL_ON_JOB_CLOSE` 带走整棵树（不需要枚举进程表）

关键 API 与细节：

- `quoteArg()`（`job-launch.c:29`）：完整实现 MSVCRT 引号规则（反斜杠双写、`"` 转义）。
- `--parent-pid` watchdog（`parentWatch`）：父进程消失即 `TerminateJobObject`。
- **PID 复用防护**（`job-launch.c:150-175`）：用 `GetProcessTimes` 比较创建时间，
  若"父进程"比我们更晚创建 → 说明真父已死、pid 被回收 → 当父死处理。注释说明
  必须严格 `>`（FILETIME 粒度可能相等，相等不能收树）。
- `cmd.exe /c` 特判（`job-launch.c:120-130`）：cmd 不用 MSVCRT 转义，改为先把脚本路径塞进
  环境变量 `RIVET_HOOK_SCRIPT`，再拼 `/d /v:off /s /c ""%RIVET_HOOK_SCRIPT%""`，
  避免二次转义。
- 三个模式开关：`--hook-capabilities`（输出版本探针 JSON）、`--hook-supervisor`
  （走 supervisor）、`--hook-child`（supervisor 内部再 spawn 的子进程模式）。

### 3.3 `job-hook-supervisor.h` 真实行为

这是给"外部 hook 脚本"用的加固执行器。协议 v1：**5 字节帧头（1 字节 kind + 4 字节长度）**
+ payload，双向走 stdio。

| kind | 方向 | 语义 |
|---|---|---|
| 1 | child→parent | `hello`（4 字节 version=1） |
| 2 | parent→child | `input`（hook stdin 内容，**只接受一次**） |
| 3 | parent→child | `cancel`（length=0） |
| 4 / 5 | child→parent | `stdout` / `stderr` 分帧 |
| 6 | child→parent | `done`（int32 exitCode + clean + flags） |

实现细节值得注意：

- `hsControl`（`job-hook-supervisor.h:50`）用 `InterlockedCompareExchange(&inputSeen,1,0)`
  保证 input 只接受一次，重复帧直接终止。
- 子进程用 `CreateProcessW(..., CREATE_SUSPENDED | CREATE_NO_WINDOW |
  EXTENDED_STARTUPINFO_PRESENT)` + `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 只继承三个管道句柄，
  **在 `ResumeThread` 之前 `AssignProcessToJobObject`**——保证"第一条指令前已入作业"。
- 收尾（`done:` 标签）：`QueryInformationJobObject(JobObjectBasicAccountingInformation)`
  看 `ActiveProcesses`，非 0 就 `TerminateJobObject(124)` 并置 `flags |= 1`
  （= 后台进程残留），1.5s 内轮询到 0 才算 `clean`。
- 父进程比子进程更晚创建也判失败（`job-hook-supervisor.h:120-128`，同 pid 复用防护）。

### 3.4 接线（内核侧如何使用）

| 位置 | 作用 |
|---|---|
| `src/tools/process-kill.ts:117-274` | `resolveJobLauncher()` 从自身目录**上溯 ≤5 跳**找 `native/job-launch.exe` 或 `dist/native/job-launch.exe`（含进程级缓存与 `RIVET_JOB_LAUNCHER` 覆盖）；`jobLaunchArgv()` 定义 argv 契约；`spawnShell()` / `spawnOwnedCommand()` 是统一出口 |
| `src/tools/process-kill.ts:taskkillArgs` | Windows 一律 `['/F','/T','/PID',pid]`——注释实测：不带 `/F` 的 `taskkill /T` 对 console 子进程是 **no-op**，那 3 秒"优雅期"纯空转 |
| `src/hooks/hook-job-launcher.ts:1-50` | 找 helper 时除路径外还校验 **PE 头 + machine 类型**，并执行 `--hook-capabilities` 确认 `hookProtocol === 1`（不兼容的旧 exe 不会被误用） |
| `src/hooks/windows-hook-process.ts:68` | spawn `--hook-supervisor --cwd … --parent-pid … --timeout-ms …`，帧解码后把 `flags&1` 映射为失败原因 `background_process_left` |
| `scripts/pack-job-launcher.js:43` | 打包期按目标架构编译（本机缺 MSVC 时复用已跟踪的 `win32-<arch>/job-launch.exe`），**临时名 + rename** 原子替换，落盘前后各做一次 PE/架构断言 |

### 3.5 可学 / 不学

**可学**

1. **"出生在作业里"这一条**：这是 Windows 上唯一可靠的进程树收口方式；`taskkill /T`
   在 `nohup`/MSYS 场景下不可靠，这条结论有实测记录支撑。
2. **零 stdio 中转**：helper 继承句柄，父进程仍直接读写管道——不引入转发层，退出码/EOF 语义不变。
3. **PID 复用防护**：比较进程创建时间，而不是相信 pid。
4. **`clean` 语义**：收尾时检查 `ActiveProcesses`，把"脚本留下了后台进程"变成可见失败，
   而不是静默清理。
5. **helper 能力探针**（`--hook-capabilities`）+ PE machine 校验：升级/换架构时不会静默降级。

**不学**

1. **自维护 200 行 C + 220 行头文件**：只有 Windows 需要，且必须随包分发编译产物；
   成本在于"每个架构都要 CI 编译 + 签名 + 校验"。若我们的代码签名/发布链路还不成熟，
   先做"打包期编译 + 启动期探测 + 缺失时 fail-open"的降级路径更现实。
2. **supervisor 的完整 hook 协议**：只有"需要捕获脚本 stdin/stdout 并判定后台残留"时才需要；
   普通命令执行用 `job-launch.c` 的简单模式就够了。

---

## 4. `src/tools/computer-use/`（4 文件 / 418 行）

### 4.1 文件清单

| 文件 | 行数 | 角色 |
|---|---:|---|
| `stub.ts` | 164 | 开源侧工具定义 + 审批镜像（真身在 `src/pro/`，**不在本快照**） |
| `bridge.ts` | 60 | 闭源桥：`existsSync` 探测 + 变量路径动态 import + 静默降级 |
| `app-grants.ts` | 123 | 应用级"始终允许"授权表（机器级，`~/.rivet/computer-use-grants.json`） |
| `__tests__/app-grants.test.ts` | 71 | 授权表用例 |

### 4.2 真实行为

- **能力面**：`computer_use` 一个工具承载 25 个 action（`check_permissions`/`diagnose`/
  `sequence`/`list_apps`/`snapshot`/`find`/`wait_for`/`click`/`double_click`/`right_click`/
  `scroll`/`drag`/`type`/`set_value`/`key`/`wait`/`focus_app`/`launch_app`/`menu_select`/
  `paste_text`/`navigate`/`read_page`/`js_eval`/`tabs`/`browser_adopt`）。
  描述文本本身就是产品文档（截图 artifact、AX 树为推理依据、ref 缓存失效与自动重试、
  8s 采集预算、`feedback:false` 关掉 diff、CN 文本自动走剪贴板绕开 IME）。
- **审批档映射**（`stub.ts:20-26`）：
  `NO_APPROVAL_ACTIONS = {check_permissions, diagnose, wait}`；
  `ALWAYS_APPROVE_ACTIONS = {js_eval, browser_adopt}`（任意代码执行/端点接管，**永不免审**）；
  `list_apps` 因"会暴露运行中应用清单"而**恒门控**；其余动作要求 `app` 且该 app
  已在授权表中（fail-closed）。
- **`sequence` 的单次审批**（`stub.ts:requiresApproval`）：空/畸形必审；含
  `js_eval`/`browser_adopt` 必审；纯免审步骤免审；否则**所有需 app 的步骤必须指向同一个
  已授权 app**——"按最严格步骤定档"。
- **超时按动作分档**：`snapshot`/`find`/`wait_for` 90s，`sequence` 为
  `min(600s, 60s + 30s×步数)`，其余 60s。
- **平台门控**：`isEnabled = (darwin|win32) && proEnabled`；公开构建里
  `loadComputerUseImpl()` 返回 null → 工具返回"实现为 Pro 闭源模块"错误，不崩。
- **授权表**（`app-grants.ts`）：机器级（非项目级），损坏文件视为空表（fail-closed），
  `resolveRememberedComputerUseApp()` 只在"单 app"或"所有步骤同一 app"时记住。

### 4.3 可学 / 不学

**可学**

1. **"动作 → 免审/必审/门控"三张表**，比一句"敏感操作需确认"可执行得多。
2. **`sequence` 的定档规则**（取最严 + 同 app 约束）——批量操作既省往返又不放宽安全。
3. **无障碍树优先、坐标兜底**；`find`/`wait_for` 解决"大树输出爆炸"。
4. **应用级 always-allow 持久化**（机器级而非项目级：信任某 app 是"这台机器用户"的属性）。
5. **导出不可用时不崩**（闭源模块缺失 → 明确错误 + 状态端点报不可用）。

**不学**

1. **25 个 action 塞进一个工具**：schema 巨大、描述上千字、模型选型空间过大；
   我们应按"读/写/浏览器"拆成 3–4 个工具。
2. **闭源真身**：驱动层不在本仓，无法审计"截图存哪、坐标越界怎么办、权限被拒如何处理"——
   我们要么全开源，要么不提供该能力。
3. **`js_eval` 与自动化共用一套审批**：即使永不免审，也应与普通点击分开计费/记审计。

---

## 5. `src/agent/worker-process/`（5 文件 / 1304 行）

### 5.1 文件清单

| 文件 | 行数 | 角色 |
|---|---:|---|
| `protocol.ts` | 153 | stdio NDJSON 线协议 + 帧编解码 + 心跳/宽限常量 |
| `parent.ts` | 368 | OOP runner：spawn / watchdog / kill ladder / 终态映射 |
| `child.ts` | 322 | 子进程入口：重建运行时 → `runWorkerSession` → 上行 result |
| `__tests__/worker-process.test.ts` | 415 | 用例（含分派路径、watchdog、帧序列） |
| `__tests__/hook-host-wiring.test.ts` | 46 | hook RPC 接线 |

### 5.2 真实行为

**目标**：把"worker 卡死连累主 TUI"隔离到子进程，粒度可选。

**开关与粒度**（`parent.ts:workerIsolationMode`）：
`RIVET_WORKER_ISOLATION=1|true|all` → 全部 worker 走子进程；`=review` → 只隔离
`profile === 'reviewer'` 的审查 worker；未设 → 进程内（**v1 默认关**，注释说明要"烧机一个版本再翻默认"）。

**协议**（`protocol.ts`）：NDJSON（JSON + `\n`），父写 `child.stdin`、子写 stdout，
stderr 留给子进程诊断（父侧收进 40 行环形缓冲，失败时随结果带出）。

Parent→Child：`init`（完整序列化配置 + 用户指令快照 + 记忆块 + activeClaims +
可能先到的 `steerSeed`）、`steer`、`abort`、`hook-response`、`pro-deny`。
Child→Parent：`activity`、`nested`（嵌套委派活动）、`mailbox`（子进程发消息桥回父侧
真实 InMemoryMailbox）、`tick`（5s 心跳）、`log`、`result`（含
`messages`/`usage`/`transcript`/`checkpoint`/**`prefixProof`**/**`frozenSnapshot`**）。

**父侧**（`parent.ts:runWorkerSessionOop`）：

- Unix 上 `detached: true`（否则 `kill(-pid)` 组杀打不到 stdio MCP/LSP 后代）；
  Windows 交给 `taskkill /T`。
- watchdog = `deriveWorkerStallMs(...)` 与 `4 × tick` 取大；`activity`/`tick` 任一重置。
- 击杀梯度：`SIGTERM` → 300ms → `SIGKILL`（`CHILD_TERM_GRACE_MS`）。
- 终态后再等 5s 做"post-result cleanup"（组杀已死 worker 遗留的进程组）。
- `abort` 监听**在 settle 时摘除**——注释记录过真实泄漏：会话级 `AbortSignal.any()`
  会让闭包（含完整 initPayload）挂在会话生命周期上，长会话第 11 次委派触发
  `MaxListenersExceededWarning`。
- 子进程崩溃/停摆 → 合成 `failed` WorkerResult（`worker_crash` / `stalled`），
  **不自动重派**（`terminalFailure: true`）。
- 入口缺失 / spawn 失败 → 直接 `WorkerOopUnavailable`，**不偷偷退回进程内**。

**子侧**（`child.ts`）：

- `--worker-child` 入口守卫（防被 import 误启）。
- 首帧必须是 `init`；父子进程都用同一 `deriveWorkerSessionId(order.id, nonce)`，
  避免"同一 work order 在父子进程各拿一个 sessionId，被上游当成两段对话"。
- **按 `runtimeDecision` 忠实重建** client/promptEngine，**不重跑路由**（父进程决策是唯一事实源）。
- 用 `createInteractiveToolRegistry` + `allowedTools` 过滤重建注册表；缺工具直接报错
  （`Isolated worker tool catalog unavailable`）而不是静默少工具。
- 嵌套委派在子进程内走**进程内** coordinator（防进程爆炸）。
- `result` 写出后 `process.stdout.end(cb)` 再 `exit`——注释记录过真实事故：
  `process.exit()` 不等 pipe 冲刷，几十 KB 的 result 会被截断，父侧只能判 `worker_crash`。
- 启动异常也写一条 `log` + 一条失败 `result`，让父侧拿结构化失败而不是干等 watchdog。

### 5.3 可学 / 不学

**可学**

1. **"隔离粒度可选 + 默认关 + 窄口径 review 模式"**：先只隔离已知会卡死的那类 worker。
2. **心跳 + watchdog + 击杀梯度**三件套，是子进程模型的必备件。
3. **父子同 sessionId 派生规则**写成注释并落地，避免"看起来同一条会话、实际两条"。
4. **`prefixProof` / `frozenSnapshot` 随结果上行**：续跑时继承冻结前缀，避免冷启动全量重建。
5. **`stdout.end()` 再退出**：这是踩过坑的细节，值得直接抄。
6. **abort 监听摘除**：长会话里最容易被忽略的泄漏点。

**不学**

1. **NDJSON 单工 + 大量特例消息**（`pro-deny`/`pro-drained`/`hook-request` 混在同一流）：
   我们要做就分两条通道（数据面 / 控制面），否则协议会越加越乱。
2. **`initPayload` 直接把整份配置与历史塞进一帧**：大 history 时首帧巨大，
   更适合"引用 + 拉取"。
3. **v1 的众多 no-op 降级**（prewarm/stigmergy 不注入、mailbox 只单向）：说明这套模型对
   主进程状态耦合仍重；我们应先把状态边界设计干净再拆进程。

---

## 6. `website/`（63 文件 / 7646 行，营销站）

读的是与产品功能相关的部分，纯视觉组件只登记：

| 文件 | 行数 | 与产品的关系 |
|---|---:|---|
| `src/components/DownloadSection.vue` | 116 | 三平台下载卡，链接指向 `github.com/huiliyi37/**Tianshu-Tui**/releases/latest`（**旧仓库名**） |
| `src/components/QuickStart.vue` | 96 | 三步安装：`git clone` → `npm install && npm run build` → `node dist/cli/entry.js` |
| `src/components/Galaxy.vue` / `StarSkills.vue` / `BigDipper3D.vue` / `StarfieldCanvas.vue` | 354 / 290 / 139 / 132 | 星域/北斗视觉叙事 |
| `public/star-icons/*.svg`（11）、`public/council-icons/*.svg`（11） | 各 11–15 | 星域/议会图标资产 |
| `src/composables/useI18n.ts` | 231 | 中英文案 |
| `vite.config.ts` / `package.json` | 17 / 29 | Vue3 + Tailwind4 + three/ogl |

结论：

1. **站点不承载产品功能**，没有版本 API、没有下载计数、没有更新检查——纯静态营销页。
2. 但它暴露了一个**真实产品缺陷**：下载页用旧仓库名 `Tianshu-Tui`，README 用
   `Tianshu-harness`，安装脚本走 npm 包 `tianshu-harness`，三处不同源
   （对比 `scripts/releases/README.md` 里"catalog 与 website 保持字节一致"的纪律，
   说明这条纪律没有覆盖到"下载按钮 URL"）。
3. 星域/议会叙事（11+11 图标、Galaxy 组件）是**纯产品表达层**，与 `src/constellation/`
   （9 个文件：`schema`/`store`/`milestone`/`format` + 5 个测试）不是同一件事；
   后者才是代码。这也印证了"星域是叙事包装"的判断——不建议我们引入。

---

## 7. `scripts/`（228 文件 / 26589 行，按产品相关度选读）

读过的产品相关文件（其余约 205 个文件按目录归类登记，见 §10.2）：

### 7.1 安装器

| 文件 | 行数 | 关键行为 |
|---|---:|---|
| `install-tui.ps1` | 79 | Node 版本安全下限（`24.22.1+` 或 `26.12.1+`，注释写明"未包含 2026-10-21 安全修复"）；**npm 全局目录可写性预检**（写探针文件，失败直接给修法而不是误诊成网络问题）；旧包 `tianshu-tui` → 卸载再装 `tianshu-harness`；`-NoLaunch` 从 `$args` 读（因为远程 `irm|iex` 不能带 `param()`） |
| `install-tui.sh` | 111 | 同口径的 POSIX 版本 |

### 7.2 打包

| 文件 | 行数 | 关键行为 |
|---|---:|---|
| `pack-native.js` | 262 | better-sqlite3 二进制 ABI **必须等于目标运行时 ABI**，否则构建期 fail-closed（防"发到用户手里才发现跨会话知识失能"）；逃生舱 `PACK_NATIVE_SKIP_ABI_CHECK=1`；目标 Node 版本从 `fetch-node-runtime.js` 单一同源导入 |
| `pack-job-launcher.js` | 43 | 按目标架构编译 helper；`copy → 断言 → rename` 原子替换（注释：先删后拷中途失败会丢掉有效 helper） |
| `stage-plugins.js` | 79 | 剥 `node_modules`/`__tests__`/lockfile/`.git`，只发插件源码 + manifest；产物落 `desktop/src-tauri/resources/plugins-staged` |
| `stage-runtime-deps.js` | 320 | 运行时依赖闭包裁剪（未逐行读，仅看用途注释） |

### 7.3 发布与更新控制

| 文件 | 行数 | 关键行为 |
|---|---:|---|
| `releases/catalog.mjs` | 80 | schema v1，版本/平台/purpose 与包字节强绑定 |
| `releases/generate-catalog.mjs` | 72 | 生成 catalog；`--atomgit` 做匿名实读校验后才写 `verified:true` |
| `releases/publish-routing.mjs` | 85 | 不可变字节、单调 revision、version-pinned 关账 |
| `releases/anonymous-download.mjs` | 121 | 匿名完整回读 + 精确 `Range` 请求校验（必须 206 + `Content-Range` 正确），不保留签名临时 URL |
| `releases/update-control.mjs` | 109 | **受控灰度的状态机**：`validateControl`（revision 单调、revoked 只增、stable 不可被 revoke）、`chooseControl`（冲突/回滚/撤销被移除一律报错）、`bucket(id,version,platform) = sha256(...)%10000` 分桶、`transition()`（stage/set-percentage/pause/resume/revoke/promote）、`validateEvidence(...)`（promote 必须 `realSignedUpgrade === true`） |
| `releases/publish-update-control.mjs` | 246 | CLI（默认 dry-run，`--publish` 才写远端；失败保留 transaction receipt 供重试） |
| `releases/compose-release-body.mjs` | 104 | 强制安装前言（单一来源 `docs/releases/install-preamble.md`），缺失即 fail-closed |
| `cloudflare-update-worker/src/worker.js` | 132 | 反代 GitHub release：**资产名白名单正则**（防被当通用代理）、`latest.json` 不缓存且**改写内嵌资产 URL**到镜像路由、大文件流式透传不缓冲 |

实测边界：`update-control.mjs` 只被发布工具链 import，`src/` 内**没有任何引用**
（grep 无命中）——客户端 updater 在 `desktop/`（不在本快照）。所以"客户端如何分桶、
何时检查、如何回滚"**不可核对**。

### 7.4 诊断

| 文件 | 行数 | 关键行为 |
|---|---:|---|
| `self-audit-report.ts` | 318 | 只读扫会话目录出 Markdown：静态层（assembly-audit）、运行时 advisory 指标、cache 命中摘要、帧准入、双声源叠发检测；**读数落在不可能区间即 `exit 2`**（防止"跑通了但输出假数据"） |
| `diagnose-tool-orphans.ts` | 341 | 检查 `tool_call ↔ tool_result` 配对完整性 + 邻接违规（tool 消息必须紧跟 assistant） |
| `verify-cache-hit-rate.ts` | 217 | 真实 DeepSeek 20 轮对话，逐轮记录 cache hit/miss（**要 API key，属付费实验**，本附录未执行） |
| `serve-startup-report.ts` | 556 | serve 启动图与耗时报告（未逐行读） |
| `verify-worker-isolation.ts` | 204 | worker 隔离模式验证（未逐行读） |

值得单独记的一条：**会话 JSONL 每行可能带 `|<hash>` 完整性后缀**，解析前要剥离
（`self-audit-report.ts:parseSessionLine`、`diagnose-tool-orphans.ts` 同款处理）——
这是"append-only 事件日志 + 防篡改"的落地细节。

---

## 8. 根 `package.json`（安装与自动更新视角）

- `bin`：`rivet` 与 `tianshu` **都指向** `dist/cli/entry.js`（`rivet` 是兼容别名，
  扩展侧 CLI 探测用的是 `rivet`，文案已逐步改叫 `tianshu`）。
- `engines`：`^24.22.1 || ^26.12.1`——只支持两个含安全修复的 LTS 线，安装脚本会硬拦。
- `files`：发布 `dist/`，但**排除** `dist/native`、`dist/pro`、`dist/node_modules/**`
  （只保留 `better-sqlite3`）——即 npm 包不带 Windows helper、不带闭源模块；
  CLI 安装时靠 `postinstall` 重编 sqlite。
- `postinstall`：`check-mobile-env → install-git-hooks → fetch-native-sqlite →
  prune-installed-wasms`，每步都 `|| node -e 1` 兜底（失败不影响安装）。
- `scripts`：`test` 走自研 runner（`scripts/run-node-tests.ts`，272 行，支持
  unit/integration/fast/incremental 分类）；`budgets:check`、`surfaces:check`、
  `structure:check` 是三项架构门禁（源码预算、注入面、结构守卫）。
- **自动更新**：仓库内只有"控制协议 + 镜像 + 发布工具"，客户端 updater 不在公开仓；
  桌面端走 Tauri updater + `latest.json`（`latest.json` 里每个平台带 `signature`）。

---

## 9. 三个特别问题的回答

### 9.1 VS Code 扩展是不是独立产品？

**不是。它是同一产品的"编辑器皮肤 + 本地落地层"。** 证据：

1. `src/extension.ts:1-5` 头注释：插件内不实现任何 agent 逻辑，智能全在 sidecar。
2. `README.md` 工作原理图：扩展宿主只做三件事——spawn `serve`、webview 走 HTTP/SSE、
   委托执行（`apply_edit` / `terminal_exec`）。
3. 会话数据与 CLI/桌面共用 `~/.rivet`（`README.md` 数据目录节）；插件另开
   `sidecar-data` 子目录**只为避免与桌面端抢锁**（`extension.ts:36-65` 注释）。
4. 所有能力都通过内核 REST 路由暴露（`client.ts` 40+ 个方法一一对应
   `/sessions/...`），扩展没有本地业务状态机（除 UI 层 reducer）。

但它有两块**具备独立产品价值**的部分：

- **编辑器内落地**：红绿 diff 装饰 + CodeLens 人审 + 可见终端 Shell Integration +
  原生双栏 diff + 双步回滚 + 原生 SCM 面板。这部分是"agent 在 IDE 里能不能用"的关键，
  值得独立设计。
- **零依赖自举**：无 CLI 时自动下载运行时（sha256 + 双端点 + 版本回退 + 企业代理
  `EnvHttpProxyAgent`）。

### 9.2 `plugins/` 是不是 DSH 式插件树？

**不是。** 它是"扁平目录 + 动态 import 的 tools 数组 + 三个可选贡献点"，无服务容器、
无依赖解析、无热插拔、无权限强制（详见 §2.5 的五条依据）。

两者真正的差别在**扩展点形状**：

| 维度 | 天枢插件 | DSH 式插件树 |
|---|---|---|
| 扩展单位 | 导出 `tools` 的 npm 包 | 注册 service 的模块 |
| 组合方式 | 扫描目录 + 逐项注册 | 依赖注入 + 生命周期 |
| 冲突处理 | 工具重名整插件拒绝 | 服务覆盖/优先级 |
| 生效时机 | 下一个会话 | 运行时 |
| 权限 | 声明性、不强制 | 由容器约束 |

### 9.3 native Job 钩子能否用于我们 Windows 端进程树清理？

**能，而且这是目前最可靠的方案；但有四个前置条件必须一起满足。**

1. **必须"出生在作业里"**：事后 `AssignProcessToJobObject` 对 MSYS/Git-Bash 派生的后代
   无效（`process-kill.ts:117-140` 与 `job-launch.c` 头注释都记录了实测）。
   所以所有子进程 spawn 必须统一走一个出口（天枢是 `spawnShell`/`spawnOwnedCommand`），
   由 helper 代 spawn。
2. **stdio 必须直通**：helper 继承父进程句柄，不做转发；否则管道语义、退出码、EOF 全要重做。
3. **打包必须带上 helper 并能解析到**：天枢用"上溯 ≤5 跳找 `native/` 或 `dist/native/`"
   + `RIVET_JOB_LAUNCHER` 覆盖 + 进程级缓存；解析失败时 **fail-open**（退回 `taskkill /F /T`）。
   我们要在 CI 里对 x64/arm64 各编译一次，并在启动日志里报告"helper 是否可用"。
4. **需要 `clean` 语义才上 supervisor 模式**：hook 脚本场景要区分"脚本正常结束"与
   "脚本留下了后台进程"（`flags&1` → `background_process_left`）。

迁移路径建议（最小可用）：

```
第 1 步：只抄 job-launch.c 的简单模式（200 行），编译进发布包，启动期探活
第 2 步：把所有子进程 spawn 收敛到一个 spawnOwned() 出口（Unix detached / Windows helper）
第 3 步：清理路径统一为 killOwned(handle)：Windows 杀 helper（KILL_ON_JOB_CLOSE 收树），Unix kill(-pid)
第 4 步：加测试矩阵：普通命令 / 后台孙进程 / 父进程崩溃 / pid 复用 / 超时
```

**不要抄的部分**：supervisor 模式的完整 hook 协议（220 行），除非我们真要做"外部 hook
脚本 + 后台残留判定"。

---

## 10. 覆盖边界（诚实声明）

### 10.1 逐行读过（本次实际打开的全部内容）

- `vscode-extension/`：`src/` 下 **全部 33 个 `.ts`**（含 `vscode-proposed.d.ts`）、
  `webview-ui/src/` 下 **全部 14 个文件**、`package.json`、`esbuild.mjs`、`README.md`、
  `CHANGELOG.md`。
- `plugins/`：`design/`（全部 7 个 js + package.json + SKILL.md）、`office-docx` /
  `office-excel` / `office-pdf`（前 90 行 + 结构与 schema）/ `office-ppt`（前 70 行 +
  schema）、`hello-world`（全）、`tianshu-imbridge`（`index.js`、`README.md`、
  `lib/bridge.mjs` 前 70 行、`lib/serve-client.mjs` 前 40 行、`lib/qq/authorization.mjs`、
  `lib/qq/config.mjs`、`package.json`）。
- `native/`：三个文件全读。
- `src/tools/computer-use/`：`stub.ts`、`bridge.ts`、`app-grants.ts` 全读。
- `src/agent/worker-process/`：`protocol.ts`、`parent.ts`、`child.ts` 全读。
- 内核侧配套：`src/plugins/{manifest,plugin-loader,plugin-installer,plugin-presets,git-source}.ts`、
  `src/server/{plugin-api,plugin-session-cache}.ts`、`src/tools/process-kill.ts`、
  `src/hooks/{hook-job-launcher,windows-hook-process}.ts`（全读）；
  `src/bootstrap.ts` 2400–2500 段。
- `website/`：`DownloadSection.vue`、`QuickStart.vue`、`vite.config.ts`、`package.json`。
- `scripts/`：`install-tui.ps1`、`pack-job-launcher.js`、`stage-plugins.js`、
  `pack-native.js`（前 60 行）、`releases/update-control.mjs`、
  `cloudflare-update-worker/src/worker.js`、`releases/README.md`（全）、
  `self-audit-report.ts`（前 80 行）、`diagnose-tool-orphans.ts`（前 60 行）、
  `verify-cache-hit-rate.ts`（前 45 行）。
- 根 `package.json`、`latest.json`、`update-control.json`。

### 10.2 只读结构/清单，未逐行读

- `vscode-extension/tests/` 23 个文件：读了**全部用例标题**（约 150 条）与 `daemon-lease`、
  `host-lifecycle` 的关键断言命名，未逐行读实现。
- `plugins/*/package-lock.json`（5 个，3835 行）、`office-*/test/smoke.mjs`、
  `tianshu-imbridge/test/*.mjs`（14 个，约 3700 行）：只读结构。
- `website/src/components/` 其余 20 个组件（`Galaxy.vue`/`StarSkills.vue` 等）：
  只登记文件名与行数，未逐行读（营销视觉，非产品逻辑）。
- `scripts/` 其余 **约 205 个文件**：按目录归类登记——`experiments/`（23，实验框架）、
  `verification/` 与 `verify-*`（约 45，缺陷回归验证）、`releases/` 其余（16）、
  `build-*/stage-*/pack-*`（12）、`benchmark-*`/`run-benchmark`（5）、
  `docs-index`/`contributors`/`gen-*`（8）、`__tests__/`（56，脚本自身的测试）、
  其余为一次性诊断与平台适配脚本。

### 10.3 不可核对（快照缺失或需付费/外部环境）

1. `desktop/`：Tauri 壳、客户端 updater、Rust 侧 IPC——**源码不在本仓**，
   凡涉及"客户端如何分桶/何时检查/如何回滚"的结论均未验证。
2. `src/pro/`：`computer_use` 真实现——不在本仓，驱动、AX 树、CDP、截图存储全部未审计。
3. 真实 QQ 连接（imbridge 的群聊路径 README 自述"尚未实机验证"）。
4. 真实 GUI 自动化、真实签名升级（`realSignedUpgrade` 只有发布记录，无法在本机复现）。
5. `verify-cache-hit-rate.ts` 需要真实 DeepSeek key（付费）——本附录未执行。
6. 本机安装的 4.0.4 与源码 3.37.4 的差异：本附录只描述源码，未逐项对比 4.0.4 行为。

### 10.4 与主报告的关系

`docs/source-analysis/tianshu.md` 覆盖 `src/` 内的调用链与缓存经济学；本附录只补
`src/` 之外（以及为解释插件/native 而必须回看的 `src/plugins`、`process-kill`、
`hooks` 三个横切模块）。两份文档不重叠，也不存在"全仓每个文件都逐行读完"的说法。

## 11. 天枢 src/ 之外全功能清单

| 功能 | 证据（文件:行/节） | 成熟度 | 采用建议 |
|---|---|---|---|
| 编辑器内红绿 diff + 接受/拒绝 | `delegation/executor.ts:153`、`diff-decorations.ts` | 高（有冲突检测与回滚） | **采用**（NORMA/EVA 都需要） |
| 可见终端执行 + Shell Integration | `executor.ts:301`、`detectShellIntegration:370` | 高 | **采用**，但加命令白名单 |
| 变更审查树 + 基线双栏 diff | `views/changes-view.ts` | 高 | **采用** |
| 双步确认回滚 | `changes-view.ts`（preview token → rollback） | 高 | **采用** |
| 原生 SCM 变更面板 | `scm/source-control.ts:92` | 中 | 可选用（VS Code 特有） |
| 一键生成提交语（headless） | `scm/commit-message.ts:123` | 高 | **采用**（`-p --json` 无持久会话） |
| 会话租约 + Reload 重连 | `launcher.ts:213/252/372` | 高（17 条租约竞态用例） | **采用**（桌面/IDE 双端必然遇到） |
| 崩溃自动重启 + 退避 | `extension.ts:257-340` | 高 | **采用** |
| 自举运行时下载 | `runtime-downloader.ts:138` | 高（sha256 + 双端点 + 回退） | **采用**（但换我们自己的分发源） |
| Windows npm shim 解析 | `sidecar/cli-command.ts:18` | 高 | **采用**（避免 prompt 进 `cmd.exe`） |
| 协议编译期 SSOT | `sidecar/protocol.ts:1-40` | 高 | **采用** |
| Chat participant 桥 | `chat/participant.ts` + 4 个守卫模块 | 高（踩坑记录完整） | **采用思路**（EVA 用） |
| 审批感知超时 | `chat/turn-timeout.ts` | 高 | **采用** |
| 权限档位桥（UI→内核） | `chat/permission-bridge.ts` | 中（单向、状态机简单） | **采用思路** |
| Token 账本（本机 + 显式同步） | `token-ledger-bridge.ts`、`TokenLedgerPanel.tsx` | 中 | 可选用（我们更需要成本面板） |
| 扁平插件目录 + tools 导出 | `plugin-loader.ts:104` | 中（无热插拔/无权限） | **部分采用**（见 §2.6） |
| 插件让位机制 | `plugin-loader.ts:133` | 高 | **采用** |
| 插件路径安全（realpath + 参数替换） | `plugin-loader.ts:wrapPluginTool` | 高 | **采用** |
| 插件安装（npm --ignore-scripts / git clone） | `plugin-installer.ts`、`git-source.ts` | 中 | 可选用（供应链风险在用户侧） |
| Windows Job Object 进程树 | `native/job-launch.c`、`process-kill.ts:117-274` | 高（有实测依据） | **强烈采用**（见 §9.3） |
| hook supervisor 协议 | `native/job-hook-supervisor.h` | 中 | 暂不采用 |
| computer_use 审批三表 | `computer-use/stub.ts:20-26` | 高（设计层） | **采用设计**，实现自研 |
| computer_use 应用级 always-allow | `computer-use/app-grants.ts` | 高 | 若做 GUI 自动化则采用 |
| GUI 自动化真实现 | `src/pro/`（**不在快照**） | 不可核对 | 不采用（自研或不做） |
| worker 子进程隔离 | `worker-process/parent.ts` | 中（v1 默认关） | **采用骨架**（心跳/watchdog/kill ladder） |
| 冻结前缀快照随结果上行 | `worker-process/protocol.ts:SerializedWorkerRun` | 高（思路） | **采用**（与天枢前缀缓存同源） |
| 受控灰度更新协议 | `releases/update-control.mjs` | 高（证据门禁严格） | **采用协议设计**（客户端 updater 自研） |
| Cloudflare 更新镜像 | `cloudflare-update-worker/src/worker.js` | 高（白名单 + URL 改写） | 可选用（若需国内加速） |
| 安装器（Node 版本 + npm 权限预检） | `install-tui.ps1` | 高 | **采用思路** |
| 构建期 ABI fail-closed | `pack-native.js` | 高 | **采用**（凡带原生扩展都要） |
| 自审计报告（不可能区间 fail loud） | `self-audit-report.ts` | 高 | **采用** |
| tool_call/result 配对诊断 | `diagnose-tool-orphans.ts` | 高 | **采用**（我们的工具流水线正需要） |
| 前缀缓存命中率实测脚本 | `verify-cache-hit-rate.ts` | 高（但需付费 key） | **采用脚本形态**，按预算跑 |
| 官网营销站 | `website/` | 低（下载链接已漂移） | 不采用其做法；可借鉴"下载页与 catalog 同源"的反面教训 |
| 星域/议会视觉叙事 | `website/public/star-icons`、`council-icons` | 产品表达层 | **不引入**（与既定决策一致） |

---

