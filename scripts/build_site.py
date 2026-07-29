#!/usr/bin/env python3
"""按核心资源清单和活跃模块清单构建 GitHub Pages 目录。"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "public_files.json"


def _safe_root_name(name: object, *, source: str) -> str:
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise ValueError(f"{source} 只允许仓库根目录文件名")
    return name


def load_manifest() -> tuple[dict, dict]:
    public = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    required = public.get("required")
    modules_name = public.get("activeModules")
    if public.get("schemaVersion") != 2 or not isinstance(required, list):
        raise ValueError("public_files.json 协议无效")
    _safe_root_name(modules_name, source="activeModules")
    if modules_name not in required:
        raise ValueError("active_modules.json 必须属于公开核心资源")
    core_names = [_safe_root_name(name, source="公开资源清单") for name in required]
    if len(core_names) != len(set(core_names)):
        raise ValueError("公开资源清单存在重复文件")

    modules_path = ROOT / modules_name
    modules = json.loads(modules_path.read_text(encoding="utf-8"))
    entries = modules.get("modules")
    if modules.get("schemaVersion") != 1 or not isinstance(entries, list) or not entries:
        raise ValueError("active_modules.json 协议无效")
    module_files = [_safe_root_name(entry.get("file"), source="活跃模块清单")
                    for entry in entries if isinstance(entry, dict)]
    if len(module_files) != len(entries):
        raise ValueError("active_modules.json 中存在无效模块")
    if len(module_files) != len(set(module_files)):
        raise ValueError("active_modules.json 存在重复文件")
    if set(module_files) & set(core_names):
        raise ValueError("核心资源与活跃模块文件重复")
    return public, modules


def public_files() -> list[str]:
    public, modules = load_manifest()
    return [*public["required"], *(entry["file"] for entry in modules["modules"])]


def build_site(output: Path) -> list[str]:
    output = output.resolve()
    if output in {ROOT.resolve(), ROOT.parent.resolve()}:
        raise ValueError("构建目录不能是仓库根目录或其父目录")
    files = public_files()
    missing = [name for name in files if not (ROOT / name).is_file()]
    if missing:
        raise FileNotFoundError("Pages 必需公开资源缺失: " + ", ".join(missing))
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in files:
        shutil.copy2(ROOT / name, output / name)
    (output / ".nojekyll").touch()
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="构建股市看板公开站点")
    parser.add_argument("output", nargs="?", default=str(ROOT / "_site"))
    parser.add_argument(
        "--list-files",
        action="store_true",
        help="逐行输出公开构建和线上探针使用的同一份文件清单",
    )
    args = parser.parse_args()
    if args.list_files:
        print("\n".join(public_files()))
        return 0
    files = build_site(Path(args.output))
    print(f"public site ok: {len(files)} files -> {Path(args.output).resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
