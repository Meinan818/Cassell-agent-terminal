import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  FileEntry,
  InspectorView,
  ReviewState,
  Settings,
} from "../types";
import Mark from "./Mark";

export interface MergeSummary {
  paths: string[];
  additions: number;
  deletions: number;
  at: string;
}

const STATUS_LABEL: Record<string, string> = {
  modified: "已修改",
  added: "新增",
  deleted: "已删除",
  untracked: "未追踪",
  renamed: "已重命名",
};

interface RightPanelProps {
  /** Inspector 当前视图（App 持有；null 时不渲染本组件）。 */
  view: InspectorView;
  onViewChange: (view: InspectorView) => void;
  onClose: () => void;
  /** L3 决策展开：扩宽到 480px。 */
  wide: boolean;
  onToggleWide: () => void;
  running: boolean;
  runningTaskTitle: string | null;
  workdir: string;
  review: ReviewState | null;
  reviewError: string | null;
  onRefreshReview: () => void;
  onApproveFile: (path: string) => void;
  onRejectFile: (path: string) => void;
  onUndoFile: (path: string) => void;
  onAcceptAll: () => void;
  onUndoMerge: () => void;
  onDismissMerge: () => void;
  merge: MergeSummary | null;
  terminalLines: string[];
  onRunShell: (cmd: string) => void;
  settings: Settings;
  onToggleExtension: (id: string) => void;
}

const VIEWS: { id: InspectorView; label: string }[] = [
  { id: "review", label: "审查" },
  { id: "terminal", label: "终端" },
  { id: "files", label: "文件" },
  { id: "browser", label: "浏览器" },
  { id: "plugins", label: "插件" },
  { id: "workflow", label: "工作流" },
];

