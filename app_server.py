#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股市看板 · 本地 App 服务器

功能：
1. 托管看板网页（本地访问 http://localhost:8787）
2. 提供「刷新数据」API → 按活跃刷新计划更新行情、信号和个股新闻
3. 提供「打开看板」→ 自动用浏览器打开

用法：
  python3 app_server.py            # 启动服务器并打开看板
  python3 app_server.py --no-open  # 只启动不打开浏览器

数据刷新流程：读取 scripts/refresh_plan.json 统一执行。
全部本地运行，不依赖 GitHub。
"""
import errno
import http.client
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

from scripts.kimi_review import load_review

# 启动诊断日志(写到文件,排查卡在哪)
def _log_diag(msg):
    """按需写诊断日志，不保持文件句柄"""
    with open("/tmp/stock-dashboard-app.log", "a", encoding="utf-8") as f:
        f.write(f"[{os.getpid()}] {msg}\n")
_log_diag(f"app_server 启动, cwd={os.getcwd()}")

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ID = "stock-dashboard"
API_VERSION = 1
MAX_STATUS_BYTES = 64 * 1024


def _configured_port():
    raw = os.environ.get("STOCK_DASHBOARD_PORT", "8787")
    try:
        port = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("STOCK_DASHBOARD_PORT 必须是 1..65535 的整数") from exc
    if not 1 <= port <= 65535:
        raise ValueError("STOCK_DASHBOARD_PORT 必须是 1..65535 的整数")
    return port


PORT = _configured_port()
PUBLIC_FILES_PATH = os.path.join(HERE, "public_files.json")


def _load_public_static_files():
    """读取核心资源与当前启用模块，其他仓库文件一律不公开。"""
    with open(PUBLIC_FILES_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    active_name = manifest.get("activeModules")
    if (
        manifest.get("schemaVersion") != 2
        or not isinstance(active_name, str)
        or os.path.basename(active_name) != active_name
    ):
        raise ValueError("public_files.json 协议无效")
    active_path = os.path.join(HERE, active_name)
    with open(active_path, "r", encoding="utf-8") as f:
        active = json.load(f)
    modules = active.get("modules")
    if active.get("schemaVersion") != 1 or not isinstance(modules, list):
        raise ValueError("active_modules.json 协议无效")
    module_files = [module.get("file") for module in modules if isinstance(module, dict)]
    names = manifest.get("required", []) + module_files
    if not names or any(
        not isinstance(name, str) or not name or os.path.basename(name) != name for name in names
    ):
        raise ValueError("public_files.json 协议无效")
    return {"/" + name for name in names}


PUBLIC_STATIC_FILES = _load_public_static_files()

# 刷新状态（进程内共享）
refresh_state = {"running": False, "log": [], "done": False, "error": None, "failedSteps": []}
refresh_state_lock = threading.Lock()


def _valid_status_payload(data):
    """严格识别本项目本地服务，避免把同端口的其他 HTTP 服务当成看板。"""
    return (
        isinstance(data, dict)
        and data.get("appId") == APP_ID
        and type(data.get("apiVersion")) is int
        and data["apiVersion"] == API_VERSION
        and type(data.get("running")) is bool
        and type(data.get("done")) is bool
        and isinstance(data.get("log"), list)
        and all(isinstance(item, str) for item in data["log"])
        and (data.get("error") is None or isinstance(data.get("error"), str))
        and isinstance(data.get("failedSteps"), list)
        and all(isinstance(item, str) for item in data["failedSteps"])
    )


def _probe_existing_server(port, timeout=1.0):
    """直连回环地址并核验状态协议；不经过系统 HTTP 代理。"""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request(
            "GET",
            "/api/status",
            headers={
                "Accept": "application/json",
                "Host": f"127.0.0.1:{port}",
            },
        )
        response = connection.getresponse()
        if response.status != 200 or response.headers.get_content_type() != "application/json":
            return False
        raw = response.read(MAX_STATUS_BYTES + 1)
        if len(raw) > MAX_STATUS_BYTES:
            return False
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
        return _valid_status_payload(payload)
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def _load_xbriefs_data(root=None):
    """解析项目根目录 xbriefs.js 中的 window.XBRIEFS（只读，损坏时返回空结构）。"""
    base = Path(root or HERE)
    path = base / "xbriefs.js"
    empty = {"updated": "", "generatedAt": "", "briefs": []}
    if not path.is_file():
        return empty
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return empty
    match = re.search(r"window\.XBRIEFS\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not match:
        return empty
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return empty
    if not isinstance(data, dict):
        return empty
    briefs = data.get("briefs")
    if not isinstance(briefs, list):
        data = {**data, "briefs": []}
    return data


def _xbrief_latest_payload(root=None):
    """供菜单栏读取的最新一期外围热点摘要。"""
    data = _load_xbriefs_data(root)
    briefs = data.get("briefs") or []
    raw = briefs[0] if briefs and isinstance(briefs[0], dict) else None
    latest = None
    if raw is not None:
        latest = {
            "id": raw.get("id") or "",
            "time": raw.get("time") or "",
            "title": raw.get("title") or "外围热点",
            "content": raw.get("content") or "",
            "period": raw.get("period") or "",
            "aiCount": raw.get("aiCount"),
            "marketCount": raw.get("marketCount"),
        }
    return {
        "ok": True,
        "updated": data.get("updated") or (latest or {}).get("time") or "",
        "generatedAt": data.get("generatedAt") or "",
        "latest": latest,
    }


def _kimi_latest_payload(root=None):
    """只在本机 API 中读取 Kimi Code 的最新 HTML 复盘。"""
    return load_review()


def _data_version(root=None):
    """返回本地页面需要关注的数据文件版本，供前端无缓存轮询。"""
    base = Path(root or HERE)
    names = {
        "data.js", "meta.js", "market.js", "logic.js", "events.js", "xbriefs.js",
        "weekend.js", "kimi_review.js",
    }
    stamps = []
    for name in names:
        path = base / name
        try:
            stamps.append(path.stat().st_mtime_ns)
        except OSError:
            continue
    return {"ok": True, "version": str(max(stamps) if stamps else 0)}


class Handler(http.server.SimpleHTTPRequestHandler):
    """仅托管看板运行必需文件，仓库内容默认不可访问。"""

    server_version = "StockDashboard"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        # 静态文件 no-cache + 安全头
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def _allowed_origins(self):
        port = self.server.server_address[1]
        return {
            f"http://localhost:{port}",
            f"http://127.0.0.1:{port}",
        }

    def _api_host_allowed(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        return host in {f"localhost:{port}", f"127.0.0.1:{port}"}

    def _require_api_host(self):
        if self._api_host_allowed():
            return True
        self.send_error(403, "Host not allowed")
        return False

    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin in self._allowed_origins()

    def _require_local_origin(self):
        if self._origin_allowed():
            return True
        self.send_error(403, "Origin not allowed")
        return False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._require_api_host():
            return
        if parsed.path == "/api/status":
            self._handle_status()
            return
        if parsed.path == "/api/xbrief/latest":
            self._handle_xbrief_latest()
            return
        if parsed.path == "/api/kimi-review/latest":
            self._handle_kimi_review()
            return
        if parsed.path == "/api/data-version":
            self._handle_data_version()
            return
        path = urllib.parse.unquote(parsed.path)
        if path == "/":
            path = "/index.html"
        if path not in PUBLIC_STATIC_FILES:
            self.send_error(404)
            return
        self.path = path
        super().do_GET()

    def do_HEAD(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path == "/":
            path = "/index.html"
        if path not in PUBLIC_STATIC_FILES:
            self.send_error(404)
            return
        self.path = path
        super().do_HEAD()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(404)
            return
        if not self._require_api_host():
            return
        if not self._require_local_origin():
            return
        if parsed.path == "/api/refresh":
            self._handle_refresh()
            return
        self.send_error(404)

    def _handle_refresh(self):
        with refresh_state_lock:
            if refresh_state["running"]:
                self._json({"ok": False, "msg": "刷新正在进行中，请等待"}, status=409)
                return
            refresh_state.update(running=True, log=[], done=False, error=None, failedSteps=[])
        threading.Thread(target=_run_refresh, daemon=True).start()
        self._json({"ok": True, "msg": "刷新已启动，查看 /api/status 获取进度"}, status=202)

    def _handle_status(self):
        self._json({
            "appId": APP_ID,
            "apiVersion": API_VERSION,
            "running": refresh_state["running"],
            "log": refresh_state["log"][-20:],
            "done": refresh_state["done"],
            "error": refresh_state["error"],
            "failedSteps": refresh_state["failedSteps"],
        })

    def _handle_xbrief_latest(self):
        self._json(_xbrief_latest_payload())

    def _handle_kimi_review(self):
        self._json(_kimi_latest_payload())

    def _handle_data_version(self):
        self._json(_data_version())

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self.headers.get("Origin")
        if origin in self._allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(404)
            return
        if not self._require_api_host():
            return
        if not self._require_local_origin():
            return
        self.send_response(204)
        origin = self.headers.get("Origin")
        if origin in self._allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, *args):
        pass  # 静默日志，避免刷屏


REFRESH_WATCHDOG_SECONDS = 30 * 60


def _run_refresh():
    """统一调用主刷新器，由主刷新器负责步骤语义与跨进程锁。"""
    try:
        proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "scripts", "run_refresh.py")],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=HERE,
            bufsize=1,
        )
        # 看门狗：子进程挂死时强杀，否则 running 永远为 True，后续刷新会一直 409
        watchdog = threading.Timer(REFRESH_WATCHDOG_SECONDS, proc.kill)
        watchdog.start()
        try:
            for raw in proc.stdout or []:
                line = raw.strip()
                if not line:
                    continue
                refresh_state["log"].append(line[:500])
                if line.startswith("✗ "):
                    refresh_state["failedSteps"].append(line[2:].split(" ", 1)[0])
            returncode = proc.wait()
        finally:
            watchdog.cancel()
        refresh_state["done"] = returncode == 0
        if returncode != 0:
            refresh_state["error"] = "刷新失败，请查看日志"
            if returncode == -9:
                refresh_state["log"].append(
                    f"✗ 看门狗超时（{REFRESH_WATCHDOG_SECONDS // 60} 分钟），已强制终止刷新"
                )
    except Exception as e:
        refresh_state["error"] = str(e)
        refresh_state["log"].append(f"✗ 异常: {e}")
    finally:
        with refresh_state_lock:
            refresh_state["running"] = False


def main():
    no_open = "--no-open" in sys.argv
    _log_diag(f"[{os.getpid()}] 进入 main, no_open={no_open}\n"); 
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    try:
        _log_diag(f"[{os.getpid()}] 准备绑定 127.0.0.1:{PORT}\n"); 
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler)
        _log_diag(f"[{os.getpid()}] ✓ 绑定成功\n"); 
    except OSError as e:
        _log_diag(f"[{os.getpid()}] ✗ 绑定失败: {e}\n"); 
        if e.errno == errno.EADDRINUSE or "Address already in use" in str(e):
            if not _probe_existing_server(PORT):
                print(
                    f"错误：端口 {PORT} 已被其他程序占用；"
                    "身份校验未通过，为避免加载未知服务，看板未打开。",
                    file=sys.stderr,
                )
                return 1
            print(f"端口 {PORT} 上已运行通过身份校验的股市看板服务")
            url = f"http://localhost:{PORT}/index.html"
            if not no_open:
                webbrowser.open(url)
            return 0
        raise
    url = f"http://localhost:{PORT}/index.html"
    print(f"股市看板服务器已启动：{url}")
    if not no_open:
        webbrowser.open(url)
    try:
        _log_diag(f"[{os.getpid()}] 开始 serve_forever\n"); 
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n退出")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
