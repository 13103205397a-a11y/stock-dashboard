#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用同花顺问财 SkillHub 技能为自选股补充「消息面」数据，合并写回 data.js。

抓取（每只股票）：
  - 主力资金流向 / 换手率   ← hithink-market-query
  - 近 14 天 top3 新闻       ← news-search
  - 最新研报评级/机构        ← report-search

只新增/更新 s.fund / s.news / s.research 三个字段，其余字段（叙事/信号/复盘）原样保留。
技术信号（signal/left/right）由 scripts/fetch_signals.js 负责，本脚本不碰。

依赖：IWENCAI_API_KEY 环境变量；技能目录默认 ../../skills（可用 IWENCAI_SKILLS_DIR 覆盖）。
news-search / report-search 需 requests（report 还需 numpy）；market-query 为纯标准库。
数据来源：同花顺问财（https://www.iwencai.com）。仅供研究参考，非投资建议。
用法： python3 scripts/fetch_iwencai.py
"""
import os
import sys
import json
import time
import re
import subprocess
import tempfile
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA = os.path.join(PROJ, "data.js")


def _resolve_skills():
    # 优先用环境变量；否则优先仓库内 vendored 副本(供 GitHub Actions)，再退回本地同级 skills/
    env = os.environ.get("IWENCAI_SKILLS_DIR")
    if env:
        return os.path.abspath(env)
    vendored = os.path.join(PROJ, "skills")
    if os.path.isdir(os.path.join(vendored, "hithink-market-query")):
        return vendored
    return os.path.abspath(os.path.join(PROJ, "..", "skills"))


SKILLS = _resolve_skills()

NEWS_DAYS = 14
NEWS_N = 3
REPORT_N = 2
TIMEOUT = 40

if not os.environ.get("IWENCAI_API_KEY"):
    print("✗ 缺少 IWENCAI_API_KEY 环境变量，无法调用问财技能。", file=sys.stderr)
    sys.exit(1)


def load_stocks():
    """从 data.js 解析 window.STOCKS（兼容 fetch_signals.js 写出的格式）。"""
    txt = open(DATA, encoding="utf-8").read()
    body = txt.split("window.STOCKS", 1)[1]
    body = body.split("=", 1)[1].strip()
    if body.endswith(";"):
        body = body[:-1]
    return json.loads(body)


def write_stocks(stocks):
    header = (
        "/* 自选股叙事 + 左/右侧策略 + 消息面数据\n"
        " * 技术信号(signal/left/right)由 scripts/fetch_signals.js 计算(腾讯日K)。\n"
        " * 消息面(fund/news/research)由 scripts/fetch_iwencai.py 抓取(同花顺问财)。\n"
        " * 叙事/证伪/增长点等为 AI 整理。仅供研究参考，非投资建议。\n"
        " * 消息面更新：" + dt.date.today().isoformat() + "\n */\n"
    )
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(header + "window.STOCKS = " + json.dumps(stocks, ensure_ascii=False, indent=2) + ";\n")


def run(cmd, timeout=TIMEOUT):
    """运行子进程，返回 stdout 文本（失败返回 None）。"""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=SKILLS)
        return p.stdout
    except Exception:
        return None


def read_json_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ---------------- 主力资金流向 ----------------
def fetch_fund(name):
    cli = os.path.join(SKILLS, "hithink-market-query", "scripts", "cli.py")
    out = run([sys.executable, cli, "--query", f"{name}主力资金流向 换手率"])
    if not out:
        return None
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    rows = d.get("datas") or []
    if not rows:
        return None
    row = rows[0]
    net = None
    turn = None
    date = None
    for k, v in row.items():
        if k.startswith("主力资金流向") and v not in (None, ""):
            try:
                net = round(float(v) / 1e8, 2)  # 元 → 亿元
            except Exception:
                pass
        elif k.startswith("换手率") and v not in (None, ""):
            try:
                turn = round(float(v), 2)
            except Exception:
                pass
        mm = re.search(r"\[(\d{8})\]", k)
        if mm:
            date = mm.group(1)
    if net is None and turn is None:
        return None
    if date:
        date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    return {"netInflow": net, "turnover": turn, "date": date}


# ---------------- 新闻 ----------------
def fetch_news(name):
    main = os.path.join(SKILLS, "news-search", "scripts", "__main__.py")
    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as tf:
        tmp = tf.name
    try:
        run([sys.executable, main, "-q", name, "-f", "json", "-l", str(NEWS_N),
             "-d", str(NEWS_DAYS), "-o", tmp])
        d = read_json_file(tmp)
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
    if not d:
        return []
    items = d if isinstance(d, list) else (d.get("articles") or d.get("results") or [])
    out = []
    for x in items[:NEWS_N]:
        out.append({
            "title": (x.get("title") or "").strip(),
            "date": (x.get("publish_date") or x.get("date") or "")[:16],
            "source": x.get("source") or "",
            "url": x.get("url") or "",
        })
    return [n for n in out if n["title"]]


# ---------------- 研报 ----------------
def fetch_research(name):
    cli = os.path.join(SKILLS, "report-search", "scripts", "cli.py")
    with tempfile.NamedTemporaryFile("r", suffix=".json", delete=False) as tf:
        tmp = tf.name
    try:
        run([sys.executable, cli, "-q", name, "-f", "json", "-l", "6", "-o", tmp])
        d = read_json_file(tmp)
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
    if not d:
        return []
    rows = d if isinstance(d, list) else (d.get("results") or [])
    seen = set()
    out = []
    for x in sorted(rows, key=lambda r: r.get("publish_time", 0), reverse=True):
        ex = x.get("extra", {}) or {}
        org = ex.get("organization") or ""
        title = (x.get("title") or "").strip()
        key = (org, title[:20])
        if key in seen:
            continue
        seen.add(key)
        ts = x.get("publish_time")
        date = ""
        if ts:
            try:
                date = dt.datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d")
            except Exception:
                pass
        out.append({
            "org": org,
            "rating": ex.get("rating") or "",
            "title": title,
            "date": date,
        })
        if len(out) >= REPORT_N:
            break
    return out


def main():
    stocks = load_stocks()
    n = len(stocks)
    today = dt.date.today().isoformat()
    ok_fund = ok_news = ok_rep = 0
    for i, s in enumerate(stocks, 1):
        name = s["name"]
        fund = fetch_fund(name)
        news = fetch_news(name)
        research = fetch_research(name)
        if fund:
            fund["asof"] = today
            s["fund"] = fund
            ok_fund += 1
        if news:
            s["news"] = news
            s["newsAsof"] = today
            ok_news += 1
        if research:
            s["research"] = research
            ok_rep += 1
        nf = f"净流入{fund['netInflow']}亿" if fund and fund.get("netInflow") is not None else "—"
        print(f"[{i:>2}/{n}] {name}  资金:{nf}  新闻:{len(news)}  研报:{len(research)}", flush=True)
        time.sleep(0.2)
    write_stocks(stocks)
    print(f"\n完成：资金流 {ok_fund}/{n} · 新闻 {ok_news}/{n} · 研报 {ok_rep}/{n}（{today}）")


if __name__ == "__main__":
    main()
