import { useEffect, useRef, useState } from "react";
import Mark from "./Mark";

type Phase = "particles" | "finger" | "grade" | "welcome";

const LOG_LINES = [
  "卡塞尔学院终端 v0.1.0",
  "加载诺玛核心 … OK",
  "连接学院网络 … OK",
  "验证专员身份 …",
  "血统评级 … S",
  "ACCESS GRANTED",
];

const PHASE_MS: Record<Phase, number> = {
  particles: 2600,
  finger: 1500,
  grade: 1500,
  welcome: 1900,
};

export default function Boot({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("particles");
  const [logCount, setLogCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(onDone, 520);
  };

  // Phase machine.
  useEffect(() => {
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase("welcome");
      const t = window.setTimeout(finish, 900);
      return () => window.clearTimeout(t);
    }
    const order: Phase[] = ["particles", "finger", "grade", "welcome"];
    let i = 0;
    let timer = window.setTimeout(function tick() {
      i += 1;
      if (i >= order.length) {
        finish();
        return;
      }
      setPhase(order[i]);
      timer = window.setTimeout(tick, PHASE_MS[order[i]]);
    }, PHASE_MS[order[0]]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot log lines appear one by one.
  useEffect(() => {
    if (logCount >= LOG_LINES.length) return;
    const t = window.setTimeout(() => setLogCount((c) => c + 1), 420);
    return () => window.clearTimeout(t);
  }, [logCount]);

  // Esc / click "跳过" skips the ritual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Particle field: white specks spiral into the seal.
  useEffect(() => {
    if (phase !== "particles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    const cx = w / 2;
    const cy = h / 2 - 20 * dpr;
    const R = Math.min(w, h) * 0.3;
    type P = {
      a: number;
      r: number;
      targetR: number;
      speed: number;
      size: number;
      tw: number;
    };
    const N = 520;
    const parts: P[] = Array.from({ length: N }, () => {
      const onRing = Math.random();
      const targetR =
        onRing < 0.55 ? R : onRing < 0.85 ? R * 0.92 : R * (0.2 + Math.random() * 0.6);
      return {
        a: Math.random() * Math.PI * 2,
        r: R * (1.6 + Math.random() * 1.6),
        targetR,
        speed: 0.006 + Math.random() * 0.012,
        size: (0.6 + Math.random() * 1.6) * dpr,
        tw: Math.random() * Math.PI * 2,
      };
    });
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        // Spiral inward, then hold + shimmer on the seal.
        const k = Math.min(1, t / 1.9);
        const ease = 1 - Math.pow(1 - k, 3);
        const r = p.r + (p.targetR - p.r) * ease;
        const a = p.a + t * p.speed * (1 - ease * 0.7);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.96;
        const alpha = 0.25 + 0.65 * Math.abs(Math.sin(t * 1.6 + p.tw)) * (0.4 + 0.6 * ease);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  return (
    <div
      className={`boot ${leaving ? "boot-leaving" : ""}`}
      role="dialog"
      aria-label="启动"
    >
      <button className="boot-skip" onClick={finish} type="button">
        跳过
      </button>

      {phase === "particles" && (
        <div className="boot-stage">
          <canvas ref={canvasRef} className="boot-canvas" />
          <div className="boot-seal">
            <img
              src="/cassell-seal.jpg"
              alt="卡塞尔学院校徽"
              width={220}
              height={220}
              className="boot-seal-img"
            />
          </div>
          <div className="boot-motto">
            BONUM CERTAMEN CERTAVI · CURSUM CONSUMMAVI · FIDEM SERVAVI
          </div>
        </div>
      )}

      {phase === "finger" && (
        <div className="boot-stage">
          <div className="finger-wrap">
            <svg width="180" height="180" viewBox="0 0 180 180" fill="none">
              <circle cx="90" cy="90" r="86" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
              <circle cx="90" cy="90" r="72" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" strokeDasharray="300 60" strokeLinecap="round" />
              <circle cx="90" cy="90" r="56" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeDasharray="200 70" strokeLinecap="round" />
              <circle cx="90" cy="90" r="40" stroke="rgba(255,255,255,0.9)" strokeWidth="1.4" strokeDasharray="120 60" strokeLinecap="round" />
              <circle cx="90" cy="90" r="24" stroke="rgba(255,255,255,0.9)" strokeWidth="1.4" strokeDasharray="70 40" strokeLinecap="round" />
              <path d="M90 66 C 84 78, 84 102, 90 114 M90 66 C 96 78, 96 102, 90 114" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <div className="scanline" />
          </div>
          <div className="boot-caption">身份验证</div>
          <div className="boot-sub">IDENTITY VERIFICATION</div>
          <div className="boot-progress">
            <div className="boot-progress-fill" />
          </div>
        </div>
      )}

      {phase === "grade" && (
        <div className="boot-stage">
          <div className="grade-seal">
            <span className="grade-s">S</span>
          </div>
          <div className="boot-caption">血统评级</div>
          <div className="grade-scale">
            {["E", "D", "C", "B", "A", "S"].map((g) => (
              <span key={g} className={`grade-tick ${g === "S" ? "on" : ""}`}>
                {g}
              </span>
            ))}
          </div>
          <div className="boot-sub">BLOODLINE ASSESSMENT</div>
        </div>
      )}

      {phase === "welcome" && (
        <div className="boot-stage">
          <Mark size={72} eva={false} state="done" />
          <div className="boot-welcome">欢迎你，路专员</div>
          <div className="boot-sub">CASSELL COLLEGE · ACCESS GRANTED</div>
        </div>
      )}

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
