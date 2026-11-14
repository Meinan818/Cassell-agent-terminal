# 项目审计索引（2026-11-14）

这一组文档只做一件事：把卡塞尔专员终端**现在到底是什么、哪里能用、哪里会坏、下一步怎么干**说清楚。

## 文档

| 文档 | 内容 | 谁写的 |
|---|---|---|
| [PROJECT-AUDIT.md](./PROJECT-AUDIT.md) | 项目总账：产品、代码地图、功能状态、架构债务、风险总表 | 主线程 |
| [frontend.md](./frontend.md) | 前端组件/状态/数据流、3 个 P0、冻结区与可拆分边界 | 子代理审计 |
| [security-data.md](./security-data.md) | 权限、路径、命令、凭据、数据落盘、Tauri 命令面 | 子代理审计 |
| [build-release.md](./build-release.md) | 版本、构建、分支、发布物、测试门禁、Windows 出包清单 | 子代理审计 |
| [../PLAN-NEXT.md](../PLAN-NEXT.md) | 接下来的执行计划：阶段、任务、验收、顺序 | 主线程 |

## 一句话现状

**0.1.9 是一个能聊天、能改文件、能跑终端、能看 diff、能做目标循环的可用原型；但引擎的“会话、工具结果、审批、上下文、进程树”五块地基还没打牢，P1 功能全部没接，且当前 `engine/v2` 分支从未在 Windows 真机上跑过。**

## 审计基线

- 分支：`engine/v2`，HEAD `a391689`，领先 `origin/master`（0.1.9）23 个提交，未 Push。
- 版本：五处版本号仍为 `0.1.9`（`app/package.json`、`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`、`version.ts`）。
- 验证：`cargo test` 85/85 通过；`npm run build` 通过；`cargo clippy` 通过但有 27 条警告；`cargo fmt --check` 仍有 116 处差异（20 文件）。
- 规模：Rust 约 9,000 行；前端约 50,000 行（含 `sealTargets.ts` 30,011 行）；单包 JS 1.78MB。
- 真实边界：单人、单机、本地 BYOK、Windows 优先；没有云、没有遥测、没有自动更新。
