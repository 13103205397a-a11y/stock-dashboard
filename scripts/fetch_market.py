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


def sina_top(sort_field, n=50, asc=0):
    """新浪涨跌幅/换手率 TOP 榜(push2.eastmoney 不通时的 fallback)。
    sort_field: changepercent(涨跌幅) / turnoverratio(换手率) / amount(成交额) / nmc(流通市值)
    asc: 0 降序(最高) / 1 升序(最低)
    返回格式与 market_top 兼容: [{rank, code, name, price, chgPct, turnover, ...}]
    """
    import urllib.request, json
    url = (f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           f"Market_Center.getHQNodeData?page=1&num={n}&sort={sort_field}&asc={asc}"
           f"&node=hs_a&symbol=&_s_r_a=sort")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            items = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [WARN] sina_top({sort_field}) 失败: {e}", flush=True)
        return []
    out = []
    for i, it in enumerate(items, 1):
        out.append({
            "rank": i,
            "code": it.get("code", ""),
            "name": it.get("name", ""),
            "price": float(it.get("trade", 0) or 0),
            "chgPct": round(float(it.get("changepercent", 0) or 0), 2),
            "turnover": round(float(it.get("turnoverratio", 0) or 0), 2),
            "amount": float(it.get("amount", 0) or 0),
            "mcap_yi": round(float(it.get("nmc", 0) or 0) / 1e8, 2),
        })
    return out


def top_with_fallback(em_fn, em_args, sina_sort, sina_asc, n=50, default=None):
    """先试东财 market_top,空了用新浪 fallback。"""
    r = safe(em_fn, *em_args, default=default or [])
    if r and len(r) > 0:
        return r
    print(f"    东财为空,改用新浪...", flush=True)
    return sina_top(sina_sort, n, asc=sina_asc)


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

    # ===== 2. 涨幅/资金流 TOP 榜(东财不通时用新浪 fallback) =====
    print("  [2/4] 涨幅/资金流 TOP 榜...", flush=True)
    market["topGainers"] = top_with_fallback(a.market_top, ("chgPct", 50), "changepercent", 0)
    market["topLosers"] = top_with_fallback(a.market_top, ("chgPct", 50, False), "changepercent", 1)
    market["topTurnover"] = top_with_fallback(a.market_top, ("turnover", 50), "turnoverratio", 0)
    # 资金流新浪没有,只能靠东财(东财不通就空)
    market["topInflow"] = safe(a.market_top, "netInflow", 50, default=[])
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


def validate_market(market):
    """核心行情池必须完整，否则保留上一份 market.js。"""
    minimums = {"topGainers": 10, "topLosers": 10, "topTurnover": 10}
    missing = [f"{key}<{minimum}" for key, minimum in minimums.items()
               if len(market.get(key) or []) < minimum]
    if missing:
        raise ValueError("核心市场数据不足: " + "、".join(missing))


def main():
    print(f"开始全市场异动扫描 ({TODAY_DASH})...", flush=True)
    market = collect_market()
    try:
        validate_market(market)
    except ValueError as e:
        print(f"✗ {e}，保留旧 market.js 不更新。", file=sys.stderr, flush=True)
        return 1
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
