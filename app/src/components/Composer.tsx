import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Approval,
  ContextStatus,
  Effort,
  FileEntry,
  Mode,
  RunMode,
  Sandbox,
  Settings,
} from "../types";
import { EFFORTS, EFFORT_LABELS, SANDBOX_LABELS } from "../types";
import Mark, { type MarkState } from "./Mark";
import { EFFORT_DESCS, SANDBOX_DESCS } from "./Drawers";
import type { CommandItem } from "./commands";

interface ComposerProps {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  /** 返回 true = 已接受发送（可以清空输入框）；false = 被拦截（如未配 Key），输入框保留文字。 */
  onSend: (text: string, attachments: string[]) => boolean;
  running: boolean;
  onCancel: () => void;
  /** 模式切换走 App 的统一入口（带 1200ms 仪式，与侧栏名册同步）。 */
  onModeChange: (mode: Mode) => void;
  /** P2-6：名册与 Composer chip 的球接同一份 markState，不要永远 idle。 */
  markState: MarkState;
  /** P1-6：斜杠命令用同一套命令注册表（行首打 / 时弹迷你面板）。 */
  getSlashCommands: (query: string) => CommandItem[];
  /** P0-5 运行模式： "execute" 执行 | "plan" 计划（只调查、出方案）。 */
  runMode: RunMode;
  onRunModeChange: (m: RunMode) => void;
  /** P0-6 目标模式开关：开着时，下一条消息立一个目标（后端自己跑到底）。 */
  goalMode: boolean;
  onGoalModeChange: (v: boolean) => void;
  /** P0-6 当前对话已有进行中的目标：开关收起，显示“目标进行中”。 */
  goalActive: boolean;
  /** P0-5 修改方案：App 点"修改方案"时 +1，输入框聚焦。 */
  focusNonce: number;
  /** P1-17：上下文状态（上轮实报用量 + 顾问决策）。没跑过时为 null，
      仪表条隐藏，不编数字。 */
  contextStatus: ContextStatus | null;
  /** P1-17：仪表条上点“现在压缩”（近上限时才出现）。 */
  onCompactRequest: () => void;
  /** P1-17：点仪表条打开上下文仪表盘抽屉。 */
  onOpenContext: () => void;
}

type Popover = "model" | "perm" | "attach" | "mode" | null;

/** 固定契约：球那位工人按这个 cue 接打字状态（节流约 2s 一次）。 */
function dispatchBallCue(cue: string) {
  window.dispatchEvent(
    new CustomEvent("cassell:ball-cue", { detail: { cue } }),
  );
}

/** P1-17：Composer 常驻的上下文仪表条。数字全部来自后端实报，
    窗口未知时不渲染（不编数字）。 */
function ContextMeter({
  status,
  onCompactRequest,
  onOpenContext,
}: {
  status: ContextStatus;
  onCompactRequest: () => void;
  onOpenContext: () => void;
}) {
  const windowTokens = status.window_tokens ?? 0;
  const ratio =
    windowTokens > 0
      ? Math.min(1, status.prompt_tokens / windowTokens)
      : 0;
  const pct = Math.round(ratio * 100);
  const state =
    ratio >= 0.85 ? "critical" : ratio >= 0.7 ? "warn" : "ok";
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className={`ctx-meter ctx-${state}`} role="status">
      <button
        type="button"
        className="ctx-meter-bar"
        onClick={onOpenContext}
        title="打开上下文仪表盘"
        aria-label={`上下文已用 ${pct}%，打开仪表盘`}
      >
        <span
          className="ctx-meter-fill"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </button>
      <button
        type="button"
        className="ctx-meter-text"
        onClick={onOpenContext}
        title="打开上下文仪表盘"
      >
        上下文 {fmt(status.prompt_tokens)} / {fmt(windowTokens)}（{pct}%）
        {status.hit_rate != null &&
          ` · 缓存命中 ${Math.round(status.hit_rate * 100)}%`}
      </button>
      {state === "warn" && <span className="ctx-meter-note">快满了</span>}
      {state === "critical" && (
        <button
          type="button"
          className="ctx-compact-btn"
          onClick={onCompactRequest}
        >
          现在压缩
        </button>
      )}
    </div>
  );
}

