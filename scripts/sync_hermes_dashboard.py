#!/usr/bin/env python3
"""导出活跃 Hermes 模块，并从隔离 worktree 防回滚发布本轮成功文件。"""
from __future__ import annotations

import fcntl
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import sanitize_ai_content


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_MODULES_PATH = ROOT / "active_modules.json"
LOCK = "/tmp/stock-dashboard-hermes-sync.lock"
MAX_PUBLISH_ATTEMPTS = 3


class SnapshotRollbackError(RuntimeError):
    """候选快照不比远端新，拒绝覆盖。"""


def exporter_command(hermes: dict) -> list[str]:
    """把清单中的导出器规范化为安全的仓库内脚本命令。"""
    raw = hermes.get("exporter")
    command = [raw] if isinstance(raw, str) else raw
    if (
        not isinstance(command, list) or not command or
        not all(isinstance(part, str) and part for part in command)
    ):
        raise ValueError("Hermes exporter 必须是脚本路径或非空命令数组")
    script = Path(command[0])
    if script.is_absolute() or ".." in script.parts or script.parts[:1] != ("scripts",):
        raise ValueError("Hermes exporter 必须位于 scripts/")
    return command


def run(command, *, cwd=ROOT, check=False, timeout=300):
    result = subprocess.run(
        command, cwd=str(cwd), text=True, capture_output=True, timeout=timeout,
    )
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode and result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if check and result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"命令失败: {' '.join(command)}{': ' + detail if detail else ''}")
    return result


def load_sync_modules() -> list[dict]:
    manifest = json.loads(ACTIVE_MODULES_PATH.read_text(encoding="utf-8"))
    modules = manifest.get("modules")
    if manifest.get("schemaVersion") != 1 or not isinstance(modules, list):
        raise ValueError("active_modules.json 协议无效")
    sync_modules = []
    for module in modules:
        hermes = module.get("hermes") if isinstance(module, dict) else None
        if not hermes or hermes.get("publishMode") != "sync":
            continue
        marker = hermes.get("successMarker")
        timestamp_fields = hermes.get("timestampFields")
        if (
            not isinstance(marker, str) or not marker or
            not isinstance(timestamp_fields, list) or not timestamp_fields or
            not all(isinstance(field, str) and field for field in timestamp_fields)
        ):
            raise ValueError(f"active_modules.json: {module.get('id', '未知')} Hermes 发布配置无效")
        try:
            exporter_command(hermes)
        except ValueError as error:
            raise ValueError(
                f"active_modules.json: {module.get('id', '未知')} Hermes 发布配置无效: {error}"
            ) from error
        sync_modules.append(module)
    return sync_modules


def export_current_run() -> list[str]:
    """只返回本轮明确提取成功且产物存在的模块文件。"""
    successful: list[str] = []
    for module in load_sync_modules():
        hermes = module["hermes"]
        label = module.get("label") or module["id"]
        print(f"→ 导出{label}")
        result = run([sys.executable, *exporter_command(hermes)])
        output = f"{result.stdout}\n{result.stderr}"
        output_path = ROOT / module["file"]
        if result.returncode:
            print(f"⚠ {label}导出失败，本轮不发布旧快照。", file=sys.stderr)
            continue
        if hermes["successMarker"] not in output or not output_path.is_file():
            print(f"⚠ {label}本轮没有成功提取新快照，不发布历史文件。", file=sys.stderr)
            continue
        sanitize_ai_content.sanitize_file(output_path)
        successful.append(module["file"])
    return successful


def _parse_timestamp(value: str) -> datetime | None:
    normalized = value.strip().replace("/", "-")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def snapshot_timestamp(path: Path, fields: list[str]) -> datetime | None:
    if not path.is_file():
        return None
    content = path.read_text(encoding="utf-8")
    for field in fields:
        pattern = re.compile(
            rf"""["']{re.escape(field)}["']\s*:\s*["']([^"']+)["']""",
            re.I,
        )
        timestamps = [
            parsed for match in pattern.finditer(content)
            if (parsed := _parse_timestamp(match.group(1))) is not None
        ]
        # 字段按清单中的优先级取值，避免嵌套对象里较晚的普通 date
        # 越过顶层 generatedAt，错误放行旧快照。
        if timestamps:
            return max(timestamps)
    return None


