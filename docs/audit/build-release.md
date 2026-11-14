# 卡塞尔专员终端 · 构建 / 版本 / 发布状态只读审计

- 审计日期：2026-11-14
- 仓库：`D:\卡塞尔学院\repo`，分支 `engine/v2`，HEAD `a391689`
- 审计性质：**只读**。唯一写入是本文件。全程没有 push、没有 reset、没有删分支、没有打包安装包、没有改代码或配置。
- 事实边界见 §8，先看结论看 §0。

---

## 0. 结论先行

1. **版本号本身是干净的**：五处全部 `0.1.9`（`package.json` / `Cargo.toml` / `Cargo.lock` / `tauri.conf.json` / `src/version.ts`）。没有内部漂移。
2. **但 `0.1.9` 这个号已经用掉了**。`engine/v2` 相对**已交付给用户的 0.1.9**（`origin/master`）改了 27 个 app 文件（+1988 / -563），其中包含 `App.tsx`、`BrowserPane.tsx`、`RightPanel.tsx` 这些看得见的地方。版本号却还是 0.1.9 —— **从当前 HEAD 出包，会产出一个和已交付 0.1.9 同号但内容不同的安装包**，用户没法区分。出包前必须升版。
3. **门禁实际能过**：`npm run build` exit 0；`cargo check` exit 0；`cargo test` **85/85 通过**；`cargo clippy` exit 0。唯一过不去的是 `cargo fmt --check`（20 个文件 116 处 diff），根因是仓库没有 `rustfmt.toml`、代码按旧版 rustfmt 排版，而本机 rustfmt 1.100 改了 import 排序规则 —— **是格式基准没定，不是代码坏**。
4. **Windows 构建工具链在本机是齐的**：MSVC 14.44 + Windows SDK 10.0.26100 + WebView2 157 + rustc 1.100 + tauri CLI 2.12.4。但 **NSIS / WiX 没有安装，tauri 打包器缓存目录也不存在**，第一次 `tauri build` 必须联网下载打包器。
5. **0.1.7「坏包」现在可以定性了**：本机 7 个历史安装包里，只有 0.1.7 的 PE 校验和非零且自洽（`0x00A39D2F`），也只有 0.1.7 的图标是卡塞尔图标。其余 6 个都是 makensis 原生输出（校验和 0）+ NSIS 默认蓝色图标。**图标补丁只打在了那个坏包上，0.1.8 / 0.1.9 都漏了** —— 所以 0.1.9 装的时候还是 NSIS 默认图标。
6. **仓库没有任何 CI**（无 `.github/`、无任何 yml）。发布靠人手跑命令，没有自动门禁。
7. **前端零测试、零 lint**（没有 test 脚本、没有 vitest/jest、没有 eslint/prettier）。Rust 侧 85 个测试里，PTY 只有 1 个在 Windows 上真跑（另 2 个是 `#[cfg(unix)]`）。

---

## 1. 版本一致性

### 1.1 五处版本号（已验证一致）

| 位置 | 行 | 值 |
|---|---|---|
| `app/package.json` | 4 | `"version": "0.1.9"` |
| `app/src-tauri/Cargo.toml` | 3 | `version = "0.1.9"` |
| `app/src-tauri/Cargo.lock` | 437 | `version = "0.1.9"`（`cassell-agent-terminal` 包） |
| `app/src-tauri/tauri.conf.json` | 4 | `"version": "0.1.9"` |
| `app/src/version.ts` | 2 | `export const APP_VERSION = "0.1.9";` |

顺带核到：`tauri.conf.json:3` 的 `productName` = 卡塞尔专员终端（7 个字符，`U+5361 U+585E U+5C14 U+4E13 U+5458 U+7EC8 U+7AEF`，无截断、无非法字节，JSON 可正常解析）。此前用 GBK 控制台看这个文件会出现 `鍗″灏斾笓鍛樼粓绔?` 一类乱码，**是控制台代码页假象，不是文件问题**。

已交付的 0.1.9 安装包 VERSIONINFO 也核对过：

```
FileVersion    : 0.1.9
ProductVersion : 0.1.9
ProductName    : 卡塞尔专员终端
CompanyName    :            <- 空
FileDescription: 卡塞尔专员终端
```

### 1.2 分支维度的版本漂移（真问题，P1）

命令：`git show <ref>:app/package.json` 再取 `"version"` 行。

