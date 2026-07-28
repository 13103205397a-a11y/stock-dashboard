#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

from scripts import build_site


class PublicBuildTest(unittest.TestCase):
    def test_manifest_builds_complete_public_site_without_private_files(self):
        manifest = json.loads((build_site.ROOT / "public_files.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "site"
            copied = build_site.build_site(output)
            report_html = sorted(f"reports/{f.name}" for f in (build_site.ROOT / "reports").glob("*.html"))
            self.assertEqual(copied, manifest["required"] + report_html)
            self.assertTrue((output / "index.html").is_file())
            self.assertTrue((output / "design-system.css").is_file())
            self.assertTrue((output / "industry_market.js").is_file())
            self.assertTrue((output / ".nojekyll").is_file())
            for name in report_html:
                self.assertTrue((output / name).is_file())
            # reports/ 下的旧 md 等非 html 文件不发布
            self.assertFalse(list((output / "reports").glob("*.md")))
            for private in ["portfolio.json", *manifest["localOptional"]]:
                self.assertFalse((output / private).exists())


if __name__ == "__main__":
    unittest.main()
