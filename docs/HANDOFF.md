# 卡塞尔专员终端 — 交接文档

> **历史文档（2026-11-12），已作废。** 当前状态以
> `docs/HANDOFF-2026-11-13.md` 和稳定线的实际代码为准；
> 本文中关于 `mockup` 前端和旧版引擎的描述不要继续使用。

**写给接手的 AI。** 用户（GitHub Meinan818）于 2026-11-12 13:35 决定把本项目交给别的 AI，本助手停止开发、准备交接。用户原话：先把正在跑的修复做完，再推送全部源码到 GitHub。

> 阅读顺序：先读 §1–§2 建立全貌，再按需查 §3 的文件位置、§4 的铁律、§6 的构建流程。不要跳过 §4——违反其中任何一条都会被用户当场打回。

---

## 1. 项目是什么

- **产品**：龙族世界观、卡塞尔学院专员专用的 AI agent 桌面端软件，对标 Codex Desktop / Claude Desktop，日常办公用的执行终端。软件名暂定「卡塞尔专员终端」，Windows 优先，代码先私有不开源。
- **技术栈**：Tauri 2 + React + TS。引擎用开源 Codex CLI（本机 `/opt/hatch-image/bin/codex`，codex-cli 0.164.0-alpha.9）。
- **模型路线（已拍板，BYOK）**：不由软件定一家模型，用户自己配置 API Key 接入，支持 DeepSeek、Kimi、千问、GPT 等多家；Key 存本地。设置里有「模型提供商」页（选服务商、填 Key、测连通、设默认模型、模型目录、加自定义服务商）。
- **用户在终端里的身份（产品内自选身份，非真实姓名）**：路明非；问候称「路专员」；编号 S2017-0117；血统评级 S。
- **AI 设定**：平时只有诺玛；EVA 是单个模式开关（默认关），打开后诺玛「变成」EVA，对标 Claude Code 的 ultracode（自动动态工作流编排，不是模型）。诺玛与 EVA 共用同一套记忆，关掉开关后诺玛能接上她的进度。
- **GitHub 仓库**：私有库 **Meinan818/Cassell-agent-terminal**（main 分支，用户在 github.com 手动建好）。**不要再尝试经 GitHub App 建库**——2026-11-12 试过，403 Resource not accessible by integration，该 App 无建库权限。
  - 仓库目前只有初始提交 `a07e90ae`（README、.gitignore、docs/research/codex-claude-feature-study.md）。**正式版源码至今未推**，用户 13:35 的指令是：先把正在跑的修复（§2.3）做完，再推送全部源码。
  - 推送规则（快照推送）：仅 UTF-8 文本、无二进制、≤2000 文件/16MiB；推送后把确认的 commit SHA 追加进 `~/workspace/cassell-agent/repo-init.muse-github-snapshot-sync.json`。本地暂存见 `~/workspace/cassell-agent/repo-init/`。

## 2. 当前状态（截至 2026-11-12 13:36 CST）

### 2.1 视觉稿即 v1（已定版）

- 用户 2026-11-12 11:10 亲口纠正：「现在这个视觉稿就是我想要的初始版本」——**视觉稿就是 v1、定版；正式版按视觉稿做、做到一模一样**。11:39 再强调正式版必须**百分百还原**。
- 视觉稿 artifact：slug `zhu-jie-mian-shi-jue-gao`，名「主界面视觉稿」。平台只保留最新 10 个版本。回退点：设计丰富版（build 9bff5ee4，10:04）与提供商页版本（build 5c754cc2，09:57）仍在版本列表。
- 最近交付的视觉稿版本（均待用户点验，见 §5）：
  - `bd48499b`（12:34）：权限/沙箱弹窗真修好。根因：上一版把弹窗钉在输入框底边、用写死的 67px 魔法数，按钮行换行时失效、弹窗压到按钮上；现改成弹窗直接挂在按钮行本身上（底边恒定在按钮行上方 19px），并补齐与模型弹窗同构的弹簧弹出动画。
  - `dcb1e411`（13:04）：P0/P1 界面项 + 全站假数据清零（从空状态开始）+ 功能闭环。另修六处：bindExpand 空值守卫（控制台报错根因）、设置「默认模型」改三态（已连接 / Key 已保存·未验证 / 未连接·待配置 Key）、两输入框模型按钮加「未连接 / 未验证」小标记、附件菜单「当前任务的文件」默认隐藏、Skills 改 0/4、手机宽度窗口随内容长高。
  - `36bc4729`（13:18）：模型名乱飞修复。模型选择改成单一状态源 DEF_MODEL + 写入函数 setDefaultModel，弹窗勾选、弹窗底部「当前」行、输入框模型按钮、设置页「默认模型」四处同步驱动；模型列表从服务商目录渲染；显示名带渠道（直连「DeepSeek 直连 · deepseek-flash / deepseek-v4-pro」、反代「workbuddy 反代 · deepseek-v4.1-flash / deepseek-v4.1」）。

