# 旧分析文档复核：哪些已经写过、哪些这轮才补、哪些口径要改

这份文件回答一个很具体的问题：**在 `docs/source-analysis/` 之前，项目里已经
有过一批 Codex / Claude / 天枢分析；这轮新报告到底重复了多少、补了什么、
哪些旧结论必须保留。**

复核日期：2026-11-14。

## 1. 旧文档清单

| 文档 | 体量 | 日期 | 性质 | 本轮处理 |
|---|---:|---|---|---|
| `docs/抄什么不抄什么_Claude-Codex-天枢.md` | 70.1 KB / 510 行 | 2026-11-13 | 产品级“抄/不抄”决策底稿，含 NORMA/EVA 定稿 | **全文读完**，作为产品判断基线 |
| `docs/tianshu-4.0.4-拆包研究报告.md` | 44.4 KB / 约 330 行 | 2026-11-13 | 天枢 4.0.4 安装包拆解（Tauri + rivet-runtime） | **全文读完**，作为 4.0.4 运行时证据 |
| `docs/claude-code-cli-teardown.md` | 65.7 KB / 约 610 行 | 2026-11-13 | Claude Code / DeepSeek-TUI / dsh TUI 的 CLI 视觉与交互拆解 | **读了关键章节**（渲染引擎、综合对照、选型） |
| `docs/research/codex-claude-feature-study.md` | 50.4 KB / 189 行 | 2026-11-11/12 | Claude Code vs Codex 功能总表与差异 | **读了摘要、对比表、开放问题** |
| `docs/ENGINE-BENCHMARK.md` | 13.9 KB / 约 250 行 | 2026-11-14 | 引擎层通用能力对照与迁移顺序 | **全文读完** |
| `docs/FEATURE-BENCHMARK.md` | 21.9 KB / 467 行 | 2026-11-14 | 功能级解剖（搜索、浏览器、星域、记忆、Skills、子代理等） | **全文读完** |
| `docs/research/*` 其它分报告 | 多份 | 2026-11-12 | Codex 功能缺口、ultracode 原理、天枢 DeepSeek 优化、Codex 设置、子代理展示 | **读了其中 5 份的关键章节**，见 §2.5 |

## 2. 旧文档已经回答了什么

### 2.1 Claude

旧文档比这轮新报告更细的地方：

- **Cowork 是独立工作面**：文件夹级授权；删除文件永远要批；Manual / Auto /
  Skip 三档；连接器 > 浏览器 > 屏幕操作的优先级；Projects 工作区；
  Docs / Slides / Design；明确不做软件开发，不建议处理银行、法律、医疗、
  凭证类文件；提示注入无法完全消除。
- **Claude Code 六档权限**：Manual / Accept edits / Plan / Auto / dontAsk /
  Bypass；Auto 自 v2.1.283 起是终端/VS Code 的默认起始模式。
- **检查点 / 倒带**：最多 100 个检查点、约 30 天；可只回对话、只回代码、
  或两者都回；只覆盖 Claude 自己改的文件。
- **Hooks 33 类事件**（官方核实），不是新报告二进制里能直接看到的 18 个名称。
- **沙箱**：只包 shell，默认关闭；macOS Seatbelt、Linux bubblewrap；
  原生 Windows 没有沙箱。
- **Agent Teams（实验）**：共享任务清单 + 邮箱消息，和 ultracode 是两套机制。
- **Auto memory 默认开启**；Codex 的 Memories 默认关闭。
- **`/batch`**：把任务拆成 5–30 个独立单元，每个单元一个 worktree + 一个 PR。
- **`/advisor`**：第二模型咨询，Anthropic API 限定。

### 2.2 Codex

旧文档已经写清、而新报告没有展开的产品层：

- 四种形态：ChatGPT 桌面里的 Codex 模式、开源 CLI、IDE 扩展、Cloud/Web。
- **两把独立 dial**：sandbox（read-only / workspace-write /
  danger-full-access）× approval（untrusted / on-request / never）。
- **Plan + Goal**：Plan 回答“怎么做”，Goal 回答“什么算完成”；Goal 是线程级
  持久目标，空闲续跑，≤4,000 字符。
- **Side chat、Queue/Steer、Fork + Esc-Esc 改写、Worktree + Handoff**。
- **Automations + Triage 收件箱**：Standalone 与 Thread 两种；结果进 Triage。
- **14 个 hook 事件，支持 Windows**；旧报告“暂不支持 Windows”已被证伪。
- **没有文件级 rewind**：文件回滚靠 git；`/rewind` 仍是 open 的功能请求。
- **Memories 默认关闭**，需要显式开启。

### 2.3 天枢

