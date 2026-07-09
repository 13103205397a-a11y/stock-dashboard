#!/usr/bin/env python3

import json
import os
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "xhs" / "output"
W, H = 1080, 1440


PALETTE = {
    "paper": "#f6f1e7",
    "paper_2": "#efe6d8",
    "ink": "#191714",
    "muted": "#756f66",
    "line": "#d8cbbb",
    "red": "#d9382f",
    "gold": "#b88435",
    "green": "#1f7a5c",
    "deep": "#11100e",
}


def font(size, weight="regular"):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            index = 0
            return ImageFont.truetype(path, size=size, index=index)
    return ImageFont.load_default()


FONT_META = font(28)
FONT_BADGE = font(30)
FONT_COVER = font(104)
FONT_TITLE = font(70)
FONT_VERDICT = font(42)
FONT_BODY = font(38)
FONT_SMALL = font(27)
FONT_FOOT = font(26)


def text_box(draw, text, fnt):
    return draw.textbbox((0, 0), str(text), font=fnt)


def text_width(draw, text, fnt):
    box = text_box(draw, text, fnt)
    return box[2] - box[0]


def fit_font(draw, text, base_font, max_width, min_size=54):
    size = base_font.size
    while size > min_size:
        trial = font(size)
        if max(text_width(draw, line, trial) for line in wrap_text(draw, text, trial, max_width)) <= max_width:
            return trial
        size -= 4
    return font(min_size)


def wrap_text(draw, text, fnt, max_width, max_lines=None):
    lines = []
    current = ""
    for ch in str(text):
        if ch == "\n":
            if current:
                lines.append(current)
            current = ""
            continue
        trial = current + ch
        if text_width(draw, trial, fnt) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip("，。；、 ") + "…"
    return lines


def draw_wrapped(draw, xy, text, fnt, fill, max_width, line_gap=14, max_lines=None):
    x, y = xy
    for line in wrap_text(draw, text, fnt, max_width, max_lines):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap
    return y


def add_paper_texture(img):
    px = img.load()
    for y in range(0, H, 3):
        for x in range(0, W, 3):
            delta = ((x * 17 + y * 13) % 9) - 4
            r, g, b = px[x, y]
            color = (max(0, min(255, r + delta)), max(0, min(255, g + delta)), max(0, min(255, b + delta)))
            for yy in range(y, min(y + 3, H)):
                for xx in range(x, min(x + 3, W)):
                    px[xx, yy] = color


def make_bg(cover=False):
    img = Image.new("RGB", (W, H), PALETTE["paper"])
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 170), fill=PALETTE["deep"] if cover else PALETTE["paper_2"])
    draw.rectangle((0, H - 128, W, H), fill=PALETTE["deep"])
    add_paper_texture(img)
    return img


def pill(draw, xy, text, fill, outline=None, text_fill=None):
    x, y = xy
    pad_x, pad_y = 22, 11
    tw = text_width(draw, text, FONT_BADGE)
    box = (x, y, x + tw + pad_x * 2, y + FONT_BADGE.size + pad_y * 2)
    draw.rounded_rectangle(box, radius=26, fill=fill, outline=outline, width=2 if outline else 1)
    draw.text((x + pad_x, y + pad_y - 1), text, font=FONT_BADGE, fill=text_fill or PALETTE["ink"])
    return box[2]


def draw_header(draw, card, index, total, cover=False):
    left = card.get("kicker") or f"{index:02d}"
    draw.text((72, 58), left, font=FONT_META, fill=PALETTE["paper"] if cover else PALETTE["muted"])
    right = "A股题材看板"
    draw.text((W - 72 - text_width(draw, right, FONT_META), 58), right, font=FONT_META, fill=PALETTE["paper"] if cover else PALETTE["muted"])
    if not cover:
        draw.line((72, 132, W - 72, 132), fill=PALETTE["line"], width=2)
    draw.text((W - 72 - text_width(draw, f"{index}/{total}", FONT_FOOT), H - 78), f"{index}/{total}", font=FONT_FOOT, fill=PALETTE["paper_2"])
    draw.text((72, H - 78), "复盘 / 观察 / 风险", font=FONT_FOOT, fill=PALETTE["paper_2"])


