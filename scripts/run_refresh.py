#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统一执行本地刷新计划。

默认遇到失败会继续执行后续步骤，最后用非 0 退出码标记存在失败。
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "scripts" / "refresh_plan.json"
LOCK_PATH = ROOT / ".refresh.lock"


def load_plan() -> list[dict]:
    with PLAN_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("refresh_plan.json 缺少 steps")
    for step in steps:
        if not isinstance(step, dict) or not step.get("name") or not isinstance(step.get("command"), list):
            raise ValueError("refresh_plan.json 中存在无效步骤")
        if not all(isinstance(x, str) and x for x in step["command"]):
            raise ValueError(f"{step.get('name', '未知步骤')} 的 command 必须是字符串数组")
    return steps


def acquire_refresh_lock():
    """持有返回的文件句柄即可维持跨进程互斥。"""
    lock_file = LOCK_PATH.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    lock_file.seek(0)
    lock_file.truncate()
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def env_with_iwencai() -> dict[str, str]:
    env = os.environ.copy()
    if env.get("IWENCAI_API_KEY") or sys.platform != "darwin":
        return env
    account = env.get("IWENCAI_KEYCHAIN_ACCOUNT", "Admin")
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-a", account, "-s", "iwencai-api-key", "-w"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        key = (result.stdout or "").strip()
        if key:
            env["IWENCAI_API_KEY"] = key
    except Exception:
        pass
    return env


def main() -> int:
    parser = argparse.ArgumentParser(description="股市看板本地全量刷新")
    parser.add_argument("--list", action="store_true", help="只列出刷新步骤")
    parser.add_argument("--stop-on-error", action="store_true", help="某一步失败后立即停止")
    args = parser.parse_args()

    steps = load_plan()
    if args.list:
        for i, step in enumerate(steps, 1):
            kind = "必需" if step.get("required", True) else "可选"
            requirement = f"，需 {step['requiresEnv']}" if step.get("requiresEnv") else ""
            print(f"{i}. [{kind}{requirement}] {step['name']}: {' '.join(step['command'])}")
        return 0

    env = env_with_iwencai()
    lock_file = acquire_refresh_lock()
    if lock_file is None:
        print("✗ 已有刷新任务正在运行，本次未启动。", file=sys.stderr, flush=True)
        return 2
    required_failed: list[str] = []
    optional_failed: list[str] = []
    skipped: list[str] = []
    try:
        for step in steps:
            name = step["name"]
            cmd = step["command"]
            timeout = int(step.get("timeout") or 300)
            required = bool(step.get("required", True))
            required_env = step.get("requiresEnv")
            if required_env and not env.get(required_env):
                print(f"↷ {name} 跳过：未设置 {required_env}", flush=True)
                skipped.append(name)
                continue
            print(f"▶ {name}", flush=True)
            try:
                result = subprocess.run(
                    cmd,
                    cwd=ROOT,
                    env=env,
                    text=True,
                    capture_output=True,
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired:
                print(f"✗ {name} 超时({timeout}s){' [必需]' if required else ' [可选]'}", flush=True)
                (required_failed if required else optional_failed).append(name)
                if args.stop_on_error and required:
                    break
                continue
            except Exception as e:
                print(f"✗ {name} 异常: {e}{' [必需]' if required else ' [可选]'}", flush=True)
                (required_failed if required else optional_failed).append(name)
                if args.stop_on_error and required:
                    break
                continue

            if result.returncode == 0:
                tail = (result.stdout or "").strip().splitlines()[-1:] or []
                print(f"✓ {name} 完成" + (f" · {tail[0][:120]}" if tail else ""), flush=True)
            else:
                err = ((result.stderr or result.stdout or "").strip().splitlines()[-1:] or ["未知错误"])[0]
                print(f"✗ {name} 失败: {err[:160]}{' [必需]' if required else ' [可选]'}", flush=True)
                (required_failed if required else optional_failed).append(name)
                if args.stop_on_error and required:
                    break
    finally:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()

    if optional_failed:
        print("可选步骤失败（旧数据已保留）: " + "、".join(optional_failed), flush=True)
    if skipped:
        print("跳过步骤: " + "、".join(skipped), flush=True)
    if required_failed:
        print("刷新失败，必需步骤: " + "、".join(required_failed), flush=True)
        return 1
    print("刷新完成" + ("（存在可选步骤告警）" if optional_failed else ""), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
