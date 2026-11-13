# 卡塞尔专员终端 · 去线条化 → 极简高级重做方案

> 用户原话（2026-11-13 06:04–06:14）：「全是线条、一点都没高级感，我最讨厌线条了」「身份卡丑的要死」「用户气泡也丑」「报错卡丑的要死」「聊天界面 low 爆了，像几年前的怀旧书签产物」「现在的界面就像一张纸，平庸至极——太平、太扁、没有纵深、没有层次」「我们是极简高级，和 grokbot 一样」「点名参照：grokbot、Hark、Gemini 手机端、Muse」。
> 铁律：不要线框感。红线：开机 9000 粒子汇真校徽动画（Boot.tsx 粒子段）一个字不改——用户亲口说这是他最爱的部分。
> 本方案分两条并列主线：**A 去线条**（删掉所有框线）+ **B 纵深与层次**（去线之后不能是一张白纸，要有深度）。

## 0. 四个参照到底高级在哪（已网查，非凭印象）

- **grokbot**（xAI/Cursor，2026-08 发布）：极简黑白 + 柔和灰底色系统；「kill as many pixels as you can」「the pixel was the bug」——狠删像素，技术复杂性全部藏起来；头像（圆形 + 眼睛）本身就是状态载体，状态靠头像运动编码，不用三圆点、不写步骤条；对话像 iMessage/WhatsApp，不像 IDE。
- **Hark**（Hark Labs，2026-10-06 发布，设计负责人前 Apple 工业设计师 Abidur Chowdhury）：被多家评测称为「the Apple of AI agents」「Design 9/10，Clean, Apple-style interface」；一个持续对话线程 + Home/Projects，界面干净、快；图形界面是给 AI 加一层可见可操作的外壳，而不是把聊天框换个皮。
- **Gemini 手机端**（2026 年 5 月 UI 2.0 大改版）：纯黑底 + 底部微弱蓝渐变光晕（有深度但不破极简）；建议芯片全删，只留一个大问候；输入框是底部药丸条；导航抽屉深炭色、字干净、间距宽松；Liquid Glass 方向：半透明、背景模糊、随内容变化的渐变。
- **Muse**（Meta，2026-09-08 发布）：「One Chat, No Choices」——没有模型选择器、没有斜杠命令面板、没有 token 计数器；对话就是 WhatsApp 式消息流；人格与头像是设计维度；三层状态（要点 → 过程 → 细节）按需展开。

**共性提炼（高级感五要素）：**
1. **留白即奢侈**——低密度、一屏一个重点、大问候、大行距；删建议芯片、删装饰框。
2. **色阶而非线框**——黑/白/柔灰三档底色递进分区，只用一个强调色；框线出现次数 ≈ 0。
3. **字阶与字重**——标题 600/700、正文 400、meta 11–12px 弱色；行高 1.65–1.7；字重本身就是层级。
4. **克制的状态表达**——状态靠运动、颜色、字重，不靠徽章和框；错误也要克制。
5. **浮层有纵深**——浮起来的东西（输入框、弹窗、Inspector）靠柔和阴影 + 一档更亮的底色与画布拉开距离；背景一层层递进。

## 1. 「纸」的问题：为什么现在像一张纸

S9 截图实测：侧栏（panel #1e1e1e）与画布（canvas #161616）只有一档色差，分区全靠 1px 边框线撑着；一旦把线删掉，如果不补色阶、阴影、间距，界面就塌成一张平纸。所以去线条必须同时做纵深：

**纵深标尺（Elevation，写进令牌）：**
- L-1 凹陷：侧栏 rail（暗 #101010 / 浅 #efefec）——比画布暗一档，沉下去。
- L0 画布：canvas（暗 #161616 / 浅 #fbfbfa）——内容呼吸的底。
- L1 抬起：panel（暗 #1e1e1e / 浅 #ffffff）——标题栏、卡片、Inspector、弹窗的面。
- L2 填充：soft（暗 #262626 / 浅 #f0f0ee）——输入框底、选中行、工具行、思考块的填充色。
- L3 浮起：shadow（--shadow 0 8px 28px / --shadow-sm 0 2px 10px）——输入框、弹窗、Inspector、浮动按钮才配阴影；静止内容不配阴影。
- 呼吸：关键间距放大——对话 turn 间距 16→24px、分区 16→24px、卡片内边距 12→16px；输入框聚焦时阴影变大（浮起感），失焦收回。

## 2. 全站线条清点（实测代码，2026-11-13 06:06）

