#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每天 23:00 调用一次 Grok 只读搜索 X，并由本脚本受控更新外围热点。

Grok 不能运行命令或读写文件；去重、北京时间校验、写入和 GitHub 发布均由
本脚本完成。适合作为 macOS LaunchAgent 的一次性任务，跑完即退出。
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import push_xbrief  # noqa: E402


PROMPT_PATH = ROOT / "agent" / "xbrief-collector.md"
STATE_PATH = ROOT / ".runtime" / "grok-xbrief-state.json"
LOCK_PATH = ROOT / ".grok-xbrief.lock"
GROK_FALLBACK = Path("/Users/Admin/.local/bin/grok")
BEIJING = ZoneInfo("Asia/Shanghai")
INITIAL_LOOKBACK = timedelta(hours=24)
MAX_LOOKBACK = timedelta(hours=26)
OVERLAP = timedelta(minutes=5)
MAX_SEEN_IDS = 2000
X_SNOWFLAKE_EPOCH_MS = 1288834974657

DISALLOWED_TOOLS = ",".join(
    [
        "Agent",
        "run_terminal_cmd",
        "write_file",
        "search_replace",
        "apply_patch",
        "read_file",
        "grep",
        "glob",
        "scheduler_create",
        "scheduler_delete",
        "scheduler_list",
        "monitor",
        "kill_task",
        "get_task_output",
        "search_tool",
        "use_tool",
        "web_search",
        "web_fetch",
    ]
)

OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["newPosts", "noiseZh", "aiConclusionZh", "marketConclusionZh"],
    "properties": {
        "newPosts": {
            "type": "array",
            "maxItems": 10,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "url",
                    "account",
                    "publishedAt",
                    "category",
                    "titleZh",
                    "detailZh",
                    "whyImportantZh",
                    "confidence",
                ],
                "properties": {
                    "url": {"type": "string"},
                    "account": {"type": "string"},
                    "publishedAt": {"type": "string"},
                    "category": {"type": "string", "enum": ["AI", "财经/股市"]},
                    "titleZh": {"type": "string"},
                    "detailZh": {"type": "string"},
                    "whyImportantZh": {"type": "string"},
                    "confidence": {
                        "type": "string",
                        "enum": ["高", "中高", "中", "低"],
                    },
                },
            },
        },
        "noiseZh": {
            "type": "array",
            "maxItems": 3,
            "items": {"type": "string"},
        },
        "aiConclusionZh": {"type": "string"},
        "marketConclusionZh": {"type": "string"},
    },
}

STATUS_RE = re.compile(
    r"https?://(?:www\.)?(?:x\.com|twitter\.com)/([^/?#]+)/status/(\d+)",
    re.I,
)
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def acquire_lock():
    lock_file = LOCK_PATH.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    return lock_file


def empty_state() -> dict:
    return {
        "version": 1,
        "lastCheckedAt": "",
        "lastRunAt": "",
        "lastResult": "never",
        "lastError": "",
        "pendingPublish": False,
        "seenStatusIds": [],
    }


def load_state(path: Path = STATE_PATH) -> dict:
    state = empty_state()
    if not path.is_file():
        return state
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return state
    if isinstance(loaded, dict):
        state.update(loaded)
    if not isinstance(state.get("seenStatusIds"), list):
        state["seenStatusIds"] = []
    return state


def save_state(state: dict, path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix=".grok-xbrief-state.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def parse_iso_utc(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def observation_window(state: dict, current: datetime) -> tuple[datetime, datetime]:
    previous = parse_iso_utc(state.get("lastCheckedAt"))
    if previous is None:
        start = current - INITIAL_LOOKBACK
    else:
        start = previous - OVERLAP
        start = max(start, current - MAX_LOOKBACK)
    return start, current


def status_parts(url: object) -> tuple[str, str] | None:
    if not isinstance(url, str):
        return None
    match = STATUS_RE.search(url.strip())
    if not match:
        return None
    return match.group(1), match.group(2)


def status_published_at(status_id: str) -> datetime | None:
    """从 X/Twitter Snowflake ID 解码权威发布时间。"""
    try:
        numeric_id = int(status_id)
        timestamp_ms = (numeric_id >> 22) + X_SNOWFLAKE_EPOCH_MS
        return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).astimezone(BEIJING)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def existing_status_ids() -> set[str]:
    data = push_xbrief.load_existing()
    found: set[str] = set()
    for brief in data.get("briefs", []):
        if not isinstance(brief, dict):
            continue
        for match in STATUS_RE.finditer(str(brief.get("content") or "")):
            found.add(match.group(2))
    return found


