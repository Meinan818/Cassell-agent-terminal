# Pi 外围产品层源码附录

- 源码：`D:\卡塞尔学院\research-src\pi`
- 快照：`main` / `827383a`（2026-11-13，`git ls-files` 共 4,546 个受控文件；其中 `packages/` 3,252、`apps/` 1,165）
- 定位：`docs/source-analysis/pi.md` 已把内核（`agent` / `ai` 核心 / `durable` 概览）读透。本附录补的是**内核之外的产品层**：包管理、资源装载、技能、导出、`chord`、`durable` 调度器、provider 注册、非交互模式、以及 `apps/` 三个应用。
- 方法：只读源码与仓库内文档，**未运行** `npm run build` / `npm test` / `npm start`。下文“已确认”= 源码证据，“未验证”= 需要跑起来才能断言的结论。

---

## 0. 口径与方法（先定规矩，避免再混行数）

仓库里行数存在两种自然口径，`pi.md` 用的是**非空行**，我先前用的是**总行数**，两者都对但不可混用。本附录统一如下：

| 口径 | 定义 | 用途 |
|---|---|---|
| 总行数 | `Get-Content <file>` 的元素个数（含空行） | 判断文件规模、切块阅读 |
| 非空行 | 去掉纯空白行后的行数 | 与 `pi.md` 对比 |

实例（同一快照实测）：

| 文件 | 总行数 | 非空行 |
|---|---|---|
| `packages/coding-agent/src/core/package-manager.ts` | 2,967 | 2,656 |
| `packages/coding-agent/src/core/resource-loader.ts` | 1,319 | 1,191 |
| `packages/coding-agent/src/core/skills.ts` | 505 | 430 |

---

## 1. 对 `pi.md` 的修正

本节只修正**事实口径**，不改 `pi.md` 的判断与结构。

### 1.1 provider 数量口径（原：48 个 provider / 97 个 .ts）

实测 `packages/ai/src/providers/` 共 **97 个 `.ts` 文件**，拆解如下：

| 类别 | 数量 | 说明 |
|---|---|---|
| provider 实现 | **43** | 每个导出 `xxxProvider(): Provider<...>` |
| 模型目录 | **43** | `*.models.ts`，由 `catalog/generate.ts` 从 `data/*.json` 生成（文件头注明 auto-generated / do not edit） |
| 聚合入口 | 1 | `all.ts`（`builtinProviders()` / `builtinModels()`） |
| 支撑文件 | 10 | `compat-schema.ts`、`model-schema.ts`、`schema-builders.ts`、`data-json.d.ts`、`faux.ts`、`cloudflare-auth.ts`、`cloudflare-stream.ts`、`opencode-headers.ts`、`openrouter-api.ts`、`radius-config.ts` |
| 合计 | **97** | 另有子目录 `images/register-builtins.ts`，不在 97 之内 |

结论：**43 个内置 provider**，不是 48。`pi.md` 第 2 节与第 5.2 节的“48 个 provider”按此修正；功能表的结论（只学接口不学 43 份实现）不受影响。

`builtinProviders()` 的完整名单（`providers/all.ts:137-183`，43 项）：
`amazon-bedrock, ant-ling, anthropic, azure, baseten, cerebras, cloudflare-ai-gateway, cloudflare-workers-ai, deepseek, fireworks, github-copilot, google, google-vertex, groq, huggingface, kimi-coding, meta, minimax, minimax-cn, mistral, moonshotai, moonshotai-cn, nvidia, openai, openai-codex, opencode, opencode-go, openrouter, qwen-token-plan, qwen-token-plan-cn, qwen-token-plan-individual, qwen-token-plan-individual-cn, radius, together, typesafe, vercel-ai-gateway, xai, xiaomi, xiaomi-token-plan-ams, xiaomi-token-plan-cn, xiaomi-token-plan-sgp, zai, zai-coding-cn`。

### 1.2 `apps/` 的描述（原：“三个产品壳，不属于运行时，本次不展开”）

原判断把 `apps/` 一笔带过，且把 `p2-mac` 与 `p3` 的性质写反了。实测：

| 目录 | 受控文件 | 真实性质 |
|---|---|---|
| `apps/p2` | 1,088 | 可运行的**自托管 Pi Durable UI**（Chord 插件组成的服务端 + Web + TUI + 每会话 worker），`private: true`，README 自称 EXPERIMENTAL 且“will be gone soon” |
| `apps/p2-mac` | 27 | macOS 原生**壳**：Swift/AppKit + WKWebView，菜单栏宿主，跑本地 p2 服务并显示其 Web UI |
| `apps/p3` | 50 | **纯设计文档包**，无 `package.json`、无 `src`；是下一个应用（p3）的规格与调研 |

即：`p2` = Web/桌面应用本体，`p2-mac` = Swift 壳，`p3` = docs 站/规格库。详见本附录第 10 节。

### 1.3 `export-html` 行数（原：907 行）

当前快照的 `export-html/` 拆分如下（非空行 / 总行数）：

| 文件 | 非空 | 总 | 作用 |
|---|---|---|---|
| `index.ts` | 278 | 318 | 导出主流程、主题变量、自绘工具预渲染 |
| `ansi-to-html.ts` | 270 | 297 | ANSI 转 HTML（16 色 / 256 色 / truecolor / OSC 8） |
| `tool-renderer.ts` | 159 | 175 | 复用 TUI 渲染器产出 HTML |
| `template.js` | 1,803 | 2,044 | 前端：树、过滤、搜索、深链、图片弹窗 |
| `template.css` | 906 | 1,085 | 主题变量 + 布局 |
| `template.html` | 52 | 52 | 单文件骨架 |
| `vendor/*` | 1,296 | 1,311 | `marked` / `marked-cjk-friendly` / `highlight.js` |

“907 行”对应不上任何当前聚合值（最接近的是 `template.css` 非空 906）。正确表述：**手写部分约 3,468 非空行，加 vendor 共约 4,764 行，产出单个自包含 HTML。**

### 1.4 其余仍需保留的边界

- `pi.md` 说 `packages/` 12 个包、锁同一版本 `1.5.2`：已复核仍成立（`agent, ai, chord, codemode, coding-agent, durable, env, evals, mcp, schema, telemetry, tui`）。
- `chord` 规模：`src` 299 个 `.ts`、**56,461 行**（含空行），与 `pi.md` 的“56,461”一致；整包（含 docs/json）980 个文件 172,263 行。不要把“整包 17 万行”当 `src` 规模。

---

## 2. 包管理：`packages/coding-agent/src/core/package-manager.ts`

### 2.1 文件清单

| 文件 | 总行 | 非空 |
|---|---|---|
| `src/core/package-manager.ts` | 2,967 | 2,656 |
| 依赖：`src/utils/git.ts` `parseGitUrl`、`src/utils/paths.ts` `resolvePath`/`canonicalizePath`、`src/core/pi-manifest.ts` `readPiManifest`、`src/core/settings-manager.ts` `PackageSource`、`src/core/source-info.ts` `getResourcePathKey` | — | — |

### 2.2 入口与关键符号

| 符号 | 位置 | 作用 |
|---|---|---|
| `PackageManager`（接口） | `package-manager.ts:140-156` | 对外契约：`resolve / install / installAndPersist / remove / removeAndPersist / update / listConfiguredPackages / resolveExtensionSources / addSourceToSettings / removeSourceFromSettings / setProgressCallback / getInstalledPath` |
| `DefaultPackageManager` | `:882` | 唯一实现 |
| `isOfflineModeEnabled()` | `:64-68` | `PI_OFFLINE=1/true/yes` |
| `ParsedSource = NpmSource / GitSource / LocalSource` | `:168-182` | 三种来源 |
| `parseSource()` | `:1653-1678` | `npm:` 前缀 → npm；本地路径 → local；`parseGitUrl` → git；兜底 local |
| `resourcePrecedenceRank()` | `:231-237` | 资源优先级数值（0 最高）：0 项目+settings、1 项目+自动发现、2 用户+settings、3 用户+自动发现、4 包资源、5 内置扩展 |
| `applyPatterns()` | `:807-861` | 四类模式：普通 include、`!x` exclude、`+x` 强制包含、`-x` 强制排除，顺序 include→exclude→force-include→force-exclude |
| `ProgressEvent` | `:111-122` | `start / progress / complete / error / result`，`start` 与 `complete/error` 严格配对 |
| `PackageInstallFailure` | `:103-107` | `{ source, scope, message }` |

### 2.3 真实行为（按调用链）

**解析（启动路径）**：`resolve()` `:990` → 先收集 project 包再 global 包（project 先，冲突时 cwd 资源胜出 `:995-1002`）→ `dedupePackages()` `:1915` 去重（同 identity 时 project 覆盖 user；但 project 条目 `autoload:false` 是“增量覆盖”，两条都保留）→ `resolvePackageSources()` `:1428`。

**缺失即安装、失败不阻断启动**（关键设计）：`installMissing()` `:1449-1469`，离线直接返回 false；`onMissing` 回调可返回 `install / skip / error`；安装抛错时**只记 `PackageInstallFailure` 并跳过该包资源**，注释写明“a source that cannot be installed must not abort startup”。这条与 `resolve()` 返回值里的 `installFailures` 一起冒到 UI（`resource-loader.ts:105-117` 转成一行的启动警告）。

**npm**：`getNpmInstallRoot()` `:2285` → project=`<cwd>/.pi/npm`、user=`<agentDir>/npm`、temporary=`<agentDir>/tmp/extensions/npm`；`ensureNpmProject()` `:2262` 写一个 `{name:"pi-extensions",private:true}` 的 `package.json` 并标记为云同步忽略；`getNpmInstallArgs()` `:2018` 按 npm/pnpm/bun 分派，统一禁用 peer 解析（`--legacy-peer-deps` / `--omit=peer` / `--config.auto-install-peers=false`），注释说明宿主的 `@earendil-works/pi-*` 由 loader 别名提供，装成依赖会产生重复运行时。

