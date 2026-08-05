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
保留最近 MAX_BRIEFS 期（默认 48 期）。
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
from datetime import datetime, timezone
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
    ".gitignore",
    "README.md",
    "active_modules.json",
    "agent/xbrief.md",
    "agent/xbrief-collector.md",
    "app/main.swift",
    "app_server.py",
    "xbriefs.js",
    "kimi_review.js",
    "scripts/push_xbrief.py",
    "scripts/kimi_review.py",
    "scripts/run_grok_xbrief.py",
    "scripts/test_app_server.py",
    "scripts/test_grok_xbrief.py",
    "scripts/test_push_xbrief.py",
    "scripts/test_public_build.py",
    "launchd/com.stockdashboard.grok-xbrief.plist",
    "package.json",
    "index.html",
    "app.js",
    "app_ai_modules.js",
    "styles.css",
    "warm-desk.css",
    "tests/e2e/dashboard.spec.mjs",
    "public_files.json",
]


def now_local() -> datetime:
    return datetime.now().astimezone()


def _empty_xbriefs() -> dict:
    return {"updated": "", "generatedAt": "", "briefs": []}


def load_xbriefs(path: Path, *, strict: bool = False) -> dict:
    """读取一个 xbriefs.js；发布路径使用 strict=True，损坏时拒绝覆盖远端。"""
    if not path.is_file():
        if strict:
            raise ValueError(f"{path}: 文件不存在")
        return _empty_xbriefs()
    text = path.read_text(encoding="utf-8")
    match = re.search(r"window\.XBRIEFS\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not match:
        if strict:
            raise ValueError(f"{path}: 缺少有效 window.XBRIEFS")
        return _empty_xbriefs()
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        if strict:
            raise ValueError(f"{path}: XBRIEFS JSON 无效: {exc}") from exc
        return _empty_xbriefs()
    if not isinstance(data, dict):
        if strict:
            raise ValueError(f"{path}: window.XBRIEFS 必须是对象")
        return _empty_xbriefs()
    briefs = data.get("briefs")
    if not isinstance(briefs, list):
        if strict:
            raise ValueError(f"{path}: XBRIEFS.briefs 必须是数组")
        data["briefs"] = []
    return data


def load_existing() -> dict:
    if not OUT.is_file():
        return {"updated": "", "generatedAt": "", "briefs": []}
    return load_xbriefs(OUT)


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("/", "-")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = datetime.strptime(normalized, "%Y%m%d-%H%M%S")
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _brief_timestamp(brief: dict) -> datetime | None:
    for field in ("time", "generatedAt", "updated"):
        parsed = _parse_timestamp(brief.get(field))
        if parsed is not None:
            return parsed
    return _parse_timestamp(brief.get("id"))


def _brief_key(brief: dict) -> str:
    brief_id = str(brief.get("id") or "").strip()
    if brief_id:
        return f"id:{brief_id}"
    # 兼容早期没有 id 的数据：完全相同的条目会去重，不同正文不会互相覆盖。
    return "legacy:" + json.dumps(brief, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _latest_timestamp_text(local: dict, remote: dict, field: str) -> str:
    candidates = []
    for source_rank, data in ((0, local), (1, remote)):
        value = data.get(field)
        parsed = _parse_timestamp(value)
        if parsed is not None:
            candidates.append((parsed, source_rank, value))
    if candidates:
        return max(candidates)[2]
    # 无法比较时保守保留远端，避免用本机异常字段覆盖公开快照。
    remote_value = remote.get(field)
    if isinstance(remote_value, str) and remote_value:
        return remote_value
    local_value = local.get(field)
    return local_value if isinstance(local_value, str) else ""


def merge_xbriefs(local: dict, remote: dict, *, limit: int = MAX_BRIEFS) -> dict:
    """合并本机候选与最新远端快照；同 id 取时间较新者，时间相同保留远端。"""
    selected: dict[str, tuple[datetime, int, dict]] = {}
    for source_rank, data in ((0, local), (1, remote)):
        for brief in data.get("briefs", []):
            if not isinstance(brief, dict):
                continue
            timestamp = _brief_timestamp(brief) or datetime.min
            key = _brief_key(brief)
            candidate = (timestamp, source_rank, brief)
            current = selected.get(key)
            if current is None or candidate[:2] > current[:2]:
                selected[key] = candidate

    ordered = sorted(
        selected.values(),
        key=lambda item: (item[0], _brief_key(item[2])),
        reverse=True,
    )
    merged = {**remote, **local}
    merged["briefs"] = [dict(item[2]) for item in ordered[:limit]]
    merged["updated"] = _latest_timestamp_text(local, remote, "updated")
    merged["generatedAt"] = _latest_timestamp_text(local, remote, "generatedAt")
    return merged


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


def write_js(data: dict, path: Path = OUT) -> None:
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    body = HEADER + f"window.XBRIEFS = {payload};\n"
    fd, tmp = tempfile.mkstemp(prefix=".xbriefs.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, path)
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


def publish_to_github(
    files: list[str],
    message: str,
    *,
    merge_xbrief: bool = True,
) -> list[str]:
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
                    source = ROOT / name
                    if merge_xbrief and name == "xbriefs.js" and dest.is_file():
                        local_data = load_xbriefs(source, strict=True)
                        remote_data = load_xbriefs(dest, strict=True)
                        write_js(merge_xbriefs(local_data, remote_data), dest)
                    else:
                        shutil.copy2(source, dest)
                # 合并后的快照必须通过当前仓库的完整公开数据契约，才允许进入 main。
                run(["node", "scripts/validate_data.js"], cwd=worktree, check=True)
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
        "warCount": count_section(content, "三、全球战争/地缘")
        or count_section(content, "全球战争/地缘")
        or count_section(content, "全球战争"),
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
            f"feat: 重做每日外围热点 {stamp}",
            merge_xbrief=False,
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
