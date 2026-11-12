import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Approval,
  Effort,
  FileEntry,
  Sandbox,
  Settings,
} from "../types";
import { EFFORTS, EFFORT_LABELS, SANDBOX_LABELS } from "../types";

interface ComposerProps {
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
  /** 返回 true = 已接受发送（可以清空输入框）；false = 被拦截（如未配 Key），输入框保留文字。 */
  onSend: (text: string, attachments: string[]) => boolean;
  running: boolean;
  onCancel: () => void;
}

type Popover = "model" | "perm" | "attach" | null;

export default function Composer({
  settings,
  onPatch,
  onSend,
  running,
  onCancel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [popover, setPopover] = useState<Popover>(null);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachDir, setAttachDir] = useState(settings.workdir);
  const [attachFiles, setAttachFiles] = useState<FileEntry[]>([]);
  const [customModel, setCustomModel] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

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
      if (e.key === "Escape") setPopover(null);
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

  const send = () => {
    const body = text.trim();
    if (!body || running) return;
    // 只有发送被接受才清空；被拦截（未配 Key）时文字留着。
    if (onSend(body, attachments)) {
      setText("");
      setAttachments([]);
    }
  };

  const togglePopover = (which: Popover) =>
    setPopover((cur) => (cur === which ? null : which));

  const pickProvider = (id: string) => {
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return;
    onPatch({ provider_id: id, model: p.default_model });
  };

  const pickModel = (m: string) => onPatch({ model: m });
  const pickEffort = (e: Effort) => onPatch({ effort: e });
  const pickApproval = (a: Approval) => onPatch({ approval: a });
  const pickSandbox = (s: Sandbox) => onPatch({ sandbox: s });

  const submitCustomModel = () => {
    const m = customModel.trim();
    if (!m) return;
    onPatch({ model: m });
    setCustomModel("");
  };

  const modelLabel = `${provider?.id ?? ""}:${settings.model} ${EFFORT_LABELS[settings.effort]}`;
  const canSend = text.trim().length > 0 && !running;

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
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
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
          className="composer-btn perm-btn"
          aria-label="权限与沙箱"
          aria-expanded={popover === "perm"}
          onClick={() => togglePopover("perm")}
        >
          <span className={`status-dot ${settings.approval === "auto" ? "on" : "warn"}`} />
          🛡 {settings.approval === "auto" ? "全自动" : "只读确认"}
        </button>
        <button
          type="button"
          className="composer-eva"
          aria-pressed={settings.mode === "eva"}
          onClick={() =>
            onPatch({ mode: settings.mode === "eva" ? "norma" : "eva" })
          }
          title="切换模式：诺玛（通用工作）/ EVA（工程开发）。只换模式，不改思考强度与 Ultracode。"
        >
          {settings.mode === "eva" ? "EVA" : "诺玛"}
          <span
            className={`switch ${settings.mode === "eva" ? "on" : ""}`}
            aria-hidden="true"
          >
            <span className="knob" />
          </span>
        </button>
        <span className="composer-spacer" />
        <button
          type="button"
          className="composer-btn model-btn"
          aria-label="选择模型与思考强度"
          aria-expanded={popover === "model"}
          onClick={() => togglePopover("model")}
        >
          {modelLabel} ▾
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

      <div className="composer-status">
        审批 {settings.approval === "auto" ? "Auto" : "只读"} · 沙箱{" "}
        {SANDBOX_LABELS[settings.sandbox]} · {provider?.name ?? ""} ·{" "}
        {settings.mode === "eva" ? "EVA 模式" : "诺玛"}
      </div>

      {popover && (
        <>
          <div
            className="popover-backdrop"
            onClick={() => setPopover(null)}
            aria-hidden="true"
          />
          <div className="popover" role="dialog">
            {popover === "model" && (
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
                <div className="popover-section">模型</div>
                <div className="option-list">
                  {(provider?.models ?? []).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`option ${m === settings.model ? "selected" : ""}`}
                      onClick={() => pickModel(m)}
                    >
                      <span>{m}</span>
                      {m === settings.model && <span className="check">✓</span>}
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
                  面板不会在点选后消失，点外面、按 Esc 或点“完成”才收起。
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

            <button
              type="button"
              className="popover-done"
              onClick={() => setPopover(null)}
            >
              完成
            </button>
          </div>
        </>
      )}
    </div>
  );
}
