import { useEffect, useRef, useState } from "react";
import Mark from "./Mark";
import { SEAL_TARGETS } from "./sealTargets";
import { APP_VERSION } from "../version";

/**
 * 开机登录流（七步，顺序固定）：
 * particles（3D 粒子校徽：白粒子从深空汇聚成有厚度的粒子校徽）
 * → gate（身份认证门）→ finger（指纹）
 * → login（登录表单）→ verify（权限核验环 0→100% 点亮 S）
 * → granted（ACCESS GRANTED）→ welcome（WELCOME + 身份已连接面板）
 * → 300ms 交叉淡化进工作区。
 *
 * 质感约定（frontend-redesign-plan.md §2 / §7.1）：
 * - 阶段切换：交叉淡化 600ms --ease-exp，淡出与淡入重叠 150ms
 *   （淡出 0–600ms，淡入自 450ms 起 600ms）。
 * - 字阶：仪式大标题 32px/600/-0.02em；WELCOME 字距 0.30em；
 *   拉丁铭文衬线体逐行淡入；核验环进度数字等宽字体。
 * - 间距：4px 基数（8 / 12 / 16 / 24 / 32 / 48）。
 * - 配色：近黑 + 白 + 银 + 墨绿，不要金色。
 */
type Phase =
  | "particles"
  | "gate"
  | "finger"
  | "login"
  | "verify"
  | "granted"
  | "welcome";

const LOG_LINES = [
  `卡塞尔学院终端 v${APP_VERSION}`,
  "加载诺玛核心 … OK",
  "连接学院网络 … OK",
  "验证专员身份 …",
  "血统评级 … S",
  "ACCESS GRANTED",
];

const ORDER: Phase[] = [
  "particles",
  "gate",
  "finger",
  "login",
  "verify",
  "granted",
  "welcome",
];

/** 每步停留时长。粒子段：校徽 6500ms 淡出，8500ms 才出认证门，不得重叠。 */
const PHASE_MS: Record<Phase, number> = {
  particles: 8500,
  gate: 1600,
  finger: 2200,
  login: 2600,
  verify: 2400,
  granted: 1400,
  welcome: 2200,
};

/** 交叉淡化：旧段淡出 600ms，新段 300ms 后淡入 600ms，二者重叠 300ms
 * 才是真的交叉淡化——之前 450ms 延迟只剩 150ms 重叠，旧段快淡没了
 * 新段才出现，中间近半秒空场，看着像硬切。七步每步停留时长不动，
 * 只改淡入提前量。 */
const STAGE_MS = 600;
const STAGE_ENTER_DELAY_MS = 300;

/** 铭文三行（拉丁铭文，衬线体逐行淡入）。 */
const MOTTO_LINES = [
  "BONUM CERTAMEN CERTAVI",
  "CURSUM CONSUMMAVI",
  "FIDEM SERVAVI",
];

/** 指纹纹路：程序化生成的涡纹（whorl）——22 条平滑嵌套的闭合纹脊，
 * 不是同心圆简笔画，也不是一团乱线。
 * 关键在“平行流动”：相位只随层数缓慢漂移，不逐条随机——真指纹的
 * 纹脊是平行流线；逐条随机相位 + 高频扰动会让纹脊互相打结、缠成毛线球。
 * 低频扰动（2θ 主瓣 + 3θ 细流，振幅小）让环带微微起伏但不打结；
 * 内圈密亮、外圈渐淡，中心收成一个干净的小环芯，不留空洞。 */
