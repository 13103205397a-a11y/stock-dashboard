#!/usr/bin/env python3
"""按公开资源清单构建 GitHub Pages 目录。"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "public_files.json"


def load_manifest() -> dict:
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    required = data.get("required")
    optional = data.get("localOptional")
    if data.get("schemaVersion") != 1 or not isinstance(required, list) or not isinstance(optional, list):
        raise ValueError("public_files.json 协议无效")
    names = required + optional
    if any(not isinstance(name, str) or not name or Path(name).name != name for name in names):
        raise ValueError("公开资源清单只允许仓库根目录文件名")
    if len(names) != len(set(names)):
        raise ValueError("公开资源清单存在重复文件")
    return data


def build_site(output: Path) -> list[str]:
    output = output.resolve()
    if output in {ROOT.resolve(), ROOT.parent.resolve()}:
        raise ValueError("构建目录不能是仓库根目录或其父目录")
    manifest = load_manifest()
    required = manifest["required"]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        raise FileNotFoundError("Pages 必需公开资源缺失: " + ", ".join(missing))
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in required:
        shutil.copy2(ROOT / name, output / name)
    (output / ".nojekyll").touch()
    return required


def main() -> int:
    parser = argparse.ArgumentParser(description="构建股市看板公开站点")
    parser.add_argument("output", nargs="?", default=str(ROOT / "_site"))
    args = parser.parse_args()
    files = build_site(Path(args.output))
    print(f"public site ok: {len(files)} files -> {Path(args.output).resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
