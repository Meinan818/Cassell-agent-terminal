/**
 * CrestLine — 卡塞尔学院校徽的白色线条版（Deline 6）。
 *
 * 身份卡里的校徽不用照片/位图：只有线条勾勒的矢量感——外圈 + 一棵
 * 简化的世界树（主干、左右分枝、根须），呼应真校徽的圆形树印。
 * 描边用 currentColor：父级给 color: var(--text)，深色下近白、浅色下近墨，
 * 两套主题都可见。线宽 1.1，圆角端点。
 *
 * 注意：这只是身份卡（侧栏段位牌 + 设置身份区）里的校徽。开机粒子动画
 * 用的真校徽照片（Boot.tsx /cassell-seal.jpg）绝对不要动。
 */
export default function CrestLine({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* 外圈 */}
      <circle cx={12} cy={12} r={10.4} />
      {/* 主干 */}
      <path d="M12 19.5 V11" />
      {/* 左右分枝 */}
      <path d="M12 14.5 C10 13, 8.5 12.4, 7 10.8" />
      <path d="M12 14.5 C14 13, 15.5 12.4, 17 10.8" />
      <path d="M12 12 C10.6 10.6, 9.6 9.6, 9.2 7.6" />
      <path d="M12 12 C13.4 10.6, 14.4 9.6, 14.8 7.6" />
      {/* 顶芽 */}
      <path d="M12 11.5 C12 9.5, 12 8, 12 6.4" />
      {/* 根须 */}
      <path d="M12 19.5 C10.4 20.6, 9 20.6, 7.8 19.8" />
      <path d="M12 19.5 C13.6 20.6, 15 20.6, 16.2 19.8" />
    </svg>
  );
}
