#!/usr/bin/env python3
"""Render the new CLI mascot: 龙宝 (baby blue dragon) — a cute round creature
like the blue whale, not a humanoid. Round body, big dark eyes with white
highlights, small horn, tiny wings, light-blue belly, small tail.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'L' = belly light blue #a8c8fa
  'W' = white #f5f3ee (eye highlights, horn)
  'D' = dark navy #1e3a5f (eye pupils, mouth)
  'M' = wing blue #3b82c4 (slightly darker than body)
"""
from PIL import Image

GRID = [
    # v3: dark 2x2 eyes with highlight, wider apart; curved smile (2 rows);
    # smaller horn; wings darker; tail attached to body.
    "..........................",
    "............W.............",
    "...........WWW............",
    "..........WWWWW...........",
    ".........BBBBBBBB.........",
    "........BBBBBBBBBB........",
    ".......BBWDBBBWDBBB.......",
    ".......BBDDBBBDDBBB.......",
    ".....MMBBBBBBBBBBBBMM.....",
    "...MMMMBBBDBBBDBBBBMMMM...",
    ".....MMBBBLLLLLLBBBMM.....",
    ".......BBBLLLLLLBBB.......",
    "........BBLLLLLLBB........",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    "..........BBBBBB.BBB......",
    ".................BBB......",
    "..........................",
]

# Eyes-closed variant: top eye row -> body blue, bottom row keeps thin
# dark lines as closed eyelids.
GRID_CLOSED = list(GRID)
GRID_CLOSED[6] = ".......BBBBBBBBBBBB......."
GRID_CLOSED[7] = ".......BBDDBBBBDDBB......."

COLORS = {
    "B": (96, 165, 250),    # body blue
    "L": (168, 200, 250),   # belly light blue
    "W": (245, 243, 238),   # white
    "D": (30, 58, 95),      # dark navy
    "M": (42, 90, 143),     # wing blue (darker, so wings read)
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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v1-{name}.png")
