import { useRef, useState } from "react";
import { paletteFor, useAppTheme } from "./mark/ballAdapter";
import {
  EYE_CENTER_Y,
  EYE_H,
  EYE_SPACING,
  EYE_TILT_DEG,
  EYE_W,
  eyeBoost,
  useBallEngine,
  useTourState,
} from "./mark/useBallEngine";
import type { BallState } from "./mark/expressions";
import "./mark/mark.css";

/** 对外状态类型：14 个工作状态（App.tsx 的 markState 继续用这个类型）。 */
export type MarkState = BallState;

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
 * language. Rendering layer only — it receives a pose from useBallEngine
 * and a palette from ballAdapter, and knows nothing about agents or EVA.
 *
 * B1–B3（形）：正圆 50%；眼中心 39% D（眼顶 24% D）；两眼平行倾斜 "/"
 *   14°（12–16° 取中；round-teal 是 "/" 34°、hero 是 0°，取中间值。
 *   唯一不许的是旧的镜像顶部向外 "\/"。注视方向一致性由眼对的垂直
 *   倾斜（向左看左眼略高）表达，见 useBallEngine 的 dyL/dyR）。
 * B4/B9（质感）：渐变压平成近纯色（见 ballAdapter.paletteFor 的 5 点采样），
 *   浅色 0 4px 12px rgba(0,0,0,0.10)，深色极淡光晕，无 inset 暗角。
 * B5（去超调）：全部过渡 Cubic(0.645, 0.045, 0.355, 1.0)，永不超调；
 *   眼睛由引擎逐帧驱动，不挂 CSS transition。
 * B7：眼睛是球体内的 div + overflow:hidden 裁剪，滑到边缘自动被轮廓裁剪；
 *   自旋到背面按 cos ≤ 0.02 隐藏（球面投影，见 projectEye）。
 */
