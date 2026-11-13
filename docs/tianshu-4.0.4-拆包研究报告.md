# 天枢 4.0.4 安装包拆包研究报告

> 研究对象：天枢桌面端 v4.0.4（2026-11-06 发布），GitHub huiliyi37/Tianshu-harness
> 安装包：`Tianshu_4.0.4_x64-setup.exe`，897,908,580 字节（约 856MB），NSIS 安装包，
> SHA-256 `9134fca0d362ace23247d1e9c9a8da58bc642e19b448b8834ebe7d826e858591`（与官网一致）
> 解包位置：`~/workspace/tianshu-research/extracted/`（12,260 个文件，约 1.3GB）
> 研究方法：只拆包、只读文件，不运行程序，不联网调用天枢的任何服务
> 报告日期：2026-11-13

**先说最重要的结论（一句话）：4.0 真正的新东西不在公开源码里，但也不全在黑盒里——它在安装包里。** 公开源码停在旧提交 `2d0b22e`（五个 v4.0.x tag 全指它）这点没错，但安装包里有一份 292MB 的 Node 运行时，里面的 JS 只是混淆、不是加密，字符串全能读出来。共鸣星域、极限思考、XiaoSi 两件套这些 4.0 机制，在这份运行时里都有名有姓、有函数、有协议、有数据结构。桌面端前端是例外：它被嵌进主程序 exe 里，读不到源码。

---

## 1. 包结构总览

### 1.1 顶层长什么样

| 部分 | 大小 | 是什么 |
|---|---|---|
| `tianshu-desktop.exe` | 170MB | 主程序，**Tauri 2.12.4**（Rust 壳 + WebView2 内核，wry 0.57.0），桌面端前端嵌在它里面 |
| `rivet-runtime/` | 292MB | **4.0.4 的核心**：Node.js 写的 agent 运行时（就是天枢内核），`package.json` 写明 `tianshu-harness 4.0.4` |
| `node-runtime/` | 107MB | 自带的 win-x64 Node，用来跑上面那个运行时 |
| `whisper-runtime/` | 134MB | 语音转文字（Whisper）运行时 |
| `native-media/` | 186MB | 开机视频（`alice-boot-1..4.mp4`、`taiyi-boot.mp4` 等） |
| `plugins/` | 74MB | 插件：office-docx/excel/pdf/ppt、xiaosi-axiom、design、dynamic-background、tianshu-imbridge、trace-lab、hello-world |
| `shell-runtime/` | 57MB | shell 相关运行时 |
| `ripgrep-runtime/` | 20MB | ripgrep 搜索工具 |
| `mobile-web/` | 2.9MB | 手机端网页（`mobile.html` + 带 hash 的静态资源） |
| `windows-repair/` | 很小 | WebView2 修复脚本（见 §2.10） |
| `$TEMP/` | 很小 | 只有 WebView2 安装器 |

### 1.2 框架：Tauri，不是 Electron

主程序是 **Tauri**，证据是 exe 字符串里有 `__TAURI_`、`tauri://`、`asset:` 协议、CSP 配置，以及构建路径 `/Users/lanbinyuan/.cargo/registry/src/.../tauri-2.12.4/src/protocol/asset.rs`（在一台 Mac 上构建的，用户名 lanbinyuan）。WebView2 是它的网页渲染内核（wry 0.57.0 的 `webview2/mod.rs`）。

这对卡塞尔是个直接参考：卡塞尔也是 Tauri + Windows 优先，天枢证明了这条路能装下 170MB 的主程序 + 292MB 的 Node 侧车。

### 1.3 核心运行时 `rivet-runtime/` 长什么样

- 309 个文件，入口是 Node 脚本（`pro/index.js` 的 shebang 是 `node --expose-gc --max-old-space-size=4096`）。
- 带一份 **`integrity.json`**：产品名 `tianshu-desktop`、模式 `code`、337 个文件各带 sha256、整包 `bundleHash`，还有一段 minisign 签名。抽查验证过：`pro/search/index.js` 的实际 sha256 与清单里登记的完全一致——**清单是真的，不是摆设**。
- JS 是**压缩 + 混淆**过的：javascript-obfuscator 风格，变量名全是 `_0x...`，字符串存在数组里轮换取用，一个文件只有一行。逻辑读不全，但**字符串字面量全能 grep 到**：函数名、中文提示、错误文案、路由、配置键都没混淆。
- 另外有 120 个具名模块（`checkpoint-*.js`、`goal-tracker-*.js`、`plan-approval-*.js`、`cvm-ledger-*.js`、`path-grants-*.js`、`project-trust-*.js`、`tool-preset-*.js`、`prefix-budget-*.js`、`session-persist-*.js`、`session-registry-*.js`、`spawn-broker-*.js`、`web-search-*.js`、`meridian-indexer-*.js`、`pro/` 等），其余是 `chunk-*.js` 大杂烩。
- `native/better_sqlite3.node`：SQLite 原生模块（给 Meridian 索引库用）。
- `node_modules/` 里除了常规依赖，还有一个值得注意的东西：**`dsh-pet`**（桌面宠物，见 §2.13）。

### 1.4 桌面端前端：嵌在 exe 里，读不到

解包后的文件里**没有桌面端前端的 HTML/JS**（只有一个 `mobile-web/`）。exe 字符串里能看到前端资源的路径：`/assets/index-DNbo44wJ.js`、`/assets/WorkspaceLocationPanel-*.js`、`/assets/SkillsSurface-*.js`、`/assets/4.0.2-*.js`、`/assets/3.28.0-*.js`、Monaco 编辑器（`/monaco/vs/...`）、KaTeX 字体、dagre/mindmap 资源，还有 SPA 的"找不到就回退到 index.html"。也就是说：**前端 bundle 被 Tauri 以 asset 协议嵌进 exe 了**，只能看到文件名和版本号，看不到代码。前端长什么样、怎么实现的，本次拆包**无法确认**。

