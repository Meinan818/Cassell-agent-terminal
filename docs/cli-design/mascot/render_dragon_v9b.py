#!/usr/bin/env python3
"""Render 龙宝 v9b — Direction B "Long low loong" (research §6, Direction B).

  - Long, low horizontal body (a capsule, wider than tall) — the Chinese
    loong cue, translated to one readable gesture at terminal size.
  - Tiny head at the LEFT end with two round dot eyes (2x2).
  - ONE oversized curled tail at the RIGHT end, rising 6 cells and
    ending in a single white ice shard. The tail is the one feature.
  - No legs (floating / swimming pose). No wings, no horns, no mane.
  - Palette: body #60a5fa, eyes dark navy #0F172A, white tail tip.
    3 flat colours.
"""
from PIL import Image

GRID = [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    ".....................W....",
    "....................WW....",
    "...................BBB....",
    "...................BBB....",
    "..BBBBB............BBB....",
    ".BDDBDDB...........BBB....",
    ".BDDBDDBBBBBBBBBBBBBB.....",
    ".BBBBBBBBBBBBBBBBBBBB.....",
    ".BBBBBBBBBBBBBBBBBBBB.....",
    "..BBBBBBBBBBBBBBBBBB......",
    "..........................",
    "..........................",
    "..........................",
]

GRID_CLOSED = list(GRID)
GRID_CLOSED[10] = ".BBBBBBB...........BBB...."
GRID_CLOSED[11] = ".BBBBBBBBBBBBBBBBBBBB....."

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v9b-{name}.png")
