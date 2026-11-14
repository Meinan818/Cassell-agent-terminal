#!/usr/bin/env python3
"""Render mockup-10 (transcript, S9) and mockup-11 (mode switch, S10),
dark + light. Reuses helpers from render_mockups.py; does not modify it.

Canvas: 80 cols x 24 rows. Run: python3 render_mockups_1011.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_mockups as R

BASE = R.BASE


def mockup_transcript():
    """S9: transcript view (Ctrl+O) + half of the /status detail page.
    An independent screen: timestamps + model per assistant message,
    expanded tool rows and diff detail, then /status (model, exact
    context numbers + progress bar, TPS, cache hit rate, cost, Git)."""
    img, d = R.new_canvas()

    # --- title ---
    R.line(d, 0, [("转录视图", R.TEXT, True),
                  ("  ·  TRANSCRIPT", R.TEXT2, False),
                  ("    Ctrl+O 退出 · Esc 返回", R.TEXT3, False)])
    R.divider(d, 1)

    # --- round 1: user + assistant (with timestamp + model) ---
    R.line(d, 2, [("14:31  ", R.TEXT3, False),
                  ("❯ ", R.BLUE, True),
                  ("帮我把登录接口的超时改成 5 秒", R.TEXT, False)])
    R.line(d, 3, [("14:32 · deepseek-flash", R.TEXT2, False)])
    R.line(d, 4, [("已改好：超时从 3 秒改为 5 秒，本地测试通过。", R.TEXT, False)])
    # expanded tool row: lifecycle mark + diff detail (normally folded)
    R.line(d, 5, [("● ", R.BLUE, True),
                  ("Edit", R.TEXT, True),
                  ("(src/api/auth.ts)  ", R.TEXT2, False),
                  ("✓ done", R.GREEN, False)])
    d.rectangle([R.PAD, R.y_of(6), R.W - R.PAD, R.y_of(6) + R.ROW_H],
                fill=R.DIFF_DEL_BG)
    R.line(d, 6, [("−   timeout: 3000", R.RED, False)])
    d.rectangle([R.PAD, R.y_of(7), R.W - R.PAD, R.y_of(7) + R.ROW_H],
                fill=R.DIFF_ADD_BG)
    R.line(d, 7, [("+   timeout: 5000", R.GREEN, False)])
    R.line(d, 8, [("⎿ ", R.TEXT3, False),
                  ("Updated 2 lines · 8s · ↓ 96 tokens", R.TEXT3, False)])

    # --- round 2: user + assistant, with a failed test (full error here) ---
    R.line(d, 9, [("14:35  ", R.TEXT3, False),
                  ("❯ ", R.BLUE, True),
                  ("再跑一遍测试确认一下", R.TEXT, False)])
    R.line(d, 10, [("14:36 · deepseek-flash", R.TEXT2, False)])
    R.line(d, 11, [("测试跑完了：3 通过，1 失败，失败的是超时用例。", R.TEXT, False)])
    R.line(d, 12, [("● ", R.BLUE, True),
                   ("Bash", R.TEXT, True),
                   ("(npm test)  ", R.TEXT2, False),
                   ("✓ done", R.GREEN, False)])
    R.line(d, 13, [("⎿ ", R.TEXT3, False),
                   ("3 passed, ", R.TEXT3, False),
                   ("1 failed", R.RED, False)])
    # expanded error detail (only visible in transcript, not main chat)
    d.rectangle([R.PAD, R.y_of(14), R.W - R.PAD, R.y_of(14) + R.ROW_H],
                fill=R.BG_SOFT)
    R.line(d, 14, [("  ✖ 超时用例：expected 5000ms, got 3000ms", R.RED, False)])

    R.divider(d, 15)

    # --- /status detail page (half of it) ---
    R.line(d, 16, [("/status 详情", R.TEXT, True),
                   ("  ·  模型 / 上下文 / 成本 / Git", R.TEXT3, False)])
    R.line(d, 17, [("模型  ", R.TEXT3, False),
                   ("deepseek-flash", R.TEXT, False),
                   ("  ·  High", R.TEXT2, False)])
    R.line(d, 18, [("上下文  ", R.TEXT3, False),
                   ("18,432 / 80,000 tokens", R.TEXT, False),
                   ("  ·  23%", R.TEXT2, False)])
    # progress bar: 23% filled (rectangles, not glyphs)
    bx0, bx1 = R.PAD, R.W - R.PAD
    by0 = R.y_of(19) + 8
    d.rectangle([bx0, by0, bx1, by0 + 10], fill=R.BORDER)
    d.rectangle([bx0, by0, bx0 + int((bx1 - bx0) * 0.23), by0 + 10],
                fill=R.BLUE)
    R.line(d, 20, [("TPS  ", R.TEXT3, False),
                   ("42.6", R.TEXT, False),
                   ("  ·  缓存命中率  ", R.TEXT3, False),
                   ("87%", R.TEXT, False)])
    R.line(d, 21, [("成本  ", R.TEXT3, False),
                   ("本会话 ¥0.12", R.TEXT, False),
                   ("  ·  累计 ¥1.48", R.TEXT2, False)])
    R.line(d, 22, [("Git  ", R.TEXT3, False),
                   ("main ●", R.TEXT, False),
                   ("  ·  工作区干净", R.TEXT2, False)])
    R.line(d, 23, [("↑↓ 滚动 · Enter 展开/折叠 · Ctrl+O 退出转录", R.TEXT3, False)])
    return img


def mockup_mode_switch():
    """S10: one Shift+Tab mode switch on the main chat screen.
    A NORMA round, then a dim separator line, then status bar A flips
    to EVA (blue ball + EVA name) and an EVA-voiced thinking line."""
    img, d = R.new_canvas()

    # --- before: NORMA ---
    R.status_a(d, 0)  # ◉ NORMA · Ask · S · deepseek-flash · High · 上下文 23% · main ●
    R.divider(d, 1)
    R.user_msg(d, 2, "帮我整理一下今天的待办")
    R.line(d, 4, [("已按优先级排好：先回导师邮件，再改登录超时。", R.TEXT, False)])
    R.line(d, 5, [("◉ 想了 6s · 用了 208 tokens", R.TEXT3, False)])

    # --- the switch: dim separator, then status bar A becomes EVA ---
    sep = "── EVA 已就位（工程开发）──"
    w = R.seg_width(sep, False)
    R.line(d, 6, [(sep, R.TEXT3, False)],
           x=R.PAD + int((R.W - 2 * R.PAD - w) / 2))
    R.status_a(d, 7, ctx="上下文 23%", branch="main ●", mode="EVA")
    R.divider(d, 8)

    # --- after: EVA working (EVA-voiced thinking verb) ---
    R.line(d, 9, [
        ("◉ ", R.BLUE, True),
        ("正在解析龙文… ", R.TEXT, False),
        ("(4s · ↓ 96 tokens · ", R.TEXT3, False),
        ("esc", R.TEXT2, False),
        (" 中断)", R.TEXT3, False),
    ])
    R.user_msg(d, 10, "把登录超时改成 5 秒")
    R.tool_row(d, 12, "Read", "src/api/auth.ts")
    R.result_row(d, 13, "Read 128 lines")
    R.tool_row(d, 14, "Edit", "src/api/auth.ts")
    R.result_row(d, 15, "Updated 2 lines")
    R.line(d, 16, [("已改好：超时 5 秒，测试全过。", R.TEXT, False)])
    R.line(d, 18, [("Shift+Tab 切换 = 开新任务 · 上下文保留在历史里，分界线就是证据",
                    R.TEXT3, False)])

    R.divider(d, 21)
    R.input_row(d, 22)
    R.line(d, 23, [
        ("◉ ", R.TEXT, True),
        ("EVA 待命 · 输入 ", R.TEXT3, False),
        ("/", R.TEXT2, False),
        (" 查看帮助，", R.TEXT3, False),
        ("esc", R.TEXT2, False),
        (" 退出", R.TEXT3, False),
    ])
    return img


if __name__ == "__main__":
    print(f"canvas {R.W}x{R.H}")
    for theme, suffix in (("dark", ""), ("light", "-light")):
        R.set_theme(theme)
        mockup_transcript().save(f"{BASE}/mockup-10-transcript{suffix}.png")
        print(f"saved mockup-10-transcript{suffix}.png")
        mockup_mode_switch().save(f"{BASE}/mockup-11-mode-switch{suffix}.png")
        print(f"saved mockup-11-mode-switch{suffix}.png")
