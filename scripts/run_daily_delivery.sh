#!/usr/bin/env bash
# 每日硬数据刷新（行情/信号）。研究模块（逻辑链/热点/周末）改由任意 Agent 按 agent/ 说明书手写更新。
# 用法：bash scripts/run_daily_delivery.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/bin:${PATH}"

echo "==== $(date '+%F %T') 硬数据刷新 ===="
python3 scripts/run_refresh.py

echo "==== 校验 ===="
python3 scripts/sanitize_ai_content.py || true
node scripts/validate_data.js
node scripts/check_freshness.js --strict --scope=market

echo "==== 完成 $(date '+%F %T') ===="
echo "研究模块请按 agent/logic-chain.md · events-analysis.md · weekend_ferment.md 由 Agent 更新"
echo "本机看板刷新页面即可看到新数据（app_server 每 30 秒自动检测数据版本）"
