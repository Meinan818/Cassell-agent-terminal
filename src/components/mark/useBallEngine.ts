/**
 * useBallEngine.ts — 驱动层：rAF + 弹簧 + 眨眼/注视调度 + 姿态合成。
 *
 * 依据 emotion-ball-plan.md §3.2–§3.4 与 grokbot-animation-spec.md：
 * - 离散切换：Cubic(0.645, 0.045, 0.355, 1.0) 指数缓出，0.3s，永不超调；
 *   切换前先眨眼 0.2s 遮盖（眼闭期间完成形变）。
 * - 连续运动：临界阻尼弹簧 ζ=1.0、子步 1/120；诺玛 k175/c26.5、EVA k315/c35.5
 *   （tempo 靠提高 ω，不降低阻尼）。
 * - 眨眼：确定性时刻表（固定种子 RNG，可复现可测试），总 0.2s、闭比开快、
 *   最低点满高 20%、两眼同步；睁开时 1.08 微过冲（只作用于眼睛）。
 * - 注视漫游：0.9–1.5s 选目标 → 滑行 0.4–0.6s → 停顿 0.4–0.9s，
 *   水平 ±7% D、垂直 ±2% D；指针目标（gaze prop）混合叠加。
 * - 呼吸与倾身（调和方案）：只允许均匀缩放 + 整体旋转——呼吸是 CSS 均匀缩放
 *   （4.6s 慢周期，待机 ±0.5%）、倾身是整体旋转（状态切换时 ±6°）、摇摆是
 *   缓慢旋转摆动（±2°）、眨眼软沉是均匀缩小 1.5%；永不垂直位移、永不压成椭圆。
 *   旧版里 replying 的"上下起伏"、receiving 的"-3px 轻沉"、stopped 的"下沉 +3px"
 *   一律改成均匀缩放（见 expressions.ts 的 entryPulse），不做垂直位移。
 * - 全局共享 rAF ticker（多实例单循环，集合清空自动停表）；待机无运动时停表，
 *   呼吸走 CSS animation（合成器层，零 JS）。
 * - prefers-reduced-motion：动画直达终态。
 * - 180s 无操作 → 休眠变暗 15%、呼吸放慢、眨眼停止；任意交互立即唤醒。
 */
import { useEffect, useRef, useState } from "react";
import {
  BALL_STATES,
  THINKING_POOL,
  expressionFor,
  type BallState,
  type Expression,
} from "./expressions";

/* ------------------------------------------------------------------ */
/* 几何常量（B1/B2 的验收数字，Mark.tsx 与自测脚本共用同一组）          */
/* ------------------------------------------------------------------ */

/** B1：两只眼平行倾斜 "/"，距垂直 14°（12–16° 取中）。 */
export const EYE_TILT_DEG = 14;
/** B2：眼中心 y = 39% D（38–40% 取中），眼顶 24% D。 */
export const EYE_CENTER_Y = 0.39;
export const EYE_W = 0.2; // 眼宽 20% D（用户已批准，不改）
export const EYE_H = 0.3; // 眼高 30% D（用户已批准，不改）
export const EYE_SPACING = 0.28; // 眼睛间距 28% D（不改）
/** B10：32–48px 小球的眼睛占比放大系数上限。 */
export const EYE_BOOST_MAX = 0.25;

/** 小尺寸眼睛放大：48px 以下按比例放大，28px 时眼宽 6.3px / 眼高 9.4px。 */
export function eyeBoost(size: number): number {
  if (size >= 48) return 1;
  return 1 + Math.min(EYE_BOOST_MAX, (48 - size) * 0.006);
}

/* ------------------------------------------------------------------ */
/* 缓动与弹簧                                                          */
/* ------------------------------------------------------------------ */

