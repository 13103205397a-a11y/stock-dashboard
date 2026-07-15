#!/usr/bin/env python3
"""将本机 Hermes 成功会话同步到看板，并从隔离 worktree 发布公开模块。"""
from __future__ import annotations

import fcntl
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
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
MAX_PUBLISH_ATTEMPTS = 3


def run(command, *, cwd=ROOT, check=False, timeout=300):
    result = subprocess.run(
        command, cwd=str(cwd), text=True, capture_output=True, timeout=timeout,
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode and result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if check and result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"命令失败: {' '.join(command)}{': ' + detail if detail else ''}")
    return result


def publish_public_files() -> list[str]:
    """基于最新 origin/main 隔离发布，不触碰当前分支和未提交改动。"""
    last_error = None
    for attempt in range(1, MAX_PUBLISH_ATTEMPTS + 1):
        print(f"→ 发布公开 AI 数据（第 {attempt}/{MAX_PUBLISH_ATTEMPTS} 次）")
        run(["git", "fetch", "origin", "main"], check=True)
        with tempfile.TemporaryDirectory(prefix="stock-dashboard-publish-") as temp:
            worktree = Path(temp) / "repo"
            run(["git", "worktree", "add", "--detach", str(worktree), "origin/main"], check=True)
            try:
                for name in PUBLIC_AI_FILES:
                    shutil.copy2(ROOT / name, worktree / name)
                run(["node", "scripts/validate_data.js"], cwd=worktree, check=True)
                changed = run(
                    ["git", "diff", "--name-only", "--", *PUBLIC_AI_FILES], cwd=worktree, check=True,
                ).stdout.splitlines()
                if not changed:
                    print("✓ 远端公开 AI 数据已是最新，无需发布。")
                    return []
                run(["git", "add", "--", *changed], cwd=worktree, check=True)
                stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
                run([
                    "git", "-c", "user.name=stock-dashboard",
                    "-c", "user.email=stock-dashboard@users.noreply.github.com",
                    "commit", "-m", f"AI 数据同步 {stamp}",
                ], cwd=worktree, check=True)
                pushed = run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
                if pushed.returncode == 0:
                    print(f"✓ 已发布 Hermes 数据: {', '.join(changed)}")
                    return changed
                last_error = pushed.stderr.strip() or "git push 失败"
                print(f"远端在发布期间发生变化，将重试：{last_error}", file=sys.stderr)
            finally:
                run(["git", "worktree", "remove", "--force", str(worktree)])
    raise RuntimeError(f"连续 {MAX_PUBLISH_ATTEMPTS} 次发布失败: {last_error or '未知错误'}")


def main():
    with open(LOCK, "w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("已有 Hermes 同步任务运行，跳过。")
            return

        for label, script in EXPORTERS:
            print(f"→ 导出{label}")
            # 单个可选导出器失败时保留旧快照，但发布校验和 push 失败必须报错。
            result = run([sys.executable, script])
            if result.returncode:
                print(f"⚠ {label}导出失败，保留旧快照。", file=sys.stderr)

        print("→ 清理 AI 内部字段与机器化表达")
        run([sys.executable, "scripts/sanitize_ai_content.py"], check=True)
        print("→ 校验公开数据与内容质量")
        run(["node", "scripts/validate_data.js"], check=True)
        # 即使本轮没有新文件变化，也要重试发布本地与远端不一致的公开快照。
        publish_public_files()


if __name__ == "__main__":
    main()
