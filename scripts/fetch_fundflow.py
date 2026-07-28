#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块资金流向 → fundflow.js (window.FUNDFLOW)

数据源：东方财富 push2delay（免 key）
  - 行业板块主力净流入排行（日累计）
  - 头部板块分钟级资金流（盘中分时曲线，与 vip001 同类）

用法：
  python3 scripts/fetch_fundflow.py
  python3 scripts/fetch_fundflow.py --top 12 --minute 10
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "fundflow.js")
_CN = timezone(timedelta(hours=8))

UT = "b2884a393a59ad64002292a3e90d46a5"
HOSTS = (
    "https://push2delay.eastmoney.com",
    "https://push2.eastmoney.com",
)
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def now_cn() -> datetime:
    return datetime.now(_CN)


def get_json(path: str, timeout: int = 18) -> dict:
    last_err: Exception | None = None
    for host in HOSTS:
        url = host + path
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Referer": "https://data.eastmoney.com/bkzj/hy.html",
                "Accept": "*/*",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
            return json.loads(raw)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.35)
    raise RuntimeError(f"请求失败: {path}: {last_err}")


def clean_name(name: str) -> str:
    """去掉 Ⅱ/Ⅲ 等层级后缀，便于展示去重。"""
    return re.sub(r"[ⅡⅢIVX\d]+$", "", name or "").strip() or (name or "")


def yi(v: Any) -> float:
    try:
        return round(float(v or 0) / 1e8, 2)
    except (TypeError, ValueError):
        return 0.0


def _parse_board_rows(rows: list, seen: set[str]) -> list[dict]:
    out: list[dict] = []
    for it in rows:
        code = str(it.get("f12") or "")
        raw_name = str(it.get("f14") or "")
        name = clean_name(raw_name)
        if not code or not name:
            continue
        if name in seen:
            continue
        # 跳过过细的 Ⅲ 级重复（与 Ⅱ 同资金）
        if "Ⅲ" in raw_name:
            continue
        seen.add(name)
        net = yi(it.get("f62"))
        out.append(
            {
                "code": code,
                "name": name,
                "rawName": raw_name,
                "chgPct": round(float(it.get("f3") or 0), 2)
                if it.get("f3") not in (None, "-")
                else 0.0,
                "netInflowYi": net,
                "netInflowRatio": round(float(it.get("f184") or 0), 2)
                if it.get("f184") not in (None, "-")
                else 0.0,
                "superLargeYi": yi(it.get("f66")),
                "largeYi": yi(it.get("f72")),
                "mediumYi": yi(it.get("f78")),
                "smallYi": yi(it.get("f84")),
                "leadStock": str(it.get("f204") or it.get("f205") or ""),
            }
        )
    return out


