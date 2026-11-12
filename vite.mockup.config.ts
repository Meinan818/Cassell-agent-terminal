import { defineConfig } from "vite";

// 开发模式专用：直接服务视觉稿目录（app/mockup）。
// 正式版 tauri.conf.json 的 frontendDist 也指向 ../mockup，
// 所以 dev 和发行版看到的是同一套界面，避免"dev 一个样、装出来另一个样"。
// 视觉稿是单文件内联脚本，不需要 React 插件或打包，
// vite 只负责静态服务 + 文件变更时整页热刷新。
export default defineConfig({
  root: "mockup",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
