#!/usr/bin/env python3
"""Render 龙宝 v8 — original dragon, Claude principles only.

The user is right: v7b is a blue Claude beast with a horn — anyone can
tell at a glance. Claude is a REFERENCE, not a shape to copy. So v8 keeps
only Claude's PRINCIPLES and changes the SHAPE entirely:
  - principle: one flat colour, minimal face, distinctive silhouette,
    stubby proportions, instantly recognisable
  - shape: NOT a rectangle (that IS the Claude beast), NOT a plain circle
    (v3-v6 were generic blobs). A round body + two small bat wings
    sticking up from the shoulders. The silhouette is a circle with
    wings — a dragon, not a table, not a blob.
  - face: two tiny dark square eyes, no mouth (Claude's minimal face,
    but on a round body)
  - only 2 colours (body blue / dark navy). No legs, no horn, no tail —
    the wings ARE the dragon feature.

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
    ".....B..............B.....",
    ".....BB............BB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    "......BBBBBBBBBBBBBB......",
    "......BBBBBBBBBBBBBB......",
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

# Eyes-closed variant: the eyes disappear (body blue). The blink is
# eyes appear / disappear, 400ms a frame.
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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v8-{name}.png")
