#!/usr/bin/env python3
"""Render noya v11 base 多帧升级 (2026-11-15, base 常驻动作组).

只画帧, 不定播放速度 / 触发 / 时序 / 冷却 / 状态机 (那些归 Codex).
本体一个像素不动: 大圆头 (整个就是身体) + 头顶一对小蝙蝠翼耳
(白尖) + 两颗圆眼睛 (3x2, 深海军 #0F172A) + 底下两只小脚,
没身子、没手、没嘴. 体蓝 #60a5fa, 翼耳尖白 #FFFFFF, 网格 26x18.

画法复用 render_dragon_v11.py / render_dragon_v11_actions.py /
render_dragon_v11_reactions.py 的辅助函数 (grid/blank/put/fill/shift、
BASE/CLOSED、save 方式、颜色映射).

40 帧, 文件名全部带 mf (multiframe) 前缀, 旧文件一个不动:
  walk  8: walk-R-A/B/C/D, walk-L-A/B/C/D
         循环 A 右脚前抬 -> B 双脚着地 -> C 左脚前抬 -> D 双脚着地
         (D 全身下沉 1 格 = 身体起伏, D -> A 接回). A 复用 v11 原版
         walk-R-A / walk-L-A 的脚位; B 在原版基础上改为双脚着地.
  look  6: look-left-1/2/3, look-right-1/2/3
         1 眼睛居中; 2 眼睛移 1 格 (半偏, 身体不动);
         3 眼睛移 1 格 + 全身跟移 1 格 (全偏, 总位移 2 格).
  jump  3: jump-1 蹲下 (全身下沉 1 格、脚张开);
         jump-2 最高点 (整只上移 2 格、脚收起);
         jump-3 落地 (回正常位置、脚着地、压扁 1 格).
  sleep 4: sleep-1 闭眼 + Z 在头顶低处;
         sleep-2 Z 上飘一格; sleep-3 Z 再上一格 + 身体下沉 1 格;
         sleep-4 Z 到最高处 + 身体下沉 1 格 + 两侧胀出 1 格 (呼吸).
  roll  4: roll-1/2/3/4 蓝球 + 球上一个白色旋转标记,
         4 个角度: 顶 -> 右 -> 底 -> 左 (顺时针, 4 -> 1 接回).
         复用 render_dragon_v11_actions.py 的 roll_ball.
  peek  3: peek-1 藏 (只露翼耳尖, 复用 peek_hide);
         peek-2 半露 (全身下沉 4 格, 眼睛刚露出来);
         peek-3 全露 (正常睁眼).
  dance 4: dance-1 左倾; dance-2 居中、左脚点地;
         dance-3 右倾; dance-4 居中、右脚点地.
  snow  4: snow-1 雪花在高处, 眼睛上移盯着;
         snow-2 雪花到中部; snow-3 雪花到头顶附近;
         snow-4 雪花落到头顶 + 开心闭眼 + 脚收起小跳
         (复用原版 snow_2 的跳 + 落雪).
  eat   4: eat-1 点心出现, 眼睛看向点心;
         eat-2 啄一下, 身体下 1 格, 点心变小 (2x2 -> 1 格);
         eat-3 再啄一下, 点心更小 (下移 1 格) + 两粒碎屑;
         eat-4 点心吃完, 满足闭眼 (身体回正, 无点心无碎屑).
  blink 1 帧: 复用 dragon-v11-closed.png, 不新画.

输出: dragon-v11-mf-<name>.png (40 张) + contact-sheet-multiframe.png
(按动作分行, 40 帧全在里面).
"""
from PIL import Image, ImageDraw, ImageFont

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


def set_eyes(g, lcol, rcol, rows=(7, 8)):
    """把 rows 两行的眼区先刷回体蓝, 再按给定左列画两颗 3x2 眼睛."""
    for r in rows:
        fill(g, r, r, 5, 20, "B")
    for r in rows:
        fill(g, r, r, lcol, lcol + 2, "D")
        fill(g, r, r, rcol, rcol + 2, "D")


