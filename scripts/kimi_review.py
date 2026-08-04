#!/usr/bin/env python3
"""读取本机 Kimi Code 复盘，供 localhost 看板只读展示。

该模块只返回给本地 app_server，不把 Kimi 报告写入公开静态资源或 GitHub Pages。
"""
from __future__ import annotations

import html
import os
import re
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from pathlib import Path


BJ = timezone(timedelta(hours=8))
SOURCE_LABEL = "Kimi Code"
EXCLUDED_NAMES = {
    "AGENTS.md", "CLAUDE.md", "收盘复盘.md", "看盘分析.md", "明日计划.md", "周末发酵.md",
}


def _candidate_dirs() -> list[Path]:
    configured = os.environ.get("KIMI_REVIEW_DIR", "").strip()
    dirs = [Path(configured)] if configured else []
    dirs.extend([
        Path.home() / "Desktop" / "Claude复盘",
        Path("/Users/Admin/Documents/kimi/workspace"),
        Path("/Users/Admin/Documents/kimi/reports"),
    ])
    unique: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        if not directory:
            continue
        key = str(directory.expanduser().resolve())
        if key not in seen:
            unique.append(directory.expanduser())
            seen.add(key)
    return unique


def _is_candidate(path: Path) -> bool:
    return (
        path.is_file()
        and path.name not in EXCLUDED_NAMES
        and path.suffix.lower() in {".html", ".htm"}
    )


def find_latest_review() -> Path | None:
    configured_file = os.environ.get("KIMI_REVIEW_FILE", "").strip()
    if configured_file:
        path = Path(configured_file).expanduser()
        return path if _is_candidate(path) else None
    candidates: list[Path] = []
    for directory in _candidate_dirs():
        if directory.is_dir():
            candidates.extend(path for path in directory.iterdir() if _is_candidate(path))
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


class _SafeHTMLParser(HTMLParser):
    """保留报告常用排版标签，丢弃脚本、样式、属性和外部资源。"""

    ALLOWED = {
        "article", "aside", "b", "blockquote", "br", "caption", "code", "div",
        "em", "footer", "h1", "h2", "h3", "h4", "header", "hr", "li", "ol",
        "p", "section", "small", "span", "strong", "table", "tbody", "td",
        "th", "thead", "tr", "ul",
    }
    VOID = {"br", "hr"}
    SKIP = {"head", "script", "style", "svg", "iframe", "object", "embed", "form"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        tag = tag.lower()
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in {"html", "body", "main"}:
            return
        if tag in self.ALLOWED:
            self.parts.append(f"<{tag}>")

    def handle_startendtag(self, tag: str, attrs) -> None:  # noqa: ANN001
        tag = tag.lower()
        if not self.skip_depth and tag in self.ALLOWED:
            self.parts.append(f"<{tag}/>" if tag in self.VOID else f"<{tag}></{tag}>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in self.ALLOWED and tag not in self.VOID:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and data:
            self.parts.append(html.escape(data, quote=False))


def sanitize_html_document(raw: str) -> str:
    parser = _SafeHTMLParser()
    parser.feed(raw)
    parser.close()
    return "".join(parser.parts).strip()


def _empty() -> dict:
    return {
        "ok": True, "available": False, "title": "每日复盘", "generatedAt": "",
        "fileName": "", "source": SOURCE_LABEL, "contentHtml": "",
    }


def load_review(path: Path | None = None) -> dict:
    path = path or find_latest_review()
    if path is None:
        return _empty()
    try:
        raw = path.read_text(encoding="utf-8")
        stamp = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone(BJ)
    except (OSError, UnicodeError):
        return _empty()
    content = sanitize_html_document(raw)
    if not content:
        return _empty()
    match = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
    title = re.sub(r"\s+", " ", html.unescape(match.group(1))).strip() if match else path.stem
    return {
        "ok": True, "available": True, "title": title or path.stem,
        "generatedAt": stamp.strftime("%Y-%m-%d %H:%M"), "fileName": path.name,
        "source": SOURCE_LABEL, "contentHtml": content,
    }
