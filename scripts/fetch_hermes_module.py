#!/usr/bin/env python3
"""从最新成功的 Hermes 会话导出一个结构化研究模块。

逻辑链与今日热点事件只在最终回复里交付 JSON；本脚本负责校验、原子写入，
后续由 sync_hermes_dashboard.py 在最新远端 worktree 中防回滚发布。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

import fetch_weekend


ROOT = Path(__file__).resolve().parents[1]
MODULES = {
    "logic": {
        "keywords": ["逻辑链"],
        "file": "logic.js",
        "global": "LOGIC",
        "array": "chains",
        "header": "逻辑链数据：事件驱动推理链（事件 → 传导 → 受益股）",
    },
    "events": {
        "keywords": ["今日热点事件"],
        "file": "events.js",
        "global": "EVENTS",
        "array": "events",
        "header": "今日热点事件：重要新闻影响与市场传导",
    },
}


def normalize_payload(value: object, spec: dict) -> dict | None:
    if not isinstance(value, dict):
        return None
    rows = value.get(spec["array"])
    if not isinstance(rows, list) or not rows:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value.get("date") or "")):
        return None
    if not str(value.get("generatedAt") or "").strip():
        return None
    return value


def _message_payloads(message: dict, spec: dict):
    content = fetch_weekend._content_to_str(message.get("content", ""))
    candidates = [content]
    for call in message.get("tool_calls") or []:
        try:
            args = json.loads(call.get("function", {}).get("arguments", "{}"))
        except (TypeError, json.JSONDecodeError):
            continue
        for key in ("content", "text", "new_string"):
            if isinstance(args.get(key), str):
                candidates.insert(0, args[key])
    marker = f"window.{spec['global']} = "
    for text in candidates:
        if marker in text:
            try:
                yield json.loads(text[text.index(marker) + len(marker):].rsplit(";", 1)[0])
                continue
            except (ValueError, json.JSONDecodeError):
                pass
        value = fetch_weekend.extract_json_block(text)
        if value is not None:
            yield value


def extract_payload(session: dict | None, spec: dict) -> tuple[dict | None, str]:
    if not session or fetch_weekend.session_failure_reason(session):
        return None, ""
    for message in reversed(session.get("messages") or []):
        if message.get("role") not in ("assistant", "tool"):
            continue
        for value in _message_payloads(message, spec):
            payload = normalize_payload(value, spec)
            if payload:
                snippet = fetch_weekend._content_to_str(message.get("content", ""))
                return payload, snippet[:80].replace("\n", " ")
    return None, ""


def find_latest_payload(spec: dict) -> tuple[dict | None, str]:
    sessions = fetch_weekend.list_sessions(100)
    matches = [
        session for session in sessions
        if any(keyword.lower() in session.get("title", "").lower() for keyword in spec["keywords"])
    ]
    for candidate in matches:
        session = fetch_weekend.get_session(candidate["id"])
        payload, snippet = extract_payload(session, spec)
        if payload:
            return payload, snippet
    return None, ""


def write_module(payload: dict, spec: dict) -> bool:
    output = ROOT / spec["file"]
    marker = f"window.{spec['global']} = "
    try:
        current = output.read_text(encoding="utf-8")
        previous = json.loads(current[current.index(marker) + len(marker):].rsplit(";", 1)[0])
        if previous == payload:
            return False
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    header = (
        f"/* {spec['header']}\n"
        " * 由 Hermes Agent 生成并由本机安全同步器导出\n"
        " * 仅供研究参考，非投资建议。\n"
        " */\n"
    )
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(
        header + marker + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    os.replace(temp, output)
    return True


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or args[0] not in MODULES:
        print("用法: fetch_hermes_module.py logic|events", file=sys.stderr)
        return 2
    module_id = args[0]
    spec = MODULES[module_id]
    if not shutil.which("hermes"):
        print(f"[{module_id}] hermes 命令不可用", file=sys.stderr)
        return 1
    payload, snippet = find_latest_payload(spec)
    if not payload:
        print(f"[{module_id}] 未找到本轮有效结构化会话", file=sys.stderr)
        return 1
    changed = write_module(payload, spec)
    print(f"提取成功: {spec['file']} · {'已更新' if changed else '内容无变化'} · {snippet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
