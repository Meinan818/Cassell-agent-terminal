#!/usr/bin/env python3
"""Render 龙宝 v7b — Claude-beast language, legs fixed.

v7's legs didn't read (2 rows tall, same colour as the body — they looked
like a bumpy bottom edge, not legs). v7b makes the legs TALLER (3 rows)
and the body SHORTER (6 rows) so the legs are proportionally prominent,
with clear 2-cell gaps between them. The Claude beast's legs are about
1/3 of the body height and clearly separated — same here.

  - horizontal blue rectangle body (14 wide x 6 tall)
  - four short legs (2 wide x 3 tall each), clear gaps
  - two tiny dark square eyes (2x2, no highlight)
  - NO mouth
  - ONE dragon feature: a small triangular horn on top (body blue)
  - only 2 colours (body blue / dark navy).

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
    "............B.............",
    "...........BBB............",
    "..........BBBBB...........",
    "......BBBBBBBBBBBBBB......",
    "......BBBBBBBBBBBBBB......",
    "......BBBDDBBBBDDBBB......",
    "......BBBDDBBBBDDBBB......",
    "......BBBBBBBBBBBBBB......",
    "......BBBBBBBBBBBBBB......",
    "......BB..BB..BB..BB......",
    "......BB..BB..BB..BB......",
    "......BB..BB..BB..BB......",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant: the eyes disappear (body blue). The blink is
# eyes appear / disappear, 400ms a frame.
GRID_CLOSED = list(GRID)
GRID_CLOSED[8] = "......BBBBBBBBBBBBBB......"
GRID_CLOSED[9] = "......BBBBBBBBBBBBBB......"

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v7b-{name}.png")
