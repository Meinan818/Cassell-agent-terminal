#!/usr/bin/env python3
"""Render 龙宝 v11 桌宠反应帧 (user request 2026-11-14 21:24:
"4 个全做，包括功能" — 优化 #1 龙宝变状态灯的反应帧).
Same base as v11 (26x18, 3 colours: body #60a5fa, eyes #0F172A,
white #FFFFFF). These are the EVENT reactions (not idle actions):
the pet stops being decoration and becomes a status light.

  celebrate  成功庆祝 : hop up 1 + happy closed eyes + 2 sparkles.
  dizzy      出错晕   : X-shaped eyes (dizzy/dead classic).
  yawn       打哈欠   : half-closed eyes (1-row line) + body slumped 1.
"""
from PIL import Image

BASE = [
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
    ".....BBBBBBBBBBBBBBBB.....",
    "......BBBBBBBBBBBBBB......",
    ".......BBBBBBBBBBBB.......",
    ".........BB....BB.........",
    ".........BB....BB.........",
    "..........................",
    "..........................",
    "..........................",
]

CLOSED = list(BASE)
CLOSED[7] = ".....BBBBBBBBBBBBBBBB....."
CLOSED[8] = ".....BBBDDBBBBBDDBBBB....."

W, H = 26, 18


def grid(lines):
    return [list(r) for r in lines]


def blank():
    return [["."] * W for _ in range(H)]


def put(g, r, c, ch):
    if 0 <= r < H and 0 <= c < W:
        g[r][c] = ch


def fill(g, r0, r1, c0, c1, ch):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            put(g, r, c, ch)


def shift(g, dr, dc):
    out = blank()
    for r in range(H):
        for c in range(W):
            nr, nc = r + dr, c + dc
            if 0 <= nr < H and 0 <= nc < W:
                out[nr][nc] = g[r][c]
    return out


def s(g):
    return ["".join(row) for row in g]


def celebrate():
    """Hop up 1 + happy closed eyes + 2 sparkles in the air."""
    g = shift(grid(CLOSED), -1, 0)
    put(g, 0, 3, "W")
    put(g, 0, 22, "W")
    return g


def dizzy():
    """X-shaped eyes: row 7 has the two diagonals' outer points,
    row 8 has the centre point (reads as an X at this scale)."""
    g = grid(BASE)
    # left eye (cols 8-10), right eye (cols 15-17)
    fill(g, 7, 7, 8, 10, "B")
    fill(g, 7, 7, 15, 17, "B")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    put(g, 7, 8, "D")
    put(g, 7, 10, "D")
    put(g, 8, 9, "D")
    put(g, 7, 15, "D")
    put(g, 7, 17, "D")
    put(g, 8, 16, "D")
    return g


def yawn():
    """Half-closed eyes (one thin line, lower row only) + slumped 1."""
    g = shift(grid(BASE), 1, 0)
    # after shifting down 1, the eyes sit at rows 8-9; keep only row 9
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    return g


FRAMES = {
    "react-celebrate": celebrate(),
    "react-dizzy": dizzy(),
    "react-yawn": yawn(),
}

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
}
SCALE = 28
OUT = "/home/hatch/workspace/cassell-agent/cli-design/mascot"
BG = (11, 18, 32)


def render(grid_lines, path, scale=SCALE):
    lines = grid_lines if isinstance(grid_lines[0], str) else s(grid_lines)
    h = len(lines)
    w = max(len(r) for r in lines)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(lines):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch] + (255,)
    img = img.resize((w * scale, h * scale), Image.NEAREST)
    img.save(path)
    return img


def strip(names, path):
    imgs = [render(FRAMES[n], f"{OUT}/dragon-v11-{n}.png") for n in names]
    w, h = imgs[0].size
    out = Image.new("RGB", (w * len(imgs), h), BG)
    for i, im in enumerate(imgs):
        out.paste(im, (i * w, 0), im)
    out.save(path)
    print(f"saved {path}", out.size)


if __name__ == "__main__":
    for name, g in FRAMES.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        render(lines, f"{OUT}/dragon-v11-{name}.png")
        print(f"saved dragon-v11-{name}.png")
    strip(["react-celebrate", "react-dizzy", "react-yawn"],
          f"{OUT}/action-reactions.png")
