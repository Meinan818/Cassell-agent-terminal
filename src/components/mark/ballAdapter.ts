/**
 * ballAdapter.ts — 适配层：配色 + 语义翻译（照搬初代 evaball.js 的两件事）。
 * 球本体只收 palette，不知道"诺玛"/"EVA"这两个词；映射表是唯一知道
 * "引擎事件"的地方，Mark 只认识 14 个球状态。
 */
import { useEffect, useState } from "react";
import type { BallState } from "./expressions";

export type BallMode = "norma" | "eva";
export type BallTheme = "light" | "dark";

export interface BallPalette {
  /** 球体背景（线性渐变，顶部提亮在 0–15% 内收完，保证 5 点亮度极差 ≤40）。 */
  ballBackground: string;
  /** 眼睛颜色（诺玛深色为墨色、其余为白色，无高光）。 */
  eyeColor: string;
  /** 思考环带颜色（球本体色，低透明度，单色）。 */
  ringColor: string;
  /** 球体阴影/光晕（B9：浅色收敛阴影，深色极淡光晕，无 inset 暗角）。 */
  glow: string;
}

/**
 * B4 压平渐变（实测数字见下方 luminance 校验）：
 * - 诺玛浅色：#141414 纯墨 + 顶部极淡提亮 #1e1e1e（+10/255 ≈ +3.9pts，在 +8% 以内，
 *   无硬高光点）；浅底上墨球清晰。
 * - 诺玛深色（Deline 4：随主题反色）：#f5f5f5 纯白 + 顶部提亮纯白 #ffffff
 *   （亮度极差 10，在 ≤40 以内）；深底上白球清晰，眼睛同步反为墨色 #141414。
 *   墨球贴近黑底看不见是 S1+S2+S3（9351873）留下的 bug：亮暗同一套墨色。
 * - EVA 浅色：#2563EB 基底 + 顶部提亮一档 #3b82f6；深色：#3b82f6 基底 +
 *   顶部提亮一档 #60a5fa。EVA 不动：两套蓝色在两种底上都可见。
 * 渐变全部是 linear-gradient(180deg, lift 0%, base 15%, base 100%)——
 * 15% 处已回到基底色，所以沿垂直中心线采 5 点（10/30/50/70/90%）时
 * 只有第 1 点带一点提亮，极差 ≤40、相邻差 ≤15（见 sampleLuminance）。
 */
export function paletteFor(mode: BallMode, theme: BallTheme): BallPalette {
  if (mode === "eva") {
    if (theme === "dark") {
      return {
        ballBackground:
          "linear-gradient(180deg, #60a5fa 0%, #3b82f6 15%, #3b82f6 100%)",
        eyeColor: "#ffffff",
        ringColor: "rgba(96, 165, 250, 0.55)",
        glow: "0 0 16px rgba(59, 130, 246, 0.18)",
      };
    }
    return {
      ballBackground:
        "linear-gradient(180deg, #3b82f6 0%, #2563eb 15%, #2563eb 100%)",
      eyeColor: "#ffffff",
      ringColor: "rgba(37, 99, 235, 0.45)",
      glow: "0 4px 12px rgba(0, 0, 0, 0.10)",
    };
  }
  // 诺玛：随主题反色，保证对比度——深色白球黑眼，浅色墨球白眼。
  if (theme === "dark") {
    return {
      ballBackground:
        "linear-gradient(180deg, #ffffff 0%, #f5f5f5 15%, #f5f5f5 100%)",
      eyeColor: "#141414",
      ringColor: "rgba(245, 245, 245, 0.5)",
      glow: "0 0 16px rgba(255, 255, 255, 0.10)",
    };
  }
  return {
    ballBackground:
      "linear-gradient(180deg, #1e1e1e 0%, #141414 15%, #141414 100%)",
    eyeColor: "#ffffff",
    ringColor: "rgba(20, 20, 20, 0.5)",
    glow: "0 4px 12px rgba(0, 0, 0, 0.10)",
  };
}

/** 相对亮度（0–255 标度），与 B4 验收口径一致。 */
export function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface GradientStop {
  color: string;
  at: number; // 0–100
}

/**
 * 沿垂直中心线采 5 点（y = 10/30/50/70/90%）的亮度：
 * 返回每点亮度、极差、最大相邻差。供 B4 验收与自测脚本复用。
 */