### 2.2 Windows 正式版：最新 0.1.4（已交付用户试装）

| 版本 | 交付时间 | 安装包 | 便携版 | 内容 |
|---|---|---|---|---|
| 0.1.4 | 13:25 | 1,803,873 字节，SHA256 `0d2f3e93bef10835d18727bcdc4801ae8d1c993cf2aaabb66334d6db3eddc220` | 2,056,304 字节，SHA256 `3aa238feb55221cf9423bf3eaaf86ff471f06193abf921f378c959ff023ef60b`（内含 exe 4,851,712 字节） | 模型名修复 + P0/P1 + 假数据清理 + 权限弹窗修复 + 去文字 |
| 0.1.3 | 13:14 | 1,803,385 字节 | 2,054,594 字节 | 去文字 + P0/P1 + 假数据清理 + 权限弹窗修复 |
| 0.1.2 | 12:17 | 1,801,064 字节 | 2,054,876 字节 | 基于用户批准的视觉稿 build 9aa226c5（模型弹窗钉死 + 圆球可戳） |
| 0.1.1 | 11:34 | 1,750,108 字节 | 2,004,519 字节 | 仅改版本号（与 0.1.0 同名混淆问题的应对） |
| 0.1.0 | 11:15 | 1,750,680 字节 | 2,004,833 字节 | 重建版（修 dev 模式坏构建）；另有更早的 0.1.0 dev 坏版 |

- 产物目录：`~/workspace/cassell-agent/windows-build/`（0.1.0–0.1.4 十个文件都在，交付新包时提醒用户别混淆、认准文件名里的版本号；装之前先卸载旧版、删旧便携文件夹）。
- **未在真实 Windows 上实测**（本机无 Wine），等用户试装反馈。

### 2.3 正在跑的修复（先做完，再推 GitHub）

2026-11-12 13:34 用户发截图（`~/workspace/user/media_library/image/image-81.png`）报两处，已派 artifact.edit 在跑：

1. **整页滚动**：整个页面可以上下滚动，不应该——应用应填满整个窗口（像桌面软件一样固定高度、不出现整页滚动），只有内部内容区（侧栏列表、对话、面板）可以滚动。改法：应用根容器定高视口高度、整页不滚动、内部各区各自滚动。
2. **未配置却有模型**：用户明明没配置模型供应商，模型选择器里却列出一堆模型。改法：没配置 Key 的服务商，其模型不出现在选择器里；一个都没配置时显示空态（提示先去配置、带入口），只有配置了 Key 的服务商其模型才出现。

修好后进 **0.1.5**（重新导出 → 去文字 → 升版 → 交叉编译 → 交付，流程见 §6）。**用户指令：这个修完再推送全部源码到 GitHub。**

## 3. 关键文件位置

| 内容 | 位置 |
|---|---|
| 视觉稿 artifact（源头，v1） | slug `zhu-jie-mian-shi-jue-gao`；导出文件 `~/workspace/your_files/zhu-jie-mian-shi-jue-gao/zhu-jie-mian-shi-jue-gao.html`（自包含、资源内联） |
| Tauri 正式版源码 | `~/workspace/cassell-agent/app/`（Tauri 2 + React + TS；`src-tauri/` 为 Rust 后端，`lib.rs` 未动过） |
| 正式版前端（关键！） | `~/workspace/cassell-agent/app/mockup/index.html`——**不是 React 构建产物**，是视觉稿导出 HTML 原样拷入（再经去文字清理，见 §6.2）。`tauri.conf.json` 的 `frontendDist` 已改成 `../mockup`，`beforeBuildCommand` 已删（不再 npm build 覆盖） |
| Windows 构建产物 | `~/workspace/cassell-agent/windows-build/`（setup exe + portable zip，0.1.0–0.1.4） |
| grokbot 动画规范（23.8KB，必读） | `~/workspace/cassell-agent/grokbot-animation-spec.md` |
| 参考图 | `~/workspace/cassell-agent/style-ref/`（grokbot-pebble-blue.png、grokbot-hero.gif、grokbot-round-teal.png、codex/claude UI 参考图、新会话空态图等） |
| 用户发来的真校徽 | `~/workspace/user/files/108646_0_tegf.jpg`（双环圆印、外环拉丁铭文 BONUM CERTAMEN CERTAVI CURSUM CONSUMMAVI FIDEM SERVAVI、下方 CASSELL COLLEGE、中间大树带卷曲树根；开场粒子采样它，`assets/cassell-crest.jpg` 与原图逐字节一致） |
| 策划案（7 页） | `~/workspace/your_files/cassell-agent-plan/cassell-agent-plan.pdf`（3 项待拍板至今未答：软件名暂定「卡塞尔专员终端」、Windows 优先、代码先私有不开源；「先接哪家模型」已由 BYOK 关闭） |
| 诺玛/EVA 人设文档（8 页） | `~/workspace/your_files/norma-eva-persona/norma-eva-persona.pdf`（诺玛记忆库五层：人物/地点/制度/事件/专员档案；文末 3 个开放项等用户定：专员编号与评级的正式写法、学院纪念日要不要问候、EVA 模式下哪些不可逆操作要确认） |
| 研究报告（7 份） | `~/workspace/research_notes/` 下各 `report.md`（见 §7） |
| P0 开工简报（旧，已部分过时） | `~/workspace/cassell-agent/P0-next-version-brief.md`（2026-11-12 07:03 的准备稿，P0 清单已于 13:04 落地大半，仅供追溯） |
| 仓库暂存 | `~/workspace/cassell-agent/repo-init/`（初始 README、.gitignore、docs/research/codex-claude-feature-study.md）+ `repo-init.muse-github-snapshot-sync.json` |

