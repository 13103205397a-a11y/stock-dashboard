#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Hermes Agent 会话库导出最新的「持仓综合分析」→ 写 portfolio_analysis.js。

Hermes 按 agent/portfolio_analysis.md 的 prompt 对 portfolio.json 中的持仓
做五维度综合分析（基本面/资金面/技术面/风险/噪音过滤），最终输出一个 JSON
数组代码块。本脚本从对应 session 提取该 JSON 数组，写入 portfolio_analysis.js
（window.PORTFOLIO_ANALYSIS）。

数据来源：本机 Hermes sessions（持仓分析定时任务），非 GitHub Actions。
本地运行： python3 scripts/fetch_portfolio_analysis.py
需 hermes 命令行可用（已在 PATH 中）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
OUT = os.path.join(PROJ, "portfolio_analysis.js")
PORTFOLIO_JSON = os.path.join(PROJ, "portfolio.json")


def run(cmd, timeout=60):
    """运行子进程，返回 stdout。失败返回空串（不抛异常）。"""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout
    except Exception:
        return ""


def load_holdings():
    """读取 portfolio.json 的 holdings 列表。没有文件或无持仓返回 []。"""
    if not os.path.exists(PORTFOLIO_JSON):
        return []
    try:
        with open(PORTFOLIO_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("holdings", []) or []
    except Exception:
        return []


def list_sessions(limit=80):
    """调用 hermes sessions list，解析出 [{title, id}]。

    list 输出是表格，格式可能变；用正则抓末尾的 session id（cron_xxx 或
    时间戳_十六进制），标题取 id 左侧文本。
    """
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
    """获取单个 session 的完整 messages。

    优先用 `hermes sessions get`（与 fetch_industry_ai.py 一致）；
    失败则 fallback 到 `hermes sessions export --session-id <id> -`。
    """
    if not session_id:
        return None
    # 优先 get
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
    # fallback: export 到 stdout（JSONL 第一行）
    out = run(
        ["hermes", "sessions", "export", "--session-id", session_id, "-"],
        timeout=120,
    )
    if not out:
        return None
    try:
        return json.loads(out.splitlines()[0])
    except Exception:
        return None


def _content_to_str(content):
    """把 message.content 统一成 str（兼容 list[{text}] 结构）。"""
    if isinstance(content, list):
        return "\n".join(
            c.get("text", "") if isinstance(c, dict) else str(c) for c in content
        )
    return str(content).strip() if content else ""


def extract_last_assistant(session):
    """提取 session 里最后一条 assistant 的完整内容（用于日志/兜底）。

    注意：agent 最终的 JSON 不一定在最后一条 assistant 里（可能后面还跟了
    验证总结、commit 说明等），所以本函数只用于调试；正式提取 JSON 用
    extract_analyses_from_session，它会从后往前扫所有 assistant 消息。
    """
    msgs = session.get("messages", []) if session else []
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = _content_to_str(m.get("content", ""))
        if len(content) >= 80:
            return content
    return ""


def extract_analyses_from_session(session):
    """从后往前扫 assistant 与文件读取结果，提取有效持仓分析 JSON。

    agent 跑完后可能继续输出验证总结/commit 说明，真正的 JSON 代码块往往
    在倒数第 2~3 条 assistant 里。所以不能只看最后一条，要逐条尝试。

    返回 (analyses_list, found_json, matched_content_snippet) 或 (None, None, "")。
    """
    msgs = session.get("messages", []) if session else []
    for m in reversed(msgs):
        role = m.get("role")
        if role not in ("assistant", "tool"):
            continue
        content = _content_to_str(m.get("content", ""))
        if role == "tool":
            try:
                decoded = json.loads(content)
                content = decoded.get("content", content) if isinstance(decoded, dict) else content
            except Exception:
                pass
            content = re.sub(r"(?m)^\s*\d+\|", "", content)
            if "window.PORTFOLIO_ANALYSIS" not in content and '"analyses"' not in content:
                continue
        if len(content) < 20:
            continue
        marker = "window.PORTFOLIO_ANALYSIS = "
        if marker in content:
            try:
                j = json.loads(content[content.index(marker) + len(marker):].rsplit(";", 1)[0])
            except Exception:
                j = extract_json_block(content)
        else:
            j = extract_json_block(content)
        if j is None:
            continue
        analyses, _ = normalize_analyses(j)
        if analyses:
            snippet = content[:80].replace("\n", " ")
            return analyses, j, snippet
    return None, None, ""


def extract_json_block(content):
    """从 AI 输出里提取 JSON（兼容数组 [...] 和对象 {...}）。

    优先 ```json 代码块 → 任意 ``` 代码块 → 裸 JSON。
    """
    if not content:
        return None
    # 1. ```json 代码块
    for m in re.finditer(r"```json\s*([\s\S]*?)\s*```", content):
        text = m.group(1).strip()
        try:
            return json.loads(text)
        except Exception:
            continue
    # 2. 任意 ``` 代码块
    for m in re.finditer(r"```[a-zA-Z]*\s*([\s\S]*?)\s*```", content):
        text = m.group(1).strip()
        try:
            return json.loads(text)
        except Exception:
            continue
    # 3. 裸 JSON 数组（持仓分析输出的是数组）
    m = re.search(r"\[\s*\{.*?\}\s*\]", content, re.S)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    # 4. 裸 JSON 对象
    m = re.search(r"\{.*\}", content, re.S)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return None


def normalize_analyses(found):
    """把提取到的 JSON 归一为 analyses 列表。

    - list → 直接用
    - dict 含 analyses → 取 analyses
    - dict 单条 → 包成 [dict]
    """
    if found is None:
        return [], None
    if isinstance(found, list):
        # 过滤掉非 dict 或缺 code 的项
        return [x for x in found if isinstance(x, dict) and x.get("code")], None
    if isinstance(found, dict):
        if "analyses" in found and isinstance(found["analyses"], list):
            return [x for x in found["analyses"] if isinstance(x, dict) and x.get("code")], found.get("updated")
        if found.get("code"):
            return [found], None
    return [], None


def main():
    # 0. 前置检查：hermes 是否可用
    if not shutil.which("hermes"):
        print("✗ 未找到 hermes 命令，本脚本仅在本机 Hermes 环境运行，跳过。", file=sys.stderr)
        return

    # 1. 读取持仓列表
    holdings = load_holdings()
    if not holdings:
        print("· portfolio.json 无持仓或文件不存在，跳过持仓分析导出。")
        return
    holding_codes = [h.get("code", "") for h in holdings if h.get("code")]
    print(f"· 当前持仓 {len(holdings)} 只：{', '.join(holding_codes)}", flush=True)

    # 2. 列出 sessions
    print("查找持仓综合分析 Hermes session...", flush=True)
    sessions = list_sessions(limit=100)
    if not sessions:
        print("⚠ 未找到任何 Hermes session，保留旧 portfolio_analysis.js 不更新。", flush=True)
        print("  请先运行 agent/portfolio_analysis.md 任务。", flush=True)
        return

    # 3. 匹配持仓分析相关 session
    keywords = [
        "持仓分析", "持仓综合分析", "持仓诊断", "portfolio_analysis",
        "portfolio", "持仓", "买卖点",
    ]
    matched = [s for s in sessions if any(k in s.get("title", "") for k in keywords)]
    candidates = matched if matched else sessions[:8]
    print(f"  候选 session: {len(candidates)} 个（标题匹配 {len(matched)} 个）", flush=True)

    # 4. 逐个 session 查找含 analyses 的 JSON
    found_json = None
    used_title = ""
    used_snippet = ""
    for s in candidates:
        sid = s.get("id", "")
        if not sid:
            continue
        print(f"  检查 session: {s.get('title', '')[:30]} ({sid[:20]})", flush=True)
        sess = get_session(sid)
        if not sess:
            continue
        # 从后往前扫所有 assistant 消息找 JSON（agent 最后一条可能是验证总结）
        analyses, j, snippet = extract_analyses_from_session(sess)
        if analyses:
            found_json = j
            used_title = s.get("title", "")
            used_snippet = snippet
            break

    if found_json is None:
        print("⚠ 未在候选 session 中找到持仓分析 JSON，保留旧 portfolio_analysis.js 不更新。", flush=True)
        print("  请确认 agent/portfolio_analysis.md 任务已运行且输出了 JSON 代码块。", flush=True)
        return

    # 重新归一化（extract_analyses_from_session 已校验过，这里再取一次 updated）
    analyses, updated_from_json = normalize_analyses(found_json)
    if not analyses:
        print("⚠ 提取到的 JSON 无有效持仓分析条目（缺 code 字段），保留旧文件不更新。", flush=True)
        return
    print(f"  ✓ 命中 JSON（来源消息开头: {used_snippet}）", flush=True)

    # 5. 对比持仓列表，提示哪些没被分析到
    analyzed_codes = {a.get("code", "") for a in analyses}
    missing = [c for c in holding_codes if c not in analyzed_codes]
    if missing:
        print(
            f"  ⚠ 分析结果不完整，缺少持仓：{', '.join(missing)}；保留旧文件不覆盖。",
            flush=True,
        )
        return

    # 6. 写回 portfolio_analysis.js
    updated = updated_from_json or time.strftime("%Y-%m-%d %H:%M", time.localtime())
    payload = {"updated": updated, "analyses": analyses}

    header = (
        "/* Hermes Agent 持仓综合分析（本机自动导出）\n"
        " * 数据来源：本地 Hermes sessions（持仓综合分析定时任务）。\n"
        " * 由 scripts/fetch_portfolio_analysis.py 从本机 Hermes 会话库导出，非 GitHub Actions。\n"
        f" * session: {used_title}\n"
        " * 仅供研究参考，非投资建议。\n"
        " */\n"
    )
    content = (
        header
        + "window.PORTFOLIO_ANALYSIS = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, OUT)

    print(f"\n✅ 已从 session「{used_title}」导出持仓分析 → portfolio_analysis.js", flush=True)
    print(f"   分析条数: {len(analyses)} | 更新时点: {updated}", flush=True)
    # 简要预览每只评级
    for a in analyses:
        print(
            f"   - {a.get('code', '')} {a.get('name', '')}: "
            f"{a.get('rating', '?')} (score {a.get('score', '?')})",
            flush=True,
        )


if __name__ == "__main__":
    main()
