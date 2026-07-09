#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""持仓决策数据 → 写回 holdings.js (window.HOLDINGS)。

聚焦德业股份(605117) + 信维通信(300136)两只持仓,采集:
  - 实时行情(价格/涨跌幅/换手)
  - 估值面板(PE/PEG/市值/EPS/机构覆盖)
  - 资金流向(主力净流入)
  - 近期研报(机构/评级/标题/日期)
  - 板块/概念归属
全部走 a-stock-pro 免 key 端点,海外可跑。
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
OUT = os.path.join(PROJ, "holdings.js")
ASTOCK_PATH = os.path.join(PROJ, "skills", "a-stock-pro", "scripts")
sys.path.insert(0, ASTOCK_PATH)
import astock as a  # noqa: E402

TODAY = datetime.now().strftime("%Y-%m-%d")
HOLDING_CODES = ["605117", "300136"]  # 默认持仓，portfolio.json 不存在时回退


def load_portfolio():
    """读取 portfolio.json 持仓配置，回退到默认硬编码列表"""
    pf = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "portfolio.json")
    if os.path.exists(pf):
        try:
            with open(pf, "r", encoding="utf-8") as f:
                data = json.load(f)
            codes = [h["code"] for h in data.get("holdings", []) if h.get("code")]
            if codes:
                print(f"  [portfolio.json] 读取 {len(codes)} 只持仓: {codes}", flush=True)
                return codes
        except Exception as e:
            print(f"  [WARN] portfolio.json 解析失败，回退默认: {e}", flush=True)
    return HOLDING_CODES


def safe(fn, *args, default=None, **kw):
    try:
        return fn(*args, **kw)
    except Exception as e:
        print(f"  [WARN] {fn.__name__} 失败: {type(e).__name__}: {str(e)[:60]}", flush=True)
        return default


def build_one(code):
    """采集单只持仓的全维度数据。"""
    # 1. 实时行情
    q = safe(a.tencent_quote, [code], default={})
    qd = q.get(code, {}) if q else {}
    # 2. 估值
    fv = safe(a.full_valuation, code, default={})
    valuation = None
    if fv and not fv.get("error"):
        valuation = {
            "pe_ttm": fv.get("pe_ttm"),
            "pe_fwd": fv.get("pe_fwd"),
            "peg": fv.get("peg"),
            "pb": fv.get("pb"),
            "mcap_yi": fv.get("mcap_yi"),
            "eps_cur": fv.get("eps_cur"),
            "eps_next": fv.get("eps_next"),
            "analyst_count": fv.get("analyst_count"),
        }
    # 3. 资金流向:优先 120日日级(push2his,不易风控),回退分钟级(push2)
    flow = safe(a.stock_fund_flow_120d, code, default=[])
    if not flow:
        flow = safe(a.eastmoney_fund_flow_minute, code, default=[])
    net_inflow = None
    if flow:
        net_inflow = round((flow[-1].get("main_net", 0) or 0) / 1e8, 2)
    fund = {"netInflow": net_inflow, "turnover": qd.get("turnover_pct"), "date": TODAY}
    # 4. 研报
    reps = safe(a.eastmoney_reports, code, default=[])
    research = []
    for r in (reps or [])[:5]:
        research.append({
            "org": r.get("orgSName") or r.get("orgName", ""),
            "rating": r.get("emRatingName", ""),
            "title": r.get("title", ""),
            "date": str(r.get("publishDate", ""))[:10],
        })
    # 5. 板块归属
    blocks = safe(a.eastmoney_concept_blocks, code, default={})
    concept = (blocks or {}).get("concept_tags", []) if blocks else []
    industry = qd.get("industry") or (concept[0] if concept else "")
    return {
        "code": code,
        "name": qd.get("name", ""),
        "price": qd.get("price"),
        "lastClose": qd.get("last_close"),
        "industry": industry,
        "concept": concept,
        "valuation": valuation,
        "fund": fund,
        "research": research,
    }


def main():
    print(f"采集持仓数据 ({TODAY})...", flush=True)
    time.sleep(1)
    codes = load_portfolio()
    items = []
    for code in codes:
        print(f"  → {code}", flush=True)
        items.append(build_one(code))
        time.sleep(1.2)
    data = {"date": TODAY, "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "list": items}
    content = (
        "/* 持仓决策数据：德业股份 + 信维通信\n"
        f" * 由 scripts/fetch_holdings.py 生成（a-stock-pro,免 key）\n"
        f" * 时点: {data['generatedAt']}\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
        "window.HOLDINGS = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    )
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, OUT)
    for h in items:
        print(f"  {h['name']}({h['code']}) 价{h['price']} PE{(h['valuation'] or {}).get('pe_ttm')} 净{h['fund']['netInflow']}亿", flush=True)
    print(f"完成 → holdings.js", flush=True)


if __name__ == "__main__":
    main()
