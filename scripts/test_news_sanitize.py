#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_news_all.sanitize_cjk_brackets 回归。"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch_news_all import sanitize_cjk_brackets, sanitize_news_item  # noqa: E402


class TestNewsSanitize(unittest.TestCase):
    def test_drop_truncated_open_near_end(self):
        raw = "局地发生山洪灾害可能性很大（红色"
        out = sanitize_cjk_brackets(raw)
        self.assertNotIn("（", out)
        self.assertTrue(out.endswith("很大"))

    def test_close_earlier_open(self):
        raw = "发生山洪灾害可能性大（橙色预警，后续仍需观察"
        out = sanitize_cjk_brackets(raw)
        self.assertEqual(out.count("（"), out.count("）"))
        self.assertTrue(out.endswith("）"))

    def test_square_brackets(self):
        raw = "【两部门联合发布红色山洪灾害气象预警 未闭合"
        out = sanitize_cjk_brackets(raw)
        self.assertEqual(out.count("【"), out.count("】"))

    def test_news_item(self):
        item = sanitize_news_item({"title": "正常", "summary": "可能性很大（红色"})
        self.assertEqual(item["summary"], "可能性很大")


if __name__ == "__main__":
    unittest.main()
