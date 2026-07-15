#!/usr/bin/env python3
"""保存持仓/自选后刷新行情，并触发 Hermes 持仓综合分析。"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_BIN = os.path.expanduser("~/.local/bin")
# Finder/LaunchServices 启动的 Mac App 不会读取 shell PATH。Node 和 Hermes
# 均由本地 CLI 安装到 ~/.local/bin，因此刷新任务必须自己补全运行环境。
path_entries = os.environ.get("PATH", "").split(os.pathsep)
if LOCAL_BIN not in path_entries:
    os.environ["PATH"] = os.pathsep.join([LOCAL_BIN, *filter(None, path_entries)])
STEPS = [
    ("计算自动筛选", ["node", "scripts/fetch_portfolio_signals.js"]),
    ("同步行情/估值", [sys.executable, "scripts/fetch_holdings.py"]),
]
PORTFOLIO = os.path.join(ROOT, "portfolio.json")
ANALYSIS = os.path.join(ROOT, "portfolio_analysis.js")
HERMES_JOB_ID = os.environ.get("HERMES_PORTFOLIO_JOB_ID", "b10664e5bf63")

for name, command in STEPS:
    print(f"→ {name}", flush=True)
    result = subprocess.run(command, cwd=ROOT, timeout=180)
    if result.returncode:
        raise SystemExit(result.returncode)

with open(PORTFOLIO, encoding="utf-8") as f:
    holdings = json.load(f).get("holdings", []) or []

if holdings:
    print("→ 触发 Hermes 持仓综合分析", flush=True)
    started = time.time()
    result = subprocess.run(["hermes", "cron", "run", HERMES_JOB_ID], cwd=ROOT, timeout=30)
    if result.returncode:
        raise SystemExit(result.returncode)
    expected = {str(item.get("code") or "") for item in holdings}
    deadline = time.time() + 900
    while time.time() < deadline:
        if os.path.exists(ANALYSIS) and os.path.getmtime(ANALYSIS) >= started:
            text = open(ANALYSIS, encoding="utf-8").read()
            if all(f'"code": "{code}"' in text for code in expected) and not any(
                marker in text for marker in ("分析正文", "一句话总结", "100-200字", "字段约束", "示例")
            ):
                print(f"✓ Hermes 已完成 {len(expected)} 只持仓分析", flush=True)
                break
        time.sleep(10)
    else:
        raise SystemExit("Hermes 持仓分析等待超时，配置已保存，稍后可点击刷新筛选重试")
else:
    print("· 当前无持仓，跳过 Hermes 分析", flush=True)

print("✓ 持仓、自选、行情与分析已完成更新", flush=True)