共约 70 处可见线条规则。分布：App.css 约 30 处、App.tsx 内联 WAVE2/S7/AUDIT 三块 CSS 约 35 处、TitleBar 1 处、RightPanel 内联 4 处；Composer/Drawers/ConnectWizard 自身无 border 代码（走 App.css 类名）。Boot.tsx 的线（登录表单框、印章环）**全部排除，不动**。

### 2.1 布局分隔线（删，用色阶 + 间距替代）
| 位置 | 现状 | 替代 |
|---|---|---|
| 标题栏底边 | TitleBar `.w6-titlebar` border-bottom 1px | 删；标题栏 L1 panel 底色 + 40px 高度自带分区 |
| 侧栏右边 | App.css `.sidebar` border-right 1px | 删；侧栏 L-1 rail 比画布暗一档 |
| 主头底边 | `.main-head` border-bottom 1px | 删；标题 16px/600 + 间距分区 |
| 身份卡上方 | `.side-bottom` border-top 1px | 删；16px 间距 + 卡片自身阴影 |
| L1 状态行底边 | App.tsx `.w2-l1` border-bottom 1px | 删；12px 弱色小字 + 间距 |
| Inspector 头底边 | `.w2-insp-head` border-bottom 1px | 删；标题 600 + 16px 间距 |
| Inspector 左边 | `.w2-inspector` border-left 1px | 删；已有 --shadow，浮层靠阴影 |
| 右栏头底边 | `.drawer-head` border-bottom 1px | 删；标题 700 + 间距 |
| 设置导航右边 | `.s7-nav` border-right 1px | 删；160px 导航列 + 选中行 accent-soft 底 |
| 设置组底边 | `.s7-group` border-bottom 1px | 删；组间距 24px + 组标题 700 |
| Cmd-K 输入底边 | `.s7-palette-input` border-bottom 1px | 删；输入字 14px + 间距 |
| Cmd-K 底部顶边 | `.s7-palette-foot` border-top 1px | 删；11px 弱色 + 间距 |
| 文件预览头底边 | `.file-preview-head` border-bottom 1px | 删；head 用 soft 底、body 透明，色阶分区 |
| 插件行底边 | `.ext-row` border-bottom 1px | 删；行间距 4px + 悬停底色 |

### 2.2 卡片与容器框（删框，改色阶填充 / 浮起阴影）
| 位置 | 现状 | 替代 |
|---|---|---|
| 工具行卡 | `.msg.tool` bg-soft + 1px border | 去框，soft 底保留，字 13px text-2 |
| 错误卡 | `.msg.error` danger-soft + 1px border（另见 §5 重做） | 重做（§5） |
| 思考块 | `.think-body` bg-soft + 1px border | 去框，soft 底保留 |
| 首次配置 CTA | `.setup-cta` bg-soft + 1px border + 24px 垫 | 去框，soft 底保留，居中排版不变 |
| 发送拦截条 | `.gate-notice` bg-soft + 1px border | 去框，soft 底保留 |
| 内联卡片 | App.tsx `.w2-card` 1px border + hover 加深 | 去框，改 L1 panel 底 + shadow-sm（浮起）；hover 只抬阴影 |
| 合并完成卡 | `.merge-card` ok-soft + 1px border | 去框，ok-soft 底保留 |
| 审查文件行 | `.review-file` 1px border；approved 态 border-color ok | 去框，每行 soft 底；approved 态改 ok-soft 底，不改边框色；rejected 暂存态改 danger-soft 底（替 RightPanel.tsx:622 的 borderColor danger） |
| diff 展开框 | RightPanel.tsx:104 内联 1px border | 去框，soft 底保留 |
| 拒绝暂存提示 | RightPanel.tsx:586 内联 1px border | 去框，danger-soft 底保留 |
| 工作流信息框 | RightPanel.tsx:1026 内联 1px border | 去框，soft 底保留 |
| 文件预览 | `.file-preview` 1px border | 去框，soft 底 + 圆角保留 |
| 浏览器卡 | `.browser-card` 1px border | 去框，soft 底保留 |
| 档案行 | `.archive-row` 1px border | 去框，soft 底保留 |
| 设置空态框 | `.s7-empty` 1px border | 去框，soft 底保留 |
| 设置摘要行 | `.s7-summary` 1px border；warn 态 border-color accent | 去框，soft 底；warn 态改 accent-soft 底 |
| EVA 提示 | `.eva-toast` accent-soft + 1px accent border | 去框，accent-soft 底 + shadow 保留 |
| EVA 详情行 | `.eva-note-detail` bg-soft + 1px border | 去框，soft 底保留 |