**git**：安装路径 `resolveManagedPath(installRoot, host, path)` `:2386`，越界直接抛 `Refusing to use path outside package install root`；`installGit()` `:2069` clone → 可选 checkout ref → 若有 `package.json` 装依赖；失败则 `rmSync(targetDir,{recursive:true,force:true})` + 清理空父目录后重抛 `:2096-2099`（即安装是事务性的）。更新走 `ensureGitRef()` `:2181`：只 fetch 目标 ref，`rev-parse` 比对，不同则**先写 marker 文件**（`.{dir}.pi-update-incomplete` `:2149`）再 `git reset --hard` + `git clean -fdx` + 装依赖；Windows 上文件被占用导致 clean 失败时**保留 marker 下次重试**，并给出一条人能看懂的 progress（`:2153-2179`）。

**temporary（`-e`）**：`getTemporaryDir()` `:2377` 用 `sha256(prefix-suffix@ref)[:8]` 分桶，目录权限 0700（`getExtensionTempFolder` `:270`）；temporary 源没有 `pi update` 路径，所以在 `resolve()` 时**加载即刷新**（`:1475-1490` npm 无 pin 时按 `name@latest` 重装；git 见 `refreshTemporaryGitSource` `:2209`，但 ref 是具体 commit 且 HEAD 已匹配时跳过网络）。

**并发**：常量 `UPDATE_CHECK_CONCURRENCY = 4`、`GIT_UPDATE_CONCURRENCY = 4` `:60-61`；`runWithConcurrency()` `:1864` 是标准 worker-pool（数组下标递增，结果按原序回填）。

**失败类型**：`MissingSourceAction`、`PackageInstallFailure`、`Unsupported install source`、超时（`NETWORK_TIMEOUT_MS=10000`，`runCommandCapture` `:2895` 超时 `child.kill()` 后 reject）、npm 元数据滞后专门有一条 `reportUnchangedNpmUpdates()` `:1338`（“registry reports X, try again in a few minutes”）。

**安全边界**：
- project scope 任何访问前 `assertProjectTrustedForScope()` `:1948`，未信任直接抛错。
- `resolveManagedPath` 父目录约束；`isPathInside` + `canonicalizePath` 校验 changelog 不许出包根 `:706-729`。
- glob 展开过滤任何以 `.` 开头的路径段 `:333-342`。
- `node_modules` 默认跳过 `:374-375`；忽略文件支持 `.gitignore/.ignore/.fdignore`。
- **没有**跨进程安装锁（本文件内只有 marker 文件的重试语义）；并发 pi 进程同时更新同一包不在保护范围内。

### 2.4 功能点

1. 三种来源（npm / git / local）统一解析、安装、升级、卸载、列表。
2. 两级作用域（user / project）+ temporary，且 project 覆盖 user、`autoload:false` 做增量覆盖。
3. 资源级 include/exclude/force 四种模式（`! + -`）。
4. 启动容错：装不上就跳过并报告，不阻断启动。
5. 离线模式一键关闭全部网络。
6. npm/pnpm/bun 三包管理器适配 + 宿主 peer 依赖抑制。
7. 安装事务性（失败回滚）、更新可恢复（marker 重试）。
8. 有进度事件与“版本没变”这类易踩坑的专门提示。

### 2.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| 资源优先级数值表 + 去重规则 | 我们现在多来源（内置 / 项目 / 用户）资源冲突没有显式 rank，靠加载顺序隐式决定 | P1 |
| 四类模式（include/exclude/force-include/force-exclude） | 表达力刚好够用，规则可写成用户看得懂的字符串 | P1 |
| 安装失败不阻断启动 + 顶层汇总报告 | 桌面端尤其需要：一个坏插件不能让人打不开应用 | P1 |
| 离线开关（`PI_OFFLINE`） | 一行环境变量，运维成本极低 | P1 |
| `autoload:false` 增量覆盖 | 解决“项目只想微调某个全局包的启用集” | P2 |

| 不学 | 理由 |
|---|---|
| npm/pnpm/bun 三套命令分支 + peer 依赖抑制 | 那是 Pi 用 npm 装扩展的架构副产品；我们是 Rust 单体，没有运行期 npm 安装 |
| `git clean -fdx` + `git reset --hard` | 破坏性太强，和我们的安全底线冲突 |
| temporary 源“加载即刷新” | 隐式网络副作用，不利于可复现 |

---

## 3. 资源装载：`packages/coding-agent/src/core/resource-loader.ts`

### 3.1 文件清单

| 文件 | 总行 | 非空 |
|---|---|---|
| `src/core/resource-loader.ts` | 1,319 | 1,191 |
| 依赖：`core/extensions/loader.ts`（`loadExtensionsCached` / `loadExtensionFromFactory` / `clearExtensionCache`）、`core/prompt-templates.ts`、`core/skills.ts`、`core/source-info.ts`、`modes/interactive/theme/theme.ts` | — | — |

### 3.2 入口与关键符号

| 符号 | 位置 | 作用 |
|---|---|---|
| `ResourceLoader`（接口） | `:181-193` | `getExtensions / getSkills / getPrompts / getThemes / getAgentsFiles / getSystemPrompt(+Source) / getAppendSystemPrompt(+Sources) / extendResources / reload` |
| `DefaultResourceLoader` | `:343` | 实现 |
| `reload()` | `:541-710` | 唯一装配入口，顺序即优先级 |
| `loadProjectContextFiles()` | `:260-302` | AGENTS.md 祖先链合并 |
| `loadContextFileFromDir()` | `:212-231` | 候选文件名：`AGENTS.override.md → AGENTS.md → AGENTS.MD → CLAUDE.md → CLAUDE.MD` |
| `findShadowedContextFile()` | `:242-258` | worktree 里被主仓同文件遮蔽时跳过，避免上下文加载两遍 |
| `omitReplacedExtensions()` | `:143-179` | `replaceable` 扩展被别人注册同名 tool/command/flag 时让位，并给出可操作警告 |
| `detectExtensionConflicts()` | `:1282-1318` | 同名工具/flag 冲突检测 |
| `dedupePrompts()` / `dedupeThemes()` | `:1192` / `:1218` | 同名后到者降级为 `collision` 诊断 |
| `discoverSystemPromptFile()` / `discoverAppendSystemPromptFile()` | `:1245` / `:1259` | `<cwd>/.pi/SYSTEM.md`（需信任）→ `<agentDir>/SYSTEM.md`；`APPEND_SYSTEM.md` 同理 |

### 3.3 真实行为

**装配顺序（`reload()`）**：清扩展缓存 → 可选“预信任扫描”（先把 `projectTrusted` 强制 false 载一遍，只带用户/全局与 CLI 临时扩展，交给回调决定是否信任 `:533-553`）→ `settingsManager.reload()` → `packageManager.resolve()`（见第 2 节）→ CLI `-e` 源（temporary）→ 合并 enabled 路径 → 载入扩展 → 记录每个路径的 `PathMetadata` → 依次装配 skills / prompts / themes → 载入 AGENTS 文件 → 解析 system prompt 与 append system prompt。

**优先级链条**（从高到低）：
1. project + settings 显式条目
2. project + 自动发现（`.pi/skills`、`.agents/skills`、`.pi/extensions` 等）
3. user + settings
4. user + 自动发现
5. 包资源
6. 内置扩展（`builtin:` 前缀，最后加载，因为“已加载的扩展不能卸载” `:719-723`）

**同名冲突**：扩展层面的工具/flag 名冲突**不卸载**，全部加载并按加载顺序取先者，冲突作为 `errors` 报出 `:835-842`；prompt/theme/skill 层面同名则记 `collision` 诊断并保留先到者。

**AGENTS.md 合并**：先全局 `<agentDir>`，再从仓库根到 cwd 逐级 `unshift`（保证“越靠近 cwd 越靠后、覆盖越强”），按真实路径去重；worktree 的 `.git` 指向主仓时，主仓同一文件名的 AGENTS.md 视为“被遮蔽”而跳过 `:242-258`。

**内置扩展可替换**：`omitReplacedExtensions` 处理“第三方 MCP 扩展注册了 `/mcp` 就顶掉内置 MCP 扩展”这类场景，并给一条包含修复步骤的警告（`:168-176`）。

**包依赖警告**：若扩展包的 `dependencies` 里出现宿主提供的 `@earendil-works/pi-*` / `typebox`，提示应改为 `peerDependencies: "*"`，否则会装出重复运行时模块 `:59-103`。

**诊断而非崩溃**：路径不存在、主题不是 json、prompt 解析失败等一律进 `diagnostics` / `errors`，不抛。

### 3.4 功能点

1. 6 层资源优先级 + 路径级去重。
2. 项目信任门（预信任扫描 → 决定 → 重新装载）。
3. AGENTS.md 祖先链继承 + worktree 遮蔽处理。
4. 可替换（replaceable）内置扩展机制 + 冲突诊断。
5. skills / prompts / themes / extensions 四类资源统一 metadata（`source / scope / origin / baseDir / packageRoot / changelogPath`）。
6. 每种资源都能被 override 回调改写（`*Override` 选项 `:323-340`），供 SDK 用户定制。
7. reload 的增量入口 `extendResources()` `:493`（运行期加 skill/prompt/theme 路径）。

