#!/usr/bin/env python3
"""Render noya v11 第二批新帧 (user request 2026-11-15:
创意页「龙宝新创意：螃蟹调研启发」上的点子“我都要”，一个不漏).
Same base as v11 (26x18, body #60a5fa, eyes #0F172A, white #FFFFFF).
noya v11 本体一个像素不动.

Batch2 = 12 张只靠眼睛的表情 (expr-) + 帽子表里还没画的 4 件
配饰 (hat-) + 15 个新动作里还没画的 12 组 24 帧 (action-).

已画的不重画,复用:
  表情: 平常 = dragon-v11-open, 晕 = dragon-v11-react-dizzy
  帽子: 侦探/巫师/厨师/安全帽/耳机 (batch1)
  动作: 出汗阶梯 sweat-1/2/3, 翻肚皮 belly-up + soul-out,
        举牌 sign-yes/no, 天降礼盒 gift-box-*
  状态: 11 个试演状态全部由已有帧 + 本批新帧覆盖,不另画帧.

表情 (只改眼睛,身体/翼耳/脚一律不动):
  expr-happy    开心: ∩∩ 闭眼
  expr-blush    脸红开心: 开心眼 + 粉脸颊
  expr-wink     眨单眼: 左闭右睁
  expr-surprised 惊讶: 3 格高大眼睛
  expr-star     星星眼: 白色四角星
  expr-heart    爱心眼: 粉色爱心
  expr-sleepy   困倦: 半闭眼 (无汗,区别于 sweat-3)
  expr-sad      委屈: 内高外低八字眼
  expr-swirl    蚊香眼: 暗环白心 ◎
  expr-squint   专注眯眼: 单行窄眼 (2 格宽,区别于困倦 3 格)

配饰 (卡在两翼耳中间,白尖不盖;深底上看得清,不要黑):
  hat-glasses     小圆眼镜: 白色细框 (读长文档)
  hat-pompom      拉拉队绒球: 粉白绒球顶在耳尖 (跑测试通过)
  hat-mode-norma  NORMA 小帽: 白色小帽
  hat-mode-eva    EVA 小帽: 深蓝小帽

新动作 (每动作 1-3 帧,关键帧):
  A2 action-juggle / action-conduct  杂耍/指挥: 抛接 3 光点 / 排成一列指挥
  A3 action-sprint-r / action-sprint-l 冲刺搬运: 快跑 + 身后小灰尘
  A4 action-point  举牌/指向: 歪头,翼耳指向右侧
  A5 action-prop-stamp / -lantern / -snowpile 常驻小道具: 印章台/灯笼/雪堆
  A6 action-stamp-down / -up  压缩盖印: 低头盖印 / 抬头,纸上有印
  B1 action-hug-me / -picked-up  求抱抱/被抱起: 两耳张开眼巴巴 / 被拎起爱心飘
  B3 action-thrown / -parachute  被扔/耳朵降落伞: 落地晕星星绕头 / 翼耳张开当伞
  B4 action-squash / -bounce / -sneeze  被戳: 压扁 / 回弹+爱心 / 打喷嚏
  B5 action-flip-1 / -2  整点后空翻: 翻转中 (头朝下) / 落地
  B6 action-star-medal  升级星星+奖牌: 星星落头上 + 脖子下小奖牌
  C2 action-slide-leaf / -cloud  踩叶/踩云滑行: 踩叶 / 踩云
  C3 action-sun / -moon  接物小任务: 接满 5 片升起小太阳 / 夜里小月亮
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
    """Wipe the eye area (rows 7-8, cols 7-18) back to body blue."""
    fill(g, 7, 8, 7, 18, "B")


def eyes_up(g):
    """Eyes looking up: dark rows 6-7, row 8 cleared."""
    fill(g, 6, 6, 8, 10, "D")
    fill(g, 6, 6, 15, 17, "D")
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")


# ================= 12 张只靠眼睛的表情 =================
def expr_normal():
    return grid(BASE)


def expr_happy():
    g = grid(BASE)
    clear_eyes(g)
    # ∩∩ closed happy eyes: dark top-middle + bottom sides
    put(g, 7, 9, "D")
    put(g, 7, 16, "D")
    put(g, 8, 8, "D")
    put(g, 8, 10, "D")
    put(g, 8, 15, "D")
    put(g, 8, 17, "D")
    return g


def expr_blush():
    g = expr_happy()
    # pink cheeks on both sides
    put(g, 9, 6, "P")
    put(g, 9, 7, "P")
    put(g, 10, 6, "P")
    put(g, 9, 18, "P")
    put(g, 9, 19, "P")
    put(g, 10, 19, "P")
    return g


def expr_wink():
    g = grid(BASE)
    clear_eyes(g)
    # left eye closed (2-wide dot, row 8), right eye open
    put(g, 8, 8, "D")
    put(g, 8, 9, "D")
    fill(g, 7, 8, 15, 17, "D")
    return g


def expr_surprised():
    g = grid(BASE)
    # wide eyes: 3 rows tall (6-8) instead of 2
    fill(g, 6, 8, 8, 10, "D")
    fill(g, 6, 8, 15, 17, "D")
    return g


def expr_star():
    g = grid(BASE)
    clear_eyes(g)
    # white 4-point stars on the blue face
    put(g, 7, 9, "W")
    put(g, 8, 8, "W")
    put(g, 8, 9, "W")
    put(g, 8, 10, "W")
    put(g, 7, 16, "W")
    put(g, 8, 15, "W")
    put(g, 8, 16, "W")
    put(g, 8, 17, "W")
    return g


def expr_heart():
    g = grid(BASE)
    clear_eyes(g)
    # pink hearts: two lobes on row 7, point on row 8
    put(g, 7, 8, "P")
    put(g, 7, 10, "P")
    fill(g, 8, 8, 8, 10, "P")
    put(g, 7, 15, "P")
    put(g, 7, 17, "P")
    fill(g, 8, 8, 15, 17, "P")
    return g


def expr_sleepy():
    g = grid(BASE)
    clear_eyes(g)
    # half-closed: only the lower eye row stays dark (no sweat drops,
    # unlike sweat-3)
    fill(g, 8, 8, 8, 10, "D")
    fill(g, 8, 8, 15, 17, "D")
    return g


def expr_sad():
    g = grid(BASE)
    clear_eyes(g)
    # wronged slant: inner corners up, outer corners down
    put(g, 7, 9, "D")
    put(g, 7, 10, "D")
    put(g, 8, 8, "D")
    put(g, 7, 15, "D")
    put(g, 7, 16, "D")
    put(g, 8, 17, "D")
    return g


def expr_swirl():
    g = grid(BASE)
    clear_eyes(g)
    # spiral / dizzy ring eyes: dark ring with a white centre
    fill(g, 7, 7, 8, 10, "D")
    fill(g, 7, 7, 15, 17, "D")
    put(g, 8, 8, "D")
    put(g, 8, 9, "W")
    put(g, 8, 10, "D")
    put(g, 8, 15, "D")
    put(g, 8, 16, "W")
    put(g, 8, 17, "D")
    return g


def expr_squint():
    g = grid(BASE)
    clear_eyes(g)
    # focused squint: one thin row, 2 cells wide (narrower than sleepy)
    put(g, 8, 8, "D")
    put(g, 8, 9, "D")
    put(g, 8, 16, "D")
    put(g, 8, 17, "D")
    return g


def expr_dizzy():
    """X eyes (same as react-dizzy, reused for the expression sheet)."""
    g = grid(BASE)
    fill(g, 7, 8, 8, 10, "B")
    fill(g, 7, 8, 15, 17, "B")
    put(g, 7, 8, "D")
    put(g, 7, 10, "D")
    put(g, 8, 9, "D")
    put(g, 7, 15, "D")
    put(g, 7, 17, "D")
    put(g, 8, 16, "D")
    return g


# ================= 帽子表里还没画的 4 件配饰 =================
def hat_glasses():
    """Small round glasses: thin white frame around the eyes."""
    g = grid(BASE)
    fill(g, 6, 6, 7, 11, "W")       # top bars
    fill(g, 6, 6, 14, 18, "W")
    fill(g, 9, 9, 7, 11, "W")       # bottom bars
    fill(g, 9, 9, 14, 18, "W")
    put(g, 7, 7, "W")
    put(g, 8, 7, "W")               # left frame sides
    put(g, 7, 11, "W")
    put(g, 8, 11, "W")
    put(g, 7, 14, "W")
    put(g, 8, 14, "W")              # right frame sides
    put(g, 7, 18, "W")
    put(g, 8, 18, "W")
    fill(g, 7, 7, 12, 13, "W")      # bridge
    return g


def hat_pompom():
    """Cheer pompom on the ear tip: pink fluffy ball, white spikes."""
    g = grid(BASE)
    put(g, 0, 12, "P")
    put(g, 0, 13, "P")
    fill(g, 1, 1, 11, 14, "P")
    put(g, 1, 12, "W")              # white centre
    put(g, 2, 10, "W")
    put(g, 2, 15, "W")              # fluffy spikes
    return g


def hat_mode_norma():
    """NORMA mode cap: small white cap between the ears."""
    g = grid(BASE)
    put(g, 0, 12, "W")
    put(g, 0, 13, "W")
    fill(g, 1, 1, 11, 14, "W")
    fill(g, 2, 2, 10, 15, "W")
    return g


def hat_mode_eva():
    """EVA mode cap: same shape, deeper blue so it reads on the body."""
    g = grid(BASE)
    put(g, 0, 12, "L")
    put(g, 0, 13, "L")
    fill(g, 1, 1, 11, 14, "L")
    fill(g, 2, 2, 10, 15, "L")
    return g


# ================= 15 个新动作里还没画的 =================
def walk_r_a():
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    g[13] = list(".........BB.....BB........")
    g[14] = list(".........BB...............")
    return g


def walk_l_a():
    g = grid(BASE)
    g[7] = list(".....BBDDDBBBBDDDBBBB.....")
    g[8] = list(".....BBDDDBBBBDDDBBBB.....")
    g[13] = list("........BB.....BB.........")
    g[14] = list("...............BB.........")
    return g


def action_juggle():
    """1 subagent: juggling 3 light dots above the head."""
    g = grid(BASE)
    eyes_up(g)
    # arc of 3 dots along the very top edge, clear of the ear tips
    put(g, 0, 9, "W")
    put(g, 0, 12, "W")
    put(g, 0, 16, "W")
    return g


def action_conduct():
    """2+ subagents: light dots in a row, head nodding down 1."""
    g = shift(grid(BASE), 1, 0)
    # dots on the top edge, clear of the (shifted-down) ear tips
    put(g, 0, 8, "W")
    put(g, 0, 12, "W")
    put(g, 0, 16, "W")
    return g


def action_sprint_r():
    """Sprint right: walk-R pose + dust puffs kicked up behind."""
    g = walk_r_a()
    put(g, 14, 2, "W")
    put(g, 15, 3, "W")
    put(g, 13, 4, "W")
    put(g, 11, 1, "W")
    return g


def action_sprint_l():
    """Sprint left: mirror of sprint right."""
    g = walk_l_a()
    put(g, 14, 23, "W")
    put(g, 15, 22, "W")
    put(g, 13, 21, "W")
    put(g, 11, 24, "W")
    return g


def action_point():
    """Pointing: head tilted right, right wing-ear stretched to point."""
    g = shift(grid(BASE), 0, 1)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    put(g, 2, 21, "B")
    put(g, 2, 22, "B")
    put(g, 2, 23, "W")              # ear tip at the end of the point
    return g


def action_prop_stamp():
    """Resident prop: stamp pad beside the dragon (context compress)."""
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    fill(g, 12, 12, 21, 24, "W")    # pad
    fill(g, 13, 13, 21, 24, "D")    # stamp top
    put(g, 11, 22, "D")             # stamp knob
    return g


def action_prop_lantern():
    """Resident prop: red lantern at night."""
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    put(g, 3, 22, "W")              # string
    put(g, 4, 22, "R")              # cap
    fill(g, 5, 7, 21, 23, "R")      # round body, 3 wide
    put(g, 6, 22, "W")              # glow centre
    put(g, 8, 22, "R")              # base
    return g


def action_prop_snowpile():
    """Resident prop: snow pile in winter."""
    g = grid(BASE)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    put(g, 13, 22, "W")
    fill(g, 14, 14, 21, 23, "W")
    fill(g, 15, 15, 20, 24, "W")
    return g


def action_stamp_down():
    """Compression stamping: head pressed down onto the paper stack."""
    g = shift(grid(BASE), 1, 0)
    fill(g, 14, 16, 20, 23, "W")    # paper stack
    put(g, 14, 21, "D")             # fresh stamp mark
    return g


def action_stamp_up():
    """Compression stamping: head back up, stamped check on the paper."""
    g = grid(BASE)
    fill(g, 13, 15, 20, 23, "W")    # paper stack
    put(g, 13, 21, "D")
    put(g, 14, 22, "D")             # check mark on the paper
    return g


def action_hug_me():
    """Begging for a hug: ears spread wide, pleading eyes looking up."""
    g = grid(BASE)
    put(g, 1, 7, ".")               # remove old ear tips
    put(g, 1, 18, ".")
    put(g, 2, 5, "B")               # new wider ears
    put(g, 2, 20, "B")
    put(g, 1, 5, "W")
    put(g, 1, 20, "W")              # new tips
    eyes_up(g)
    return g


def action_picked_up():
    """Picked up: lifted up 1, hearts floating up."""
    g = shift(grid(BASE), -1, 0)
    put(g, 1, 3, "P")
    put(g, 0, 22, "P")
    put(g, 2, 23, "P")
    return g


def action_thrown():
    """Thrown: landing dizzy, stars circling the head."""
    g = expr_dizzy()
    put(g, 3, 3, "W")
    put(g, 2, 22, "W")
    put(g, 4, 23, "W")
    return g


def action_parachute():
    """Ear parachute: wing-ears spread into a canopy, floating down."""
    g = shift(grid(BASE), 1, 0)
    fill(g, 0, 0, 10, 15, "B")      # canopy top
    fill(g, 1, 1, 8, 17, "B")       # canopy
    put(g, 1, 8, "W")
    put(g, 1, 17, "W")              # ear tips at canopy edges
    # happy closed eyes (∩∩): after the shift, eyes sit at rows 8-9
    fill(g, 8, 9, 8, 10, "B")
    fill(g, 8, 9, 15, 17, "B")
    put(g, 8, 8, "D")
    put(g, 8, 10, "D")
    put(g, 8, 15, "D")
    put(g, 8, 17, "D")
    put(g, 9, 9, "D")
    put(g, 9, 16, "D")
    return g


def action_squash():
    """Poked: squashed flat, eyes squeezed to one row."""
    g = shift(grid(BASE), 1, 0)
    fill(g, 11, 11, 4, 21, "B")     # wider, flatter bottom
    fill(g, 8, 8, 8, 10, "B")
    fill(g, 8, 8, 15, 17, "B")
    return g


def action_bounce():
    """Poked: bounced back, happy eyes + one heart above."""
    g = expr_happy()
    put(g, 1, 12, "P")
    put(g, 1, 13, "P")
    put(g, 2, 12, "P")
    return g


def action_sneeze():
    """Sneeze: scrunched down, eyes shut tight, puff to the side."""
    g = shift(grid(CLOSED), 1, 0)
    put(g, 5, 22, "W")
    put(g, 6, 21, "W")
    put(g, 6, 22, "W")
    put(g, 7, 23, "W")
    return g


def action_flip_1():
    """Hourly backflip, mid-flip: upside down, feet up, normal eyes."""
    g = [list(r) for r in reversed(BASE)]
    return g


def action_flip_2():
    """Hourly backflip, landing: happy eyes + motion arc above."""
    g = expr_happy()
    put(g, 0, 10, "W")
    put(g, 0, 15, "W")
    put(g, 1, 8, "W")
    put(g, 1, 17, "W")
    return g


def action_star_medal():
    """Upgrade star + medal: star lands on the head, medal under the neck."""
    g = grid(BASE)
    put(g, 0, 12, "W")              # star
    put(g, 1, 11, "W")
    put(g, 1, 12, "W")
    put(g, 1, 13, "W")
    put(g, 2, 12, "W")
    put(g, 13, 12, "R")             # ribbon
    put(g, 14, 12, "W")
    put(g, 14, 13, "W")             # medal disc
    put(g, 15, 12, "W")
    return g


def action_slide_leaf():
    """Leaf slide: standing on a green leaf, leaning forward, speed lines."""
    g = walk_r_a()
    fill(g, 15, 15, 9, 16, "G")     # leaf
    fill(g, 16, 16, 8, 17, "G")
    put(g, 11, 2, "W")
    put(g, 12, 3, "W")              # speed lines
    return g


def action_slide_cloud():
    """Cloud slide: standing on a white cloud, happy closed eyes."""
    g = expr_happy()
    fill(g, 15, 15, 9, 16, "W")     # cloud
    fill(g, 16, 16, 8, 17, "W")
    return g


def action_sun():
    """Catch quest payoff (day): little sun rises, dragon looks up-right."""
    g = grid(BASE)
    eyes_up(g)
    g[7] = list(EYES_R)
    g[8] = list(EYES_R)
    put(g, 1, 22, "W")              # sun disc
    put(g, 2, 21, "W")
    put(g, 2, 22, "W")
    put(g, 2, 23, "W")
    put(g, 3, 22, "W")
    put(g, 0, 22, "O")              # orange rays
    put(g, 2, 20, "O")
    put(g, 2, 24, "O")
    return g


def action_moon():
    """Catch quest payoff (night): little moon rises, dragon looks up."""
    g = grid(BASE)
    eyes_up(g)
    put(g, 1, 22, "W")
    put(g, 1, 23, "W")              # crescent
    put(g, 2, 21, "W")
    put(g, 2, 22, "W")
    put(g, 3, 22, "W")
    return g


EXPRESSIONS = {
    "expr-normal": expr_normal(),       # reuse of dragon-v11-open
    "expr-happy": expr_happy(),
    "expr-blush": expr_blush(),
    "expr-wink": expr_wink(),
    "expr-surprised": expr_surprised(),
    "expr-star": expr_star(),
    "expr-heart": expr_heart(),
    "expr-sleepy": expr_sleepy(),
    "expr-sad": expr_sad(),
    "expr-dizzy": expr_dizzy(),         # reuse of dragon-v11-react-dizzy
    "expr-swirl": expr_swirl(),
    "expr-squint": expr_squint(),
}

HATS = {
    "hat-glasses": hat_glasses(),
    "hat-pompom": hat_pompom(),
    "hat-mode-norma": hat_mode_norma(),
    "hat-mode-eva": hat_mode_eva(),
}

ACTIONS = {
    "action-juggle": action_juggle(),
    "action-conduct": action_conduct(),
    "action-sprint-r": action_sprint_r(),
    "action-sprint-l": action_sprint_l(),
    "action-point": action_point(),
    "action-prop-stamp": action_prop_stamp(),
    "action-prop-lantern": action_prop_lantern(),
    "action-prop-snowpile": action_prop_snowpile(),
    "action-stamp-down": action_stamp_down(),
    "action-stamp-up": action_stamp_up(),
    "action-hug-me": action_hug_me(),
    "action-picked-up": action_picked_up(),
    "action-thrown": action_thrown(),
    "action-parachute": action_parachute(),
    "action-squash": action_squash(),
    "action-bounce": action_bounce(),
    "action-sneeze": action_sneeze(),
    "action-flip-1": action_flip_1(),
    "action-flip-2": action_flip_2(),
    "action-star-medal": action_star_medal(),
    "action-slide-leaf": action_slide_leaf(),
    "action-slide-cloud": action_slide_cloud(),
    "action-sun": action_sun(),
    "action-moon": action_moon(),
}

FRAMES = {}
FRAMES.update(EXPRESSIONS)
FRAMES.update(HATS)
FRAMES.update(ACTIONS)

COLORS = {
    "B": (96, 165, 250),
    "D": (15, 23, 42),
    "W": (255, 255, 255),
    "R": (239, 68, 68),     # red (lantern, ribbon)
    "G": (34, 197, 94),     # green (leaf)
    "O": (249, 115, 22),    # orange (sun rays)
    "P": (244, 114, 182),   # pink (blush, hearts, pompom)
    "L": (59, 130, 246),    # deeper blue (EVA cap)
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


def contact_sheet(names, path, cols=5, scale=SCALE):
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

    expr_order = ["expr-normal", "expr-happy", "expr-blush", "expr-wink",
                  "expr-surprised", "expr-star", "expr-heart", "expr-sleepy",
                  "expr-sad", "expr-dizzy", "expr-swirl", "expr-squint"]
    contact_sheet(expr_order, f"{OUT}/contact-sheet-expressions.png", cols=4)

    batch2_order = list(HATS.keys()) + list(ACTIONS.keys())
    contact_sheet(batch2_order, f"{OUT}/contact-sheet-batch2.png", cols=5)