/** 指数缓出 Cubic(0.645, 0.045, 0.355, 1.0)，y(0.5) = 0.516875，永不超调。 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton + 二分兜底，求 x(t) = t 的参数
    let x = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(x) - t;
      if (Math.abs(err) < 1e-6) break;
      const d = sampleDX(x);
      if (Math.abs(d) < 1e-6) break;
      x -= err / d;
    }
    if (x < 0 || x > 1) {
      let lo = 0;
      let hi = 1;
      x = t;
      for (let i = 0; i < 12; i++) {
        if (sampleX(x) < t) lo = x;
        else hi = x;
        x = (lo + hi) / 2;
      }
    }
    return sampleY(x);
  };
}

export const easeExp = cubicBezier(0.645, 0.045, 0.355, 1.0);

/** 临界阻尼弹簧步进，子步 1/120（照搬初代 engine.js 的 springStep）。 */
export function springStep(
  x: number,
  v: number,
  target: number,
  k: number,
  c: number,
  dt: number,
): [number, number] {
  const sub = 1 / 120;
  let t = 0;
  while (t < dt) {
    const h = Math.min(sub, dt - t);
    const a = -k * (x - target) - c * v;
    v += a * h;
    x += v * h;
    t += h;
  }
  return [x, v];
}

export const SPRING_NORMA = { k: 175, c: 26.5 }; // ω=13.2, ζ=1.0
export const SPRING_EVA = { k: 315, c: 35.5 }; // ω=17.7, ζ=1.0, 1.7×

/* ------------------------------------------------------------------ */
/* 共享 rAF ticker（多实例单循环，空闲停表）                              */
/* ------------------------------------------------------------------ */

type TickFn = (now: number, dt: number) => boolean; // 返回 false = 本实例无运动，可退订

const tickSubs = new Set<TickFn>();
let tickRaf = 0;
let lastTick = 0;

function tickLoop(now: number): void {
  const dt = Math.min(0.05, (now - lastTick) / 1000 || 0.016);
  lastTick = now;
  // 复制一份再跑：回调里退订不应影响本轮遍历
  [...tickSubs].forEach((fn) => {
    if (!fn(now, dt)) tickSubs.delete(fn);
  });
  if (tickSubs.size > 0) {
    tickRaf = requestAnimationFrame(tickLoop);
  } else {
    tickRaf = 0;
  }
}

export function subscribeTick(fn: TickFn): () => void {
  tickSubs.add(fn);
  if (!tickRaf) {
    lastTick = performance.now();
    tickRaf = requestAnimationFrame(tickLoop);
  }
  return () => {
    tickSubs.delete(fn);
    if (tickSubs.size === 0 && tickRaf) {
      cancelAnimationFrame(tickRaf);
      tickRaf = 0;
    }
  };
}

/* ------------------------------------------------------------------ */
/* 活动总线（休眠判定用）：任意指针/键盘/滚轮活动都会唤醒               */
/* ------------------------------------------------------------------ */

let lastActivityAt = Date.now();
const activitySubs = new Set<() => void>();
let activityWired = false;

function wireActivity(): void {
  if (activityWired || typeof window === "undefined") return;
  activityWired = true;
  const bump = () => {
    lastActivityAt = Date.now();
    [...activitySubs].forEach((fn) => fn());
  };
  window.addEventListener("pointerdown", bump);
  window.addEventListener("keydown", bump);
  window.addEventListener("wheel", bump, { passive: true });
}

export function onBallActivity(fn: () => void): () => void {
  wireActivity();
  activitySubs.add(fn);
  return () => {
    activitySubs.delete(fn);
  };
}

/* ------------------------------------------------------------------ */
/* 确定性 RNG（固定种子，可复现可测试；巡演模式会重置种子）              */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 姿态                                                               */
/* ------------------------------------------------------------------ */

