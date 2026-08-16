#!/usr/bin/env python3
"""
股市看板 Mac App Logo
白底 · 大写 B · 高级简洁

铺满不透明白底，圆角交给系统 superellipse，避免二次裁切发飘。
字母按真实墨水框几何居中，再做极小光学微调。
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_SIZE = 1024
SCALE = 4
SIZE = OUT_SIZE * SCALE
HERE = Path(__file__).resolve().parent
OUT = HERE / "icon_assets"
OUT.mkdir(parents=True, exist_ok=True)

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_INDEX = 1  # Helvetica Neue Bold
INK = (23, 23, 23, 255)
PAPER = (255, 255, 255, 255)


def load_font(px: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, px, index=FONT_INDEX)
    except OSError:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", px, index=1)


def ink_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    box = img.split()[-1].getbbox()
    if box is None:
        raise RuntimeError("letter B rendered empty")
    return box


def draw_letter_b(size: int) -> Image.Image:
    font = load_font(int(size * 0.56))
    scratch = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(scratch).text(
        (size / 2, size / 2), "B", font=font, fill=INK, anchor="mm"
    )
    left, top, right, bottom = ink_bbox(scratch)
    ink_cx = (left + right) / 2
    ink_cy = (top + bottom) / 2
    # 几何居中后：B 左竖偏重，略向右；大写视觉中心略偏上
    dx = round(size / 2 - ink_cx + size * 0.006)
    dy = round(size / 2 - ink_cy - size * 0.012)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(scratch, (dx, dy), scratch)
    return layer


def compose_master() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), PAPER)
    canvas = Image.alpha_composite(canvas, draw_letter_b(SIZE))
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
