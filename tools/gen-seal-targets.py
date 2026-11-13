#!/usr/bin/env python3
"""Sample the real Cassell seal (public/cassell-seal.jpg) into particle
target points for the boot 3D particle crest.

Bright pixels = crest. Rejection sampling weighted by luminance, fixed
seed (deterministic) so the crest is identical every launch. Points are
normalized so the crest CONTENT (not the image frame) spans [-1, 1]:
the emblem only fills ~61% of the photo, so normalizing by the image
frame would shrink it. z depth is assigned at runtime (front/back/side).

Usage: python3 tools/gen-seal-targets.py
Output: src/components/sealTargets.ts
"""
import random
from PIL import Image

SEED = 1337
N = 30000
# 30000 颗 + 1px 晕染：真校徽的笔画在 300px 尺度只有 1–3px 宽，
# 10000 颗沿细笔画排是断续的虚线，成型后像淡淡的云；参考视频
# （frame-09）里的心形是一条粗实、密不透风的发光带。1px 晕染
# 让笔画加粗成带（形状本身不动），30000 颗填满这条带，粒子
# 重叠成实心的光带。20000 颗一版已验证可读、中心不过曝，
# 再加到 30000 颗是往视频那种“密不透风”再推一档。
SRC = "public/cassell-seal.jpg"
OUT = "src/components/sealTargets.ts"

random.seed(SEED)
im = Image.open(SRC).convert("RGB")
W, H = im.size
sw = 300
sh = round(300 * H / W)
small = im.resize((sw, sh))
px = small.load()


def lum(x, y):
    r, g, b = px[x, y]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


# 亮度预计算（1px 晕染要反复查邻域，先算好一张表）。
LUM = [[lum(x, y) for x in range(sw)] for y in range(sh)]


def neighbor_max_lum(x, y):
    m = 0
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = x + dx, y + dy
            if 0 <= nx < sw and 0 <= ny < sh and LUM[ny][nx] > m:
                m = LUM[ny][nx]
    return m


raw = []
guard = 0
while len(raw) < N and guard < N * 80:
    guard += 1
    sx = random.randrange(sw)
    sy = random.randrange(sh)
    L = LUM[sy][sx]
    if L >= 55:
        if random.random() > (L - 55) / 200 + 0.15:
            continue
        raw.append((sx, sy, int(L)))
        continue
    # 1px 晕染：紧贴亮像素的暗像素以较低概率采入（晕染层比核心稀疏，
    # 光带是亮核 + 柔边，不是生硬加粗），笔画加粗成发光带。
    nl = neighbor_max_lum(sx, sy)
    if nl < 55:
        continue
    if random.random() > 0.35 * ((nl - 55) / 200 + 0.15):
        continue
    raw.append((sx, sy, int(L)))

# normalize by the CONTENT extent so the emblem spans [-1, 1]
half = max(sw, sh) / 2
nx = [(sx - sw / 2) / half for sx, _, _ in raw]
ny = [(sy - sh / 2) / half for _, sy, _ in raw]
extent = max(max(abs(v) for v in nx), max(abs(v) for v in ny))
pts = [(round(x / extent, 4), round(y / extent, 4), L)
       for (x, y), L in zip(zip(nx, ny), [p[2] for p in raw])]
print(f"sampled {len(pts)} points, extent {extent:.3f}")

with open(OUT, "w") as f:
    f.write("/**\n")
    f.write(" * 卡塞尔校徽粒子布点：由真校徽照片（public/cassell-seal.jpg）\n")
    f.write(" * 在构建期采样得到（亮像素 = 校徽），x/y 已归一化到 [-1, 1]\n")
    f.write(" *（按校徽内容范围归一化，校徽只占照片约 61%），lum 为该点\n")
    f.write(" * 亮度 0–255。构建期预计算，避免运行时加载图片的竞态\n")
    f.write(" *（图慢到就只剩双环兜底）。z 轴深度在运行时按前脸 / 后脸 /\n")
    f.write(" * 侧壁分配。生成脚本见 tools/gen-seal-targets.py（seed 1337）。\n")
    f.write(" */\n")
    f.write("export interface SealTarget { x: number; y: number; lum: number }\n")
    f.write("export const SEAL_TARGETS: SealTarget[] = [\n")
    for x, y, L in pts:
        f.write(f"  {{ x: {x}, y: {y}, lum: {L} }},\n")
    f.write("];\n")
print(f"wrote {OUT}")
