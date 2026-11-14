//! P0-11③ 内置浏览器前端：地址栏 + 前进/后退/刷新是 DOM，
//! 页面本身是后端原生子 webview（`Window::add_child`），
//! 不是 iframe——很多网站禁 framing，iframe 里的页面 agent 也够不着。
//!
//! 子 webview 是原生层、不是 DOM 孩子：位置/显隐/大小都要这里
//! 手动同步——挂载时按占位 div 的 rect 打开（或复位已有的），
//! ResizeObserver 跟尺寸变化，卸载（切页签/关 Inspector）时隐藏。
//! 地址栏靠后端 `browser-event`（页面加载开始/完成）同步。

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface BrowserRequest {
  url: string;
  nonce: number;
}

/** 本地 dev server 默认 http；外网默认 https。与后端 normalize_url 保持一致。 */
function isLocalHost(raw: string): boolean {
  const hostPort = raw.split("/")[0] ?? "";
  const host = hostPort.startsWith("[")
    ? (hostPort.slice(1).split("]")[0] ?? "")
    : (hostPort.split(":")[0] ?? "");
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host.toLowerCase());
}

interface BrowserPaneProps {
  /** App 传来的打开请求（agent 的 open_browser 工具 / 其他入口）。 */
  requested: BrowserRequest | null;
  onRequestedConsumed: () => void;
  /** 有 DOM 浮层打开或 Inspector 正在退场：原生子 webview 要先藏起来，
   * 否则它会永远画在抽屉/命令面板/关闭动画上面。 */
  covered?: boolean;
}

export default function BrowserPane({ requested, onRequestedConsumed, covered = false }: BrowserPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPage, setHasPage] = useState(false);
  const hasPageRef = useRef(false);
  hasPageRef.current = hasPage;
  const requestedRef = useRef<BrowserRequest | null>(null);
  requestedRef.current = requested;

  const rect = useCallback(() => {
    const el = hostRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const syncRect = useCallback(async () => {
    if (!hasPageRef.current) return;
    const r = rect();
    if (!r) return;
    try {
      await invoke("browser_set_rect", r);
    } catch {
      // 子 webview 还没建好或已关，忽略。
    }
  }, [rect]);

  const openUrl = useCallback(
    async (raw: string) => {
      const u = raw.trim();
      if (!u) return;
      const full = /^https?:\/\//i.test(u)
        ? u
        : `${isLocalHost(u) ? "http" : "https"}://${u}`;
      const r = rect();
      if (!r) return;
      setUrl(full);
      setHasPage(true);
      hasPageRef.current = true;
      setLoading(true);
      try {
        await invoke("browser_open", { url: full, ...r });
      } catch (e) {
        setLoading(false);
        setHasPage(false);
        hasPageRef.current = false;
        setUrl(`打不开：${e}`);
      }
    },
    [rect],
  );

  // 挂载：复位已有的子 webview（切页签回来），或保持空态。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await invoke<{ open: boolean; url: string }>("browser_current");
        if (!alive) return;
        if (info.open) {
          setHasPage(true);
          hasPageRef.current = true;
          setUrl(info.url);
          await invoke("browser_show");
          await syncRect();
        }
      } catch {
        // 还没打开过，空态即可。
      }
    })();
    return () => {
      alive = false;
      // 切走/关掉时只隐藏不销毁：会话（登录态、历史）留在子 webview 里。
      invoke("browser_hide").catch(() => {});
    };
  }, [syncRect]);

  // 原生子 webview 不参与 DOM 层叠：任何抽屉/命令面板/向导打开、或
  // Inspector 正在退场时先隐藏；浮层关闭后再显示并重新对齐占位区。
  useEffect(() => {
    if (!hasPage) return;
    if (covered) {
      invoke("browser_hide").catch(() => {});
      return;
    }
    invoke("browser_show")
      .then(() => syncRect())
      .catch(() => {});
  }, [covered, hasPage, syncRect]);

  // 首次打开时 Inspector/页签/占位区还在播入场动画；getBoundingClientRect
  // 会带着 transform，等动画结束再补几次对齐，避免子 webview 永久偏几像素。
  useEffect(() => {
    if (!hasPage) return;
    const timers = [0, 120, 280, 460].map((ms) =>
      window.setTimeout(() => void syncRect(), ms),
    );
    const el = hostRef.current;
    const onEnd = () => void syncRect();
    el?.addEventListener("animationend", onEnd);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      el?.removeEventListener("animationend", onEnd);
    };
  }, [hasPage, syncRect]);

  // agent 或其他入口要求打开某个 URL。
  useEffect(() => {
    if (!requested) return;
    void openUrl(requested.url);
    onRequestedConsumed();
  }, [requested, openUrl, onRequestedConsumed]);

  // 后端页面事件：加载开始/完成时同步地址栏与加载态。
  useEffect(() => {
    let un: (() => void) | null = null;
    (async () => {
      un = await listen<{ kind: string; url: string; loading: boolean }>(
        "browser-event",
        (e) => {
          if (e.payload.url) setUrl(e.payload.url);
          setLoading(e.payload.loading);
        },
      );
    })();
    return () => {
      un?.();
    };
  }, []);

  // 占位尺寸变化 → 同步子 webview 的位置与大小。
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      void syncRect();
    });
    ro.observe(el);
    const onWinResize = () => {
      void syncRect();
    };
    window.addEventListener("resize", onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
    };
  }, [syncRect]);

  const closePage = async () => {
    try {
      await invoke("browser_close");
    } catch {
      // 已经关了也无所谓。
    }
    setHasPage(false);
    hasPageRef.current = false;
    setLoading(false);
    setUrl("");
  };

  return (
    <div className="browser-pane">
      <div className="rp-head">
        <span>浏览器</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading && <span className="browser-loading-dot" title="加载中" />}
          {hasPage && (
            <button type="button" className="btn-ghost" onClick={closePage} title="关闭内置浏览器">
              关闭
            </button>
          )}
        </span>
      </div>
      <div className="browser-toolbar">
        <button
          type="button"
          className="btn-ghost"
          disabled={!hasPage}
          onClick={() => invoke("browser_back").catch(() => {})}
          title="后退"
        >
          ←
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!hasPage}
          onClick={() => invoke("browser_forward").catch(() => {})}
          title="前进"
        >
          →
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!hasPage}
          onClick={() => invoke("browser_reload").catch(() => {})}
          title="刷新"
        >
          ↻
        </button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void openUrl(url);
          }}
          placeholder="输入网址，如 github.com 或 http://localhost:3000"
          aria-label="网址"
        />
        <button type="button" className="btn-primary" onClick={() => void openUrl(url)}>
          打开
        </button>
      </div>
      <div className="browser-host" ref={hostRef}>
        {!hasPage && (
          <div className="browser-empty">
            <div className="browser-empty-title">应用内浏览器</div>
            <div className="rp-empty-text">
              在上面输网址打开页面（本地 dev server 和外网都行），
              链接点开后留在应用内，不跳系统浏览器。独立 profile，不带系统浏览器的登录态。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
