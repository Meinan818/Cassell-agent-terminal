# 主题切换实施计划：比初代 EVA 更好

> 目标：主题切换是一次渐进平滑的过渡，全站颜色一起平滑渐变，绝不是忽然变黑。
> 标准要拉高：过渡本身要做得足够高级、足够顺滑——切换本身就是一次让人想再点一次的小演出，
> 不是"能切、不跳变"就交差。当前前端整体被评价为太过平庸无聊，这次切换是少数全屏动效之一，
> 必须按签名级动效来做。

---

## 0. 结论先行（给实施者的三句话）

1. **两层过渡叠加**：View Transitions 圆形揭示（羽化软边，700ms）+ 全站颜色交叉淡化（450ms）——
   任何一层单独看都平滑，两层叠加后没有任何一个像素会瞬间跳变。
2. **时长与缓动全部定死**：揭示 700ms 走产品自己的 `--ease-exp`；颜色淡化 450ms 走 `--ease`；
   图标变形 400ms 走 `--spring`。不许凭感觉各写各的。
3. **首屏零闪烁是硬指标**：启动第一帧就必须是保存的主题——Rust 侧在窗口创建前就定好底色，
   启动屏不许再写死浅色。

---

## 1. 初代主题切换机制拆解（以文件实际内容为准）

源码位置：`~/workspace/cassell-agent/eva-gen1/asar/web/`

### 1.1 令牌层：暗色默认 + 浅色覆盖

- `css/base.css:4-52`：`:root` 里就是**暗色默认值**（夜是默认），`color-scheme: dark`。
  令牌分层很干净：底色 `--ink-950…--ink-600`、线 `--line/--line-strong`、品牌 `--gold/--cyan`、
  语义 `--red/--ok`、文字 `--text/--text-2/--text-dim/--text-faint`、阴影 `--sh-1/--sh-2/--sh-glow`、
  动效 `--ease: cubic-bezier(0.2, 0.7, 0.3, 1)`、`--fast: 140ms`、`--base: 200ms`。
- `css/theme.css`（192 行，**最后加载**）：所有覆盖挂在 `html[data-theme='light']` 下，
  靠更高特异性生效，不动 token 定义本身；同时设 `color-scheme: light`（原生滚动条、表单控件跟着走）。
  浅色令牌不是简单反色，而是**按对比度重调的**：底色翻成白与极浅冷灰蓝；
  学院金在浅底上压暗到 `#a8761b` 才够对比；信号青加深到 `#0e9bb8`；主操作走科技蓝 `#2563eb`。
  文件里还特意注明：浅底上的次级文字必须压到 4.5:1 以上，10–12px 的字尤其禁不起太浅。
- `theme.css` 覆盖面很全：背景骨架、侧栏/面板、对话气泡、工具卡、首屏、输入区、弹层、滚动条、
  选中色、输入框底色、主题按钮两套图标的显隐（`.theme-ico--sun` 只在浅色显示）。

### 1.2 切换层：View Transitions 圆形揭示（亮点）+ 颜色过渡兜底

`js/app.js`：`applyTheme`（约 228-234 行）只做三件事——写 `documentElement.dataset.theme`、
存 `localStorage['eva.theme']`、改按钮 title。`setTheme(theme, silent)`（240 行起）是核心：

```js
// 从按钮位置扩散一个圆，盖满的瞬间换主题 —— 圆形揭示比整页渐隐有意思得多。
// 用 View Transition 的 clip-path 实现，不额外插一层遮罩 DOM；
// 不支持该 API、或用户要求减少动效时，直接切（已有 260ms 颜色过渡兼底）。
const rect = btn.getBoundingClientRect();
const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 48;
root.style.setProperty('--vt-x', `${x}px`);  // 圆心 = 按钮中心
root.style.setProperty('--vt-y', `${y}px`);
root.style.setProperty('--vt-r', `${radius}px`);  // 半径 = 到最远角 + 48px 余量
document.startViewTransition(() => applyTheme(next));
```

- `css/app.css` 约 625-634 行：`::view-transition-old(root) { animation: none; }`（旧快照冻结），
  `::view-transition-new(root)` 跑 `eva-theme-wipe` **620ms `cubic-bezier(0.6, 0.05, 0.3, 1)`**，
  从 `clip-path: circle(0 at 圆心)` 扩到 `circle(150% at 圆心)`。
