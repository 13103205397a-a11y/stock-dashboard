#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拉取自选股日K(TickFlow 免费档,前复权)到 raw/<code>.json
输出格式与原腾讯源 fetch_klines.sh 完全兼容,下游(app.js / fetch_signals.js)零改动。

用法:
  python3 scripts/fetch_klines_tf.py                  # 抓 data.js 全部自选股
  python3 scripts/fetch_klines_tf.py 600206 605117    # 只抓指定代码(测试用)
  python3 scripts/fetch_klines_tf.py --out /tmp/x     # 指定输出目录(测试用,默认 scripts/raw)

数据源: TickFlow 免费服务(无需 API key)。仅供研究参考,非投资建议。
免费档限流 60 次/分钟,脚本已内置节流(sleep)和限流自动重试。
"""
import os
import sys
import json
import time
import argparse
import datetime
import subprocess
from pathlib import Path

try:
    from tickflow import TickFlow
except ImportError:
    print("✗ 未安装 tickflow,请先 pip install tickflow", file=sys.stderr)
    sys.exit(2)
try:
    from tickflow import RateLimitError
except ImportError:
    class RateLimitError(Exception):
        pass

DIR = Path(__file__).resolve().parent
DATA_JS = DIR.parent / "data.js"

# 免费档限流 60 次/分钟:每只之间节流避免触发;触发则等待后自动重试。
THROTTLE_SEC = 1.1
RATELIMIT_WAIT_SEC = 8
MAX_ATTEMPTS = 3


def load_codes():
    """从 data.js 的 window.STOCKS 读代码列表(沿用 fetch_klines.sh 的 node 方式)。"""
    if not DATA_JS.exists():
        print(f"✗ 找不到 data.js: {DATA_JS}", file=sys.stderr)
        sys.exit(1)
    path_js = json.dumps(str(DATA_JS))
    js = 'global.window={};require(' + path_js + ');console.log(window.STOCKS.map(s=>s.code).join(" "))'
    try:
        out = subprocess.check_output(["node", "-e", js], text=True, timeout=15)
    except Exception as e:
        print(f"✗ 读取 data.js 失败: {e}", file=sys.stderr)
        sys.exit(1)
    codes = out.strip().split()
    if len(codes) < 1:
        print("✗ 从 data.js 解析出 0 个股票代码,中止(不会用旧K线静默继续)。", file=sys.stderr)
        sys.exit(1)
    return codes


def market_of(code):
    """市场路由: 6开头=sh, 8/4开头=bj, 其余=sz(与 fetch_klines.sh 一致)。"""
    if code.startswith("6"):
        return "sh"
    if code.startswith("8") or code.startswith("4"):
        return "bj"
    return "sz"


def tf_symbol(code):
    return f"{code}.{market_of(code).upper()}"


def norm_date(d):
    """日期规范化为 YYYY-MM-DD(兼容 '2026-07-24'、'2026-07-24 00:00:00'、'20260724')。"""
    s = str(d)[:10]
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s


def df_to_qfqday(df):
    """TickFlow DataFrame -> 腾讯 qfqday 行 [[date, open, close, high, low, volume], ...]。
    注意腾讯字段顺序: date, open, close, high, low, volume(close 在 high 前)。"""
    rows = []
    for d, o, c, h, l, v in zip(
        df["trade_date"], df["open"], df["close"], df["high"], df["low"], df["volume"]
    ):
        fv = float(v)
        vol_str = str(int(fv)) if fv.is_integer() else str(fv)
        rows.append([norm_date(d), str(o), str(c), str(h), str(l), vol_str])
    return rows


def validate(rows):
    """校验(移植自 fetch_klines.sh): 行数>=20、末尾日期7天内、单日涨跌幅<=30%、过滤未来日期。
    返回 (ok, clean_rows, reason)。"""
    today = datetime.date.today().isoformat()
    week_ago = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
    clean = [p for p in rows if p[0] <= today]
    if len(clean) < 20:
        return False, None, f"行数不足({len(clean)})"
    if clean[-1][0] < week_ago:
        return False, None, "末尾日期过旧(>7天)"
    for i in range(1, len(clean)):
        try:
            prev = float(clean[i - 1][2])
            curr = float(clean[i][2])
        except (ValueError, IndexError):
            return False, None, "价格字段异常"
        if prev > 0 and abs((curr - prev) / prev) > 0.30:
            return False, None, f"单日涨跌幅>30%({clean[i][0]})"
    return True, clean, ""


def write_raw(raw_dir, code, rows):
    """写成腾讯格式 raw/<code>.json,原子替换(先 tmp 再 os.replace)。"""
    key = f"{market_of(code)}{code}"
    obj = {"code": 0, "msg": "", "data": {key: {"qfqday": rows}}}
    tmp = raw_dir / f"{code}.json.tmp"
    dst = raw_dir / f"{code}.json"
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("codes", nargs="*", help="股票代码(不传则读 data.js 全量)")
    ap.add_argument("--out", default=str(DIR / "raw"), help="输出目录(默认 scripts/raw)")
    args = ap.parse_args()

    raw_dir = Path(args.out)
    raw_dir.mkdir(parents=True, exist_ok=True)

    codes = args.codes if args.codes else load_codes()
    print(f"自选股 {len(codes)} 只,开始批量抓取(TickFlow 免费档,前复权日K 330根,batch并发)...")

    tf = TickFlow.free()

    # 清理已删股票的旧K线缓存(仅全量模式 + 默认 raw 目录时,避免误删测试目录)
    if not args.codes and raw_dir == (DIR / "raw"):
        code_set = set(codes)
        removed = 0
        for f in raw_dir.glob("*.json"):
            if f.stem not in code_set:
                f.unlink()
                removed += 1
        if removed:
            print(f"清理 {removed} 个已删股票的旧K线缓存")

    syms = [tf_symbol(c) for c in codes]

    # 一次性批量抓取(免费档 batch 内部并发,47只实测3.7s且不触发 60次/分钟 限流)
    dfs = None
    err = None
    for attempt in range(MAX_ATTEMPTS):  # 整体限流自动重试,最多 MAX_ATTEMPTS 次
        try:
            dfs = tf.klines.batch(syms, period="1d", count=330, adjust="forward",
                                  as_dataframe=True, show_progress=True, max_workers=5)
            err = None
            break
        except RateLimitError as e:
            err = e
            if attempt < MAX_ATTEMPTS - 1:
                print(f"  ⏳ batch 限流,等 {RATELIMIT_WAIT_SEC}s 重试({attempt + 2}/{MAX_ATTEMPTS})...", file=sys.stderr)
                time.sleep(RATELIMIT_WAIT_SEC)
            else:
                break
        except Exception as e:
            err = e
            break
    if err is not None:
        print(f"  ✗ 批量抓取失败: {type(err).__name__}: {err},保留所有旧缓存", file=sys.stderr)
        print(f"K线抓取完成:0/{len(codes)} 只成功")
        print("✗ 失败:批量请求异常(" + type(err).__name__ + ")", file=sys.stderr)
        sys.exit(1)

    ok = 0
    fail = []
    for code in codes:
        sym = tf_symbol(code)
        df = dfs.get(sym)
        if df is None or len(df) == 0:
            fail.append(f"{code}(无数据)")
            print(f"  ✗ {code} 抓取失败:无数据,保留旧缓存")
            continue
        rows = df_to_qfqday(df)
        valid, clean, reason = validate(rows)
        if not valid:
            fail.append(f"{code}({reason})")
            print(f"  ✗ {code} 校验失败: {reason},保留旧缓存")
        else:
            write_raw(raw_dir, code, clean)
            ok += 1
            print(f"  ✓ {code} {len(clean)}根 末:{clean[-1][0]} 收:{clean[-1][2]}")

    print(f"K线抓取完成:{ok}/{len(codes)} 只成功")
    if fail:
        print("✗ 失败:" + " ".join(fail), file=sys.stderr)
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
