#!/usr/bin/env python3
"""Render 龙宝 v10 桌宠动作帧 (user request 2026-11-14 18:35: the mascot
should live on the top layer and wander back and forth like a desktop
pet).

Frames (all 26x18, same palette as v10: body #60a5fa, eyes #0F172A,
wing-ear tips white):
  walk-R-A / walk-R-B : walking RIGHT, feet alternate.
      Eyes shift 1 cell toward the direction of travel (so you can
      tell which way it is facing). The stepping foot lifts 1 cell
      and moves 1 cell forward; the planted foot stays down. At the
      bottom row only the planted foot is visible.
  walk-L-A / walk-L-B : walking LEFT, mirrors of the R frames.
  look-left / look-right : idle "looking around" — eyes shift 1 cell,
      feet both down. Used during idle pauses.
  (Blink reuses the existing v10-closed frame. A hop is the whole
  sprite shifted up 1-2 cells at render time, no separate frame.)

Walk cycle (moving right): R-A -> R-B -> R-A -> R-B, 1 column per
frame, ~200ms per frame. Moving left mirrors it.
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
    "..BBBBBBBBBBBBBBBBBBBBBB..",
    "..BBBBBBBBBBBBBBBBBBBBBB..",
    "......BBBBBBBBBBBBBB......",
    ".......BBBBBBBBBBBB.......",
    ".........BB....BB.........",
    ".........BB....BB.........",
    "..........................",
    "..........................",
    "..........................",
]

EYES_R = ".....BBBBDDDBBBBDDDBB....."   # eyes shifted 1 cell right
EYES_L = ".....BBDDDBBBBDDDBBBB....."   # eyes shifted 1 cell left
FEET_BASE = ".........BB....BB........."


def frame(eyes, r13, r14):
    g = list(BASE)
    g[7] = eyes
    g[8] = eyes
    g[13] = r13
    g[14] = r14
    return g


FRAMES = {
    # moving right: right foot steps, then left foot steps
    "walk-R-A": frame(EYES_R,
                      ".........BB.....BB........",
                      ".........BB..............."),
    "walk-R-B": frame(EYES_R,
                      "..........BB...BB.........",
                      "...............BB........."),
    # moving left: left foot steps, then right foot steps
    "walk-L-A": frame(EYES_L,
                      "........BB.....BB.........",
                      "...............BB........."),
    "walk-L-B": frame(EYES_L,
                      ".........BB...BB..........",
                      ".........BB..............."),
    # idle looking around, feet planted
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
        imgs[name] = render(g, f"{OUT}/dragon-v10-{name}.png")
        print(f"saved dragon-v10-{name}.png")

    # Walk-cycle preview strip: R-A -> R-B -> R-A -> R-B (one full
    # rightward walk cycle), frames side by side on dark terminal bg.
    seq = ["walk-R-A", "walk-R-B", "walk-R-A", "walk-R-B"]
    w, h = imgs[seq[0]].size
    strip = Image.new("RGB", (w * len(seq), h), (11, 18, 32))
    for i, name in enumerate(seq):
        strip.paste(imgs[name], (i * w, 0), imgs[name])
    strip.save(f"{OUT}/walk-cycle-right.png")
    print("saved walk-cycle-right.png", strip.size)

    # Look strip: look-left, look-right.
    seq2 = ["look-left", "look-right"]
    strip2 = Image.new("RGB", (w * len(seq2), h), (11, 18, 32))
    for i, name in enumerate(seq2):
        strip2.paste(imgs[name], (i * w, 0), imgs[name])
    strip2.save(f"{OUT}/look-strip.png")
    print("saved look-strip.png", strip2.size)
