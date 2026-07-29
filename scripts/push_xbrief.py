#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将外围热点推送到股市看板 xbriefs.js。

用法：
  # 从标准输入读 markdown
  cat brief.md | python3 scripts/push_xbrief.py

  # 从文件
  python3 scripts/push_xbrief.py --file /tmp/xbrief.md

  # 指定标题/时段
  python3 scripts/push_xbrief.py --file brief.md --title "外围热点" --period "近约2小时"

  # 写入后同步到 GitHub Pages（隔离 worktree，不碰本地未提交改动）
  python3 scripts/push_xbrief.py --file /tmp/xbrief.md --git-push

  # 仅发布 UI + 脚本 + 当前 xbriefs.js（首次上线）
  python3 scripts/push_xbrief.py --bootstrap-git

数据文件：项目根目录 xbriefs.js → window.XBRIEFS
保留最近 MAX_BRIEFS 期（默认 48 期 ≈ 4 天 / 每 2 小时）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "xbriefs.js"
MAX_BRIEFS = 48
MAX_PUBLISH_ATTEMPTS = 3
HEADER = """/* 外围热点（海外 AI + 宏观 + 市场）
 * 由定时任务从 X 抓取筛选后，经 scripts/push_xbrief.py 推送。
 * 时区：Asia/Shanghai。仅供研究参考，非投资建议。
 */
"""

# 日常只同步数据文件；UI 首次上线用 --bootstrap-git
DATA_FILES = ["xbriefs.js"]
BOOTSTRAP_FILES = [
    "xbriefs.js",
    "scripts/push_xbrief.py",
    "index.html",
    "app.js",
    "app_ai_modules.js",
    "styles.css",
    "public_files.json",
]


def now_local() -> datetime:
    return datetime.now().astimezone()