## 4. 设计铁律（用户原话，逐条遵守，违反必被打回）

1. **grokbot 的动画设计语言就是本产品的设计语言**（用户 10:41、12:16 多次强调：「多去抄抄 grokbot 的动画设计和动画效果，给我往死里学行吗，这就是我们的美术圣经」）。规范见 `grokbot-animation-spec.md`，三句最重要纠正：
   - 圆球/表情过渡**不用弹簧**，是指数缓出、永不超调（全系统唯一带超调是通知小点弹出 +14%）；临界阻尼诺玛 k175/c26.5、EVA k315/c35.5（ζ=1.0），tempo 靠提高 ω。
   - **圆球本体永远正圆，不挤压、不浮动**（实测 3.4s 内中心只动 ±1px、宽高比恒 1.00–1.01）；生命感来自眼睛；呼吸改均匀缩放（待机 0.5%，工作到来单次 +2%～+6.9% 脉冲）。
   - 状态由圆球本身的运动编码（idle/thinking/working/waiting/blocked/done）；聊天区三小指示器是另一层（规范 §4b）。
   - 已批准的偏离（不改回）：眼睛宽 20% D（实测原版 12%）、眼睛在上半部、诺玛墨色 / EVA 蓝色 / EVA 白色药丸眼。
2. **前端是最高优先级**（用户 07:55「我们的前端是最厉害的」、08:31「前端就是命根子」、09:30 立标准「美观，简洁，动画高级和 grokbot 那样丝滑，高级，不能杂乱，功能清晰，前端必须做到交互顶级，每个地方都不能放过不能胡弄过去，必须使用起来超级丝滑」）。长期 mandate（12:16）：持续打磨前端 + 正式版，别丢功能、不断优化体验、该加就加该减就减，多做 DeepSeek 适配。
3. **功能叫本名**（工具调用就是工具调用、沙箱就是沙箱），不硬套言灵等设定；龙族只留身份与语境层（专员身份、学院配发终端、AI 是诺玛）。
4. **简洁是硬要求**：主路径（新会话→输入→发送→审查→合并）一眼看懂，次要功能渐进收纳，不堆主界面。布局与呈现方式多学 Codex（左栏/右栏/聊天的组织方式），视觉身份保持自己的。**功能可以对标别家，长相绝不照抄**。
5. **做减法只减视觉噪音，绝不减必要功能**（06:54）。grokbot 只是设计语言参考，不是产品原型。
6. **视觉稿即 v1，正式版百分百还原**（见 §2.1）。同步规则：视觉稿每次批准新版后，重新 artifact.export → 覆盖 `app/mockup/index.html` → 去文字清理（§6.2）→ 重编 Windows；重编前先核对 live build 号。
7. **活标记（头像）定版，不得再动造型**（07:06 用户「通过」）：干净圆形（边缘一点点柔和不规则）；药丸眼宽约球直径 20%、高约 30%、上半部、间距拉开、微微平行倾斜、无高光；待机张望带方向与停顿、眨眼完整挤压（25% 概率连眨）；诺玛墨色、EVA 蓝色、**EVA 眼睛是白色药丸眼**。诺玛/EVA 共用同一造型，只以颜色与表情区分。
8. **不要金色**（多次明令）；开场粒子只用白色。程序生成的半朽世界树已被否决（太丑），粒子目标只能是用户发来的真校徽。
9. **不要假数据**：用户 12:40 明确要求「全新纯净」——未配置的服务商不显示已连接、不显示假 Key、不显示假测试时间；模型列表只列已配置 Key 的服务商的模型（§2.3 第 2 条正在修）。提供商加 Key 走真实流程（保存→真发 GET /models→回结果，失败如实报错、不假装成功）。
10. **S 级印章定版**：不要实心盘、不要球体感（用户 11:11 骂深墨绿珐琅圆盘版「更丑了，这是台球吗」）、不要「血统评级」文字；最终形态：大号优雅衬线 S（墨色、Georgia、字重 500、光学居中）+ 仅 1px 浅色发丝圆环、零体积感，侧栏与设置页两处同款、居中对齐。
11. **背景淡色校徽水印全部去掉**（用户 10:07 要求）：面板、抽屉、身份卡、对话区 CSS background 校徽引用为 0；S 级印章保留（等级徽章非背景图）；开机校徽是前景内容不动。
12. **新会话空态**：中央活标记圆球 100px + 问候 + 身份小字 + 上下文栏 + 同款输入框；**无建议芯片、无「试试：」行**；问候按时段变（夜深了/早安/上午好/午安/下午好/晚上好），后半句轮换 6 个简单小任务。