exe 字符串还泄露了天枢的服务端点（只作记录，不调用）：
- 许可服务器 `tianshu-license-server.huiliyi37.workers.dev`、履约服务器 `tianshu-fulfillment-server.huiliyi37.workers.dev`（Cloudflare Workers）
- 支付 `pay.plotstudio.cn`、更新 `update.plotstudio.cn`、更新清单 `tianshu-update.oss-cn-hangzhou.aliyuncs.com/tianshu/latest.json`（阿里云 OSS）+ GitHub releases 的 `latest.json`
- 头像存 Supabase（`grcedmhghzroqnirizcy.supabase.co`）
- 更新包用 minisign 签名验签（exe 里有一段 minisign 公钥）
- Tauri 命令里有 `webview2_repair`、`activate_with_code`（激活码）、`deepseek_login`、`official_model_...`、`get_sidecar_runtime` / `set_sidecar_runtime`（侧车运行时管理）、`runtime_storage_*`（运行时存储位置）

---

## 2. 4.0 新功能逐项：是什么、代码里怎么实现的、卡塞尔抄不抄

> 约定：每项先给"拆包证实 / 已在公开源码 / 未确认"的定性，再讲实现证据，最后讲卡塞尔怎么抄。
> "已在公开源码"的意思是：这个机制在公开提交 `2d0b22e` 里已经有了，**不是 4.0 新东西**，旧报告研究过它，拆包只是又验证了一遍。

### 2.1 共鸣星域（Resonance）——4.0 的二分，拆包证实，Pro 专属

**是什么。** 天枢 4.0 把产品切成两半：**天枢内核**写代码，**共鸣星域**聊天/理思路/查新消息。官网原话"写代码交给天枢内核，聊天、理思路、查新消息交给共鸣星域"。星域的人格叫**天琴**（Lyra，天琴座），称用户为「共鸣者」；代码里还有第二个人格**太一**（Taiyi）。

**代码里怎么实现的（证据都在 `rivet-runtime/` 里）。**

- **Pro 门禁是真的。** 默认配置里 `pro.features` 明确列着 `resonance: true`，Pro 功能目录（`PRO_CATALOG`）里有一条 `{'key': 'resonance', 'surface': 'desktop', 'wired': true}`。非 Pro 调用直接回 403（`{'error': ..., 'feature': 'resonance'}`）。所以总结文档里"Pro 专属"这个判断是对的。
- **星域是一个独立的 HTTP 内核服务。** `buildResonanceKernelRoutes` 挂了一整套路由，全在 `/resonance/kernel/` 下面：
  - `GET /resonance/kernel/personas`：返回两个人格——`lyra`（版本 `RESONANCE_KERNEL_PERSONA_VERSION`，文本 `RESONANCE_KERNEL_PERSONA`）和 `taiyi`，外加一个默认值。
  - `GET /resonance/kernel/catalog`、`POST /resonance/kernel/stream`、`GET /resonance/kernel/resolve`、`GET /resonance/kernel/search-keys`、`GET /resonance/kernel/search`、`GET /resonance/kernel/workspace`、`GET /resonance/kernel/alerts`：除 personas 外全部要 Pro 权限（`proGated`）。
  - 还有一个 `resonanceSidecar(...)` 函数——星域是跑在**侧车进程**里的，不是主进程里的一段逻辑。
- **星域的提示词是这样进系统的。** `PromptEngine` 有个 `resonancePrompt` 字段：`buildSystemPrompt({...staticCtx, audience, resonancePrompt})`，改了它会重算 `computeFingerprint(systemPrompt, tools, volatileBlock)`。意思是：星域提示词属于**冻结的静态上下文**，会话内一旦定下来就和系统提示词一起被冻结、一起算指纹，不会每轮变。
- **星域的聊天纪律（从字符串证据看）。** 聊天会话只保留对话 + 联网搜索；回答必须引用来源；2026-10-25 有一条合流注解嵌在代码里（`delivery-readonly-*.js`）："2026-10-25 共鸣星域合流：保留 4.0 现…接鉴权和提示受众接线；主体已独立在…"——星域是 10 月 25 日合进 4.0 主线的，主体独立，鉴权和提示词接线是合流时补的。
- **人格版本号。** `RESONANCE_PERSONA_VERSION = 3`，说明天琴这个人格至少迭代过 3 版。
- **公开源码里 0 命中。** `resonance`、`共鸣星域`、`天琴`、`Tianqin` 在公开 `src/` 里一个都搜不到——共鸣星域是纯粹的 4.0 闭源新增。

**卡塞尔抄不抄：抄二分，不抄星域包装。** 这正是 NORMA/EVA 的映射已经定下来的方向（NORMA=办公≈共鸣星域，EVA=工程≈天枢内核），拆包等于给这个映射又加了一份实现证据。具体抄三点：
1. **两个入口走两套路由**：聊天入口和工程入口不要共用同一套系统提示词和工具表，各自有独立的 kernel/路由/人格，切换是"换工作站"不是"换颜色"（总结文档 §4.4 已定）。
2. **聊天侧的纪律**：聊天会话只保留对话 + 联网搜索；回答必须引用来源；动工具前先征得同意。这三条可以直接写进 NORMA 的系统提示词。
3. **人格进冻结前缀**：NORMA/EVA 的人格提示词要算进冻结前缀的指纹里，会话内定下来就别变，否则前缀缓存全 miss。

### 2.2 极限思考（Extreme Thinking）——拆包证实，核心是写锁协议 + 分层搜索

**是什么。** 深度研究（搜索、读、比对）和写入（改代码、派子代理）不能同时踩同一份工作区。开启后，先研究、再落地，中间主模型不许直接改代码。斜杠命令是 `/ex-ultra [on|off...]`。

**代码里怎么实现的。**

