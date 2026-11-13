import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import hljs from "highlight.js/lib/common";
import type {
  FileEntry,
  InspectorView,
  Mode,
  ReviewFile,
  ReviewState,
  Settings,
} from "../types";
import Mark from "./Mark";
import {
  displayNo,
  lineKey,
  parseUnifiedDiff,
  sideBySideRows,
  type DiffLine,
} from "./diffUtils";

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
  /** P0-11 ①③：Inspector 宽度三档 360 / 480 / 720（并排 diff 用超宽档）。 */
  width: number;
  onToggleWidth: () => void;
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
  /** P0-9 当前模式：审查/交付入口与标题随模式换名。 */
  mode: Mode;
  /** P0-11 ②：逐行评论发给 agent（App 的 handleSend 包一层，返回 false 表示没发出去）。 */
  onSendToAgent: (text: string) => boolean;
  /** P0-9 NORMA 交付：本任务里写过的文件（App 从 agent-tool-result 汇总）。 */
  deliverables: { path: string; at: number }[];
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
/** P0-11 ①：文件预览按需渲染，每页行数（不再一次渲染几千行 DOM）。 */
const PREVIEW_PAGE = 300;

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

/** P0-11 ②：逐行评论（存在 localStorage，按文件路径分桶；评论是本地的，
 * 发给智能体后也保留，改完再看 diff 时还能对上）。 */
interface LineComment {
  id: string;
  /** 行定位键：新文件行 n{行号}，删除行 o{行号}。 */
  key: string;
  side: "new" | "old";
  line: number;
  text: string;
  at: number;
}

const COMMENTS_KEY = "cassell-diff-comments-v1";
const DIFF_MODE_KEY = "cassell-diff-mode";

function loadAllComments(): Record<string, LineComment[]> {
  try {
    const raw = localStorage.getItem(COMMENTS_KEY);
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    if (obj && typeof obj === "object") return obj as Record<string, LineComment[]>;
  } catch {
    // 读不到就当没有评论，不报错。
  }
  return {};
}

function saveAllComments(all: Record<string, LineComment[]>) {
  try {
    localStorage.setItem(COMMENTS_KEY, JSON.stringify(all));
  } catch {
    // 存不下也不报错，评论只留本会话。
  }
}

/** P0-11 ②：diff 审查视图——统一/并排切换、逐行评论、hunk 折叠、取消 400 行截断。
 * 超长 diff（>600 行）默认只展开第一个 hunk，其余点开再看，避免一次渲染几千行 DOM。 */
