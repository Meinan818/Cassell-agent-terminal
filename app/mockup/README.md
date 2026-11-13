# 前端来源说明

`index.html` 是视觉稿（主界面视觉稿，build 425839f0：整页滚动修复 + 未配置服务商时模型列表为空）
的最新导出再经清理的版本。原始导出：
`~/workspace/your_files/zhu-jie-mian-shi-jue-gao/zhu-jie-mian-shi-jue-gao.html`
（SHA256 `faabf8f0d2e4e27e5a68d12a4676b1bef26867297481b5a5c6203a1b98e714dc`）。

清理内容（0.1.3 起，用户要求正式版只要界面、不要说明文字）：
- 删掉顶部标题头（`<header class="intro">`：「主界面视觉稿 — 安静的界面，
  会动的诺玛」+ 描述段落）；
- 删掉「设计说明」整节（`<section class="notes">`：01/02/03 三栏 + 配色表 +
  foot-note），以及帮助抽屉里「查看这一稿的设计说明」按钮及其 JS 绑定；
- `<title>` 由「主界面视觉稿」改为「卡塞尔专员终端」。
清理后文件 SHA256 `051c7ac828ba9d37bc182f54d67e8d411b3bd63997f1a7625157bb34e9122b7e`，
「主界面视觉稿」「设计说明」等字样 0 处、模型名单一状态源（DEF_MODEL +
setDefaultModel）与「DeepSeek 直连 / workbuddy 反代」显示名均保留、
内联脚本 `node --check` 通过；另含整页滚动修复（根容器定高视口、整页不滚动）
与未配置服务商时模型列表空态（「还没有可用的模型」+「去配置服务商」）。

正式版 Tauri 应用的前端就是这份文件（`tauri.conf.json` 里
`frontendDist` 指向 `../mockup`），不再用 Vite/React 的 `dist/`。
这样应用打开后显示的界面与视觉稿一致（7 步登录流、聊天区、
侧栏、设置、输入框、活标记、思考指示器、询问卡片等全部一样），
只是没有标题头与设计说明页。

注意：
- 视觉稿若重新导出，需把新文件重新拷到这里并重新做一遍清理
  （去掉标题头与设计说明节），再重新构建 Windows 版。
- 文件内引用了 Google Fonts 与 Three.js 的 CDN（与网页版视觉稿相同），
  需联网才能加载到完全一致的字体与粒子动画；Three.js 加载失败时
  有 `window.THREE` 守卫，不会崩。