### 4.1 已定版的功能形态（不得丢失）

- **开机动画（登录流，08:24 用户说「对味」通过）**：七步——①约 9000 白色粒子汇成用户真校徽（冲击波+亮度脉冲，成形后呼吸；铭文衬线宽字距逐行淡入；近黑底+暗角+胶片颗粒）②身份认证门→指纹屏（圆形扫描镜框+同心断弧指纹+扫光）③校园网登录表单（路明非/S2017-0117/密码掩码；接入信息 CASSELL-LAN、−52 dBm、IP 10.24.7.117、延迟 18 ms）④权限核验环 0→100% 点亮 S ⑤ ACCESS GRANTED ⑥ WELCOME TO CASSELL COLLEGE +「欢迎你，路专员」⑦身份已连接面板→交叉淡化进工作区（不许硬切）。左下角等宽终端日志六行随流程亮起+闪烁光标；可跳过、可重演。注意：参考视频里的用户名 zihang chu / 学号 2024087 是视频作者的，禁用。
- **EVA 模式区分**（08:16 交付、用户批准）：切换仪式感（圆球整圈旋转 1200ms 再接涟漪、窗口呼吸一次泛蓝光、期间极淡蓝光晕）、并行工作可见（对话里一行安静小字、点开看明细，不要步骤条演示味）、tempo 分开（诺玛 k175/c26.5、EVA k315/c35.5）。
- **审查队列**：合并有完整过程（步骤+弹簧进度条）→完成卡（已合并到 main、3 文件、+79 −6、时间戳）→查看结果+撤销合并；逐文件通过/拒绝留记录行可撤销；驳回同样有过程与完成卡；设计过的空态。主批准按钮是 42px 小圆角方块细线对勾图标（悬停转绿并浮出「审查批准」提示）。
- **输入框**：容器双层柔和阴影+24px 圆角、自动增高 min 50px/max 184px 后框内滚动、行高 1.65、长词断行、5px 细圆滚动条平时隐藏、+ 号展开旋转 45°、附件菜单五项、发送按钮无字灰置/输入点亮/发送弹簧回弹、聚焦光晕；模型/思考强度选择器是常驻面板（点选项只打勾不关闭，点面板外/Esc/完成才收起）；占位文「向诺玛下达指令…例如：把校验规则抽成一个单独的函数」；状态行「审批 Auto · 沙箱 workspace-write」与顶栏/设置实时同步。模型/思考强度弹窗与权限弹窗均锚定输入框固定位置（宽固定 344px），切换只换内容不动位置尺寸。
- **设置**：25 页已补全；主页是「档案 deck」（吸顶搜索大胶囊+专员身份卡+四组共 25 张宫格卡片）；整体是**居中单页**（不要侧边栏设置页，子页同样居中、左上返回）。含「模型提供商」页（DeepSeek、Kimi、通义千问、OpenAI、Claude 五家 + 自定义服务商，OpenAI 兼容接口）。
- **斜杠命令 30 条**：/plan 是真计划模式（开启后发指令只出计划清单、输入框上方有计划行可确认/退出）、/worktree、/rename（真改标题与侧栏）、/pin、/new、/pet、/memories、/skills、/usage、/fast、/approve、/ide、/side、/fork、/reasoning、/feedback 等；对话顶栏「…」菜单有 11 项。
- **思考指示器**：参考视频里那种小指示器（思考=三个跳动圆点、探索=同心圆脉冲环、起草=笔形标记），常驻在聊天消息区里跟着消息走（线程末尾、输入框上方，平时慢脉冲「待命」，收到消息依次变思考→探索→起草，回复完回待命），放在正常文档流里（绝不用浮动/绝对定位）。发消息后走思考约 2.4s→探索约 2.8s、整轮 5 秒多才出回复；点「待命」指示行可循环演示。
- **询问卡片/权限卡片（对话内、非弹窗）**：审批=只读确认（manual）时诺玛运行命令前递权限卡片（命令原文+拒绝 Esc/本次会话都允许/允许一次 Enter），命令动画停在「等你确认」，决定后卡片收成回执续行；问带选择的问题先递询问卡片给三选项、点选后才继续。
- **圆球可戳**（build 9aa226c5）：点一下看向点击处+微微倾身、果冻压扁回弹+轻轻一跳、眼睛瞬间睁大；连点第二下开心眯眯眼、第三下晕乎乎左右摇晃；点左/右/中/顶反应各不同；鼠标附近徘徊时悄悄瞥过去。

## 5. 待办与未验收项

### 5.1 等用户点验（都已交付、用户尚未回复）