- **写锁是真的，有名有姓。** `createWriteLock()`（`chunk-KJIVHYT2.js`）：一个 promise 链做的互斥锁，带 `run` 方法和计数器；对外暴露 `withWriteLock`。文案写得非常直白："用户开启「极限思考」后，本轮搜索完成前主模型不能直接改产品代码（写文件工具被拦截；验收测试与…除外）；搜索结束后解锁"、"极限思考搜索正在进行…结果出来后用 apply 落地，再直接修"。**Plan 模式也用同一把锁**：退出计划模式时解除写锁；"要放弃规划直接动手，…退出（无需用户批准）。只在文本里…退出——模式只认工具调用"（想退出计划模式必须调工具，光在文字里说不算）。
- **搜索是分层的（tier plan）。** 默认档 `DEFAULT_SEARCH_TIER = 'high'`，`TIER_PLANS` 里 low/high 两档各有自己的 `roundWidths`（每轮并行几路）、`wallClockMs`（每轮时间预算）、`auditsPerRound`（每轮审计几次）。搜索工具的名字叫 **`interference_search`**（"干涉搜索"——多路候选方案互相干涉、竞争的意思）。
- **搜索实现就在包里，而且完整性可验证。** `pro/search/index.js`，294,373 字节，混淆过，但它从 `chunk-J6VINWX3.js` 导入的导出名是明文：`DEFAULT_SEARCH_LIMITS`、`SEARCH_HARD_LIMITS`、`SEARCH_IN_FLIGHT_PHASES`、`SEARCH_SCHEMA_VERSION`、`auditPenalty`、`browserIncomplete`、`clampSearchLimits`、`compareSearchCandidates`、`decideSearchDelivery`、`describeSearchUnavailable`、`normalizeSearchLimits`、`parseVerifyCommand`、`resumeModelLabels`、`tierPlan`。`integrity.json` 里登记了它的 sha256，实测文件 hash 与登记值**完全一致**——搜索模块确实随包发布，不是占位符。
  - 注意：代码里也有几句兜底报错——"当前安装包未包含极限思考能力"、"极限思考模块加载失败"、"极限思考暂不支持当前平台"、`searchUnavailableReason = '极限思考装配失败'` / `'load_failed'`。结合 `loadSearchImpl` 是动态加载这一点看，这些是**加载失败时的 fallback 文案**（比如不支持的平台、动态 import 失败），不是"包里没有这个模块"。包里有，hash 也对得上。
- **和目标模式是联动的。** `describeGoalExUltraWait`：目标会因为极限思考而暂停续跑，分几种状态——`awaiting_choice`（"目标暂停续跑：等你在极限思考里选方案。落地或放弃后目标继续"）、`no_accepted`（"极限思考没有通过验收的方案，全自动档不自动落地"）、`apply_failed`。另外还有一条："极限思考停在「等选方案」，不等用户：落地得分最高、且已通过全部验收（测试、类型检查、…）"——全自动档下，得分最高且通过全部验收的方案会自动落地，不等用户选。
- **公开源码里 0 命中。** `极限思考`、`exUltra`、`ex-ultra`、`interference_search`、`createWriteLock`、`writeLock` 在公开 `src/` 里全是 0。公开源码里仅有的 3 处 `interference` 是别的意思（控制器争用、CVM 信号干扰设计文档），与极限思考无关。

**卡塞尔抄不抄：抄，而且是 P0 级。** 总结文档 §3.2 的 T14（极限思考式研究态）原来只写了"研究占用仓库时写任务排队，落地方案前检查工作区是否被改过"，拆包后可以写得更具体：
1. **写锁协议**：研究态/计划态期间，写文件工具在执行层拦截（不是 UI 上灰掉按钮，是后端 `withWriteLock` 拦），验收测试类操作除外；研究结束自动解锁。
2. **分层搜索**：研究分 low/high 两档，每档定死每轮并行路数、时间预算、审计次数；多路候选要有一个 `compareSearchCandidates` + `decideSearchDelivery` 这样的裁决环节，选出得分最高且通过全部验收的方案再落地。
3. **落地用 apply**：研究结果不是直接写进代码，而是先形成方案、验收通过后用一次 apply 落地；目标模式要能感知这个等待状态（暂停续跑，等选方案/落地/放弃后再继续）。

### 2.3 XiaoSi Compress2.0——拆包证实，先归档再压缩

**是什么。** 上下文压缩前先把原文归档，需要时按页召回；常规请求不改动已缓存的前缀。

**代码证据。**

- 长摘要前缀字面量：`LONG_SUMMARY_PREFIX = 'XiaoSi Compress2.0 ...'`，后面跟着"求、决定、失败与未决…具体证据时按归档索引召回原文，在同一会话…"。
- 压缩走一个专用工具 `COMPACT_HISTORY_TOOL`，摘要字段写着 `'XiaoSi Compress2.0 original co...'`（original content，原文）。
- **检查点用 XML 标签密封**：`<xiaosi-checkpoint>{json}</xiaosi-checkpoint>`，`readRenderedCheckpoint` / `validateCheckpoint` 要求正好一个开标签、一个闭标签才认；`isSourceRef` / `sourceKey` 校验来源。
- **完整性护栏**："历史在 XiaoSi Compress2.0 期间发生变化；禁止替换"、"原历史已保留"——压缩期间历史变了就禁止替换，原文保留。
- 代码注解里有合流时间："2026-10-26 XiaoSi Compress2.0 … newCompacti…"，以及"frozen base 的保守预算；恢复旁路"。
- **公开源码里 0 命中**：`XiaoSi Compress`、`Compress2.0`、`xiaosi` 在公开 `src/` 里一个都没有。

**卡塞尔抄不抄：抄（T16 已有，拆包后加证据）。** 压缩不可逆是用户最怕的点，"先归档再压 + 按页召回 + 压缩期间历史变了就禁止替换"这三条直接抄进 EVA 的压缩设计。注意 XiaoSi Compress2.0 和下面 §2.4 的 XiaoSi Axiom 是**两个不同的东西**，都姓 XiaoSi，别混了：一个是压缩（会话内），一个是记忆（跨会话）。

### 2.4 XiaoSi Axiom 记忆插件——可读，未混淆，设计最完整

**是什么。** 天枢内置的用户本地记忆插件：每个用户在本机有一套自己的记忆库，分短期和长期两层。这是本次拆包里**可读性最高**的部分——整个插件没有混淆，README 和代码全是明文。

**代码证据（`plugins/xiaosi-axiom/`，`lib/` 下 16 个文件：`cascade.js`、`engine.js`、`fidelity.js`、`lens.js`、`refine.js`、`render.js`、`retrieve.js`、`scrub.js`、`slots.js`、`store.js`、`tokens.js`、`tools.js`、`vectors.js`、`weights.js`、`write.js`，外加 `lens/` 可视化）。**

- **四条公理**（README 原文）：
  1. **原文永不丢**：短期的"遗忘"只是退出工作集。依据是 LightMem 的复现实验：同样给出正确证据，读精炼记忆比读原文低 11.3 个点。
  2. **时效归代码**：槽位键由规则分配，现值由代码按陈述时间裁决，不交给模型。乱序到达的旧陈述只进时间线，不改现值。
  3. **检索可证伪**：每一路召回都能单独计量；查不到就弃答。
  4. **字节稳定**：注入块只经 TPI `promptContext` 在用户消息边界追加，不碰 frozen 前缀。同样的状态渲染出逐字节相同的块，块里不含分数、计数和时钟。