def load_existing() -> dict:
    if not OUT.is_file():
        return {"updated": "", "generatedAt": "", "briefs": []}
    text = OUT.read_text(encoding="utf-8")
    m = re.search(r"window\.XBRIEFS\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        return {"updated": "", "generatedAt": "", "briefs": []}
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return {"updated": "", "generatedAt": "", "briefs": []}
    if not isinstance(data, dict):
        return {"updated": "", "generatedAt": "", "briefs": []}
    briefs = data.get("briefs")
    if not isinstance(briefs, list):
        data["briefs"] = []
    return data


def brief_id(dt: datetime) -> str:
    return dt.strftime("%Y%m%d-%H%M%S")


def count_section(content: str, heading: str) -> int:
    """粗算 markdown 章节下编号条目数量。"""
    pattern = rf"##\s*{re.escape(heading)}.*?(?=##\s|\Z)"
    m = re.search(pattern, content, re.S)
    if not m:
        return 0
    body = m.group(0)
    return len(re.findall(r"^\s*\d+\.\s+", body, re.M))


def has_focus_stock(content: str) -> bool:
    keys = ("德业股份", "605117", "信维通信", "300136")
    return any(k in content for k in keys)


def write_js(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    body = HEADER + f"window.XBRIEFS = {payload};\n"
    fd, tmp = tempfile.mkstemp(prefix=".xbriefs.", suffix=".tmp", dir=str(ROOT))
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


def run(
    command: list[str],
    *,
    cwd: Path = ROOT,
    check: bool = False,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode and result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if check and result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"命令失败: {' '.join(command)}{': ' + detail if detail else ''}"
        )
    return result


def publish_to_github(files: list[str], message: str) -> list[str]:
    """基于最新 origin/main 隔离发布，不触碰当前分支和未提交改动。"""
    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit(f"本地缺少待发布文件: {', '.join(missing)}")

    last_error = None
    for attempt in range(1, MAX_PUBLISH_ATTEMPTS + 1):
        print(f"→ 发布外围热点到 GitHub（第 {attempt}/{MAX_PUBLISH_ATTEMPTS} 次）")
        run(["git", "fetch", "origin", "main"], check=True)
        with tempfile.TemporaryDirectory(prefix="stock-dashboard-xbrief-") as temp:
            worktree = Path(temp) / "repo"
            run(
                ["git", "worktree", "add", "--detach", str(worktree), "origin/main"],
                check=True,
            )
            try:
                for name in files:
                    dest = worktree / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / name, dest)
                changed = run(
                    ["git", "diff", "--name-only", "--", *files],
                    cwd=worktree,
                    check=True,
                ).stdout.splitlines()
                # 新文件不会出现在 diff，用 status 补全
                status = run(
                    ["git", "status", "--porcelain", "--", *files],
                    cwd=worktree,
                    check=True,
                ).stdout.splitlines()
                for line in status:
                    path = line[3:].strip()
                    if path and path not in changed:
                        changed.append(path)
                if not changed:
                    print("✓ 远端外围热点相关文件已是最新，无需发布。")
                    return []
                run(["git", "add", "--", *changed], cwd=worktree, check=True)
                run(
                    [
                        "git",
                        "-c",
                        "user.name=stock-dashboard",
                        "-c",
                        "user.email=stock-dashboard@users.noreply.github.com",
                        "commit",
                        "-m",
                        message,
                    ],
                    cwd=worktree,
                    check=True,
                )
                pushed = run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
                if pushed.returncode == 0:
                    print(f"✓ 已发布到 GitHub: {', '.join(changed)}")
                    return changed
                last_error = pushed.stderr.strip() or "git push 失败"
                print(f"远端在发布期间发生变化，将重试：{last_error}", file=sys.stderr)
            finally:
                run(["git", "worktree", "remove", "--force", str(worktree)])
    raise RuntimeError(f"连续 {MAX_PUBLISH_ATTEMPTS} 次发布失败: {last_error or '未知错误'}")


def push(content: str, *, title: str, period: str, time_str: str | None) -> dict:
    content = (content or "").strip()
    if len(content) < 40:
        raise SystemExit("简报内容太短（至少 40 字），已拒绝写入")

    dt = now_local()
    stamp = time_str or dt.strftime("%Y-%m-%d %H:%M")
    data = load_existing()
    item = {
        "id": brief_id(dt),
        "time": stamp,
        "period": period or "近约2小时",
        "title": title or "外围热点",
        "content": content,
        "aiCount": count_section(content, "一、AI 要闻") or count_section(content, "AI 要闻"),
        "marketCount": count_section(content, "二、股市/财经要闻")
        or count_section(content, "股市/财经要闻")
        or count_section(content, "股市"),
        "hasFocusStock": has_focus_stock(content),
    }
    briefs = [b for b in data.get("briefs", []) if isinstance(b, dict)]
    # 同小时去重：若上一期 id 前 11 位相同则替换
    key = item["id"][:11]
    briefs = [b for b in briefs if str(b.get("id", ""))[:11] != key]
    briefs.insert(0, item)
    data["briefs"] = briefs[:MAX_BRIEFS]
    data["updated"] = stamp
    data["generatedAt"] = stamp
    write_js(data)
    return item


def main() -> int:
    parser = argparse.ArgumentParser(description="推送外围热点到看板")
    parser.add_argument("--file", "-f", help="markdown 文件路径；缺省读 stdin")
    parser.add_argument("--title", default="外围热点")
    parser.add_argument("--period", default="近约2小时")
    parser.add_argument("--time", dest="time_str", default=None, help="覆盖时间戳 YYYY-MM-DD HH:MM")
    parser.add_argument(
        "--git-push",
        action="store_true",
        help="写入后把 xbriefs.js 同步到 GitHub Pages（隔离 worktree）",
    )
    parser.add_argument(
        "--bootstrap-git",
        action="store_true",
        help="首次上线：发布 UI + 脚本 + 当前 xbriefs.js，不读新简报",
    )
    args = parser.parse_args()

    if args.bootstrap_git:
        stamp = now_local().strftime("%Y-%m-%d %H:%M")
        publish_to_github(
            BOOTSTRAP_FILES,
            f"feat: 上线外围热点模块并同步数据 {stamp}",
        )
        print("  线上: https://13103205397a-a11y.github.io/stock-dashboard/#xbrief")
        return 0

    if args.file:
        content = Path(args.file).read_text(encoding="utf-8")
    else:
        if sys.stdin.isatty():
            raise SystemExit("请通过 --file 或管道传入简报 markdown")
        content = sys.stdin.read()

    item = push(content, title=args.title, period=args.period, time_str=args.time_str)
    print(
        f"✓ 已推送看板: {item['title']} · {item['time']}"
        f" · AI{item['aiCount']}/市{item['marketCount']}"
        f" · focus={'Y' if item['hasFocusStock'] else 'N'}"
        f"\n  文件: {OUT}"
        f"\n  打开: http://localhost:8787/index.html#xbrief"
    )

    if args.git_push:
        publish_to_github(
            DATA_FILES,
            f"外围热点更新 {item['time']}",
        )
        print("  线上: https://13103205397a-a11y.github.io/stock-dashboard/#xbrief")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
