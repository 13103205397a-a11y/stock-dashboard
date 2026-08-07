#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""外围热点：每 2 小时采集 X，早 8:00 / 晚 23:00 生成精致 HTML 简报。

Grok 仅做只读 X 搜索；去重、北京时间校验、桌面 HTML、看板写入与 GitHub
发布均由本脚本完成。适合作为 macOS LaunchAgent 的一次性任务，跑完即退出。

模式：
  collect          仅采集入库（默认非整点摘要时）
  digest-morning   早报 HTML → ~/Desktop/外围热点/
  digest-evening   晚报 HTML + 看板推送（可选 --git-push）
  auto             按北京时间自动选择（8→早报，23→晚报，其余→采集）
"""
from __future__ import annotations

import argparse
import fcntl
import html
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
INBOX_PATH = ROOT / ".runtime" / "xbrief-inbox.json"
LOCK_PATH = ROOT / ".grok-xbrief.lock"
DESKTOP_DIR = Path.home() / "Desktop" / "外围热点"
GROK_FALLBACK = Path("/Users/Admin/.local/bin/grok")
BEIJING = ZoneInfo("Asia/Shanghai")
INITIAL_LOOKBACK = timedelta(hours=24)
MAX_LOOKBACK = timedelta(hours=26)
MORNING_LOOKBACK = timedelta(hours=14)
EVENING_LOOKBACK = timedelta(hours=16)
OVERLAP = timedelta(minutes=5)
MAX_SEEN_IDS = 2000
MAX_INBOX_POSTS = 200
X_SNOWFLAKE_EPOCH_MS = 1288834974657

CATEGORIES = ("AI", "财经/股市", "全球战争")
CATEGORY_HEADINGS = {
    "AI": "一、AI 要闻",
    "财经/股市": "二、股市/财经要闻",
    "全球战争": "三、全球战争/地缘",
}
CATEGORY_CSS = {
    "AI": "ai",
    "财经/股市": "market",
    "全球战争": "war",
}

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
    "required": [
        "newPosts",
        "noiseZh",
        "aiConclusionZh",
        "marketConclusionZh",
        "warConclusionZh",
    ],
    "properties": {
        "newPosts": {
            "type": "array",
            "maxItems": 12,
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
                    "category": {
                        "type": "string",
                        "enum": ["AI", "财经/股市", "全球战争"],
                    },
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
        "warConclusionZh": {"type": "string"},
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
        "version": 2,
        "lastCheckedAt": "",
        "lastRunAt": "",
        "lastResult": "never",
        "lastError": "",
        "lastMode": "",
        "pendingPublish": False,
        "seenStatusIds": [],
    }


def empty_inbox() -> dict:
    return {
        "version": 1,
        "updatedAt": "",
        "posts": [],
        "noise": [],
        "aiConclusionZh": "",
        "marketConclusionZh": "",
        "warConclusionZh": "",
        "lastMorningDigestAt": "",
        "lastEveningDigestAt": "",
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


def load_inbox(path: Path = INBOX_PATH) -> dict:
    inbox = empty_inbox()
    if not path.is_file():
        return inbox
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return inbox
    if isinstance(loaded, dict):
        inbox.update(loaded)
    if not isinstance(inbox.get("posts"), list):
        inbox["posts"] = []
    if not isinstance(inbox.get("noise"), list):
        inbox["noise"] = []
    return inbox


def save_inbox(inbox: dict, path: Path = INBOX_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(inbox, ensure_ascii=False, indent=2) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix=".xbrief-inbox.", dir=str(path.parent))
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


def observation_window(
    state: dict,
    current: datetime,
    *,
    mode: str,
) -> tuple[datetime, datetime]:
    previous = parse_iso_utc(state.get("lastCheckedAt"))
    if previous is None:
        if mode == "digest-morning":
            start = current - MORNING_LOOKBACK
        elif mode == "digest-evening":
            start = current - EVENING_LOOKBACK
        else:
            start = current - INITIAL_LOOKBACK
    else:
        start = previous - OVERLAP
        cap = MAX_LOOKBACK
        if mode == "digest-morning":
            cap = max(cap, MORNING_LOOKBACK)
        elif mode == "digest-evening":
            cap = max(cap, EVENING_LOOKBACK)
        start = max(start, current - cap)
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
        "10",
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
        and (
            isinstance(item.get("warConclusionZh"), str)
            or "warConclusionZh" not in item
        )
    ]
    if not valid:
        raise ValueError("Grok text 中没有完整的结构化结果")
    result = valid[-1]
    if not isinstance(result.get("warConclusionZh"), str):
        result["warConclusionZh"] = ""
    return result


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
    category_counts = {key: 0 for key in CATEGORIES}
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


def merge_posts_into_inbox(
    inbox: dict,
    posts: list[dict],
    *,
    payload: dict,
    collected_at: datetime,
) -> list[dict]:
    """把新帖并入 inbox，返回实际新增条目。"""
    existing_ids = {
        str(item.get("statusId"))
        for item in inbox.get("posts", [])
        if isinstance(item, dict) and item.get("statusId")
    }
    added: list[dict] = []
    stamp = collected_at.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
    for post in posts:
        sid = post["statusId"]
        if sid in existing_ids:
            continue
        entry = dict(post)
        entry["collectedAt"] = stamp
        added.append(entry)
        existing_ids.add(sid)

    merged = [*added, *[p for p in inbox.get("posts", []) if isinstance(p, dict)]]
    # 按发布时间新→旧，截断
    merged.sort(key=lambda item: str(item.get("publishedAt") or ""), reverse=True)
    inbox["posts"] = merged[:MAX_INBOX_POSTS]
    inbox["updatedAt"] = stamp

    noise = payload.get("noiseZh")
    if isinstance(noise, list):
        cleaned = [clean_text(item, 260) for item in noise if clean_text(item, 260)]
        if cleaned:
            inbox["noise"] = cleaned[:3]
    for key in ("aiConclusionZh", "marketConclusionZh", "warConclusionZh"):
        value = clean_text(payload.get(key), 300)
        if value:
            inbox[key] = value
    return added


def _title_fingerprint(title: object) -> str:
    """粗粒度标题指纹，用于摘要去重（去掉空白/标点后取前 24 字）。"""
    text = re.sub(r"[\s\W_]+", "", str(title or ""), flags=re.U)
    return text[:24]


def posts_for_digest(inbox: dict, *, since: datetime | None, end: datetime) -> list[dict]:
    """从 inbox 取出摘要窗口内的帖子（按类限 5 条，标题近似去重）。"""
    end_bj = end.astimezone(BEIJING)
    since_bj = since.astimezone(BEIJING) if since else end_bj - timedelta(hours=24)
    selected: list[dict] = []
    counts = {key: 0 for key in CATEGORIES}
    seen_titles: set[str] = set()
    # 先按发布时间新→旧，保证每类优先最新
    ordered = sorted(
        [p for p in inbox.get("posts", []) if isinstance(p, dict)],
        key=lambda item: str(item.get("publishedAt") or ""),
        reverse=True,
    )
    for post in ordered:
        category = post.get("category")
        if category not in counts or counts[category] >= 5:
            continue
        published = parse_beijing_time(post.get("publishedAt"))
        if published is None:
            continue
        if published < since_bj - OVERLAP or published > end_bj + timedelta(minutes=10):
            continue
        fingerprint = _title_fingerprint(post.get("titleZh"))
        if fingerprint and fingerprint in seen_titles:
            continue
        if fingerprint:
            seen_titles.add(fingerprint)
        selected.append(post)
        counts[category] += 1
    return selected


def count_by_category(posts: list[dict]) -> dict[str, int]:
    counts = {key: 0 for key in CATEGORIES}
    for post in posts:
        cat = post.get("category")
        if cat in counts:
            counts[cat] += 1
    return counts


def render_markdown(
    payload: dict,
    posts: list[dict],
    start: datetime,
    end: datetime,
    *,
    title: str = "X 资讯简报 · AI · 股市 · 地缘",
) -> str:
    period = period_label(start, end)
    end_text = end.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# {title}",
        f"**时段**：{period}（北京时间 {end_text} 前后） | **筛选说明**：仅收录新推文，已剔除情绪帖、喊单、旧闻翻炒和上期重复",
        "",
    ]

    for category, heading in CATEGORY_HEADINGS.items():
        lines.extend([f"## {heading}（最多 5 条）", ""])
        category_posts = [post for post in posts if post.get("category") == category]
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
    lines.extend(["## 四、噪音观察", ""])
    if noise:
        lines.extend([f"- {item}" for item in noise[:3]])
    else:
        lines.append("- 本时段未记录需要特别提示的高热噪音。")

    ai_conclusion = clean_text(payload.get("aiConclusionZh"), 300)
    market_conclusion = clean_text(payload.get("marketConclusionZh"), 300)
    war_conclusion = clean_text(payload.get("warConclusionZh"), 300)
    lines.extend(
        [
            "",
            "## 五、一句话结论",
            "",
            f"- **AI 侧**：{ai_conclusion or '继续等待下一条可核实的新催化。'}",
            f"- **股市侧**：{market_conclusion or '继续观察外围风险偏好与半导体链定价。'}",
            f"- **地缘侧**：{war_conclusion or '继续跟踪可核实的冲突与制裁进展。'}",
        ]
    )
    return "\n".join(lines).strip() + "\n"


def _esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def render_html(
    *,
    posts: list[dict],
    payload: dict,
    start: datetime,
    end: datetime,
    mode: str,
) -> str:
    """精致排版的中文 HTML 简报。"""
    is_morning = mode == "digest-morning"
    label = "早报" if is_morning else "晚报" if mode == "digest-evening" else "快报"
    end_bj = end.astimezone(BEIJING)
    start_bj = start.astimezone(BEIJING)
    period = period_label(start, end)
    stamp = end_bj.strftime("%Y-%m-%d %H:%M")
    date_cn = end_bj.strftime("%Y年%m月%d日")
    counts = count_by_category(posts)
    total = len(posts)

    noise = payload.get("noiseZh")
    if isinstance(noise, list):
        noise_items = [clean_text(item, 260) for item in noise if clean_text(item, 260)]
    else:
        noise_items = []

    conclusions = [
        ("AI", clean_text(payload.get("aiConclusionZh"), 300) or "继续等待可核实的新催化。"),
        ("股市", clean_text(payload.get("marketConclusionZh"), 300) or "继续观察外围风险偏好。"),
        ("地缘", clean_text(payload.get("warConclusionZh"), 300) or "继续跟踪可核实冲突与制裁。"),
    ]

    sections_html: list[str] = []
    for category, heading in CATEGORY_HEADINGS.items():
        css = CATEGORY_CSS[category]
        cat_posts = [p for p in posts if p.get("category") == category]
        cards: list[str] = []
        if not cat_posts:
            cards.append(
                '<div class="empty">本时段未发现高价值增量。</div>'
            )
        else:
            for index, post in enumerate(cat_posts, 1):
                conf = _esc(post.get("confidence"))
                conf_class = {
                    "高": "high",
                    "中高": "midhigh",
                    "中": "mid",
                    "低": "low",
                }.get(str(post.get("confidence")), "mid")
                cards.append(
                    f"""
            <article class="card">
              <div class="card-top">
                <span class="idx">{index:02d}</span>
                <span class="conf conf-{conf_class}">可信度 {conf}</span>
              </div>
              <h3>{_esc(post.get('titleZh'))}</h3>
              <p class="detail">{_esc(post.get('detailZh'))}</p>
              <p class="why"><strong>为何重要</strong> {_esc(post.get('whyImportantZh'))}</p>
              <div class="meta">
                <a href="{_esc(post.get('url'))}" target="_blank" rel="noopener">{_esc(post.get('account'))}</a>
                <span>北京时间 {_esc(post.get('publishedAt'))}</span>
              </div>
            </article>"""
                )
        sections_html.append(
            f"""
      <section class="section section-{css}">
        <header class="section-head">
          <h2>{_esc(heading)}</h2>
          <span class="badge">{len(cat_posts)} 条</span>
        </header>
        <div class="cards">
          {''.join(cards)}
        </div>
      </section>"""
        )

    noise_html = (
        "".join(f"<li>{_esc(item)}</li>" for item in noise_items[:3])
        if noise_items
        else "<li>本时段未记录需要特别提示的高热噪音。</li>"
    )
    conclusion_html = "".join(
        f'<div class="concl-item"><span class="concl-tag">{_esc(tag)}</span><p>{_esc(text)}</p></div>'
        for tag, text in conclusions
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>外围热点 · {label} · {date_cn}</title>
  <style>
    :root {{
      --bg: #0b1020;
      --bg-soft: #121a2f;
      --panel: rgba(255,255,255,0.04);
      --panel-2: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.08);
      --text: #eef2ff;
      --muted: #9aa6c3;
      --dim: #6d7a99;
      --ai: #7c9cff;
      --market: #5ee4a8;
      --war: #ff8b7a;
      --accent: #c4b5fd;
      --shadow: 0 18px 50px rgba(0,0,0,0.35);
      --radius: 18px;
      --font: "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
              "Noto Sans SC", system-ui, sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--font); }}
    body {{
      min-height: 100vh;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(124,156,255,0.18), transparent 55%),
        radial-gradient(900px 500px at 90% 0%, rgba(94,228,168,0.12), transparent 50%),
        radial-gradient(800px 400px at 50% 100%, rgba(255,139,122,0.10), transparent 55%),
        var(--bg);
      line-height: 1.65;
    }}
    .wrap {{ max-width: 920px; margin: 0 auto; padding: 40px 22px 80px; }}
    .hero {{
      background: linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 32px 28px 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      margin-bottom: 28px;
    }}
    .kicker {{
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--accent); font-weight: 600; margin-bottom: 12px;
    }}
    .kicker::before {{
      content: ""; width: 8px; height: 8px; border-radius: 50%;
      background: linear-gradient(135deg, var(--ai), var(--market));
      box-shadow: 0 0 12px rgba(124,156,255,0.8);
    }}
    h1 {{
      margin: 0 0 10px; font-size: clamp(1.6rem, 3vw, 2.1rem);
      font-weight: 700; letter-spacing: -0.02em; line-height: 1.25;
    }}
    .subtitle {{ color: var(--muted); font-size: 0.98rem; margin: 0 0 18px; }}
    .stats {{ display: flex; flex-wrap: wrap; gap: 10px; }}
    .stat {{
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 999px; padding: 8px 14px; font-size: 13px; color: var(--muted);
    }}
    .stat b {{ color: var(--text); font-weight: 650; margin-right: 4px; }}
    .stat.ai b {{ color: var(--ai); }}
    .stat.market b {{ color: var(--market); }}
    .stat.war b {{ color: var(--war); }}
    .section {{
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 22px 20px 8px;
      margin-bottom: 18px;
      box-shadow: var(--shadow);
    }}
    .section-head {{
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 14px; padding: 0 4px;
    }}
    .section-head h2 {{
      margin: 0; font-size: 1.12rem; font-weight: 700; letter-spacing: -0.01em;
    }}
    .section-ai .section-head h2 {{ color: var(--ai); }}
    .section-market .section-head h2 {{ color: var(--market); }}
    .section-war .section-head h2 {{ color: var(--war); }}
    .badge {{
      font-size: 12px; color: var(--dim); background: var(--panel);
      border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px;
    }}
    .cards {{ display: grid; gap: 12px; }}
    .card {{
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 16px 14px;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }}
    .card:hover {{ border-color: rgba(255,255,255,0.16); transform: translateY(-1px); }}
    .card-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }}
    .idx {{
      font-variant-numeric: tabular-nums; font-weight: 700; font-size: 12px;
      color: var(--dim); letter-spacing: 0.08em;
    }}
    .conf {{
      font-size: 11px; border-radius: 999px; padding: 3px 9px;
      border: 1px solid var(--border); color: var(--muted);
    }}
    .conf-high {{ color: #86efac; border-color: rgba(134,239,172,0.35); background: rgba(34,197,94,0.08); }}
    .conf-midhigh {{ color: #93c5fd; border-color: rgba(147,197,253,0.35); background: rgba(59,130,246,0.08); }}
    .conf-mid {{ color: #fde68a; border-color: rgba(253,230,138,0.3); background: rgba(234,179,8,0.08); }}
    .conf-low {{ color: #fca5a5; border-color: rgba(252,165,165,0.3); background: rgba(239,68,68,0.08); }}
    .card h3 {{ margin: 0 0 8px; font-size: 1.05rem; line-height: 1.4; font-weight: 650; }}
    .detail {{ margin: 0 0 10px; color: #d5dcf0; font-size: 0.95rem; }}
    .why {{ margin: 0 0 12px; color: var(--muted); font-size: 0.9rem; }}
    .why strong {{ color: var(--accent); font-weight: 600; margin-right: 4px; }}
    .meta {{
      display: flex; flex-wrap: wrap; gap: 10px 16px; font-size: 12.5px; color: var(--dim);
      border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 10px;
    }}
    .meta a {{ color: var(--ai); text-decoration: none; font-weight: 600; }}
    .meta a:hover {{ text-decoration: underline; }}
    .empty {{
      color: var(--dim); font-size: 0.92rem; padding: 18px 8px 22px; text-align: center;
    }}
    .bottom-grid {{
      display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; margin-top: 6px;
    }}
    @media (max-width: 720px) {{
      .bottom-grid {{ grid-template-columns: 1fr; }}
      .hero {{ padding: 24px 18px; }}
      .wrap {{ padding: 24px 14px 60px; }}
    }}
    .panel {{
      background: var(--bg-soft); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow);
    }}
    .panel h2 {{
      margin: 0 0 12px; font-size: 1rem; color: var(--accent); letter-spacing: 0.02em;
    }}
    .panel ul {{ margin: 0; padding-left: 18px; color: var(--muted); }}
    .panel li {{ margin-bottom: 8px; }}
    .concl-item {{
      display: grid; grid-template-columns: 52px 1fr; gap: 10px;
      padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
    }}
    .concl-item:last-child {{ border-bottom: 0; padding-bottom: 0; }}
    .concl-tag {{
      font-size: 12px; font-weight: 700; color: var(--text);
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 8px; height: fit-content; text-align: center; padding: 4px 0;
    }}
    .concl-item p {{ margin: 0; color: var(--muted); font-size: 0.92rem; }}
    footer {{
      margin-top: 28px; text-align: center; color: var(--dim); font-size: 12px;
    }}
    footer code {{ color: var(--muted); }}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="kicker">外围热点 · {label}</div>
      <h1>{date_cn} · X 硬信息精选</h1>
      <p class="subtitle">
        观察窗口：北京时间 {_esc(start_bj.strftime('%Y-%m-%d %H:%M'))}
        — {_esc(end_bj.strftime('%Y-%m-%d %H:%M'))}
        （{_esc(period)}）· 重点账号 + 热帖消噪 · 中文编译
      </p>
      <div class="stats">
        <div class="stat"><b>{total}</b>条精选</div>
        <div class="stat ai"><b>{counts['AI']}</b>AI</div>
        <div class="stat market"><b>{counts['财经/股市']}</b>财经</div>
        <div class="stat war"><b>{counts['全球战争']}</b>地缘</div>
        <div class="stat">生成于 <b>{_esc(stamp)}</b></div>
      </div>
    </header>

    {''.join(sections_html)}

    <div class="bottom-grid">
      <section class="panel">
        <h2>噪音观察</h2>
        <ul>{noise_html}</ul>
      </section>
      <section class="panel">
        <h2>一句话结论</h2>
        {conclusion_html}
      </section>
    </div>

    <footer>
      仅供研究参考，非投资建议 · 数据来源 X · 时区 Asia/Shanghai<br />
      重点账号：@aleabitoreddit @JensenHuang @thsottiaux @business @elonmusk
      @Reuters @ReutersBiz @ChatGPT @OpenAI @ZhipuAI
    </footer>
  </div>
</body>
</html>
"""


