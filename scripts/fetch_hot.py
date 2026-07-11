#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日「市场热点 TOP30」模块：按个股热度(人气)取前 30，分析炒作题材/技术面/情绪面。

数据来源：同花顺问财（hithink-astock-selector 取热度榜 + news-search 取催化新闻）。
- 榜单：一个问句取前 30（热度降序），含 涨跌幅/换手/量比/资金流/连板/所属概念/行业/市值。
- 题材：所属概念标签 + 当日最热 1 条新闻标题（点出催化）。
- 技术面/情绪面：基于量价规则生成标签（确定性，无需 LLM）。
输出：写 hot.js → window.HOT = { date, generatedAt, list:[...] }。
依赖：IWENCAI_API_KEY；技能目录优先仓库内 skills/（回退到上级 ../skills/）。
仅供研究参考，非投资建议。用法： python3 scripts/fetch_hot.py
"""
import os
import sys
import re
import json
import time
import ast
import tempfile
import datetime as dt
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
HOT = os.path.join(PROJ, "hot.js")
TOPN = 30
NEWS_DAYS = 3
TIMEOUT = 50


def _resolve_skills():
    env = os.environ.get("IWENCAI_SKILLS_DIR")
    if env:
        return os.path.abspath(env)
    vendored = os.path.join(PROJ, "skills")
    if os.path.isdir(os.path.join(vendored, "hithink-astock-selector")):
        return vendored
    return os.path.abspath(os.path.join(PROJ, "..", "skills"))


SKILLS = _resolve_skills()

if not os.environ.get("IWENCAI_API_KEY"):
    print("✗ 缺少 IWENCAI_API_KEY，无法调用问财技能。", file=sys.stderr)
    sys.exit(1)


def run(cmd, timeout=TIMEOUT):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=SKILLS)
        return p.stdout
    except Exception:
        return None


def num(v):
    try:
        return float(v)
    except Exception:
        return None


def as_list(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str) and v.strip().startswith("["):
        try:
            return list(ast.literal_eval(v))
        except Exception:
            return []
    return []


def field(row, prefix):
    """取形如 '换手率[20260623]' 的带日期后缀字段。"""
    for k, val in row.items():
        if k.startswith(prefix):
            return val
    return None


# ---------------- 取热度榜 TOP30 ----------------
def fetch_top():
    cli = os.path.join(SKILLS, "hithink-astock-selector", "scripts", "cli.py")
    q = ("个股热度从高到低前30名 涨跌幅 换手率 量比 主力资金流向 "
         "连续涨停天数 所属概念 所属同花顺行业 流通市值 上市板块")
    out = run([sys.executable, cli, "--query", q, "--limit", str(TOPN)], timeout=60)
    if not out:
        return []
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return []
    try:
        d = json.loads(m.group(0))
    except Exception:
        return []
    return d.get("datas") or []


# ---------------- 每只取 1 条催化新闻 ----------------
def clean_news_text(value):
    """清掉上游截断造成的半个括号，不补写无法确认的新闻内容。"""
    text = str(value or "").strip()
    for opening, closing in (("（", "）"), ("【", "】")):
        if text.count(opening) > text.count(closing):
            pos = text.rfind(opening)
            if 0 <= pos and len(text) - pos <= 56:
                text = text[:pos].rstrip()
    if "【" not in text and "】" in text:
        text = text.replace("】", "")
    return text


def fetch_one_news(name):
    main = os.path.join(SKILLS, "news-search", "scripts", "__main__.py")
    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as tf:
        tmp = tf.name
    try:
        run([sys.executable, main, "-q", name, "-f", "json", "-l", "2",
             "-d", str(NEWS_DAYS), "-o", tmp], timeout=40)
        try:
            with open(tmp, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            d = None
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
    if not d:
        return []
    items = d if isinstance(d, list) else (d.get("articles") or d.get("results") or [])
    out = []
    for x in items[:2]:
        t = clean_news_text(x.get("title"))
        if t:
            out.append({"title": t, "date": (x.get("publish_date") or "")[:16],
                        "source": x.get("source") or "", "url": x.get("url") or ""})
    return out


# ---------------- 技术面 / 情绪面 规则 ----------------
def tech_tag(chg, boards, vol_ratio, turnover, amplitude):
    chg = chg or 0
    boards = int(boards or 0)
    vr = vol_ratio or 0
    if boards >= 2:
        return f"{boards}连板 · 强势趋势"
    if chg >= 9.8:
        return "涨停 · 多方主导"
    if chg >= 5:
        return "放量大涨" if vr >= 1.5 else "大涨但量能一般"
    if chg <= -5:
        return "高位跳水 · 趋势走坏"
    if chg <= -2:
        return "冲高回落 · 分歧加大"
    if (amplitude or 0) >= 8:
        return "宽幅震荡 · 多空激烈"
    return "横盘整理 · 方向待选"


def senti_tag(chg, net_inflow, turnover, vol_ratio):
    net = net_inflow or 0   # 亿
    turn = turnover or 0
    vr = vol_ratio or 0
    hot = turn >= 8 or vr >= 2
    if net > 0 and chg and chg > 0:
        base = "资金净流入 · 情绪亢奋" if hot else "资金净流入 · 情绪偏暖"
    elif net < 0 and chg and chg > 0:
        base = "涨但主力流出 · 分歧加剧"
    elif net < 0 and chg and chg < 0:
        base = "资金流出 · 情绪转弱"
    elif net > 0 and chg and chg < 0:
        base = "跌但主力回补 · 有承接"
    else:
        base = "情绪中性"
    if turn >= 15:
        base += " · 换手过热"
    return base


def reason_text(concepts, news):
    parts = []
    if concepts:
        parts.append("｜".join(concepts[:3]))
    if news:
        parts.append("催化：" + news[0]["title"])
    return "　".join(parts) if parts else "—"


def main():
    rows = fetch_top()
    if not rows:
        print("⚠ 未取到热度榜数据(可能问财配额耗尽/异常),保留旧 hot.js 不更新。", file=sys.stderr)
        return 1
    today = dt.date.today().isoformat()
    out = []
    for i, r in enumerate(rows[:TOPN], 1):
        code = (r.get("股票代码") or "").split(".")[0]
        name = r.get("股票简称") or ""
        chg = num(r.get("最新涨跌幅"))
        price = num(r.get("最新价"))
        heat = num(field(r, "个股热度"))
        turnover = num(field(r, "换手率"))
        vol_ratio = num(r.get("量比"))
        amplitude = num(field(r, "振幅"))
        net = num(r.get("主力资金流向"))
        net_yi = round(net / 1e8, 2) if net is not None else None
        boards = num(field(r, "连续涨停天数")) or 0
        concepts = as_list(r.get("所属概念"))
        industry = as_list(r.get("所属同花顺行业"))
        board = r.get("上市板块") or ""
        float_cap = num(field(r, "流通市值"))
        float_yi = round(float_cap / 1e8, 1) if float_cap else None

        news = fetch_one_news(name)
        rec = {
            "rank": i,
            "code": code,
            "name": name,
            "price": round(price, 2) if price is not None else None,
            "chgPct": round(chg, 2) if chg is not None else None,
            "heat": int(heat) if heat is not None else None,
            "turnover": round(turnover, 2) if turnover is not None else None,
            "volRatio": round(vol_ratio, 2) if vol_ratio is not None else None,
            "amplitude": round(amplitude, 2) if amplitude is not None else None,
            "netInflow": net_yi,
            "boards": int(boards),
            "concepts": concepts[:6],
            "industry": industry[:2],
            "board": board,
            "floatCap": float_yi,
            "reason": reason_text(concepts, news),
            "news": news,
            "tech": tech_tag(chg, boards, vol_ratio, turnover, amplitude),
            "senti": senti_tag(chg, net_yi, turnover, vol_ratio),
        }
        out.append(rec)
        print(f"[{i:>2}/{TOPN}] {name}({code}) 热度{rec['heat']} {('+' if (chg or 0)>=0 else '')}{rec['chgPct']}% "
              f"{rec['boards']}板 资金{rec['netInflow']}亿 新闻{len(news)}", flush=True)
        time.sleep(0.15)

    payload = {"date": today, "generatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "list": out}
    header = ("/* 市场热点 TOP30（按个股热度/人气排序）\n"
              " * 数据来源：同花顺问财；scripts/fetch_hot.py 每日收盘后生成。\n"
              " * 技术面/情绪面为规则化标签。仅供研究参考，非投资建议。\n */\n")
    content = header + "window.HOT = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    tmp = HOT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, HOT)
    print(f"\n完成：热点 {len(out)} 只 → hot.js（{today}）")


if __name__ == "__main__":
    raise SystemExit(main() or 0)
