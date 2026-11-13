# 卡塞尔专员终端 (Cassell Agent Terminal) — v0.1.0 MVP

卡塞尔学院配发给专员的日常执行终端。AI 是诺玛；打开 EVA 开关后，诺玛切换为
EVA 模式（并行编排 + 交叉核查）。对标 Codex / Claude Code 的产品级 AI agent
桌面端，龙族只留身份与语境，功能全部叫本名。

**这是一个能用的版本，不是模型稿。** 发消息会真的跑 Codex CLI 做事，改文件、
跑命令、审查变更都接在真实的 Git 状态上。

## 技术栈

- **Tauri 2 + React 19 + TypeScript**（桌面壳）
- **执行引擎：开源 Codex CLI**（`openai/codex`，Apache 2.0），后端直接驱动
  `codex exec --json`，逐行解析 JSONL 事件流回聊天界面
- **模型路线：BYOK** — 你自己在设置里填各家 API Key（DeepSeek / Kimi / 千问 /
  OpenAI），Key 只保存在本机设置文件，不上传

## 本机能做什么（v0.1 已做实）

- 对话：发指令 → 真实 agent 回合，工具调用、改文件、错误都以消息形式落进对话
- 新会话空态：按时间问候（夜深了/早安/上午好/午安/下午好/晚上好）+ 轮换小任务
- 活标记：圆形球体 + 白色药丸眼（诺玛墨色 / EVA 蓝色），自己眨眼、张望、跟视线倾斜，
  待机/聆听/思考/工作/完成几种表情
- 开机仪式：白色粒子汇聚成真校徽（`public/cassell-seal.jpg`，用户提供的校徽图）
  → 指纹身份验证 → 血统评级 S → 终端启动日志 → 「欢迎你，路专员」→ 淡入工作区
  （Esc / 点“跳过”可跳过；设置里可关闭）
- 模型选择器（常驻面板，点选项只打勾不关闭）：服务商 / 模型 / 自定义模型名 /
  思考强度 低→Max→EVA（并行）
- 权限盾（常驻面板）：审批 Auto / 只读确认 + 沙箱 只读 / 工作区可写 / 完全访问
- EVA 开关：打开后按 ultra 强度 + EVA 人设跑，标记变蓝
- 审查队列：按工作区真实 Git diff 生成；逐文件通过 / 拒绝（拒绝会 `git checkout`
  还原，文件留在列表里显示“已拒绝 · 已还原到 HEAD”）；接受全部变更会弹出完成卡
  （文件数、+− 统计、时间戳）+ 撤销入口；什么都不会凭空消失
- 右侧栏 5 个标签：审查 / 终端（真 shell，30 秒超时）/ 文件（浏览 + 预览）/
  浏览器（邀请码复制 + 在系统浏览器打开任意网址）/ 插件与 MCP（开关实时保存）
- 左侧栏：新建任务、搜索、项目过滤、最近列表、身份卡片（路明非 · S2017-0117 · S 级）、
  设置 / 档案库 / 帮助抽屉
- 设置抽屉：API Key 配置 + 测试连通（真实发一次最小请求）、工作区目录、Codex CLI
  检测与路径、主题、开机动画、流式输出开关
- 浅色 / 深色双主题；全站同一套弹簧动效（只动 transform / opacity）；任务列表存
  localStorage，重启不丢

## 在 Windows 上运行

### 1. 装依赖（只需要一次）