def set_feet(g, feet):
    """feet: [(c0, r0, r1), ...] 每只脚一个蓝矩形; 先清空脚区."""
    fill(g, 13, 14, 5, 20, ".")
    for c0, r0, r1 in feet:
        fill(g, r0, r1, c0, c0 + 1, "B")


def eyes_up(g):
    """眼睛上移 1 行 (看雪花用): D 上移到 row 6-7, row 8 刷回体蓝."""
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")


def draw_z(g, top, left):
    """3x3 白色 Z: 上横 / 斜 / 下横."""
    fill(g, top, top, left, left + 2, "W")
    put(g, top + 1, left + 1, "W")
    fill(g, top + 2, top + 2, left, left + 2, "W")


def draw_flake(g, top, left):
    fill(g, top, top + 1, left, left + 1, "W")


# --- walk: 4 帧循环, 方向 R/L 各一套 ---
def walk(direction, phase):
    g = grid(BASE)
    if direction == "R":
        set_eyes(g, 9, 16)   # 眼睛朝行进方向 (右)
    else:
        set_eyes(g, 7, 14)   # 眼睛朝行进方向 (左)
    if phase == "A":
        # 一脚前抬 (抬起的脚只有 row 13 一行, 向行进方向挪 1 格),
        # 另一脚着地 (rows 13-14).
        if direction == "R":
            set_feet(g, [(9, 13, 14), (16, 13, 13)])
        else:
            set_feet(g, [(8, 13, 13), (15, 13, 14)])
    elif phase == "B":
        # 双脚着地
        set_feet(g, [(9, 13, 14), (15, 13, 14)])
    elif phase == "C":
        # 另一只脚前抬 (向身体中线摆)
        if direction == "R":
            set_feet(g, [(10, 13, 13), (15, 13, 14)])
        else:
            set_feet(g, [(9, 13, 14), (14, 13, 13)])
    elif phase == "D":
        # 双脚着地 + 全身下沉 1 格 (身体起伏的低点, D -> A 接回)
        set_feet(g, [(9, 13, 14), (15, 13, 14)])
        g = shift(g, 1, 0)
    return g


# --- look: 1 居中 / 2 眼睛移 1 格 / 3 眼睛 + 全身再移 1 格 ---
def look(direction, step):
    g = grid(BASE)
    if step == 1:
        pass  # 眼睛居中, 原版
    elif step == 2:
        if direction == "left":
            set_eyes(g, 7, 14)
        else:
            set_eyes(g, 9, 16)
    else:
        if direction == "left":
            set_eyes(g, 7, 14)
            g = shift(g, 0, -1)
        else:
            set_eyes(g, 9, 16)
            g = shift(g, 0, 1)
    return g


# --- jump ---
def jump_1():
    """蹲下: 全身下沉 1 格, 脚张开."""
    g = shift(grid(BASE), 1, 0)
    fill(g, 14, 15, 5, 20, ".")
    fill(g, 14, 15, 8, 9, "B")
    fill(g, 14, 15, 16, 17, "B")
    return g


def jump_2():
    """最高点: 整只上移 2 格, 脚收起 (只有 row 12 一行, 向内收).
    上移后翼耳白尖会顶出网格, 在耳顶 row 0 补回两颗白尖."""
    g = shift(grid(BASE), -2, 0)
    put(g, 0, 7, "W")
    put(g, 0, 18, "W")
    fill(g, 11, 12, 5, 20, ".")
    fill(g, 12, 12, 10, 11, "B")
    fill(g, 12, 12, 14, 15, "B")
    return g


def jump_3():
    """落地: 回正常位置, 脚着地, 轻微压扁 (身体少 1 行, 脚提到
    rows 12-13, 脚张开)."""
    rows = list(BASE)
    # 删掉 row 12 (身体底行), 脚行上提一行
    new = rows[:12] + [rows[13], rows[14]] + ["." * W] * 4
    g = grid(new)
    fill(g, 12, 13, 5, 20, ".")
    fill(g, 12, 13, 8, 9, "B")
    fill(g, 12, 13, 16, 17, "B")
    return g


# --- sleep ---
def sleep_1():
    g = grid(CLOSED)
    draw_z(g, 2, 20)
    return g