- 兜底：不支持 View Transition API、或 `prefers-reduced-motion`、或静默启动时，直接换主题，
  靠全站颜色过渡兜底——`app.css` 约 697 行给 `.sheet/.toast/.tool/.term/.skill-row/.msg__ava/.msg--user .msg__text`
  加了 `transition: background-color 260ms, border-color 260ms, color 260ms, box-shadow 260ms`，
  其余各处大量 `transition: background var(--base), color var(--base)`（200ms）。
- 按钮本身：太阳/月亮图标旋转进出（`transition: transform 620ms, opacity 380ms`），
  切换后弹 toast「日间模式 / 夜间模式」。
- 启动：`boot()`（约 405 行）`setTheme(localStorage.getItem('eva.theme') || dataset.theme || 'dark', true)` 静默恢复。

### 1.3 首屏防闪：`<head>` 内联脚本

`index.html` 约 36-44 行，**首次绘制前**就定好主题：

```html
<script>
  /* 首次绘制前就定好主题，避开一闪而过的白 / 黑 */
  (() => {
    const saved = localStorage.getItem('eva.theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.dataset.theme = saved || (prefersLight ? 'light' : 'dark');
  })();
</script>
```

优先级：已保存的选择 ＞ 系统偏好 ＞ 默认暗色。系统偏好只在**首次**起作用，之后不再跟随。

### 1.4 画布特效也跟主题走

`js/effects.js` 约 84-88 行：代码雨的 `palette()` 每帧读 `document.documentElement.dataset.theme`，
暗色用青 `#22d3ee`、浅色用蓝 `#2563eb`——canvas 特效不是写死色，而是跟着主题变量走。

### 1.5 初代做得好的、与不足

做得好的：暗色默认 + 浅色覆盖的令牌结构；圆形揭示（从按钮扩散，眼睛跟着手走）；
260ms 颜色过渡兜底；首屏内联脚本防闪；`color-scheme` 跟着换；减少动效时降级。

不足（正是我们要超过它的地方）：
- 揭示的圆边是**硬边**（clip-path 的锐利圆环），看得出是一层遮罩在扫，机械感重。
- 颜色过渡 260ms 偏短，接近"闪一下就过去了"，不够从容。
- 个别地方写了 `transition: all var(--base)`（app.css 202、271、402 行）——`all` 会连 transform 一起拖，
  和动效系统打架。
- 系统偏好只做一次性默认，不实时跟随；没有"跟随系统"这个选项。
- 每次切换都弹 toast，有点吵；金色品牌色在浅色下要靠压暗硬撑（我们产品本来就不要金色，没这个包袱）。
- 主题只存 localStorage（纯网页够用；我们是 Tauri，主题存在 Rust 设置文件里，首屏要另外想办法）。

---

## 2. 现在咱们的主题切换缺什么（对照着列）

源码位置：`~/workspace/cassell-agent/app/src/`（`index.css` 不存在，样式全在 `App.css`）