### 3.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| 显式 6 级优先级 + 只在最终结果里做一次排序去重 | 我们现在是“谁先加载谁赢”的隐式规则，排查困难 | P0 |
| AGENTS.md 祖先链 + 越近越优先 | 与 Codex 行为一致，用户已有心智模型 | P0 |
| 冲突分级：能共存就共存 + 诊断，不能共存才让位 | 比“冲突即失败”友好得多 | P1 |
| 项目信任的两遍装载 | 解决“读项目配置前必须先问信任”的鸡生蛋问题 | P1 |
| 包依赖 host-provided 警告 | 我们现在没有插件，但一旦有扩展机制就会踩同一个坑 | P2 |

| 不学 | 理由 |
|---|---|
| 6 类 override 回调 | TS 里方便，Rust 侧用 trait/配置即可，不需要照抄形状 |
| 同进程加载 TS 扩展 | 权限模型完全不同（见 `pi.md` 5.2） |

---

## 4. 技能：`packages/coding-agent/src/core/skills.ts`

### 4.1 文件清单

| 文件 | 总行 | 非空 |
|---|---|---|
| `src/core/skills.ts` | 505 | 430 |
| 依赖：`utils/frontmatter.ts` `parseFrontmatter`、`core/source-info.ts`、`ignore`（npm 包） | — | — |

### 4.2 入口与关键符号

| 符号 | 位置 | 作用 |
|---|---|---|
| `Skill` | `:74-81` | `{ name, description, filePath, baseDir, sourceInfo, disableModelInvocation }` |
| `SkillFrontmatter` | `:67-72` | `name?`、`description?`、`"disable-model-invocation"?`，其余键透传 |
| `loadSkillsFromDir()` | `:168` | 单目录入口 |
| `loadSkillsFromDirInternal()` | `:173-275` | 发现算法本体 |
| `loadSkillFromFile()` | `:277-345` | frontmatter 解析 + 校验 + 构造 Skill |
| `formatSkillsForPrompt()` | `:358-388` | 注入 system prompt 的 XML |
| `loadSkills()` | `:414-505` | 多路径汇总 + 去重 + 同名碰撞 |
| `validateName()` / `validateDescription()` | `:92` / `:117` | 规范校验 |

### 4.3 真实行为

**发现规则**（源码注释 `:160-167`，实现 `:173-275`）：
1. 目录里有 `SKILL.md` → 该目录就是一个 skill 根，**不再向下递归**（找到即 `return`，`:220`）。
2. 否则先收本层 `*.md` 作为“根级技能”（仅 `includeRootFiles=true`）。
3. 再递归子目录找 `SKILL.md`；跳过 `.` 开头项、`node_modules`；尊重 `.gitignore / .ignore / .fdignore`（`:16`、`:47-65`）。
4. 符号链接按 `statSync` 解析，坏链接跳过。

**frontmatter**：`name` 缺省用父目录名；`description` 必填（缺/空 → 该文件被丢弃，`:304-308`、`:330-332`）。校验只产出 warning，不阻止加载：名字必须匹配 `^[a-z0-9-]+$`、长度 ≤64、不以 `-` 起止、无连续 `--`；描述 ≤1024。

**注入方式**（`:358-388`）：只注入 `name` / `description` / `location` 三项，XML 形如

```xml
<available_skills><skill><name>..</name><description>..</description><location>/abs/path/SKILL.md</location></skill></available_skills>
```

同时用一句话告诉模型“任务匹配描述时用 read（或 bash）去读该文件”，并强调“相对路径基于该 SKILL.md 所在目录，工具调用里用绝对路径”。**技能正文不进 prompt**——这与 Codex 的渐进披露一致，但 Pi 自己不读文件，完全依赖模型的 `read` 工具调用。

`disable-model-invocation: true` 的技能**不进 prompt**，只能由用户显式 `/skill:name` 触发（`:341`、`:359`）。

**去重与碰撞**：同一物理文件（经 symlink 到同一 realpath）静默跳过；同 `name` 不同文件 → `collision` 诊断，先到者胜（`:426-455`）。

**与 Codex skills 的差异**（仅就 Pi 侧可证事实；Codex 侧以 `docs/source-analysis/codex.md` 为准，本附录不重新核对）：
- Pi 的发现单位是**目录含 `SKILL.md`**，并额外支持“根目录散落的 `*.md`”当技能；Codex 侧技能入口是显式 skill roots（`.codex/skills` 等）。
- Pi 支持 `disable-model-invocation`（把技能降级为纯手动命令）；这是 Pi 自己的扩展字段。
- Pi 支持祖先链 `.agents/skills`（由 `package-manager.ts:507-526` 沿 git root 向上收集），即“仓库级共享技能”。
- 两边都用 agentskills.io 的 XML 披露格式，语义可迁移。

### 4.4 功能点

1. 单层根/递归子目录/根散落 md 三种发现路径。
2. frontmatter 规范校验（宽进：只警告）。
3. 显式 XML 披露 + 按需 read（省 token）。
4. `disable-model-invocation` 手动模式。
5. symlink/realpath 去重、同名碰撞诊断。
6. `sourceInfo`（user / project / path）贯穿，UI 可显示来源。

### 4.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| 只注入 name+description+location，正文靠 read | 我们现在若把技能全文塞 prompt，浪费上下文且难维护 | P0 |
| 目录含 SKILL.md 即技能根、不再下钻 | 规则一句话能说清，用户可预测 | P0 |
| 校验只警告不拒绝 | 用户写错一个大小写不该导致技能消失 | P1 |
| `disable-model-invocation` | “只想自己敲”的技能确实存在 | P1 |
| 祖先链 `.agents/skills` | 仓库级共享技能，团队协作有用 | P2 |

| 不学 | 理由 |
|---|---|
| 把根目录散落 `*.md` 当技能 | 歧义大（普通笔记会被当技能），我们已有显式 skills 目录 |

---

## 5. 会话导出：`export-html/` 与 `session-export.ts`

### 5.1 文件清单

| 文件 | 非空 | 总 |
|---|---|---|
| `src/core/export-html/index.ts` | 278 | 318 |
| `src/core/export-html/ansi-to-html.ts` | 270 | 297 |
| `src/core/export-html/tool-renderer.ts` | 159 | 175 |
| `src/core/export-html/template.html` | 52 | 52 |
| `src/core/export-html/template.css` | 906 | 1,085 |
| `src/core/export-html/template.js` | 1,803 | 2,044 |
| `src/core/export-html/vendor/{marked,marked-cjk-friendly,highlight}.min.js` | 1,296 | 1,311 |
| `src/core/session-export.ts` | 37 | 45 |

### 5.2 入口与关键符号

| 符号 | 位置 | 作用 |
|---|---|---|
| `exportSessionToHtml(sm, state?, opts?)` | `index.ts:238-284` | TUI `/export` 用；可带 `AgentState`（systemPrompt + tools）与 `toolRenderer` |
| `exportFromFile(inputPath, opts?)` | `index.ts:290-318` | CLI 导出任意 `.jsonl` 会话 |
| `generateHtml(sessionData, themeName?)` | `index.ts:143-177` | 拼装单文件 |
| `preRenderCustomTools()` | `index.ts:185-232` | 非内置工具用 TUI 渲染器预渲染 HTML |
| `TEMPLATE_RENDERED_TOOLS` | `index.ts:180` | `bash/read/write/edit/ls` 由模板自己渲染 |
| `ToolHtmlRenderer` | `index.ts:15-26`、`tool-renderer.ts:26-37` | `renderCall` + `renderResult`（collapsed/expanded） |
| `ansiLinesToHtml()` | `ansi-to-html.ts` | ANSI → 内联样式 HTML |
| `serializeSessionBranch()` / `exportSessionToJsonl()` | `session-export.ts:9` / `:32` | 只导出**当前分支**并补 `parentId` 链 |

### 5.3 真实行为

**序列化**：`SessionData = { header, entries, leafId, systemPrompt?, tools?, renderedTools? }`（`index.ts:130-138`）→ `JSON.stringify` → **base64** → 塞进 `<script id="session-data" type="application/json">`（`template.html:42`）。用 base64 是为了绕开 `</script>` 与转义问题（`:160-161` 注释）。

**前端**：`template.js` 用 `atob` + `TextDecoder` 还原（`:1-14`），纯数据建树（`buildTree`），支持 `?leafId=` / `?targetId=` 深链与 iframe `srcdoc` 注入参数（`:17-31`）；侧栏过滤 `default / no-tools / user-only / labeled-only / all`；搜索、可拖拽侧栏、图片弹窗。

**依赖全内联**：`marked`、`marked-cjk-friendly`、`highlight.js`、CSS、JS 全部拼进同一 HTML（`generateHtml` `:143-177` 依次 `replace` 六个占位符）。产物**完全可离线打开**，单文件可邮件/发群。

**主题**：把主题色转成 CSS 变量（`generateThemeVars` `:111-128`），并按亮度自动推导导出页背景/卡片/信息底色（`deriveExportColors` `:81-106`），保证浅色主题导出也好看。

**自定义工具**：内置 5 个工具由模板渲染；其余工具调用走 `ToolHtmlRenderer`，把 TUI 组件输出（ANSI）转成 HTML，输出 `collapsed` 与 `expanded` 两版（`tool-renderer.ts:57+`）。

**会话 JSONL**：`serializeSessionBranch` 输出 `header` 行 + 每条约 `{...entry, parentId}`，形成可回放的链（`session-export.ts:9-29`）。

### 5.4 功能点

1. 单文件、零外部依赖、可离线打开的 HTML 会话导出。
2. 分支感知（只导当前分支），JSONL 带 `parentId` 链。
3. 复用 TUI 渲染器（ANSI→HTML），自定义工具也能漂亮导出。
4. 深链（`leafId` / `targetId`）、树状侧栏、五种过滤、搜索。
5. 主题色自动派生导出配色。

