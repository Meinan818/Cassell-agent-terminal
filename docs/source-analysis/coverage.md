# 源码覆盖台账

这份台账回答一个问题：**四份源码分析报告，到底读了多少、哪些只是登记、哪些还没读。**

它不是“阅读量排行榜”，而是防止把模块名总结冒充源码分析。后续每补读一块，就在对应表格里把等级从 D 改成 A/B，并注明证据落在哪份附录。

## 1. 覆盖等级

| 等级 | 含义 | 证据要求 |
|---|---|---|
| **A 深读** | 逐文件或大段读过实现 | 结论能落到 `文件:行号` 或具体类型/函数 |
| **B 结构级** | 读过入口、导出、清单、关键类型，未逐行走实现 | 能说清模块边界和调用方向 |
| **C 登记** | 只统计文件数/行数或按目录归类 | 只用于测试、生成物、vendor、快照、纯 UI 资产 |
| **D 未覆盖** | 现有报告没有读，或只有一句话带过 | 必须补读，不能写成“已分析” |

**“全仓每个文件逐行”不是本项目的目标，也不应假装做到。** 目标是：产品功能涉及的代码路径达到 A/B，非产品代码有明确的 C 级理由。

## 2. 总账

快照时间：2026-11-14。数据源：`git ls-files`。

| 项目 | 提交 | tracked 文件 | 源码文件（按扩展名） | 顶层目录 |
|---|---|---:|---:|---:|
| Codex | `6ddb87e` | 10,336 | 7,141 | 13 |
| Tianshu | `2d0b22e` | 4,599 | 4,139 | 13 |
| Pi | `827383a` | 4,546 | 3,667 | 7 |
| DeepSeek Harness | `39163dd3` | 21,632 | 7,926 | 14 |

源码文件口径：`.rs .ts .tsx .js .jsx .mjs .cjs .py .go .java .c .h .cpp .hpp .cs .swift .kt .sh .ps1`。不含 JSON、Markdown、快照、图片。

## 3. Codex

主报告：[codex.md](./codex.md)。补读附录：[codex-appendix.md](./codex-appendix.md)。

### 3.1 仓库层

| 顶层目录 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `codex-rs` | 9,777 | A/B | 主产品，207 个 workspace members |
| `sdk` | 125 | B | TS/Python SDK，协议封装 |
| `scripts` | 58 | C | 构建/发布脚本 |
| `third_party` | 94 | C | 第三方补丁与 vendored 代码 |
| `docs` | 15 | B | 官方说明，只作辅助 |
| `codex-cli` | 9 | B | npm 包装层 |
| `patches` / `bazel` / `tools` | 92 | C | 构建与补丁 |

### 3.2 `codex-rs` 模块

| 模块 | 规模 | 等级 | 说明 |
|---|---:|---|---|
| `core` | 988 rs | A | turn、工具、审批、上下文、压缩、多代理 |
| `tui` | 1,265 rs | C | 终端 UI，产品形态不采用；未逐文件读 |
| `app-server` / `app-server-protocol` / `app-server-daemon` | 502 rs | A- | JSON-RPC、线程、远控协议 |
| `exec-server` | 204 rs | B | 执行后端，读过入口 |
| `core-plugins` / `plugin` / `plugin-host` | 148 rs | B | 插件运行时，未深读 |
| `ext`（18 个扩展） | 355 rs | A | 附录逐个读入口与核心实现 |
| `execpolicy` | — | A | 附录补 `decision.rs` 四态与聚合规则 |
| `sandboxing` / `windows-sandbox-rs` / `linux-sandbox` | 202 rs | B | 策略选择与平台后端，未做真机拦截验证 |
| `rollout` / `thread-store` / `state` | 199 rs | A- | JSONL、线程存储、SQLite |
| `network-proxy` | 76 rs | B | 域名允许/拒绝、凭据注入 |
| `codex-mcp` / `rmcp-client` | 194 rs | B | MCP 客户端与连接池 |
| `skills` / `hooks` | 58 rs | A- | 技能模型、14 类 hook |
| `worktree` | 6 rs | A | 附录补创建/归属/列举/加固全链 |
| `code-mode*` | 138 rs | C | V8 Code Mode，不采用 |
| `realtime-webrtc` / `voice-host` | 48 rs | C | 语音链路，不采用 |
| `cloud-*` / `backend-client` / `chatgpt` / `login` | — | C | 云账号/计费/认证，不采用 |
| `prompts` / `model-provider` / `models-manager` | 101 rs | B | 提示词与模型目录 |
| `otel` / `analytics` / `feedback` | 65 rs | B | 观测与反馈 |
| 其余约 150 个小 crate | — | C | 工具库、平台适配、测试支撑；按目录登记 |

