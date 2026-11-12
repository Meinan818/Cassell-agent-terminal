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

/* ------------------------------------------------------------------ */
/* 人格动作参数表（第 3 步第二波 §1）：只看动作、不看颜色也要分得出    */
/* 是诺玛还是 EVA。诺玛冷静耐心温和，EVA 锋利警觉快速。                  */
/* ------------------------------------------------------------------ */

/**
 * 呼吸波形（第 3 步第二波 §6）：诺玛慢吸入 2s → 停顿 0.6s → 慢呼出 2s，
 * 4.6s 周期；EVA 吸入 1.2s → 短停顿 0.3s → 呼出 1.2s，约 2.7s 周期，
 * 呼出末尾带一次极轻的二次脉冲（警觉的心跳漏一拍再补上）。
 */
export interface BreatheWaveform {
  inhaleS: number;
  holdS: number;
  exhaleS: number;
  /** 呼出末尾是否带二次脉冲。 */
  secondPulse: boolean;
}

export const BREATHE_NORMA: BreatheWaveform = {
  inhaleS: 2,
  holdS: 0.6,
  exhaleS: 2,
  secondPulse: false,
};

export const BREATHE_EVA: BreatheWaveform = {
  inhaleS: 1.2,
  holdS: 0.3,
  exhaleS: 1.2,
  secondPulse: true,
};

/** 诺玛呼吸周期 4.6s；EVA 2.7s（= 4.6 / 1.7 tempo）。 */
export const BREATHE_PERIOD_NORMA = 4.6;
export const BREATHE_PERIOD_EVA = 2.7;

export interface PersonaMotion {
  /** 注视漫游：目标间停顿 [min, max] ms（诺玛拉长、EVA 缩短）。 */
  roamDwellMs: [number, number];
  /** 注视滑行时长 [min, max] ms（诺玛更缓、EVA 更快）。 */
  roamSlideMs: [number, number];
  /** 注视漫游横向范围 %D（EVA 工作时幅度更大）。 */
  roamRangeX: number;
  /** 眨眼间隔乘数（乘在各状态 blinkMs 上）：诺玛 1.25 慢而放松，EVA 0.7 快。 */
  blinkScale: number;
  /** 眨眼闭合时长 ms（诺玛 110 慢而柔，EVA 60 干脆）。 */
  blinkCloseMs: number;
  /** 眨眼睁开完成时刻 ms（从眨眼开始计，含过冲到 1.08）。 */
  blinkOpenMs: number;
  /** 眨眼总时长 ms（诺玛 330，EVA 200）。 */
  blinkTotalMs: number;
  /** 呼吸波形。 */
  breathe: BreatheWaveform;
  /** 呼吸周期（秒）。 */
  breathePeriodS: number;
  /** 检索扫读周期 ms（诺玛 700，EVA 450）。 */
  scanPeriodMs: number;
  /** 检索扫读幅度 %D（诺玛 ±7，EVA ±9）。 */
  scanAmpPct: number;
  /** 并行跳点停留 [min, max] ms。 */
  hopDwellMs: [number, number];
  /** 并行跳点滑行 ms。 */
  hopSlideMs: number;
  /** 思考时眼睛上飘 %D（诺玛 -2 微微上飘，EVA 0）。 */
  thinkingLookUpPct: number;
}

export const PERSONA_MOTION: Record<"norma" | "eva", PersonaMotion> = {
  norma: {
    roamDwellMs: [650, 1100],
    roamSlideMs: [550, 750],
    roamRangeX: 7,
    blinkScale: 1.25,
    blinkCloseMs: 110,
    blinkOpenMs: 230,
    blinkTotalMs: 330,
    breathe: BREATHE_NORMA,
    breathePeriodS: BREATHE_PERIOD_NORMA,
    scanPeriodMs: 700,
    scanAmpPct: 7,
    hopDwellMs: [800, 1500],
    hopSlideMs: 350,
    thinkingLookUpPct: -2,
  },
  eva: {
    roamDwellMs: [300, 550],
    roamSlideMs: [250, 400],
    roamRangeX: 9,
    blinkScale: 0.7,
    blinkCloseMs: 60,
    blinkOpenMs: 140,
    blinkTotalMs: 200,
    breathe: BREATHE_EVA,
    breathePeriodS: BREATHE_PERIOD_EVA,
    scanPeriodMs: 450,
    scanAmpPct: 9,
    hopDwellMs: [500, 900],
    hopSlideMs: 220,
    thinkingLookUpPct: 0,
  },
};

/** 按 eva/fast 取人格（fast 即 EVA tempo，与 useBallEngine 的 tempo 口径一致）。 */
export function personaFor(evaOrFast: boolean): PersonaMotion {
  return evaOrFast ? PERSONA_MOTION.eva : PERSONA_MOTION.norma;
}

/* ------------------------------------------------------------------ */
/* 眼形与核验环（第 3 步第二波 §3–§4）                                  */
/* ------------------------------------------------------------------ */

/** 待机久了微微下垂：idle 超过 60s，眼高 0.92× + 眼睛整体下移 1% D。 */
export const IDLE_DROOP_AFTER_MS = 60000;
export const IDLE_DROOP_SCALE_Y = 0.92;
export const IDLE_DROOP_DY_PCT = 1;

/** 权限核验环会填充的状态（working 家族）。 */
export const RING_FILLING_STATES: BallState[] = [
  "thinking",
  "searching",
  "working",
  "parallel",
];

/**
 * 核验环填充时长：诺玛满环约 8s 匀速，EVA 约 4s 带脉冲。
 * 进度按连续工作时长累计（thinking→searching→working→parallel 连续
 * 切换不重置，离开工作家族才清零；blocked/error 时冻结在当前进度）。
 */
export const RING_FILL_MS_NORMA = 8000;
export const RING_FILL_MS_EVA = 4000;

/** done 时环填满后淡出时长 0.6s。 */
export const RING_DONE_FADE_MS = 600;

/** blocked/error 时环变暗系数。 */
export const RING_DIMMED_OPACITY = 0.4;

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
  /** 笑弧弧度（弧高占眼高的比例；done 0.55，其余 0）。 */
  smileArc: number;
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
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    // 一次性关键帧：点头确认（0.7s 内回落），均匀缩放代替换旧的 -3px 轻沉
    //（垂直位移被禁，见 useBallEngine.ts 的调和说明）。
    entryPulse: -0.015,
  },
  thinking: {
    id: "thinking",
    eyeScale: 1,
    eyeScaleY: 0.8, // 专注收窄（第 3 步第二波 §3）
    open: 1,
    bodyRotate: -6,
    blinkMs: [3500, 7000],
    gazeMode: "roam",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: true,
    shake: false,
    smile: false,
    smileArc: 0,
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
    smileArc: 0,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0,
  },
  working: {
    id: "working",
    eyeScale: 1.08,
    eyeScaleY: 0.8, // 专注收窄（第 3 步第二波 §3）
    open: 1,
    bodyRotate: 0,
    blinkMs: [2800, 5500],
    gazeMode: "lock",
    lookBiasX: 0,
    lookBiasY: 0,
    ring: false,
    shake: false,
    smile: false,
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0.55,
    breathePeriod: 4.6,
    breatheAmp: 0.005,
    entryPulse: 0.02,
  },
  error: {
    id: "error",
    eyeScale: 1.14, // 惊讶圆睁：眼高 1.14×（均匀缩放，宽高同为 1.14×；unexpected cue 沿用 1.15×）
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
    smileArc: 0,
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
    smileArc: 0,
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
    smileArc: 0,
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
