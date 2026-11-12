import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentResult,
  ChatMsg,
  CodexInfo,
  InspectorView,
  Mode,
  Project,
  ReviewFile,
  ReviewState,
  Settings,
  Task,
} from "./types";
import {
  GREETING_TASKS,
  THEME_KEY,
  EFFORT_LABELS,
  MODE_LABELS,
  folderName,
  greetingForHour,
  resolveTheme,
  uid,
} from "./types";
import type { Effort, Theme } from "./types";
import Boot from "./components/Boot";
import TitleBar from "./components/TitleBar";
import Mark, { type MarkState } from "./components/Mark";
import { stateFor } from "./components/mark/ballAdapter";
import Sidebar from "./components/Sidebar";
import Composer from "./components/Composer";
import ConnectWizard from "./components/ConnectWizard";
import RightPanel, { type MergeSummary } from "./components/RightPanel";
import {
  ArchiveDrawer,
  CommandPalette,
  HelpDrawer,
  SettingsModal,
} from "./components/Drawers";
import { getCommands, type SettingsNav } from "./components/commands";

const TASKS_KEY = "cassell.tasks.v1";
/** P0-1：项目列表与当前项目 id 的持久化——跟任务列表走同一套机制
 *（localStorage，一样的 try/catch 兜底，不发明新办法）。 */
const PROJECTS_KEY = "cassell.projects.v1";
const ACTIVE_PROJECT_KEY = "cassell.active-project.v1";

/**
 * Wave 2 (S5+S6) 样式增量。App.css 不在本波文件清单内，所以本波新增的
 * class 与覆盖全部放在这里（<style> 在 body 内、晚于 head 里的 App.css，
 * 加上 .app 前缀提权后，同名规则以这里为准）。令牌全部复用 S0 的
 * --bg-rail / --bg-canvas / --accent 等，不引入新颜色。
 */
const WAVE2_CSS = `
.app .sidebar { width: 232px; background: var(--bg-rail); }
.app .main { background: var(--bg-canvas); }
.app .chat { padding: 24px 24px 24px; }
.app .composer-slot { padding: 8px 24px 24px; }
.app .msg-usage { font-family: var(--mono); }
/* ---- L1 安静状态行：对话区顶部一行 12px 小字，无底无边框 ---- */
.w2-l1 { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font-size: 12px; color: var(--text-3); padding: 8px 24px; background: none; border: none; transition: color 150ms var(--ease); }
.w2-l1:hover { color: var(--text-2); }
.w2-l1 .w2-dot { margin-left: 0; }
/* ---- 侧栏名册 ---- */
.w2-roster { display: flex; flex-direction: column; gap: 4px; }
.w2-roster-row { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px 8px 12px; border-radius: 8px; transition: background 150ms var(--ease); }
.w2-roster-row:hover { background: var(--bg-hover); }
.w2-roster-row.w2-on { background: var(--accent-soft); }
.w2-roster-name { font-size: 13px; font-weight: 600; line-height: 1.4; }
.w2-roster-sub { font-size: 11px; color: var(--text-3); line-height: 1.4; }
.w2-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-left: auto; }
.w2-dot.ok { background: var(--ok); }
.w2-dot.busy { background: var(--accent); }
.w2-dot.idle { background: var(--text-3); }
.w2-dot.warn { background: var(--accent); }
/* ---- 状态 pill（11px） ---- */
.w2-pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--bg-soft); color: var(--text-2); white-space: nowrap; flex-shrink: 0; }
.w2-pill.run { background: var(--accent-soft); color: var(--accent); }
.w2-pill.done { background: var(--ok-soft); color: var(--ok); }
.w2-pill.bad { background: var(--danger-soft); color: var(--danger); }
/* ---- 侧栏轻量行按钮（新建 / 搜索入口） ---- */
.w2-side-action { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 12px; border-radius: 8px; font-size: 13px; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease); }
.w2-side-action:hover { background: var(--bg-hover); color: var(--text); }
.w2-kbd { margin-left: auto; font-size: 11px; color: var(--text-3); font-family: var(--mono); }
.w2-search-input { width: 100%; border-radius: 8px; background: var(--bg-panel); color: var(--text); padding: 8px 12px; outline: none; font-size: 13px; animation: w2-fade 150ms var(--ease) both; }
.w2-search-input:focus { box-shadow: 0 0 0 3px var(--accent-soft); }
/* ---- 段位牌 ---- */
/* ---- 段位牌 · 卡塞尔学院专员证件（Deline 6 根本重做）----
 * 横向名片比例（约 208×122，1.7:1），三行：发证行（线条校徽 22px + 卡塞尔学院 +
 * S 印章）/ 身份行（名字 + 编号 + 在线并在一行）/ 图标行。S 印章回归定版：
 * 大号优雅衬线 S（Georgia 500）+ 1px 浅色发丝圆环，无实心圆底、无“血统评级”文字；
 * EVA 态 S 与环同步变 accent 色。 */
.w2-rank { background: var(--bg-panel); border-radius: 16px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
.w2-rank-top { display: flex; align-items: center; gap: 8px; }
.w2-rank-school { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--text-2); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w2-crest { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; color: var(--text); flex-shrink: 0; }
.w2-crest svg { width: 100%; height: 100%; display: block; }
.w2-rank-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.w2-rank-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; white-space: nowrap; }
.w2-seal { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--serif); font-size: 17px; font-weight: 500; color: var(--text); background: none; border: 1px solid var(--border-strong); margin-left: auto; flex-shrink: 0; }
.w2-rank-id { font-family: var(--mono); font-size: 11px; color: var(--text-3); display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.w2-icon-nav { display: flex; gap: 4px; }
.w2-icon-btn { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease); }
.w2-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
.w2-icon-btn.w2-on { background: var(--accent-soft); color: var(--accent); }
.w2-invite { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.w2-invite button { font-size: 11px; color: var(--accent); padding: 2px 4px; border-radius: 4px; }
/* ---- 时间线三档：B 内联卡片 / C 安静状态行 ---- */
.w2-card { border-radius: 16px; background: var(--bg-panel); overflow: hidden; box-shadow: var(--shadow-sm); transition: box-shadow 150ms var(--ease); }
.w2-card:hover { box-shadow: var(--shadow); }
/* ---- 报错卡重做（去线条 + 去 2012）：无框、无红底、无 pill、无蓝主按钮 ----
 * 错误就是一条普通的助手回合：球头像 + 红色 600 字重标题行 + 14px 正文
 * + 12px 弱色提示；重试是行内文字链（accent 色、带 →、悬停下划线），
 * 自然融入对话流，不像个报错弹窗。红色全站只用在这一行标题。 */
.w2-err { flex: 1; min-width: 0; padding-top: 4px; }
.w2-err-title { font-size: 13px; font-weight: 600; color: var(--danger); line-height: 1.5; }
.w2-err-body { font-size: 14px; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; margin-top: 4px; }
.w2-err-hint { font-size: 12px; color: var(--text-3); line-height: 1.6; margin-top: 8px; }
.w2-err-retry { background: none; border: none; padding: 0; margin-top: 10px; font-size: 13px; font-weight: 600; color: var(--accent); cursor: pointer; transition: opacity 150ms var(--ease); }
.w2-err-retry:hover { opacity: 0.8; text-decoration: underline; }
.w2-card-head { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 12px; font-size: 12px; color: var(--text-2); }
.w2-card-title { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 40%; }
.w2-card-sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; color: var(--text-3); font-size: 12px; }
.w2-card-body { padding: 0 12px 12px; font-size: 13px; line-height: 1.65; color: var(--text-2); white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; animation: w2-fade 150ms var(--ease) both; }
.w2-card-body .w2-card-link { font-size: 12px; color: var(--accent); padding: 4px 0 0; }
.w2-quiet { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); background: none; border: none; padding: 2px 0; transition: color 150ms var(--ease); }
.w2-quiet:hover { color: var(--text-2); }
.msg.eva-note-row { flex-direction: column; align-items: flex-start; gap: 8px; }
/* ---- 新消息：150ms 淡入 + 4px 上移，一次性；无 stagger 入场 ---- */
@keyframes w2-msg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.w2-live { animation: w2-msg-in 150ms var(--ease) both; }
@keyframes w2-fade { from { opacity: 0; } to { opacity: 1; } }
/* ---- Inspector（L2 浮层，不挤压对话区） ---- */
.w2-inspector { position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 92vw; z-index: 60; display: flex; flex-direction: column; background: var(--bg-panel); box-shadow: var(--shadow); animation: w2-insp-in 240ms var(--ease-exp) both; }
.w2-inspector.w2-wide { width: 480px; }
@keyframes w2-insp-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
.w2-insp-head { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px 12px 8px; }
.w2-insp-title-row { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.w2-seg { display: flex; flex: 1; gap: 2px; background: var(--bg-soft); border-radius: 999px; padding: 2px; overflow-x: auto; scrollbar-width: none; min-width: 0; }
.w2-seg::-webkit-scrollbar { display: none; }
.w2-seg button { flex: 1; white-space: nowrap; font-size: 12px; padding: 6px 8px; border-radius: 999px; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease), box-shadow 150ms var(--ease); }
.w2-seg button.w2-on { background: var(--bg-panel); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
.w2-insp-body { flex: 1; overflow-y: auto; padding: 16px; min-height: 0; }
.w2-view { animation: w2-fade 150ms var(--ease) both; }
/* ---- Composer 瘦身 ---- */
.app .popover { width: 280px; padding: 12px; }
.w2-model-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 0; line-height: 1.4; padding: 6px 12px; min-width: 0; }
.w2-model-chip .w2-m1 { font-size: 13px; font-weight: 600; color: var(--text); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.w2-model-chip .w2-m2 { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.w2-mode-chip { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; border-radius: 999px; font-size: 13px; font-weight: 600; transition: background 150ms var(--ease); }
.w2-mode-chip:hover { background: var(--bg-hover); }
.w2-shield { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
.w2-shield .w2-dot { margin-left: 0; }
.app .effort-row { display: flex; gap: 0; background: var(--bg-soft); border-radius: 8px; padding: 2px; flex-wrap: nowrap; }
.app .effort { flex: 1; border: none; padding: 6px 2px; font-size: 12px; text-align: center; }
.w2-pop-back { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-3); padding: 4px 8px; margin-bottom: 4px; width: 100%; text-align: left; border-radius: 8px; }
.w2-pop-back:hover { background: var(--bg-hover); color: var(--text); }
/* ---- W4 · EVA 切换仪式（1350ms，分拍变身/呼气收尾） ----
 * 球的分拍包络在 useBallEngine.ritualEnvelope（收束→闪烁→展开 / 呼气→回暖），
 * spin 整圈是球的第二拍（startedAt+150ms 起转、1200ms 转满）；这里只管界面层：
 * - 面纱（veil）：一层淡蓝/暖灰光晕从标题栏球的位置（顶部约 22% 处）漫开再收住，
 *   界面跟着“吸一口气/呼一口气”，背景微微变冷/回暖；落定后由稳态光晕接手。
 * - 顶线（sweep）：已删——1350ms 瞬态的 2px 硬线是用户最讨厌的东西，面纱光晕已足够承载仪式。
 * - 稳态光晕（steady-halo）：EVA 期间常驻的极淡蓝顶光（已有球身蓝光晕的延续），
 *   800ms 淡入淡出；切回诺玛时随之褪去。
 * - 顶栏球包（wrap）：to-EVA 两圈单色涟漪（第二圈延迟 150ms），to-诺玛一次
 *   柔和呼气缩放（无旋转——收尾不是反向变身）。
 * 全部 pointer-events: none，不挡输入；颜色只走令牌/低透明度 accent。 */
.w4-veil { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
.w4-veil-eva { background: radial-gradient(ellipse 70% 55% at 22% 0%, rgba(96, 165, 250, 0.14), transparent 70%); animation: w4-veil-eva 1350ms var(--ease) both; }
@keyframes w4-veil-eva { 0% { opacity: 0; } 30% { opacity: 1; } 70% { opacity: 0.45; } 100% { opacity: 0; } }
.w4-veil-norma { background: radial-gradient(ellipse 70% 55% at 22% 0%, rgba(214, 200, 170, 0.10), transparent 70%); animation: w4-veil-norma 1350ms var(--ease) both; }
@keyframes w4-veil-norma { 0% { opacity: 0; } 30% { opacity: 0.8; } 100% { opacity: 0; } }
.w4-steady-halo { position: fixed; inset: 0; z-index: 1; pointer-events: none; background: radial-gradient(ellipse 60% 220px at 22% 0%, rgba(96, 165, 250, 0.05), transparent 70%); opacity: 0; transition: opacity 800ms var(--ease); }
.w4-steady-halo.on { opacity: 1; }
.w4-wrap { display: inline-flex; position: relative; }
.w4-wrap-eva::after, .w4-wrap-eva::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 1px solid var(--accent); opacity: 0; animation: w4-ripple 1350ms var(--ease) both; pointer-events: none; }
.w4-wrap-eva::before { animation-delay: 150ms; }
@keyframes w4-ripple { 0% { opacity: 0.55; transform: scale(0.8); } 35% { opacity: 0.35; } 100% { opacity: 0; transform: scale(1.7); } }
.w4-wrap-norma { animation: w4-exhale 1350ms var(--ease) both; }
@keyframes w4-exhale { 0% { transform: scale(1); } 30% { transform: scale(0.98); } 100% { transform: scale(1); } }
/* ---- W4 · 侧栏名册与段位牌在仪式中的变化 ----
 * 名册行：切入的行高亮从透明扫入（与 w2-on 的 accent-soft 落点一致），
 * 切出的行高亮淡出；切入行的状态点在仪式里脉冲一次。段位牌：to-EVA 时
 * 卡面由 panel 洗成 accent-soft（EVA 期间常驻 w4-rank-eva-on 洗色 + 柔蓝光晕），
 * to-诺玛时洗色褪去——不画 1px 蓝环（去线条）。 */
.w4-roster-in { animation: w4-roster-in 1350ms var(--ease) both; }
@keyframes w4-roster-in { 0% { background: transparent; } 25% { background: var(--accent-soft); } 100% { background: var(--accent-soft); } }
.w4-roster-out { animation: w4-roster-out 1350ms var(--ease) both; }
@keyframes w4-roster-out { 0% { background: var(--accent-soft); } 100% { background: transparent; } }
.w4-roster-in .w2-dot { animation: w4-dot-pulse 1350ms var(--ease) both; }
@keyframes w4-dot-pulse { 0% { transform: scale(1); } 25% { transform: scale(1.8); } 55% { transform: scale(1); } 100% { transform: scale(1); } }
.w4-rank-eva { animation: w4-rank-eva 1350ms var(--ease) both; }
@keyframes w4-rank-eva { 0% { background: var(--bg-panel); box-shadow: var(--shadow-sm); } 30% { background: color-mix(in srgb, var(--accent-soft) 55%, var(--bg-panel)); box-shadow: 0 8px 28px rgba(96, 165, 250, 0.16); } 100% { background: color-mix(in srgb, var(--accent-soft) 45%, var(--bg-panel)); box-shadow: 0 8px 24px rgba(96, 165, 250, 0.12); } }
.w4-rank-eva-on { background: color-mix(in srgb, var(--accent-soft) 45%, var(--bg-panel)); box-shadow: 0 8px 24px rgba(96, 165, 250, 0.12); }
.w4-rank-eva-on .w2-seal { color: var(--accent); border-color: var(--accent); }
.w4-rank-norma { animation: w4-rank-norma 1350ms var(--ease) both; }
@keyframes w4-rank-norma { 0% { background: color-mix(in srgb, var(--accent-soft) 45%, var(--bg-panel)); box-shadow: 0 8px 24px rgba(96, 165, 250, 0.12); } 100% { background: var(--bg-panel); box-shadow: var(--shadow-sm); } }
/* ---- 矮窗口紧凑模式（≤760px 高）保留 ---- */
@media (max-height: 760px) {
  .app .empty-state { gap: 8px; }
  .app .chat { padding-top: 12px; gap: 12px; }
  .app .composer-slot { padding-bottom: 12px; }
}
/* ---- W6 · S8 自定义窗口框 + P2-21 审查与对话同屏 ----
 * .app 从横向三栏改成纵向：标题栏（40px）在上，三栏壳在下。壳是新包的
 * 一层 flex 行，Sidebar / main / Inspector 的横向关系原封不动。
 * Inspector 顶缘对齐标题栏底边（top: 40px）：浮层再也不盖标题栏，
 * 窗口按钮在 Inspector 打开时始终可点。
 * P2-21 用方案 ① 的“固定浮层 + 主区同步留白”：.w2-inspector 保持 fixed
 * （不改成文档流第三栏——改文档流要动 .app 的 flex 结构与 Inspector 的
 * 滑入动画，风险大）；只在 review 视图下 main 加 margin-right（360px，
 * wide 时 480px），与浮层宽度一一对应，二者只留一份白、不叠加。
 * 其他视图（终端/文件/浏览器/插件/工作流）保持浮层、不挤压对话区。
 * margin-right 走 240ms --ease-exp，停靠/脱离不跳变。 */
.app { flex-direction: column; }
.w6-shell { display: flex; flex: 1; min-height: 0; }
.w6-shell-in { animation: w6-shell-fade 300ms var(--ease) both; }
@keyframes w6-shell-fade { from { opacity: 0; } to { opacity: 1; } }
.app .main { transition: margin-right 240ms var(--ease-exp); }
.w2-inspector { top: 40px; }
@media (prefers-reduced-motion: reduce) { .w6-shell-in { animation-duration: 0.01ms !important; } }
`;

