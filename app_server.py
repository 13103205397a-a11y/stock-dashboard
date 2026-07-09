#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股市看板 · 本地 App 服务器

功能：
1. 托管看板网页（本地访问 http://localhost:8787）
2. 提供「刷新数据」API → 跑抓取脚本（日K/信号/新闻/复盘）
3. 提供「打开看板」→ 自动用浏览器打开

用法：
  python3 app_server.py            # 启动服务器并打开看板
  python3 app_server.py --no-open  # 只启动不打开浏览器

数据刷新流程：读取 scripts/refresh_plan.json 统一执行。
全部本地运行，不依赖 GitHub。
"""
import http.server
import json
import os
import signal
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

# 启动诊断日志(写到文件,排查卡在哪)
def _log_diag(msg):
    """按需写诊断日志，不保持文件句柄"""
    with open("/tmp/stock-dashboard-app.log", "a", encoding="utf-8") as f:
        f.write(f"[{os.getpid()}] {msg}\n")
_log_diag(f"app_server 启动, cwd={os.getcwd()}")

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8787
ALLOWED_ORIGINS = {
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
}
MAX_PORTFOLIO_BYTES = 64 * 1024
PORTFOLIO_FIELDS = {"code", "name", "buyPrice", "shares", "weight", "note", "addedAt"}
REFRESH_PLAN_PATH = os.path.join(HERE, "scripts", "refresh_plan.json")

# 刷新状态（进程内共享）
refresh_state = {"running": False, "log": [], "done": False, "error": None, "failedSteps": []}


def _load_refresh_steps():
    """读取统一刷新计划，返回 [{name, command, timeout}]。"""
    with open(REFRESH_PLAN_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("refresh_plan.json 缺少 steps")
    out = []
    for step in steps:
        name = step.get("name")
        cmd = step.get("command")
        if not name or not isinstance(cmd, list) or not all(isinstance(x, str) and x for x in cmd):
            raise ValueError("refresh_plan.json 中存在无效步骤")
        out.append({
            "name": name,
            "command": cmd,
            "timeout": int(step.get("timeout") or 300),
        })
    return out


def _env_with_iwencai():
    env = os.environ.copy()
    if env.get("IWENCAI_API_KEY"):
        return env
    try:
        import subprocess as sp
        account = env.get("IWENCAI_KEYCHAIN_ACCOUNT", "Admin")
        key = sp.run(["security", "find-generic-password", "-a", account,
                      "-s", "iwencai-api-key", "-w"],
                     capture_output=True, text=True, timeout=10).stdout.strip()
        if key:
            env["IWENCAI_API_KEY"] = key
    except Exception:
        pass
    return env


def _validate_portfolio(data):
    """校验持仓配置，只允许前端需要的字段落盘。"""
    if not isinstance(data, dict) or not isinstance(data.get("holdings"), list):
        raise ValueError("数据格式错误，需 {holdings: [...]}")
    out = {"updated": str(data.get("updated") or "")[:10], "holdings": []}
    for item in data["holdings"]:
        if not isinstance(item, dict):
            raise ValueError("持仓条目格式错误")
        code = str(item.get("code") or "").strip()
        name = str(item.get("name") or "").strip()
        if not code.isdigit() or len(code) != 6:
            raise ValueError("股票代码必须是 6 位数字")
        if not name:
            raise ValueError("股票名称不能为空")
        clean = {k: item[k] for k in PORTFOLIO_FIELDS if k in item}
        clean["code"] = code
        clean["name"] = name
        for key in ("buyPrice", "shares", "weight"):
            if clean.get(key) in ("", None):
                clean[key] = None
            elif not isinstance(clean[key], (int, float)):
                raise ValueError(f"{key} 必须是数字")
        if clean.get("note") is not None:
            clean["note"] = str(clean["note"])[:200]
        out["holdings"].append(clean)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    """托管看板网页，根目录指向项目根。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        # 静态文件 no-cache + 安全头
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin in ALLOWED_ORIGINS

    def _require_local_origin(self):
        if self._origin_allowed():
            return True
        self.send_error(403, "Origin not allowed")
        return False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/status":
            self._handle_status()
            return
        if parsed.path == "/api/portfolio":
            self._handle_portfolio_get()
            return
        # 静态文件（网页本体）
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self._require_local_origin():
            return
        if parsed.path == "/api/refresh":
            self._handle_refresh()
            return
        if parsed.path == "/api/portfolio":
            self._handle_portfolio_post()
            return
        self.send_error(404)

    def _handle_portfolio_get(self):
        """读取 portfolio.json 持仓配置"""
        path = os.path.join(HERE, "portfolio.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._json({"ok": True, "data": data})
        except FileNotFoundError:
            self._json({"ok": True, "data": {"updated": "", "holdings": []}})
        except Exception as e:
            self._json({"ok": False, "msg": str(e)})

    def _handle_portfolio_post(self):
        """写入 portfolio.json 持仓配置（整体覆盖）"""
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_PORTFOLIO_BYTES:
            self.send_error(413, "Portfolio payload too large")
            return
        body = self.rfile.read(length).decode("utf-8")
        try:
            data = _validate_portfolio(json.loads(body))
            path = os.path.join(HERE, "portfolio.json")
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
            self._json({"ok": True, "msg": "持仓已保存"})
        except json.JSONDecodeError:
            self._json({"ok": False, "msg": "JSON 解析失败"})
        except ValueError as e:
            self._json({"ok": False, "msg": str(e)})
        except Exception as e:
            self._json({"ok": False, "msg": str(e)})

    def _handle_refresh(self):
        if refresh_state["running"]:
            self._json({"ok": False, "msg": "刷新正在进行中，请等待"})
            return
        threading.Thread(target=_run_refresh, daemon=True).start()
        self._json({"ok": True, "msg": "刷新已启动，查看 /api/status 获取进度"})

    def _handle_status(self):
        self._json({
            "running": refresh_state["running"],
            "log": refresh_state["log"][-20:],
            "done": refresh_state["done"],
            "error": refresh_state["error"],
            "failedSteps": refresh_state["failedSteps"],
        })

    def _json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._require_local_origin():
            return
        self.send_response(204)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, *args):
        pass  # 静默日志，避免刷屏


