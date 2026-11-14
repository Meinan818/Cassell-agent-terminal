#!/usr/bin/env python3
"""Render 龙宝 v8d — wings in a DARKER blue.

v8b's wings merged with the body (same colour = one wide shape, no
wings visible). The Claude beast's legs read as legs because there are
GAPS between them. A wing needs the same treatment: it must be VISIBLY
separate from the body. v8c makes the wings a darker blue (#2a5a8f) so
they read as wings against the body blue — the silhouette becomes
"a round body with two darker wings", which is a dragon.

  - round body (body blue), whale-like roundness
  - two side wings in darker blue (the dragon feature, now visible)
  - two tiny dark square eyes, no mouth
  - only 3 colours. No legs, no horn, no tail.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'M' = wing blue #2a5a8f (darker, so wings read)
  'D' = dark navy #1e3a5f (pupils)
  'W' = white #f5f3ee (eyes)
"""
from PIL import Image

GRID = [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "....M................M....",
    "...MMM..BBBBBBBBBB..MMM...",
    "...MMMMBBBBBBBBBBBBMMMM...",
    ".......BBWWWBBWWWBB.......",
    ".......BBWDWBBWDWBB.......",
    ".......BBBBBBBBBBBB.......",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant: the eyes disappear (body blue).
GRID_CLOSED = list(GRID)
GRID_CLOSED[9] = ".......BBBBBBBBBBBB......."
GRID_CLOSED[10] = ".......BBDDBBBDDBBB......."

COLORS = {
    "B": (96, 165, 250),    # body blue
    "M": (42, 90, 143),     # wing blue (darker)
    "D": (30, 58, 95),      # dark navy
    "W": (245, 243, 238),   # white
}
BG = None  # transparent background (the mascot sits on panels now,
             # not on a fixed dark canvas — see the beautified welcome)
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
    print(f"saved {path} ({w}x{h} -> {w*SCALE}x{h*SCALE})")


if __name__ == "__main__":
    for name, g in [("open", GRID), ("closed", GRID_CLOSED)]:
        lens = {len(r) for r in g}
        assert len(lens) == 1, (name, lens)
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v8d-{name}.png")
