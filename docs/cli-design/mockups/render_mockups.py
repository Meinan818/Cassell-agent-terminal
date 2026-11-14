#!/usr/bin/env python3
"""Render the 3 CLI design mockups (welcome / main chat / approval) as PNGs.

Terminal grid: 80 cols x 24 rows. Colors/fonts per the design doc v1.0.
Glyph fallback: Noto Sans Mono CJK SC -> DejaVu Sans Mono; U+23FA (not in
either font) is substituted with U+25CF (visually identical at this size).
"""
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTCollection, TTFont

BASE = "/home/hatch/workspace/cassell-agent/cli-design/mockups"

# ---- colors (design doc §4, beautified 2026-11-14) ----
# The user called the old look "a plain black terminal". So the base is
# no longer near-black: a deep navy with layered panels, an ice-blue
# accent, and a solid status bar. No gold anywhere (iron rule).
BG = (11, 18, 32)          # deep navy #0b1220 (was #141413 near-black)
BG_SOFT = (20, 29, 51)     # panel #141d33
BG_PANEL = (26, 39, 69)     # header band #1a2745
BORDER = (42, 58, 95)       # panel border #2a3a5f
TEXT = (232, 230, 220)
TEXT2 = (168, 180, 200)     # blue-gray (was plain gray)
TEXT3 = (90, 106, 133)      # muted blue-gray
BLUE = (96, 165, 250)
CYAN = (103, 232, 249)      # secondary accent #67e8f9
GREEN = (120, 140, 93)
RED = (196, 84, 74)
YELLOW = (184, 154, 74)
DIFF_ADD_BG = (34, 48, 32)
DIFF_DEL_BG = (52, 32, 30)

# ---- fonts ----
FS = 17
NOTO_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
NOTO_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
DEJ_R = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
DEJ_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
IDX = 7

f_noto = ImageFont.truetype(NOTO_R, FS, index=IDX)
f_noto_b = ImageFont.truetype(NOTO_B, FS, index=IDX)
f_dej = ImageFont.truetype(DEJ_R, FS)
f_dej_b = ImageFont.truetype(DEJ_B, FS)

_noto_cmap = TTCollection(NOTO_R).fonts[IDX].getBestCmap()
_dej_cmap = TTFont(DEJ_R).getBestCmap()
SUBST = {"⏺": "●"}  # U+23FA not in either font


def font_for(ch, bold):
    # cmap keys are codepoint ints, not characters
    cp = ord(ch)
    if cp in _noto_cmap:
        return f_noto_b if bold else f_noto
    if cp in _dej_cmap:
        return f_dej_b if bold else f_dej
    return None


def seg_width(text, bold):
    w = 0
    for ch in text:
        ch = SUBST.get(ch, ch)
        f = font_for(ch, bold) or f_noto
        w += f.getlength(ch)
    return w


def draw_text(draw, x, y, text, color, bold=False):
    """Draw text with per-char font fallback; returns width drawn."""
    cur = x
    buf, buf_font = "", None
    def flush():
        nonlocal cur, buf, buf_font
        if buf:
            draw.text((cur, y), buf, font=buf_font, fill=color)
            cur += buf_font.getlength(buf)
            buf, buf_font = "", None
    for ch in text:
        ch = SUBST.get(ch, ch)
        f = font_for(ch, bold) or f_noto
        if f is not buf_font:
            flush()
            buf_font = f
        buf += ch
    flush()
    return cur - x


# ---- terminal grid ----
COLS, ROWS = 80, 24
PAD = 28
ROW_H = 26
CJK_W = f_noto.getlength("中")
W = int(PAD * 2 + COLS * CJK_W)
H = int(PAD * 2 + ROWS * ROW_H)


def new_canvas():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)


def y_of(row):
    return PAD + row * ROW_H


def divider(draw, row):
    y = y_of(row) + ROW_H // 2
    draw.line([(PAD, y), (W - PAD, y)], fill=TEXT3, width=1)


