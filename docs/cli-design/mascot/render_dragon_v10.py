#!/usr/bin/env python3
"""Render 龙宝 v10 — Direction C simplified, Clawd-style (user request
2026-11-14 18:31: "3号的头可以只留头加和手和脚吗，就和claude的螃蟹一样").

Clawd's trick: the body IS the face. One fused shape, no separate
head/body split — limbs attach directly to the face. So v10 drops the
small body of v9 and keeps:
  - ONE big round head (the whole creature, 10 rows tall, 16 wide),
  - the wing-ears on top (white tips) — the single dragon marker,
  - two round eyes (3x2, dark navy),
  - two small hands (2x2 nubs on the sides, like Clawd's side arms),
  - two small feet (2x2, under the head, like Clawd's legs).
Palette: body #60a5fa, eyes dark navy #0F172A, white wing-ear tips.
3 flat colours. No mouth, no nose, no tail, no separate body.
"""
from PIL import Image

GRID = [
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

GRID_CLOSED = list(GRID)
GRID_CLOSED[7] = ".....BBBBBBBBBBBBBBBB....."
GRID_CLOSED[8] = ".....BBBDDBBBBBDDBBBB....."

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
}
SCALE = 28


def render(grid, path):
    h = len(grid)
    w = max(len(r) for r in grid)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch] + (255,)
    img = img.resize((w * SCALE, h * SCALE), Image.NEAREST)
    img.save(path)
    print(f"saved {path}")


if __name__ == "__main__":
    for name, g in [("open", GRID), ("closed", GRID_CLOSED)]:
        lens = {len(r) for r in g}
        assert len(lens) == 1, (name, lens)
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v10-{name}.png")
