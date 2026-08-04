#!/usr/bin/env python3
"""
股市看板 Mac App Logo 生成器
风格：研究台 · 沙盘坐标（非行情图）
- 深墨暖径向底 + 极淡网格
- 赭石四象限环 + 坐标轴 + 离散观测点
- macOS squircle；4× 超采样后降采样
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math

OUT_SIZE = 1024
SCALE = 4  # 超采样
SIZE = OUT_SIZE * SCALE
HERE = Path(__file__).resolve().parent
OUT = HERE / "icon_assets"
OUT.mkdir(parents=True, exist_ok=True)


def lerp(a, b, t):
    return a + (b - a) * t


def radial_ink_bg(size):
    """中心暖墨 #201a16 → 四角 #141010"""
    cx = cy = size / 2
    max_r = math.hypot(cx, cy)
    c0 = (32, 26, 22)   # #201a16
    c1 = (20, 16, 16)   # #141010
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, math.hypot(x - cx, y - cy) / max_r)
            t = t ** 1.15
            px[x, y] = (
                int(lerp(c0[0], c1[0], t)),
                int(lerp(c0[1], c1[1], t)),
                int(lerp(c0[2], c1[2], t)),
                255,
            )
    return img


def fade_grid(size, step, line_rgb, base_alpha=95):
    """十字网格，离中心越远越淡"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx = cy = size / 2
    fade_r = size * 0.42
    margin = int(size * 0.078)
    for x in range(margin, size - margin, step):
        dist = abs(x - cx)
        a = int(base_alpha * max(0.0, 1.0 - dist / fade_r))
        if a < 4:
            continue
        draw.line([(x, margin), (x, size - margin)], fill=line_rgb + (a,), width=max(1, SCALE // 2))
    for y in range(margin, size - margin, step):
        dist = abs(y - cy)
        a = int(base_alpha * max(0.0, 1.0 - dist / fade_r))
        if a < 4:
            continue
        draw.line([(margin, y), (size - margin, y)], fill=line_rgb + (a,), width=max(1, SCALE // 2))
    return layer


def squircle_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


# ---- 画布 ----
bg = radial_ink_bg(SIZE)

# 网格（#3a2f28）
grid_step = 96 * SCALE
bg = Image.alpha_composite(bg, fade_grid(SIZE, grid_step, (58, 47, 40), base_alpha=88))

mark = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
md = ImageDraw.Draw(mark)
cx = cy = SIZE // 2

# 坐标轴（赭石深 #b86a46）
axis_half = int(280 * SCALE)
axis_w = max(3, int(10 * SCALE))
axis = (184, 106, 70, 255)
md.line([(cx - axis_half, cy), (cx + axis_half, cy)], fill=axis, width=axis_w)
md.line([(cx, cy - axis_half), (cx, cy + axis_half)], fill=axis, width=axis_w)
# 轴端微圆帽
cap_r = axis_w // 2
for px, py in (
    (cx - axis_half, cy),
    (cx + axis_half, cy),
    (cx, cy - axis_half),
    (cx, cy + axis_half),
):
    md.ellipse([px - cap_r, py - cap_r, px + cap_r, py + cap_r], fill=axis)

# 四象限环（赭石亮 #d18a66）
ring_r = int(220 * SCALE)
ring_w = max(4, int(26 * SCALE))
ring = (209, 138, 102, 255)
bbox = [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r]
md.ellipse(bbox, outline=ring, width=ring_w)

# 观测点（纸白 + 赭石，四象限不对称）
paper = (232, 217, 200, 255)
terr = (209, 138, 102, 255)
dots = [
    (-132, -132, 18, paper),
    (138, -162, 14, terr),
    (-152, 148, 14, terr),
    (128, 138, 18, paper),
    (48, -78, 9, paper),
]
for dx, dy, r, color in dots:
    x = cx + int(dx * SCALE)
    y = cy + int(dy * SCALE)
    rr = max(2, int(r * SCALE))
    md.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)

# 环心极弱暖辉（克制）
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse(
    [cx - int(160 * SCALE), cy - int(160 * SCALE), cx + int(160 * SCALE), cy + int(160 * SCALE)],
    fill=(209, 138, 102, 28),
)
glow = glow.filter(ImageFilter.GaussianBlur(radius=28 * SCALE))
bg = Image.alpha_composite(bg, glow)
bg = Image.alpha_composite(bg, mark)

# 顶部微高光
scan = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(scan)
band = int(SIZE * 0.09)
for y in range(band):
    a = int(26 * (1 - y / band))
    sd.line([(0, y), (SIZE, y)], fill=(243, 235, 224, a))
bg = Image.alpha_composite(bg, scan)

# 降采样 → 1024
bg = bg.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)

# squircle + 边缘玻璃感
radius = OUT_SIZE // 5
mask = squircle_mask(OUT_SIZE, radius)
bg.putalpha(mask)
edge = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (0, 0, 0, 0))
ed = ImageDraw.Draw(edge)
ed.rounded_rectangle(
    [0, 0, OUT_SIZE - 1, OUT_SIZE - 1],
    radius=radius,
    outline=(255, 255, 255, 30),
    width=2,
)
ed.arc([2, 2, OUT_SIZE - 3, OUT_SIZE - 3], 200, 340, fill=(255, 255, 255, 44), width=3)
final = Image.alpha_composite(bg, edge)

png_path = OUT / "logo_1024.png"
final.save(png_path, "PNG")
print(f"✓ {png_path.name} 生成完成 ({OUT_SIZE}x{OUT_SIZE})")
print("  设计：深墨沙盘 + 赭石四象限环/坐标轴 + 观测点（无 K 线）")
