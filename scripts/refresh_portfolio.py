#!/usr/bin/env python3
"""保存持仓/自选后执行的轻量刷新，不触碰公开看板数据。"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEPS = [
    ("计算自动筛选", ["node", "scripts/fetch_portfolio_signals.js"]),
    ("同步行情/估值", [sys.executable, "scripts/fetch_holdings.py"]),
]

for name, command in STEPS:
    print(f"→ {name}", flush=True)
    result = subprocess.run(command, cwd=ROOT, timeout=180)
    if result.returncode:
        raise SystemExit(result.returncode)
print("✓ 持仓与自选已使用同一交易日数据更新", flush=True)