### 5.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| base64 内嵌数据 + 单文件 HTML | 分享/归档成本最低，无需服务器 | P1 |
| 只导当前分支 + `parentId` 链 | fork/回退语义下不会导出整棵树 | P1 |
| 渲染器复用（一套 tool 渲染，两端输出） | 我们已有 Rust→前端工具渲染；导出可复用同一份描述 | P2 |
| 主题亮度推导导出配色 | 小细节，避免浅色主题导出成黑底 | P2 |

| 不学 | 理由 |
|---|---|
| 把整套 1.8k 行前端模板照搬 | 我们前端已定版，导出是独立小页面，重写更省事 |
| ANSI→HTML 全量实现（256 色/truecolor/OSC8） | 只在需要“终端保真导出”时才值得，可先只支持 16 色 |---

## 6. `chord`：跨进程对象运行时

### 6.1 文件清单（规模与结构）

| 指标 | 数值 |
|---|---|
| `packages/chord/src` `.ts` | 299 个，**56,461 行** |
| `packages/chord` 文档 `.md` | 69 个，24,061 行（含 `docs/design.md` 3,400+ 行） |
| 整包（含 json/css） | 980 个文件，172,263 行 |
| 主要模块 | `contracts`、`host`、`data`、`documents`、`jobs`、`link`、`registries`、`remote`、`state`、`store`、`delta`、`sync`、`surfaces`、`web`、`react`、`tui`、`node/{app,http,plugins,workers,tui,compression}`、`sqlite`、`telemetry-*` |
| 体量最大的文件 | `delta/tracker.ts` 2,165、`host/host.ts` 1,884、`host/attempt.ts` 1,398、`host/object.ts` 1,352、`host/reference.ts` 1,080、`store/store.ts` 937、`node/app/app.ts` 916、`jobs/records.ts` 885 |

### 6.2 它到底是什么（一句话）

**一个“让对象活过插件热重载、跨进程跨页共享、按 principal 隔离”的应用运行时**：应用由若干 **host**（进程/标签页/Durable Object）组成，host 之间用 **link** 连；代码以 **facet（插件声明）** 形式加载，声明“我 serve 哪些 **object type**”；调用方永远拿 **reference**（活的句柄，保持对象存活），而不是对象本身；对象的 **document**（命名 JSON）走事务提交，**derive** 从 watchable 派生，**job** 是能活过调用方的工作；**reload** 在运行中换掉插件代码而不断连接、不丢数据。

核心抽象（`docs/design.md` §2 概念表，`:46-69`）：

| 概念 | 定义 |
|---|---|
| host | 一个参与者：逻辑身份 + 一次“化身”（incarnation） |
| link | 两个 host 之间的连接 |
| host kind / address | 可寻址 host 的类型 / 某个实例（`Session({ id })`） |
| facet | 插件对某个 host kind 的声明（serve 哪些类型、贡献哪些注册表项），自身无状态 |
| object type | 契约：名字 + params（选实例）+ host 地址 + 成员 + **version** |
| object | 每个 (type, params, principal) 一个实例 |
| principal | 谁在调用（link 盖章，应用定型） |
| reference | `get()` 返回的活句柄；等待后是“已水合”的；保活 |
| document | 对象拥有的命名 JSON，事务写，持久化 |
| derive | 由 watchable 计算的纯函数值 |
| routine | 对象的常驻行为（`self.on(source, fn)`、`self.onLive(fn)`） |
| job | 调用发起但活过调用的工作：intent / run / finish |
| registry | 拥有者的扩展点，一个贡献者一项 |
| ctx | 每次调用：取消、principal、调用域引用 |
| revision | （服务器化身, 序号）= 一个 host 正在跑的完整代码集 |

### 6.3 关键源码位置

| 主题 | 位置 |
|---|---|
| 根导出（全部 API + store 适配器面） | `src/index.ts:1-54` |
| host / facet / object / reference | `src/host/host.ts`（1,884）、`src/host/reference.ts`（1,080）、`src/host/object.ts`（1,352）、`src/host/attempt.ts`（1,398） |
| 事务化 JSON 增量 | `src/delta/tracker.ts`（2,165）、`src/delta/diff.ts`、`src/delta/index.ts` |
| store / SQLite | `src/store/store.ts`（937）、`src/store/engine.ts`、`src/sqlite/*` |
| 传输与编码 | `src/link/binary.ts`（554）、`src/link/text.ts`、`src/remote/*`（provider 754 / hold 675 / remote-object 672 / consumer 464） |
| 插件构建/发现/热重载 | `src/node/plugins/{build,watcher,plugins,discover}.ts` |
| HTTP / workers / app kit / TUI | `src/node/http/*`、`src/node/workers/workers.ts`（841）、`src/node/app/app.ts`（916）、`src/node/tui/*` |
| 设计总纲 | `docs/design.md`（31 章，含 §22 Wire、§21 Reload、§31 Rejected） |

### 6.4 真实行为（挑对我们最相关的三块）

**① 增量与订阅（`delta`）**：`track(initial)` 取得独占所有权（O(1)，不遍历）→ `beginChange()` 开 overlay 草稿 → `prepare()` 冻结出 `{base, value, ops}` → `adopt()` 换根。op 元组只有 7 种：`["r",v]` 整体替换、`["s",p,v]` 设值、`["d",p]` 删除、`["a",p,text]` 追加、`["t",p,n]` 从头删字符、`["p",p,i,rm,items]` 数组 splice、`["m",p,perm]` 重排。`PendingOps` 会**折叠**慢消费者积压的 op（第 10,000 条后退化为 `replace`）。字符串增长必须用 `appendText()`，否则 `draft.text += chunk` 每次是 O(整串长度)（`delta/README.md` 实测：20,000 次 × 40 字符，2.4s vs 1ms）。

**② 事件（`design.md` §11 事件段 `:1565-1596`）**：事件是**一次性、无重放**的 JSON 值。每次 emit 递增该 host 的计数器并追加 `{source,value,at,n}`；每个绑定记录“建立时的计数器值”，只收 `n` 更大的；flush 是第一个 emit 排入的 microtask；状态消息先发、事件后发；窗口满则丢弃（事件不保证可靠）。**“必须保证的事”要写进 state，不能放进 event**（`:1595-1596` 明确写了）。

**③ 线协议（§22 `:2420-2479`）**：单一 `MESSAGE` tagged union（`hello/hold/release/call/abort/ack/bound/state/failed/loading/result/error/gone/ping/pong/event`）；**成员名走索引**（不传字符串）；`Part` 是“origin 处是 JSON 文本、线上是 UTF-8 字节”，中继转发时不解析；未知 id 静默忽略（属正常竞态）；两种编解码器可插拔（二进制约 23 B/token，2000 token 回复约 46 KiB vs 文本 196 KiB）。

### 6.5 为什么 `pi.md` 判断“不学”（我复核后的结论：成立，但要拆开看）

`pi.md` 的原话是“那是为‘同一份会话在终端/网页/多设备上同构’服务的，我们没有那个场景，抄进来只会变成第二套状态管理”。复核后我认为这个判断成立，理由更具体：

1. **它的复杂度来自“跨进程 + 热重载 + 多端同构”三个条件同时成立。** 56k 行 `src` 里，`host/`（约 7k）+ `remote/`（约 2.6k）+ `link/`（约 1.5k）+ `node/{plugins,workers,http,app,tui}`（约 6k）几乎全是这三件事的开销。我们单进程桌面应用，去掉任一条件，这一半代码都不需要。
2. **它的正确性成本极高且难验证。** `design.md` 有 31 章规则 + 决策日志，仍在标注 “Decision needed”；我们自己没有能力维护这种规格。
3. **它自带一整套“对象/引用/principal/registry”应用模型**，采用它等于采用它的架构。我们的 NORMA/EVA 已有自己的工具面与会话模型，两套并存就是用户最讨厌的“乱”。
4. **它把“一切皆可热重载”当第一目标**（`design.md` §1 第 1 条），而我们的 UI 是冻结的，热重载不是需求。

### 6.6 但有 4 处确实可借（不是照抄，是拿机制）

| 机制 | 出处 | 可借形式 | 优先级 |
|---|---|---|---|
| 事务化增量 + 折叠 | `delta/tracker.ts`、`delta/README.md` 的 Slow consumers 节 | 我们的流式事件/工具进度也可用“op 折叠”：慢消费者只收最新快照而非全部增量 | P1 |
| “未知 id 静默忽略，属正常竞态” | `design.md:2475-2478` | 我们的取消/超时路径常出现“回包晚于取消”，应明确当作正常态而非错误 | P1 |
| 事件不保证可靠、要保证的写进 state | `design.md:1595-1596` | 明确划分“可靠状态”与“可丢进度事件”，避免 UI 把进度当真相 | P1 |
| 决策区域（读已提交态、遇未发布写入者则重跑） | `durable/scheduler.ts:304-315` 注释 | 我们若做并发工具执行，可用同思路：读一致性检查 + 重试，而不是全局大锁 | P2 |

---

## 7. `pi-durable`：任务调度器与任务图

### 7.1 文件清单

| 文件 | 总行 |
|---|---|
| `packages/durable/src/harness/scheduler.ts` | 3,203 |
| `packages/durable/src/harness/task-graph.ts` | 306 |
| 周边（本附录未逐行）：`harness/{harness,generation,context,compaction,tool,agent,inbox,live,transcript,types}.ts`、`session/{session,transaction,writer,keys,forks}.ts`、`storage/{memory,jsonl,sqlite,indexeddb}` | 见 `pi.md` 包表（33,363） |

### 7.2 关键类型

