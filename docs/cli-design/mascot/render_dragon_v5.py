#!/usr/bin/env python3
"""Render 龙宝 v5 — slime-style face.

v4 was still "two dark rectangles = sunglasses". The fix is the face:
model it on the Dragon Quest slime (the reference for a round blue blob
that is cute): two SMALL dark oval eyes + one small curved smile.
  - eyes: 2x2 dark, closer together, lower on the face, with a 1px
    white highlight (shiny, not flat)
  - mouth: a small curved "U" smile over two rows (corners on row 10,
    bottom on row 11)
  - one small horn bump on top (body blue)
  - NO wings, NO belly, NO tail — the round body is the character.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'W' = white #f5f3ee (eye highlight)
  'D' = dark navy #1e3a5f (eyes, mouth)
"""
from PIL import Image

GRID = [
    "..........................",
    "............BB............",
    "...........BBBB...........",
    "..........BBBBBB..........",
    ".........BBBBBBBB.........",
    "........BBBBBBBBBB........",
    ".......BBBBBBBBBBBB.......",
    ".......BBBWDBBWDBBB.......",
    ".......BBBDDBBDDBBB.......",
    ".......BBBBBBBBBBBB.......",
    ".......BBBBDBBDBBBB.......",
    ".......BBBBBDDBBBBB.......",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    "..........BBBBBB..........",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant: top eye row -> body blue; bottom row keeps a thin
# dark line per eye (closed eyelids).
GRID_CLOSED = list(GRID)
GRID_CLOSED[7] = ".......BBBBBBBBBBBB......."
GRID_CLOSED[8] = ".......BBBDDBBDDBBB......."

COLORS = {
    "B": (96, 165, 250),    # body blue
    "W": (245, 243, 238),   # white
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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v5-{name}.png")
