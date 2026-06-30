#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Hermes Agent 会话库导出最新的「产业雷达」分析 → 覆盖 industry.js。

Hermes 按 agent/industry-radar.md 的 prompt 跑产业供需分析,
最终输出一个 JSON 代码块。本脚本从对应 session 提取该 JSON,
写入 industry.js(window.INDUSTRY)。

本地运行: python3 scripts/fetch_industry_ai.py
需 hermes 命令行可用。
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "industry.js")


def run(cmd, timeout=60):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout
    except Exception:
        return ""


def list_sessions(limit=80):
    """调用 hermes sessions list,解析出 [{title, id, last_active}]。"""
    out = run(["hermes", "sessions", "list", "--limit", str(limit)])
    if not out:
        return []
    sessions = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        # session id 形如 cron_xxx 或 数字_十六进制,在行末
        m = re.search(r"\b(\w*?\d[\w-]*|[a-f0-9]+_[a-f0-9]+)\s*$", line)
        sid = m.group(1) if m else ""
        # 标题是去掉 id 后剩下的部分
        title = re.sub(re.escape(sid) + r"\s*$", "", line).strip() if sid else line
        sessions.append({"title": title, "id": sid})
    return sessions


def get_session(session_id):
    """获取单个 session 的完整 messages。"""
    if not session_id:
        return None
    out = run(["hermes", "sessions", "get", session_id], timeout=120)
    if not out:
        return None
    try:
        return json.loads(out)
    except Exception:
        # 可能是别的格式,尝试找 JSON
        m = re.search(r"\{.*\}", out, re.S)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
        return None


def extract_json_block(content):
    """从 AI 输出里提取 ```json ... ``` 代码块里的 JSON。"""
    if not content:
        return None
    # 优先找 ```json 代码块
    m = re.search(r"```json\s*(\{.*?\})\s*```", content, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 兜底:找任意 ``` 代码块
    for m in re.finditer(r"```\s*(\{.*?\})\s*```", content, re.S):
        try:
            return json.loads(m.group(1))
        except Exception:
            continue
    # 最后兜底:找裸 JSON(window.INDUSTRY = {...};)
    m = re.search(r"window\.INDUSTRY\s*=\s*(\{.*?\})\s*;?", content, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None


def extract_last_assistant(session):
    """提取 session 里最后一条 assistant 的完整内容。"""
    msgs = session.get("messages", []) if session else []
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                c.get("text", "") if isinstance(c, dict) else str(c) for c in content
            )
        content = str(content).strip()
        if len(content) >= 80:
            return content
    return ""


def main():
    print("查找产业雷达 Hermes session...", flush=True)
    sessions = list_sessions(limit=100)
    if not sessions:
        print("⚠ 未找到任何 Hermes session,保留旧 industry.js 不更新。请先运行 agent/industry-radar.md 任务。", flush=True)
        return
    # 匹配产业雷达相关 session(标题含"产业"/"供需"/"雷达"/"industry")
    keywords = ["产业雷达", "供需", "产业分析", "industry-radar", "industry", "涨价"]
    matched = []
    for s in sessions:
        t = s.get("title", "")
        if any(k in t for k in keywords):
            matched.append(s)
    # 没匹配到就用最近的几个 session 碰运气(按 last_active 倒序已由 list 保证)
    candidates = matched if matched else sessions[:8]
    print(f"  候选 session: {len(candidates)} 个", flush=True)

    found_json = None
    used_title = ""
    for s in candidates:
        sid = s.get("id", "")
        if not sid:
            continue
        print(f"  检查 session: {s.get('title', '')[:30]} ({sid[:20]})", flush=True)
        sess = get_session(sid)
        if not sess:
            continue
        content = extract_last_assistant(sess)
        if not content:
            continue
        j = extract_json_block(content)
        if j and j.get("directions"):
            found_json = j
            used_title = s.get("title", "")
            break

    if not found_json:
        print("⚠ 未在候选 session 中找到含 directions 的产业分析 JSON,保留旧 industry.js 不更新。", flush=True)
        print("  请确认 agent/industry-radar.md 任务已运行且输出了 JSON 代码块。", flush=True)
        return

    # 写回 industry.js
    header = (
        "/* 产业雷达数据：供需紧张/涨价方向调研\n"
        f" * 由 Hermes Agent 按 agent/industry-radar.md 分析生成\n"
        f" * session: {used_title}\n"
        f" * 时点: {found_json.get('date', '')}\n"
        " * 数据来源: TrendForce/财联社/SMM/公司公告/研报等公开信息\n"
        " * 仅供研究参考,非投资建议。\n"
        " */\n"
    )
    content = header + "window.INDUSTRY = " + json.dumps(found_json, ensure_ascii=False, indent=2) + ";\n"
    tmp = OUT + ".tmp"
    open(tmp, "w", encoding="utf-8").write(content)
    os.replace(tmp, OUT)
    print(f"✅ 已从 session「{used_title}」导出产业雷达 → industry.js", flush=True)
    print(f"   方向数: {len(found_json.get('directions', []))} | 时点: {found_json.get('date', '')}", flush=True)


if __name__ == "__main__":
    main()
