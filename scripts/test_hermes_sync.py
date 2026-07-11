import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import fetch_hermes
import fetch_portfolio_analysis
import fetch_weekend


class HermesSyncTest(unittest.TestCase):
    def test_quota_failure_is_not_exported_as_report(self):
        session = {"messages": [{
            "role": "assistant",
            "content": "Cron failed: provider quota limit. Fallback chain was exhausted or unavailable." * 2,
        }]}
        self.assertEqual(fetch_hermes.extract_report(session), "")

    def test_portfolio_can_be_recovered_from_file_tool_result(self):
        payload = {"updated": "2026-07-10 15:35", "analyses": [{"code": "605117", "name": "德业股份"}]}
        content = "1|window.PORTFOLIO_ANALYSIS = " + json.dumps(payload, ensure_ascii=False) + ";"
        session = {"messages": [{"role": "tool", "content": json.dumps({"content": content})}]}
        analyses, found, _ = fetch_portfolio_analysis.extract_analyses_from_session(session)
        self.assertEqual(analyses[0]["code"], "605117")
        self.assertEqual(found["updated"], "2026-07-10 15:35")

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


if __name__ == "__main__":
    unittest.main()
