import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentResult,
  ChatMsg,
  CodexInfo,
  InspectorView,
  Mode,
  ReviewFile,
  ReviewState,
  Settings,
  Task,
} from "./types";
import {
  GREETING_TASKS,
  THEME_KEY,
  greetingForHour,
  resolveTheme,
  uid,
} from "./types";
import type { Theme } from "./types";
import Boot from "./components/Boot";
import Mark, { type MarkState } from "./components/Mark";
import { stateFor } from "./components/mark/ballAdapter";
import Sidebar from "./components/Sidebar";
import Composer from "./components/Composer";
import RightPanel, { type MergeSummary } from "./components/RightPanel";
import {
  ArchiveDrawer,
  HelpDrawer,
  SettingsDrawer,
} from "./components/Drawers";

const TASKS_KEY = "cassell.tasks.v1";

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
.w2-l1 { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font-size: 12px; color: var(--text-3); padding: 8px 24px; background: none; border: none; border-bottom: 1px solid var(--border); transition: color 150ms var(--ease); }
.w2-l1:hover { color: var(--text-2); }
.w2-l1 .w2-dot { margin-left: 0; }
/* ---- 侧栏名册 ---- */
.w2-roster { display: flex; flex-direction: column; gap: 4px; }
.w2-roster-row { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px 8px 12px; border-radius: 8px; transition: background 150ms var(--ease); }
.w2-roster-row:hover { background: var(--bg-hover); }
.w2-roster-row.w2-on { background: var(--accent-soft); }
.w2-roster-row.w2-on::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--accent); }
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
.w2-search-input { width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); color: var(--text); padding: 8px 12px; outline: none; font-size: 13px; animation: w2-fade 150ms var(--ease) both; }
.w2-search-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.w2-task-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
/* ---- 段位牌 ---- */
.w2-rank { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; transition: border-color 150ms var(--ease); }
.w2-rank:hover { border-color: var(--border-strong); }
.w2-rank-top { display: flex; align-items: center; gap: 8px; }
.w2-crest { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--forest); color: var(--forest); display: flex; align-items: center; justify-content: center; font-family: var(--serif); font-size: 10px; font-weight: 700; flex-shrink: 0; }
.w2-rank-name { font-size: 14px; font-weight: 600; }
.w2-seal { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--serif); font-size: 14px; font-weight: 700; color: var(--seal-fg); background: var(--seal-bg); border: 1px solid var(--border-strong); margin-left: auto; flex-shrink: 0; }
.w2-rank-id { font-family: var(--mono); font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 8px; }
.w2-icon-nav { display: flex; gap: 4px; }
.w2-icon-btn { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--text-2); transition: background 150ms var(--ease), color 150ms var(--ease); }
.w2-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
.w2-icon-btn.w2-on { background: var(--accent-soft); color: var(--accent); }
.w2-invite { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.w2-invite button { font-size: 11px; color: var(--accent); padding: 2px 4px; border-radius: 4px; }
/* ---- 时间线三档：B 内联卡片 / C 安静状态行 ---- */
.w2-card { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-panel); overflow: hidden; transition: border-color 150ms var(--ease); }
.w2-card:hover { border-color: var(--border-strong); }
.w2-card-head { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 12px; font-size: 12px; color: var(--text-2); }
.w2-card-title { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 40%; }
.w2-card-sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; color: var(--text-3); font-size: 12px; }
.w2-card-body { padding: 0 12px 12px; font-size: 13px; line-height: 1.65; color: var(--text-2); white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; animation: w2-fade 150ms var(--ease) both; }
.w2-card-body .w2-card-link { font-size: 12px; color: var(--accent); padding: 4px 0 0; }
.w2-card-err { border-left: 2px solid var(--danger); }
.w2-quiet { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); background: none; border: none; padding: 2px 0; transition: color 150ms var(--ease); }
.w2-quiet:hover { color: var(--text-2); }
.msg.eva-note-row { flex-direction: column; align-items: flex-start; gap: 8px; }
/* ---- 新消息：150ms 淡入 + 4px 上移，一次性；无 stagger 入场 ---- */
@keyframes w2-msg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.w2-live { animation: w2-msg-in 150ms var(--ease) both; }
@keyframes w2-fade { from { opacity: 0; } to { opacity: 1; } }
/* ---- Inspector（L2 浮层，不挤压对话区） ---- */
.w2-inspector { position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 92vw; z-index: 60; display: flex; flex-direction: column; background: var(--bg-panel); border-left: 1px solid var(--border); box-shadow: var(--shadow); animation: w2-insp-in 240ms var(--ease-exp) both; }
.w2-inspector.w2-wide { width: 480px; }
@keyframes w2-insp-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
.w2-insp-head { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px 12px 8px; border-bottom: 1px solid var(--border); }
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
/* ---- EVA 切换仪式（1200ms）：spin + 涟漪 + 泛蓝光 ---- */
@keyframes w2-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.w2-ritual-spin { display: inline-flex; animation: w2-spin 1200ms var(--ease-exp); position: relative; }
.w2-ritual-spin::after { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 1px solid var(--accent); opacity: 0; animation: w2-ripple 1200ms var(--ease) both; }
@keyframes w2-ripple { 0% { opacity: 0.5; transform: scale(0.8); } 100% { opacity: 0; transform: scale(1.6); } }
.w2-ritual-glow { position: fixed; inset: 0; z-index: 70; pointer-events: none; background: radial-gradient(ellipse at 50% 0%, rgba(96, 165, 250, 0.12), transparent 60%); animation: w2-glow 600ms var(--ease) both; }
@keyframes w2-glow { from { opacity: 0; } 30% { opacity: 1; } to { opacity: 0; } }
/* ---- 矮窗口紧凑模式（≤760px 高）保留 ---- */
@media (max-height: 760px) {
  .app .empty-state { gap: 8px; }
  .app .chat { padding-top: 12px; gap: 12px; }
  .app .composer-slot { padding-bottom: 12px; }
}
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

