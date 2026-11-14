#!/usr/bin/env python3
"""Render CLI mockups 04/05/06 (splash / thinking / tools), dark + light.

Reuses the helpers in render_mockups.py (do not modify that file).
Canvas: 80 cols x 24 rows. Palettes per design doc §4, no gold anywhere.
Outputs (mockups/):
  mockup-04-splash.png / mockup-04-splash-light.png   (S0, 3 frames)
  mockup-05-thinking.png / mockup-05-thinking-light.png (S3)
  mockup-06-tools.png / mockup-06-tools-light.png     (S4)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_mockups as R
from PIL import Image

BASE = R.BASE
MASCOT = "/home/hatch/workspace/cassell-agent/cli-design/mascot"


def cx(text, bold=False):
    """x that centers `text` on the canvas."""
    return int((R.W - R.seg_width(text, bold)) / 2)


def paste_mascot(img, name, h, cx_px=None, y=None, smooth=False):
    """Paste a mascot PNG scaled to height h, centered horizontally
    unless cx_px is given. Returns the (x, y) it was pasted at.
    smooth=True uses LANCZOS (better for tiny sizes like the spinner)."""
    m = Image.open(os.path.join(MASCOT, name))
    w = int(m.width * h / m.height)
    m = m.resize((w, h), Image.LANCZOS if smooth else Image.NEAREST)
    x = int((R.W - w) / 2) if cx_px is None else cx_px
    img.paste(m, (x, y), m)
    return x, y, w, h


def centered_line(d, row, segments):
    """line() but horizontally centered. segments: (text, color, bold)."""
    total = sum(R.seg_width(t, b) for t, _, b in segments)
    x = int((R.W - total) / 2)
    R.line(d, row, segments, x=x)


# ============================================================
# Mockup 4 — S0 Splash: 3 frames in one image (0.0s / 0.4s / 0.8s)
# ============================================================
def mockup_splash():
    img, d = R.new_canvas()

    # --- frame 1: 0.0s — night, dim stars, small title, noya eyes closed
    R.line(d, 0, [("0.0s", R.TEXT3, False)])
    stars = [(6, 1), (20, 2), (34, 1), (52, 2), (66, 1), (74, 3),
             (12, 4), (44, 3), (58, 4), (70, 5), (28, 5)]
    for col, row in stars:
        R.draw_text(d, R.PAD + col * R.CJK_W, R.y_of(row), "·", R.TEXT3)
    centered_line(d, 2, [("卡塞尔学院", R.TEXT2, False)])
    paste_mascot(img, "dragon-v11-closed.png", 104, y=R.y_of(3))

    R.divider(d, 7)

    # --- frame 2: 0.4s — eyes open, greeting
    R.line(d, 8, [("0.4s", R.TEXT3, False)])
    paste_mascot(img, "dragon-v11-open.png", 104, y=R.y_of(9))
    centered_line(d, 13, [("欢迎你，路专员", R.TEXT, True)])

    R.divider(d, 15)

    # --- frame 3: 0.8s — info line + input with blinking cursor
    R.line(d, 16, [("0.8s", R.TEXT3, False)])
    centered_line(d, 18, [
        ("S2017-0117  ·  ", R.TEXT2, False),
        ("NORMA", R.BLUE, True),
        ("  ·  deepseek-flash  ·  上下文 0%", R.TEXT2, False),
    ])
    # input row, centered: "> " + solid block cursor
    prompt_w = R.seg_width("> ", True)
    cur_w, cur_h = 11, 18
    x0 = int((R.W - prompt_w - cur_w - 6) / 2)
    R.line(d, 20, [("> ", R.TEXT2, True)], x=x0)
    d.rectangle([x0 + prompt_w + 6, R.y_of(20) + 4,
                 x0 + prompt_w + 6 + cur_w, R.y_of(20) + 4 + cur_h],
                fill=R.BLUE)
    centered_line(d, 22, [("1 秒三帧 · 任意键跳过", R.TEXT3, False)])

    return img


# ============================================================
# Mockup 5 — S3 Thinking
# ============================================================
def mockup_thinking():
    img, d = R.new_canvas()
    R.status_a(d, 0)
    R.divider(d, 1)
    R.user_msg(d, 2, "帮我查一下时间零是几号言灵")
    R.line(d, 4, [("正在调阅学院档案…", R.TEXT, False)])

    # thinking line: noya (eyes open) as the spinner + the status text
    # mascot shifted up ~half a row so its centre lines up with the text
    mx, my, mw, mh = paste_mascot(img, "dragon-v11-open.png", 52,
                                  cx_px=R.PAD, y=R.y_of(9) - 13, smooth=True)
    tx = mx + mw + 14
    R.line(d, 9, [
        ("◉ ", R.BLUE, True),
        ("言灵共鸣中… ", R.TEXT, False),
        ("(8s · ↓ 312 tokens · ", R.TEXT3, False),
        ("esc", R.TEXT2, False),
        (" 中断)", R.TEXT3, False),
    ], x=tx)
    # round-end summary, dim
    R.line(d, 11, [
        ("◉ ", R.TEXT3, True),
        ("想了 8s · 用了 312 tokens", R.TEXT3, False),
    ], x=tx)

    R.divider(d, 21)
    R.input_row(d, 22)
    R.status_c_idle(d, 23)
    return img


# ============================================================
# Mockup 6 — S4 Tool calls
# ============================================================
def mockup_tools():
    img, d = R.new_canvas()
    R.status_a(d, 0)
    R.divider(d, 1)
    R.user_msg(d, 2, "帮我把登录接口的超时改成 5 秒")

    # completed: grey bullet; failed: red bullet + red short tag
    R.tool_row(d, 4, "Read", "src/api/auth.ts", color=R.TEXT3)
    R.result_row(d, 5, "Read 128 lines")
    R.tool_row(d, 6, "Edit", "src/api/auth.ts", color=R.TEXT3)
    R.result_row(d, 7, "Updated 2 lines")
    R.tool_row(d, 8, "Bash", "npm test", color=R.RED)
    R.line(d, 9, [
        ("⎿ ", R.TEXT3, False),
        ("3 passed, ", R.TEXT3, False),
        ("1 failed", R.RED, True),
        ("  · 失败", R.RED, True),
    ])

    # read-only aggregate row (in progress: EVA blue bullet)
    R.line(d, 11, [
        ("● ", R.BLUE, True),
        ("Searching for 1 pattern, reading 2 files…", R.TEXT, False),
    ])
    # semantic rendering of a sed command
    R.line(d, 13, [
        ("● ", R.TEXT3, True),
        ("Read file", R.TEXT, True),
        (" (lines 1-200)", R.TEXT2, False),
    ])
    R.line(d, 14, [("  ⎿ sed 命令 · 已语义渲染", R.TEXT3, False)])

    R.line(d, 16, [("超时已改好，但有 1 个测试没过，要我接着修吗？", R.TEXT, False)])

    R.divider(d, 21)
    R.input_row(d, 22)
    R.status_c_idle(d, 23)
    return img


def main():
    jobs = [
        ("mockup-04-splash", mockup_splash),
        ("mockup-05-thinking", mockup_thinking),
        ("mockup-06-tools", mockup_tools),
    ]
    for theme, suffix in (("dark", ""), ("light", "-light")):
        R.set_theme(theme)
        for name, fn in jobs:
            img = fn()
            path = f"{BASE}/{name}{suffix}.png"
            img.save(path)
            print(f"saved {os.path.basename(path)}")


if __name__ == "__main__":
    main()
