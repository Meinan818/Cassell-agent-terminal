import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  FileEntry,
  InspectorView,
  ReviewFile,
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
  /** 正在退场：先播 180ms 滑出动画再卸载（App 的 useOverlayExitValue）。 */
  closing?: boolean;
  /** L3 决策展开：扩宽到 480px。 */
  wide: boolean;
  onToggleWide: () => void;
  running: boolean;
  runningTaskTitle: string | null;
  /** 本对话累计用量（App 已算出；无用量数据时 replies 为 0）。 */
  usageTotal?: {
    prompt: number;
    completion: number;
    total: number;
    replies: number;
  } | null;
  /** 本轮工具调用（App 从 kind:"tool" 的消息汇总；无分步耗时）。 */
  toolCalls?: { label: string; detail: string }[];
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
  /**
   * 保留的 prop：插件开关目前是“未接入”禁用态，故本面板不再调用它。
   * 引擎真正消费 extensions[].enabled 后再恢复拨动。
   */
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

const TERM_HISTORY_KEY = "cassell-term-history";
const DIFF_LINE_CAP = 400;
const PREVIEW_LINE_CAP = 2000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function quoteForShell(p: string): string {
  // git paths come from `git status`; strip line breaks, double-quote the rest.
  // Works for sh -c and cmd /C for ordinary paths (quotes in names are not supported).
  return `"${p.replace(/[\r\n]/g, "").replace(/"/g, '\\"')}"`;
}

/** diff 文本按行着色：+ 绿底、− 红底、@@ 蓝、文件头灰。纯文本节点渲染，不拼 HTML。 */
function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, DIFF_LINE_CAP);
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        lineHeight: 1.7,
        background: "var(--bg-soft)",
        borderRadius: 8,
        padding: "8px 10px",
        overflowX: "hidden",
      }}
    >
      {shown.map((l, i) => {
        let style: React.CSSProperties = {
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        };
        if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ")) {
          style = { ...style, color: "var(--text-3)" };
        } else if (l.startsWith("+")) {
          style = { ...style, background: "var(--ok-soft)" };
        } else if (l.startsWith("-")) {
          style = { ...style, background: "var(--danger-soft)" };
        } else if (l.startsWith("@@")) {
          style = { ...style, color: "var(--accent)", fontWeight: 700 };
        }
        return (
          <div key={i} style={style}>
            {l || " "}
          </div>
        );
      })}
      {lines.length > DIFF_LINE_CAP && (
        <div style={{ color: "var(--text-3)", marginTop: 4 }}>
          仅显示前 {DIFF_LINE_CAP} 行，共 {lines.length} 行
        </div>
      )}
    </div>
  );
}

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "json",
  "css", "scss", "toml", "yaml", "yml", "sh", "md",
]);

const KEYWORDS = new Set(
  ("const let var function return if else for while import from export default class extends " +
    "interface type enum struct impl fn pub mut match use mod async await try catch throw new " +
    "typeof in of switch case break continue do void delete this super static readonly private " +
    "public protected def pass with as lambda None True False and or not elif bool int str float " +
    "true false null undefined").split(" "),
);