def write_desktop_html(
    *,
    posts: list[dict],
    payload: dict,
    start: datetime,
    end: datetime,
    mode: str,
) -> Path:
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    end_bj = end.astimezone(BEIJING)
    if mode == "digest-morning":
        kind = "早报"
        latest_name = "最新-早报.html"
    elif mode == "digest-evening":
        kind = "晚报"
        latest_name = "最新-晚报.html"
    else:
        kind = "快报"
        latest_name = "最新-快报.html"

    dated_name = f"外围热点-{kind}-{end_bj.strftime('%Y-%m-%d_%H%M')}.html"
    content = render_html(
        posts=posts,
        payload=payload,
        start=start,
        end=end,
        mode=mode,
    )
    dated_path = DESKTOP_DIR / dated_name
    latest_path = DESKTOP_DIR / latest_name
    dated_path.write_text(content, encoding="utf-8")
    latest_path.write_text(content, encoding="utf-8")
    return dated_path


def resolve_mode(explicit: str | None, current: datetime | None = None) -> str:
    if explicit and explicit != "auto":
        return explicit
    now = (current or now_utc()).astimezone(BEIJING)
    if now.hour == 8:
        return "digest-morning"
    if now.hour == 23:
        return "digest-evening"
    return "collect"


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


def payload_from_inbox(inbox: dict, extra: dict | None = None) -> dict:
    base = {
        "noiseZh": list(inbox.get("noise") or []),
        "aiConclusionZh": str(inbox.get("aiConclusionZh") or ""),
        "marketConclusionZh": str(inbox.get("marketConclusionZh") or ""),
        "warConclusionZh": str(inbox.get("warConclusionZh") or ""),
    }
    if extra:
        for key in ("noiseZh", "aiConclusionZh", "marketConclusionZh", "warConclusionZh"):
            value = extra.get(key)
            if key == "noiseZh" and isinstance(value, list) and value:
                base[key] = value
            elif isinstance(value, str) and value.strip():
                base[key] = value
    return base


