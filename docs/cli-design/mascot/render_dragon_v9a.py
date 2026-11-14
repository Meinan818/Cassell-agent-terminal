#!/usr/bin/env python3
"""Render 龙宝 v9a — Direction A "One ice horn" (research §6, Direction A).

  - Round blob body (NOT a rectangle — that is Clawd's shape).
  - ONE oversized ice-crystal horn, centre of the head, 4 cells tall,
    triangular, white-tipped. The horn is the single silhouette breaker.
  - 2 stubby legs only (not 4).
  - Two ROUND/OVAL dot eyes (3x2, not squares), wide-set, low, no mouth.
  - Palette: body #60a5fa, eyes dark navy #0F172A, white horn tip.
    3 flat colours. No wings, no tail, no spikes, no whiskers.
"""
from PIL import Image

GRID = [
    "..........................",
    "............W.............",
    "...........WWW............",
    "..........BBBBB...........",
    "..........BBBBB...........",
    ".......BBBBBBBBBBBB.......",
    "......BBBBBBBBBBBBBB......",
    "......BBBBBBBBBBBBBB......",
    "......BBBDDDBBDDDBBB......",
    "......BBBDDDBBDDDBBB......",
    "......BBBBBBBBBBBBBB......",
    "......BBBBBBBBBBBBBB......",
    ".......BBBBBBBBBBBB.......",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    ".........BB....BB.........",
    ".........BB....BB.........",
    "..........................",
]

GRID_CLOSED = list(GRID)
GRID_CLOSED[8] = "......BBBBBBBBBBBBBB......"
GRID_CLOSED[9] = "......BBBBDDBBBBDDBB......"

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v9a-{name}.png")
