#!/usr/bin/env python3
"""Render mockups 12 (S11 narrow terminal) and 13 (S12 error states).

Uses render_mockups.py helpers; does NOT modify it.
- mockup-12: 60-col narrow canvas (vs standard 80): single-column welcome
  card (sessions on top, entries below), status bar A with only 3 fields,
  unified diff, tool args truncated to filename only.
- mockup-13: 80-col, two halves: top = no-Key welcome card (model
  'Unconfigured' / cost 'Unknown'); bottom = red connection-failure line
  + context-almost-full reminder (percentage in red).
Both rendered in dark and light themes via R.set_theme().
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_mockups as R
from PIL import ImageFont

BASE = R.BASE
PAD = R.PAD
ROW_H = R.ROW_H


def custom_status_bar(d, row, text, width):
    """Solid ice-blue status bar with arbitrary text (dark text on blue)."""
    y0 = R.y_of(row)
    d.rectangle([PAD, y0, width - PAD, y0 + ROW_H], fill=R.BLUE)
    R.draw_text(d, PAD + 8, y0, text, R.BG, bold=False)


def _title_band_narrow(img, d, width):
    """Header band for the narrow screen (rows 2-3), no mascot."""
    hb_y0, hb_y1 = R.y_of(2), R.y_of(3) + ROW_H
    d.rectangle([PAD, hb_y0, width - PAD, hb_y1], fill=R.BG_PANEL)
    d.line([(PAD, hb_y1), (width - PAD, hb_y1)], fill=R.BLUE, width=2)
    f_title = ImageFont.truetype(R.NOTO_B, 24, index=R.IDX)
    d.text((PAD + 12, hb_y0 + 2), "CASSELL COLLEGE", font=f_title, fill=R.TEXT)
    R.draw_text(d, PAD + 12, R.y_of(3) + 3,
                "COMMISSIONER TERMINAL  ·  60 列窄终端",
                R.TEXT2, bold=False)


def mockup_narrow():
    """S11: 60-column narrow terminal."""
    orig_w = R.W
    w60 = int(PAD * 2 + 60 * R.CJK_W)
    R.W = w60
    try:
        img, d = R.new_canvas()
        # Row 0: status A, only 3 fields (per S11 / task spec)
        custom_status_bar(d, 0, "\u25c9 NORMA \u00b7 S \u00b7 deepseek-flash", w60)
        R.divider(d, 1)
        _title_band_narrow(img, d, w60)

        # Welcome card, single column: sessions on top, entries below
        cx0, cx1 = PAD, w60 - PAD
        cy0, cy1 = R.y_of(4), R.y_of(14) + ROW_H
        d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=10,
                            fill=R.BG_SOFT, outline=R.BORDER, width=1)
        lx = PAD + 20
        R.line(d, 5, [("\u6b22\u8fce\u4f60\uff0c\u8def\u4e13\u5458", R.TEXT, True)], x=lx)
        R.line(d, 6, [("S2017-0117  \u00b7  ", R.TEXT2, False),
                      ("\u5b66\u9662\u552f\u4e00\u7684 S \u7ea7\u5b66\u751f", R.TEXT3, False)], x=lx)
        R.line(d, 7, [("\u25c6 ", R.CYAN, True),
                      ("\u4eca\u65e5\u8a00\u7075  ", R.TEXT, True),
                      ("\u65f6\u95f4\u96f6 (84) \u00b7 \u6602\u70ed \u00b7 \u5ef6\u7f13\u65f6\u95f4",
                       R.TEXT2, False)], x=lx)
        d.line([(cx0 + 20, R.y_of(8) + ROW_H // 2),
                (cx1 - 20, R.y_of(8) + ROW_H // 2)], fill=R.BORDER, width=1)
        R.line(d, 9, [("\u25c8 ", R.BLUE, True), ("\u6700\u8fd1\u7684\u4f1a\u8bdd", R.TEXT, True)], x=lx)
        R.line(d, 10, [("\u00b7  ", R.TEXT3, False),
                       ("\u767b\u5f55\u63a5\u53e3\u8d85\u65f6\u8c03\u6574", R.TEXT2, False),
                       ("\uff082 \u5c0f\u65f6\u524d\uff09", R.TEXT3, False)], x=lx)
        R.line(d, 11, [("\u00b7  ", R.TEXT3, False),
                       ("\u6bd5\u4e1a\u8bbe\u8ba1\u4efb\u52a1\u4e66\u6574\u7406", R.TEXT2, False),
                       ("\uff08\u6628\u5929\uff09", R.TEXT3, False)], x=lx)
        R.line(d, 12, [("\u25b6 ", R.CYAN, True), ("\u5e38\u7528\u5165\u53e3", R.TEXT, True)], x=lx)
        R.line(d, 13, [("/resume", R.BLUE, False), ("  \u7ee7\u7eed\u4e0a\u6b21\u4f1a\u8bdd  ", R.TEXT2, False),
                       ("/new", R.BLUE, False), ("  \u65b0\u4f1a\u8bdd", R.TEXT2, False)], x=lx)
        R.line(d, 14, [("/model", R.BLUE, False), ("   \u6362\u6a21\u578b   ", R.TEXT2, False),
                       ("/help", R.BLUE, False), ("  \u5168\u90e8\u547d\u4ee4", R.TEXT2, False)], x=lx)

        # Chat snippet: truncated tool arg (filename only) + unified diff
        R.user_msg(d, 15, "\u5e2e\u6211\u628a\u767b\u5f55\u63a5\u53e3\u7684\u8d85\u65f6\u6539\u6210 5 \u79d2")
        R.tool_row(d, 16, "Edit", "auth.ts")
        R.result_row(d, 17, "Updated 2 lines")
        R.line(d, 18, [("auth.ts", R.TEXT2, False),
                       ("  \u00b7  \u7edf\u4e00 Diff  \u00b7  +1 \u22121", R.TEXT3, False)])
        d.rectangle([PAD, R.y_of(19), w60 - PAD, R.y_of(19) + ROW_H],
                    fill=R.DIFF_DEL_BG)
        R.line(d, 19, [("\u2212   timeout: 3000", R.RED, False)])
        d.rectangle([PAD, R.y_of(20), w60 - PAD, R.y_of(20) + ROW_H],
                    fill=R.DIFF_ADD_BG)
        R.line(d, 20, [("+   timeout: 5000", R.GREEN, False)])
        R.divider(d, 21)
        R.input_row(d, 22)
        R.status_c_idle(d, 23)
        return img
    finally:
        R.W = orig_w


def mockup_error():
    """S12: top = no-Key welcome card; bottom = connection failure +
    context-almost-full reminder. No fake data: cost is 'Unknown'."""
    img, d = R.new_canvas()
    # Row 0: status A, model field reads 'Unconfigured'
    custom_status_bar(d, 0,
                      "\u25c9 NORMA \u00b7 S \u00b7 \u672a\u914d\u7f6e \u00b7 High \u00b7 \u4e0a\u4e0b\u6587 0% \u00b7 main",
                      R.W)
    R.divider(d, 1)

    # --- top half: no-Key welcome card (rows 2-10) ---
    cx0, cx1 = PAD, R.W - PAD
    cy0, cy1 = R.y_of(2), R.y_of(10) + ROW_H
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=10,
                        fill=R.BG_SOFT, outline=R.BORDER, width=1)
    lx = PAD + 20
    R.line(d, 3, [("\u6b22\u8fce\u4f60\uff0c\u8def\u4e13\u5458", R.TEXT, True)], x=lx)
    R.line(d, 4, [("S2017-0117  \u00b7  ", R.TEXT2, False),
                  ("\u5b66\u9662\u552f\u4e00\u7684 S \u7ea7\u5b66\u751f", R.TEXT3, False)], x=lx)
    R.line(d, 5, [("\u8fd8\u6ca1\u6709\u914d\u7f6e\u6a21\u578b\uff0c\u6309 ", R.RED, True),
                  ("/provider", R.BLUE, True),
                  (" \u5f00\u59cb", R.RED, True)], x=lx)
    d.line([(cx0 + 20, R.y_of(6) + ROW_H // 2),
            (cx1 - 20, R.y_of(6) + ROW_H // 2)], fill=R.BORDER, width=1)
    R.line(d, 7, [("\u6a21\u578b\uff1a", R.TEXT3, False),
                  ("\u672a\u914d\u7f6e", R.RED, True),
                  ("    \u00b7    \u672c\u4f1a\u8bdd\u6210\u672c\uff1a", R.TEXT3, False),
                  ("\u672a\u77e5", R.TEXT, False)], x=lx)
    R.line(d, 8, [("/provider", R.BLUE, False), ("  \u914d Key    ", R.TEXT2, False),
                  ("/new", R.BLUE, False), ("  \u65b0\u4f1a\u8bdd    ", R.TEXT2, False),
                  ("/help", R.BLUE, False), ("  \u5168\u90e8\u547d\u4ee4", R.TEXT2, False)], x=lx)
    R.line(d, 9, [("\u4e0d\u663e\u793a\u5047\u6a21\u578b\u3001\u4e0d\u663e\u793a\u5047\u8fde\u63a5\u2014\u2014\u7a7a\u72b6\u6001\u5c31\u662f\u7a7a\u72b6\u6001\u3002",
                  R.TEXT3, False)], x=lx)
    R.line(d, 10, [("Shift+Tab", R.TEXT2, False), (" \u5207\u6a21\u5f0f  \u00b7  ", R.TEXT3, False),
                   ("Tab", R.TEXT2, False), (" \u6392\u961f  \u00b7  ", R.TEXT3, False),
                   ("esc", R.TEXT2, False), (" \u9000\u51fa", R.TEXT3, False)], x=lx)

    # --- divider + bottom half: error states ---
    R.divider(d, 11)
    R.line(d, 12, [("\u2500\u2500 \u9519\u8bef\u6001 \u2500\u2500", R.TEXT3, False)])
    R.line(d, 13, [("\u8fde\u63a5\u5931\u8d25\uff1a\u7f51\u7edc\u8d85\u65f6 \u00b7 \u6309 R \u91cd\u8bd5",
                   R.RED, True)])
    R.line(d, 14, [("\u6309 R \u91cd\u8bd5\uff0c\u6216\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u65b0\u53d1\u9001\u3002",
                   R.TEXT2, False)])
    R.divider(d, 15)
    R.line(d, 16, [("\u4e0a\u4e0b\u6587 ", R.TEXT, False),
                   ("96%", R.RED, True),
                   (" \u5feb\u6ee1\u4e86\uff0c", R.TEXT, False),
                   ("/compact", R.BLUE, False),
                   (" \u538b\u7f29\u6216 ", R.TEXT, False),
                   ("/new", R.BLUE, False),
                   (" \u5f00\u65b0\u4f1a\u8bdd", R.TEXT, False)])
    R.line(d, 17, [("\u25c9 NORMA \u00b7 S \u00b7 deepseek-flash \u00b7 \u4e0a\u4e0b\u6587 ",
                   R.TEXT2, False),
                  ("96%", R.RED, True)])
    R.line(d, 18, [("\u63d0\u793a\uff1a\u538b\u7f29\u4f1a\u4fdd\u7559\u5173\u952e\u4e8b\u5b9e\uff0c\u6700\u8fd1 5 \u8f6e\u539f\u6837\u4fdd\u7559\u3002",
                   R.TEXT3, False)])
    R.divider(d, 21)
    R.input_row(d, 22)
    R.status_c_idle(d, 23)
    return img


if __name__ == "__main__":
    for theme, suffix in (("dark", ""), ("light", "-light")):
        R.set_theme(theme)
        mockup_narrow().save(f"{BASE}/mockup-12-narrow{suffix}.png")
        print(f"saved mockup-12-narrow{suffix}.png")
        mockup_error().save(f"{BASE}/mockup-13-error{suffix}.png")
        print(f"saved mockup-13-error{suffix}.png")
    R.set_theme("dark")
