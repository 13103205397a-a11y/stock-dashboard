#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Hermes Agent 的会话库导出最近的盘面复盘报告 → 写 reports.js

Hermes 跑着多个定时复盘任务（盘前简报/盘初热点/午间复盘/收盘复盘），
每次跑完生成一个 session，AI 产出的报告存在 session 的 messages 里。
本脚本挑每类复盘的最近一条，提取 AI 最后输出的报告全文，写成
window.REPORTS 供看板读取展示。

本地运行（Hermes 数据只在本机）： python3 scripts/fetch_hermes.py
需 hermes 命令行可用（已在 PATH 中）。
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "reports.js")

# 复盘类型 → 用于匹配 session 标题的关键词（取标题命中且最近的一条）
REPORT_TYPES = [
    ("盘前简报", "每日盘前简报"),
    ("盘初热点", "盘初热点扫描"),
    ("午间复盘", "午间复盘"),
    ("收盘复盘", "收盘复盘"),
]

PROCESS_OPENERS = re.compile(
    r"^(?:I(?:'ll| will) (?:generate|prepare)|I (?:now )?have all the data|"
    r"Let me |All data verified|Here(?:'s| is) the |"
    r"现在我已经(?:获取|掌握).*(?:让我来|下面))",
    re.I,
)


def sanitize_report(content):
    """移除模型生成过程语，只保留面向用户的报告正文。"""
    lines = str(content or "").strip().splitlines()
    while lines and (not lines[0].strip() or PROCESS_OPENERS.search(lines[0].strip())):
        lines.pop(0)
    if lines and re.fullmatch(r"```(?:markdown|md)?", lines[0].strip(), re.I):
        lines.pop(0)
    if lines and lines[-1].strip() == "```":
        lines.pop()
    if lines and "数据完整度" in lines[0] and "全部正常" in lines[0] and re.search(r"缺失|未能|失败|暂缺|报错", lines[0]):
        lines[0] = re.sub(r"[\[［]全部正常[\]］]", "[部分缺失]", lines[0], count=1)
    return "\n".join(lines).strip()


def run(cmd, timeout=60):
    """运行子进程，返回 stdout。"""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout
    except Exception:
        return ""


def list_sessions(limit=80):
    """调用 hermes sessions list，解析出 [{title, id, last_active}]。

    list 输出是表格，但格式可能变；用正则尽量稳健地抓 标题 和 ID。
    session id 形如 cron_xxx 或 数字_十六进制，出现在每行末尾。
    """
    out = run(["hermes", "sessions", "list", "--limit", str(limit)])
    if not out:
        return []
    sessions = []
    for line in out.splitlines():
        # session id：cron_开头 或 时间戳_十六进制
        m = re.search(r"(cron_[a-f0-9_]+|\d{8}_[a-f0-9]+)\s*$", line.strip())
        if not m:
            continue
        sid = m.group(1)
        # 标题：取 id 左边、最右一个 tab/多空格分隔的文本
        title_part = line[: m.start()].strip()
        # 去掉 Preview 列内容（[IMPORTANT...] 这类）只留标题
        title = re.sub(r"\[.*$", "", title_part).strip() or title_part
        sessions.append({"title": title, "id": sid})
    return sessions


def export_session(sid):
    """导出单个 session 为 dict（JSONL 第一行）。"""
    out = run(["hermes", "sessions", "export", "--session-id", sid, "-"], timeout=90)
    if not out:
        return None
    try:
        return json.loads(out.splitlines()[0])
    except Exception:
        return None


def extract_report(session):
    """从 session 的 messages 里提取 AI 最后输出的报告全文。

    AI 的最终报告通常是最后一条 role=assistant 的 message，content 为报告 markdown。
    兼容 content 是 str 或 list[{text}] 两种结构。
    """
    msgs = session.get("messages", [])
    # 从后往前找最后一条 assistant 且内容足够长的
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = m.get("content", "")
        if isinstance(content, list):
            content = "\n".join(
                c.get("text", "") if isinstance(c, dict) else str(c) for c in content
            )
        content = sanitize_report(content)
        if re.search(r"provider quota limit|fallback chain was exhausted|HTTP 429|monthly usage quota", content, re.I):
            continue
        # 报告通常较长且有标题结构；过滤掉太短的过渡语（如"Let me compile..."）
        if len(content) >= 80:
            return content
    return ""


def ts_to_str(ts):
    """Unix 时间戳 → YYYY-MM-DD HH:MM。"""
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(float(ts)))
    except Exception:
        return ""


def main():
    sessions = list_sessions()
    if not sessions:
        print("✗ 未取到 Hermes 会话列表，确认 hermes 命令可用。", file=sys.stderr)
        sys.exit(1)

    reports = []
    for label, keyword in REPORT_TYPES:
        # 最新会话可能因额度/网络失败；逐条回退，直到找到最近一条有效正文。
        matches = [s for s in sessions if keyword in s["title"]]
        if not matches:
            print(f"· {label}: 未找到含「{keyword}」的会话，跳过。")
            continue
        match = sess = text = None
        for candidate in matches:
            candidate_session = export_session(candidate["id"])
            candidate_text = extract_report(candidate_session or {})
            if candidate_text:
                match, sess, text = candidate, candidate_session, candidate_text
                break
        if not match:
            print(f"· {label}: 最近 {len(matches)} 条会话均无有效正文，跳过。")
            continue
        reports.append({
            "type": label,
            "title": match["title"],
            "time": ts_to_str(sess.get("started_at")),
            "id": match["id"],
            "content": text,
        })
        print(f"✓ {label}: {match['title']} ({reports[-1]['time']}, {len(text)}字)")

    if not reports:
        print("✗ 未提取到任何报告。", file=sys.stderr)
        sys.exit(1)

    payload = {
        "updated": time.strftime("%Y-%m-%d %H:%M", time.localtime()),
        "reports": reports,
    }
    try:
        old = open(OUT, encoding="utf-8").read()
        marker = "window.REPORTS = "
        old_payload = json.loads(old[old.index(marker) + len(marker):].rsplit(";", 1)[0])
        if old_payload.get("reports") == reports:
            print("Hermes 复盘内容无变化，跳过写入。")
            return
    except Exception:
        pass
    header = (
        "/* Hermes Agent 盘面复盘报告（本机自动导出）\n"
        " * 数据来源：本地 Hermes sessions（盘前/盘初/午间/收盘复盘定时任务）。\n"
        " * 由 scripts/fetch_hermes.py 从本机 Hermes 会话库导出，非 GitHub Actions。\n"
        " * 仅供研究参考，非投资建议。\n */\n"
    )
    content = header + "window.REPORTS = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, OUT)
    print(f"\n完成：{len(reports)} 篇报告 → reports.js（{payload['updated']}）")


if __name__ == "__main__":
    main()
