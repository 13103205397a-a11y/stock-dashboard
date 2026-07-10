#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""行业板块涨跌排名 → 写回 industry_market.js (window.INDUSTRY_MARKET)。

采集东财全行业板块涨跌排名(~100个行业),含龙头股/涨跌家数。
走 a-stock-pro 的 industry_comparison,免 key,海外可跑。
"""
import json
import os
import sys
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "industry_market.js")
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y-%m-%d")


def main():
    print(f"采集产业雷达数据 ({TODAY})...", flush=True)
    try:
        data = a.industry_comparison(top_n=30)
    except Exception as e:
        print(f"✗ 采集行业排名失败({type(e).__name__}: {e}),保留旧 industry_market.js 不更新。", file=sys.stderr, flush=True)
        return 1
    top = data.get("top", [])
    bottom = data.get("bottom", [])
    total = data.get("total", 0)
    if not isinstance(top, list) or not isinstance(bottom, list) or not top or not total:
        print("✗ 行业排名结果为空或结构无效，保留旧 industry_market.js 不更新。", file=sys.stderr, flush=True)
        return 1
    out = {
        "schemaVersion": 1,
        "date": TODAY,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "top": top,
        "bottom": bottom,
        "total": total,
    }
    content = (
        "/* 产业雷达数据：行业板块涨跌排名\n"
        f" * 由 scripts/fetch_industry.py 生成（a-stock-pro,免 key）\n"
        f" * 时点: {out['generatedAt']}\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
        "window.INDUSTRY_MARKET = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
    )
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, OUT)
    print(f"完成: 涨幅前{len(out['top'])} 跌幅前{len(out['bottom'])} 共{out['total']}行业 → industry_market.js", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