function DiffView({
  text,
  filePath,
  panelWidth,
  onSendToAgent,
}: {
  text: string;
  filePath: string;
  panelWidth: number;
  onSendToAgent: (text: string) => boolean;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(text), [text]);
  const adds = parsed.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.kind === "add").length,
    0,
  );
  const dels = parsed.hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.kind === "del").length,
    0,
  );
  const [mode, setMode] = useState<"unified" | "side">(() => {
    try {
      return localStorage.getItem(DIFF_MODE_KEY) === "side" ? "side" : "unified";
    } catch {
      return "unified";
    }
  });
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() =>
    parsed.totalLines > 600
      ? Object.fromEntries(parsed.hunks.map((_, i) => [i, i !== 0]))
      : {},
  );
  const [comments, setComments] = useState<LineComment[]>(
    () => loadAllComments()[filePath] ?? [],
  );
  const [editing, setEditing] = useState<{
    key: string;
    side: "new" | "old";
    line: number;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [sendNote, setSendNote] = useState<string | null>(null);

  useEffect(() => {
    const all = loadAllComments();
    if (comments.length === 0) delete all[filePath];
    else all[filePath] = comments;
    saveAllComments(all);
  }, [comments, filePath]);

  const setModeAndSave = (m: "unified" | "side") => {
    setMode(m);
    try {
      localStorage.setItem(DIFF_MODE_KEY, m);
    } catch {
      // 存不下就只留本次，不报错。
    }
  };

  const commentsFor = (key: string) => comments.filter((c) => c.key === key);

  const toggleEditor = (l: DiffLine) => {
    const key = lineKey(l);
    const no = displayNo(l);
    if (no === null) return;
    setEditing((prev) =>
      prev?.key === key
        ? null
        : { key, side: l.newNo !== null ? "new" : "old", line: no },
    );
    setDraft("");
    setSendNote(null);
  };

  const saveDraft = () => {
    const t = draft.trim();
    if (!editing || !t) return;
    setComments((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        key: editing.key,
        side: editing.side,
        line: editing.line,
        text: t,
        at: Date.now(),
      },
    ]);
    setDraft("");
    setEditing(null);
  };

  const sendComments = () => {
    if (comments.length === 0) return;
    const lines = comments
      .slice()
      .sort((a, b) => a.line - b.line)
      .map(
        (c) =>
          `- 第 ${c.line} 行（${c.side === "new" ? "新文件" : "旧文件，已删除"}）：${c.text}`,
      );
    const msg =
      `关于 ${filePath} 的 diff，我有以下逐行意见，请只按意见改对应行，不要动其他地方：\n` +
      lines.join("\n");
    const ok = onSendToAgent(msg);
    setSendNote(
      ok
        ? "已发给当前任务的智能体，评论保留在下面。"
        : "没发出去：可能正在运行，或还没配 API Key。评论还留着，稍后再发。",
    );
  };

  /** 某一行下面的评论区：已有评论 + 正在写的输入框。 */
  const commentBlock = (key: string, line: number) => {
    const list = commentsFor(key);
    const isEditing = editing?.key === key;
    if (list.length === 0 && !isEditing) return null;
    return (
      <div className="dv-comments">
        {list.map((c) => (
          <div key={c.id} className="dv-comment">
            <span className="dv-comment-text">{c.text}</span>
            <button
              type="button"
              className="dv-comment-del"
              onClick={() =>
                setComments((prev) => prev.filter((x) => x.id !== c.id))
              }
              title="删除这条评论"
              aria-label="删除这条评论"
            >
              ×
            </button>
          </div>
        ))}
        {isEditing && (
          <div className="dv-comment-editor">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDraft();
                if (e.key === "Escape") {
                  setEditing(null);
                  setDraft("");
                }
              }}
              placeholder={`给第 ${line} 行写一句意见…（回车保存）`}
              aria-label="逐行评论"
              autoFocus
            />
            <button
              type="button"
              className="btn-primary"
              onClick={saveDraft}
              disabled={!draft.trim()}
            >
              保存
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditing(null);
                setDraft("");
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>
    );
  };

  /** 行号按钮：点它给这一行写评论；有评论的行号后面带一个点。 */
  const noButton = (l: DiffLine, which: "old" | "new") => {
    const no = which === "old" ? l.oldNo : l.newNo;
    const key = lineKey(l);
    const has = commentsFor(key).length > 0;
    return (
      <button
        type="button"
        className={`dv-no${has ? " has-comment" : ""}`}
        title={
          no !== null
            ? `点此给第 ${no} 行写评论`
            : which === "old"
              ? "新增行（旧文件无此行）"
              : "删除行（新文件无此行）"
        }
        onClick={() => toggleEditor(l)}
        disabled={no === null}
      >
        {no ?? ""}
      </button>
    );
  };

  const renderUnified = (hunkLines: DiffLine[]) => (
    <>
      {hunkLines.map((l, i) => {
        const key = lineKey(l);
        return (
          <div key={i}>
            <div className={`dv-row k-${l.kind}`}>
              <span className="dv-nos">
                {noButton(l, "old")}
                {noButton(l, "new")}
              </span>
              <span className="dv-sign">
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
              </span>
              <span className="dv-text">{l.text || " "}</span>
            </div>
            {commentBlock(key, displayNo(l) ?? 0)}
          </div>
        );
      })}
    </>
  );

  const renderSide = (hunkLines: DiffLine[]) => {
    const rows = sideBySideRows({ header: "", oldStart: 0, newStart: 0, lines: hunkLines });
    return (
      <div className="dv-side-scroll">
        <div className="dv-side">
          {rows.map((r, i) => {
            const keys = [r.old ? lineKey(r.old) : null, r.next ? lineKey(r.next) : null].filter(
              (k): k is string => k !== null,
            );
            const uniqKeys = [...new Set(keys)];
            return (
              <div key={i} className="dv-side-row">
                <div className={`dv-cell k-${r.old?.kind ?? "blank"}`}>
                  {r.old ? (
                    noButton(r.old, "old")
                  ) : (
                    <span className="dv-no" aria-hidden="true" />
                  )}
                  <span className="dv-text">{r.old?.text ?? ""}</span>
                </div>
                <div className={`dv-cell k-${r.next?.kind ?? "blank"}`}>
                  {r.next ? (
                    noButton(r.next, "new")
                  ) : (
                    <span className="dv-no" aria-hidden="true" />
                  )}
                  <span className="dv-text">{r.next?.text ?? ""}</span>
                </div>
                {uniqKeys.map((k) => {
                  const c = comments.find((x) => x.key === k);
                  return (
                    <div key={k} className="dv-side-comments">
                      {commentBlock(k, c?.line ?? 0)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="dv">
      <div className="dv-toolbar">
        <div className="dv-seg" role="tablist" aria-label="diff 视图">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "unified"}
            className={mode === "unified" ? "on" : ""}
            onClick={() => setModeAndSave("unified")}
          >
            统一
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "side"}
            className={mode === "side" ? "on" : ""}
            onClick={() => setModeAndSave("side")}
          >
            并排
          </button>
        </div>
        <span className="dv-counts">
          +{adds} −{dels} · {parsed.totalLines} 行
        </span>
        {comments.length > 0 && (
          <button type="button" className="btn-ghost" onClick={sendComments}>
            发评论给智能体（{comments.length}）
          </button>
        )}
      </div>
      {sendNote && <div className="dv-note">{sendNote}</div>}
      {mode === "side" && panelWidth < 720 && (
        <div className="dv-note">
          并排视图在窄面板里要左右滑着看；点顶部宽度按钮切到超宽（720px）更舒服。
        </div>
      )}
      {parsed.hunks.length === 0 && (
        <div className="rp-empty-text">没有可显示的 diff 内容。</div>
      )}
      {parsed.hunks.map((h, hi) => (
        <div key={hi} className="dv-hunk">
          <button
            type="button"
            className="dv-hunk-head"
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, [hi]: !prev[hi] }))
            }
            aria-expanded={!collapsed[hi]}
          >
            <span aria-hidden="true">{collapsed[hi] ? "▸" : "▾"}</span>
            <span className="dv-hunk-title">{h.header}</span>
          </button>
          {!collapsed[hi] && (
            <div className="dv-hunk-body">
              {mode === "unified" ? renderUnified(h.lines) : renderSide(h.lines)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** P0-11 ①：文件扩展名 → highlight.js 语言名（lib/common 自带的语言集）。 */
const HL_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  xml: "xml",
  html: "xml",
  sql: "sql",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "cpp",
  rb: "ruby",
  php: "php",
  kt: "kotlin",
  swift: "swift",
  lua: "lua",
  r: "r",
  diff: "diff",
};

/** P0-11 ①：图片类文件先给预览（走已有的 read_file_base64，data URL，不走 asset 协议）。 */
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** P0-11 ①：单行语法高亮（highlight.js，逐行调用；跨行块注释在续行上不着色，
 * 和旧版手写正则同限，覆盖面远胜手写正则）。返回已转义的 HTML 片段，
 * 交给 dangerouslySetInnerHTML（hljs 输出自带转义，不拼原始 HTML）。
 * md 不高亮（正文着色反而难读），未知后缀直接原样显示。 */
function highlightLineHtml(line: string, ext: string): string {
  if (!line) return "";
  const lang = HL_LANG[ext];
  if (!lang || ext === "md" || !hljs.getLanguage(lang)) return escapeHtml(line);
  try {
    return hljs.highlight(line, { language: lang }).value;
  } catch {
    return escapeHtml(line);
  }
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
    width,
    onToggleWidth,
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
    mode,
    onSendToAgent,
    deliverables,
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

  // ---- P0-11 ②：提交已通过的变更（git add + git commit，走后端 commit_files 命令）。
  const approvedFiles = (review?.files ?? []).filter(
    (f) => (f.state ?? "pending") === "approved",
  );
  const [commitMsg, setCommitMsg] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitNote, setCommitNote] = useState<string | null>(null);

  const doCommit = () => {
    const message = commitMsg.trim();
    if (approvedFiles.length === 0 || !message || commitBusy) return;
    setCommitBusy(true);
    setCommitNote(null);
    invoke<string>("commit_files", {
      workdir,
      paths: approvedFiles.map((f) => f.path),
      message,
    })
      .then((result) => {
        setCommitNote(result);
        setCommitMsg("");
        onRefreshReview();
      })
      .catch((e) => setCommitNote(`提交失败：${String(e)}`))
      .finally(() => setCommitBusy(false));
  };

  // ---- Files view state ----
  const [dir, setDir] = useState(workdir);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** P0-11 ①：图片预览的 data URL（和预览文本分开存，点别的文本文件时不串）。 */
  const [imgData, setImgData] = useState<{ path: string; dataUrl: string } | null>(null);
  /** P0-11 ①：改过标记——工作区内相对路径的集合（git status --porcelain 的真实结果）。 */
  const [modified, setModified] = useState<Set<string>>(new Set());
  /** P0-11 ①：预览按需渲染，已显示的行数（点“显示更多”再加一页）。 */
  const [shownLines, setShownLines] = useState(PREVIEW_PAGE);

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
    // 改过标记：读一次 git status（不是 git 仓库 / 失败时就当没有改动，不报错）。
    if (workdir) {
      invoke<{ stdout: string; stderr: string; code: number | null }>("run_shell", {
        command: "git status --porcelain",
        workdir,
      })
        .then((r) => {
          if (!alive || r.code !== 0) return;
          const set = new Set<string>();
          for (const line of r.stdout.split("\n")) {
            if (line.length < 4) continue;
            const raw = line.slice(3).trim();
            const p = raw.split(" -> ").pop() ?? raw;
            if (p) set.add(p.replace(/\\/g, "/"));
          }
          setModified(set);
        })
        .catch(() => {
          // 不是 git 仓库时静默：没有改过标记而已。
        });
    }
    return () => {
      alive = false;
    };
  }, [view, dir, workdir]);

  useEffect(() => {
    setDir(workdir);
  }, [workdir]);

  /** 工作区内相对路径（改过标记用）：不在工作区内的返回 null。 */
  const relToWorkdir = (abs: string): string | null => {
    if (!workdir) return null;
    const base = workdir.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    const p = abs.replace(/\\/g, "/");
    if (p === base) return "";
    if (p.startsWith(`${base}/`)) return p.slice(base.length + 1);
    return null;
  };

  const openFile = (f: FileEntry) => {
    if (f.is_dir) {
      setDir(f.path);
      setPreview(null);
      setImgData(null);
      return;
    }
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    setShownLines(PREVIEW_PAGE);
    if (IMAGE_EXTS.has(ext)) {
      // 图片：data URL 预览（不走 read_file，那个只给文本）。
      setPreview({ path: f.path, text: "", bytes: f.size ?? null, truncated: false });
      invoke<string>("read_file_base64", { path: f.path })
        .then((dataUrl) => setImgData({ path: f.path, dataUrl }))
        .catch((e) => {
          setImgData(null);
          setPreview({ path: f.path, text: `无法预览图片：${e}`, bytes: null, truncated: false });
        });
      return;
    }
    setImgData(null);
    invoke<string>("read_file", { path: f.path })
      .then((text) => {
        const truncated = text.endsWith("（仅预览前 200KB）");
        const bytes = truncated ? null : new TextEncoder().encode(text).length;
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
      className={`w2-inspector ${width === 720 ? "w2-xwide" : width === 480 ? "w2-wide" : ""}${closing ? " closing" : ""}`}
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
            onClick={onToggleWidth}
            aria-label={`切换 Inspector 宽度（当前 ${width}px）`}
            title={`切换宽度：360 / 480 / 720（并排 diff 用超宽）；当前 ${width}px`}
          >
            {width}
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
              {v.id === "review" ? (mode === "norma" ? "交付" : "审查") : v.label}
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
                <span>{mode === "norma" ? "本次交付" : "审查队列"}</span>
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

              {/* P0-9 NORMA 交付：产出物以文档形式汇总（本任务里写过的文件）。
                  下面的 diff 列表照常显示（文件改动的真实记录）。 */}
              {mode === "norma" && deliverables.length > 0 && (
                <div className="rp-deliverables">
                  <div className="rp-deliverables-title">文档产出</div>
                  {deliverables.map((d) => (
                    <div key={d.path} className="rp-deliverable">
                      <span className="review-path" title={d.path}>
                        {d.path}
                      </span>
                      <span className="rp-deliverable-time">
                        {new Date(d.at).toLocaleTimeString("zh-CN", { hour12: false })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

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
                  {/* P0-11 ②：提交已通过的变更——先逐项通过，再一次提交。 */}
                  {approvedFiles.length > 0 && (
                    <div className="rp-commit">
                      <div className="rp-commit-title">
                        已通过 {approvedFiles.length} 个文件，可以提交了
                      </div>
                      <div className="rp-commit-row">
                        <input
                          value={commitMsg}
                          onChange={(e) => {
                            setCommitMsg(e.target.value);
                            setCommitNote(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") doCommit();
                          }}
                          placeholder="提交信息，如：修复登录接口的空指针"
                          aria-label="提交信息"
                          disabled={commitBusy}
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={doCommit}
                          disabled={!commitMsg.trim() || commitBusy}
                        >
                          {commitBusy ? "提交中…" : `提交（${approvedFiles.length}）`}
                        </button>
                      </div>
                      {commitNote && <div className="rp-commit-note">{commitNote}</div>}
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
                              {diff?.state === "done" && (
                                <DiffView
                                  text={diff.text}
                                  filePath={f.path}
                                  panelWidth={width}
                                  onSendToAgent={onSendToAgent}
                                />
                              )}
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
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {!f.is_dir &&
                        (() => {
                          const rel = relToWorkdir(f.path);
                          return rel !== null && modified.has(rel) ? (
                            <span className="file-mod" title="这个文件改过，还没提交">
                              已修改
                            </span>
                          ) : null;
                        })()}
                      {!f.is_dir && f.size != null && (
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                          {formatBytes(f.size)}
                        </span>
                      )}
                    </span>
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
                        ? ` · ${formatBytes(preview.bytes)}${preview.text ? ` · ${preview.text.split("\n").length} 行` : ""}`
                        : ""}
                    {(() => {
                      const rel = relToWorkdir(preview.path);
                      return rel !== null && modified.has(rel) ? " · 已修改" : "";
                    })()}
                  </div>
                  {imgData && imgData.path === preview.path ? (
                    <div className="fp-img">
                      <img src={imgData.dataUrl} alt={preview.path} />
                    </div>
                  ) : (
                    (() => {
                      const lines = preview.text.split("\n");
                      const ext = (preview.path.split(".").pop() ?? "").toLowerCase();
                      const shown = lines.slice(0, shownLines);
                      return (
                        <div className="fp-lines">
                          {shown.map((line, i) => (
                            <div key={i} className="fp-row">
                              <span className="fp-no">{i + 1}</span>
                              <span
                                className="fp-code"
                                dangerouslySetInnerHTML={{
                                  __html: highlightLineHtml(line, ext) || "&nbsp;",
                                }}
                              />
                            </div>
                          ))}
                          {lines.length > shownLines && (
                            <button
                              type="button"
                              className="btn-ghost fp-more"
                              onClick={() => setShownLines((n) => n + PREVIEW_PAGE)}
                            >
                              显示更多（已显示 {shownLines} / 共 {lines.length} 行）
                            </button>
                          )}
                        </div>
                      );
                    })()
                  )}
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
