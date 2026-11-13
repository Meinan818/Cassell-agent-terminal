#!/usr/bin/env python3
"""Mock OpenAI-compatible server for verifying the native engine.

Endpoints:
  GET  /v1/models            -> {"data": [{"id": "mock-flash"}, {"id": "mock-pro"}]}
  POST /v1/chat/completions  -> stream=true: slow SSE with reasoning_content,
                               content deltas, one tool_calls delta, final usage.
                               stream=false: tiny JSON {"choices": [...OK...]}.
Logs every request (method, path, truncated body) to /tmp/mock-ai.log.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = "/tmp/mock-ai.log"


def log(line: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def sse(data: dict) -> bytes:
    return ("data: " + json.dumps(data, ensure_ascii=False) + "\n\n").encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        log(f"GET {self.path} auth={self.headers.get('Authorization', '')[:20]}")
        if self.path.rstrip("/").endswith("/models"):
            self._send_json(200, {
                "object": "list",
                "data": [
                    {"id": "mock-flash", "object": "model"},
                    {"id": "mock-pro", "object": "model"},
                ],
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}
        log(f"POST {self.path} model={body.get('model')} stream={body.get('stream')} "
            f"msgs={[(m.get('role')) for m in body.get('messages', [])]} "
            f"tools_in_history={any(m.get('role') == 'tool' for m in body.get('messages', []))} "
            f"offered_tools={[t.get('function', {}).get('name') for t in body.get('tools', [])]}")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._send_json(404, {"error": "not found"})
            return
        if not body.get("stream"):
            self._send_json(200, {
                "choices": [{"message": {"role": "assistant", "content": "OK"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            })
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def chunk(delta, finish=None):
            d = {"choices": [{"index": 0, "delta": delta}]}
            if finish:
                d["choices"][0]["finish_reason"] = finish
            return sse(d)

        # 测试标记（只用于本地验证 P0-4/P0-5/P0-9，不影响正常 mock 行为）：
        # 最后一句用户消息里带 [MOCK-WRITE] → 首轮发 write_file 调用；
        # 带 [MOCK-RM] → 首轮发 run_shell rm 调用；带 [MOCK-PLAN] → 次轮
        # 发结构化方案文本（目标/发现/步骤/风险）。标记本身不进任何产品逻辑。
        last_user = ""
        for m in reversed(body.get("messages", [])):
            if m.get("role") == "user":
                last_user = m.get("content", "")
                break
        marker_write = "[MOCK-WRITE]" in last_user
        marker_rm = "[MOCK-RM]" in last_user
        marker_plan = "[MOCK-PLAN]" in last_user
        log(f"markers write={marker_write} rm={marker_rm} plan={marker_plan}")

        # Slow reasoning deltas (thinking block).
        for piece in ["让我", "想想", "……"]:
            self.wfile.write(chunk({"reasoning_content": piece}))
            self.wfile.flush()
            time.sleep(0.7)
        # Slow content deltas (streaming bubble).
        for piece in ["这是", "流式", "回复", "，", "一个", "字", "一个", "字", "地", "出来", "。"]:
            self.wfile.write(chunk({"content": piece}))
            self.wfile.flush()
            time.sleep(0.5)
        # First round: one tool call (read README.md in the workdir).
        # Later rounds (tool result already in history): answer in plain text
        # so the run terminates instead of looping on the same tool call.
        tools_in_history = any(m.get("role") == "tool" for m in body.get("messages", []))
        if tools_in_history:
            if marker_plan:
                plan_text = (
                    "## 目标\n把这个项目重构成更清晰的结构。\n"
                    "## 发现\n- 工作区有一个 README.md，先读它理清现状。\n"
                    "## 步骤\n1. 读 README.md 与主要文件。\n2. 按模块拆分代码。\n3. 跑测试验证。\n"
                    "## 风险\n- 重构可能破坏现有行为，需跑测试验证。\n"
                )
                self.wfile.write(chunk({"content": plan_text}))
            elif marker_write or marker_rm:
                self.wfile.write(chunk({"content": "工具调用已处理，见上文结果。"}))
            else:
                self.wfile.write(chunk({"content": "读完了，工作区里有一个 README.md。"}))
            self.wfile.flush()
            time.sleep(0.3)
        elif marker_write:
            self.wfile.write(chunk({
                "tool_calls": [{
                    "index": 0,
                    "id": "call_mock_write",
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "arguments": "{\"path\": \"plan-test.txt\", \"content\": \"计划模式测试写入。\\n\"}",
                    },
                }],
            }, finish="tool_calls"))
            self.wfile.flush()
            time.sleep(0.5)
        elif marker_rm:
            self.wfile.write(chunk({
                "tool_calls": [{
                    "index": 0,
                    "id": "call_mock_rm",
                    "type": "function",
                    "function": {
                        "name": "run_shell",
                        "arguments": "{\"command\": \"rm -f test-delete.txt\"}",
                    },
                }],
            }, finish="tool_calls"))
            self.wfile.flush()
            time.sleep(0.5)
        else:
            self.wfile.write(chunk({
                "tool_calls": [{
                    "index": 0,
                    "id": "call_mock_1",
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "arguments": "{\"path\": \"README.md\"}",
                    },
                }],
            }, finish="tool_calls"))
            self.wfile.flush()
            time.sleep(0.5)
        # Final usage frame (real token numbers from the "provider").
        self.wfile.write(sse({
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 42, "completion_tokens": 18, "total_tokens": 60},
        }))
        self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    with open(LOG, "w", encoding="utf-8") as f:
        f.write("mock server started\n")
    ThreadingHTTPServer(("127.0.0.1", 8791), Handler).serve_forever()
