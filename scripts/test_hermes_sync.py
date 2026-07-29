import json
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import fetch_weekend
import fetch_hermes_module
import sanitize_ai_content
import sync_hermes_dashboard


class HermesSyncTest(unittest.TestCase):
    def test_weekend_rejects_prompt_template(self):
        template = {
            "weekendDate": "2026-07-05", "summary": "本周末共发酵 N 个热点，偏多/偏空",
            "hotspots": [{"title": "热点标题（10-20字）"}] * 3, "scenario": {},
        }
        self.assertIsNone(fetch_weekend.normalize_weekend(template))
        valid = {
            "weekendDate": "2026-07-05", "summary": "本周末共发酵3个有效热点",
            "hotspots": [{"title": f"真实热点{i}"} for i in range(3)], "scenario": {},
        }
        self.assertEqual(fetch_weekend.normalize_weekend(valid), valid)

    def test_weekend_reports_missing_prompt_as_real_failure(self):
        session = {"messages": [{
            "role": "assistant",
            "content": "未找到 agent/weekend_ferment.md，无法执行周末发酵。",
        }]}
        self.assertIn("weekend_ferment.md", fetch_weekend.session_failure_reason(session))

    def test_ai_internal_fields_are_rewritten_for_readers(self):
        source = "thsStrong confidence=高 break=14次 thsHot rank_chg"
        cleaned = sanitize_ai_content.sanitize_text(source)
        self.assertEqual(cleaned, "强势股数据 置信度高 开板14次 热度榜数据 排名变化")

    def test_retired_source_names_are_rewritten_for_readers(self):
        source = "newsall.js / hot.js / chain.js / reports.js"
        cleaned = sanitize_ai_content.sanitize_text(source)
        self.assertEqual(cleaned, "公开资讯 / 热度榜数据 / 公开产业资料 / 历史复盘资料")

    def test_retired_source_names_match_chinese_concatenation(self):
        source = "午间(market.js/newsall.js报道) hot.js榜单 industry.js摘要"
        cleaned = sanitize_ai_content.sanitize_text(source)
        self.assertEqual(
            cleaned,
            "午间(市场异动数据/公开资讯报道) 热度榜数据榜单 行业数据摘要",
        )

    def test_sanitizer_uses_only_active_hermes_modules(self):
        self.assertEqual(
            sanitize_ai_content.active_ai_files(),
            ["logic.js", "events.js", "weekend.js"],
        )

    def test_only_active_sync_exporter_is_loaded(self):
        modules = sync_hermes_dashboard.load_sync_modules()
        self.assertEqual(
            [module["file"] for module in modules],
            ["logic.js", "events.js", "weekend.js"],
        )
        serialized = json.dumps(modules, ensure_ascii=False)
        for retired in ["portfolio", "industry.js", "materials.js", "fundflow.js"]:
            self.assertNotIn(retired, serialized)

    def test_structured_module_export_rejects_incomplete_and_accepts_valid_payload(self):
        spec = fetch_hermes_module.MODULES["logic"]
        incomplete = {"date": "2026-07-29", "generatedAt": "2026-07-29 20:00", "chains": []}
        self.assertIsNone(fetch_hermes_module.normalize_payload(incomplete, spec))
        valid = {
            "date": "2026-07-29",
            "generatedAt": "2026-07-29 20:00",
            "chains": [{"name": "有效逻辑链"}],
        }
        session = {
            "messages": [{
                "role": "assistant",
                "content": "```json\n" + json.dumps(valid, ensure_ascii=False) + "\n```",
            }]
        }
        payload, _ = fetch_hermes_module.extract_payload(session, spec)
        self.assertEqual(payload, valid)

    def test_exporter_command_allows_only_repository_scripts(self):
        self.assertEqual(
            sync_hermes_dashboard.exporter_command({
                "exporter": ["scripts/fetch_hermes_module.py", "logic"],
            }),
            ["scripts/fetch_hermes_module.py", "logic"],
        )
        for exporter in ("/tmp/evil.py", "../evil.py", []):
            with self.subTest(exporter=exporter):
                with self.assertRaises(ValueError):
                    sync_hermes_dashboard.exporter_command({"exporter": exporter})

    def test_current_run_only_returns_explicit_successes(self):
        calls = []
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "fresh.js").write_text('window.FRESH={"generatedAt":"2026-07-29 10:00"};', encoding="utf-8")
            (root / "skipped.js").write_text('window.SKIP={"generatedAt":"2026-07-28 10:00"};', encoding="utf-8")
            modules = [
                {
                    "id": "fresh", "label": "新数据", "file": "fresh.js",
                    "hermes": {"exporter": "scripts/fresh.py", "successMarker": "EXPORTED"},
                },
                {
                    "id": "skipped", "label": "旧数据", "file": "skipped.js",
                    "hermes": {"exporter": "scripts/skipped.py", "successMarker": "EXPORTED"},
                },
            ]

            def fake_run(command, **kwargs):
                calls.append(command)
                if command[-1] == "scripts/fresh.py":
                    return mock.Mock(returncode=0, stdout="EXPORTED", stderr="")
                return mock.Mock(returncode=0, stdout="未找到会话，跳过", stderr="")

            with mock.patch.object(sync_hermes_dashboard, "ROOT", root), \
                 mock.patch.object(sync_hermes_dashboard, "load_sync_modules", return_value=modules), \
                 mock.patch.object(sync_hermes_dashboard, "run", side_effect=fake_run), \
                 mock.patch.object(sync_hermes_dashboard.sanitize_ai_content, "sanitize_file"):
                self.assertEqual(sync_hermes_dashboard.export_current_run(), ["fresh.js"])
        self.assertEqual(len(calls), 2)

    def test_snapshot_rollback_guard_rejects_older_and_equal_conflicts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = root / "local.js"
            remote = root / "remote.js"
            fields = ["generatedAt", "date"]
            remote.write_text('window.X={"generatedAt":"2026-07-29 10:00","value":2};', encoding="utf-8")

            local.write_text('window.X={"generatedAt":"2026-07-28 10:00","value":1};', encoding="utf-8")
            with self.assertRaises(sync_hermes_dashboard.SnapshotRollbackError):
                sync_hermes_dashboard.assert_not_rollback(local, remote, fields)

            local.write_text('window.X={"generatedAt":"2026-07-29 10:00","value":1};', encoding="utf-8")
            with self.assertRaises(sync_hermes_dashboard.SnapshotRollbackError):
                sync_hermes_dashboard.assert_not_rollback(local, remote, fields)

            local.write_text('window.X={"generatedAt":"2026-07-29 10:01","value":3};', encoding="utf-8")
            self.assertTrue(sync_hermes_dashboard.assert_not_rollback(local, remote, fields))
            self.assertEqual(
                sync_hermes_dashboard.snapshot_timestamp(local, fields),
                datetime(2026, 7, 29, 10, 1),
            )

    def test_identical_remote_snapshot_needs_no_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = root / "local.js"
            remote = root / "remote.js"
            content = 'window.X={"generatedAt":"2026-07-29 10:00"};'
            local.write_text(content, encoding="utf-8")
            remote.write_text(content, encoding="utf-8")
            self.assertFalse(
                sync_hermes_dashboard.assert_not_rollback(local, remote, ["generatedAt"])
            )


if __name__ == "__main__":
    unittest.main()
