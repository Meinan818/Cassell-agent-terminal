import { useEffect, useRef, useState } from "react";
import Mark from "./Mark";
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

/** 交叉淡化：淡出 600ms，淡入延迟 450ms 起、600ms，二者重叠 150ms。 */
const STAGE_MS = 600;
const STAGE_ENTER_DELAY_MS = 450;

/** 铭文三行（拉丁铭文，衬线体逐行淡入）。 */
const MOTTO_LINES = [
  "BONUM CERTAMEN CERTAVI",
  "CURSUM CONSUMMAVI",
  "FIDEM SERVAVI",
];

export default function Boot({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("particles");
  const [exiting, setExiting] = useState<Phase | null>(null);
  const [exitingFading, setExitingFading] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [sealGone, setSealGone] = useState(false);
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lit, setLit] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark",
  );
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
    // 开机结束 300ms 交叉淡化交接（--ease）：onDone 在淡出中途（150ms）
    // 就触发，App 随即挂载标题栏 + 三栏壳（300ms 淡入），Boot 再留
    // 150ms 才卸载——淡出与淡入重叠 150ms，不许硬切（见 App.tsx 的
    // handleBootDone）。七步流程与每步时长一律不动。
    later(onDone, 150);
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
    setConnected(false);
    setProgress(0);
    setLit(false);
    later(() => setExitingFading(true), 30);
    later(() => setExiting(null), STAGE_MS);
  };

  /** Esc / 跳过：直接进欢迎段，900ms 后结束；已在欢迎段则直接结束。 */
  const skip = () => {
    if (doneRef.current) return;
    if (phaseRef.current === "welcome") {
      finish();
      return;
    }
    goTo("welcome");
    later(finish, 900);
  };

  // 卸载时清掉所有待定计时器。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // 主题跟随：读 html[data-theme]（index.html 内联脚本 + App.tsx 首帧已写好），
  // MutationObserver + theme-switched 事件双通道跟随，亮暗切换时开机同步变。
  useEffect(() => {
    const read = () =>
      setTheme(
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      );
    read();
    const ob = new MutationObserver(read);
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("theme-switched", read);
    return () => {
      ob.disconnect();
      window.removeEventListener("theme-switched", read);
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

  // 粒子段：校徽 6500ms 淡出（600ms），8500ms 才切认证门。
  useEffect(() => {
    if (phase !== "particles") return;
    const t = window.setTimeout(() => setSealGone(true), 6500);
    return () => window.clearTimeout(t);
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

  // Particle field: the seal IS the particles — a true 3D particle crest.
  // GPT-6 Astra 式：数千白色光点从深空汇聚成一个有厚度、有纵深的
  // 3D 粒子模型（不是平面粒子拼图）。校徽按真校徽照片采样布点；
  // 每个粒子带 z 轴深度：前脸 / 后脸 / 侧壁三层构成 0.55R 厚的
  // 立体校徽；成型后绕 Y 轴缓慢摆动（±17°）+ 透视投影，厚度与
  // 视差一眼可见；背景是深空星野（远近星点带视差漂移）。全程只用
  // 白色粒子，照片校徽 <img> 已彻底去掉。
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
    const DEPTH = R * 0.55; // 校徽立体厚度（前脸到后脸）
    const FOCAL = Math.min(w, h) * 1.05; // 透视焦距：越短，纵深越夸张

    // ---- 柔光点精灵（预渲染，drawImage 比逐点 arc 快得多）----
    const makeDot = () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      if (!g) return c;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.18, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.4, "rgba(255,255,255,0.28)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return c;
    };
    const dot = makeDot();

    // ---- 深空背景（一次建好，每帧复用）----
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
    bgGrad.addColorStop(0, "#0a1826");
    bgGrad.addColorStop(0.55, "#050d18");
    bgGrad.addColorStop(1, "#02070d");

    // ---- 背景星野：450 颗星，布在三维大空间里（z -1400..+250），
    // 远星小而暗、近星大而亮，随镜头缓慢视差漂移。----
    type Star = { x: number; y: number; z: number; size: number; base: number; tw: number };
    const stars: Star[] = Array.from({ length: 450 }, () => ({
      x: (Math.random() * 2 - 1) * cssW * 0.55 * S,
      y: (Math.random() * 2 - 1) * cssH * 0.55 * S,
      z: -1400 * S + Math.random() * 1650 * S,
      size: (0.5 + Math.random() * 1.1) * S,
      base: 0.1 + Math.random() * 0.38,
      tw: Math.random() * Math.PI * 2,
    }));

    // ---- 校徽采样：亮像素 = 校徽，暗像素 = 背景 ----
    type Target = { x: number; y: number; z: number; lum: number };
    const N_CREST = 7500;
    const targets: Target[] = [];
    const buildTargets = (img: HTMLImageElement | null) => {
      if (img) {
        const sw = 300;
        const sh = Math.max(1, Math.round((300 * img.naturalHeight) / img.naturalWidth));
        const off = document.createElement("canvas");
        off.width = sw;
        off.height = sh;
        const octx = off.getContext("2d");
        if (octx) {
          octx.drawImage(img, 0, 0, sw, sh);
          const data = octx.getImageData(0, 0, sw, sh).data;
          const lumAt = (x: number, y: number) => {
            const i = (y * sw + x) * 4;
            return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          };
          const scale = (2 * R) / Math.max(sw, sh);
          let guard = 0;
          while (targets.length < N_CREST && guard++ < N_CREST * 60) {
            const sx = (Math.random() * sw) | 0;
            const sy = (Math.random() * sh) | 0;
            const lum = lumAt(sx, sy);
            if (lum < 55) continue;
            if (Math.random() > (lum - 55) / 200 + 0.15) continue;
            const x = (sx - sw / 2) * scale;
            const y = (sy - sh / 2) * scale;
            // 立体厚度：前脸 40% / 后脸 25% / 侧壁体 35%，亮处微微凸起。
            const roll = Math.random();
            let z: number;
            if (roll < 0.4) z = DEPTH / 2 + (Math.random() - 0.5) * 10 * S;
            else if (roll < 0.65) z = -DEPTH / 2 + (Math.random() - 0.5) * 10 * S;
            else z = (Math.random() * 2 - 1) * (DEPTH / 2);
            z += (lum / 255) * 10 * S;
            targets.push({ x, y, z, lum });
          }
        }
      }
      if (targets.length < 1200) {
        // 兜底：双环 + 辐条（图片万一读不到也不空场）。
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
        // 起点：以校徽为中心的球状星云，半径 1.4R–3.8R，三维散开。
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(Math.random() * 2 - 1);
        const rr = R * (1.4 + Math.random() * 2.4);
        const sizeRoll = Math.random();
        const hero = sizeRoll > 0.95;
        return {
          tx: tg.x, ty: tg.y, tz: tg.z,
          sx: Math.sin(ph) * Math.cos(th) * rr,
          sy: Math.sin(ph) * Math.sin(th) * rr * 0.9,
          sz: Math.cos(ph) * rr * 0.9,
          swirl: (Math.random() * 2 - 1) * Math.PI * 1.2,
          delay: Math.random() * 2.2,
          dur: 1.6 + Math.random() * 1.0,
          size: (hero ? 5.5 + Math.random() * 4.5 : sizeRoll > 0.8 ? 3.2 + Math.random() * 2.3 : 1.8 + Math.random() * 1.4) * S,
          base: hero ? 0.95 : 0.4 + Math.random() * 0.5,
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
      const rotY = 0.3 * Math.sin(t * 0.45) * formed; // ±17°，约 14s 一摆
      const rotX = 0.1 * Math.sin(t * 0.36 + 1.3) * formed;
      const camY = 0.04 * Math.sin(t * 0.12); // 镜头微漂移，始终有
      const formK = smooth(2.2, 4.8, t); // 整体成型进度（核心光晕用）
      const pulse = Math.exp(-Math.pow((t - 4.8) / 0.4, 2)); // 锁定时一闪

      // 背景：深空（source-over），其余全部加色混合（lighter，发光感）。
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // 核心光晕：随成型变亮，锁定时一闪，之后柔和呼吸。
      const glowR = R * 1.6;
      const glowA = 0.1 + 0.08 * formK + 0.22 * pulse;
      const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      gg.addColorStop(0, `rgba(255,255,255,${glowA.toFixed(3)})`);
      gg.addColorStop(0.5, `rgba(190,215,255,${(0.05 + 0.04 * formK).toFixed(3)})`);
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
        // 起点 → 目标插值。
        let x = p.sx + (p.tx - p.sx) * e;
        let y = p.sy + (p.ty - p.sy) * e;
        let z = p.sz + (p.tz - p.sz) * e;
        // 汇聚时绕 Y 轴旋入（漩涡感），到位后旋角归零。
        const sw = p.swirl * (1 - e);
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
        const twk = 1 - 0.22 * formed * (0.5 + 0.5 * Math.sin(t * 2.2 + p.tw * 3));
        const a = p.base * Math.pow(sc, 1.6) * fadeIn * (0.55 + 0.45 * e) * twk;
        if (a < 0.02) continue;
        const sz = Math.max(0.7, p.size * sc);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(dot, px - sz / 2, py - sz / 2, sz, sz);
        // 最亮的 5% 再叠一层大光晕（bloom）。
        if (p.hero && e > 0.6) {
          const hs = sz * 4;
          ctx.globalAlpha = Math.min(0.22, a * 0.22);
          ctx.drawImage(dot, px - hs / 2, py - hs / 2, hs, hs);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };

    // 校徽图是本地 56KB，正常几十毫秒就绪；600ms 还没好就用兜底先播，
    // 绝不等图。开始画的那一刻才是汇聚时钟的 t=0。
    let started = false;
    const begin = (img: HTMLImageElement | null) => {
      if (started) return;
      started = true;
      buildTargets(img);
      initParticles();
      raf = requestAnimationFrame(draw);
    };
    const img = new Image();
    img.onload = () => begin(img);
    img.onerror = () => begin(null);
    img.src = "/cassell-seal.jpg";
    const fallbackTimer = window.setTimeout(() => begin(null), 600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallbackTimer);
    };
  }, [phase]);

  // ---- 主题跟随（只改 Boot.tsx，不动 App.css）----
  // --boot-* 两套同值、固定深色；这里在 Boot 根节点上按当前主题重定义：
  // 亮色用 --bg 浅色仪式底 + --text 深色字；深色沿用固定深色值。
  // 这样铭文、S 印章、细线等所有走 --boot-white 的元素都随主题走，
  // 浅色底上不再出现看不清的浅字。
  // 例外：粒子段是深空宇宙（只用白色粒子），强制深色底，不跟浅色走；
  // 切到认证门时根背景 600ms 淡回主题色（见根节点 transition）。
  const bootVars = {
    "--boot-bg":
      phase === "particles" ? "#02070d" : theme === "light" ? "var(--bg)" : "#0b0b0c",
    "--boot-fg":
      phase === "particles" ? "#f5f5f5" : theme === "light" ? "var(--text)" : "#f5f5f5",
    "--boot-white":
      phase === "particles" ? "#ffffff" : theme === "light" ? "var(--text)" : "#ffffff",
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
                opacity: sealGone ? 0 : 1,
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
            <div className="finger-wrap">
              <svg width="180" height="180" viewBox="0 0 180 180" fill="none">
                {/* 同心断弧：全部 1px 发丝线，断弧错开排布 */}
                <circle cx="90" cy="90" r="86" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
                <circle cx="90" cy="90" r="72" stroke="rgba(255,255,255,0.7)" strokeWidth="1" strokeDasharray="300 60" strokeLinecap="round" transform="rotate(24 90 90)" />
                <circle cx="90" cy="90" r="56" stroke="rgba(255,255,255,0.85)" strokeWidth="1" strokeDasharray="200 70" strokeLinecap="round" transform="rotate(-48 90 90)" />
                <circle cx="90" cy="90" r="40" stroke="rgba(255,255,255,0.9)" strokeWidth="1" strokeDasharray="120 60" strokeLinecap="round" transform="rotate(96 90 90)" />
                <circle cx="90" cy="90" r="24" stroke="rgba(255,255,255,0.9)" strokeWidth="1" strokeDasharray="70 40" strokeLinecap="round" transform="rotate(-132 90 90)" />
                <path d="M90 66 C 84 78, 84 102, 90 114 M90 66 C 96 78, 96 102, 90 114" stroke="rgba(255,255,255,0.8)" strokeWidth="1" strokeLinecap="round" />
              </svg>
              {/* 扫光：从上到下 1.2s 匀速（linear，来回各 1.2s） */}
              <div
                className="scanline"
                style={{ animation: "boot-scan-linear 1.2s linear infinite alternate" }}
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
        return (
          <>
            <div style={{ position: "relative", width: 200, height: 200 }}>
              <svg width="200" height="200" viewBox="0 0 200 200" fill="none">
                <circle
                  cx="100"
                  cy="100"
                  r={R}
                  stroke="color-mix(in srgb, var(--boot-white) 14%, transparent)"
                  strokeWidth="1.5"
                />
                <circle
                  cx="100"
                  cy="100"
                  r={R}
                  stroke="var(--boot-white)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - progress / 100)}
                  transform="rotate(-90 100 100)"
                />
              </svg>
              {/* S 印章：大号优雅衬线 S + 1px 发丝圆环，不加体积感、不描边加粗 */}
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
                    opacity: lit ? 1 : 0.35,
                    transition: "opacity 300ms var(--ease)",
                    animation: lit ? "boot-s-lit 300ms var(--ease) both" : undefined,
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
            <Mark size={72} eva={false} state="done" />
            <div
              className="boot-welcome"
              style={{ letterSpacing: "-0.02em" }}
            >
              欢迎你，路专员
            </div>
            <div className="boot-sub" style={{ letterSpacing: "0.30em" }}>
              WELCOME TO CASSELL COLLEGE
            </div>
            {/* 身份已连接面板 */}
            <div
              style={{
                marginTop: 8,
                border: "1px solid color-mix(in srgb, var(--boot-white) 35%, transparent)",
                borderRadius: 12,
                padding: "16px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>路明非 · 血统 S</div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "color-mix(in srgb, var(--boot-white) 70%, transparent)",
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
            </div>
          </>
        );
    }
  };

  return (
    <div
      className={`boot ${leaving ? "boot-leaving" : ""}`}
      role="dialog"
      aria-label="启动"
      style={{
        ...bootVars,
        transition: leaving
          ? "opacity 300ms var(--ease), background-color 600ms var(--ease)"
          : "background-color 600ms var(--ease)",
        // 淡出期间不再挡输入：标题栏已在 Boot 之下淡入，空白处可拖、按钮可点。
        pointerEvents: leaving ? "none" : undefined,
      }}
    >
      {/* Boot 局部关键帧（只改 Boot.tsx：不写进 App.css） */}
      <style>{`
        @keyframes boot-scan-linear { from { top: 6%; } to { top: 90%; } }
        @keyframes boot-motto-line { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes boot-s-lit {
          from { text-shadow: 0 0 0 color-mix(in srgb, var(--boot-white) 0%, transparent); }
          to { text-shadow: 0 0 18px color-mix(in srgb, var(--boot-white) 45%, transparent); }
        }
      `}</style>

      <button className="boot-skip" onClick={skip} type="button">
        跳过
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
