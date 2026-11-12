/**
 * Parse one Codex CLI `--json` (JSONL) event line into normalized actions
 * the UI can render. Defensive by design: the exact event set of the
 * installed Codex version may add fields, so unknown shapes fall through
 * to the terminal log instead of being dropped silently.
 *
 * Shapes verified against codex-cli 0.164.0-alpha.9:
 *  {"type":"thread.started","thread_id":"..."}
 *  {"type":"turn.started"}
 *  {"type":"turn.completed", ...}
 *  {"type":"turn.failed","error":{"message":"..."}}
 *  {"type":"error","message":"Reconnecting... 2/5 (...)"}
 *  {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *  {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"..."}}
 *  {"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"...","kind":"..."}]}}
 *  {"type":"item.completed","item":{"id":"item_3","type":"error","message":"..."}}
 */

export type AgentAction =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string; itemId?: string }
  | { type: "message"; text: string; itemId?: string }
  | { type: "tool"; label: string; detail?: string }
  | { type: "file"; path: string; kind: string }
  | { type: "error"; message: string }
  | { type: "turn-done" }
  | { type: "turn-failed"; message: string }
  | { type: "log"; line: string };

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseAgentEvent(line: string): AgentAction[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [{ type: "log", line }];
  }
  const t = asText(obj.type);

  if (t === "thread.started") {
    return [{ type: "thread", threadId: asText(obj.thread_id) }];
  }
  if (t === "turn.started") return [];
  if (t === "turn.completed") return [{ type: "turn-done" }];
  if (t === "turn.failed") {
    const err = obj.error as Record<string, unknown> | undefined;
    return [
      {
        type: "turn-failed",
        message: asText(err?.message) || asText(obj.message) || "任务失败",
      },
    ];
  }
  if (t === "error") {
    return [{ type: "error", message: asText(obj.message) || "发生错误" }];
  }

  // Incremental text (some versions emit delta events).
  if (typeof obj.delta === "string" && obj.delta.length > 0) {
    return [{ type: "delta", text: obj.delta, itemId: asText(obj.item_id) || undefined }];
  }

  if (t === "item.started" || t === "item.completed") {
    const item = (obj.item ?? {}) as Record<string, unknown>;
    const itemId = asText(item.id) || undefined;
    const it = asText(item.type);
    if (it === "agent_message") {
      const text = asText(item.text) || asText(item.message);
      if (!text) return [];
      return [{ type: "message", text, itemId }];
    }
    if (it === "command_execution") {
      const cmd = asText(item.command);
      const out = asText(item.aggregated_output) || asText(item.output);
      return [
        {
          type: "tool",
          label: cmd ? `执行命令：${cmd}` : "执行命令",
          detail: out || undefined,
        },
      ];
    }
    if (it === "file_change") {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return changes
        .map((c) => {
          const ch = c as Record<string, unknown>;
          const p = asText(ch.path);
          return p
            ? ({ type: "file", path: p, kind: asText(ch.kind) || "modified" } as AgentAction)
            : null;
        })
        .filter((a): a is AgentAction => a !== null);
    }
    if (it === "reasoning") return [];
    if (it === "error") {
      return [{ type: "error", message: asText(item.message) || "发生错误" }];
    }
    if (it === "web_search") {
      return [{ type: "tool", label: "联网搜索", detail: asText(item.query) || undefined }];
    }
    if (it === "mcp_tool_call") {
      return [
        {
          type: "tool",
          label: `MCP 调用：${asText(item.server) || ""} ${asText(item.tool) || ""}`.trim(),
        },
      ];
    }
    if (it === "todo_list") return [];
    return [{ type: "log", line }];
  }

  return [{ type: "log", line }];
}
