#!/usr/bin/env python3
"""Render noya v11 节日版常驻动作 · 多帧升级 C 组 (2026-11-15):
情人节 valentine / 复活节 easter / 万圣节 halloween, 各 10 种常驻动作
的多帧版, 每节日 40 帧, 共 120 帧.

只画帧, 不定播放速度 / 触发 / 时序 / 冷却 / 状态机 (那些归 Codex).
v11 本体一个像素不动 (26x18, 体蓝 #60a5fa, 眼睛 #0F172A, 翼耳尖白
#FFFFFF). 节日造型沿用 render_dragon_v11_festivals.py 已有的特殊形象,
不改造型, 只穿着它做动作. 颜色只用节日自己的颜色, 不要金色.

每节日 10 个动作 (帧数与姿态与 base 多帧版一致):
  walk  走路 8 帧: walk-R-A/B/C/D + walk-L-A/B/C/D.
        A 右脚前抬 (沿用 v11 walk-R-A), B 双脚着地, C 左脚前抬
        (沿用 v11 walk-R-B), D 双脚着地. L 组为镜像, 眼睛朝左.
        注: B 与 D 是同一个双脚着地接触姿态, 按定义就是同一帧.
  look  张望 6 帧: look-left-1/2/3 + look-right-1/2/3.
        1 眼睛居中, 2 半偏 (标准 1 格偏移), 3 全偏 (2 格偏移).
  jump  跳 3 帧: 1 蹲下 (整体下沉 1 格), 2 最高点 (整体上移 2 格、
        脚收起、下方白色动感虚线), 3 落地 (回常驻站姿).
        造型跟着身体走, 不被裁: 2 号帧造型后贴 (不随上移裁掉),
        翼耳白尖在顶行补回.
  sleep 睡觉 4 帧: 1 闭眼 + 小 Z 低处 (沿用已有 <fest>-sleep 的 Z),
        2 Z 上飘一格, 3 Z 再向右上飘 + 身体下沉 1 格,
        4 Z 飘到最右上角 + 身体下沉 1 格.
  roll  打滚 4 帧: 蓝球 + 白色旋转标记 4 个角度
        (顶 / 右 / 底 / 左). 造型移到球顶上方
        (沿用 festivals_full 里 roll 的做法: topper 下移 3 行).
  peek  躲猫猫 3 帧: 1 藏只露翼耳尖 (沿用 festivals_full peek,
        造型下移 14 行跟着露头), 2 半露 (整体下沉 9 格, 露头顶
        + 双眼), 3 全露 (常驻站姿).
  dance 跳舞 4 帧: 1 左倾, 2 居中左脚点地, 3 右倾, 4 居中右脚点地.
        造型先戴好再整体平移 (沿用 festivals_full 里 dance 的做法).
  snow  接雪花 4 帧: 掉落物 4 个下落位置 (高 / 中 / 近头顶 /
        落到头顶), 眼睛上移跟着盯, 第 4 帧开心闭眼.
        掉落物按节日换: 情人节粉爱心 / 复活节彩蛋 / 万圣节糖果,
        位置在右上方, 姿态与原版一致.
  eat   吃东西 4 帧: 1 食物出现 (2x2), 2 啄一下食物变小 (剩上排),
        3 再啄一下更小 (剩 1 格) + 碎屑, 4 吃完满足闭眼 (开心闭眼).
        食物按节日换: 情人节巧克力 (深棕) / 复活节彩蛋 /
        万圣节糖果, 食物在嘴边 (2x2, 行 13-14, 列 21-22).
  blink 眨眼: 复用已有的 <fest>-blink, 不用新画.

拼图: 每节日更新一张 contact-sheet-<fest>.png, 按动作分行排,
该节日 40 新帧 + 原有 13 帧全在里面 (共 53 帧).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

import render_dragon_v11_festivals as F
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
happy_eyes = F.happy_eyes
eyes_up = F.eyes_up
COLORS = F.COLORS
W, H = F.W, F.H
OUT = os.path.dirname(os.path.abspath(__file__))
BG = F.BG
SCALE = 28

FESTS = ["valentine", "easter", "halloween"]
TOPPERS = {name: fn for name, (fn, _, _) in F.FESTIVALS.items()}

EYES_L = ".....BBDDDBBBBDDDBBBB....."
EYES_R2 = ".....BBBBBDDDBBBBDDDB....."   # eyes shifted 2 cells right
EYES_L2 = ".....BDDDBBBBDDDBBBBB....."   # eyes shifted 2 cells left
FEET_BASE = ".........BB....BB........."

# v11 walk feet (from render_dragon_v11.py)
WALK_R_A = (".........BB.....BB........", ".........BB...............")
WALK_R_C = ("..........BB...BB.........", "...............BB.........")
WALK_L_A = ("........BB.....BB.........", "...............BB.........")
WALK_L_C = (".........BB...BB..........", ".........BB...............")


def walk_frame(top_fn, eyes, feet):
    g = grid(BASE)
    g[7] = list(eyes)
    g[8] = list(eyes)
    g[13] = list(feet[0])
    g[14] = list(feet[1])
    return top_fn(g)


def look_frame(top_fn, eyes):
    g = grid(BASE)
    g[7] = list(eyes)
    g[8] = list(eyes)
    return top_fn(g)


def jump_1(top_fn):
    """Crouch: whole sprite (topper included) sinks 1 row."""
    return shift(top_fn(grid(BASE)), 1, 0)


def jump_2(top_fn):
    """Apex: whole sprite up 2, feet tucked, motion dashes below.
    Topper is applied AFTER the shift so it is never cropped off the
    top edge; it still sits on the raised head. Wing-ear white tips
    are restored on the top row (the shift would push them off)."""
    g = shift(grid(BASE), -2, 0)
    fill(g, 11, 12, 9, 10, ".")    # feet tucked up
    fill(g, 11, 12, 15, 16, ".")
    put(g, 15, 8, "W")             # motion dashes below
    put(g, 15, 17, "W")
    put(g, 0, 7, "W")              # ear tips (would be shifted off)
    put(g, 0, 18, "W")
    return top_fn(g)


def jump_3(top_fn):
    """Landing: back to the standing pose."""
    return top_fn(grid(BASE))


def z_mark(g, r0, c0):
    """Little white 'Z', 3 rows tall, top-left corner (r0, c0)."""
    fill(g, r0, r0, c0, c0 + 2, "W")
    put(g, r0 + 1, c0 + 1, "W")
    fill(g, r0 + 2, r0 + 2, c0, c0 + 2, "W")


def sleep_1(top_fn):
    g = top_fn(grid(CLOSED))
    z_mark(g, 1, 20)               # same Z as the existing <fest>-sleep
    return g


def sleep_2(top_fn):
    g = top_fn(grid(CLOSED))
    z_mark(g, 0, 21)               # Z floats up one row
    return g


def sleep_3(top_fn):
    g = shift(top_fn(grid(CLOSED)), 1, 0)   # body sinks 1
    z_mark(g, 0, 22)               # Z drifts further up-right
    return g


def sleep_4(top_fn):
    g = shift(top_fn(grid(CLOSED)), 1, 0)   # body sinks 1
    z_mark(g, 0, 23)               # Z highest / furthest away
    return g


# white rotation mark on the ball: 4 angles (top / right / bottom / left)
ROLL_MARKS = {
    1: [(6, 12), (6, 13)],
    2: [(9, 17), (10, 17)],
    3: [(12, 12), (12, 13)],
    4: [(9, 8), (10, 8)],
}


def roll_frame(top_fn, n):
    g = roll_ball()
    for (r, c) in ROLL_MARKS[n]:
        put(g, r, c, "W")
    return FF.composite(g, FF.topper_shifted(top_fn, 3))


def peek_1(top_fn):
    """Hidden: only wing-ear tips + topper peeking over the edge."""
    return FF.composite(peek_hide(), FF.topper_shifted(top_fn, 14))


def peek_2(top_fn):
    """Half out: sunk 9 rows, head top + both eye rows visible."""
    return shift(top_fn(grid(BASE)), 9, 0)


def peek_3(top_fn):
    """Fully out: standing pose."""
    return top_fn(grid(BASE))


def dance_1(top_fn):
    """Lean left, left foot tapping."""
    g = shift(top_fn(grid(BASE)), 0, -1)
    put(g, 14, 8, ".")
    put(g, 14, 9, ".")
    return g


def dance_2(top_fn):
    """Centred, left foot tapping."""
    g = top_fn(grid(BASE))
    put(g, 14, 9, ".")
    put(g, 14, 10, ".")
    return g


def dance_3(top_fn):
    """Lean right, right foot tapping (festivals_full dance)."""
    g = shift(top_fn(grid(BASE)), 0, 1)
    put(g, 14, 16, ".")
    put(g, 14, 17, ".")
    return g


def dance_4(top_fn):
    """Centred, right foot tapping."""
    g = top_fn(grid(BASE))
    put(g, 14, 15, ".")
    put(g, 14, 16, ".")
    return g


# falling items (snow): cells relative to an anchor (dr, dc, colour)
# valentine = pink heart, easter = painted egg, halloween = candy
ITEMS = {
    "valentine": [(0, 0, "P"), (0, 1, "P"), (1, 0, "P")],
    "easter":    [(0, 0, "W"), (0, 1, "W"), (1, 0, "W"), (1, 1, "P")],
    "halloween": [(0, 0, "O"), (0, 1, "O"), (1, 0, "O"), (1, 1, "O")],
}
# fall heights (anchor row): high / mid / near the head
SNOW_ROWS = {1: 0, 2: 3, 3: 6}


def snow_frame(top_fn, fest, n):
    if n == 4:
        # landed on the head top (rows 2-3, cols 18-19), happy closed eyes
        g = top_fn(grid(BASE))
        happy_eyes(g)
        for (dr, dc, ch) in ITEMS[fest]:
            put(g, 2 + dr, 18 + dc, ch)
        return g
    g = top_fn(grid(BASE))
    eyes_up(g)
    for (dr, dc, ch) in ITEMS[fest]:
        put(g, SNOW_ROWS[n] + dr, 20 + dc, ch)
    return g


# snacks (eat): 2x2 at rows 13-14, cols 21-22
# valentine = chocolate (dark brown K), easter = egg, halloween = candy
SNACK_FULL = {
    "valentine": [(13, 21, "K"), (13, 22, "K"),
                  (14, 21, "K"), (14, 22, "K")],
    "easter":    [(13, 21, "W"), (13, 22, "W"),
                  (14, 21, "P"), (14, 22, "P")],
    "halloween": [(13, 21, "O"), (13, 22, "O"),
                  (14, 21, "O"), (14, 22, "O")],
}
SNACK_HALF = {   # eat-2: top row left after one peck
    "valentine": [(13, 21, "K"), (13, 22, "K")],
    "easter":    [(13, 21, "W"), (13, 22, "W")],
    "halloween": [(13, 21, "O"), (13, 22, "O")],
}
# eat-3: one last bite + crumbs
SNACK_BITE = {
    "valentine": ([(14, 21, "K")], [(15, 20, "K"), (16, 22, "K")]),
    "easter":    ([(14, 21, "P")], [(15, 20, "W"), (16, 22, "W")]),
    "halloween": ([(14, 21, "O")], [(15, 20, "O"), (16, 22, "O")]),
}


def eat_1(top_fn, fest):
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    for (r, c, ch) in SNACK_FULL[fest]:
        put(g, r, c, ch)
    return top_fn(g)


def eat_2(top_fn, fest):
    g = shift(top_fn(grid(CLOSED)), 1, 0)   # peck down 1
    for (r, c, ch) in SNACK_HALF[fest]:
        put(g, r, c, ch)
    return g


def eat_3(top_fn, fest):
    g = shift(top_fn(grid(CLOSED)), 1, 0)   # peck down 1 again
    bite, crumbs = SNACK_BITE[fest]
    for (r, c, ch) in bite:
        put(g, r, c, ch)
    for (r, c, ch) in crumbs:
        put(g, r, c, ch)
    return g


def eat_4(top_fn):
    g = top_fn(grid(CLOSED))
    happy_eyes(g)                            # satisfied, eyes closed happy
    return g


# --- build all 120 frames ---
FRAMES = {}
for fest in FESTS:
    top_fn = TOPPERS[fest]
    p = f"{fest}-"
    FRAMES[p + "walk-R-A"] = walk_frame(top_fn, EYES_R, WALK_R_A)
    FRAMES[p + "walk-R-B"] = walk_frame(top_fn, EYES_R,
                                        (FEET_BASE, FEET_BASE))
    FRAMES[p + "walk-R-C"] = walk_frame(top_fn, EYES_R, WALK_R_C)
    FRAMES[p + "walk-R-D"] = walk_frame(top_fn, EYES_R,
                                        (FEET_BASE, FEET_BASE))
    FRAMES[p + "walk-L-A"] = walk_frame(top_fn, EYES_L, WALK_L_A)
    FRAMES[p + "walk-L-B"] = walk_frame(top_fn, EYES_L,
                                        (FEET_BASE, FEET_BASE))
    FRAMES[p + "walk-L-C"] = walk_frame(top_fn, EYES_L, WALK_L_C)
    FRAMES[p + "walk-L-D"] = walk_frame(top_fn, EYES_L,
                                        (FEET_BASE, FEET_BASE))
    FRAMES[p + "look-left-1"] = look_frame(top_fn, BASE[7])
    FRAMES[p + "look-left-2"] = look_frame(top_fn, EYES_L)
    FRAMES[p + "look-left-3"] = look_frame(top_fn, EYES_L2)
    FRAMES[p + "look-right-1"] = look_frame(top_fn, BASE[7])
    FRAMES[p + "look-right-2"] = look_frame(top_fn, EYES_R)
    FRAMES[p + "look-right-3"] = look_frame(top_fn, EYES_R2)
    FRAMES[p + "jump-1"] = jump_1(top_fn)
    FRAMES[p + "jump-2"] = jump_2(top_fn)
    FRAMES[p + "jump-3"] = jump_3(top_fn)
    FRAMES[p + "sleep-1"] = sleep_1(top_fn)
    FRAMES[p + "sleep-2"] = sleep_2(top_fn)
    FRAMES[p + "sleep-3"] = sleep_3(top_fn)
    FRAMES[p + "sleep-4"] = sleep_4(top_fn)
    for n in (1, 2, 3, 4):
        FRAMES[p + f"roll-{n}"] = roll_frame(top_fn, n)
    FRAMES[p + "peek-1"] = peek_1(top_fn)
    FRAMES[p + "peek-2"] = peek_2(top_fn)
    FRAMES[p + "peek-3"] = peek_3(top_fn)
    FRAMES[p + "dance-1"] = dance_1(top_fn)
    FRAMES[p + "dance-2"] = dance_2(top_fn)
    FRAMES[p + "dance-3"] = dance_3(top_fn)
    FRAMES[p + "dance-4"] = dance_4(top_fn)
    for n in (1, 2, 3, 4):
        FRAMES[p + f"snow-{n}"] = snow_frame(top_fn, fest, n)
    FRAMES[p + "eat-1"] = eat_1(top_fn, fest)
    FRAMES[p + "eat-2"] = eat_2(top_fn, fest)
    FRAMES[p + "eat-3"] = eat_3(top_fn, fest)
    FRAMES[p + "eat-4"] = eat_4(top_fn)

# all frames for the contact sheets: old 13 per festival + new 40
ALL = {}
ALL.update(F.FRAMES)
ALL.update(FF.NEW)
ALL.update(FRAMES)


def grid_to_image(grid_lines, scale=SCALE):
    lines = grid_lines if isinstance(grid_lines[0], str) else s(grid_lines)
    h = len(lines)
    w = max(len(r) for r in lines)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(lines):
        for x, ch in enumerate(row):
            if ch in COLORS:
                px[x, y] = COLORS[ch] + (255,)
    return img.resize((w * scale, h * scale), Image.NEAREST)


def render(grid_lines, path, scale=SCALE):
    img = grid_to_image(grid_lines, scale=scale)
    img.save(path)
    return img


def contact_sheet_fest(fest, path, scale=16):
    """One row per action group: old frame first, then the new frames.
    53 frames per festival (13 old + 40 new)."""
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
        small = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
        small = font
    a, b = F.SPECIAL_NAMES[fest]
    rows = [
        ("hat",   [f"{fest}-hat"]),
        ("walk",  [f"{fest}-walk",
                   f"{fest}-walk-R-A", f"{fest}-walk-R-B",
                   f"{fest}-walk-R-C", f"{fest}-walk-R-D",
                   f"{fest}-walk-L-A", f"{fest}-walk-L-B",
                   f"{fest}-walk-L-C", f"{fest}-walk-L-D"]),
        ("blink", [f"{fest}-blink"]),
        ("sleep", [f"{fest}-sleep",
                   f"{fest}-sleep-1", f"{fest}-sleep-2",
                   f"{fest}-sleep-3", f"{fest}-sleep-4"]),
        ("look",  [f"{fest}-look",
                   f"{fest}-look-left-1", f"{fest}-look-left-2",
                   f"{fest}-look-left-3", f"{fest}-look-right-1",
                   f"{fest}-look-right-2", f"{fest}-look-right-3"]),
        ("jump",  [f"{fest}-jump",
                   f"{fest}-jump-1", f"{fest}-jump-2", f"{fest}-jump-3"]),
        ("roll",  [f"{fest}-roll",
                   f"{fest}-roll-1", f"{fest}-roll-2",
                   f"{fest}-roll-3", f"{fest}-roll-4"]),
        ("peek",  [f"{fest}-peek",
                   f"{fest}-peek-1", f"{fest}-peek-2", f"{fest}-peek-3"]),
        ("dance", [f"{fest}-dance",
                   f"{fest}-dance-1", f"{fest}-dance-2",
                   f"{fest}-dance-3", f"{fest}-dance-4"]),
        ("snow",  [f"{fest}-snow",
                   f"{fest}-snow-1", f"{fest}-snow-2",
                   f"{fest}-snow-3", f"{fest}-snow-4"]),
        ("eat",   [f"{fest}-eat",
                   f"{fest}-eat-1", f"{fest}-eat-2",
                   f"{fest}-eat-3", f"{fest}-eat-4"]),
        ("special", [f"{fest}-{a}", f"{fest}-{b}"]),
    ]
    total = sum(len(names) for _, names in rows)
    assert total == 53, (fest, total)
    label_w = 150
    cap_h = 30
    fw, fh = W * scale, H * scale
    row_h = fh + cap_h + 10
    max_cols = max(len(names) for _, names in rows)
    sheet = Image.new("RGB", (label_w + fw * max_cols, row_h * len(rows)), BG)
    dr = ImageDraw.Draw(sheet)
    for ri, (label, names) in enumerate(rows):
        y = ri * row_h
        dr.text((12, y + fh // 2 - 14), label, fill=(255, 255, 255),
                font=font)
        for ci, name in enumerate(names):
            x = label_w + ci * fw
            im = grid_to_image(ALL[name], scale=scale)
            sheet.paste(im, (x, y), im)
            dr.text((x + 6, y + fh + 4), name, fill=(200, 200, 200),
                    font=small)
    sheet.save(path)
    print(f"saved {path}", sheet.size, f"({total} frames)")


if __name__ == "__main__":
    assert len(FRAMES) == 120, len(FRAMES)
    for name, g in FRAMES.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1 and lens == {26}, (name, lens)
        assert len(lines) == 18, (name, len(lines))
        render(lines, f"{OUT}/{name}.png")
        print(f"saved {name}.png")

    for fest in FESTS:
        contact_sheet_fest(fest, f"{OUT}/contact-sheet-{fest}.png")
