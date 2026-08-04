#!/usr/bin/env python3
"""清理 Agent 研究模块公开数据中的内部字段名和影响阅读的机器化表达。"""
from __future__ import annotations

import os
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_MODULES_PATH = ROOT / "active_modules.json"


def _file_token(name: str) -> re.Pattern[str]:
    """匹配文件名；允许紧贴中文，避免 \\b 在 CJK 粘连时漏替换。"""
    return re.compile(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", re.I)


REPLACEMENTS = [
    (re.compile(r"thsStrong", re.I), "强势股数据"),
    (re.compile(r"thsHot", re.I), "热度榜数据"),
    (re.compile(r"confidence\s*=\s*", re.I), "置信度"),
    (re.compile(r"break\s*=\s*(\d+)\s*次?", re.I), r"开板\1次"),
    (re.compile(r"rank_chg", re.I), "排名变化"),
    # 已退休的数据文件名不应继续作为用户可见来源；保留来源语义而不是暴露旧模块。
    (_file_token("newsall.js"), "公开资讯"),
    (_file_token("hot.js"), "热度榜数据"),
    (_file_token("chain.js"), "公开产业资料"),
    (_file_token("reports.js"), "历史复盘资料"),
    (_file_token("fundflow.js"), "资金数据"),
    (_file_token("materials.js"), "公开材料价格资料"),
    (_file_token("industry_market.js"), "行业行情数据"),
    (_file_token("market.js"), "市场异动数据"),
    (_file_token("industry.js"), "行业数据"),
    # 正文里嵌着的内部工具名,换成用户能懂的说法(纯过程语整行由下面的报告级清洗删除)。
    # e2e 门禁对任何 .py 字样一律判失败,故不保留 scripts/xxx.py 路径出处,全部替换。
    (re.compile(r"(?<!\w)[\w.-]+\.py"), "数据接口"),
    (re.compile(r"web_search", re.I), "网页搜索"),
    (re.compile(r"tenacity\s*库?版本冲突", re.I), "组件版本冲突"),
]

def sanitize_text(text: str) -> str:
    for pattern, replacement in REPLACEMENTS:
        text = pattern.sub(replacement, text)
    # 研究摘要常以英文分隔符串联多个方向，替换为中文断句改善阅读。
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


def active_ai_files() -> list[str]:
    """只清理活跃清单中由 Agent 维护的研究模块数据文件。"""
    manifest = json.loads(ACTIVE_MODULES_PATH.read_text(encoding="utf-8"))
    modules = manifest.get("modules")
    if manifest.get("schemaVersion") != 1 or not isinstance(modules, list):
        raise ValueError("active_modules.json 协议无效")
    files = [
        module["file"]
        for module in modules
        if isinstance(module, dict) and isinstance(module.get("agent") or module.get("hermes"), dict)
    ]
    if any(not isinstance(name, str) or Path(name).name != name for name in files):
        raise ValueError("active_modules.json 中存在无效 AI 文件")
    return files


def main() -> int:
    changed = []
    for name in active_ai_files():
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
