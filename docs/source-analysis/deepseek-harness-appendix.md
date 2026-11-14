# DeepSeek Harness 源码补读附录

本文件是 `deepseek-harness.md` 的补读附录，只补三件事：`apps/` 六个应用的实际实现、持久化与格式迁移的物理机制、以及压缩 / 审批 / 工作区 / 事件模型 / 工具流水线的源码级证据。

源码：`D:\卡塞尔学院\research-src\deepseek-harness`
快照：`master` / `39163dd3`（dsh-0.2.2-rc.3，Merge PR #8422）
本机安装：`0.2.1-rc.2`（比源码旧，不能把本文当本机行为）

证据标注：

- **【源码】**：实际打开了实现文件，并核对到具体类型、默认值、行号或调用顺序。
- **【文档】**：只读了 `docs/` 或包 README，未读实现。

行数口径：本文表格里的行数是本次一次性统计（空行不完全计入），与按行号定位时看到的行号可能差几行空行。**引用位置以 `file:line` 的行号为准，表格行数只用于判断文件体量。**

本文不修改主报告，只补它明确留空的边界。凡与主报告结论不一致处，在第 0 节列出。

---

## 0. 本附录对主报告的三处修正

| 位置 | 主报告原来写的 | 补读后的事实 | 影响 |
|---|---|---|---|
| §2.6 持久化 | 标为【文档】："一代一个文件，提交后的代文件永不改名/替换/删除" | 结论方向对，但机制远不止"一代一文件"。有临时文件 + fsync + `link()` 独占发布、损坏尾部截断修复、追加失败回滚、跨进程内核锁、zstd 帧级 checksum、迁移期源 identity 校验。【源码】 | 这条从【文档】升级为【源码】，且新增 8 个必须知道的细节（见第 2 节） |
| §2.7 Apps 层 | 只有 6 行目录表，注明"未逐文件分析" | 6 个 app 全部读过入口与核心模块。desktop 是 Electron 壳 + 子进程宿主 + 本地 Web UI 三段式，不是"Electron 里写界面"。【源码】 | 这条从"目录级"升级为源码级（见第 1 节） |
| §2.5 压缩"孤儿锁可检测" | 表述为崩溃留下孤儿锁，"可检测" | 检测方式不是扫描全 log 找未闭合 start，而是**用 `session/end-seed` 边界判定归属**：边界之前的未闭合 start 属于上一生命周期，直接豁免；只有边界之后的未闭合 start 才算 busy。【源码】 | 这是可抄的具体算法，不是概念（见 4.4） |

另外补一处主报告没提的：**压缩锁是"durable 事件"而不是内存锁**。`compaction/start` 一旦 append 成功就已经是锁，进程崩溃后锁仍存在于 log 里，重启读 log 就知道"上次没压完"。这和我们目前"内存标志位"的做法是两个层级。

---

## 1. apps/ 六个应用

### 1.0 一句话结构

六个 app 不是六个产品，是**一套运行时 + 四种外壳**：

```text
                   ┌──────────────── runProfile()  ← apps/cli/src/profile-boot.ts:282
                   │        （读 cordis.yml + cordis.patch.yml 分层，挂插件树）
                   │
  apps/cli ────────┤  dsh <profile>          终端 / headless / web 服务
  apps/desktop-host┤  profile = 'desktop'    Electron 的子进程宿主
                   └───────────────────────────────────────────────

  apps/desktop  ── Electron 主进程：开窗口 + 拉起 desktop-host 子进程 + 加载它给的 http://127.0.0.1:PORT/
  apps/web      ── 同一份 Web UI 的 vite 构建产物：既能被 dsh web 当静态站点服务，也能被 Electron 窗口 loadURL
  apps/desktop-publisher  ── 发布期脚本（COS 上传 + 灰度 + 更新源 YAML），不参与运行时
  apps/plugin-market-generator ── 构建期脚本（生成插件市场静态索引），不参与运行时
```

关键点：**desktop 里没有 UI 代码的渲染实现**。界面是 `apps/web` 的构建产物，由 `desktop-host` 起一个只监听 `127.0.0.1:0`（随机端口）的 HTTP 服务来提供，Electron 只负责开窗、注入 preload、加载那个 URL。所以"桌面端"和"网页端"共享同一份前端，差别只在外壳能力（文件拖拽、托盘、自动更新、原生菜单）。

### 1.1 apps/cli（`@deepseek-ai/dsh`，v0.2.2-rc.3）

文件清单（`src/`，行数为实测）：

| 文件 | 行数 |
|---|---:|
| `src/bin.ts` | 72 |
| `src/args.ts` | 201 |
| `src/profile-boot.ts` | 349 |
| `src/plugin.ts` | 105 |
| `src/dump-config.ts` | 72 |
| `src/dump-config-schema.ts` | 44 |
| `src/process-shutdown.ts` | 69 |
| `src/startup-diagnostics.ts` | 64 |
| `src/installed-bin.ts` | 26 |
| `src/sdk-source.cordis.patch.yml` | 5 |
| `package.json` | — |

入口：`package.json` 的 `bin: { dsh: "lib/bin.js" }`。

真实行为【源码】：

1. `bin.ts:26 runCli()` 先 `getDshRuntimeVersion()`，再 `parseDshArgs()`，然后按 `invocation.mode` 四路分派：`profile` / `plugin` / `dump-config` / `dump-config-schema`（`bin.ts:31-73`）。
2. `profile` 模式才真正启动运行时：`bin.ts:35 runProfile({ environment: loadLayeredEnv('dsh'), profile, fromDefaultProfile, patchFiles, args })`。
3. 启动失败只捕获 `StartupError` 并走 `reportStartupFailure()` 后 `exit(1)`（`bin.ts:43-47`）；其他异常继续上抛——即"能被诊断的失败给用户看，不能诊断的失败就崩"。
4. `runProfile()`（`profile-boot.ts:282`）在**任何插件 import 之前**做完这些事：
   - 设 `process.env.DSH_USER_AGENT_SUFFIX = dsh-profile/<name>`（`profile-boot.ts:284`）；
   - 装 HTTP 代理（`installProxyFromEnvironment`），注释明确写"在第一个插件挂载前、在任何人发请求前"（`profile-boot.ts:285-286`）；
   - 解析 profile：`PROFILE_ROOT_FILENAME = 'cordis.yml'`（`profile-boot.ts:88`），用户层补丁在 `$DSH_HOME/cordis.patch.yml`（`homePatchPath()` `profile-boot.ts:73`）；
   - `await hostCtx.plugin(PluginPackages, {...})` 挂包管理服务（`profile-boot.ts:342`）。
5. `dsh.profile.bundles` 的加载顺序写在生成的 `cordis.yml` 头注释里：**package.json 的 bundles → cordis.patch.yml → 任意 `--patch` 覆盖层**（`profile-boot.ts:82-83`）。

产品功能点：终端交互、`dsh web` 起 Web 服务、插件增删（`plugin.ts`）、配置导出（`dump-config`）、配置 schema 导出、启动诊断。

与 core 的边界：cli **不含任何 agent 语义**。它的全部工作就是"把一份 YAML 分层解析成插件树，然后交给 cordis Loader"。它的 `dependencies` + `devDependencies` 里出现了 **138 次** `workspace:*` / `workspace:~` 依赖——这正是"它是装配器而不是实现者"的旁证。

可学：

- 启动前固化环境快照（UA、代理）再挂插件的顺序纪律。
- `dump-config` / `dump-config-schema` 作为可回归的配置断言（他们有 `tests/expected/dump-config-schema.json` 快照）。

不学：profile / bundle / patch 三层 YAML 覆盖。同一行配置要在三个文件里找"最后谁赢"，静态推理成本高。

### 1.2 apps/desktop（Electron 壳，重点）

`package.json` 关键字段：`main: "lib/main.js"`、`devDependencies.electron: ^44.7.0`、`electron-builder: ^26.17.0`、`electron-updater: ^6.8.9`。

**结论：是 Electron，不是 Tauri。** 打包器是 electron-builder（`electron-builder.config.mjs` + `config/{windows,macos}-packaging/*.env.example`），Windows 安装器是自定义 NSIS（`installer/*.nsh`、`installer/window-frame.cpp`、8 种语言的 `installer/locales/*.json`）。

进程结构（`src/` 共 86 个文件，含 `src/client/` 与 `src/updates/` 子目录）：

```text
Electron 主进程（src/main.ts，1574 行）
 ├─ createWindow()            BrowserWindow：contextIsolation:true / sandbox:true / preload
 ├─ DesktopHostProcess        子进程：node --expose-internals .../dsh-desktop-host/lib/index.js
 ├─ DesktopBackendController  启停/重启宿主，拿 ready.url
 ├─ 更新子系统                 update-coordinator(263) / update-schedule / mandatory-update-policy(223)
 ├─ 系统能力                   tray / keyboard(259) / file-drag(161) / crash-report(170) / locale(1591)
 └─ IPC                        ipcMain.handle(...) 每个句柄都校验 sender

渲染进程（不是本仓库的 UI 代码）
 └─ loadURL(host 提供的 http://127.0.0.1:PORT/)
```

关键源码点：

- `main.ts:264 createWindow(preload, show, primary)`；`webPreferences` 在 `main.ts:289-292`：`contextIsolation: true`、`sandbox: true`、独立 preload；`titleBarStyle: 'hidden'`（Windows/Linux `main.ts:273`）/ `'hiddenInset'`（macOS `main.ts:280`）——即自绘标题栏。
- 宿主 URL 有严格白名单：`isOwnedHostUrl()`（`host-process.ts:65-75`）只接受 `http(s)://127.0.0.1/`，要求无用户名密码、pathname 恰为 `/`、无 query 无 hash。子进程给别的 URL 直接判非法事件并 `SIGTERM`（`host-process.ts:257-261`）。
- 导航收口：`navigateMain(url)` → `window.loadURL(url)`（`main.ts:517-529`），并且 `will-navigate` 有拦截（`main.ts:369-371`）、`setWindowOpenHandler` 接管新窗口（`main.ts:298`）。
- IPC 收口：每个 handler 先跑 `assertProductSender`（`main.ts:508-515`），要求事件来源是主窗口的**主 frame**，否则抛 `rejected IPC from an unowned renderer`。
- 子进程拉起（`host-process.ts:227-240`）：`spawn(node, ['--expose-internals', ...entry, runtimeDir, projectDir, primaryRuntime, pnpm, nodeBin], { cwd: projectDir, stdio: ['ignore','pipe','pipe','ipc'] })`。**通过 `ipc` 通道而不是 socket 做握手**。
- 握手事件集（`host-process.ts:29-48`）：`starting` / `ready{url, injections}` / `fatal{message, diagnostic}` / `platform-session` / `shutdown-complete` / `file-drag-resource` / `update-tasks` / `quit-inspection`。所有输入都过 `isDesktopHostEvent()` 运行时校验（`host-process.ts:77-124`），包括 `platform-session` 里 header 名必须是 lowercase 且**禁止** `authorization` / `x-dsh-auth-token` / `host` / `content-length` / `transfer-encoding` / `connection` / `content-type`（`host-process.ts:99`）——这是防宿主把凭据头透给嵌入页。
- preload 家族（共 11 个）：`preload-app`、`preload-browser`、`preload-platform`、`preload-platform-account`、`preload-menu`、`preload-theme`、`preload-update-dialog`、`preload-mandatory`、`preload-mandatory-overlay`、`preload-welcome`、`preload-windows`。**按窗口分权**，不是一个大 preload 全给。

