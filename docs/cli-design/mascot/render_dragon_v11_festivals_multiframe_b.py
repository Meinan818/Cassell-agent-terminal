#!/usr/bin/env python3
"""Render noya v11 节日版常驻动作 · 多帧版 B 组 (圣诞 / 新年 / 春节).

只负责 christmas / newyear / springfest 三个节日, 每节日 10 种常驻动作
的多帧版, 每节日 40 帧, 共 120 帧. 眨眼复用已有的 <fest>-blink, 不新画.

帧数与姿态与 base 多帧版一致, 只是穿着该节日原有造型 (不改造型):
  walk  走路   R/L 各 4 帧: A 右脚前抬 / B 双脚着地 / C 左脚前抬 / D 双脚着地
  look  张望   左右各 3 帧: 1 眼睛居中 / 2 半偏 / 3 全偏
  jump  跳     3 帧: 1 蹲下(身体下沉 1 格) / 2 最高点(整只上移 2 格、脚收起)
                    / 3 落地. 造型跟着身体走, 不被裁 (festivals_full 的
                    脚收起 + 下方白色动感虚线; 上移 2 格会裁掉帽顶/翼耳尖,
                    所以移后把造型按原位补回头顶、翼耳尖补回顶行).
  sleep 睡觉   4 帧: 1 闭眼 + 小 Z 低处 / 2 Z 上飘 / 3 Z 再上 + 身体下沉 1 格
                    / 4 Z 最高 + 身体下沉 1 格
  roll  打滚   4 帧: 蓝球 + 白色旋转标记 4 个角度 (顶/右/底/左);
                    造型移到球顶上方 (festivals_full roll 的做法).
  peek  躲猫猫 3 帧: 1 藏只露翼耳尖 / 2 半露 / 3 全露.
                    造型下移跟着露头 (festivals_full peek: 沉到下沿 +
                    造型下移 14 行; 半露为整体下移 7 格).
  dance 跳舞   4 帧: 1 左倾 / 2 居中左脚点地 / 3 右倾 / 4 居中右脚点地.
                    造型先戴好再整体平移 (festivals_full dance 的做法).
  snow  接雪花 4 帧: 掉落物 4 个下落位置 (高/中/近头顶/落到头顶),
                    眼睛上移跟着盯, 第 4 帧开心闭眼. 掉落物按节日换:
                    圣诞=白色雪花 / 新年=五彩纸屑 / 春节=红色花瓣.
                    位置在右上方, 姿态与原版一致.
  eat   吃东西 4 帧: 1 食物出现 / 2 啄一下食物变小 / 3 再啄一下更小 + 碎屑
                    / 4 吃完满足闭眼. 食物按节日换: 圣诞=曲奇(T) /
                    新年=红点心(R) / 春节=饺子(W). 食物在嘴边 (2x2).
  blink 眨眼   复用已有 <fest>-blink, 不新画.

只画帧, 不定播放速度、不写触发/时序/冷却/状态机 (那些归 Codex).
v11 本体一个像素不动 (26x18, 体蓝 #60a5fa, 眼睛 #0F172A,
翼耳尖白 #FFFFFF). 颜色只用节日自己的颜色, 不要金色.

复用: render_dragon_v11_festivals.py (造型 + 辅助函数),
render_dragon_v11_christmas.py (圣诞造型),
render_dragon_v11_festivals_full.py (节日版 7 动作画法 + 造型跟随规则),
render_dragon_v11_actions.py (原版动作画法: roll_ball / peek_hide).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

import render_dragon_v11_festivals as F
import render_dragon_v11_christmas as C
import render_dragon_v11_festivals_full as FF
from render_dragon_v11_actions import roll_ball, peek_hide

BASE = F.BASE
CLOSED = F.CLOSED
EYES_R = F.EYES_R
grid = F.grid
blank = F.blank
put = F.put
fill = F.fill
shift = F.shift
s = F.s
eyes_up = F.eyes_up
happy_eyes = F.happy_eyes
COLORS = F.COLORS
OUT = F.OUT
BG = F.BG
W, H = F.W, F.H

FESTS = ["christmas", "newyear", "springfest"]

TOPPERS = {
    "christmas": C.santa_hat,
    "newyear": F.top_newyear,
    "springfest": F.top_springfest,
}

# 食物颜色 (2x2, 嘴边 rows 13-14, cols 21-22)
FOOD_COLOR = {"christmas": "T", "newyear": "R", "springfest": "W"}

# --- 眼睛行: 居中 / 右偏 1 / 右偏 2 / 左偏 1 / 左偏 2 ---
EYES_R2 = ".....BBBBBDDDBBBBDDDB....."
EYES_L = ".....BBDDDBBBBDDDBBBB....."
EYES_L2 = ".....BDDDBBBBDDDBBBBB....."

EYES = {
    ("R", 1): None,          # 居中 = BASE 原样
    ("R", 2): EYES_R,
    ("R", 3): EYES_R2,
    ("L", 1): None,
    ("L", 2): EYES_L,
    ("L", 3): EYES_L2,
}


def set_eyes(g, row):
    if row is not None:
        g[7] = list(row)
        g[8] = list(row)


def mirror_row(row):
    return row[::-1]


# --- walk: R/L 各 4 帧 ---
# R-A (右脚前抬, 沿用 christmas_walk 的脚位):
R_A = (".........BB.....BB........", ".........BB...............")
# R-C (左脚前抬, R-A 的镜像):
R_C = ("........BB.....BB.........", "...............BB.........")
R_FEET = {"A": R_A, "B": None, "C": R_C, "D": None}  # B/D = 双脚着地 = BASE 原样


def walk_frame(top_fn, direction, phase):
    g = grid(BASE)
    set_eyes(g, EYES_R if direction == "R" else EYES_L)
    feet = R_FEET[phase]
    if feet is not None:
        r13, r14 = feet
        if direction == "L":
            r13, r14 = mirror_row(r13), mirror_row(r14)
        g[13] = list(r13)
        g[14] = list(r14)
    return top_fn(g)


# --- look: 左右各 3 帧 ---
def look_frame(top_fn, direction, step):
    g = grid(BASE)
    set_eyes(g, EYES[(direction, step)])
    return top_fn(g)


# --- jump: 3 帧 ---
def jump_frame(top_fn, n):
    if n == 1:
        # 蹲下: 整体下沉 1 格 (造型跟着走)
        return shift(top_fn(grid(BASE)), 1, 0)
    if n == 2:
        # 最高点: 脚收起 + 下方白色动感虚线, 整只上移 2 格.
        # 上移会裁掉帽顶与翼耳尖, 所以移后把造型按原位补回头顶,
        # 翼耳尖补回顶行 (0,7) / (0,18), 造型不丢、白尖可见.
        g = top_fn(grid(BASE))
        fill(g, 13, 14, 9, 10, ".")     # 脚收起
        fill(g, 13, 14, 15, 16, ".")
        put(g, 15, 8, "W")              # 下方白色动感虚线
        put(g, 15, 17, "W")
        g = shift(g, -2, 0)
        g = top_fn(g)                   # 造型补回头顶原位
        put(g, 0, 7, "W")               # 翼耳尖补回顶行
        put(g, 0, 18, "W")
        return g
    # 3 落地: 常驻帧
    return top_fn(grid(BASE))


# --- sleep: 4 帧, Z 上飘 ---
def draw_z(g, r, c):
    fill(g, r, r, c, c + 2, "W")
    put(g, r + 1, c + 1, "W")
    fill(g, r + 2, r + 2, c, c + 2, "W")


def sleep_frame(top_fn, n):
    if n == 1:
        g = top_fn(grid(CLOSED))
        draw_z(g, 3, 20)                # 小 Z 低处
        return g
    if n == 2:
        g = top_fn(grid(CLOSED))
        draw_z(g, 1, 21)                # Z 上飘
        return g
    if n == 3:
        g = shift(top_fn(grid(CLOSED)), 1, 0)   # 身体下沉 1 格
        draw_z(g, 0, 21)                # Z 再上
        return g
    g = shift(top_fn(grid(CLOSED)), 1, 0)       # 身体下沉 1 格
    draw_z(g, 0, 22)                    # Z 最高 (再往右上飘)
    return g


# --- roll: 4 帧, 白色旋转标记 4 个角度 ---
ROLL_MARKS = {
    1: [(6, 12), (6, 13)],       # 顶
    2: [(8, 17), (9, 17)],       # 右
    3: [(12, 12), (12, 13)],     # 底
    4: [(8, 8), (9, 8)],         # 左
}


def roll_frame(top_fn, n):
    # 蓝球 + 造型移到球顶上方 (festivals_full roll 的做法)
    g = FF.composite(roll_ball(), FF.topper_shifted(top_fn, 3))
    for (r, c) in ROLL_MARKS[n]:
        put(g, r, c, "W")
    return g


# --- peek: 3 帧 ---
def peek_frame(top_fn, fest, n):
    if n == 1:
        # 藏只露翼耳尖 + 造型下移 14 行 (festivals_full peek 的做法)
        return FF.peek_base(top_fn, fest)
    if n == 2:
        # 半露: 整体下移 7 格, 眼睛刚露到下沿
        return shift(top_fn(grid(BASE)), 7, 0)
    # 3 全露: 常驻帧
    return top_fn(grid(BASE))


# --- dance: 4 帧 ---
def dance_frame(top_fn, n):
    if n == 1:
        # 左倾 (festivals_full dance 的镜像)
        g = shift(top_fn(grid(BASE)), 0, -1)
        put(g, 14, 8, ".")
        put(g, 14, 9, ".")
        return g
    if n == 2:
        # 居中, 左脚点地 (右脚抬起)
        g = top_fn(grid(BASE))
        put(g, 14, 15, ".")
        put(g, 14, 16, ".")
        return g
    if n == 3:
        # 右倾 (festivals_full dance 原样)
        return FF.dance_base(top_fn)
    # 4 居中, 右脚点地 (左脚抬起)
    g = top_fn(grid(BASE))
    put(g, 14, 9, ".")
    put(g, 14, 10, ".")
    return g


# --- snow: 4 帧, 掉落物右上方下落 ---
def snow_frame(top_fn, fest, n):
    pattern = FF.SNOW_ITEMS[fest]       # 2x2, rows 0-1, cols 20-21
    g = top_fn(grid(BASE))
    if n in (1, 2, 3):
        eyes_up(g)
        dr = {1: 0, 2: 3, 3: 5}[n]      # 高 / 中 / 近头顶
        for (r, c, ch) in pattern:
            put(g, r + dr, c, ch)
    else:
        # 4 落到头顶: 掉落物落在头顶右上方, 开心闭眼
        happy_eyes(g)
        chars = [ch for (_, _, ch) in pattern]
        for (r, c), ch in zip([(2, 18), (2, 19), (3, 18), (3, 19)], chars):
            put(g, r, c, ch)
    return g


# --- eat: 4 帧 ---
def eat_frame(top_fn, fest, n):
    fc = FOOD_COLOR[fest]
    snack = [(13, 21), (13, 22), (14, 21), (14, 22)]
    if n == 1:
        # 食物出现 (festivals_full eat 原样)
        g = grid(BASE)
        set_eyes(g, EYES_R)
        for (r, c) in snack:
            put(g, r, c, fc)
        return top_fn(g)
    if n == 2:
        # 啄一下: 整体下沉 1 格 (低头啄), 食物变小剩 1 格
        g = grid(BASE)
        set_eyes(g, EYES_R)
        for (r, c) in snack:
            put(g, r, c, fc)
        g = shift(top_fn(g), 1, 0)
        for (r, c) in [(14, 21), (14, 22), (15, 22)]:
            put(g, r, c, ".")
        return g                     # 只剩 (15,21) 一格
    if n == 3:
        # 再啄一下更小 + 碎屑: 只剩 1 格小食物 + 两粒碎屑
        g = grid(BASE)
        set_eyes(g, EYES_R)
        put(g, 14, 21, fc)
        put(g, 15, 20, fc)          # 碎屑
        put(g, 16, 22, fc)
        return top_fn(g)
    # 4 吃完满足闭眼
    g = top_fn(grid(BASE))
    happy_eyes(g)
    return g


# --- build all 120 frames ---
NEW = {}
for fest in FESTS:
    top_fn = TOPPERS[fest]
    for d in ("R", "L"):
        for ph in ("A", "B", "C", "D"):
            NEW[f"{fest}-walk-{d}-{ph}"] = walk_frame(top_fn, d, ph)
    for d in ("left", "right"):
        for step in (1, 2, 3):
            NEW[f"{fest}-look-{d}-{step}"] = look_frame(
                top_fn, "L" if d == "left" else "R", step)
    for n in (1, 2, 3):
        NEW[f"{fest}-jump-{n}"] = jump_frame(top_fn, n)
    for n in (1, 2, 3, 4):
        NEW[f"{fest}-sleep-{n}"] = sleep_frame(top_fn, n)
    for n in (1, 2, 3, 4):
        NEW[f"{fest}-roll-{n}"] = roll_frame(top_fn, n)
    for n in (1, 2, 3):
        NEW[f"{fest}-peek-{n}"] = peek_frame(top_fn, fest, n)
    for n in (1, 2, 3, 4):
        NEW[f"{fest}-dance-{n}"] = dance_frame(top_fn, n)
    for n in (1, 2, 3, 4):
        NEW[f"{fest}-snow-{n}"] = snow_frame(top_fn, fest, n)
    for n in (1, 2, 3, 4):
        NEW[f"{fest}-eat-{n}"] = eat_frame(top_fn, fest, n)

assert len(NEW) == 120, len(NEW)

# 原有 13 帧 (供拼图用, 不重画): hat / walk / blink / sleep /
# look / jump / roll / peek / dance / snow / eat / 专属特殊动作 x2
OLD = {}
OLD.update(F.FRAMES)
OLD.update(C.FRAMES)
OLD.update(FF.NEW)
SPECIALS = dict(F.SPECIAL_NAMES)
SPECIALS["christmas"] = ("gift", "lights")

OLD_ORDER = {}
for fest in FESTS:
    a, b = SPECIALS[fest]
    OLD_ORDER[fest] = [f"{fest}-hat", f"{fest}-walk", f"{fest}-blink",
                       f"{fest}-sleep", f"{fest}-look", f"{fest}-jump",
                       f"{fest}-roll", f"{fest}-peek", f"{fest}-dance",
                       f"{fest}-snow", f"{fest}-eat",
                       f"{fest}-{a}", f"{fest}-{b}"]

NEW_ORDER = {}
for fest in FESTS:
    NEW_ORDER[fest] = (
        [f"{fest}-walk-R-{p}" for p in "ABCD"] +
        [f"{fest}-walk-L-{p}" for p in "ABCD"] +
        [f"{fest}-look-left-{i}" for i in (1, 2, 3)] +
        [f"{fest}-look-right-{i}" for i in (1, 2, 3)] +
        [f"{fest}-jump-{i}" for i in (1, 2, 3)] +
        [f"{fest}-sleep-{i}" for i in (1, 2, 3, 4)] +
        [f"{fest}-roll-{i}" for i in (1, 2, 3, 4)] +
        [f"{fest}-peek-{i}" for i in (1, 2, 3)] +
        [f"{fest}-dance-{i}" for i in (1, 2, 3, 4)] +
        [f"{fest}-snow-{i}" for i in (1, 2, 3, 4)] +
        [f"{fest}-eat-{i}" for i in (1, 2, 3, 4)])

ALL = {}
ALL.update(OLD)
ALL.update(NEW)

SCALE = 28


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


def contact_sheet_grouped(fest, path, scale=SCALE):
    """按动作分行排: 第 1 行原有 13 帧, 其后每行一组新动作
    (walk-R / walk-L / look-left / look-right / jump / sleep /
    roll / peek / dance / snow / eat). 每帧都能在拼图里看到."""
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    except Exception:
        font = ImageFont.load_default()
    label_h = 48
    rows = [OLD_ORDER[fest]]
    new = NEW_ORDER[fest]
    rows.append(new[0:4])      # walk-R
    rows.append(new[4:8])      # walk-L
    rows.append(new[8:11])     # look-left
    rows.append(new[11:14])    # look-right
    rows.append(new[14:17])    # jump
    rows.append(new[17:21])    # sleep
    rows.append(new[21:25])    # roll
    rows.append(new[25:28])    # peek
    rows.append(new[28:32])    # dance
    rows.append(new[32:36])    # snow
    rows.append(new[36:40])    # eat
    flat = [n for row in rows for n in row]
    assert len(flat) == 53, len(flat)
    imgs = {n: render(ALL[n], f"{OUT}/{n}.png", scale=scale)
            for n in flat if n in NEW}
    # 原有帧不重写 PNG, 只为拼图渲染一份内存图
    for n in OLD_ORDER[fest]:
        lines = s(ALL[n])
        h = len(lines)
        w = max(len(r) for r in lines)
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = im.load()
        for y, row in enumerate(lines):
            for x, ch in enumerate(row):
                if ch in COLORS:
                    px[x, y] = COLORS[ch] + (255,)
        imgs[n] = im.resize((w * scale, h * scale), Image.NEAREST)
    w, h = imgs[flat[0]].size
    cols = max(len(r) for r in rows)
    sheet = Image.new("RGB", (w * cols, (h + label_h) * len(rows)), BG)
    dr = ImageDraw.Draw(sheet)
    for ri, row in enumerate(rows):
        for ci, n in enumerate(row):
            x = ci * w
            y = ri * (h + label_h)
            sheet.paste(imgs[n], (x, y), imgs[n])
            dr.text((x + 12, y + h + 8), n, fill=(255, 255, 255), font=font)
    sheet.save(path)
    print(f"saved {path}", sheet.size)


if __name__ == "__main__":
    for name, g in NEW.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        assert len(lines) == H, (name, len(lines))
        render(lines, f"{OUT}/{name}.png")
        print(f"saved {name}.png")

    for fest in FESTS:
        contact_sheet_grouped(fest, f"{OUT}/contact-sheet-{fest}.png")
