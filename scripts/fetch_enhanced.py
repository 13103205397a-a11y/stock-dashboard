#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 a-stock-pro 给自选股补齐 fund(资金流) + research(研报) + valuation(估值) 字段。

这三类数据原本由已删除的 fetch_iwencai.py 维护(fund/research 字段已停在 2026-06-25),
valuation 是全新字段。本脚本用 a-stock-pro 的免 key 端点(东财/腾讯/同花顺)重新填充。

字段映射(与 data.js 既有 schema 兼容):
  fund.netInflow  ← eastmoney_fund_flow_minute 当日主力净(亿元)
  fund.turnover   ← tencent_quote.turnover_pct (换手率%)
  fund.date/asof  ← 今日
  research[]      ← eastmoney_reports {orgSName→org, emRatingName→rating, title, publishDate→date}
  valuation{}     ← full_valuation {pe_ttm, pe_fwd, peg, pb, mcap_yi, eps_cur, eps_next, analyst_count}

依赖: pandas (a-stock-pro 用)。mootdx 在 GitHub Actions 海外机房会超时,本脚本不调用
      需要 mootdx 的函数(tdx_client 等),只用 HTTP 端点,海外可跑。
免 key: 所有用到的端点都不需要 IWENCAI_API_KEY。
"""
import json
import os
import re
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA = os.path.join(PROJ, "data.js")
TODAY = time.strftime("%Y-%m-%d")

# a-stock-pro vendored 在项目内 skills/a-stock-pro/scripts/astock.py
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402


def load_stocks():
    """读 data.js 的 STOCKS 数组(与 fetch_news.py 同模式)。"""
    txt = open(DATA, encoding="utf-8").read()
    start = txt.index("window.STOCKS")
    brace = txt.index("[", start)
    depth, end = 0, brace
    for i in range(brace, len(txt)):
        if txt[i] == "[":
            depth += 1
        elif txt[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return eval(txt[brace:end], {"true": True, "false": False, "null": None})


def write_stocks(stocks):
    """原子写回 data.js(与 fetch_news.py 同模式)。"""
    txt = open(DATA, encoding="utf-8").read()
    start = txt.index("window.STOCKS")
    brace = txt.index("[", start)
    depth, end = 0, brace
    for i in range(brace, len(txt)):
        if txt[i] == "[":
            depth += 1
        elif txt[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    new_txt = txt[:brace] + json.dumps(stocks, ensure_ascii=False, indent=2) + txt[end:]
    tmp = DATA + ".tmp"
    open(tmp, "w", encoding="utf-8").write(new_txt)
    os.replace(tmp, DATA)


def build_fund(code):
    """构造 fund 字段(与原 schema 兼容: netInflow 亿/turnover %/date/asof)。
    资金流优先用 stock_fund_flow_120d(push2his, 历史日级, 不易被风控),
    失败时回退 eastmoney_fund_flow_minute(push2, 分钟级, 易被风控)。"""
    net_inflow = None
    try:
        # 优先:120日日级(走 push2his,实测不被风控)
        flow = a.stock_fund_flow_120d(code)
        if flow:
            main_net_yuan = flow[-1].get("main_net", 0) or 0
            net_inflow = round(main_net_yuan / 1e8, 2) if main_net_yuan else 0
    except Exception:
        net_inflow = None
    # 回退:分钟级(push2,可能被风控)
    if net_inflow is None:
        try:
            flow = a.eastmoney_fund_flow_minute(code)
            if flow:
                main_net_yuan = flow[-1].get("main_net", 0) or 0
                net_inflow = round(main_net_yuan / 1e8, 2) if main_net_yuan else 0
        except Exception:
            net_inflow = None
    try:
        q = a.tencent_quote([code])
        turnover = q[code].get("turnover_pct") if q and code in q else None
    except Exception:
        turnover = None
    return {
        "netInflow": net_inflow,
        "turnover": turnover,
        "date": TODAY,
        "asof": TODAY,
    }


def build_research(code, limit=5):
    """构造 research 字段(与原 schema 兼容: org/rating/title/date)。"""
    try:
        reps = a.eastmoney_reports(code)
    except Exception:
        return []
    if not reps:
        return []
    out = []
    for r in reps[:limit]:
        out.append({
            "org": r.get("orgSName") or r.get("orgName", ""),
            "rating": r.get("emRatingName", ""),
            "title": r.get("title", ""),
            "date": str(r.get("publishDate", ""))[:10],
        })
    return out


def build_valuation(code):
    """构造 valuation 字段(新增,原 schema 没有)。"""
    try:
        fv = a.full_valuation(code)
    except Exception:
        return None
    if not fv or fv.get("error"):
        return None
    return {
        "pe_ttm": fv.get("pe_ttm"),
        "pe_fwd": fv.get("pe_fwd"),
        "peg": fv.get("peg"),
        "pb": fv.get("pb"),
        "mcap_yi": fv.get("mcap_yi"),
        "eps_cur": fv.get("eps_cur"),
        "eps_next": fv.get("eps_next"),
        "analyst_count": fv.get("analyst_count"),
        "asof": TODAY,
    }


def fetch_one(stock):
    """单只票: 并发拉 fund/research/valuation。"""
    code = stock["code"]
    fund = build_fund(code)
    # 研报和估值放一起拉(research 不并发,避免东财限流)
    research = build_research(code, limit=5)
    valuation = build_valuation(code)
    return code, fund, research, valuation


def main():
    stocks = load_stocks()
    print(f"开始用 a-stock-pro 补齐 {len(stocks)} 只股票的 fund/research/valuation...")
    # 并发度 3: 东财有限流,太快会被风控
    results = {}
    ok_fund = ok_research = ok_val = 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(fetch_one, s): s for s in stocks}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                code, fund, research, valuation = fut.result()
                results[code] = (fund, research, valuation)
                if fund.get("netInflow") is not None:
                    ok_fund += 1
                if research:
                    ok_research += 1
                if valuation:
                    ok_val += 1
            except Exception as e:
                print(f"  [WARN] {futs[fut]['code']} 失败: {e}")
            if i % 10 == 0 or i == len(stocks):
                print(f"  进度: {i}/{len(stocks)} (fund {ok_fund}/research {ok_research}/val {ok_val})", flush=True)
    # 写回
    for s in stocks:
        code = s["code"]
        if code in results:
            fund, research, valuation = results[code]
            s["fund"] = fund
            if research:
                s["research"] = research
            if valuation:
                s["valuation"] = valuation
    write_stocks(stocks)
    print(f"\n完成: fund {ok_fund}/{len(stocks)}, research {ok_research}/{len(stocks)}, "
          f"valuation {ok_val}/{len(stocks)} → data.js")


if __name__ == "__main__":
    main()