- **两层**：短期为主——每轮对话原文写进冷存档，称呼/偏好/约束/决定/待办等按规则抽成槽位写进短期，**这一步不调用模型**；长期校准——每轮先拿短期涉及的槽位去长期库精确比对，一致就互相强化，冲突就提醒模型以最新的明确表述为准；短期答不了时再深检索长期记忆和对话原文；短期过期后后台用侧路模型精炼进长期，再做保真校验，精炼没成功之前短期条目不删，对话原文永远保留。
- **级联检索（4 级）**：0 级槽位探针（短期槽位与长期现值精确比对，标冲突，每轮跑）→ 1 级短期（按激活排序的工作集，12 条，每轮跑）→ 2 级长期（六路召回 + RRF 融合 + 三道门，短期没覆盖问题、或问题带时间/回忆线索时跑）→ 3 级原文（冷存档里的对话，同会话展开前后各 1 轮，长期不够强、或问"上次""还记得"时跑）→ 都空手就**弃答**（明确告诉模型没有记录，不让模型编）。
- 六路召回：BM25（FTS5，中文二元切分 + porter 英文词干）、条目向量、原文片段向量、会话向量、槽位精确匹配、时间区间。三道门：**身份门**（只服务关于用户本人的槽位，"我同事用 Cursor"不会写成用户的编辑器）、**来源门**（不可信来源——导入、工具输出——不能改写用户自己陈述的现值，冲突值留档为 `rejected`；不可信条目最多占结果的 20%）、**弃答门**（问的属性库里没有槽位时，原文证据必须是用户的陈述句，并且要含信息量高的词）。
- **权重全是确定性计算，不让模型给自己打分**（README 给了公式）：
  - 重要度 `importance = clamp(base[kind] × evidence[说话人] × (explicit ? 1.1 : 1), 0, cap)`，assistant 归纳的上限 0.7
  - 短期激活 `a = importance × 0.5^(Δ轮/6) × 0.5^(Δ天/1) × (1 + 0.2·min(提及,5))`
  - 长期强度 `s = importance × 0.5^(Δ天/60) × (1 + 0.1·min(命中,5))`，core 不衰减
  - 最终分 `= rrf × (0.5 + 0.5·权重)`，权重只调序、压不过相关度
  - 强度低于 0.5 的长期条目会沉底：不再自动注入，但问得足够精确时仍能召回。
- **用户控制的工具**：`axiom_recall`（深检索）、`axiom_remember`（钉住不衰减）、`axiom_forget`（`suppress` 不主动提起；`forget` 退出召回；`purge` 连同来源原文物理删除，需审批）、`axiom_timeline`（看某个属性的历史值）、`axiom_status`（记忆库规模）、`axiom_lens`（导出记忆库可视化页面）。
- 设计文档在天枢仓库 `docs/design/2026-11-02-xiaosi-axiom-memory.md`——**但公开仓库里没有这个文件**（公开 clone 里连 `docs/design/` 目录都没有），所以设计文档本身也是闭源的，能读到的只有包里的插件 README 和代码。
- 插件的发现方式：`installedPluginsRoot()` 会到 `plugins/` 目录下找带 `TPI_MANIFEST_FILE` 的 `xiaosi-axiom`。

**卡塞尔抄不抄：抄，这是本次拆包对卡塞尔最有价值的一份。** NORMA 和 EVA 是"同一智能中枢的两种性格"，共用记忆——XiaoSi Axiom 正好是"一个记忆库、两种性格共用"的现成设计，而且是唯一一份**没混淆、带公式、带公理**的实现。建议新立一项抄：
1. **四条公理照搬**：原文永不丢、时效归代码、检索可证伪、字节稳定（第四条直接对接冻结前缀，记忆注入块不碰 frozen 前缀）。
2. **两层 + 级联检索**：短期槽位（不调用模型抽取）+ 长期六路召回 + 三道门 + 找不到就弃答。卡塞尔的"学院知识库"和用户记忆可以按这个结构做。
3. **权重公式照搬**：确定性计算，不让模型给自己打分；短期按轮和天双重衰减，长期 60 天半衰期。
4. **用户控制工具**：`remember/forget/timeline/status` 这套要给用户，不要让记忆变成黑盒。

### 2.5 冻结前缀 + appendixDelta——拆包证实，但已在公开源码，不是 4.0 新东西

**代码证据（`chunk-74ZJHER5.js` 里的 `PromptEngine` 类）。**

- `frozenBase`、`frozenUserMerged`、`frozenPendingMerged`、`inheritedActiveBase`、`frozenBaseHash` 全是类里的正式字段；`frozenBaseHash` 是对冻结内容算 sha256（校验时要求 `/^[a-f0-9]{64}$/`）；`computeFingerprint(systemPrompt, tools, volatileBlock)` 给系统提示词 + 工具表 + 动态块算指纹。
- 冻结快照可继承：`inheritFrozenFrom`，分 v1（legacy snapshot）和 v2 两种格式；resume 时读回快照，hash 对不上就重建边界。
- `appendixDelta` 是个显式开关：`'appendixDelta': process.env['RIVET_APPENDIX_DELTA'] !== '0'`，环境变量能关掉。
- 组装规则在代码里能看到：`[...this['frozenBase'] !== ... ? [this['frozenBase']] : []]`——冻结块与动态块不同就补一个冻结块；`volatileBlock` 在需要时才会被重置回 `frozenBase`。
- **公开源码里早有**：`frozenBase` 在公开 `src/` 里有命中（`domain-picker-entries.ts`、`history-rescue.ts` 等），旧报告研究的就是公开的 `src/prompt/engine.ts`（1,809 行）+ `frozen-snapshot.ts`。拆包只是证实：4.0.4 的运行时里还是同一套，没有换实现。

**卡塞尔抄不抄：整套抄（T1，已有，拆包后加证据）。** 结论不变。补充一个细节：冻结快照的继承（resume 读回 `.frozen.json`、sha256 逐条密封校验）是 99% 命中率能跨会话维持的关键，卡塞尔做 resume 时要抄这一段。

### 2.6 CacheAdvisor 自适应延迟压缩——拆包证实，已在公开源码

**代码证据（`chunk-U3DFVGI5.js` 里的 `CacheAdvisor` 类）。**

