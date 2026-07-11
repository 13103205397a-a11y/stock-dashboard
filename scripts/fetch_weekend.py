#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Hermes Agent 会话库导出最新的「周末发酵」→ 写 weekend.js。

Hermes 按 agent/weekend_ferment.md 的 prompt 搜集周末热点事件并解读，
输出一个 JSON 对象（含 hotspots/scenario/noiseFilter）。本脚本从对应
session 提取该 JSON，写入 weekend.js（window.WEEKEND）。

数据来源：本机 Hermes sessions（周日下午定时任务），非 GitHub Actions。
本地运行： python3 scripts/fetch_weekend.py
需 hermes 命令行可用（已在 PATH 中）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "weekend.js")

# 匹配周末发酵类 session 的关键词
MATCH_KEYWORDS = ["周末发酵", "周末热点", "weekend", "周末事件", "周一策略", "热点发酵"]


def run(cmd, timeout=60):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout
    except Exception:
        return ""


def list_sessions(limit=80):
    out = run(["hermes", "sessions", "list", "--limit", str(limit)], timeout=60)
    if not out:
        return []
    sessions = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.search(r"(cron_[a-f0-9_]+|\d{8}_[a-f0-9]+)\s*$", line)
        sid = m.group(1) if m else ""
        if not sid:
            continue
        title_part = line[: m.start()].strip()
        title = re.sub(r"\[.*$", "", title_part).strip() or title_part
        sessions.append({"title": title, "id": sid})
    return sessions


def get_session(session_id):
    if not session_id:
        return None
    out = run(["hermes", "sessions", "get", session_id], timeout=120)
    if out:
        try:
            return json.loads(out)
        except Exception:
            m = re.search(r"\{.*\}", out, re.S)
            if m:
                try:
                    return json.loads(m.group())
                except Exception:
                    pass
    out = run(["hermes", "sessions", "export", "--session-id", session_id, "-"], timeout=120)
    if not out:
        return None
    try:
        return json.loads(out.splitlines()[0])
    except Exception:
        return None


def _content_to_str(content):
    if isinstance(content, list):
        return "\n".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
    return str(content).strip() if content else ""


def extract_json_block(content):
    """从 AI 输出里提取 JSON 对象 {...}。"""
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    m = re.search(r"(\{[\s\S]*\})", content)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None


def normalize_weekend(obj):
    """归一化周末发酵数据。期望含 hotspots 数组或 scenario 对象。"""
    if not isinstance(obj, dict):
        return None
    hotspots = obj.get("hotspots")
    summary = str(obj.get("summary") or "")
    placeholder = re.compile(r"N 个|政策类 X|热点标题|板块A|偏多/偏空|关注理由|确认信号")
    if not isinstance(hotspots, list) or len(hotspots) < 3 or placeholder.search(summary):
        return None
    if any(placeholder.search(str(item.get("title") or "")) for item in hotspots if isinstance(item, dict)):
        return None
    if "scenario" in obj and "weekendDate" in obj:
        return obj
    return None


def extract_from_session(session):
    """从后往前扫 assistant 与文件读取结果，提取周末发酵 JSON。"""
    msgs = session.get("messages", []) if session else []
    for m in reversed(msgs):
        role = m.get("role")
        if role not in ("assistant", "tool"):
            continue
        candidates = [_content_to_str(m.get("content", ""))]
        for call in m.get("tool_calls") or []:
            try:
                args = json.loads(call.get("function", {}).get("arguments", "{}"))
                for key in ("content", "text", "new_string"):
                    if isinstance(args.get(key), str):
                        candidates.insert(0, args[key])
            except Exception:
                pass
        for content in candidates:
            if role == "tool":
                try:
                    decoded = json.loads(content)
                    content = decoded.get("content", content) if isinstance(decoded, dict) else content
                except Exception:
                    pass
                content = re.sub(r"(?m)^\s*\d+\|", "", content)
                if "window.WEEKEND" not in content and '"hotspots"' not in content:
                    continue
            if len(content) < 20:
                continue
            marker = "window.WEEKEND = "
            if marker in content:
                try:
                    j = json.loads(content[content.index(marker) + len(marker):].rsplit(";", 1)[0])
                except Exception:
                    j = extract_json_block(content)
            else:
                j = extract_json_block(content)
            if j is None:
                continue
            data = normalize_weekend(j)
            if data:
                snippet = content[:80].replace("\n", " ")
                return data, snippet
    return None, ""


def find_weekend_session(sessions):
    """在 sessions 列表里找标题命中关键词的最近一条。"""
    for s in sessions:
        title = s.get("title", "")
        for kw in MATCH_KEYWORDS:
            if kw.lower() in title.lower():
                return s
    return None


def write_weekend_js(data):
    """原子写入 weekend.js"""
    try:
        old = open(OUT, encoding="utf-8").read()
        marker = "window.WEEKEND = "
        old_data = json.loads(old[old.index(marker) + len(marker):].rsplit(";", 1)[0])
        if old_data == data:
            return False
    except Exception:
        pass
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = (
        f"/* Hermes Agent 周末发酵（本机自动导出，非 GitHub Actions）\n"
        f"   导出于 {now}，由 scripts/fetch_weekend.py 从 Hermes sessions 提取。\n"
        f"   仅供研究参考，非投资建议。 */\n"
    )
    body = "window.WEEKEND = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(header + body)
    os.replace(tmp, OUT)
    return True


def main():
    if not shutil.which("hermes"):
        print("[fetch_weekend] hermes 命令不可用，跳过（本机工具未安装）", flush=True)
        return

    print("[fetch_weekend] 列出最近 sessions...", flush=True)
    sessions = list_sessions(80)
    if not sessions:
        print("[fetch_weekend] 无 session，跳过", flush=True)
        return
    print(f"[fetch_weekend] 共 {len(sessions)} 个 session", flush=True)

    target = find_weekend_session(sessions)
    if not target:
        print(f"[fetch_weekend] 未找到周末发酵类 session（关键词: {MATCH_KEYWORDS}），跳过", flush=True)
        return
    print(f"[fetch_weekend] 命中: {target['title']} → {target['id']}", flush=True)

    session = get_session(target["id"])
    if not session:
        print("[fetch_weekend] 获取 session 详情失败，跳过", flush=True)
        return

    data, snippet = extract_from_session(session)
    if not data:
        print(f"[fetch_weekend] 未提取到周末发酵 JSON，跳过。最后内容: {snippet}", flush=True)
        return
    print(f"[fetch_weekend] 提取成功: {snippet}", flush=True)

    changed = write_weekend_js(data)
    print(f"[fetch_weekend] {'✓ 已写入' if changed else '内容无变化'} {OUT}", flush=True)


if __name__ == "__main__":
    main()
