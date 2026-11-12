import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentResult,
  ChatMsg,
  CodexInfo,
  ReviewFile,
  ReviewState,
  Settings,
  Task,
} from "./types";
import {
  GREETING_TASKS,
  THEME_KEY,
  greetingForHour,
  resolveTheme,
  uid,
} from "./types";
import type { Theme } from "./types";
import Boot from "./components/Boot";
import Mark, { type MarkState } from "./components/Mark";
import Sidebar from "./components/Sidebar";
import Composer from "./components/Composer";
import RightPanel, { type MergeSummary } from "./components/RightPanel";
import {
  ArchiveDrawer,
  HelpDrawer,
  SettingsDrawer,
} from "./components/Drawers";

const TASKS_KEY = "cassell.tasks.v1";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** EVA's quiet line in the chat: one small line, click to see details. */
function EvaNote({ ultracode }: { ultracode: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="msg eva-note-row">
      <button
        type="button"
        className="eva-note"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="eva-dot" />
        EVA · 工程开发
        <span className="eva-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="eva-note-detail">
          EVA 模式以工程开发人设执行：先拆解子任务、完成后交叉核查再交付。
          思考强度与 Ultracode 各自独立设置。
          {ultracode
            ? "Ultracode 已开启：开关已传给引擎记录，当前引擎仍为单智能体循环，多智能体并行编排在后续版本接入。"
            : "真正的多智能体并行编排（Ultracode）在后续版本接入；工具调用明细见下方消息。"}
        </div>
      )}
    </div>
  );
}

