import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Mark, { type MarkState } from "./Mark";
import type { Mode } from "../types";
import { MODE_LABELS } from "../types";
import type { ModeRitual } from "./mark/useBallEngine";

/**
 * S8 · 自绘标题栏（40px，横跨三栏之上，底边 1px 细线）。
 *
 * 位置纪律（用户定的：按使用频率 / 流程 / 层级排）：
 * - 左：36px 球 + CASSELL COLLEGE（身份层）——常驻、第一眼认出“这是谁的
 *   终端”，球是身份锚点不是装饰；左上角是视线起点，身份放这里最稳。
 * - 中（居中偏右）：模式切换器（主入口）——诺玛/EVA 是全产品最高频的
 *   操作入口之一，放在视线中心偏右：不跟左边的身份抢第一眼，也不跟
 *   右边的系统按钮抢右上角；鼠标从对话区抬上去最近的就是它。
 * - 右：最小化 / 最大化 / 关闭（系统惯例）——Windows 用户的肌肉记忆
 *   就在右上角，关闭 hover 变红是系统惯例，不创新。
 *
 * 拖拽：整条标题栏是拖拽区（data-tauri-drag-region="deep"——Tauri 2 的
 * drag.js 里裸属性只认“直接点在该元素上”，子元素上的点击不触发拖拽，
 * 必须用 "deep" 才覆盖整条）；模式切换器与窗口按钮显式标
 * data-tauri-drag-region="false"，否则点它们会变成拖窗口（按钮本身是
 * <button>，按 drag.js 的规则也会挡住拖拽，双保险）。
 * 双击标题栏空白处 = 最大化/还原（Windows 惯例）：由 Tauri 的 drag.js
 * 在 mousedown（detail===2）里直接调 internal_toggle_maximize（默认
 * 权限就有），这里不再另挂 onDoubleClick——两边各调一次会互相抵消。
 *
 * 模式切换走 App.handleModeChange 统一入口（1200ms 仪式 + 涟漪 + 泛蓝光），
 * 与侧栏名册、Composer chip 三处同步；这里不自己改 mode。
 */
