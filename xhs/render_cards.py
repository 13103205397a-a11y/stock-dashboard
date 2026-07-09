#!/usr/bin/env python3

import hashlib
import json
import os
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "xhs" / "output"
W, H = 1080, 1440
M = 72


PALETTE = {
    "bg": "#101216",
    "bg2": "#171b20",
    "panel": "#f4efe4",
    "panel2": "#e8ddcc",
    "ink": "#15171a",
    "muted": "#6f756f",
    "line": "#343a40",
    "red": "#e34b3f",
    "green": "#20a06b",
    "amber": "#d6a34a",
    "blue": "#5b8def",
    "white": "#f7f2e8",
}


def font(size):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size, index=0)
    return ImageFont.load_default()


FONT_MICRO = font(24)
FONT_META = font(28)
FONT_BADGE = font(30)
FONT_BODY = font(36)
FONT_BODY_SM = font(31)
FONT_TITLE = font(72)
FONT_COVER = font(96)
FONT_NUM = font(92)


def text_box(draw, text, fnt):
    return draw.textbbox((0, 0), str(text), font=fnt)


def text_width(draw, text, fnt):
    box = text_box(draw, text, fnt)
    return box[2] - box[0]


def wrap_text(draw, text, fnt, max_width, max_lines=None):
    lines, current = [], ""
    for ch in str(text or ""):
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


def draw_wrapped(draw, xy, text, fnt, fill, max_width, line_gap=12, max_lines=None):
    x, y = xy
    for line in wrap_text(draw, text, fnt, max_width, max_lines):
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap
    return y


def fit_font(draw, text, start_size, max_width, min_size=46):
    size = start_size
    while size >= min_size:
        trial = font(size)
        if max(text_width(draw, line, trial) for line in wrap_text(draw, text, trial, max_width)) <= max_width:
            return trial
        size -= 4
    return font(min_size)


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))


def make_bg():
    top = hex_to_rgb(PALETTE["bg"])
    bottom = hex_to_rgb("#1e2329")
    img = Image.new("RGB", (W, H), top)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = blend(top, bottom, t)
        for x in range(W):
            noise = ((x * 11 + y * 7) % 13) - 6
            px[x, y] = tuple(max(0, min(255, c + noise)) for c in row)
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 54):
        draw.line((x, 0, x, H), fill="#1d2228", width=1)
    for y in range(0, H, 54):
        draw.line((0, y, W, y), fill="#1d2228", width=1)
    return img


def seed_from(card):
    src = json.dumps(card, ensure_ascii=False, sort_keys=True)
    return int(hashlib.sha1(src.encode("utf-8")).hexdigest()[:10], 16)


def draw_trace(draw, box, seed, color):
    rnd = random.Random(seed)
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    points = []
    value = 0.48
    for i in range(18):
        value += rnd.uniform(-0.13, 0.16)
        value = max(0.12, min(0.88, value))
        x = x1 + int(w * i / 17)
        y = y1 + int(h * (1 - value))
        points.append((x, y))
    for gy in range(4):
        y = y1 + int(h * gy / 3)
        draw.line((x1, y, x2, y), fill="#2a3036", width=1)
    draw.line(points, fill=color, width=5, joint="curve")
    for p in points[-4:]:
        draw.ellipse((p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5), fill=color)


def badge(draw, xy, text, fill, text_fill=None, outline=None):
    x, y = xy
    text = str(text or "")
    pad_x, pad_y = 20, 10
    tw = text_width(draw, text, FONT_BADGE)
    box = (x, y, x + tw + pad_x * 2, y + FONT_BADGE.size + pad_y * 2)
    draw.rounded_rectangle(box, radius=10, fill=fill, outline=outline, width=2 if outline else 1)
    draw.text((x + pad_x, y + pad_y - 2), text, font=FONT_BADGE, fill=text_fill or PALETTE["ink"])
    return box[2]


def draw_header(draw, card, index, total):
    draw.text((M, 46), "ASTOCK RESEARCH NOTE", font=FONT_MICRO, fill="#98a0a8")
    right = card.get("kicker") or ""
    draw.text((W - M - text_width(draw, right, FONT_META), 42), right, font=FONT_META, fill=PALETTE["white"])
    draw.line((M, 94, W - M, 94), fill="#3a4048", width=2)
    draw.text((M, H - 70), "盘后复盘 / 题材观察 / 风险优先", font=FONT_MICRO, fill="#98a0a8")
    page = f"{index:02d}/{total:02d}"
    draw.text((W - M - text_width(draw, page, FONT_META), H - 76), page, font=FONT_META, fill=PALETTE["white"])