产品功能点：多窗口（主窗口 / welcome / mandatory-update / update-dialog / 平台账号视图 / 浏览器受限访客）、托盘、快捷键、原生菜单、文件拖入、崩溃上报与恢复、操作日志（`operation-journal.ts` 分段 256KB / 单条 4096B）、自动更新（含强制更新策略与灰度通道）、单实例、退出确认。

与 core 的边界：desktop **不 import 任何 agent / session / tools 包**。它的 `dependencies` 只有 `electron-updater`、`semver`、`ws`、`dsh-api-gateway`、`dsh-error`、`cordis`。所有业务能力都在子进程里。

可学：

- 外壳与运行时**跨进程隔离**：UI 崩不带走 agent，agent 崩能被外壳重启并保留诊断 stderr 环形缓冲（`host-process.ts:243`）。
- 所有跨进程消息运行期校验（`isDesktopHostEvent`）+ URL/header 白名单，这套"不信任子进程输出"的姿态值得直接照搬。
- preload 按窗口切分权限。

不学：

- NSIS 自定义安装器 + 双通道 + 强制更新的整套发布机制（我们目前没有发布链，收益为 0）。
- `locale.ts` 1591 行的多语言方案（体量与收益不符）。

### 1.3 apps/desktop-host（桌面宿主，`private`）

`src/index.ts` 179 行，是本附录里**信噪比最高的一个文件**。真实启动序列【源码】：

1. `index.ts:23` `receiveDesktopSecret(process)`：**父进程通过 IPC 送来的启动凭据**，不是命令行参数、不是环境变量。
2. `index.ts:24-26` 先发 `{ type:'starting', runId }`，父进程据此才开始投递凭据（`host-process.ts:262-269` 对应接收）。
3. `index.ts:44` `process.env.DSH_PRIMARY_RUNTIME = argv[4] || <runtimeDir>/../runtime/primary-runtime`。
4. `index.ts:46` `loadProfileDirectory('dsh', projectDir, installAnchor)` → `reportSkippedBundles()`。
5. `index.ts:48-65` `runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', args: ['--no-open', '--host', '127.0.0.1', '--port', '0'], ... })`。
   - `--port 0` = **随机空闲端口**，避免固定端口冲突；
   - `--no-open` = 宿主不自己拉浏览器。
6. `index.ts:159` `await ctx.plugin(DesktopAuthentication, { readSecret: () => secret })`。
7. `index.ts:161-164` `ctx.connection.authentication.authenticate({...})`，失败即 `throw`（"Desktop authentication provider did not accept its startup credential"）。
8. `index.ts:165` `const url = ${ctx.webServer.protocol}//127.0.0.1:${ctx.webServer.port}/`。
9. `index.ts:166` `ctx.webServer.collectIndexInjections(...)` —— **把要注入 index.html 的客户端插件脚本列表一起交出去**。
10. `index.ts:168` `process.send({ type:'ready', url, injections })`。
11. 控制通道（`index.ts:85-140`）：`shutdown` / `file-drag-resource` / `file-drag-cancel`；另有 `update-tasks.ts`（inspect/lock/unlock，10s 超时）、`quit-inspection.ts`（2s 超时，超时视为"有未知工作"，外壳再问用户）、`platform-session.ts`。
12. 退出：`application.shutdown.shutdown(0)` → 发 `shutdown-complete` → `disconnect` → `process.exit()`（`index.ts:73-84`）。注释点明"插件没关掉的句柄会让宿主活过优雅退出期限"。

产品功能点：单一 profile 的桌面运行时、父进程认证、随机端口、注入清单、拖拽资源受权读取、退出前"还有没有活"的检查。

与 core 的边界：desktop-host 是 core 的**组装者之一**，自己只做认证、生命周期、IPC 收口。业务全部在 profile 挂载的插件里。

可学（优先级最高的一组）：

- **"凭据由父进程经 IPC 投递、先 starting 再 ready"的握手顺序**；凭据不落 argv/环境变量。
- `--port 0` + `127.0.0.1` 绑定 + URL 回传，而不是约定固定端口。
- `collectIndexInjections` 这种"服务端决定客户端加载哪些脚本"的注入清单机制（我们做前端插件面时会用到）。
- 退出前置检查（有活就别静默退）与超时降级为"询问用户"。

不学：`--expose-internals` 与 `ELECTRON_RUN_AS_NODE` 这类 Node 内部依赖的打包技巧（跟 Node 版本强绑定，升级即碎）。

### 1.4 apps/web（`@deepseek-ai/dsh-web-frontend`）

`src/` 只有 4 个文件：`main.ts`（38 行）、`preview.ts`、`node-module-stub.ts`、`vite-env.d.ts`；真正的 UI 在 `packages/client/*`（74 个包）。

真实行为【源码】：

- 构建= `vite build` → `dist/`，`package.json` 描述明确写"dist/ 由 apps/cli 的 `dsh web` 服务"。
- `main.ts:3` 只做一件事：`new AppWebEntry(el)` + `entry.run()`。
- **同一份产物跑在两个宿主里**：`main.ts:11` 读 `globalThis.dshDesktopBoot`；存在即为 Electron 环境，走 `desktop.ready()` 拿 `{ injections, streamBaseUrl }`，写 `globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }`（`main.ts:24-26`），然后 `applyIndexInjections()` 用 `<script>` 动态加载注入清单（`main.ts:27-33`）。
- 浏览器直连时没有 `dshDesktopBoot`，走 `AppWebEntry` 自己的 transport（连 host 的 WebSocket）。

产品功能点：Web 客户端（会话、工具卡、审批卡、工作区、插件页），以及桌面端完全复用的同一套 UI。

与 core 的边界：客户端只消费 host 经 `typert` 网关暴露的 RPC 与流；不直接读 session log 文件。

可学：

- "一套前端 + 两种宿主 + 启动桥 `dshDesktopBoot`"的接法，比维护两套 UI 便宜得多。
- 客户端脚本由服务端注入清单决定（`applyIndexInjections`），而不是前端写死插件列表。

不学：`window.__DSH_BOOT_READY__` / `__DSH_TRANSPORT__` 这种全局变量做启动同步（隐式契约难测）。

### 1.5 apps/desktop-publisher（发布脚本，`private`）

纯 Node/TS 脚本库，`exports: { "./*": "./src/*" }`，**没有 bin、没有 UI、不被运行时依赖**。28 个文件，代表：

| 文件 | 行数 | 职责 |
|---|---:|---|
| `src/desktop-publish.ts` | 128 | 发布状态机 + 字节摘要（sha512）+ 不可变对象禁覆盖 |
| `src/desktop-publish-cos.ts` | 82 | 腾讯 COS 传输实现 |
| `src/desktop-rollout.ts` | 122 | **只改灰度百分比**，不重传安装包 |
| `src/desktop-release-store.ts` | 150 | 保留版本清单 |
| `src/desktop-purge-recovery.ts` | 142 | 清理失败后的恢复 |
| `src/desktop-website-installer.ts` | 113 | 官网安装器入口 |
| `src/preflight-desktop-publish.mjs` | 45 | 发布前体检 |
| `src/publish-desktop-rollout-ci.ts` | 133 | CI 入口 |

真实行为【源码】：

- `desktop-publish.ts:8` 注释：`/** File identity computed from bytes, never inferred from COS ETags. */` —— 摘要靠读字节算 sha512，不信对象存储的 ETag。
- `DesktopPublishTransport.put(artifact, digest, forbidOverwrite)`：不可变二进制必须 `forbidOverwrite = true`（靠 COS 的禁覆盖能力）。
- 发布事件是**可审计状态机**（`desktop-publish.ts:22-27`）：`object-present` / `put-intent` / `put-verified` / `feeds-complete` / `tag-pending` / `complete` / `failed`，且明确"凭据-free、durably flushed"。失败带 `{phase, code, message}`。
- tag 语义：`tag(): Promise<void>` 注释 "Ensure the production tag names the packaged commit; **never move an existing tag**"。
- `desktop-rollout.ts` 只读已保留的更新 YAML，改 `stagingPercentage`（0-100 整数），并且**不读安装包字节**；元数据 > 1MiB 直接拒。

可学：发布状态机的七态 + "改动前先反查远端字节"的幂等恢复思路（如果以后我们要做发布链）。
不学：现在是 P2/暂不做。我们连安装包发布流程都还没建。

### 1.6 apps/plugin-market-generator（构建期生成器）

9 个文件，CLI 形态（`bin.ts` 3 行 → `cli.ts` 111 行）：

```text
sources.ts(45)         一行一个 npm 包名或 git URL；忽略空行与 # 注释；统一去掉尾部 / 与 .git
   ↓
fetchers.ts(248)       npm packument / tarball、git objects，带 cacheKey 与 FetchLimits
   ↓
packages.ts(191)       读 manifest、判定 isBundle/isPrivate、dshRange
metadata.ts(218)       读展示字段与图标（GENERATED_ICON 兜底）
metrics.ts(72)         github_stars / npm_weekly_downloads（失败即省略，不让发现流程失败）
   ↓
generate.ts(351)       → format-1 索引，未变的 release/commit 复用缓存
   ↓
files.ts(117)          writeIfChanged（内容没变不写盘，避免抖动）
```

真实行为【源码】：`generate.ts:1` 注释即规格——"把源列表变成校验过的 format-1 索引，对未变的 release 与 commit 复用缓存结果"。输出物由 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 校验，即"生成器自己先按消费者 schema 校验自己"。

可学：索引生成器**先做一次消费者校验**（`generate.ts` 调 `parseMarketIndex` 自检）、`writeIfChanged` 幂等写、指标抓取失败降级为省略。
不学：插件市场本身（我们不采用插件生态）。

### 1.7 六个 app 的横向结论