- 类字段有名有姓：`behaviorLearner`（行为学习器）、`thresholdController`（阈值控制器）、`warmthTracker`（热度追踪）、`recentHitRate`（最近命中率）。
- **阶段乘数与旧报告完全一致**：`PHASE_MULTIPLIERS = {'explore': 1, 'plan': 1.5, 'execute': 1, 'verify': 2, 'deliver': 0.5}`——验证阶段最值得保护缓存，交付阶段最不值得。
- 配套机制都在：`onCacheAdvisorTurnEnd`（每轮结束时更新）、`planCacheAdvisory`（计划缓存建议，渲染成 `<plan-cache…>` 标签进提示词）、`renderPlanCacheAdvisory`。
- **公开源码里早有**：`CacheAdvisor` 在公开 `src/` 的测试里有命中，旧报告研究的是 `src/cache/advisor.ts`。拆包证实 4.0.4 没改这套。

**卡塞尔抄不抄：直接落为公式（T2，已有，拆包后加证据）。** 结论不变。

### 2.7 DSML 工具调用恢复——拆包证实，已在公开源码

**代码证据（`chunk-CI2YKVOQ.js`，正则表达式是明文的）。**

- 三个正则原样在代码里：
  - 开标记 `/<[｜|]DSML[｜|]tool_calls\s*>/g`
  - 闭标记 `/<\/[｜|]DSML[｜|]tool_calls\s*>/g`
  - 调用 `/<[｜|]DSML[｜|]invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/[｜|]DSML[｜|]invoke>/g`
  - 参数 `/<[｜|]DSML[｜|]parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/[｜|]DSML[｜|]parameter>/g`
- 恢复规则和旧报告说的一样：扫描时跳过 Markdown 字面量区段（`markdownLiteralRanges`）；`MARKUP_RE` 同时认 DSML、`<tool_call>`、`<function_calls>`、`<invoke name=`、`<function=…>` 几种写法；`isReportChannelError` 会把含 DSML 标记的报错识别为"报告通道错误"。
- 代码注解里嵌着真实事故的复盘："2026-10-06：1897→1907——DSML…频繁中断」：模型把…写成 DSML 标…故整轮零 tool_call、会话静…"——和旧报告里"182 条记录中 23 条命中"的事故是同一件事。
- **公开源码里早有**：`DSML` 在公开 `src/agent/worker-report-repair.ts` 及测试里有命中。拆包证实 4.0.4 没改这套。

**卡塞尔抄不抄：两层网照抄（T5，已有，拆包后加证据）。** 结论不变。卡塞尔接 workbuddyapi2 反代，这层直接决定工具调用丢不丢。

### 2.8 模型 ID 映射 + 推理强度诚实规则——拆包证实，细节比旧报告多得多

**代码证据（`chunk-6R3JWADI.js`，模型目录是明文数据）。**

