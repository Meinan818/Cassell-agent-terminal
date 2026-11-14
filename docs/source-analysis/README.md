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

- [Codex](./codex.md)
- [Tianshu](./tianshu.md)
- [Pi](./pi.md)
- [DeepSeek Harness](./deepseek-harness.md)
- [Claude Code](./claude-code.md)（闭源，只做公开接口/社区分析）
- [Claude Code 本地黑盒逆向](./claude-code-reverse.md)

## 一句话结论

- Codex：成熟在**协议、会话、压缩、策略、沙箱和应用服务器分层**。
- Tianshu：成熟在**缓存优先、上下文预算、交付门、路径授权和 DeepSeek 工程**。
- Pi：成熟在**最小核心、agent loop 事件模型、durable runtime 和包边界**。
- DeepSeek Harness：成熟在**session/tool/context 的插件化边界**，但“一切皆插件”不采用。
- Claude Code：模型和工具交互成熟，但闭源，不能假装做过源码级全量审阅。

## 复核状态

四份开源报告已由独立复核代理抽查：Codex 34 个证据点、Tianshu 30 个、
Pi 26 个、DSH 24 个。复核结果是：没有指向不存在文件/函数/行的严重错误；
已修正 Codex 的 worktree 行数、`Decision` 第四态、`ext` 数量；
Tianshu 的模块计数和 `src/` 外目录缺口；Pi 的 provider 数量与
package-manager/skills 缺口；DSH 的 14 事件、文件计数和文档证据等级。

仍未做到“全仓每个文件逐行”：

- Tianshu 的 VS Code 扩展、插件市场、native 进程钩子只做了目录级登记；
- DSH 的 `apps/` 只做了目录级核对；
- Pi 的部分外围包没有逐行统计算力；
- Claude Code 闭源，只能黑盒 + 公开接口。

这些是明确的覆盖边界，后续补读，不用“模块名总结”冒充全量源码通读。
