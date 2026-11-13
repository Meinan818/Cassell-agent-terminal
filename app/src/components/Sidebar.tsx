import { useState } from "react";
import type { Mode, Project, Task } from "../types";
import { modKey } from "../platform";
import Mark, { type MarkState } from "./Mark";
import CrestLine from "./CrestLine";

interface SidebarProps {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  /** P0-1：真项目列表——点即切换；每行只显示项目名。 */
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  /** 项目名可改（双击项目行重命名，默认名是文件夹名）。 */
  onRenameProject: (id: string, name: string) => void;
  /** P2-1：任务行悬停重命名（双击标题也可）与删除（两步确认）。 */
  onRenameTask: (id: string, title: string) => void;
  onDeleteTask: (id: string) => void;
  onOpenDrawer: (which: "settings" | "archive" | "help" | "usage") => void;
  /** 搜索入口：点开即 Cmd-K 命令面板（S7），不再是行内过滤框。 */
  onOpenPalette: () => void;
  /** 身份卡显示名（空 = 默认“路明非”，由调用方处理回退）。 */
  displayName: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  running: boolean;
  /** P2-6：名册与输入框芯片的球接同一份 markState，不要永远 idle。 */
  markState: MarkState;
  drawer: "settings" | "archive" | "help" | "usage" | null;
  /**
   * 切换仪式（第 3 步第四波）：App 的 handleModeChange 统一派发；
   * 名册行与段位牌在仪式里点亮/褪去，球与顶栏共用同一份仪式。
   */
  ritual?: { dir: Mode; startedAt: number } | null;
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
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  onRenameProject,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 项目行重命名（双击项目行；与任务重命名同一套交互）。 */
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");

  /** P0-1：任务列表只显示当前项目的任务——切项目后列表跟着走。
   * 没有项目时（全新用户还没打开过文件夹）列表为空，空态引导去新建项目。 */
  const visible = tasks.filter(
    (t) => !t.archived && (activeProjectId === null || t.project === activeProjectId),
  );

  const saveRename = (t: Task) => {
    if (editingId !== t.id) return;
    if (editTitle.trim()) onRenameTask(t.id, editTitle);
    setEditingId(null);
  };

  const saveProjectRename = (p: Project) => {
    if (editingProjectId !== p.id) return;
    if (editProjectName.trim()) onRenameProject(p.id, editProjectName);
    setEditingProjectId(null);
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

  // P0-9 侧栏重点随模式换：NORMA 突出"最近任务/文档"，EVA 突出"项目/代码文件"。
  // 两组内容不变，只换上下顺序（定义在 return 前，渲染处按 mode 换序）。
  const projectSection = (
    <>
          {/* ③ 项目（P0-1 / 位-17）：独立一组，名册之下、最近之上，不再是
              “最近”下面的过滤器。一个项目 = 一个文件夹，点即切换；
              “+ 新建项目”放组顶部——最高频的项目操作，第一眼就能看到。 */}
          <div className="side-section">
            <div className="side-section-title">项目</div>
            <button className="w2-side-action" onClick={onNewProject} type="button">
              ＋ 新建项目
              <span className="w2-kbd">选文件夹</span>
            </button>
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return editingProjectId === p.id ? (
                <input
                  key={p.id}
                  className="field-input w2-task-rename"
                  value={editProjectName}
                  autoFocus
                  onChange={(e) => setEditProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProjectRename(p);
                    else if (e.key === "Escape") setEditingProjectId(null);
                  }}
                  onBlur={() => saveProjectRename(p)}
                  aria-label="重命名项目"
                  autoComplete="off"
                />
              ) : (
                <button
                  key={p.id}
                  type="button"
                  className={`side-project ${isActive ? "active" : ""}`}
                  onClick={() => onSelectProject(p.id)}
                  onDoubleClick={() => {
                    setEditingProjectId(p.id);
                    setEditProjectName(p.name);
                  }}
                  aria-pressed={isActive}
                  title={p.path ? `${p.name}\n${p.path}\n双击重命名` : `${p.name}\n双击重命名`}
                >
                  <span className="side-project-name">{p.name}</span>
                </button>
              );
            })}
            {projects.length === 0 && (
              <div className="side-empty">
                还没有项目
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={onNewProject}
                  >
                    打开一个项目文件夹
                  </button>
                </div>
              </div>
            )}
          </div>
    </>
  );
  const recentSection = (
    <>
          {/* ④ 最近：只列当前项目的任务；切项目后这里跟着换。 */}
          <div className="side-section side-tasks">
            <div className="side-section-title">最近</div>
            {visible.map((t) => {
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
                      <span className="side-task-title">{t.title}</span>
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
                {tasks.length === 0
                  ? "还没有任务"
                  : activeProjectId === null
                    ? "先打开一个项目文件夹"
                    : "这个项目还没有任务"}
              </div>
            )}
          </div>
    </>
  );

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
          <span className="w2-kbd">{modKey("N")}</span>
        </button>
        <button
          className="w2-side-action"
          onClick={onOpenPalette}
          type="button"
          aria-label="打开命令面板"
          title={`命令面板：搜命令、搜任务（${modKey("K")}）`}
        >
          搜索任务…
          <span className="w2-kbd">{modKey("K")}</span>
        </button>
      </div>

      {/* P0-9：NORMA 下"最近"在上、"项目"在下；EVA 下"项目"在上、"最近"在下。 */}
      {mode === "norma" ? (
        <>
          {recentSection}
          {projectSection}
        </>
      ) : (
        <>
          {projectSection}
          {recentSection}
        </>
      )}


      {/* ⑤ 段位牌：校徽小印 + 名字 + S 印章 + 等宽编号 + 状态；图标导航 */}
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
            {/* Deline 6：校徽改白色线条版（CrestLine 矢量线稿），不用照片。 */}
            <span className="w2-crest" title="卡塞尔学院">
              <CrestLine size={22} />
            </span>
            <span className="w2-rank-school">卡塞尔学院</span>
            {/* Deline 6：S 印章回归定版——大号优雅衬线 S + 1px 发丝圆环，无实心圆底、无“血统评级”文字。 */}
            <span className="w2-seal" title="S">
              S
            </span>
          </div>
          {/* Deline 6：横向名片比例——名字 + 编号 + 状态并在一行，卡片不再是矮胖正方形。 */}
          <div className="w2-rank-line">
            <span className="w2-rank-name">{displayName}</span>
            <span className="w2-rank-id">
              S2017-0117
              <span
                className={`w2-dot ${running ? "busy" : "ok"}`}
                style={{ marginLeft: 0 }}
              />
              {running ? "工作中" : "在线"}
            </span>
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
