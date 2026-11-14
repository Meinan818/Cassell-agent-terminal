#!/usr/bin/env python3
"""Render 龙宝 v11 桌宠新动作帧 (user request 2026-11-14 19:37:
"都要，6 个全做"). All 6 new actions from the §2.4 action library,
drawn on the v11 base (no hands, 26x18, 3 colours: body #60a5fa,
eyes #0F172A, white #FFFFFF).

Actions:
  sleep  睡觉   : closed eyes + a white "Z" floating up, body sinks.
  roll   打滚   : curled into a plain blue ball (ears tucked in).
  peek   躲猫猫 : sunk below the edge, only wing-ear tips peeking.
  dance  跳舞   : whole sprite leans 1 cell left/right, one foot taps.
  snow   接雪花 : snowflake falls, pet looks up, then hops with the
                  flake on its head (happy closed eyes).
  eat    吃东西 : snack appears, pet pecks down, snack shrinks,
                  crumbs fall, satisfied closed eyes.
"""
from PIL import Image

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


# --- sleep: closed eyes + "Z" floating up, body sinks in frame 2 ---
def sleep_1():
    g = grid(CLOSED)
    fill(g, 1, 1, 20, 22, "W")
    put(g, 2, 21, "W")
    fill(g, 3, 3, 20, 22, "W")
    return g


def sleep_2():
    g = shift(grid(CLOSED), 1, 0)
    fill(g, 0, 0, 21, 23, "W")
    put(g, 1, 22, "W")
    fill(g, 2, 2, 21, 23, "W")
    return g


# --- roll: curled into a plain blue ball ---
def roll_ball():
    g = blank()
    fill(g, 6, 6, 10, 15, "B")
    fill(g, 7, 11, 8, 17, "B")
    fill(g, 12, 12, 10, 15, "B")
    return g


# --- peekaboo: sunk below the edge, only wing-ear tips peeking ---
def peek_hide():
    g = blank()
    put(g, 15, 7, "W")
    put(g, 15, 18, "W")
    fill(g, 16, 16, 6, 8, "B")
    fill(g, 16, 16, 17, 19, "B")
    fill(g, 17, 17, 6, 19, "B")
    return g


# --- dance: lean 1 cell left/right, one foot tapping ---
def dance_l():
    g = shift(grid(BASE), 0, -1)
    put(g, 14, 8, ".")
    put(g, 14, 9, ".")
    return g


def dance_r():
    g = shift(grid(BASE), 0, 1)
    put(g, 14, 16, ".")
    put(g, 14, 17, ".")
    return g


# --- snowflake: flake falls, pet looks up, then hops with it on head ---
def snow_1():
    g = grid(BASE)
    # eyes look up: move eye rows from 7-8 to 6-7
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    # snowflake 2x2, falling above the head
    fill(g, 0, 1, 12, 13, "W")
    return g


def snow_2():
    g = shift(grid(CLOSED), -1, 0)  # hop: whole sprite up 1
    # flake landed on the head top (was row 3, now row 2)
    put(g, 2, 12, "W")
    put(g, 2, 13, "W")
    return g


# --- eat: snack appears, peck down, snack shrinks, crumbs fall ---
def eat_1():
    g = grid(BASE)
    # eyes glance right at the snack
    g[7] = ".....BBBBDDDBBBBDDDBB....."
    g[8] = ".....BBBBDDDBBBBDDDBB....."
    fill(g, 13, 14, 21, 22, "W")
    return g


def eat_2():
    g = shift(grid(CLOSED), 1, 0)  # peck down 1
    put(g, 14, 21, "W")  # snack down to 1 cell
    return g


def eat_3():
    g = grid(CLOSED)  # satisfied, eyes closed
    put(g, 15, 20, "W")
    put(g, 16, 22, "W")
    return g


FRAMES = {
    "sleep-1": sleep_1(),
    "sleep-2": sleep_2(),
    "roll-ball": roll_ball(),
    "peek-hide": peek_hide(),
    "dance-L": dance_l(),
    "dance-R": dance_r(),
    "snow-1": snow_1(),
    "snow-2": snow_2(),
    "eat-1": eat_1(),
    "eat-2": eat_2(),
    "eat-3": eat_3(),
}

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
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


def strip(names, path):
    imgs = [render(FRAMES[n], f"{OUT}/dragon-v11-{n}.png") for n in names]
    w, h = imgs[0].size
    out = Image.new("RGB", (w * len(imgs), h), BG)
    for i, im in enumerate(imgs):
        out.paste(im, (i * w, 0), im)
    out.save(path)
    print(f"saved {path}", out.size)


if __name__ == "__main__":
    for name, g in FRAMES.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        render(lines, f"{OUT}/dragon-v11-{name}.png")
        print(f"saved dragon-v11-{name}.png")

    # one preview strip per action
    strip(["sleep-1", "sleep-2"], f"{OUT}/action-sleep.png")
    strip(["roll-ball"], f"{OUT}/action-roll.png")
    strip(["peek-hide"], f"{OUT}/action-peek.png")
    strip(["dance-L", "dance-R"], f"{OUT}/action-dance.png")
    strip(["snow-1", "snow-2"], f"{OUT}/action-snow.png")
    strip(["eat-1", "eat-2", "eat-3"], f"{OUT}/action-eat.png")

    # roll strip: ball at 3 x-positions to show it rolling
    ball = render(FRAMES["roll-ball"], f"{OUT}/dragon-v11-roll-ball.png")
    w, h = ball.size
    out = Image.new("RGB", (w * 3, h), BG)
    for i in range(3):
        out.paste(ball, (i * w, 0), ball)
    out.save(f"{OUT}/action-roll.png")
    print("saved action-roll.png (3 positions)", out.size)
