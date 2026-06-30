#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""产业雷达数据 → 写回 industry.js (window.INDUSTRY)。

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
OUT = os.path.join(PROJ, "industry.js")
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y-%m-%d")


def main():
    print(f"采集产业雷达数据 ({TODAY})...", flush=True)
    try:
        data = a.industry_comparison(top_n=30)
    except Exception as e:
        print(f"⚠ 采集产业雷达失败({type(e).__name__}: {e}),保留旧 industry.js 不更新。", flush=True)
        return
    out = {
        "date": TODAY,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "top": data.get("top", []),
        "bottom": data.get("bottom", []),
        "total": data.get("total", 0),
    }
    content = (
        "/* 产业雷达数据：行业板块涨跌排名\n"
        f" * 由 scripts/fetch_industry.py 生成（a-stock-pro,免 key）\n"
        f" * 时点: {out['generatedAt']}\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
        "window.INDUSTRY = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
    )
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, OUT)
    print(f"完成: 涨幅前{len(out['top'])} 跌幅前{len(out['bottom'])} 共{out['total']}行业 → industry.js", flush=True)


if __name__ == "__main__":
    main()
