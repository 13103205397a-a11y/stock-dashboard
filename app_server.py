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

数据刷新流程：抓日K → 算信号 → 抓新闻 → 同步Hermes复盘
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
_diag = open("/tmp/stock-dashboard-app.log", "a")
_diag.write(f"[{os.getpid()}] app_server 启动, cwd={os.getcwd()}\n")
_diag.flush()

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8787
ALLOWED_ORIGINS = {
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
}
MAX_PORTFOLIO_BYTES = 64 * 1024
PORTFOLIO_FIELDS = {"code", "name", "buyPrice", "shares", "weight", "note", "addedAt"}
# 数据刷新时各脚本的顺序（前者输出是后者输入）
# ⚠️ 与 app/main.swift 的 steps 保持一致，改动需同步两端。
REFRESH_STEPS = [
    ("抓日K(腾讯)", ["bash", "scripts/fetch_klines.sh"]),
    ("算技术信号", ["node", "scripts/fetch_signals.js"]),
    ("抓新闻(东方财富)", ["python3", "scripts/fetch_news.py"]),
    ("补资金/研报/估值", ["python3", "scripts/fetch_enhanced.py"]),
    ("全市场异动", ["python3", "scripts/fetch_market.py"]),
    ("同步Hermes复盘", ["python3", "scripts/fetch_hermes.py"]),
    ("同步持仓分析", ["python3", "scripts/fetch_portfolio_analysis.py"]),
    ("同步周末发酵", ["python3", "scripts/fetch_weekend.py"]),
]

# 刷新状态（进程内共享）
refresh_state = {"running": False, "log": [], "done": False, "error": None, "failedSteps": []}


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
        # 静态文件 no-cache：手机端每次验证更新（304 仍可用，但不会拿到过期的 v=1）
        self.send_header("Cache-Control", "no-cache, must-revalidate")
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
        for name, cmd in REFRESH_STEPS:
            refresh_state["log"].append(f"▶ {name}...")
            env = os.environ.copy()
            # 问财密钥：优先环境变量，其次 macOS 钥匙串（账号名可配，默认 Admin）
            if not env.get("IWENCAI_API_KEY"):
                try:
                    import subprocess as sp
                    account = env.get("IWENCAI_KEYCHAIN_ACCOUNT", "Admin")
                    key = sp.run(["security", "find-generic-password", "-a", account,
                                  "-s", "iwencai-api-key", "-w"],
                                 capture_output=True, text=True).stdout.strip()
                    if key:
                        env["IWENCAI_API_KEY"] = key
                except Exception:
                    pass
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env, cwd=HERE)
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
    _diag.write(f"[{os.getpid()}] 进入 main, no_open={no_open}\n"); _diag.flush()
    socketserver.TCPServer.allow_reuse_address = True
    try:
        _diag.write(f"[{os.getpid()}] 准备绑定 127.0.0.1:{PORT}\n"); _diag.flush()
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
        _diag.write(f"[{os.getpid()}] ✓ 绑定成功\n"); _diag.flush()
    except OSError as e:
        _diag.write(f"[{os.getpid()}] ✗ 绑定失败: {e}\n"); _diag.flush()
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
        _diag.write(f"[{os.getpid()}] 开始 serve_forever\n"); _diag.flush()
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n退出")
        sys.exit(0)


if __name__ == "__main__":
    main()
