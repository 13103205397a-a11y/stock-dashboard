#!/usr/bin/env python3
"""清理 Hermes 公开数据中的内部字段名和影响阅读的机器化表达。"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "reports.js", "industry.js", "logic.js", "events.js",
    "materials.js", "weekend.js", "chain.js",
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

# —— reports.js 过程语兜底(导出层 fetch_hermes.py 已拦一道,这里再拦) ——
# 正文起点:markdown 标题 / 数据完整度状态行 / 表格
REPORT_START = re.compile(r"^(#{1,3}\s|[-*]*\s*数据完整度|\|)", re.M)
# 过程语特征:工具文件名、搜索工具名、生成流程自述
PROCESS_HINT = re.compile(
    r"\.py\b|web_search|让我重试|我将使用|现在综合|数据已全部?到位|撰写报告|"
    r"我(?:已经)?获取了|现在让我来|让我来(?:汇总|撰写|整理|综合|分析)|成功了|不可用|解析 market\.js",
    re.I,
)
PROCESS_LINE = re.compile(
    r"^\s*(?:[\w.-]+\.py\b|web_search\b|数据已全部?到位|现在综合|让我重试|我将使用|"
    r"我(?:已经)?获取了|现在让我来|让我来(?:汇总|撰写|整理|综合|分析))",
    re.I,
)
MIN_REPORT_CHARS = 80


def clean_report_content(content: str) -> str:
    """剥掉报告正文之前的过程语 preamble,并删除残留的整行过程语。"""
    text = str(content or "").strip()
    if not text:
        return ""
    start = REPORT_START.search(text)
    if start and PROCESS_HINT.search(text[: start.start()]):
        text = start.string[start.start():].strip()
    lines = [ln for ln in text.splitlines() if not PROCESS_LINE.match(ln)]
    return "\n".join(lines).strip()


def sanitize_reports(path: Path) -> bool:
    """清洗 reports.js 每篇报告;洗完后太短(会话中断残留的残篇)的整篇剔除。"""
    original = path.read_text(encoding="utf-8")
    match = re.search(r"window\.REPORTS\s*=\s*(\{.*\})\s*;?\s*$", original, re.S)
    if not match:
        return False
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return False
    changed = False
    kept = []
    for report in payload.get("reports", []):
        cleaned = clean_report_content(report.get("content", ""))
        if cleaned != str(report.get("content", "")).strip():
            changed = True
        if len(cleaned) < MIN_REPORT_CHARS:
            changed = True
            continue
        report["content"] = cleaned
        kept.append(report)
    if not changed:
        return False
    payload["reports"] = kept
    header = original[: match.start()]
    rewritten = (
        header
        + "window.REPORTS = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(rewritten, encoding="utf-8")
    os.replace(temp, path)
    return True


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
    # 先做报告级结构化清洗(过程语剥离/残篇剔除),此时工具名仍是原文,模式最准;
    # 再做文本级替换,兜住嵌在正文句子里的工具名残留。
    changed = []
    if sanitize_reports(ROOT / "reports.js"):
        changed.append("reports.js")
    for name in FILES:
        if sanitize_file(ROOT / name) and name not in changed:
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