| ref | 提交 | package.json 版本 |
|---|---|---|
| `origin/main`（GitHub 默认分支） | `179340c` | **0.1.8** |
| `origin/master` | `e40fea8` | **0.1.9** ← 实际最新已交付 |
| `origin/p1` | `7e8a1be` | 0.1.7 |
| `engine/v2`（当前工作分支） | `a391689` | 0.1.9 |
| `stabilize/0.1.9` | `69468a7` | 0.1.9 |
| `p1` / `backup/p1-20261114` | `fb7d5b3` | 0.1.7 |

`origin/HEAD -> origin/main`，所以**任何人克隆这个仓库，默认拿到的是 0.1.8**，比已交付版本落后。这不是代码问题，是发布卫生问题。

### 1.3 HEAD 与「已交付 0.1.9」的实际代码差异（P0 依据）

命令：`git diff --stat origin/master..HEAD -- app/`

```
27 files changed, 1988 insertions(+), 563 deletions(-)
```

其中 Rust 侧 20 个文件 +1817/-529，前端 3 个文件（`App.tsx`、`BrowserPane.tsx`、`RightPanel.tsx`）。变更清单含 `agent.rs`、`fsutil.rs`、`browser.rs`、`settings.rs`、`shell.rs`、`sandbox.rs`、`pty.rs`，以及整个新增的 `engine/` 目录。

**结论：版本号必须动。** 内容变、号不变，是发布里最容易出人命的一类错误。

---

## 2. 构建脚本与工具链

### 2.1 `app/package.json` scripts（全部，原文）

| 脚本 | 命令 | 说明 |
|---|---|---|
| `dev` | `vite` | 纯前端，1420 端口 |
| `build` | `tsc && vite build` | 类型检查 + 生产构建 |
| `preview` | `vite preview` | 预览产物 |
| `tauri` | `tauri` | CLI 直通 |
| `dev:mockup` | `vite --config vite.mockup.config.ts` | 假数据壳 |
| `app` | `tauri dev --config src-tauri/tauri.conf.json` | 正常开发 |
| `app:hot` | `tauri dev --config src-tauri/tauri.hot.json` | 前端走 mockup 配置 |
| `app:build` | `tauri build --no-bundle` | **只出 exe，不出安装包** |

**注意：没有任何脚本会产出安装包。** `app:build` 带 `--no-bundle`。要出 setup.exe 必须手敲 `npx tauri build`。这是交接时最容易漏的一条。

### 2.2 `tauri.conf.json` 关键项

| 项 | 行 | 值 |
|---|---|---|
| `beforeBuildCommand` | 8 | `npm run build` |
| `beforeDevCommand` | 7 | `npm run dev` |
| `frontendDist` | 10 | `../dist` |
| `devUrl` | 9 | `http://localhost:1420` |
| `bundle.targets` | 39 | **`"all"`** |
| `bundle.icon` | 40-46 | 32x32 / 128x128 / 128x128@2x / icon.icns / icon.ico |
| `bundle.active` | 38 | `true` |
| `identifier` | 5 | `com.cassell.agent` |
| `withGlobalTauri` | 36 | `true` |

`bundle` 段只有三个键：`active` / `targets` / `icon`。**没有 `bundle.windows`，因此没有 `bundle.windows.nsis`，也没有 `bundle.windows.wix`**（已用 Python 解析 JSON 确认）。后果见 §4.4。

`targets: "all"` 在 Windows 上意味着 **MSI（WiX）+ NSIS 两个都打**。Linux 交叉编译时只出 NSIS（HANDOFF 里写过「只有 NSIS 安装包」），本机原生构建会两个都试；WiX 失败会整体报错，必要时用 `--bundles nsis` 收窄。

### 2.3 Windows 相关配置与依赖

`app.windows[0]`（`tauri.conf.json:13-31`）：`decorations: false`（无边框自绘标题栏）、`transparent: false`、`dragDropEnabled: false`、`shadow: true`、`1440×900`、`minWidth 960`、`minHeight 640`、`center: true`。

`capabilities/default.json` 只开放 `core:default` + 窗口三操作（minimize / toggle-maximize / close）+ `start-dragging` + `opener:default`。**没有 fs、shell、dialog 权限** —— 前端拿不到直接文件系统能力，权限面是收着的。

Rust 侧 Windows 相关（`Cargo.toml`）：

- `portable-pty = "0.8"`（Windows 上走 ConPTY）
- `webview2-com = "0.39"`
- `windows = "0.62"`，features：`Win32_Foundation`、`Win32_System_Com`、`Win32_System_Com_StructuredStorage`
- release profile：`lto = true`、`codegen-units = 1`、`opt-level = 3`、`panic = "abort"`、`strip = true` → **release 构建慢是预期的**

