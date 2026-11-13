import { useId } from "react";

/**
 * 变形图标系统（Grok 变形动画标准）——智能体全部活动态共用同一套图标语言。
 *
 * 原理：4 颗“墨滴”在 gooey 滤镜下始终连成一个整体——形态切换时，墨滴的
 * 位置/半径用 550ms 指数缓出过渡，形状是真正“变形”过去的，不消失、不硬切、
 * 不是画个东西动两下。几何类形态（文件/文件夹/终端）是一块圆角方片从墨滴
 * 中心舒展开，细节描边（笔尖/文件行/文件夹标签/终端 >_ /放大镜）随形态淡入。
 * 形态切换时容器有一个轻微 squash，强化“变形”的感觉；运行中整体轻呼吸。
 * 完成态：变形收束成一颗安静的小圆点 + 弱色文字——不用绿药丸、不打对号。
 *
 * 形态与活动对应：
 * dots    思考中（三点）      ball    思考中（球）
 * ring    探索中（圆环）      pen     撰写中（笔）
 * file    读取文件            folder  列出目录
 * terminal 执行命令          search  搜索中（放大镜）
 * dot     完成态（安静小圆点）
 */
export type MorphShape =
  | "dots"
  | "ball"
  | "pen"
  | "ring"
  | "file"
  | "folder"
  | "terminal"
  | "search"
  | "dot";

interface BlobSpec {
  /** 相对中心 (12,12) 的偏移，单位 px（24 视图）。 */
  x: number;
  y: number;
  r: number;
  /** 三点态的错峰上下浮动延迟（秒），只有 dots 态的三颗用。 */
  bob?: number;
}

const PARKED: BlobSpec = { x: 0, y: 0, r: 0.1 };

const BLOBS: Record<MorphShape, BlobSpec[]> = {
  dots: [
    { x: -7, y: 0, r: 2.2, bob: 0 },
    { x: 0, y: 0, r: 2.2, bob: 0.15 },
    { x: 7, y: 0, r: 2.2, bob: 0.3 },
    { ...PARKED },
  ],
  ball: [
    { x: 0, y: 0, r: 4.2 },
    { x: 0, y: 0, r: 4.2 },
    { x: 0, y: 0, r: 4.2 },
    { x: 0, y: 0, r: 4.2 },
  ],
  pen: [
    { x: -4.6, y: 4.6, r: 2.7 },
    { x: 0, y: 0, r: 2.7 },
    { x: 4.6, y: -4.6, r: 2.7 },
    { ...PARKED },
  ],
  ring: [{ ...PARKED }, { ...PARKED }, { ...PARKED }, { ...PARKED }],
  file: [{ ...PARKED }, { ...PARKED }, { ...PARKED }, { ...PARKED }],
  folder: [{ ...PARKED }, { ...PARKED }, { ...PARKED }, { ...PARKED }],
  terminal: [{ ...PARKED }, { ...PARKED }, { ...PARKED }, { ...PARKED }],
  search: [
    { x: -1, y: -1, r: 3 },
    { ...PARKED },
    { ...PARKED },
    { ...PARKED },
  ],
  dot: [{ x: 0, y: 0, r: 2.1 }, { ...PARKED }, { ...PARKED }, { ...PARKED }],
};

/** 减弱动效偏好：循环切换停在当前形态，不自动变；CSS 里的呼吸/浮动也停。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function MorphIcon({
  shape,
  size = 18,
  breathing = false,
}: {
  shape: MorphShape;
  size?: number;
  breathing?: boolean;
}) {
  const gooId = `morph-goo-${useId().replace(/:/g, "")}`;
  const blobs = BLOBS[shape];
  return (
    <svg
      className={`morph-svg${breathing ? " breathe" : ""}`}
      data-shape={shape}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <filter id={gooId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.3" result="b" />
          <feColorMatrix
            in="b"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
          />
        </filter>
      </defs>
      {/* 墨滴簇：位置/半径过渡 = 变形本身；gooey 让它们始终是一个整体。 */}
      <g filter={`url(#${gooId})`}>
        {blobs.map((b, i) => (
          <g
            key={i}
            className="morph-blob-pos"
            style={{ transform: `translate(${b.x}px, ${b.y}px)` }}
          >
            <circle
              cx="12"
              cy="12"
              className={`morph-blob${b.bob !== undefined ? " morph-blob-bob" : ""}`}
              style={{
                r: b.r,
                ...(b.bob !== undefined
                  ? { animationDelay: `${b.bob}s` }
                  : {}),
              } as React.CSSProperties}
            />
          </g>
        ))}
      </g>
      {/* 几何形态的方片：从墨滴中心舒展开（文件/文件夹/终端共用）。 */}
      <rect
        className="morph-tile"
        x="4.6"
        y="4.6"
        width="14.8"
        height="14.8"
        rx="4.2"
      />
      {/* 笔尖：斜向笔身的西南端。 */}
      <path
        className="morph-detail morph-pen-tip"
        d="M3.8 20.2 L9.3 18.5 L5.5 14.7 Z"
        fill="currentColor"
        stroke="none"
      />
      <g
        className="morph-detail morph-file-detail"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.6 11.8 H15.4" />
        <path d="M8.6 15.2 H13.2" />
        <path d="M14.8 4.8 L19.2 9.2 L14.8 9.2 Z" />
      </g>
      <g
        className="morph-detail morph-folder-detail"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.2 8.6 V6.4 Q8.2 5.2 9.4 5.2 H11.6 L13 6.6 H16" />
        <path d="M7.8 11.2 H16.2" />
      </g>
      <g
        className="morph-detail morph-terminal-detail"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.6 10.2 L11.4 12.4 L8.6 14.6" />
        <path d="M13.2 15.2 H16.6" />
      </g>
      <circle
        className="morph-detail morph-detail-ring morph-ring"
        cx="12"
        cy="12"
        r="7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <g
        className="morph-detail morph-detail-ring morph-search-detail"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="5.6" />
        <path d="M15.2 15.2 L19.2 19.2" />
      </g>
    </svg>
  );
}