`tianshu-4.0.4-拆包研究报告.md` 是本项目里**唯一一份对 4.0.4 安装包做过实际
拆解**的文档，结论比公开源码报告更贴近本机版本：

- 桌面端是 **Tauri 2.12.4**，不是 Electron；`rivet-runtime/` 是 292MB 的
  Node 运行时，JS 混淆但字符串可读；`integrity.json` 带 337 个文件 sha256
  与 minisign 签名。
- **共鸣星域（Resonance）**：Pro 专属、独立 HTTP 内核服务、侧车进程、
  天琴/太一两个人格；聊天只保留对话 + 联网搜索，回答必须引用来源。
- **极限思考（Extreme Thinking）**：`createWriteLock` / `withWriteLock` 写锁；
  研究态 low/high 两档；`interference_search`；目标模式感知 `awaiting_choice`。
- **XiaoSi Compress2.0**：先归档再压缩；`<xiaosi-checkpoint>` 密封；
  压缩期间历史变了禁止替换。
- **XiaoSi Axiom 记忆插件**：四条公理、短期槽位 + 长期校准、4 级级联检索、
  六路召回、三道门、确定性权重公式、`axiom_recall/remember/forget/timeline/status/lens`。
- **spawn-broker**：并行派生由 broker 管，主循环不直接 spawn。
- **模型 ID 映射与推理强度契约**：`MODEL_SYNONYMS`、`GO_CONTRACTS`、
  压缩模型解耦、退役 ID 迁移。
- **Windows 自愈**：WebView2 修复已证实；其余三项未确认。

### 2.4 CLI / TUI

`claude-code-cli-teardown.md` 的结论仍然有效：

- Claude Code 的终端渲染是 **Ink 深度 fork 的半自研引擎**（React reconciler +
  Yoga 布局保留，渲染管线重写），不是从零自研；v2.x 是否再次重写未证实。
- 三个参考分别是 Claude Code、DeepSeek-TUI（现 Codewhale，Rust + Ratatui）、
  dsh TUI（像素鲸鱼，多路线）。
- 给卡塞尔 CLI 的选型建议是 **Rust + Ratatui**，不是 Ink/Bubble Tea/OpenTUI；
  先用成熟框架，实测到瓶颈再 fork。

### 2.5 research 子报告里已经写过的硬结论

| 报告 | 本轮读到什么 | 对现在的作用 |
|---|---|---|
| `research/tianshu-deepseek-20261112/report.md` | 天枢六层架构；冻结前缀/CacheAdvisor/压缩档位；5 个真实长会话 2,001 次请求、6.45 亿 input tokens、命中率 99.3–99.6%、账单 ¥880→¥20；DSML/模型 ID/思考参数 | 作为天枢 DeepSeek 优化的**实测数据来源**；新报告只补源码实现 |
| `research/deepseek-api-adaptation-20261112/report.md` | DeepSeek 官方模型/价格/峰谷；`deepseek-flash` 与 `deepseek-v4-pro`；思考只有 low/high/max，中=高；带 tools 必须回传 `reasoning_content`；思考时 `tool_choice` 只能 auto；无服务端压缩 | 作为 `engine/deepseek.rs` 和上下文策略的**规格依据** |
| `research/claude-code-ultracode-principles-20261112-0032/report.md` | ultracode 是“xhigh + 动态工作流”的会话开关；LLM 写编排脚本，`parallel()` vs `pipeline()`；Agent Teams 是另一套机制；成本/限制/失败模式 | 作为 EVA 并行编排的**产品层依据**；本轮没有重读全文，只读了摘要与机制段 |
| `research/codex-feature-gap-analysis-20261112-0110/report.md` | Codex 四种形态、Goal/Plan、会话/模式/权限/沙箱、Subagents、Skills/MCP/Hooks、Automations、审查、上下文、桌面 App、Slash 命令全表、Gap Analysis | 作为 Codex 产品层**最全的旧清单**；新 Codex 附录只补源码 |
| `research/codex-settings-features-complete-20261112-0145/report.md` | Codex Desktop 设置、`config.toml` 全量、功能/Slash 命令、模型与 provider 配置 | 作为 Codex 设置项的**对照表**；本轮未逐条核，标为旧报告 |
| `research/agent-subagent-display-sidebar-20261112-0038/report.md` | 子代理展示、工作详情、侧栏的桌面 UI 研究 | UI 已冻结；仅作后续设计参考，本轮不采用 |

## 3. 这轮新增了什么

旧文档强在产品层和“抄什么”的判断；这轮新报告强在**源码调用链和实现边界**：

