import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import fetch_hermes
import fetch_portfolio_analysis
import fetch_weekend
import sanitize_ai_content
import sync_hermes_dashboard


class HermesSyncTest(unittest.TestCase):
    def test_report_strips_markdown_fence_and_corrects_completeness_conflict(self):
        source = "```markdown\n数据完整度：[全部正常]（自选股数据未能获取）\n\n# 盘前简报\n正文\n```"
        cleaned = fetch_hermes.sanitize_report(source)
        self.assertFalse(cleaned.startswith("```"))
        self.assertFalse(cleaned.endswith("```"))
        self.assertIn("数据完整度：[部分缺失]", cleaned)

    def test_quota_failure_is_not_exported_as_report(self):
        session = {"messages": [{
            "role": "assistant",
            "content": "Cron failed: provider quota limit. Fallback chain was exhausted or unavailable." * 2,
        }]}
        self.assertEqual(fetch_hermes.extract_report(session), "")

    def test_portfolio_can_be_recovered_from_file_tool_result(self):
        payload = {"updated": "2026-07-10 15:35", "analyses": [{
            "code": "605117", "name": "德业股份", "fundamentals": "真实基本面数据与估值比较。" * 8,
            "capital": "资金数据。" * 8, "technicals": "技术信号。" * 8, "risks": "风险说明。" * 8,
            "noiseFilter": "噪音过滤。" * 8, "action": "操作计划。" * 8, "summary": "谨慎持有",
        }]}
        content = "1|window.PORTFOLIO_ANALYSIS = " + json.dumps(payload, ensure_ascii=False) + ";"
        session = {"messages": [{"role": "tool", "content": json.dumps({"content": content})}]}
        analyses, found, _ = fetch_portfolio_analysis.extract_analyses_from_session(session)
        self.assertEqual(analyses[0]["code"], "605117")
        self.assertEqual(found["updated"], "2026-07-10 15:35")

    def test_portfolio_template_placeholder_is_rejected(self):
        placeholder = {"analyses": [{
            "code": "605117", "fundamentals": "基本面+估值分析正文，100-200字中文",
            "capital": "资金面分析正文，100-200字中文", "summary": "一句话总结",
        }]}
        analyses, _ = fetch_portfolio_analysis.normalize_analyses(placeholder)
        self.assertEqual(analyses, [])

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

    def test_isolated_publish_checks_remote_even_without_root_diff(self):
        calls = []
        with tempfile.TemporaryDirectory() as temp:
            worktree = Path(temp) / "repo"
            worktree.mkdir()
            for name in sync_hermes_dashboard.PUBLIC_AI_FILES:
                (worktree / name).write_text("snapshot", encoding="utf-8")

            def fake_run(command, **kwargs):
                calls.append(command)
                stdout = "" if command[:3] != ["git", "diff", "--name-only"] else ""
                return mock.Mock(returncode=0, stdout=stdout, stderr="")

            fake_tmp = mock.Mock()
            fake_tmp.__enter__ = mock.Mock(return_value=temp)
            fake_tmp.__exit__ = mock.Mock(return_value=False)
            with mock.patch.object(sync_hermes_dashboard.tempfile, "TemporaryDirectory", return_value=fake_tmp), \
                 mock.patch.object(sync_hermes_dashboard, "run", side_effect=fake_run), \
                 mock.patch.object(sync_hermes_dashboard.shutil, "copy2"):
                self.assertEqual(sync_hermes_dashboard.publish_public_files(), [])
        self.assertIn(["git", "fetch", "origin", "main"], calls)
        self.assertTrue(any(call[:3] == ["git", "worktree", "add"] for call in calls))


if __name__ == "__main__":
    unittest.main()
