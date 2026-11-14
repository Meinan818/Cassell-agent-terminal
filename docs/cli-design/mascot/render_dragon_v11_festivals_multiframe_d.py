#!/usr/bin/env python3
"""Render noya v11 节日版常驻动作 · 多帧升级 D 组 (2026-11-15):
中秋 midautumn / 生日 birthday / 周五傍晚 friday / 天气联动 weather,
各 10 种常驻动作的多帧版, 每节日 40 帧, 共 160 帧.

只画帧, 不定播放速度 / 触发 / 时序 / 冷却 / 状态机 (那些归 Codex).
不碰别的节日和 base, 不改设计文档, 不提交.

姿态与 base 多帧版一致 (每动作帧数/姿态见下), 只是穿着该节日原有
造型 (沿用 render_dragon_v11_festivals.py 的造型, 不改造型):
  walk  走路 8 帧: R/L 各 A 右脚前抬 / B 双脚着地 / C 左脚前抬 /
                   D 双脚着地 (A/B 沿用 v11 现有走路帧, C/D 为其镜像)
  look  张望 6 帧: left/right 各 1 眼睛居中 / 2 半偏 / 3 全偏
                   (半偏 = 靠方向一侧的那只眼先移 1 格)
  jump  跳 3 帧: 1 蹲下 (整只下沉 1 格, 造型跟走) / 2 最高点
                   (整只上移 2 格、脚收起 + 下方白色动感虚线, 跟 B 组
                   一致: 上移后造型按原位补回头顶、翼耳尖补回顶行;
                   周五墨镜在脸上, 跟着脸一起上移, 不重贴) / 3 落地
  sleep 睡觉 4 帧: 1 闭眼 + 小 Z 低处 (= 已有 <fest>-sleep) /
                   2 Z 上飘 / 3 Z 再上 + 身体下沉 1 格 /
                   4 Z 最高 (Z 再往右上方飘) + 身体下沉 1 格
  roll  打滚 4 帧: 蓝球 + 白色旋转标记 4 个角度 (顶/右/底/左);
                   造型移到球顶上方 (沿用 festivals_full roll);
                   周五墨镜改画在球面上 (裁到球内, 沿用 friday-roll)
  peek  躲猫猫 3 帧: 1 藏只露翼耳尖 (= 已有 peek 做法, 造型下移
                   14 行跟着露头) / 2 半露 (整只下沉 7 格, 眼睛
                   刚露出来) / 3 全露 (= <fest>-hat);
                   周五例外: 墨镜在脸上, 脸藏起来所以 1 不出现墨镜,
                   2/3 脸露出来墨镜跟着脸走 (用原版 peek 的理由)
  dance 跳舞 4 帧: 1 左倾 (整体左移 1 格, 左脚点地) / 2 居中
                   左脚点地 / 3 右倾 (整体右移 1 格, 右脚点地) /
                   4 居中右脚点地 (造型先戴好再整体平移, 沿用
                   festivals_full dance 的做法)
  snow  接雪花 4 帧: 掉落物 4 个下落位置 (高/中/近头顶/落到头顶),
                   眼睛上移跟着盯, 第 4 帧开心闭眼; 掉落物按节日换:
                   中秋月饼 / 生日彩纸 / 周五橙片 / 天气雨滴;
                   位置在右上方 (第 1 帧 = 已有 <fest>-snow)
  eat   吃东西 4 帧: 1 食物出现 (= 已有 <fest>-eat) / 2 啄一下
                   食物变小 (身体下沉 1 格啄食, 食物剩 1 格) /
                   3 再啄一下更小 + 碎屑 (食物吃完, 掉两粒碎屑) /
                   4 吃完满足闭眼 (开心闭眼); 食物按节日换:
                   中秋月饼 / 生日蛋糕 / 周五橙汁 / 天气热饮,
                   食物在嘴边 (2x2)
  blink 眨眼: 复用已有的 <fest>-blink, 不用新画

周五傍晚特殊情况 (造型本身的限制, 不是画错, 设计文档 §2.4):
墨镜盖住眼睛, 所以 friday-look 各帧眼睛的移动会被墨镜盖住、
friday-snow 眼睛上移会并进墨镜里、friday-eat 眼睛右移同样被
盖住 —— 照实画, 不为"看得出来"去改墨镜造型.

v11 本体一个像素不动 (26x18, 体蓝 #60a5fa, 眼睛 #0F172A,
翼耳尖白 #FFFFFF). 颜色只用节日自己的颜色, 不要金色.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

import render_dragon_v11_festivals as F
import render_dragon_v11_festivals_full as FF
from render_dragon_v11_actions import roll_ball, peek_hide

BASE = F.BASE
CLOSED = F.CLOSED
EYES_R = F.EYES_R
EYES_L = ".....BBDDDBBBBDDDBBBB....."  # eyes shifted left (v11)
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

FESTS = ["midautumn", "birthday", "friday", "weather"]
TOPPERS = {name: fn for name, (fn, _, _) in F.FESTIVALS.items()
           if name in FESTS}
SPECIALS = {name: F.SPECIAL_NAMES[name] for name in FESTS}

# --- walk feet (R-A / R-B 沿用 v11 现有走路帧, C/D 为其镜像) ---
FEET_R_A = (".........BB.....BB........", ".........BB...............")
FEET_R_B = ("..........BB...BB.........", "...............BB.........")
FEET_R_C = ("........BB.....BB.........", "...............BB.........")
FEET_R_D = (".........BB...BB..........", ".........BB...............")
FEET_L_A, FEET_L_B, FEET_L_C, FEET_L_D = FEET_R_C, FEET_R_D, FEET_R_A, FEET_R_B

# --- look: 半偏 = 靠方向一侧的那只眼先移 1 格 ---
EYES_R_HALF = ".....BBBDDDBBBBBDDDBB....."
EYES_L_HALF = ".....BBDDDBBBBBDDDBBB....."


def walk_frame(top_fn, direction):
    eyes = EYES_R if direction == "R" else EYES_L
    feet = {"R": (FEET_R_A, FEET_R_B, FEET_R_C, FEET_R_D),
            "L": (FEET_L_A, FEET_L_B, FEET_L_C, FEET_L_D)}[direction]
    out = {}
    for letter, (r13, r14) in zip("ABCD", feet):
        g = grid(BASE)
        g[7] = list(eyes)
        g[8] = list(eyes)
        g[13] = list(r13)
        g[14] = list(r14)
        out[letter] = top_fn(g)
    return out


def look_frames(top_fn):
    out = {}
    for side, full, half in (("left", EYES_L, EYES_L_HALF),
                             ("right", EYES_R, EYES_R_HALF)):
        for n, eyes in ((1, None), (2, half), (3, full)):
            g = grid(BASE)
            if eyes is not None:
                g[7] = list(eyes)
                g[8] = list(eyes)
            out[f"{side}-{n}"] = top_fn(g)
    return out


def jump_2(top_fn, fest):
    """最高点: 脚收起 + 下方白色动感虚线, 整只上移 2 格 (跟 B 组一致).
    上移会裁掉帽顶与翼耳尖, 所以移后把造型按原位补回头顶、
    翼耳尖补回顶行 (0,7)/(0,18), 造型不丢、白尖可见.
    周五例外: 墨镜在脸上, 移前画好、跟着脸一起上移, 移后不重贴
    (重贴会把墨镜留在原位, 盖不住上移后的眼睛)."""
    g = top_fn(grid(BASE))
    fill(g, 13, 14, 9, 10, ".")     # 脚收起
    fill(g, 13, 14, 15, 16, ".")
    put(g, 15, 8, "W")              # 下方白色动感虚线
    put(g, 15, 17, "W")
    g = shift(g, -2, 0)
    if fest != "friday":
        g = top_fn(g)               # 帽子造型补回头顶原位
    put(g, 0, 7, "W")               # 翼耳尖补回顶行
    put(g, 0, 18, "W")
    return g


def jump_frames(top_fn, fest):
    return {
        "1": shift(top_fn(grid(BASE)), 1, 0),   # 蹲下: 整只下沉 1 格
        "2": jump_2(top_fn, fest),              # 最高点: 整只上移 2 格
        "3": top_fn(grid(BASE)),                # 落地
    }


def draw_z(g, r, c):
    fill(g, r, r, c, c + 2, "W")
    put(g, r + 1, c + 1, "W")
    fill(g, r + 2, r + 2, c, c + 2, "W")


def sleep_frames(top_fn):
    f1 = top_fn(grid(CLOSED))
    draw_z(f1, 1, 20)
    f2 = top_fn(grid(CLOSED))
    draw_z(f2, 0, 21)
    f3 = shift(top_fn(grid(CLOSED)), 1, 0)
    draw_z(f3, 0, 21)
    f4 = shift(top_fn(grid(CLOSED)), 1, 0)
    draw_z(f4, 0, 22)
    return {"1": f1, "2": f2, "3": f3, "4": f4}


ROLL_MARKS = {
    "1": [(6, 12), (6, 13)],      # 顶
    "2": [(9, 17), (10, 17)],     # 右
    "3": [(12, 12), (12, 13)],    # 底
    "4": [(9, 8), (10, 8)],       # 左
}


def roll_frames(top_fn, fest):
    out = {}
    for n, marks in ROLL_MARKS.items():
        g = FF.roll_base(top_fn, fest)
        for (r, c) in marks:
            put(g, r, c, "W")
        out[n] = g
    return out


def peek_frames(top_fn, fest):
    f1 = FF.peek_base(top_fn, fest)              # 藏: 只露翼耳尖
    # 半露: 造型跟着头走; 周五墨镜在脸上, 脸露出一半墨镜也跟着露一半
    # (只有 f1 脸全藏才不出现墨镜, 沿用 festivals_full 的做法)
    f2 = shift(top_fn(grid(BASE)), 7, 0)
    f3 = top_fn(grid(BASE))                     # 全露
    return {"1": f1, "2": f2, "3": f3}


def dance_frames(top_fn):
    f1 = shift(top_fn(grid(BASE)), 0, -1)        # 左倾
    put(f1, 14, 8, ".")
    put(f1, 14, 9, ".")
    f2 = top_fn(grid(BASE))                      # 居中, 左脚点地
    put(f2, 14, 9, ".")
    put(f2, 14, 10, ".")
    f3 = shift(top_fn(grid(BASE)), 0, 1)         # 右倾
    put(f3, 14, 16, ".")
    put(f3, 14, 17, ".")
    f4 = top_fn(grid(BASE))                      # 居中, 右脚点地
    put(f4, 14, 15, ".")
    put(f4, 14, 16, ".")
    return {"1": f1, "2": f2, "3": f3, "4": f4}


# --- snow: 掉落物 2x2 (雨滴 3 格), 4 个下落位置 (右上方斜落向头顶) ---
SNOW_OFFSETS = {
    "midautumn": [(0, 0, "T"), (0, 1, "T"), (1, 0, "T"), (1, 1, "T")],
    "birthday":  [(0, 0, "P"), (0, 1, "L"), (1, 0, "W"), (1, 1, "P")],
    "friday":    [(0, 0, "O"), (0, 1, "O"), (1, 0, "O"), (1, 1, "O")],
    "weather":   [(0, 0, "L"), (1, 0, "L"), (1, 1, "L")],
}
SNOW_ORIGINS = {"1": (0, 20), "2": (1, 19), "3": (2, 17), "4": (2, 12)}


def snow_frames(top_fn, fest):
    out = {}
    for n, (r0, c0) in SNOW_ORIGINS.items():
        if n == "4":
            # 开心闭眼; 眼睛先画再戴造型, 周五墨镜盖住眼睛、造型完好
            g = grid(BASE)
            happy_eyes(g)
            g = top_fn(g)
        else:
            g = top_fn(grid(BASE))
            eyes_up(g)
        for (dr, dc, ch) in SNOW_OFFSETS[fest]:
            put(g, r0 + dr, c0 + dc, ch)
        out[n] = g
    return out


# --- eat: 食物 2x2 在嘴边; f2 剩 1 格, f3 碎屑, f4 开心闭眼 ---
SNACK_CELLS = {
    "midautumn": [(13, 21, "T"), (13, 22, "T"), (14, 21, "T"), (14, 22, "T")],
    "birthday":  [(13, 21, "W"), (13, 22, "W"), (14, 21, "P"), (14, 22, "P")],
    "friday":    [(13, 21, "O"), (13, 22, "O"), (14, 21, "O"), (14, 22, "O")],
    "weather":   [(13, 21, "W"), (13, 22, "W"), (14, 21, "W"), (14, 22, "W")],
}
SNACK_MAIN = {"midautumn": "T", "birthday": "W", "friday": "O", "weather": "W"}


def eat_frames(top_fn, fest):
    f1 = FF.eat_base(top_fn, SNACK_CELLS[fest])   # 食物出现
    f2 = shift(top_fn(grid(CLOSED)), 1, 0)        # 啄一下: 下沉 1 格
    put(f2, 14, 21, SNACK_MAIN[fest])             # 食物剩 1 格
    f3 = shift(top_fn(grid(CLOSED)), 1, 0)        # 再啄一下: 吃完 + 碎屑
    put(f3, 15, 20, "W")
    put(f3, 16, 22, "W")
    g4 = grid(BASE)                               # 吃完满足闭眼
    happy_eyes(g4)
    f4 = top_fn(g4)
    return {"1": f1, "2": f2, "3": f3, "4": f4}


NEW = {}
for fest, top_fn in TOPPERS.items():
    for letter, g in walk_frame(top_fn, "R").items():
        NEW[f"{fest}-walk-R-{letter}"] = g
    for letter, g in walk_frame(top_fn, "L").items():
        NEW[f"{fest}-walk-L-{letter}"] = g
    for key, g in look_frames(top_fn).items():
        NEW[f"{fest}-look-{key}"] = g
    for n, g in jump_frames(top_fn, fest).items():
        NEW[f"{fest}-jump-{n}"] = g
    for n, g in sleep_frames(top_fn).items():
        NEW[f"{fest}-sleep-{n}"] = g
    for n, g in roll_frames(top_fn, fest).items():
        NEW[f"{fest}-roll-{n}"] = g
    for n, g in peek_frames(top_fn, fest).items():
        NEW[f"{fest}-peek-{n}"] = g
    for n, g in dance_frames(top_fn).items():
        NEW[f"{fest}-dance-{n}"] = g
    for n, g in snow_frames(top_fn, fest).items():
        NEW[f"{fest}-snow-{n}"] = g
    for n, g in eat_frames(top_fn, fest).items():
        NEW[f"{fest}-eat-{n}"] = g

# 拼图用: 新 40 帧 + 原有 13 帧 (6 帧节日套装 + 7 帧单帧常驻动作)
ALL = {}
ALL.update(F.FRAMES)
ALL.update(FF.NEW)
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


def contact_sheet(fest, path, scale=SCALE):
    """按动作分行排: 11 行新帧 (40 帧) + 2 行原有帧 (13 帧)."""
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
        row_font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
    except Exception:
        font = ImageFont.load_default()
        row_font = font
    label_h = 48
    rows = [
        ("walk-R", [f"{fest}-walk-R-{x}" for x in "ABCD"]),
        ("walk-L", [f"{fest}-walk-L-{x}" for x in "ABCD"]),
        ("look-L", [f"{fest}-look-left-{n}" for n in "123"]),
        ("look-R", [f"{fest}-look-right-{n}" for n in "123"]),
        ("jump", [f"{fest}-jump-{n}" for n in "123"]),
        ("sleep", [f"{fest}-sleep-{n}" for n in "1234"]),
        ("roll", [f"{fest}-roll-{n}" for n in "1234"]),
        ("peek", [f"{fest}-peek-{n}" for n in "123"]),
        ("dance", [f"{fest}-dance-{n}" for n in "1234"]),
        ("snow", [f"{fest}-snow-{n}" for n in "1234"]),
        ("eat", [f"{fest}-eat-{n}" for n in "1234"]),
        ("old", [f"{fest}-hat", f"{fest}-walk", f"{fest}-blink",
                  f"{fest}-sleep", f"{fest}-look", f"{fest}-jump",
                  f"{fest}-roll"]),
        ("old", [f"{fest}-peek", f"{fest}-dance", f"{fest}-snow",
                  f"{fest}-eat", f"{fest}-{SPECIALS[fest][0]}",
                  f"{fest}-{SPECIALS[fest][1]}"]),
    ]
    imgs = {}
    for _, names in rows:
        for n in names:
            imgs[n] = render(ALL[n], f"{OUT}/{n}.png", scale=scale)
    w, h = imgs[f"{fest}-walk-R-A"].size
    maxcols = max(len(names) for _, names in rows)
    lab_w = 200
    sheet = Image.new("RGB",
                      (lab_w + w * maxcols, (h + label_h) * len(rows)), BG)
    dr = ImageDraw.Draw(sheet)
    for ri, (label, names) in enumerate(rows):
        y = ri * (h + label_h)
        dr.text((12, y + h // 2 - 18), label, fill=(255, 255, 255),
                font=row_font)
        for i, n in enumerate(names):
            x = lab_w + i * w
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
    print(f"saved {len(NEW)} new frames")
    assert len(NEW) == 160, len(NEW)

    for fest in FESTS:
        contact_sheet(fest, f"{OUT}/contact-sheet-{fest}.png")