/**
 * S7 样式增量（设置 modal + Cmd-K + 通知）。App.css 不在本波文件清单内，
 * 所以本波新增的 class 全部放在这里（<style> 在 body 内、晚于 head 里的
 * App.css，加上 .s7 前缀避免与旧规则冲突）。令牌全部复用 S0 的令牌。
 * 动效按 §4 的表走：modal 240ms --ease-exp（缩放 + 淡入），面板 150ms
 * --ease-exp（淡入 + 4px 上移），列表项 hover/选中 100ms --ease。
 */
const S7_CSS = `
.s7-overlay { position: fixed; inset: 0; z-index: 80; background: var(--scrim); display: flex; align-items: center; justify-content: center; animation: s7-fade 150ms var(--ease) both; }
@keyframes s7-fade { from { opacity: 0; } to { opacity: 1; } }
.s7-modal { width: 640px; max-width: calc(100vw - 48px); max-height: calc(100vh - 96px); background: var(--bg-panel); color: var(--text); border-radius: 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden; animation: s7-modal-in 240ms var(--ease-exp) both; }
@keyframes s7-modal-in { from { opacity: 0; transform: scale(0.98) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.s7-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.s7-modal-title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.4; }
.s7-modal-body { display: flex; flex: 1; min-height: 0; padding-top: 12px; }
.s7-nav { width: 160px; flex-shrink: 0; padding: 4px 12px 24px 16px; display: flex; flex-direction: column; gap: 4px; }
.s7-nav button { position: relative; text-align: left; padding: 8px 12px; border-radius: 8px; font-size: 13px; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease); }
.s7-nav button:hover { background: var(--bg-hover); color: var(--text); }
.s7-nav button.on { background: var(--accent-soft); color: var(--text); font-weight: 600; }
.s7-content { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 24px 24px; animation: s7-fade 150ms var(--ease) both; }
.s7-group { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
.s7-group:first-child { padding-top: 4px; }
.s7-group:last-child { padding-bottom: 0; }
.s7-group .drawer-section { margin-top: 0; }
.s7-identity { display: flex; align-items: center; gap: 8px; }
.s7-identity-name { font-size: 14px; font-weight: 600; }
.s7-identity-id { font-family: var(--mono); font-size: 12px; color: var(--text-3); }
.s7-key-row { display: flex; gap: 8px; align-items: center; }
.s7-key-row .field-input { flex: 1; min-width: 0; }
.s7-key-state { font-size: 13px; color: var(--text-3); }
.s7-empty { display: flex; flex-direction: column; gap: 4px; border-radius: 12px; padding: 12px; font-size: 13px; color: var(--text-2); background: var(--bg-soft); }
.s7-empty span { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.s7-empty .btn-ghost { align-self: flex-start; color: var(--accent); padding: 4px 0; }
.s7-kbd-list { display: flex; flex-direction: column; gap: 8px; }
.s7-kbd-list > div { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-2); }
.s7-kbd-list kbd { font-family: var(--mono); font-size: 11px; color: var(--text-2); background: var(--bg-soft); border-radius: 4px; padding: 2px 6px; min-width: 88px; text-align: center; }
/* ---- Cmd-K 命令面板：560px 居中，150ms --ease-exp 淡入 + 4px 上移 ---- */
.s7-palette-overlay { position: fixed; inset: 0; z-index: 90; background: var(--scrim); display: flex; justify-content: center; padding-top: 18vh; animation: s7-fade 150ms var(--ease) both; }
.s7-palette { width: 560px; max-width: calc(100vw - 48px); height: fit-content; max-height: 60vh; background: var(--bg-panel); color: var(--text); border-radius: 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden; animation: s7-palette-in 150ms var(--ease-exp) both; }
@keyframes s7-palette-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.s7-palette-input { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.s7-palette-prompt { font-family: var(--mono); font-size: 12px; color: var(--accent); font-weight: 600; }
.s7-palette-input input { flex: 1; min-width: 0; border: none; outline: none; background: none; font-size: 14px; color: var(--text); }
.s7-palette-esc { font-family: var(--mono); font-size: 11px; color: var(--text-3); background: var(--bg-soft); border-radius: 4px; padding: 2px 6px; }
.s7-palette-list { overflow-y: auto; padding: 8px; }
.s7-palette-group { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-3); padding: 8px 12px 4px; }
.s7-palette-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 12px; border-radius: 8px; font-size: 13px; color: var(--text-2); transition: background 100ms var(--ease), color 100ms var(--ease); }
.s7-palette-item.sel { background: var(--accent-soft); color: var(--text); }
.s7-palette-hint { margin-left: auto; font-size: 11px; color: var(--text-3); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.s7-palette-foot { display: flex; gap: 16px; padding: 8px 16px; font-size: 11px; color: var(--text-3); }
/* ---- 命令执行后的轻反馈（toast 已删，仪式本身就是反馈；只有没有界面可开的命令才落这行小字） ---- */
.s7-notice { position: fixed; left: calc(50% + 116px); bottom: 96px; transform: translateX(-50%); z-index: 95; max-width: 60vw; background: var(--bg-panel); color: var(--text); border-radius: 999px; box-shadow: var(--shadow); padding: 8px 16px; font-size: 13px; line-height: 1.5; animation: s7-notice-in 240ms var(--ease-exp) both; }
@keyframes s7-notice-in { from { opacity: 0; transform: translate(-50%, 4px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { .s7-overlay, .s7-modal, .s7-content, .s7-palette-overlay, .s7-palette, .s7-notice { animation-duration: 0.01ms !important; } }
`;

/**
 * 审计合并样式增量（2026-11-13 可用性审计，P0/P1/P2）。同样放 App.tsx 的
 * <style> 里，不动 App.css（C 留下的惯例）。内容：:focus-visible 焦点环、
 * 消息操作、用量常驻行、回到底部按钮、校徽图片、向导、斜杠面板、设置小件。
 */
