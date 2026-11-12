import { useMemo, useState } from "react";
import type { Task } from "../types";
import Mark from "./Mark";

interface SidebarProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  onOpenDrawer: (which: "settings" | "archive" | "help") => void;
  /** 身份卡显示名（空 = 默认“路明非”，由调用方处理回退）。 */
  displayName: string;
}

export default function Sidebar({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onOpenDrawer,
  displayName,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

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

  return (
    <aside className="sidebar">
      <div className="side-top">
        <button className="btn-primary side-new" onClick={onNewTask} type="button">
          ＋ 新建任务
        </button>
        <input
          className="side-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务…"
          aria-label="搜索任务"
        />
      </div>

      <div className="side-section">
        <div className="side-section-title">项目</div>
        {projects.map(([name, count]) => (
          <button
            key={name}
            type="button"
            className={`side-project ${projectFilter === name ? "active" : ""}`}
            onClick={() => setProjectFilter(projectFilter === name ? null : name)}
          >
            <span className="side-project-name">{name}</span>
            <span className="side-project-count">{count}</span>
          </button>
        ))}
        {projects.length === 0 && (
          <div className="side-empty">暂无项目</div>
        )}
      </div>

      <div className="side-section side-tasks">
        <div className="side-section-title">最近</div>
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`side-task ${t.id === activeTaskId ? "active" : ""}`}
            onClick={() => onSelectTask(t.id)}
          >
            <span className="side-task-title">{t.title}</span>
            <span className="side-task-meta">{t.project}</span>
          </button>
        ))}
        {visible.length === 0 && (
          <div className="side-empty">没有匹配的任务</div>
        )}
      </div>

      <div className="side-bottom">
        <div className="identity-card">
          <Mark size={40} eva={false} state="idle" />
          <div className="identity-info">
            <div className="identity-name">{displayName}</div>
            <div className="identity-id">S2017-0117</div>
          </div>
          <span className="identity-badge" title="血统评级">
            S
          </span>
        </div>
        <div className="side-nav">
          <button type="button" onClick={() => onOpenDrawer("settings")}>
            <span aria-hidden="true">⚙</span>设置
          </button>
          <button type="button" onClick={() => onOpenDrawer("archive")}>
            <span aria-hidden="true">▤</span>档案库
          </button>
          <button type="button" onClick={() => onOpenDrawer("help")}>
            <span aria-hidden="true">?</span>帮助
          </button>
        </div>
      </div>
    </aside>
  );
}