| 类型 | 位置 | 说明 |
|---|---|---|
| `TaskGraphState` | `task-graph.ts:28-44` | `pending/running` / `waiting{on,policy}` / `sleeping{until,signals}` / `completing{outcome}` |
| `TaskGraphNode` | `task-graph.ts:46-62` | `{id, kind, conversationId, owner?, background, abortRequested, state, blocked?, conversations}` |
| `TaskDefinition<I,S,R,H>` | `types.ts:372` | `name` + `version` + `initial(input)` + **穷尽式 `phases` 映射** + `abort()` + 可选 `migrate()` + `hooks` |
| `JoinPolicy` | `types.ts:409` | `failFast / allSettled / any` |
| `WakeReason` | `types.ts:417-421` | `time / expired / signal / tasks` |
| `BlockedReason` | `scheduler.ts:101` | `missing_task / task_too_old / migration_failed` |
| `TaskScheduler` | `scheduler.ts:316` | 调度器本体 |
| `TaskGraphView` | `task-graph.ts:94` | 由提交发布派生出的“活任务图” |

### 7.3 真实行为

**任务模型 = 阶段机 + 检查点**。一个任务有 `checkpoint = {phase, attempt?}`；`phases` 是穷尽映射（类型层面保证不会漏阶段）；每跑完一个阶段必须**提交一个新的 checkpoint**，否则被判为 `fault`：

> `Task <kind> phase <phase> returned without durable progress`（`scheduler.ts:2426-2429`）

这条“没有持久进展就是故障”的规则，是整套持久化能自洽的关键——它把“死循环/静默空转”变成显式错误。

**状态机**：`pending → running → (waiting | sleeping | completing | terminal)`；`completing` 表示“结果已定但还有自己名下的普通工作没结束”（`:2551-2559`）。`waiting` 在写入前做**环检测**：wait-for 图必须无环，自身等待/等待持有自己的 owner 都是最短环（`:2599-2624`）。`sleeping` 带 `until` 与 `signals`，唤醒原因被记录为 `WakeReason`。

**重启与崩溃恢复**：`restarts` 计数，超过 `restartLimit` 的**非自终止**任务被写成 `faulted`（`:2005-2020`）；`abandonOnRestart` 的子孙在下次启动时先被 abort-mark（`:1973-1986`）；`open()`/`resume()` 会做一次 reconcile（`:481`、`:527`、`:1080`），把上次崩溃留下的 `running` 变成可续跑或故障。

**并发模型**（`:304-315` 的类注释是精华）：
- 不变量：**每一次任务状态变化都由一个回调在“Session line”上串行决定并写出**；handler 与 join 在线外跑。
- 决策读的是内存镜像（`#live`），但可能落后于已提交未发布的写；因此每个决策在 **decision region** 里做（同步、记录读过的 key、不暂存），一旦读到了未发布的写入者就等发布后重跑。
- 存储层做 **group commit**：多个 commit 合并一次写，但决策仍然串行。

**观测**：每个 phase 一个 span（`pi.durable.phase`），带 `task.id / kind / phase / outcome / attempt / resumed`，故障时设 `error` 状态并把消息截到 500（`:2346-2410`）；`TaskGraphView` 把“活任务图”从提交流里派生出来，供 UI 用 `watch()`/`observe()` 订阅（`task-graph.ts:141-153`、`:226-279`）。

### 7.4 功能点

1. 阶段机 + 检查点 + 版本迁移（`migrate(fromVersion)`）。
2. abort handler 必跑一次且必须提交终态。
3. 重启上限 + “无持久进展即故障”。
4. waiting/sleeping 与唤醒原因（时间/信号/任务完成）。
5. wait-for 图无环校验 + 三种 join 策略。
6. 崩溃恢复 reconcile，`abandonOnRestart` 语义。
7. 只读模式（`readOnly`：只加载不跑不提交）。
8. 决策区域 + group commit 的一致性模型。
9. 活任务图视图（含 `blocked` 原因，来自 registry 变化）。

### 7.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| “阶段 + 检查点 + 无进展即故障” | 我们 `goal.rs` 有 checkpoint 但缺“没进展就判错”的硬规则，容易空转 | P0 |
| `blockedReason` 三态（定义缺失 / 版本太旧 / 迁移失败） | 明确区分“我还没准备好”和“你坏了” | P1 |
| 重启上限 + abort handler 必跑 | 长任务可恢复的前提 | P1 |
| wait-for 图无环 + join 三策略 | 子代理/并行工具一旦要等待彼此，这是防死锁的最小完备集 | P1 |
| 决策区域（读一致性 + 重跑）思想 | 我们做并行工具执行时的正确性参考 | P2 |

| 不学 | 理由 |
|---|---|
| Chord 承载的 store / SQLite / group commit 全栈 | 与第 6 节同因：为多端一致性与热重载服务 |
| `sleeping` + 信号表 + 唤醒原因四态 | 我们目前没有“休眠任务等信号”的场景，先做超时即可 |
| 整套 `TaskGraphView` 派生订阅 | 我们用事件流推 UI 更直接 |

---

## 8. `pi-ai`：provider 注册与流式接口

### 8.1 文件清单

| 位置 | 规模 |
|---|---|
| `packages/ai/src/providers/` | 97 个 `.ts`，非空 3,570 行（43 provider + 43 catalog + `all.ts` + 10 支撑） |
| `packages/ai/src/api/` | 20 个 API 实现 + 12 个 `.lazy.ts` 包装；最大 `anthropic-messages.ts` 1,837、`openai-completions.ts` 1,607、`openai-codex-responses.ts` 1,561、`bedrock-converse-stream.ts` 1,346 |
| `packages/ai/src/auth/` | 19 个文件：`helpers.ts`、`resolve.ts`(201)、`types.ts`(226)、`oauth/{anthropic 277, openai-chatgpt 283, openai-codex 386, github-copilot 453, xai 218, radius 295, kimi-coding 248, openrouter 150, meta 182, device-code 85, pkce 30, callback-server 172, load 70}` |
| `packages/ai/src/models.ts` | 1,340 行（`Provider` / `Models` / `createProvider` / cost / thinking levels） |
| `packages/ai/src/types.ts` | 925 行（消息、事件、usage、`Model`、`StopReason`） |
| `packages/ai/src/model-catalog.ts`、`models.generated.ts`(18,822)、`models-store.ts`、`lazy-*.ts` | 目录生成与懒加载 |

### 8.2 注册机制（三层）

1. **catalog**：`providers/data/<provider>.json`（模型元数据）→ `catalog/generate.ts` 生成 `xxx.models.ts`（文件头写明 auto-generated）→ `model-catalog.ts:62-81` 的 `flatten{Chat,Image,Classifier}ModelCatalog` 把“按 api 分组的 JSON”拍平成 `Record<modelId, Model>`。
2. **provider 工厂**：`createProvider({ id, name, baseUrl, auth, models, api, fetchModels?, images?, classifiers? })`（`models.ts:1108-1275`）：
   - `api` 可以是**单个** `ProviderStreams`，也可以是 **按 `model.api` 分派的映射**；两者都没有则构造失败（`:1119-1121`）。
   - 静态 `models` + **动态覆盖** `dynamicModels`（`fetchModels` 拉到的按 `(type,id)` 覆盖静态项，`:1126-1136`）。
   - `refreshModels`：先恢复 `context.stored`，`allowNetwork` 且未中断才拉网络，`context.publish({persist, update})` 事务化发布并丢弃未知类型（`:1166-1192`）。
   - 请求分发 `dispatch()`：模型 api 没有实现时返回一个**会报错的懒流**，而不是抛异常（`:1139-1156`）。
3. **聚合**：`providers/all.ts:137-183` 的 `builtinProviders()` 实例化 43 个；`builtinModels()` 注册进 `Models` 集合（`:186-192`）；`getBuiltinModel(provider, id)` 提供字面量级类型推导（`:63-70`）。

### 8.3 鉴权

`Provider.auth` 是必需字段，且至少含 `apiKey` 或 `oauth`（`models.ts:165-172` 注释明确“连纯环境变量的、无 key 的本地服务也要提供 apiKey 语义，其 `resolve()` 报告是否已配置”）。`Models.getAuth()` 对未配置的 provider 返回 `undefined`。

代表实现（**深读的 3 个**）：

| provider | 鉴权行为 |
|---|---|
| `deepseek.ts`（14 行） | 只认 `DEEPSEEK_API_KEY`，复用 `openai-completions` API 实现 |
| `anthropic.ts`（90 行） | 顺序：stored credential → `ANTHROPIC_AUTH_TOKEN`(Bearer) → `ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` → **Workload Identity Federation**（`FEDERATION_RULE_ID`+`ORGANIZATION_ID`+`IDENTITY_TOKEN_FILE` 三项齐全才启用，其余两项可选；都通过 `env` 透传给 SDK 让它自己换 token）。另有 `oauth` 走订阅登录（`lazyOAuth`） |
| `openrouter.ts`（88 行） | apiKey 或 OAuth；**多 API 映射**（`anthropic-messages` + `openai-completions`）；另有 images 与 classifiers；`personalizeOpenRouterCatalog()` 用 `GET /models/user` 按 key 的实际可用模型裁剪目录（401/403/404 时保持原目录不报错），并用返回的 context_length/定价覆盖本地目录 |

其余 40 个按同一形状：`createProvider` + 一份 catalog + 一个 api 实现；差异集中在 baseUrl、鉴权环境变量、是否需要特殊 header、动态目录。

### 8.4 流式接口

- `Provider.stream(model, TranscriptContext, options?) → AssistantMessageEventStream`，`streamSimple` 是简化版；可选 `fetchDeferred` / `cancelDeferred` 支持批处理型 provider（`models.ts:223-240`）。
- 事件在 `types.ts:831` `AssistantMessageEvent`（`text_delta` / `thinking_delta` / `toolcall_delta` / `done` / `error` 等）；`StopReason = pending|stop|length|toolUse|error|aborted|deferred`（`:497`）；`Usage`（`:467`）挂在 `AssistantMessage` 上。
- `Transport = "sse" | "websocket" | "websocket-cached" | "auto"`（`:148`）——即协议层允许非 SSE。
- 每类 API 一个实现文件，`.lazy.ts` 是 3-7 行的动态 import 包装（冷启动优化）。