1. **Node.js 20+**：去 [nodejs.org](https://nodejs.org) 下 LTS，装完确认：
   `node --version` / `npm --version`
2. **Rust（stable）**：去 [rustup.rs](https://rustup.rs) 下 `rustup-init.exe`，
   一路默认装完，**关掉重开命令行**，确认：`cargo --version`
3. **Codex CLI**（执行引擎）：
   `npm install -g @openai/codex`，确认：`codex --version`
4. **WebView2**：Windows 10/11 自带，一般不用装；没有的话去微软官网装
   WebView2 Runtime。

### 2. 拿代码、装包、跑起来

```powershell
git clone <仓库地址> cassell-agent-terminal
cd cassell-agent-terminal/app
npm install

# 开发模式（热更新）
npm run tauri dev

# 打包成安装程序（产物在 src-tauri/target/release/bundle/）
npm run tauri build
```

### 3. 第一次使用

1. 打开左侧栏底部的 **设置**。
2. 在 **API Key 配置** 里选服务商（默认 DeepSeek），填 Key，点 **测试连通**，
   看到“连通正常”就说明能干活了。
3. 把 **任务工作目录** 改成你要让诺玛干活的项目目录（最好是 Git 仓库，
   这样审查队列才能按 diff 工作）。
4. 回到主界面发指令，例如：`把校验规则抽成一个单独的函数`。

### 常用操作

- Enter 发送，Shift + Enter 换行；Esc 关闭面板 / 跳过开机动画
- 任务进行中点发送按钮（变 ■）可停止
- 输入框右下角的模型按钮、权限盾都是常驻面板：点选项只打勾，点外面 / Esc /
  点“完成”才收起

## 配置说明

- 设置保存在应用配置目录的 `settings.json` 里（Key 是明文存的，MVP 阶段如此，
  后续版本会移到系统钥匙串；不要把这个文件发给别人）。
- 各服务商默认走 `/v1/responses`（Codex 0.164 只支持 Responses 协议），
  DeepSeek / Kimi / 千问 / OpenAI 都已验证可达。
- 思考强度映射：低→low，中→medium，高→high，Max→xhigh，EVA→xhigh（+ EVA 人设）。

## 已知限制（v0.1，老实写在这里）

- **流式输出是“逐条到达”不是“逐字”**：Codex CLI 0.164 的 `--json` 只在每条
  agent_message 完成时才吐全文，没有逐字 delta 事件，所以界面是整条整条出现，
  不是逐字打字机效果。等 Codex 提供逐字事件再接。
- **EVA 模式 v1 的区分是仪式感 + 提示 + 节奏**：打开 EVA 开关时有启动提示、对话里
  EVA 回合前有一行安静小字（点开看明细）、活标记眨眼与张望更快；真正的多智能体
  并行编排与交叉核查在后续版本接入。
- **Linux 打包**：`npm run tauri build` 会产出可执行文件、.deb 与 .rpm；AppImage
  一步会因中文产品名失败（appimagetool 要求 ASCII 名，Tauri 2 没有 AppImage
  单独改名配置），不影响 Windows 的 NSIS/MSI 打包。
- **MCP 开关只保存状态**，服务器的实际接线（stdio/远程）下个版本做。
- **内置浏览器还没做**：浏览器标签现在是邀请码复制 + 在系统浏览器打开网址。
- 任务列表只存在本机浏览器存储（localStorage），换电脑不带走；多设备同步后续做。
- API Key 目前明文存在本机 `settings.json`，后续移到系统钥匙串。

## 目录结构

```
app/
├── src/                    # React 前端
│   ├── App.tsx             # 主界面：布局 + 对话 + 运行状态机
│   ├── types.ts            # 共享类型 + 问候/强度等常量
│   ├── lib/events.ts       # Codex JSONL 事件解析（已对实测事件做过单元测试）
│   └── components/
│       ├── Boot.tsx        # 开机仪式（粒子 + 指纹 + 血统 + 日志 + 过渡）
│       ├── Mark.tsx        # 活标记（圆球 + 白色药丸眼）
│       ├── Sidebar.tsx     # 左侧栏（任务/项目/身份卡片）
│       ├── Composer.tsx    # 输入框（常驻模型/权限/附件面板）
│       ├── RightPanel.tsx  # 右侧栏（审查/终端/文件/浏览器/插件）
│       └── Drawers.tsx     # 设置/档案库/帮助抽屉
├── src-tauri/src/
│   ├── lib.rs              # 命令注册
│   ├── codex.rs            # Codex CLI 驱动（run_agent / cancel / 测连通）
│   ├── settings.rs         # 设置持久化（本地 JSON）
│   ├── fsutil.rs           # 文件浏览 + Git 审查队列
│   └── shell.rs            # 终端命令执行
└── README.md               # 本文件
```

## 开发命令（Linux/macOS 也一样）

```bash
npm run build        # 前端类型检查 + 打包
npm run tauri dev    # 开发模式
npm run tauri build  # 打包
```

## 许可证

应用本身随仓库协议；执行引擎 Codex CLI 为 Apache 2.0（openai/codex）。
