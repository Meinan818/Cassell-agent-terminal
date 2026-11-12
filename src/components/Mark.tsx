import { useEffect, useRef, useState } from "react";

export type MarkState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "done"
  | "waiting";

interface MarkProps {
  size?: number;
  /** false = Norma (ink), true = EVA (blue). Same shape, color only. */
  eva?: boolean;
  state?: MarkState;
  /** Look direction: -1 (left) .. 1 (right). */
  gaze?: number;
  /** EVA tempo: faster blinking / motion. */
  fast?: boolean;
}

/**
 * The living mark: one round ball + two pill eyes, per the real Grok Bot
 * language. Eyes live on the sphere (they slide sideways when the ball
 * turns), blink on their own, and morph per state. Only transform/opacity
 * are animated (60fps), all changes run on the shared spring curve.
 */
export default function Mark({
  size = 40,
  eva = false,
  state = "idle",
  gaze = 0,
  fast = false,
}: MarkProps) {
  const [blinking, setBlinking] = useState(false);
  const timer = useRef<number | null>(null);

  // Idle blinking on its own clock (EVA blinks faster — quicker tempo).
  useEffect(() => {
    let alive = true;
    const schedule = () => {
      timer.current = window.setTimeout(
        () => {
          if (!alive) return;
          setBlinking(true);
          window.setTimeout(() => {
            if (!alive) return;
            setBlinking(false);
            schedule();
          }, 160);
        },
        fast ? 1700 + Math.random() * 2000 : 2600 + Math.random() * 3200,
      );
    };
    schedule();
    return () => {
      alive = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [fast]);

  const eyeW = size * 0.2;
  const eyeH = size * 0.3;
  const eyeY = size * 0.36;
  const leftX = size * 0.26;
  const rightX = size * 0.54;

  const ballBg = eva
    ? "radial-gradient(circle at 32% 26%, #7db4ff 0%, #3b82f6 42%, #1d4ed8 78%, #1e3a8a 100%)"
    : "radial-gradient(circle at 32% 26%, #4a4a4a 0%, #232323 45%, #0a0a0a 80%, #000000 100%)";

  const ballTransform =
    state === "thinking"
      ? `rotate(-6deg) translateX(${gaze * size * 0.03}px)`
      : `rotate(${gaze * 4}deg) translateX(${gaze * size * 0.02}px)`;

  const eyeScaleY = blinking
    ? 0.08
    : state === "thinking"
      ? 0.55
      : state === "working"
        ? 0.8
        : state === "listening"
          ? 1.1
          : 1;
  const eyeScaleX = state === "listening" ? 1.06 : 1;

  const eyeStyle = (x: number, tilt: number): React.CSSProperties => ({
    position: "absolute",
    left: x,
    top: eyeY,
    width: eyeW,
    height: eyeH,
    borderRadius: eyeW / 2,
    background: "#fff",
    transform: `translateX(${gaze * size * 0.055}px) rotate(${tilt}deg) scale(${eyeScaleX}, ${eyeScaleY})`,
    transition: "transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  });

  const arcStyle = (x: number): React.CSSProperties => ({
    position: "absolute",
    left: x,
    top: eyeY + eyeH * 0.28,
    width: eyeW,
    height: eyeH * 0.55,
    borderTop: `${Math.max(2, size * 0.045)}px solid #fff`,
    borderLeft: "none",
    borderRight: "none",
    borderBottom: "none",
    borderRadius: `${eyeW / 2}px ${eyeW / 2}px 0 0`,
    transform: `translateX(${gaze * size * 0.04}px)`,
    transition: "transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  });

  return (
    <div
      className="mark"
      role="img"
      aria-label={eva ? "EVA" : "诺玛"}
      style={{
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        className="mark-ball"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50% 48% 52% 49% / 49% 52% 48% 51%",
          background: ballBg,
          boxShadow:
            "inset 0 -6% 12% rgba(0,0,0,0.35), 0 6px 18px rgba(0,0,0,0.18)",
          transform: ballTransform,
          transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          animation: "mark-breathe 3.4s ease-in-out infinite",
        }}
      >
        {state === "done" ? (
          <>
            <div style={arcStyle(leftX)} />
            <div style={arcStyle(rightX)} />
          </>
        ) : (
          <>
            <div style={eyeStyle(leftX, -7)} />
            <div style={eyeStyle(rightX, 7)} />
          </>
        )}
      </div>
    </div>
  );
}