export function sampleLuminance(stops: GradientStop[]): {
  points: number[];
  spread: number;
  maxStep: number;
} {
  const at = (y: number): number => {
    // 分段线性插值
    if (y <= stops[0].at) return luminance(stops[0].color);
    for (let i = 1; i < stops.length; i++) {
      if (y <= stops[i].at) {
        const p = stops[i - 1];
        const n = stops[i];
        const t = (y - p.at) / (n.at - p.at || 1);
        return luminance(p.color) + t * (luminance(n.color) - luminance(p.color));
      }
    }
    return luminance(stops[stops.length - 1].color);
  };
  const points = [10, 30, 50, 70, 90].map((y) => Math.round(at(y) * 10) / 10);
  const spread = Math.max(...points) - Math.min(...points);
  let maxStep = 0;
  for (let i = 1; i < points.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(points[i] - points[i - 1]));
  }
  return { points, spread: Math.round(spread * 10) / 10, maxStep: Math.round(maxStep * 10) / 10 };
}

/** 各配色的渐变断点（与 paletteFor 里的字符串同一组数字，供采样校验）。 */
export const PALETTE_STOPS: Record<string, GradientStop[]> = {
  "norma-light": [
    { color: "#1e1e1e", at: 0 },
    { color: "#141414", at: 15 },
    { color: "#141414", at: 100 },
  ],
  "norma-dark": [
    { color: "#ffffff", at: 0 },
    { color: "#f5f5f5", at: 15 },
    { color: "#f5f5f5", at: 100 },
  ],
  "eva-light": [
    { color: "#3b82f6", at: 0 },
    { color: "#2563eb", at: 15 },
    { color: "#2563eb", at: 100 },
  ],
  "eva-dark": [
    { color: "#60a5fa", at: 0 },
    { color: "#3b82f6", at: 15 },
    { color: "#3b82f6", at: 100 },
  ],
};

/**
 * 引擎事件 → 球状态映射表（对照初代 evaball.js 的 EMOTION 表）。
 * 这是唯一知道"引擎事件"的地方；App.tsx 的接线（下一波）经过这里
 * 再传给 Mark。未知事件 → idle + console.warn。
 */
export type AgentEvent =
  | "runStart"
  | "agent-thinking"
  | "agent-tool-read"
  | "agent-tool-write"
  | "agent-tool-result"
  | "agent-delta"
  | "runDone-success"
  | "runDone-error"
  | "approvalPending"
  | "userStopped"
  | "ultracode-parallel"
  | "boot"
  | string;

const EVENT_TO_STATE: Record<string, BallState> = {
  runStart: "receiving", // 点头确认
  "agent-thinking": "thinking",
  "agent-tool-read": "searching", // 读类工具：read / list
  "agent-tool-write": "working", // 写类工具：write / run
  "agent-tool-result": "working", // 保持当前态（不闪）——调用方应保持，不切态
  "agent-delta": "replying",
  "runDone-success": "done",
  "runDone-error": "error",
  approvalPending: "blocked",
  userStopped: "stopped",
  "ultracode-parallel": "parallel", // ultracode 开启时 working 升级为 parallel
  boot: "loading",
};

export function stateFor(event: AgentEvent): BallState {
  const s = EVENT_TO_STATE[event];
  if (!s) {
    console.warn(`[Mark] unknown agent event "${event}", falling back to idle`);
    return "idle";
  }
  return s;
}

/** 从 DOM 读当前主题：App 把 theme-light / theme-dark 挂在 .app div 上。 */
/**
 * Deline 4b 根因：主题现在走 S4 的 html[data-theme]，`.app.theme-dark` 类
 * 在代码里已不存在（grep 为零）——旧实现永远返回 "light"，深色下诺玛
 * 与 EVA 都拿了浅色配色。所以只改 paletteFor 不够，必须先修检测。
 */
export function readAppTheme(): BallTheme {
  if (typeof document === "undefined") return "light";
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light") return t;
  return document.querySelector(".app.theme-dark") ? "dark" : "light";
}

/** 跟随主题变化的 hook（监听 html[data-theme] + .app 的 class 变化）。 */
export function useAppTheme(): BallTheme {
  const [theme, setTheme] = useState<BallTheme>(() => readAppTheme());
  useEffect(() => {
    const update = () => setTheme(readAppTheme());
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}