def line(draw, row, segments, x=PAD):
    """segments: list of (text, color, bold)."""
    cur = x
    for text, color, bold in segments:
        cur += draw_text(draw, cur, y_of(row), text, color, bold)
    return cur


def status_bar_solid(draw, row, ctx="上下文 0%", branch="main ●", mode="NORMA"):
    """A real status bar: solid ice-blue band, dark text (like tmux/vim).
    The old text-only status line is what made it feel like a plain
    terminal; a solid bar anchors the bottom of the screen."""
    y0 = y_of(row)
    draw.rectangle([PAD, y0, W - PAD, y0 + ROW_H], fill=BLUE)
    dark = BG
    x = PAD + 8
    parts = [
        ("◉ ", dark, True),
        (mode + "  ·  ", dark, False),
        ("S", dark, True),
        ("  ·  ", dark, False),
        ("deepseek-flash  ·  High  ·  " + ctx + "  ·  " + branch, dark, False),
    ]
    cur = x
    for text, color, bold in parts:
        cur += draw_text(draw, cur, y0, text, color, bold)


def status_a(draw, row, ctx="上下文 23%", branch="main ●", mode="NORMA"):
    status_bar_solid(draw, row, ctx, branch, mode)


def status_c_idle(draw, row):
    line(draw, row, [
        ("◉ ", TEXT, True),
        ("诺玛待命 · 输入 ", TEXT3, False),
        ("/", TEXT2, False),
        (" 查看帮助，", TEXT3, False),
        ("esc", TEXT2, False),
        (" 退出", TEXT3, False),
    ])


def input_row(draw, row):
    line(draw, row, [
        ("> ", TEXT2, True),
        ("●", BLUE, True),
    ])


def user_msg(draw, row, text):
    line(draw, row, [("❯ ", BLUE, True), (text, TEXT, False)])


def tool_row(draw, row, name, arg, color=TEXT2):
    line(draw, row, [
        ("● ", color, True),
        (name, TEXT, True),
        ("(" + arg + ")", TEXT2, False),
    ])


def result_row(draw, row, text, color=TEXT3):
    line(draw, row, [("⎿ ", TEXT3, False), (text, color, False)])