def _fingerprint(path: Path) -> str | None:
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_not_rollback(local: Path, remote: Path, fields: list[str]) -> bool:
    """返回是否需要复制；旧于或同时间但内容不同的快照会被拒绝。"""
    if _fingerprint(local) == _fingerprint(remote):
        return False
    local_timestamp = snapshot_timestamp(local, fields)
    remote_timestamp = snapshot_timestamp(remote, fields)
    if local_timestamp is None:
        raise SnapshotRollbackError(f"{local.name}: 本地快照缺少可比较时间戳")
    if remote_timestamp is not None and local_timestamp < remote_timestamp:
        raise SnapshotRollbackError(
            f"{local.name}: 本地 {local_timestamp} 早于远端 {remote_timestamp}"
        )
    if remote_timestamp is not None and local_timestamp == remote_timestamp:
        raise SnapshotRollbackError(
            f"{local.name}: 时间戳与远端相同但内容不同，拒绝不确定覆盖"
        )
    return True


def publish_public_files(candidates: list[str]) -> list[str]:
    """基于最新 origin/main 隔离发布，仅复制本轮成功且更新的候选文件。"""
    if not candidates:
        print("✓ 本轮没有成功导出的 Hermes 文件，跳过发布。")
        return []

    module_by_file = {module["file"]: module for module in load_sync_modules()}
    unknown = sorted(set(candidates) - set(module_by_file))
    if unknown:
        raise ValueError("非活跃 Hermes 发布文件: " + ", ".join(unknown))
    candidates = list(dict.fromkeys(candidates))

    last_error = None
    for attempt in range(1, MAX_PUBLISH_ATTEMPTS + 1):
        print(f"→ 发布本轮 Hermes 数据（第 {attempt}/{MAX_PUBLISH_ATTEMPTS} 次）")
        run(["git", "fetch", "origin", "main"], check=True)
        with tempfile.TemporaryDirectory(prefix="stock-dashboard-publish-") as temp:
            worktree = Path(temp) / "repo"
            run(["git", "worktree", "add", "--detach", str(worktree), "origin/main"], check=True)
            try:
                safe_candidates = []
                for name in candidates:
                    fields = module_by_file[name]["hermes"]["timestampFields"]
                    if assert_not_rollback(ROOT / name, worktree / name, fields):
                        shutil.copy2(ROOT / name, worktree / name)
                        safe_candidates.append(name)
                if not safe_candidates:
                    print("✓ 远端 Hermes 数据已是最新，无需发布。")
                    return []

                run(["node", "scripts/validate_data.js"], cwd=worktree, check=True)
                changed = run(
                    ["git", "diff", "--name-only", "--", *safe_candidates],
                    cwd=worktree,
                    check=True,
                ).stdout.splitlines()
                if not changed:
                    print("✓ 远端 Hermes 数据已是最新，无需发布。")
                    return []
                run(["git", "add", "--", *changed], cwd=worktree, check=True)
                stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
                run([
                    "git", "-c", "user.name=stock-dashboard",
                    "-c", "user.email=stock-dashboard@users.noreply.github.com",
                    "commit", "-m", f"Hermes 数据同步 {stamp}",
                ], cwd=worktree, check=True)
                pushed = run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
                if pushed.returncode == 0:
                    print(f"✓ 已发布本轮 Hermes 数据: {', '.join(changed)}")
                    return changed
                last_error = pushed.stderr.strip() or "git push 失败"
                print(f"远端在发布期间发生变化，将重试：{last_error}", file=sys.stderr)
            except SnapshotRollbackError:
                raise
            finally:
                run(["git", "worktree", "remove", "--force", str(worktree)])
    raise RuntimeError(f"连续 {MAX_PUBLISH_ATTEMPTS} 次发布失败: {last_error or '未知错误'}")


def main():
    with open(LOCK, "w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("已有 Hermes 同步任务运行，跳过。")
            return

        successful = export_current_run()
        if not successful:
            print("本轮 Hermes 无成功导出，不清理、不校验、不发布历史快照。")
            return
        print("→ 校验公开数据与内容质量")
        run(["node", "scripts/validate_data.js"], check=True)
        publish_public_files(successful)


if __name__ == "__main__":
    main()
