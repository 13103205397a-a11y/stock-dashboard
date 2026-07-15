#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_news_all.sanitize_cjk_brackets 回归。"""
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch_news_all import sanitize_cjk_brackets, sanitize_news_item  # noqa: E402
from fetch_news import fetch_one  # noqa: E402
from _dataio import sanitize_square_brackets, sanitize_stock_news  # noqa: E402


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

    def test_square_brackets_removes_unmatched_closer(self):
        self.assertEqual(sanitize_cjk_brackets("必需】后续"), "必需后续")

    def test_shared_write_layer_sanitizes_all_stock_news(self):
        stocks = [{"news": [{"content": "无匹配】", "title": "标题【未闭合"}]}]
        changed = sanitize_stock_news(stocks)
        self.assertEqual(changed, 2)
        self.assertEqual(stocks[0]["news"][0], {"content": "无匹配", "title": "标题【未闭合】"})
        self.assertEqual(sanitize_square_brackets("已【正常】"), "已【正常】")

    def test_news_item(self):
        item = sanitize_news_item({"title": "正常", "summary": "可能性很大（红色"})
        self.assertEqual(item["summary"], "可能性很大")

    def test_stock_news_pipeline_sanitizes_incomplete_square_brackets(self):
        item = {"title": "正常新闻", "date": "2026-07-15", "content": "内容【未完", "source": "test", "url": ""}
        with mock.patch("fetch_news.fetch_search_news", return_value=[sanitize_news_item(item)]), \
             mock.patch("fetch_news.fetch_announcements", return_value=[]):
            _, _, news = fetch_one("600000", "浦发银行")
        self.assertEqual(news[0]["content"], "内容【未完】")


if __name__ == "__main__":
    unittest.main()