export default function RightPanel(props: RightPanelProps) {
  const {
    view,
    onViewChange,
    onClose,
    wide,
    onToggleWide,
    running,
    runningTaskTitle,
    workdir,
    review,
    reviewError,
    onRefreshReview,
    onApproveFile,
    onRejectFile,
    onUndoFile,
    onAcceptAll,
    onUndoMerge,
    onDismissMerge,
    merge,
    terminalLines,
    onRunShell,
    settings,
    onToggleExtension,
  } = props;

  // ---- Files view state ----
  const [dir, setDir] = useState(workdir);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    if (view !== "files") return;
    let alive = true;
    invoke<FileEntry[]>("list_files", { path: dir })
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [view, dir]);

  useEffect(() => {
    setDir(workdir);
  }, [workdir]);

  const openFile = (f: FileEntry) => {
    if (f.is_dir) {
      setDir(f.path);
      setPreview(null);
      return;
    }
    invoke<string>("read_file", { path: f.path })
      .then((text) => setPreview({ path: f.path, text }))
      .catch((e) => setPreview({ path: f.path, text: `无法预览：${e}` }));
  };

  // ---- Terminal view state ----
  const [cmd, setCmd] = useState("");
  const runCmd = (c: string) => {
    const t = c.trim();
    if (!t) return;
    setCmd("");
    onRunShell(t);
  };

  // ---- Browser view state（agent 工作视图：看文档、看页面） ----
  const [url, setUrl] = useState("");
  const openWebUrl = async () => {
    const u = url.trim();
    if (!u) return;
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    try {
      await openUrl(full);
    } catch {
      // opener failed; nothing to fake — leave the URL in the box.
    }
  };

  const pendingCount = (review?.files ?? []).filter(
    (f) => (f.state ?? "pending") === "pending",
  ).length;
  const plugins = settings.extensions.filter((e) => e.kind === "plugin");
  const mcps = settings.extensions.filter((e) => e.kind === "mcp");
  const enabledCount = settings.extensions.filter((e) => e.enabled).length;

  return (
    <aside
      className={`w2-inspector ${wide ? "w2-wide" : ""}`}
      role="dialog"
      aria-label="Inspector"
    >
      <div className="w2-insp-head">
        <div className="w2-insp-title-row">
          <span>Inspector</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="w2-icon-btn"
            onClick={onToggleWide}
            aria-label={wide ? "收起 Inspector" : "展开 Inspector"}
            title={wide ? "收起（360px）" : "展开（480px）"}
          >
            {wide ? "›" : "‹"}
          </button>
          <button
            type="button"
            className="w2-icon-btn"
            onClick={onClose}
            aria-label="关闭 Inspector"
            title="关闭（Esc）"
          >
            ×
          </button>
        </div>
        <div className="w2-seg" role="tablist" aria-label="Inspector 视图">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? "w2-on" : ""}
              onClick={() => onViewChange(v.id)}
            >
              {v.label}
              {v.id === "review" && pendingCount > 0 && (
                <span className="rp-badge">{pendingCount}</span>
              )}
              {v.id === "plugins" && enabledCount > 0 && (
                <span className="rp-badge">{enabledCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="w2-insp-body">
        <div className="w2-view" key={view}>
          {view === "review" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>审查队列</span>
                <button type="button" className="btn-ghost" onClick={onRefreshReview}>
                  刷新
                </button>
              </div>

              {merge && (
                <div className="merge-card" role="status">
                  <div className="merge-title">✓ 全部变更已接受</div>
                  <div className="merge-stats">
                    {merge.paths.length} 个文件 · +{merge.additions} −{merge.deletions} ·{" "}
                    {new Date(merge.at).toLocaleTimeString("zh-CN", { hour12: false })}
                  </div>
                  <div className="merge-actions">
                    <button type="button" className="btn-ghost" onClick={onUndoMerge}>
                      撤销
                    </button>
                    <button type="button" className="btn-ghost" onClick={onDismissMerge}>
                      知道了
                    </button>
                  </div>
                </div>
              )}

              {reviewError && <div className="rp-error">{reviewError}</div>}

              {review && !review.is_git && (
                <div className="rp-empty">
                  <Mark size={48} state="waiting" />
                  <div className="rp-empty-title">工作区不是 Git 仓库</div>
                  <div className="rp-empty-text">
                    无法按 diff 审查变更。先在设置里选一个 Git 仓库作为工作区。
                  </div>
                </div>
              )}

              {review && review.is_git && review.files.length === 0 && !merge && (
                <div className="rp-empty">
                  <Mark size={48} state="idle" />
                  <div className="rp-empty-title">没有待审查的变更</div>
                  <div className="rp-empty-text">
                    诺玛完成改动后，变更会列在这里，等你逐项通过或拒绝。
                  </div>
                </div>
              )}

              {review && review.files.length > 0 && (
                <>
                  <div className="rp-summary">
                    {review.files.length} 个文件 · +{review.additions} −{review.deletions}
                  </div>
                  <div className="review-list">
                    {review.files.map((f) => {
                      const state = f.state ?? "pending";
                      return (
                        <div key={f.path} className={`review-file state-${state}`}>
                          <div className="review-file-head">
                            <span className="review-status">{STATUS_LABEL[f.status] ?? f.status}</span>
                            <span className="review-path" title={f.path}>
                              {f.path}
                            </span>
                            <span className="review-stats">
                              +{f.additions} −{f.deletions}
                            </span>
                          </div>
                          <div className="review-file-actions">
                            {state === "pending" && (
                              <>
                                <button
                                  type="button"
                                  className="btn-approve"
                                  onClick={() => onApproveFile(f.path)}
                                >
                                  通过
                                </button>
                                <button
                                  type="button"
                                  className="btn-reject"
                                  onClick={() => onRejectFile(f.path)}
                                >
                                  拒绝
                                </button>
                              </>
                            )}
                            {state === "approved" && (
                              <>
                                <span className="review-state-label ok">✓ 已通过</span>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => onUndoFile(f.path)}
                                >
                                  撤销
                                </button>
                              </>
                            )}
                            {state === "rejected" && (
                              <span className="review-state-label bad">
                                ✕ 已拒绝 · 已还原到 HEAD
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="btn-primary rp-accept-all"
                    disabled={pendingCount === 0}
                    onClick={onAcceptAll}
                  >
                    接受全部变更（{pendingCount}）
                  </button>
                </>
              )}
            </div>
          )}

          {view === "terminal" && (
            <div className="rp-section terminal-tab">
              <div className="rp-head">
                <span>终端</span>
                <span className="rp-note">{workdir || "工作区未设置"}</span>
              </div>
              <div className="term-log" aria-live="polite">
                {terminalLines.length === 0 && (
                  <div className="term-line dim">终端就绪。输入命令，回车执行。</div>
                )}
                {terminalLines.map((l, i) => (
                  <div key={i} className="term-line">
                    {l}
                  </div>
                ))}
              </div>
              <div className="term-quick">
                {["pwd", "ls", "git status"].map((c) => (
                  <button key={c} type="button" onClick={() => runCmd(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="term-input"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runCmd(cmd);
                }}
                placeholder="$ 输入命令，回车执行"
                aria-label="终端命令"
              />
            </div>
          )}

          {view === "files" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>文件</span>
                <span className="rp-note">{dir}</span>
              </div>
              <div className="file-list">
                {dir !== workdir && (
                  <button
                    type="button"
                    className="file-row"
                    onClick={() => {
                      const parent =
                        dir.split(/[\\/]/).slice(0, -1).join("/") || workdir;
                      setDir(parent);
                      setPreview(null);
                    }}
                  >
                    ← 上一级
                  </button>
                )}
                {entries.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className="file-row"
                    onClick={() => openFile(f)}
                  >
                    {f.is_dir ? "▸ " : "· "}
                    {f.name}
                  </button>
                ))}
                {entries.length === 0 && <div className="rp-empty-text">该目录为空</div>}
              </div>
              {preview && (
                <div className="file-preview">
                  <div className="file-preview-head">{preview.path}</div>
                  <pre>{preview.text}</pre>
                </div>
              )}
            </div>
          )}

          {view === "browser" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>浏览器</span>
              </div>
              <div className="rp-empty-text">
                Agent 工作视图：查看文档与页面。打开后走系统浏览器；学院邀请码已收到侧栏段位牌里。
              </div>
              <div className="browser-card">
                <div className="browser-card-title">打开网页</div>
                <div className="browser-open-row">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openWebUrl();
                    }}
                    placeholder="输入网址，如 github.com"
                    aria-label="网址"
                  />
                  <button type="button" className="btn-primary" onClick={openWebUrl}>
                    打开
                  </button>
                </div>
                <div className="rp-empty-text">
                  在系统浏览器中打开。内置浏览器下个版本接入。
                </div>
              </div>
            </div>
          )}

          {view === "plugins" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>插件与 MCP</span>
                <span className="rp-note">
                  已安装 {settings.extensions.length} · 已启用 {enabledCount}
                </span>
              </div>
              <div className="popover-section">已安装插件</div>
              <div className="ext-list">
                {plugins.map((e) => (
                  <div key={e.id} className="ext-row">
                    <div className="ext-info">
                      <div className="ext-name">{e.name}</div>
                      <div className="ext-detail">{e.detail}</div>
                    </div>
                    <button
                      type="button"
                      className={`switch ${e.enabled ? "on" : ""}`}
                      role="switch"
                      aria-checked={e.enabled}
                      aria-label={`${e.name} 开关`}
                      onClick={() => onToggleExtension(e.id)}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="popover-section">MCP 服务器</div>
              <div className="ext-list">
                {mcps.map((e) => (
                  <div key={e.id} className="ext-row">
                    <div className="ext-info">
                      <div className="ext-name">{e.name}</div>
                      <div className="ext-detail">{e.detail}</div>
                    </div>
                    <button
                      type="button"
                      className={`switch ${e.enabled ? "on" : ""}`}
                      role="switch"
                      aria-checked={e.enabled}
                      aria-label={`${e.name} 开关`}
                      onClick={() => onToggleExtension(e.id)}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="rp-empty-text">
                开关实时保存。MCP 服务器的实际接入在下个版本完成。
              </div>
            </div>
          )}

          {view === "workflow" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>工作流</span>
                <span className="rp-note">并行入口</span>
              </div>
              {running && runningTaskTitle ? (
                <div className="review-list">
                  <div className="review-file">
                    <div className="review-file-head">
                      <span className="review-status">{runningTaskTitle}</span>
                      <span className="w2-pill run">进行中</span>
                    </div>
                    <div className="rp-empty-text">
                      当前任务正在执行。Ultracode 开启后，复杂任务会在这里拆成多路并行，每路的状态与进度都能点开看。
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rp-empty">
                  <Mark size={48} state="idle" />
                  <div className="rp-empty-title">没有并行任务</div>
                  <div className="rp-empty-text">
                    打开 Ultracode 开关后，复杂任务会在这里并行。
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