| 维度 | 初代 | 现在咱们的 | 缺口 |
|---|---|---|---|
| 令牌结构 | `:root` 暗色默认 + `html[data-theme='light']` 覆盖，文档级 | `.theme-light` / `.theme-dark` 两个 class 挂在 `.app` div 上（`App.css:65-106`），约 18 个令牌 | 主题只是 React 层的一个 div class，启动屏、滚动条、原生控件都够不着 |
| 切换过渡 | 圆形揭示 620ms + 全站 260ms 颜色过渡 | **没有**。`.app` 上没有任何颜色过渡；全站只有按钮 180ms、输入框 focus 180ms、开关 200ms 这种局部过渡（`App.css:41、230、800`） | 点一下主题，绝大多数表面是**瞬间跳变**——这就是用户说的"忽然就变黑" |
| 揭示效果 | 有（View Transitions） | 没有 | 切换没有任何仪式感 |
| 按钮反馈 | 太阳/月亮旋转进出 620ms + toast | 只有文字互换「☀ 浅色 / ☾ 深色」（`App.tsx:831-835`、`Drawers.tsx:438-441`），无动画、无反馈 | 像个设置项，不像个设计过的控件 |
| 首屏防闪 | `<head>` 内联脚本，首绘前定主题 | **没有**。`index.html` 无内联脚本、无底色；`App.tsx:773` 启动屏写死 `theme-light`；`tauri.conf.json:15` 窗口底色写死 `#0b0b0c`（近黑） | 深色用户每次启动：先黑窗 → 再亮启动屏 → 设置加载完再跳回深色，三连闪。浅色用户：先闪黑再变亮 |
| 跟随系统 | 首次默认跟系统 | **没有**。`types.ts:6` 只有 `"light" \| "dark"`；全站搜不到 `prefers-color-scheme` | 没有"跟随系统"选项，也不会实时跟系统走 |
| 持久化 | localStorage `eva.theme` | Rust 设置文件 `settings.theme`（`settings.rs`，默认 `"light"`） | 存 Rust 是对的，但 webview 在 React 挂载 + `get_settings` 返回前不知道主题——这正是首屏闪的根因 |
| `color-scheme` | 两套主题各设 | 没有 | 滚动条、原生控件不跟主题走 |
| 球的颜色 | —（初代是情绪球组件，另案） | `Mark.tsx` 两套径向渐变写死（墨色 `#4a4a4a→#000` / 蓝色 `#7db4ff→#1e3a8a`），眼睛恒 `#fff`，阴影写死 `rgba(0,0,0,…)`；**亮暗两套主题下球完全一样** | 球不参与主题；渐变背景本身无法 CSS transition，主题真要改球色会硬跳 |
| 硬编码色值 | 少 | `App.css` 与各组件里有散落的写死色（如 `#eab308`、组件内约 10 处 hex、内联 `rgba(0,0,0,…)` 阴影） | 任何一处写死色在切换时都不会动，会成为"跳变点" |
| 减少动效 | 有降级 | 有（`App.css:1933` 全局把动画/过渡压到 0.01ms；`Boot.tsx:39`） | 保留，切换降级要沿用同一条线 |

**一句话总结缺口**：现在咱们的主题切换 = 一个改 class 名的二态开关。颜色是令牌化的（这点底子不错），
但切换瞬间全站硬跳、启动三连闪、球不参与、没有跟随系统、没有任何过渡质感可言。

---

## 3. 「比它更好」的具体做法

### 3.1 设计原则：切换是一次全站一起完成的渐变，不是两次状态的拼接

- **全站一起动**：同一个 700ms 手势里，所有表面、文字、边框、阴影、滚动条、球、画布粒子一起渐变。
  验收标准是"没有掉队者"——任何一个区域先跳变或后跳变，都是 bug。
- **先柔后锐**：揭示边缘是羽化的（见 3.2），不是初代那种硬圆环。
- **颜色先行、揭示收尾**：颜色淡化 450ms 比揭示 700ms 先结束，揭示收尾时颜色早已落定，
  不会出现"揭示过去了、某块颜色还在追"的拖尾感。
- **只动颜色**：过渡只挂 `background-color / border-color / color / box-shadow / outline-color / fill / stroke`，
  绝不写 `transition: all`——transform / opacity 永远归弹簧系统管（`--spring` / `--ease`）。
- **切换本身就是反馈**：揭示 + 图标变形 + 球眨眼就是全部反馈，不弹 toast（初代弹 toast 是多余的噪音）。

### 3.2 两层过渡叠加（核心机制）

**A 层——羽化圆形揭示（View Transitions API，700ms）**

沿用初代"从按钮中心扩散"的思路（眼睛跟着手走，这点是对的），但把硬边换成羽化边：

- 用 `@property` 注册一个可动画的自定义属性 `--wipe-r`（长度类型），在 `::view-transition-new(root)` 上用
  `mask-image: radial-gradient(circle at var(--vt-x) var(--vt-y), black calc(var(--wipe-r) - 80px), transparent var(--wipe-r))`
  代替 `clip-path`——80px 的羽化带让新旧主题的交界是一段柔和的渐变，而不是一道锐利的圆环。
  圆心 `--vt-x / --vt-y` 取主题按钮中心；半径从 0 动画到"到最远角距离 + 64px 余量"（初代是 +48px，余量给够才不会留死角）。
- 时长 **700ms**（初代 620ms，略放慢才从容），缓动走产品自己的 **`--ease-exp: cubic-bezier(0.645, 0.045, 0.355, 1)`**
  （与 grokbot-animation-spec.md 的 expo 曲线同一条，`--ease-exp` 已在 `App.css:10` 定义）。