### 2.4 本机环境实测（`npx tauri info`，exit 0）

```
OS: Windows 10.0.26200 x86_64
WebView2: 157.0.4341.57            OK
MSVC: Visual Studio 生成工具 2022   OK   (D:\Tools\CassellVS2022, cl 14.44.35207, SDK 10.0.26100.0)
rustc 1.100.0 / cargo 1.100.0 / rustup 1.29.3   OK  (stable-x86_64-pc-windows-msvc, default)
node 22.14.0 / npm 10.9.2 / pnpm 9.15.4
tauri 2.12.5 / tauri-build 2.7.4 / wry 0.57.2 / tao 0.37.2
@tauri-apps/api 2.12.4 / @tauri-apps/cli 2.12.4
tauri-plugin-dialog 2.8.4  (JS 侧未装)
tauri-plugin-fs     2.7.1  (JS 侧未装)
tauri-plugin-opener 2.7.3 + JS 2.7.3
```

`@tauri-apps/plugin-dialog` / `plugin-fs` 的 JS 包缺失**不构成问题**：前端全仓只有一处插件 import，在 `app/src/components/Drawers.tsx:2`，用的是 `@tauri-apps/plugin-opener`。dialog / fs 都只在 Rust 侧使用。

`rustup target list --installed` 只有 `x86_64-pc-windows-msvc`（本机原生构建够用，**不需要 `cargo-xwin`**）。

**缺的：** `where makensis` 找不到；`%LOCALAPPDATA%\tauri` 目录不存在。→ 第一次出包会联网下载 NSIS 与 WiX 到该目录。

### 2.5 实际构建/检查结果（全部本机跑过）

| 命令 | 结果 | 备注 |
|---|---|---|
| `npm run build` | **exit 0** | vite 8.3.8，88 modules，381ms |
| `cargo check` | **exit 0** | 2.28s，无 warning |
| `cargo test` | **exit 0，85 passed / 0 failed；finished in 0.01s** | 已编译，增量运行 |
| `cargo clippy --all-targets` | **exit 0**，27 条 warning | 明细见 §5.3 |
| `cargo fmt --check` | **exit -1（不通过）** | 116 处 diff / 20 文件，见 §5.4 |

构建产物（`app/dist`）：

```
dist/index.html                  1.33 kB
dist/assets/index-2lyEm-by.js    1,777.57 kB   gzip 445.59 kB
dist/assets/index-DFpH8Vdi.css      41.84 kB   gzip   8.41 kB
```

Vite 警告 `Some chunks are larger than 500 kB after minification`（阈值 500 kB，实际 1,777.57 kB，约 3.5 倍）。**这是警告，不是失败。**

### 2.6 CSP 观察（P2）

