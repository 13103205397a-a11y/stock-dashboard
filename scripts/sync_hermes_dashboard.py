#!/usr/bin/env python3
"""将本机 Hermes 成功会话同步到当前看板，并发布公开模块。"""
import fcntl
import os
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = "/tmp/stock-dashboard-hermes-sync.lock"
EXPORTERS = [
    ("盘面复盘", "scripts/fetch_hermes.py"),
    ("持仓分析", "scripts/fetch_portfolio_analysis.py"),
    ("周末发酵", "scripts/fetch_weekend.py"),
]
PUBLIC_AI_FILES = [
    "reports.js", "industry.js", "logic.js", "events.js",
    "opportunities.js", "materials.js", "weekend.js",
]


def run(command, check=False):
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=300)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode and result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if check and result.returncode:
        raise RuntimeError(f"命令失败: {' '.join(command)}")
    return result


def main():
    with open(LOCK, "w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("已有 Hermes 同步任务运行，跳过。")
            return

        for label, script in EXPORTERS:
            print(f"→ 导出{label}")
            run([sys.executable, script])

        changed = run(["git", "diff", "--name-only", "--", *PUBLIC_AI_FILES]).stdout.splitlines()
        untracked = run(["git", "ls-files", "--others", "--exclude-standard", "--", *PUBLIC_AI_FILES]).stdout.splitlines()
        files = sorted(set(changed + untracked))
        if not files:
            print("✓ Hermes 数据已同步，无公开文件变化。")
            return

        run(["git", "add", "--", *files], check=True)
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        run([
            "git", "-c", "user.name=stock-dashboard",
            "-c", "user.email=stock-dashboard@users.noreply.github.com",
            "commit", "-m", f"AI 数据同步 {stamp}",
        ], check=True)
        pushed = run(["git", "push", "origin", "main"])
        if pushed.returncode:
            run(["git", "pull", "--rebase", "origin", "main"], check=True)
            run(["git", "push", "origin", "main"], check=True)
        print(f"✓ 已发布 Hermes 数据: {', '.join(files)}")


if __name__ == "__main__":
    main()