def sleep_2():
    g = grid(CLOSED)
    draw_z(g, 1, 21)
    return g


def sleep_3():
    g = shift(grid(CLOSED), 1, 0)
    draw_z(g, 0, 22)
    return g


def sleep_4():
    """Z 到最高处 + 身体下沉 1 格 + 两侧胀出 1 格 (呼吸起伏)."""
    g = shift(grid(CLOSED), 1, 0)
    draw_z(g, 0, 22)
    fill(g, 10, 11, 4, 4, "B")
    fill(g, 10, 11, 21, 21, "B")
    return g


# --- roll: 复用原版 roll_ball, 白色标记 4 个旋转角度 ---
def roll_ball():
    g = blank()
    fill(g, 6, 6, 10, 15, "B")
    fill(g, 7, 11, 8, 17, "B")
    fill(g, 12, 12, 10, 15, "B")
    return g


def roll(pos):
    g = roll_ball()
    if pos == "top":
        fill(g, 6, 6, 12, 13, "W")
    elif pos == "right":
        fill(g, 8, 9, 17, 17, "W")
    elif pos == "bottom":
        fill(g, 12, 12, 12, 13, "W")
    elif pos == "left":
        fill(g, 8, 9, 8, 8, "W")
    return g


# --- peek ---
def peek_hide():
    g = blank()
    put(g, 15, 7, "W")
    put(g, 15, 18, "W")
    fill(g, 16, 16, 6, 8, "B")
    fill(g, 16, 16, 17, 19, "B")
    fill(g, 17, 17, 6, 19, "B")
    return g


def peek_2():
    """半露: 全身下沉 4 格, 眼睛刚露出来 (rows 11-12)."""
    return shift(grid(BASE), 4, 0)


def peek_3():
    return grid(BASE)


# --- dance ---
def dance_1():
    """左倾 (复用原版 dance-L 画法)."""
    g = shift(grid(BASE), 0, -1)
    put(g, 14, 8, ".")
    put(g, 14, 9, ".")
    return g


def dance_2():
    """居中、左脚点地 (左脚只有 row 13 一行)."""
    g = grid(BASE)
    put(g, 14, 9, ".")
    put(g, 14, 10, ".")
    return g


def dance_3():
    """右倾 (复用原版 dance-R 画法)."""
    g = shift(grid(BASE), 0, 1)
    put(g, 14, 16, ".")
    put(g, 14, 17, ".")
    return g


def dance_4():
    """居中、右脚点地 (右脚只有 row 13 一行)."""
    g = grid(BASE)
    put(g, 14, 15, ".")
    put(g, 14, 16, ".")
    return g


# --- snow ---
def snow_1():
    g = grid(BASE)
    eyes_up(g)
    draw_flake(g, 0, 12)
    return g


def snow_2():
    g = grid(BASE)
    eyes_up(g)
    draw_flake(g, 1, 12)
    return g


def snow_3():
    g = grid(BASE)
    eyes_up(g)
    draw_flake(g, 2, 12)
    return g


def snow_4():
    """雪花落到头顶 + 开心闭眼 + 脚收起小跳 (复用原版 snow_2)."""
    g = shift(grid(CLOSED), -1, 0)
    put(g, 2, 12, "W")
    put(g, 2, 13, "W")
    return g


# --- eat ---
def eat_1():
    """点心出现, 眼睛看向点心 (复用原版 eat_1)."""
    g = grid(BASE)
    set_eyes(g, 9, 16)
    fill(g, 13, 14, 21, 22, "W")
    return g


def eat_2():
    """啄一下, 身体下 1 格, 点心变小 (复用原版 eat_2: 1 格点心)."""
    g = shift(grid(CLOSED), 1, 0)
    put(g, 14, 21, "W")
    return g


def eat_3():
    """再啄一下, 点心更小 (下移 1 格) + 两粒碎屑."""
    g = shift(grid(CLOSED), 1, 0)
    put(g, 15, 21, "W")
    put(g, 16, 20, "W")
    put(g, 17, 22, "W")
    return g