def run_observation(
    *,
    git_push: bool,
    dry_run: bool = False,
    mode: str = "auto",
) -> int:
    current = now_utc()
    mode = resolve_mode(mode, current)
    state = load_state()
    inbox = load_inbox()
    start, end = observation_window(state, current, mode=mode)
    seen_ids = {
        str(item)
        for item in state.get("seenStatusIds", [])
        if isinstance(item, (str, int))
    }
    seen_ids.update(existing_status_ids())
    # 已入库帖子也视为 seen，避免采集轮重复
    for post in inbox.get("posts", []):
        if isinstance(post, dict) and post.get("statusId"):
            seen_ids.add(str(post["statusId"]))

    try:
        publish_existing_if_needed(state, git_push and not dry_run and mode == "digest-evening")
    except Exception as exc:
        print(f"⚠ 上次内容仍未发布到 GitHub：{exc}", file=sys.stderr, flush=True)

    template = PROMPT_PATH.read_text(encoding="utf-8")
    prompt = build_prompt(template, start, end, seen_ids)
    print(
        f"→ Grok 只读观察 X [{mode}]："
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
        state["lastMode"] = mode

        if dry_run:
            print(json.dumps({"mode": mode, "posts": posts, "payload": payload}, ensure_ascii=False, indent=2))
            if posts:
                print(render_markdown(payload, posts, start, end))
            return 0

        added = merge_posts_into_inbox(inbox, posts, payload=payload, collected_at=end)
        if posts:
            state["seenStatusIds"] = (
                list(
                    dict.fromkeys(
                        [*state.get("seenStatusIds", []), *[p["statusId"] for p in posts]]
                    )
                )
            )[-MAX_SEEN_IDS:]
            print(f"→ 新采集 {len(added)} 条（本轮过滤后 {len(posts)} 条）", flush=True)
        else:
            print("→ 本轮无新增高价值推文", flush=True)

        if mode == "collect":
            state["lastResult"] = "collected" if added else "no-new-posts"
            save_inbox(inbox)
            save_state(state)
            print(
                f"✓ 采集完成：入库新增 {len(added)}，inbox 共 {len(inbox.get('posts', []))} 条",
                flush=True,
            )
            return 0

        # 摘要窗口固定用早/晚报回看时长，不因「距上次采集仅 1–2 小时」缩成近约 1 小时
        digest_since = end - (
            MORNING_LOOKBACK if mode == "digest-morning" else EVENING_LOOKBACK
        )
        digest_posts = posts_for_digest(inbox, since=digest_since, end=end)
        digest_payload = payload_from_inbox(inbox, payload)
        html_path = write_desktop_html(
            posts=digest_posts,
            payload=digest_payload,
            start=digest_since,
            end=end,
            mode=mode,
        )
        kind = "早报" if mode == "digest-morning" else "晚报"
        print(f"✓ 已写桌面 HTML（{kind}）：{html_path}", flush=True)

        stamp = end.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M")
        if mode == "digest-morning":
            inbox["lastMorningDigestAt"] = stamp
        else:
            inbox["lastEveningDigestAt"] = stamp
        save_inbox(inbox)

        counts = count_by_category(digest_posts)
        # 晚报写入看板；早报仅桌面 HTML（避免早报/晚报同日刷屏）
        if mode == "digest-evening" and digest_posts:
            markdown = render_markdown(
                digest_payload,
                digest_posts,
                digest_since,
                end,
            )
            item = push_xbrief.push(
                markdown,
                title="外围热点",
                period=period_label(digest_since, end, compact=True),
                time_str=stamp,
            )
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
            print(
                f"✓ 晚报已更新看板：AI {counts['AI']} / 市 {counts['财经/股市']} / 地缘 {counts['全球战争']}"
                + ("，并同步 GitHub" if git_push else "，仅本地"),
                flush=True,
            )
        else:
            state["lastResult"] = "digest-html"
            print(
                f"✓ {kind}完成：AI {counts['AI']} / 市 {counts['财经/股市']} / 地缘 {counts['全球战争']}"
                + ("（无增量帖，仍生成 HTML）" if not digest_posts else ""),
                flush=True,
            )

        save_state(state)
        return 0
    except Exception as exc:
        state["lastRunAt"] = iso_utc(current)
        state["lastResult"] = "error"
        state["lastError"] = clean_text(str(exc), 1200)
        state["lastMode"] = mode
        if not dry_run:
            save_state(state)
        print(f"✗ Grok 外围热点任务失败：{exc}", file=sys.stderr, flush=True)
        return 1


def print_status() -> int:
    state = load_state()
    inbox = load_inbox()
    print(
        json.dumps(
            {
                "state": state,
                "inboxPosts": len(inbox.get("posts") or []),
                "desktop": str(DESKTOP_DIR),
                "lastMorningDigestAt": inbox.get("lastMorningDigestAt"),
                "lastEveningDigestAt": inbox.get("lastEveningDigestAt"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def check_configuration() -> int:
    missing = [str(path) for path in (PROMPT_PATH, ROOT / "scripts" / "run_refresh.py") if not path.is_file()]
    binary = Path(grok_binary())
    if not binary.is_file():
        missing.append(str(binary))
    if missing:
        print("缺少文件：" + "、".join(missing), file=sys.stderr)
        return 1
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    print(
        f"配置正常：Grok={binary}\n"
        f"  桌面输出：{DESKTOP_DIR}\n"
        f"  调度：每 2 小时采集；北京时间 08:00 早报 HTML；23:00 晚报 HTML + 看板"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="外围热点：每 2h 采集 X；早 8 / 晚 23 生成桌面 HTML"
    )
    parser.add_argument("--git-push", action="store_true", help="晚报有新增时同步 xbriefs.js 到 GitHub")
    parser.add_argument("--dry-run", action="store_true", help="执行搜索和筛选，但不写入、不发布、不更新状态")
    parser.add_argument(
        "--mode",
        choices=["auto", "collect", "digest-morning", "digest-evening"],
        default="auto",
        help="运行模式（默认 auto：8→早报，23→晚报，其余→采集）",
    )
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
        observation_code = run_observation(
            git_push=args.git_push,
            dry_run=args.dry_run,
            mode=args.mode,
        )
        # 晚报顺带刷新行情；采集/早报跳过以省时间（可用环境变量强制）
        mode = resolve_mode(args.mode)
        should_refresh = (
            not args.skip_refresh
            and not args.dry_run
            and (mode == "digest-evening" or os.environ.get("XBRIEF_ALWAYS_REFRESH") == "1")
        )
        refresh_code = run_refresh() if should_refresh else 0
        return observation_code or refresh_code
    finally:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