export interface BallPose {
  eyeScale: number;
  eyeScaleY: number;
  /** 两眼开合乘数（眨眼：最低 0.2；睁开过冲 1.08）。 */
  openL: number;
  openR: number;
  /** 注视偏移（%D）：水平 ±7，垂直 ±2。 */
  lookX: number;
  lookY: number;
  /** 两眼倾斜角（度），基态均为 14°（"/" 平行）。 */
  tiltL: number;
  tiltR: number;
  /** 两眼垂直偏移（px）：error 的一高一低 + 注视的眼对倾斜。 */
  dyL: number;
  dyR: number;
  /** 身体整体旋转（度），倾身只在状态切换时，上限 ±6°。 */
  bodyRotate: number;
  /** 外层均匀缩放脉冲（入场/完成 +2%，receiving -1.5%）。 */
  pulse: number;
  /** 自旋偏航角（弧度），眼睛转到背面按 cos ≤ 0.02 隐藏。 */
  yaw: number;
  ring: boolean;
  shake: boolean;
  smile: boolean;
  /** 呼吸周期（秒，EVA tempo 下除以 1.7）。 */
  breathePeriod: number;
  /** 休眠变暗系数（1 正常，0.85 休眠）。 */
  dim: number;
  reducedMotion: boolean;
}

export interface BallEngineOpts {
  state: BallState;
  eva: boolean;
  fast: boolean;
  gaze: number;
  size: number;
}

/** 眨眼关键帧：闭 80ms（快）→ 睁到 1.08（200ms）→ 300ms 落回 1.0。 */
const BLINK_CLOSE_MS = 80;
const BLINK_OPEN_MS = 200;
const BLINK_TOTAL_MS = 300;
const BLINK_FLOOR = 0.2;
const BLINK_OVERSHOOT = 1.08;

function blinkOpenAt(elapsedMs: number): number {
  if (elapsedMs < BLINK_CLOSE_MS) {
    const t = elapsedMs / BLINK_CLOSE_MS;
    return 1 - (1 - BLINK_FLOOR) * easeExp(t);
  }
  if (elapsedMs < BLINK_OPEN_MS) {
    const t = (elapsedMs - BLINK_CLOSE_MS) / (BLINK_OPEN_MS - BLINK_CLOSE_MS);
    return BLINK_FLOOR + (BLINK_OVERSHOOT - BLINK_FLOOR) * easeExp(t);
  }
  if (elapsedMs < BLINK_TOTAL_MS) {
    const t = (elapsedMs - BLINK_OPEN_MS) / (BLINK_TOTAL_MS - BLINK_OPEN_MS);
    return BLINK_OVERSHOOT + (1 - BLINK_OVERSHOOT) * easeExp(t);
  }
  return 1;
}

interface Morph {
  from: { eyeScale: number; eyeScaleY: number; open: number; bodyRotate: number; tiltL: number; tiltR: number };
  to: { eyeScale: number; eyeScaleY: number; open: number; bodyRotate: number; tiltL: number; tiltR: number };
  start: number;
  dur: number;
}

interface Blink {
  eye: "both" | "left" | "right";
  start: number;
}

interface Slide {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  dur: number;
}

interface Spin {
  start: number;
  turns: number;
}

const TOUR_MS = 2500;

/** ?ball=tour 巡演 / ?ball=<state> 单状态锁定（开发态开关）。 */
export function useTourState(propState: BallState): BallState {
  const [tour, setTour] = useState(false);
  const [lock, setLock] = useState<BallState | null>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("ball");
    if (q === "tour") setTour(true);
    else if (q && (BALL_STATES as string[]).includes(q)) setLock(q as BallState);
  }, []);
  useEffect(() => {
    if (!tour) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % BALL_STATES.length), TOUR_MS);
    return () => window.clearInterval(t);
  }, [tour]);
  if (lock) return lock;
  if (tour) return BALL_STATES[idx];
  return propState;
}

function initialPose(expr: Expression, tempo: number): BallPose {
  return {
    eyeScale: expr.eyeScale,
    eyeScaleY: expr.eyeScaleY,
    openL: expr.open,
    openR: expr.open,
    lookX: expr.lookBiasX,
    lookY: expr.lookBiasY,
    tiltL: EYE_TILT_DEG,
    tiltR: EYE_TILT_DEG,
    dyL: 0,
    dyR: 0,
    bodyRotate: expr.bodyRotate,
    pulse: 0,
    yaw: 0,
    ring: expr.ring,
    shake: expr.shake,
    smile: expr.smile,
    breathePeriod: expr.breathePeriod / tempo,
    dim: 1,
    reducedMotion: false,
  };
}

