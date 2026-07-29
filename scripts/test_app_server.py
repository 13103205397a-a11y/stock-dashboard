#!/usr/bin/env python3
import errno
import json
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
from scripts import run_refresh


class AppServerTest(unittest.TestCase):
    def test_desktop_refresh_environment_includes_local_cli_bin(self):
        with mock.patch.dict("os.environ", {"PATH": "/usr/bin:/bin"}, clear=True), \
             mock.patch.object(run_refresh.sys, "platform", "linux"):
            env = run_refresh.env_with_iwencai()
        self.assertEqual(env["PATH"].split(":"), [str(Path.home() / ".local" / "bin"), "/usr/bin", "/bin"])

    def test_configured_port_validates_environment(self):
        with mock.patch.dict("os.environ", {"STOCK_DASHBOARD_PORT": "49123"}, clear=True):
            self.assertEqual(app_server._configured_port(), 49123)
        for invalid in ("0", "65536", "not-a-port"):
            with self.subTest(invalid=invalid), \
                 mock.patch.dict("os.environ", {"STOCK_DASHBOARD_PORT": invalid}, clear=True):
                with self.assertRaisesRegex(ValueError, "1..65535"):
                    app_server._configured_port()

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        (cls.root / "index.html").write_text("ok", encoding="utf-8")
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

    def request_full(self, path, data=None, headers=None):
        body = None if data is None else json.dumps(data, allow_nan=True).encode("utf-8")
        request_headers = {"Content-Type": "application/json"} if body is not None else {}
        request_headers.update(headers or {})
        req = urllib.request.Request(
            self.base + path,
            data=body,
            headers=request_headers,
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, response.read(), response.headers.get("Content-Type")
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers.get("Content-Type")

    def request(self, path, data=None, headers=None):
        status, body, _ = self.request_full(path, data=data, headers=headers)
        return status, body

    def test_static_allowlist_blocks_repository_and_private_config(self):
        self.assertEqual(self.request("/index.html")[0], 200)
        self.assertEqual(self.request("/.git/config")[0], 404)
        self.assertEqual(self.request("/portfolio.json")[0], 404)
        self.assertEqual(self.request("/api/portfolio")[0], 404)

    def test_api_rejects_untrusted_host_and_origin(self):
        self.assertEqual(self.request("/api/status")[0], 200)
        self.assertEqual(self.request("/api/status", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(
            self.request("/api/refresh", {}, headers={"Origin": "https://evil.example"})[0],
            403,
        )

    def test_status_identity_is_strict_and_probeable(self):
        status, raw, content_type = self.request_full("/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json; charset=utf-8")
        payload = json.loads(raw)
        self.assertEqual(payload["appId"], app_server.APP_ID)
        self.assertEqual(payload["apiVersion"], app_server.API_VERSION)
        self.assertTrue(app_server._valid_status_payload(payload))
        self.assertTrue(
            app_server._probe_existing_server(self.server.server_address[1])
        )

        for invalid in [
            {**payload, "appId": "other-service"},
            {**payload, "apiVersion": True},
            {**payload, "running": "false"},
            {**payload, "log": [123]},
            {**payload, "error": {"message": "bad"}},
            {**payload, "failedSteps": [None]},
        ]:
            with self.subTest(invalid=invalid):
                self.assertFalse(app_server._valid_status_payload(invalid))

    def test_identity_probe_rejects_non_json_error_and_wrong_service(self):
        valid = {
            "appId": app_server.APP_ID,
            "apiVersion": app_server.API_VERSION,
            "running": False,
            "log": [],
            "done": False,
            "error": None,
            "failedSteps": [],
        }
        cases = [
            (503, "application/json", valid),
            (200, "text/html", valid),
            (200, "application/json", {**valid, "appId": "other-service"}),
        ]
        for status, content_type, payload in cases:
            with self.subTest(status=status, content_type=content_type, payload=payload):
                response = mock.Mock(status=status)
                response.headers.get_content_type.return_value = content_type
                response.read.return_value = json.dumps(payload).encode("utf-8")
                connection = mock.Mock()
                connection.getresponse.return_value = response
                with mock.patch.object(
                    app_server.http.client,
                    "HTTPConnection",
                    return_value=connection,
                ):
                    self.assertFalse(app_server._probe_existing_server(8787))
                connection.close.assert_called_once()

    def test_port_collision_never_opens_unknown_service(self):
        occupied = OSError(errno.EADDRINUSE, "Address already in use")
        with mock.patch.object(
            app_server.socketserver,
            "ThreadingTCPServer",
            side_effect=occupied,
        ), mock.patch.object(
            app_server,
            "_probe_existing_server",
            return_value=False,
        ), mock.patch.object(
            app_server,
            "_log_diag",
        ), mock.patch.object(
            app_server.webbrowser,
            "open",
        ) as open_browser, mock.patch.object(
            app_server.sys,
            "argv",
            ["app_server.py"],
        ):
            self.assertEqual(app_server.main(), 1)
        open_browser.assert_not_called()

    def test_port_collision_reuses_only_verified_dashboard(self):
        occupied = OSError(errno.EADDRINUSE, "Address already in use")
        with mock.patch.object(
            app_server.socketserver,
            "ThreadingTCPServer",
            side_effect=occupied,
        ), mock.patch.object(
            app_server,
            "_probe_existing_server",
            return_value=True,
        ), mock.patch.object(
            app_server,
            "_log_diag",
        ), mock.patch.object(
            app_server.webbrowser,
            "open",
        ) as open_browser, mock.patch.object(
            app_server.sys,
            "argv",
            ["app_server.py"],
        ):
            self.assertEqual(app_server.main(), 0)
        open_browser.assert_called_once_with(
            f"http://localhost:{app_server.PORT}/index.html"
        )


if __name__ == "__main__":
    unittest.main()