const AUDIT_CSS = `
/* ---- P2-18：全站 :focus-visible 焦点环（鼠标点击不显示，键盘导航必须显示） ---- */
.app :focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
/* ---- P2-8（Deline 6）：校徽改线条版（CrestLine），.w2-crest 里不再放 img ---- */
/* ---- 设置 modal 审计小件 ---- */
.app .s7-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; font-size: 12px; color: var(--text-2); background: var(--bg-soft); }
.app .s7-summary-warn { background: var(--accent-soft); }
.app .s7-summary .btn-ghost { white-space: nowrap; }
.app .s7-tag-current { display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 10px; color: var(--accent); background: var(--accent-soft); border-radius: 999px; vertical-align: 1px; }
.app .option.static { cursor: default; }
.app .s7-codex-line { display: flex; flex-direction: column; gap: 6px; }
.app .s7-codex-input { font-size: 12px; padding: 6px 10px; }
/* ---- 向导（ConnectWizard）：复用 s7-modal 壳，窄一点 + 步骤指示 ---- */
.app .s7-wizard { width: 520px; max-width: calc(100vw - 48px); }
.app .s7-wizard-steps { display: flex; gap: 16px; padding: 12px 20px 0; font-size: 12px; color: var(--text-3); }
.app .s7-wizard-steps span { display: flex; align-items: center; gap: 6px; }
.app .s7-wizard-steps b { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--bg-soft); font-size: 11px; font-weight: 600; }
.app .s7-wizard-steps span.on { color: var(--text); }
.app .s7-wizard-steps span.on b { background: var(--accent); color: #fff; }
.app .s7-wizard-steps span.done { color: var(--text-2); }
.app .s7-wizard-steps span.done b { background: var(--accent-soft); color: var(--accent); }
.app .s7-wizard-content { padding: 16px 20px; }
.app .s7-wizard-foot { display: flex; justify-content: flex-end; padding: 0 20px 16px; }
/* 向导里的按钮不换行（“重新测试”被结果文案挤成竖排的问题）。 */
.app .s7-wizard .btn-primary, .app .s7-wizard .btn-ghost { white-space: nowrap; flex-shrink: 0; }
/* ---- 顶栏审查入口徽标（P1-14：有待审时变色） ---- */
.app .w2-review-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--bg-soft); color: var(--text-3); }
.app .w2-review-badge.hot { background: var(--accent); color: #fff; }
/* ---- P1-4：消息操作（悬停出现；出错卡片里重试是主按钮） ---- */
.app .msg { position: relative; }
.app .w2-msg-actions { display: flex; gap: 2px; margin-top: 4px; opacity: 0; transition: opacity 150ms var(--ease); }
.app .msg:hover .w2-msg-actions, .app .w2-msg-actions:focus-within { opacity: 1; }
.app .msg.user .w2-msg-actions { justify-content: flex-end; }
.app .w2-msg-actions button { border: none; background: none; color: var(--text-3); font-size: 11px; padding: 3px 8px; border-radius: 6px; cursor: pointer; transition: background 100ms var(--ease), color 100ms var(--ease); }
.app .w2-msg-actions button:hover { background: var(--bg-hover); color: var(--text); }
.app .w2-msg-actions button.danger:hover { color: #dc2626; }
.app .w2-msg-edit { width: 100%; }
.app .w2-msg-edit textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 8px; background: var(--bg-soft); color: var(--text); font: inherit; padding: 8px 10px; box-shadow: 0 0 0 3px var(--accent-soft); }
.app .w2-msg-edit-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
/* ---- P1-5：用量常驻行（输入框上方；Cmd-K“查看状态与用量”滚动到这里并高亮） ---- */
.app .w2-usage { display: flex; align-items: center; gap: 8px; padding: 6px 4px; font-size: 11px; color: var(--text-3); border-radius: 8px; transition: background 300ms var(--ease); }
.app .w2-usage.flash { background: var(--accent-soft); color: var(--text-2); }
/* ---- P2-19：回到底部按钮（聊天区末尾的 sticky 元素：滚上去时贴在可视区右下角） ---- */
.app .w2-jump { position: sticky; bottom: 16px; align-self: flex-end; z-index: 5; background: var(--bg-panel); color: var(--text-2); border-radius: 999px; padding: 6px 14px; font-size: 12px; box-shadow: var(--shadow); cursor: pointer; animation: s7-notice-in 200ms var(--ease-exp) both; }
.app .w2-jump:hover { color: var(--text); }
/* ---- P2-6/P2-10/P2-22：Composer 斜杠面板 + 附件过滤 ---- */
.app .composer-wrap { position: relative; }
.app .s7-slash { position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); z-index: 30; background: var(--bg-panel); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; animation: s7-palette-in 150ms var(--ease-exp) both; }
.app .s7-slash-list { max-height: 280px; overflow-y: auto; padding: 6px; }
.app .s7-slash .s7-palette-item { padding: 7px 10px; }
.app .attach-filter { width: 100%; margin-bottom: 6px; }
/* ---- P2-20：档案库搜索 + 删除 ---- */
.app .s7-archive-search { margin-bottom: 10px; }
.app .archive-actions { display: flex; gap: 6px; align-items: center; }
/* ---- P2-1：任务行悬停重命名/删除（样式放这里，不动 App.css） ---- */
.app .side-task-wrap { position: relative; }
.app .w2-task-actions { position: absolute; right: 6px; top: 8px; display: none; gap: 4px; z-index: 2; }
.app .side-task-wrap:hover .w2-task-actions, .app .w2-task-actions:focus-within { display: flex; }
.app .w2-task-actions button { border: none; background: var(--bg-panel); color: var(--text-3); font-size: 11px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 6px; cursor: pointer; box-shadow: var(--shadow); }
.app .w2-task-actions button:hover { color: var(--text); }
.app .w2-task-actions button.danger:hover { color: #dc2626; }
.app .w2-task-rename { width: 100%; font-size: 13px; padding: 6px 10px; }
@media (prefers-reduced-motion: reduce) { .app .s7-slash, .app .w2-jump, .app .w2-msg-actions { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
/* ---- P0-1：真项目——侧栏项目行单行只显示名字（路径副标题与任务数徽章已删） ---- */
`;

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 读已保存的项目列表（没有 = 全新用户，返回 []，不凭空编一个）。 */
function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) => p && typeof p.id === "string" && typeof p.name === "string",
    );
  } catch {
    return [];
  }
}

function loadActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

/** EVA 的安静小字行（C 档）：一行 12px 小字，点开看明细。 */
function EvaNote({
  ultracode,
  onInspect,
}: {
  ultracode: boolean;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="msg eva-note-row">
      <button
        type="button"
        className="w2-quiet"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="eva-dot" />
        EVA · 工程开发
        <span className="eva-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="eva-note-detail">
          EVA 模式以工程开发人设执行：先拆解子任务、完成后交叉核查再交付。
          思考强度与 Ultracode 各自独立设置。
          {ultracode
            ? "Ultracode 已开启：开关已传给引擎记录，当前引擎仍为单智能体循环，多智能体并行编排在后续版本接入。"
            : "真正的多智能体并行编排（Ultracode）在后续版本接入；工具调用明细见下方消息。"}
          <button type="button" className="w2-card-link" onClick={onInspect}>
            在 Inspector 中查看 →
          </button>
        </div>
      )}
    </div>
  );
}

/** 思考块（B 档卡片）：标题行 + 状态标签，默认只露标题行；跑完默认收起。 */
function ThinkBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);
  return (
    <div className="msg think">
      <div className="w2-card" style={{ width: "100%" }}>
        <button
          type="button"
          className="w2-card-head"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="w2-card-title">思考过程</span>
          <span className="w2-card-sum">
            {streaming ? "正在思考…" : "已完成"}
          </span>
          <span className={`w2-pill ${streaming ? "run" : "done"}`}>
            {streaming ? "思考中" : "已思考"}
          </span>
          <span>{open ? "▾" : "▸"}</span>
        </button>
        {open && <div className="w2-card-body">{text || "…"}</div>}
      </div>
    </div>
  );
}

