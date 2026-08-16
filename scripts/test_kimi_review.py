#!/usr/bin/env python3
"""kimi_review 安全边界回归：HTML 白名单消毒 + 最新报告定位。"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import kimi_review


class SanitizeHtmlDocumentTest(unittest.TestCase):
    def test_strips_script_event_attrs_and_dangerous_protocol(self):
        raw = ('<h2>标题</h2><p onclick="alert(1)">正文</p>'
               '<script>alert(2)</script><img src="javascript:alert(3)">')
        out = kimi_review.sanitize_html_document(raw)
        self.assertIn("<h2>标题</h2>", out)
        self.assertIn("<p>正文</p>", out)
        self.assertNotIn("script", out.lower())
        self.assertNotIn("onclick", out)
        self.assertNotIn("javascript:", out.lower())

    def test_keeps_layout_tags_and_escapes_text(self):
        out = kimi_review.sanitize_html_document("<table><tr><td>1</td></tr></table><p>a & b < c</p>")
        self.assertIn("<td>1</td>", out)
        self.assertIn("a &amp; b &lt; c", out)

    def test_drops_style_and_iframe_whole_subtree(self):
        out = kimi_review.sanitize_html_document(
            '<style>.x{color:red}</style><iframe src="https://evil.example"></iframe><p>keep</p>'
        )
        self.assertNotIn("iframe", out)
        self.assertNotIn("color:red", out)
        self.assertIn("<p>keep</p>", out)


class FindLatestReviewTest(unittest.TestCase):
    def test_prefers_newest_html_by_mtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            old = directory / "old.html"
            old.write_text("<p>old</p>", encoding="utf-8")
            new = directory / "new.html"
            new.write_text("<p>new</p>", encoding="utf-8")
            stamp = old.stat()
            os.utime(old, (stamp.st_atime - 9999, stamp.st_mtime - 9999))
            with mock.patch.object(kimi_review, "_candidate_dirs", return_value=[directory]):
                self.assertEqual(kimi_review.find_latest_review(), new)

    def test_ignores_excluded_names_and_non_html(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "AGENTS.md").write_text("x", encoding="utf-8")
            (directory / "收盘复盘.md").write_text("x", encoding="utf-8")
            (directory / "notes.txt").write_text("x", encoding="utf-8")
            html = directory / "r.html"
            html.write_text("<p>r</p>", encoding="utf-8")
            with mock.patch.object(kimi_review, "_candidate_dirs", return_value=[directory]):
                self.assertEqual(kimi_review.find_latest_review(), html)

    def test_empty_dir_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(kimi_review, "_candidate_dirs", return_value=[Path(tmp)]):
                self.assertIsNone(kimi_review.find_latest_review())

    def test_env_file_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "pick.html"
            target.write_text("<p>x</p>", encoding="utf-8")
            with mock.patch.dict(os.environ, {"KIMI_REVIEW_FILE": str(target)}):
                self.assertEqual(kimi_review.find_latest_review(), target)
            with mock.patch.dict(os.environ, {"KIMI_REVIEW_FILE": str(Path(tmp) / "nope.html")}):
                self.assertIsNone(kimi_review.find_latest_review())


class LoadReviewTest(unittest.TestCase):
    def test_extracts_title_and_sanitizes_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "复盘.html"
            target.write_text(
                "<html><head><title>8月复盘</title></head><body>"
                "<h1>正文</h1><script>alert(1)</script></body></html>",
                encoding="utf-8",
            )
            payload = kimi_review.load_review(target)
            self.assertTrue(payload["available"])
            self.assertEqual(payload["title"], "8月复盘")
            self.assertEqual(payload["fileName"], "复盘.html")
            self.assertIn("<h1>正文</h1>", payload["contentHtml"])
            self.assertNotIn("script", payload["contentHtml"].lower())

    def test_missing_or_unreadable_file_returns_empty(self):
        payload = kimi_review.load_review(Path("/nonexistent/path/review.html"))
        self.assertFalse(payload["available"])
        self.assertTrue(payload["ok"])

    def test_none_path_without_candidates_returns_empty(self):
        with mock.patch.object(kimi_review, "find_latest_review", return_value=None):
            payload = kimi_review.load_review()
            self.assertFalse(payload["available"])


if __name__ == "__main__":
    unittest.main()