def latest_brief_excerpt() -> str:
    briefs = push_xbrief.load_existing().get("briefs", [])
    if not briefs or not isinstance(briefs[0], dict):
        return "（暂无历史简报）"
    latest = briefs[0]
    content = str(latest.get("content") or "").strip()
    header = f"发布时间：{latest.get('time', '')}\n"
    return (header + content)[:9000]


def build_prompt(template: str, start: datetime, end: datetime, seen_ids: set[str]) -> str:
    start_bj = start.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
    end_bj = end.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
    seen_text = "\n".join(sorted(seen_ids)[-300:]) or "（暂无）"
    return (
        template.replace("{{WINDOW_START_BJ}}", start_bj)
        .replace("{{WINDOW_END_BJ}}", end_bj)
        .replace("{{LATEST_BRIEF}}", latest_brief_excerpt())
        .replace("{{SEEN_STATUS_IDS}}", seen_text)
    )


def grok_binary() -> str:
    configured = os.environ.get("GROK_BIN", "").strip()
    if configured:
        return configured
    discovered = shutil.which("grok")
    if discovered:
        return discovered
    return str(GROK_FALLBACK)


def grok_command(prompt: str) -> list[str]:
    return [
        grok_binary(),
        "--no-subagents",
        "--no-memory",
        "--no-plan",
        "--max-turns",
        "8",
        "--disallowed-tools",
        DISALLOWED_TOOLS,
        "--json-schema",
        json.dumps(OUTPUT_SCHEMA, ensure_ascii=False, separators=(",", ":")),
        "--output-format",
        "json",
        "--single",
        prompt,
    ]