### 3.3 Codex 原缺口（已补读，见 [codex-appendix.md](./codex-appendix.md)）

- `core/src/tasks/*`：`SessionTask`/`TaskKind` 四种任务生命周期
- `core/src/session/review.rs`：独立 review 线程
- `core/src/codex_delegate.rs`：委派协议
- `execpolicy/src/decision.rs`：`PromptUser` 第四态
- `worktree/src/*`：worktree 生命周期
- `ext/` 其余 15 个扩展的真实功能
- `hooks` 14 类事件的执行器与失败策略

以上均由附录补到 A/B；附录同时修正了 `TaskKind` 只有三个变体、`PromptUser`
只存在于托管规则、`hooks/types.rs` 的 legacy `HookEvent` 只有 `AfterAgent`
三处容易误读的结论。

## 4. Tianshu

主报告：[tianshu.md](./tianshu.md)。补读附录：[tianshu-appendix.md](./tianshu-appendix.md)。

### 4.1 仓库层

| 顶层目录 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `src` | 3,780 | A/B | 主程序，39 个顶层模块 |
| `vscode-extension` | 87 | A | 附录逐文件读扩展入口与 webview |
| `plugins` | 70 | A | 附录读插件加载器、清单与安装 |
| `native` | 3 | A | 附录全读 Job 对象与 supervisor |
| `scripts` | 228 | C | 安装、发布、诊断脚本 |
| `docs` | 302 | B | 项目文档，只作辅助 |
| `website` | 63 | C | 官网 |
| `prompts` | 11 | B | 提示词模板 |
| `benchmark` / `runtime-assets` / `completions` | 10 | C | 基准与补全资源 |

### 4.2 `src` 模块

| 模块 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `agent`（含 `council`、`hooks`、`worker-process`） | 1,308 | A | 附录补 worker-process 与 hooks 边界 |
| `tools`（含 `bash`、`browser`、`computer-use`） | 506 | A | 附录补 computer-use 桩与审批表 |
| `cache` | 31 | A | 前缀缓存经济学核心 |
| `compact` | 30 | A | 压缩档位、回收估算 |
| `context` | 76 | A | compact-policy |
| `prompt` | 82 | A | prefix budget、frozen anchors、engine |
| `api` | 162 | A- | provider profile、cost model、continuation-prefix |
| `server` | 382 | A- | cron、session persistence |
| `config` | 117 | A- | project-trust |
| `skills` / `memory` / `token-ledger` | 103 | A- | 技能加载、统一记忆、token 账本 |
| `mcp` / `lsp` / `plugins` / `hooks` / `plan` / `recovery` | 122 | B | 读过入口与策略 |
| `tui` | 532 | C | 终端 UI，不采用 |
| `constellation` | 10 | A- | 星域仅作认知姿态，已判定不采用 |
| 其余约 15 个模块 | — | B/C | 工具库、平台、存储、诊断 |

### 4.3 Tianshu 原缺口（已补读，见 [tianshu-appendix.md](./tianshu-appendix.md)）

- `vscode-extension/src` + `webview-ui`：贡献点、消息协议、是否独立产品
- `plugins/`：插件清单格式、安装/加载机制
- `native/job-launch.c`、`job-hook-supervisor.h`：Job 对象与进程树
- `src/tools/computer-use/*`：截图、鼠标键盘、权限边界
- `src/agent/worker-process/*`：worker IPC 与生命周期

以上由附录覆盖 255 个文件；`desktop/` 与 `src/pro/` 不在公开快照，仍是明确边界。

## 5. Pi

主报告：[pi.md](./pi.md)。补读附录：[pi-appendix.md](./pi-appendix.md)。

### 5.1 仓库层

| 顶层目录 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `packages` | 3,252 | A/B | 12 个包 |
| `apps` | 1,165 | D | 应用外壳，附录补读 |
| `scripts` | 68 | C | 构建脚本 |
| `.pi` | 18 | C | 项目自身配置 |

### 5.2 `packages` 模块

| 包 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `agent` | 21 | A | agent loop、事件模型、工具协议 |
| `coding-agent` | 870 | A | 附录补包管理/资源/技能/导出全链 |
| `durable` | 295 | A | 附录补调度器与任务图 |
| `ai` | 478 | A- | 附录补 provider 注册；20 个 API 实现未读 |
| `mcp` | 53 | B | MCP 命名与传输 |
| `codemode` | 35 | B | 代码模式运行时 |
| `tui` | 127 | C | 终端 UI，不采用 |
| `schema` / `env` / `telemetry` / `evals` | 359 | B/C | 类型、环境、遥测、评测 |
| `chord` | 1,014 | B | 附录读约 1/10 并给出“不学”的源码依据 |