| app | 交付形态 | 是否含 agent 语义 | 与 core 的耦合方式 |
|---|---|---|---|
| cli | npm 全局 bin `dsh` | 否 | `runProfile()` |
| desktop | Electron 安装包（NSIS/dmg） | 否 | 子进程 → desktop-host |
| desktop-host | 私有进程（随 desktop 打包） | 否 | `runProfile({profile:'desktop'})` |
| web | vite `dist/` 静态产物 | 否 | WebSocket + typert RPC |
| desktop-publisher | CI 脚本 | 否 | 无（只碰对象存储与 YAML） |
| plugin-market-generator | CI 脚本 | 否 | 无（只碰 npm/git 与索引 JSON） |

**一句话**：DSH 的 apps 层是"四种外壳 + 两个构建脚本"，业务全在 `packages/` 的插件里。它证明了接口分层能做到什么程度，也暴露了代价——想知道 desktop 到底挂了哪些能力，得读 `packages/bundle/base/cordis.patch.yml`（约 700 行 YAML）而不是读 desktop 的代码。

---

## 2. session-persistence-jsonl 全部源文件

| 文件 | 行数 |
|---|---:|
| `src/index.ts` | 1793 |
| `src/generation.ts` | 994 |
| `src/storage.ts` | 534 |
| `src/format.ts` | 506 |
| `src/win32.ts` | 190 |
| `src/migration-verifier.ts` | 187 |
| `src/zstd-private-decoder.ts` | 162 |
| `src/zstd.ts` | 140 |
| `src/lease.ts` | 127 |
| `src/catalog-migration.ts` | 89 |
| `src/zstd-public-decoder.ts` | 36 |
| `src/worker.ts` | 49 |
| `src/testing/generation.ts` | 15 |

### 2.1 文件格式与命名（`format.ts`）

- 后缀：`.jsonl` 或 `.jsonl.zstd`（`format.ts:42 logSuffix`）。
- 文件名：`session.jsonl`（v0）/ `session.vN.jsonl`（N≥1），见 `packages/session/session-format/src/filename.ts:5` 的正则 `^session(?:\.v([1-9][0-9]*))?\.jsonl$`，`filename.ts:14-17` 生成。
- 解析器**故意不认**：临时名、大写、前导零、`.v0`、带压缩后缀的名字（`filename.ts:20-25` 注释 + `format.ts:62-77`）。理由：只有规范名代表"已提交的代"。
- 第一行永远是 header 记录：`{ type: 'session', version, id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth, agentPreset? }`（`format.ts:83-98`）。
- 必填键集 `['type','version','id','createdAt','isSeeded','delegationDepth']`，可选键集 `['cwd','parentSession','origin','agentPreset']`，**多余键不接受**：`isHeaderLine()` 里逐个 `Object.keys(value).every(key => HEADER_KEYS.has(key))`（`format.ts:96-98`, `format.ts:159-163`）。
- 明确拒绝已退役字段：`sandboxMode` / `approvalPolicy` 出现在 header 里直接抛（`format.ts:105-110`）——它们在 v4 里已从 header 移到 `request/header` 与 `approval/policy` 事件。
- 尾部损坏的恢复策略是**构造期参数**：`SessionFormatRecovery = 'strict' | 'recoverable'`（`format.ts:404`）；`recoverable` 下先记录"可恢复的撕裂前缀"快照再继续（`format.ts:446`），`strict` 下直接抛（`format.ts:485`, `format.ts:513`）。

### 2.2 追加写与 fsync（`index.ts:1464-1519`）

这是最值得抄的一段物理实现【源码】：

```text
appendLines(meta, events)                       // index.ts:1469
  content = encodeEventBatch(events)            // 一批一次编码（zstd 一帧）
  handle = open(path, 'a')
  before = handle.stat().size
  try:
    handle.writeFile(content)
    handle.sync()                               // fsync
  catch:
    close; rollbackAppend(path, before)         // truncate 回 before + sync
    throw                                        // 游标未推进 → 上层会重试整批
```

为什么必须回滚：注释写得很直白——"unchanged cursor will retry the batch; leaving partial bytes would create duplicate sequence numbers"（`index.ts:1465-1468`）。即**宁可把已写的字节删掉，也不让同 seq 出现两次**。

### 2.3 首次落盘 = 原子发布（`index.ts:1320-1427`）

```text
materialize(meta, inheritedCount, events)       // index.ts:1321
 ├─ rejectOppositeArtifact(...)                 // 不允许同一 session 同时存在 .jsonl 与 .jsonl.zstd
 ├─ encodeMaterialization(...)                  // header 单独一帧，事件另一帧（不合并帧边界）
 ├─ win32 ? materializeWin32 : materializePosix
```

**POSIX（`index.ts:1340-1380`）**：

1. 逐级 `mkdir(0o700)` + **每建一级就 fsync 父目录**（`syncDirPosix` `index.ts:1454-1461`）。
2. `writeSyncedTempFile`：`open(tmp,'wx',0o600)` → `writeFile` → `sync`（`index.ts:1417-1427`）。
3. 发布用 **`link(tmp, finalPath)` 而不是 `rename()`**，注释给了理由：`link` 在目标已存在时 `EEXIST`，两个进程并发 materialize 同一个 id 不会互相覆盖；`rename` 会静默覆盖（`index.ts:1355-1357`）。
4. 发布后 fsync 目录（"new link is not crash-durable until the parent directory's metadata is synced"，`index.ts:1368-1371`）。
5. 最后删临时硬链接，且**吞掉删除失败**——"publish already durable, rm failure must NOT reject the append"（`index.ts:1372-1379`）。

**Windows（`index.ts:1384-1402` + `win32.ts`）**：Windows 没有"fsync 父目录"的接口，改用 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH = 0x8)`，禁止替换、禁止跨卷拷贝回退（`win32.ts:1-12`、`win32.ts:39`）。

### 2.4 跨进程写锁（`lease.ts`）

语义全在文件头注释（`lease.ts:1-29`），实现只有 127 行：

- 锁文件 `session.lock` 位于 session 目录（`lease.ts:40`）。
- POSIX：`tryLockExclusive(handle.fd)` 非阻塞 `flock`；`EAGAIN`/`EWOULDBLOCK` → `SessionAlreadyOwnedError`（`lease.ts:48-52`, `lease.ts:90-98`）。
- **锁 inode 校验**（最关键的一条）：flock 锁的是 inode 不是路径，所以拿到锁后要 `stat` 比对 `ino`/`dev` 是否仍是路径上的文件，不一致就重来（最多 3 次）（`lease.ts:99-115`）。否则"锁文件被删掉重建"会锁住一个孤儿 inode，等于没锁。
- **没有过期时间**，且注释明确解释了为什么："no expiry that could expropriate a stalled writer whose resumed appends would tear the log"（`lease.ts:11-13`）。进程崩溃由内核释放，卡死的活进程就一直持有。
- Windows：命名内核信号量（不是文件锁），`createSemaphoreW`/`waitForSingleObject`（`win32.ts:19-22`、`lease.ts:76-86`）。共享冲突 `EBUSY` → `SessionAlreadyOwnedError`。
- 读操作**完全不碰锁**（`lease.ts:19`）：读、搜索、删目录都不受写锁影响。
- 获取时机：打开已有工件时；新建 session 时延到**第一次真正落盘前**（未落盘的 session 在磁盘上零足迹）（`lease.ts:20-22`）。

### 2.5 代文件与迁移发布（`generation.ts`）

- 代文件**不可变**：迁移不是改写源文件，而是**发布一个更高版本号的新文件**（`generation.ts:1-8`）。
- 流式迁移的调度常量：解码片 1 MiB、写片 4 MiB、每 500 ms 让出一次事件循环（`generation.ts:49-51`）。
- 临时文件写作（`generation.ts:715-787`）：`session.migration.<token><suffix>.tmp`，`open('wx',0o600)`，边写边算 **sha256**，最后 `sync`。失败则删除临时文件并把原始异常抛出去（清理失败用 `AggregateError`，`generation.ts:790-803`）。
- 发布前**先验证自己写的临时文件**：`verifyCurrentFile(staged.path, ...)`，并比对 `bytes` 与 `digest` 与写入时记录一致（`generation.ts:896-904`）。
- 发布前**校验源文件没被改过**：`stat(sourcePath)` 的 identity（size + mtime/ctime ns）必须等于开始时的快照，否则 `JsonlGenerationSourceChangedError`（`generation.ts:905-910`, `generation.ts:112-120`）。
- 发布是**独占**的：`link()` 成功=我赢了；`EEXIST`=别人已发布，此时**不报错**，改为校验对方文件与我写的字节完全一致，一致则接受对方（`generation.ts:817-843`, `generation.ts:921-938`）。这是"并发迁移同一 session 也只会有一个赢家，且赢家内容必须等价"。
- 只有在**发布成功并验证**之后才删临时文件；删除失败**不把成功变失败**（`generation.ts:806-815`）。

### 2.6 zstd 层（`zstd.ts` / `zstd-private-decoder.ts` / `zstd-public-decoder.ts`）

- 压缩开启 **帧级 checksum**：`ZSTD_c_checksumFlag: 1`（`generation.ts:52-55`, `session-persistence-jsonl/src/index.ts` 编码侧同款）。
- 撕裂帧恢复：`decompressZstdPrefix(bytes.subarray(tornStart))`（`generation.ts:460-462`）——只解压到损坏点之前，把能读的事件救回来，配合 `storage.ts` 的"撕裂点"状态在第一次新写入时把已恢复事件重写为持久内容。
- 两个 decoder 分公开/私有：`zstd-public-decoder.ts`(36 行) 只要浏览器也能跑的路径，`zstd-private-decoder.ts`(162 行) 走完整能力。

### 2.7 写缓冲与句柄状态机（`storage.ts`）

- `LIVE_WRITE_BATCH_MAX_DELAY_MS = 200`（`storage.ts:37`）：实时流的写入走**写后缓冲**，最多攒 200 ms 再落一盘（`storage.ts:281`），显式 `append` 则进同一条链立即写。
- 每个句柄一条 mutation chain（`storage.ts:1-6` 注释）：同一 session 只有一个 mutator。
- 状态字段（`storage.ts:64-83`）：`tornTailOffset`（撕裂点，第一次新追加前截断用）、`recoveredEvents`（从撕裂帧恢复出的事件，第一次变更时重写为持久内容）、`primed`（写句柄打开时验证过的前缀，供读使用）。
- 关闭顺序（`storage.ts:217-258`）：先排空缓冲 → 再释放写锁；两者都失败时报 `AggregateError`。

### 2.8 崩溃恢复的完整过程（把上面串起来）

```text
进程在追加中途被杀
 ↓
重启 open(write)
 ↓
读 log：SessionLogScanner 逐帧解 → 遇到不完整尾帧
 ↓
recovery='recoverable'：记录 tornTailOffset + 已解出的事件
 ↓
第一次新 append 之前：repair(meta, tornTailOffset) 截断 + fsync   // index.ts:1510-1519
 ↓
