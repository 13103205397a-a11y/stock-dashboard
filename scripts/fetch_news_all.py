#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新闻全量数据 → 写回 newsall.js (window.NEWSALL)。

采集:
  - 东财全球资讯 7×24(财联社替代)
  - 巨潮公告(沪深北全量,取前 N 条)
走 a-stock-pro 免 key 端点,海外可跑。
"""
import json
import os
import sys
import time
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "newsall.js")
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y-%m-%d")


def sanitize_cjk_brackets(text):
    """修正常见截断导致的中文括号不完整，避免校验门禁误伤。

    规则：
    - 末尾附近未闭合的「（…」视为截断，丢掉残片
    - 更早出现的未闭合「（」补全「）」
    - 「【】」数量不平衡时补全缺失的闭括号
    """
    if not isinstance(text, str) or not text:
        return text
    t = text
    depth = 0
    last_open = -1
    for i, ch in enumerate(t):
        if ch == "（":
            depth += 1
            last_open = i
        elif ch == "）" and depth > 0:
            depth -= 1
    if depth > 0 and last_open >= 0:
        dangling = t[last_open + 1 :]
        # 末尾残片：很短、或几乎没有实质内容 → 视为截断，丢掉「（…」
        # 否则补全闭括号，保留已有正文
        incomplete_tail = (
            len(dangling) <= 8
            or not any(ch.isalnum() or ("\u4e00" <= ch <= "\u9fff") for ch in dangling)
            or (len(dangling) <= 12 and not any(ch in "，。；、,.!？" for ch in dangling))
        )
        if incomplete_tail:
            t = t[:last_open].rstrip("，,、；;：: ")
        else:
            t = t + ("）" * depth)
    square_open = t.count("【")
    square_close = t.count("】")
    if square_open > square_close:
        t = t + ("】" * (square_open - square_close))
    return t


def sanitize_news_item(item):
    if not isinstance(item, dict):
        return item
    out = dict(item)
    for key in ("title", "summary", "content"):
        if key in out and isinstance(out[key], str):
            out[key] = sanitize_cjk_brackets(out[key])
    return out


def safe(fn, *args, default=None, **kw):
    try:
        return fn(*args, **kw)
    except Exception as e:
        print(f"  [WARN] {fn.__name__} 失败: {type(e).__name__}: {str(e)[:60]}", flush=True)
        return default


def main():
    print(f"采集新闻全量数据 ({TODAY})...", flush=True)
    # 1. 全球资讯
    global_news = safe(a.eastmoney_global_news, default=[]) or []
    global_news = [sanitize_news_item(x) for x in global_news]
    print(f"  全球资讯: {len(global_news)} 条", flush=True)
    time.sleep(1)
    # 2. 公告(从自选股里取,每只前 3 条,合并去重)
    announcements = []
    # 复用 data.js 里的自选代码
    data_js = os.path.join(PROJ, "data.js")
    codes = []
    if os.path.exists(data_js):
        import re
        src = open(data_js, encoding="utf-8").read()
        codes = re.findall(r'"code":\s*"(\d{6})"', src)[:20]  # 前 20 只,避免太慢
    for code in codes[:10]:
        anns = safe(a.cninfo_announcements, code, default=[])
        for an in (anns or [])[:2]:
            announcements.append(sanitize_news_item({
                "title": an.get("announcementTitle") or an.get("title", ""),
                "date": str(an.get("announcementTime") or an.get("date", ""))[:10],
                "code": code,
            }))
        time.sleep(0.8)
    # 去重(按标题)
    seen, dedup = set(), []
    for an in announcements:
        if an["title"] and an["title"] not in seen:
            seen.add(an["title"])
            dedup.append(an)
    announcements = dedup[:50]
    if not global_news and not announcements:
        print("✗ 全球资讯和公告均为空，保留旧 newsall.js 不更新。", file=sys.stderr, flush=True)
        return 1
    out = {
        "date": TODAY,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "global": global_news,
        "announcements": announcements,
    }
    content = (
        "/* 新闻全量数据：全球资讯 + 公告\n"
        f" * 由 scripts/fetch_news_all.py 生成（a-stock-pro,免 key）\n"
        f" * 时点: {out['generatedAt']}\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
        "window.NEWSALL = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
    )
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, OUT)
    print(f"完成: 全球资讯{len(global_news)} 公告{len(announcements)} → newsall.js", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