def decode_json_text(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        raise ValueError("Grok 响应缺少结构化 text")
    text = value.strip()
    # Headless agent 每一轮都可能受 json-schema 约束而输出一个对象；经过多轮
    # X 搜索后，CLI 会把这些对象串接到 text。最后一个对象才是最终汇总。
    text = re.sub(r"```(?:json)?", "", text, flags=re.I)
    decoder = json.JSONDecoder()
    parsed_objects: list[dict] = []
    cursor = 0
    while cursor < len(text):
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        if cursor >= len(text):
            break
        if text[cursor] != "{":
            next_object = text.find("{", cursor + 1)
            if next_object < 0:
                break
            cursor = next_object
        try:
            parsed, end = decoder.raw_decode(text, cursor)
        except json.JSONDecodeError:
            cursor += 1
            continue
        if isinstance(parsed, dict):
            parsed_objects.append(parsed)
        cursor = end
    valid = [
        item
        for item in parsed_objects
        if isinstance(item.get("newPosts"), list)
        and isinstance(item.get("noiseZh"), list)
        and isinstance(item.get("aiConclusionZh"), str)
        and isinstance(item.get("marketConclusionZh"), str)
    ]
    if not valid:
        raise ValueError("Grok text 中没有完整的结构化结果")
    return valid[-1]


def run_grok(prompt: str, timeout: int = 600) -> dict:
    env = os.environ.copy()
    env["GROK_DISABLE_AUTOUPDATER"] = "1"
    result = subprocess.run(
        grok_command(prompt),
        cwd=str(ROOT),
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Grok 退出码非 0").strip()
        raise RuntimeError(detail[-1200:])
    outer = json.loads(result.stdout)
    if not isinstance(outer, dict):
        raise ValueError("Grok CLI 输出不是 JSON 对象")
    return decode_json_text(outer.get("text"))


def parse_beijing_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("北京时间", "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(normalized, fmt).replace(tzinfo=BEIJING)
        except ValueError:
            continue
    return None


def clean_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:limit]


def filter_new_posts(
    payload: dict,
    *,
    start: datetime,
    end: datetime,
    seen_ids: set[str],
) -> list[dict]:
    raw_posts = payload.get("newPosts")
    if not isinstance(raw_posts, list):
        raise ValueError("Grok 结果缺少 newPosts 数组")
    selected: list[dict] = []
    selected_ids: set[str] = set()
    category_counts = {"AI": 0, "财经/股市": 0}
    earliest = start.astimezone(BEIJING) - OVERLAP
    latest = end.astimezone(BEIJING) + timedelta(minutes=10)

    for raw in raw_posts:
        if not isinstance(raw, dict):
            continue
        parts = status_parts(raw.get("url"))
        published = status_published_at(parts[1]) if parts is not None else None
        category = raw.get("category")
        if parts is None or published is None or category not in category_counts:
            continue
        url_account, status_id = parts
        if status_id in seen_ids or status_id in selected_ids:
            continue
        if published < earliest or published > latest:
            continue
        if category_counts[category] >= 5:
            continue

        title = clean_text(raw.get("titleZh"), 180)
        detail = clean_text(raw.get("detailZh"), 700)
        importance = clean_text(raw.get("whyImportantZh"), 500)
        if not (
            CHINESE_RE.search(title)
            and CHINESE_RE.search(detail)
            and CHINESE_RE.search(importance)
        ):
            continue
        confidence = raw.get("confidence")
        if confidence not in {"高", "中高", "中", "低"}:
            continue

        selected.append(
            {
                "url": f"https://x.com/{url_account}/status/{status_id}",
                "account": f"@{url_account}",
                "statusId": status_id,
                "publishedAt": published.strftime("%Y-%m-%d %H:%M"),
                "category": category,
                "titleZh": title,
                "detailZh": detail,
                "whyImportantZh": importance,
                "confidence": confidence,
            }
        )
        selected_ids.add(status_id)
        category_counts[category] += 1

    selected.sort(key=lambda item: item["publishedAt"], reverse=True)
    return selected


def period_label(start: datetime, end: datetime, *, compact: bool = False) -> str:
    duration_minutes = max(1, int((end - start).total_seconds() // 60))
    if duration_minutes >= 18 * 60:
        period = "近约 1 天"
    elif duration_minutes <= 105:
        period = "近约 1 小时"
    else:
        period = f"近约 {duration_minutes / 60:.1f} 小时"
    return period.replace(" ", "") if compact else period


def render_markdown(payload: dict, posts: list[dict], start: datetime, end: datetime) -> str:
    period = period_label(start, end)
    end_text = end.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
    lines = [
        "# X 资讯简报 · AI & 股市",
        f"**时段**：{period}（北京时间 {end_text} 前后） | **筛选说明**：仅收录新推文，已剔除情绪帖、喊单、旧闻翻炒和上期重复",
        "",
    ]

    for category, heading in (("AI", "一、AI 要闻"), ("财经/股市", "二、股市/财经要闻")):
        lines.extend([f"## {heading}（最多 5 条）", ""])
        category_posts = [post for post in posts if post["category"] == category]
        if not category_posts:
            lines.extend(["本时段未发现相对上期有增量的高价值推文。", ""])
            continue
        for index, post in enumerate(category_posts, 1):
            lines.extend(
                [
                    f"{index}. **{post['titleZh']}**  ",
                    f"   {post['detailZh']}  ",
                    f"   **为何重要**：{post['whyImportantZh']}  ",
                    f"   **可信度**：{post['confidence']} | **来源**：[{post['account']}]({post['url']}) | **发布时间**：北京时间 {post['publishedAt']}",
                    "",
                ]
            )

    noise = payload.get("noiseZh")
    if isinstance(noise, list):
        noise = [clean_text(item, 260) for item in noise if clean_text(item, 260)]
    else:
        noise = []
    lines.extend(["## 三、噪音观察", ""])
    if noise:
        lines.extend([f"- {item}" for item in noise[:3]])
    else:
        lines.append("- 本时段未记录需要特别提示的高热噪音。")

    ai_conclusion = clean_text(payload.get("aiConclusionZh"), 300)
    market_conclusion = clean_text(payload.get("marketConclusionZh"), 300)
    lines.extend(
        [
            "",
            "## 四、一句话结论",
            "",
            f"- **AI 侧**：{ai_conclusion or '继续等待下一条可核实的新催化。'}",
            f"- **股市侧**：{market_conclusion or '继续观察外围风险偏好与半导体链定价。'}",
        ]
    )
    return "\n".join(lines).strip() + "\n"


def run_refresh(timeout: int = 1800) -> int:
    print("→ 刷新本地行情与研究数据", flush=True)
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "run_refresh.py")],
        cwd=str(ROOT),
        text=True,
        timeout=timeout,
    )
    if result.returncode:
        print(f"⚠ 行情刷新失败，旧数据已保留（退出码 {result.returncode}）", flush=True)
    return result.returncode


def publish_existing_if_needed(state: dict, git_push: bool) -> None:
    if not (git_push and state.get("pendingPublish")):
        return
    print("→ 重试发布上次已写入的外围热点", flush=True)
    push_xbrief.publish_to_github(
        push_xbrief.DATA_FILES,
        f"外围热点补发 {datetime.now(BEIJING).strftime('%Y-%m-%d %H:%M')}",
    )
    state["pendingPublish"] = False


def run_observation(*, git_push: bool, dry_run: bool = False) -> int:
    current = now_utc()
    state = load_state()
    start, end = observation_window(state, current)
    seen_ids = {
        str(item)
        for item in state.get("seenStatusIds", [])
        if isinstance(item, (str, int))
    }
    seen_ids.update(existing_status_ids())

    try:
        publish_existing_if_needed(state, git_push and not dry_run)
    except Exception as exc:
        print(f"⚠ 上次内容仍未发布到 GitHub：{exc}", file=sys.stderr, flush=True)

    template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = build_prompt(template, start, end, seen_ids)
    print(
        "→ Grok 只读观察 X："
        + start.astimezone(BEIJING).strftime("%m-%d %H:%M")
        + "–"
        + end.astimezone(BEIJING).strftime("%H:%M")
        + "（北京时间）",
        flush=True,
    )

    try:
        payload = run_grok(prompt)
        posts = filter_new_posts(payload, start=start, end=end, seen_ids=seen_ids)
        state["lastCheckedAt"] = iso_utc(end)
        state["lastRunAt"] = iso_utc(current)
        state["lastError"] = ""

        if not posts:
            state["lastResult"] = "no-new-posts"
            if not dry_run:
                save_state(state)
            print("✓ 没有新的高价值推文，本轮不生成、不发布简报。", flush=True)
            return 0

        markdown = render_markdown(payload, posts, start, end)
        print(f"→ 发现 {len(posts)} 条新增高价值推文", flush=True)
        if dry_run:
            print(markdown)
            return 0

        item = push_xbrief.push(
            markdown,
            title="外围热点",
            period=period_label(start, end, compact=True),
            time_str=end.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M"),
        )
        state["seenStatusIds"] = (
            list(dict.fromkeys([*state.get("seenStatusIds", []), *[p["statusId"] for p in posts]]))
        )[-MAX_SEEN_IDS:]
        state["lastResult"] = "local-published"

        if git_push:
            try:
                push_xbrief.publish_to_github(
                    push_xbrief.DATA_FILES,
                    f"外围热点更新 {item['time']}",
                )
                state["pendingPublish"] = False
                state["lastResult"] = "published"
            except Exception:
                state["pendingPublish"] = True
                save_state(state)
                raise
        save_state(state)
        print(
            f"✓ 外围热点已更新：AI {item['aiCount']} / 市 {item['marketCount']}"
            + ("，并同步 GitHub" if git_push else "，仅本地"),
            flush=True,
        )
        return 0
    except Exception as exc:
        state["lastRunAt"] = iso_utc(current)
        state["lastResult"] = "error"
        state["lastError"] = clean_text(str(exc), 1200)
        if not dry_run:
            save_state(state)
        print(f"✗ Grok 外围热点任务失败：{exc}", file=sys.stderr, flush=True)
        return 1


def print_status() -> int:
    state = load_state()
    print(json.dumps(state, ensure_ascii=False, indent=2))
    return 0


def check_configuration() -> int:
    missing = [str(path) for path in (PROMPT_PATH, ROOT / "scripts" / "run_refresh.py") if not path.is_file()]
    binary = Path(grok_binary())
    if not binary.is_file():
        missing.append(str(binary))
    if missing:
        print("缺少文件：" + "、".join(missing), file=sys.stderr)
        return 1
    print(f"配置正常：Grok={binary}，LaunchAgent 每天 23:00 运行")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Grok 每天 23:00 X 简报采集与受控发布")
    parser.add_argument("--git-push", action="store_true", help="有新增时同步 xbriefs.js 到 GitHub")
    parser.add_argument("--dry-run", action="store_true", help="执行搜索和筛选，但不写入、不发布、不更新状态")
    parser.add_argument("--skip-refresh", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--status", action="store_true", help="只显示最近运行状态")
    parser.add_argument("--check", action="store_true", help="只检查本机配置")
    args = parser.parse_args()

    if args.status:
        return print_status()
    if args.check:
        return check_configuration()

    lock_file = acquire_lock()
    if lock_file is None:
        print("↷ 上一轮 Grok 观察尚未结束，本轮跳过。")
        return 0
    try:
        observation_code = run_observation(git_push=args.git_push, dry_run=args.dry_run)
        refresh_code = 0 if args.skip_refresh else run_refresh()
        return observation_code or refresh_code
    finally:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