export default function TitleBar({
  mode,
  onModeChange,
  markState,
  gaze,
  ritual,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  markState: MarkState;
  gaze: number;
  ritual: ModeRitual | null;
}) {
  const [maximized, setMaximized] = useState(false);
  /** 非 Tauri 环境（纯 vite 预览）下窗口 API 不可用：按钮置灰，不报错。 */
  const [winApi, setWinApi] = useState(true);

  // 最大化状态：挂载时读一次；窗口尺寸一变（最大化/还原/拖拽分屏都会
  // 触发 resize）就重读，图标（▢/还原）才跟得上双击标题栏这种不经过
  // 按钮的切换。读不到（非 Tauri）就静默置灰按钮。
  useEffect(() => {
    let alive = true;
    const sync = () => {
      try {
        getCurrentWindow()
          .isMaximized()
          .then((v) => {
            if (alive) setMaximized(v);
          })
          .catch(() => {
            if (alive) setWinApi(false);
          });
      } catch {
        if (alive) setWinApi(false);
      }
    };
    sync();
    window.addEventListener("resize", sync);
    return () => {
      alive = false;
      window.removeEventListener("resize", sync);
    };
  }, []);

  const run = (fn: () => Promise<void>) => {
    try {
      fn()
        .then(() => {
          // 最大化/还原后立刻重读状态，图标不滞后一帧。
          getCurrentWindow()
            .isMaximized()
            .then(setMaximized)
            .catch(() => undefined);
        })
        .catch(() => setWinApi(false));
    } catch {
      setWinApi(false);
    }
  };
  const minimize = () => run(() => getCurrentWindow().minimize());
  const toggleMaximize = () =>
    run(() => getCurrentWindow().toggleMaximize());
  const close = () => run(() => getCurrentWindow().close());

  return (
    <header
      className="w6-titlebar"
      data-tauri-drag-region="deep"
    >
      <style>{`
        .w6-titlebar { display: flex; align-items: center; gap: 12px; height: 40px; flex-shrink: 0; padding: 0 0 0 12px; background: var(--bg-panel); user-select: none; -webkit-user-select: none; position: relative; z-index: 20; animation: w6-fade-in 300ms var(--ease) both; }
        @keyframes w6-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .w6-tb-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .w6-tb-title { font-size: 13px; font-weight: 600; letter-spacing: 0.08em; white-space: nowrap; }
        .w6-tb-sub { font-size: 12px; color: var(--text-3); white-space: nowrap; }
        .w6-tb-mid { flex: 1; display: flex; align-items: center; justify-content: center; min-width: 0; }
        .w6-tb-seg { display: flex; gap: 2px; background: var(--bg-soft); border-radius: 999px; padding: 2px; }
        .w6-tb-seg button { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 999px; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease), box-shadow 150ms var(--ease); white-space: nowrap; }
        .w6-tb-seg button:hover { color: var(--text); }
        .w6-tb-seg button.w6-on { background: var(--bg-panel); color: var(--text); box-shadow: var(--shadow-sm); }
        .w6-tb-seg button.w6-on-eva { background: var(--accent-soft); color: var(--accent); }
        .w6-tb-seg button .w6-seg-sub { font-size: 11px; font-weight: 400; color: var(--text-3); }
        .w6-tb-seg button.w6-on-eva .w6-seg-sub { color: var(--accent); opacity: 0.8; }
        .w6-tb-wins { display: flex; align-items: stretch; align-self: stretch; }
        .w6-tb-wins button { display: flex; align-items: center; justify-content: center; width: 46px; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease); }
        .w6-tb-wins button:hover { background: var(--bg-hover); color: var(--text); }
        .w6-tb-wins button:disabled { opacity: 0.45; cursor: default; }
        .w6-tb-wins button.w6-close:hover { background: #e81123; color: #fff; }
        .w6-tb-wins button:active { transform: none; }
        @media (prefers-reduced-motion: reduce) { .w6-titlebar { animation-duration: 0.01ms !important; } }
      `}</style>

      {/* 左：身份——36px 球（接 markState，与顶栏球同状态）+ 学院名 */}
      <div className="w6-tb-left">
        <Mark
          size={36}
          eva={mode === "eva"}
          state={markState}
          gaze={gaze}
          fast={mode === "eva"}
          ritual={ritual}
        />
        <span className="w6-tb-title">CASSELL COLLEGE</span>
        <span className="w6-tb-sub">卡塞尔专员终端</span>
      </div>

      {/* 中：模式切换器（主入口）——分段控件，点按即走 handleModeChange */}
      <div className="w6-tb-mid">
        <div
          className="w6-tb-seg"
          data-tauri-drag-region="false"
          role="tablist"
          aria-label="模式切换"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "norma"}
            className={mode === "norma" ? "w6-on" : ""}
            onClick={() => onModeChange("norma")}
            title="诺玛 · 通用工作"
          >
            {MODE_LABELS.norma}
            <span className="w6-seg-sub">通用</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "eva"}
            className={mode === "eva" ? "w6-on w6-on-eva" : ""}
            onClick={() => onModeChange("eva")}
            title="EVA · 工程开发"
          >
            {MODE_LABELS.eva}
            <span className="w6-seg-sub">工程</span>
          </button>
        </div>
      </div>

      {/* 右：窗口按钮（系统惯例）——最小化 / 最大化·还原 / 关闭 */}
      <div className="w6-tb-wins" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={minimize}
          disabled={!winApi}
          aria-label="最小化"
          title="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={toggleMaximize}
          disabled={!winApi}
          aria-label={maximized ? "还原" : "最大化"}
          title={maximized ? "还原" : "最大化"}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="1.5" y="3.5" width="7" height="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.5 3.5 V2 a1 1 0 0 1 1-1 H9.5 a1 1 0 0 1 1 1 V7 a1 1 0 0 1-1 1 H8.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="w6-close"
          onClick={close}
          disabled={!winApi}
          aria-label="关闭"
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}