def fetch_boards(limit: int = 80) -> list[dict]:
    """行业板块：分别拉流入榜(降序)与流出榜(升序)，再合并去重。"""
    fields = "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124"
    base = (
        "/api/qt/clist/get?pn=1&pz=80&np=1&fltt=2&invt=2&fid=f62"
        f"&fs=m:90+t:2+f:!50&ut={UT}&fields={fields}"
    )
    seen: set[str] = set()
    # po=1 净流入从大到小；po=0 从小到大（流出）——两侧各取，避免全是正数
    desc = (get_json(base + "&po=1").get("data") or {}).get("diff") or []
    asc = (get_json(base + "&po=0").get("data") or {}).get("diff") or []
    out = _parse_board_rows(desc, seen) + _parse_board_rows(asc, seen)
    pos = [b for b in out if b["netInflowYi"] > 0]
    neg = [b for b in out if b["netInflowYi"] < 0]
    pos.sort(key=lambda x: x["netInflowYi"], reverse=True)
    neg.sort(key=lambda x: x["netInflowYi"])  # 最负在前
    half = max(limit // 2, 20)
    merged = pos[:half] + neg[:half]
    merged.sort(key=lambda x: x["netInflowYi"], reverse=True)
    return merged


def fetch_minute(code: str) -> list[dict]:
    """板块分钟资金流。东财返回日累计主力净流入（元）。"""
    path = (
        "/api/qt/stock/fflow/kline/get?"
        f"lmt=0&klt=1&secid=90.{code}&ut={UT}"
        "&fields1=f1,f2,f3,f7"
        "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63"
    )
    data = get_json(path)
    klines = (data.get("data") or {}).get("klines") or []
    points: list[dict] = []
    for line in klines:
        parts = str(line).split(",")
        if len(parts) < 2:
            continue
        ts = parts[0].strip()
        # "2026-07-28 09:31" -> "09:31"
        clock = ts[11:16] if len(ts) >= 16 else ts
        try:
            main = float(parts[1] or 0)
        except ValueError:
            continue
        points.append(
            {
                "t": clock,
                "ts": ts,
                "mainYi": round(main / 1e8, 3),
            }
        )
    return points


def pick_series_boards(boards: list[dict], n: int) -> list[dict]:
    """选曲线板块：优先流出端大户 + 流入端头部，更接近 vip001 对照图。"""
    pos = sorted(
        [b for b in boards if b["netInflowYi"] > 0],
        key=lambda x: x["netInflowYi"],
        reverse=True,
    )
    neg = sorted(
        [b for b in boards if b["netInflowYi"] < 0],
        key=lambda x: x["netInflowYi"],
    )
    # 流出略多，因为暴跌日对照图更需要看到砸出的方向
    n_neg = max(n // 2 + 2, 6)
    n_pos = max(n - n_neg, 3)
    picked: list[dict] = []
    seen: set[str] = set()
    for b in neg[:n_neg] + pos[:n_pos]:
        if b["code"] in seen:
            continue
        seen.add(b["code"])
        picked.append(b)
        if len(picked) >= n:
            break
    # 按 |净流入| 排，图例更直观
    picked.sort(key=lambda x: abs(x["netInflowYi"]), reverse=True)
    return picked


def write_js(payload: dict) -> None:
    body = (
        "/* 板块资金流向（东财，盘中分钟级）\n"
        " * 由 scripts/fetch_fundflow.py 生成。单位：亿元。仅供研究参考。\n"
        " */\n"
        f"window.FUNDFLOW = {json.dumps(payload, ensure_ascii=False, indent=2)};\n"
    )
    fd, tmp = tempfile.mkstemp(prefix=".fundflow.", suffix=".tmp", dir=PROJ)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, OUT)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="抓取板块资金流向")
    parser.add_argument("--top", type=int, default=40, help="排行榜条数")
    parser.add_argument("--minute", type=int, default=12, help="分时曲线板块数")
    args = parser.parse_args()

    stamp = now_cn().strftime("%Y-%m-%d %H:%M:%S")
    date = now_cn().strftime("%Y-%m-%d")
    print(f"→ 板块资金流 {stamp}", flush=True)

    boards_all = fetch_boards(limit=max(args.top, 60))
    if not boards_all:
        print("✗ 未拿到板块排行", file=sys.stderr)
        return 1

    inflow = [b for b in boards_all if b["netInflowYi"] > 0][:15]
    outflow = sorted(
        [b for b in boards_all if b["netInflowYi"] < 0],
        key=lambda x: x["netInflowYi"],
    )[:15]
    boards = sorted(
        inflow[: max(args.top // 2, 12)] + outflow[: max(args.top // 2, 12)],
        key=lambda x: x["netInflowYi"],
        reverse=True,
    )

    series_meta = pick_series_boards(boards_all, args.minute)
    series: list[dict] = []
    for i, b in enumerate(series_meta):
        print(f"  分时 {i + 1}/{len(series_meta)} {b['name']} ({b['code']})...", flush=True)
        try:
            pts = fetch_minute(b["code"])
        except Exception as e:  # noqa: BLE001
            print(f"    [WARN] {b['name']} 分时失败: {e}", flush=True)
            pts = []
        series.append(
            {
                "code": b["code"],
                "name": b["name"],
                "netInflowYi": b["netInflowYi"],
                "chgPct": b["chgPct"],
                "points": pts,
            }
        )
        time.sleep(0.15)

    payload = {
        "date": date,
        "generatedAt": stamp,
        "source": "eastmoney-push2delay",
        "unit": "亿元",
        "note": "主力净流入为日累计；分时曲线取绝对值最大的若干板块。仅供研究参考，非投资建议。",
        "inflow": inflow,
        "outflow": outflow,
        "boards": boards[: args.top],
        "series": series,
    }
    write_js(payload)
    top_in = ", ".join(
        "{}{:+.1f}".format(x["name"], x["netInflowYi"]) for x in inflow[:5]
    )
    top_out = ", ".join(
        "{}{:+.1f}".format(x["name"], x["netInflowYi"]) for x in outflow[:5]
    )
    print("✓ 已写入 {}".format(OUT))
    print("  流入TOP: {}".format(top_in))
    print("  流出TOP: {}".format(top_out))
    print("  分时曲线: {} 条".format(len(series)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
