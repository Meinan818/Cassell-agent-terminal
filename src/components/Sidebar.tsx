import { useMemo, useState } from "react";
import type { Mode, Task } from "../types";
import Mark, { type MarkState } from "./Mark";

interface SidebarProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  /** P2-1：任务行悬停重命名（双击标题也可）与删除（两步确认）。 */
  onRenameTask: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onOpenDrawer: (which: "settings" | "archive" | "help") => void;
  /** 搜索入口：点开即 Cmd-K 命令面板（S7），不再是行内过滤框。 */
  onOpenPalette: () => void;
  /** 身份卡显示名（空 = 默认“路明非”，由调用方处理回退）。 */
  displayName: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  running: boolean;
  /** P2-6：名册与输入框芯片的球接同一份 markState，不要永远 idle。 */
  markState: MarkState;
  drawer: "settings" | "archive" | "help" | null;
  /**
   * 切换仪式（第 3 步第四波）：App 的 handleModeChange 统一派发；
   * 名册行与段位牌在仪式里点亮/褪去，球与顶栏共用同一份仪式。
   */
  ritual?: { dir: Mode; startedAt: number } | null;
}

/** P2-2：任务行相对时间（“2 小时前”）。 */
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** 1.5px 描边线条图标（与全站同一套；禁用 emoji ⚙/▤/?）。 */
function LineIcon({ kind }: { kind: "gear" | "archive" | "help" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "gear") {
    return (
      <svg {...common}>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (kind === "archive") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="5" rx="1" />
        <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
        <path d="M10 13h4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}

export default function Sidebar({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onRenameTask,
  onDeleteTask,
  onOpenDrawer,
  onOpenPalette,
  displayName,
  mode,
  onModeChange,
  running,
  markState,
  drawer,
  ritual = null,
}: SidebarProps) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const projects = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (t.archived) continue;
      map.set(t.project, (map.get(t.project) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const visible = tasks.filter((t) => {
    if (t.archived) return false;
    if (projectFilter && t.project !== projectFilter) return false;
    return true;
  });

  const saveRename = (t: Task) => {
    if (editingId !== t.id) return;
    if (editTitle.trim()) onRenameTask(t.id, editTitle);
    setEditingId(null);
  };

  const roster: {
    id: Mode;
    name: string;
    sub: string;
    eva: boolean;
    status: string;
    dot: string;
  }[] = [
    {
      id: "norma",
      name: "诺玛",
      sub: "通用工作",
      eva: false,
      status: mode === "norma" && running ? "工作中" : "空闲中",
      dot: mode === "norma" && running ? "busy" : "ok",
    },
    {
      id: "eva",
      name: "EVA",
      sub: "工程开发",
      eva: true,
      // 诚实文案：当前引擎是单智能体循环，EVA 运行时也只说“工作中”，不说“并行中”。
      status: mode === "eva" && running ? "工作中" : "待命",
      dot: mode === "eva" && running ? "busy" : "idle",
    },
  ];

  return (
    <aside className="sidebar">
      {/* ① 名册：侧栏第一眼是两个 agent，不是任务列表 */}
      <div className="side-section">
        <div className="side-section-title">名册</div>
        <div className="w2-roster">
          {roster.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`w2-roster-row ${mode === r.id ? "w2-on" : ""} ${
                // W4 仪式：切入行高亮扫入（状态点脉冲一次），切出行高亮淡出；
                // mode 在 t=0 已翻转，所以切入行就是 ritual.dir 那行。
                ritual
                  ? r.id === ritual.dir
                    ? "w4-roster-in"
                    : "w4-roster-out"
                  : ""
              }`}
              onClick={() => onModeChange(r.id)}
              aria-pressed={mode === r.id}
              title={`切换到${r.name}（${r.sub}）`}
            >
              {/* P2-6：当前模式那行的球接 App 的 markState；另一行永远 idle。 */}
              <Mark
                size={28}
                eva={r.eva}
                state={mode === r.id ? markState : "idle"}
                ritual={ritual}
              />
              <span style={{ minWidth: 0 }}>
                <span className="w2-roster-name">{r.name}</span>
                <span
                  className="w2-roster-sub"
                  style={{ display: "block" }}
                >
                  {r.sub} · {r.status}
                </span>
              </span>
              <span className={`w2-dot ${r.dot}`} />
            </button>
          ))}
        </div>
      </div>

      {/* ② 新建任务（行内轻量按钮）+ 搜索入口（点开即 Cmd-K 命令面板，S7） */}
      <div className="side-section">
        <button className="w2-side-action" onClick={onNewTask} type="button">
          ＋ 新任务
          <span className="w2-kbd">⌘N</span>
        </button>
        <button
          className="w2-side-action"
          onClick={onOpenPalette}
          type="button"
          aria-label="打开命令面板"
          title="命令面板：搜命令、搜任务（⌘K）"
        >
          搜索任务…
          <span className="w2-kbd">⌘K</span>
        </button>
      </div>

      {/* ③ 最近：带状态标签；项目分组收进下方可折叠的一组 */}
      <div className="side-section side-tasks">
        <div className="side-section-title">最近</div>
        {visible.map((t) => {
          const isRunning = running && t.id === activeTaskId;
          const done = t.messages.length > 0;
          return (
            <div
              key={t.id}
              className={`side-task-wrap ${t.id === activeTaskId ? "active" : ""}`}
            >
              {editingId === t.id ? (
                <input
                  className="field-input w2-task-rename"
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(t);
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => saveRename(t)}
                  aria-label="重命名任务"
                  autoComplete="off"
                />
              ) : (
                <button
                  type="button"
                  className={`side-task ${t.id === activeTaskId ? "active" : ""}`}
                  onClick={() => onSelectTask(t.id)}
                  onDoubleClick={() => {
                    setEditingId(t.id);
                    setEditTitle(t.title);
                  }}
                  title="双击重命名"
                >
                  <span className="w2-task-top">
                    <span className="side-task-title">{t.title}</span>
                    {isRunning ? (
                      <span className="w2-pill run">运行中</span>
                    ) : done ? (
                      <span className="w2-pill done">已完成</span>
                    ) : null}
                  </span>
                  <span className="side-task-meta">
                    {t.project} · {relTime(t.createdAt)}
                  </span>
                </button>
              )}
              {/* P2-1：悬停出现重命名与删除（删除两步确认）。 */}
              <span className="w2-task-actions">
                {confirmDeleteId === t.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteTask(t.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      确认删除
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`重命名 ${t.title}`}
                      title="重命名"
                      onClick={() => {
                        setEditingId(t.id);
                        setEditTitle(t.title);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="danger"
                      aria-label={`删除 ${t.title}`}
                      title="删除"
                      onClick={() => setConfirmDeleteId(t.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="side-empty">
            {tasks.length === 0 ? "还没有任务" : "没有匹配的任务"}
          </div>
        )}

        <button
          type="button"
          className="w2-side-action"
          onClick={() => setProjectsOpen(!projectsOpen)}
          aria-expanded={projectsOpen}
          style={{ marginTop: 8 }}
        >
          项目
          <span className="w2-kbd">
            {projects.length} 个 {projectsOpen ? "▾" : "▸"}
          </span>
        </button>
        {projectsOpen && (
          <div style={{ animation: "w2-fade 150ms var(--ease) both" }}>
            {projects.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={`side-project ${projectFilter === name ? "active" : ""}`}
                onClick={() =>
                  setProjectFilter(projectFilter === name ? null : name)
                }
              >
                <span className="side-project-name">{name}</span>
                <span className="side-project-count">{count}</span>
              </button>
            ))}
            {projects.length === 0 && (
              <div className="side-empty">暂无项目</div>
            )}
          </div>
        )}
      </div>

      {/* ④ 段位牌：校徽小印 + 名字 + S 印章 + 等宽编号 + 状态；图标导航 */}
      <div className="side-bottom">
        <div
          className={`w2-rank ${
            // W4 仪式：to-EVA 时蓝环由 0 扩到 1px 落定，EVA 期间常驻蓝环
            //（w4-rank-eva-on，S 印章同步变蓝）；to-诺玛时蓝环褪去。
            ritual
              ? ritual.dir === "eva"
                ? "w4-rank-eva"
                : "w4-rank-norma"
              : mode === "eva"
                ? "w4-rank-eva-on"
                : ""
          }`}
        >
          <div className="w2-rank-top">
            {/* P2-8：校徽圆印用真校徽图片，不再写“卡”字。 */}
            <span className="w2-crest" title="卡塞尔学院">
              <img src="/cassell-seal.jpg" alt="卡塞尔学院校徽" />
            </span>
            <span className="w2-rank-name">{displayName}</span>
            <span className="w2-seal" title="血统评级 S">
              S
            </span>
          </div>
          <div className="w2-rank-id">
            S2017-0117
            <span
              className={`w2-dot ${running ? "busy" : "ok"}`}
              style={{ marginLeft: 0 }}
            />
            {running ? "工作中" : "在线"}
          </div>
          <div className="w2-icon-nav">
            <button
              type="button"
              className={`w2-icon-btn ${drawer === "settings" ? "w2-on" : ""}`}
              onClick={() => onOpenDrawer("settings")}
              aria-label="设置"
              title="设置"
            >
              <LineIcon kind="gear" />
            </button>
            <button
              type="button"
              className={`w2-icon-btn ${drawer === "archive" ? "w2-on" : ""}`}
              onClick={() => onOpenDrawer("archive")}
              aria-label="档案库"
              title="档案库"
            >
              <LineIcon kind="archive" />
            </button>
            <button
              type="button"
              className={`w2-icon-btn ${drawer === "help" ? "w2-on" : ""}`}
              onClick={() => onOpenDrawer("help")}
              aria-label="帮助"
              title="帮助"
            >
              <LineIcon kind="help" />
            </button>
          </div>
          {/* P2-7：邀请码行已拿掉——装饰码没有用途，复制它也加不进任何组织。 */}
        </div>
      </div>
    </aside>
  );
}
