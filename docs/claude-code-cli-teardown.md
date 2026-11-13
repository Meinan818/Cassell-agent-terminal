# 卡塞尔 CLI：Claude Code 与 DeepSeek 系 TUI 拆解 + 对照设计

> 研究日期：2026-11-13
> 目的：用户想做卡塞尔的 CLI 版本，觉得单纯命令行太丑，点名先把 Claude Code 的 CLI 拆一遍，再决定我们的 CLI 长什么样。随后用户又补充两个核实点：① Claude Code 是不是自研渲染引擎；② 他觉得好看的另一个 TUI，名字记不清了，“deepseek tui 还是 dsh tui”。
> 本文档 = Claude Code 拆解 + 渲染引擎核实 + 两个名字的身份确认与拆解（DeepSeek-TUI / dsh TUI）+ 综合对照 + 卡塞尔 CLI 对照设计方案。
> 方法：只写能找到来源的东西。官方文档、真实截图的文字记录、源码分析文章、项目 README。**没有来源的结论会明确写“未证实”，不编造。**

---

## 0. 先说结论（TL;DR）

1. **Claude Code 好看，七成是设计层、三成是渲染层。** 设计层 = 极度克制的配色（一主色 + 灰阶）、信息分层（一行一件事、人话不要 JSON）、信任感（工具调用永远可见、可折叠但不隐藏）。渲染层 = 流畅不闪烁（60fps 流式、同步输出），这部分确实下了重本。
2. **渲染引擎核实结论：用户听说的“自研渲染引擎”，对了一半。** Claude Code 不是从零自研，也不是直接用开源 Ink，而是**在 Ink 的基础上深度 fork、把关键路径全部重写**的“半自研”引擎：React 调和器 + Yoga 布局这两个骨架留着，渲染管线（双缓冲、逐格 diff、类型化数组、字符串池、同步输出）是自己写的。源码在 `src/ink/`，多份独立源码分析一致证实这一点。详见 §1.8。
3. **“deepseek tui / dsh tui”两个名字都查到了，而且是两个不同的东西：**
   - **deepseek tui = DeepSeek-TUI**（github.com/Hmbown/DeepSeek-TUI）：独立开发者做的 Rust 终端 coding agent，“DeepSeek 版 Claude Code”，2026 年 5 月上 GitHub Trending，**现已改名 Codewhale**（github.com/codewhale-hq/Codewhale，41,178 star，2026-11-13 实测）。用 **Ratatui** 渲染。
   - **dsh tui = DeepSeek Harness（dsh）的 TUI**：dsh 是 DeepSeek 官方的 agent harness CLI（`@deepseek-ai/dsh`），它的终端界面有官方版和好几个社区版，其中最出名的是 **ccch1mneyyy/dsh-TUI**（像素鲸鱼顶栏，DSH 官方公众号收录、官方首推的 TUI 插件）。用户说的很可能就是像素鲸鱼那一个。
   - 两个都值得拆：一个代表 **Rust + Ratatui** 路线，一个代表 **Ink / pi-tui / OpenTUI / 原生 ANSI 四条路线同场竞技**的生态。
4. **给卡塞尔 CLI 的明确选型建议：Rust + Ratatui。** 不要含糊，就是它。理由与投入产出比见 §5.1。我们的后端本来就是 Rust（Tauri），同一语言、同一进程、不用再装 Node/Bun 运行时，Windows 发行也最顺。Claude Code 那种 fork 级别的自研渲染，现阶段不值得做——等 Ratatui 真的成为瓶颈那天再 fork，就像 Anthropic 当年做的那样。
5. **最值得抄的 5 条（按优先级）：** ① 工具调用一行一件事 + 人话不要 JSON；② 状态栏常驻（模型/上下文/模式/成本，一眼看到）；③ 思考指示有生命感（spinner + 异想动词 + 用时/token）；④ 开场有个小仪式（吉祥物 + 欢迎，不超过 1 秒）；⑤ 颜色只用 3–4 种，一个强调色打到底。

---

## 1. Claude Code CLI 拆解

> 版本口径：交互行为以官方文档 Interactive mode（code.claude.com，v2.1.x，2026-11-13 读取）为准；内部实现细节来自对 v1.x 时期源码的分析（见 §1.8 的版本说明）。

### 1.1 整体长相：三个区 + 一个吉祥物

**布局只有三个区，从上到下：**

```
┌──────────────────────────────────────────────────┐
│ 对话区（可滚动的历史记录）                          │
│   用户消息 / 助手回复 / 工具调用行 / diff / 思考     │
│   …流式输出…▍                                     │
├──────────────────────────────────────────────────┤
│ 输入框（带边框的输入盒，`>` 提示符，上方一条 ─ 分隔） │
│   > 帮我把这个函数重构一下                          │
├──────────────────────────────────────────────────┤
│ 状态栏 / 页脚（几行小字）                           │
│   当前目录 · 后台任务 · PR 链接 · 模式 · 上下文用量    │
└──────────────────────────────────────────────────┘
```

- **全屏渲染**：占满整个终端（alternate screen），不是一行行往上顶的普通 CLI。标题栏也有状态：工作时显示 Braille spinner 字形，空闲时显示 `✳`；任务完成时发 OSC 9 进度通知（`ESC]9;4;0`）。
- **对话区是主角，占绝大部分高度**；输入框固定在底部附近；状态栏是几行小字，不抢戏。
- **启动时显示什么**：一句 “Welcome back!” + **像素风吉祥物**（橙色像素小兽，有粉色变体；另有新月 + 云 + 星星 + 虚线地面的像素画、大号字母 C 变体）。右侧是 “Tips for getting started” + “What's new”（如 /fork、auto-mode reset、session limits）。下方显示模型、账号、当前目录。首次运行会出主题选择器（7 个选项，Dark 默认），底部提示 “Image in clipboard · ctrl+v to paste”。
- **启动后的状态栏示例**（来自真实截图的文字记录）：`[Opus 5.5 high] jarrod`、上下文 0%、用量 41%（43 分钟后重置）、`auto mode on (shift+tab to cycle)`。
- **模式 / 权限提示**：default（显示为 Manual）、plan、acceptEdits、auto、bypassPermissions；Shift+Tab 切换；页脚显示当前模式。PR 链接的下划线颜色表评审状态：绿 = 已批准、黄 = 待定、红 = 要求修改、灰 = 草稿。

来源：官方文档 code.claude.com/docs/en/interactive-mode；claude-code-explorer.vercel.app；多张真实截图的文字记录（facebook.com / Instagram 相关帖文）。

### 1.2 颜色与字体：一个主色 + 灰阶，克制到极致

- **品牌橙是唯一强调色**：深色主题 `#d97757`，浅色变体 `#c4613d`。整个界面基本只用这一个彩色。
- **色板一共 6 个色**：深 `#141413`、浅 `#faf9f5`、中灰 `#b0aea5`、浅灰 `#e8e6dc`、蓝 `#6a9bcc`、绿 `#788c5d`。蓝和绿只在极少数地方出现（链接、成功态）。
- **主题选择器共 7 项**：auto、dark（默认）、light、dark-daltonized、light-daltonized（色盲友好，红/绿对比换成蓝/黄）、dark-ansi、light-ansi（仅 16 色，兼容老终端）。Dark 主题强调色 `#e8956d`，Light 主题 `#a84f2a`，焦点环 `#d97757`。
- **字体**：继承用户终端自己的等宽字体，不自带字体；Apple Terminal 会自动降级到 256 色。也就是说 Claude Code 的“好看”完全不依赖字体，靠的是排版和颜色克制。
- **克制体现在数字上**：彩色 ≤ 2 种（橙 + 偶尔的蓝/绿），灰阶 4 档，边框几乎不用（没有盒子线，只有 `─` 分隔线），留白靠空行而不是线框。

来源：品牌色板与主题见 blog.vincentqiao.com（/theme）、sdeaton.com（Costuming Claude Code）、waka-ds.com、dplouffe.ca；7 个主题见官方文档。

### 1.3 工具调用怎么显示：紧凑的一行，人话不要 JSON

这是 Claude Code 最值得抄的部分。精确语法来自对 v2.1.207 的实测记录（npm.io `@owlburtoe/pi-claudify`，该项目明确“capture, do not guess”）：

```
⏺ Read(src/app.ts)                    ← 标题行，列 0 开始，工具名加粗
⎿ Read 42 lines                       ← 结果行，缩进一格，写成一句话
⏺ Edit(src/app.ts)
⎿ Updated 2 lines
⏺ Bash(npm test)
⎿ 3 passed, 1 failed
```

