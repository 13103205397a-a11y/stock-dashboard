#!/usr/bin/env python3
"""清理 Hermes 公开数据中的内部字段名和影响阅读的机器化表达。"""
from __future__ import annotations

import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "reports.js", "industry.js", "logic.js", "events.js",
    "opportunities.js", "materials.js", "weekend.js",
]
REPLACEMENTS = [
    (re.compile(r"thsStrong", re.I), "强势股数据"),
    (re.compile(r"thsHot", re.I), "热度榜数据"),
    (re.compile(r"confidence\s*=\s*", re.I), "置信度"),
    (re.compile(r"break\s*=\s*(\d+)\s*次?", re.I), r"开板\1次"),
    (re.compile(r"rank_chg", re.I), "排名变化"),
]


def sanitize_text(text: str) -> str:
    for pattern, replacement in REPLACEMENTS:
        text = pattern.sub(replacement, text)
    # Hermes 摘要常以英文分隔符串联多个方向，替换为中文断句改善阅读。
    return text.replace(") / ", ")；")


def sanitize_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    cleaned = sanitize_text(original)
    if cleaned == original:
        return False
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(cleaned, encoding="utf-8")
    os.replace(temp, path)
    return True


def main() -> int:
    changed = [name for name in FILES if sanitize_file(ROOT / name)]
    print("AI 内容清理: " + (", ".join(changed) if changed else "无需修改"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
