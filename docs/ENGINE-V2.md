# 引擎 v2 架构约定

目标不是把界面推倒重做，而是把“一个能聊天、能改文件”的自研循环，整理成
可观察、可恢复、可扩展的 agent runtime。

## 借鉴原则

本机安装的 Codex CLI 0.167、Claude Code 2.1.325、天枢 4.0.4 和 DeepSeek
Harness 0.2.1-rc.2 都已经有成熟的运行时边界。只借鉴机制，不复制界面、私有
源码或品牌文案。

- **Codex**：计划/目标、审批策略、会话 rollout、会话恢复与 fork。
- **Claude Code**：权限模式、会话持久化、上下文压缩、后台 agent、预算控制。
- **天枢**：AgentLoop、tool-pipeline、path-grants、project-trust、
  plan-approval、goal-tracker、checkpoint、session-persist、prefix-budget、
  provider-health。

## 当前分层

```text
engine/
  journal.rs   运行事件 JSONL，记录 run / round / tool / approval / retry
  retry.rs     仅对 408、429、5xx 和连接超时做有上限的重试
  deepseek.rs  DeepSeek 的 reasoning_effort、参数适配和模型能力判断

agent.rs       对话循环、流式解析、工具调用编排（后续继续拆出）
sandbox.rs     文件路径边界与审批决策纯函数
goal.rs        目标、检查点、倒带
pty.rs         真终端
browser.rs     内置浏览器
```

## 硬规则

1. 每次 run 必须产生可检查的事件序列，失败也要落 `run_failed`。
2. 日志不写 API Key、完整文件内容或完整命令输出；参数只写摘要。
3. 只重试瞬时错误，认证错误、参数错误、业务错误不重试。
4. 工具执行必须经过统一的路径/审批/超时策略，不在每个 handler 里重复判断。
5. 会话恢复、上下文压缩、目标继续和检查点都属于引擎，不属于 UI。
6. UI 只消费事件和状态，不能自己拼一套“看起来完成了”的假状态。

## 后续顺序

1. 把 `agent.rs` 的 tool definitions、destructive policy、tool execution 拆成
   `engine/tool-spec.rs`、`engine/policy.rs`、`engine/tool-pipeline.rs`。
2. 增加 session store：按 task id 持久化 transcript、usage、goal 和
   checkpoint，支持 resume / fork。
3. 接回 P1 的 compact / advisor，但通过独立模块接入，不把实验代码塞回
   `agent.rs`。
4. 最后再接 Skills / MCP / 自动化；没有统一种工具协议前不接。
