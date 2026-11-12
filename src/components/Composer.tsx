import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Approval,
  Effort,
  FileEntry,
  Mode,
  Sandbox,
  Settings,
} from "../types";
import { EFFORTS, EFFORT_LABELS, SANDBOX_LABELS } from "../types";
import Mark from "./Mark";

interface ComposerProps {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  /** 返回 true = 已接受发送（可以清空输入框）；false = 被拦截（如未配 Key），输入框保留文字。 */
  onSend: (text: string, attachments: string[]) => boolean;
  running: boolean;
  onCancel: () => void;
  /** 模式切换走 App 的统一入口（带 1200ms 仪式，与侧栏名册同步）。 */
  onModeChange: (mode: Mode) => void;
}

type Popover = "model" | "perm" | "attach" | "mode" | null;

/** 固定契约：球那位工人按这个 cue 接打字状态（节流约 2s 一次）。 */
function dispatchBallCue(cue: string) {
  window.dispatchEvent(
    new CustomEvent("cassell:ball-cue", { detail: { cue } }),
  );
}

export default function Composer({
  settings,
  onPatch,
  onSend,
  running,
  onCancel,
  onModeChange,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [popover, setPopover] = useState<Popover>(null);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachDir, setAttachDir] = useState(settings.workdir);
  const [attachFiles, setAttachFiles] = useState<FileEntry[]>([]);
  const [customModel, setCustomModel] = useState("");
  /** 模型菜单分层：null = 服务商列表；某服务商 id = 该服务商的模型列表。 */
  const [modelLevel, setModelLevel] = useState<string | null>(null);
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
        setPopover(null);
        setModelLevel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

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
    setPopover((cur) => {
      const next = cur === which ? null : which;
      if (next !== "model") setModelLevel(null);
      return next;
    });
  };
  const closePopover = () => {
    setPopover(null);
    setModelLevel(null);
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
    closePopover(); // 思考强度是最终项，选完关闭。
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

  return (
    <div className={`composer-wrap ${focused ? "focused" : ""}`}>
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a) => (
            <span key={a} className="attach-chip" title={a}>
              {a.split(/[\\/]/).pop()}
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

      <textarea
        ref={taRef}
        className="composer-input"
        value={text}
        rows={1}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={
          settings.mode === "eva"
            ? "向 EVA 下达指令…例如：把校验规则抽成一个单独的函数"
            : "向诺玛下达指令…例如：把校验规则抽成一个单独的函数"
        }
        aria-label={
          settings.mode === "eva" ? "给 EVA 下达指令" : "给诺玛下达指令"
        }
      />

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
            className={`w2-dot ${settings.approval === "auto" ? "ok" : "warn"}`}
            title={settings.approval === "auto" ? "全自动" : "只读确认"}
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
            state="idle"
            fast={settings.mode === "eva"}
          />
          {settings.mode === "eva" ? "EVA" : "诺玛"}
          <span aria-hidden="true">▾</span>
        </button>
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
            ■
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            onClick={send}
            disabled={!canSend}
            aria-label="发送"
          >
            ↑
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
          <div className="popover" role="dialog">
            {popover === "model" && (
              <>
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
                        >
                          {EFFORT_LABELS[e]}
                        </button>
                      ))}
                    </div>
                    <div className="popover-hint">
                      点服务商进第二层选模型；选到最终项菜单才收起。
                    </div>
                  </>
                )}
              </>
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
                    className={`option ${settings.approval === "auto" ? "selected" : ""}`}
                    onClick={() => pickApproval("auto")}
                  >
                    <span>Auto 全自动</span>
                    <span className="option-note">自动审批，可撤销</span>
                    {settings.approval === "auto" && <span className="check">✓</span>}
                  </button>
                  <button
                    type="button"
                    className={`option ${settings.approval === "read-only" ? "selected" : ""}`}
                    onClick={() => pickApproval("read-only")}
                  >
                    <span>只读确认</span>
                    <span className="option-note">每次操作都要确认</span>
                    {settings.approval === "read-only" && <span className="check">✓</span>}
                  </button>
                </div>
                <div className="popover-section">沙箱模式</div>
                <div className="option-list">
                  {(Object.keys(SANDBOX_LABELS) as Sandbox[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`option ${settings.sandbox === s ? "selected" : ""}`}
                      onClick={() => pickSandbox(s)}
                    >
                      <span>{SANDBOX_LABELS[s]}</span>
                      <span className="option-note">{s}</span>
                      {settings.sandbox === s && <span className="check">✓</span>}
                    </button>
                  ))}
                </div>
                <div className="popover-hint">
                  审批与沙箱是两个独立开关；危险操作始终需要确认。
                </div>
              </>
            )}

            {popover === "attach" && (
              <>
                <div className="popover-title">附加文件（{attachDir || "工作区"}）</div>
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
                  {attachFiles.map((f) => (
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
                  {attachFiles.length === 0 && (
                    <div className="option-note">该目录为空</div>
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
