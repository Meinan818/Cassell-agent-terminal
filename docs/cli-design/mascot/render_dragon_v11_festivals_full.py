#!/usr/bin/env python3
"""Render noya v11 节日版常驻动作 · 全量补画 (user decision 2026-11-15:
每个节日 10 种常驻动作全画,不是 3 个代表).

10 个节日各已有 6 帧 (特殊形象 1 + 节日版常驻动作 3: 走路/眨眼/睡觉
+ 专属特殊动作 2). 本脚本补画剩下的 7 种常驻动作,穿着该节日的造型
(沿用该节日已有的特殊形象,不改造型). 共 10 节日 x 7 帧 = 70 帧.

补画的 7 种常驻动作 (原版画法见 render_dragon_v11_actions.py /
render_dragon_v11.py,节日造型见 render_dragon_v11_festivals.py /
render_dragon_v11_christmas.py):
  look  张望 : 眼睛右移 (look-right), 造型戴在头上.
  jump  跳   : 脚收起 + 下方白色动感虚线 (复用 easter hop 的跳法),
              身体不动, 造型不被裁.
  roll  打滚 : 蓝球 + 造型移到球顶上方 (topper 下移 3 行);
              周五是墨镜, 改画在球面上 (裁到球内).
  peek  躲猫猫: 沉到下沿只露翼耳尖 + 造型下移 14 行跟着露头;
              周五墨镜在脸上, 脸藏起来了所以墨镜不出现, 用原版 peek.
  dance 跳舞 : 造型先戴好再整体右移 1 格 (帽子跟着头走), 右脚点地.
  snow  接雪花: 眼睛上移 + 节日主题的掉落物在右上方 (动作姿态与
              原版接雪花一致); 掉落物: 圣诞雪花/万圣节糖果/
              新年彩纸/春节红瓣/情人节爱心/复活节彩蛋/
              中秋月饼/生日彩纸/周五橙片/天气雨滴.
  eat   吃东西: 眼睛右移 + 节日食物在嘴边 (2x2);
              圣诞曲奇/万圣节糖果/新年红点心/春节饺子/
              情人节巧克力/复活节彩蛋/中秋月饼/生日蛋糕/
              周五橙汁/天气热饮.

v11 本体一个像素不动 (26x18, 体蓝 #60a5fa, 眼睛 #0F172A,
翼耳尖白 #FFFFFF). 颜色只用节日自己的颜色, 不要金色.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

import render_dragon_v11_festivals as F
import render_dragon_v11_christmas as C
from render_dragon_v11_actions import roll_ball, peek_hide

BASE = F.BASE
CLOSED = F.CLOSED
EYES_R = F.EYES_R
grid = F.grid
blank = F.blank
put = F.put
fill = F.fill
shift = F.shift
s = F.s
eyes_up = F.eyes_up
COLORS = F.COLORS
OUT = F.OUT
BG = F.BG
W, H = F.W, F.H


def composite(base, over):
    """Overlay non-blank cells of `over` onto `base`."""
    out = [row[:] for row in base]
    for r in range(H):
        for c in range(W):
            if over[r][c] != ".":
                out[r][c] = over[r][c]
    return out


def topper_shifted(top_fn, dr):
    """Render a festival topper on a blank grid, shifted down dr rows."""
    return shift(top_fn(blank()), dr, 0)


# --- the 7 resident-action bases, festival topper applied ---
def look_base(top_fn):
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    return top_fn(g)


def jump_base(top_fn):
    g = grid(BASE)
    fill(g, 13, 14, 9, 10, ".")     # feet tucked up
    fill(g, 13, 14, 15, 16, ".")
    put(g, 15, 8, "W")              # motion dashes below
    put(g, 15, 17, "W")
    return top_fn(g)


def roll_base(top_fn, fest):
    if fest == "friday":
        # sunglasses clipped to the ball (ball spans cols 8-17, rows 7-11)
        g = roll_ball()
        fill(g, 7, 8, 8, 11, "D")
        fill(g, 7, 8, 14, 17, "D")
        fill(g, 7, 7, 12, 13, "D")
        put(g, 7, 9, "W")
        put(g, 7, 15, "W")
        return g
    # ball + topper moved down 3 so the hat sits on the ball
    return composite(roll_ball(), topper_shifted(top_fn, 3))


def peek_base(top_fn, fest):
    if fest == "friday":
        # sunglasses live on the face; the face is hidden, so nothing shows
        return peek_hide()
    # ear tips + topper shifted down 14 so the hat peeks over the edge too
    return composite(peek_hide(), topper_shifted(top_fn, 14))


def dance_base(top_fn):
    # topper on first, then lean the whole sprite (hat follows the head)
    g = shift(top_fn(grid(BASE)), 0, 1)
    put(g, 14, 16, ".")
    put(g, 14, 17, ".")
    return g


def snow_base(top_fn, item_cells):
    g = top_fn(grid(BASE))
    eyes_up(g)
    for (r, c, ch) in item_cells:
        put(g, r, c, ch)
    return g


def eat_base(top_fn, snack_cells):
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    for (r, c, ch) in snack_cells:
        put(g, r, c, ch)
    return top_fn(g)


# --- festival-themed falling things (snow) and snacks (eat) ---
SNOW_ITEMS = {
    "christmas":  [(0, 20, "W"), (0, 21, "W"), (1, 20, "W"), (1, 21, "W")],
    "halloween":  [(0, 20, "O"), (0, 21, "O"), (1, 20, "O"), (1, 21, "O")],
    "newyear":    [(0, 20, "R"), (0, 21, "G"), (1, 20, "P"), (1, 21, "W")],
    "springfest": [(0, 20, "R"), (0, 21, "R"), (1, 20, "R"), (1, 21, "R")],
    "valentine":  [(0, 20, "P"), (0, 21, "P"), (1, 20, "P")],
    "easter":     [(0, 20, "W"), (0, 21, "W"), (1, 20, "W"), (1, 21, "P")],
    "midautumn":  [(0, 20, "T"), (0, 21, "T"), (1, 20, "T"), (1, 21, "T")],
    "birthday":   [(0, 20, "P"), (0, 21, "L"), (1, 20, "W"), (1, 21, "P")],
    "friday":     [(0, 20, "O"), (0, 21, "O"), (1, 20, "O"), (1, 21, "O")],
    "weather":    [(0, 20, "L"), (1, 20, "L"), (1, 21, "L")],
}

SNACKS = {
    "christmas":  [(13, 21, "T"), (13, 22, "T"), (14, 21, "T"), (14, 22, "T")],
    "halloween":  [(13, 21, "O"), (13, 22, "O"), (14, 21, "O"), (14, 22, "O")],
    "newyear":    [(13, 21, "R"), (13, 22, "R"), (14, 21, "R"), (14, 22, "R")],
    "springfest": [(13, 21, "W"), (13, 22, "W"), (14, 21, "W"), (14, 22, "W")],
    "valentine":  [(13, 21, "P"), (13, 22, "P"), (14, 21, "P"), (14, 22, "P")],
    "easter":     [(13, 21, "W"), (13, 22, "W"), (14, 21, "P"), (14, 22, "P")],
    "midautumn":  [(13, 21, "T"), (13, 22, "T"), (14, 21, "T"), (14, 22, "T")],
    "birthday":   [(13, 21, "W"), (13, 22, "W"), (14, 21, "P"), (14, 22, "P")],
    "friday":     [(13, 21, "O"), (13, 22, "O"), (14, 21, "O"), (14, 22, "O")],
    "weather":    [(13, 21, "W"), (13, 22, "W"), (14, 21, "W"), (14, 22, "W")],
}

# festival -> its topper function
TOPPERS = {name: fn for name, (fn, _, _) in F.FESTIVALS.items()}
TOPPERS["christmas"] = C.santa_hat

SPECIALS = dict(F.SPECIAL_NAMES)
SPECIALS["christmas"] = ("gift", "lights")

NEW = {}
for fest, top_fn in TOPPERS.items():
    NEW[f"{fest}-look"] = look_base(top_fn)
    NEW[f"{fest}-jump"] = jump_base(top_fn)
    NEW[f"{fest}-roll"] = roll_base(top_fn, fest)
    NEW[f"{fest}-peek"] = peek_base(top_fn, fest)
    NEW[f"{fest}-dance"] = dance_base(top_fn)
    NEW[f"{fest}-snow"] = snow_base(top_fn, SNOW_ITEMS[fest])
    NEW[f"{fest}-eat"] = eat_base(top_fn, SNACKS[fest])

# all frames (old 6 per festival + new 7) for the contact sheets
ALL = {}
ALL.update(F.FRAMES)
ALL.update(C.FRAMES)
ALL.update(NEW)

SCALE = 28


def render(grid_lines, path, scale=SCALE):
    lines = grid_lines if isinstance(grid_lines[0], str) else s(grid_lines)
    h = len(lines)
    w = max(len(r) for r in lines)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(lines):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch] + (255,)
    img = img.resize((w * scale, h * scale), Image.NEAREST)
    img.save(path)
    return img


def contact_sheet(names, path, cols=3, scale=SCALE):
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    except Exception:
        font = ImageFont.load_default()
    label_h = 48
    imgs = {}
    for n in names:
        imgs[n] = render(ALL[n], f"{OUT}/{n}.png", scale=scale)
    w, h = imgs[names[0]].size
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (w * cols, (h + label_h) * rows), BG)
    dr = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        x = (i % cols) * w
        y = (i // cols) * (h + label_h)
        sheet.paste(imgs[n], (x, y), imgs[n])
        dr.text((x + 12, y + h + 8), n, fill=(255, 255, 255), font=font)
    sheet.save(path)
    print(f"saved {path}", sheet.size)


if __name__ == "__main__":
    for name, g in NEW.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        render(lines, f"{OUT}/{name}.png")
        print(f"saved {name}.png")

    order_actions = ["look", "jump", "roll", "peek", "dance", "snow", "eat"]
    for fest in TOPPERS:
        a, b = SPECIALS[fest]
        order = [f"{fest}-hat", f"{fest}-walk", f"{fest}-blink",
                 f"{fest}-sleep"] + [f"{fest}-{x}" for x in order_actions] + \
                [f"{fest}-{a}", f"{fest}-{b}"]
        assert len(order) == 13, (fest, len(order))
        contact_sheet(order, f"{OUT}/contact-sheet-{fest}.png")
