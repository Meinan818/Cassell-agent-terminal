import { useEffect, useRef, useState } from "react";
import Mark from "./Mark";
import { APP_VERSION } from "../version";

/**
 * 开机登录流（七步，顺序固定）：
 * particles（粒子真校徽）→ gate（身份认证门）→ finger（指纹）
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
    // 开机结束 300ms 交叉淡化交接（--ease）。
    later(onDone, 300);
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

  // Particle field: 9000 white specks spiral into the real seal.
  // 锐利星点（硬边圆盘、NormalBlending、DPR 上限 3）；远近分层：
  // 远的更小更慢、近的更大更快；无拖尾（每帧 clearRect，拖尾克制）；
  // 成形后干净停留 + 轻微呼吸（振幅 0.6%，不再一直转）。
  useEffect(() => {
    if (phase !== "particles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    const cx = w / 2;
    const cy = h / 2 - 20 * dpr;
    const R = Math.min(w, h) * 0.3;
    // 亮色主题下白粒子在浅底上看不见：粒子走墨色（与 --text 同色），
    // 仍是单色、无金色；深色主题下走白色。
    const ink = theme === "light" ? "26,26,26" : "255,255,255";
    type P = {
      a: number;
      r: number;
      targetR: number;
      speed: number;
      size: number;
      tw: number;
      depth: number;
    };
    const N = 9000;
    const parts: P[] = Array.from({ length: N }, () => {
      const onRing = Math.random();
      const targetR =
        onRing < 0.55 ? R : onRing < 0.85 ? R * 0.92 : R * (0.2 + Math.random() * 0.6);
      const depth = Math.random();
      return {
        a: Math.random() * Math.PI * 2,
        r: R * (1.6 + Math.random() * 1.6),
        targetR,
        speed: 0.004 + depth * 0.014,
        size: (0.5 + depth * 1.6) * dpr,
        tw: Math.random() * Math.PI * 2,
        depth,
      };
    });
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        // Spiral inward, then hold + breathe on the seal.
        const k = Math.min(1, t / 1.9);
        const ease = 1 - Math.pow(1 - k, 3);
        // 成形后几乎停转（只剩 15% 角速度）+ 0.6% 呼吸半径。
        const breathe = 1 + 0.006 * Math.sin(t * 0.9 + p.tw) * ease;
        const r = (p.r + (p.targetR - p.r) * ease) * breathe;
        const a = p.a + t * p.speed * (1 - ease * 0.85);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.96;
        const alpha =
          0.25 + 0.65 * Math.abs(Math.sin(t * 1.6 + p.tw)) * (0.4 + 0.6 * ease);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ink},${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [phase, theme]);

  // ---- 主题跟随（只改 Boot.tsx，不动 App.css）----
  // --boot-* 两套同值、固定深色；这里在 Boot 根节点上按当前主题重定义：
  // 亮色用 --bg 浅色仪式底 + --text 深色字；深色沿用固定深色值。
  // 这样铭文、S 印章、细线等所有走 --boot-white 的元素都随主题走，
  // 浅色底上不再出现看不清的浅字。
  const bootVars = {
    "--boot-bg": theme === "light" ? "var(--bg)" : "#0b0b0c",
    "--boot-fg": theme === "light" ? "var(--text)" : "#f5f5f5",
    "--boot-white": theme === "light" ? "var(--text)" : "#ffffff",
  } as React.CSSProperties;

  const stageIn = (delayMs: number): React.CSSProperties => ({
    animation: `boot-stage-in 600ms var(--ease-exp) ${delayMs}ms both`,
  });

  const renderStage = (p: Phase) => {
    switch (p) {
      case "particles":
        return (
          <>
            <canvas ref={canvasRef} className="boot-canvas" />
            <div
              className="boot-seal"
              style={{
                opacity: sealGone ? 0 : 1,
                transition: "opacity 600ms var(--ease-exp)",
              }}
            >
              <img
                src="/cassell-seal.jpg"
                alt="卡塞尔学院校徽"
                width={220}
                height={220}
                className="boot-seal-img"
              />
            </div>
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
        transition: leaving ? "opacity 300ms var(--ease)" : undefined,
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