def eat_4():
    """点心吃完, 满足闭眼 (身体回正, 无点心无碎屑)."""
    return grid(CLOSED)


FRAMES = {
    "walk-R-A": walk("R", "A"),
    "walk-R-B": walk("R", "B"),
    "walk-R-C": walk("R", "C"),
    "walk-R-D": walk("R", "D"),
    "walk-L-A": walk("L", "A"),
    "walk-L-B": walk("L", "B"),
    "walk-L-C": walk("L", "C"),
    "walk-L-D": walk("L", "D"),
    "look-left-1": look("left", 1),
    "look-left-2": look("left", 2),
    "look-left-3": look("left", 3),
    "look-right-1": look("right", 1),
    "look-right-2": look("right", 2),
    "look-right-3": look("right", 3),
    "jump-1": jump_1(),
    "jump-2": jump_2(),
    "jump-3": jump_3(),
    "sleep-1": sleep_1(),
    "sleep-2": sleep_2(),
    "sleep-3": sleep_3(),
    "sleep-4": sleep_4(),
    "roll-1": roll("top"),
    "roll-2": roll("right"),
    "roll-3": roll("bottom"),
    "roll-4": roll("left"),
    "peek-1": peek_hide(),
    "peek-2": peek_2(),
    "peek-3": peek_3(),
    "dance-1": dance_1(),
    "dance-2": dance_2(),
    "dance-3": dance_3(),
    "dance-4": dance_4(),
    "snow-1": snow_1(),
    "snow-2": snow_2(),
    "snow-3": snow_3(),
    "snow-4": snow_4(),
    "eat-1": eat_1(),
    "eat-2": eat_2(),
    "eat-3": eat_3(),
    "eat-4": eat_4(),
}

# 拼图行顺序 (按动作分行)
SHEET_ROWS = [
    ("walk", ["walk-R-A", "walk-R-B", "walk-R-C", "walk-R-D",
              "walk-L-A", "walk-L-B", "walk-L-C", "walk-L-D"]),
    ("look", ["look-left-1", "look-left-2", "look-left-3",
              "look-right-1", "look-right-2", "look-right-3"]),
    ("jump", ["jump-1", "jump-2", "jump-3"]),
    ("sleep", ["sleep-1", "sleep-2", "sleep-3", "sleep-4"]),
    ("roll", ["roll-1", "roll-2", "roll-3", "roll-4"]),
    ("peek", ["peek-1", "peek-2", "peek-3"]),
    ("dance", ["dance-1", "dance-2", "dance-3", "dance-4"]),
    ("snow", ["snow-1", "snow-2", "snow-3", "snow-4"]),
    ("eat", ["eat-1", "eat-2", "eat-3", "eat-4"]),
]

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
}
SCALE = 28
OUT = "/home/hatch/workspace/cassell-agent/cli-design/mascot"
BG = (11, 18, 32)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


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


if __name__ == "__main__":
    assert len(FRAMES) == 40, len(FRAMES)
    imgs = {}
    for name, g in FRAMES.items():
        lines = s(g)
        assert len(lines) == 18, (name, len(lines))
        lens = {len(r) for r in lines}
        assert lens == {26}, (name, lens)
        imgs[name] = render(lines, f"{OUT}/dragon-v11-mf-{name}.png")
        print(f"saved dragon-v11-mf-{name}.png")

    # contact sheet: 一行一个动作, 左侧标动作名
    fw, fh = imgs["walk-R-A"].size
    label_w = 200
    cols = max(len(r[1]) for r in SHEET_ROWS)
    sheet = Image.new("RGB", (label_w + fw * cols, fh * len(SHEET_ROWS)), BG)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(FONT, 44)
    for ri, (label, names) in enumerate(SHEET_ROWS):
        y = ri * fh
        draw.text((20, y + fh // 2 - 30), label, fill=(255, 255, 255), font=font)
        for ci, name in enumerate(names):
            sheet.paste(imgs[name], (label_w + ci * fw, y), imgs[name])
    sheet.save(f"{OUT}/contact-sheet-multiframe.png")
    print("saved contact-sheet-multiframe.png", sheet.size)