export function useBallEngine(opts: BallEngineOpts): BallPose {
  const { state, eva, fast, gaze, size } = opts;
  const tempo = eva || fast ? 1.7 : 1;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rngRef = useRef<() => number>(mulberry32(20261113));
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;
  // tempo/size 经 ref 读：ticker 持有的是旧闭包的 step，props 变化后
  // 新 tempo 必须立刻生效（否则 EVA 切换后呼吸周期不变，直到下次重订阅）。
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [pose, setPose] = useState<BallPose>(() =>
    initialPose(expressionFor(state), tempo),
  );

  const eng = useRef({
    cur: initialPose(expressionFor(state), tempo),
    expr: expressionFor(state),
    morph: null as Morph | null,
    blink: null as Blink | null,
    slide: null as Slide | null,
    spin: null as Spin | null,
    pulseStart: 0,
    pulseAmp: 0,
    pulseDur: 0,
    poolIdx: 0,
    yaw: 0,
    yawV: 0,
    dim: false,
    prevEva: eva,
    unsub: null as (() => void) | null,
    timers: [] as number[],
  });

  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(fn, ms);
    eng.current.timers.push(id);
  };
  const clearTimers = (): void => {
    eng.current.timers.forEach((id) => window.clearTimeout(id));
    eng.current.timers = [];
  };

  const ensureTicking = (): void => {
    if (eng.current.unsub || reducedMotion) return;
    // step 返回 false = 无运动：tickLoop 会退订本回调，这里同步把 unsub
    // 置空，否则下次 startBlink 会以为还在订阅中而不再拉起循环。
    const tickFn = (now: number, dt: number): boolean => {
      const keep = step(now, dt);
      if (!keep) eng.current.unsub = null;
      return keep;
    };
    eng.current.unsub = subscribeTick(tickFn);
  };

  const compose = (now: number): BallPose => {
    const e = eng.current;
    const p: BallPose = {
      ...e.cur,
      yaw: e.yaw,
      dim: e.dim ? 0.85 : 1,
      breathePeriod: e.expr.breathePeriod / tempoRef.current,
      reducedMotion,
    };
    // replying：随输出节奏轻微缩放（0.68s 周期，幅度 0.1 峰峰值即 ±0.05）
    if (e.expr.id === "replying") {
      p.eyeScale = e.cur.eyeScale * (1 + 0.05 * Math.sin((2 * Math.PI * now) / 680));
    }
    // searching：三角波快速扫读（周期 0.7s）
    if (e.expr.id === "searching") {
      const ph = ((now / 700) % 2 + 2) % 2;
      p.lookX = 7 * (ph < 1 ? -1 + 2 * ph : 3 - 2 * ph);
    }
    return p;
  };

  const step = (now: number, dt: number): boolean => {
    const e = eng.current;
    let moving = false;

    // 形变插值（0.3s 指数缓出，永不超调）
    if (e.morph) {
      const t = Math.min(1, (now - e.morph.start) / e.morph.dur);
      const k = easeExp(t);
      const f = e.morph.from;
      const to = e.morph.to;
      e.cur.eyeScale = f.eyeScale + (to.eyeScale - f.eyeScale) * k;
      e.cur.eyeScaleY = f.eyeScaleY + (to.eyeScaleY - f.eyeScaleY) * k;
      e.cur.bodyRotate = f.bodyRotate + (to.bodyRotate - f.bodyRotate) * k;
      e.cur.tiltL = f.tiltL + (to.tiltL - f.tiltL) * k;
      e.cur.tiltR = f.tiltR + (to.tiltR - f.tiltR) * k;
      // open 用基态值插值（眨眼乘数另算）
      e.cur.openL = f.open + (to.open - f.open) * k;
      e.cur.openR = e.cur.openL;
      if (t >= 1) e.morph = null;
      else moving = true;
    }

    // 眨眼关键帧
    if (e.blink) {
      const el = now - e.blink.start;
      if (el >= BLINK_TOTAL_MS) {
        e.blink = null;
        e.cur.openL = e.expr.open;
        e.cur.openR = e.expr.open;
      } else {
        const v = blinkOpenAt(el) * e.expr.open;
        if (e.blink.eye === "both" || e.blink.eye === "left") e.cur.openL = v;
        if (e.blink.eye === "both" || e.blink.eye === "right") e.cur.openR = v;
        moving = true;
      }
    }

    // 注视滑行（0.4–0.6s 指数缓出）
    if (e.slide) {
      const t = Math.min(1, (now - e.slide.start) / e.slide.dur);
      const k = easeExp(t);
      e.cur.lookX = e.slide.fromX + (e.slide.toX - e.slide.fromX) * k;
      e.cur.lookY = e.slide.fromY + (e.slide.toY - e.slide.fromY) * k;
      if (t >= 1) e.slide = null;
      else moving = true;
    }

    // 自旋：目标 0→2π 线性爬升 1200ms，临界阻尼弹簧追赶（解析速度，无微分噪声）
    if (e.spin) {
      const el = now - e.spin.start;
      const progress = Math.min(1, el / 1200);
      const target = e.spin.turns * 2 * Math.PI * progress;
      const spring = tempoRef.current > 1 ? SPRING_EVA : SPRING_NORMA;
      const [y, v] = springStep(e.yaw, e.yawV, target, spring.k, spring.c, dt);
      e.yaw = y;
      e.yawV = v;
      if (progress >= 1 && Math.abs(e.yaw - target) < 0.01 && Math.abs(v) < 0.05) {
        e.yaw = e.yaw % (2 * Math.PI);
        e.yawV = 0;
        e.spin = null;
      } else {
        moving = true;
      }
    }

    // 入场/完成脉冲（均匀缩放，正弦包络，单次）
    if (e.pulseAmp !== 0) {
      const el = now - e.pulseStart;
      const progress = el / e.pulseDur;
      if (progress >= 1) {
        e.pulseAmp = 0;
        e.cur.pulse = 0;
      } else {
        e.cur.pulse = e.pulseAmp * Math.sin(Math.PI * progress);
        moving = true;
      }
    }

    // 注视的眼对倾斜：向左看时左眼略高、右眼略低，反之亦然（±1.5% D）
    const lookN = Math.max(-1, Math.min(1, e.cur.lookX / 7));
    const skew = lookN * sizeRef.current * 0.015;
    const err = e.expr.id === "error";
    e.cur.dyL = skew + (err ? -3 * (sizeRef.current / 100) : 0);
    e.cur.dyR = -skew + (err ? 4 * (sizeRef.current / 100) : 0);

    setPose(compose(now));

    // 持续运动态（检索扫读 / 流式脉冲）需要 ticker 常驻
    if (e.expr.id === "searching" || e.expr.id === "replying") moving = true;
    return moving;
  };

  const startBlink = (eye: Blink["eye"] = "both"): void => {
    if (reducedMotion) return;
    eng.current.blink = { eye, start: performance.now() };
    ensureTicking();
  };

  const scheduleBlink = (): void => {
    const e = eng.current;
    const ms = e.expr.blinkMs;
    if (!ms || reducedMotion) return;
    const interval = (ms[0] + rngRef.current() * (ms[1] - ms[0])) / tempoRef.current;
    later(() => {
      if (Date.now() - lastActivityAt > 180000) {
        // 休眠：变暗 15%、呼吸放慢、眨眼停止；10s 后再查
        e.dim = true;
        setPose((p) => ({ ...p, dim: 0.85 }));
        later(() => scheduleBlink(), 10000);
        return;
      }
      e.dim = false;
      startBlink("both");
      // 14% 概率追加第二次连眨
      if (rngRef.current() < 0.14) {
        later(() => startBlink("both"), BLINK_TOTAL_MS + 120);
      }
      scheduleBlink();
    }, interval);
  };

  const pickRoamTarget = (): { x: number; y: number } => {
    const r = rngRef.current;
    // 70% 概率水平方向，30% 概率轻微上下
    const x = (r() * 2 - 1) * 7;
    const y = r() < 0.7 ? (r() * 2 - 1) * 1 : (r() * 2 - 1) * 2;
    return { x, y };
  };

  const scheduleRoam = (): void => {
    const e = eng.current;
    if (e.expr.gazeMode !== "roam" || reducedMotion) return;
    const dwell = (400 + rngRef.current() * 500) / tempoRef.current;
    later(() => {
      if (e.expr.gazeMode !== "roam") return;
      const t = pickRoamTarget();
      // 指针目标混合叠加：漫游目标 + gaze*3.5% D，钳制 ±7% D
      const toX = Math.max(-7, Math.min(7, t.x + gazeRef.current * 3.5));
      const toY = Math.max(-2, Math.min(2, t.y + e.expr.lookBiasY));
      e.slide = {
        fromX: e.cur.lookX,
        fromY: e.cur.lookY,
        toX,
        toY,
        start: performance.now(),
        dur: (400 + rngRef.current() * 200) / tempoRef.current,
      };
      ensureTicking();
      scheduleRoam();
    }, dwell);
  };

  const schedulePool = (): void => {
    const e = eng.current;
    if (e.expr.id !== "thinking" || reducedMotion) return;
    later(() => {
      if (e.expr.id !== "thinking") return;
      e.poolIdx = (e.poolIdx + 1) % THINKING_POOL.length;
      const p = THINKING_POOL[e.poolIdx];
      const now = performance.now();
      e.morph = {
        from: {
          eyeScale: e.cur.eyeScale,
          eyeScaleY: e.cur.eyeScaleY,
          open: e.expr.open,
          bodyRotate: e.cur.bodyRotate,
          tiltL: e.cur.tiltL,
          tiltR: e.cur.tiltR,
        },
        to: {
          eyeScale: e.expr.eyeScale,
          eyeScaleY: e.expr.eyeScaleY * p.scaleY,
          open: e.expr.open,
          bodyRotate: e.expr.bodyRotate,
          tiltL: EYE_TILT_DEG + p.tiltDelta,
          tiltR: EYE_TILT_DEG - p.tiltDelta,
        },
        start: now,
        dur: 300,
      };
      // 池姿态带注视漂移
      e.slide = {
        fromX: e.cur.lookX,
        fromY: e.cur.lookY,
        toX: p.lookX,
        toY: p.lookY,
        start: now,
        dur: 300,
      };
      ensureTicking();
      schedulePool();
    }, 2000 + rngRef.current() * 1600);
  };

  const scheduleLoadingBlink = (): void => {
    const e = eng.current;
    if (e.expr.id !== "loading" || reducedMotion) return;
    let left = true;
    const tickFn = () => {
      if (e.expr.id !== "loading") return;
      startBlink(left ? "left" : "right");
      left = !left;
      later(tickFn, 800);
    };
    later(tickFn, 400);
  };

  const startSpin = (): void => {
    const e = eng.current;
    if (reducedMotion || e.spin) return;
    e.spin = { start: performance.now(), turns: 1 };
    ensureTicking();
  };

  const applyState = (next: Expression, coverBlink: boolean): void => {
    const e = eng.current;
    const now = performance.now();
    const prev = e.expr;
    e.expr = next;
    clearTimers();
    // 思考池复位
    e.poolIdx = 0;
    // 眨眼遮盖：切换表情前先眨眼 0.2s（停止/加载类除外），眼闭期间完成形变
    if (coverBlink && next.id !== "stopped" && next.id !== "loading") {
      startBlink("both");
    } else {
      e.blink = null;
    }
    // 形变插值（0.3s 指数缓出）
    const err = next.id === "error";
    e.morph = {
      from: {
        eyeScale: e.cur.eyeScale,
        eyeScaleY: e.cur.eyeScaleY,
        open: prev.open,
        bodyRotate: e.cur.bodyRotate,
        tiltL: e.cur.tiltL,
        tiltR: e.cur.tiltR,
      },
      to: {
        eyeScale: next.eyeScale,
        eyeScaleY: next.eyeScaleY,
        open: next.open,
        bodyRotate: next.bodyRotate,
        tiltL: err ? EYE_TILT_DEG - 6 : EYE_TILT_DEG,
        tiltR: err ? EYE_TILT_DEG + 8 : EYE_TILT_DEG,
      },
      start: now,
      dur: 300,
    };
    // 入场/完成脉冲（单次均匀缩放）
    if (next.entryPulse !== 0) {
      e.pulseAmp = next.entryPulse;
      e.pulseStart = now;
      e.pulseDur = next.id === "receiving" ? 700 : 600;
    }
    // 静态标志位（环带/shake/笑弧）立即换，动效由 CSS 过渡
    e.cur.ring = next.ring;
    e.cur.shake = next.shake;
    e.cur.smile = next.smile;
    e.cur.breathePeriod = next.breathePeriod / tempoRef.current;
    ensureTicking();
    // 按状态重建调度器
    scheduleBlink();
    if (next.gazeMode === "roam") scheduleRoam();
    if (next.id === "thinking") schedulePool();
    if (next.id === "loading") scheduleLoadingBlink();
    // 注视锁定态：滑向外部 gaze 目标
    if (next.gazeMode === "lock") {
      e.slide = {
        fromX: e.cur.lookX,
        fromY: e.cur.lookY,
        toX: Math.max(-7, Math.min(7, gaze * 7 + next.lookBiasX)),
        toY: Math.max(-2, Math.min(2, next.lookBiasY)),
        start: now,
        dur: 500 / tempoRef.current,
      };
      ensureTicking();
    }
    if (next.gazeMode === "still") {
      e.slide = {
        fromX: e.cur.lookX,
        fromY: e.cur.lookY,
        toX: next.lookBiasX,
        toY: next.lookBiasY,
        start: now,
        dur: 500 / tempoRef.current,
      };
      ensureTicking();
    }
  };

  // ---- 状态切换（props 变化） ----
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      // 出场：大球（≥72px）idle 挂载时眼睛绕球转满一圈再滑入位置
      if (size >= 72 && state === "idle") startSpin();
      applyState(expressionFor(state), false);
    } else {
      applyState(expressionFor(state), true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ---- EVA 切换 spin：eva false→true 时转一整圈（1200ms） ----
  useEffect(() => {
    const e = eng.current;
    if (e.prevEva !== eva) {
      const wasEva = e.prevEva;
      e.prevEva = eva;
      // 只在 ≥36px 的球上做 spin（顶栏 36 / 空态 84 / 侧栏 40），
      // 28px 消息内小球与 24px toast 只换色，不重复做仪式
      if (eva && !wasEva && size >= 36) startSpin();
    }
    // tempo 变化立即刷新呼吸周期（ticker 停表时 pose 不会自动更新）
    setPose((p) => ({ ...p, breathePeriod: e.expr.breathePeriod / tempo }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eva, size]);

  // ---- 外部 gaze 变化：lock 态滑向新目标 ----
  useEffect(() => {
    const e = eng.current;
    if (e.expr.gazeMode === "lock") {
      e.slide = {
        fromX: e.cur.lookX,
        fromY: e.cur.lookY,
        toX: Math.max(-7, Math.min(7, gaze * 7 + e.expr.lookBiasX)),
        toY: Math.max(-2, Math.min(2, e.expr.lookBiasY)),
        start: performance.now(),
        dur: 500 / tempoRef.current,
      };
      ensureTicking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaze]);

  // ---- 休眠唤醒：任意交互立即唤醒 + 眨一次眼 ----
  useEffect(() => {
    const off = onBallActivity(() => {
      const e = eng.current;
      if (e.dim) {
        e.dim = false;
        setPose((p) => ({ ...p, dim: 1 }));
        startBlink("both");
      }
    });
    return off;
  }, []);

  // ---- 卸载清理 ----
  useEffect(() => {
    return () => {
      clearTimers();
      if (eng.current.unsub) {
        eng.current.unsub();
        eng.current.unsub = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reduced-motion 下：直达终态，不跑任何调度
  if (reducedMotion) {
    const expr = expressionFor(state);
    return {
      ...initialPose(expr, 1),
      openL: expr.open,
      openR: expr.open,
      reducedMotion: true,
    };
  }

  return pose;
}