/** 思考块：推理模型的 reasoning_content 单独渲染，可折叠；跑完默认收起。 */
function ThinkBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);
  return (
    <div className="msg think">
      <button
        type="button"
        className="think-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {streaming ? "思考中…" : "思考过程"} {open ? "▾" : "▸"}
      </button>
      {open && <div className="msg-body think-body">{text || "…"}</div>}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [boot, setBoot] = useState(true);
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [merge, setMerge] = useState<MergeSummary | null>(null);
  const [drawer, setDrawer] = useState<"settings" | "archive" | "help" | null>(null);
  const [codexInfo, setCodexInfo] = useState<CodexInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [markState, setMarkState] = useState<MarkState>("idle");
  const [gaze, setGaze] = useState(0);
  const [greetIdx, setGreetIdx] = useState(0);
  const [modeToast, setModeToast] = useState(false);
  /** 系统偏好（亮/暗）：theme === "system" 时实时跟随。 */
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  /** 未配 Key 时点发送的拦截提示（文字保留在输入框里）。 */
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  const settingsRef = useRef<Settings | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const markTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  /** 主题切换：B 层收尾定时器 / 是否已做过首次静默应用 / 上次点击的按钮中心。 */
  const themeTimer = useRef<number | null>(null);
  const themeAppliedRef = useRef(false);
  const themeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevMode = useRef(false);
  const modeToastTimer = useRef<number | null>(null);
  /** 本轮消息的 id：原生事件按 id 找气泡，不依赖“最后一条”——工具行插在中间也不会丢增量。 */
  const tasksRef = useRef<Task[]>([]);
  const streamMsgIdRef = useRef<string | null>(null);
  const thinkMsgIdRef = useRef<string | null>(null);
  const lastToolMsgIdRef = useRef<string | null>(null);

  settingsRef.current = settings;
  tasksRef.current = tasks;
  activeTaskIdRef.current = activeTaskId;
  runningRef.current = running;

  // ---- Theme (S4): 文档级 html[data-theme]，两层过渡 ----
  // 实时监听系统偏好：theme === "system" 时系统一切、应用跟着切。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings
    ? resolveTheme(settings.theme, systemDark)
    : "dark";

  /**
   * 把解析后的亮/暗主题写到 documentElement（CSS 令牌挂在 html[data-theme] 上）。
   * 两层过渡（theme-switch-plan.md §3.2）：
   *  A 层：View Transitions 羽化圆形揭示，700ms，--ease-exp，从 origin（主题按钮中心）扩散；
   *  B 层：.theme-animating 全站颜色交叉淡化，450ms，--ease，700ms 后摘掉。
   * 首次应用是静默的（首绘脚本已经定了正确的主题，不做动画、不发事件）。
   */
  const applyThemeVisual = useCallback(
    (next: "light" | "dark", origin?: { x: number; y: number }) => {
      const root = document.documentElement;
      const current = root.dataset.theme;
      const isSwitch = themeAppliedRef.current && current !== next;
      if (!themeAppliedRef.current) {
        // 首次：直接落位，不挂过渡、不发事件。
        root.dataset.theme = next;
        themeAppliedRef.current = true;
        return;
      }
      if (!isSwitch) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches;
      const setTheme = () => {
        root.dataset.theme = next;
      };
      // B 层先行：全站颜色交叉淡化（无 View Transition 环境下这就是唯一过渡）。
      root.classList.add("theme-animating");
      if (themeTimer.current) window.clearTimeout(themeTimer.current);
      themeTimer.current = window.setTimeout(
        () => root.classList.remove("theme-animating"),
        reduced ? 200 : 700,
      );
      // A 层：羽化圆形揭示（不支持或减少动效时只走 B 层）。
      const startVT = (
        document as Document & {
          startViewTransition?: (cb: () => void) => void;
        }
      ).startViewTransition;
      if (!reduced && typeof startVT === "function") {
        const x = origin?.x ?? window.innerWidth / 2;
        const y = origin?.y ?? window.innerHeight / 2;
        const r =
          Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
          ) + 64;
        root.style.setProperty("--vt-x", `${x}px`);
        root.style.setProperty("--vt-y", `${y}px`);
        root.style.setProperty("--vt-r", `${r}px`);
        startVT.call(document, setTheme);
      } else {
        setTheme();
      }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta)
        meta.setAttribute("content", next === "light" ? "#f7f7f5" : "#141414");
      // S4 集成点：主题切换完成时通知球眨一次眼（160ms，“眨了下眼适应光线”）。
      // 本步不改 Mark.tsx；下一波由球的接线方监听此事件。
      window.dispatchEvent(
        new CustomEvent("theme-switched", { detail: { theme: next } }),
      );
    },
    [],
  );

  // 偏好或系统偏好一变，就按解析后的主题应用（带两层过渡）。
  useEffect(() => {
    if (!settings) return;
    try {
      localStorage.setItem(THEME_KEY, settings.theme);
    } catch {
      // 首绘镜像写不进去不阻塞：Rust 设置文件仍是事实来源。
    }
    const origin = themeOriginRef.current;
    themeOriginRef.current = null;
    applyThemeVisual(resolvedTheme, origin ?? undefined);
  }, [settings, resolvedTheme, applyThemeVisual]);

  /** 顶栏主题按钮：浅色 → 深色 → 跟随系统 三态循环（手动选择即退出 system）。 */
  const handleThemeToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!settings) return;
    themeOriginRef.current = { x: e.clientX, y: e.clientY };
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    patchSettings({ theme: next });
  };

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  // ---- Chat auto-scroll: instant jump to bottom while following output ----
  const activeMessages = activeTask?.messages;
  useEffect(() => {
    const el = chatRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeMessages]);

  // ---- Load settings + Codex status on mount ----
  useEffect(() => {
    let alive = true;
    invoke<Settings>("get_settings")
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        if (!s.boot_animation) setBoot(false);
      })
      .catch(() => {
        if (alive) setBoot(false);
      });
    invoke<CodexInfo>("check_codex")
      .then((info) => {
        if (alive) setCodexInfo(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // ---- Persist tasks locally ----
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {
      // Storage full or unavailable — tasks still work in memory.
    }
  }, [tasks]);

  // ---- Persist settings (debounced) ----
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        invoke("save_settings", { settings: next }).catch(() => undefined);
      }, 400);
      return next;
    });
  }, []);

  // ---- Greeting task rotates every 8s ----
  useEffect(() => {
    const t = window.setInterval(
      () => setGreetIdx((i) => (i + 1) % GREETING_TASKS.length),
      8000,
    );
    return () => window.clearInterval(t);
  }, []);

  // ---- EVA switch ritual: a short toast the moment EVA turns on ----
  const evaMode = settings?.mode === "eva";
  useEffect(() => {
    if (evaMode && !prevMode.current) {
      setModeToast(true);
      if (modeToastTimer.current) window.clearTimeout(modeToastTimer.current);
      modeToastTimer.current = window.setTimeout(() => setModeToast(false), 2800);
    }
    prevMode.current = evaMode;
  }, [evaMode]);

  // ---- Living-mark gaze: idle look-around, working scan (EVA scans faster) ----
  useEffect(() => {
    const interval =
      runningRef.current
        ? (settingsRef.current?.mode === "eva" ? 900 : 1400)
        : 3200;
    const t = window.setInterval(
      () => {
        if (runningRef.current) {
          setGaze((Math.random() * 2 - 1) * 0.9);
        } else {
          setGaze((Math.random() * 2 - 1) * 0.5);
        }
      },
      interval,
    );
    return () => window.clearInterval(t);
  }, [running, evaMode]);

  // ---- Native engine message helpers (id-based, not "last message") ----
  const updateMsgText = useCallback((id: string, fn: (cur: string) => string) => {
    const taskId = activeTaskIdRef.current;
    if (!id || !taskId) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === id ? { ...m, text: fn(m.text) } : m,
              ),
            }
          : t,
      ),
    );
  }, []);

  const pushMsg = useCallback((msg: ChatMsg) => {
    const id = activeTaskIdRef.current;
    if (!id) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, messages: [...t.messages, msg] } : t,
      ),
    );
  }, []);

  /** 思考块插到流式气泡前面（思考先于正文）。 */
  const insertThinkMsg = useCallback((msg: ChatMsg) => {
    const taskId = activeTaskIdRef.current;
    const streamId = streamMsgIdRef.current;
    if (!taskId) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const msgs = [...t.messages];
        if (streamId) {
          const idx = msgs.findIndex((m) => m.id === streamId);
          if (idx >= 0) {
            msgs.splice(idx, 0, msg);
            return { ...t, messages: msgs };
          }
        }
        return { ...t, messages: [...msgs, msg] };
      }),
    );
  }, []);

  // ---- Native engine event stream ----
  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    const add = (p: Promise<() => void>) => {
      p.then((u) => {
        if (alive) unlisteners.push(u);
        else u();
      });
    };

    // 正文增量：逐字追加到本轮流式气泡
    add(
      listen<{ text: string }>("agent-delta", ({ payload }) => {
        const id = streamMsgIdRef.current;
        if (id && payload.text) updateMsgText(id, (cur) => cur + payload.text);
      }),
    );
    // 思考增量：单独的思考块（第一段到达时创建，插到气泡前面）
    add(
      listen<{ text: string }>("agent-thinking", ({ payload }) => {
        if (!payload.text) return;
        let id = thinkMsgIdRef.current;
        if (!id) {
          id = uid();
          thinkMsgIdRef.current = id;
          insertThinkMsg({
            id,
            role: "assistant",
            text: "",
            streaming: true,
            kind: "think",
          });
        }
        updateMsgText(id, (cur) => cur + payload.text);
      }),
    );
    // 工具调用开始
    add(
      listen<{ name: string; args: Record<string, unknown> }>(
        "agent-tool",
        ({ payload }) => {
          const id = uid();
          lastToolMsgIdRef.current = id;
          const argSummary = JSON.stringify(payload.args ?? {});
          pushMsg({
            id,
            role: "assistant",
            text:
              `调用工具：${payload.name}` +
              (argSummary && argSummary !== "{}"
                ? `（${argSummary.slice(0, 200)}）`
                : ""),
            kind: "tool",
            toolLabel: payload.name,
          });
        },
      ),
    );
    // 工具调用结果：追加到同一行（截断，避免把文件全文塞进对话）
    add(
      listen<{ name: string; result: string }>(
        "agent-tool-result",
        ({ payload }) => {
          const id = lastToolMsgIdRef.current;
          if (!id) return;
          const r = payload.result ?? "";
          const short = r.length > 400 ? `${r.slice(0, 400)}…（已截断）` : r;
          updateMsgText(id, (cur) => `${cur}\n→ ${short}`);
        },
      ),
    );

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [pushMsg, insertThinkMsg, updateMsgText]);

  // ---- Review queue ----
  const refreshReview = useCallback(() => {
    const s = settingsRef.current;
    if (!s) return;
    invoke<ReviewState>("get_review", { workdir: s.workdir })
      .then((state) => {
        setReviewError(null);
        setReview((prev) => {
          const prevMap = new Map(
            (prev?.files ?? []).map((f) => [f.path, f]),
          );
          // Union: keep files that vanished from git status (e.g. rejected
          // + reverted) so nothing ever disappears silently.
          const merged: ReviewFile[] = state.files.map((f) => {
            const old = prevMap.get(f.path);
            return { ...f, state: old?.state ?? "pending" };
          });
          for (const old of prev?.files ?? []) {
            if (!state.files.some((f) => f.path === old.path)) {
              merged.push(old);
            }
          }
          return { ...state, files: merged };
        });
      })
      .catch((e) => setReviewError(String(e)));
  }, []);

  useEffect(() => {
    if (settings) refreshReview();
  }, [settings, refreshReview]);

  const setReviewState = (path: string, state: "pending" | "approved" | "rejected") => {
    setReview((prev) =>
      prev
        ? {
            ...prev,
            files: prev.files.map((f) =>
              f.path === path ? { ...f, state } : f,
            ),
          }
        : prev,
    );
  };

  const handleApproveFile = (path: string) => setReviewState(path, "approved");

  const handleRejectFile = (path: string) => {
    const s = settingsRef.current;
    if (!s) return;
    invoke<string>("revert_file", { workdir: s.workdir, path })
      .then(() => {
        setReviewState(path, "rejected");
        refreshReview();
      })
      .catch((e) => {
        setTerminalLines((prev) => [...prev, `· 审查还原失败：${e}`]);
      });
  };

  const handleAcceptAll = () => {
    setReview((prev) => {
      if (!prev) return prev;
      const pending = prev.files.filter((f) => (f.state ?? "pending") === "pending");
      if (pending.length === 0) return prev;
      setMerge({
        paths: pending.map((f) => f.path),
        additions: pending.reduce((a, f) => a + f.additions, 0),
        deletions: pending.reduce((a, f) => a + f.deletions, 0),
        at: new Date().toISOString(),
      });
      return {
        ...prev,
        files: prev.files.map((f) =>
          (f.state ?? "pending") === "pending" ? { ...f, state: "approved" } : f,
        ),
      };
    });
  };

  const handleUndoMerge = () => {
    setMerge((m) => {
      if (m) {
        setReview((prev) =>
          prev
            ? {
                ...prev,
                files: prev.files.map((f) =>
                  m.paths.includes(f.path) ? { ...f, state: "pending" } : f,
                ),
              }
            : prev,
        );
      }
      return null;
    });
  };

  // ---- Shell ----
  const handleRunShell = useCallback((command: string) => {
    const s = settingsRef.current;
    setTerminalLines((prev) => [...prev, `$ ${command}`]);
    invoke<{ stdout: string; stderr: string; code: number | null }>("run_shell", {
      command,
      workdir: s?.workdir ?? "",
    })
      .then((r) => {
        setTerminalLines((prev) => {
          const lines = [...prev];
          if (r.stdout.trim()) lines.push(...r.stdout.replace(/\n$/, "").split("\n"));
          if (r.stderr.trim()) lines.push(...r.stderr.replace(/\n$/, "").split("\n"));
          lines.push(`（退出码 ${r.code ?? "?"}）`);
          return lines.length > 300 ? lines.slice(-300) : lines;
        });
      })
      .catch((e) => {
        setTerminalLines((prev) => [...prev, `执行失败：${e}`]);
      });
  }, []);

  // ---- Run one agent turn (deferred a frame so the bubble paints first) ----
  const runTurn = useCallback(
    async (
      taskId: string,
      prompt: string,
      assistantMsgId: string,
      userText: string,
    ) => {
      const s = settingsRef.current;
      if (!s) return;
      // 历史只取本轮之前的回合（刚发的这条不重复进历史，prompt 已是最后一条）。
      const task = tasksRef.current.find((t) => t.id === taskId);
      const prior = (task?.messages ?? []).filter(
        (m) =>
          !m.streaming &&
          m.text.trim() &&
          (m.role === "user" || (m.role === "assistant" && !m.kind)),
      );
      const history = prior
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.text }));
      if (history.length > 0) {
        const last = history[history.length - 1];
        if (last.role === "user" && last.content === userText) history.pop();
      }
      try {
        const result = await invoke<AgentResult>("run_agent_native", {
          req: {
            prompt,
            model: s.model,
            provider_id: s.provider_id,
            // 模式、思考强度、Ultracode 三个独立字段各自传给引擎：
            // EVA 模式不再强制改思考强度，Ultracode 只透传、不假装并行。
            effort: s.effort,
            mode: s.mode,
            ultracode: s.ultracode,
            approval: s.approval,
            sandbox: s.sandbox,
            workdir: s.workdir,
            history,
            display_name: s.display_name ?? "",
          },
        });
        const thinkId = thinkMsgIdRef.current;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  messages: t.messages.map((m) => {
                    if (thinkId && m.id === thinkId)
                      return { ...m, streaming: false };
                    if (m.id !== assistantMsgId) return m;
                    const usage =
                      result.total_tokens != null
                        ? {
                            prompt: result.prompt_tokens ?? 0,
                            completion: result.completion_tokens ?? 0,
                            total: result.total_tokens,
                          }
                        : undefined;
                    if (result.cancelled) {
                      // 停止按钮已在气泡后追加“（已停止）”，这里只收尾、不改文字。
                      return { ...m, streaming: false, usage };
                    }
                    return {
                      ...m,
                      streaming: false,
                      text:
                        result.text || m.text || "（本轮没有文字输出）",
                      usage,
                    };
                  }),
                }
              : t,
          ),
        );
        refreshReview();
      } catch (e) {
        const thinkId = thinkMsgIdRef.current;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, streaming: false, text: `启动失败：${e}` }
                      : thinkId && m.id === thinkId
                        ? { ...m, streaming: false }
                        : m,
                  ),
                }
              : t,
          ),
        );
      } finally {
        thinkMsgIdRef.current = null;
        lastToolMsgIdRef.current = null;
        streamMsgIdRef.current = null;
        setRunning(false);
        setMarkState("done");
        if (markTimer.current) window.clearTimeout(markTimer.current);
        markTimer.current = window.setTimeout(() => setMarkState("idle"), 2600);
      }
    },
    [refreshReview],
  );

  // ---- Send: paint the user bubble in this same frame, then run the turn ----
  // The bubble must be on screen the instant Send is pressed; the backend
  // spawn is deferred one frame so nothing on the send path can delay paint.
  // Returns false when the send is refused (e.g. no API key): the composer
  // keeps the typed text in that case.
  const handleSend = useCallback(
    (text: string, attachments: string[]): boolean => {
      const s = settingsRef.current;
      if (!s || runningRef.current) return false;
      const currentKey = s.api_keys[s.provider_id]?.trim();
      if (!currentKey) {
        const anyKey = Object.values(s.api_keys).some((k) => k?.trim());
        const providerName =
          s.providers.find((p) => p.id === s.provider_id)?.name ??
          s.provider_id;
        setGateNotice(
          anyKey
            ? `当前服务商 ${providerName} 还没配置 API Key，先去配好才能发消息。`
            : "还没有配置任何模型服务商的 API Key，诺玛没法开始干活。",
        );
        return false;
      }
      setGateNotice(null);

      let taskId = activeTaskIdRef.current;
      if (!taskId) {
        taskId = uid();
        const task: Task = {
          id: taskId,
          title: text.length > 24 ? `${text.slice(0, 24)}…` : text,
          project: "默认项目",
          messages: [],
          createdAt: Date.now(),
        };
        setTasks((prev) => [task, ...prev]);
        setActiveTaskId(taskId);
        activeTaskIdRef.current = taskId;
      }

      const prompt =
        attachments.length > 0
          ? `${text}\n\n附件：\n${attachments.map((a) => `- ${a}`).join("\n")}`
          : text;

      const userMsg: ChatMsg = { id: uid(), role: "user", text };
      const assistantMsg: ChatMsg = {
        id: uid(),
        role: "assistant",
        text: "",
        streaming: true,
      };
      // EVA turns open with one quiet line (click it for details).
      const evaNote: ChatMsg | null = s.mode === "eva"
        ? { id: uid(), role: "assistant", text: "", kind: "eva" }
        : null;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  userMsg,
                  ...(evaNote ? [evaNote] : []),
                  assistantMsg,
                ],
              }
            : t,
        ),
      );
      // Per-turn refs for the native event listeners.
      streamMsgIdRef.current = assistantMsg.id;
      thinkMsgIdRef.current = null;
      lastToolMsgIdRef.current = null;
      setRunning(true);
      setMarkState("working");
      stickToBottom.current = true;

      requestAnimationFrame(() => {
        void runTurn(taskId, prompt, assistantMsg.id, text);
      });
      return true;
    },
    [runTurn],
  );

  const handleCancel = useCallback(() => {
    invoke<boolean>("cancel_run")
      .then(() => {
        setRunning(false);
        setMarkState("idle");
        const id = activeTaskIdRef.current;
        if (id) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    messages: t.messages.map((m) =>
                      m.streaming ? { ...m, streaming: false, text: m.text + "\n（已停止）" } : m,
                    ),
                  }
                : t,
            ),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  const handleNewTask = () => setActiveTaskId(null);

  const handleArchiveTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, archived: true } : t)));
    setActiveTaskId(null);
  };

  const handleRestoreTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, archived: false } : t)));
    setActiveTaskId(id);
    setDrawer(null);
  };

  // 原生引擎的连通测试：真发一条最小请求，不经过 Codex CLI。
  // 注意先落盘再测——Rust 侧从磁盘设置文件里读 Key 与地址。
  const handleTestConnection = () => {
    const s = settingsRef.current;
    if (!s) return;
    setTesting(true);
    setTestResult(null);
    invoke("save_settings", { settings: s })
      .then(() =>
        invoke<{ ok: boolean; detail: string }>("test_provider", {
          // 注意：Tauri v2 命令参数默认转 camelCase，Rust 侧 provider_id 对应 JS 侧 providerId
          providerId: s.provider_id,
          model: s.model,
        }),
      )
      .then((r) => setTestResult(r))
      .catch((e) => setTestResult({ ok: false, detail: String(e) }))
      .finally(() => setTesting(false));
  };

  // 从服务商真实拉取模型列表（GET /models），填进当前服务商的模型目录。
  const handleFetchModels = useCallback(async (): Promise<{
    ok: boolean;
    detail: string;
  }> => {
    const s = settingsRef.current;
    if (!s) return { ok: false, detail: "设置还没加载好" };
    try {
      await invoke("save_settings", { settings: s });
      const models = await invoke<string[]>("list_models", {
        // Tauri v2 命令参数默认转 camelCase（见 test_provider 处注释）
        providerId: s.provider_id,
      });
      if (models.length === 0) {
        return { ok: true, detail: "服务商没有返回任何模型（列表为空）" };
      }
      const pid = s.provider_id;
      patchSettings({
        providers: s.providers.map((p) =>
          p.id === pid ? { ...p, models } : p,
        ),
        model: models.includes(s.model) ? s.model : models[0],
      });
      return { ok: true, detail: `已拉取 ${models.length} 个模型` };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }, [patchSettings]);

  // 系统原生文件夹选择对话框
  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_folder");
      if (picked) patchSettings({ workdir: picked });
    } catch {
      // 用户取消或打开失败：保持原工作区不变
    }
  }, [patchSettings]);

  // 当前服务商一旦配好 Key，拦截提示自动消失
  useEffect(() => {
    if (!settings) return;
    if (settings.api_keys[settings.provider_id]?.trim()) setGateNotice(null);
  }, [settings]);

  if (!settings) {
    return (
      <div className="app">
        <div className="boot">
          <div className="boot-welcome">正在启动…</div>
        </div>
      </div>
    );
  }

  const hour = new Date().getHours();
  // 显示名默认“路明非”；问候取首字 + “专员”（路明非 → 路专员）。
  const displayName = settings.display_name?.trim() || "路明非";
  const greeting = `${greetingForHour(hour)}，${displayName.charAt(0)}专员。${GREETING_TASKS[greetIdx]}`;
  const hasAnyKey = Object.values(settings.api_keys).some((k) => k?.trim());
  const showEmpty = !activeTask || activeTask.messages.length === 0;

  return (
    <div className="app">
      {boot && settings.boot_animation && <Boot onDone={() => setBoot(false)} />}

      <Sidebar
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSelectTask={setActiveTaskId}
        onNewTask={handleNewTask}
        onOpenDrawer={setDrawer}
        displayName={displayName}
      />

      <main className="main">
        <header className="main-head">
          <Mark
            size={36}
            eva={settings.mode === "eva"}
            state={running ? "working" : markState}
            gaze={gaze}
            fast={settings.mode === "eva"}
          />
          <div className="main-head-title">
            {activeTask ? activeTask.title : "新任务"}
            <span className="main-head-sub">
              {settings.mode === "eva" ? "EVA" : "诺玛"} · {settings.provider_id}:
              {settings.model} · {settings.effort}
            </span>
          </div>
          <span className="main-head-spacer" />
          {activeTask && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleArchiveTask(activeTask.id)}
            >
              归档
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={handleThemeToggle}
            aria-label="切换主题"
          >
            {settings.theme === "light"
              ? "☾ 深色"
              : settings.theme === "dark"
                ? "◐ 跟随系统"
                : "☀ 浅色"}
          </button>
        </header>

        {modeToast && (
          <div className="eva-toast" role="status">
            <Mark size={24} eva state="done" fast />
            <span className="eva-toast-title">EVA 已启动</span>
            <span className="eva-toast-sub">工程开发模式</span>
          </div>
        )}

        {showEmpty ? (
          <div className="empty-state">
            <Mark size={84} eva={settings.mode === "eva"} state="idle" gaze={gaze} fast={settings.mode === "eva"} />
            <div className="empty-greeting">{greeting}</div>
            <div className="empty-identity">
              {displayName} · S2017-0117 · 血统评级 S
            </div>
            {!hasAnyKey && (
              <div className="setup-cta">
                <div className="setup-cta-title">
                  还差一步：先连接一家模型服务商，诺玛才能开始干活
                </div>
                <div className="setup-cta-text">
                  用你自己的 API Key 接入（DeepSeek、Kimi、千问、OpenAI 都可以，也支持自己的反代地址），粘贴一次、测通就行，之后回来直接发消息。
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setDrawer("settings")}
                >
                  连接模型服务商 →
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="chat"
            ref={chatRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            }}
          >
            {activeTask?.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg user">
                  <div className="msg-body">{m.text}</div>
                </div>
              ) : m.kind === "eva" ? (
                <EvaNote key={m.id} ultracode={settings.ultracode} />
              ) : m.kind === "think" ? (
                <ThinkBlock key={m.id} text={m.text} streaming={!!m.streaming} />
              ) : m.kind === "tool" ? (
                <div key={m.id} className="msg tool">
                  <div className="msg-body tool-body">{m.text}</div>
                </div>
              ) : m.kind === "error" ? (
                <div key={m.id} className="msg error">
                  <div className="msg-body">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className="msg assistant">
                  <Mark
                    size={28}
                    eva={settings.mode === "eva"}
                    state={m.streaming ? "working" : "idle"}
                    gaze={gaze}
                    fast={settings.mode === "eva"}
                  />
                  <div className="msg-body">
                    {m.text}
                    {m.streaming && <span className="stream-caret">▍</span>}
                    {m.usage && (
                      <div className="msg-usage">
                        ↑ {m.usage.prompt} · ↓ {m.usage.completion} · 共{" "}
                        {m.usage.total} tokens
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        <div className="composer-slot">
          {gateNotice && (
            <div className="gate-notice" role="alert">
              <span>{gateNotice}</span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setDrawer("settings")}
              >
                去配置
              </button>
            </div>
          )}
          <Composer
            settings={settings}
            onPatch={patchSettings}
            onSend={handleSend}
            running={running}
            onCancel={handleCancel}
          />
        </div>
      </main>

      <RightPanel
        workdir={settings.workdir}
        review={review}
        reviewError={reviewError}
        onRefreshReview={refreshReview}
        onApproveFile={handleApproveFile}
        onRejectFile={handleRejectFile}
        onUndoFile={(path) => setReviewState(path, "pending")}
        onAcceptAll={handleAcceptAll}
        onUndoMerge={handleUndoMerge}
        onDismissMerge={() => setMerge(null)}
        merge={merge}
        terminalLines={terminalLines}
        onRunShell={handleRunShell}
        settings={settings}
        onToggleExtension={(id) =>
          patchSettings({
            extensions: settings.extensions.map((e) =>
              e.id === id ? { ...e, enabled: !e.enabled } : e,
            ),
          })
        }
      />

      {drawer === "settings" && (
        <SettingsDrawer
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setDrawer(null)}
          codexInfo={codexInfo}
          onTestConnection={handleTestConnection}
          testing={testing}
          testResult={testResult}
          onFetchModels={handleFetchModels}
          onPickFolder={handlePickFolder}
        />
      )}
      {drawer === "archive" && (
        <ArchiveDrawer
          tasks={tasks}
          onRestore={handleRestoreTask}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "help" && <HelpDrawer onClose={() => setDrawer(null)} />}
    </div>
  );
}