export default function Mark({
  size = 40,
  eva = false,
  state = "idle",
  gaze = 0,
  fast = false,
}: MarkProps) {
  // 巡演模式：?ball=tour 固定顺序循环 14 态；?ball=<state> 单状态锁定。
  const tourState = useTourState(state);
  // 悬停注视（第 3 步第二波 §5）：悬停在球上时它看向光标；离开后 1s
  // 回到自主漫游（延迟清掉 hover，引擎随即恢复漫游调度）。
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const onHoverMove = (e: React.MouseEvent<HTMLDivElement>) => {
    clearHoverTimer();
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    setHover({
      x: Math.max(-1, Math.min(1, nx)),
      y: Math.max(-1, Math.min(1, ny)),
    });
  };
  const onHoverLeave = () => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => setHover(null), 1000);
  };
  const pose = useBallEngine({
    state: tourState,
    eva,
    fast,
    gaze,
    size,
    hoverGaze: hover,
  });
  const theme = useAppTheme();
  const palette = paletteFor(eva ? "eva" : "norma", theme);

  const R = size / 2;
  const boost = eyeBoost(size);
  const eyeW = size * EYE_W * boost;
  const eyeH = size * EYE_H * boost;
  // B2：眼中心锚定 39% D（眼顶 = 39% − 15%×boost；100px 时眼顶 24% D）
  const eyeCenterY = size * EYE_CENTER_Y;
  const eyeTop = eyeCenterY - eyeH / 2;
  const leftBaseX = size * (0.5 - EYE_SPACING / 2); // 36% D
  const rightBaseX = size * (0.5 + EYE_SPACING / 2); // 64% D

  /**
   * 球面投影闭式公式（emotion-ball-plan.md §3.2）：
   * total = asin(ox/R) + yaw；x = R·sin(total)；scaleX = cos(total)；
   * cos ≤ 0.02 时隐藏。ox 是眼睛相对球心的横向偏移（含基态 ±14% D
   * 与注视偏移）。纬度因子 fy = sqrt(1 − (dy/R)²·0.22)。
   */
  const projectEye = (
    baseX: number,
    lookXPx: number,
  ): { x: number; scaleX: number; hidden: boolean } => {
    const ox = baseX - R + lookXPx;
    const total = Math.asin(Math.max(-1, Math.min(1, ox / R))) + pose.yaw;
    const cos = Math.cos(total);
    return { x: R * Math.sin(total), scaleX: cos, hidden: cos <= 0.02 };
  };

  const lookXPx = (pose.lookX / 100) * size;
  const dyFromCenter = eyeCenterY - R; // −11% D
  const fy = Math.sqrt(1 - (dyFromCenter / R) ** 2 * 0.22);
  const leftProj = projectEye(leftBaseX, lookXPx);
  const rightProj = projectEye(rightBaseX, lookXPx);

  const eyeStyle = (
    proj: { x: number; scaleX: number; hidden: boolean },
    tilt: number,
    dy: number,
    open: number,
  ): React.CSSProperties => ({
    position: "absolute",
    left: R,
    top: eyeCenterY,
    width: eyeW,
    height: eyeH,
    borderRadius: eyeW / 2,
    background: palette.eyeColor,
    display: proj.hidden ? "none" : undefined,
    transform: `translate(-50%, -50%) translate(${proj.x}px, ${dy}px) rotate(${tilt}deg) scale(${Math.max(0, proj.scaleX) * pose.eyeScale}, ${fy * pose.eyeScaleY * open * pose.eyeScale})`,
  });

  const arcStyle = (proj: { x: number; scaleX: number; hidden: boolean }): React.CSSProperties => ({
    position: "absolute",
    left: R,
    // 笑弧：弧顶在眼顶 + (0.83 − smileArc) 眼高处，弧高 = smileArc × 眼高
    //（smileArc 0.55 时与旧版固定值完全一致；弧度由 expressions.ts 的参数表定）
    top: eyeTop + eyeH * (0.83 - pose.smileArc),
    width: eyeW,
    height: eyeH * pose.smileArc,
    borderTop: `${Math.max(2, size * 0.045)}px solid ${palette.eyeColor}`,
    borderLeft: "none",
    borderRight: "none",
    borderBottom: "none",
    borderRadius: `${eyeW / 2}px ${eyeW / 2}px 0 0`,
    display: proj.hidden ? "none" : undefined,
    transform: `translate(-50%, 0) translateX(${proj.x}px)`,
  });

  const ringSize = size * 0.07;
  const dotSize = Math.max(3, size * 0.04);
  // 权限核验环（第 3 步第二波 §4）：1.5px 细线，半径 = 球半径 + 6px，
  // 颜色走球本体色低透明度（palette.ringColor）；进度按 pose.verifyProgress。
  const verifyR = R + 6;
  const verifyC = 2 * Math.PI * verifyR;

  return (
    <div
      className="mark"
      role="img"
      aria-label={eva ? "EVA" : "诺玛"}
      onMouseEnter={onHoverMove}
      onMouseMove={onHoverMove}
      onMouseLeave={onHoverLeave}
      style={{
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
        transform: `scale(${1 + pose.pulse})`,
        filter: `brightness(${pose.dim})`,
      }}
    >
      {/* 权限核验环：细、淡、慢——不抢球本身的戏 */}
      {pose.verifyVisible && (
        <svg
          className="mark-verify-ring"
          aria-hidden
          width={size + 12}
          height={size + 12}
          viewBox={`0 0 ${size + 12} ${size + 12}`}
          style={{
            position: "absolute",
            left: -6,
            top: -6,
            opacity: pose.verifyOpacity,
            animation:
              pose.verifyPulse && !pose.reducedMotion
                ? "mark-verify-pulse 1s ease-in-out infinite"
                : "none",
            pointerEvents: "none",
          }}
        >
          <circle
            cx={(size + 12) / 2}
            cy={(size + 12) / 2}
            r={verifyR}
            fill="none"
            stroke={palette.ringColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={verifyC}
            strokeDashoffset={verifyC * (1 - pose.verifyProgress)}
            transform={`rotate(-90 ${(size + 12) / 2} ${(size + 12) / 2})`}
          />
        </svg>
      )}
      {/* 思考环带：单色细环，低倾角水平轨道缓慢环绕；退出时 0.5s 淡出回缩 */}
      <div
        className="mark-ring"
        aria-hidden
        style={{
          position: "absolute",
          inset: -ringSize,
          borderRadius: "50%",
          border: `1px solid ${palette.ringColor}`,
          animation: pose.reducedMotion
            ? "none"
            : "mark-ring-spin 2.8s linear infinite",
          opacity: pose.ring ? 1 : 0,
          scale: pose.ring ? 1 : 0.85,
          transition:
            "opacity 500ms cubic-bezier(0.645, 0.045, 0.355, 1.0), scale 500ms cubic-bezier(0.645, 0.045, 0.355, 1.0)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -dotSize / 2,
            left: `calc(50% - ${dotSize / 2}px)`,
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: palette.ringColor,
          }}
        />
      </div>
      <div
        className="mark-ball"
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          borderRadius: "50%",
          background: palette.ballBackground,
          boxShadow: palette.glow,
          // B6：日常注视只动眼睛，身体角度不动；倾身只在状态切换时作为
          // 整体旋转（pose.bodyRotate，上限 ±6°）。
          rotate: `${pose.bodyRotate}deg`,
          // B8 + 第 3 步第二波 §6：呼吸波形按人格分开——诺玛
          // mark-breathe-norma（2s 吸入→0.6s 停顿→2s 呼出），EVA
          // mark-breathe-eva（1.2s→0.3s→1.2s + 呼出末尾二次脉冲）。
          animation: pose.reducedMotion
            ? "none"
            : pose.shake
              ? `${pose.breatheAnim} ${pose.breathePeriod}s ease-in-out infinite, mark-shake 0.5s ease-in-out`
              : `${pose.breatheAnim} ${pose.breathePeriod}s ease-in-out infinite`,
          transition:
            "box-shadow 300ms cubic-bezier(0.645, 0.045, 0.355, 1.0)",
        }}
      >
        {pose.smile ? (
          <>
            <div style={arcStyle(leftProj)} />
            <div style={arcStyle(rightProj)} />
          </>
        ) : (
          <>
            <div style={eyeStyle(leftProj, pose.tiltL, pose.dyL, pose.openL)} />
            <div style={eyeStyle(rightProj, pose.tiltR, pose.dyR, pose.openR)} />
          </>
        )}
      </div>
    </div>
  );
}

// 保留给自测脚本与调用方：B1 倾斜角（度）、B2 眼中心（%D）。
export const MARK_GEOMETRY = {
  tiltDeg: EYE_TILT_DEG,
  eyeCenterYPct: EYE_CENTER_Y * 100,
  eyeTopPct100: (EYE_CENTER_Y - EYE_H / 2) * 100,
};
