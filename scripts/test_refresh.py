#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_refresh


class RefreshPlanTest(unittest.TestCase):
    def test_plan_contains_public_refresh_and_final_validation(self):
        steps = run_refresh.load_plan()
        commands = [step["command"][-1] for step in steps]
        self.assertIn("scripts/fetch_market.py", commands)
        self.assertIn("scripts/fetch_weekend.py", commands)
        self.assertIn("scripts/validate_data.js", commands)
        for retired in [
            "scripts/fetch_holdings.py",
            "scripts/fetch_portfolio_signals.js",
            "scripts/fetch_portfolio_analysis.py",
            "scripts/fetch_industry.py",
            "scripts/fetch_news_all.py",
            "scripts/fetch_hot.py",
            "scripts/fetch_fundflow.py",
            "scripts/fetch_hermes.py",
        ]:
            self.assertNotIn(retired, commands)
        self.assertEqual(commands[-2:], ["scripts/validate_data.js", "--strict"])
        self.assertTrue(steps[-1]["required"])

    def test_refresh_lock_is_exclusive(self):
        first = run_refresh.acquire_refresh_lock()
        self.assertIsNotNone(first)
        try:
            self.assertIsNone(run_refresh.acquire_refresh_lock())
        finally:
            run_refresh.fcntl.flock(first.fileno(), run_refresh.fcntl.LOCK_UN)
            first.close()


if __name__ == "__main__":
    unittest.main()
