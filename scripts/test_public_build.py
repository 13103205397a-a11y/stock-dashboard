#!/usr/bin/env python3
import json
import re
import subprocess
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts import build_site


class PublicBuildTest(unittest.TestCase):
    def test_active_manifest_builds_complete_public_site_without_retired_files(self):
        public = json.loads((build_site.ROOT / "public_files.json").read_text(encoding="utf-8"))
        active = json.loads((build_site.ROOT / public["activeModules"]).read_text(encoding="utf-8"))
        expected = [
            *public["required"],
            *(module["file"] for module in active["modules"]),
        ]
        for retired in [
            "app_holdings.js", "holdings.js", "portfolio_analysis.js", "portfolio_signals.js",
            "industry.js", "materials.js", "hot.js", "newsall.js", "industry_market.js",
            "fundflow.js", "reports.js", "chain.js",
        ]:
            self.assertNotIn(retired, expected)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "site"
            copied = build_site.build_site(output)
            self.assertEqual(copied, expected)
            self.assertTrue((output / "index.html").is_file())
            self.assertTrue((output / "styles.css").is_file())
            self.assertTrue((output / "active_modules.json").is_file())
            self.assertTrue((output / "xbriefs.js").is_file())
            self.assertTrue((output / ".nojekyll").is_file())
            for retired in [
                "portfolio.json", "app_holdings.js", "holdings.js", "portfolio_analysis.js",
                "portfolio_signals.js", "industry.js", "materials.js", "hot.js", "newsall.js",
                "industry_market.js", "fundflow.js", "reports.js", "chain.js",
            ]:
                self.assertFalse((output / retired).exists())

    def test_probe_file_list_is_the_build_file_list(self):
        files = build_site.public_files()
        self.assertEqual(len(files), len(set(files)))
        self.assertIn("active_modules.json", files)
        self.assertEqual(
            {"data.js", "meta.js", "market.js", "logic.js", "events.js", "xbriefs.js", "kimi_review.js", "weekend.js"},
            {name for name in files if name.endswith(".js") and name not in {"app.js", "app_ai_modules.js"}},
        )

    def test_stock_signal_contract_cannot_be_masked_by_fresh_meta(self):
        active = json.loads((build_site.ROOT / "active_modules.json").read_text(encoding="utf-8"))
        stocks = next(module for module in active["modules"] if module["id"] == "stocks")
        self.assertTrue(stocks["contract"]["requireSignalDate"])
        self.assertEqual(stocks["freshness"][0]["selector"], "oldest:signal.date")

    def test_pages_workflow_is_archived_for_local_only_use(self):
        # 项目已转向本地优先：CI 工作流归档到 archive/，根目录不再保留部署配置
        archived = build_site.ROOT / "archive/github-workflows/pages.yml"
        self.assertTrue(archived.is_file(), "归档的 pages.yml 应保留在 archive/")
        self.assertFalse((build_site.ROOT / ".github/workflows/pages.yml").exists())
        workflow = archived.read_text(encoding="utf-8")
        self.assertIn("npm run test:e2e", workflow)
        for retired in ["hot.js", "newsall.js", "industry_market.js", "fundflow.js", "materials.js"]:
            self.assertNotIn(retired, workflow)

    def test_future_market_date_fails_freshness_gate(self):
        meta = (build_site.ROOT / "meta.js").read_text(encoding="utf-8")
        match = re.search(r'"signalDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', meta)
        self.assertIsNotNone(match)
        signal_date = date.fromisoformat(match.group(1))
        result = subprocess.run(
            [
                "node",
                "scripts/check_freshness.js",
                "--strict",
                "--scope=market",
                f"--now={signal_date - timedelta(days=1)}",
            ],
            cwd=build_site.ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("无效/未来", result.stderr)


if __name__ == "__main__":
    unittest.main()