# ============================================================
# Mockup 1 — Welcome
# ============================================================
def mockup_welcome():
    # Beautified welcome (2026-11-14): the user called the old welcome
    # "a plain black terminal, an ugly blue mascot, a pile of text".
    # So this is a real beautification, not another layout tweak:
    #   - deep navy background (not black) + layered panels = depth
    #   - a big title band up top (the academy, not a text line)
    #   - the welcome content on ONE rounded panel (fill + border),
    #     sections marked with icons and accent colours, not bare text
    #   - the mascot shrunk to a small badge in the header (it is an
    #     accent now, not the centrepiece)
    #   - a solid ice-blue status bar anchoring the bottom
    img, d = new_canvas()
    f_title = ImageFont.truetype(NOTO_B, 32, index=IDX)
    f_sub = f_noto

    # Desktop pet (2026-11-14 §2.4): the mascot is not a parked badge
    # any more — it lives on the top layer and wanders back and forth.
    # This frame shows it mid-walk (walk-R-A, moving right, right foot
    # stepping), placed mid-track rather than at the far right edge.
    mascot = Image.open(
        "/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v11-walk-R-A.png"
    )  # keep RGBA (transparent) — do not convert to RGB
    # small badge, not a centrepiece: ~4 rows tall
    mw, mh = 116, 81
    mascot = mascot.resize((mw, mh), Image.NEAREST)

    # --- header band: big title + subtitle + small mascot badge ---
    hb_y0, hb_y1 = y_of(0), y_of(2) + ROW_H
    d.rectangle([PAD, hb_y0, W - PAD, hb_y1], fill=BG_PANEL)
    # thin ice accent line under the band
    d.line([(PAD, hb_y1), (W - PAD, hb_y1)], fill=BLUE, width=2)
    d.text((PAD + 20, hb_y0 + 8), "CASSELL COLLEGE", font=f_title, fill=TEXT)
    d.text((PAD + 20, hb_y0 + 48), "COMMISSIONER TERMINAL",
           font=f_sub, fill=TEXT2)
    # desktop pet mid-walk: placed mid-track (not parked at the edge),
    # so the frame reads as "wandering", not "sitting in the corner"
    img.paste(mascot, (int(W * 0.62), hb_y0 + 6), mascot)

    # --- welcome card: one rounded panel holding everything ---
    cx0, cx1 = PAD, W - PAD
    cy0, cy1 = y_of(4), y_of(18) + ROW_H
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=10,
                        fill=BG_SOFT, outline=BORDER, width=1)

    # greeting
    line(d, 5, [("欢迎你，路专员", TEXT, True)], x=PAD + 20)
    line(d, 6, [("S2017-0117  ·  ", TEXT2, False),
                ("血统 S", BLUE, True),
                ("  ·  学院唯一的 S 级学生", TEXT3, False)], x=PAD + 20)
    # today spirit (accent row)
    line(d, 8, [("◆ ", CYAN, True),
                ("今日言灵  ", TEXT, True),
                ("时间零 (84)  ·  昂热  ·  延缓时间", TEXT2, False)], x=PAD + 20)
    # divider inside the card
    d.line([(cx0 + 20, y_of(9) + ROW_H // 2),
            (cx1 - 20, y_of(9) + ROW_H // 2)], fill=BORDER, width=1)

    # two columns: recent sessions | quick entries
    mid_x = PAD + 40 * CJK_W
    lx, rx = PAD + 20, int(mid_x) + 20
    line(d, 10, [("◈ ", BLUE, True), ("最近的会话", TEXT, True)], x=lx)
    line(d, 11, [("·  ", TEXT3, False), ("登录接口超时调整", TEXT2, False),
                 ("（2 小时前）", TEXT3, False)], x=lx)
    line(d, 12, [("·  ", TEXT3, False), ("毕业设计任务书整理", TEXT2, False),
                 ("（昨天）", TEXT3, False)], x=lx)
    line(d, 10, [("▶ ", CYAN, True), ("常用入口", TEXT, True)], x=rx)
    line(d, 11, [("/resume", BLUE, False), ("  继续上次会话   ", TEXT2, False),
                 ("/new", BLUE, False), ("  新会话", TEXT2, False)], x=rx)
    line(d, 12, [("/model", BLUE, False), ("   换模型          ", TEXT2, False),
                 ("/help", BLUE, False), ("  全部命令", TEXT2, False)], x=rx)
    # divider inside the card
    d.line([(cx0 + 20, y_of(13) + ROW_H // 2),
            (cx1 - 20, y_of(13) + ROW_H // 2)], fill=BORDER, width=1)

    # shortcuts strip
    line(d, 14, [("⌘ ", BLUE, True), ("快捷键  ", TEXT, True),
                 ("Shift+Tab", TEXT2, False), (" 切模式  ·  ", TEXT3, False),
                 ("Tab", TEXT2, False), (" 排队  ·  ", TEXT3, False),
                 ("Ctrl+O", TEXT2, False), (" 转录  ·  ", TEXT3, False),
                 ("?", TEXT2, False), (" 帮助", TEXT3, False)], x=PAD + 20)
    line(d, 15, [("输入问题，诺玛会调阅学院档案帮你处理。按 ", TEXT3, False),
                 ("/", TEXT2, False), (" 查看全部命令。", TEXT3, False)],
         x=PAD + 20)
    line(d, 17, [("按 ", TEXT3, False), ("Shift+Tab", TEXT2, False),
                 (" 切换 NORMA / EVA；工作时按 ", TEXT3, False),
                 ("Tab", TEXT2, False), (" 排队下一条，", TEXT3, False),
                 ("esc", TEXT2, False), (" 随时中断。", TEXT3, False)],
         x=PAD + 20)

    status_a(d, 20, ctx="上下文 0%", branch="main")
    divider(d, 21)
    input_row(d, 22)
    status_c_idle(d, 23)
    img.save(f"{BASE}/mockup-01-welcome.png")
    print("saved mockup-01-welcome.png")


# ============================================================
# Mockup 2 — Main chat
# ============================================================
def mockup_main():
    img, d = new_canvas()
    status_a(d, 0)
    divider(d, 1)
    user_msg(d, 2, "帮我把登录接口的超时改成 5 秒")
    tool_row(d, 4, "Read", "src/api/auth.ts")
    result_row(d, 5, "Read 128 lines")
    tool_row(d, 6, "Edit", "src/api/auth.ts")
    result_row(d, 7, "Updated 2 lines")
    line(d, 9, [("已改好：超时从 3 秒改为 5 秒，本地测试通过。", TEXT, False)])
    user_msg(d, 11, "再跑一遍测试确认一下")
    tool_row(d, 13, "Bash", "npm test")
    result_row(d, 14, "3 passed, 1 failed")
    # inline diff (unified, no box)
    line(d, 16, [("src/api/auth.ts", TEXT2, False),
                 ("  ·  1 file +1 −1", TEXT3, False)])
    d.rectangle([PAD, y_of(17), W - PAD, y_of(17) + ROW_H], fill=DIFF_DEL_BG)
    line(d, 17, [("−   timeout: 3000", RED, False)])
    d.rectangle([PAD, y_of(18), W - PAD, y_of(18) + ROW_H], fill=DIFF_ADD_BG)
    line(d, 18, [("+   timeout: 5000", GREEN, False)])
    line(d, 19, [
        ("◉ ", BLUE, True),
        ("正在解析龙文… ", TEXT, False),
        ("(8s · ↓ 312 tokens · ", TEXT3, False),
        ("esc", TEXT2, False),
        (" 中断)", TEXT3, False),
    ])
    divider(d, 21)
    input_row(d, 22)
    status_c_idle(d, 23)
    img.save(f"{BASE}/mockup-02-main.png")
    print("saved mockup-02-main.png")


# ============================================================
# Mockup 3 — Approval
# ============================================================
def mockup_approval():
    img, d = new_canvas()
    status_a(d, 0)
    divider(d, 1)
    user_msg(d, 2, "把超时改成 5 秒，顺手把测试也修了")
    tool_row(d, 4, "Edit", "src/api/auth.ts")
    result_row(d, 5, "Updated 2 lines")
    tool_row(d, 6, "Edit", "src/api/auth.test.ts")
    result_row(d, 7, "Updated 1 line")

    # approval panel: bg-panel, no border, separated by spacing
    p_top, p_bot = y_of(9) - 6, y_of(16) + ROW_H - 4
    d.rounded_rectangle([PAD, p_top, W - PAD, p_bot], radius=10, fill=BG_PANEL)
    line(d, 9, [("要改动 2 个文件", TEXT, True), ("（+3 −1）", TEXT2, False)])
    line(d, 11, [("  src/api/auth.ts", TEXT, False),
                 ("（+2 −1）", TEXT3, False)])
    line(d, 12, [("  src/api/auth.test.ts", TEXT, False),
                 ("（+1）", TEXT3, False)])
    # buttons: focused = blue bg + dark text; other = dim
    bx = PAD + 24
    by = y_of(14)
    bw = seg_width(" 接受 ", True) + 16
    bh = ROW_H - 4
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=6, fill=BLUE)
    draw_text(d, bx + 8, by + 1, "接受", BG, bold=True)
    bx2 = bx + bw + 16
    draw_text(d, bx2, by + 1, "拒绝", TEXT3, bold=False)
    line(d, 14, [("        ← → 切换 · Tab 加评论 · Enter 确认", TEXT3, False)],
         x=bx2 + seg_width("拒绝", False) + 24)

    divider(d, 21)
    input_row(d, 22)
    status_c_idle(d, 23)
    img.save(f"{BASE}/mockup-03-approval.png")
    print("saved mockup-03-approval.png")


if __name__ == "__main__":
    print(f"canvas {W}x{H}, CJK cell {CJK_W:.1f}px")
    mockup_welcome()
    mockup_main()
    mockup_approval()
