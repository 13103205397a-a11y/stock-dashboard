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
from collections import defaultdict
from datetime import datetime

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "industry_market.js")
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y-%m-%d")


def fallback_from_market():
    """上游板块接口不可用时，用同次全市场异动快照聚合，避免空白且标明覆盖范围。"""
    path = os.path.join(PROJ, "market.js")
    text = open(path, encoding="utf-8").read()
    marker = "window.MARKET = "
    data = json.loads(text[text.index(marker) + len(marker):].rsplit(";", 1)[0])
    stocks = {}
    for key in ("limitUp", "limitDown", "brokeUp", "yesterday"):
        for row in data.get(key, []):
            industry = row.get("industry")
            change = row.get("pct", row.get("chgPct"))
            if row.get("code") and industry and isinstance(change, (int, float)):
                stocks[row["code"]] = {**row, "change": change}
    groups = defaultdict(list)
    for row in stocks.values():
        groups[row["industry"]].append(row)
    rows = []
    for name, members in groups.items():
        leader = max(members, key=lambda x: x["change"])
        rows.append({
            "name": name,
            "change_pct": round(sum(x["change"] for x in members) / len(members), 2),
            "up_count": sum(x["change"] > 0 for x in members),
            "down_count": sum(x["change"] < 0 for x in members),
            "leader": leader.get("name", ""),
            "sample_count": len(members),
        })
    rows.sort(key=lambda x: x["change_pct"], reverse=True)
    if len(rows) < 5:
        raise ValueError("市场快照行业样本不足")
    for index, row in enumerate(rows, 1):
        row["rank"] = index
    return {
        "top": rows[:15],
        "bottom": sorted(rows[-15:], key=lambda x: x["change_pct"]),
        "total": len(rows),
        "source": "market-snapshot-fallback",
        "coverage": len(stocks),
        "date": data.get("date") or TODAY,
    }


def main():
    print(f"采集产业雷达数据 ({TODAY})...", flush=True)
    try:
        data = a.industry_comparison(top_n=30)
    except Exception as e:
        print(f"⚠ 行业接口失败({type(e).__name__}: {e})，改用同日市场快照聚合。", file=sys.stderr, flush=True)
        try:
            data = fallback_from_market()
        except Exception as fallback_error:
            print(f"✗ 行业回退也失败({fallback_error})，保留旧文件。", file=sys.stderr, flush=True)
            return 1
    top = data.get("top", [])
    bottom = data.get("bottom", [])
    total = data.get("total", 0)
    if not isinstance(top, list) or not isinstance(bottom, list) or not top or not total:
        print("✗ 行业排名结果为空或结构无效，保留旧 industry_market.js 不更新。", file=sys.stderr, flush=True)
        return 1
    out = {
        "schemaVersion": 1,
        "date": data.get("date") or TODAY,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "top": top,
        "bottom": bottom,
        "total": total,
        "source": data.get("source", "eastmoney-industry"),
        "coverage": data.get("coverage"),
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