function fingerprintRidges(): { d: string; o: number; delay: number }[] {
  const cx = 90;
  const cy = 94;
  const N = 22;
  const ridges: { d: string; o: number; delay: number }[] = [];
  for (let i = 0; i < N; i++) {
    const r0 = 5 + i * 3.7; // 5 → 约 82.7，铺满 clip 椭圆
    const phase = i * 0.2; // 相位随层缓慢漂移：相邻纹脊平行流动
    const steps = 140;
    let d = "";
    let minY = Infinity;
    for (let k = 0; k <= steps; k++) {
      const th = (k / steps) * Math.PI * 2;
      const rr =
        r0 *
        (1 +
          0.075 * Math.sin(2 * th + phase) +
          0.045 * Math.sin(3 * th + phase * 1.7 + 0.9));
      const x = cx + Math.cos(th) * rr * 0.94;
      const y = cy + Math.sin(th) * rr * 1.06;
      if (y < minY) minY = y;
      d += `${k === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    d += "Z";
    // 内密外疏：核心亮（0.84）、外圈渐淡（0.34），边缘柔化
    const fall = 1 - i / (N - 1); // 1 → 0
    const o = 0.34 + 0.5 * fall * fall;
    // 扫光自上而下：按纹脊顶部 y 排布，0–800ms
    const delay = Math.round(
      Math.max(0, Math.min(1, (minY - 10) / 168)) * 800,
    );
    ridges.push({ d, o: +o.toFixed(2), delay });
  }
  return ridges;
}
const FP_RIDGES = fingerprintRidges();

export default function Boot({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("particles");
  const [exiting, setExiting] = useState<Phase | null>(null);
  const [exitingFading, setExitingFading] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // 跳过退出仪式：点跳过后整屏 600ms 溶解 + 轻微收拢进工作区，不再
  // 硬切到欢迎段闪一下。skippingRef 是 finish() 定时的依据。
  const [skipping, setSkipping] = useState(false);
  const skippingRef = useRef(false);
  const [sealGone, setSealGone] = useState(false);
  // 画布淡出（8.0s）：比铭文晚 1.5s——6.5–8.0s 是校徽散回星野的时间，
  // 散完画布才淡出，不要一边散一边被 CSS 盖掉。
  const [canvasGone, setCanvasGone] = useState(false);
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lit, setLit] = useState(false);
  // 视口尺寸：粒子段的铭文要落在成型校徽正下方，留白按校徽直径算。
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1440,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  }));
  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 常驻夜空画布（与粒子校徽画布分开）：开机全程的纯黑夜空底，不跟阶段走。
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);
  const phaseRef = useRef<Phase>("particles");
  const timersRef = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    // 开机结束交叉淡化交接：正常路径 300ms 淡出（--ease），onDone 在淡出
    // 中途（150ms）触发，App 随即挂载标题栏 + 三栏壳（300ms 淡入），Boot
    // 再留 150ms 才卸载——淡出与淡入重叠 150ms，不许硬切（见 App.tsx
    // 的 handleBootDone）。七步流程与每步时长一律不动。
    // 跳过路径：整屏 600ms 溶解（--ease-exp）+ 轻微收拢，onDone 放在
    // 450ms——App 在 600ms 时卸载 Boot，正好是溶解完成的一刻；主界面
    // 300ms 淡入与溶解最后 150ms 重叠，同样不许硬切。
    later(onDone, skippingRef.current ? 450 : 150);
  };

  /** 切到下一阶段：旧阶段留场淡出 600ms，新阶段 450ms 后淡入。 */
  const goTo = (next: Phase) => {
    const prev = phaseRef.current;
    if (prev === next) return;
    phaseRef.current = next;
    setExitingFading(false);
    setExiting(prev);
    setPhase(next);
    setSealGone(false);
    setCanvasGone(false);
    setConnected(false);
    setProgress(0);
    setLit(false);
    later(() => setExitingFading(true), 30);
    later(() => setExiting(null), STAGE_MS);
  };

  /** Esc / 跳过：退出仪式，不是硬切。
   * 旧路径是 goTo("welcome") + 900ms 后 finish：当前段的动画被半截掐断，
   * 欢迎段刚错峰入场就被打断、一闪而过，整个过程像硬切，很廉价。
   * 新路径不走欢迎段：点下即进退出仪式——按钮与日志先退场（250ms），
   * 整屏 600ms 溶解 + 轻微收拢（scale 0.99 / 上浮 6px），主界面在溶解
   * 末段交叉淡入。全程约 750ms，比旧路径（900+300ms）更快，也更克制。
   * 舞台内的入场动画不杀死、不掐断——它在溶解之下继续走完，没有跳变；
   * 七步正常流程与每步时长一字不动，只改跳过这条路径。 */
  const skip = () => {
    if (doneRef.current || skippingRef.current) return;
    // 减弱动效：直接结束，不要任何过渡动画。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    skippingRef.current = true;
    setSkipping(true);
    finish();
  };

  // 卸载时清掉所有待定计时器。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // Phase machine.
  useEffect(() => {
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      goTo("welcome");
      const t = window.setTimeout(finish, 900);
      return () => window.clearTimeout(t);
    }
    const timer = window.setTimeout(() => {
      // 跳过进行中：不再切下一阶段，等退出仪式走完、Boot 卸载。
      if (doneRef.current || skippingRef.current) return;
      const i = ORDER.indexOf(phaseRef.current);
      if (i >= ORDER.length - 1) {
        finish();
        return;
      }
      goTo(ORDER[i + 1]);
    }, PHASE_MS[phaseRef.current]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Boot log lines appear one by one.
  useEffect(() => {
    if (logCount >= LOG_LINES.length) return;
    const t = window.setTimeout(() => setLogCount((c) => c + 1), 420);
    return () => window.clearTimeout(t);
  }, [logCount]);

  // 粒子段：铭文 6500ms 淡出（600ms）；校徽 6.5–8.0s 散回星野，
  // 画布 8000ms 才淡出（600ms），8500ms 切认证门。
  useEffect(() => {
    if (phase !== "particles") return;
    const t1 = window.setTimeout(() => setSealGone(true), 6500);
    const t2 = window.setTimeout(() => setCanvasGone(true), 8000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [phase]);

  // 登录段：1800ms 后接入状态由“正在接入”变为“已连接”。
  useEffect(() => {
    if (phase !== "login") return;
    const t = window.setTimeout(() => setConnected(true), 1800);
    return () => window.clearTimeout(t);
  }, [phase]);

  // 核验环：0→100% 平滑填充 2000ms（easeOutCubic），进度数字与环同步；
  // 到 100% 的瞬间点亮 S（一次 0.3s 微光晕，不闪）。
  useEffect(() => {
    if (phase !== "verify") return;
    let raf = 0;
    const start = performance.now();
    const DURATION = 2000;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - k, 3);
      setProgress(Math.round(eased * 100));
      if (k >= 1) {
        setLit(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Esc / click "跳过" skips the ritual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 常驻纯黑夜空背景（独立于粒子校徽段）：开机七步全程都有的底。
  // 粒子段的画布只在 particles 阶段挂载，校徽一走背景就空了——这块
  // 画布从开机挂到结束，画纯黑底 + 清晰可见的星野散在夜空里，
  // 和粒子段的气质接得上。约 4500 颗星，亮度 0.30–0.95，闪烁 + 极慢漂移；
  // 只画背景，不碰校徽粒子。背景是纯黑 #000000，不要发蓝。
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const S = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let cssW = 0;
    let cssH = 0;
    // 柔光点精灵（和粒子段同款做法，drawImage 比逐点 arc 快得多）。
    const makeDot = () => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const g = c.getContext("2d");
      if (!g) return c;
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return c;
    };
    const dot = makeDot();
    type BgStar = { x: number; y: number; size: number; base: number; tw: number; drift: number };
    let stars: BgStar[] = [];
    const seed = () => {
      w = (canvas.width = Math.round(canvas.clientWidth * S));
      h = (canvas.height = Math.round(canvas.clientHeight * S));
      cssW = canvas.clientWidth;
      cssH = canvas.clientHeight;
      // 约 4500 颗星，夜空要一眼看清密密麻麻的星野，不能黑漆漆一片——
      // 之前 2500 颗、0.08–0.36 太暗太小，截图上几乎看不见。普通星
      // 0.8–2.0px、亮度 0.30–0.80，约 12% 是亮星（2.0–3.0px、0.75–0.95）。
      stars = Array.from({ length: 4500 }, () => {
        const hero = Math.random() < 0.12;
        return {
          x: Math.random() * cssW,
          y: Math.random() * cssH,
          size: (hero ? 2.0 + Math.random() * 1.0 : 0.8 + Math.random() * 1.2) * S,
          base: hero ? 0.75 + Math.random() * 0.2 : 0.3 + Math.random() * 0.5,
          tw: Math.random() * Math.PI * 2,
          drift: (Math.random() * 2 - 1) * 1.2,
        };
      });
    };
    seed();
    const onResize = () => seed();
    window.addEventListener("resize", onResize);
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      // 纯黑夜空（不要发蓝）。
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const st of stars) {
        const x = (st.x + st.drift * t + cssW) % cssW;
        const a = st.base * (0.7 + 0.3 * Math.sin(t * 0.7 + st.tw));
        if (a < 0.03) continue;
        const sz = st.size;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(dot, x * S - sz / 2, st.y * S - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Particle field: the seal IS the particles — a true 3D particle crest.
  // 参考视频（gemini3 全息粒子演示）式细腻星尘：30000 颗细小白色光点
  // 从纯黑夜空被引力牵引、沿同一方向的漩涡优雅流进来（远处先出发、
  // 近处后出发），ease-out 轻柔落位，拼成一个有厚度、有纵深的 3D
  // 粒子模型（不是平面拼图）；成型后 6.5–8.0s 再沿流入路径散回星野。
  // 校徽按真校徽照片采样布点（30000 颗，含 1px 晕染层：笔画是粗实
  // 的发光带，不是单像素细线——视频里的心形就是密不透风的光带）；
  // 每个粒子带 z 轴深度：前脸 / 后脸 / 侧壁三层构成 0.65R 厚的立体
  // 校徽；成型后绕 Y 轴缓慢摆动（±22°）+ 透视投影，厚度与视差一眼
  // 可见。背景是纯黑夜空 #000000 + 4500 颗清晰可见的星野（远近星点
  // 带视差漂移），不要发蓝。粒子要亮、要密、要看得清（尺寸 1.0–4.0、
  // base 0.65–1.0），边缘柔和衰减——细腻但不暗，不要粗大糊团、
  // 不要中心过曝成白团。
  // 全程只用白色粒子，照片校徽 <img> 已彻底去掉。
  useEffect(() => {
    if (phase !== "particles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const S = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = Math.round(canvas.clientWidth * S));
    const h = (canvas.height = Math.round(canvas.clientHeight * S));
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2 - 30 * S;
    const R = Math.min(cssW, cssH) * 0.21 * S; // 校徽半径（设备 px）
    const DEPTH = R * 0.65; // 校徽立体厚度（前脸到后脸）
    const FOCAL = Math.min(w, h) * 1.05; // 透视焦距：越短，纵深越夸张

    // ---- 柔光点精灵（预渲染，drawImage 比逐点 arc 快得多）----
    const makeDot = () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      if (!g) return c;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      // 亮核 + 柔晕：中心亮到 1.0（亮点），0.35 处 0.55、0.7 处 0.15
      // 拖出柔光晕——亮核比之前更实（0.25→0.35），每颗的发光面积更大，
      // 30000 颗叠起来才是密实的光带，不是稀疏的虚点；形状靠亮点堆叠
      // 发光（加色混合），不是靠中心光晕糊成一团。
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
      grad.addColorStop(0.7, "rgba(255,255,255,0.15)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return c;
    };
    const dot = makeDot();

    // ---- 背景：纯黑夜空 #000000，不要发蓝（用户明确要纯黑夜空 + 星空）。

    // ---- 背景星野：4500 颗细星，布在三维大空间里（z -1400..+250），
    // 远星小而暗、近星大而亮，随镜头缓慢视差漂移。夜空要一眼看清
    // 密密麻麻的星野——之前 3000 颗、0.08–0.38 太暗，截图上看不见。
    type Star = { x: number; y: number; z: number; size: number; base: number; tw: number };
    const stars: Star[] = Array.from({ length: 4500 }, () => {
      const hero = Math.random() < 0.12;
      return {
        x: (Math.random() * 2 - 1) * cssW * 0.55 * S,
        y: (Math.random() * 2 - 1) * cssH * 0.55 * S,
        z: -1400 * S + Math.random() * 1650 * S,
        size: (hero ? 2.0 + Math.random() * 1.0 : 0.8 + Math.random() * 1.2) * S,
        base: hero ? 0.75 + Math.random() * 0.2 : 0.3 + Math.random() * 0.5,
        tw: Math.random() * Math.PI * 2,
      };
    });

    // ---- 校徽布点：构建期由真校徽照片采样得到（sealTargets.ts），
    // x/y 已归一化到 [-1, 1]，直接按 R 缩放。运行时不再加载图片，
    // 没有竞态、没有兜底双环。----
    type Target = { x: number; y: number; z: number; lum: number };
    const N_CREST = 30000;
    const targets: Target[] = [];
    const buildTargets = () => {
      for (const sp of SEAL_TARGETS.slice(0, N_CREST)) {
        const x = sp.x * R;
        const y = sp.y * R;
        // 立体厚度：前脸 40% / 后脸 25% / 侧壁体 35%，亮处微微凸起。
        const roll = Math.random();
        let z: number;
        if (roll < 0.4) z = DEPTH / 2 + (Math.random() - 0.5) * 10 * S;
        else if (roll < 0.65) z = -DEPTH / 2 + (Math.random() - 0.5) * 10 * S;
        else z = (Math.random() * 2 - 1) * (DEPTH / 2);
        z += (sp.lum / 255) * 10 * S;
        targets.push({ x, y, z, lum: sp.lum });
      }
      if (targets.length < 1200) {
        // 兜底：双环 + 辐条（布点表万一为空也不空场）。
        targets.length = 0;
        for (let i = 0; i < N_CREST; i++) {
          const ring = Math.random();
          const a = Math.random() * Math.PI * 2;
          const rr =
            ring < 0.6 ? R : ring < 0.85 ? R * 0.72 : R * (0.2 + Math.random() * 0.4);
          const roll = Math.random();
          const z =
            roll < 0.45 ? DEPTH / 2 : roll < 0.7 ? -DEPTH / 2 : (Math.random() * 2 - 1) * (DEPTH / 2);
          targets.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.96, z, lum: 200 });
        }
      }
    };

    // ---- 粒子：从三维空间各处螺旋汇聚到目标点 ----
    type P = {
      tx: number; ty: number; tz: number;
      sx: number; sy: number; sz: number;
      swirl: number; delay: number; dur: number;
      size: number; base: number; tw: number; hero: boolean;
    };
    let parts: P[] = [];
    const initParticles = () => {
      parts = targets.map((tg) => {
        // 起点：校徽外围的球壳，半径 2.0R–4.6R，三维散开。
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(Math.random() * 2 - 1);
        const rr = R * (2.0 + Math.random() * 2.6);
        // 远处先出发、近处后出发（farK 0 近 → 1 远）：一波接一波地
        // 流进来，不是同时垮塌——汇聚过程本身是一场流动。
        const farK = (rr / R - 2.0) / 2.6;
        const sizeRoll = Math.random();
        const hero = sizeRoll > 0.97;
        return {
          tx: tg.x, ty: tg.y, tz: tg.z,
          sx: Math.sin(ph) * Math.cos(th) * rr,
          sy: Math.sin(ph) * Math.sin(th) * rr * 0.9,
          sz: Math.cos(ph) * rr * 0.85,
          // 同向漩涡：全部同一方向旋入 0.5–1.5 圈（有组织的涡流，
          // 像被引力牵引的星尘），不要随机正反乱转。
          swirl: (0.5 + Math.random() * 1.0) * Math.PI,
          delay: (1 - farK) * 1.1 + Math.random() * 0.6,
          // 更长的飞行时间 + ease-out 落位：越近越慢，轻柔落位不砸进去。
          dur: 2.2 + Math.random() * 1.0,
          // 星尘要亮、要密、要看得清（用户：成型后还是太淡，没有视频
          // 里那种密集感）：小 1.0–1.7、中 1.7–2.6、hero 2.6–4.0；
          // base 0.65–0.9、hero 1.0。中心光晕仍克制，不会过曝成白团
          // ——亮度靠粒子本身（20000 颗叠出来的实心光带），不靠糊光晕。
          size: (hero ? 2.6 + Math.random() * 1.4 : sizeRoll > 0.8 ? 1.7 + Math.random() * 0.9 : 1.0 + Math.random() * 0.7) * S,
          base: hero ? 1.0 : 0.65 + Math.random() * 0.25,
          tw: Math.random() * Math.PI * 2,
          hero,
        };
      });
    };

    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
    const smooth = (a: number, b: number, x: number) => {
      const k = clamp01((x - a) / (b - a));
      return k * k * (3 - 2 * k);
    };

    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const fadeIn = Math.min(1, t / 0.5);
      // 成型度：0 = 还在汇聚，1 = 校徽已成型；旋转只在成型后介入。
      const formed = smooth(4.6, 5.8, t);
      // 散开度：6.5–8.0s 校徽沿流入路径散回星野（视频里的“散回去”），
      // 散开时旋转归零、光晕熄灭；8.0s 画布才淡出。
      const disp = smooth(6.5, 8.0, t);
      const rotY = 0.38 * Math.sin(t * 0.5) * formed * (1 - disp); // ±22°，约 12.5s 一摆
      const rotX = 0.12 * Math.sin(t * 0.4 + 1.3) * formed * (1 - disp);
      const camY = 0.04 * Math.sin(t * 0.12); // 镜头微漂移，始终有
      const formK = smooth(2.2, 4.8, t); // 整体成型进度（核心光晕用）
      const pulse = Math.exp(-Math.pow((t - 4.8) / 0.4, 2)); // 锁定时一闪

      // 背景：深空（source-over），其余全部加色混合（lighter，发光感）。
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // 核心光晕：随成型变亮，锁定时一闪，之后柔和呼吸。
      const glowR = R * 1.6;
      // 光晕克制：底亮 0.025、锁定时一闪也只到 0.06——不要中心过曝成白团。
      // 第二档用纯白，不要发蓝（190,215,255）。
      const glowA = (0.025 + 0.02 * formK + 0.06 * pulse) * (1 - disp);
      const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      gg.addColorStop(0, `rgba(255,255,255,${glowA.toFixed(3)})`);
      gg.addColorStop(0.5, `rgba(255,255,255,${((0.012 + 0.012 * formK) * (1 - disp)).toFixed(3)})`);
      gg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      // 背景星野（远 → 近，带镜头视差）。
      const cY = Math.cos(camY);
      const sY = Math.sin(camY);
      for (const st of stars) {
        const x2 = st.x * cY + st.z * sY;
        const z2 = -st.x * sY + st.z * cY;
        const sc2 = FOCAL / (FOCAL - z2);
        const twk = 0.75 + 0.25 * Math.sin(t * 0.9 + st.tw);
        const a = st.base * Math.pow(sc2, 1.5) * twk * fadeIn;
        if (a < 0.02) continue;
        const sz = Math.max(0.6, st.size * sc2);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(dot, cx + x2 * sc2 - sz / 2, cy + st.y * sc2 - sz / 2, sz, sz);
      }

      // 校徽粒子。
      const cRy = Math.cos(rotY + camY);
      const sRy = Math.sin(rotY + camY);
      const cRx = Math.cos(rotX);
      const sRx = Math.sin(rotX);
      for (const p of parts) {
        const e = easeOutCubic(clamp01((t - p.delay) / p.dur));
        // 散开时 e2 从 e 退回 0：粒子沿流入路径反向飞回起点（球壳星野），
        // 旋角也随之回到满幅——像退潮一样优雅散开，不是原地消失。
        const e2 = e * (1 - disp);
        // 起点 → 目标插值。
        let x = p.sx + (p.tx - p.sx) * e2;
        let y = p.sy + (p.ty - p.sy) * e2;
        let z = p.sz + (p.tz - p.sz) * e2;
        // 汇聚时绕 Y 轴旋入（漩涡感），到位后旋角归零；散开时旋角回来。
        const sw = p.swirl * (1 - e2);
        const cSw = Math.cos(sw);
        const sSw = Math.sin(sw);
        const x1 = x * cSw + z * sSw;
        const z1 = -x * sSw + z * cSw;
        x = x1;
        z = z1;
        // 模型旋转（成型后）+ 镜头漂移。
        const x2 = x * cRy + z * sRy;
        const z2 = -x * sRy + z * cRy;
        const y2 = y * cRx - z2 * sRx;
        const z3 = y * sRx + z2 * cRx;
        // 成型后轻微呼吸。
        const br = 1 + 0.004 * Math.sin(t * 0.9 + p.tw) * formed;
        // 透视：近大亮、远小暗——这是纵深最强的线索。
        const sc = FOCAL / (FOCAL - z3);
        const px = cx + x2 * sc * br;
        const py = cy + y2 * sc * br;
        if (px < -40 || px > w + 40 || py < -40 || py > h + 40) continue;
        const twk = 1 - 0.12 * formed * (0.5 + 0.5 * Math.sin(t * 2.2 + p.tw * 3));
        // 透视增益压到 1.15：近处粒子不再爆亮，纵深靠大小与位置，不靠亮度炸。
        const a = p.base * Math.pow(sc, 1.15) * fadeIn * (0.55 + 0.45 * e2) * twk;
        if (a < 0.02) continue;
        const sz = Math.max(0.7, p.size * sc);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(dot, px - sz / 2, py - sz / 2, sz, sz);
        // 最亮的 3% 再叠一层小光晕（bloom，克制：小一圈、更暗）。
        if (p.hero && e2 > 0.6) {
          const hs = sz * 3;
          ctx.globalAlpha = Math.min(0.07, a * 0.07);
          ctx.drawImage(dot, px - hs / 2, py - hs / 2, hs, hs);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };

    // 布点是构建期预计算的，同步就绪：直接建粒子、开画，没有异步等图。
    buildTargets();
    initParticles();
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [phase]);

  // ---- 开机全程纯黑夜空（只改 Boot.tsx，不动 App.css）----
  // 之前按主题走：粒子段是 #02070d 深空，切到认证门后浅色主题下
  // 变成 var(--bg) 纯白——深空切纯白，背景 600ms 翻白、旧段白字
  // 在白底上迅速失对比，中间近半秒只剩空荡白屏，看着像硬切。
  // 用户还要纯黑夜空、不要发蓝：现在开机就是一场黑色仪式，七步
  // 全程 #000000 纯黑底、白字，不跟随应用主题切白；常驻星野画布
  // （见上）让纯黑夜空从头到尾都在，不只校徽段有。--boot-bg 恒定，
  // 根节点也不再有背景色过渡。
  const bootVars = {
    "--boot-bg": "#000000",
    "--boot-fg": "#f5f5f5",
    "--boot-white": "#ffffff",
  } as React.CSSProperties;

  const stageIn = (delayMs: number): React.CSSProperties => ({
    animation: `boot-stage-in 600ms var(--ease-exp) ${delayMs}ms both`,
  });

  const renderStage = (p: Phase) => {
    switch (p) {
      case "particles": {
        // 成型校徽直径（CSS px）：铭文留白按它算，落在校徽正下方。
        const crestD = Math.round(Math.min(viewport.w, viewport.h) * 0.42);
        return (
          <>
            {/* 全屏深空画布：校徽就是粒子本身，没有照片 <img>。 */}
            <canvas
              ref={canvasRef}
              className="boot-canvas"
              style={{
                width: "100vw",
                height: "100vh",
                maxWidth: "none",
                maxHeight: "none",
                opacity: canvasGone ? 0 : 1,
                transition: "opacity 600ms var(--ease-exp)",
              }}
            />
            {/* 占位：把铭文顶到成型校徽下方，不与粒子重叠。 */}
            <div aria-hidden="true" style={{ height: crestD + 16 }} />
            <div
              className="boot-motto"
              style={{
                opacity: sealGone ? 0 : 1,
                transition: "opacity 600ms var(--ease-exp)",
              }}
            >
              {MOTTO_LINES.map((line, i) => (
                <div
                  key={line}
                  style={{
                    animation:
                      "boot-motto-line 600ms var(--ease-exp) both",
                    animationDelay: `${100 + i * 250}ms`,
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          </>
        );
      }
      case "gate":
        return (
          <>
            <div
              style={{
                border: "1px solid color-mix(in srgb, var(--boot-white) 35%, transparent)",
                borderRadius: 12,
                padding: "32px 48px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div className="boot-caption">身份认证门</div>
              <div
                style={{
                  width: 44,
                  height: 1,
                  background:
                    "color-mix(in srgb, var(--boot-white) 35%, transparent)",
                }}
              />
              <div className="boot-sub">IDENTITY GATE</div>
            </div>
            <div className="boot-sub">CASSELL COLLEGE</div>
          </>
        );
      case "finger":
        return (
          <>
            {/* 指纹：程序化生成的涡纹（22 条平滑纹脊，见 FP_RIDGES），
             * 不是同心圆简笔画，也不是一团乱线。扫光带自上而下扫过，
             * 纹脊随扫光逐亮；柔光晕 + 圆边收光，给高端生物识别仪的质感。 */}
            <div
              className="finger-wrap"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--boot-white) 22%, transparent)",
                boxShadow:
                  "0 0 60px rgba(255,255,255,0.06), inset 0 0 40px rgba(255,255,255,0.04)",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  width: 220,
                  height: 220,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 55%, transparent 70%)",
                }}
              />
              <svg
                width="180"
                height="180"
                viewBox="0 0 180 180"
                fill="none"
                style={{ position: "relative" }}
              >
                <defs>
                  <clipPath id="fp-clip">
                    <ellipse cx="90" cy="94" rx="80" ry="82" />
                  </clipPath>
                </defs>
                <g clipPath="url(#fp-clip)">
                  {FP_RIDGES.map((r, i) => (
                    <g key={i} opacity={r.o}>
                      <path
                        d={r.d}
                        stroke="rgba(255,255,255,0.9)"
                        strokeWidth="1.1"
                        fill="none"
                        strokeLinecap="round"
                        style={{
                          animation: "boot-fp-in 500ms var(--ease) both",
                          animationDelay: `${r.delay}ms`,
                        }}
                      />
                    </g>
                  ))}
                </g>
              </svg>
              {/* 扫光带：26px 柔光带 + 淡光晕，自上而下 1.2s 匀速来回
               *（峰值 0.55，不是一道硬白尺子） */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "6%",
                  right: "6%",
                  height: 26,
                  background:
                    "linear-gradient(to bottom, transparent, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.06) 60%, transparent)",
                  filter: "drop-shadow(0 0 10px rgba(255,255,255,0.22))",
                  animation: "boot-fp-scan 1.2s linear infinite alternate",
                  pointerEvents: "none",
                }}
              />
            </div>
            <div className="boot-caption">身份验证</div>
            <div className="boot-sub">IDENTITY VERIFICATION</div>
            <div className="boot-progress">
              <div className="boot-progress-fill" />
            </div>
          </>
        );
      case "login":
        return (
          <>
            <div
              style={{
                width: "min(340px, 84vw)",
                border: "1px solid color-mix(in srgb, var(--boot-white) 35%, transparent)",
                borderRadius: 16,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.08em" }}>
                校园网登录
              </div>
              <LoginRow label="专员姓名" value="路明非" delay={0} />
              <LoginRow label="专员编号" value="S2017-0117" mono delay={90} />
              <LoginRow label="密码" value="••••••••" mono delay={180} />
              <div
                style={{
                  height: 1,
                  background:
                    "color-mix(in srgb, var(--boot-white) 20%, transparent)",
                  margin: "4px 0",
                }}
              />
              <LoginRow label="网络" value="CASSELL-LAN" mono delay={270} />
              <LoginRow label="信号" value="强" delay={360} />
              <LoginRow label="IP 地址" value="10.24.7.117" mono delay={450} />
              <LoginRow label="延迟" value="18ms" mono delay={540} />
            </div>
            <div
              className="boot-sub"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "opacity 300ms var(--ease)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: connected ? "var(--forest)" : "var(--boot-white)",
                  opacity: connected ? 1 : 0.5,
                  transition: "background-color 300ms var(--ease), opacity 300ms var(--ease)",
                }}
              />
              {connected ? "已连接 · 学院网络" : "正在接入学院网络 …"}
            </div>
          </>
        );
      case "verify": {
        const R = 84;
        const C = 2 * Math.PI * R;
        const headA = (-90 + progress * 3.6) * (Math.PI / 180);
        const hx = 110 + R * Math.cos(headA);
        const hy = 110 + R * Math.sin(headA);
        const TICKS = 72;
        return (
          <>
            {/* 权限核验环：仪表式——外框细环 + 72 刻度随进度逐亮 + 渐变主弧 +
             * 辉光底层 + 弧头彗星 + 完成脉冲 + 中央 S 优雅点亮。不是一根细线转圈。 */}
            <div style={{ position: "relative", width: 220, height: 220 }}>
              <svg width="220" height="220" viewBox="0 0 220 220" fill="none">
                <defs>
                  <radialGradient id="boot-verify-halo">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
                    <stop offset="55%" stopColor="#ffffff" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient
                    id="boot-verify-arc"
                    x1="110"
                    y1="14"
                    x2="110"
                    y2="206"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0.7" />
                  </linearGradient>
                </defs>
                <circle cx="110" cy="110" r="108" fill="url(#boot-verify-halo)" />
                <circle
                  cx="110"
                  cy="110"
                  r="104"
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="1"
                />
                {Array.from({ length: TICKS }, (_, i) => {
                  const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
                  const on = (i / TICKS) * 100 <= progress;
                  const x1 = 110 + 96 * Math.cos(a);
                  const y1 = 110 + 96 * Math.sin(a);
                  const x2 = 110 + 101.5 * Math.cos(a);
                  const y2 = 110 + 101.5 * Math.sin(a);
                  return (
                    <line
                      key={i}
                      x1={x1.toFixed(1)}
                      y1={y1.toFixed(1)}
                      x2={x2.toFixed(1)}
                      y2={y2.toFixed(1)}
                      stroke="#ffffff"
                      strokeOpacity={on ? 0.85 : 0.13}
                      strokeWidth={i % 6 === 0 ? 1.6 : 1}
                      strokeLinecap="round"
                    />
                  );
                })}
                <circle
                  cx="110"
                  cy="110"
                  r="70"
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="1"
                />
                <circle
                  cx="110"
                  cy="110"
                  r={R}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="2.5"
                />
                <circle
                  cx="110"
                  cy="110"
                  r={R}
                  stroke="#ffffff"
                  strokeOpacity={0.07}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - progress / 100)}
                  transform="rotate(-90 110 110)"
                  fill="none"
                />
                <circle
                  cx="110"
                  cy="110"
                  r={R}
                  stroke="url(#boot-verify-arc)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - progress / 100)}
                  transform="rotate(-90 110 110)"
                  fill="none"
                />
                {progress > 0 && progress < 100 && (
                  <g>
                    <circle cx={hx} cy={hy} r="10" fill="#ffffff" opacity="0.08" />
                    <circle cx={hx} cy={hy} r="4.5" fill="#ffffff" opacity="0.25" />
                    <circle cx={hx} cy={hy} r="2.2" fill="#ffffff" />
                  </g>
                )}
                {lit && (
                  <circle
                    cx="110"
                    cy="110"
                    r={R}
                    stroke="#ffffff"
                    strokeWidth="2"
                    fill="none"
                    style={{ animation: "boot-ring-done 900ms var(--ease) both" }}
                  />
                )}
              </svg>
              {/* S 印章：大号优雅衬线 S，点亮时缩放浮现 + 微光晕 */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  className="grade-s"
                  style={{
                    opacity: lit ? 1 : 0.3,
                    transition: "opacity 400ms var(--ease)",
                    animation: lit
                      ? "boot-s-lit 400ms var(--ease) both, boot-s-in 500ms var(--ease-exp) both"
                      : undefined,
                  }}
                >
                  S
                </span>
              </div>
            </div>
            {/* 进度数字：等宽字体，与环的填充同步 */}
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 13,
                fontVariantNumeric: "tabular-nums",
                color: "color-mix(in srgb, var(--boot-white) 90%, transparent)",
              }}
            >
              {String(progress).padStart(3, "0")}%
            </div>
            <div className="boot-caption">权限核验</div>
            <div className="boot-sub">PERMISSION VERIFICATION</div>
          </>
        );
      }
      case "granted":
        return (
          <>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "0.4em",
                textIndent: "0.4em",
              }}
            >
              ACCESS GRANTED
            </div>
            <div
              style={{
                width: 44,
                height: 1,
                background:
                  "color-mix(in srgb, var(--boot-white) 35%, transparent)",
              }}
            />
            <div className="boot-sub">权限已下发 · PERMISSION ISSUED</div>
          </>
        );
      case "welcome":
        return (
          <>
            {/* 球 + 柔光晕：欢迎段的视觉锚点，和粒子段的纯黑夜空气质接得上。 */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "boot-stage-in 550ms var(--ease-exp) both",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  width: 220,
                  height: 220,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 55%, transparent 70%)",
                  animation: "boot-welcome-halo 3.4s ease-in-out infinite",
                }}
              />
              {/* 欢迎浮动：球轻轻上下浮 + 微微呼吸缩放，和光晕同周期，
               * 像刚醒来在跟路专员打招呼，不是静止贴纸。只动这个 wrapper，
               * Mark 本体的呼吸/眨眼/表情引擎一概不动。 */}
              <div style={{ animation: "boot-welcome-float 3.4s ease-in-out infinite" }}>
                <Mark size={84} eva={false} state="done" />
              </div>
            </div>
            <div
              className="boot-welcome"
              style={{
                letterSpacing: "-0.02em",
                animation: "boot-stage-in 550ms var(--ease-exp) 100ms both",
              }}
            >
              欢迎你，路专员
            </div>
            <div
              className="boot-sub"
              style={{
                letterSpacing: "0.30em",
                // .boot-sub 在 App.css 里只有 45% 白，太暗：行内提到 62%。
                color: "color-mix(in srgb, var(--boot-white) 62%, transparent)",
                animation: "boot-stage-in 550ms var(--ease-exp) 200ms both",
              }}
            >
              WELCOME TO CASSELL COLLEGE
            </div>
            {/* 发丝分隔线：不用边框卡片，间距 + 细线 + 字阶分层。 */}
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 1,
                background:
                  "color-mix(in srgb, var(--boot-white) 35%, transparent)",
                animation: "boot-stage-in 550ms var(--ease-exp) 300ms both",
              }}
            />
            {/* 身份行：名字 + S 印章（衬线 S + 1px 发丝圆环），不要“血统”文字。 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                animation: "boot-stage-in 550ms var(--ease-exp) 380ms both",
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "0.04em" }}>
                路明非
              </span>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  border:
                    "1px solid color-mix(in srgb, var(--boot-white) 55%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                S
              </span>
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "color-mix(in srgb, var(--boot-white) 70%, transparent)",
                animation: "boot-stage-in 550ms var(--ease-exp) 460ms both",
              }}
            >
              S2017-0117
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--forest)",
                }}
              />
              已连接
            </div>
          </>
        );
    }
  };

  return (
    <div
      className={`boot ${leaving ? "boot-leaving" : ""} ${skipping ? "boot-skipping" : ""}`}
      role="dialog"
      aria-label="启动"
      style={{
        ...bootVars,
        // 背景恒定纯黑，不再有背景色过渡；只剩淡出。
        // 正常结束：300ms 淡出。跳过：600ms 溶解 + 轻微收拢（见下 .boot-skipping 规则）。
        transition: leaving
          ? skipping
            ? "opacity 600ms var(--ease-exp), transform 600ms var(--ease-exp)"
            : "opacity 300ms var(--ease)"
          : undefined,
        // 淡出期间不再挡输入：标题栏已在 Boot 之下淡入，空白处可拖、按钮可点。
        // 跳过开始即不再挡输入：按钮已退场，重复点击由 skip() 的守卫挡住。
        pointerEvents: leaving || skipping ? "none" : undefined,
      }}
    >
      {/* Boot 局部关键帧（只改 Boot.tsx：不写进 App.css） */}
      <style>{`
        @keyframes boot-motto-line { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes boot-s-lit {
          from { text-shadow: 0 0 0 color-mix(in srgb, var(--boot-white) 0%, transparent); }
          to { text-shadow: 0 0 18px color-mix(in srgb, var(--boot-white) 45%, transparent); }
        }
        @keyframes boot-fp-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes boot-fp-scan { from { top: 2%; } to { top: calc(98% - 26px); } }
        @keyframes boot-welcome-float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.012); } }
        @keyframes boot-welcome-halo { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.07); } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes boot-welcome-float { from { transform: none; } to { transform: none; } }
          @keyframes boot-welcome-halo { from { opacity: 0.8; transform: none; } to { opacity: 0.8; transform: none; } }
        }
        @keyframes boot-ring-done { 0% { opacity: 0; } 30% { opacity: 0.55; } 100% { opacity: 0; } }
        @keyframes boot-s-in { from { transform: scale(0.88); } to { transform: scale(1); } }
        /* 跳过退出仪式：铬件（按钮、日志）先退场 250ms；整屏溶解时轻微收拢，
           像场景向后退一步再化开——克制的退出，不是“啪一下没了”。
           溶解 600ms + onDone 在 450ms：主界面淡入与溶解末段重叠 150ms，
           Boot 在溶解完成一刻卸载，不截断、不闪白。 */
        .boot-skipping .boot-log,
        .boot-skipping .boot-skip {
          opacity: 0;
          transition: opacity 250ms var(--ease);
        }
        .boot-skipping.boot-leaving {
          transform: scale(0.99) translateY(-6px);
        }
      `}</style>

      {/* 常驻纯黑夜空（开机全程的底，z-index 0；各段内容在其上） */}
      <canvas
        ref={bgCanvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      />

      <button
        className="boot-skip"
        onClick={skip}
        type="button"
        aria-label="跳过启动动画（Esc）"
      >
        <span className="boot-skip-label">跳过</span>
        <span aria-hidden="true" className="boot-skip-esc">
          ESC
        </span>
      </button>

      {exiting !== null && (
        <div
          className="boot-stage"
          style={{
            animation: "none",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            opacity: exitingFading ? 0 : 1,
            transition: "opacity 600ms var(--ease-exp)",
          }}
          aria-hidden="true"
        >
          {renderStage(exiting)}
        </div>
      )}

      <div className="boot-stage" style={stageIn(exiting !== null ? STAGE_ENTER_DELAY_MS : 0)}>
        {renderStage(phase)}
      </div>

      <div className="boot-log" aria-hidden="true">
        {LOG_LINES.slice(0, logCount).map((l) => (
          <div key={l} className="boot-log-line">
            {l}
          </div>
        ))}
        <span className="boot-caret">▍</span>
      </div>
    </div>
  );
}

function LoginRow({
  label,
  value,
  mono = false,
  delay = 0,
}: {
  label: string;
  value: string;
  mono?: boolean;
  delay?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        animation: "boot-stage-in 500ms var(--ease-exp) both",
        animationDelay: `${delay}ms`,
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "color-mix(in srgb, var(--boot-white) 45%, transparent)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontFamily: mono ? "var(--mono)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
