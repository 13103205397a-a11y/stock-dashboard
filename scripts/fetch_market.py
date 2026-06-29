#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全市场异动扫描 → 写回 market.js (window.MARKET)。

用 a-stock-pro 的免 key 端点采集全市场异动,覆盖四类:
  1. 打板情绪池: 涨停/炸板/跌停/昨涨停 + 打板情绪速算
  2. 涨幅/资金流 TOP 榜: 涨幅前50/跌幅前50/换手前50/主力净流入前50/净流出前50
  3. 热度人气榜: 东财人气榜TOP50 + 同花顺热榜 + 当日强势股题材归因
  4. 资金面异动: 全市场龙虎榜 + 北向资金实时

全部走东财/同花顺 HTTP 端点,免 key,海外机房可跑(不调 mootdx)。
输出: market.js → window.MARKET = { date, generatedAt, ... }
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
MARKET_JS = os.path.join(PROJ, "market.js")

# a-stock-pro vendored 在项目内
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y%m%d")
TODAY_DASH = datetime.now().strftime("%Y-%m-%d")


def safe(fn, *args, default=None, **kw):
    """安全调用,失败返回 default + 打印警告(不中断整体)。"""
    try:
        return fn(*args, **kw)
    except Exception as e:
        print(f"  [WARN] {fn.__name__} 失败: {type(e).__name__}: {str(e)[:70]}", flush=True)
        return default


def collect_market():
    """采集全市场异动数据。"""
    market = {
        "date": TODAY_DASH,
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    # ===== 1. 打板情绪池 =====
    print("  [1/4] 打板情绪池...", flush=True)
    market["limitUp"] = safe(a.em_zt_pool, TODAY, default=[])
    market["limitDown"] = safe(a.em_dt_pool, TODAY, default=[])
    market["brokeUp"] = safe(a.em_zb_pool, TODAY, default=[])
    market["yesterday"] = safe(a.em_yzt_pool, TODAY, default=[])
    market["sentiment"] = safe(a.limit_up_sentiment, TODAY, default={})
    time.sleep(1.2)  # 尊重东财限流

    # ===== 2. 涨幅/资金流 TOP 榜 =====
    print("  [2/4] 涨幅/资金流 TOP 榜...", flush=True)
    market["topGainers"] = safe(a.market_top, "chgPct", 50, default=[])
    time.sleep(1.0)
    market["topLosers"] = safe(a.market_top, "chgPct", 50, desc=False, default=[])
    time.sleep(1.0)
    market["topTurnover"] = safe(a.market_top, "turnover", 50, default=[])
    time.sleep(1.0)
    market["topInflow"] = safe(a.market_top, "netInflow", 50, default=[])
    time.sleep(1.0)
    market["topOutflow"] = safe(a.market_top, "netInflow", 50, desc=False, default=[])

    # ===== 3. 热度人气榜 =====
    print("  [3/4] 热度人气榜...", flush=True)
    time.sleep(1.0)
    market["hotRank"] = safe(a.em_hot_rank, 50, default=[])
    time.sleep(1.0)
    market["thsHot"] = safe(a.ths_hot_list, default=[])
    time.sleep(1.0)
    market["thsStrong"] = []
    # ths_hot_reason 返回 DataFrame,转成 list of dict
    try:
        df = a.ths_hot_reason()
        if df is not None and not df.empty:
            # 列名可能是中文,用位置取
            for _, row in df.head(100).iterrows():
                item = {}
                for col in df.columns:
                    v = row.get(col)
                    item[str(col)] = v if not hasattr(v, "item") else v.item()
                market["thsStrong"].append(item)
    except Exception as e:
        print(f"  [WARN] ths_hot_reason 失败: {e}", flush=True)

    # ===== 4. 资金面异动 =====
    print("  [4/4] 资金面异动...", flush=True)
    time.sleep(1.0)
    market["dragonTiger"] = safe(a.daily_dragon_tiger, TODAY_DASH, default={})
    time.sleep(1.0)
    market["northbound"] = None
    try:
        df = a.hsgt_realtime()
        if df is not None and not df.empty:
            # 取最新一行(收盘价) + 整体走势
            latest = df.iloc[-1]
            market["northbound"] = {
                "time": str(latest.get("time", "")),
                "hgt_yi": float(latest.get("hgt_yi", 0)) if latest.get("hgt_yi") is not None else 0,
                "sgt_yi": float(latest.get("sgt_yi", 0)) if latest.get("sgt_yi") is not None else 0,
                "total_yi": (float(latest.get("hgt_yi", 0) or 0) + float(latest.get("sgt_yi", 0) or 0)),
            }
    except Exception as e:
        print(f"  [WARN] hsgt_realtime 失败: {e}", flush=True)

    return market


def write_market_js(market):
    """原子写回 market.js → window.MARKET = {...}"""
    content = (
        "/* 全市场异动扫描数据：涨停/炸板/TOP榜/热度/资金面\n"
        f" * 由 scripts/fetch_market.py 生成（a-stock-pro,免 key）\n"
        f" * 时点: {market.get('generatedAt')}\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
        "window.MARKET = " + json.dumps(market, ensure_ascii=False, indent=2) + ";\n"
    )
    tmp = MARKET_JS + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, MARKET_JS)


def main():
    print(f"开始全市场异动扫描 ({TODAY_DASH})...", flush=True)
    market = collect_market()
    write_market_js(market)
    # 统计
    counts = {
        "涨停": len(market.get("limitUp", [])),
        "炸板": len(market.get("brokeUp", [])),
        "跌停": len(market.get("limitDown", [])),
        "涨幅TOP": len(market.get("topGainers", [])),
        "跌幅TOP": len(market.get("topLosers", [])),
        "换手TOP": len(market.get("topTurnover", [])),
        "流入TOP": len(market.get("topInflow", [])),
        "流出TOP": len(market.get("topOutflow", [])),
        "人气榜": len(market.get("hotRank", [])),
        "强势股": len(market.get("thsStrong", [])),
    }
    nb = market.get("northbound")
    nb_str = f"北向净{nb['total_yi']:.2f}亿" if nb else "北向无"
    print(f"\n完成: {counts} | {nb_str} → market.js", flush=True)


if __name__ == "__main__":
    main()
