#!/usr/bin/env python3
"""Render 龙宝 v9d — Direction D "Ice-shard dragon" (research §6, Direction D).

  - TRIANGULAR / diamond body (point at the top, wide at the bottom) —
    the opposite of Clawd's rectangle and of Direction A's circle.
  - Two round dot eyes (2x2) on the upper third.
  - ONE contrasting white/ice belly plate — a single vertical diamond
    shard down the centre of the body. The shard is the one feature
    and the ice cue (a frozen core).
  - Two tiny feet under the corners. No horns, no wings, no tail.
  - Palette: body #60a5fa, eyes dark navy #0F172A, white belly shard.
    3 flat colours.
"""
from PIL import Image

GRID = [
    "..........................",
    "..........................",
    "..........................",
    "............B.............",
    "...........BBB............",
    "..........BBBBB...........",
    ".........BBBBBBB..........",
    "........BBBBBBBBB.........",
    "........BBDDBBDDBB........",
    ".......BBBDDBBDDBBB.......",
    ".......BBBBWWBBBBBB.......",
    "......BBBBWWWWBBBBBB......",
    "......BBBBWWWWBBBBBB......",
    ".....BBBBBBWWBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    "........BB........BB......",
    "..........................",
    "..........................",
]

GRID_CLOSED = list(GRID)
GRID_CLOSED[8] = "........BBBBBBBBBB........"
GRID_CLOSED[9] = ".......BBBDDBBDDBBB......."

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v9d-{name}.png")
