#!/usr/bin/env python3
"""Render mockups 07/08/09 (Diff / First-run wizard / Help) in dark + light.

Own script (does NOT modify render_mockups.py): imports its helpers and
theme palettes. Canvas 80 cols x 24 rows. Colors per design doc §4.
No gold anywhere.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_mockups as R

BASE = R.BASE


def _save(img, name):
    img.save(f"{BASE}/{name}")
    print(f"saved {name}")


# ============================================================
# Mockup 7 — Diff (S5): unified diff, no box, line-number gutter
# ============================================================
def mockup_diff(theme):
    R.set_theme(theme)
    suffix = "-light" if theme == "light" else ""
    img, d = R.new_canvas()

    R.status_a(d, 0)
    R.divider(d, 1)
    R.user_msg(d, 2, "帮我把登录接口的超时改成 5 秒")
    R.tool_row(d, 3, "Edit", "src/api/auth.ts")
    R.result_row(d, 4, "Updated 2 lines")
    R.line(d, 5, [("已改好：超时从 3 秒改为 5 秒，本地测试通过。", R.TEXT, False)])

    # file header: name + counts (+1 green, -1 red)
    R.line(d, 7, [
        ("src/api/auth.ts", R.TEXT2, False),
        ("  ·  1 file ", R.TEXT3, False),
        ("+1", R.GREEN, True),
        (" ", R.TEXT3, False),
        ("−1", R.RED, True),
    ])
    # line-number gutter: "  9 │" style, numbers in dim, content plain
    gutter_x = R.PAD
    content_x = R.PAD + int(5.5 * R.CJK_W)
    # context line above
    R.line(d, 8, [("   9 │ ", R.TEXT3, False)],
           x=gutter_x)
    R.line(d, 8, [("    const API_URL = '/api/login';", R.TEXT2, False)],
           x=content_x)
    # deleted line: full-width red tint, no syntax highlight
    d.rectangle([R.PAD, R.y_of(9), R.W - R.PAD, R.y_of(9) + R.ROW_H],
                fill=R.DIFF_DEL_BG)
    R.line(d, 9, [("  10 │ ", R.TEXT3, False)], x=gutter_x)
    R.line(d, 9, [("−   timeout: 3000", R.RED, False)], x=content_x)
    # added line: full-width green tint
    d.rectangle([R.PAD, R.y_of(10), R.W - R.PAD, R.y_of(10) + R.ROW_H],
                fill=R.DIFF_ADD_BG)
    R.line(d, 10, [("  10 │ ", R.TEXT3, False)], x=gutter_x)
    R.line(d, 10, [("+   timeout: 5000", R.GREEN, False)], x=content_x)
    # context line below
    R.line(d, 11, [("  11 │ ", R.TEXT3, False)], x=gutter_x)
    R.line(d, 11, [("    return fetch(API_URL, { timeout });", R.TEXT2, False)],
           x=content_x)

    # collapsed form (second file group, folded)
    R.line(d, 13, [
        ("▸  ", R.TEXT3, False),
        ("2 files ", R.TEXT, False),
        ("+3", R.GREEN, True),
        (" ", R.TEXT3, False),
        ("−1", R.RED, True),
        ("   （已折叠，按 Enter 展开）", R.TEXT3, False),
    ])
    R.line(d, 14, [
        ("▸  ", R.TEXT3, False),
        ("src/api/auth.test.ts", R.TEXT2, False),
        ("  ·  ", R.TEXT3, False),
        ("+2", R.GREEN, False),
        (" ", R.TEXT3, False),
        ("−0", R.TEXT3, False),
    ])

    R.line(d, 16, [
        ("◉ ", R.BLUE, True),
        ("想了 8s · 用了 312 tokens", R.TEXT3, False),
    ])
    R.line(d, 17, [
        ("按 ", R.TEXT3, False),
        ("/diff", R.TEXT2, False),
        (" 看工作区改动，可按回合过滤", R.TEXT3, False),
    ])

    R.divider(d, 21)
    R.input_row(d, 22)
    R.status_c_idle(d, 23)
    _save(img, f"mockup-07-diff{suffix}.png")


# ============================================================
# Mockup 8 — First-run wizard (S7): 4 steps, no Key = no chat
# ============================================================
def mockup_wizard(theme):
    R.set_theme(theme)
    suffix = "-light" if theme == "light" else ""
    img, d = R.new_canvas()

    R.line(d, 0, [
        ("卡塞尔 CLI · 首次设置", R.TEXT, True),
        ("（4 步，随时可用 /setup 重跑）", R.TEXT3, False),
    ])
    R.divider(d, 1)

    # step 1
    R.line(d, 3, [("①  ", R.BLUE, True), ("选 provider 与模型", R.TEXT, True)])
    R.line(d, 4, [
        ("     DeepSeek", R.TEXT, False),
        ("（推荐）", R.BLUE, True),
        ("  /  其他 OpenAI 兼容端点  /  本地 Ollama", R.TEXT2, False),
    ])
    # step 2
    R.line(d, 6, [("②  ", R.BLUE, True), ("语言 + 主题", R.TEXT, True)])
    R.line(d, 7, [
        ("     简体中文", R.TEXT, False),
        ("  ·  ", R.TEXT3, False),
        ("dark", R.TEXT, True),
        ("  /  light  /  auto", R.TEXT2, False),
    ])
    # step 3
    R.line(d, 9, [("③  ", R.BLUE, True), ("工作区", R.TEXT, True)])
    R.line(d, 10, [("     选择一个文件夹作为工作区", R.TEXT, False)])
    R.line(d, 11, [
        ("     （文件工具只在这个文件夹里活动）", R.TEXT3, False),
    ])
    # step 4
    R.line(d, 13, [("④  ", R.BLUE, True), ("快捷键", R.TEXT, True)])
    R.line(d, 14, [
        ("     ", R.TEXT, False),
        ("Shift+Tab", R.TEXT2, False), (" 切模式  ·  ", R.TEXT3, False),
        ("Tab", R.TEXT2, False), (" 排队  ·  ", R.TEXT3, False),
        ("Ctrl+O", R.TEXT2, False), (" 转录  ·  ", R.TEXT3, False),
        ("?", R.TEXT2, False), (" 帮助", R.TEXT3, False),
    ])

    # hard rule: no Key, no chat
    R.line(d, 16, [
        ("⚠  ", R.RED, True),
        ("没配 Key 不许进聊天", R.RED, True),
        ("：向导完成前不显示假模型、不显示假连接", R.TEXT3, False),
    ])
    R.line(d, 17, [
        ("     跳过向导进空会话，卡上会写“还没有配置模型，按 ", R.TEXT3, False),
        ("/provider", R.TEXT2, False),
        (" 开始”", R.TEXT3, False),
    ])

    # buttons: [ 下一步 ] focused (blue bg, dark text), [ 跳过 ] dim
    by = R.y_of(19)
    bx = R.PAD + 20
    bw = R.seg_width(" 下一步 ", True) + 16
    bh = R.ROW_H - 4
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=6, fill=R.BLUE)
    R.draw_text(d, bx + 8, by + 1, "下一步", R.BG, bold=True)
    bx2 = bx + bw + 24
    R.draw_text(d, bx2, by + 1, "跳过", R.TEXT3, bold=False)
    R.line(d, 19, [
        ("            ← → 切换 · Enter 下一步 · Esc 跳过", R.TEXT3, False),
    ], x=bx2 + R.seg_width("跳过", False) + 24)

    R.divider(d, 21)
    R.input_row(d, 22)
    R.status_c_idle(d, 23)
    _save(img, f"mockup-08-wizard{suffix}.png")


# ============================================================
# Mockup 9 — Help (S8): '?' panel (top) + '/' menu (bottom), one image
# ============================================================
def mockup_help(theme):
    R.set_theme(theme)
    suffix = "-light" if theme == "light" else ""
    img, d = R.new_canvas()

    R.status_a(d, 0)
    R.divider(d, 1)

    # --- top half: '?' shortcut help, two columns, no box ---
    R.line(d, 2, [
        ("?  快捷键帮助", R.TEXT, True),
        ("   （按 ? 或 Esc 关闭）", R.TEXT3, False),
    ])
    key_x = R.PAD + 8
    act_x = R.PAD + int(17 * R.CJK_W)
    R.line(d, 3, [("按键", R.TEXT3, False)], x=key_x)
    R.line(d, 3, [("作用", R.TEXT3, False)], x=act_x)
    shortcuts = [
        ("Shift+Tab", "切换 NORMA / EVA（换工位）"),
        ("Tab", "工作时排队下一条；空闲时接受补全"),
        ("Ctrl+O", "转录视图"),
        ("Ctrl+R", "反向搜索历史"),
        ("Esc", "中断；Esc×2 改上一条消息"),
        ("Enter", "发送；工作时立即插进当前轮"),
        ("?", "快捷键帮助"),
    ]
    for i, (key, action) in enumerate(shortcuts):
        row = 4 + i
        R.line(d, row, [(key, R.TEXT2, False)], x=key_x)
        R.line(d, row, [(action, R.TEXT, False)], x=act_x)

    R.divider(d, 11)

    # --- bottom half: '/' completion menu ---
    R.line(d, 12, [
        ("/  命令菜单", R.TEXT, True),
        ("   （输入 / 弹出补全，Tab 接受）", R.TEXT3, False),
    ])
    commands = [
        ("/help", "全部命令与快捷键"),
        ("/model", "换模型"),
        ("/permissions", "改审批策略"),
        ("/plan", "进 / 出计划模式"),
        ("/compact", "手动压缩上下文一次"),
        ("/new", "新会话"),
        ("/resume", "继续最近的会话"),
        ("/status", "模型、上下文、成本详情"),
    ]
    for i, (cmd, desc) in enumerate(commands):
        row = 13 + i
        if i == 0:
            # selected row: soft background, blue command
            d.rectangle([R.PAD, R.y_of(row), R.W - R.PAD,
                         R.y_of(row) + R.ROW_H], fill=R.BG_SOFT)
            R.line(d, row, [("  " + cmd, R.BLUE, True)], x=key_x - 8)
            R.line(d, row, [(desc, R.TEXT, False)], x=act_x)
        else:
            R.line(d, row, [("  " + cmd, R.TEXT, False)], x=key_x - 8)
            R.line(d, row, [(desc, R.TEXT3, False)], x=act_x)
    # +2 count line: ghost text hint lives in the input row below
    # (menu shows 8 of 10; footer carries the count)
    # NOTE: rows 13-20 are the 8 commands; row 21 is the divider, so the
    # +2 count is drawn on the input row itself (see below).

    R.divider(d, 21)
    # input row with '/' typed + ghost completion 'help' + '+2' count
    R.line(d, 22, [
        ("> ", R.TEXT2, True),
        ("/he", R.TEXT, False),
        ("lp", R.TEXT3, False),
        ("   +2", R.TEXT2, False),
        ("   （Tab 接受补全）", R.TEXT3, False),
    ])
    R.status_c_idle(d, 23)
    _save(img, f"mockup-09-help{suffix}.png")


if __name__ == "__main__":
    for theme in ("dark", "light"):
        mockup_diff(theme)
        mockup_wizard(theme)
        mockup_help(theme)
