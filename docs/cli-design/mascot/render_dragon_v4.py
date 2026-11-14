#!/usr/bin/env python3
"""Render 龙宝 v4 — the baby blue dragon mascot, redone after the user said
v3 "has none of the Claude mascot's cuteness".

Diagnosis of v3: too many parts stuck on a blob (horn + wings + belly +
tail + eyes + mouth). It read as "a blue blob with stuff on it", not a
character. The Claude mascot is cute because it is SIMPLE: one round body
+ big eyes + small mouth. v4 does the same subtraction:
  - one round body (a circle, the dominant shape)
  - two BIG eyes (3x2, dark with a white highlight) — the focal point
  - one small smile
  - one small horn bump on top (body blue, integrated, not a white tab)
  - NO wings, NO belly patch, NO tail.

Grid legend:
  '.' = transparent (terminal bg)
  'B' = body blue #60a5fa
  'W' = white #f5f3ee (eye highlight)
  'D' = dark navy #1e3a5f (eyes, mouth)
"""
from PIL import Image

GRID = [
    # v4: subtraction. Round body + big eyes + small smile + one horn bump.
    "..........................",
    "............BB............",
    "...........BBBB...........",
    "..........BBBBBB..........",
    ".........BBBBBBBB.........",
    "........BBBBBBBBBB........",
    ".......BBBBBBBBBBBB.......",
    ".......BBWDDBBWDDBB.......",
    ".......BBDDDBBDDDBB.......",
    ".......BBBBBBBBBBBB.......",
    ".......BBBBBDDBBBBB.......",
    ".......BBBBBBBBBBBB.......",
    "........BBBBBBBBBB........",
    ".........BBBBBBBB.........",
    "..........BBBBBB..........",
    "..........................",
    "..........................",
    "..........................",
]

# Eyes-closed variant (splash frame 1 + blink frame): the top eye row
# becomes body blue; the bottom row keeps a thin dark line per eye
# (closed eyelids), centred in the 3-wide eye.
GRID_CLOSED = list(GRID)
GRID_CLOSED[7] = ".......BBBBBBBBBBBB......."
GRID_CLOSED[8] = ".......BBDDBBBDDBBB......."

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
        render(g, f"/home/hatch/workspace/cassell-agent/cli-design/mascot/dragon-v4-{name}.png")