- `::view-transition-old(root) { animation: none; }`（旧快照冻结，照抄初代这句）。
- 降级：不支持 View Transition API 时只走 B 层；`prefers-reduced-motion` 时不要揭示、B 层缩到 200ms。

**B 层——全站颜色交叉淡化（450ms，兜底 + 打底）**

- 切换期间给根元素挂临时 class `.theme-animating`，CSS 里写：
  `.theme-animating *, .theme-animating *::before, .theme-animating *::after { transition: background-color 450ms var(--ease), border-color 450ms var(--ease), color 450ms var(--ease), box-shadow 450ms var(--ease), outline-color 450ms var(--ease), fill 450ms var(--ease), stroke 450ms var(--ease); }`
  切换结束（700ms 后）摘掉 class，避免这条全局过渡干扰日常 hover 等微交互。
- 时长 **450ms**（初代 260ms 太赶；450ms 能让渐变被眼睛读到"在渐变"，又不至于拖沓），
  缓动走 **`--ease: cubic-bezier(0.22, 1, 0.36, 1)`**（产品标准缓动，`App.css:11` 已有；
  与规范里"UI 控件 0.24s ease-out"是同一条语言，只是主题切换需要更长的时长）。
- 450ms ＜ 700ms：颜色先落定、揭示后收尾，不拖尾。
- 这一层同时也是无 View Transition 环境下的唯一过渡——在任何浏览器里都保证"绝不忽然变黑"。

**为什么两层叠加才够**：只有揭示，没有颜色淡化，揭示边缘扫过的地方是硬切；只有淡化，没有揭示，
全站一起变会显得平、没有方向感。揭示给方向（从按钮漾开），淡化给质感（每处颜色都在渐变），
羽化边把两者缝起来——三者缺一不可。

### 3.3 时长与缓动总表（定死，不许各写各的）

| 元素 | 时长 | 缓动 | 备注 |
|---|---|---|---|
| 圆形揭示（羽化边） | 700ms | `--ease-exp` (0.645, 0.045, 0.355, 1) | 从主题按钮中心扩散，羽化带 80px |
| 全站颜色淡化 | 450ms | `--ease` (0.22, 1, 0.36, 1) | `.theme-animating` 期间挂载，结束后摘掉 |
| 太阳/月亮图标变形 | 400ms | `--spring` (0.34, 1.45, 0.5, 1) | 旋转 + 缩放进出，带一点弹簧感；图标交叉淡化 200ms |
| 球（Mark） | 450ms | `--ease` | 两层渐变叠加、透明度交叉淡化；切换瞬间补一次眨眼（160ms 闭合，与现有眨眼同一节奏） |
| 画布粒子（Boot） | 450ms | 线性插值 | JS 里对粒子颜色做 lerp，不重启粒子场、不跳色 |
| 滚动条 / 原生控件 | 跟随 `color-scheme` | — | 不单独做过渡，`color-scheme` 切换即跟随 |
| 减少动效时 | 揭示取消，淡化 200ms | `ease` | 沿用现有 `prefers-reduced-motion` 降级线 |

### 3.4 全站令牌化（消灭跳变点）

1. **令牌上移到文档级**：颜色令牌从 `.theme-light / .theme-dark`（挂在 `.app` div 上）搬到
   `:root`（暗色默认）+ `html[data-theme='light']`（浅色覆盖），照抄初代的结构。
   主题从此是文档级事实：启动屏、抽屉、滚动条、原生控件全部自动跟随；React 只负责改 `data-theme`，
   不再靠 div class。
2. **每套主题设 `color-scheme`**：`:root { color-scheme: dark; }` / `html[data-theme='light'] { color-scheme: light; }`（初代有，我们没有）。
3. **浅色令牌按对比度重调，不是简单反色**：照抄初代的做法——浅底上次级文字压到 4.5:1 以上；
   品牌 accent 浅色 `#2563eb` / 深色 `#60a5fa`（现有值已对，保留）；阴影两套分开定
   （现有 `--shadow / --shadow-sm` 两套值已对，保留并全站统一用它们）。
4. **审计并清掉写死色**：`App.css` 与各组件里所有不在令牌块内的 hex / rgba 全部过一遍，
   要么进令牌，要么写明例外。重点三处：
   - `Mark.tsx` 的两套球渐变与阴影：改成主题感知变量（见 3.6）；
   - 画布粒子颜色：从 `getComputedStyle` 读令牌，不许写死（初代 `effects.js` 就是这么做的）；
   - 任何内联 `style={{ color: '#…' }}`：清零。