### 8.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| `Provider` 接口的**最小面**（id/name/baseUrl/auth/getModels/stream/filterModels） | 我们 `engine/deepseek.rs` 是单点硬编码，抽 trait 就够，不需要 43 份实现 | P1 |
| “api 缺失返回会报错的懒流”而非抛异常 | 把配置错误变成可展示的事件，UI 不会白屏 | P1 |
| `filterModels(models, credential)` | 同一 provider 不同凭证可用模型不同（ChatGPT OAuth 只能用 Responses API）是真问题 | P2 |
| 动态目录覆盖静态目录（按 `(type,id)` 合并） | 模型目录会过期，这条让“本地目录 + 远端刷新”共存 | P2 |
| 目录由脚本从 JSON 生成 | 避免手写巨型常量、便于 diff | P2 |

| 不学 | 理由 |
|---|---|
| 43 个 provider 实现、19 个鉴权文件、20 个 API 实现 | 我们只服务少数几家，且 DeepSeek 已单独优化 |
| OAuth 订阅登录 / 设备码 / PKCE | 我们走 API key |
| Workload Identity Federation | 企业场景，与个人桌面无关 |
---

## 9. 非交互模式：`print` / `json` / `rpc`

### 9.1 文件清单

| 文件 | 总行 |
|---|---|
| `packages/coding-agent/src/modes/print-mode.ts` | 165 |
| `packages/coding-agent/src/modes/json-event.ts` | 52 |
| `packages/coding-agent/src/modes/index.ts` | 15 |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | 737 |
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | 267 |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | 538 |
| `packages/coding-agent/src/modes/rpc/jsonl.ts` | 49 |
| `packages/coding-agent/src/rpc-entry.ts` | 13 |

### 9.2 模式选择

`main.ts:1013-1064`：`rpc` → `runRpcMode()`；`interactive` → `InteractiveMode`；其余（`print` / `json`）→ `runPrintMode()`，非零退出码写进 `process.exitCode`。`rpc-entry.ts` 是独立 bin：设 `process.title`、`PI_CODING_AGENT=true`、`AI_AGENT=pi`、屏蔽 `process.emitWarning`，然后 `main(["--mode","rpc", ...])`。

### 9.3 print / json 真实行为

`runPrintMode()` `print-mode.ts:33`：
- `mode: "text"`：只输出**最后一条 assistant 消息**的文本；`json`：`header` 一行 + 每条 `AgentSessionEvent` 一行 JSON。
- **退出码**：正常 0；`stopReason === "error"` 或 `"aborted"` → 1（错误写 stderr）；`stopReason === "length"`（被截断）→ 1 并在 stderr 说明“response was truncated”；捕获到异常 → 1；`SIGTERM` → 143、`SIGHUP` → 129（Windows 不注册 SIGHUP），**第二次信号直接 `process.exit`**（`:54-73`）。
- JSON 模式有**背压**：订阅 agent 事件并 `await waitForRawStdoutBackpressure()`，避免管道写爆（`:120-125`）。
- 收尾顺序很讲究：先 `disposeRuntime()`（幂等、共享一个 Promise），**销毁完成后才移除信号处理器**，最后 `flushRawStdout()`（`:173-181`，注释解释“否则信号会在 dispose 中途杀掉进程，例如 MCP token 刷新中”）。

`json-event.ts`：`message_update` 事件**剥掉累积的 `partial` 快照**，只留增量 + 累积 `usage`；`toolcall_start` 额外带 `id` 与 `toolName`（`:20-38`）。注释说明理由：`message_start` 给初值、delta 增量、`message_end` 给终值，都常量化，避免每帧重发全量。

### 9.4 rpc 真实行为

协议：stdin 每行一个 JSON 命令，stdout 每行 `response` 或事件；`id` 可选用于关联（`rpc-types.ts:4-6`）。

命令面（`rpc-types.ts:20-74`，33 条）：`prompt / steer / follow_up / abort / clear_queue / new_session`、`get_state`、`set_model / cycle_model / get_available_models`、`set_thinking_level / cycle_thinking_level / get_available_thinking_levels`、`set_steering_mode / set_follow_up_mode`、`compact / set_auto_compaction`、`set_auto_retry / abort_retry`、`bash / abort_bash`、`get_session_stats / export_html / switch_session / fork / clone / get_fork_messages / get_entries / get_tree / get_last_assistant_text / set_session_name`、`get_messages`、`get_commands`。

响应：统一 `{type:"response", command, success, data?|error?}`（`rpc-types.ts:116-245`），每条命令都有独立成功类型。

**扩展 UI 也走同一条管道**：扩展要弹选择框/确认/输入/编辑器/通知时，输出 `extension_ui_request`（`rpc-types.ts:252-287`），客户端回 `extension_ui_response`（`:294-297`）；需要阻塞的用 `pendingExtensionRequests` + 超时/中断（`rpc-mode.ts:95-130`）。不支持的能力（终端原始输入、自定义 footer/header、动画 loader）**显式声明为 no-op 并留注释**（`rpc-mode.ts:167-235`）——不是假装支持。

退出：`runRpcMode` 返回类型是 `Promise<never>`；stdin `end` 且空闲、无命令在跑、输入已就绪时才 `shutdown()` → `process.exit(exitCode)`（`rpc-mode.ts:744-756`、`:763`、`:826-842`）；信号语义与 print 一致（129/143）。

### 9.5 可学 / 不学

| 可学 | 理由 | 优先级 |
|---|---|---|
| JSONL 事件流 + `id` 关联 + **剥掉累积快照** | 我们做脚本/评测入口时最省流量的写法 | P1 |
| 明确的退出码表（0/1/129/143） | 自动化脚本要能判成败；我们 Tauri 版目前没有 | P1 |
| “dispose 完成前不移除信号处理器”+ 二次信号强杀 | 关停时的经典坑，代价极低 | P1 |
| 能力不支持就显式 no-op + 注释 | 避免上层以为能用 | P2 |
| stdout 背压等待 | 长输出管道不爆 | P2 |

| 不学 | 理由 |
|---|---|
| 33 条命令的完整 RPC 面 | 我们先用事件流 + 少量控制命令即可 |
| 扩展 UI 请求/响应协议 | 我们没有运行期 TS 扩展 |

---

## 10. 应用层：`apps/`（p2 / p2-mac / p3）

### 10.1 总览

| 目录 | 受控文件 | 性质 | 有无 `package.json` | 是否产品交付 |
|---|---|---|---|---|
| `apps/p2` | 1,088 | 可运行的自托管 Pi Durable UI（服务端 + Web + TUI + 每会话 worker + 插件） | 有（`private: true`） | **否**（原型，README 自我声明“will be gone soon”） |
| `apps/p2-mac` | 27 | macOS 原生壳（菜单栏 + WKWebView），跑/连本地 p2 | 无（SwiftPM `Package.swift`） | **否**（spike，ad-hoc 签名，无 notarize） |
| `apps/p3` | 50 | 纯设计文档包（下一个应用的规格） | 无 | **否**（无代码） |

根 `package.json` 的 `workspaces` 含 `apps/*`，所以 p2 是 npm workspace；p2-mac、p3 没有 `package.json`，只是目录。

### 10.2 `apps/p2` —— 自托管 Pi Durable UI

**是什么**：README 原文——“A self-hosted Pi Durable UI built from independent Chord plugins. Owners have full agent and shell control on that server and its workers; this is not server-side filesystem isolation. Downloaded TUI facets run in a locked-down worker on the visitor's machine.” 即：一个自己部署的、多端（浏览器 / 终端）共享同一批会话的 Pi 界面，服务端本身拥有 agent 与 shell 全权。

**如何启动**（README「Run」）：

```sh
npm install --ignore-scripts        # 仓库根
npm run hydrate:model-data          # 仓库根，拉模型目录数据
cd apps/p2
npm start                           # → http://127.0.0.1:8788
```

启动后打印一次性登录 token（10 分钟有效），浏览器粘贴登录；`PORT` 改端口，`P2_DATA_DIR`（默认 `~/.pi/p2`）改数据目录，`P2_FAKE=1 npm start` 用假 provider 演示。TUI：`npm run tui`（`src/hosts/tui.ts`，launcher 需 Node ≥26.5.1）；开发模式 `npm run dev`（带插件监听与重启）。

**依赖的包**（`apps/p2/package.json`）：`@earendil-works/chord`、`pi-ai`、`pi-durable`、`pi-env`、`pi-mcp`、`pi-schema`、`pi-telemetry`、`pi-tui`、`pi-codemode`（全部 `1.5.2`），另加 `@earendil-works/elanor-{react,icons-react,fonts}`、`design-tokens`（自有设计系统）、`react 19.3`、`ws 8.21`、`undici`、`esbuild`、`marked`、`lowlight`、`grok-mermaid`、`diff`、`yaml`、`proper-lockfile`、`discord.js 14`。

**源码结构**（`src/`）：