- **标题行 `⏺ Tool(args)`**：工具名加粗，文件路径是 OSC 8 超链接（终端里可点击打开）。参数只放最关键的一个（文件名、命令），不要把整个参数 JSON 倒出来。
- **结果行 `⎿ …`**：结果写成一句话，不是 JSON：`Wrote 3 lines to <path>`、`Added 2 lines, removed 2 lines`、`Listed 1 directory`。
- **状态圆点**：灰 → 绿（成功）/ 红（失败）。失败时收成红色短标签，如 `● Write(src/config.ts)` / `⎿ Error writing file`，完整错误信息只在 Ctrl+O 转录视图里看。
- **只读工具会聚合**：运行时聚合成一句进行时标题，如 `⏺ Searching for 1 pattern, reading 2 files…`；回合结束后收成暗色过去时摘要，如 `Read 1 file, ran 1 shell command`。**不刷屏是靠聚合，不是靠隐藏。**
- **友好名**：Edit 显示为 Update，Glob/Grep 显示为 Search。用户看到的是动作，不是内部工具名。
- **MCP 调用完全没有工具行**（无标题、无结果、无参数）——这是个反例：藏得太干净，用户反而不知道发生了什么。我们不要学这一点。
- **常见 shell 命令按语义渲染**：如 `nl -ba file | sed -n '1,200p'` 显示为 `Read file (lines 1-200)`。Bash 输出按语法高亮的 shell 脚本显示，描述与超时写成 `#` 注释。
- **AskUserQuestion 渲染为问题卡片 + 选项**，选中的高亮。
- **说话人配色**（Backscroll / 转录阅读）：用户消息蓝色、Claude 回合结束回复绿色、工具流量无着色、失败的工具结果红色、skill 正文琥珀色。
- **信任感设计**：工具调用不要整个藏起来——每一次调用都看得见、可展开、可追溯，但默认只占一行。

来源：npm.io `@owlburtoe/pi-claudify`（v2.1.207 实测记录）；blog.laozhang.ai；learn.b-squared.tech；cfb3.github.io 工具速查表。

### 1.4 Diff 怎么显示

- **统一格式（unified diff）**，Claude 的红/绿配色，带行号栏，**无盒子边框**（不要框起来，diff 本身就是内容）。
- **被删行不做语法高亮**（Claude 也是这样），改动行着色；新增行绿、删除行红。
- shell 命令造成的改动也会记录并显示 diff，折叠形态如 `2 files +3 −1`。
- `/diff` 命令看工作区改动，可按回合过滤（T1、T2，`source` 参数）。

来源：官方文档；npm.io `@owlburtoe/pi-claudify` 实测记录。

### 1.5 思考 / 状态指示：有生命感，但不花哨

- **Spinner 是 6 帧星号循环**：`· ✢ ✳ ✶ ✻ ✽`（Interpunct、四泪滴辐条星、八辐星、六角黑星、泪滴辐条星、粗泪滴辐条星）。Ghostty 与非 Darwin 终端用 `*` 代替。
- **184 个异想动词**（Alex Beals 2026-02-07 从 node_modules 用 ripgrep 得到并全文公布；另一来源 deepakness.com 称 187 个，版本差异），每回合随机选一个，可在 settings.json 用 `spinnerVerbs` 自定义。另有 spinner tips（长等待时 spinner 下方浮现的提示）。
- **格式示例**：
  - `✻ Pontificating... (21s • ↓ 173 tokens)`
  - `Working… (3s · ↑ 429 tokens · esc to interrupt)`
  - `Grooving, 5s, 248 tokens, thinking`
- **等待态**：20 秒无数据出现 “Waiting for API response” 横幅；重试显示 “Retrying in a few seconds” + 尝试次数。
- **回合结束**：一行过去时总结，如 `✻ Cooked for 8s`。
- **中断**：按 Esc 后显示 `Interrupted · What should Claude do instead?` 并回到输入框。
- **页脚提示**：工作时显示 `esc to interrupt`；空闲时显示空闲提示。
- **关键设计**：思考指示 = 动词（有性格）+ 用时 + token 数（有信息量）+ 明确的中断出口（esc）。三者缺一不可。没有用三个跳动圆点糊弄——那是 grokbot 设计语言明确拒绝的做法，我们也不要。

来源：blog.alexbeals.com/posts/claude-codes-thinking-animation；官方文档；deepakness.com。

### 1.6 输入框与交互

