#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""data.js 的共享读写模块（Python 端）。

- 用 json.loads 替代 eval：data.js 的 STOCKS 部分由 fetch_signals.js 的
  JSON.stringify 写入，是合法 JSON，无需也不应再用 eval。
- 跨语言文件锁：与 fetch_signals.js（Node）共用同一锁协议（锁文件 + PID），
  防止 Python 脚本与 Node 脚本并发写 data.js 互相覆盖。
- 原子写：先写 .tmp 再 os.replace，防中断导致文件截断。

锁协议（与 fetch_signals.js 保持一致，勿单独修改）：
  锁文件路径 = data.js 同级 ".data.lock"
  获取：O_CREAT|O_EXCL 创建，成功则写入本进程 PID
  冲突：读 PID，若进程已不存活则强占（删后重建）；否则等待，超时报错
  释放：删除锁文件
"""
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA = os.path.join(PROJ, "data.js")
LOCK = os.path.join(PROJ, ".data.lock")

_LOCK_TIMEOUT = 30   # 秒
_LOCK_POLL = 0.2     # 秒


def sanitize_square_brackets(text):
    """修复「【】」截断：移除无左括号的右括号，并补齐未闭合的左括号。"""
    if not isinstance(text, str) or not text:
        return text
    out = []
    depth = 0
    for char in text:
        if char == "【":
            depth += 1
            out.append(char)
        elif char == "】":
            if depth > 0:
                depth -= 1
                out.append(char)
        else:
            out.append(char)
    if depth:
        out.extend("】" * depth)
    return "".join(out)


def sanitize_stock_news(stocks):
    """在统一写盘层清理新闻文本，防止任一采集源绕过入口校验。"""
    changed = 0
    for stock in stocks if isinstance(stocks, list) else []:
        for item in stock.get("news", []) if isinstance(stock, dict) else []:
            if not isinstance(item, dict):
                continue
            for key in ("title", "summary", "content"):
                original = item.get(key)
                cleaned = sanitize_square_brackets(original)
                if cleaned != original:
                    item[key] = cleaned
                    changed += 1
    return changed


def _pid_alive(pid):
    """PID 对应进程是否仍在运行（os.kill(pid, 0) 探活）。"""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def acquire_lock(timeout=_LOCK_TIMEOUT):
    """获取 data.js 排他锁。超时抛 RuntimeError。"""
    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return
        except FileExistsError:
            try:
                pid = int(open(LOCK, encoding="utf-8").read().strip())
            except (ValueError, OSError):
                pid = 0
            if not _pid_alive(pid):
                # 持有者已退出，强占
                try:
                    os.unlink(LOCK)
                except FileNotFoundError:
                    pass
                continue
            if time.time() > deadline:
                raise RuntimeError(
                    f"获取 data.js 锁超时（{timeout}s），PID {pid} 仍持有")
            time.sleep(_LOCK_POLL)


def release_lock():
    """释放锁。"""
    try:
        os.unlink(LOCK)
    except FileNotFoundError:
        pass


class DataLock:
    """with DataLock(): ... 上下文管理器，自动获取/释放锁。"""

    def __enter__(self):
        acquire_lock()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        release_lock()
        return False


def _slice_stocks_array(txt):
    """定位 txt 中 window.STOCKS = [ ... ] 的数组区间，返回 (brace, end)。

    括号深度计数时跳过 JSON 字符串内部字符——新闻标题中可能出现
    不成对的 [ 或 ]，按裸字符计数会切错区间、写坏 data.js。
    """
    start = txt.index("window.STOCKS")
    brace = txt.index("[", start)
    depth, end = 0, brace
    in_string = False
    escaped = False
    for i in range(brace, len(txt)):
        char = txt[i]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if depth != 0 or end == brace:
        raise ValueError("data.js 的 window.STOCKS 数组未正确闭合，拒绝切片以免写坏文件")
    return brace, end


def load_stocks():
    """读 data.js 的 STOCKS 数组（json.loads，非 eval）。"""
    txt = open(DATA, encoding="utf-8").read()
    brace, end = _slice_stocks_array(txt)
    return json.loads(txt[brace:end])


def write_stocks(stocks):
    """原子写回 data.js（保留头部注释与其他 window.* 字段）。"""
    sanitize_stock_news(stocks)
    txt = open(DATA, encoding="utf-8").read()
    brace, end = _slice_stocks_array(txt)
    new_txt = txt[:brace] + json.dumps(stocks, ensure_ascii=False, indent=2) + txt[end:]
    tmp = DATA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(new_txt)
    os.replace(tmp, DATA)
