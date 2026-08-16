#!/usr/bin/env python3
"""
股市看板 Mac App Logo
墨底 · 宣纸K线 · 朱红收官

设计：深墨为底，三根蜡烛拾级而上——前两根取看板宣纸色，
末根阳线用看板涨色朱砂红收尾，与 A股盘面 / 研究工作台 同一套色。
铺满不透明底色，圆角交给系统 superellipse，避免二次裁切发飘。
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

OUT_SIZE = 1024
SCALE = 4
SIZE = OUT_SIZE * SCALE
HERE = Path(__file__).resolve().parent
OUT = HERE / "icon_assets"
OUT.mkdir(parents=True, exist_ok=True)

# 与 styles.css 同源：--ink / 纸色 #f3ebe0 / 涨色 --up #c03a2b
INK = (28, 25, 21, 255)        # #1c1915 深墨（比 web 主 ink 略沉，Dock 里更稳）
PAPER = (243, 235, 224, 255)   # #f3ebe0 宣纸
RED = (192, 58, 43, 255)       # #c03a2b 朱砂阳线

# 1024 基准几何：三根蜡烛逐根走高，红烛收官
BODY_W = 112
WICK_W = 26
BODY_R = 22
CANDLES = (
    # cx, body_top, body_bottom, wick_top, wick_bottom, color
    (360, 582, 698, 526, 734, PAPER),
    (512, 486, 602, 430, 638, PAPER),
    (664, 358, 538, 298, 578, RED),
)
SHIFT_Y = -14  # 组合视觉中心微调（略向上）


def rounded(draw: ImageDraw.ImageDraw, box: tuple, r: float, fill: tuple) -> None:
    draw.rounded_rectangle(box, radius=r, fill=fill)


def draw_candles(size: int) -> Image.Image:
    k = size / OUT_SIZE
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for cx, bt, bb, wt, wb, color in CANDLES:
        cx = cx * k
        bt, bb, wt, wb = [(v + SHIFT_Y) * k for v in (bt, bb, wt, wb)]
        bw, ww, br = BODY_W * k, WICK_W * k, BODY_R * k
        # 影线在体下，上下影贯通
        rounded(draw, (cx - ww / 2, wt, cx + ww / 2, wb), ww / 2, color)
        rounded(draw, (cx - bw / 2, bt, cx + bw / 2, bb), br, color)
    return layer


def ink_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    box = img.split()[-1].getbbox()
    if box is None:
        raise RuntimeError("candles rendered empty")
    return box


def compose_master() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), INK)
    canvas = Image.alpha_composite(canvas, draw_candles(SIZE))
    return canvas.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)


def write_icns(png_1024: Path, icns_path: Path) -> None:
    sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    src = Image.open(png_1024).convert("RGBA")
    with tempfile.TemporaryDirectory(prefix="AppIcon.") as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        for name, px in sizes.items():
            src.resize((px, px), Image.Resampling.LANCZOS).save(iconset / name, "PNG")
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(icns_path)],
            check=True,
        )


def main() -> None:
    final = compose_master()
    left, top, right, bottom = ink_bbox(final)
    print(
        f"ink box=({left},{top})-({right},{bottom}) "
        f"cx={(left + right) / 2:.1f} cy={(top + bottom) / 2:.1f} "
        f"center={OUT_SIZE / 2:.1f}"
    )

    png_path = OUT / "logo_1024.png"
    final.save(png_path, "PNG")
    print(f"✓ {png_path.name}")

    for px, name in ((32, "logo_32.png"), (180, "apple-touch-icon.png")):
        final.resize((px, px), Image.Resampling.LANCZOS).save(OUT / name, "PNG")
        print(f"✓ {name}")

    icns_path = OUT / "AppIcon.icns"
    write_icns(png_path, icns_path)
    print(f"✓ {icns_path.name}")

    app_icns = HERE.parent / "股市看板.app" / "Contents" / "Resources" / "AppIcon.icns"
    if app_icns.parent.exists():
        shutil.copy2(icns_path, app_icns)
        app = app_icns.parents[2]
        subprocess.run(["touch", str(app), str(app / "Contents" / "Info.plist")], check=False)
        print(f"✓ 已写入 {app_icns.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
