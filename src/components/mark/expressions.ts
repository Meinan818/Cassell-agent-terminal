/**
 * expressions.ts — 数据层：球的 14 个工作状态声明式配置表。
 *
 * 依据 emotion-ball-plan.md §3.1：每个表情必须对应一个真实到达的 agent
 * 生命周期时刻；初代 32 种里的 12 个情绪（害羞/失落/生气…）全部砍掉。
 * 加表情 = 这里加一条配置 + ballAdapter.ts 映射表加一行，
 * Mark.tsx / useBallEngine.ts 一行不改。
 *
 * 单位：look / lookBias 用 %D（相对球直径的百分比）；角度用度；
 * eyeScale / eyeScaleY / open 是相对基态的乘数；bodyScale 是均匀缩放。
 */

export type BallState =
  | "idle"
  | "listening"
  | "receiving"
  | "thinking"
  | "searching"
  | "working"
  | "parallel"
  | "replying"
  | "waiting"
  | "blocked"
  | "done"
  | "error"
  | "stopped"
  | "loading";

/** 巡演模式（?ball=tour）的固定循环顺序。 */
export const BALL_STATES: BallState[] = [
  "idle",
  "listening",
  "receiving",
  "thinking",
  "searching",
  "working",
  "parallel",
  "replying",
  "waiting",
  "blocked",
  "done",
  "error",
  "stopped",
  "loading",
];

export type GazeMode =
  | "roam" // 待机漫游：滑行 + 停顿
  | "lock" // 锁定外部 gaze 目标
  | "scan" // 三角波快速扫读（检索）
  | "hop" // 在 2–3 个工作点之间跳（并行）
  | "still"; // 不主动动眼睛

export interface Expression {
  id: BallState;
  /** 眼睛整体缩放（1 = 基态）。 */
  eyeScale: number;
  /** 眼睛纵向压扁（1 = 基态）。 */
  eyeScaleY: number;
  /** 眼睛常驻开合度（1 = 全开；stopped 半闭 0.35）。 */
  open: number;
  /** 身体整体旋转（度），倾身只在状态切换时出现，上限 ±6°。 */
  bodyRotate: number;
  /** 眨眼间隔 [min, max] ms；null = 不眨眼。 */
  blinkMs: [number, number] | null;
  /** 注视模式。 */
  gazeMode: GazeMode;
  /** 注视横向偏置（%D），叠加在漫游/外部 gaze 之上。 */
  lookBiasX: number;
  /** 注视纵向偏置（%D）。 */
  lookBiasY: number;
  /** 思考环带（单色细环）是否显示。 */
  ring: boolean;
  /** 轻 shake（左右 ≤6px，0.5s 内收住）。 */
  shake: boolean;
  /** 完成时笑弧（代替药丸眼）。 */
  smile: boolean;
  /** 呼吸周期（秒），待机 4.6s。 */
  breathePeriod: number;
  /** 呼吸幅度（均匀缩放，待机 ±0.5%）。 */
  breatheAmp: number;
  /** 入场/进入时一次均匀缩放脉冲（+2%），0.3s 缓出，不循环。 */
  entryPulse: number;
}

/**
 * 思考池：替代初代 48 点眼环池的 5 个参数化药丸眼姿态，
 * 轮换间隔 2–3.6s。读感：P0 平静 / P1 扫读 / P2 斜视 / P3 圆睁 / P4 微聚。
 */
export interface ThinkPoolPose {
  lookX: number; // %D
  lookY: number; // %D
  scaleY: number;
  tiltDelta: number; // 度，叠加在基态倾斜上
}

export const THINKING_POOL: ThinkPoolPose[] = [
  { lookX: 0, lookY: 0, scaleY: 1, tiltDelta: 0 },
  { lookX: 9, lookY: 0, scaleY: 0.95, tiltDelta: 0 },
  { lookX: 0, lookY: -4, scaleY: 1, tiltDelta: -6 },
  { lookX: 0, lookY: 0, scaleY: 1.12, tiltDelta: 0 },
  { lookX: 0, lookY: 0, scaleY: 1.05, tiltDelta: 0 },
];

export const EXPRESSIONS: Record<BallState, Expression> = {
  idle: {
    id: "idle",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [2500, 4000],
    gazeMode: "roam",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  listening: {
    id: "listening",
    eyeScale: 1.05,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [3000, 5000],
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  receiving: {
    id: "receiving",
    eyeScale: 1.12,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [2500, 4000],
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    // 一次性关键帧：点头确认（0.7s 内回落），均匀缩放代替换旧的 -3px 轻沉
    //（垂直位移被禁，见 useBallEngine.ts 的调和说明）。
    entryPulse: -0.015,
  },
  thinking: {
    id: "thinking",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: -6,
    blinkMs: [3500, 7000],
    gazeMode: "roam",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: true,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.01,
    entryPulse: 0,
  },
  searching: {
    id: "searching",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [1600, 4000],
    gazeMode: "scan",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  working: {
    id: "working",
    eyeScale: 1.08,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [2800, 5500],
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0.02,
  },
  parallel: {
    id: "parallel",
    eyeScale: 1.08,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [2800, 5500],
    gazeMode: "hop",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: true,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0.02,
  },
  replying: {
    id: "replying",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: null, // 输出间隙才眨眼，输出中不主动眨眼
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  waiting: {
    id: "waiting",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [4000, 8000],
    gazeMode: "roam",
    lookBiasX: 0,
    lookBiasY: -2, // 视线略微上移/放空
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 5,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  blocked: {
    id: "blocked",
    eyeScale: 1,
    eyeScaleY: 0.75, // 警觉形收窄
    open: 1,
    bodyRotate: 0,
    blinkMs: null, // 保持警觉，不眨眼
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: true,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  done: {
    id: "done",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: [2500, 4000],
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: true,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0.02,
  },
  error: {
    id: "error",
    eyeScale: 1.14, // 圆睁
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: null, // 定格 1.5s，不眨眼
    gazeMode: "still",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: true, // 轻 shake 后定住
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  stopped: {
    id: "stopped",
    eyeScale: 0.6,
    eyeScaleY: 1,
    open: 0.35, // 慢慢收小到半闭后定格
    bodyRotate: 0,
    blinkMs: null,
    gazeMode: "still",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 5,
    breatheAmp: 0.005,
    entryPulse: -0.03, // 轻微缩小到 0.97（均匀缩放，不是下沉）
  },
  loading: {
    id: "loading",
    eyeScale: 1,
    eyeScaleY: 1,
    open: 1,
    bodyRotate: 0,
    blinkMs: null, // 双眼缓慢交替亮起（左眼眨、右眼眨，间隔 800ms）
    gazeMode: "still",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
};

/** 未知状态回退 idle + console.warn（照搬初代的 fallback 机制）。 */
export function expressionFor(state: string): Expression {
  const expr = (EXPRESSIONS as Record<string, Expression | undefined>)[state];
  if (!expr) {
    console.warn(`[Mark] unknown ball state "${state}", falling back to idle`);
    return EXPRESSIONS.idle;
  }
  return expr;
}