- **模型 ID 分别映射是真的。** `MODEL_SYNONYMS`（别名表）：`v4-flash` → `deepseek-v4-flash`、`v4-pro` → `deepseek-v4-pro`、`v4.1-flash` / `4.1-flash` / `deepseek-4.1-flash` → `deepseek-flash`、`go-ds4p` → `deepseek-v4-pro`、`cc-dsv4` → `deepseek-v4-pro`、`sf-v4-pro` → 硅基流动上的 DeepSeek V4 Pro、`sf-v4-flash` → 硅基流动上的 V4 Flash，等等。官方 V4.1-Flash 的实际 ID 是 `deepseek-flash`，`deepseek-v4-flash` 是中转/火山引擎上的独立 ID——和旧报告一致。
- **在售模型（4.0.4 的目录）**：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4.1-flash`（即 `deepseek-flash`）、`deepseek-v4.1-flash-free`、`deepseek-v4-flash-vision`，另有 Kimi（K2.7-Code、kimi-k3、kimi-k3.1-pro）、GLM（5.2、5.3、5.3-flash）、MiMo（V2.6）、MiniMax（M2.7、M3）、Qwen（3.6-27B、3.7-max）、GPT-5.6、Claude Sonnet 4.5 / Opus、Grok、LongCat、硅基流动等。每个模型带中文描述（"1M 上下文""旗舰档：深度推理""速档：1M 上下文""生图专用"等）、contextWindow、maxTokens、tier、pricing。
- **推理强度是按模型签契约的。** `GO_CONTRACTS` / `ZEN_CONTRACTS`：`deepseek-v4-pro` 只认 `[high, max]`；`deepseek-v4.1-flash` 认 `[low, high, max]`；`glm-5.2` 认 `[high, max]`；`glm-5.3` 认 `[low, high, max]`；`kimi-k3` 只认 `[max]`；`kimi-k3.1-pro` 认 `[low, high, max]`。发请求时 `resolveWireEffort` 把内部档位映射成线上的 `reasoning_effort` 字段，`applyThinkingWire` 负责接线；档位不存在就直接删掉这个字段（不硬发）。
- **退役迁移是代码，不是文档。** `OFFICIAL_RETIRED_FLASH = 'deepseek-v4'`，`OFFICIAL_FLASH = 'deepseek-flash'`，官方渠道 `['deepseek', 'deepseek-spark']`。`migrateOfficialFlashRetirement` / `migrateDeepseekVisionExpRetirement` 会在读配置时自动把退役 ID（`deepseek-v4`、`deepseek-v4-flash-vision`）改写成 `deepseek-flash`；还有一条迁移把 `deepseek-v4-flash` 上残留的 `reasoningEffort: 'high'` 改成 `'max'`。
- **压缩模型解耦有据可查。** 代码里有一段诊断文案："压缩一直静默退回会话主模型。可能是官方 deepseek-…也可能是只写了 co…是哪种，compact…"——压缩模型不在提供商的模型列表里时，会静默退回会话主模型，并且这个退回是**会被诊断出来**的（不是悄悄发生）。默认配置里问候模型和压缩模型都是 `deepseek-flash`；压缩自动阈值 `autoThreshold = 0xc3500`（800,000 tokens）、`autoFloor = 0x7a120`（500,000 tokens）。
- **DeepSeek 计费是按北京时间峰谷算的。** `deepseekPricingPhase`：按北京时间的星期 + 是否中国公众假期定峰/谷，谷时 0.5 倍。`DEEPSEEK_PEAK_PRICING`（人民币）：flash 档 `cacheRead 0.04 / cacheWrite 2`；pro 档 `input 9 / output 27 / cacheRead 0.3 / cacheWrite 9`。`hitRatio` 直接用 `cache_read_input_tokens / input_tokens` 算。
- **缓存尾巴规则**：`TAIL_RULES` 里 `deepseek-128` 是 `min(x, 128 + x % 128)`——缓存按 128 token 对齐截断。

**卡塞尔抄不抄：抄（T6 + T20，已有，拆包后细节升级）。** 新增三条可直接抄的：
1. **别名表**：模型 ID 不要只存一个字符串，要有一张"别名 → 规范 ID"的映射表（直连/反代/硅基流动各一套），配置迁移时自动改写退役 ID。
2. **强度契约表**：每个模型声明自己认哪几档强度（`GO_CONTRACTS` 式），菜单只列生效的档；档位不存在就删字段，别硬发。
3. **压缩模型独立字段 + 退回要诊断**：压缩模型是独立配置，迁移时不许悄悄改；压缩模型不可用时静默退回主模型可以，但必须留一条诊断让用户查得到。

### 2.9 Meridian 索引 + 信息素记忆——拆包证实，已在公开源码

**代码证据。**

- **Meridian**：`MeridianIndexer` 类，`meridian.db` 是 SQLite（better-sqlite3，WAL 模式，`busy_timeout`），存在状态目录里。`generateCodebaseIndexBlock(meridianDb, getHeadSha())` 把代码库索引渲染进提示词；配套工具有 `createRepoGraphTool`（导入图）、`createRelatedTestsTool`（相关测试）；库里还存议会会话（`recordCouncilSession`）、路由影子（`recordRoutingShadow`）、模型分层 bandit 状态（`modelTierShadowStore`、`modelTierBanditEnabled`，多臂老虎机做模型路由）、团队调度奖励（`getTeamSchedulerRewardStore`）。另有 `DomainKnowledgeStore`（领域知识库）与 Meridian 并列。
- **信息素（Stigmergy）**：`StigmergyStore` 类，`deposit({path, signal, strength: 0.8, halfLifeMs: 0x36ee80, context})`——改完文件就往对应路径存一条信息素，强度 0.8，半衰期参数 0x36ee80 = 3,600,000ms = **1 小时**（这是实测看到的一条 deposit 调用的值；旧报告说的"7 天半衰期"是另一处默认值，本次拆包没在代码里核对到 7 天这个数，**以 1 小时为准的是这条调用，不是全系统默认值**）。`MeridianBehavior` 的默认权重是 `{at: 0.3, pheromone: 0.2}`。信息素按会话存 `pheromones.json`，进提示词时渲染成 `formatBatchStigmergyBlock`。还有一个 `PhysarumEngine`（黏菌引擎）+ `ImmuneHook`（免疫钩子）挂在旁边。
- **公开源码里早有**：`meridian`、`stigmergy` 在公开 `src/` 的测试里都有命中（`assembly-audit.test.ts` 等）。拆包证实 4.0.4 没改这套。

**卡塞尔抄不抄：抄（T10 + T11，已有，拆包后加证据）。** 补充一个细节：信息素的半衰期是**按信号类型给参数**的，不是全系统一个数；卡塞尔做的时候也要分信号给，不要一刀切。

### 2.10 Windows 自愈清单——部分证实：WebView2 修复是真的，其余三项未确认

**证实的部分：WebView2 修复机制。**

- `windows-repair/` 里有三个可读文件：`repair-webview2.ps1`（主脚本）、`repair-webview2.cmd`（双击入口）、`webview2.ps1`（共享库）。脚本头写着：`WEBVIEW2_CONTRACT_MIN_MAJOR=120`（最低大版本 120）、"Pre-GUI repair: install / update WebView2 Runtime, then optionally launch Tianshu"、"NSIS already embeds offlineInstaller"（NSIS 包里嵌了离线安装器）。流程是：查已装版本 → 没装/版本不够/UAC 提权 → 装/更新 → 可选启动天枢。
- exe 里也有对应的 Tauri 命令：`webview2_repair`、`webview2_version`，还有一句报错文案 `"repair script not found (windows-repair/repair-webview2.cmd)"`——主程序运行时会去找这个修复脚本，找不到就报错。也就是说 WebView2 修复是**产品里的正式机制**，不是安装包里放着好看的。

**未确认的三项**（本次拆包没找到证据，不是不存在，是没拆出来）：
- WebView2 本地存储损坏自动挪备份：`windows-repair/` 里没有 `backup` 字样；运行时里也没找到对应的备份逻辑。
- 杀毒软件隔离按文件名报缺失：运行时里 `隔离` 出现的地方都是"隔离环境""隔离审查补丁""会话隔离"这类通用词，没有"杀毒软件隔离了某某文件"的报缺逻辑。
- 冷启动移出主线程：只找到一句"禁止静默冷启动"，意思是不要悄悄冷启动某个东西，和"冷启动移出主线程"不是一回事。

**卡塞尔抄不抄：抄 WebView2 修复这一条（T19 部分证实）。** 卡塞尔也是 Windows 优先的 Tauri 应用，WebView2 是命脉：安装包里嵌离线安装器 + 一个独立的修复脚本 + 主程序里挂 `webview2_repair` 命令，这套可以直接抄。其余三项等天枢后续版本或别的证据再说，不要按"已证实"写进计划。

### 2.11 种子胶囊（seed-capsules）——可读，22 个，都是方法胶囊

**是什么。** `rivet-runtime/seed-capsules/` 下 22 个 Markdown 文件：根目录 15 个（attack-methodology、changgeng、design-aesthetics、diagnostic-ladder、fu、huagai、kaiyang、knowledge-work、tanlang、tianfu、tianliang、tianquan、tianxuan-ccr、tianxuan、yaoguang），`domains/` 下 7 个（pojun、qiming、qisha、taiyi、tianji、tianshu、wenqu）。名字大多取自北斗七星及辅星。

**内容示例（天枢胶囊，`sealed="2026-10-27"`）：**

```xml
<seed-capsule star="天枢" sealed="2026-10-27" gist="执中者的方法：意图至上、全貌查证、可独立验证的拆解、失败产出信息、改动前看波及半径">
  你是天枢——北斗主星，执中者，把开发者的意图变成经过验证的交付。你的方法：
  <principle key="TS1@P7+P3" action="...">失败必须产出信息——每次出手要么淘汰一条假设，要么收窄搜索范围</principle>
  ...（TS1–TS7 七条原则，每条带 key 引用，如 TS1@P7+P3）