| 目录/文件 | 内容 |
|---|---|
| `hosts/server.ts`（48.7 KB） | HTTP + WebSocket accept；把 `session:` 地址路由到会话 worker；加载 server facets；鉴权、CSP、允许主机；构建/发布 Web 基础包与插件脚本 |
| `hosts/worker.ts` | **一个会话一个进程**：Chord host 挂在该会话地址上（`<data>/sessions/<id>/store.sqlite`），经 IPC 连服务端，持有该会话的 Durable Harness |
| `hosts/tui.ts` + `tui-*`（约 15 个文件） | 终端 launcher：信任侧（终端、传输、凭据）+ 沙箱侧 worker；下载的 TUI facet 在受限 Node worker 里跑 |
| `hosts/web/` | React 页面基础包（`main.tsx` 用 Chord 的 `startPage`） |
| `runtime/`（55 个文件） | `chord.ts`、`durable.ts`、`principals.ts`、`server.ts`（`serverCore`/`Routes`/`Upgrades`）、`owner-link.ts`、`process-lock.ts`、`backup.ts`、`files.ts` 等 |
| `web/`（40+ 文件） | `Chat.tsx`、`Code.tsx`、`AppLayout.tsx`、`ModelPicker.tsx`、`ElanorMarkdown.tsx`、手势/滚动/拖拽等 |
| `plugins/` | **48 个** Chord 插件目录：`agent`、`agent-plugins`（含 `writing-p2-plugins` 技能）、`artifacts`、`chat`、`codemode`、`coding-tools`、`conversations`、`devices`、`discord`、`files`、`history`、`locations`、`mcp`、`models`、`projects`、`radius`、`search`、`sessions`、`settings`、`sharing`、`subagents`、`sync`、`telemetry`、`terminals`、`tree`、`views`、`voice`、`workspace` 等 |
| `voice-server/` | Python（`server.py`、`engines.py`、`segmenter.py`、`Dockerfile`） |
| `scripts/` | `dev.mjs`、`reload.mjs`、`owner-link.ts`、`cloud-bundle.ts`、`migrate-*.ts`、`traces.ts` |

**安全模型（值得注意，不是常规 Web 应用）**：loopback 不等于授权——owner 的判定标准是“能否读服务器私有数据目录”（0700，`owner-key` 0600）；客户端用 owner key 对一次性 challenge 做 HMAC（绑定端口）登录，防重放；Cookie 30 天、HttpOnly、SameSite=Lax、远端 HTTPS 时 Secure；`P2_ALLOWED_HOSTS` 显式列出反代主机名；TUI 侧在**任何**下载模块求值前丢掉 `fs/net/child/worker/addon/wasi/inspector` 等权限，输出必须过 launcher 的白名单。

### 10.3 `apps/p2-mac` —— macOS 原生壳

**是什么**：README 原文——“A menu bar item that finds or runs the local p2 server” + “Windows that show p2's web UI in a WKWebView, signed in as the local owner without a token to paste”。AppKit + WKWebView，macOS 14+，**零依赖**。

**如何启动**：

```sh
cd apps/p2-mac
./scripts/build-app.sh        # → build/Pi.app（debug，ad-hoc 签名；CONFIG=release 优化）
open build/Pi.app
# 或
make run         # 自带服务：端口 8798，数据 ~/.pi/p2-mac/local（FAKE=1 用假 provider）
make run-radius  # 自带服务 + Radius：端口 8799
make attach      # 接管已在 127.0.0.1:8788 跑着的 p2
```

首次启动需在菜单栏选 checkout（pi-mono 根或 `apps/p2`）且依赖已装好，然后它执行 `node --import ./src/source.ts src/hosts/server.ts`。若端口上已有 p2 在答，它**接管**而不重启；dev 模式下可通过 `dev.sock` 重启。

**源码**（`Sources/P2Mac/`，20 个 Swift 文件，约 2,530 行）：`AppDelegate`(283)、`PiWindowController`(164)、`ServerController`(236)、`ServerScan`(95)、`ServerConfig`(96)、`RadiusAccount`(265)、`Brain*`（`Brain`/`BrainDirectory`/`BrainPage`/`BrainTabBar` 共 812）、`OAuthLoopback`(83)、`LocalSignIn`(60)、`DevControl`(56)、`Diagnostics`(89)、`MainMenu`(82)、`WindowChrome`(145) 等。

**依赖的包**：无（纯系统框架）。它依赖的是**外部进程** p2。

**配置**：每个设置一个 user default（`defaults write com.earendil.pi <key>`）+ 同名环境变量覆盖（`P2MAC_CHECKOUT/PORT/DATA_DIR/MODE/FAKE/ATTACH`），服务器日志落 `~/Library/Logs/Pi/server-<port>.log`，`P2MAC_DIAG_DIR` 可导出每页 DOM/PNG。

### 10.4 `apps/p3` —— 下一个应用的规格包（无代码）

**是什么**：50 个文件全是 `.md` / `.html` 文档，没有 `package.json`、没有 `src`。它是 p3 的设计与调研集合：

| 文档 | 内容 |
|---|---|
| `direction-pi-roam.md` | 方向讨论（未定）：个人 Pi 实例、一切可覆盖、Radius 备份/远程访问/一键云机器；“**实例就是信任边界**” |
| `plan-2026-11-11.md` | 计划：p2 是“随便试的操场”，下周决定哪些进 p3；p3 骨架（`server.ts` / `supervisor.ts` / `worker.ts`、`hello` 与 `reload` 插件、重载开关、压缩、隔离测试） |
| `step-0/`、`step-0a/` | 第 0 步规格（book + html 双份） |
| `resource-model/`、`map/`、`rundown/`、`org-managed/`、`people/`、`accounts/`、`apps/`、`layouts/`、`reload-loop/`、`base-inventory/`、`startup-telemetry/`、`coding-flow/` | 各主题规格与调研（每主题一份 `book.md` + 一份 `index.html`） |
| `views.md`、`sharing.md`、`authz-research.md`、`efficiency.md`、`decisions.md`、`handoff.md`、`status-2026-11-09.md`、`openclaw-teams.md`、`hermes-opencode-teams.md` | 视图模型、共享、授权调研、效率、决策日志、交接、状态、团队方案对比 |

**如何启动**：不适用（没有可运行物）。

**依赖的包**：无。

### 10.5 应用层结论（可学 / 不学）

| 可学 | 理由 | 优先级 |
|---|---|---|
| `p2` 的**每会话一进程** worker 模型 | 会话隔离、崩溃不互相拖死；我们用 Tauri 也可以给“重任务会话”开子进程 | P2 |
| owner 判定 = “能读私有数据目录”，加 HMAC challenge 登录 | 比“监听 127.0.0.1 就算本地可信”正确得多；我们如果做本机多用户要注意 | P2 |
| 壳/服务分离（`p2-mac` 只做宿主） | 我们已经是 Tauri 壳，这条已具备 | — |
| `p3` 的 `step-0` 文档纪律（每步一份规格 + 决策日志） | 我们正缺这种“先写规格再写码”的节奏 | P1（流程，不是代码） |

| 不学 | 理由 |
|---|---|
| Chord 插件树 / 热重载 / Web 与 TUI 共享同一会话 | 同第 6 节；且我们 UI 冻结 |
| `discord.js`、`voice-server`(Python)、Radius 云、cloud-bundle | 业务侧功能，与引擎无关 |
| 把 p2 当“产品”参考 | 它自己说会被 p3 取代，数据格式与 API 随时变 |

---

## 11. Pi 全功能清单（外围产品层）

成熟度：**生产级**（有测试、长期在用）/ **可用**（功能完整、边缘粗糙）/ **实验**（自称实验或会被替换）/ **原型**（spike）/ **设计稿**（无代码）。