| 项目 | 本轮新增的源码级内容 |
|---|---|
| Codex | `core/src/tasks/*` 任务生命周期、`review` 子会话、`codex_delegate`、`execpolicy` 四态、`worktree` 全链、`hooks` 执行器、18 个 `ext` crate |
| 天枢 | `vscode-extension/` 87 文件、`plugins/` 70 文件、`native/` Job 钩子、`computer-use` 桩、`worker-process` |
| Pi | `package-manager.ts`、`resource-loader.ts`、`skills.ts`、`export-html`、`chord`、调度器、provider 注册、`apps/` 三件套 |
| DSH | 6 个 `apps/`、JSONL 持久化、v0→v4 迁移链、压缩锁与孤儿锁算法、`user-approval`、`workspace`、14 个 `SessionEvent` 完整字段 |
| Claude | 372MB 单文件程序的二进制字符串证据：920 个 `CLAUDE_CODE_*`、103 个 `DISABLE_*`、12 态工具结果、6 种权限模式、18 个可确认 hook 名称、compact thrash 检测 |

## 4. 口径冲突与最终采用

| 主题 | 旧文档说法 | 新报告说法 | 最终采用 |
|---|---|---|---|
| Claude 工具数量 | 社区分析称“80+ 工具” | `sdk-tools.d.ts` 实测 44 个工具输入 + 44 个输出 = 88 个接口 | **44 个工具 / 88 个接口**；“80+”是旧社区口径 |
| Claude hooks | 官方核实 **33 类事件** | 二进制字符串可确认 **18 个名称** | **33 类（官方）**；二进制只能证明这 18 个名称存在 |
| Claude 权限模式 | Manual / Accept edits / Plan / Auto / dontAsk / Bypass | 枚举 `default / acceptEdits / plan / auto / bypassPermissions / dontAsk` | 是同一组六档，`default` 就是 Manual |
| Codex hooks | 14 个事件，支持 Windows | 附录实测 14 类事件 | 一致，采用 14 |
| Pi provider | 旧报告曾写 48 个 | 附录实测 43 个实现 + 43 个模型目录 | **43 个 provider 实现** |
| Codex TaskKind | 新报告初稿写 regular / compact / review / user_shell 四种 | 附录实测 `TaskKind` 只有 Regular / Review / Compact 三种 | **3 种**；`user_shell` 是独立任务实现但 kind 为 Regular |
| 天枢 4.0.4 | 公开源码停在 `2d0b22e`，不能说 4.0.4 源码 | 拆包报告在 `rivet-runtime/` 里找到 4.0.4 运行时实现 | **分两层**：源码报告覆盖公开 3.37.4；4.0.4 结论以拆包报告为准 |
| DSH desktop | 新报告初稿只做目录级核对 | 附录实测 Electron 壳 + desktop-host 子进程 + 本地 HTTP 服务 | **三段式**，不是“Electron 里写界面” |

## 5. 必须保留的旧结论（不要重开）

以下不是“旧报告的观点”，而是已经定稿的产品决策，本轮新报告全部沿用：

1. **NORMA = Cowork，EVA = Code**；同一产品两种模式，共用记忆，任务绑定模式。
2. **EVA 的 Ultracode 是工程侧增强，不是第三模式。**
3. **不采用天枢 16 星域、人格、议会、星域投票**；只借“独立验证、只读审查、
   聊天纪律”的机制。
4. **不采用 DSH“Everything is a Plugin”/ Cordis 插件树**；只借 session /
   turn / step / tool pipeline / compaction 的事件边界。
5. **UI 冻结**：未经明确授权不改可见界面；旧 CLI 拆解只作为设计参考，
   不自动落地。
6. **本地优先、BYOK**：不把 Cloud/Remote/手机遥控作为核心依赖。
7. **危险动作永远要批**：尤其删除、对外发送、支付、权限变更。

## 6. 两份“主参考”怎么配合使用

- 做**产品功能和取舍**：先看 `docs/抄什么不抄什么_Claude-Codex-天枢.md` 和
  `docs/FEATURE-BENCHMARK.md`；它们已经把 Cowork、Codex 桌面、星域等产品层
  讲透。
- 做**引擎和源码实现**：看 `docs/source-analysis/` 的主报告 + 附录；它们给
  调用链、类型、行号和边界。
- 做**天枢 4.0.4**：公开源码看 `tianshu.md` / `tianshu-appendix.md`；
  4.0.4 运行时看 `docs/tianshu-4.0.4-拆包研究报告.md`。两者不能互相冒充。
- 做**CLI/TUI**：看 `docs/claude-code-cli-teardown.md`；那是设计层，
  不是引擎层。

## 7. 结论

旧文档不是“重复劳动”，它们是产品判断和 4.0.4 运行时证据的底稿；这轮新报告
是源码实现层的补充。**两者合起来才是完整答案。** 以后写新分析前，先查这份
索引和 `coverage.md`，避免再把已经写过的功能重新“发现”一遍。
