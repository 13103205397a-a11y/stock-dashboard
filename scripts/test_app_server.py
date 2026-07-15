#!/usr/bin/env python3
import json
import math
import socketserver
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app_server


class AppServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        (cls.root / "index.html").write_text("ok", encoding="utf-8")
        (cls.root / "portfolio.json").write_text(
            json.dumps({"updated": "2026-07-10", "holdings": []}), encoding="utf-8"
        )
        (cls.root / ".git").mkdir()
        (cls.root / ".git" / "config").write_text("secret", encoding="utf-8")
        cls.old_here = app_server.HERE
        app_server.HERE = str(cls.root)
        cls.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), app_server.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        app_server.HERE = cls.old_here
        cls.tmp.cleanup()

    def request(self, path, data=None):
        body = None if data is None else json.dumps(data, allow_nan=True).encode("utf-8")
        req = urllib.request.Request(
            self.base + path,
            data=body,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_static_allowlist_blocks_repository_and_private_config(self):
        self.assertEqual(self.request("/index.html")[0], 200)
        self.assertEqual(self.request("/.git/config")[0], 404)
        self.assertEqual(self.request("/portfolio.json")[0], 404)
        status, body = self.request("/api/portfolio")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])

    def test_portfolio_http_status_and_atomic_write(self):
        valid = {
            "updated": "2026-07-10",
            "holdings": [{"code": "600000", "name": "浦发银行", "shares": 100}],
            "watchlist": [{"code": "000001", "name": "平安银行"}],
        }
        status, body = self.request("/api/portfolio", valid)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["data"]["holdings"][0]["code"], "600000")
        self.assertEqual(json.loads(body)["data"]["watchlist"][0]["code"], "000001")

        invalid = {"holdings": [{"code": "600000", "name": "A", "weight": 2}]}
        status, body = self.request("/api/portfolio", invalid)
        self.assertEqual(status, 422)
        self.assertFalse(json.loads(body)["ok"])

    def test_portfolio_validation_rejects_duplicates_and_non_finite_values(self):
        with self.assertRaisesRegex(ValueError, "重复"):
            app_server._validate_portfolio({"holdings": [
                {"code": "600000", "name": "A"}, {"code": "600000", "name": "A"},
            ]})
        with self.assertRaisesRegex(ValueError, "有限数字"):
            app_server._validate_portfolio({"holdings": [
                {"code": "600000", "name": "A", "buyPrice": math.nan},
            ]})
        with self.assertRaisesRegex(ValueError, "已在持仓"):
            app_server._validate_portfolio({
                "holdings": [{"code": "600000", "name": "A"}],
                "watchlist": [{"code": "600000", "name": "A"}],
            })

    def test_portfolio_refresh_endpoint_reports_completion(self):
        app_server.portfolio_refresh_state.update(running=False, done=False, error=None, log="")
        with mock.patch.object(app_server, "_run_portfolio_refresh_background", return_value=None):
            status, body = self.request("/api/portfolio/refresh", {})
        payload = json.loads(body)
        self.assertEqual(status, 202)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["running"])
        app_server.portfolio_refresh_state.update(running=False, done=False, error=None, log="")


if __name__ == "__main__":
    unittest.main()
