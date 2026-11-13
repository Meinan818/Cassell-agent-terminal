//! P0-11④ 真终端前端：xterm.js 只渲染 + 收键盘，shell 跑在后端 PTY 里。
//!
//! - 会话按对话 id 分（`sessionId` = 前端 task id，普通对话是 "default"），
//!   后端 `pty_spawn` 幂等：会话已存在就复用，不会切个页签就丢 shell。
//! - 面板挂载时先 spawn、再用 `pty_snapshot` 把环形缓冲里的历史输出
//!   写回去（切走再回来、关掉 Inspector 再打开，输出都在）；
//!   挂载完成后再接 `pty-output` 事件，避免快照与直播重复写同一行。
//! - 尺寸变化（FitAddon 算出 cols/rows）就同步给 PTY；
//!   Ctrl+C、清屏、上下翻历史都是 shell 自己的行为。

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalPaneProps {
  sessionId: string;
  workdir: string;
}

const QUICK_CMDS = ["pwd", "ls", "git status"];

export default function TerminalPane({ sessionId, workdir }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.35,
      fontFamily:
        "ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans SC', monospace",
      theme: {
        background: "#0e1116",
        foreground: "#d7dce3",
        cursor: "#60a5fa",
        cursorAccent: "#0e1116",
        selectionBackground: "rgba(96, 165, 250, 0.35)",
        black: "#0e1116",
        brightBlack: "#5b6472",
        white: "#d7dce3",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    setReady(false);
    let disposed = false;
    let lastDims = { cols: 0, rows: 0 };
    const syncSize = async () => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (!d || (d.cols === lastDims.cols && d.rows === lastDims.rows)) return;
        lastDims = d;
        await invoke("pty_resize", { id: sessionId, cols: d.cols, rows: d.rows });
      } catch {
        // PTY 还没起时 resize 会失败，spawn 完会再同步一次。
      }
    };
    let unOut: (() => void) | null = null;
    let unExit: (() => void) | null = null;
    (async () => {
      try {
        const dims = fit.proposeDimensions();
        await invoke("pty_spawn", {
          id: sessionId,
          workdir,
          cols: dims?.cols ?? 80,
          rows: dims?.rows ?? 24,
        });
        const snap = await invoke<string>("pty_snapshot", { id: sessionId });
        if (disposed) return;
        if (snap) term.write(snap);
        // 快照写完再接直播：快照之前发出的输出都在快照里，不会重复。
        unOut = await listen<{ id: string; data: string }>("pty-output", (e) => {
          if (e.payload.id === sessionId) term.write(e.payload.data);
        });
        unExit = await listen<{ id: string; code: number | null }>(
          "pty-exited",
          (e) => {
            if (e.payload.id !== sessionId) return;
            term.write(
              `\r\n[终端进程已退出${
                e.payload.code != null ? `（退出码 ${e.payload.code}）` : ""
              }，回车可重开一个新会话]\r\n`,
            );
          },
        );
        setReady(true);
        await syncSize();
      } catch (e) {
        if (!disposed) term.write(`\r\n[终端启动失败：${e}]\r\n`);
      }
    })();
    const dataDisp = term.onData((data) => {
      invoke("pty_write", { id: sessionId, data }).catch(() => {});
    });
    const ro = new ResizeObserver(() => {
      void syncSize();
    });
    ro.observe(host);
    term.focus();
    return () => {
      disposed = true;
      ro.disconnect();
      dataDisp.dispose();
      unOut?.();
      unExit?.();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, workdir]);

  const sendQuick = (c: string) => {
    termRef.current?.focus();
    invoke("pty_write", { id: sessionId, data: `${c}\r` }).catch(() => {});
  };

  return (
    <div className="term-pty">
      <div className="rp-head">
        <span>终端</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="rp-note">{workdir || "工作区未设置"}</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => termRef.current?.clear()}
            title="只清空本面板的显示，不影响已执行的命令"
          >
            清空
          </button>
        </span>
      </div>
      <div
        className="term-xterm"
        ref={hostRef}
        onClick={() => termRef.current?.focus()}
        aria-label="终端"
      />
      <div className="term-quick">
        {QUICK_CMDS.map((c) => (
          <button key={c} type="button" onClick={() => sendQuick(c)} disabled={!ready}>
            {c}
          </button>
        ))}
        <span className="term-hint">真 PTY：交互程序能跑，↑ / ↓ 翻 shell 历史</span>
      </div>
    </div>
  );
}