| 项 | 版本 | 用户去哪验 |
|---|---|---|
| 权限弹窗真修好（67px 魔法数根因 + 弹簧动画补齐） | 视觉稿 build bd48499b | 切换权限级别：弹窗还动不动、打开有没有弹簧动画 |
| P0/P1 + 假数据清理（假数据清零、功能闭环） | 视觉稿 build dcb1e411 | 提供商页是否干净（没有假已连接、假 Key、假测试时间），加 Key 流程走不走得通 |
| 模型名乱飞修复（单一状态源、四处同步、显示名带渠道） | 视觉稿 build 36bc4729 | 点一个模型，关掉弹窗再打开，勾选还在不在同一个上；三处是不是同一个名字 |
| Windows 0.1.3（去文字 + P0/P1 + 假数据清理 + 权限弹窗修复） | windows-build/ | 试装 |
| Windows 0.1.4（模型名修复 + 上述全部） | windows-build/ | 试装（优先试这个） |

### 5.2 待办

1. **正在跑的修复（§2.3）做完 → 进 0.1.5**：整页滚动 + 未配置却有模型。修完重新导出、去文字、升版、交叉编译、交付。
2. **推送全部源码到 GitHub**（私有库 Meinan818/Cassell-agent-terminal）：**等 §2.3 的修复做完再推**（用户 13:35 指令）。只推源码（UTF-8 文本、无二进制），推送后把 commit SHA 追加进 `repo-init.muse-github-snapshot-sync.json`。
3. **长期持续打磨**（用户 12:16 mandate）：前端 + 正式版不断优化用户体验，该加就加该减就减，不丢功能；多做 DeepSeek 适配（用户 DeepSeek API 用得多，缓存命中率等）；前端交互动画持续打磨（用户 12:17 说「前端老是觉得还差点意思，但说不上来」）。
4. **正式版按视觉稿 v1 做、与视觉稿一模一样**（长期）：视觉稿每次改完都要同步到正式版前端并重编 Windows。

## 6. 构建与发布流程

### 6.1 Tauri 交叉编译（Windows，Linux 本机上做）

```bash
cd ~/workspace/cassell-agent/app
export PATH="$HOME/.cargo/bin:$PATH"   # 必须先有 cargo，否则构建失败
npx tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin
```

- 约 2 分 18 秒；成功标志 `TAURI_BUILD_EXIT=0`、「Finished 1 bundle」；只有无害的 LNK4099 警告与 "ignoring msi" 提示（Linux 交叉编译只产 NSIS 安装包、不产 MSI）。
- 工具链前提：本机已装 llvm（`/usr/bin/llvm-rc`，LLVM 18）+ 软链 `/usr/local/bin/clang-cl -> /usr/lib/llvm-18/bin/clang`。缺这两个构建会失败。
- 产物：`app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`（安装包）与 `.../release/cassell-agent-terminal.exe`（单文件 exe，用它打便携版 zip）。拷到 `~/workspace/cassell-agent/windows-build/`，文件名带版本号（`卡塞尔专员终端_<版本>_x64-setup.exe` / `卡塞尔专员终端_<版本>_x64-portable.zip`）。

### 6.2 版本号与同步流程（每次发版必走）

1. 视觉稿有新批准的 build 后，重新 `artifact.export`（slug `zhu-jie-mian-shi-jue-gao`），得到自包含 HTML。
2. **去文字清理（必做，每次重导出都要重做）**：删 `<header class="intro">`（顶部大标题「主界面视觉稿 — 安静的界面，会动的诺玛」+ 描述段落）、删 `<section class="notes">`（「设计说明」整节：01/02/03 三栏 + 配色表 + foot-note）、删帮助抽屉里「查看这一稿的设计说明」按钮及其 JS 绑定（不删绑定会报空值错）、`<title>` 改「卡塞尔专员终端」。清理后验证：`视觉稿/设计说明/这一稿/help-to-notes` 全站 0 处；界面完好（win、开机、输入框、侧栏、路明非、S2017-0117、诺玛、EVA 都在）；标签开闭数量前后一致；内联脚本 `node --check` 通过。
3. 清理后的文件覆盖 `app/mockup/index.html`（拷后 SHA256 核对一致），同步更新 `app/mockup/README.md`。
4. 版本号三处一致：`app/src-tauri/tauri.conf.json`、`app/package.json`、`app/src-tauri/Cargo.toml`（当前 0.1.4）。
5. 按 §6.1 交叉编译，产物拷到 `windows-build/`，交付时给用户两个文件链接 + SHA256，并提醒：先卸载旧版、删旧便携文件夹，认准文件名里的版本号。

### 6.3 验证口径（决定性验证，别只凭“构建成功”）

