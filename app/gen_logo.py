#!/usr/bin/env python3
"""
股市看板 Mac App Logo 生成器
风格：暗夜终端 K 线
- 深墨蓝底 + 网格纹理
- 三根 K 线蜡烛（两红涨一绿跌）
- 赭石辉光强调
- macOS squircle 圆角
"""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# ============ 1. squircle 蒙版（macOS 圆角矩形）============
# macOS 图标用超椭圆，这里用圆角近似
radius = SIZE // 5  # macOS Big Sur+ 风格大圆角
mask = Image.new("L", (SIZE, SIZE), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.rounded_rectangle([0, 0, SIZE-1, SIZE-1], radius=radius, fill=255)

# ============ 2. 深墨蓝底色 + 径向渐变 ============
# 底色 #0d1117（GitHub 深色风），中心略亮
bg = Image.new("RGBA", (SIZE, SIZE), (13, 17, 23, 255))
bdraw = ImageDraw.Draw(bg)
# 径向渐变：中心 #1a1f2e 向边缘 #0d1117
cx, cy = SIZE // 2, SIZE * 2 // 5
for r in range(SIZE, 0, -2):
    t = r / SIZE
    # 中心略亮带赭石暖调
    r_col = int(26 + (13 - 26) * t)
    g_col = int(31 + (17 - 31) * t)
    b_col = int(46 + (23 - 46) * t)
    bdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(r_col, g_col, b_col, 255))

# ============ 3. 微妙网格纹理 ============
grid = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(grid)
grid_color = (184, 92, 31, 10)  # 赭石色低透明度
step = 64
for x in range(0, SIZE, step):
    gdraw.line([x, 0, x, SIZE], fill=grid_color, width=1)
for y in range(0, SIZE, step):
    gdraw.line([0, y, SIZE, y], fill=grid_color, width=1)
# 网格用径向遮罩淡出
grid_mask = Image.new("L", (SIZE, SIZE), 0)
gmdraw = ImageDraw.Draw(grid_mask)
for r in range(SIZE, 0, -4):
    t = 1 - (r / SIZE)
    alpha = int(255 * (t ** 1.5))
    gmdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
grid.putalpha(grid_mask)
bg = Image.alpha_composite(bg, grid)

# ============ 4. 三根 K 线蜡烛 ============
# A 股语义：红涨绿跌。设计为 涨-跌-涨（两红一绿），体现波动
# 蜡烛参数：[x中心, 开盘y, 收盘y, 最高y, 最低y, 涨跌]
candles = [
    # 左：大红涨（实体长，上影短）
    {"x": SIZE * 28 // 100, "open": SIZE * 68 // 100, "close": SIZE * 38 // 100,
     "high": SIZE * 32 // 100, "low": SIZE * 74 // 100, "up": True, "w": SIZE * 7 // 100},
    # 中：绿跌（实体中等，下影长）
    {"x": SIZE * 50 // 100, "open": SIZE * 45 // 100, "close": SIZE * 62 // 100,
     "high": SIZE * 40 // 100, "low": SIZE * 72 // 100, "up": False, "w": SIZE * 7 // 100},
    # 右：大红涨（实体最长，无上影，最强）
    {"x": SIZE * 72 // 100, "open": SIZE * 70 // 100, "close": SIZE * 30 // 100,
     "high": SIZE * 30 // 100, "low": SIZE * 76 // 100, "up": True, "w": SIZE * 7 // 100},
]

# 赭石辉光层（先画大模糊光晕）
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gldraw = ImageDraw.Draw(glow)
for c in candles:
    color = (200, 57, 43) if c["up"] else (30, 122, 82)
    # 大光晕
    gldraw.ellipse([c["x"]-c["w"]*3, c["close"]-c["w"]*3,
                    c["x"]+c["w"]*3, c["low"]+c["w"]*3], fill=color + (60,))
glow = glow.filter(ImageFilter.GaussianBlur(radius=40))
bg = Image.alpha_composite(bg, glow)

# 蜡烛层
candle_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
cdraw = ImageDraw.Draw(candle_layer)
for c in candles:
    color = (200, 57, 43, 255) if c["up"] else (30, 122, 82, 255)
    w = c["w"]
    x = c["x"]
    # 影线（细竖线）
    cdraw.line([x, c["high"], x, c["low"]], fill=color, width=max(3, w // 5))
    # 实体（矩形）
    top = min(c["open"], c["close"])
    bot = max(c["open"], c["close"])
    cdraw.rounded_rectangle([x - w, top, x + w, bot], radius=w // 4, fill=color)
bg = Image.alpha_composite(bg, candle_layer)

# ============ 5. 顶部扫描线高光 ============
scan = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(scan)
# 顶部一道赭石高光
for y in range(SIZE * 12 // 100):
    alpha = int(40 * (1 - y / (SIZE * 12 // 100)))
    sdraw.line([0, y, SIZE, y], fill=(184, 92, 31, alpha))
bg = Image.alpha_composite(bg, scan)

# ============ 6. 应用 squircle 蒙版 ============
bg.putalpha(mask)

# ============ 7. 边缘高光（macOS 玻璃感）============
edge = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
edraw = ImageDraw.Draw(edge)
edraw.rounded_rectangle([0, 0, SIZE-1, SIZE-1], radius=radius, outline=(255, 255, 255, 30), width=2)
# 顶部内高光
edraw.arc([2, 2, SIZE-3, SIZE-3], 200, 340, fill=(255, 255, 255, 50), width=3)
final = Image.alpha_composite(bg, edge)

# ============ 输出 ============
final.save("app/icon_assets/logo_1024.png", "PNG")
print("✓ logo_1024.png 生成完成 (1024x1024)")
print("  设计：深墨蓝底 + 网格纹理 + 两红一绿 K 线 + 赭石辉光")
