#!/usr/bin/env python3
"""Render noya v11 圣诞节日套装 (user request 2026-11-15:
节日那天要有三样东西,缺一不可——① 特殊形象 ② 特殊形象版的
常驻动作 ③ 节日专属特殊动作.不然只出现一次、动作还是老样子,
一点彩蛋的感觉都没有).

Same base as v11 (26x18, body #60a5fa, eyes #0F172A, white
#FFFFFF). Christmas adds only red + green (no gold, ever).

Santa hat: red cap + white fur brim + white pompom, perched
BETWEEN the wing-ears, white tips never covered.

Frames (6, christmas- prefix):
  christmas-hat    圣诞形象:戴圣诞帽的常驻帧
  christmas-walk   圣诞走路 (walk-R-A + 圣诞帽)
  christmas-blink  圣诞眨眼 (闭眼帧 + 圣诞帽)
  christmas-sleep  圣诞睡觉 (sleep-1 + 圣诞帽)
  christmas-gift   圣诞拆礼物 (红盒白丝带,盖子飞起,眼睛瞟向礼物)
  christmas-lights 圣诞挂彩灯 (头顶一串彩灯,眼睛上移盯着灯)
"""
from PIL import Image, ImageDraw, ImageFont

BASE = [
    "..........................",
    ".......W..........W.......",
    "......BBB........BBB......",
    "......BBBBBBBBBBBBBB......",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBDDDBBBBDDDBBB.....",
    ".....BBBDDDBBBBDDDBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    "......BBBBBBBBBBBBBB......",
    ".......BBBBBBBBBBBB.......",
    ".........BB....BB.........",
    ".........BB....BB.........",
    "..........................",
    "..........................",
    "..........................",
]

CLOSED = list(BASE)
CLOSED[7] = ".....BBBBBBBBBBBBBBBB....."
CLOSED[8] = ".....BBBDDBBBBBDDBBBB....."

EYES_R = ".....BBBBDDDBBBBDDDBB....."  # eyes shifted right

W, H = 26, 18


def grid(lines):
    return [list(r) for r in lines]


def blank():
    return [["."] * W for _ in range(H)]


def put(g, r, c, ch):
    if 0 <= r < H and 0 <= c < W:
        g[r][c] = ch


def fill(g, r0, r1, c0, c1, ch):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            put(g, r, c, ch)


def shift(g, dr, dc):
    out = blank()
    for r in range(H):
        for c in range(W):
            nr, nc = r + dr, c + dc
            if 0 <= nr < H and 0 <= nc < W:
                out[nr][nc] = g[r][c]
    return out


def s(g):
    return ["".join(row) for row in g]


def santa_hat(g):
    """Red cap + white fur brim + white pompom, between the ears."""
    put(g, 0, 11, "R")
    put(g, 0, 12, "R")                      # cap top
    put(g, 0, 14, "W")                      # pompom (flop tip)
    fill(g, 1, 1, 10, 14, "R")              # cap body
    fill(g, 2, 2, 9, 16, "W")               # white fur brim
    return g


def christmas_hat():
    return santa_hat(grid(BASE))


def christmas_walk():
    # walk-R-A: eyes right, one foot up + forward, other down
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    g[13] = list(".........BB.....BB........")
    g[14] = list(".........BB...............")
    return santa_hat(g)


def christmas_blink():
    return santa_hat(grid(CLOSED))


def christmas_sleep():
    g = santa_hat(grid(CLOSED))
    fill(g, 1, 1, 20, 22, "W")
    put(g, 2, 21, "W")
    fill(g, 3, 3, 20, 22, "W")              # little "Z" floating up
    return g


def christmas_gift():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)                     # glance at the gift
    # red box with white ribbon, rows 12-14, cols 21-24
    fill(g, 12, 14, 21, 24, "R")
    fill(g, 12, 14, 22, 22, "W")            # vertical ribbon
    fill(g, 13, 13, 21, 24, "W")            # horizontal ribbon
    # lid lifted off, floating just above the box
    fill(g, 10, 10, 22, 25, "W")
    put(g, 10, 23, "R")                     # lid ribbon
    # sparkles rising from the open box
    put(g, 8, 22, "W")
    put(g, 9, 24, "W")
    return g


def christmas_lights():
    g = grid(BASE)
    # eyes look up at the lights
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    # wire across the top (row 0), bulbs hanging below it (row 1)
    # bulbs avoid the ear tips at (1,7) and (1,18)
    for c in (6, 8, 10, 12, 14, 16, 18, 20):
        put(g, 0, c, "W")
    put(g, 1, 9, "R")
    put(g, 1, 13, "G")
    put(g, 1, 17, "R")
    return g


FRAMES = {
    "christmas-hat": christmas_hat(),
    "christmas-walk": christmas_walk(),
    "christmas-blink": christmas_blink(),
    "christmas-sleep": christmas_sleep(),
    "christmas-gift": christmas_gift(),
    "christmas-lights": christmas_lights(),
}

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
    "R": (239, 68, 68),     # santa red
    "G": (34, 197, 94),     # light green
}
SCALE = 28
OUT = "/home/hatch/workspace/cassell-agent/cli-design/mascot"
BG = (11, 18, 32)


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
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
    except Exception:
        font = ImageFont.load_default()
    label_h = 52
    imgs = {}
    for n in names:
        imgs[n] = render(FRAMES[n], f"{OUT}/{n}.png", scale=scale)
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
    for name, g in FRAMES.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        render(lines, f"{OUT}/{name}.png")
        print(f"saved {name}.png")

    order = ["christmas-hat", "christmas-walk", "christmas-blink",
             "christmas-sleep", "christmas-gift", "christmas-lights"]
    contact_sheet(order, f"{OUT}/contact-sheet-christmas.png")