- **前端就是清理后的文件**：Tauri 把 `../mockup` 里的文件经 Brotli 压缩嵌进 exe（`tauri-codegen` 的 `include_bytes!` 机制）。把 exe 里的 Brotli 资源流解压出来，与清理后的 index.html 逐字节比对 SHA256（0.1.4：清理后 915,113 字节，SHA256 `a7842cb1d35bf67e9b04354c7c32017ae2d8aab9b0489e25adde908f14afe583`，压缩 blob 在 exe 内偏移 4112356 处完整命中）。
- **cargo:dev=false + custom-protocol 已开**：本次构建的 tauri 构建脚本输出里有 `cargo:dev=false` 与 `cargo:rustc-cfg=custom_protocol`（Tauri 2.12.5；CLI 构建时 build.rs 里 `dev = !custom_protocol`，自动启用）。
- **localhost:1420 只是配置文本**：exe 里仍有 1 处 `http://localhost:1420` 字样，是 `devUrl` 配置文本（0.1.1–0.1.4 都有），release 模式不用它。不要把它当成旧 bug 复发，也不要反过来宣称“已确认不走 localhost”——真正的检验是用户在 Windows 上打开看是不是视觉稿本人。
- **未在真实 Windows 上实测**（本机无 Wine），每次交付都要如实说，等用户试装反馈。
- HTML 引用 Google Fonts 与 Three.js CDN，需联网才有完全一致的字体与粒子；Three.js 加载失败时有 `window.THREE` 守卫，不会崩。

### 6.4 版本脉络与 localhost 坑（别重蹈覆辙）

- **0.1.0 原版是 dev 模式坏构建**（绕过 Tauri CLI 直跑 cargo xwin build、custom-protocol 没开，启动找 localhost:1420；用户 10:59、11:01 两次报 Edge/localhost 拒绝连接 ERR_CONNECTION_REFUSED）。**永远用 Tauri CLI 构建**（`npx tauri build ...`），不要直跑 cargo xwin build。
- 0.1.0 重建版（11:15）与 0.1.1（11:34，仅改版本号）本身没问题，但用户仍报 localhost——最可能是跑的还是旧 dev 版（新旧文件名完全相同、无法区分）。教训：**每次升版必须改文件名里的版本号**，并提醒用户先卸载旧版、删旧便携文件夹。
- **两套代码从未合流曾是头号问题**（11:46 诊断）：视觉稿（单文件静态稿）与正式版 React 骨架是两套，11 月 11–12 日视觉稿加的功能都没进正式版。解法已落地：视觉稿导出为精确源文件，原样拷进正式版为 `app/mockup/index.html`，`frontendDist` 改 `../mockup`、删 `beforeBuildCommand`。**不要再往 `app/src/`（React 骨架）里加功能**——正式版前端就是 mockup 的 HTML。
- 0.1.2 管线验证版（12:07，用 11:46 旧导出构建成功）因内容已旧**未交付**、只留在 target 目录，不要把它当成 0.1.2 发出去。正式交付的 0.1.2 是 12:17 用 build 9aa226c5 重新导出的那版。

## 7. 研究结论要点（报告都在 `~/workspace/research_notes/`）

### 7.1 DeepSeek 适配（`deepseek-api-adaptation-20261112/report.md`，379 行；用户 12:16 点名，他 DeepSeek API 用得多）