恢复出来的事件作为新批重写（保证 log 里没有"半个事件"也没有丢事件）
 ↓
若当时正处在压缩中：log 里留着 compaction/start 没有 end
 ↓
重启不靠"扫描"：靠 session/end-seed 边界判定归属（见 4.4）
```

### 2.9 可学 / 不学

可学（P0/P1）：

1. **追加失败必须回滚到之前 size**，否则重试会产生重复 seq。这是"事件日志"最容易踩的坑。
2. **发布用 link 不用 rename**（POSIX），目标存在即失败，天然防并发覆盖。
3. **锁 inode 校验**：锁文件被重建后必须重试，否则锁了个孤儿。
4. 读不参与写锁；锁不做超时抢占（宁可卡住也不撕裂日志）。
5. 损坏尾部"截断到最后一个完整帧 + 把恢复出的事件重写"的策略。
6. 代文件不可变 + 迁移发布前校验源 identity。

不学（P2/不采用）：

- zstd 双解码器与撕裂帧前缀解压：我们暂时用明文 JSONL，不需要。
- Windows `MoveFileExW` + Koffi FFI：我们用 Rust，标准库/`windows-sys` 更直接。
- 命名信号量做锁：我们单进程单写者，用文件锁或进程内单写者即可。

---

## 3. session-format-* 迁移链

### 3.1 格式层抽象（`packages/session/session-format/src/`，共 8 个文件）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `types.ts` | 208 | 全部契约类型（codec / migration / chain / catalog） |
| `chain.ts` | 236 | 相邻迁移链的编译与校验 |
| `catalog.ts` | 268 | 物理 codec 分派 + 迁移编排 |
| `json.ts` | 87 | 无损 JSON 边界与版本读取 |
| `filename.ts` | 28 | 代文件名规范 |
| `error.ts` | 8 | 两个错误类 |
| `context.ts` | 24 | 事件收集器 |
| `index.ts` | 8 | 导出 |

核心契约（`types.ts`）：

- `SessionFormatMigration { name, fromVersion, toVersion, migrateHeader(), createStage(), validateTargetHeader() }`（`types.ts:45-55`）——**一步只跨一个版本**。
- `SessionFormatMigrationStage { transformEvent(), transformRun(), finish() }`（`types.ts:142-157`）——**流式**，一行一行转，不把整个 artifact 读进内存。
- `SessionFormatCodec { version, decodeHeader(), createDecoder(headerValue, recovery) }`（`types.ts:94-100`）。
- `SessionFormatHeaderReadResult` 四态：`current` / `migration-required` / `unsupported` / `malformed`（`types.ts:167-186`）。

### 3.2 版本检测与不兼容处理（`catalog.ts`）

```text
readHeader(headerValue)                              // catalog.ts:45
 ├─ 读不出版本号            → malformed
 ├─ stored > current        → unsupported("newer format vN; this build writes vM")
 ├─ 无对应 codec            → unsupported
 ├─ decodeHeader 抛 UnsupportedMigrationError → unsupported
 └─ 否则 status = stored === current ? 'current' : 'migration-required'