### 2.3 输入框与按钮（删框，改填充色 + 聚焦光环）
| 位置 | 现状 | 替代 |
|---|---|---|
| 输入框本体 | `.composer-wrap` 1px border-strong + shadow-sm；聚焦 border-color accent | 去框，L1 panel 底 + shadow-sm 常驻；聚焦改 0 0 0 3px accent-soft 光环 + 阴影加深（浮起），不改边框色 |
| 侧栏搜索 | `.side-search` / `.w2-search-input` 1px border；聚焦 border-color accent | 去框，soft 底；聚焦光环 |
| 输入框内按钮 | `.composer-btn` 1px border | 去框，透明底 + 悬停 bg-hover |
| 幽灵按钮 | `.btn-ghost` 1px border + panel 底 | 去框，soft 底填充 |
| 思考强度档 | `.effort` 1px border；选中态 border-color accent | 去框，soft 底；选中态 accent 底白字（已有） |
| 自定义模型输入 | `.custom-model input/button` 1px border | 去框，soft 底；聚焦光环 |
| 字段输入 | `.field-input` / `.term-input` / `.browser-open-row input` 1px border；聚焦 border-color accent | 去框，soft 底；聚焦光环 |
| 终端快捷按钮 | `.term-quick button` 1px border | 去框，透明底 + 悬停底 |
| 弹出层 | `.popover` 1px border-strong + shadow | 去框，shadow 保留（浮层靠阴影） |
| 设置 modal | `.s7-modal` 1px border + shadow | 去框，shadow 保留 |
| Cmd-K 面板 | `.s7-palette` 1px border + shadow | 去框，shadow 保留 |
| 通知气泡 | `.s7-notice` 1px border + shadow | 去框，shadow 保留 |
| 斜杠菜单 | `.s7-slash` 1px border + shadow | 去框，shadow 保留 |
| 回到底部 | `.w2-jump` 1px border + shadow；hover border-color accent | 去框，shadow 保留；hover 只改字色 |
| kbd 键帽 | `.s7-kbd-list kbd` / `.s7-palette-esc` 1px border | 去框，soft 底保留 |
| 审查徽标 | `.w2-review-badge` 1px border | 去框，soft 底 / accent 底保留 |
| 当前标签 | `.s7-tag-current` 1px accent border | 去框，accent 字 + accent-soft 底 |
| 向导步骤圆点 | `.s7-wizard-steps b` 1px border | 去框，未完成态 soft 底、完成/当前态 accent 底 |
| 消息编辑框 | `.w2-msg-edit textarea` 1px accent border | 去框，soft 底 + 聚焦光环 |

### 2.4 选中与状态指示（删 2px 线，改底色 + 字重）
| 位置 | 现状 | 替代 |
|---|---|---|
| 名册选中竖条 | `.w2-roster-row.w2-on::before` 2px accent 竖条 | 删；选中态已有 accent-soft 底 + 600 字重，足够 |
| 设置导航选中竖条 | `.s7-nav button.on::before` 2px accent 竖条 | 删；同上 |
| 右栏页签下划线 | `.rp-tab.active` border-bottom 2px accent | 删；选中态改 accent-soft pill 底 + 700 字重 |
| 错误卡左红条 | `.w2-card-err` border-left 2px danger | 删（§5 重做：红标题字 + danger-soft 底） |
| 段位牌 EVA 蓝环 | `.w4-rank-eva-on` box-shadow 0 0 0 1px accent | 删；改 EVA 洗色（§4） |
| W4 顶线扫过 | `.w4-sweep` 顶部 2px accent 线（1350ms 瞬态） | 删；仪式已有面纱光晕 + 涟漪，顶线冗余，且是用户最讨厌的硬线 |
| 审查徽标等 | 见 2.3 | — |

### 2.5 保留项（不是框线，是 artwork / 无障碍，不动）
- 焦点环：`box-shadow: 0 0 0 3px var(--accent-soft)`（.side-search:focus、.field-input:focus、.term-input:focus、.app :focus-visible）——无障碍必需，保留。
- 球的权限核验环：Mark.tsx:232 `1px solid ringColor`——球的 signature 元素，是球体 artwork 的一部分，保留。
- 球眼睛弧线：Mark.tsx:155 `borderTop`——眼睛形状的画法，不是界面线，保留。
- S 印章发丝环：`.w2-seal` / `.identity-badge` 的 1.5px 环——印章 artwork 本身（已定版：衬线 S + 发丝圆环），保留。
- 开关轨道：`.switch` 是填充色块，不是线，保留。
- 滚动条拇指：`background: var(--border-strong)` 填充块，不是线，保留。
- 涟漪：`.w4-wrap-eva::before/::after` 扩散圆环——1350ms 瞬态动效，是球的运动语言，不是静态框，保留。
- 开机全部：Boot.tsx 一个字不改（红线）。

