#!/usr/bin/env python3
"""Render 龙宝 v11 第一批新帧 (user request 2026-11-15:
"去画吧不换就行" — 画第一批 5 组新帧,龙宝 v11 本身不动).
Same base as v11 (26x18, 3 colours: body #60a5fa, eyes #0F172A,
white #FFFFFF). New groups from the Clawd research report §6:

  sweat   出汗阶梯 : 1 drop -> 2 drops + darting eyes -> half-closed.
  belly   翻肚皮   : vertical flip + X eyes; soul-out adds a ghost.
  hats    职业帽   : hat perched BETWEEN the wing-ears, never covering
                     the white tips. deerstalker / wizard / chef /
                     hard hat / headphones.
  sign    举牌     : white sign floating beside the ear, dark symbol.
  gift    天降礼盒 : falling box -> open box -> jack-in-the-box.
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

W, H = 26, 18
EYES_R = ".....BBBBDDDBBBBDDDBB....."  # eyes shifted right (look right)


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


# --- sweat ladder: one drop -> two drops + darting eyes -> half-closed ---
def sweat_1():
    g = grid(BASE)
    # one sweat drop, upper right of the head (never over the eyes)
    put(g, 4, 22, "W")
    fill(g, 5, 6, 21, 22, "W")
    return g


def sweat_2():
    g = grid(BASE)
    # darting eyes: left eye looks left, right eye looks right
    fill(g, 7, 8, 8, 10, "B")
    fill(g, 7, 8, 15, 17, "B")
    fill(g, 7, 8, 7, 9, "D")
    fill(g, 7, 8, 16, 18, "D")
    # two drops: upper right + lower left
    put(g, 2, 22, "W")
    fill(g, 3, 4, 21, 22, "W")
    put(g, 5, 4, "W")
    fill(g, 6, 7, 3, 4, "W")
    return g


def sweat_3():
    g = grid(BASE)
    # half-closed eyes: only the lower eye row stays dark (exhausted)
    fill(g, 7, 7, 8, 10, "B")
    fill(g, 7, 7, 15, 17, "B")
    # two drops
    put(g, 4, 22, "W")
    fill(g, 5, 6, 21, 22, "W")
    put(g, 5, 4, "W")
    fill(g, 6, 7, 3, 4, "W")
    return g


# --- belly-up: vertical flip + X eyes; soul-out adds a ghost ---
def belly_up():
    g = [list(r) for r in reversed(BASE)]
    # X eyes at rows 9-10 (the flipped eye rows)
    fill(g, 9, 10, 8, 10, "B")
    fill(g, 9, 10, 15, 17, "B")
    put(g, 9, 8, "D")
    put(g, 9, 10, "D")
    put(g, 10, 9, "D")
    put(g, 9, 15, "D")
    put(g, 9, 17, "D")
    put(g, 10, 16, "D")
    return g


def soul_out():
    g = belly_up()
    # little ghost dragon rising to the upper right (white, dark eyes).
    # Kept small with a margin so it never touches the frame edge.
    put(g, 1, 20, "W")
    put(g, 1, 22, "W")                      # ear tips
    fill(g, 2, 4, 19, 23, "W")              # head
    put(g, 3, 20, "D")
    put(g, 3, 22, "D")                      # eyes
    put(g, 5, 19, "W")
    put(g, 5, 21, "W")
    put(g, 5, 23, "W")                      # wavy tail
    return g


# --- hats: perched BETWEEN the wing-ears, white tips never covered ---
# 2026-11-15 用户反馈:黑色帽子在深色终端底上看不清、太丑,重画.
# 侦探帽改棕色/驼色(猎鹿帽经典色),巫师帽改深紫(不要黑、不要金).
def hat_deerstalker():
    g = grid(BASE)
    put(g, 0, 12, "K")
    put(g, 0, 13, "K")                      # button, dark brown
    fill(g, 1, 1, 10, 15, "T")              # flat cap, tan brown
    fill(g, 2, 2, 9, 16, "T")               # brim
    return g


def hat_wizard():
    g = grid(BASE)
    put(g, 0, 12, "P")
    put(g, 0, 13, "P")                      # tip, deep purple
    fill(g, 1, 1, 11, 14, "P")              # cone
    put(g, 1, 12, "W")                      # star
    fill(g, 2, 2, 9, 16, "P")               # brim
    return g


def hat_chef():
    g = grid(BASE)
    fill(g, 0, 1, 10, 15, "W")              # puffy top
    fill(g, 2, 2, 11, 14, "W")              # band
    return g


def hat_hardhat():
    g = grid(BASE)
    put(g, 0, 12, "W")
    put(g, 0, 13, "W")                      # ridge
    fill(g, 1, 1, 11, 14, "W")              # dome
    fill(g, 2, 2, 9, 16, "W")               # brim
    return g


def hat_headphones():
    g = grid(BASE)
    fill(g, 0, 0, 11, 14, "D")              # band, stepped arc
    fill(g, 1, 1, 10, 15, "D")
    fill(g, 2, 2, 9, 16, "D")
    # cups are white so they read against the dark terminal background
    # (dark cups were invisible off the body); dark dot = speaker
    fill(g, 5, 7, 3, 4, "W")                # left cup
    fill(g, 5, 7, 21, 22, "W")              # right cup
    put(g, 6, 4, "D")
    put(g, 6, 21, "D")                      # speaker dot
    return g


# --- signs: white sign floating beside the ear, dark symbol ---
def sign_yes():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)                     # glance at the sign
    fill(g, 2, 6, 21, 25, "W")              # sign board
    put(g, 4, 21, "D")
    put(g, 5, 22, "D")                      # checkmark: dip then rise
    put(g, 4, 23, "D")
    put(g, 3, 24, "D")
    put(g, 2, 25, "D")
    return g


def sign_no():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    fill(g, 2, 6, 21, 25, "W")
    put(g, 2, 21, "D")
    put(g, 3, 22, "D")                      # X: diagonal 1
    put(g, 4, 23, "D")
    put(g, 5, 24, "D")
    put(g, 6, 25, "D")
    put(g, 2, 25, "D")
    put(g, 3, 24, "D")                      # X: diagonal 2
    put(g, 5, 22, "D")
    put(g, 6, 21, "D")
    return g


# --- gift box: falling -> open -> jack-in-the-box ---
def gift_falling():
    g = grid(BASE)
    # eyes look up (rows 6-7)
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    # gift box falling above the head, white + dark ribbon
    fill(g, 0, 1, 11, 15, "W")
    fill(g, 0, 1, 13, 13, "D")
    return g


def gift_box_body(g):
    # open box on the ground, rows 12-14, cols 21-24
    fill(g, 12, 12, 21, 24, "W")
    put(g, 12, 22, "D")
    fill(g, 13, 13, 21, 24, "D")
    fill(g, 14, 14, 21, 24, "W")
    put(g, 14, 22, "D")


def gift_open():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    gift_box_body(g)
    # lid lifted off, floating just above the box
    fill(g, 10, 10, 22, 25, "W")
    put(g, 10, 23, "D")
    # sparkles rising from the open box
    put(g, 8, 22, "W")
    put(g, 9, 24, "W")
    return g


def gift_jack():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    gift_box_body(g)
    # spring holding the mini dragon up (white so it reads on dark bg)
    put(g, 10, 23, "W")
    put(g, 11, 23, "W")
    # mini dragon popping out, rows 6-9, cols 21-25
    put(g, 6, 21, "W")
    put(g, 6, 25, "W")                      # ear tips
    fill(g, 7, 9, 21, 25, "B")              # head
    put(g, 8, 22, "D")
    put(g, 8, 24, "D")                      # eyes
    return g


FRAMES = {
    "sweat-1": sweat_1(),
    "sweat-2": sweat_2(),
    "sweat-3": sweat_3(),
    "belly-up": belly_up(),
    "soul-out": soul_out(),
    "hat-deerstalker": hat_deerstalker(),
    "hat-wizard": hat_wizard(),
    "hat-chef": hat_chef(),
    "hat-hardhat": hat_hardhat(),
    "hat-headphones": hat_headphones(),
    "sign-yes": sign_yes(),
    "sign-no": sign_no(),
    "gift-box-falling": gift_falling(),
    "gift-box-open": gift_open(),
    "gift-box-jack": gift_jack(),
}

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
    "T": (176, 124, 64),    # tan brown (deerstalker)
    "K": (120, 82, 42),     # dark brown (deerstalker button)
    "P": (168, 85, 247),    # deep purple (wizard hat)
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


def contact_sheet(names, path, cols=5, scale=SCALE):
    """All new frames in one labelled grid (5 cols x 3 rows)."""
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

    order = ["sweat-1", "sweat-2", "sweat-3", "belly-up", "soul-out",
             "hat-deerstalker", "hat-wizard", "hat-chef", "hat-hardhat",
             "hat-headphones", "sign-yes", "sign-no",
             "gift-box-falling", "gift-box-open", "gift-box-jack"]
    contact_sheet(order, f"{OUT}/contact-sheet-batch1.png")