| # | 功能 | 证据 | 成熟度 | 采用建议 |
|---|---|---|---|---|
| 1 | 三类包来源（npm / git / local）安装·升级·卸载 | `package-manager.ts:990-1256`、`:2044-2238` | 生产级 | 不采用（架构不同） |
| 2 | user/project 双作用域 + temporary + project 覆盖 | `:990-1010`、`:1915-1936` | 生产级 | **P1** 双作用域思想 |
| 3 | 6 级资源优先级（含 builtin 最后） | `:231-237`、`resource-loader.ts:541-710` | 生产级 | **P0** |
| 4 | 资源 include/exclude/force 四类模式 | `:807-861` | 生产级 | **P1** |
| 5 | `autoload:false` 增量覆盖全局包 | `:1518-1531`、`:2520-2536` | 可用 | P2 |
| 6 | 安装失败不阻断启动 + 顶层警告汇总 | `:1449-1469`、`resource-loader.ts:105-125` | 生产级 | **P1** |
| 7 | 离线模式（`PI_OFFLINE`） | `:64-68` | 生产级 | **P1** |
| 8 | git 安装事务性回滚 + 更新 marker 重试 | `:2096-2099`、`:2149-2179` | 生产级 | P2（思想） |
| 9 | 进度事件五态（start/progress/complete/error/result） | `:111-122`、`:973-988` | 生产级 | P2 |
| 10 | 项目信任门 + 预信任两遍装载 | `:1948`、`resource-loader.ts:533-553` | 生产级 | **P1** |
| 11 | AGENTS.md 祖先链 + worktree 遮蔽去重 | `resource-loader.ts:212-302` | 生产级 | **P0** |
| 12 | 可替换扩展（同名工具顶掉内置）+ 冲突诊断 | `resource-loader.ts:143-179`、`:1282-1318` | 生产级 | P1 |
| 13 | 资源 override 回调（SDK 定制） | `resource-loader.ts:323-340` | 可用 | 不采用 |
| 14 | 技能发现三规则（SKILL.md 根 / 根 md / 递归） | `skills.ts:160-275` | 生产级 | **P0**（前两条） |
| 15 | 技能 XML 披露 + 按需 read（省 token） | `skills.ts:358-388` | 生产级 | **P0** |
| 16 | 技能 frontmatter 校验（宽进只警告） | `skills.ts:92-127`、`:313-332` | 生产级 | **P1** |
| 17 | `disable-model-invocation`（手动技能） | `skills.ts:341`、`:359` | 可用 | **P1** |
| 18 | 祖先链 `.agents/skills` | `package-manager.ts:507-526` | 可用 | P2 |
| 19 | 单文件自包含 HTML 导出（base64 内嵌） | `export-html/index.ts:143-284` | 生产级 | **P1** |
| 20 | 分支感知导出 + JSONL `parentId` 链 | `session-export.ts:9-45` | 生产级 | **P1** |
| 21 | 复用 TUI 渲染器做 HTML 导出（ANSI→HTML） | `export-html/tool-renderer.ts:57+`、`ansi-to-html.ts` | 可用 | P2 |
| 22 | 导出深链/树/过滤/搜索 | `export-html/template.js` | 可用 | P2 |
| 23 | Chord 跨进程对象/引用/principal 运行时 | `chord/src/host/*`、`docs/design.md` | 实验（v2, experimental） | **不采用** |
| 24 | Chord 事务化 JSON 增量 + 慢消费者折叠 | `chord/src/delta/tracker.ts`、`delta/README.md` | 生产级（组件级） | **P1**（机制） |
| 25 | Chord 线协议：名字走索引 / Part 不解析 / 未知 id 忽略 | `design.md:2420-2479` | 实验 | P1（规则） |
| 26 | 事件模型：一次性、无重放、窗口满即丢 | `design.md:1565-1596` | 实验 | **P1**（划分原则） |
| 27 | 插件热重载 / rollout / 引用不断 | `design.md` §21、`node/plugins/*` | 实验 | **不采用** |
| 28 | durable 阶段机 + 检查点 + 迁移 | `scheduler.ts`、`types.ts:372` | 可用 | **P1** |
| 29 | “无持久进展即故障” | `scheduler.ts:2426-2429` | 可用 | **P0** |
| 30 | 重启上限 + abort handler 必跑 | `scheduler.ts:2005-2048`、`:2469-2489` | 可用 | **P1** |
| 31 | wait/sleep + 四种唤醒原因 | `types.ts:417-421`、`scheduler.ts:2130-2156` | 可用 | P2 |
| 32 | wait-for 图无环 + join 三策略 | `scheduler.ts:2599-2624`、`types.ts:409` | 可用 | **P1** |
| 33 | 崩溃恢复 reconcile + abandonOnRestart | `scheduler.ts:1080-1200`、`:1973-1986` | 可用 | P2 |
| 34 | 决策区域 + group commit（一致性模型） | `scheduler.ts:304-315` | 可用 | P2（思想） |
| 35 | 活任务图视图（含 blocked 原因） | `task-graph.ts:94-279` | 可用 | P2 |
| 36 | Provider 抽象（auth/models/stream/filter） | `ai/src/models.ts:158-380` | 生产级 | **P1** |
| 37 | 43 个内置 provider 实现 | `ai/src/providers/` | 生产级 | 不采用 |
| 38 | 模型目录代码生成 + 动态覆盖 | `model-catalog.ts`、`models.ts:1126-1192` | 生产级 | P2 |
| 39 | 按凭证过滤可用模型 | `anthropic.ts`、`openai.ts:27-29` | 生产级 | P2 |
| 40 | OAuth 订阅 / 设备码 / PKCE / WIF | `ai/src/auth/oauth/*` | 生产级 | 不采用 |
| 41 | print 模式 + 明确退出码 | `print-mode.ts:33-181` | 生产级 | **P1** |
| 42 | json 事件流（剥累积快照 + 背压） | `json-event.ts`、`print-mode.ts:115-125` | 生产级 | **P1** |
| 43 | rpc 模式（33 命令 + 扩展 UI 双向） | `rpc-mode.ts`、`rpc-types.ts` | 生产级 | P2 |
| 44 | 关闭时序：dispose 后再摘信号处理器，二次信号强杀 | `print-mode.ts:40-73`、`:173-181` | 生产级 | **P1** |
| 45 | p2：每会话一进程 + Chord 插件 UI + 多端同构 | `apps/p2/src/hosts/{server,worker,tui}.ts` | 实验（自称将废弃） | **不采用** |
| 46 | p2：owner key + HMAC challenge 本机登录 | `apps/p2/README.md`、`src/runtime/owner-link.ts` | 实验 | P2（思想） |
| 47 | p2：TUI 沙箱（下载代码前丢 fs/net/child 权限） | `apps/p2/DEV.md`「Security boundary」 | 实验 | P2（思想） |
| 48 | p2-mac：菜单栏宿主 + WKWebView + 自动接管已有服务 | `apps/p2-mac/README.md`、`Makefile` | 原型 | 不采用 |
| 49 | p3：step-0 规格驱动的开发流程 | `apps/p3/docs/step-0/book.md`、`plan-2026-11-11.md` | 设计稿 | **P1**（流程） |

统计：49 项中 **P0 5 项**（#3 / #11 / #14 / #15 / #29）、**P1 21 项**、**P2 15 项**、**不采用 8 项**。

---

## 12. 覆盖边界（必须与 `pi.md` 一起读）

### 12.1 本附录逐行读完的文件

| 文件 | 行数（总/非空） |
|---|---|
| `packages/coding-agent/src/core/package-manager.ts` | 2,967 / 2,656（全文） |
| `packages/coding-agent/src/core/resource-loader.ts` | 1,319 / 1,191（全文） |
| `packages/coding-agent/src/core/skills.ts` | 505 / 430（全文） |
| `packages/coding-agent/src/core/session-export.ts` | 45 / 37（全文） |
| `packages/coding-agent/src/core/export-html/index.ts` | 318 / 278（全文） |
| `packages/coding-agent/src/core/export-html/template.html` | 52（全文） |
| `packages/coding-agent/src/core/export-html/{ansi-to-html,tool-renderer}.ts` | 头 40 / 头 60（抽样） |
| `packages/coding-agent/src/core/export-html/template.js` | 头 80（抽样） |
| `packages/coding-agent/src/modes/print-mode.ts` | 165（全文） |
| `packages/coding-agent/src/modes/json-event.ts`、`index.ts` | 52 / 15（全文） |
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | 267（全文） |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | 737（头 120 + 命令分派索引 + 退出段；**未逐行读完全文**） |
| `packages/coding-agent/src/rpc-entry.ts` | 13（全文） |
| `packages/ai/src/providers/all.ts`、`deepseek.ts`、`deepseek.models.ts`、`anthropic.ts`、`openai.ts`、`openrouter.ts` | 全文 |
| `packages/ai/src/model-catalog.ts` | 全文 |
| `packages/ai/src/models.ts` | `Provider`/`Models` 接口（126-380）、`createProvider`（1063-1192）逐行；其余段抽样 |
| `packages/durable/src/harness/task-graph.ts` | 全文 |
| `packages/durable/src/harness/scheduler.ts` | 类头与不变量注释（287-360）、生命周期入口（449-760 抽样）、`#reconcile`（1080-1129）、`#reserve`（1966-2062）、`#run`/`#phase`/`#rules`/`#progress`（2308-2466）、`#step`/`#terminate`/`#commitState`/`#validateWait`（2499-2624）；**未逐行读完全文** |
| `packages/chord/docs/design.md` | §1-3（1-130）、§7 摘录（908-997）、§11 事件（1565-1596）、§22 线协议（2420-2479）、§31 Rejected（3382-3403）；**其余 30 章未逐章通读** |
| `packages/chord/src/delta/README.md` | 262（全文） |
| `packages/chord/src/host/README.md` | 头 130（抽样） |
| `packages/chord/src/index.ts` | 全文 |
| `apps/p2`：`README.md`、`DEV.md`、`docs/p2-notes.md`（头 70）、`package.json`、`src/source.ts`、`src/hosts/server.ts`（头 80）、`src/hosts/worker.ts`（头 40）、目录清单 | 抽样 |
| `apps/p2-mac`：`Package.swift`、`README.md`、`Makefile`、`scripts/build-app.sh`、`Sources/` 清单 | 抽样（非逐行） |
| `apps/p3`：`direction-pi-roam.md`、`plan-2026-11-11.md`、全目录清单 | 抽样 |

### 12.2 明确未覆盖

- `chord` 56,461 行中只读了约 1/10（`design.md` 摘要 + `delta` 全文说明 + `index`）；`store/`、`sync/`、`node/http`、`node/tui`、`sqlite/*` **未读**。
- `durable` 只精读调度器骨架与任务图；`harness/{generation,compaction,tool,context,live}.ts`、`session/*`、`storage/*` **未读**（`pi.md` 已给目录级描述）。
- `ai` 的 20 个 API 实现（约 1.2 万行）**未读**；只读了 3 个 API 的注册侧（`openai-completions` / `anthropic-messages` / `openai-responses` 的 `.lazy` 包装）与 5 个 provider 工厂。
- `apps/p2` 的 1,088 个文件（约 18 万行）只读了入口与文档；`src/web/*`、`src/runtime/*`、`plugins/*`、`tui-*` **未读**。
- `apps/p2-mac` 的 20 个 Swift 文件**未逐行读**。
- `apps/p3` 的 47 个文档**未通读**（只读方向与计划两篇）。
- 全部内容**未经运行时验证**：未 `npm install`、未 `npm start`、未跑 `p2`。第 10 节的“如何启动”来自 README / `package.json` / `Makefile` 的声明，**未实测**。

### 12.3 一句话收口

`pi.md` 回答的是“内核里什么最值得抄”；本附录回答的是“**内核之外那 20 万行在干什么、哪些是产品和实验、哪些机制能摘出来用**”。

结论：外围层真正值得动的只有 4 条——**资源优先级显式化**、**AGENTS.md/token 友好的技能披露**、**任务状态机加“无进展即故障”**、**导出/事件流的省流量写法**。`chord`、`durable` 全栈、43 个 provider、`apps/` 三件套都是**看结构、不搬代码**。

---

**本次唯一新增的文件**：`D:\卡塞尔学院\repo\docs\source-analysis\pi-appendix.md`。未修改 `pi.md` 或其他文件，未改动 `research-src` 下任何内容，未提交、未推送。
