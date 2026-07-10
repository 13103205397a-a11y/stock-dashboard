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
        self.assertIn("scripts/fetch_industry.py", commands)
        self.assertIn("scripts/fetch_news_all.py", commands)
        self.assertIn("scripts/fetch_hot.py", commands)
        self.assertEqual(commands[-1], "scripts/validate_data.js")
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