/** 单行基础高亮：字符串 / 行注释 / 数字 / 关键字。只做行内，不跨行追踪块注释。 */
function highlightLine(line: string, ext: string): ReactNode[] {
  if (!CODE_EXTS.has(ext) || ext === "md") return [line];
  const hashComment = ext === "py" || ext === "sh" || ext === "toml" || ext === "yaml" || ext === "yml";
  const re = hashComment
    ? /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|#[^\n]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g
    : /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`|\/\/[^\n]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const tok = m[0];
    let style: React.CSSProperties | undefined;
    if (
      tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")
    ) {
      style = { color: "var(--ok)" };
    } else if (tok.startsWith("//") || tok.startsWith("#")) {
      style = { color: "var(--text-3)", fontStyle: "italic" };
    } else if (/^\d/.test(tok)) {
      style = { color: "#d08770" };
    } else if (KEYWORDS.has(tok)) {
      style = { color: "var(--accent)", fontWeight: 600 };
    }
    out.push(
      style ? (
        <span key={k++} style={style}>
          {tok}
        </span>
      ) : (
        tok
      ),
    );
    last = m.index + tok.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

type DiffState =
  | { state: "loading" }
  | { state: "done"; text: string }
  | { state: "error"; error: string };

interface PreviewState {
  path: string;
  text: string;
  /** 非截断预览的真实字节数；截断时为 null（大小未知，只知道 >200KB）。 */
  bytes: number | null;
  truncated: boolean;
}

export default function RightPanel(props: RightPanelProps) {
  const {
    view,
    onViewChange,
    onClose,
    closing = false,
    wide,
    onToggleWide,
    running,
    runningTaskTitle,
    usageTotal,
    toolCalls,
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
  } = props;

  // ---- Review view state ----
  // P0-3：行内 diff（真实 `git diff HEAD`，经已有的 run_shell 命令取；无 get_file_diff 命令）。
  const [diffOpen, setDiffOpen] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({});
  // P0-3：拒绝两步走——先本地标记“已拒绝（未还原）”，点“确认还原”才调 onRejectFile
  //（App 侧的 onRejectFile 会立刻 revert_file，不可逆，所以确认之前绝不调用它）。
  const [rejectStaged, setRejectStaged] = useState<string[]>([]);

  // 审查列表刷新后，丢掉已不在列表里的暂存拒绝（文件已消失时不留幽灵标记）。
  useEffect(() => {
    setRejectStaged((prev) =>
      prev.filter((p) => (review?.files ?? []).some((f) => f.path === p)),
    );
  }, [review]);

  const loadDiff = (f: ReviewFile) => {
    if (diffOpen === f.path) {
      setDiffOpen(null);
      return;
    }
    setDiffOpen(f.path);
    if (diffs[f.path]) return;
    setDiffs((prev) => ({ ...prev, [f.path]: { state: "loading" } }));
    if (f.status === "untracked") {
      // 未追踪文件没有 HEAD 对照：全文即新增，直接读文件当 diff。
      const full = workdir ? `${workdir.replace(/[\\/]+$/, "")}/${f.path}` : f.path;
      invoke<string>("read_file", { path: full })
        .then((text) => {
          const body = text.endsWith("（仅预览前 200KB）")
            ? text
            : text
                .split("\n")
                .map((l) => `+${l}`)
                .join("\n");
          setDiffs((prev) => ({
            ...prev,
            [f.path]: {
              state: "done",
              text: `--- /dev/null\n+++ ${f.path}（未追踪：无 HEAD 对照，全文均为新增）\n${body}`,
            },
          }));
        })
        .catch((e) =>
          setDiffs((prev) => ({
            ...prev,
            [f.path]: { state: "error", error: `读文件失败：${String(e)}` },
          })),
        );
      return;
    }
    invoke<{ stdout: string; stderr: string; code: number | null }>("run_shell", {
      command: `git diff HEAD -- ${quoteForShell(f.path)}`,
      workdir,
    })
      .then((r) => {
        if (r.code !== 0) {
          setDiffs((prev) => ({
            ...prev,
            [f.path]: { state: "error", error: r.stderr.trim() || `git diff 退出码 ${r.code ?? "?"}` },
          }));
          return;
        }
        const text = r.stdout;
        setDiffs((prev) => ({
          ...prev,
          [f.path]: {
            state: "done",
            text: text.trim()
              ? text
              : "与 HEAD 相比没有文本差异（可能是纯模式变化或二进制文件）。",
          },
        }));
      })
      .catch((e) =>
        setDiffs((prev) => ({
          ...prev,
          [f.path]: { state: "error", error: String(e) },
        })),
      );
  };

  const confirmStagedRejects = () => {
    const paths = [...rejectStaged];
    setRejectStaged([]);
    paths.forEach((p) => onRejectFile(p));
  };

  // ---- Files view state ----
  const [dir, setDir] = useState(workdir);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // 列表行文件大小：只有预览过的才知道真实字节数（list_files 不返回 size）。
  const [sizes, setSizes] = useState<Record<string, number>>({});

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
      .then((text) => {
        const truncated = text.endsWith("（仅预览前 200KB）");
        const bytes = truncated ? null : new TextEncoder().encode(text).length;
        if (bytes !== null) setSizes((prev) => ({ ...prev, [f.path]: bytes }));
        setPreview({ path: f.path, text, bytes, truncated });
      })
      .catch((e) => setPreview({ path: f.path, text: `无法预览：${e}`, bytes: null, truncated: false }));
  };

  // ---- Terminal view state ----
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(TERM_HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [draftCmd, setDraftCmd] = useState("");
  // “清空”只隐藏本面板已显示的行（App 持有的 terminalLines 不动，不影响已执行命令）。
  const [clearedAt, setClearedAt] = useState(0);
  const termLogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    termLogRef.current?.scrollTo({ top: termLogRef.current.scrollHeight });
  }, [terminalLines, clearedAt]);

  const runCmd = (c: string) => {
    const t = c.trim();
    if (!t) return;
    setCmd("");
    setHistIdx(null);
    setDraftCmd("");
    setHistory((prev) => {
      if (prev[prev.length - 1] === t) return prev;
      const next = [...prev, t].slice(-100);
      try {
        localStorage.setItem(TERM_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // 存储不可用时历史只留本会话，不报错。
      }
      return next;
    });
    onRunShell(t);
  };

  const onTermKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCmd(cmd);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      if (histIdx === null) setDraftCmd(cmd);
      setHistIdx(next);
      setCmd(history[next]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(null);
        setCmd(draftCmd);
      } else {
        setHistIdx(next);
        setCmd(history[next]);
      }
    }
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
  const visibleTermLines = terminalLines.slice(clearedAt);

  return (
    <aside
      className={`w2-inspector ${wide ? "w2-wide" : ""}${closing ? " closing" : ""}`}
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
                <span style={{ display: "flex", gap: 8 }}>
                  {/* P2-21 面板内能做的部分：关掉浮层去对照对话（审查状态保留在 App 侧）。 */}
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={onClose}
                    title="关闭 Inspector，直接看对话内容；审查状态会保留，回来继续审"
                  >
                    对照对话
                  </button>
                  <button type="button" className="btn-ghost" onClick={onRefreshReview}>
                    刷新
                  </button>
                </span>
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
                    {rejectStaged.length > 0 && ` · 已标记拒绝 ${rejectStaged.length} 个（未还原）`}
                  </div>
                  {/* P0-3：接受全部降级为次要按钮，移到列表顶部；有未确认的拒绝时禁用，避免把已标记拒绝的文件一起批了。 */}
                  <button
                    type="button"
                    className="btn-ghost rp-accept-all"
                    disabled={pendingCount === 0 || rejectStaged.length > 0}
                    title={
                      rejectStaged.length > 0
                        ? "先确认还原或撤销已标记拒绝的文件，再批量接受"
                        : "批量接受全部待审变更（建议先逐项看 diff）"
                    }
                    onClick={onAcceptAll}
                  >
                    接受全部变更（{pendingCount}）
                  </button>
                  {rejectStaged.length > 0 && (
                    <div
                      role="status"
                      style={{
                        background: "var(--danger-soft)",
                        borderRadius: 8,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                        已标记拒绝 {rejectStaged.length} 个文件，尚未还原。确认后才真正还原到
                        HEAD，确认前随时可撤销。
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="btn-reject" onClick={confirmStagedRejects}>
                          确认还原（{rejectStaged.length}）
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setRejectStaged([])}
                        >
                          全部撤销
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="review-list">
                    {review.files.map((f) => {
                      const state = f.state ?? "pending";
                      const staged = rejectStaged.includes(f.path);
                      const diff = diffs[f.path];
                      const isOpen = diffOpen === f.path;
                      return (
                        <div
                          key={f.path}
                          className={`review-file state-${state}`}
                          style={staged ? { background: "var(--danger-soft)" } : undefined}
                        >
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
                            {state === "pending" && !staged && (
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
                                  onClick={() =>
                                    setRejectStaged((prev) =>
                                      prev.includes(f.path) ? prev : [...prev, f.path],
                                    )
                                  }
                                  title="先标记拒绝，确认后才真正还原到 HEAD"
                                >
                                  拒绝
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => loadDiff(f)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? "收起 diff" : "查看 diff"}
                                </button>
                              </>
                            )}
                            {state === "pending" && staged && (
                              <>
                                <span className="review-state-label bad">
                                  ✕ 已拒绝（未还原）
                                </span>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() =>
                                    setRejectStaged((prev) => prev.filter((p) => p !== f.path))
                                  }
                                >
                                  撤销
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => loadDiff(f)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? "收起 diff" : "查看 diff"}
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
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => loadDiff(f)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? "收起 diff" : "查看 diff"}
                                </button>
                              </>
                            )}
                            {state === "rejected" && (
                              <>
                                <span className="review-state-label bad">
                                  ✕ 已拒绝 · 已还原到 HEAD
                                </span>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => loadDiff(f)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? "收起 diff" : "查看 diff"}
                                </button>
                              </>
                            )}
                          </div>
                          {isOpen && (
                            <div>
                              {(!diff || diff.state === "loading") && (
                                <div className="rp-empty-text">正在读取 diff…</div>
                              )}
                              {diff?.state === "error" && (
                                <div className="rp-error">{diff.error}</div>
                              )}
                              {diff?.state === "done" && <DiffView text={diff.text} />}
                              <div className="rp-empty-text" style={{ marginTop: 6 }}>
                                面板太窄？点顶部 ‹ 可扩宽到 480px 看 diff。
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {view === "terminal" && (
            <div className="rp-section terminal-tab">
              <div className="rp-head">
                <span>终端</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="rp-note">{workdir || "工作区未设置"}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setClearedAt(terminalLines.length)}
                    title="只清空本面板的显示，不影响已执行命令"
                  >
                    清空
                  </button>
                </span>
              </div>
              <div className="term-log" aria-live="polite" ref={termLogRef}>
                {visibleTermLines.length === 0 && (
                  <div className="term-line dim">终端就绪。输入命令，回车执行。↑ / ↓ 翻命令历史。</div>
                )}
                {visibleTermLines.map((l, i) => (
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
                onChange={(e) => {
                  setCmd(e.target.value);
                  setHistIdx(null);
                }}
                onKeyDown={onTermKeyDown}
                placeholder="$ 输入命令，回车执行（↑ / ↓ 翻历史）"
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
                    style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}
                    onClick={() => openFile(f)}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.is_dir ? "▸ " : "· "}
                      {f.name}
                    </span>
                    {!f.is_dir && sizes[f.path] != null && (
                      <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-3)" }}>
                        {formatBytes(sizes[f.path])}
                      </span>
                    )}
                  </button>
                ))}
                {entries.length === 0 && <div className="rp-empty-text">该目录为空</div>}
              </div>
              {preview && (
                <div className="file-preview">
                  <div className="file-preview-head">
                    {preview.path}
                    {preview.truncated
                      ? " · 大于 200KB，仅预览前 200KB"
                      : preview.bytes !== null
                        ? ` · ${formatBytes(preview.bytes)} · ${preview.text.split("\n").length} 行`
                        : ""}
                  </div>
                  {(() => {
                    const lines = preview.text.split("\n");
                    const ext = (preview.path.split(".").pop() ?? "").toLowerCase();
                    const shown = lines.slice(0, PREVIEW_LINE_CAP);
                    return (
                      <div
                        style={{
                          maxHeight: 280,
                          overflowY: "auto",
                          overflowX: "hidden",
                          padding: 12,
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                          lineHeight: 1.7,
                        }}
                      >
                        {shown.map((line, i) => (
                          <div
                            key={i}
                            style={{ display: "flex", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}
                          >
                            <span
                              style={{
                                flexShrink: 0,
                                width: "3.5ch",
                                marginRight: 12,
                                textAlign: "right",
                                color: "var(--text-3)",
                                userSelect: "none",
                              }}
                            >
                              {i + 1}
                            </span>
                            <span style={{ minWidth: 0 }}>{highlightLine(line, ext)}</span>
                          </div>
                        ))}
                        {lines.length > PREVIEW_LINE_CAP && (
                          <div style={{ color: "var(--text-3)", marginTop: 4 }}>
                            仅显示前 {PREVIEW_LINE_CAP} 行，共 {lines.length} 行
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                <span className="rp-note">已安装 {settings.extensions.length} · 全部未接入</span>
              </div>
              <div className="rp-empty-text">
                开关暂未接入引擎：拨动不会产生任何效果，故已禁用。引擎真正消费开关后再恢复。
              </div>
              <div className="popover-section">已安装插件</div>
              <div className="ext-list">
                {plugins.map((e) => (
                  <div key={e.id} className="ext-row">
                    <div className="ext-info">
                      <div className="ext-name">
                        {e.name}{" "}
                        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400 }}>
                          未接入
                        </span>
                      </div>
                      <div className="ext-detail">{e.detail}</div>
                    </div>
                    <button
                      type="button"
                      className="switch"
                      disabled
                      aria-disabled="true"
                      aria-label={`${e.name}（未接入，已禁用）`}
                      title="未接入引擎，已禁用"
                      style={{ opacity: 0.45, cursor: "not-allowed" }}
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
                      <div className="ext-name">
                        {e.name}{" "}
                        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400 }}>
                          未接入
                        </span>
                      </div>
                      <div className="ext-detail">{e.detail}</div>
                    </div>
                    <button
                      type="button"
                      className="switch"
                      disabled
                      aria-disabled="true"
                      aria-label={`${e.name}（未接入，已禁用）`}
                      title="未接入引擎，已禁用"
                      style={{ opacity: 0.45, cursor: "not-allowed" }}
                    >
                      <span className="knob" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="rp-empty-text">
                MCP 服务器的实际接入在下个版本完成；接入完成后这里恢复可拨动的开关。
              </div>
            </div>
          )}

          {view === "workflow" && (
            <div className="rp-section">
              <div className="rp-head">
                <span>工作流</span>
                <span className="rp-note">单智能体 · 未并行</span>
              </div>
              {running && runningTaskTitle ? (
                <div className="review-list">
                  <div className="review-file">
                    <div className="review-file-head">
                      <span className="review-status">{runningTaskTitle}</span>
                      <span className="w2-pill run">进行中</span>
                    </div>
                    <div className="rp-empty-text">
                      正在执行本轮任务。当前引擎为单智能体循环 + 工具调用，未开启多路并行编排。
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rp-empty">
                  <Mark size={48} state="idle" />
                  <div className="rp-empty-title">没有正在执行的任务</div>
                  <div className="rp-empty-text">
                    当前引擎为单智能体循环。Ultracode 并行编排接入后，复杂任务会在这里按每路一行显示状态 / 进度 /
                    token。
                  </div>
                </div>
              )}
              <div
                style={{
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>本轮真实信息</div>
                {[
                  { k: "任务", v: runningTaskTitle ?? "—" },
                  { k: "状态", v: running ? "进行中" : "空闲" },
                  {
                    k: "工具调用",
                    v:
                      toolCalls && toolCalls.length > 0
                        ? `共 ${toolCalls.length} 次：${toolCalls.map((t) => t.label).join("、")}`
                        : "本轮还没有工具调用",
                  },
                  {
                    k: "每步耗时",
                    v: "未接入——引擎暂无分步计时",
                  },
                  {
                    k: "累计用量",
                    v:
                      usageTotal && usageTotal.replies > 0
                        ? `↑ ${usageTotal.prompt} · ↓ ${usageTotal.completion} · 共 ${usageTotal.total} tokens（${usageTotal.replies} 条回复）`
                        : "还没有用量数据",
                  },
                ].map((row) => (
                  <div
                    key={row.k}
                    style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.6 }}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-3)", width: 64 }}>{row.k}</span>
                    <span style={{ color: "var(--text-2)" }}>{row.v}</span>
                  </div>
                ))}
              </div>
              {toolCalls && toolCalls.length > 0 && (
                <div
                  style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {toolCalls.map((t, i) => (
                    <div key={i} style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <span style={{ fontFamily: "var(--mono)", color: "var(--text-2)" }}>
                        {t.label}
                      </span>
                      {t.detail ? (
                        <span style={{ color: "var(--text-3)" }}>
                          {" "}
                          （{t.detail.length > 120 ? `${t.detail.slice(0, 120)}…` : t.detail}）
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
