#!/usr/bin/env python3
"""Render 龙宝 v8b — wings moved to the SIDES.

v8's wings sat on top and read as ears (a blob with ears = a cat/bear,
not a dragon). v8b puts the wings on the SIDES, sticking OUT — a bat
wing's triangle points up-and-out from the shoulder, not straight up
from the head. Same principles (one flat colour, minimal face, round
body, no mouth, no legs, no horn): the wings alone are the dragon.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'D' = dark navy #1e3a5f (eyes)
"""
from PIL import Image

GRID = [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "....B................B....",
    "...BBB..BBBBBBBBBB..BBB...",
    "....BBBBBBBBBBBBBBBBBB....",
    "......BBBBDDBBDDBBBB......",
    "......BBBBDDBBDDBBBB......",
    "......BBBBBBBBBBBBBB......",
    ".......BBBBBBBBBBBB.......",
    "........BBBBBBBBBB........",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant: the eyes disappear (body blue).
GRID_CLOSED = list(GRID)
GRID_CLOSED[9] = "......BBBBBBBBBBBBBB......"
GRID_CLOSED[10] = "......BBBBBBBBBBBBBB......"

COLORS = {
    "B": (96, 165, 250),    # body blue
    "D": (30, 58, 95),      # dark navy
}
BG = (20, 20, 19)  # terminal dark #141413
SCALE = 28


def render(grid, path):
    h = len(grid)
    w = max(len(r) for r in grid)
    img = Image.new("RGB", (w, h), BG)
    px = img.load()
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch]
    img = img.resize((w * SCALE, h * SCALE), Image.NEAREST)
    img.save(path)
    print(f"saved {path} ({w}x{h} -> {w*SCALE}x{h*SCALE})")


if __name__ == "__main__":
    for name, g in [("open", GRID), ("closed", GRID_CLOSED)]:
        lens = {len(r) for r in g}
        assert len(lens) == 1, (name, lens)
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v8b-{name}.png")
