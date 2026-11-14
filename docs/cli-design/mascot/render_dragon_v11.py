#!/usr/bin/env python3
"""Render 龙宝 v11 — v10 minus the side hands (user request 2026-11-14
19:34: "把两侧的手去掉"). The mascot is now: one big round head (the
whole body) + wing-ears (white tips) + two round eyes + two small
feet. No hands, no separate body, no mouth, no nose.

Also renders the walk / look frames on the v11 base (same walk logic
as v10: feet alternate, eyes shift toward travel direction).
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

GRID_CLOSED = list(BASE)
GRID_CLOSED[7] = ".....BBBBBBBBBBBBBBBB....."
GRID_CLOSED[8] = ".....BBBDDBBBBBDDBBBB....."

EYES_R = ".....BBBBDDDBBBBDDDBB....."
EYES_L = ".....BBDDDBBBBDDDBBBB....."
FEET_BASE = ".........BB....BB........."


def frame(eyes, r13, r14):
    g = list(BASE)
    g[7] = eyes
    g[8] = eyes
    g[13] = r13
    g[14] = r14
    return g


FRAMES = {
    "open": BASE,
    "closed": GRID_CLOSED,
    "walk-R-A": frame(EYES_R,
                      ".........BB.....BB........",
                      ".........BB..............."),
    "walk-R-B": frame(EYES_R,
                      "..........BB...BB.........",
                      "...............BB........."),
    "walk-L-A": frame(EYES_L,
                      "........BB.....BB.........",
                      "...............BB........."),
    "walk-L-B": frame(EYES_L,
                      ".........BB...BB..........",
                      ".........BB..............."),
    "look-left": frame(EYES_L, FEET_BASE, FEET_BASE),
    "look-right": frame(EYES_R, FEET_BASE, FEET_BASE),
}

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
}
SCALE = 28
OUT = "/home/hatch/workspace/cassell-agent/cli-design/mascot"


def render(grid, path, scale=SCALE):
    h = len(grid)
    w = max(len(r) for r in grid)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch] + (255,)
    img = img.resize((w * scale, h * scale), Image.NEAREST)
    img.save(path)
    return img


if __name__ == "__main__":
    imgs = {}
    for name, g in FRAMES.items():
        lens = {len(r) for r in g}
        assert len(lens) == 1, (name, lens)
        imgs[name] = render(g, f"{OUT}/dragon-v11-{name}.png")
        print(f"saved dragon-v11-{name}.png")

    seq = ["walk-R-A", "walk-R-B", "walk-R-A", "walk-R-B"]
    w, h = imgs[seq[0]].size
    strip = Image.new("RGB", (w * len(seq), h), (11, 18, 32))
    for i, name in enumerate(seq):
        strip.paste(imgs[name], (i * w, 0), imgs[name])
    strip.save(f"{OUT}/walk-cycle-v11-right.png")
    print("saved walk-cycle-v11-right.png", strip.size)