`tauri.conf.json:33`：

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; base-uri 'self'
```

`object-src 'none'` 与 `base-uri 'self'` 都设了，这部分是对的。但 `script-src` 带 `'unsafe-inline'` —— 它被 `dist/index.html` 里那段内联主题脚本（防首屏闪烁）依赖着。**改 CSP 前必须先处理那个内联脚本，否则会把启动画面搞坏。**

---

## 3. 分支与远端

### 3.1 当前状态

```
分支:   engine/v2
HEAD:   a391689  docs: 复核旧分析文档并统一源码报告口径   (2026-11-14 16:35:37 +0800)
工作区: 干净（git status 仅 ?? docs/audit/，即本审计目录，非代码）
远端:   origin  git@github.com:Meinan818/Cassell-agent-terminal.git
```

`engine/v2` **没有上游跟踪分支**（`git branch -vv` 中该行无 `[origin/...]`）。

### 3.2 与稳定线的关系（已验证）

```
git merge-base --is-ancestor stabilize/0.1.9 engine/v2   -> exit 0（是祖先）
git rev-list --count origin/master..HEAD                 -> 23
git rev-list --count HEAD..origin/master                 -> 0
```

**即 `engine/v2` 完整包含 0.1.9 稳定线，领先 23 个提交，无回退。** 这是一条干净的线性推进，不是分叉。

### 3.3 origin 各分支 tip

```
origin/HEAD   -> origin/main
origin/main    179340c  chore: bump version to 0.1.8 (P0-complete Windows installer)
origin/master  e40fea8  docs: 交接文档 HANDOFF-2026-11-13（用户 22:27 叫停开发、准备交给别的 AI）
origin/p1      7e8a1be  WIP: P1 第一批（P1-1 压缩 + P1-13 Compress2.0 + P1-17 上下文仪表盘）——未完成
```

`origin/main` 是 `origin/master` 的祖先（`--is-ancestor` exit 0），master 比 main 多 3 个提交，**两者没有分叉**，只是一个纯粹落后 3 个提交的默认分支。

### 3.4 与旧 `p1` 的关系

`git merge-base engine/v2 p1` → `b7d2086`。**`p1` 基于旧基线 `b7d2086`，不含 0.1.9 稳定线的修复**，所以 `p1` 的 WIP（`compact.rs` / `advisor.rs`）不能直接 cherry-pick 到 `engine/v2`，只能当参考重写。`backup/p1-20261114` 与 `p1` 同 SHA（`fb7d5b3`），是同一现场的备份。

### 3.5 未推送规模

`engine/v2` 相对 `origin/master` 领先 **23 个提交**，全部只在本地。

---

## 4. 发布物

### 4.1 仓库内没有任何发布产物（已验证）

- `app/src-tauri/target/` 只有 `debug/`，**没有 `release/`**，因此没有 `release/bundle/nsis/*.exe`。
- `app/dist/` 是前端产物（8 个文件 / 9,711,147 字节），不是安装包。
- 全仓（排除 `node_modules`）搜 `*.msi` / `*.exe` 只命中 `target/debug/**` 的构建中间产物。
- `windows-build/` 目录**不存在**（`D:\卡塞尔学院` 下递归搜索无结果）；`patch-installer-icon.py` **不在仓库里**（递归搜索无结果）。

结论：**本机没有可直接交付的 0.1.9 安装包副本，也没有能力重跑那个打图标补丁的脚本**（脚本本身已不在）。

### 4.2 历史安装包实物核对（本机 `D:\下载`）

| 文件 | 字节 | 时间 | SHA256（前 16 位） | PE 校验和 | 外壳图标 |
|---|---|---|---|---|---|
| `卡塞尔专员终端_0.1.2_x64-portable.zip` | 2,054,876 | 11-12 12:33 | `81E067F14EC7A5B2` | — | — |
| `..._0.1.4_x64-setup.exe` | 1,803,873 | 11-12 13:31 | `0D2F3E93BEF10835` | 0（未设置） | NSIS 默认 |
| `..._0.1.5_x64-setup.exe` | 1,804,138 | 11-12 13:52 | `B5E9318D03F7AD5F` | 0（未设置） | NSIS 默认 |
| `..._0.1.6_x64-setup.exe` | 10,589,072 | 11-13 07:55 | `07780211ECD57542` | 0（未设置） | NSIS 默认 |
| `..._0.1.6_x64-setup (1).exe` | 10,679,571 | 11-13 10:32 | `1F02D219E91FB233` | 0（未设置） | NSIS 默认 |
| `..._0.1.7_x64-setup.exe` | 10,678,596 | 11-13 13:18 | `004AA884918EF030` | **`0x00A39D2F`（自洽）** | **卡塞尔图标** |
| `..._0.1.8_x64-setup.exe` | 11,349,597 | 11-13 22:04 | `4C13B76E76B7CA66` | 0（未设置） | NSIS 默认 |
| `..._0.1.9_x64-setup.exe` | **11,349,592** | 11-13 22:29 | **`89E4407252D7B3C7E75D4194B9B80DFC7BC96026B6194042D615556F52B12ACD`** | 0（未设置） | NSIS 默认 |

**0.1.9 的字节数与完整 SHA256 与 `docs/HANDOFF-2026-11-13.md:31` 记录的完全一致** —— 交付物本身是完整的、没被换过的。

### 4.3 0.1.7「坏包」的技术定性（部分已验证 / 部分未直接验证）

两条独立证据指向同一结论：

1. **PE 校验和**（Python 解析 PE Optional Header 的 CheckSum 字段并重算标准值）：8 个包里**只有 0.1.7 的校验和非零且与重算值完全相等**（declared `0x00A39D2F` = calc `0x00A39D2F`）。其余 6 个 setup 的校验和字段都是 `0x00000000`（makensis 原生输出，Windows 容忍这种）。→ **0.1.7 被事后改写过 PE 头**，与「只修 PE checksum 的补丁脚本」完全吻合。
2. **外壳图标**（`System.Drawing.Icon::ExtractAssociatedIcon` 抽 exe 关联图标再比 PNG 哈希）：0.1.4/0.1.5/0.1.6/0.1.8/0.1.9 **图标哈希全部相同**（`25434bf6bae7b500…`，即 NSIS 默认蓝色安装器图标，已导出并肉眼确认）；0.1.7 唯一不同（`1a26d2b3c3f4d1e2…`，卡塞尔图标）。→ **图标补丁只执行在 0.1.7 上。**

**未直接验证：** NSIS 内部数据块 CRC 是否真的不匹配。直接验证需要 7z 解包测试或实际安装 0.1.7；本机没有 `7z`，且安装动作超出只读边界。`docs/HANDOFF-2026-11-13.md:117` 记录的根因是「只修 PE checksum、没修 NSIS CRC」，与上面第 1 条一致，但**我没有独立复现那次安装失败**。

### 4.4 图标补丁的风险：从「人」转移到了「配置」（P0）

- 危险的 `windows-build/patch-installer-icon.py` **已不在任何位置**，所以「误跑它」的直接风险消失了。
- 但**构建期仍然没有图标方案**：`tauri.conf.json` 的 `bundle` 只有 `active/targets/icon`，没有 `bundle.windows.nsis`。`bundle.icon` 里的 `icons/icon.ico` 只决定**应用 exe 的图标**，不决定**安装器外壳图标**。
- 结果：**从当前 HEAD 出包，安装器外壳仍然是 NSIS 默认蓝色图标**（与 0.1.8 / 0.1.9 表现一致）。
- 要修只能走配置路线（给 `bundle.windows.nsis` 指定自定义模板/图标，需先核对 tauri 2.12 的实际支持面），**绝不能再走后补脚本**。

### 4.5 其他发布物线索

- `D:\卡塞尔\卡塞尔终端-免安装\卡塞尔专员终端.exe`：13,299,712 字节，2026-11-13 00:07，VERSIONINFO = **0.1.6**。→ **便携版停在 0.1.6，落后 3 个版本。**
- 便携 zip 只到 0.1.2（`D:\下载\..._0.1.2_x64-portable.zip`）。→ 便携线整体是断的。

---

## 5. 测试与门禁

### 5.1 测试分布（`cargo test --lib -- --list`，权威 85 条）

| 模块 | 条数 |
|---|---|
| `goal` | 21 |
| `engine`（edit 3 + deepseek 3 + retry 2 + modes 2 + journal 2 + context 2） | 14 |
| `dsml` | 12 |
| `lore` | 7 |
| `agent` | 6 |
| `sandbox` | 6 |
| `models` | 4 |
| `frozen` | 4 |
| `usage` | 4 |
| `text` | 3 |
| `browser` | 2 |
| `pty` | **1** |
| `fsutil` | 1 |
| **合计** | **85** |

`main.rs` 0 条，doc-tests 0 条。

**一个容易误报的坑：** 直接 grep `#[test]` 会数出 **87** 个（`pty.rs` 里有 3 个），但实际只跑 85 个。原因是 `app/src-tauri/src/pty.rs:309` 和 `:350` 的测试带 `#[cfg(unix)]`，**在 Windows 上编译期就被排除**。所以：

> **Windows 上 PTY 只有 1 个测试在跑。** 而 PTY/ConPTY 正是 P0-11③「真终端」的实现路径 —— 这条功能在 Windows 上几乎没有自动化覆盖。

### 5.2 前端测试：零（已验证）

- `app/package.json` 无 `test` 脚本。
- `devDependencies` 只有 `@tauri-apps/cli` / `@types/react` / `@types/react-dom` / `@vitejs/plugin-react` / `typescript` / `vite`，**没有 vitest / jest / playwright / testing-library**。
- `app/` 下无 `.test.*` / `.spec.*`。
- 无 `eslint` / `prettier` / `.editorconfig` 配置。

前端唯一的门禁是 `tsc`（`tsconfig.json`：`strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`）。类型挡住了，行为没挡住。

规模参考：前端 26 个 `.ts/.tsx`，共 43,867 行；Rust 27 个文件，约 7,000 行（`agent.rs` 1490 / `goal.rs` 1360 / `fsutil.rs` 493 / `dsml.rs` 495 / `tool_pipeline.rs` 402 / `browser.rs` 400）。

### 5.3 clippy：能过，但 27 条未清（P1）

`cargo clippy --all-targets` exit 0，`Finished dev profile`，**27 条独立 warning**（另有 2 条汇总行，grep 会数成 29）：

| 条数 | lint |
|---|---|
| 16 | `collapsible_if`（if 可合并） |
| 4 | `manual_char_comparison`（手写字符比较可简化） |
| 1 | `needless_borrow` |
| 1 | owned instance 仅为比较 |
| 1 | `manual_div_ceil` |
| 1 | `unnecessary_cast`（`u32` → `u32`） |
| 1 | `empty_line_after_doc_comments` |
| 2 | `too_many_arguments`（**8/7 与 10/7**） |

按文件：`goal.rs` 9、`agent.rs` 8、`policy.rs` 2、`dsml.rs` 2、`codex.rs` 2、`browser.rs` 1、`lore.rs` 1、`tool_pipeline.rs` 1、`fsutil.rs` 1。

`too_many_arguments` 那两条（参数 8 个 / 10 个）是**结构信号**，不是风格洁癖 —— 对应工具执行入口的参数爆炸。

### 5.4 `cargo fmt --check` 不通过（P1）

- 结果：**exit -1**，`116` 处 `Diff in`，覆盖 **20 个 src 文件**（`agent.rs`、`browser.rs`、`codex.rs`、`dsml.rs`、`engine/{context,deepseek,journal,mod,policy,retry,tool_pipeline,tooling}.rs`、`fsutil.rs`、`goal.rs`、`lore.rs`、`models.rs`、`pty.rs`、`sandbox.rs`、`settings.rs`、`usage.rs`）。
- **仓库里没有 `rustfmt.toml` / `.rustfmt.toml`**（递归搜索无结果）。
- diff 主体示例（`agent.rs:8`）：

```
-use crate::settings::{load_settings, Settings};
+use crate::settings::{Settings, load_settings};
```

这类 **import 排序变化**占绝大多数 —— 是 rustfmt 1.100 的默认排序规则与当年排版时的版本不同导致，**不是代码写坏了**。

- 判断：现在把 `cargo fmt --check` 当发布门禁会永远红。要么补一个固定 `rustfmt.toml` 并一次性 `cargo fmt` 全仓（会产生一个巨大的纯格式提交），要么明确把它排除出门禁。**二选一必须有人拍板，不能继续挂着。**

### 5.5 无 CI（P1）

- 无 `.github/` 目录；全仓（排除 `node_modules`）搜 `*.yml` / `*.yaml` 无结果。
- 意味着上面所有门禁都是「靠人记得跑」，没有任何自动拦截。

### 5.6 遗留环境垃圾

`app/xtest.py` 是 **Linux X11 + XTest 的鼠标/键盘自动化脚本**（`ctypes.CDLL("libX11.so.6")`），是当年 Linux 虚拟机里做点击验收留下的，在 Windows 上跑不了。它跟着仓库一起走，会误导后来的人。

---

## 6. 从当前 HEAD 出 Windows 安装包需要什么

### 6.1 必须先拍板的（本机做不了）

| # | 前置 | 为什么卡在这 |
|---|---|---|
| 1 | **决定新版本号** | 现在仍是 0.1.9 而内容已变（27 文件 +1988/-563），出包会与已交付 0.1.9 撞号。建议 `0.1.10`；若按语义化，拆出 `engine/` 并重构 `agent.rs` 也可算 `0.2.0`。 |
| 2 | **决定从哪条线出包** | 直接在 `engine/v2` 出，还是先合回 `master`？`engine/v2` 无上游跟踪、23 个提交未推送。 |
| 3 | **图标策略二选一** | (a) 接受 NSIS 默认安装器图标，先出包；(b) 先给 `bundle.windows.nsis` 配自定义图标再出。**禁止再用后补脚本。** |
| 4 | **真机验收** | 只能在用户的 Windows 真机上装、开、用。 |

### 6.2 版本号要改的位置（漏一处就会出现「装的是新版、属性显示旧版」）

```
app/package.json:4
app/src-tauri/Cargo.toml:3
app/src-tauri/tauri.conf.json:4
app/src/version.ts:2
app/src-tauri/Cargo.lock:437      <- 由 cargo 自动更新，但必须确认它跟着变了
```

另按 `HANDOFF-2026-11-13.md` 既有约定：安装包**文件名也要带版本号**，交付时提醒用户**先卸载旧版**。

### 6.3 本机可以做的部分（前提已验证齐备）

| 步骤 | 命令 | 本机状态 |
|---|---|---|
| 前端构建 + 类型检查 | `cd app; npm run build` | 已实测 exit 0 |
| Rust 单测 | `cd app/src-tauri; cargo test` | 已实测 85/85 |
| Rust 静态检查 | `cargo check` / `cargo clippy` | 已实测 exit 0 |
| 原生构建 + 打包 | `cd app; npx tauri build` | **未实跑**（原因见下） |
| 只要 exe 不要安装包 | `npm run app:build`（= `tauri build --no-bundle`） | 未实跑 |
| 只打 NSIS | `npx tauri build --bundles nsis` | 未实跑 |
| 校验产物哈希 | `Get-FileHash -Algorithm SHA256` | 可用；**本机无 7z**，需先装或用 PowerShell 替代 |
| 产物路径 | `app/src-tauri/target/release/bundle/nsis/*.exe` 与 `.../release/cassell-agent-terminal.exe` | 目录尚不存在（无 release 构建） |

**为什么没实跑打包（诚实说明）：** `tauri build` 会做 LTO + `codegen-units=1` 的全量 release 编译（预计十几分钟），会新写 `target/release/`，并且**首次会联网下载 NSIS + WiX 到 `%LOCALAPPDATA%\tauri`**。这属于会产生新产物与外部下载的写操作，超出本次只读审计边界，因此列为未验证。上表中标「已实测」的都是真跑过的。

### 6.4 打包时容易踩的三条（有据可查，不是猜测）

1. **`targets: "all"` 会同时试 MSI 和 NSIS。** WiX 那条更容易失败；如果只想出 setup.exe，用 `--bundles nsis` 收窄。
2. **不要再走 Linux 交叉编译老路。** `HANDOFF-2026-11-13.md:133` 记的是 `--target x86_64-pc-windows-msvc --runner cargo-xwin`（Linux 虚拟机方案，依赖 makensis 3.09 / LLVM 18 / clang-cl 软链）。**本机是 Windows 原生 + MSVC 14.44 + SDK 10.0.26100，不需要 xwin**，直跑 `npx tauri build` 即可。照抄旧的交叉编译命令反而会失败。
3. **永远用 Tauri CLI 构建**，不要直接 `cargo build --release` —— 后者不会跑 `beforeBuildCommand`，也不生成 bundle，`dist/` 可能还是旧的。

---

## 7. 风险表

### P0 — 发布阻断

| # | 风险 | 证据 | 建议 |
|---|---|---|---|
| P0-1 | **版本号冲突**：HEAD 内容已变但仍是 0.1.9，与已交付 0.1.9 撞号 | `git diff --stat origin/master..HEAD -- app/` = 27 files, +1988/-563；五处版本仍 0.1.9 | 出包前先升版并同步 5 处 |
| P0-2 | **安装器图标没有构建期方案**：`bundle` 无 `windows.nsis`，只能出 NSIS 默认图标；历史补救手段已被证明会造坏包 | `tauri.conf.json` 的 bundle keys = `[active, targets, icon]`；0.1.7 唯一带补丁图标、也唯一 PE 校验和非零 | 要么接受默认图标，要么配 `bundle.windows.nsis`；禁止后补脚本 |
| P0-3 | **`engine/v2` 从未做过 Windows 真机运行**：`engine/*` 与 `tool_pipeline` 拆分后只过了编译和单测 | 交接摘要记录「最新 tool_pipeline 拆分后没有启动 Windows 应用做真实交互验收」；本机 `target/` 无 release 产物 | 出包前至少本地 `tauri dev` 跑一遍对话 + 审查 + 终端 + 浏览器 |

### P1 — 应在下次发布前处理

| # | 风险 | 证据 | 建议 |
|---|---|---|---|
| P1-1 | **GitHub 默认分支停在 0.1.8** | `origin/HEAD -> origin/main`，`origin/main` = `179340c` = 0.1.8，比 master 少 3 个提交 | 默认分支切到 master，或把 main 快进到 master |
| P1-2 | **23 个提交只在本地**，`engine/v2` 无上游 | `git rev-list --count origin/master..HEAD` = 23；`git branch -vv` 无跟踪 | 明确后推分支，避免再出现「本机才有最新代码」 |
| P1-3 | **`cargo fmt --check` 恒红**，无法当门禁 | exit -1，116 diff / 20 文件，无 `rustfmt.toml` | 补 `rustfmt.toml` 并一次性全仓格式化，或明确排除 |
| P1-4 | **无 CI**，所有门禁靠人记 | 无 `.github/`、无 yml | 至少加一条 build + test 工作流 |
| P1-5 | **PTY 在 Windows 只有 1/3 测试** | `pty.rs:309` / `:350` 为 `#[cfg(unix)]`；`--list` 只列出 1 条 | ConPTY 路径需要 Windows 侧断言或真机脚本 |
| P1-6 | **clippy 27 条未清**，含 2 条 `too_many_arguments`(8/7, 10/7) | `cargo clippy --all-targets` 输出，`goal.rs` 9 / `agent.rs` 8 | 先修 2 条参数爆炸（结构信号），其余批量 `--fix` |
| P1-7 | **便携版停在 0.1.6** | `D:\卡塞尔\卡塞尔终端-免安装\卡塞尔专员终端.exe` VERSIONINFO = 0.1.6；portable zip 只到 0.1.2 | 决定是否继续维护便携线，维护就补齐 |
| P1-8 | **没有出包脚本**，必须手敲 `npx tauri build` | `package.json` 的 `app:build` 带 `--no-bundle` | 加一个 `release:win` 脚本，把版本断言 + bundle + 哈希串起来 |

### P2 — 记录在案，不阻断

| # | 风险/问题 | 证据 |
|---|---|---|
| P2-1 | 单包 1.78 MB 无代码分割 | vite 警告 `1,777.57 kB > 500 kB`；`dist/assets` 只有 1 个 js |
| P2-2 | 默认图标残留 | `dist/index.html` 的 favicon 仍指 `/vite.svg`；`dist/` 里有 `vite.svg` + `tauri.svg` |
| P2-3 | CSP 含 `script-src 'unsafe-inline'`，且被内联主题脚本依赖 | `tauri.conf.json:33` + `dist/index.html` 内联 `<script>` |
| P2-4 | 安装包元数据不全 | 0.1.9 setup 的 `CompanyName` 为空；`bundle` 无 publisher/copyright/category |
| P2-5 | 无自动更新配置 | `bundle` 无 `createUpdaterArtifacts`，整个配置无 updater 段 |
| P2-6 | Linux 遗留脚本混在源码里 | `app/xtest.py` 依赖 `libX11.so.6` |
| P2-7 | 无版本 git tag | `git tag -l` 输出为空；7 个历史安装包无法对应到提交 |

---

## 8. 事实边界

### 8.1 本报告实际执行过的命令（可复现）

```
git status --short / branch --show-current / log -1 / remote -v / branch -a -vv
git merge-base --is-ancestor stabilize/0.1.9 engine/v2
git merge-base engine/v2 p1
git rev-list --count origin/master..HEAD / HEAD..origin/master / origin/main..origin/master
git show <ref>:app/package.json
git diff --stat origin/master..HEAD -- app/
git tag -l
npm run build
cargo check / cargo test / cargo test --lib -- --list / cargo clippy --all-targets / cargo fmt --check
npx tauri info
rustc -V / cargo -V / rustup target list --installed / node -v / npm -v
where.exe makensis / 7z / cl
vswhere -products * -format json
Get-FileHash -Algorithm SHA256（8 个历史安装包）
System.Drawing.Icon::ExtractAssociatedIcon（外壳图标比对）
Python: PE Optional Header CheckSum 解析与重算、tauri.conf.json JSON 解析、ICO/PNG 尺寸解析
```

### 8.2 已验证

- 五处版本号一致（0.1.9），且 0.1.9 setup 的 VERSIONINFO 一致
- `npm run build` / `cargo check` / `cargo test(85/85)` / `cargo clippy` 的实际结果
- `cargo fmt --check` 实际不通过及 diff 规模
- 分支祖先关系、23 提交领先、0 落后、main/master 无分叉
- 8 个历史安装包的字节数与 SHA256；0.1.9 与 HANDOFF 记录逐位一致
- 0.1.7 的 PE 校验和唯一非零且自洽；0.1.7 的外壳图标唯一不同
- 本机无 release 产物、无 `windows-build/`、无 `patch-installer-icon.py`
- 本机工具链齐备（MSVC/SDK/WebView2/rustc/tauri CLI），NSIS/WiX 与 tauri 缓存缺失
- 无 CI、无前端测试、无 lint 配置
- 85 与 87 的差额来源（`pty.rs` 两条 `#[cfg(unix)]`）

### 8.3 未验证 / 有边界

- **未跑 `tauri build`**：会产生 release 产物并联网下载 NSIS/WiX，超出只读边界。所以「能不能出包」目前是**前提齐备**，不是**实测通过**。
- **未做 Windows 真机安装与运行验收**。
- **未直接验证 0.1.7 的 NSIS CRC 损坏**：现有证据是「PE 头被改写」与「图标被换」两条旁证，不是解包/安装复现。本机无 7z。
- **未验证 `bundle.windows.nsis` 自定义图标在本项目 tauri 2.12.5 上的具体写法**：需查当前官方文档后再定，不能凭记忆。
- 本报告只覆盖**构建 / 版本 / 发布**这条线；前端结构、引擎架构、功能对标不在范围内（前端见同目录 `docs/audit/frontend.md`）。

---

*本文件为只读审计产物。执行过程中没有修改任何代码、配置、分支或远端；临时产生的构建日志已移出仓库并清理。*