## 3. 替代工具箱（删线之后靠什么分区）

1. **色阶**：L-1/L0/L1/L2 四档底色（§1 纵深标尺）。分区第一手段。
2. **间距**：分区第二手段——对话 turn 16→24px、分区 16→24px、组间距 24px。
3. **细腻阴影**：只有浮起的面配阴影（输入框、弹窗、Inspector、浮动按钮、身份卡）；静止内容零阴影。
4. **字重层级**：选中/活动态 = 600–700 字重 + accent-soft 底；标题 700、正文 400、meta 11–12px text-3。
5. **柔和 tint**：状态只用淡底——ok-soft、danger-soft、accent-soft；不改边框色。

## 4. 身份卡（段位牌）全新设计 —— 「卡塞尔学院 · 专员证件」

用户第二次批评它丑（第一次 2026-11-12：做成真正的身份卡片）。这次不改边框，要重新想形态：**它不是设置区的一个小盒子，而是一张证件**。

- **容器**：无框，L1 panel 底，圆角 16px，内边距 12px 16px，shadow-sm（在 rail 侧栏上浮起一层），与任务列表之间 16px 间距（删 `.side-bottom` 的 border-top）。
- **第一行（发证方）**：校徽线条版 22px（CrestLine 矢量线稿：外圈 + 世界树，currentColor）+ 「卡塞尔学院」11px/600、字间距 0.08em、text-2；右侧 S 印章 30px。
- **第二行（身份）**：路明非 16px/700 + S2017-0117 等宽 11px text-3 + 绿点 + 「在线」并在一行（baseline 对齐）。
- **第三行（操作）**：设置 / 档案库 / 帮助三个 32px 纯图标按钮，透明底，悬停 bg-hover；激活态 accent-soft 底 + accent 图标。
- **EVA 态**：卡面改 accent-soft 洗色（color-mix 45% accent-soft + panel），印章 S 变 accent 色；删 `.w4-rank-eva-on` 的 1px 蓝环 box-shadow，改柔和蓝光晕阴影。
- **浅色主题**：同结构，panel #ffffff 在 rail #efefec 上浮起，阴影 0 8px 28px rgba(0,0,0,.10)。
- 旧 App.css `.identity-card` / `.identity-badge` 已无人引用（Sidebar 现用 w2-rank 体系），第二阶段确认后删除，避免两套并存。

> Deline 6（2026-11-13 06:51，用户第三次批评身份卡，四条具体要求）：
> 1. 从根本上重想，不小修小补；2. S 徽章像台球——删实心圆底（`--seal-bg` 径向深色圆 + 白字），回归定版 S 印章：大号优雅衬线 S（Georgia 500）+ 1px 浅色发丝圆环，无实心圆底、无「血统评级」文字（印章 title 与设置身份区的「血统评级 S」一并拿掉）；3. 校徽不要照片，改白色线条版 CrestLine（外圈 + 世界树线稿；描边 currentColor，深色下近白、浅色下近墨；开机粒子动画的真校徽照片绝对不动）；4. 比例改横向名片（约 208×122，1.7:1）：名字 + 编号 + 状态并在一行，内边距 16px→12px 16px，行距 12px→8px，不再是矮胖正方形。

## 5. 用户气泡重做 —— Grok 式现代极简高级气泡（Deline 5，纠正）

> 2026-11-13 06:46 用户纠正：他不是不要气泡，他要的是现代极简高级的气泡，就和 Grok 那种一样。
> 之前传的“无气泡”是错的（Deline 1/2 已按无气泡做，Deline 5 改回气泡）。

现状：`.msg.user .msg-body` 右对齐灰盒子（暗 #2a2a2a / 浅 #efefec），16px 圆角 + 4px 小角，用户说「框住的感觉」很丑。