- **模型换代**：deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役（请求直接失败）；现只有 **deepseek-flash**（V4.1-Flash-1017）与 **deepseek-v4-pro**（V4-Pro-0813），思考是请求参数不是模型；视觉稿里的 cn:deepseek-v4.1 / cn:deepseek-v4.1-flash 不是官方 ID（疑似反代自定义名），直连要映射官方 ID。
- **缓存是最大省钱杠杆**：命中输入价只有未命中的 2%（Flash，50 倍差）/约 3.3%（Pro），自动开启、零配置、零写入费；命中率=命中 token/（命中+未命中），读 `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；实测案例 99.82% 命中、日账单 $61→$1.38；提高命中铁律：系统提示词逐字节固定、工具定义顺序固定、历史只追加不改写、易变元数据放最后。
- **思考强度四档实际只有三档有效**：官方映射 medium→high，视觉稿低/中/高/Max 里「中」与「高」发出去一样；DeepSeek 下只显示低/高/Max 或标注「中=高」；思考模式下 temperature/top_p/presence_penalty/frequency_penalty 被静默忽略、UI 应置灰。
- **工具调用+思考三个硬坑**：带 tools 必须把之前所有轮次 reasoning_content 原样回传（缺了 400）；思考开启时 tool_choice 只能 auto（required/指定函数名 400）；思考 token 按输出计费。
- **无服务端压缩**（Chat Completions 无 /compact）；可抄 DeepSeek Harness 方案：80% 触发、先剪工具结果（头 4096+尾 1024 字符）、保留 16% 原文尾巴、一次 LLM 摘要替换旧区段。
- **高峰=北京时间工作日 9:00–12:00、14:00–18:00 费率翻倍**，其余半价；价格（每 1M token）：Flash 低谷 $0.15 未命中/$0.003 命中/$0.60 输出，Pro 低谷 $0.66/$0.022/$1.98，高峰翻倍；上下文 1M、最大输出 384K。
- **限流按并发数**（Flash 2500、Pro 500，按账号计、所有 Key 共享，可免费申请扩容）；JSON 输出只有 json_object（json_schema 会 400）；Strict 模式 Beta、只针对工具调用、走 api.deepseek.com/beta。
- 用户 12:24 对 P0 修复选了「先看报告再说」，后于 12:33 说「P0P1吧」批准应用 P0+P1（界面部分已于 13:04 落地，引擎项留待正式版）。报告 §8 有 P0/P1/P2 功能清单。

### 7.2 TIANSHU（`tianshu-deepseek-20261112/report.md`，474 行；用户 12:25 推荐参考）

- huiliyi37/Tianshu-harness，TypeScript 编程 agent 运行时（终端 TUI + 桌面端 Tauri + VS Code 插件共用内核），v3.37.4、1333 stars、Apache-2.0，约 1700 文件/35 万行、75 个运行时 hook、16 个星域，核心理念 CVM（认知执行环境：目标/状态/证据/权限/终止条件交给运行时管理）。
- **缓存引擎（重点）**：5 个真实长会话实测 2001 次请求、6.45 亿 input tokens，命中率 99.3–99.6%、账单 ¥880→¥20（省 97.7%）。技术手段：**冻结前缀 + appendixDelta**（系统提示词+工具定义会话开始时冻结、动态内容只走 appendix 增量块、绝不重写前缀、压缩只在用户回合边界、resume 读 .frozen.json 快照继承前缀；前两条消息必须稳定）、CacheAdvisor 自适应延迟压缩（protection=hitRate×(1−pressure)≥0.45 时延迟压缩）、成本感知压缩档位（DeepSeek 用 cache-preserving 档）、用量观测（/cache 面板三档+命中率+节省金额+峰谷拆分、GlanceBar 常驻命中率、/debug cache 诊断碎裂）。
- **DSML 工具调用恢复（关键）**：DeepSeek 系网关会把 tool_calls 以 `<｜DSML｜tool_calls>` 标记文本塞进 content，而不是结构化字段；没有这层恢复，调用蒸发成纯文本、会话静默结束（真实事故：182 条记录中 23 条命中）。接 workbuddyapi2 反代时这层直接决定工具调用丢不丢。
- **思考展示**：reasoning_content 经 onThinkingDelta → 1000ms 定时节流 flush（不要加字符数阈值）、剥掉中转内联 `</think>` 标签。
- **模型 ID**：官方 V4.1-Flash 实际 ID 是 `deepseek-flash`，`deepseek-v4-flash` 是中转/火山独立 ID（印证 DeepSeek 报告）；服务商缓存能力矩阵：DeepSeek exact-prefix、Kimi 无、GLM 隐式、MiniMax 无、MiMo 同 DeepSeek。
- 给卡塞尔的借鉴清单（报告 §10）：P0 冻结前缀+appendixDelta、CacheAdvisor 公式、成本感知压缩档位、用量/缓存面板布局、DSML 恢复、模型 ID 直连/反代分别映射、思考展示工程细节；P1 交付门分离、统一记忆、信息素记忆、混合检索、检查点回滚、多智能体编排、Plan/Ask/Agent；P2 CVM 轻量版、星域机制、驾驶舱、SideChat、插件与工具预算；不建议照搬星域包装、CVM 全量 75 hook、桌面端闭源部分。
- **关于 dsh**：TIANSHU 代码两处提到 dsh（重试可见性注「dsh 式」、记忆回填注「对齐 dsh memory-pipeline」），说明 dsh 是独立项目、TIANSHU 对齐它；dsh 极可能是 **DeepSeek Harness** 本体（DeepSeek 官方开源终端 agent，「一切皆插件」、插件框架 Cordis），dsh-tianshu-build 是 dsh 的 fork。**用户尚未亲口确认**，不要擅自断言，找机会问他一次。

### 7.3 ultracode 真原理（`claude-code-ultracode-principles-20261112-0032/report.md`，官方文档）

- ultracode 是开关不是模型/档位；每任务现写 plain-JS 动态工作流脚本后台运行（agent()/parallel() 屏障/pipeline() 无屏障/phase() 分组），中间结果留脚本变量、只最终答案回主上下文；验证靠智能体互相驳斥+投票收敛；**agent teams 是独立机制，不要混淆**；默认 16 并发、上限 1000 智能体/次；>25 智能体或 >150 万 token 有大工作流警告；失败 stall 最多自动重启 6 次；用户可见 /workflows 进度视图（阶段、智能体数、每路 token、点开看提示词/工具调用/结果，p 暂停/x 停止/r 重启/s 保存/f 过滤）、任务面板进度行、后台任务面板、(retry N) 标记。思考强度与 ultracode 是两回事。
- 诺玛基底同样强：gather→act→verify、思考低–Max+单轮 ultrathink、Skills、MCP、内置只读 Explore/Plan 子智能体、权限模式、沙箱、检查点/回退/复刻、自动压缩；ultracode 加的是规模、编排与系统化验证。

### 7.4 Codex 功能清单（`codex-feature-gap-analysis-20261112-0110/report.md` 约 60KB；`codex-settings-features-complete-20261112-0145/report.md` 67KB）

- 目标模式=Goal mode（/goal 线程级持久目标）；计划模式=Plan mode（/plan→/goal）；**Codex 没有 /ask**。
- **已定加 10 个西瓜**（用户 09:26 把取舍权交给助理）：真 Plan、真 Goal、Side chat、会话 Fork+Esc-Esc、Worktree 并行隔离+Handoff、Queue/Steer、定时任务 Automations+Triage、Skills、权限颗粒化、用量可见/自动压缩。**顺序铁律：先修好视觉稿（稳定+简洁），再按榜分批加，绝不一次全塞**。
- DON'T ADD：Codex Cloud、云端 PR 自动评审、Security Cloud、手机 Remote、IDE 扩展、Computer Use（macOS 专属）、/rewind（Codex 自己都没有）。
- **Codex 桌面端没有图形界面的服务商配置表单**（只能改 config.toml），咱们的提供商页更方便；config.toml 约 200 项全列在清单报告里；桌面设置 16 分组；斜杠 CLI 60+ 条、桌面 28 条；/rewind 与文件状态检查点恢复经核实不存在。
- 子智能体展示/工作细节/侧边栏调研（`agent-subagent-display-sidebar-20261112-0038/report.md`）：Claude 的 Agent Map 与 Tasks 面板最好，Codex 最薄，Cursor 是 Agents Window+worktree+queue/steer；工作细节 Claude 三档 Normal/Thinking/Verbose（Ctrl+O）；未确认任何一家能单独暂停/重启单个子智能体；用户 08:46 已把该领域决策权交给助理。

### 7.5 其他已核实、可直接用的结论

- **workbuddyapi2 可接**：`wohaoeya1/workbuddyapi2`（公开 Python，源自 xiaofan6ya/workbuddy2api）是 WorkBuddy 反代网关，OpenAI 兼容接口 `http://127.0.0.1:8790/v1`（/v1/chat/completions、/v1/responses、/v1/models，Bearer Key）与 Anthropic 兼容接口 `http://127.0.0.1:8790`（/v1/messages）；通过「自定义服务商」（名称+Base URL+Key）接进软件；前提是用户自己有跑着的部署（本机 EXE 或服务器 Docker），可用模型看其 WorkBuddy 账号权益。**接它时 DSML 恢复（§7.2）必须做，否则工具调用会丢。**
- **Codex/Claude 功能对标**：`codex-claude-feature-study-20261111-2233/report.md`（51KB），对标页 artifact slug `codex-claude-code-gong-neng-dui-biao`；Codex 自 2026-07-09 合并后无独立桌面 App，是 ChatGPT 桌面端里的 Codex 模式。

