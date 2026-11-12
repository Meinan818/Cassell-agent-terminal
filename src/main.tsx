import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { THEME_KEY } from "./types";

// 首屏兜底（第二层防御）：index.html 内联脚本是第一层；若它没跑起来
//（例如缓存的旧 index.html），这里在 React 挂载前把主题定下来。
// 优先级与内联脚本一致：已保存的选择 > 系统偏好 > 默认暗色。
try {
  const root = document.documentElement;
  if (!root.dataset.theme) {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      root.dataset.theme = saved;
    } else {
      root.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
    }
  }
} catch {
  // 存储或 matchMedia 不可用：保持默认暗色，不阻塞启动。
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
