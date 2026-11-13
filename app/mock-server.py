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
            f"tools_in_history={any(m.get('role') == 'tool' for m in body.get('messages', []))}")
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
            self.wfile.write(chunk({"content": "读完了，工作区里有一个 README.md。"}))
            self.wfile.flush()
            time.sleep(0.3)
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