### 5.3 Pi 原缺口（已补读，见 [pi-appendix.md](./pi-appendix.md)）

- `core/package-manager.ts`：包安装/升级/离线/失败类型
- `core/resource-loader.ts`：资源发现顺序与冲突
- `core/skills.ts`：SKILL.md frontmatter 与注入
- `export-html`：会话导出格式
- `chord`：核心抽象与不学理由
- `durable/src/harness/{scheduler,task-graph}.ts`
- `ai/src/providers/`：provider 注册、元数据、鉴权
- `apps/`：应用外壳与运行方式

以上由附录补到 A/B；provider 口径修正为 43 个实现（不是 48）。

## 6. DeepSeek Harness

主报告：[deepseek-harness.md](./deepseek-harness.md)。补读附录：[deepseek-harness-appendix.md](./deepseek-harness-appendix.md)。

### 6.1 仓库层

| 顶层目录 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `packages` | 11,711 | A/B/C | 53 个包组、382 个 package.json |
| `apps` | 1,644 | A | 附录读 6 个应用入口与核心模块 |
| `.agents` | 4,177 | C | agent 定义/资源，非引擎实现 |
| `snapshots` | 1,996 | C | 快照/评测夹具 |
| `docs` | 1,186 | B | 文档，只作辅助；已明确区分文档证据 |
| `scripts` / `benchmarks` / `website` / `patches` | 573 | C | 工具与站点 |
| `vendor` / `native` / `python` | 230 | B/C | 原生与 Python 桥 |

### 6.2 `packages` 模块

| 包组 | 文件数 | 等级 | 说明 |
|---|---:|---|---|
| `core`（session/agent-loop/tools） | 265 | A | 事件模型、turn/step、工具管线 |
| `session` | 460 | A | 附录补 persistence/format 迁移链 |
| `compaction` | 93 | A | 附录补三事件、锁与孤儿锁算法 |
| `interaction`（user-approval） | 95 | A | 附录补审批协议与拒绝回传 |
| `workspace` | — | A | 附录补多工作区注册表 |
| `client` | 3,447 | C | 客户端 SDK/生成物，非引擎核心 |
| `experimental` | 2,689 | C | 实验包，按目录登记 |
| `llm` / `api` / `subagent` / `context` / `bundle` / `boot` / `host` | 1,573 | B | 按包清点，读过接口 |
| `skill` / `sandbox` / `mcp` / `credentials` / `goal` / `schedule` / `workflow` / `jobs` / `team` / `guard` | 900+ | B | 按包清点，读过 README/入口 |
| `util` / `test-support` / `storage` / `fs` / `shell` / `terminal` / `subprocess` | 1,100+ | C | 基础设施 |
| 其余约 20 组 | — | C | 外围/生成物/实验 |

### 6.3 DSH 原缺口（已补读，见 [deepseek-harness-appendix.md](./deepseek-harness-appendix.md)）

- `apps/` 6 个应用：cli、desktop、desktop-host、desktop-publisher、plugin-market-generator、web
- `session-persistence-jsonl`：追加写、代文件轮转、崩溃恢复
- `session-format-*`：v0→v4 迁移链
- `compaction/src/types.ts`：三事件字段与 surfaceOp
- `interaction/user-approval`：allowed-once、超时、拒绝回传
- `workspace/workspace`：workspace 注册表
- `core/session/src/types.ts` 287–435：14 个事件键完整字段

以上由附录补到 A/B；`packages/sandbox/*`、`llm/*`、`client/*`、`experimental/*`
仍未逐包读，见附录 §10。

## 7. Claude Code

闭源，没有源码快照。只做：

- 公开 `sdk-tools.d.ts` 的 81 个输入/输出接口；
- CLI `--help`、`--version`、配置目录、会话文件格式等黑盒观察；
- 官方文档与社区分析交叉核对。

等级上限是 **B（结构级）**，不能标 A。真实 API 黑盒实验未执行（需要预算）。

## 8. 怎么用这份台账

1. 写新结论前先查表：D 级模块不允许写出“源码表明”这种句式。
2. 补读完一块，更新等级和附录链接，不重写主报告全文。
3. 报告之间的数字冲突以台账的 `git ls-files` 口径为准；行数口径必须注明“含空行/非空行”。
4. 测试文件、生成物、vendor、快照不逐行读，但要能说清为什么不影响产品结论。