def _run_refresh():
    """后台跑数据刷新脚本。"""
    refresh_state.update(running=True, log=[], done=False, error=None, failedSteps=[])
    try:
        env = _env_with_iwencai()
        for step in _load_refresh_steps():
            name = step["name"]
            cmd = step["command"]
            refresh_state["log"].append(f"▶ {name}...")
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=step["timeout"], env=env, cwd=HERE)
            out = (r.stdout or "")[-500:]
            if r.returncode == 0:
                refresh_state["log"].append(f"  ✓ {name} 完成")
                if out.strip():
                    refresh_state["log"].append(f"  {out.strip()[:200]}")
            else:
                refresh_state["log"].append(f"  ✗ {name} 失败: {(r.stderr or '')[:200]}")
                refresh_state["failedSteps"].append(name)
        if refresh_state["failedSteps"]:
            refresh_state["error"] = "部分步骤失败：" + "、".join(refresh_state["failedSteps"])
            refresh_state["log"].append("刷新结束，但存在失败步骤 ✗")
        else:
            refresh_state["log"].append("全部完成 ✓")
            refresh_state["done"] = True
    except Exception as e:
        refresh_state["error"] = str(e)
        refresh_state["log"].append(f"✗ 异常: {e}")
    finally:
        refresh_state["running"] = False


def main():
    no_open = "--no-open" in sys.argv
    _log_diag(f"[{os.getpid()}] 进入 main, no_open={no_open}\n"); 
    socketserver.TCPServer.allow_reuse_address = True
    try:
        _log_diag(f"[{os.getpid()}] 准备绑定 127.0.0.1:{PORT}\n"); 
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
        _log_diag(f"[{os.getpid()}] ✓ 绑定成功\n"); 
    except OSError as e:
        _log_diag(f"[{os.getpid()}] ✗ 绑定失败: {e}\n"); 
        if "Address already in use" in str(e):
            print(f"端口 {PORT} 已被占用,可能服务器已在运行")
            url = f"http://localhost:{PORT}/index.html"
            if not no_open:
                webbrowser.open(url)
            return
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
        sys.exit(0)


if __name__ == "__main__":
    main()