export default function Composer({
  settings,
  onPatch,
  onSend,
  running,
  onCancel,
  onModeChange,
  markState,
  getSlashCommands,
  runMode,
  onRunModeChange,
  goalMode,
  onGoalModeChange,
  goalActive,
  focusNonce,
  contextStatus,
  onCompactRequest,
  onOpenContext,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [popover, setPopover] = useState<Popover>(null);
  /** 菜单正在退场：先播 150ms 回缩动画再卸载（全站铁律：不许“蹦”一下消失）。 */
  const [popClosing, setPopClosing] = useState(false);
  const popCloseTimer = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachDir, setAttachDir] = useState(settings.workdir);
  const [attachFiles, setAttachFiles] = useState<FileEntry[]>([]);
  /** P2-10：附件菜单里的文件名过滤框。 */
  const [attachFilter, setAttachFilter] = useState("");
  const [customModel, setCustomModel] = useState("");
  /** 模型菜单分层：null = 服务商列表；某服务商 id = 该服务商的模型列表。 */
  const [modelLevel, setModelLevel] = useState<string | null>(null);
  /** P1-6：斜杠命令迷你面板的选中行；Esc 隐藏后，下一次打字再出现。 */
  const [slashIdx, setSlashIdx] = useState(0);
  const slashSuppressedRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingCueRef = useRef(0);

  const provider =
    settings.providers.find((p) => p.id === settings.provider_id) ??
    settings.providers[0];

  // Auto-grow the textarea to 184px, then scroll inside (fixes the
  // multi-line long-text complaint: the box never explodes).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 184)}px`;
  }, [text]);

  // Esc closes any popover.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePopover();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  // 卸载时清掉未播完的退出计时器。
  useEffect(
    () => () => {
      if (popCloseTimer.current !== null)
        window.clearTimeout(popCloseTimer.current);
    },
    [],
  );

  // P0-5：App 点"修改方案"时把输入框聚焦（focusNonce 每次 +1 触发，初值 0 不触发）。
  useEffect(() => {
    if (focusNonce > 0) taRef.current?.focus();
  }, [focusNonce]);

  // Load the workdir listing when the attach popover opens.
  useEffect(() => {
    if (popover !== "attach") return;
    let alive = true;
    invoke<FileEntry[]>("list_files", { path: attachDir })
      .then((list) => {
        if (alive) setAttachFiles(list);
      })
      .catch(() => {
        if (alive) setAttachFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [popover, attachDir]);

  const handleTextChange = (value: string) => {
    setText(value);
    setSlashIdx(0);
    // Esc 藏起来的斜杠面板，下一次打字再出现。
    if (value.startsWith("/")) slashSuppressedRef.current = false;
    // 打字 cue：节流约 2s 一次，球据此进 listening。
    const now = Date.now();
    if (value.trim() && now - lastTypingCueRef.current > 2000) {
      lastTypingCueRef.current = now;
      dispatchBallCue("typing-start");
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body || running) return;
    // 只有发送被接受才清空；被拦截（未配 Key）时文字留着。
    if (onSend(body, attachments)) {
      setText("");
      setAttachments([]);
    }
  };

  const togglePopover = (which: Popover) => {
    // P2-10：附件菜单每次打开都回到工作区根目录 + 清空过滤。
    if (which === "attach" && popover !== "attach") {
      setAttachDir(settings.workdir);
      setAttachFilter("");
    }
    // 点同一个芯片 = 关闭（走退出动画）；点另一个芯片 = 直接切换内容，菜单不关。
    if (popover === which) {
      closePopover();
      return;
    }
    if (which !== "model") setModelLevel(null);
    setPopover(which);
  };
  /** 菜单关闭：先播 150ms 回缩动画再卸载；退场中再点直接忽略（150ms 的窗口）。 */
  const closePopover = () => {
    if (popClosing) return;
    setPopClosing(true);
    popCloseTimer.current = window.setTimeout(() => {
      setPopover(null);
      setModelLevel(null);
      setPopClosing(false);
      popCloseTimer.current = null;
    }, 150);
  };

  const pickProvider = (id: string) => {
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return;
    // 换服务商是中间层：不关闭，同一菜单内滑进该服务商的模型列表。
    onPatch({ provider_id: id, model: p.default_model });
    setModelLevel(id);
  };

  const pickModel = (m: string) => {
    onPatch({ model: m });
    closePopover(); // 选到最终项才关闭。
  };
  const pickEffort = (e: Effort) => {
    onPatch({ effort: e });
    // P1-1（用户 07:19 已投诉过一次）：思考强度点选只打勾、不关闭菜单；
    // 只有选到最终项（模型）或点菜单外 / Esc 才关闭。
  };
  const pickApproval = (a: Approval) => {
    onPatch({ approval: a });
    closePopover();
  };
  const pickSandbox = (s: Sandbox) => {
    onPatch({ sandbox: s });
    closePopover();
  };

  const submitCustomModel = () => {
    const m = customModel.trim();
    if (!m) return;
    onPatch({ model: m });
    setCustomModel("");
    closePopover();
  };

  const canSend = text.trim().length > 0 && !running;
  const levelProvider = modelLevel
    ? (settings.providers.find((p) => p.id === modelLevel) ?? provider)
    : null;

  // P1-6：行首打 / 弹出同一套命令注册表的迷你面板（上下键选、回车执行、Esc 关闭）。
  // 有其他菜单开着时不弹；Esc 只是藏起来，下一次打字再出现。
  const slashActive =
    text.startsWith("/") && popover === null && !slashSuppressedRef.current;
  const slashItems = slashActive ? getSlashCommands(text.slice(1)).slice(0, 8) : [];
  const slashSel = Math.min(slashIdx, Math.max(0, slashItems.length - 1));
  const runSlash = (item: CommandItem) => {
    setText("");
    setSlashIdx(0);
    item.run();
  };

  // P2-22：附件 chip 显示相对路径（相对工作区），不是只显示文件名；
  // 悬停 title 仍是完整路径。
  const relPath = (a: string) => {
    const wd = settings.workdir;
    if (wd && a.startsWith(wd)) {
      const r = a.slice(wd.length).replace(/^[/\\]/, "");
      if (r) return r;
    }
    return a.split(/[\\/]/).pop() ?? a;
  };
  // P2-10：附件列表按文件名过滤。
  const attachShown = attachFilter.trim()
    ? attachFiles.filter((f) =>
        f.name.toLowerCase().includes(attachFilter.trim().toLowerCase()),
      )
    : attachFiles;

  return (
    <div className={`composer-wrap ${focused ? "focused" : ""}`}>
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a) => (
            <span key={a} className="attach-chip" title={a}>
              {relPath(a)}
              <button
                type="button"
                aria-label={`移除附件 ${a}`}
                onClick={() => setAttachments(attachments.filter((x) => x !== a))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* P1-6：斜杠命令迷你面板。 */}
      {slashActive && (
        <div className="s7-slash" role="listbox" aria-label="斜杠命令">
          <div className="s7-slash-list">
            {slashItems.length === 0 && (
              <div className="s7-empty">
                没有匹配「{text.slice(1)}」的命令
                <span>换个词试试，或按 Esc 关掉。</span>
              </div>
            )}
            {(() => {
              let lastGroup = "";
              return slashItems.map((item, idx) => {
                const head =
                  item.group !== lastGroup ? (
                    <div className="s7-palette-group" key={`g-${item.group}-${idx}`}>
                      {item.group}
                    </div>
                  ) : null;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {head}
                    <button
                      type="button"
                      className={`s7-palette-item ${idx === slashSel ? "sel" : ""}`}
                      onMouseEnter={() => setSlashIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runSlash(item);
                      }}
                    >
                      <span>{item.title}</span>
                      {item.hint && <span className="s7-palette-hint">{item.hint}</span>}
                    </button>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      <textarea
        ref={taRef}
        className="composer-input"
        value={text}
        rows={1}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (slashActive) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSlashIdx((i) => Math.min(i + 1, slashItems.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSlashIdx((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const item = slashItems[slashSel];
              if (item) runSlash(item);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              slashSuppressedRef.current = true;
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={
          runMode === "plan"
            ? "计划模式：先调查、再出方案，不改文件…例如：把这个项目重构一下，先出方案"
            : settings.mode === "eva"
              ? "向 EVA 下达指令…例如：把校验规则抽成一个单独的函数"
              : "向诺玛下达指令…例如：帮我起草一份会议纪要"
        }
        aria-label={
          settings.mode === "eva" ? "给 EVA 下达指令" : "给诺玛下达指令"
        }
      />

      {/* P1-17：上下文仪表条（常驻）。只在有实报数据、窗口已知时出现；
          ≥70% 标“快满了”，≥85% 挂“现在压缩”按钮。点条打开仪表盘抽屉。 */}
      {contextStatus &&
        contextStatus.has_data &&
        contextStatus.window_tokens != null && (
          <ContextMeter
            status={contextStatus}
            onCompactRequest={onCompactRequest}
            onOpenContext={onOpenContext}
          />
        )}

      <div className="composer-row">
        <button
          type="button"
          className="composer-btn"
          aria-label="附加文件"
          aria-expanded={popover === "attach"}
          onClick={() => togglePopover("attach")}
        >
          ＋
        </button>
        <button
          type="button"
          className="composer-btn w2-shield"
          aria-label="权限与沙箱"
          aria-expanded={popover === "perm"}
          onClick={() => togglePopover("perm")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
          </svg>
          <span
            className={`w2-dot ${settings.approval === "always" ? "warn" : "ok"}`}
            title={
              settings.approval === "always"
                ? "每步问"
                : settings.approval === "never"
                  ? "从不问"
                  : "按需问"
            }
          />
        </button>
        <button
          type="button"
          className="w2-mode-chip"
          aria-label="切换模式"
          aria-expanded={popover === "mode"}
          onClick={() => togglePopover("mode")}
          title="切换模式：诺玛（通用工作）/ EVA（工程开发）"
        >
          <Mark
            size={28}
            eva={settings.mode === "eva"}
            state={markState}
            fast={settings.mode === "eva"}
          />
          {settings.mode === "eva" ? "EVA" : "诺玛"}
          <span aria-hidden="true">▾</span>
        </button>
        {/* P0-5 计划/执行切换：放在模式切换旁边，用户一眼能看到。
            计划模式只调查、出方案，不写文件、不跑命令。 */}
        <div
          className="w2-runmode"
          role="group"
          aria-label="运行模式：执行或计划"
        >
          <button
            type="button"
            className={runMode === "execute" ? "w2-on" : ""}
            aria-pressed={runMode === "execute"}
            onClick={() => onRunModeChange("execute")}
            title="执行：直接动手改文件、跑命令"
          >
            执行
          </button>
          <button
            type="button"
            className={runMode === "plan" ? "w2-on" : ""}
            aria-pressed={runMode === "plan"}
            onClick={() => onRunModeChange("plan")}
            title="计划：只调查、出方案，不改文件"
          >
            计划
          </button>
        </div>
        {/* P0-6 目标开关：放在计划/执行旁边。开着时，下一条消息立一个目标，
            后端自己一轮接一轮跑到底，中途不用点什么。计划模式下不可用
            （计划只调查、不写文件，立目标没有意义）；目标进行中时显示状态。 */}
        {goalActive ? (
          <span
            className="w2-goal-chip w2-on"
            title="目标进行中：这个对话归目标所有，发消息就是接着做目标；结束目标后才能发普通消息"
          >
            目标进行中
          </span>
        ) : (
          <button
            type="button"
            className={`w2-goal-chip ${goalMode ? "w2-on" : ""}`}
            aria-pressed={goalMode}
            disabled={runMode === "plan"}
            onClick={() => onGoalModeChange(!goalMode)}
            title={
              runMode === "plan"
                ? "计划模式下不能立目标（计划只调查、不写文件）"
                : goalMode
                  ? "目标模式已开：下一条消息会立一个目标，自己跑到底"
                  : "目标：下一条消息立一个目标，自己一轮接一轮做到做完为止"
            }
          >
            目标
          </button>
        )}
        <span className="composer-spacer" />
        <button
          type="button"
          className="composer-btn w2-model-chip"
          aria-label="选择模型与思考强度"
          aria-expanded={popover === "model"}
          onClick={() => togglePopover("model")}
        >
          <span className="w2-m1">{settings.model}</span>
          <span className="w2-m2">
            {provider?.name ?? ""} · {EFFORT_LABELS[settings.effort]}
          </span>
        </button>
        {running ? (
          <button
            type="button"
            className="composer-send stop"
            onClick={onCancel}
            aria-label="停止"
          >
            {/* 停止方块：精致 SVG 圆角方块，不再是 Unicode ■ 字符 */}
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2.5" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            onClick={send}
            disabled={!canSend}
            aria-label="发送"
          >
            {/* 上箭头：精致 SVG 描边箭头，不再是 Unicode ↑ 字符 */}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>

      {popover && (
        <>
          <div
            className="popover-backdrop"
            onClick={closePopover}
            aria-hidden="true"
          />
          <div className={popClosing ? "popover closing" : "popover"} role="dialog">
            {popover === "model" && (
              // 分层切换也交叉淡化（key 换层 → pop-level-in 重播），不许硬切。
              <div key={modelLevel ?? "root"} className="w2-pop-level">
                {levelProvider ? (
                  <>
                    <button
                      type="button"
                      className="w2-pop-back"
                      onClick={() => setModelLevel(null)}
                    >
                      ‹ 服务商
                    </button>
                    <div className="popover-title">{levelProvider.name} 的模型</div>
                    <div className="option-list">
                      {(levelProvider.models ?? []).map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`option ${m === settings.model && levelProvider.id === settings.provider_id ? "selected" : ""}`}
                          onClick={() => pickModel(m)}
                        >
                          <span>{m}</span>
                          {m === settings.model &&
                            levelProvider.id === settings.provider_id && (
                              <span className="check">✓</span>
                            )}
                        </button>
                      ))}
                    </div>
                    <div className="custom-model">
                      <input
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitCustomModel();
                        }}
                        placeholder="自定义模型名，回车确认"
                        aria-label="自定义模型名"
                      />
                      <button type="button" onClick={submitCustomModel}>
                        确定
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="popover-title">模型与思考强度</div>
                    <div className="popover-section">服务商（BYOK）</div>
                    <div className="option-list">
                      {settings.providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`option ${p.id === settings.provider_id ? "selected" : ""}`}
                          onClick={() => pickProvider(p.id)}
                        >
                          <span>{p.name}</span>
                          <span className="option-note">
                            {settings.api_keys[p.id]?.trim() ? "已配置 Key" : "未配置 Key"}
                          </span>
                          {p.id === settings.provider_id && <span className="check">✓</span>}
                        </button>
                      ))}
                    </div>
                    <div className="popover-section">思考强度</div>
                    <div className="effort-row">
                      {EFFORTS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={`effort ${settings.effort === e ? "selected" : ""}`}
                          onClick={() => pickEffort(e)}
                          title={EFFORT_DESCS[e]}
                        >
                          {EFFORT_LABELS[e]}
                        </button>
                      ))}
                    </div>
                    {/* P1-2：当前档位一句话说明。 */}
                    <div className="popover-hint">{EFFORT_DESCS[settings.effort]}</div>
                    <div className="popover-hint">
                      点服务商进第二层选模型；选到最终项菜单才收起。
                    </div>
                  </>
                )}
              </div>
            )}

            {popover === "mode" && (
              <>
                <div className="popover-title">切换模式</div>
                <div className="option-list">
                  <button
                    type="button"
                    className={`option ${settings.mode === "norma" ? "selected" : ""}`}
                    onClick={() => {
                      onModeChange("norma");
                      closePopover();
                    }}
                  >
                    <span>诺玛</span>
                    <span className="option-note">通用工作</span>
                    {settings.mode === "norma" && <span className="check">✓</span>}
                  </button>
                  <button
                    type="button"
                    className={`option ${settings.mode === "eva" ? "selected" : ""}`}
                    onClick={() => {
                      onModeChange("eva");
                      closePopover();
                    }}
                  >
                    <span>EVA</span>
                    <span className="option-note">工程开发</span>
                    {settings.mode === "eva" && <span className="check">✓</span>}
                  </button>
                </div>
                <div className="popover-hint">
                  只换模式，不改思考强度与 Ultracode。
                </div>
              </>
            )}

            {popover === "perm" && (
              <>
                <div className="popover-title">权限与沙箱</div>
                <div className="popover-section">审批模式</div>
                <div className="option-list">
                  <button
                    type="button"
                    className={`option ${settings.approval === "always" ? "selected" : ""}`}
                    onClick={() => pickApproval("always")}
                  >
                    <span>每步问</span>
                    <span className="option-note">写文件、跑命令都先问你</span>
                    {settings.approval === "always" && <span className="check">✓</span>}
                  </button>
                  <button
                    type="button"
                    className={`option ${settings.approval === "on-demand" ? "selected" : ""}`}
                    onClick={() => pickApproval("on-demand")}
                  >
                    <span>按需问</span>
                    <span className="option-note">只在危险操作时问你</span>
                    {settings.approval === "on-demand" && <span className="check">✓</span>}
                  </button>
                  <button
                    type="button"
                    className={`option ${settings.approval === "never" ? "selected" : ""}`}
                    disabled={settings.mode === "norma"}
                    title={
                      settings.mode === "norma"
                        ? "诺玛没有从不问档，切到 EVA 再用"
                        : undefined
                    }
                    onClick={() => pickApproval("never")}
                  >
                    <span>从不问</span>
                    <span className="option-note">什么都不问，删根仍拒绝</span>
                    {settings.approval === "never" && <span className="check">✓</span>}
                  </button>
                </div>
                <div className="popover-section">沙箱模式</div>
                <div className="option-list">
                  {(Object.keys(SANDBOX_LABELS) as Sandbox[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`option ${settings.sandbox === s ? "selected" : ""}`}
                      disabled={settings.mode === "norma" && s === "danger-full-access"}
                      title={
                        settings.mode === "norma" && s === "danger-full-access"
                          ? "诺玛没有无边界档，切到 EVA 再用"
                          : undefined
                      }
                      onClick={() => pickSandbox(s)}
                    >
                      <span>{SANDBOX_LABELS[s]}</span>
                      {/* P2-4：沙箱小字用人话，不露原始枚举名。 */}
                      <span className="option-note">{SANDBOX_DESCS[s]}</span>
                      {settings.sandbox === s && <span className="check">✓</span>}
                    </button>
                  ))}
                </div>
                <div className="popover-hint">
                  审批与沙箱是两个独立开关；删根目录任何档位都拒绝。
                </div>
              </>
            )}

            {popover === "attach" && (
              <>
                <div className="popover-title">附加文件（{attachDir || "工作区"}）</div>
                {/* P2-10：文件名过滤框。 */}
                <input
                  className="field-input attach-filter"
                  value={attachFilter}
                  onChange={(e) => setAttachFilter(e.target.value)}
                  placeholder="按文件名过滤…"
                  aria-label="按文件名过滤"
                  autoComplete="off"
                />
                <div className="option-list attach-list">
                  {attachDir !== settings.workdir && (
                    <button
                      type="button"
                      className="option"
                      onClick={() => {
                        const parent = attachDir.split(/[\\/]/).slice(0, -1).join("/") || settings.workdir;
                        setAttachDir(parent);
                      }}
                    >
                      ← 上一级
                    </button>
                  )}
                  {attachShown.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className="option"
                      onClick={() => {
                        if (f.is_dir) {
                          setAttachDir(f.path);
                        } else if (!attachments.includes(f.path)) {
                          setAttachments([...attachments, f.path]);
                        }
                      }}
                    >
                      <span>{f.is_dir ? "▸" : "·"} {f.name}</span>
                      {!f.is_dir && attachments.includes(f.path) && (
                        <span className="check">✓</span>
                      )}
                    </button>
                  ))}
                  {attachShown.length === 0 && (
                    <div className="option-note">
                      {attachFilter.trim() ? "没有匹配的文件" : "该目录为空"}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