/** 出错卡（B 档）：红色左侧 2px 条，不要整块红底。 */
function ErrorCard({ msg }: { msg: ChatMsg }) {
  return (
    <div className="msg">
      <div className="w2-card w2-card-err" style={{ width: "100%" }}>
        <div className="w2-card-head">
          <span className="w2-card-title">出错了</span>
          <span className="w2-card-sum">先看一眼原因，再决定下一步</span>
          <span className="w2-pill bad">错误</span>
        </div>
        <div className="w2-card-body">
          {msg.text}
          <div style={{ marginTop: 4, color: "var(--text-3)" }}>
            可以换个说法再试一次，或检查一下模型配置。
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [boot, setBoot] = useState(true);
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
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
  const [greetIdx, setGreetIdx] = useState(0);
  /** Inspector（S6）：默认不常驻；null = 关闭，打开时对话画布不重排（浮层）。 */
  const [inspector, setInspector] = useState<InspectorView | null>(null);
  const [inspectorWide, setInspectorWide] = useState(false);
  /** EVA 切换仪式进行中的模式（1200ms 内防重入）；模式切换落行（C 档小字）。 */
  const [ritual, setRitual] = useState<Mode | null>(null);
  const [modeLine, setModeLine] = useState<string | null>(null);
  /** 系统偏好（亮/暗）：theme === "system" 时实时跟随。 */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  /** 未配 Key 时点发送的拦截提示（文字保留在输入框里）。 */
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  const settingsRef = useRef<Settings | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const markTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  /** 主题切换：B 层收尾定时器 / 是否已做过首次静默应用 / 上次点击的按钮中心。 */
  const themeTimer = useRef<number | null>(null);
  const themeAppliedRef = useRef(false);
  const themeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const ritualRef = useRef(false);
  const ritualTimer = useRef<number | null>(null);
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

  /** 顶栏主题按钮：浅色 → 深色 → 跟随系统 三态循环（手动选择即退出 system）。 */
  const handleThemeToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!settings) return;
    themeOriginRef.current = { x: e.clientX, y: e.clientY };
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    patchSettings({ theme: next });
  };

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  // ---- Chat auto-scroll: instant jump to bottom while following output ----
  const activeMessages = activeTask?.messages;
  useEffect(() => {
    const el = chatRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeMessages]);

  // ---- Load settings + Codex status on mount ----
  useEffect(() => {
    let alive = true;
    invoke<Settings>("get_settings")
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        if (!s.boot_animation) setBoot(false);
      })
      .catch(() => {
        if (alive) setBoot(false);
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

  // ---- Persist tasks locally ----
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {
      // Storage full or unavailable — tasks still work in memory.
    }
  }, [tasks]);

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

  // ---- Greeting task rotates every 8s ----
  useEffect(() => {
    const t = window.setInterval(
      () => setGreetIdx((i) => (i + 1) % GREETING_TASKS.length),
      8000,
    );
    return () => window.clearInterval(t);
  }, []);

  // ---- Ball cue dispatch (fixed contract for the ball worker) ----
  const dispatchCue = useCallback((cue: string) => {
    window.dispatchEvent(
      new CustomEvent("cassell:ball-cue", { detail: { cue } }),
    );
  }, []);

  // ---- Mode switch (single entry: sidebar roster + composer mode chip) ----
  // 1200ms 仪式：标题栏球 spin 一整圈 + 涟漪 + 泛蓝光 + 对话落一行安静小字；
  // 仪式进行中再点直接忽略（防重入，不许动画排队堆积）。toast 已删——
  // 仪式本身就是反馈，再弹 toast 是噪音。
  const handleModeChange = useCallback(
    (mode: Mode) => {
      if (ritualRef.current) return;
      const cur = settingsRef.current?.mode;
      if (!cur || cur === mode) return;
      patchSettings({ mode });
      ritualRef.current = true;
      setRitual(mode);
      setModeLine(
        mode === "eva" ? "EVA 模式已开启，并行编排启动" : "已切回诺玛",
      );
      if (modeLineTimer.current) window.clearTimeout(modeLineTimer.current);
      modeLineTimer.current = window.setTimeout(
        () => setModeLine(null),
        6000,
      );
      if (ritualTimer.current) window.clearTimeout(ritualTimer.current);
      ritualTimer.current = window.setTimeout(() => {
        ritualRef.current = false;
        setRitual(null);
      }, 1200);
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
                      ? { ...m, streaming: false, text: `启动失败：${e}` }
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
        const task: Task = {
          id: taskId,
          title: text.length > 24 ? `${text.slice(0, 24)}…` : text,
          project: "默认项目",
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

  // 原生引擎的连通测试：真发一条最小请求，不经过 Codex CLI。
  // 注意先落盘再测——Rust 侧从磁盘设置文件里读 Key 与地址。
  const handleTestConnection = () => {
    const s = settingsRef.current;
    if (!s) return;
    setTesting(true);
    setTestResult(null);
    invoke("save_settings", { settings: s })
      .then(() =>
        invoke<{ ok: boolean; detail: string }>("test_provider", {
          // 注意：Tauri v2 命令参数默认转 camelCase，Rust 侧 provider_id 对应 JS 侧 providerId
          providerId: s.provider_id,
          model: s.model,
        }),
      )
      .then((r) => setTestResult(r))
      .catch((e) => setTestResult({ ok: false, detail: String(e) }))
      .finally(() => setTesting(false));
  };

  // 从服务商真实拉取模型列表（GET /models），填进当前服务商的模型目录。
  const handleFetchModels = useCallback(async (): Promise<{
    ok: boolean;
    detail: string;
  }> => {
    const s = settingsRef.current;
    if (!s) return { ok: false, detail: "设置还没加载好" };
    try {
      await invoke("save_settings", { settings: s });
      const models = await invoke<string[]>("list_models", {
        // Tauri v2 命令参数默认转 camelCase（见 test_provider 处注释）
        providerId: s.provider_id,
      });
      if (models.length === 0) {
        return { ok: true, detail: "服务商没有返回任何模型（列表为空）" };
      }
      const pid = s.provider_id;
      patchSettings({
        providers: s.providers.map((p) =>
          p.id === pid ? { ...p, models } : p,
        ),
        model: models.includes(s.model) ? s.model : models[0],
      });
      return { ok: true, detail: `已拉取 ${models.length} 个模型` };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }, [patchSettings]);

  // 系统原生文件夹选择对话框
  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (picked) patchSettings({ workdir: picked });
    } catch {
      // 用户取消或打开失败：保持原工作区不变
    }
  }, [patchSettings]);

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
  const greeting = `${greetingForHour(hour)}，${displayName.charAt(0)}专员。${GREETING_TASKS[greetIdx]}`;
  const hasAnyKey = Object.values(settings.api_keys).some((k) => k?.trim());
  const showEmpty = !activeTask || activeTask.messages.length === 0;

  // L1 安静状态行：有任务在跑 / 有待审查变更 / 模式刚切换时出现，空闲消失。
  const pendingCount = (review?.files ?? []).filter(
    (f) => (f.state ?? "pending") === "pending",
  ).length;
  const l1Text = running
    ? settings.mode === "eva" && settings.ultracode
      ? "并行核查中… 3 个智能体"
      : settings.mode === "eva"
        ? "EVA 正在执行…"
        : "正在思考…"
    : pendingCount > 0
      ? `正在审查 ${pendingCount} 个文件`
      : modeLine;
  const l1Target: InspectorView =
    pendingCount > 0 ? "review" : running ? "workflow" : "review";
  // 新消息一次性出现动效：最后一条用户消息 + 流式中的 AI 气泡（150ms 淡入 + 4px 上移）。
  const messages = activeTask?.messages ?? [];
  const lastUserId =
    [...messages].reverse().find((m) => m.role === "user")?.id ?? null;

  return (
    <div className="app">
      <style>{WAVE2_CSS}</style>
      {boot && settings.boot_animation && <Boot onDone={() => setBoot(false)} />}
      {ritual && <div className="w2-ritual-glow" aria-hidden="true" />}

      <Sidebar
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSelectTask={setActiveTaskId}
        onNewTask={handleNewTask}
        onOpenDrawer={setDrawer}
        displayName={displayName}
        mode={settings.mode}
        onModeChange={handleModeChange}
        running={running}
        drawer={drawer}
      />

      <main className="main">
        <header className="main-head">
          <span className={ritual ? "w2-ritual-spin" : undefined}>
            <Mark
              size={36}
              eva={settings.mode === "eva"}
              state={markState}
              gaze={gaze}
              fast={settings.mode === "eva"}
            />
          </span>
          <div className="main-head-title">
            {activeTask ? activeTask.title : "新任务"}
            <span className="main-head-sub">
              {settings.mode === "eva" ? "EVA" : "诺玛"} · {settings.provider_id}:
              {settings.model} · {settings.effort}
            </span>
          </div>
          <span className="main-head-spacer" />
          {activeTask && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleArchiveTask(activeTask.id)}
            >
              归档
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={handleThemeToggle}
            aria-label="切换主题"
          >
            {settings.theme === "light"
              ? "☾ 深色"
              : settings.theme === "dark"
                ? "◐ 跟随系统"
                : "☀ 浅色"}
          </button>
        </header>

        {l1Text && (
          <button
            type="button"
            className="w2-l1"
            onClick={() => setInspector(l1Target)}
          >
            <span className={`w2-dot ${running ? "busy" : "ok"}`} />
            {l1Text}
            <span aria-hidden="true">›</span>
          </button>
        )}

        {showEmpty ? (
          <div className="empty-state">
            <Mark size={100} eva={settings.mode === "eva"} state="idle" gaze={gaze} fast={settings.mode === "eva"} />
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
                  onClick={() => setDrawer("settings")}
                >
                  连接模型服务商 →
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
              stickToBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            }}
          >
            {messages.map((m) =>
              m.role === "user" ? (
                <div
                  key={m.id}
                  className={`msg user ${m.id === lastUserId ? "w2-live" : ""}`}
                >
                  <div className="msg-body">{m.text}</div>
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
                <ErrorCard key={m.id} msg={m} />
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
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        <div className="composer-slot">
          {gateNotice && (
            <div className="gate-notice" role="alert">
              <span>{gateNotice}</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setDrawer("settings")}
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

      {drawer === "settings" && (
        <SettingsDrawer
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setDrawer(null)}
          codexInfo={codexInfo}
          onTestConnection={handleTestConnection}
          testing={testing}
          testResult={testResult}
          onFetchModels={handleFetchModels}
          onPickFolder={handlePickFolder}
        />
      )}
      {drawer === "archive" && (
        <ArchiveDrawer
          tasks={tasks}
          onRestore={handleRestoreTask}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "help" && <HelpDrawer onClose={() => setDrawer(null)} />}
    </div>
  );
}