def render_cover(draw, card):
    draw.rectangle((72, 225, 1008, 235), fill=PALETTE["red"])
    pill(draw, (72, 278), "明天别急追", PALETTE["red"], text_fill="#fff7ef")

    title_font = fit_font(draw, card["title"], FONT_COVER, W - 144, min_size=76)
    y = draw_wrapped(draw, (72, 380), card["title"], title_font, PALETTE["ink"], W - 144, 18, max_lines=3)

    y += 36
    draw_wrapped(draw, (76, y), card["subtitle"], FONT_VERDICT, PALETTE["muted"], W - 152, 14, max_lines=2)

    panel = (72, 930, W - 72, 1192)
    draw.rounded_rectangle(panel, radius=22, fill="#fffaf2", outline=PALETTE["line"], width=2)
    draw.text((112, 974), "今天这篇只看一件事", font=FONT_SMALL, fill=PALETTE["muted"])
    draw.text((112, 1026), "热度出来以后，资金还接不接？", font=FONT_VERDICT, fill=PALETTE["ink"])
    draw.rectangle((112, 1115, W - 112, 1121), fill=PALETTE["red"])

    x = 72
    for tag in card["bullets"][:3]:
        x = pill(draw, (x, 1242), tag, "#eadfce", text_fill=PALETTE["ink"]) + 16


def render_slide(draw, card):
    pill(draw, (72, 184), card.get("label") or "观察", "#eadfce", text_fill=PALETTE["ink"])
    title_font = fit_font(draw, card["title"], FONT_TITLE, W - 144, min_size=56)
    y = draw_wrapped(draw, (72, 270), card["title"], title_font, PALETTE["ink"], W - 144, 16, max_lines=2)

    verdict = card.get("verdict") or card.get("subtitle") or "只做复盘观察"
    draw.rounded_rectangle((72, y + 30, W - 72, y + 142), radius=18, fill=PALETTE["deep"])
    draw.text((108, y + 65), "判断", font=FONT_SMALL, fill=PALETTE["gold"])
    draw_wrapped(draw, (202, y + 55), verdict, FONT_VERDICT, "#fff7ef", W - 300, 10, max_lines=1)
    y += 196

    for i, bullet in enumerate(card["bullets"][:4], start=1):
        top = y
        body_lines = wrap_text(draw, bullet, FONT_BODY, W - 250, max_lines=3)
        height = max(112, len(body_lines) * (FONT_BODY.size + 13) + 42)
        draw.rounded_rectangle((72, top, W - 72, top + height), radius=20, fill="#fffaf2", outline=PALETTE["line"], width=2)
        num = f"{i:02d}"
        draw.text((110, top + 38), num, font=FONT_BADGE, fill=PALETTE["red" if i == 1 else "gold"])
        line_y = top + 30
        for line in body_lines:
            draw.text((190, line_y), line, font=FONT_BODY, fill=PALETTE["ink"])
            line_y += FONT_BODY.size + 13
        y += height + 26


def render_card(card, index, total, out_path):
    cover = card.get("cover", False)
    img = make_bg(cover)
    draw = ImageDraw.Draw(img)
    draw_header(draw, card, index, total, cover)

    if cover:
        render_cover(draw, card)
    else:
        render_slide(draw, card)

    img.save(out_path, quality=96)


def cards_from_plan(plan):
    cards = [
        {
            "kicker": plan["date"],
            "title": plan["cover"]["headline"],
            "subtitle": plan["cover"]["subline"],
            "bullets": plan["cover"]["tags"],
            "cover": True,
        }
    ]
    for idx, slide in enumerate(plan["slides"], start=1):
        cards.append(
            {
                "kicker": slide.get("label") or f"图 {idx}",
                "label": slide.get("label") or f"图 {idx}",
                "title": slide["title"],
                "subtitle": "不荐股，只做复盘观察" if idx == len(plan["slides"]) else plan["theme"],
                "verdict": slide.get("verdict"),
                "bullets": slide["bullets"],
            }
        )
    return cards


def main():
    if len(os.sys.argv) > 1:
        json_path = Path(os.sys.argv[1])
    else:
        files = sorted(OUT_DIR.glob("*-xhs.json"))
        if not files:
            raise SystemExit("未找到 xhs/output/*-xhs.json，请先运行 node xhs/generate_xhs.js")
        json_path = files[-1]

    plan = json.loads(json_path.read_text(encoding="utf-8"))
    date = plan.get("date") or json_path.name.split("-xhs.json")[0]
    img_dir = OUT_DIR / f"{date}-cards"
    img_dir.mkdir(parents=True, exist_ok=True)

    cards = cards_from_plan(plan)
    for index, card in enumerate(cards, start=1):
        out_path = img_dir / f"{index:02d}.png"
        render_card(card, index, len(cards), out_path)
        print(out_path)


if __name__ == "__main__":
    main()