- **定稿：Grok 式气泡**。用户消息 = 右对齐气泡，15px/1.65/400，最大宽度 78%；底色用 `--user-bubble` 极淡 tint（深色 #2a2a2a 比底色 #161616 稍亮、浅色 #efefec 比底色 #fbfbfa 稍深），无边框，20px 大而柔和的圆角，留白 10px 16px。克制、柔和、有质感，一眼高级，不要像个灰盒子。
- 操作行（复制/编辑/重试，`.w2-msg-actions`）悬停时出现在消息下方右对齐，本来就无框，保留。
- 助手侧不变：球头像 + 14px/1.7 纯文字（本来就无框），两者统一成一套排版语言。

## 6. 报错卡重做 —— 克制、清晰、有质感

现状：`.msg.error` / `.w2-card.w2-card-err`——大红框 + 左 2px 红条 + 右上「错误」红 pill + 「出错了 先看一眼原因，再决定下一步」+ 蓝色重试按钮。用户：丑的要死。

- **定稿：无框、无红底、无 pill**。错误 = 一条普通的助手回合：第一行红色 600 字重小标题（只写人话原因，如「启动失败：本地反代没启动」），下面 14px text-2 正文写清楚原因与两步做法；重试入口是行内文字按钮（accent 色、无框，悬停下划线），文案「重试」；再附一行 12px text-3「也可以换个说法再试一次，或检查一下模型配置」。
- 红色只用在一处（标题行），其余全是正常文字色；危险操作（拒绝还原等）仍用 danger-soft 淡底提示，不用红框。
- 审查区 `.rp-error` 同理：danger-soft 底保留、去框、字 13px。

## 7. 聊天界面整体现代感（去 dated）

用户说像「几年前的怀旧书签产物」——老气的根源是：框 + 密 + 小字 + 生硬状态。统一改成现代极简语言：

- **字阶**：问候 24px/600 保持；助手正文 14px/1.7；用户 15px/1.65；工具行 13px text-2；思考块 13px text-2；用量行 11px mono text-3；meta 一律 11–12px。
- **间距**：chat gap 16→24px；turn 之间再加 4px 呼吸；composer-slot 上间距 8→12px；空态 greeting 与球之间 16px 保持。
- **留白**：对话区左右 24px 保持，内容 max-width 760px 不变；删 L1 底边线后状态行与内容之间用 8px 间距。
- **工具调用行**：无框、透明底、13px text-2、mono 标题；展开的 w2-card 改 L1 panel + shadow-sm、无框、圆角 16px。
- **思考块**：无框、soft 底、13px。
- **状态表达**：运行中 / 已完成 pill 保留（soft 底、无框）；用量行常驻 mono 小字。

## 8. 第二阶段实施清单（按文件）

1. **App.css**：删 §2.1–2.4 中 App.css 的全部边框规则；chat gap 16→24；用户气泡改 Grok 式气泡（§5，Deline 5）；错误卡改 §6；composer 去框 + 聚焦光环；删旧 `.identity-card`（确认无人用后）。
2. **App.tsx（WAVE2/S7/AUDIT 三块 CSS）**：删全部边框规则（§2.1–2.4 所列）；`.w2-rank` 按 §4 重做（配合 Sidebar 结构改动）；删 `.w4-sweep`；`.w4-rank-eva-on` 改洗色 + 柔光晕；`.rp-tab.active` 改 pill。
3. **Sidebar.tsx**：身份卡按 §4 重排结构（crest 24px、名字 17px、S 印章 28px、三行布局）；删 `.side-bottom` 的分隔线依赖（CSS 侧已删）。
4. **RightPanel.tsx**：4 处内联 border 改 soft/danger-soft 底（:104、:586、:1026、:622）。
5. **TitleBar.tsx**：`.w6-titlebar` 删 border-bottom。
6. **不动**：Boot.tsx（全部）、Mark.tsx（球环与眼睛）、Rust、引擎接线、app/mockup/、视觉稿。
7. 每步本地 git commit、不推送。

## 9. 截图验证清单（存 `~/workspace/cassell-agent/step3-shots/deline/`）

- 对话区：正常消息、用户气泡（Grok 式）、错误卡、工具调用行（折叠 + 展开）、思考块——重点。
- 侧栏：身份卡新设计（诺玛态 + EVA 态）、名册、项目、最近。
- 设置 modal：模型 / 工作方式 / 外观三页。
- Inspector：审查、终端、文件三视图。
- 标题栏 + 输入框聚焦态；浅色主题全套。
- 自查标准（按 grokbot / Hark / Gemini / Muse）：① 全屏找不出一处 1px 框线；② 界面有纵深（侧栏沉、画布平、浮层浮），不像一张纸；③ 像现代产品，不像几年前的老界面；④ 身份卡像一张证件；⑤ 错误卡克制清晰。
