# 卡塞尔专员终端（Cassell Agent Terminal）

《龙族》卡塞尔学院专员专用的 AI agent 桌面端 —— 日常办公与工程执行终端。

> 早期开发中。代码先私有，不开源。

## 定位

- 产品是专业办公终端，不是二创网站。龙族只留身份与语境层：专员身份、学院配发终端、AI 是诺玛（学院中枢 AI）。
- 功能叫本名：工具调用就是工具调用，沙箱就是沙箱。不硬套言灵等设定。
- NORMA 对标 Claude Cowork（通用工作、资料、文档、整理）；EVA 对标 Claude Code（工程、代码、终端、测试）。两者是同一产品的两种模式，共用记忆；EVA 的 Ultracode 是工程侧增强，不是第三模式。

## 技术路线

- 桌面端：Tauri 2 + React + TypeScript，Windows 优先。
- 模型路线：BYOK —— 不由软件定一家模型，用户自己配置 API Key 接入干活，支持 DeepSeek、Kimi、千问、GPT 等多家。Key 存本地。

## 设计语言

- Codex 式简洁，白黑双主题，全圆角（不要直角），不要廉价字体与线框感。
- 动画设计语言对标 Grok Bot：全站统一运动系统（一套弹簧参数、所有状态变化有过渡、控件有按压/悬停反馈、60fps 只动 transform/opacity）。
- 活标记：诺玛与 EVA 共用同一圆球形象，只以颜色与表情区分（诺玛墨色，EVA 蓝色）；眼睛是小药丸形，长在球面上。
- AI 输出消息为 GPT 式流式输出（逐字流出、带光标）。
- 开机仪式：白色细粒子螺旋汇聚成卡塞尔校徽，接指纹身份验证、S 级血统、ACCESS GRANTED，最后落到「欢迎你，专员」。

## 最小可用版本（MVP）

- 对话（流式输出）+ 新会话空态（活标记、专员问候、建议芯片、上下文栏）
- 模型选择器（服务商:模型 + 思考强度 low→max，EVA 并行档）
- 权限盾：审批模式（Auto / 只读）+ 沙箱模式（read-only / workspace-write / danger-full-access）
- 审查队列：Changes 增减统计、逐文件通过/拒绝

## 以后迭代

`/ `命令面板、会话操作（恢复/重命名/分支/复刻）与检查点回退、Skills 与 MCP、定时任务、用量状态、BYOK 服务商表设置页。

功能对标见 [`docs/research/codex-claude-feature-study.md`](docs/research/codex-claude-feature-study.md)（Codex / Claude Code 功能调研，2026-11-11）。

接手/继续开发先读：

- [`docs/audit/PROJECT-AUDIT.md`](docs/audit/PROJECT-AUDIT.md)：项目现状、代码地图、功能状态、风险总表；
- [`docs/PLAN-NEXT.md`](docs/PLAN-NEXT.md)：0.2.0 的分阶段计划与第一批任务；
- [`docs/HANDOFF-2026-11-13.md`](docs/HANDOFF-2026-11-13.md)：上一轮交接（产品定位与铁律）。

## 仓库结构

```text
docs/
  research/   功能调研与对标
```

应用代码在 `app/`；当前稳定线为 0.1.9（Tauri 2 + React + TS + 原生 Rust agent）。