5. **不许新增 `transition: all`**：已有几处 `transition: all` 顺手清掉（初代的教训）。

### 3.5 首屏零闪烁（三层防御，缺一不可）

问题根因：主题存在 Rust 设置文件里，webview 在 React 挂载 + `get_settings` 返回前不知道主题；
而现在窗口底色写死 `#0b0b0c`（近黑）、启动屏写死浅色，导致深色用户启动三连闪、浅色用户先闪黑。

1. **Rust 侧窗口底色跟主题走**：启动时先读设置文件，再建窗口，把窗口 `backgroundColor` 设成
   保存主题对应的底色（浅色 `#f7f7f5` / 深色 `#141414`），不要写死 `#0b0b0c`。
   这是第一帧的颜色，在任何 JS 跑起来之前就生效。
2. **初始化脚本在首绘前定主题**：Rust 侧用 `initialization_script` 在页面脚本之前注入
   `document.documentElement.dataset.theme = '<保存的主题>';`（读设置文件得到的值）。
   同时把主题镜像一份到 localStorage（只做首绘缓存，Rust 设置文件仍是唯一事实来源），
   再加一段 `index.html` 内联脚本做兜底：localStorage → `prefers-color-scheme` → 默认浅色（Rust 默认值）。
   这一层照抄初代 `index.html` 内联脚本的思路，但数据源从 localStorage 换成 Rust 设置。
3. **启动屏去掉写死浅色**：`App.tsx:773` 的 `theme-light` 硬编码删掉——令牌上移到文档级后，
   启动屏自动就是对的主题；`index.html` 再给 `html` 一个与默认主题一致的底色，双保险。

### 3.6 球与品牌色在亮暗两套主题下的走法

- **球不换身份，只换光**：诺玛仍是墨色、EVA 仍是蓝色（产品铁律），亮暗主题只调"光感"——
  浅色主题下墨球的渐变 stops 整体提亮一档（避免黑球在白底上死黑）、蓝球加深一档（保证在白底上的对比）；
  深色主题保持现有两套渐变。眼睛恒为白色（已有规范，不动）。
- **渐变无法 transition 的解法**：球体用两层叠加——底层放当前主题的渐变，顶层放目标主题的渐变，
  切换时顶层透明度 0→1 做 450ms 交叉淡化（与 B 层同时长）；阴影用令牌化的 `--shadow`，跟着 B 层走。
  切换瞬间球补一次眨眼（160ms，与现有自主眨眼同一节奏）——主题切换的那个瞬间，球像"眨了下眼适应光线"，
  是整个切换里最有生命感的一笔。
- **品牌色**：accent 两套值已对（浅 `#2563eb` / 深 `#60a5fa`），不动；不要学初代的金色（产品不要金色）。

### 3.7 跟随系统与手动选择的关系、持久化

- 设置项从二态改成**三态**：`light | dark | system`（`types.ts:6` 的 `Theme` 类型要扩；
  `settings.rs` 的 `theme: String` 注释同步）。默认 `system`。
- **实时跟随**：`system` 模式下监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件，
  系统切了、应用跟着切，走同一套 700ms + 450ms 过渡（初代只在首次用系统偏好，我们要做到实时跟随）。
- **手动优先**：用户点一次浅色/深色，即退出 `system`、记为手动选择并持久化到 Rust 设置文件；
  设置里留一个"跟随系统"选项可随时回去。手动选择后改系统主题，应用不动。
- **持久化**：Rust 设置文件是唯一事实来源；localStorage 只存一份镜像供首绘脚本读，
  每次 `patchSettings` 改主题时同步写镜像。两个来源不一致时以 Rust 文件为准。

### 3.8 高标准：切换本身要做得足够高级（回应"前端太平庸"）

- **切换是签名级动效**：它是全站少数几次全屏动效之一，按这个标准验收——
  羽化边看不见硬环、所有区域同时动、圆心就是手指点的按钮、球跟着眨眼。
  做完之后，切换主题应该是一件让人想再点一次的事。
- **克制**：高级感来自"所有东西一起、柔和、恰好"，不是堆特效——不加额外的粒子、闪光、音效；
  揭示 + 淡化 + 图标变形 + 球眨眼就是全部，700ms 内收束干净。