```

**没有降级路径**：只有"能读"和"拒绝"两种。`chain.ts:81-85` 同理——`stored > current` 直接抛 `SessionFormatUnsupportedMigrationError`，不做尽力而为的字段丢弃。

构造期就完成的完整性检查（`chain.ts:53-76`）：

1. 每条迁移必须 `to === from + 1`（`chain.ts:30-32`）；
2. `fromVersion` 与 `name` 都不能重复；
3. 从 0 到 `currentVersion-1` 的每一段都必须存在，缺一段直接 `SessionFormatUnsupportedMigrationError("vX->vY is missing")`（`chain.ts:64-71`）；
4. 不允许存在"通向未来版本"的迁移（`chain.ts:72-75`）。
5. 每个版本必须恰有一个 codec，多一个或少一个都在构造期抛（`catalog.ts:31-43`）。

**这套设计的效果**：构建时就保证了"读到任何历史版本都有完整链可走"，运行期不需要判断"这个版本能不能迁"。这是我们应该照抄的姿态：【源码】

### 3.3 v0 → v1（`session-format-v0-to-v1`，src 共 2744 行，其中 `payload-validation.ts` 1021 行）

真实行为【源码】：

- 是**身份边**：header 只把 `version: 0` 改成 `1`（`migration.ts:31-34`），其余不变。
- 事件级规范化：`normalizeReleasedV0Event()`（`migration.ts:85`）处理三件事——legacy compaction 类型改名、`messageIds` 重映射、`retryIds` 重映射；还特意用一个拼接常量 `['pro','venance'].join('')` 来表达"这个键名不该出现在新代码里"（`migration.ts:24`）。
- 保留 compact run 不解包：`transformRun()` 遇到已发布的 assistant chunk run 直接原样透传（`migration.ts:59-68`），避免把紧凑块展开成数组。
- 批量校验在 `payload-validation.ts`（1021 行）与 `validation.ts`（210 行）：**为每个已发布版本单独维护一份该版本真实接受的 payload 规格**，不是"按当前 schema 校验历史"。

### 3.4 v1 → v2（`session-format-v1-to-v2`，src 共 1182 行）

- 目的：把 v1 的**顶层 assistant chunk 事件**折叠进 v2 的 `assistant/attempt` / `assistant/message` 内嵌 stream。
- 用 `AssistantStreamAccumulator` 累积（`migration.ts:1-2`, `migration.ts:30-40` 的 `AttemptGroup`），按 `(turn, step)` 分组、记录 `firstSeq`/`eventCount`/`chunkCount`。
- 两套 stage 实现：`DecodedReleasedV1ToV2Stage`（吃物理解码输出）与 `TransformedReleasedV1ToV2Stage`（吃上一条迁移的输出），由 `input.sourceKind` 决定（`migration.ts:51-56`）。**同一版本要支持两种输入来源**，因为链可以独立组合。
- **seq 重排**：`targetSeq` 从 0 重新编号，`targetCut` 单独维护（`migration.ts:70-72`）——迁移后 seq 会变，但"继承前缀长度"要跟着改。

### 3.5 v2 → v3（`session-format-v2-to-v3`，src 共 773 行）

两个变化，都在 `migration.ts` 里能直接看到：

1. **系统提示从 header 提升为事件**：读 `request/header` 里的 `system` 字符串，与上一次的 prompt 比较，变了就 `emitSystem()`（`migration.ts:50-55`）：
   - 生成稳定 id：`'v2-to-v3-system-' + sha256(['session-format-v2-to-v3', sessionId, anchorSeq, anchorType])`（`migration.ts:113-114`）；
   - 首个 system 用 `surfaceOp: 'append'`；后续用 `{op:'replace', start:head, end:head}` 只覆盖自己（`migration.ts:130-133`）；
   - 生成 id 与既有 id 撞车 → `UnsupportedMigrationError`（`migration.ts:115-117`）。
2. **`code` 改名 `ptc`**：`agentPreset: 'code' → 'ptc'`（`migration.ts:18`）、`tool/code-dispatch*` → `tool/ptc-dispatch*`（`migration.ts:145-148`）、`source.plugin: 'tools-code-mode' → 'tools-ptc'`（`migration.ts:169-172`）。

**迁移失败策略**（这段最能说明他们的取舍）：当 v2 的历史在"第一个 step 之前就有 surface 事件"或"在 step 之外改了 prompt"时，抛 `SessionFormatUnsupportedMigrationError`，注释写明理由——"cannot retain source chronology"（`migration.ts:56-58`, `migration.ts:110-112`）。即：**宁可拒绝迁移，也不编造一个时间线**。

### 3.6 v3 → v4（`session-format-v3-to-v4`，src 共 1601 行，17 个 src 文件）

- **声明式边拒绝隐式行为**：导出的 `sessionFormatV3ToV4` 的 `createStage()` 直接抛 `UnsupportedMigrationError('V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children')`（`migration.ts:23-25`）。要真正迁移，必须走 `createSessionFormatV3ToV4(children)`（`migration.ts:34-39`），把该 session 的历史子会话证据显式传进来。
- 为什么：v4 引入了 `subagent/catalog` 事件，而 v3 的子会话关系只存在于别的文件里。没有证据就不许猜——**空数组也必须显式声明**。
- 迁移期间做的转换：
  - 子会话目录插入：按 `childCreatedAt` 再按 `childId` 排序（`migration.ts:56-58`），在 `finish()` 里生成 `subagent/catalog`（`migration.ts:170-171`）；与父目录已有记录冲突且不一致 → `UnsupportedMigrationError`（`migration.ts:155-169`）。
  - **补写被中断的 turn**：发现"上一个 turn 未闭合 + 中间有 next-turn 注入 + 下一个 turn/start"时，补一条 `turn/end { reason: { kind:'interrupted' } }`（`migration.ts:67-71`, `migration.ts:117-135`）。
  - 消息来源重写（`sources.ts`）、tool role 提升（`tool-role.ts` 的 `liftToolResult`）、内容迁移（`content.ts` 的 `migrateV3EventContent`）、未知可忽略事件加命名空间（`extension-identities.ts` 的 `namespaceV3OpaqueEvent`）。
  - **未知事件类型**：`RELEASED_V3_EVENT_TYPES` 之外的、又不是可忽略的 → `UnsupportedMigrationError`（`migration.ts:97-101`）。
  - 继承切点跟着改：`session/end-seed` 处把 `sourceCut`/`cut` 一起更新（`migration.ts:74-78`）。
- 发布侧的配合：`generation.ts` 的 `validateRelatedSources` 用来在发布前确认"相关源（比如子会话文件）也没变"（`generation.ts:906`）。
- `session-format-catalog/src/historical.ts`（21 行）另建了一个 **currentVersion = 3** 的 catalog，只用来"读v0–v3 收集迁移前置事实，绝不发布或补全父目录"（`historical.ts:9-21`）。即：**读历史与写当前是两套 catalog**。

### 3.7 可学 / 不学

可学（P2，但思想 P1）：

1. "一版本一步、相邻、缺一段就构造期报错"的迁移链。我们以后必然要面对 session 格式演进，到时候直接照这个骨架建。
2. 拒绝迁移而不是编造时间线（v2→v3 的两处 `UnsupportedMigrationError` 就是范例）。
3. 需要外部证据的迁移必须显式传参，空数组也要显式（v3→v4 的子会话）。
4. 迁移是流式的（一行一行转），不把整个 log 读进内存。
5. 每版本维护该版本自己的 payload 校验器，不用当前 schema 校验历史数据。

不学：现在（我们连 v1 格式都还没冻结）。列为 P2。

---

## 4. compaction 包

### 4.1 三事件字段（`packages/compaction/compaction/src/types.ts`，116 行，全部读完）

四个事件（主报告说三个，实际是**四个**：多了 `compaction/prune`）：

```ts
'compaction/start': { compactionId, sourceCommandId?, turn: number | null }          // types.ts:24
'compaction/summary': {
  compactionId, sourceCommandId?, summary: ContentBlock[],
  shadowedRange: { start, end }, shadowedSeqs: SessionSeq[], shadowedTokenCount: number,
  provider: string, model: string, maxTokens?: number, usage?: TokenUsage,
  rawOutput: ContentBlock[] | undefined, llmStreamCall?: true                        // types.ts:34-67
}
'compaction/end': { compactionId, sourceCommandId?, turn: number | null, error?: string }   // types.ts:72
'compaction/prune': { shadowedRange, shadowedSeqs, shadowedTokenCount }               // types.ts:82-89
```

字段语义要点【源码】：

- `turn: number | null`：`null` = 独立的手动事务（发生在两个 turn 之间）；数字 = 被那个 turn 严格包住（`types.ts:19-24`）。
- `provider` / `model` / `maxTokens` / `usage` 都记进 log：注释写"so the one-shot request is reconstructable from log + code"（`types.ts:43-53`）。**写摘要那次模型调用的信封是可重建的**，不是"压缩过就查不到了"。
- `llmStreamCall: true` 区分"经本 context 的 `ctx.llm.stream()` 调用"与"模板/远端/其他摘要器"两种来源（`types.ts:54-66`）。
- `compaction/prune` 是**无模型裁剪**（比如只截断超长工具结果）的计量事件，它和 `summary` 共用同一套"影子价格协议"：**紧跟其后的那条 surface `replace` 事件的价格，就由这条计量事件声明**（`types.ts:73-81`）。

### 4.2 surfaceOp replace 的真实语义（`types.ts:106-119` + `compaction/src/index.ts:168-186`）

- `shadowedRange` 是**surface 位置区间**，不是 seq 数值区间。注释明确写："after a prior replace lands a fresh high-seq summary node at an older range's position, `start` can be GREATER than `end`"（`types.ts:108-113`）。
- 权威集合是 `shadowedSeqs`（按 surface 顺序），`shadowedRange` 只是首尾。
- 替换动作**不是** `compaction/*` 事件做的，而是紧随其后的一条 `user/message`：

```ts
session.append('user/message', checkpointMessage, {
  surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
  sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],   // region.ts:507-510
})
```

`sourceEventSeqs` 必须包含 start、summary 以及**每一个被遮挡的节点**——这条规则在 surface 层被强制校验（见 7.3）。

### 4.3 锁 = durable 事件（`compaction-basic/src/region.ts`）

```text
compactSurfaceRegion()                                // region.ts:174
 ├─ validateSurfaceRegion   （区间必须在当前 surface 上、start 位置 <= end 位置、两端 tool 配对平衡）
 ├─ inspectCompactionEntryState(session)   ← 读 log 判断 openTurn / 未闭合 start / 最新 end-seed
 ├─ assertCompactionInactive(...)          ← 锁检查（核心）
 ├─ owner = 手动 ? null（且必须无 open turn） : openTurn
 ├─ startEvent = session.append('compaction/start', lifecycle)   // region.ts:211  ← 锁已落库
 ├─ prepareCompaction → summarizeCompaction（异步，可能很久）
 ├─ assertStable(...)                      ← 摘要期间区间被别人改了 → SurfaceChangedError
 ├─ commitCompactionBody(...)              ← summary + replace 两条一起，中间不让出
 ├─ endEvent = session.append('compaction/end', lifecycle)       // region.ts:238
 └─ catch: 一定补一次带 error 的 end（除非 close 本身失败）        // region.ts:241-251
```

注释把设计意图写得很清楚："`compaction/start` are synchronously adjacent, so the durable opening marker is the compaction lock before summarization yields... a failed close deliberately leaves the unmatched start detectable"（`region.ts:158-164`）。

即：**start 与"进入异步摘要"之间不允许有 await**，否则另一路可以在缝隙里插进来。

### 4.4 孤儿锁检测（真正的算法）

```ts
function assertCompactionInactive(unmatchedStart, latestEndSeedSeq, stage) {
  if (unmatchedStart === undefined
      || (latestEndSeedSeq !== undefined && latestEndSeedSeq > unmatchedStart.seq)) return
  throw new ManualCompactionError('busy', '...the session compaction lock is already active')
}                                                        // region.ts:309-321
```

判定规则：**未闭合的 start 只有在"它之后没有更新的 `session/end-seed` 边界"时才算活着**。因为 `session/end-seed` 标记"此前的字节属于上一生命周期（fork 继承或恢复）"，那么边界之前没关的 start 就属于已经结束的那个生命周期，不需要清理也永远不该阻塞。

同一逻辑在两处格式迁移里也有独立实现：

- `session-format-v0-to-v1/src/relationships.ts:329-341 inheritedOrphanCompactionStarts()`
- `session-format-v3-to-v4/src/relationships.ts:66-79`（构造时预扫描，`session/end-seed` 之后把 open start 记进 `orphanCompactions`，之后 turn 校验跳过它）

**这是"事件溯源系统如何处理崩溃遗留的成对开闭事件"的通用答案**，比"启动时扫一遍 log 清理孤儿"更省事也更安全（清理动作本身可能出错）。

### 4.5 工具配对约束（`compaction/src/tool-pairing.ts`，115 行）

- 压缩区间两端必须"平衡"，即不能从中间切断一个 tool-call / tool-result 对。
- 增量算法：维护 `cutBalanced[]`（N 个节点有 N+1 个切点）与 `inProgressToolCalls`；`assistant/message` 里每个 `type:'tool-call'` 块 +1，`tool/result` −1；计数为 0 的切点才算安全（`tool-pairing.ts:28-38`、`tool-pairing.ts:41-69`）。
- 平衡计算基于**当前 surface 顺序的内容**，而不是 step 标记（`tool-pairing.ts:2-4`）——因为压缩会改变 surface 位置。
- 计数为负 → 直接抛"corrupt surface"（`tool-pairing.ts:59-61`），即"结果比调用还多"被视为数据损坏而不是可容忍状态。

### 4.6 checkpoint 来源标记（`compaction/src/checkpoint.ts`，45 行）

压缩产生的那条 `user/message` 带 `source.kind === 'compact-checkpoint'` 与 `compactionId`（`checkpoint.ts:18-24`）。用途：消费方（UI / 导出 / 统计）能**不依赖具体压缩后端**就认出"这是一条压缩检查点"，并关联到账本（`isCompactCheckpointSource()` `checkpoint.ts:48-50`）。

### 4.7 可学 / 不学

可学：

1. **压缩锁用 durable 事件而不是内存标志**；开始与"进入异步"之间不留 await 缝隙。
2. **孤儿锁用"生命周期边界事件"判定归属**，不扫描、不清理。
3. **压缩不动历史，只遮挡 surface**：`replace` 而非改写；被遮挡节点仍可完整回放。
4. 计量与替换的**影子价格协议**：替换事件的价格由紧邻其前的计量事件声明，纯消费者可减账而不必保留每节点价格。
5. 工具配对用"当前 surface 顺序 + 增量计数"校验，不用 step 标记。
6. 失败一定补一条带 `error` 的 `end`，失败尝试也留在 log 里。

不学：`compaction-basic` 的模型选择与压力阈值配置面（`config.ts` 337 行，含 per-model policy、overflow retry 等），我们自己的 DeepSeek 优化走另一套。

---

## 5. interaction/user-approval

### 5.1 类型（`src/types.ts`，86 行，全部读完）

```ts
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'   // types.ts:32

'approval/asked':   { id, toolName, callId?, reason? }        // 日志审计，非 surface
'approval/decided': { id, outcome }                           // 与 asked 一一对应
```

注意 `allowed-once` 这个名字本身就否定了"记住上次选择"：**只有一次性放行，没有永久放行**（`types.ts:28-32` 注释 "a one-shot grant"）。

### 5.2 服务实现（`src/index.ts`，308 行，全部读完）

策略只有两档【源码】：

```ts
export type ApprovalPolicy = 'ask' | 'never'      // index.ts:69
```

- `never`：任何 ask 都确定性 `rejected`，且**在服务内部、dispatch 之前就判定**（`index.ts:294-302`）。注释给了理由：如果靠"注册一个 gate 监听器"实现，`prepend: true` 的后注册监听器会插到它前面，就无法保证"无论注册顺序都拒绝"（`index.ts:297-301`）。
- `ask`：委派给组合出来的 answerers；一个都没有时 fail-closed 成 `unavailable`（`index.ts:63-64`）。
- 策略可切：`setApprovalPolicy()` 只 append 一条 `approval/policy` 事件（`index.ts:118-123`）；`setPolicy()` 额外 `agent.inject()` 一条用户消息告诉模型策略变了（`index.ts:212-223`）。**模型是通过对话知道策略的，不是靠隐式字段**。

`request()` 的强制约束（`index.ts:243-262`）：

1. **必须在开着的 turn 内**，否则直接抛，理由是"approval/asked + approval/decided 这对审计必须被 turn 的提交/重放边界包住；两个 turn 之间的裸事件在重载时就是崩溃尾部垃圾"（`index.ts:245-251`）。
2. `randomUUID()` 生成 `ApprovalRequestId`（`index.ts:252`）。
3. 顺序固定：append `asked` → `await decide()` → append `decided`（`index.ts:253-261`）。
4. 两次 append 任一在提交点前失败 → 抛；返回未记审计的决定是违约的（`index.ts:232-237`）。

超时与取消（`decide()`）：

- `signal.aborted` 直接 `cancelled`（`index.ts:296`）。
- dispatch 用 `Promise.resolve().then(...)` 进入 promise 链**再**调用（`index.ts:303-307`）：注释说明"一个在第一个 await 之前同步抛出的监听器，必须落进同一条拒绝路径，否则会逃出围栏"。
- 返回非词表值 → 归一化为 `unavailable`（`index.ts:30` 处"Callers fail closed on `unavailable`"）。

### 5.3 拒绝原因如何回到模型（`core/tools/src/pipeline.ts:442-492, 711-714`）

审批不说"no"两个字结束，而是转成结构化拒绝：

| 审批结果 | 转成的拒绝 |
|---|---|
| `rejected` | `approvalDenial('the user rejected tool "X"', APPROVAL_REJECTED)` |
| `cancelled` | `approvalDenial('approval for tool "X" was cancelled', APPROVAL_CANCELLED)` + `approvalCancelled: true` |
| `unavailable` | `approvalDenial('...no approval channel is available', APPROVAL_UNAVAILABLE)` |
| 未组合 ApprovalService | `approvalDenial('...requires approval (not yet supported)', APPROVAL_UNAVAILABLE)`（`pipeline.ts:458-461`） |
| 没有 agent 可路由 | `approvalDenial('...has no agent to route it through', APPROVAL_UNAVAILABLE)`（`pipeline.ts:466-468`） |

`approvalDenial()` 产出 `{ kind:'deny', reason, info: { name: APPROVAL_ERROR_NAME, code } }`（`pipeline.ts:712-714`）。`reason` 会以 `Error: <reason>` 文本进入工具结果正文（`pipeline.ts:220-224`），`info.code` 留在结构化错误里。

**要点**：拒绝原因**既进模型可见正文，也进结构化错误码**，审计与模型解释两不误。

### 5.4 可学 / 不学

可学：

1. 四态 outcome + `allowed-once` 唯一放行（我们目前的"允许/拒绝"缺 `cancelled` 与 `unavailable` 的区分，取消会被误报为拒绝）。
2. `unavailable` 一律 fail-closed，且"没有审批通道"也算 unavailable 而不是 allow。
3. 审批审计成对落 log，且必须被 turn 包住。
4. 拒绝原因双通道（正文给人看，code 给程序看）。
5. `never` 策略在服务内部判定，不依赖监听器顺序。

不学：`approval/policy` 的 `source: 'delegation'` 子会话继承语义（我们用不到子代理委派链时无意义）。

---

## 6. workspace

### 6.1 实体注册表（`src/spec.ts`，75 行，全部读完）

```ts
workspaceRecord = { path, title, sessionIds: SessionId[], createdAt, updatedAt }   // spec.ts:24-30
workspaceDomainState = {
  initialized, defaultWorkspaceId?, workspaceIds: WorkspaceId[],   // 权威显示顺序
  archivedSessionIds: SessionId[], pinnedSessionIds: SessionId[],  // registry-global 集合
  pendingMutation?: { operation: 'create'|'delete', workspaceId }
}                                                                  // spec.ts:57-65
defineDomain({ name:'workspace', version: 2, global, tables: { workspaces } })   // spec.ts:76-84
```

- `pendingMutation` 是**两次写之间的恢复标记**："在 record/order 对可能分叉之前先落标记，启动时就能区分'被打断的操作'与'没有解释的介质损坏'"（`spec.ts:35-43`）。
- 归档 / 置顶是 registry 级集合，且**归档保留它在 `sessionIds` 里的位置**（取消归档要能回到原位），所以它不参与"一个 session 只属于一个 workspace"的记账不变量（`spec.ts:48-55`）。置顶与归档互斥，归档会丢置顶。

### 6.2 多工作区隔离（`src/index.ts`，864 行）

- `WorkspaceId` 是**生成的 uuid，永远不是路径**（`types.ts:12-16`）："path 规范化会改写路径，而引用锚点必须稳定"。
- `path` 是创建时的 `fs.realpath` 规范形式，之后**永不重写**，即使目录消失了（`types.ts:73-78`）。
- 注册表内部结构（`index.ts:187-198`）：`table: KvTable<WorkspaceId, WorkspaceRecord>`、`global: DomainGlobal<WorkspaceDomainState>`、`entities: Map<WorkspaceId, WorkspaceEntity>`、`headers: Map<SessionId, SessionHeader>`、`sessionPaths`、`missingSessionPaths`、`invalidSessionPaths`，以及 **`operationTail` 一条串行链**（所有域写都在这一条链上排队）。
- 加入校验：`attachSession()` 要求该 session 的 header `cwd` 解析到**等于本 workspace path 的现存目录**，否则拒绝且不写盘。对已存在的候选，cwd 缺失时**保留**（目录可能只是临时被移走），其它文件系统错误不保留（`types.ts:89-100`）。
- `sessionIds` 的过滤是**同步**的：缺 header、cwd 非法、cwd 与规范路径不匹配的一律不返回（`types.ts:89-99`）。
- 一致性自检：`validateStoredState()` 检查"表里每个 workspace 都在 order 里"，否则抛 `workspace domain is inconsistent: workspace 'X' is absent from registry order`（`index.ts:780-782`）——这就是"注册表孤儿"检测。
- `status()` 是**不缓存的实时检查**（`types.ts:146-152`）：目录不在也算 `missing-dir`，但**永不因此改写记录**。

### 6.3 可学 / 不学

可学：

1. **id 是 uuid 不是路径**，path 只是规范化后的属性。这条对我们直接有用（我们现在很多地方拿路径当身份）。
2. 一个 session 只属于一个 workspace 的"one-owner 记账"不变量，加上"归档保留位置"的独立集合设计。
3. 两写操作的 `pendingMutation` 标记 + 启动恢复。
4. 串行 `operationTail` 把域写变成单链（不需要锁）。

不学：`KvTable` / `DomainGlobal` / `defineDomain` 这套 cordis 域模型（属于"一切皆插件"那一层）。

---

## 7. core/session：14 个事件与 surface

### 7.1 14 个核心事件完整清单（`packages/core/session/src/types.ts:287-435`，全段读完）

约定：`S` = surface 事件（会产生模型可见消息），需要 `surfaceOp`；`L` = log-only（不带 surfaceOp）。

| # | 事件 | 类型 | 字段 | 说明 |
|---:|---|---|---|---|
| 1 | `turn/start` | L | `{ turn }` | 在循环取输入/跑 pre-step 之前打开 turn |
| 2 | `turn/end` | L | `{ turn, reason: TurnEndReason }` | 关闭 turn；无进入 step 的 turn 没有 step 事件 |
| 3 | `step/start` | L | `{ turn, step }` | 一次模型调用 + 它请求的工具执行 |
| 4 | `step/end` | L | `{ turn, step }` | — |
| 5 | `user/message` | S | `UserMessage` | 直接人类输入 / `agent.inject()` 合成上下文 / goal 续轮，三者靠 `source` 区分 |
| 6 | `developer/message` | S | `{ turn, step, message: DeveloperMessage, headerSeq? }` | 增量会话变更（工具增删）；`headerSeq` 有工具新增时**必须**有，且必须指向更早的 `request/header` |
| 7 | `system/message` | S | `{ turn, step, message: SystemMessage }` | 系统提示；第一个是 surface 节点 0；空内容 = "没有系统提示"，不是"沿用旧的" |
| 8 | `assistant/message` | S | `{ turn, step, message, stream: AssistantStreamRecord[], usage?, interrupted?: true }` | 一步的成品消息；内嵌**紧凑原始流**；`usage` 在此不单列事件；被取消时以 `interrupted: true` 记录已投递前缀 |
| 9 | `assistant/attempt` | L | `{ turn, step, stream }` | 未提交 surface 的模型尝试（失败/重试/取消/流错误），保留原始流但**不伪造历史** |
| 10 | `tool/call` | L | `{ turn, step, callId, name, arguments: string }` | `arguments` 是**模型产出的原始 JSON 字符串，未解析**；`callId` 与 `tool/result` 配对 |
| 11 | `tool/result` | S | `{ turn, step, message: ToolResultMessage, error?: {name,code,reason?}, meta?: JsonValue }` | `error` 只在 `message.isError === true` 时允许；`meta` 不透明、必须 JSON 可序列化 |
| 12 | `request/header` | L | `{ header: EpochHeader, reason: 'initial'\|'resume'\|'change'\|'series', startsSeries?: true }` | 下一次请求的完整信封；**只有最新快照有效** |
| 13 | `request/context` | L | `RequestContext = { provider, model, contextWindow?, systemPromptUpdate? }` | 路由元数据，只在路由/容量/系统提示更新模式变化时记；**不参与 header 重建** |
| 14 | `session/end-seed` | L | `{ inherited?: true }` | 分隔继承/恢复历史与后续活工作；只有 `Session` 构造器与 `buildForkSeed` 可以写 |

配套类型：

- `EpochHeader = { config: LlmCallConfig, adapterDefaults?, tools?: ToolSchema[], system?: never }`（`types.ts:246-257`）。**`system` 被显式退役**（`@persistenceReserved`），系统提示只走 `system/message`。
- `TurnEndReason` 七态（`types.ts:206-235`）：`completed` / `aborted{reason}` / `blocked` / `error{error: LlmFailure}` / `max-tokens` / `interrupted` / `forked`。其中 `interrupted` 与 `forked` 明确写"loop 永不实时发出"，只由恢复/分叉过程补写。
- `SessionHeader = { version: 4, id, createdAt, cwd?, parentSession?, isSeeded, origin?: 'subagent', delegationDepth?, agentPreset? }`（`types.ts:95-136`）。`delegationDepth` 落盘的理由很具体：只在内存里存会在 resume 后把子会话当顶层（`types.ts:123-128`）。

### 7.2 全仓事件词表规模

`known-event-types.ts:22-86` 列出**本构建认识的全部 63 个事件类型**（生成文件，由 `scripts/gen-persistence-catalog.ts` 产出并校验新鲜度）。它 != 14 个核心事件：其余 49 个由各插件用声明合并（`declare module ... interface SessionEventMap`）加入，例如 `compaction/start`、`approval/asked`、`subagent/catalog`、`job/registered`、`llm/retry`、`todo/write`、`workspace/changes`。

`MESSAGE_PROJECTION_EVENT_TYPES` 只有一个成员：`image/offload`（`known-event-types.ts:88-91`）——需要显式纯解释器才能改变已存在消息内容的事件类型。

## 7.3 surface 层（`packages/core/session/src/surface.ts`，716 行，全部读完）

surface = append-only log 之上的一层"有序模型可见视图"。**log 是唯一真相，surface 是派生**（`surface.ts:1-9`）。

```ts
export type SurfaceOp = 'append' | { op: 'replace'; startSeq: SessionSeq; endSeq: SessionSeq }   // types.ts:469-471
export type SurfaceEventType =
  | 'system/message' | 'developer/message' | 'user/message' | 'assistant/message' | 'tool/result'  // types.ts:446-451
```

替换的五条硬校验（全部在 `validateSurfaceMetadata` / `planSurfaceEvent` 里）：

1. **区间必须真的在当前 surface 上**：`startSeq`/`endSeq` 都要能在 `nodes` 里 `indexOf` 到，且 `startIdx <= endIdx`（`surface.ts:414-434`）。
2. **必须引用更早的事件**：`startSeq`/`endSeq` 都要 `< event.seq`（`surface.ts:405-408`）。
3. **`sourceEventSeqs` 必须覆盖每一个被遮挡的节点**，一个都不能漏（`surface.ts:361-364`）；且不许重复、不许指向自己或未来（`surface.ts:338-360`）。`assistant/message` **禁止**带 `sourceEventSeqs`（它内嵌 stream 自证来源，`surface.ts:335-337`）。
4. **`tool/result` 的替换只能改 `content`**：把两边的 `content` 置空后做深比较，其余字段必须完全相等（`surface.ts:455-483`）。这是"允许裁剪工具输出，不允许篡改工具结果身份/错误标志"。
5. **surface 节点 0 的系统提示受保护**：覆盖节点 0 的替换，本身必须是 `system/message` 且恰好只覆盖那一个节点；后续 system 节点不受保护，压缩区间可以遮挡它们（`surface.ts:491-504`）。

派生的规则（`deriveEventMessage` `surface.ts:120-152`）：

- `user/message` 原样投影；
- `system` / `developer` / `assistant` 的 `message.content.length === 0` → **投影为 null**（空 system 保留位置但不产生 wire 消息；空的 assistant 只是承载 `max-tokens` 的 usage，绝不能往 provider 历史里塞一条空消息）；
- 其它类型（边界、attempt、log-only）→ null。

增量管理（`SurfaceManager` `surface.ts:618-716`）：

- `validateNext(event)`：验证下一个候选但**不动已提交状态**（`surface.ts:643-652`）。
- `prepareBatch(events)`：一批候选在**隔离的 fold 状态**上试算，返回一个"全部入 log 后采纳"的回调（`surface.ts:659-692`）。快路径：全是 append 且没有投影时直接顺序试算（`surface.ts:663-673`）；否则深拷贝状态后逐条应用（`surface.ts:674-691`）。
- 两个单调计数：`replaceGeneration`（位置替换次数）与 `contentGeneration`（替换 + 插件的消息投影）。`deriveMessages()` 用 `contentGeneration` 判断缓存是否作废（`index.ts:1082-1087`）。
- `deriveMessages()`（`index.ts:1079-1100`）：缓存式——纯尾部增长只算新增节点（O(new)），一旦 generation 变了就整段重建；返回新数组但 `Message` 对象是**共享且深冻结**的。

### 7.4 可学 / 不学

可学：

1. **log-only 与 surface 事件的二分**，用 `surfaceOp` 的"有/无"在类型系统里强制（surface 事件缺 marker 直接抛，非 surface 事件带 marker 也抛，`surface.ts:302-327`）。
2. 替换的五条校验，尤其是"`tool/result` 替换只能改 content"与"节点 0 受保护"。
3. `sourceEventSeqs` 覆盖全部被遮挡节点——这让"这次替换吃掉了什么"永远可审计。
4. 空 content 不产生 wire 消息（避免空消息污染 provider 历史）。
5. `contentGeneration` 这种单调计数器驱动派生缓存失效。
6. `ignorable` 标记的默认方向：**缺省=必需**，"忘了写标记就过度拒绝（不便），而不是静默恢复一个被掏空的 session"（`types.ts:513-523`）。这个默认值选择值得照抄。

不学：

- `SessionMessageProjection` 插件式纯解释器（`image/offload` 那种），我们暂时没有"改写已存在消息"的需求。
- 声明合并扩展事件表（TS `declare module`），属于"一切皆插件"。

---

## 8. core/tools pipeline：guard 与 approval 的交互

### 8.1 执行顺序（`packages/core/tools/src/pipeline.ts:191-234`）

```text
prepare(input)                                   // pipeline.ts:191
 ├─ createExecution(input)                      // 快照参数 + 深冻结 + 分配 token
 ├─ callerCancelled? → abort-before-dispatch
 ├─ gate = ctx.waterfall(carrier, 'tools/pre-execute', exec, () => ({kind:'allow'}))
 ├─ gate.kind === 'ask' ? serviceAsk(exec, gate) : { decision: gate }
 ├─ 取消 + approvalCancelled → abort-before-dispatch
 ├─ decision.kind === 'cancel' → abort-before-dispatch
 ├─ decision.kind === 'allow' ? tools.checkGuards(exec) : decision        // pipeline.ts:214
 ├─ denial → 物化成 isError 结果（不抛）
 └─ → { kind:'dispatch', exec }
```

### 8.2 guard 的关键性质（`core/tools/src/index.ts:381-397`）

```ts
checkGuards(exec): ToolGuardDenial | undefined {
  for (const layer of [this.guards.global, ...this.guards.chainLayers(exec.agent)]) {
    for (const guard of layer.guards.values()) {
      const denial = guard(exec)
      ...
```

- 返回类型只有两种：**拒绝原因** 或 `undefined`。**没有 allow 分支**——后来的守卫无法把前面的拒绝翻回允许。
- 求值顺序：global 层 → 该 agent 的作用域链层。
- 只在 **pre-execute 与审批都通过之后**才跑（`pipeline.ts:214` 的注释 "after pre-execute policy and approval resolve"）。即守卫看的是"将要真正执行的动作"，不是"可能被审批拦下的动作"。
- 仓库里只有两个 guard 实现：`repeat-tool-reminder`（阈值 `[3,5,8]`，参数预览 500 字符）与 `tool-call-timeout-policy`（`packages/bundle/base/cordis.patch.yml` 里的 `timeout-policy` 行）。

### 8.3 审批与 pipeline 的耦合点（`pipeline.ts:442-492`）

- 用 `ctx.get('approval')` **可选获取**：部署里没有审批服务时不报错，而是退化成 `APPROVAL_UNAVAILABLE`（`pipeline.ts:457-462`）。
- 四个 outcome 全部一对一映射到 deny code（见 5.3 表），`assertNever(outcome)` 兜底（`pipeline.ts:492`）。
- `approvalCancelled` 单独回传：区分"用户撤回了审批请求"与"整个调用被取消"，只有两者同时成立才走 abort-before-dispatch（`pipeline.ts:204-210`）。

### 8.4 参数不可变与取消语义

- 参数在进入任何策略之前就被 `snapshotJsonValue()` 快照 + `deepFreeze()`（`pipeline.ts:154-158`），不可序列化直接 `TypeError`。理由在主报告 §2.4 已写：历史、审计、UI、执行必须看到同一份参数，所以禁止策略层改写。
- 取消用信号融合 `fuseToolSignals(callerSignal, wrapperSignal)`（`pipeline.ts:268`），并且**已启动的 body 必须跑到静止**才把结果标成 `ABORTED`（`pipeline.ts:254-293`）——避免"工具还在改文件，UI 已经说取消了"。
- 取消结果分两种：`toolAbortedBeforeDispatchResult()`（body 没启动）与 `toolAbortedResult(prior)`（body 启动了，带已有结果），由 `bodyInvoked` 标志决定（`pipeline.ts:244-252`）。

### 8.5 可学 / 不学

可学：

1. **guard 无 allow 分支**：这是"权限只减不增"最便宜的实现方式。
2. guard 在审批之后跑（看真实动作）。
3. 审批可选获取，缺失即 fail-closed 而不是崩。
4. 参数进入策略前深冻结 + 快照。
5. 取消分"未启动"与"已启动"两种结果，且已启动必跑到静止。
6. 管线内的拒绝物化成 `isError` 结果而不是抛异常打断回合。

不学：瀑布式 `tools/pre-execute`（任意插件可插入决策）——我们用固定策略链 + 结构化规则。

---

## 9. DSH 全功能清单

证据等级：【源码】= 本次读到实现；【文档】= 只读文档/README。
成熟度：高 = 有多层防御与测试；中 = 功能可用但边界薄；低 = 试验性/壳。

### 9.1 apps 与交付形态

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| CLI 装配器（profile/bundle/patch 分层） | 【源码】 | 高 | 不采用（分层覆盖） |
| Electron 桌面外壳（跨进程隔离） | 【源码】 | 高 | P1（隔离思路照抄，Electron 本身不用） |
| 子进程宿主 + IPC 握手（starting→ready） | 【源码】 | 高 | **P0**（父进程投递凭据、随机端口、URL 回传） |
| 外壳 IPC sender 校验 + URL/header 白名单 | 【源码】 | 高 | **P0** |
| 退出前置检查（有活就问） | 【源码】 | 中 | P1 |
| 客户端脚本注入清单（collectIndexInjections） | 【源码】 | 中 | P1 |
| 一套前端两宿主（dshDesktopBoot 桥） | 【源码】 | 中 | P1（我们若做 Web+桌面双端） |
| 自动更新（通道/灰度/强制更新） | 【源码】 | 高 | P2 |
| 自定义 NSIS 安装器 + 签名 | 【源码】 | 高 | 不采用（现阶段无发布链） |
| 发布状态机（七态 + 字节摘要 + 禁覆盖） | 【源码】 | 高 | P2 |
| 插件市场索引生成器 | 【源码】 | 中 | 不采用（无插件生态） |

### 9.2 持久化与格式

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| append-only JSONL、一 session 一目录 | 【源码】 | 高 | **P0** |
| 代文件不可变 + 版本号命名 | 【源码】 | 高 | P1 |
| 原子首落盘（temp + fsync + link 发布） | 【源码】 | 高 | **P0**（Rust 用 tempfile+persist） |
| 追加失败回滚到原 size | 【源码】 | 高 | **P0** |
| 撕裂尾部截断 + 已恢复事件重写 | 【源码】 | 高 | P1 |
| 跨进程内核写锁（flock/信号量）+ inode 校验 | 【源码】 | 高 | P1（我们用文件锁即可） |
| 锁不超时、不抢占 | 【源码】 | 高 | **P0**（策略照抄） |
| zstd 帧 checksum + 前缀解压恢复 | 【源码】 | 高 | P2 |
| Windows MoveFileExW 写穿发布 | 【源码】 | 中 | 不采用 |
| 相邻迁移链（一版本一步、构造期校验完整性） | 【源码】 | 高 | P2（骨架 P1 思想） |
| header-only 分类四态（current/migration-required/unsupported/malformed） | 【源码】 | 高 | P1 |
| 拒绝迁移而非编造时间线 | 【源码】 | 高 | **P0**（原则） |
| 需要外部证据的迁移必须显式传参 | 【源码】 | 高 | P2 |
| 流式迁移（1MiB/4MiB 分片 + 让出） | 【源码】 | 高 | P2 |
| 迁移发布前源 identity 校验 | 【源码】 | 高 | P2 |

### 9.3 会话事件模型

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| 14 个核心事件（turn/step/message/request/seed） | 【源码】 | 高 | **P0** |
| log-only vs surface 二分 + surfaceOp 强制 | 【源码】 | 高 | **P0** |
| `sourceEventSeqs` 覆盖全部被遮挡节点 | 【源码】 | 高 | **P0** |
| `assistant/message` 内嵌紧凑 stream + `assistant/attempt` 单独记录失败 | 【源码】 | 高 | **P0** |
| 空 content 不产生 wire 消息 | 【源码】 | 高 | **P0** |
| `ignorable` 缺省=必需 | 【源码】 | 高 | **P0** |
| 替换五条校验（区间/tool-result 只改 content/节点0 保护） | 【源码】 | 高 | P1 |
| SurfaceManager 增量 fold + 批次隔离试算 | 【源码】 | 高 | P1 |
| `contentGeneration` 驱动派生缓存失效 | 【源码】 | 高 | P1 |
| 七态 TurnEndReason（含 interrupted/forked 只由恢复补写） | 【源码】 | 高 | P1 |
| 声明合并扩展事件表 | 【源码】 | 高 | 不采用 |
| 插件式消息投影（image/offload） | 【源码】 | 中 | 不采用 |

### 9.4 压缩

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| 压缩 = 遮挡 surface 不改历史 | 【源码】 | 高 | **P0** |
| 压缩锁 = durable `compaction/start` | 【源码】 | 高 | **P0** |
| 孤儿锁用 `session/end-seed` 边界判定 | 【源码】 | 高 | **P0** |
| start 与进入异步之间不留 await 缝隙 | 【源码】 | 高 | **P0** |
| 失败必补带 error 的 `end` | 【源码】 | 高 | P1 |
| 工具配对平衡（增量计数，按 surface 顺序） | 【源码】 | 高 | **P0** |
| 位置区间语义（start 可 > end） | 【源码】 | 高 | P1 |
| 影子价格协议（计量事件紧邻替换事件） | 【源码】 | 高 | P1 |
| 摘要调用的 provider/model/usage 落 log | 【源码】 | 高 | P1 |
| 稳定性校验（摘要期间区间被改即失败） | 【源码】 | 高 | P1 |
| 无模型裁剪（prune）与模型摘要分开计量 | 【源码】 | 高 | P1 |
| checkpoint source 标记 | 【源码】 | 中 | P2 |
| per-model 阈值/溢出重试策略 | 【源码】 | 中 | 不采用（我们走 DeepSeek 专属优化） |

### 9.5 审批与工具流水线

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| 审批四态 outcome（allowed-once/rejected/cancelled/unavailable） | 【源码】 | 高 | **P0** |
| `allowed-once` 唯一放行（无永久放行） | 【源码】 | 高 | **P0** |
| 审计成对 `approval/asked` + `decided`，必须 turn 内 | 【源码】 | 高 | **P0** |
| 缺审批通道 → unavailable → fail-closed | 【源码】 | 高 | **P0** |
| `never` 策略在服务内部判定（不靠监听器顺序） | 【源码】 | 高 | P1 |
| 拒绝原因双通道（正文 + 结构化 code） | 【源码】 | 高 | **P0** |
| guard 无 allow 分支（权限只减） | 【源码】 | 高 | **P0** |
| guard 在审批之后跑 | 【源码】 | 高 | **P0** |
| 参数进入策略前快照 + 深冻结 | 【源码】 | 高 | **P0** |
| 取消分"未启动/已启动"，已启动跑到静止 | 【源码】 | 高 | **P0** |
| 管线拒绝物化为 isError 结果不抛 | 【源码】 | 高 | P1 |
| 策略瀑布 `tools/pre-execute`（插件可插决策） | 【源码】 | 高 | 不采用 |
| 沙箱升级只升一次（sandbox denied → 再审批 → 重跑一次） | 【文档】 | 高 | P1（未读 `packages/sandbox/*` 实现，见覆盖边界） |
| 结构化命令规则（Starlark prefix_rule 类） | 【文档】 | 高 | P1（未读实现） |

### 9.6 工作区

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| WorkspaceId 用 uuid 不用路径 | 【源码】 | 高 | **P0** |
| path 是 realpath 规范形式、永不重写 | 【源码】 | 高 | **P0** |
| 一个 session 只属于一个 workspace（one-owner） | 【源码】 | 高 | P1 |
| 归档保留位置 / 置顶与归档互斥 | 【源码】 | 中 | P1 |
| 两写操作的 pendingMutation + 启动恢复 | 【源码】 | 高 | P1 |
| 串行 operationTail 单链写 | 【源码】 | 高 | **P0**（简单有效） |
| 注册表孤儿检测（table vs order 一致性） | 【源码】 | 高 | P1 |
| status() 实时检查且不改记录 | 【源码】 | 高 | P1 |
| KvTable / DomainGlobal 域模型 | 【源码】 | 高 | 不采用 |

### 9.7 明确不采用（DSH 产品层）

| 功能 | 证据等级 | 成熟度 | 采用建议 |
|---|---|---|---|
| Cordis 插件树 / 服务注入 / 声明合并作为主干 | 【源码】 | 高 | 不采用 |
| profile → bundle → patch 三层 YAML 覆盖 | 【源码】 | 高 | 不采用 |
| 插件市场 + 插件包管理 + HMR | 【源码】 | 高 | 不采用 |
| 74 个 client 包拆分的客户端架构 | 【源码】 | 中 | 不采用 |
| 62 个事件类型的词汇表（含 team/job/schedule/workflow 等） | 【源码】 | 高 | 不采用（我们只取 14 个核心 + 自己的扩展） |

---

## 10. 覆盖边界

### 10.1 本次逐行读完的文件

`packages/`：

- `core/session/src/types.ts`（538 行，全文）
- `core/session/src/surface.ts`（716 行，全文）
- `core/session/src/known-event-types.ts`（89 行，全文）
- `core/session/src/index.ts`（1040–1110 行，`deriveMessages` / `toolHistory` 段）
- `core/tools/src/pipeline.ts`（150–300 行执行段；442–492 + 711–714 审批段）
- `core/tools/src/index.ts`（93–110、381–397 行，guard 层）
- `compaction/compaction/src/types.ts`（116 行，全文）
- `compaction/compaction/src/index.ts`（195 行，全文）
- `compaction/compaction/src/checkpoint.ts`（45 行，全文）
- `compaction/compaction/src/tool-pairing.ts`（1–70 行）
- `compaction/compaction-basic/src/index.ts`（1–200 行）
- `compaction/compaction-basic/src/region.ts`（150–350、460–567 行）
- `interaction/user-approval/src/types.ts`（86 行，全文）
- `interaction/user-approval/src/index.ts`（308 行，全文）
- `workspace/workspace/src/types.ts`（134 行，全文）
- `workspace/workspace/src/spec.ts`（75 行，全文）
- `workspace/workspace/src/index.ts`（结构 + 关键函数签名，未逐行）
- `session/session-persistence-jsonl/src/format.ts`（36–120 行 + 扫描器段）
- `session/session-persistence-jsonl/src/index.ts`（1310–1540 行，落盘/追加/修复段）
- `session/session-persistence-jsonl/src/lease.ts`（127 行，全文）
- `session/session-persistence-jsonl/src/win32.ts`（1–80 行）
- `session/session-persistence-jsonl/src/storage.ts`（结构 + 关键函数签名）
- `session/session-persistence-jsonl/src/generation.ts`（1–60、700–845、884–1010 行）
- `session/session-format/src/types.ts`（208 行，全文）
- `session/session-format/src/chain.ts`（1–120 行）
- `session/session-format/src/catalog.ts`（1–150 行）
- `session/session-format/src/filename.ts`（28 行，全文）
- `session/session-format-catalog/src/{current,children,historical}.ts`（全文）
- `session/session-format-v0-to-v1/src/migration.ts`（1–90 行）+ `relationships.ts`（320–380 行）
- `session/session-format-v1-to-v2/src/migration.ts`（1–90 行）
- `session/session-format-v2-to-v3/src/migration.ts`（173 行，全文）
- `session/session-format-v3-to-v4/src/migration.ts`（175 行，全文）+ `relationships.ts`（40–130 行）

`apps/`：

- `cli/package.json`、`cli/src/bin.ts`（72 行，全文）、`cli/src/profile-boot.ts`（结构 + 关键函数）
- `desktop/package.json`、`desktop/src/main.ts`（470–560 行 + 全文件关键符号扫描）、`desktop/src/host-process.ts`（1–330 行）、`desktop/src/` 全部 80 个文件的行数清单
- `desktop-host/package.json`、`desktop-host/src/index.ts`（1–100、140–179 行）
- `web/package.json`、`web/src/main.ts`（38 行，全文）
- `desktop-publisher/package.json` + 全部 28 个文件行数 + 5 个核心文件头部
- `plugin-market-generator/package.json` + 9 个文件行数 + 4 个核心文件头部
- `packages/bundle/base/cordis.patch.yml`（约 700 行中的主体）

### 10.2 读了但没读全的文件（只用了结构/签名/头部）

- `core/session/src/index.ts`（1793 行的其余部分：append 细节、fork、repair）
- `core/tools/src/pipeline.ts`（300–442、492–753：around 包装、post-execute、finalizeContent）
- `apps/desktop/src/main.ts`（1574 行中的更新子系统、welcome、平台视图）
- `apps/cli/src/profile-boot.ts`（349 行中的 profile 初始化与 HMR 部分）
- `session-persistence-jsonl/src/index.ts`（1793 行中的发现/列表/导出部分）
- `session-persistence-jsonl/src/storage.ts`（534 行中的读路径）
- `workspace/workspace/src/index.ts`（864 行中的 archive/pin/bootstrap 实现细节）

### 10.3 完全没读（明确不在本附录范围）

- `packages/sandbox/*`（含 `escalation.ts` 244 行、`sandbox-windows-acl/*` 约 2000 行）——所以"沙箱升级只升一次""结构化命令规则"两条仍是【文档】。
- `packages/client/*`（74 个包，UI 面板、dockkit、虚列表等）。
- `packages/experimental/*`（65 个包，含 voice/cua/forge/ralph 等）。
- `packages/llm/*`（9 个包）——所以"流式协议、retry 策略"细节未在本文取证。
- `packages/subagent/*`、`team/*`、`job/*`、`schedule/*`、`workflow/*`、`mcp/*`、`skill/*`、`browser-use/*`、`computer-use/*`。
- `native/`、`python/`、`vendor/`、`website/`、`benchmarks/`、`snapshots/`。
- 全部测试文件（`tests/` 约 3000+ 个 spec）——只在需要交叉验证行为时读过个别断言，不作为证据引用。
- `docs/` 全部（本附录只引用实现，不引用文档）。

### 10.4 一句话边界

本附录是"apps 全量 + 持久化/格式/压缩/审批/工作区/事件模型/工具流水线的**核心路径**"的源码级取证，**不是**"全仓每个文件逐行读完"。上面 10.3 列出的部分仍然是黑盒，谁要继续补就在那一节往下切。

---

## 11. 结论：只留一句话

DSH 真正值钱的不是"一切皆插件"，而是**它把"历史"当成了唯一可变现资产**：session log 是 append-only 的事件流，压缩不改历史只遮挡 surface，锁写在 log 里而不是内存里，审批和工具结果都成对落盘，迁移要么完整要么拒绝。

我们的 engine 要抄的就是这条主线；插件树、profile 分层、插件市场、桌面发布链，一个都不要。