- **提示符**：`>`，带边框的输入盒，上方一条 `─` 横线与对话区分隔。输入框空闲时可显示灰色幽灵提示（如 “run the tests”、“commit this”）。
- **排队**：排队中的消息显示为灰色 + 提示 `ctrl+x ctrl+s to send now`，输入框显示 “Press up to edit queued messages”。
- **多行输入**：`\` + Enter、Option+Enter、Shift+Enter、Ctrl+J、直接粘贴。
- **补全**：命令补全可在提示中间工作，幽灵文本 + `+2` 计数；Tab 接受。
- **`/` 命令菜单**（含内置命令、skill、插件、MCP）、`!` shell 模式、`@` 文件提及（自动补全）、`:` emoji 简码、`?` 快捷键帮助面板。Vim 模式经 /config 开启。
- **快捷键**（官方文档，以 v2.1.x 为准）：
  | 按键 | 作用 |
  |---|---|
  | Ctrl+C | 中断 / 清空输入 |
  | Ctrl+D | 退出（第一下给确认提示，第二下退出） |
  | Esc | 中断；Esc+Esc 回退菜单 / 双击 Esc 打开 rewind 菜单 |
  | Shift+Tab | 切换权限模式 |
  | Ctrl+O | 转录视图（每条助手消息的时间戳与模型，展开默认折叠行） |
  | Ctrl+R | 反向搜索历史 |
  | Ctrl+T | 任务清单（/theme 内切换语法高亮） |
  | Ctrl+L | 重绘 |
  | Ctrl+B | 后台任务 |
  | Ctrl+S | 暂存 / 恢复输入 |
  | Ctrl+G 或 Ctrl+X Ctrl+E | 在编辑器中打开 |
  | Ctrl+Z | 挂起（仅 Unix） |
  | Option+P / Alt+P | 切换模型 |
  | Option+T / Alt+T | 切换扩展思考 |
  | Option+O / Alt+O | 切换 fast mode |
  | Tab | 接受补全 |
  | Up/Down | 历史 |
  | Ctrl+V | 粘贴图片为 `[Image #N]` 芯片 |
  | Ctrl+Enter | 立即发送排队消息 |
- **权限提示**：拟议改动 + Yes/No 的选项卡对话框，Left/Right 切换选项卡，Tab 可在回答上加评论。

来源：官方文档 code.claude.com/docs/en/interactive-mode（2026-11-13 读取）；ai-docs-hub.soarx.cc。

### 1.7 是什么让它觉得高级：设计原则提炼

1. **克制**：一个强调色（橙）、四档灰、几乎无线框。高级感来自“少”，不是“多”。
2. **节奏**：对话区 → 输入框 → 状态栏，三段式固定节奏；每一回合都有明确的开始（spinner + 动词）、过程（工具行依次出现）、结束（过去时总结 + 用时/token）。
3. **信任感**：工具调用永远看得见（一行），结果写成人话，失败给红色短标签 + 完整信息可查。藏起来的是细节，不是事实。
4. **信息密度分层**：默认只给一行摘要，展开才给详情（Ctrl+O 转录视图、折叠的工具行）。长会话不靠删内容，靠折叠。
5. **有性格但不吵**：像素吉祥物只在启动时出现一次；spinner 动词每回合换一个，但字号、颜色、位置永远不变。性格藏在细节里，不抢主流程。
6. **状态永远可见**：模型、上下文用量、模式、后台任务都在状态栏，不用问、不用翻。
7. **快**：流式输出是逐字来的，但渲染不闪烁、不跳动（见 §1.8，这就是渲染层投入的回报）。

### 1.8 渲染引擎核实：Claude Code 是不是自研渲染引擎？

**先给结论：用户听说的“自研渲染引擎”，对了一半，准确说法是“在 Ink 上深度 fork 的半自研引擎”。**

| 说法 | 是否成立 |
|---|---|
| 直接用开源 Ink | ❌ 不成立。源码里没有 `ink` 这个 npm 依赖，`src/ink/` 是内嵌在仓库里的 fork |
| 从零完全自研 | ❌ 不成立。React 调和器（react-reconciler）+ Yoga 布局引擎这两个骨架仍然是开源的 |
| **在 Ink 基础上 fork、关键路径全部重写** | ✅ 成立。多份独立源码分析一致证实 |

**证据链（按强度排序）：**

1. **源码结构**：Claude Code 源码树里有一个 `src/ink/` 目录，里面是完整的渲染实现：`ink.tsx`（Ink 类，管理 React FiberRoot 与终端生命周期）、`renderer.ts`（渲染器）、`reconciler.ts`（React 调和器桥接）、`terminal.ts`（终端输出）、`log-update.ts`（差分输出）、`dom.ts`（自定义 DOM）、`layout/yoga.ts`（Yoga 适配）。开源 Ink 是作为 npm 包引用的，Claude Code 是把 Ink 的源码整个搬进自己仓库改——这是 fork 的标准形态。
   来源：DeepWiki 对多个 claude-code 源码镜像的分析（aoxiang9696/claude-code、lazyJLBL/claude-code、lttcnly/claude-code、leoyin1127/cc、btwiuse/claude-code、xqliang/claude-code），各页结论一致。
2. **改了什么**（claude-code-from-source.com 第 13 章《The Terminal UI》，逐源码的书）：
   > “Claude Code started with Ink, then forked it beyond recognition. The stock version allocates one JavaScript object per cell per frame — on a 200x120 terminal, that is 24,000 objects created and garbage-collected every 16ms. It diffs at the string level… What remains in Claude Code is a custom rendering engine that shares Ink's conceptual DNA — React reconciler, Yoga layout, ANSI output — but reimplements the critical path: packed typed arrays instead of object-per-cell, pool-based string interning instead of string-per-frame, double-buffered rendering with cell-level diffing, and an optimizer that merges adjacent terminal writes into minimal escape sequences. The result runs at 60fps on a 200-column terminal while streaming tokens.”
   > 翻译：原版 Ink 每帧每个格子分配一个 JS 对象（200×120 的终端 = 每 16ms 创建并回收 24,000 个对象），字符串级 diff。Claude Code  fork 之后：类型化数组代替每格对象、字符串池代替每帧新建字符串、双缓冲 + 逐格 diff、合并相邻终端写入。结果是 200 列终端上流式输出跑满 60fps，单帧渲染约 2.3ms。
3. **Yoga 也是自己移植的**：`src/native-ts/yoga-layout/` 是 Meta Yoga 布局引擎的**纯 TypeScript 移植版**（不是官方的 yoga-layout npm 包），只实现用到的 flexbox 子集（flex-direction、flex-grow/shrink、绝对定位）。
4. **终端协议层是自己写的**：`termio` 子系统完整解析 CSI / OSC / DEC 私有模式序列；支持 DEC 同步输出（BSU/ESU，DEC mode 2026），让复杂帧更新原子化渲染、不撕裂；支持 DECSTBM 滚动区域硬件加速；全屏模式用 alternate screen + 自定义文本选择引擎（因为原生选择在全屏应用里会被拦截）。
   来源：同上 DeepWiki 各页；claude-code-source.doccupine.app/terminal-ui。
5. **官方文档的旁证**：当前官方文档（v2.1.x）提到存在**两种渲染器**——fullscreen rendering 与 classic renderer，`/tui` 命令（不带参数）可查看当前激活的是哪一个；转录视图的部分快捷键只在其中一种渲染器下可用。但官方文档**没有说明**这两种渲染器各自的实现方式，所以“2.x 的 fullscreen 渲染器是不是又重写了一遍”，**未证实**，不要当作结论。

**版本说明（诚实标注）**：上述源码分析的爬取时间是 2026-03-31 至 2026-04-04，对应 v1.x 时期的代码。Claude Code 2.x 是否改动了渲染层，公开资料里没有可核实的说法。本节结论的有效范围是“v1.x 时期的 Claude Code”；2.x 的 fullscreen renderer 标注为未证实。

**对我们意味着什么**（先记结论，完整选型建议在 §5.1）：
- Claude Code 好看，有一部分确实是渲染层投入换来的——主要是**流式输出不闪烁、不撕裂、60fps**，而不是颜色和排版（那些是设计层）。
- 但这个投入的量级是：一个团队、数月、为 60fps 流式 + 超长会话专门优化。Anthropic 是先用开源 Ink 起步，**被性能逼到墙角才 fork**，不是一上来就自研。
- 我们的正确姿势是抄这个顺序：先用成熟框架（Ratatui）起步，把设计层做到位；只有当实测证明框架成为瓶颈时，才考虑 fork 或自研渲染层。

---

## 2. 第二参考 A：DeepSeek-TUI（现名 Codewhale）——用户说的“deepseek tui”

### 2.1 身份确认：就是它，名字完全一致

- **“deepseek tui” = DeepSeek-TUI**，GitHub 仓库 `Hmbown/DeepSeek-TUI`。名字、定位都对得上：一个 DeepSeek 模型的终端 coding agent，被中文媒体称为“DeepSeek 版 Claude Code”。
- **项目背景**：2026 年 1 月 19 日创建，独立美国开发者 Hunter Bown（Hmbown）发起，自称 DeepSeek 爱好者（“鲸鱼兄弟”之一），Rust 编写，MIT 开源，明确声明与 DeepSeek 官方无关。2026 年 5 月初上 GitHub Trending，当时约 2.3k star；中文推广后迅速走红。
- **⚠️ 重要：已经改名了。** 该项目现名 **Codewhale**，仓库已迁移为 `codewhale-hq/Codewhale`，旧地址 `github.com/Hmbown/DeepSeek-TUI` 打开会自动跳转到新仓库。改名原因是 scope 扩大：从“只服务 DeepSeek 模型”变成“任何模型都平等对待”，不再只绑定一家提供商。配置与会话可平滑迁移（仓库里有 `docs/REBRAND.md`）。现在搜 `deepseek-tui` 会找到很多停在 v0.8.11 的旧 fork 和镜像，**不要装旧名字，要装 Codewhale**。
- **体量（2026-11-13 实测 GitHub 仓库页）**：41,178 star、14,741 个提交、140 个 release、3,571 个 fork。已经是终端 agent 领域的一线项目。
- **收录**：DeepSeek 官方的 awesome 清单 `deepseek-ai/awesome-deepseek-agent` 里有专门一页介绍它。
- **和卡塞尔的关系**：用户 DeepSeek 用得最多，这个项目默认就是 DeepSeek（默认模型 `deepseek-flash`，现对应 DeepSeek V4.1 Flash），是我们 CLI 最直接的“同行”——同一个模型、同一个终端形态。

来源：github.com/Hmbown/DeepSeek-TUI（跳转后为 codewhale-hq/Codewhale，2026-11-13 读取）；aichina.news《“The DeepSeek version of Claude Code” hits 2.3k GitHub stars》（2026-05-04）；explainx.ai《DeepSeek-TUI: terminal coding agent for DeepSeek V4》；devglaze.com《DeepSeek TUI: The Agent That Became Codewhale》；github.com/deepseek-ai/awesome-deepseek-agent/blob/main/docs/deepseek-tui.md。

### 2.2 整体长相：双二进制 + 全屏 TUI

- **架构**：`deepseek`（dispatcher CLI，分发器）→ `deepseek-tui`（伴生 TUI 二进制）→ Ratatui 界面 ↔ 异步引擎 ↔ OpenAI 兼容流式客户端。另有 `codewhale exec`（无界面跑单任务，给脚本/CI 用）、`codewhale web`（本地浏览器客户端）、`codewhale review --pr N`（GitHub PR 评审）、app-server（本地 HTTP API）、ACP（Agent Client Protocol，给 Zed 等编辑器用）。终端、网页、桌面、Runtime API 共用同一个引擎。
- **主界面**（仓库 README 截图说明）：“终端里的 Codewhale 完成一个演示任务后，报告它给 export.py 加了 --json flag、3 个本地测试全部通过、一次委派评审没有发现问题；下方任务清单显示三个已完成步骤，状态行显示 Full Access 与当前 provider。”——也就是说：**对话流 + 任务清单 + 状态行**，三段式，和 Claude Code 同构。
- **启动**：在 git 仓库根目录运行 `codewhale`；首次启动没有 key 时，发第一条消息时会问用哪个 provider（DeepSeek 默认），也可以接本地 Ollama 模型。`/provider`（或 F3）切换 provider，`/model` 切换模型，`/model auto` 每轮自动选模型，`/turn inspect` 查看某轮用的模型、成本与耗时。

### 2.3 颜色字体与信息层级

- **配色**：公开资料里没有像 Claude Code 那样成文的品牌色板。界面以终端默认前景/背景色为主，状态行用少量颜色区分模式与权限。**没有花哨的配色方案**——它的“好看”主要来自排版和信息层级，不是颜色。
- **字体**：同样继承终端字体。Rust + Ratatui 的渲染对 CJK 宽字符（中文占 2 格）有明确处理，这对中文用户很重要。
- **信息层级**（从强到弱）：
  1. 当前任务与结论（对话流正文）
  2. 任务清单（todo 式，三个步骤打勾）
  3. 状态行（权限模式 Full Access / Ask / Auto-Review + provider + 模型）
  4. 成本（footer 与 `/cost` 显示本会话花费；**不知道的价格显示为 unknown，绝不显示为免费**——这是个值得抄的诚实细节）

### 2.4 工具调用、思考与审批

- **流式思考**：模型的推理过程直接流式显示进终端——模型怎么分析问题、走哪条路、有没有改变主意，实时可见。思考块是实时渲染的，不是等想完再一次性贴出来。
- **工具**：读/写文件、跑 shell、搜网、管 git、派 sub-agent、接 MCP、装 Skills，和 Claude Code 基本同一套。
- **审批**：只读命令直接跑；其他 shell 命令每次先问：`y` 跑一次、`a` 本会话内同类命令都放行、`n` 拒绝。`/undo` 撤回上一轮请求及其文件改动；`/receipts`（或退出后 `codewhale receipts --last`）列出会话改了哪些文件、跑了哪些命令、调了哪些 web/MCP、派了哪些 agent、每次审批是谁批的、哪些失败了；`/restore` 回滚整个工作区到早期的快照（会覆盖后续编辑，需要 `/trust on` 或 Full Access）。
- **自动模式**：auto mode 每轮自动选模型与思考强度（thinking level）。
- **沙箱**：macOS 用 Seatbelt、Linux 用 bubblewrap（装了才有）、Windows 暂无 OS 沙箱；沙箱内 shell 与终端会话读不到 `~/.ssh`、`~/.aws`、`.env` 等凭据。

### 2.5 动效与反馈：模式切换是亮点

- **Tab / Shift+Tab 是核心交互**：输入框为空时按 `Tab` 切换模式——Plan（只读不改）、Work（改文件跑命令）、Operate（和 Work 同权限，一直干到目标验证通过或需要你介入）；`Shift+Tab` 切换权限——Ask（默认，文件编辑直接改、非只读 shell 命令先问）、Auto-Review（规则 + 评审模型代批常规调用、高风险拒绝）、Full Access（不问，沙箱关闭）。0.10.3 预告：Shift+Tab 将变成一个统一旋钮（Ask → Accept Edits → Plan → Auto-Review → Full Access），Tab 不再切换模式，Operate 退役，默认改为 Accept Edits。
  - 这个设计的妙处：**权限不是藏在设置里的一个开关，而是输入框旁边一个随时能拨的旋钮**，状态行常驻显示当前档位。
- **成本与缓存诚实**：成本估算带 prefix-cache 提示；多开 sub-agent 时缓存命中率难保证，会直说（“未缓存 token 的价格是缓存的 10 倍”这个提醒直接写在报道里）。
- **遥测默认开**（只发聚合计数：版本、平台、会话时长与结果、用过哪些内置 provider、功能与错误计数，随机安装 ID 每 90 天轮换；不发对话、prompt、模型名、文件/仓库名、凭据），可用 `codewhale config set telemetry false` 关掉。——这是个**反面教材**：默认开遥测在我们的产品里不要学。

### 2.6 好在哪：提炼

1. **Rust 原生 + 单二进制发行**：`npm install -g codewhale` / `cargo install` / winget / Homebrew / 预编译包（Linux/macOS/Windows x64+arm64），装完就能跑，不依赖 Node 运行时。这是它能做到 41k star 的发行基础。
2. **“DeepSeek 优先”但不锁死**：默认 DeepSeek，40+ provider 内置，任何 OpenAI 兼容端点都能接，本地模型走 Ollama/vLLM/SGLang。先解决主要用户（DeepSeek 用户），再扩展。
3. **可撤销性做进了产品骨子里**：`/undo`、`/receipts`、`/restore` 三件套，工具调用的每一步都有据可查、可以反悔。这比单纯“好看”更能建立信任。
4. **成本诚实**：不知道的价格显示 unknown 不显示免费；缓存命中率直说。符合我们“不要假数据”的铁律。
5. **模式旋钮**：权限与模式是随时可拨的旋钮 + 状态行常驻，不是设置页里的死选项。

### 2.7 渲染层：Rust + Ratatui

- **渲染框架是 Ratatui**（Rust 的 TUI 库），不是 Ink、不是自研。双二进制架构（dispatcher + TUI）让界面与引擎解耦。
- 这对我们是最有参考价值的一点：**Ratatui 已经被验证可以做出 41k star 的好看 TUI**，而且是在 Windows/macOS/Linux 三端都发行的前提下。我们的后端已经是 Rust，选 Ratatui 几乎是零新增语言成本。

---

## 3. 第二参考 B：dsh TUI（DeepSeek Harness 的 TUI）——用户说的“dsh tui”

### 3.1 身份确认：dsh = DeepSeek Harness，一簇 TUI，不是只有一个

- **dsh 是 DeepSeek 官方的 agent harness CLI**：`@deepseek-ai/dsh`（npm），MIT 开源，插件化架构（Cordis），自带 web 界面与 headless 单次模式，但**官方默认不带交互式终端界面**——终端界面是后配的，有官方版和多个社区版。
- 所以用户说的“dsh tui”大概率是下面其中之一（按出名程度排序）：
  1. **ccch1mneyyy/dsh-TUI**（最出名，像素鲸鱼顶栏）——DSH 官方公众号收录为“内测用户精选插件”，多个榜单称为“DSH 官方首推的 TUI 插件”。**用户说的很可能就是这个。**
  2. **官方 `@deepseek-ai/dsh-tui`**（deepseek-harness-cli 仓库 `packages/ui/tui`）——基于 pi-tui 的 Claude Code 风格欢迎卡 + 盲文鲸鱼。
  3. 其他社区版：tomowang/dsh-tui、Lingxi-AI-cn/dsh-tui-plugin、nexlineai/dsh-tui、fan56/dsh-tui-pi（pi 风格，20+ 主题）、songqikong/dash（零依赖原生 ANSI 单文件）、papachong/deepseek-harness-tui（OpenTUI + SolidJS）。
- **本节主拆 ccch1mneyyy/dsh-TUI**（用户最可能看到的那个），官方 dsh-tui 与 dash 作为对照补充。

来源：dshhub.dev、dsh.plus、dshplugin.store、awesome-dsh-plugins 各榜单；github.com/ccch1mneyyy/dsh-TUI（README，2026-11-13 读取）；github.com/peiyuwang54/deepseek-harness-cli/blob/HEAD/packages/ui/tui/README.md。

### 3.2 整体长相：像素鲸鱼 + Launchpad + 时间线轨

**ccch1mneyyy/dsh-TUI 的布局（全屏，alternate screen）：**

```
┌──────────────────────────────────────────────────────┐
│  🐋 像素鲸鱼顶栏（吉祥物，会动；点一下会醒）            │
│  实时工作状态行（模型 / 努力程度 / 上下文 / TPS）        │
├──────────────────────────────────────────────────────┤
│  对话流（流式 Markdown、工具卡、思考流式展开）          │
│  ◀ 时间线轨（每轮可点击跳转）                          │
├──────────────────────────────────────────────────────┤
│  输入框（/ 与 @ 补全、#L12-14 行号引用、历史搜索）       │
│  状态栏：上下文进度条 + TPS 仪表 + 缓存命中率 + token   │
├──────────────────────────────────────────────────────┤
│  侧栏（Ctrl+B，8 个内置面板，可拖拽分隔线调宽）         │
└──────────────────────────────────────────────────────┘
```

- **像素鲸鱼（pixel whale）是它的吉祥物**：启动时三种开场介绍（intro），点一下会醒；接到第一个任务后就定住不动了（freezes after the first task）。——和 Claude Code 的像素小兽、我们的诺玛球是同一个设计母题：**终端里也要有一个“活物”**，但只在开场时活，干活时不抢戏。
- **Launchpad 与首次向导**：每次普通启动都落在 landing page 上，有一个**真正的输入框**（大字 + 鲸鱼 + 快捷操作）；首次运行走四步向导（账号与模型 / 语言+主题 / 模型+工作区 / 快捷键），随时可用 `/setup` 重跑。`/settings` 里 `launchpad` 关掉可直接进聊天。
- **时间线轨（Timeline rail）**：每一轮都可点击，时间线 / 滚动条 / 隐藏 gutter 三种形态。
- **侧栏**：Ctrl+B 把聊天劈开一个面板列（终端够宽时），拖分隔线调宽；8 个内置面板默认全开；窄终端与 inline 模式下改用全屏面板。
- **官方 dsh-tui 的欢迎卡**：新会话打开时是一张自适应分栏欢迎卡（Claude Code 启发，但不抄 Claude 的文案与素材）：左栏是“欢迎”+ DeepSeek 官方鲸鱼 SVG 渲染成的**盲文点阵图**（Braille-cell raster，鲸鱼继承终端前景色，浅色终端是黑色、深色终端也清晰）；右栏列出真实的 Harness 入口与最近两个会话。——**盲文点阵是终端里画吉祥物的标准做法**，Claude Code 的像素画、dsh 的盲文鲸鱼、我们的球都可以走这条路。

### 3.3 颜色字体与信息层级

- **主题**：`/theme` 切换 auto / light / dark / dark-ansi，支持自定义 JSON 主题。dsh-tui-pi 版有 20+ 内置主题（10 亮 + 10 暗）+ 用户主题目录自动发现。
- **标志性视觉**：**蓝白上下文进度条 + TPS 仪表**。上下文进度条是蓝白两色分段填充，填充比例跟后端占用走，颜色估算内容构成；TPS（每秒 token 数）仪表常驻。——这是 dsh-TUI 最容易被记住的视觉特征，也是它“可观测性”哲学的体现。
- **信息层级**：对话流永远是主角；状态（模型、上下文、TPS、缓存命中率、token、会话成本含 subagent、Git 与会话元数据）全部挤在状态行与进度条里，不进对话流。思考与工具活动在 dsh-tui-pi 版里甚至**不进 transcript**，单独放 Think 与 Tool 面板，对话保持干净。
- **字体**：继承终端字体；中英双语 UI（`/lang` 切换）。

### 3.4 工具调用与 Diff

- **工具卡**：结构化工具卡（流式 Markdown 里嵌卡片），`/` 与 `@` 补全、`#L12-14` 行号引用。nexlineai 版的描述最具体：盒线绘制的 `⏱ bash` 方块，生命周期标记（`● running → ✓ done / ✖ error`）+ 参数/结果预览。
- **Diff**：**分栏 diff 卡**——单边增删（只有加行或只有删行）时给整段全宽，不留空的对侧 pane；普通编辑左右分栏；混合文件在折叠或流式展开前分别选布局。——这个细节值得抄：分栏 diff 最常见的丑就是一边空着，dsh-TUI 直接按内容选布局。
- **官方 dsh-tui**：渲染默认用 inline 终端 scrollback（终端自己管滚轮与拖拽选择），键盘 Up/Down 仍是输入框历史导航；编辑器保留 pi-tui 的硬件光标标记作为终端 IME 锚点，并以 530ms 交替一个单格软件光标，焦点始终可见。

### 3.5 动效与反馈：可观测性拉满

- **实时工作状态行**：活动动画、上下文进度条、TPS、缓存命中率、努力程度、token、会话成本（主任务 + subagent）、Git 与会话元数据。标题、轨迹条、会话状态动画独立于 transcript 更新，空闲或失焦时暂停。
- **双击 Esc 时间回溯**：空闲时双击 Esc 发起会话 rewind / fork，回到更早的会话状态。——和 Claude Code 的双击 Esc rewind 菜单同源。
- **通知**：一个开关覆盖四种系统通知（任务完成、等你审批工具、等你回答问题、等你评审计划），任务完成标题 “dsh-TUI · Task complete”，正文是最新回复的单行纯文本摘要（去 Markdown，最多 200 字符）；走 OSC 777/9，Windows 上是原生 toast。
- **原生光标**：聚焦的输入框继承终端自己的光标形状、颜色、闪烁与动画/拖尾效果（inline 与全屏模式都一样）；`/model` 选择器里光标跟随移动，静止 0.5 秒后隐藏。
- **图片**：Kitty/Sixel 缩略图、居中预览可缩放平移、粘贴时适配、文本回退；Mermaid 代码块画成 Unicode 图；LaTeX 公式画成 Unicode 文本。
- **长会话优化**：事件驱动投影、差分终端输出、布局级虚拟化，避免渲染成本与内存随会话无限增长。
- **dash（songqikong/dash，另一个极端参照）**：零依赖原生 ANSI 渲染、整个插件只有一个 `index.ts` 文件；差分渲染只重绘变化的行；kitty 键盘协议（CSI-u）逐键精确、SGR 鼠标支持、alternate screen + 隐藏硬件光标。状态栏是 omp 风格双行：A 行（输入框上方：`⬢ model · preset · ◉ thinking effort · in/out tokens`）、C 行（输入框下方底行：活动 spinner + 工具名 / 模型自报工作 / 回合统计、排队、状态提示、`/help`），两行都有主题背景色带，左右分段平衡，右侧带 TPS 火花线、缓存命中率、会话耗时、上下文窗口指示器（10 格条）、git 分支 / cwd / 会话标题。开场是 omp 风格欢迎屏：尖角单列框（无圆角元素、全部居中）+ 粗体 DASH 字标（ANSI Shadow art）+ 模型/provider + Tips 块 + 当前 agent preset（高亮）+ 最近会话（带相对时间）。

### 3.6 好在哪：提炼

1. **吉祥物 + 仪式的组合拳**：像素鲸鱼（启动时活、干活时定住）+ Launchpad（大字 + 鲸鱼 + 快捷操作）+ 四步向导。开场 3 秒就把“这是一个有性格的产品”立住了，之后全程克制。
2. **可观测性是第一公民**：上下文进度条、TPS 仪表、缓存命中率、成本估算——用户不用翻日志就知道“模型在想什么、上下文用了多少、token 花在哪里”。这是它相对 Claude Code 最大的差异化（Claude Code 的状态栏相对素）。
3. **信息分层干净**：对话流只放对话；状态全进状态行与侧栏；思考与工具活动可以不进 transcript。长会话不乱。
4. **Diff 布局按内容选**：单边增删全宽、普通编辑分栏——小决策，大体验。
5. **原生感**：光标、滚轮、选择、通知全部用终端原生的，不自己造一套。用户在终端里有肌肉记忆，顺着它做。

### 3.7 渲染层：一簇项目，四条路线（最有价值的对照）

dsh 生态里同一个需求（给 DSH 做终端界面）同时存在四条渲染路线，是选型时最好的天然实验场：

| 项目 | 渲染路线 | 特点 |
|---|---|---|
| ccch1mneyyy/dsh-TUI（最出名） | **Ink / React**（移植版 Ink core） | 生态最成熟，组件化开发最快；性能上限就是 Ink 的上限 |
| 官方 @deepseek-ai/dsh-tui | **pi-tui**（Pi agent 的 TUI 库） | React 风格，inline scrollback 优先，硬件光标 |
| papachong/deepseek-harness-tui | **OpenTUI + SolidJS** | Zig 原生渲染核 + Bun FFI，无 FPS 上限，内置 Yoga 与 useTimeline 动画；但**需要 Bun 运行时，尚无 Windows 原生路径** |
| songqikong/dash | **零依赖原生 ANSI**（单文件 TS） | 完全自己写差分渲染；零依赖、启动最快，但所有轮子自己造 |
| fan56/dsh-opentui | OpenTUI + Solid | 同上 OpenTUI 路线 |

**结论**：没有哪条路线是“唯一正确”的——Ink 赢在生态与开发速度，OpenTUI 赢在性能上限，原生 ANSI 赢在零依赖与可控，pi-tui 赢在与 Pi 生态的复用。选型要看团队的语言栈、发行目标与性能需求，而不是看谁最时髦。

---

## 4. 综合对照：三者共同的好设计、各自的长处、我们的取舍

### 4.1 三者共同的好设计（抄这 7 条，错不了）

| # | 共同点 | Claude Code | DeepSeek-TUI / Codewhale | dsh-TUI |
|---|---|---|---|---|
| 1 | **三区固定布局** | 对话区 / 输入框 / 状态栏 | 对话流 / 任务清单 / 状态行 | 对话流 / 输入框 / 状态栏 + 侧栏 |
| 2 | **开场有吉祥物 + 仪式** | 像素小兽 + Welcome back | （弱，无吉祥物） | 像素鲸鱼 + Launchpad + 四步向导 |
| 3 | **工具调用一行一件事** | `⏺` / `⎿` 行语法 | 任务清单 + 流式思考 | 结构化工具卡 + 生命周期标记 |
| 4 | **状态栏常驻关键信息** | 模型/上下文/模式 | 权限模式/成本 | 上下文进度条/TPS/缓存命中率 |
| 5 | **思考指示有生命感** | 6 帧星号 + 184 动词 | 流式思考实时可见 | 活动画 + 思考流式展开 |
| 6 | **颜色克制** | 一主色橙 + 灰阶 | 终端默认色为主 | 蓝白两色为主 |
| 7 | **可撤销 / 可追溯** | rewind 菜单、转录视图 | /undo、/receipts、/restore | 双击 Esc 回溯、会话管理 |

### 4.2 各自的长处（只抄长处，不抄全套）

- **Claude Code 的长处**：信息分层的教科书（默认一行摘要、展开才有详情）；工具调用的“人话”语法（`⏺`/`⎿`、友好名、语义渲染）；思考指示的性格（动词轮换）；渲染层的性能投入（60fps 流式不闪烁）。**最值得抄的是前三条，第四条按需投入。**
- **DeepSeek-TUI / Codewhale 的长处**：Rust 单二进制发行（装完就能跑）；权限/模式做成随时可拨的旋钮（Tab/Shift+Tab）+ 状态行常驻；成本与缓存的诚实（unknown 就写 unknown）；可撤销三件套（/undo、/receipts、/restore）。**最值得抄的是旋钮 + 诚实 + 可撤销。**
- **dsh-TUI 的长处**：吉祥物与开场仪式最完整（像素鲸鱼 + Launchpad + 向导）；可观测性最强（上下文进度条 + TPS 仪表 + 缓存命中率）；Diff 布局按内容选（单边全宽）；原生感（光标、滚轮、选择、通知全用终端原生的）。**最值得抄的是开场仪式 + 可观测状态栏 + Diff 布局。**

### 4.3 各自的短处 / 我们不学什么

- **Claude Code 不学**：① MCP 调用完全没有工具行（藏得太干净，信任感打折）；② 品牌橙 + 像素小兽是它自己的身份，我们不照搬颜色与吉祥物；③ 自研渲染 fork 的投入量级，现阶段不学（见 §5.1）。
- **DeepSeek-TUI 不学**：① 遥测默认开启（我们的产品默认不开遥测；要开也必须明确告知 + 一键关）；② 0.10.x 之前模式与权限是两个键（Tab/Shift+Tab）分开拨，容易按错——我们做成一个统一旋钮；③ 没有吉祥物与开场仪式（太素，缺性格）。
- **dsh-TUI 不学**：① 状态栏信息过载的倾向（TPS、缓存、成本、Git、会话元数据全挤在状态行，窄终端下会糊）——我们要做减法，只留 5–6 个字段；② 插件生态碎片化（同一个需求五六个实现，用户要自己挑）——我们只做一个官方 CLI，不搞插件市场；③ 像素鲸鱼是 DeepSeek 的鲸鱼，我们不抄鲸鱼；我们的 CLI 吉祥物是新设计的像素角色（不是球），见 §5.3。

---

## 5. 卡塞尔 CLI 对照设计方案（可落地）

> 设计前提（来自桌面端已定版的事实，不再讨论）：NORMA = 通用工作、EVA = 工程开发；思考强度 Low/Medium/High/XHigh/Max 独立；ULTRACODE 是独立开关；用户在产品内是路明非，称路专员，编号 S2017-0117、血统 S 级；诺玛与 EVA 是同一智能中枢的两种性格，EVA 为蓝色；前端最高优先级；grokbot 动效语言是美术圣经；铁律：不要线框感、不要金色、不要照片/位图、不要假数据、任何功能都必须有平滑过渡、整个应用都要有生命感。

### 5.1 技术选型：Rust + Ratatui（明确建议，不含糊）

**决定：用 Rust + Ratatui 做卡塞尔 CLI 的渲染层。不要 Ink、不要 Bubble Tea、不要 OpenTUI、现阶段不要自研。**

| 候选 | 结论 | 理由 |
|---|---|---|
| **Ratatui（Rust）** | ✅ **选它** | ① 我们的后端已经是 Rust（Tauri agent.rs），同一语言、同一进程，agent 循环可以直接复用，不用再起一个 Node/Bun 运行时；② 已被验证能做出 41k star 的好看 TUI（Codewhale/DeepSeek-TUI 就是 Ratatui）；③ crossterm 的 Windows 支持是一线的（Windows Terminal + ConPTY），符合我们 Windows 优先；④ 没有 Ink 的 30–32fps 硬上限，帧率自己掌控；⑤ 单二进制发行，和桌面端安装包的思路一致 |
| Ink（TS + React） | ❌ 不选 | ① 要带 Node 运行时，发行变重（桌面端是单文件安装包，CLI 不应反过来变重）；② 性能上限就是 Anthropic 当年被迫 fork 的原因——用 Ink 起步等于预定了一次重写；③ 我们的团队语言栈是 Rust + TS/React（前端），Ink 的 React 经验复用有限，因为终端组件与 DOM 组件不是一回事 |
| Bubble Tea（Go） | ❌ 不选 | ① Go 是第三种语言，团队要多维护一条工具链；② 相对 Ratatui 没有可感知的优势（OpenCode 当年用 Bubble Tea，后来也迁走了）；③ Windows 支持不如 crossterm 成熟 |
| OpenTUI（Zig 核 + Bun） | ❌ 不选 | ① 强制 Bun 运行时（`bun:ffi`），Node 跑不了；② **尚无 Windows 原生路径**（官方文档与评测一致），我们 Windows 优先，直接出局；③ 生态还年轻，API 不稳定 |
| 自研渲染引擎 | ❌ 现阶段不做 | ① Claude Code 的 fork 是被 60fps 流式 + 超长会话逼出来的，我们 v1 没有这个量级的问题；② 投入是数月级专人投入，回报在 v1 几乎不可见；③ 正确姿势是抄 Anthropic 的顺序：先用成熟框架起步，实测到瓶颈再 fork |
| 原生 ANSI（零依赖） | ❌ 不做主选 | dash 证明了单文件也能做好看，但所有轮子（布局、diff、鼠标、宽字符）都要自己造；省下的依赖会变成数倍的维护成本。只在“极简模式”（`--plain`，管道/脚本场景）下用纯文本输出 |

**投入产出比**：Ratatui 方案，1 个人、2–4 周可以做出 v1 可用的三区布局 + 工具行 + 状态栏 + 开场仪式；自研渲染方案，同样的人要 2–4 个月，而且 v1 用户感知到的差异几乎为零（颜色、排版、信息分层才是用户看得见的东西）。**先把设计层做到位，渲染层只做到“不闪烁、不撕裂、不卡顿”就够了。**

**演进路线（写进架构里，现在就留好口子）**：
1. v1：Ratatui + crossterm，渲染逻辑与业务逻辑分层（view 层只依赖一个窄的 `Renderer` trait，不直接调 crossterm 细节）。
2. v2（如果需要）：在 Ratatui 之上加自己的差分输出优化（只重绘变化的格子、合并相邻写入、DEC 同步输出），抄 Claude Code fork 的优化清单，但不动框架。
3. v3（只有当实测证明 Ratatui 成为瓶颈时）：fork 或自研渲染核。是否走到这一步，由实测帧率与长会话内存数据决定，不由感觉决定。

### 5.2 布局：三区 + 状态行双行

```
┌─────────────────────────────────────────────────────────┐
│ 状态行 A（输入框上方，dim 色）：                           │
│   ◉ NORMA · deepseek-flash · High · 上下文 23% · main ●   │
├─────────────────────────────────────────────────────────┤
│ 对话区（主角，占 70%+ 高度）：                             │
│   ❯ 帮我把登录接口的超时改成 5 秒                          │
│   ⏺ Read(src/api/auth.ts)                                 │
│   ⎿ Read 128 lines                                        │
│   ⏺ Edit(src/api/auth.ts)                                 │
│   ⎿ Updated 2 lines                                       │
│   已改好：超时从 3 秒改为 5 秒，本地测试通过。               │
├─────────────────────────────────────────────────────────┤
│ 输入框（`>` + 边框，上方一条 ─）：                          │
│   > │                                                     │
├─────────────────────────────────────────────────────────┤
│ 状态行 C（底行，常驻）：                                    │
│   ✻ 思考中… (8s · ↓ 312 tokens) · esc 中断 · / 帮助        │
└─────────────────────────────────────────────────────────┘
```

- **三区固定**：对话区 / 输入框 / 状态栏，和 Claude Code 同构。状态行拆成 A（输入框上方，放身份与上下文）与 C（底行，放进行态与提示），抄 dash 的双行状态栏做法。
- **不要侧栏**（v1）：dsh-TUI 的 Ctrl+B 侧栏很好，但 v1 先不要。侧栏是 v2 的东西，先把主线做扎实。
- **窄终端降级**：宽度 < 80 列时，状态行 A 只留“◉ NORMA · 模型”，其余字段进 `/status` 查看；Diff 自动从分栏切回统一格式。

### 5.3 吉祥物怎么进终端：像素角色，不是球

用户 2026-11-13 定：**CLI 的吉祥物不直接用诺玛球**——“我们单纯一个球太丑了”。跟 Claude 的像素小怪兽和像素鲸鱼比，plain 的球没有角色感、没有魅力。**桌面端的球不动，只改 CLI。**

所以 CLI 的吉祥物是一个**新设计的像素风角色**（像素版诺玛/小专员），要有角色感、有表情、有小动作，像 Claude 的像素小怪兽和像素鲸鱼那样有魅力。画法用终端字符（盲文点阵 / 半方块 / ASCII 像素画），约 8–12 行高，继承终端前景色。

**三种出现形态（按出现频率排序）：**

**形态一：状态行小标记（常驻，每时每刻都在）**
- 状态行 A 最左侧仍放一个单字符 `◉` 作人格标识：NORMA 用 `◉`（白色），EVA 用 `◉`（蓝色，终端里用 EVA 蓝 `#60a5fa` 着色）。但它只是状态指示，**不是吉祥物本体**。
- 球的状态用球后面的一个小字表示，不改球本身：`◉ 思考中` / `◉ 工作中` / `◉ 已完成` / `◉ 待命`。不要让球本身闪烁——状态行要稳。
- 切换 NORMA/EVA 时，球的颜色与名字一起变（白 ↔ 蓝），并在对话区插一行轻提示：`── 已切换到 EVA（工程开发）──`。

**形态二：欢迎屏像素角色（开场仪式，见 §5.5）**
- 开场时像素角色登场：眼睛睁开、打招呼，是开场的“活物”。
- 画法抄官方 dsh-tui 的盲文鲸鱼与 Claude Code 的像素画：点阵继承终端前景色。
- **必须在 Windows Terminal 实测**：盲文字符在某些字体下宽度不一致，画之前先做宽度自检，画坏了就回退到字符画。

**形态三：思考中的角色（进行态）**
- 思考/工作时，状态行 C 的 spinner 不用 Claude Code 的星号，**用像素角色的眼睛/表情做 spinner**：眨眼、张望，约 400ms 一帧。既是状态指示，也是角色在“活着”。
- 配一句 NORMA/EVA 口吻的进行时文案（抄 Claude Code 的动词轮换，但用我们自己的词库）：
  - NORMA：`正在想想看…` / `让我看一下…` / `稍等，我在找…`
  - EVA：`正在拆解…` / `扫描中…` / `定位问题…`
  - 格式：`◉ 正在想想看… (8s · ↓ 312 tokens · esc 中断)`。

**设计待定**：像素角色的具体长相（像素版诺玛加身体，还是一个独立的小角色）需要单独的设计稿，不在本拆解里定。原则：有角色感、有表情、克制、不抢戏、不抄鲸鱼也不抄 Claude 的小兽。

### 5.4 状态栏放什么：两行，6 个字段，禁止超载

| 行 | 字段 | 说明 |
|---|---|---|
| A（输入框上方） | `◉ NORMA/EVA` | 当前人格 + 球，白/蓝区分 |
| A | `模型` | 如 deepseek-flash；没配 Key 时显示 `未配置`，绝不显示假模型 |
| A | `思考强度` | Low/Medium/High/XHigh/Max |
| A | `上下文 23%` | 用量百分比；超过 80% 变黄色提醒，超过 95% 变红色 |
| A | `main ●` | git 分支 + 是否干净（● 有未提交改动） |
| C（底行） | 进行态 | spinner + 动词 + 用时 + token + `esc 中断`；空闲时显示 `输入 / 查看帮助，esc 退出` |
| C | `成本` | 本会话花费（¥0.12）；不知道的价格写 `未知`，绝不写免费（抄 Codewhale） |

- **禁止**：不要把 TPS、缓存命中率、subagent 数全塞进状态行（dsh-TUI 的过载倾向）。TPS 与缓存命中率进 `/status` 详情页。
- **ULTRACODE 开关**：状态行 A 用一个小标记表示，如 `ULTRA` 亮起时显示 `◆ ULTRA`，关掉时不显示。

### 5.5 开场仪式：1 秒，三帧，可跳过

抄 Claude Code 的像素吉祥物 + dsh-TUI 的 Launchpad，但压缩到 1 秒（桌面端 20 秒是故意设计的，终端里 1 秒就够了）：

```
第 0.0s：  CASSELL COLLEGE（小字，dim 色）
           （像素角色淡入，眼睛闭着）
第 0.4s：  像素角色的眼睛睁开
           欢迎你，路专员
第 0.8s：  S2017-0117 · NORMA · deepseek-flash · 上下文 0%
           > （输入框就绪，光标闪烁）
```

- 任意按键跳过；`--no-splash` 可永久关闭（设置里留开关，和桌面端启动动画开关同一逻辑）。
- 首次运行（没有 provider 配置）：开场后进四步向导（抄 dsh-TUI）：① 选 provider 与模型 ② 语言 + 主题 ③ 工作区 ④ 快捷键。向导只在首次运行出现一次。
- 空会话的欢迎卡：左栏是像素角色 + “欢迎你，路专员”，右栏是最近两个会话 + 常用入口（`/resume`、`/new`、`/model`、`/help`）。抄官方 dsh-tui 的分栏欢迎卡结构，不抄它的文案。

### 5.6 工具调用与 Diff：沿用哪套

**工具调用：Claude Code 的行语法为主，dsh-TUI 的卡片为辅。**

```
⏺ Read(src/api/auth.ts)              ← 默认只占一行，工具名加粗，路径可点（OSC 8）
⎿ Read 128 lines                     ← 结果一句话，人话
⏺ Edit(src/api/auth.ts)
⎿ Updated 2 lines
```

- 默认一行，展开（Enter 或 Ctrl+O）才看详情卡片（参数摘要 + 关键输出行），卡片样式抄 dsh-TUI 的盒线卡片 + 生命周期标记（`● running → ✓ done / ✖ error`）。
- 规则（直接抄 Claude Code，逐条都是已验证的）：
  - 工具名加粗，参数只放最关键的一个；**不要 raw JSON**。
  - 只读工具聚合：`⏺ Searching for 1 pattern, reading 2 files…` → 结束后收成 `Read 1 file, ran 1 shell command`。
  - 友好名：Edit → Update，Glob/Grep → Search。
  - 失败给红色短标签，完整错误只在转录视图里。
  - **不要学 Claude Code 藏 MCP 调用**：我们的 MCP/子代理调用也要有一行，写清楚调了谁、干了什么。
  - shell 命令按语义渲染（如 `sed -n '1,200p'` → `Read file (lines 1-200)`）。
  - 一连串工具调用依次出现（stagger 60–80ms），不要一堆同时砸出来（桌面端灵动性要求在终端里同样适用）。
- 工具图标：每种工具配一个固定符号（Read `⏺`、Edit `✎`、Bash `⌘`、Search `⌕`），执行中与完成态用颜色区分（执行中 EVA 蓝、完成灰、失败红）。

**Diff：统一格式为主，宽屏分栏为辅。**

- 默认统一格式（unified diff），红/绿配色，带行号栏，无盒子边框；被删行不做语法高亮（抄 Claude Code）。
- 终端宽度 ≥ 120 列时自动切分栏 diff（左右对照），抄 dsh-TUI 的布局选择：**单边增删（只有加行或只有删行）给全宽，不留空 pane**；普通编辑左右分栏。
- 折叠形态：`2 files +3 −1`。
- 审批：diff 显示后给 Yes/No 选项卡（Left/Right 切换，Tab 加评论），抄 Claude Code 的权限对话框。

### 5.7 思考 / 状态指示

- **进行时**：`◉ <动词>… (<用时> · <token 方向与数量> · esc 中断)`，动词用我们自己的词库（NORMA 温和、EVA 锋利，见 §5.3），每回合随机一个。
- **等待态**：20 秒无数据出现一行 dim 色提示 `等待模型响应…`；重试显示 `重试中（第 N 次）…`。
- **回合结束**：一行过去时总结，如 `◉ 想了 8s · 用了 312 tokens`。
- **中断**：Esc 后显示 `已中断 · 要让诺玛改做什么？` 回到输入框。
- **不要三个跳动圆点**：grokbot 设计语言明确拒绝，我们也拒绝。

### 5.8 颜色与字体

- **深色主题默认**（桌面端同款），浅色主题跟随终端背景自动判断（`auto`）。
- **强调色**：EVA 蓝（深色 `#60a5fa` / 浅色 `#2563EB`），只用在：球（EVA 态）、进行中的工具行、链接、焦点。NORMA 态用白色球 + 灰阶。
- **配色上限**：白、灰（3 档）、EVA 蓝、绿（成功）、红（失败/警告）、黄（提醒）。**不要金色**（桌面端铁律，终端同样遵守）。
- **字体**：继承终端字体，不自带；Windows Terminal 默认 Cascadia Mono / 新版 Cascadia Code 都能正常显示 `⏺ ⎿ ● ✓ ✗ ◐ ⠋` 等符号；**上线前必须在 Windows Terminal + ConPTY 实测每个符号的宽度**，显示异常的符号换掉（不要假设所有终端都支持）。
- **中文**：CJK 宽字符按 2 格算（Ratatui 自带 Unicode 宽度处理），状态栏字段按显示宽度截断，不按字节截断。

### 5.9 输入框与交互（快捷键对齐 Claude Code 的常用子集）

| 按键 | 作用 |
|---|---|
| Ctrl+C | 中断 / 清空输入 |
| Ctrl+D | 退出（第一下提示，第二下退出） |
| Esc | 中断；Esc+Esc 打开 rewind（回到更早的轮次） |
| Shift+Tab | 切换权限模式（Ask → Accept Edits → Plan → Full Access，一个旋钮） |
| Tab（输入框为空） | 切换 NORMA / EVA |
| Ctrl+O | 转录视图（时间戳、模型、展开折叠行） |
| Ctrl+R | 反向搜索历史 |
| Ctrl+L | 重绘 |
| Ctrl+T | 任务清单（本轮 todo） |
| Ctrl+V | 粘贴图片（终端支持时转为 `[Image #N]` 芯片；不支持时提示） |
| Up/Down | 历史 |
| `/`、`!`、`@` | 命令菜单 / shell 模式 / 文件提及 |
| `?` | 快捷键帮助 |

- **不要照搬全部**：Claude Code 的快捷键有 20+ 个，我们 v1 只要上面这张表（15 个左右），其余进 `/help`。
- **命令补全**：幽灵文本 + `+2` 计数，Tab 接受（抄 Claude Code）。
- **排队**：排队消息灰色显示 + `ctrl+enter 立即发送` 提示。

### 5.10 权限与信任（照搬桌面端铁律）

- **审批对话框**：拟议改动 + Yes/No 选项卡，Left/Right 切换，Tab 加评论。写操作先批后做，读操作直接跑。
- **成本诚实**：状态行 C 显示本会话花费；不知道的价格写 `未知`，绝不写免费；缓存命中情况在 `/status` 里直说。
- **绝不假数据**：没配 Key 的服务商不显示模型、不显示假连接、不显示假掩码、不显示假时间；空状态就是空状态，欢迎卡上写清楚“还没有配置模型，按 /provider 开始”。
- **可撤销**：`/undo` 撤回上一轮改动；`/receipts` 查看本会话所有改动与审批记录（抄 Codewhale）。

### 5.11 明确不做的清单（v1 不做）

- 不做侧栏（Ctrl+B 面板，v2 再说）。
- 不做插件市场（只做一个官方 CLI）。
- 不做图片渲染（Kitty/Sixel，Windows 优先的前提下不值得）。
- 不做 20+ 主题（只做 dark / light / auto 三个，跟桌面端一致）。
- 不做遥测（默认不开；如果以后要开，必须明确告知 + 一键关闭）。
- 不做自研渲染（见 §5.1）。
- 不做 MCP 调用的隐藏（每一次调用都要有一行）。

### 5.12 落地路线（三个阶段）

- **M1 骨架（2 周）**：Ratatui 三区布局 + 输入框 + 状态行 A/C + `⏺`/`⎿` 工具行 + 统一 diff + 基础快捷键 + 接入现有 Rust agent 循环（复用 agent.rs）。验收：在 Windows Terminal 里跑一轮真实任务不闪烁、不崩溃。
- **M2 体验（2 周）**：开场仪式（盲文球 + 欢迎）+ 球的三种形态 + 思考动词轮换 + 工具卡展开 + 审批对话框 + `/undo`、`/receipts` + 成本显示 + 首次运行向导。验收：找 3 个人盲测，问“像不像一个活的产品”。
- **M3 打磨（1–2 周）**：窄终端降级、分栏 diff、转录视图、rewind、性能测试（长会话 500+ 轮不卡、内存不涨）、Windows Terminal / ConPTY / VS Code 终端三端实测。验收：500 轮会话流畅、内存稳定、所有符号在三端显示正常。

---

## 6. 证据与来源

### Claude Code

- 官方文档 Interactive mode：https://code.claude.com/docs/en/interactive-mode（2026-11-13 读取；快捷键、双渲染器、转录视图、命令补全均出自此处）
- 源码分析《Ch 13. The Terminal UI》：https://claude-code-from-source.com/ch13-terminal-ui/（Ink fork 的核心证据；“started with Ink, then forked it beyond recognition”）
- DeepWiki 源码分析（多份独立镜像，结论一致）：https://deepwiki.com/aoxiang9696/claude-code/6-terminal-ui-(ink)-and-rendering；https://deepwiki.com/lazyJLBL/claude-code/7.1-ink-renderer-and-terminal-emulation；https://deepwiki.com/lttcnly/claude-code/2.3-custom-ink-rendering-engine；https://deepwiki.com/leoyin1127/cc/7.1-ink-rendering-engine-and-design-system；https://deepwiki.com/btwiuse/claude-code/8.1-ink-renderer-and-terminal-engine；https://deepwiki.com/xqliang/claude-code/3.1-ink-renderer-and-layout-engine
- 终端 UI 源码解析：https://claude-code-source.doccupine.app/terminal-ui
- 思考动画（184 动词）：https://blog.alexbeals.com/posts/claude-codes-thinking-animation（Alex Beals，2026-02-07，ripgrep 实测）；动词 187 个的说法见 deepakness.com（版本差异）
- 工具行精确语法（v2.1.207 实测）：https://npm.io/package/@owlburtoe/pi-claudify
- 工具调用与 diff 资料：https://blog.laozhang.ai；https://learn.b-squared.tech；https://cfb3.github.io
- 颜色与主题：https://blog.vincentqiao.com（/theme）；https://sdeaton.com（Costuming Claude Code）；https://waka-ds.com；https://dplouffe.ca
- 架构总览（React + Ink、113 个组件、Messages.tsx 147KB、VirtualMessageList 148KB）：https://claude-code-explorer.vercel.app
- 交互文档镜像：https://ai-docs-hub.soarx.cc

### DeepSeek-TUI / Codewhale（“deepseek tui”）

- 仓库（旧地址自动跳转到新仓库，2026-11-13 实测）：https://github.com/Hmbown/DeepSeek-TUI → https://github.com/codewhale-hq/Codewhale（41,178 star、14,741 提交，创建于 2026-01-19）
- 报道《“The DeepSeek version of Claude Code” hits 2.3k GitHub stars》：https://aichina.news/news/the-deepseek-version-of-claude-code-hits-2-3k-github-stars-n1fpxy/（2026-05-04）
- 解析《DeepSeek-TUI: terminal coding agent for DeepSeek V4》：https://explainx.ai/blog/deepseek-tui-terminal-agent-hmbown-2026（架构：dispatcher → TUI → Ratatui；Ratatui 出自此处）
- 改名说明《DeepSeek TUI: The Agent That Became Codewhale》：https://www.devglaze.com/blog/deepseek-tui-renamed-codewhale-terminal-coding-agent
- DeepSeek 官方 awesome 清单：https://github.com/deepseek-ai/awesome-deepseek-agent/blob/main/docs/deepseek-tui.md

### dsh TUI（“dsh tui”）

- ccch1mneyyy/dsh-TUI（像素鲸鱼，主拆对象；README，2026-11-13 读取）：https://github.com/ccch1mneyyy/dsh-TUI
- dsh-TUI 介绍（dsh.plus）：https://www.dsh.plus/zh/plugins/dsh-tui/
- 官方 dsh-tui（pi-tui、盲文鲸鱼欢迎卡）：https://github.com/peiyuwang54/deepseek-harness-cli/blob/HEAD/packages/ui/tui/README.md
- dsh-tui 插件页（out-of-tree bundle，pi-tui）：https://www.deepseekserver.com/resources/dsh-tui/
- dash（零依赖原生 ANSI、双行状态栏）：https://www.dshplugin.store/plugin/songqikong/dash
- deepseek-harness-tui（OpenTUI + SolidJS）：https://www.dshplugin.store/plugin/papachong/deepseek-harness-tui
- dsh-tui-pi（pi 风格，20+ 主题）：https://www.dshplugin.store/plugin/fan56/dsh-tui-pi
- dsh-TUI 插件（nexlineai，工具卡描述）：https://www.dshplugin.store/plugin/nexlineai/dsh-tui
- 榜单（star 数、排名）：https://github.com/chumingjun/awesome-dsh-plugin-1/blob/main/TOP200.md；https://github.com/dshworks/awesome-dsh-plugins/blob/main/lists/terminals-desktop.md；https://github.com/kejixiaoliang/awesome-dsh-plugins/blob/dd7790e43c7da3e236830d2583e523a87fc77348/plugins/desktop-tui-mobile.md

### 渲染框架（选型参考）

- OpenTUI（Zig 核 + Bun FFI，Ink 30–32fps 上限的说法出自此处）：https://betterstack.com/community/guides/scaling-nodejs/opentui-react/；https://daily.dev/posts/opentui-react-for-your-terminal-powered-by-bun-and-zig-dsyf9z0oe；https://www.codeline.co/thoughts/repo-review/2025/opentui-zig-powered-terminal-ui-with-yoga-layout（“no Windows native path yet” 出自此处）；https://www.stork.ai/blog/the-tui-library-thats-killing-ink
- dsh-TUI 的 Ink 归属：https://ross.abutalabs.com/products/dsh-tui（“built with Ink/React”）；https://awesome.ecosyste.ms/lists/dshworks%2Fawesome-dsh-plugins（“built on a ported Ink core”）

---

## 附录：待确认

1. **用户说的“dsh tui”具体是哪一个**：本节主拆的是 ccch1mneyyy/dsh-TUI（像素鲸鱼版，DSH 官方首推）。如果用户看到的是官方 dsh-tui、dash、dsh-tui-pi 或其他版本，看到鲸鱼就能确认——像素鲸鱼是 ccch1mneyyy 版的标志，盲文鲸鱼是官方版的标志，尖角 DASH 字标是 dash 的标志。用户给一张截图即可一锤定音。
2. **“deepseek tui”现在叫 Codewhale**：旧名字仍在大量文章与 fork 里流通，但新版本、新功能都在 Codewhale 名下。文档里统一写“DeepSeek-TUI（现 Codewhale）”。
3. **Claude Code 2.x 的 fullscreen renderer**：官方文档证实存在两种渲染器，但实现方式未证实。本文 §1.8 的渲染结论有效范围是 v1.x 时期源码；如需 2.x 的结论，需要直接读 2.x 的源码或等官方说明。
4. **本文所有 star 数、版本号均为 2026-11-13 的实测/读取值**，之后会变；引用时以链接里的实时值为准。
