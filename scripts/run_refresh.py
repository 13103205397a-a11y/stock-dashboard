#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统一执行本地刷新计划。

默认遇到失败会继续执行后续步骤，最后用非 0 退出码标记存在失败。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "scripts" / "refresh_plan.json"


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
            print(f"{i}. {step['name']}: {' '.join(step['command'])}")
        return 0

    env = env_with_iwencai()
    failed: list[str] = []
    for step in steps:
        name = step["name"]
        cmd = step["command"]
        timeout = int(step.get("timeout") or 300)
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
            print(f"✗ {name} 超时({timeout}s)", flush=True)
            failed.append(name)
            if args.stop_on_error:
                break
            continue
        except Exception as e:
            print(f"✗ {name} 异常: {e}", flush=True)
            failed.append(name)
            if args.stop_on_error:
                break
            continue

        if result.returncode == 0:
            tail = (result.stdout or "").strip().splitlines()[-1:] or []
            print(f"✓ {name} 完成" + (f" · {tail[0][:120]}" if tail else ""), flush=True)
        else:
            err = ((result.stderr or result.stdout or "").strip().splitlines()[-1:] or ["未知错误"])[0]
            print(f"✗ {name} 失败: {err[:160]}", flush=True)
            failed.append(name)
            if args.stop_on_error:
                break

    if failed:
        print("刷新结束，失败步骤: " + "、".join(failed), flush=True)
        return 1
    print("全部完成", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
