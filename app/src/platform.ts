/**
 * 当前是不是 macOS：快捷键提示按平台显示。
 * Windows / Linux 上显示 Ctrl，Mac 上显示 ⌘——Windows 用户不认识 ⌘。
 * 快捷键本身两种修饰键都接受（App 的中央键盘处理用 e.metaKey || e.ctrlKey），
 * 这里只管显示。
 */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    /Mac/.test(navigator.userAgent));

/** 按平台显示的快捷键文本（Mac 用 ⌘，其余用 Ctrl）。 */
export function modKey(label: string): string {
  return IS_MAC ? `⌘${label}` : `Ctrl+${label}`;
}
