#!/usr/bin/env python3
"""清理 Hermes 公开数据中的内部字段名和影响阅读的机器化表达。"""
from __future__ import annotations

import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "industry.js", "logic.js", "events.js", "materials.js", "weekend.js",
]
REPLACEMENTS = [
    (re.compile(r"thsStrong", re.I), "强势股数据"),
    (re.compile(r"thsHot", re.I), "热度榜数据"),
    (re.compile(r"confidence\s*=\s*", re.I), "置信度"),
    (re.compile(r"break\s*=\s*(\d+)\s*次?", re.I), r"开板\1次"),
    (re.compile(r"rank_chg", re.I), "排名变化"),
    # 正文里嵌着的内部工具名,换成用户能懂的说法(纯过程语整行由下面的报告级清洗删除)。
    # e2e 门禁对任何 .py 字样一律判失败,故不保留 scripts/xxx.py 路径出处,全部替换。
    (re.compile(r"(?<!\w)[\w.-]+\.py"), "数据接口"),
    (re.compile(r"web_search", re.I), "网页搜索"),
    (re.compile(r"tenacity\s*库?版本冲突", re.I), "组件版本冲突"),
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
    changed = []
    for name in FILES:
        if sanitize_file(ROOT / name):
            changed.append(name)
    # data.js 是多个采集器共同写入的公开数据，校验前必须全量兜底，
    # 不能只依赖某一个新闻入口的清洗。
    from _dataio import DataLock, load_stocks, sanitize_stock_news, write_stocks
    with DataLock():
        stocks = load_stocks()
        if sanitize_stock_news(stocks):
            write_stocks(stocks)
            changed.append("data.js")
    print("AI 内容清理: " + (", ".join(changed) if changed else "无需修改"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