def draw_cover(draw, card, index, total):
    draw_header(draw, card, index, total)
    draw.rectangle((M, 136, M + 12, 980), fill=PALETTE["red"])
    badge(draw, (M + 38, 138), card.get("label") or "盘后拆解", PALETTE["red"], "#fff8ef")

    title_font = fit_font(draw, card["title"], 104, W - M * 2 - 32, min_size=70)
    y = draw_wrapped(draw, (M + 38, 250), card["title"], title_font, PALETTE["white"], W - M * 2 - 38, 18, 2)
    y += 26
    y = draw_wrapped(draw, (M + 42, y), card.get("subtitle", ""), FONT_BODY, "#c9d0d6", W - M * 2 - 70, 12, 3)

    chart_box = (M + 42, 650, W - M, 820)
    draw_trace(draw, chart_box, seed_from(card), PALETTE["green"])
    draw.text((M + 42, 842), "intraday sentiment trace / schematic", font=FONT_MICRO, fill="#77808a")

    panel = (M + 38, 910, W - M, 1208)
    draw.rounded_rectangle(panel, radius=24, fill=PALETTE["panel"])
    draw.text((panel[0] + 34, panel[1] + 34), "这张卡只回答一个问题", font=FONT_META, fill=PALETTE["muted"])
    draw_wrapped(draw, (panel[0] + 34, panel[1] + 88), card.get("focus") or "这条线强在哪，风险又藏在哪？",
                 FONT_BODY, PALETTE["ink"], panel[2] - panel[0] - 68, 12, 2)
    draw.line((panel[0] + 34, panel[3] - 58, panel[2] - 34, panel[3] - 58), fill=PALETTE["red"], width=5)

    x = M + 38
    for tag in (card.get("bullets") or [])[:3]:
        x = badge(draw, (x, 1252), tag, "#2a3037", PALETTE["white"], "#4a525c") + 14


def draw_bullet_panel(draw, top, bullet, i):
    x = M + 126
    y = top
    text_x = x + 92
    text_width_limit = (W - M) - text_x - 32
    lines = wrap_text(draw, bullet, FONT_BODY_SM, text_width_limit, 3)
    height = max(118, len(lines) * 43 + 48)
    box = (x, y, W - M, y + height)
    draw.rounded_rectangle(box, radius=18, fill=PALETTE["panel"])
    color = PALETTE["red"] if i == 1 else PALETTE["amber"] if i == 2 else PALETTE["green"]
    draw.rectangle((box[0], box[1], box[0] + 7, box[3]), fill=color)
    draw.text((box[0] + 28, box[1] + 28), f"{i:02d}", font=FONT_META, fill=color)
    line_y = box[1] + 27
    for line in lines:
        draw.text((text_x, line_y), line, font=FONT_BODY_SM, fill=PALETTE["ink"])
        line_y += 43
    return box[3] + 22


def draw_slide(draw, card, index, total):
    draw_header(draw, card, index, total)
    draw.text((M, 146), f"{index:02d}", font=FONT_NUM, fill="#303842")
    badge(draw, (M + 126, 148), card.get("label") or "观察", "#27303a", PALETTE["white"], "#46515e")

    title_font = fit_font(draw, card["title"], 76, W - M * 2 - 126, min_size=54)
    y = draw_wrapped(draw, (M + 126, 236), card["title"], title_font, PALETTE["white"], W - M * 2 - 126, 16, 2)
    verdict = card.get("verdict") or card.get("subtitle") or "只做复盘观察"
    y += 28
    verdict_box = (M + 126, y, W - M, y + 138)
    draw.rounded_rectangle(verdict_box, radius=20, fill="#222932", outline="#3a444f", width=2)
    draw.text((verdict_box[0] + 28, verdict_box[1] + 30), "判断", font=FONT_META, fill=PALETTE["amber"])
    draw_wrapped(draw, (verdict_box[0] + 116, verdict_box[1] + 28), verdict, FONT_BODY_SM, PALETTE["white"],
                 verdict_box[2] - verdict_box[0] - 148, 8, 2)
    y = verdict_box[3] + 38

    bullets = [b for b in (card.get("bullets") or []) if str(b).strip()]
    if not bullets:
        bullets = ["数据不足，先等下一次刷新后再判断。"]
    for i, bullet in enumerate(bullets[:4], start=1):
        y = draw_bullet_panel(draw, y, bullet, i)
        if y > 1110:
            break

    trace_box = (M + 126, 1168, W - M, 1268)
    draw_trace(draw, trace_box, seed_from(card) + index, PALETTE["blue"] if index % 2 else PALETTE["green"])
    draw.text((M + 126, 1288), "not price forecast / visual index only", font=FONT_MICRO, fill="#77808a")


def render_card(card, index, total, out_path):
    img = make_bg()
    draw = ImageDraw.Draw(img)
    if card.get("cover"):
        draw_cover(draw, card, index, total)
    else:
        draw_slide(draw, card, index, total)
    img.save(out_path, quality=96)


def cards_from_plan(plan):
    cards = [
        {
            "kicker": plan["date"],
            "label": plan.get("angle") or "盘后拆解",
            "title": plan["cover"]["headline"],
            "subtitle": plan["cover"]["subline"],
            "focus": "强弱都要落到证据：盘面、资金、产业链、风险。",
            "bullets": plan["cover"]["tags"],
            "cover": True,
        }
    ]
    for idx, slide in enumerate(plan["slides"], start=1):
        cards.append(
            {
                "kicker": plan["date"],
                "label": slide.get("label") or f"图 {idx}",
                "title": slide["title"],
                "subtitle": "不荐股，只做复盘观察" if idx == len(plan["slides"]) else plan["theme"],
                "verdict": slide.get("verdict"),
                "bullets": slide.get("bullets") or [],
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
