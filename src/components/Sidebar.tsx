import { useMemo, useState } from "react";
import type { Mode, Task } from "../types";
import Mark from "./Mark";

interface SidebarProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  onOpenDrawer: (which: "settings" | "archive" | "help") => void;
  /** 身份卡显示名（空 = 默认“路明非”，由调用方处理回退）。 */
  displayName: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  running: boolean;
  drawer: "settings" | "archive" | "help" | null;
}

const INVITE_CODE = "CASSELL-S2017-0117";

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
  onOpenDrawer,
  displayName,
  mode,
  onModeChange,
  running,
  drawer,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (query && !t.title.includes(query)) return false;
    return true;
  });

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_CODE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
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
      status: mode === "eva" && running ? "并行中" : "待命",
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
              className={`w2-roster-row ${mode === r.id ? "w2-on" : ""}`}
              onClick={() => onModeChange(r.id)}
              aria-pressed={mode === r.id}
              title={`切换到${r.name}（${r.sub}）`}
            >
              <Mark size={28} eva={r.eva} state="idle" />
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

      {/* ② 新建任务（行内轻量按钮）+ 搜索入口（点开即 Cmd-K；面板是 S7 的活，
          本波先留入口，点开是行内过滤输入框——真实可用，不是假按钮） */}
      <div className="side-section">
        <button className="w2-side-action" onClick={onNewTask} type="button">
          ＋ 新任务
          <span className="w2-kbd">⌘N</span>
        </button>
        {searchOpen ? (
          <input
            className="w2-search-input"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setSearchOpen(false);
              }
            }}
            placeholder="搜索任务…（Esc 收起）"
            aria-label="搜索任务"
          />
        ) : (
          <button
            className="w2-side-action"
            onClick={() => setSearchOpen(true)}
            type="button"
          >
            搜索任务…
            <span className="w2-kbd">⌘K</span>
          </button>
        )}
      </div>

      {/* ③ 最近：带状态标签；项目分组收进下方可折叠的一组 */}
      <div className="side-section side-tasks">
        <div className="side-section-title">最近</div>
        {visible.map((t) => {
          const isRunning = running && t.id === activeTaskId;
          const done = t.messages.length > 0;
          return (
            <button
              key={t.id}
              type="button"
              className={`side-task ${t.id === activeTaskId ? "active" : ""}`}
              onClick={() => onSelectTask(t.id)}
            >
              <span className="w2-task-top">
                <span className="side-task-title">{t.title}</span>
                {isRunning ? (
                  <span className="w2-pill run">运行中</span>
                ) : done ? (
                  <span className="w2-pill done">已完成</span>
                ) : null}
              </span>
              <span className="side-task-meta">{t.project}</span>
            </button>
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
        <div className="w2-rank">
          <div className="w2-rank-top">
            <span className="w2-crest" title="卡塞尔学院">
              卡
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
          <div className="w2-invite">
            邀请码 {INVITE_CODE}
            <button type="button" onClick={copyInvite}>
              {copied ? "✓ 已复制" : "复制"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