- **不抄长相、只学机制**：圆形揭示的"从按钮扩散"学初代，但羽化边、时长、缓动、球眨眼、
  首屏三层防御都是我们自己的；初代的金色、toast、硬边、260ms 都不学。

---

## 4. 实施步骤（按顺序，React + Tauri）

> 约束：第 1 步（React 接原生引擎）正在 `app/src/` 里跑——本计划只写文档、不改代码。
> 实施时按下面顺序做，同一批改动不要和第 1 步抢文件；先做 1–3 步拿到"不跳变"，再做 4–8 步拿到"高级感"。

1. **令牌上移**：`App.css` 颜色令牌从 `.theme-light/.theme-dark` 搬到 `:root` + `html[data-theme='light']`；
   加两套 `color-scheme`；`index.html` 加 `theme-color` meta（随切换更新）。
2. **写死色审计**：全站扫一遍 hex / rgba，全部进令牌或写明例外；重点是 `Mark.tsx`、画布、内联 style。
3. **B 层先行**：加 `.theme-animating` 全局颜色过渡（450ms `--ease`，只挂颜色属性）+ 切换 helper
   （`lib/theme.ts`：改 `data-theme` → 挂/摘 class → 同步 localStorage 镜像 → `patchSettings`）。
   做完这步，切换已是"全站一起渐变"，先达到"绝不忽然变黑"。
4. **A 层揭示**：`@property --wipe-r` 注册 + `::view-transition-new(root)` 的 mask 羽化揭示（700ms `--ease-exp`，
   羽化带 80px，圆心取按钮中心，半径到最远角 + 64px）；`::view-transition-old(root)` 动画 none。
5. **按钮**：主题切换做成独立组件（顶栏 + 设置抽屉共用），太阳/月亮旋转 + 缩放进出（400ms `--spring`），
   交叉淡化 200ms；去掉"☀ 浅色 / ☾ 深色"纯文字按钮。
6. **球**：`Mark.tsx` 两层渐变叠加 + 450ms 透明度交叉淡化；主题切换时触发一次眨眼；浅色主题的球 stops 提亮/加深一档。
7. **画布**：Boot 粒子颜色改读令牌，切换时 450ms 内插值过渡，不重启粒子场。
8. **首屏三层防御**：Rust 读设置定窗口 `backgroundColor` → `initialization_script` 注入主题 →
   `index.html` 内联脚本兜底；删掉 `App.tsx:773` 写死 `theme-light`。
9. **三态设置**：`Theme` 扩成 `light | dark | system`；`system` 模式监听系统变化实时跟随；
   设置 UI 改成三态选择（浅色 / 深色 / 跟随系统），默认 `system`。
10. **减少动效**：`prefers-reduced-motion` 时揭示取消、淡化 200ms；沿用现有降级线。

---

## 5. 验证方法（肉眼验收标准）

- **逐帧检查**：60fps 录屏，逐帧看——任何一帧里都不许出现"一块区域已是新色、相邻区域还是旧色"的硬边界；
  羽化带必须看得见；**全程不许出现纯黑帧**（尤其浅→深：亮色是渐渐褪掉的，不是切掉的）。
- **掉队者检查**：切一次主题，盯住侧栏、对话区、右栏、输入框、抽屉、滚动条、球、代码块——
  全部要同时动；任何一个先跳或后跳的元素都是 bug（缺过渡或写死色）。
- **首屏检查**：分别保存浅色 / 深色后杀掉重开，启动第一帧就必须是对的主题——
  无白闪、无黑闪、无"先亮后暗"的翻转。三种组合都要测（浅色保存、深色保存、首次无保存跟系统）。
- **球检查**：切换时球的渐变是交叉淡化的（不是硬切），且补了一次眨眼；浅色下球不死黑、蓝球对比够。
- **系统跟随检查**：`system` 模式下改系统主题，应用跟着平滑切；手动模式下改系统主题，应用不动。
- **连点检查**：快速连点 5 次切换，不许卡在半态、不许动画排队堆积（实现里要加防重入：进行中忽略新切换或干净重启）。
- **减少动效检查**：开系统减少动效再切——无揭示、只有 200ms 短淡化。
- **截图留档**：Xvfb 下在切换后 0 / 150 / 350 / 700ms 各截一张，留作这版过渡的视觉凭证。
