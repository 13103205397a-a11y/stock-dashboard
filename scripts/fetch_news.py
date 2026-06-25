#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量抓取自选股新闻+公告 → 规则筛选 → 写回 data.js

流程：
1. 东方财富搜索接口拉新闻资讯（过滤成交额/涨跌快讯）
2. 东方财富公告接口拉公司公告
3. 规则筛选：保留有实质内容的，去重，每只最多 3 条
4. 写回 data.js 的 news + newsAsof 字段

免费、无需密钥、无需 AI 调用，单次 47 只约 60 秒。
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA = os.path.join(PROJ, "data.js")
SEARCH_URL = "https://search-api-web.eastmoney.com/search/jsonp"
ANN_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann"
TODAY = time.strftime("%Y-%m-%d")

# 垃圾新闻：命中丢弃（纯涨跌/成交额/盘面快讯）
GARBAGE_RE = re.compile(
    r"成交额[超达]|换手率|活跃个股|大宗交易.*成交|融资净买入|融资客|北向资金|"
    r"主力资金|净流入|净卖出|龙虎榜|现涨|现跌|盘面.*点评|收涨|收跌|"
    r"涨幅居前|跌幅居前|涨\d+%|跌\d+%|获.*评级$|机构.*评级$|"
    r"沪股通|深股通|陆股通|成交.*亿元$"
)

# 有价值新闻：命中优先保留
VALUABLE_RE = re.compile(
    r"公告|合同|中标|收购|并购|增持|减持|回购|问询|停牌|复牌|"
    r"业绩|净利|营收|分红|送转|投资.*亿|产线|项目|签约|"
    r"突破|量产|验证|送样|供应链|客户|订单|技术|研发|专利|"
    r"回应|澄清|传闻|异动|监管|处罚|退市|ST"
)


def is_garbage(title):
    return bool(GARBAGE_RE.search(title))


def score(title):
    """新闻价值评分，越高越值得保留。"""
    s = 0
    if VALUABLE_RE.search(title):
        s += 10
    if "公告" in title:
        s += 5
    if "回应" in title or "澄清" in title:
        s += 8  # 传闻+回应最有价值
    if is_garbage(title):
        s -= 20
    return s


def load_stocks():
    """读 data.js 的 STOCKS 数组。"""
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
    """原子写回 data.js。"""
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


def fetch_search_news(name):
    """东方财富新闻资讯。"""
    param = json.dumps({
        "uid": "", "keyword": name, "type": ["cmsArticleWebOld"],
        "client": "web", "clientType": "web", "clientVersion": "curr",
        "param": {"cmsArticleWebOld": {
            "searchScope": "default", "sort": "default",
            "pageIndex": 1, "pageSize": 15, "preTag": "", "postTag": "",
        }},
    }, ensure_ascii=False)
    url = SEARCH_URL + "?cb=jQuery&param=" + urllib.parse.quote(param)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://so.eastmoney.com/"})
    out = []
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        m = re.search(r"jQuery\((.*)\)", text)
        if not m:
            return out
        data = json.loads(m.group(1))
        items = data.get("result", {}).get("cmsArticleWebOld", []) or []
        for it in items:
            title = (it.get("title") or "").strip()
            out.append({
                "title": title,
                "date": it.get("date", ""),
                "source": it.get("mediaName", "东方财富"),
                "url": it.get("url", ""),
                "content": (it.get("content") or "").strip()[:200],
            })
    except Exception:
        pass
    return out


def fetch_announcements(code):
    """东方财富公告。"""
    url = f"{ANN_URL}?sr=-1&page_size=5&page_index=1&ann_type=A&client_source=web&stock_list={code}&f_node=0&s_node=0"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"})
    out = []
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        m = re.search(r"\{.*\}", text)
        if not m:
            return out
        data = json.loads(m.group())
        items = data.get("data", {}).get("list", []) or []
        for it in items[:5]:
            title = (it.get("title") or "").strip()
            date = (it.get("notice_date") or "")[:10]
            out.append({
                "title": title, "date": date, "source": "公司公告",
                "url": f"https://np-anotice-stock.eastmoney.com/api/security/ann?stock_list={code}",
                "content": "",
            })
    except Exception:
        pass
    return out


def fetch_one(code, name):
    """合并新闻+公告，去重，规则筛选。"""
    news = fetch_search_news(name)
    anns = fetch_announcements(code)
    # 合并去重
    seen, merged = set(), []
    for n in news + anns:
        t = n["title"]
        if t in seen:
            continue
        seen.add(t)
        merged.append(n)
    # 过滤垃圾 + 评分排序
    scored = [(score(n["title"]), n) for n in merged if not is_garbage(n["title"])]
    scored.sort(key=lambda x: -x[0])
    # 最多 3 条，只要评分 > 0 的
    kept = [n for sc, n in scored if sc > 0][:3]
    # 如果一条有价值的都没有，但原始新闻 > 0，留评分最高的 1 条（哪怕是 0 分）
    if not kept and merged:
        scored_all = [(score(n["title"]), n) for n in merged if not is_garbage(n["title"])]
        scored_all.sort(key=lambda x: -x[0])
        if scored_all:
            kept = [scored_all[0][1]]
    return code, name, kept


def main():
    stocks = load_stocks()
    print(f"开始抓取+筛选 {len(stocks)} 只股票的新闻（并发6）...")
    results = {}
    ok = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {pool.submit(fetch_one, s["code"], s["name"]): s for s in stocks}
        for i, fut in enumerate(as_completed(futs), 1):
            code, name, news = fut.result()
            results[code] = news
            if news:
                ok += 1
            if i % 10 == 0 or i == len(stocks):
                print(f"  进度: {i}/{len(stocks)}（有新闻 {ok}）", flush=True)
    # 写回 data.js
    updated = 0
    total = 0
    for s in stocks:
        c = s["code"]
        if c in results:
            s["news"] = results[c]
            s["newsAsof"] = TODAY
            updated += 1
            total += len(results[c])
    write_stocks(stocks)
    print(f"\n完成：{updated}/{len(stocks)} 只更新，共保留 {total} 条新闻 → data.js")


if __name__ == "__main__":
    main()
