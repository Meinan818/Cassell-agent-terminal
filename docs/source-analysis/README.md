# 源码级对标分析索引

这组文档不是功能宣传页，而是按项目拆源码、模块、入口、关键调用链和功能边界。

## 覆盖方式

已把开源项目拉到：

```text
D:\卡塞尔学院\research-src\
```

当前快照：

| 项目 | 分支 | 提交 | 文件数 |
|---|---|---|---:|
| Codex | `main` | `6ddb87e` | 10,336 |
| Tianshu | `main` | `2d0b22e` | 4,599 |
| Pi | `main` | `827383a` | 4,546 |
| DeepSeek Harness | `master` | `39163dd3` | 21,632 |

版本差异必须一起看：

- Tianshu：GitHub 源码快照提交信息是 `v3.37.4 stable rev45`；本机安装是
  `4.0.4`。**源码报告覆盖的是旧一代公开源码，不能冒充 4.0.4 源码结论**；
  4.0.4 只能做本机 runtime 观察。
- DeepSeek Harness：GitHub 源码快照是 `dsh-0.2.2-rc.3`；本机安装是
  `0.2.1-rc.2`。源码报告比本机新，二者差异要单独标。
- Codex：本机 CLI `0.167.0-alpha.3.2`；源码快照 `6ddb87e`，需按当前提交
  而非本机版本理解。
- Pi：本机没有安装，只有 GitHub 源码。

“源码级”在这里指：

1. 清点全部顶层模块和主要包；
2. 沿入口、agent loop、工具、权限、会话、上下文、压缩、观测逐层读关键实现；
3. 功能结论尽量落到文件路径和类型/函数；
4. 测试文件和极深层枝叶不作逐行抄读，但不把它们当成产品功能。

## 项目报告

- [Codex 主报告](./codex.md) / [补读附录：任务、Review、Delegate、ExecPolicy、Worktree、Hooks、18 个扩展](./codex-appendix.md)
- [Tianshu 主报告](./tianshu.md) / [补读附录：VS Code 扩展、插件、native Job、computer-use、worker](./tianshu-appendix.md)
- [Pi 主报告](./pi.md) / [补读附录：包管理、资源、技能、导出、chord、调度器、provider、apps](./pi-appendix.md)
- [DeepSeek Harness 主报告](./deepseek-harness.md) / [补读附录：apps、持久化、格式迁移、压缩锁、审批、workspace、14 事件](./deepseek-harness-appendix.md)
- [Claude Code](./claude-code.md)（闭源，只做公开接口/社区分析）
- [Claude Code 本地黑盒逆向](./claude-code-reverse.md)（含二进制字符串证据、12 态工具结果、6 种权限模式）
- [Claude Code 工具面全表（44 个工具 / 88 个接口）](./claude-tools.md)
- [源码覆盖台账（A/B/C/D 四级，防止把目录登记冒充通读）](./coverage.md)
- [旧分析文档复核（哪些已经写过、哪些这轮才补、哪些口径要改）](./prior-analysis-review.md)

### 旧分析文档（已复核，不要重复造）

- [`docs/抄什么不抄什么_Claude-Codex-天枢.md`](../抄什么不抄什么_Claude-Codex-天枢.md)：产品级“抄/不抄”决策底稿，含 NORMA/EVA 定稿。
- [`docs/tianshu-4.0.4-拆包研究报告.md`](../tianshu-4.0.4-拆包研究报告.md)：天枢 4.0.4 安装包拆解，4.0 运行时证据以它为准。
- [`docs/claude-code-cli-teardown.md`](../claude-code-cli-teardown.md)：Claude Code / DeepSeek-TUI / dsh TUI 的 CLI 设计与渲染拆解。
- [`docs/research/codex-claude-feature-study.md`](../research/codex-claude-feature-study.md)：Claude Code vs Codex 功能总表。
- [`docs/ENGINE-BENCHMARK.md`](../ENGINE-BENCHMARK.md) / [`docs/FEATURE-BENCHMARK.md`](../FEATURE-BENCHMARK.md)：引擎与功能层对照。

## 一句话结论

- Codex：成熟在**协议、会话、压缩、策略、沙箱和应用服务器分层**。
- Tianshu：成熟在**缓存优先、上下文预算、交付门、路径授权和 DeepSeek 工程**。
- Pi：成熟在**最小核心、agent loop 事件模型、durable runtime 和包边界**。
- DeepSeek Harness：成熟在**session/tool/context 的插件化边界**，但“一切皆插件”不采用。
- Claude Code：模型和工具交互成熟，但闭源，不能假装做过源码级全量审阅。

## 复核与补读状态

四份开源报告已由独立复核代理抽查：Codex 34 个证据点、Tianshu 30 个、
Pi 26 个、DSH 24 个。复核结果是：没有指向不存在文件/函数/行的严重错误。

2026-11-14 第二轮补读完成：

- Tianshu：`vscode-extension`、`plugins`、`native`、`computer-use`、`worker-process`、官网与安装/更新脚本已补读（255 个文件，附录 911 行）。
- DSH：`apps/` 6 个应用、`session-persistence-jsonl`、`session-format-*` 迁移链、compaction 锁、`user-approval`、`workspace`、14 事件完整字段已补读（附录 1,059 行）。
- Pi：`package-manager`、`resource-loader`、`skills`、`export-html`、`chord`、调度器、provider 注册、`apps/` 三件套已补读（附录 852 行）。
- Codex：`tasks/`、`review`、`codex_delegate`、`execpolicy` 四态、`worktree`、`hooks`、18 个 `ext` 已补读（附录 911 行）。
- Claude Code：本机二进制字符串分析补齐 12 态工具结果、6 种权限模式、18 类 hook、压缩 thrash 检测、920 个环境变量与 103 个 DISABLE 开关的结构；工具面校正为 44 个工具 / 88 个接口。

仍存在的覆盖边界（已写进各附录第 10 节）：

- Tianshu 的 `desktop/` 与 `src/pro/` 不在公开快照，客户端更新器和 computer-use 真实现不可核对；
- DSH 的 `packages/sandbox/*`、`llm/*`、`client/*`、`experimental/*` 未逐包读；
- Pi 的 `chord` 只读约 1/10，`ai` 的 20 个 API 实现未读，`apps/p2` 的 18 万行只读入口；
- Codex 的 `tui`、`app-server`、`exec-server`、cloud 系列未展开；
- Claude Code 闭源，只能二进制字符串 + 公开接口 + 黑盒，不能声称源码级全量。

完整分级见 [coverage.md](./coverage.md)。一句话：**产品功能涉及的主路径已达到源码级（A/B），非产品代码有明确 C 级理由，剩余边界逐项登记，不用“模块名总结”冒充全量通读。**

## 建议阅读顺序

1. 先看本页的“一句话结论”和 `coverage.md`，知道每份报告的边界。
2. 做引擎：Codex 主报告 §2/§3 + Codex 附录 §1/§4/§6；Pi 附录 §2-§5；天枢主报告 §3-§4；DSH 附录 §2/§4/§5。
3. 做产品功能：`FEATURE-BENCHMARK.md` + Claude 工具面全表 + 天枢附录 §11 + Pi 附录 §10。
4. 做 DeepSeek 优化：天枢主报告 §4.1-§4.6 + 天枢附录 §9.3 + Codex 附录 §7。
