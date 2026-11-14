#!/usr/bin/env python3
"""Render noya v11 节日套装 (user request 2026-11-15:
创意页上的点子“我都要”，圣诞第一套已批准，按圣诞模板做其余节日).
节日规则 (用户定): 节日那天三样缺一不可 —— ① 特殊形象 ② 特殊形象版
常驻动作 ③ 节日专属特殊动作. 按日期自动、第一次亮相一次、记住上次
的衣服. 颜色只用节日自己的颜色,不要金色.

每套 6 帧 (圣诞模板):
  <fest>-hat    特殊形象 (v11 本体 + 节日造型,本体不动)
  <fest>-walk   特殊形象版常驻动作: 走路 (walk-R-A + 造型)
  <fest>-blink  特殊形象版常驻动作: 眨眼 (闭眼帧 + 造型)
  <fest>-sleep  特殊形象版常驻动作: 睡觉 (sleep-1 + 造型)
  <fest>-<s1>   节日专属特殊动作 1
  <fest>-<s2>   节日专属特殊动作 2

9 套 (圣诞已做完,不在此):
  halloween  万圣节 10/24-31: 南瓜帽 + 糖果桶 / 小幽灵 (橙+绿)
  newyear    新年 1/1: 派对帽 + 五彩纸屑 / 烟花 (红+白)
  springfest 春节: 红帽白毛边 + 红包 / 红灯笼 (红+白)
  valentine  情人节 2/12-14: 爱心发箍 + 飘爱心 / 玫瑰 (粉+红)
  easter     复活节 圣周: 兔耳朵 + 彩蛋 / 兔子跳 (粉+白)
  midautumn  中秋 当晚: 月牙发箍 + 月饼 / 小白兔 (白+棕)
  birthday   生日 自设日期: 派对帽 + 生日蛋糕 / 气球 (粉+蓝)
  friday     周五傍晚 每周五 17:00 后: 墨镜 + 饮料杯 / 葛优躺 (墨镜造型)
  weather    天气联动 实时 (以雨天为代表): 雨帽 + 雨伞 / 雨滴 (蓝)
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

EYES_R = ".....BBBBDDDBBBBDDDBB....."  # eyes shifted right

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


def clear_eyes(g):
    fill(g, 7, 8, 7, 18, "B")


def happy_eyes(g):
    """∩∩ closed happy eyes."""
    clear_eyes(g)
    put(g, 7, 9, "D")
    put(g, 7, 16, "D")
    put(g, 8, 8, "D")
    put(g, 8, 10, "D")
    put(g, 8, 15, "D")
    put(g, 8, 17, "D")


def eyes_up(g):
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")


def eyes_right(g):
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)


# --- generic bases ---
def walk_base():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    g[13] = list(".........BB.....BB........")
    g[14] = list(".........BB...............")
    return g


def blink_base():
    return grid(CLOSED)


def sleep_base():
    g = grid(CLOSED)
    fill(g, 1, 1, 20, 22, "W")
    put(g, 2, 21, "W")
    fill(g, 3, 3, 20, 22, "W")          # little "Z"
    return g


# --- toppers: festival headwear, between the wing-ears, white tips kept ---
def top_halloween(g):
    put(g, 0, 12, "G")                  # stem
    fill(g, 1, 1, 10, 15, "O")          # pumpkin
    fill(g, 2, 2, 9, 16, "O")
    put(g, 2, 11, "D")                  # jack-o'-lantern face
    put(g, 2, 14, "D")
    return g


def top_newyear(g):
    put(g, 0, 12, "R")                  # striped party hat
    put(g, 1, 11, "R")
    put(g, 1, 12, "W")
    put(g, 1, 13, "R")
    put(g, 1, 14, "W")
    put(g, 2, 10, "W")
    put(g, 2, 11, "R")
    put(g, 2, 12, "W")
    put(g, 2, 13, "R")
    put(g, 2, 14, "W")
    put(g, 2, 15, "R")
    return g


def top_springfest(g):
    put(g, 0, 12, "R")                  # red hat + white fur brim
    put(g, 0, 13, "R")
    fill(g, 1, 1, 10, 15, "R")
    fill(g, 2, 2, 9, 16, "W")
    return g


def top_valentine(g):
    fill(g, 0, 0, 11, 14, "P")          # heart headband
    put(g, 1, 12, "P")
    put(g, 1, 13, "P")
    fill(g, 2, 2, 10, 15, "P")          # band
    return g


def top_easter(g):
    fill(g, 0, 2, 10, 11, "W")          # bunny ears, pink inner
    fill(g, 0, 2, 14, 15, "W")
    put(g, 1, 10, "P")
    put(g, 1, 15, "P")
    return g


def top_midautumn(g):
    put(g, 0, 13, "W")                  # crescent moon
    put(g, 0, 14, "W")
    put(g, 1, 12, "W")
    put(g, 1, 13, "W")
    put(g, 2, 11, "W")
    put(g, 2, 12, "W")
    return g


def top_birthday(g):
    put(g, 0, 12, "P")                  # pink/blue party hat
    put(g, 1, 11, "P")
    put(g, 1, 12, "L")
    put(g, 1, 13, "P")
    put(g, 1, 14, "L")
    put(g, 2, 10, "L")
    put(g, 2, 11, "P")
    put(g, 2, 12, "L")
    put(g, 2, 13, "P")
    put(g, 2, 14, "L")
    put(g, 2, 15, "P")
    return g


def top_friday(g):
    """Sunglasses: the Friday-evening look (not a hat)."""
    fill(g, 7, 8, 7, 11, "D")           # left shade
    fill(g, 7, 8, 14, 18, "D")          # right shade
    fill(g, 7, 7, 12, 13, "D")          # bridge
    put(g, 7, 8, "W")                    # glints
    put(g, 7, 15, "W")
    return g


def top_weather(g):
    put(g, 0, 12, "L")                  # blue rain hat
    put(g, 0, 13, "L")
    fill(g, 1, 1, 10, 15, "L")
    fill(g, 2, 2, 9, 16, "L")
    return g


# --- festival specials ---
def sp_halloween_candy():
    g = grid(BASE)
    eyes_right(g)
    fill(g, 12, 12, 21, 24, "O")        # candy bucket
    put(g, 12, 22, "W")                 # candy poking out
    put(g, 13, 21, "O")
    put(g, 13, 24, "O")
    fill(g, 14, 14, 21, 24, "O")
    put(g, 11, 22, "W")                 # handle
    return g


def sp_halloween_ghost():
    g = grid(BASE)
    eyes_right(g)
    fill(g, 3, 3, 21, 23, "W")          # little ghost
    fill(g, 4, 4, 20, 24, "W")
    put(g, 5, 21, "D")
    put(g, 5, 23, "D")                  # ghost eyes
    put(g, 6, 20, "W")
    put(g, 6, 22, "W")
    put(g, 6, 24, "W")                  # wavy bottom
    return g


def sp_newyear_confetti():
    g = grid(BASE)
    happy_eyes(g)
    put(g, 0, 8, "R")                    # confetti burst
    put(g, 0, 17, "G")
    put(g, 1, 5, "P")
    put(g, 1, 20, "W")
    put(g, 2, 12, "R")
    put(g, 3, 4, "G")
    put(g, 3, 22, "P")
    return g


def sp_newyear_firework():
    g = grid(BASE)
    eyes_up(g)
    put(g, 2, 22, "W")                  # firework burst, top right
    put(g, 1, 22, "W")
    put(g, 3, 22, "W")
    put(g, 2, 21, "W")
    put(g, 2, 23, "W")
    put(g, 0, 22, "R")
    put(g, 4, 22, "R")
    put(g, 2, 20, "R")
    put(g, 2, 24, "R")
    return g


def sp_springfest_envelope():
    g = grid(BASE)
    eyes_right(g)
    fill(g, 12, 15, 21, 24, "R")        # red envelope
    put(g, 13, 22, "W")                 # seal
    return g


def sp_springfest_lantern():
    g = grid(BASE)
    eyes_right(g)
    put(g, 3, 22, "W")                  # string
    put(g, 4, 22, "R")                  # cap
    fill(g, 5, 7, 21, 23, "R")          # round body
    put(g, 6, 22, "W")                  # glow centre
    put(g, 8, 22, "R")                  # base
    return g


def sp_valentine_hearts():
    g = grid(BASE)
    happy_eyes(g)
    put(g, 1, 10, "P")                  # floating hearts
    put(g, 1, 11, "P")
    put(g, 2, 10, "P")
    put(g, 0, 16, "P")
    put(g, 0, 17, "P")
    put(g, 1, 16, "P")
    return g


def sp_valentine_rose():
    g = grid(BASE)
    eyes_right(g)
    put(g, 5, 22, "R")                  # rose
    fill(g, 6, 6, 21, 23, "R")
    put(g, 7, 22, "G")                  # stem
    put(g, 8, 22, "G")
    put(g, 8, 21, "G")                  # leaf
    return g


def sp_easter_egg():
    g = grid(BASE)
    eyes_right(g)
    put(g, 12, 22, "W")                 # painted egg
    fill(g, 13, 13, 21, 23, "W")
    fill(g, 14, 14, 21, 23, "P")        # pink stripe
    put(g, 15, 22, "W")
    return g


def sp_easter_hop():
    g = top_easter(grid(BASE))
    # mid-hop: feet tucked up, motion dashes below
    fill(g, 13, 14, 10, 11, ".")
    fill(g, 13, 14, 16, 17, ".")
    put(g, 15, 8, "W")
    put(g, 15, 17, "W")
    return g


def sp_midautumn_mooncake():
    g = grid(BASE)
    eyes_right(g)
    fill(g, 13, 14, 21, 23, "T")        # mooncake
    put(g, 13, 22, "K")                 # pattern
    return g


def sp_midautumn_rabbit():
    g = grid(BASE)
    eyes_right(g)
    put(g, 8, 21, "W")                  # little white rabbit
    put(g, 8, 23, "W")
    put(g, 9, 21, "W")
    put(g, 9, 23, "W")                  # ears
    fill(g, 10, 11, 21, 23, "W")        # body
    put(g, 10, 22, "D")                 # eye
    put(g, 12, 21, "W")
    put(g, 12, 23, "W")                 # feet
    return g


def sp_birthday_cake():
    g = grid(BASE)
    eyes_right(g)
    fill(g, 13, 13, 20, 24, "W")        # cake
    fill(g, 14, 14, 20, 24, "P")        # frosting
    fill(g, 15, 15, 20, 24, "W")
    put(g, 12, 21, "W")                 # candles
    put(g, 12, 23, "W")
    put(g, 11, 21, "O")                 # flames
    put(g, 11, 23, "O")
    return g


def sp_birthday_balloon():
    g = grid(BASE)
    happy_eyes(g)
    fill(g, 1, 2, 20, 21, "P")          # pink balloon
    put(g, 3, 20, "W")
    put(g, 4, 20, "W")                  # string
    put(g, 0, 23, "L")                  # blue balloon
    put(g, 1, 23, "L")
    put(g, 2, 23, "W")                  # string
    return g


def sp_friday_drink():
    g = top_friday(grid(BASE))
    fill(g, 12, 12, 21, 23, "W")        # mug
    put(g, 13, 21, "W")
    put(g, 13, 22, "O")                 # drink
    put(g, 13, 23, "W")
    fill(g, 14, 14, 21, 23, "W")
    put(g, 13, 24, "W")                 # handle
    return g


def sp_friday_chill():
    g = top_friday(shift(grid(BASE), -1, 0))
    put(g, 12, 8, "B")                  # feet kicked up
    put(g, 12, 17, "B")
    return g


def sp_weather_umbrella():
    g = grid(BASE)
    fill(g, 0, 0, 11, 14, "L")          # umbrella canopy
    fill(g, 1, 1, 8, 17, "L")
    put(g, 2, 8, "L")
    put(g, 2, 17, "L")                  # canopy edges
    put(g, 2, 12, "L")                  # handle
    return g


def sp_weather_rain():
    g = top_weather(grid(BASE))
    eyes_up(g)
    put(g, 0, 6, "L")                   # raindrops
    put(g, 1, 12, "L")
    put(g, 0, 18, "L")
    put(g, 2, 22, "L")
    put(g, 3, 5, "L")
    put(g, 4, 15, "L")
    return g


FESTIVALS = {
    "halloween":  (top_halloween,  sp_halloween_candy,   sp_halloween_ghost),
    "newyear":    (top_newyear,    sp_newyear_confetti,  sp_newyear_firework),
    "springfest": (top_springfest, sp_springfest_envelope, sp_springfest_lantern),
    "valentine":  (top_valentine,  sp_valentine_hearts,  sp_valentine_rose),
    "easter":     (top_easter,     sp_easter_egg,        sp_easter_hop),
    "midautumn":  (top_midautumn,  sp_midautumn_mooncake, sp_midautumn_rabbit),
    "birthday":   (top_birthday,   sp_birthday_cake,     sp_birthday_balloon),
    "friday":     (top_friday,     sp_friday_drink,      sp_friday_chill),
    "weather":    (top_weather,    sp_weather_umbrella,  sp_weather_rain),
}

SPECIAL_NAMES = {
    "halloween":  ("candy", "ghost"),
    "newyear":    ("confetti", "firework"),
    "springfest": ("envelope", "lantern"),
    "valentine":  ("hearts", "rose"),
    "easter":     ("egg", "hop"),
    "midautumn":  ("mooncake", "rabbit"),
    "birthday":   ("cake", "balloon"),
    "friday":     ("drink", "chill"),
    "weather":    ("umbrella", "rain"),
}

FRAMES = {}
for _name, (_top, _s1, _s2) in FESTIVALS.items():
    FRAMES[f"{_name}-hat"] = _top(grid(BASE))
    FRAMES[f"{_name}-walk"] = _top(walk_base())
    FRAMES[f"{_name}-blink"] = _top(blink_base())
    FRAMES[f"{_name}-sleep"] = _top(sleep_base())
    _a, _b = SPECIAL_NAMES[_name]
    FRAMES[f"{_name}-{_a}"] = _s1()
    FRAMES[f"{_name}-{_b}"] = _s2()

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
    "R": (239, 68, 68),     # red (new year / spring festival / lantern)
    "G": (34, 197, 94),     # green (pumpkin stem / rose stem)
    "O": (249, 115, 22),    # orange (pumpkin / candle flames)
    "P": (244, 114, 182),   # pink (valentine / easter / birthday)
    "T": (176, 124, 64),    # tan brown (mooncake)
    "K": (120, 82, 42),     # dark brown (mooncake pattern)
    "L": (59, 130, 246),    # deeper blue (birthday hat / rain / umbrella)
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


def contact_sheet(names, path, cols=3, scale=SCALE):
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    except Exception:
        font = ImageFont.load_default()
    label_h = 48
    imgs = {}
    for n in names:
        imgs[n] = render(FRAMES[n], f"{OUT}/{n}.png", scale=scale)
    w, h = imgs[names[0]].size
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (w * cols, (h + label_h) * rows), BG)
    dr = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        x = (i % cols) * w
        y = (i // cols) * (h + label_h)
        sheet.paste(imgs[n], (x, y), imgs[n])
        dr.text((x + 12, y + h + 8), n, fill=(255, 255, 255), font=font)
    sheet.save(path)
    print(f"saved {path}", sheet.size)


if __name__ == "__main__":
    for name, g in FRAMES.items():
        lines = s(g)
        lens = {len(r) for r in lines}
        assert len(lens) == 1, (name, lens)
        render(lines, f"{OUT}/{name}.png")
        print(f"saved {name}.png")

    for fest, (_top, _s1, _s2) in FESTIVALS.items():
        a, b = SPECIAL_NAMES[fest]
        order = [f"{fest}-hat", f"{fest}-walk", f"{fest}-blink",
                 f"{fest}-sleep", f"{fest}-{a}", f"{fest}-{b}"]
        contact_sheet(order, f"{OUT}/contact-sheet-{fest}.png")