## 8. 关于用户（沟通方式，别踩雷）

- 男，大四学生，2027 届，求职方向全栈开发，GitHub Meinan818。**从未提供真实姓名，不追问、不套个人信息**（「路明非」只是其卡塞尔终端内的自选身份名；Google 账号资料名 Ricardo 只是账号资料，不当作姓名）。
- 自认代码小白：**技术讲解要通俗、多给具体步骤、少用架构术语**。
- 对证据要求极高（「不掺水」），错了立刻认错不辩解；交付物必须与交付消息同一次发出；每次交付必须如实分开说验证口径（源码核查/探针实测/未做真机帧率实测），并请用户到他报过的那几处亲自点验。
- 沟通语言为中文、碎片式短句；「他们」指谁、任务派给谁先问清再给方案。方向明确就执行、不征求微决策；动他的代码是唯一的例外，先给分步方案等他拍板——但**本项目技术细节、功能取舍、Windows 路线已由用户多次授权助理自定**（08:46–08:47、09:26、09:39、09:54），他只在乎前端交互动画与使用体验；没批准的提议仍是没批准。
- 用户多次强调前端是最高优先级（见 §4 第 2 条）；功能越加越多、界面变复杂时他会直接说「乱」「反人类」，要以简洁清晰为先落地。
- 长活（下载、构建）进行中主动报实测进度，不要沉默——长沉默会被读成停工。
- **与本项目无关、不要主动碰的线**：Claude 账号申诉（等用户确认注册邮箱，勿催）、UMBRA/幽影协议交接（等用户拍板，勿推进）、美团（已关闭，绝不再提）、P3R 塔罗牌（倒吊人 XII、死神 XIII 图片工具明确拒绝、永不重试）、加冕奶蛙短剧 B05–B07（等用户说「继续」）、世界赛决赛 GEN 打 BLG（11 月 15 日凌晨 3 点，打完赛后同步一场即可）。

---

*文档版本：2026-11-12 13:36 CST。写给接手的 AI；只写文档、不改代码、不推 GitHub。*
