#!/usr/bin/env python3
"""Render 龙宝 v9 — Direction C "Big-head baby dragon" from the Clawd
research (report.md §6, Direction C).

The research's rules, applied:
  - Head ~50% of total height (chibi 1:1 head-to-body, baby schema):
    head rows 4-11 (8 rows), body+feet rows 12-17 (6 rows).
  - ONE dragon feature only: a pair of small bat-wing EARS on the head
    (two triangles, 3 cells tall, ice-blue with a WHITE tip). The
    wing-ears are the single silhouette breaker — they must be the only
    protrusions on the top silhouette (black-fill test).
  - Face = two ROUND/OVAL dot eyes (3x2, not squares — square eyes are
    Clawd's), wide-set, low on the face, no mouth, no nose.
  - Palette: body ice blue #60a5fa, eyes dark navy #0F172A (NOT Clawd's
    #141413 ink), white only as the wing-ear tip accent. 3 flat colours.
  - No legs on the body, no arms, no tail, no horns, no spikes, no
    whiskers. Two tiny feet only, so it reads as grounded.
  - Originality: round head (not Clawd's rectangle), 2 feet (not 4 legs),
    round eyes (not square), ice blue + white (not orange), wing-ears
    (a feature Clawd does not have). Silhouette changed first.

Grid legend:
  '.' = transparent
  'B' = body ice blue #60a5fa
  'D' = dark navy #0F172A (eyes)
  'W' = white #FFFFFF (wing-ear tips)
"""
from PIL import Image

GRID = [
    "..........................",
    "..........................",
    ".......W..........W.......",
    "......BBB........BBB......",
    "......BBBBBBBBBBBBBB......",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    ".....BBBDDDBBBBDDDBBB.....",
    ".....BBBDDDBBBBDDDBBB.....",
    ".....BBBBBBBBBBBBBBBB.....",
    "......BBBBBBBBBBBBBB......",
    "........BBBBBBBBBB........",
    ".......BBBBBBBBBBBB.......",
    ".......BBBBBBBBBBBB.......",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    "..........BB..BB..........",
]

# Eyes-closed variant (splash frame 1 + blink frame): the top eye row
# disappears (body blue) and the bottom eye row becomes two thin dark
# lines (2 cells each, centred where the eyes were).
GRID_CLOSED = list(GRID)
GRID_CLOSED[8] = ".....BBBBBBBBBBBBBBBB....."
GRID_CLOSED[9] = ".....BBBDDBBBBBDDBBBB....."

COLORS = {
    "B": (96, 165, 250),    # body ice blue
    "D": (15, 23, 42),      # dark navy (eyes)
    "W": (255, 255, 255),   # white (wing-ear tips)
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
    print(f"saved {path} ({w}x{h} -> {w*SCALE}x{h*SCALE})")


if __name__ == "__main__":
    for name, g in [("open", GRID), ("closed", GRID_CLOSED)]:
        lens = {len(r) for r in g}
        assert len(lens) == 1, (name, lens)
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v9-{name}.png")