```

"借的是方法，不是身份；原话以星域说明为准。"——胶囊是**方法卡片**，不是人格设定。每条原则带一个 `key`（如 `TS1@P7+P3`），引用的是星域说明里的原则编号。

**公开源码里有同类东西**：`seed-capsule` / `seedCapsule` 在公开 `src/` 里有 23/10 个文件命中，所以胶囊机制本身不是 4.0 新发明；但**包里这 22 个胶囊的具体内容**（2026-10-27 封印的天枢方法）是 4.0 当时的版本。注意：共鸣星域的人格天琴**不在**胶囊里（胶囊里搜不到"天琴""共鸣星域"），天琴只在 JS 运行时里。

**卡塞尔抄不抄：抄机制，不抄北斗包装。** "可切换的工作纪律卡片"这个机制值得抄：每张卡片是一组带编号的原则 + 触发情境，模型卡住时按情境取用。卡塞尔可以做自己的卡片（比如"路明非的工作纪律""EVA 的工程纪律"），用龙族语境，不用北斗七星。

### 2.12 Pro 付费墙与多智能体编排——拆包证实

**Pro 付费墙。** 默认配置 `pro.enabled = false`，功能表：`computerUse`、`chatGateway`、`teamMax`、`councilMultiRound`、`unattendedAutomation`、`spark`、`resonance`、`vera`——全是 `true`（表示这些是 Pro 功能，不是默认开启）。`PRO_CATALOG` 给每个功能标了 `surface`（desktop/all）和 `wired`（是否已接线）。`createRegistry` 里有 `assertProFeatureEnabled` 门禁；`pro/` 目录下有 `index.js`（9.4KB）、`search/index.js`（极限思考）、`computer-use/index.js`（362KB）、`provider-usage/index.js`（22KB）、`runtime/backend.js` + `engine.js`。

**多智能体编排。** `DelegationCoordinator`、`WorktreeCoordinator` 从 `chunk-GGOYD43V.js` 导出；议会（council）会话、团队调度（team scheduler）的 bandit 状态都存在 Meridian 库里；`/scout`、`/team`、`/council`、`/galaxy` 的路由逻辑在运行时里（`presetIncludes('repo_graph')`、`createRepoGraphTool` 等）。**`spawn-broker` 是 4.0 新增的**：公开源码里 0 命中，运行时里有 `spawn-broker-*.js` + `spawn-broker-process.js`（worker 进程），负责并行会话的派生与管理。

**卡塞尔抄不抄：** 编排四原语已经在 T13 里了，拆包补一条——**并行会话要有一个 broker**：派生、路由、回收、状态都由 broker 管，不要让主循环直接 spawn 子代理。这是 ULTRACODE 以后做并行编排时要抄的结构。Pro 付费墙本身不抄（卡塞尔是 BYOK，不卖订阅），但"功能分级 + 门禁注册表"这个做法可以借鉴：以后加付费/高级功能时，用一张功能目录表 + 一个 `assertFeatureEnabled` 门禁，不要把判断散落在各处。

### 2.13 桌宠（dsh-pet）与 Office 插件——顺带发现

- **`dsh-pet`**：`node_modules/dsh-pet/`，上游是 PC2005-cloud/dsh-pet @ `2e80d77`，版本 0.3.8，`aiEnabled: false`。`TIANSHU-ADAPTATIONS.md` 写明：天枢的版本是**纯本地桌面伙伴**，聊天、图片上传、截图、模型状态、网站/登录、余额、模型对话全部禁用；Electron 是独立下载校验的 helper 运行时；宠物进程会监听父进程，父进程没了它就自己退出；外观只透传 `scheme` 和 6 位 hex `accent`。——这就是天枢的"桌宠"，和 Claude 的像素小怪兽、dsh-TUI 的像素鲸鱼是同一类东西，但天枢这个是**不带 AI 的纯宠物**。
- **Office 插件**：`plugins/office-docx`、`office-excel`、`office-pdf`、`office-ppt`——天枢能读写 Office 文档（这对应它"办公"的那一面）。`tianshu-imbridge`、`trace-lab`、`design`、`dynamic-background` 是另外四个插件。
- **Whisper 语音**：`whisper-runtime/` 134MB，说明桌面端带语音输入。
- **开机视频**：`native-media/` 里 `alice-boot-1..4.mp4`、`taiyi-boot.mp4`——天枢开机有视频（太一是个人格，见 §2.1）。

**卡塞尔抄不抄：** 桌宠"纯本地、不带 AI、父进程没了自己退出"这个隔离做法值得参考——卡塞尔以后做 CLI 像素吉祥物时，宠物进程不要碰模型凭证（dsh-pet 的文档里专门写了"从不复制 DSH 或天枢的模型凭证"）。Office 插件不抄（卡塞尔现阶段不做办公文档读写）。

---

## 3. 与公开源码的差异清单（4.0 新增的闭源部分）

对照方法：拿运行时里出现的机制名，去公开提交 `2d0b22e` 的 `src/`（3,772 个 TS 文件）里 grep，0 命中即"新增"，有命中即"已有"。

### 3.1 4.0 新增（公开源码里 0 命中）

| 机制 | 运行时证据 | 备注 |
|---|---|---|
| 共鸣星域 resonance | `RESONANCE_PERSONA_VERSION=3`、`/resonance/kernel/*` 路由、Pro 门禁 403、`resonanceSidecar` | 人格天琴（lyra）+ 太一（taiyi） |
| 极限思考 extreme thinking | `interference_search` 工具、`/ex-ultra` 命令、`pro/search/index.js`（294KB，hash 已验）、`TIER_PLANS` | 含写锁协议 |
| 写锁协议 | `createWriteLock` / `withWriteLock` | Plan 模式共用同一把锁 |
| spawn-broker 并行派生 | `spawn-broker-*.js`、`workers/spawn-broker-process.js` | 并行会话的 broker |
| XiaoSi Compress2.0 | `LONG_SUMMARY_PREFIX='XiaoSi Compress2.0'`、`<xiaosi-checkpoint>`、压缩期间禁替换 | 会话内压缩 |
| XiaoSi Axiom 记忆插件 | `plugins/xiaosi-axiom/` 全套可读 + README，设计文档 `docs/design/2026-11-02-xiaosi-axiom-memory.md` 不在公开仓 | 跨会话记忆 |
| pro/ 付费功能包装 | `pro/index.js`、`pro/search/`、`pro/computer-use/`、`pro/provider-usage/`、`pro/runtime/` | 功能分级 + 门禁 |
| dsh-pet 桌宠 | `node_modules/dsh-pet/`，上游 PC2005-cloud/dsh-pet @ 2e80d77，v0.3.8 | AI 已禁用，纯本地宠物 |
| 桌面端前端 | 嵌在 `tianshu-desktop.exe` 里（Tauri asset 协议），`/assets/index-DNbo44wJ.js` 等 | **读不到源码** |
| 许可/支付/更新服务端点 | exe CSP 里的 workers.dev、plotstudio.cn、阿里云 OSS、Supabase、minisign 公钥 | 只记录，不调用 |

### 3.2 已在公开源码（拆包只是又验证了一遍，不是 4.0 新东西）

DSML、冻结前缀 + appendixDelta、CacheAdvisor、Meridian、信息素（Stigmergy）、目标追踪（goal-tracker）、计划审批（plan-approval）、CVM 账本（cvm-ledger）、路径授权（path-grants）、项目信任（project-trust）、工具预设（tool-preset）、前缀预算（prefix-budget）、会话持久化（session-persist / session-registry）、联网搜索（web-search）、种子胶囊机制、computer-use 代码、provider-usage 代码——这些在公开 `2d0b22e` 里都有，旧报告研究过，4.0.4 的运行时里还是同一套（DSML 的正则、CacheAdvisor 的阶段乘数、冻结前缀的字段名都对得上）。

**这个区分很重要**：之前总结文档 §3.0 写的是"旧报告的结论全部仍然成立（机制都在公开代码里），4.0 的新东西只能从 Release notes + 官网读行为，抄得到设计、抄不到实现"。拆包后要改成：**旧报告的机制结论仍然成立；4.0 的新东西（上面 §3.1 的表）现在有了运行时级别的证据——JS 混淆但字符串可读，协议、数据结构、配置键都能抄；只有桌面端前端仍然抄不到实现**。

---

## 4. 诚实说明：哪些没拆出来、哪些是推测

1. **JS 是混淆过的。** 所有"代码里怎么实现"的描述，依据都是**字符串字面量 + 未混淆的导出名/配置键/路由名**，不是逐行读通的逻辑。函数内部的控制流（比如 `tierPlan` 具体怎么裁决、`CacheAdvisor` 的公式细节）读不出来，报告里没写它们——不要把本报告当成实现文档。
2. **桌面端前端完全没拆出来。** 它嵌在 exe 里，只能看到资源文件名和版本号（`index-DNbo44wJ.js`、`4.0.2-*`、`3.28.0-*` 等），看不到代码。共鸣星域在界面上长什么样、极限思考的交互怎么做、天枢桌面端的布局——本次拆包**一概无法确认**，不要按想象写。
3. **没验证运行行为。** 全程只读文件，没运行天枢、没联网、没调用任何服务。命中率 99.3–99.6%、账单 ¥880→¥20 这些数字来自旧报告（5 个真实长会话的实测），本次拆包**没有重新验证**，引用时以旧报告为准。
4. **Windows 自愈清单只证实了 1/4。** WebView2 修复是真的；本地存储自动备份、杀毒隔离报文件名、冷启动移出主线程——本次没找到证据，写"未确认"，不是"没有"。
5. **信息素半衰期**：实测看到的一条 deposit 调用用的是 1 小时（0x36ee80ms）；旧报告的"7 天"是另一处默认值，本次没核对到。报告里两处都写明了，不要混用。
6. **"当前安装包未包含极限思考能力"这句报错**：它是加载失败时的 fallback 文案，不是包里没有这个模块——`pro/search/index.js` 在包里，`integrity.json` 的 hash 也对得上。写报告时别把这句报错当成"功能缺失"的证据。
7. **版本号说明**：安装包是 v4.0.4（2026-11-06），`rivet-runtime/package.json` 也是 4.0.4；但 exe 里前端资源还混着 `3.28.0`、`3.29.0`、`3.29.1`、`4.0.2` 的 hash，说明前端资源是按版本累积打包的，不是每次全量换新。

---

## 5. 给卡塞尔的抄写清单（拆包后的增补）

在总结文档 §5 的 P0/P1 基础上，拆包新增/细化以下条目（编号沿用总结文档，新增的标"新"）：

| 编号 | 内容 | 依据 |
|---|---|---|
| P0-1（细化） | 冻结前缀 + appendixDelta，补"resume 读回 `.frozen.json`、sha256 逐条密封校验" | §2.5 |
| P0-2（细化） | CacheAdvisor 阶段乘数照抄：explore 1 / plan 1.5 / execute 1 / verify 2 / deliver 0.5 | §2.6 |
| P0-5（细化） | DSML 正则与两层网照抄，扫描跳过 Markdown 字面量区 | §2.7 |
| T14（细化） | 极限思考写锁协议：研究态/计划态写文件工具在执行层拦截，验收测试除外；落地方案用 apply；目标模式感知等待状态 | §2.2 |
| T16（细化） | XiaoSi Compress2.0：先归档再压、按页召回、压缩期间历史变了就禁止替换 | §2.3 |
| **新 T21** | 共鸣星域式聊天纪律：聊天入口独立路由/提示词/人格；聊天会话只保留对话 + 联网搜索；回答必须引用来源；动工具前先征得同意 | §2.1 |
| **新 T22** | XiaoSi Axiom 式记忆：四条公理 + 两层 + 级联检索 + 三道门 + 确定性权重公式 + 用户控制工具（remember/forget/timeline/status） | §2.4 |
| **新 T23** | spawn-broker：并行会话派生/路由/回收由 broker 管，主循环不直接 spawn 子代理 | §2.12 |
| T19（修正） | Windows 自愈只抄 WebView2 修复（离线安装器 + 独立修复脚本 + 主程序挂 repair 命令）；其余三项未确认，不列入计划 | §2.10 |
| T6/T20（细化） | 模型别名表 + 强度契约表 + 压缩模型独立字段 + 退回要留诊断 | §2.8 |