/** 工具调用卡（B 档）：标题行 = 工具名（等宽）+ 一句话摘要 + 状态标签。 */
function ToolCard({
  msg,
  onInspect,
}: {
  msg: ChatMsg;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const text = msg.text;
  const arrowIdx = text.indexOf("\n→ ");
  const head = arrowIdx >= 0 ? text.slice(0, arrowIdx) : text;
  const result = arrowIdx >= 0 ? text.slice(arrowIdx + 3) : "";
  const name =
    msg.toolLabel ?? head.replace(/^调用工具：/, "").split("（")[0];
  const argSummary = head.includes("（")
    ? head.slice(head.indexOf("（") + 1, head.lastIndexOf("）"))
    : "";
  const summary = (argSummary || result || "已调用").slice(0, 80);
  return (
    <div className="msg tool">
      <div className="w2-card" style={{ width: "100%" }}>
        <button
          type="button"
          className="w2-card-head"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="w2-card-title">{name}</span>
          <span className="w2-card-sum">{summary}</span>
          <span className="w2-pill">工具</span>
          <span>{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="w2-card-body">
            {argSummary ? `参数：${argSummary}\n` : ""}
            {result ? `结果：${result}` : "正在执行…"}
            <div>
              <button type="button" className="w2-card-link" onClick={onInspect}>
                在 Inspector 中查看 →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 权限 / 询问卡（B 档）：改了什么 + 风险 + 批准/拒绝/稍后处理，批准后留记录行可撤销。 */
function PermCard({ msg }: { msg: ChatMsg }) {
  const [decision, setDecision] = useState<string | null>(
    msg.perm?.decision ?? null,
  );
  const [picked, setPicked] = useState<number | null>(
    msg.ask?.picked ?? null,
  );
  const isAsk = msg.kind === "ask";
  const title = isAsk ? "需要你定一下" : "权限请求";
  const body = isAsk
    ? (msg.ask?.question ?? msg.text)
    : (msg.perm?.command ?? msg.text);
  return (
    <div className="msg">
      <div className="w2-card" style={{ width: "100%" }}>
        <div className="w2-card-head">
          <span className="w2-card-title">{title}</span>
          <span className="w2-card-sum">
            {decision
              ? `已${decision} · 可撤销`
              : picked !== null
                ? `已选第 ${picked + 1} 项 · 可撤销`
                : "等你确认"}
          </span>
          <span className={`w2-pill ${decision || picked !== null ? "done" : "run"}`}>
            {decision || picked !== null ? "已处理" : "待确认"}
          </span>
        </div>
        <div className="w2-card-body">
          <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{body}</div>
          {!isAsk && (
            <div style={{ marginTop: 4 }}>
              此操作会修改工作区，确认后才会执行；随时可以撤销。
            </div>
          )}
          {decision === null && picked === null ? (
            <div
              style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
            >
              {isAsk ? (
                (msg.ask?.options ?? []).map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn-approve"
                    onClick={() => setPicked(i)}
                  >
                    {opt}
                  </button>
                ))
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-approve"
                    onClick={() => setDecision("批准")}
                  >
                    批准
                  </button>
                  <button
                    type="button"
                    className="btn-reject"
                    onClick={() => setDecision("拒绝")}
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setDecision("稍后处理")}
                  >
                    稍后处理
                  </button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <span className="review-state-label ok">
                ✓ {decision ?? `已选第 ${(picked ?? 0) + 1} 项`}
              </span>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setDecision(null);
                  setPicked(null);
                }}
              >
                撤销
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 出错卡重做（去线条 + 去 2012）：无框、无红底、无 pill、无蓝主按钮。
 * 错误就是一条普通的助手回合：球头像 + 红色 600 标题行 + 正文 + 弱色提示，
 * 重试是行内文字链，自然融入对话流。 */
function ErrorCard({ msg, onRetry, eva, fast, ritual, gaze }: {
  msg: ChatMsg;
  onRetry?: () => void;
  eva: boolean;
  fast: boolean;
  ritual: { dir: Mode; startedAt: number } | null;
  gaze: number;
}) {
  return (
    <div className="msg">
      <Mark size={28} eva={eva} state="idle" gaze={gaze} fast={fast} ritual={ritual} />
      <div className="w2-err">
        <div className="w2-err-title">出错了</div>
        <div className="w2-err-body">{msg.text}</div>
        <div className="w2-err-hint">
          可以换个说法再试一次，或检查一下模型配置。
        </div>
        {/* P1-4：出错加“重试”文字链（用同一条 prompt 再跑一轮），不用主按钮。 */}
        {onRetry && (
          <button type="button" className="w2-err-retry" onClick={onRetry}>
            重试 →
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [boot, setBoot] = useState(true);
  /** W6 · 开机→标题栏交接：Boot 的 onDone 在它 300ms 淡出的中途（150ms）
   * 触发，App 随即挂载标题栏 + 三栏壳（300ms 淡入），Boot 再留 150ms 才
   * 卸载——淡出与淡入重叠 150ms 交叉淡化，不许硬切。 */
  const [showShell, setShowShell] = useState(false);
  const bootHideTimer = useRef<number | null>(null);
  const handleBootDone = useCallback(() => {
    setShowShell(true);
    if (bootHideTimer.current) window.clearTimeout(bootHideTimer.current);
    bootHideTimer.current = window.setTimeout(() => setBoot(false), 150);
  }, []);
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  /** P0-1：真项目——列表 + 当前项目 id。持久化与任务列表同一套 localStorage 机制。 */
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    loadActiveProjectId(),
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [merge, setMerge] = useState<MergeSummary | null>(null);
  const [drawer, setDrawer] = useState<"settings" | "archive" | "help" | null>(null);
  const [codexInfo, setCodexInfo] = useState<CodexInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [markState, setMarkState] = useState<MarkState>("idle");
  const [gaze, setGaze] = useState(0);
  /** Inspector（S6）：默认不常驻；null = 关闭，打开时对话画布不重排（浮层）。 */
  const [inspector, setInspector] = useState<InspectorView | null>(null);
  const [inspectorWide, setInspectorWide] = useState(false);
  /** EVA 切换仪式进行中的模式（1200ms 内防重入）；模式切换落行（C 档小字）。 */
  const [ritual, setRitual] = useState<{
    dir: Mode;
    startedAt: number;
  } | null>(null);
  const [modeLine, setModeLine] = useState<string | null>(null);
  /** 系统偏好（亮/暗）：theme === "system" 时实时跟随。 */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  /** 未配 Key 时点发送的拦截提示（文字保留在输入框里）。 */
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  /** S7：Cmd-K 命令面板开关；设置 modal 打开时落在哪个左导航组。 */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsNav, setSettingsNav] = useState<SettingsNav>("model");
  /** S7：命令执行后的轻反馈（一行小字，3.5s 后自动消失）。 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 审计：连接向导开关（只在没配 Key 时由空态 CTA / gate 提示打开）。 */
  const [wizardOpen, setWizardOpen] = useState(false);
  /** 审计 P1-4：消息编辑与删除两步确认。 */
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);
  /** 审计 P1-5：用量行高亮（Cmd-K“查看状态与用量”滚动到这里）。 */
  const [usageFlash, setUsageFlash] = useState(false);
  /** 审计 P2-19：回到底部按钮（离开底部超过一屏时出现）。 */
  const [showJump, setShowJump] = useState(false);
  const [hasNewMsg, setHasNewMsg] = useState(false);

  const settingsRef = useRef<Settings | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  /** handleSend 里要用最新的项目（新建任务时归属当前项目，见 P0-1）。 */
  const projectsRef = useRef<Project[]>([]);
  const activeProjectIdRef = useRef<string | null>(null);
  const markTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  /** 主题切换：B 层收尾定时器 / 是否已做过首次静默应用 / 上次点击的按钮中心。 */
  const themeTimer = useRef<number | null>(null);
  const themeAppliedRef = useRef(false);
  const themeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** 审计 P1-5：用量行锚点（查看状态与用量时滚动到这里）。 */
  const usageRowRef = useRef<HTMLDivElement>(null);
  const ritualRef = useRef(false);
  const ritualTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const modeLineTimer = useRef<number | null>(null);
  /** 本轮开始时间：>60 秒才成功时球发 long-task-done。 */
  const runStartRef = useRef<number>(0);
  /** 本轮消息的 id：原生事件按 id 找气泡，不依赖“最后一条”——工具行插在中间也不会丢增量。 */
  const tasksRef = useRef<Task[]>([]);
  const streamMsgIdRef = useRef<string | null>(null);
  const thinkMsgIdRef = useRef<string | null>(null);
  const lastToolMsgIdRef = useRef<string | null>(null);

  settingsRef.current = settings;
  tasksRef.current = tasks;
  activeTaskIdRef.current = activeTaskId;
  runningRef.current = running;
  projectsRef.current = projects;
  activeProjectIdRef.current = activeProjectId;

  /** 当前项目（找不到时为 null——比如保存的 id 指向已删的项目）。 */
  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  // ---- Theme (S4): 文档级 html[data-theme]，两层过渡 ----
  // 实时监听系统偏好：theme === "system" 时系统一切、应用跟着切。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings
    ? resolveTheme(settings.theme, systemDark)
    : "dark";

  /**
   * 把解析后的亮/暗主题写到 documentElement（CSS 令牌挂在 html[data-theme] 上）。
   * 两层过渡（theme-switch-plan.md §3.2）：
   *  A 层：View Transitions 羽化圆形揭示，700ms，--ease-exp，从 origin（主题按钮中心）扩散；
   *  B 层：.theme-animating 全站颜色交叉淡化，450ms，--ease，700ms 后摘掉。
   * 首次应用是静默的（首绘脚本已经定了正确的主题，不做动画、不发事件）。
   *
   * Wave 2 修复（主题切换 bug）：webkit2gtk 下 document.startViewTransition
   * 存在但可能抛错、或回调不执行，导致 setTheme() 没跑到、dataset.theme
   * 始终停在旧值（按钮标签已变、界面 1200ms 后仍是浅色）。修法：
   * ① 调用包进 try/catch，任何异常立即回退到直接 setTheme()；
   * ② 调用后用 rAF + 150ms / 800ms 两道核对，dataset.theme 不等于目标值
   *    就直接设（View Transition 的回调若晚到，再设一次也是同一值，无害）。
   */
  const applyThemeVisual = useCallback(
    (next: "light" | "dark", origin?: { x: number; y: number }) => {
      const root = document.documentElement;
      const current = root.dataset.theme;
      const isSwitch = themeAppliedRef.current && current !== next;
      if (!themeAppliedRef.current) {
        // 首次：直接落位，不挂过渡、不发事件。
        root.dataset.theme = next;
        themeAppliedRef.current = true;
        return;
      }
      if (!isSwitch) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches;
      const setTheme = () => {
        root.dataset.theme = next;
      };
      // B 层先行：全站颜色交叉淡化（无 View Transition 环境下这就是唯一过渡）。
      root.classList.add("theme-animating");
      if (themeTimer.current) window.clearTimeout(themeTimer.current);
      themeTimer.current = window.setTimeout(
        () => root.classList.remove("theme-animating"),
        reduced ? 200 : 700,
      );
      // A 层：羽化圆形揭示（不支持或减少动效时只走 B 层）。
      const startVT = (
        document as Document & {
          startViewTransition?: (cb: () => void) => void;
        }
      ).startViewTransition;
      if (!reduced && typeof startVT === "function") {
        const x = origin?.x ?? window.innerWidth / 2;
        const y = origin?.y ?? window.innerHeight / 2;
        const r =
          Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
          ) + 64;
        root.style.setProperty("--vt-x", `${x}px`);
        root.style.setProperty("--vt-y", `${y}px`);
        root.style.setProperty("--vt-r", `${r}px`);
        try {
          startVT.call(document, setTheme);
        } catch {
          // webkit2gtk 下可能同步抛错：立即回退到直接设主题。
          setTheme();
        }
        // 保险：回调可能不执行（或晚到）。两道核对，缺失即补设。
        const verify = () => {
          if (root.dataset.theme !== next) setTheme();
        };
        requestAnimationFrame(() => window.setTimeout(verify, 150));
        window.setTimeout(verify, 800);
      } else {
        setTheme();
      }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta)
        meta.setAttribute("content", next === "light" ? "#f7f7f5" : "#141414");
      // S4 集成点：主题切换完成时通知球眨一次眼（160ms，“眨了下眼适应光线”）。
      // 本步不改 Mark.tsx；下一波由球的接线方监听此事件。
      window.dispatchEvent(
        new CustomEvent("theme-switched", { detail: { theme: next } }),
      );
    },
    [],
  );

  // 偏好或系统偏好一变，就按解析后的主题应用（带两层过渡）。
  useEffect(() => {
    if (!settings) return;
    try {
      localStorage.setItem(THEME_KEY, settings.theme);
    } catch {
      // 首绘镜像写不进去不阻塞：Rust 设置文件仍是事实来源。
    }
    const origin = themeOriginRef.current;
    themeOriginRef.current = null;
    applyThemeVisual(resolvedTheme, origin ?? undefined);
  }, [settings, resolvedTheme, applyThemeVisual]);

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  // ---- Chat auto-scroll: instant jump to bottom while following output ----
  const activeMessages = activeTask?.messages;
  useEffect(() => {
    const el = chatRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (el) {
      // P2-19：滚在上面时来了新消息，记下来，回到底部按钮显示“有新消息 ↓”。
      setHasNewMsg(true);
    }
  }, [activeMessages]);

  // 切任务时回到跟随状态（新任务从底部开始看）。
  useEffect(() => {
    stickToBottom.current = true;
    setHasNewMsg(false);
    setShowJump(false);
  }, [activeTaskId]);

  // ---- Load settings + Codex status on mount ----
  useEffect(() => {
    let alive = true;
    invoke<Settings>("get_settings")
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        if (!s.boot_animation) {
          setBoot(false);
          setShowShell(true);
        }
      })
      .catch(() => {
        if (alive) {
          setBoot(false);
          setShowShell(true);
        }
      });
    invoke<CodexInfo>("check_codex")
      .then((info) => {
        if (alive) setCodexInfo(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // W6：卸载时清掉开机交接的 150ms 延时卸载计时器。
  useEffect(() => {
    return () => {
      if (bootHideTimer.current) window.clearTimeout(bootHideTimer.current);
    };
  }, []);

  // ---- Persist tasks locally ----
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {
      // Storage full or unavailable — tasks still work in memory.
    }
  }, [tasks]);

  // ---- Persist projects locally（与任务同一套机制） ----
  useEffect(() => {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    } catch {
      // 写不进去不阻塞：项目仍在内存里可用。
    }
  }, [projects]);

  useEffect(() => {
    try {
      if (activeProjectId) {
        localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
      } else {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
    } catch {
      // 写不进去不阻塞。
    }
  }, [activeProjectId]);

  // ---- Persist settings (debounced) ----
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        invoke("save_settings", { settings: next }).catch(() => undefined);
      }, 400);
      return next;
    });
  }, []);

  // ---- P0-1：项目首次落地（只跑一次，等设置加载完才跑） ----
  // 旧版本没有项目概念：任务的 project 是写死的"默认项目"，工作区是全局
  // settings.workdir。第一次升级时把旧东西收进一个真项目里，不丢任务：
  //   - 还没有项目列表：按 settings.workdir 建一个项目（名字取文件夹名；
  //     workdir 为空但有旧任务时，建一个 path 为空的"默认项目"收留它们）；
  //     旧任务全部归属到这个项目；当前项目 = 它。
  //   - 已有项目列表：当前 id 失效就回到第一个；把 project 字段指向
  //     不存在项目的任务（旧数据残留）收进当前项目；workdir 同步成
  //     当前项目的 path（用户上次可能在设置里改过全局 workdir）。
  // 全新用户（没有 workdir、没有旧任务）不建项目——空态会引导他
  // "打开一个项目文件夹"，而不是凭空给他一个假项目。
  // 工作区切换的机制：settings.workdir 是"当前项目的工作区"的镜像。
  // runTurn 按次传 workdir、审查/终端/文件页读 settings.workdir，
  // 所以切项目只要用现有的 patchSettings 改 workdir，各处自动跟过去，
  // 不需要改 Rust、不需要改引擎命令。
  const projectSeededRef = useRef(false);
  useEffect(() => {
    if (!settings || projectSeededRef.current) return;
    projectSeededRef.current = true;
    const list = projectsRef.current;
    let activeId = activeProjectIdRef.current;
    if (list.length === 0) {
      const legacyTasks = tasksRef.current;
      if (settings.workdir || legacyTasks.length > 0) {
        const seed: Project = {
          id: uid(),
          name: settings.workdir ? folderName(settings.workdir) : "默认项目",
          path: settings.workdir,
        };
        setProjects([seed]);
        setActiveProjectId(seed.id);
        if (legacyTasks.length > 0) {
          setTasks((prev) =>
            prev.map((t) => (t.project === seed.id ? t : { ...t, project: seed.id })),
          );
        }
      }
      // 全新用户：不建项目，空态引导新建。
    } else {
      if (!list.some((p) => p.id === activeId)) {
        activeId = list[0].id;
        setActiveProjectId(activeId);
      }
      const active = list.find((p) => p.id === activeId);
      if (active) {
        if (tasksRef.current.some((t) => !list.some((p) => p.id === t.project))) {
          setTasks((prev) =>
            prev.map((t) =>
              list.some((p) => p.id === t.project)
                ? t
                : { ...t, project: active.id },
            ),
          );
        }
        if (settings.workdir !== active.path) {
          patchSettings({ workdir: active.path });
        }
      }
    }
  }, [settings, patchSettings]);

  // ---- S7：命令执行后的轻反馈 + 打开设置 modal（带左导航定位） ----
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const openSettings = useCallback((nav: SettingsNav) => {
    setSettingsNav(nav);
    setDrawer("settings");
  }, []);
  // P2-14：问候后半句固定一条（按时段生成一次），不再每 8 秒轮换——
  // 轮换会打断正在读问候的视线，固定才安静。

  // ---- Ball cue dispatch (fixed contract for the ball worker) ----
  const dispatchCue = useCallback((cue: string) => {
    window.dispatchEvent(
      new CustomEvent("cassell:ball-cue", { detail: { cue } }),
    );
  }, []);

  // ---- Mode switch (single entry: sidebar roster + composer mode chip) ----
  // W4 切换仪式（1350ms，分拍变身/呼气收尾；切换本身即时生效，仪式只是视觉过渡，
  // 不挡输入）。分拍（to-EVA）：
  //   0–250ms   收束：球 scale→0.94 + 变暗→0.80 + 眨眼遮盖；面纱从标题栏球处漫开，
  //             顶线从左扫出，侧栏切入行开始点亮；
  //   250–400ms 闪烁：球亮度 0.80→0.72→0.88 闪一次；核验环 200ms 起填充；
  //   150–1350ms spin 整圈（球的第二拍，1200ms 转满，恰在收尾时落定）；
  //   250–750ms 展开：球 scale→1、亮度→1，EVA 蓝眼睛与 1.7× tempo 落定
  //             （呼吸 4.6s→2.7s、眨眼变快，肉眼可见地快起来）；
  //   800–1150ms 核验环淡出；段位牌蓝环落定；稳态极淡蓝光晕 800ms 淡入常驻。
  // 分拍（to-诺玛，呼气收尾，不是反向变身）：
  //   0–400ms   呼气：球 scale→0.97、亮度→0.88，暖灰面纱漫开，顶线从右收回；
  //   400–900ms 回暖：球 scale→1、亮度→1，呼吸放慢回 4.6s；
  //   900–1350ms 落定：面纱收至 0，段位牌蓝环褪去，稳态蓝光晕淡出。
  // 仪式进行中再点直接忽略（防重入，不许动画排队堆积）。toast 已删——
  // 仪式本身就是反馈，再弹 toast 是噪音。prefers-reduced-motion 时直接
  // 切换、不要仪式。
  const handleModeChange = useCallback(
    (mode: Mode) => {
      if (ritualRef.current) return;
      const cur = settingsRef.current?.mode;
      if (!cur || cur === mode) return;
      patchSettings({ mode });
      // 诚实文案（F 落地）：EVA 运行时也只说“工程开发”，不说“并行中”。
      setModeLine(
        mode === "eva" ? "已切换到 EVA · 工程开发" : "已切回诺玛",
      );
      if (modeLineTimer.current) window.clearTimeout(modeLineTimer.current);
      modeLineTimer.current = window.setTimeout(
        () => setModeLine(null),
        6000,
      );
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      ritualRef.current = true;
      setRitual({ dir: mode, startedAt: performance.now() });
      if (ritualTimer.current) window.clearTimeout(ritualTimer.current);
      ritualTimer.current = window.setTimeout(() => {
        ritualRef.current = false;
        setRitual(null);
      }, 1350);
    },
    [patchSettings],
  );

  // ---- Esc closes the Inspector (same Esc rule as drawers and menus) ----
  useEffect(() => {
    if (!inspector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspector(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspector]);

  // ---- S7 中央键盘处理（捕获阶段）：Cmd-K / Cmd-, / Cmd-N + Esc 优先级 ----
  // Esc 只关最顶上一层：命令面板 → 设置 modal → Inspector → 档案库/帮助抽屉。
  // 捕获阶段 + stopPropagation，避免抽屉/Inspector 各自的 Esc 监听再关一层。
  // 什么都没开时不拦截，Boot 的 Esc 跳过开机照常工作。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        // P2-24：侧栏齿轮与 Cmd-, 打开上次停留的页签（或默认“模型”），
        // 不强制回“模型”——settingsNav 在 App 里一直留着。
        setDrawer("settings");
        return;
      }
      if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        setActiveTaskId(null);
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) {
          e.preventDefault();
          e.stopPropagation();
          setPaletteOpen(false);
          return;
        }
        if (drawer === "settings") {
          e.preventDefault();
          e.stopPropagation();
          setDrawer(null);
          return;
        }
        if (inspector) {
          e.preventDefault();
          e.stopPropagation();
          setInspector(null);
          return;
        }
        if (drawer) {
          e.preventDefault();
          e.stopPropagation();
          setDrawer(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [paletteOpen, drawer, inspector]);

  const evaMode = settings?.mode === "eva";

  // ---- Living-mark gaze: idle look-around, working scan (EVA scans faster) ----
  useEffect(() => {
    const interval =
      runningRef.current
        ? (settingsRef.current?.mode === "eva" ? 900 : 1400)
        : 3200;
    const t = window.setInterval(
      () => {
        if (runningRef.current) {
          setGaze((Math.random() * 2 - 1) * 0.9);
        } else {
          setGaze((Math.random() * 2 - 1) * 0.5);
        }
      },
      interval,
    );
    return () => window.clearInterval(t);
  }, [running, evaMode]);

  // ---- Native engine message helpers (id-based, not "last message") ----
  const updateMsgText = useCallback((id: string, fn: (cur: string) => string) => {
    const taskId = activeTaskIdRef.current;
    if (!id || !taskId) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === id ? { ...m, text: fn(m.text) } : m,
              ),
            }
          : t,
      ),
    );
  }, []);

  const pushMsg = useCallback((msg: ChatMsg) => {
    const id = activeTaskIdRef.current;
    if (!id) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, messages: [...t.messages, msg] } : t,
      ),
    );
  }, []);

  /** 思考块插到流式气泡前面（思考先于正文）。 */
  const insertThinkMsg = useCallback((msg: ChatMsg) => {
    const taskId = activeTaskIdRef.current;
    const streamId = streamMsgIdRef.current;
    if (!taskId) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const msgs = [...t.messages];
        if (streamId) {
          const idx = msgs.findIndex((m) => m.id === streamId);
          if (idx >= 0) {
            msgs.splice(idx, 0, msg);
            return { ...t, messages: msgs };
          }
        }
        return { ...t, messages: [...msgs, msg] };
      }),
    );
  }, []);

  // ---- Native engine event stream (+ ball wiring via ballAdapter.stateFor) ----
  // 读类工具名 → searching；写类工具名 → working；EVA + ultracode 下
  // working 升级为 parallel。agent-tool-result 保持 working，不闪。
  const READ_TOOL_RE = /read|list|cat|get|search|fetch|grep|glob|view|show|stat/i;
  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    const add = (p: Promise<() => void>) => {
      p.then((u) => {
        if (alive) unlisteners.push(u);
        else u();
      });
    };

    // 正文增量：逐字追加到本轮流式气泡
    add(
      listen<{ text: string }>("agent-delta", ({ payload }) => {
        const id = streamMsgIdRef.current;
        if (id && payload.text) updateMsgText(id, (cur) => cur + payload.text);
        setMarkState(stateFor("agent-delta"));
      }),
    );
    // 思考增量：单独的思考块（第一段到达时创建，插到气泡前面）
    add(
      listen<{ text: string }>("agent-thinking", ({ payload }) => {
        if (!payload.text) return;
        setMarkState(stateFor("agent-thinking"));
        let id = thinkMsgIdRef.current;
        if (!id) {
          id = uid();
          thinkMsgIdRef.current = id;
          insertThinkMsg({
            id,
            role: "assistant",
            text: "",
            streaming: true,
            kind: "think",
          });
        }
        updateMsgText(id, (cur) => cur + payload.text);
      }),
    );
    // 工具调用开始
    add(
      listen<{ name: string; args: Record<string, unknown> }>(
        "agent-tool",
        ({ payload }) => {
          const s = settingsRef.current;
          const parallel =
            s?.mode === "eva" && !!s?.ultracode;
          setMarkState(
            parallel
              ? stateFor("ultracode-parallel")
              : stateFor(
                  READ_TOOL_RE.test(payload.name)
                    ? "agent-tool-read"
                    : "agent-tool-write",
                ),
          );
          const id = uid();
          lastToolMsgIdRef.current = id;
          const argSummary = JSON.stringify(payload.args ?? {});
          pushMsg({
            id,
            role: "assistant",
            text:
              `调用工具：${payload.name}` +
              (argSummary && argSummary !== "{}"
                ? `（${argSummary.slice(0, 200)}）`
                : ""),
            kind: "tool",
            toolLabel: payload.name,
          });
        },
      ),
    );
    // 工具调用结果：追加到同一行（截断，避免把文件全文塞进对话）
    add(
      listen<{ name: string; result: string }>(
        "agent-tool-result",
        ({ payload }) => {
          const id = lastToolMsgIdRef.current;
          if (!id) return;
          setMarkState(stateFor("agent-tool-result"));
          const r = payload.result ?? "";
          const short = r.length > 400 ? `${r.slice(0, 400)}…（已截断）` : r;
          updateMsgText(id, (cur) => `${cur}\n→ ${short}`);
        },
      ),
    );

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [pushMsg, insertThinkMsg, updateMsgText]);

  // ---- Review queue ----
  const refreshReview = useCallback(() => {
    const s = settingsRef.current;
    if (!s) return;
    invoke<ReviewState>("get_review", { workdir: s.workdir })
      .then((state) => {
        setReviewError(null);
        setReview((prev) => {
          const prevMap = new Map(
            (prev?.files ?? []).map((f) => [f.path, f]),
          );
          // Union: keep files that vanished from git status (e.g. rejected
          // + reverted) so nothing ever disappears silently.
          const merged: ReviewFile[] = state.files.map((f) => {
            const old = prevMap.get(f.path);
            return { ...f, state: old?.state ?? "pending" };
          });
          for (const old of prev?.files ?? []) {
            if (!state.files.some((f) => f.path === old.path)) {
              merged.push(old);
            }
          }
          return { ...state, files: merged };
        });
      })
      .catch((e) => setReviewError(String(e)));
  }, []);

  useEffect(() => {
    if (settings) refreshReview();
  }, [settings, refreshReview]);

  const setReviewState = (path: string, state: "pending" | "approved" | "rejected") => {
    setReview((prev) =>
      prev
        ? {
            ...prev,
            files: prev.files.map((f) =>
              f.path === path ? { ...f, state } : f,
            ),
          }
        : prev,
    );
  };

  const handleApproveFile = (path: string) => setReviewState(path, "approved");

  const handleRejectFile = (path: string) => {
    const s = settingsRef.current;
    if (!s) return;
    invoke<string>("revert_file", { workdir: s.workdir, path })
      .then(() => {
        setReviewState(path, "rejected");
        refreshReview();
      })
      .catch((e) => {
        setTerminalLines((prev) => [...prev, `· 审查还原失败：${e}`]);
      });
  };

  const handleAcceptAll = () => {
    setReview((prev) => {
      if (!prev) return prev;
      const pending = prev.files.filter((f) => (f.state ?? "pending") === "pending");
      if (pending.length === 0) return prev;
      setMerge({
        paths: pending.map((f) => f.path),
        additions: pending.reduce((a, f) => a + f.additions, 0),
        deletions: pending.reduce((a, f) => a + f.deletions, 0),
        at: new Date().toISOString(),
      });
      return {
        ...prev,
        files: prev.files.map((f) =>
          (f.state ?? "pending") === "pending" ? { ...f, state: "approved" } : f,
        ),
      };
    });
  };

  const handleUndoMerge = () => {
    setMerge((m) => {
      if (m) {
        setReview((prev) =>
          prev
            ? {
                ...prev,
                files: prev.files.map((f) =>
                  m.paths.includes(f.path) ? { ...f, state: "pending" } : f,
                ),
              }
            : prev,
        );
      }
      return null;
    });
  };

  // ---- Shell ----
  const handleRunShell = useCallback((command: string) => {
    const s = settingsRef.current;
    setTerminalLines((prev) => [...prev, `$ ${command}`]);
    invoke<{ stdout: string; stderr: string; code: number | null }>("run_shell", {
      command,
      workdir: s?.workdir ?? "",
    })
      .then((r) => {
        setTerminalLines((prev) => {
          const lines = [...prev];
          if (r.stdout.trim()) lines.push(...r.stdout.replace(/\n$/, "").split("\n"));
          if (r.stderr.trim()) lines.push(...r.stderr.replace(/\n$/, "").split("\n"));
          lines.push(`（退出码 ${r.code ?? "?"}）`);
          return lines.length > 300 ? lines.slice(-300) : lines;
        });
      })
      .catch((e) => {
        setTerminalLines((prev) => [...prev, `执行失败：${e}`]);
      });
  }, []);

  // ---- Run one agent turn (deferred a frame so the bubble paints first) ----
  const runTurn = useCallback(
    async (
      taskId: string,
      prompt: string,
      assistantMsgId: string,
      userText: string,
    ) => {
      const s = settingsRef.current;
      if (!s) return;
      // 历史只取本轮之前的回合（刚发的这条不重复进历史，prompt 已是最后一条）。
      const task = tasksRef.current.find((t) => t.id === taskId);
      const prior = (task?.messages ?? []).filter(
        (m) =>
          !m.streaming &&
          m.text.trim() &&
          (m.role === "user" || (m.role === "assistant" && !m.kind)),
      );
      const history = prior
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.text }));
      if (history.length > 0) {
        const last = history[history.length - 1];
        if (last.role === "user" && last.content === userText) history.pop();
      }
      try {
        const result = await invoke<AgentResult>("run_agent_native", {
          req: {
            prompt,
            model: s.model,
            provider_id: s.provider_id,
            // 模式、思考强度、Ultracode 三个独立字段各自传给引擎：
            // EVA 模式不再强制改思考强度，Ultracode 只透传、不假装并行。
            effort: s.effort,
            mode: s.mode,
            ultracode: s.ultracode,
            approval: s.approval,
            sandbox: s.sandbox,
            workdir: s.workdir,
            history,
            display_name: s.display_name ?? "",
          },
        });
        const thinkId = thinkMsgIdRef.current;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  messages: t.messages.map((m) => {
                    if (thinkId && m.id === thinkId)
                      return { ...m, streaming: false };
                    if (m.id !== assistantMsgId) return m;
                    const usage =
                      result.total_tokens != null
                        ? {
                            prompt: result.prompt_tokens ?? 0,
                            completion: result.completion_tokens ?? 0,
                            total: result.total_tokens,
                          }
                        : undefined;
                    if (result.cancelled) {
                      // 停止按钮已在气泡后追加“（已停止）”，这里只收尾、不改文字。
                      return { ...m, streaming: false, usage };
                    }
                    return {
                      ...m,
                      streaming: false,
                      text:
                        result.text || m.text || "（本轮没有文字输出）",
                      usage,
                    };
                  }),
                }
              : t,
          ),
        );
        // 球：成功 → done；取消 → stopped；>60 秒才成功 → long-task-done。
        const elapsed = Date.now() - (runStartRef.current || Date.now());
        if (result.cancelled) {
          setMarkState(stateFor("userStopped"));
        } else {
          setMarkState(stateFor("runDone-success"));
          dispatchCue(elapsed > 60000 ? "long-task-done" : "task-done");
        }
        if (markTimer.current) window.clearTimeout(markTimer.current);
        markTimer.current = window.setTimeout(
          () => setMarkState("idle"),
          result.cancelled ? 1500 : 2600,
        );
        refreshReview();
      } catch (e) {
        const thinkId = thinkMsgIdRef.current;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, streaming: false, kind: "error", text: `启动失败：${e}` }
                      : thinkId && m.id === thinkId
                        ? { ...m, streaming: false }
                        : m,
                  ),
                }
              : t,
          ),
        );
        // 球：出错 → error，1500ms 后回 idle；cue unexpected。
        setMarkState(stateFor("runDone-error"));
        dispatchCue("unexpected");
        if (markTimer.current) window.clearTimeout(markTimer.current);
        markTimer.current = window.setTimeout(() => setMarkState("idle"), 1500);
      } finally {
        thinkMsgIdRef.current = null;
        lastToolMsgIdRef.current = null;
        streamMsgIdRef.current = null;
        setRunning(false);
      }
    },
    [refreshReview, dispatchCue],
  );

  // ---- Send: paint the user bubble in this same frame, then run the turn ----
  // The bubble must be on screen the instant Send is pressed; the backend
  // spawn is deferred one frame so nothing on the send path can delay paint.
  // Returns false when the send is refused (e.g. no API key): the composer
  // keeps the typed text in that case.
  const handleSend = useCallback(
    (text: string, attachments: string[]): boolean => {
      const s = settingsRef.current;
      if (!s || runningRef.current) return false;
      const currentKey = s.api_keys[s.provider_id]?.trim();
      if (!currentKey) {
        const anyKey = Object.values(s.api_keys).some((k) => k?.trim());
        const providerName =
          s.providers.find((p) => p.id === s.provider_id)?.name ??
          s.provider_id;
        setGateNotice(
          anyKey
            ? `当前服务商 ${providerName} 还没配置 API Key，先去配好才能发消息。`
            : "还没有配置任何模型服务商的 API Key，诺玛没法开始干活。",
        );
        return false;
      }
      setGateNotice(null);

      let taskId = activeTaskIdRef.current;
      if (!taskId) {
        taskId = uid();
        // P0-1：任务归属当前项目，不再写死"默认项目"。
        // 还没有项目时（全新用户直接发了消息），就地建一个收留它的项目：
        // 有工作区就用工作区文件夹名，没有就叫"默认项目"。
        let projectId = activeProjectIdRef.current;
        if (!projectId || !projectsRef.current.some((p) => p.id === projectId)) {
          const fallback: Project = {
            id: uid(),
            name: settingsRef.current?.workdir
              ? folderName(settingsRef.current.workdir)
              : "默认项目",
            path: settingsRef.current?.workdir ?? "",
          };
          projectId = fallback.id;
          setProjects((prev) => [...prev, fallback]);
          setActiveProjectId(fallback.id);
        }
        const task: Task = {
          id: taskId,
          title: text.length > 24 ? `${text.slice(0, 24)}…` : text,
          project: projectId,
          messages: [],
          createdAt: Date.now(),
        };
        setTasks((prev) => [task, ...prev]);
        setActiveTaskId(taskId);
        activeTaskIdRef.current = taskId;
      }

      const prompt =
        attachments.length > 0
          ? `${text}\n\n附件：\n${attachments.map((a) => `- ${a}`).join("\n")}`
          : text;

      const userMsg: ChatMsg = { id: uid(), role: "user", text };
      const assistantMsg: ChatMsg = {
        id: uid(),
        role: "assistant",
        text: "",
        streaming: true,
      };
      // EVA turns open with one quiet line (click it for details).
      const evaNote: ChatMsg | null = s.mode === "eva"
        ? { id: uid(), role: "assistant", text: "", kind: "eva" }
        : null;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  userMsg,
                  ...(evaNote ? [evaNote] : []),
                  assistantMsg,
                ],
              }
            : t,
        ),
      );
      // Per-turn refs for the native event listeners.
      streamMsgIdRef.current = assistantMsg.id;
      thinkMsgIdRef.current = null;
      lastToolMsgIdRef.current = null;
      setRunning(true);
      // 球：收到任务 → receiving（点头确认）；cue message-sent。
      setMarkState(stateFor("runStart"));
      dispatchCue("message-sent");
      runStartRef.current = Date.now();
      stickToBottom.current = true;

      requestAnimationFrame(() => {
        void runTurn(taskId, prompt, assistantMsg.id, text);
      });
      return true;
    },
    [runTurn, dispatchCue],
  );

  const handleCancel = useCallback(() => {
    invoke<boolean>("cancel_run")
      .then(() => {
        setRunning(false);
        setMarkState(stateFor("userStopped"));
        const id = activeTaskIdRef.current;
        if (id) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    messages: t.messages.map((m) =>
                      m.streaming ? { ...m, streaming: false, text: m.text + "\n（已停止）" } : m,
                    ),
                  }
                : t,
            ),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  const handleNewTask = () => setActiveTaskId(null);

  const handleArchiveTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, archived: true } : t)));
    setActiveTaskId(null);
  };

  const handleRestoreTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, archived: false } : t)));
    setActiveTaskId(id);
    setDrawer(null);
  };

  // ---- S7：Cmd-K 命令的真实动作（注册表在 ./components/commands） ----
  const handleArchiveCurrentTask = () => {
    const id = activeTaskIdRef.current;
    const t = tasksRef.current.find((x) => x.id === id);
    if (!t) {
      showNotice("没有正在进行的任务。");
      return;
    }
    handleArchiveTask(t.id);
    showNotice(`已归档「${t.title}」。`);
  };

  const handleClearChat = () => {
    if (runningRef.current) {
      showNotice("任务还在跑，等跑完再清空对话。");
      return;
    }
    const id = activeTaskIdRef.current;
    const t = tasksRef.current.find((x) => x.id === id);
    if (!t || t.messages.length === 0) {
      showNotice("当前对话已经是空的。");
      return;
    }
    setTasks((prev) =>
      prev.map((x) => (x.id === id ? { ...x, messages: [] } : x)),
    );
    showNotice("已清空当前对话。");
  };

  // 状态与用量（P1-5）：不再弹 3.5 秒就消失的提示、也不打开没有用量数字的
  // 工作流页——用量行就常驻在输入框上方，这里滚动到它并高亮一下。
  const handleShowUsage = () => {
    usageRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setUsageFlash(true);
    window.setTimeout(() => setUsageFlash(false), 1800);
  };

  // ---- 审计 P1-4：消息操作（复制 / 重试 / 编辑 / 删除） ----
  // 重跑一轮：保留第 userIdx 条用户消息之前的所有消息，删掉它之后的一切，
  // 挂一条新的流式 AI 气泡，用同一条 prompt（或编辑后的新文本）再跑一轮。
  const rerunFromUser = useCallback(
    (taskId: string, userIdx: number, userText: string) => {
      if (runningRef.current) return;
      const s = settingsRef.current;
      const assistantId = uid();
      const evaNote: ChatMsg | null =
        s?.mode === "eva"
          ? { id: uid(), role: "assistant", text: "", kind: "eva" }
          : null;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                messages: [
                  ...t.messages.slice(0, userIdx + 1),
                  ...(evaNote ? [evaNote] : []),
                  { id: assistantId, role: "assistant", text: "", streaming: true },
                ],
              }
            : t,
        ),
      );
      streamMsgIdRef.current = assistantId;
      thinkMsgIdRef.current = null;
      lastToolMsgIdRef.current = null;
      setRunning(true);
      setMarkState(stateFor("runStart"));
      dispatchCue("message-sent");
      runStartRef.current = Date.now();
      stickToBottom.current = true;
      requestAnimationFrame(() => {
        void runTurn(taskId, userText, assistantId, userText);
      });
    },
    [runTurn, dispatchCue],
  );

  // 重试：找到该条 AI 回复（或出错卡片）前面最近一条用户消息，用同一条 prompt 再跑一轮。
  const handleRetryMessage = (msgId: string) => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return;
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;
    const idx = task.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    let userIdx = -1;
    for (let i = idx; i >= 0; i--) {
      if (task.messages[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) {
      showNotice("找不到要重试的那条提问。");
      return;
    }
    if (runningRef.current) {
      showNotice("任务还在跑，等它跑完再重试。");
      return;
    }
    rerunFromUser(taskId, userIdx, task.messages[userIdx].text);
  };

  // 编辑：改掉这条用户消息（改第一条时任务标题跟着改），删掉它之后的所有回复，按新内容重跑一轮。
  const handleEditUserMessage = (msgId: string, newText: string) => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return;
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task) return;
    const idx = task.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const text = newText.trim();
    if (!text) {
      showNotice("内容不能为空。");
      return;
    }
    if (runningRef.current) {
      showNotice("任务还在跑，等它跑完再改。");
      return;
    }
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const msgs = t.messages.map((m, i) => (i === idx ? { ...m, text } : m));
        const firstUserIdx = msgs.findIndex((m) => m.role === "user");
        const title =
          firstUserIdx === idx
            ? text.length > 24
              ? `${text.slice(0, 24)}…`
              : text
            : t.title;
        return { ...t, title, messages: msgs };
      }),
    );
    setEditingMsgId(null);
    rerunFromUser(taskId, idx, text);
  };

  const handleDeleteMessage = (msgId: string) => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, messages: t.messages.filter((m) => m.id !== msgId) }
          : t,
      ),
    );
    setConfirmDeleteMsgId(null);
    showNotice("已删除一条消息。");
  };

  const handleCopyMessage = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => showNotice("已复制。"),
      () => showNotice("复制失败。"),
    );
  };

  // ---- 审计 P2-1 / P2-20：任务重命名 / 删除 / 档案库彻底删除 ----
  const handleRenameTask = (id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, title: t } : x)));
  };
  const handleDeleteTask = (id: string) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    if (activeTaskIdRef.current === id) setActiveTaskId(null);
    showNotice("任务已删除。");
  };
  const handleDeleteArchivedTask = (id: string) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    showNotice("已彻底删除。");
  };

  const handleAcceptAllReview = () => {
    const pending = (review?.files ?? []).filter(
      (f) => (f.state ?? "pending") === "pending",
    ).length;
    if (pending === 0) {
      showNotice("没有待审查的变更。");
      return;
    }
    handleAcceptAll();
    setInspector("review");
  };

  const handleSwitchModeCmd = (mode: Mode) => {
    if (settingsRef.current?.mode === mode) {
      showNotice(mode === "eva" ? "已经是 EVA 模式了。" : "已经是诺玛模式了。");
      return;
    }
    handleModeChange(mode);
  };

  const handleSetThemeCmd = (theme: Theme) => {
    patchSettings({ theme });
    showNotice(
      `已切换到${theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统"}主题。`,
    );
  };

  const handleSetEffortCmd = (effort: Effort) => {
    patchSettings({ effort });
    showNotice(`思考强度已设为「${EFFORT_LABELS[effort]}」。`);
  };

  // 原生引擎的连通测试：真发一条最小请求，不经过 Codex CLI。
  // 注意先落盘再测——Rust 侧从磁盘设置文件里读 Key 与地址。
  // providerId 可指定（设置里“只看不切换”时测查看中的服务商）；返回结果，
  // 供连接向导直接用（设置页仍用 App 的 testing/testResult 状态显示）。
  const handleTestConnection = (providerId?: string) => {
    const s = settingsRef.current;
    if (!s) return Promise.resolve({ ok: false, detail: "设置还没加载好" });
    const pid = providerId ?? s.provider_id;
    setTesting(true);
    setTestResult(null);
    return invoke("save_settings", { settings: s })
      .then(() =>
        invoke<{ ok: boolean; detail: string }>("test_provider", {
          // 注意：Tauri v2 命令参数默认转 camelCase，Rust 侧 provider_id 对应 JS 侧 providerId
          providerId: pid,
          model: s.model,
        }),
      )
      .then((r) => {
        setTestResult(r);
        return r;
      })
      .catch((e) => {
        const r = { ok: false, detail: String(e) };
        setTestResult(r);
        return r;
      })
      .finally(() => setTesting(false));
  };

  // 从服务商真实拉取模型列表（GET /models），填进指定服务商的模型目录。
  // providerId 可指定；只有拉的是当前服务商时才顺带改 settings.model。
  const handleFetchModels = useCallback(async (providerId?: string): Promise<{
    ok: boolean;
    detail: string;
  }> => {
    const s = settingsRef.current;
    if (!s) return { ok: false, detail: "设置还没加载好" };
    const pid = providerId ?? s.provider_id;
    try {
      await invoke("save_settings", { settings: s });
      const models = await invoke<string[]>("list_models", {
        // Tauri v2 命令参数默认转 camelCase（见 test_provider 处注释）
        providerId: pid,
      });
      if (models.length === 0) {
        return { ok: true, detail: "服务商没有返回任何模型（列表为空）" };
      }
      const patch: Partial<Settings> = {
        providers: s.providers.map((p) =>
          p.id === pid ? { ...p, models } : p,
        ),
      };
      if (pid === s.provider_id) {
        patch.model = models.includes(s.model) ? s.model : models[0];
      }
      patchSettings(patch);
      return { ok: true, detail: `已拉取 ${models.length} 个模型` };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }, [patchSettings]);

  // ---- P0-1：真项目——新建 / 切换 / 重命名 ----
  // 切项目 = 换工作现场：settings.workdir 同步成新项目的 path（走现有的
  // save_settings 落盘），审查/终端/文件/引擎都读它，全部自动跟过去；
  // 任务列表跟着项目走：切到该项目最近的一个任务，没有就回到空态。
  const handleSelectProject = useCallback(
    (id: string) => {
      if (id === activeProjectIdRef.current) return;
      const p = projectsRef.current.find((x) => x.id === id);
      if (!p) return;
      setActiveProjectId(id);
      patchSettings({ workdir: p.path });
      const newest = tasksRef.current
        .filter((t) => !t.archived && t.project === id)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      setActiveTaskId(newest ? newest.id : null);
    },
    [patchSettings],
  );

  const handleNewProject = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (!picked) return; // 用户取消：什么都不做
      // 同一个文件夹只建一个项目：已经存在就切过去，不建重名行
      //（否则列表里会出现两个名字、路径都一样的项目，分不清）。
      const existing = projectsRef.current.find((p) => p.path === picked);
      if (existing) {
        handleSelectProject(existing.id);
        showNotice(`项目「${existing.name}」已存在，已切换过去。`);
        return;
      }
      const project: Project = {
        id: uid(),
        name: folderName(picked),
        path: picked,
      };
      setProjects((prev) => [...prev, project]);
      setActiveProjectId(project.id);
      patchSettings({ workdir: picked });
      setActiveTaskId(null);
      showNotice(`已新建项目「${project.name}」。`);
    } catch {
      showNotice("没能打开文件夹选择框。");
    }
  }, [patchSettings, showNotice, handleSelectProject]);

  const handleRenameProject = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: n } : p)),
    );
  }, []);

  // 系统原生文件夹选择对话框
  // P0-1：设置里的这一行现在是"当前项目的目录"（不再是全局唯一设置）。
  // 选了文件夹 = 改当前项目的目录（settings.workdir 跟着同步）；
  // 还没有项目时，选文件夹就地新建一个项目（名字取文件夹名）。
  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (!picked) return; // 用户取消：保持原工作区不变
      const cur = projectsRef.current.find(
        (p) => p.id === activeProjectIdRef.current,
      );
      if (cur) {
        setProjects((prev) =>
          prev.map((p) => (p.id === cur.id ? { ...p, path: picked } : p)),
        );
        patchSettings({ workdir: picked });
      } else {
        // 还没有项目：先看这个文件夹是不是已经有个项目（可能是在
        // 另一处建的），有就切过去，没有才新建。
        const existing = projectsRef.current.find((p) => p.path === picked);
        if (existing) {
          setActiveProjectId(existing.id);
          patchSettings({ workdir: picked });
          showNotice(`项目「${existing.name}」已存在，已切换过去。`);
          return;
        }
        const project: Project = {
          id: uid(),
          name: folderName(picked),
          path: picked,
        };
        setProjects((prev) => [...prev, project]);
        setActiveProjectId(project.id);
        patchSettings({ workdir: picked });
        showNotice(`已新建项目「${project.name}」。`);
      }
    } catch {
      // 用户取消或打开失败：保持原工作区不变
    }
  }, [patchSettings, showNotice]);

  // 当前服务商一旦配好 Key，拦截提示自动消失
  useEffect(() => {
    if (!settings) return;
    if (settings.api_keys[settings.provider_id]?.trim()) setGateNotice(null);
  }, [settings]);

  if (!settings) {
    return (
      <div className="app">
        <style>{WAVE2_CSS}</style>
        <div className="boot">
          <div className="boot-welcome">正在启动…</div>
        </div>
      </div>
    );
  }

  const hour = new Date().getHours();
  // 显示名默认“路明非”；问候取首字 + “专员”（路明非 → 路专员）。
  const displayName = settings.display_name?.trim() || "路明非";
  const greeting = `${greetingForHour(hour)}，${displayName.charAt(0)}专员。${GREETING_TASKS[0]}`;
  const hasAnyKey = Object.values(settings.api_keys).some((k) => k?.trim());
  const showEmpty = !activeTask || activeTask.messages.length === 0;

  // L1 安静状态行（P2-15）：固定占位、不出现/消失导致对话区跳动；运行状态与
  // 审查计数分开——审查计数常驻在顶部“审查”入口的徽标上，这里只说运行状态。
  // P0-4：EVA+Ultracode 运行时不说“并行核查中… 3 个智能体”（假话），只说“EVA 正在执行…”。
  const pendingCount = (review?.files ?? []).filter(
    (f) => (f.state ?? "pending") === "pending",
  ).length;
  const l1Text = running
    ? settings.mode === "eva"
      ? "EVA 正在执行…"
      : "正在思考…"
    : modeLine ?? "空闲";
  const l1Target: InspectorView = running ? "workflow" : "review";
  const l1Clickable = running || pendingCount > 0;
  // 新消息一次性出现动效：最后一条用户消息 + 流式中的 AI 气泡（150ms 淡入 + 4px 上移）。
  const messages = activeTask?.messages ?? [];
  // P1-5：用量常驻行的数据（累计 token 用服务商真实回报的数；没有用量数据的回复不计）。
  // 上下文占比不显示：没有上下文窗口配置，百分比算不出来，不编一个假的。
  const usageMessages = messages.filter((m) => m.usage);
  const usagePrompt = usageMessages.reduce((a, m) => a + (m.usage?.prompt ?? 0), 0);
  const usageCompletion = usageMessages.reduce(
    (a, m) => a + (m.usage?.completion ?? 0),
    0,
  );
  const usageTotal = usageMessages.reduce((a, m) => a + (m.usage?.total ?? 0), 0);
  // S9：工作流页要的本轮工具调用（从 kind:"tool" 的消息汇总；消息没有
  // 时间戳，故每步耗时仍显示“未接入”，不现凑）。
  const toolCallItems = messages
    .filter((m) => m.kind === "tool")
    .map((m) => {
      const first = m.text.split("\n")[0] ?? "";
      const args = first.match(/（(.*)）$/)?.[1] ?? "";
      return { label: m.toolLabel ?? "工具", detail: args };
    });
  const lastUserId =
    [...messages].reverse().find((m) => m.role === "user")?.id ?? null;

  // P2-21（方案 ①，固定浮层 + 主区同步留白，二者只留一份）：
  // 只在 Inspector 打开且视图为 review 时，对话区让出 360px（wide 时
  // 480px）——审查与对话同屏；其他视图保持浮层、不挤压对话区。
  const reviewDocked = inspector === "review";

  // S7：Cmd-K 的命令上下文（每条命令都执行真实动作，见 ./components/commands）。
  const paletteItems = (q: string) =>
    getCommands(
      {
        mode: settings.mode,
        theme: settings.theme,
        effort: settings.effort,
        providerName:
          settings.providers.find((p) => p.id === settings.provider_id)?.name ??
          settings.provider_id,
        model: settings.model,
        hasActiveTask: !!activeTask,
        activeTaskTitle: activeTask?.title ?? null,
        pendingReviewCount: pendingCount,
        running,
        tasks,
        activeTaskId,
        inspectorView: inspector,
        projects,
        activeProjectId,
        newProject: handleNewProject,
        switchProject: handleSelectProject,
        newTask: handleNewTask,
        setMode: handleSwitchModeCmd,
        openSettings,
        openInspector: setInspector,
        setTheme: handleSetThemeCmd,
        setEffort: handleSetEffortCmd,
        openArchive: () => setDrawer("archive"),
        openHelp: () => setDrawer("help"),
        archiveCurrentTask: handleArchiveCurrentTask,
        clearChat: handleClearChat,
        showUsage: handleShowUsage,
        acceptAllReview: handleAcceptAllReview,
        jumpToTask: (id: string) => setActiveTaskId(id),
      },
      q,
    );

  return (
    <div className="app">
      <style>{WAVE2_CSS}</style>
      <style>{S7_CSS}</style>
      <style>{AUDIT_CSS}</style>
      {boot && settings.boot_animation && <Boot onDone={handleBootDone} />}
      {/* W4 仪式界面层：面纱（漫开再收住），不挡输入；
          稳态光晕常驻渲染，EVA 时 800ms 淡入、切回时淡出。 */}
      {ritual && (
        <div
          className={`w4-veil ${ritual.dir === "eva" ? "w4-veil-eva" : "w4-veil-norma"}`}
          aria-hidden="true"
        />
      )}
      <div
        className={`w4-steady-halo ${evaMode ? "on" : ""}`}
        aria-hidden="true"
      />

      {/* W6 · S8 标题栏：bootDone 后才挂载（Boot 全屏覆盖期间不存在，
          不在 Boot 下面先渲染一帧）；与三栏壳一起 300ms 淡入，与 Boot
          的 300ms 淡出重叠 150ms 交叉淡化。 */}
      {showShell && (
        <TitleBar
          mode={settings.mode}
          onModeChange={handleModeChange}
          markState={markState}
          gaze={gaze}
          ritual={ritual}
        />
      )}

      {showShell && (
      <div className="w6-shell w6-shell-in">
      <Sidebar
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSelectTask={setActiveTaskId}
        onNewTask={handleNewTask}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
        onRenameProject={handleRenameProject}
        onRenameTask={handleRenameTask}
        onDeleteTask={handleDeleteTask}
        onOpenDrawer={(which) => {
          // P2-24：齿轮打开上次停留的页签，不强制回“模型”。
          setDrawer(which);
        }}
        onOpenPalette={() => setPaletteOpen(true)}
        displayName={displayName}
        mode={settings.mode}
        onModeChange={handleModeChange}
        running={running}
        markState={markState}
        drawer={drawer}
        ritual={ritual}
      />

      <main
        className="main"
        style={
          reviewDocked
            ? { marginRight: inspectorWide ? 480 : 360 }
            : undefined
        }
      >
        <header className="main-head">
          <span
            className={`w4-wrap ${ritual ? (ritual.dir === "eva" ? "w4-wrap-eva" : "w4-wrap-norma") : ""}`}
          >
            <Mark
              size={36}
              eva={settings.mode === "eva"}
              state={markState}
              gaze={gaze}
              fast={settings.mode === "eva"}
              ritual={ritual}
            />
          </span>
          <div className="main-head-title">
            {activeTask ? activeTask.title : "新任务"}
            <span className="main-head-sub">
              {/* P2-3：副标题用人话——模式中文名 · 服务商中文名 · 模型名 · 思考强度中文标签；
                  不再显示 provider_id、effort 枚举原文。 */}
              {MODE_LABELS[settings.mode]} ·{" "}
              {settings.providers.find((p) => p.id === settings.provider_id)?.name ??
                settings.provider_id}{" "}
              · {settings.model || "未选模型"} · {EFFORT_LABELS[settings.effort]}
            </span>
          </div>
          <span className="main-head-spacer" />
          {/* P1-13/P1-14：顶栏重排——“审查”独立入口（带待审查数量徽标，有待审时变色）；
              “归档”收进 Cmd-K（命令面板里有“归档当前任务”），顶栏拿掉；主题按钮拿掉，
              主题只在设置 → 外观的分段控件与 Cmd-K 里切（P2-9 的“三态循环文案显示下一个状态”随之消失）。
              位置纪律：审查入口放在对话区顶部、L1 状态行正上方——用户想检查工作成果的时刻
              就是正在看对话的时刻，入口在视线顶端，空闲与运行时位置不挪地方。 */}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setInspector(inspector ?? "review")}
            aria-label={`打开审查${pendingCount > 0 ? `，${pendingCount} 个待审查` : ""}`}
            title="审查：逐项通过或拒绝诺玛的改动（Cmd+K 也能打开）"
          >
            审查
            {pendingCount > 0 && (
              <span className="w2-review-badge hot">{pendingCount}</span>
            )}
          </button>
        </header>

        {/* P2-15：L1 状态行固定占位、不出现/消失导致对话区跳动。空闲时显示“空闲”；
            运行时或有待审时可点（进工作流 / 审查），其余时间是安静的一行小字。 */}
        {l1Clickable ? (
          <button
            type="button"
            className="w2-l1"
            onClick={() => setInspector(l1Target)}
          >
            <span className={`w2-dot ${running ? "busy" : "ok"}`} />
            {l1Text}
            <span aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="w2-l1" role="status">
            <span className="w2-dot ok" />
            {l1Text}
          </div>
        )}

        {showEmpty ? (
          <div className="empty-state">
            <Mark size={100} eva={settings.mode === "eva"} state="idle" gaze={gaze} fast={settings.mode === "eva"} ritual={ritual} />
            <div className="empty-greeting">{greeting}</div>
            <div className="empty-identity">
              {displayName} · S2017-0117 · 血统评级 S
            </div>
            {!hasAnyKey && (
              <div className="setup-cta">
                <div className="setup-cta-title">
                  还差一步：先连接一家模型服务商，诺玛才能开始干活
                </div>
                <div className="setup-cta-text">
                  用你自己的 API Key 接入（DeepSeek、Kimi、千问、OpenAI 都可以，也支持自己的反代地址），粘贴一次、测通就行，之后回来直接发消息。
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setWizardOpen(true)}
                >
                  连接模型服务商 →
                </button>
              </div>
            )}
            {/* P0-1：空态入口——新用户第一次打开、最需要它的时候。
                一个项目就是电脑里的一个文件夹，点开即原生文件夹选择框，
                选完即建成项目（名字默认文件夹名）；任务、审查、终端、
                文件页都跟着这个项目走。 */}
            {projects.length === 0 && (
              <div className="setup-cta">
                <div className="setup-cta-title">先打开一个项目文件夹</div>
                <div className="setup-cta-text">
                  一个项目就是电脑里的一个文件夹：诺玛只在这个文件夹里读写文件，任务、审查、终端都跟着它走。
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleNewProject}
                >
                  打开一个项目文件夹
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="chat"
            ref={chatRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
              stickToBottom.current = dist < 160;
              // P2-19：离开底部超过一屏时，右下角出现“回到底部”按钮。
              setShowJump(dist > el.clientHeight);
              if (dist < 160) setHasNewMsg(false);
            }}
          >
            {messages.map((m) =>
              m.role === "user" ? (
                <div
                  key={m.id}
                  className={`msg user ${m.id === lastUserId ? "w2-live" : ""}`}
                >
                  {editingMsgId === m.id ? (
                    <div className="w2-msg-edit">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleEditUserMessage(m.id, editText);
                          } else if (e.key === "Escape") {
                            setEditingMsgId(null);
                          }
                        }}
                        aria-label="编辑这条消息"
                        autoFocus
                      />
                      <div className="w2-msg-edit-row">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setEditingMsgId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleEditUserMessage(m.id, editText)}
                        >
                          保存并重发
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="msg-body">
                        {m.text}
                        {/* P1-4：每条消息悬停出现复制 / 重试 / 编辑 / 删除（放在气泡里，不破坏消息行的 flex 布局）。 */}
                        <div className="w2-msg-actions">
                          <button type="button" onClick={() => handleCopyMessage(m.text)}>
                            复制
                          </button>
                          <button type="button" onClick={() => handleRetryMessage(m.id)}>
                            重试
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsgId(m.id);
                              setEditText(m.text);
                            }}
                          >
                            编辑
                          </button>
                          {confirmDeleteMsgId === m.id ? (
                            <>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => handleDeleteMessage(m.id)}
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteMsgId(null)}
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => setConfirmDeleteMsgId(m.id)}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : m.kind === "eva" ? (
                <EvaNote
                  key={m.id}
                  ultracode={settings.ultracode}
                  onInspect={() => setInspector("workflow")}
                />
              ) : m.kind === "think" ? (
                <ThinkBlock key={m.id} text={m.text} streaming={!!m.streaming} />
              ) : m.kind === "tool" ? (
                <ToolCard
                  key={m.id}
                  msg={m}
                  onInspect={() => setInspector("terminal")}
                />
              ) : m.kind === "perm" || m.kind === "ask" ? (
                <PermCard key={m.id} msg={m} />
              ) : m.kind === "error" ? (
                <ErrorCard
                  key={m.id}
                  msg={m}
                  onRetry={() => handleRetryMessage(m.id)}
                  eva={settings.mode === "eva"}
                  fast={settings.mode === "eva"}
                  ritual={ritual}
                  gaze={gaze}
                />
              ) : (
                <div
                  key={m.id}
                  className={`msg assistant ${m.streaming ? "w2-live" : ""}`}
                >
                  <Mark
                    size={28}
                    eva={settings.mode === "eva"}
                    state={m.streaming ? markState : "idle"}
                    gaze={gaze}
                    fast={settings.mode === "eva"}
                    ritual={ritual}
                  />
                  <div className="msg-body">
                    {m.text}
                    {m.streaming && <span className="stream-caret">▍</span>}
                    {m.usage && (
                      <div className="msg-usage">
                        ↑ {m.usage.prompt} · ↓ {m.usage.completion} · 共{" "}
                        {m.usage.total} tokens
                      </div>
                    )}
                    <div className="w2-msg-actions">
                      <button type="button" onClick={() => handleCopyMessage(m.text)}>
                        复制
                      </button>
                      <button type="button" onClick={() => handleRetryMessage(m.id)}>
                        重试
                      </button>
                      {confirmDeleteMsgId === m.id ? (
                        <>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteMessage(m.id)}
                          >
                            确认删除
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteMsgId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => setConfirmDeleteMsgId(m.id)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}
            {/* P2-19：离开底部超过一屏时出现；有新消息且未跟随时显示“有新消息 ↓”。 */}
            {showJump && (
              <button
                type="button"
                className="w2-jump"
                onClick={() => {
                  const el = chatRef.current;
                  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                  stickToBottom.current = true;
                  setHasNewMsg(false);
                  setShowJump(false);
                }}
              >
                {hasNewMsg ? "有新消息 ↓" : "回到底部"}
              </button>
            )}
          </div>
        )}

        <div className="composer-slot">
          {/* P1-5：用量常驻行（输入框上方，一直可见；Cmd-K“查看状态与用量”滚动到这里并高亮）。
              上下文占比不显示：没有上下文窗口配置，百分比算不出来，不编一个假的。 */}
          <div
            ref={usageRowRef}
            className={`w2-usage ${usageFlash ? "flash" : ""}`}
            role="status"
          >
            {usageMessages.length === 0 ? (
              <span>还没有用量数据——用量会在每条 AI 回复下方显示。</span>
            ) : (
              <span>
                本对话累计 ↑ {usagePrompt} · ↓ {usageCompletion} · 共 {usageTotal}{" "}
                tokens（{usageMessages.length} 条回复）
              </span>
            )}
          </div>
          {gateNotice && (
            <div className="gate-notice" role="alert">
              <span>{gateNotice}</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setWizardOpen(true)}
              >
                去配置
              </button>
            </div>
          )}
          <Composer
            settings={settings}
            onPatch={patchSettings}
            onSend={handleSend}
            running={running}
            onCancel={handleCancel}
            onModeChange={handleModeChange}
            markState={markState}
            getSlashCommands={(q) => paletteItems(q)}
          />
        </div>
      </main>

      {inspector && (
        <RightPanel
          view={inspector}
          onViewChange={setInspector}
          onClose={() => setInspector(null)}
          wide={inspectorWide}
          onToggleWide={() => setInspectorWide((w) => !w)}
          running={running}
          runningTaskTitle={activeTask?.title ?? null}
          usageTotal={{
            prompt: usagePrompt,
            completion: usageCompletion,
            total: usageTotal,
            replies: usageMessages.length,
          }}
          toolCalls={toolCallItems}
          workdir={settings.workdir}
          review={review}
          reviewError={reviewError}
          onRefreshReview={refreshReview}
          onApproveFile={handleApproveFile}
          onRejectFile={handleRejectFile}
          onUndoFile={(path) => setReviewState(path, "pending")}
          onAcceptAll={handleAcceptAll}
          onUndoMerge={handleUndoMerge}
          onDismissMerge={() => setMerge(null)}
          merge={merge}
          terminalLines={terminalLines}
          onRunShell={handleRunShell}
          settings={settings}
          onToggleExtension={(id) =>
            patchSettings({
              extensions: settings.extensions.map((e) =>
                e.id === id ? { ...e, enabled: !e.enabled } : e,
              ),
            })
          }
        />
      )}
      </div>
      )}

      {drawer === "settings" && (
        <SettingsModal
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setDrawer(null)}
          codexInfo={codexInfo}
          onTestConnection={handleTestConnection}
          testing={testing}
          testResult={testResult}
          onFetchModels={handleFetchModels}
          onPickFolder={handlePickFolder}
          currentProjectName={activeProject?.name ?? null}
          initialNav={settingsNav}
          onModeChange={handleModeChange}
          onOpenWizard={() => {
            setDrawer(null);
            setWizardOpen(true);
          }}
        />
      )}
      {drawer === "archive" && (
        <ArchiveDrawer
          tasks={tasks}
          onRestore={handleRestoreTask}
          onDelete={handleDeleteArchivedTask}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "help" && <HelpDrawer onClose={() => setDrawer(null)} />}
      {wizardOpen && (
        <ConnectWizard
          settings={settings}
          onPatch={patchSettings}
          onTestConnection={handleTestConnection}
          onFetchModels={handleFetchModels}
          onClose={() => setWizardOpen(false)}
          onOpenSettings={() => {
            setWizardOpen(false);
            openSettings("model");
          }}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          getItems={paletteItems}
        />
      )}
      {notice && (
        <div className="s7-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
