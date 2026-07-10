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
            announcements.append({
                "title": an.get("announcementTitle") or an.get("title", ""),
                "date": str(an.get("announcementTime") or an.get("date", ""))[:10],
                "code": code,
            })
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
