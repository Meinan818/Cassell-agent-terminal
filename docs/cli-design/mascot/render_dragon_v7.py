#!/usr/bin/env python3
"""Render 龙宝 v7 — redrawn after the user sent the actual Claude mascot
screenshot ("更丑了你看人家claude").

What the Claude mascot actually is (from the user's screenshot):
  - a HORIZONTAL rectangular body (wider than tall), not a round blob
  - FOUR short legs at the bottom (the most distinctive feature)
  - TWO tiny dark eyes (small squares, no highlight, no pupils)
  - NO mouth at all — the face is just the two eyes
  - one flat colour (orange/salmon), accessories only in variants
  - the cuteness is the SILHOUETTE (rectangle + legs) and the extreme
    simplicity, not big eyes or a smile.

v7 translates that language into a dragon, keeping the Claude silhouette:
  - horizontal blue rectangle body (16 wide x 7 tall)
  - four short legs (2 wide x 2 tall each)
  - two tiny dark square eyes (2x2, no highlight)
  - NO mouth
  - ONE dragon feature: a small triangular horn on top (body blue,
    integrated — part of the creature, not an accessory)
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
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBDDBBBBDDBBBB.....",
    ".....BBBBDDBBBBDDBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    "......BB..BB..BB..BB......",
    "......BB..BB..BB..BB......",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant (splash frame 1 + blink frame): the eyes disappear
# (body blue). The blink is eyes appear / disappear, 400ms a frame.
GRID_CLOSED = list(GRID)
GRID_CLOSED[8] = ".....BBBBBBBBBBBBBBBB....."
GRID_CLOSED[9] = ".....BBBBBBBBBBBBBBBB....."

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v7-{name}.png")
