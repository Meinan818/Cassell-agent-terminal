#!/usr/bin/env python3
"""Render 龙宝 v6 — white eyes with dark pupils.

The Claude mascot's eyes are WHITE with dark pupils (cartoon style), not
dark blocks with a highlight. v2 tried white eyes but the WHITE HORN
merged with them (too much white). v6 fixes that: the horn is body blue
(integrated), so the white eyes are the only white on the creature and
they pop against the blue body. Small curved smile, round body, one
horn bump, nothing else.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'W' = white #f5f3ee (eyes)
  'D' = dark navy #1e3a5f (pupils, mouth)
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
    ".......BBWWWBBWWWBB.......",
    ".......BBWDWBBWDWBB.......",
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

# Eyes-closed variant: the white eyes disappear (body blue); the pupils
# remain as thin dark lines (closed eyelids) on the bottom eye row.
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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v6-{name}.png")
