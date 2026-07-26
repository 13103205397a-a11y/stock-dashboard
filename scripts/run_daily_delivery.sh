#!/usr/bin/env bash
# 每日交付：硬数据全量刷新 → 同步 Hermes 导出 → 发布公开 AI 模块到 GitHub
# 用法：bash scripts/run_daily_delivery.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/bin:${PATH}"
export HERMES_CRON_TIMEOUT="${HERMES_CRON_TIMEOUT:-1800}"

echo "==== $(date '+%F %T') 硬数据刷新 ===="
python3 scripts/run_refresh.py

echo "==== 校验 ===="
python3 scripts/sanitize_ai_content.py
node scripts/validate_data.js
node scripts/check_freshness.js --strict --scope=market   # AI 模块只告警不阻断（与 npm test / Actions 口径一致）

echo "==== 同步发布公开 AI 模块 ===="
python3 scripts/sync_hermes_dashboard.py

echo "==== 完成 $(date '+%F %T') ===="
echo "本机 App 请 Cmd+R 重新加载；GitHub Pages 约 1–3 分钟后更新"
