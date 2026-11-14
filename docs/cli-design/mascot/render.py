#!/usr/bin/env python3
"""Render the CLI mascot pixel grid to a PNG for visual iteration.

Grid legend:
  '.' = transparent (terminal bg)
  'W' = white (face / uniform / cap)
  'B' = EVA blue #60a5fa (eyes / tie / ball)
  'w' = dim gray (hair shadow / uniform shading)
"""
from PIL import Image

GRID = [
    # v6 (final): blue cap with white center band, big 2x2 eyes, small
    # uniform + tie, thin waving arm, round ball with highlight.
    "..........................",
    "..........BBBBB...........",
    ".........BBWWBBB..........",
    ".........WWWWWWW..........",
    "........WWWWWWWWW.........",
    "........WBBWWBBWW.........",
    "........WBBWWBBWW.........",
    "........WWWWWWWWW.........",
    ".........WWwwwWW..........",
    "...........WWW............",
    "..WW....uuuWWuuuu.........",
    "....W..uuuuBBuuuuu........",
    ".....WWuuuuBBuuuuu...BBB..",
    ".......uuuuBBuuuuu..BWBBB.",
    ".......uuuuBBuuuuu..BBBBB.",
    "........uuuuuuuuu...BBBBB.",
    "........uuuuuuuuu....BBB..",
    "........uuuuuuuuu.........",
]

# Eyes-closed variant (splash frame 1 + blink frame):
# top eye row goes all-white, bottom eye row becomes thin gray lines.
GRID_CLOSED = list(GRID)
GRID_CLOSED[5] = "........WWWWWWWWW........."
GRID_CLOSED[6] = "........WwwWWwwWW........."

COLORS = {
    "W": (245, 243, 238),   # near-white
    "B": (96, 165, 250),    # EVA blue
    "w": (150, 146, 140),   # hair gray (lighter)
    "u": (107, 104, 98),    # uniform gray (darker)
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
    render(GRID, "/home/hatch/workspace/cassell-agent/cli-design/mascot/mascot-v1.png")
