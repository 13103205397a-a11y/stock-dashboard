import json
import plistlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from scripts import run_grok_xbrief


class GrokXbriefTest(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 8, 4, 14, 0, tzinfo=timezone.utc)
        self.end = datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc)  # 北京 23:00

    @staticmethod
    def snowflake(published_at, sequence=0):
        local = datetime.strptime(published_at, "%Y-%m-%d %H:%M").replace(
            tzinfo=run_grok_xbrief.BEIJING
        )
        timestamp_ms = int(local.timestamp() * 1000)
        return str(
            ((timestamp_ms - run_grok_xbrief.X_SNOWFLAKE_EPOCH_MS) << 22)
            + sequence
        )

    @staticmethod
    def post(
        status_id=None,
        *,
        account="OpenAI",
        published_at="2026-08-04 22:30",
        category="AI",
        title="OpenAI 发布新的模型能力更新",
    ):
        status_id = status_id or GrokXbriefTest.snowflake(published_at)
        return {
            "url": f"https://x.com/{account}/status/{status_id}",
            "account": f"@{account}",
            "publishedAt": published_at,
            "category": category,
            "titleZh": title,
            "detailZh": "官方公布了新的模型能力与明确时间节点。",
            "whyImportantZh": "这会影响模型竞争与算力需求预期。",
            "confidence": "高",
        }

    @staticmethod
    def payload(posts):
        return {
            "newPosts": posts,
            "noiseZh": ["旧闻仍在刷屏，但没有新增事实。"],
            "aiConclusionZh": "关注官方后续发布节奏。",
            "marketConclusionZh": "关注外围风险偏好。",
            "warConclusionZh": "关注可核实的冲突升级。",
        }

    def test_prompt_covers_all_requested_accounts_and_time_window(self):
        template = run_grok_xbrief.PROMPT_PATH.read_text(encoding="utf-8")
        prompt = run_grok_xbrief.build_prompt(template, self.start, self.end, {"88"})

        for account in (
            "aleabitoreddit",
            "JensenHuang",
            "thsottiaux",
            "business",
            "elonmusk",
            "Reuters",
            "ReutersBiz",
            "ChatGPT",
            "OpenAI",
            "ZhipuAI",
        ):
            self.assertIn(f"from:{account}", prompt)
        self.assertIn("2026-08-04 22:00", prompt)
        self.assertIn("2026-08-04 23:00", prompt)
        self.assertIn("88", prompt)
        self.assertIn("全球战争", prompt)

    def test_first_daily_run_covers_the_previous_24_hours(self):
        start, end = run_grok_xbrief.observation_window(
            run_grok_xbrief.empty_state(),
            self.end,
            mode="collect",
        )

        self.assertEqual(end, self.end)
        self.assertEqual(start, self.end - timedelta(hours=24))
        self.assertEqual(run_grok_xbrief.period_label(start, end), "近约 1 天")

    def test_resolve_mode_by_beijing_hour(self):
        morning = datetime(2026, 8, 5, 0, 5, tzinfo=timezone.utc)  # 北京 08:05
        evening = datetime(2026, 8, 4, 15, 5, tzinfo=timezone.utc)  # 北京 23:05
        noon = datetime(2026, 8, 4, 4, 0, tzinfo=timezone.utc)  # 北京 12:00

        self.assertEqual(run_grok_xbrief.resolve_mode("auto", morning), "digest-morning")
        self.assertEqual(run_grok_xbrief.resolve_mode("auto", evening), "digest-evening")
        self.assertEqual(run_grok_xbrief.resolve_mode("auto", noon), "collect")
        self.assertEqual(run_grok_xbrief.resolve_mode("collect", morning), "collect")

    def test_grok_command_disables_mutating_tools_without_always_approve(self):
        command = run_grok_xbrief.grok_command("test")

        self.assertNotIn("--always-approve", command)
        self.assertNotIn("--tools", command)
        denied = command[command.index("--disallowed-tools") + 1]
        for tool in (
            "run_terminal_cmd",
            "write_file",
            "search_replace",
            "scheduler_create",
            "web_search",
        ):
            self.assertIn(tool, denied)

    def test_decoder_uses_last_complete_object_from_multi_turn_output(self):
        first = self.payload([])
        final = self.payload([self.post()])
        text = (
            json.dumps(first, ensure_ascii=False)
            + json.dumps({"newPosts": []}, ensure_ascii=False)
            + json.dumps(final, ensure_ascii=False)
        )

        decoded = run_grok_xbrief.decode_json_text(text)

        self.assertEqual(decoded["newPosts"][0]["url"], final["newPosts"][0]["url"])

    def test_filter_keeps_only_unseen_recent_chinese_posts(self):
        new_id = self.snowflake("2026-08-04 22:30", 1)
        seen_id = self.snowflake("2026-08-04 22:31", 2)
        old_id = self.snowflake("2026-08-04 19:00", 3)
        english_id = self.snowflake("2026-08-04 22:32", 4)
        war_id = self.snowflake("2026-08-04 22:33", 5)
        payload = self.payload(
            [
                self.post(new_id),
                self.post(seen_id, account="Reuters", published_at="2026-08-04 22:31", category="财经/股市"),
                self.post(old_id, published_at="2026-08-04 19:00"),
                self.post(english_id, published_at="2026-08-04 22:32", title="OpenAI model update"),
                self.post(
                    war_id,
                    account="Reuters",
                    published_at="2026-08-04 22:33",
                    category="全球战争",
                    title="冲突双方宣布新一轮停火谈判",
                ),
                {**self.post(), "url": "https://example.com/not-x"},
            ]
        )

        selected = run_grok_xbrief.filter_new_posts(
            payload,
            start=self.start,
            end=self.end,
            seen_ids={seen_id},
        )

        self.assertEqual(
            sorted(post["statusId"] for post in selected),
            sorted([new_id, war_id]),
        )

    def test_snowflake_time_overrides_model_claim_and_rejects_old_tweet(self):
        old_id = "1952456288900784337"  # 实际为 2025-08-04，而非模型声称的 2026。
        payload = self.payload(
            [self.post(old_id, published_at="2026-08-04 22:30")]
        )

        selected = run_grok_xbrief.filter_new_posts(
            payload,
            start=self.start,
            end=self.end,
            seen_ids=set(),
        )

        self.assertEqual(selected, [])

    def test_render_uses_beijing_time_chinese_and_direct_source_link(self):
        status_id = self.snowflake("2026-08-04 22:30")
        posts = run_grok_xbrief.filter_new_posts(
            self.payload([self.post(status_id)]),
            start=self.start,
            end=self.end,
            seen_ids=set(),
        )
        markdown = run_grok_xbrief.render_markdown(
            self.payload([self.post(status_id)]),
            posts,
            self.start,
            self.end,
        )

        self.assertIn("北京时间 2026-08-04 23:00", markdown)
        self.assertIn(f"https://x.com/OpenAI/status/{status_id}", markdown)
        self.assertIn("OpenAI 发布新的模型能力更新", markdown)
        self.assertIn("全球战争", markdown)
        self.assertIn("地缘侧", markdown)

    def test_render_html_writes_refined_chinese_document(self):
        status_id = self.snowflake("2026-08-04 22:30")
        posts = run_grok_xbrief.filter_new_posts(
            self.payload([self.post(status_id)]),
            start=self.start,
            end=self.end,
            seen_ids=set(),
        )
        doc = run_grok_xbrief.render_html(
            posts=posts,
            payload=self.payload([self.post(status_id)]),
            start=self.start,
            end=self.end,
            mode="digest-evening",
        )

        self.assertIn("<!DOCTYPE html>", doc)
        self.assertIn("外围热点 · 晚报", doc)
        self.assertIn("OpenAI 发布新的模型能力更新", doc)
        self.assertIn("北京时间", doc)
        self.assertIn(f"https://x.com/OpenAI/status/{status_id}", doc)

    @mock.patch.object(run_grok_xbrief, "save_inbox")
    @mock.patch.object(run_grok_xbrief, "save_state")
    @mock.patch.object(run_grok_xbrief, "load_inbox", return_value=run_grok_xbrief.empty_inbox())
    @mock.patch.object(run_grok_xbrief, "existing_status_ids", return_value=set())
    @mock.patch.object(run_grok_xbrief, "load_state", return_value=run_grok_xbrief.empty_state())
    @mock.patch.object(run_grok_xbrief, "run_grok")
    @mock.patch.object(run_grok_xbrief.push_xbrief, "push")
    def test_no_new_posts_collect_does_not_publish(
        self,
        push_mock,
        grok_mock,
        _load_state,
        _existing,
        _load_inbox,
        save_mock,
        save_inbox_mock,
    ):
        grok_mock.return_value = self.payload([])
        with mock.patch.object(run_grok_xbrief, "now_utc", return_value=self.end), \
             mock.patch.object(run_grok_xbrief.push_xbrief, "publish_to_github") as publish_mock:
            code = run_grok_xbrief.run_observation(git_push=True, mode="collect")

        self.assertEqual(code, 0)
        push_mock.assert_not_called()
        publish_mock.assert_not_called()
        self.assertEqual(save_mock.call_args.args[0]["lastResult"], "no-new-posts")
        save_inbox_mock.assert_called_once()

    @mock.patch.object(run_grok_xbrief, "write_desktop_html")
    @mock.patch.object(run_grok_xbrief, "save_inbox")
    @mock.patch.object(run_grok_xbrief, "save_state")
    @mock.patch.object(run_grok_xbrief, "load_inbox", return_value=run_grok_xbrief.empty_inbox())
    @mock.patch.object(run_grok_xbrief, "existing_status_ids", return_value=set())
    @mock.patch.object(run_grok_xbrief, "load_state", return_value=run_grok_xbrief.empty_state())
    @mock.patch.object(run_grok_xbrief, "run_grok")
    def test_evening_digest_writes_html_and_publishes(
        self,
        grok_mock,
        _load_state,
        _existing,
        _load_inbox,
        save_mock,
        _save_inbox,
        html_mock,
    ):
        status_id = self.snowflake("2026-08-04 22:30")
        grok_mock.return_value = self.payload([self.post(status_id)])
        html_mock.return_value = Path("/tmp/evening.html")
        item = {"time": "2026-08-04 23:00", "aiCount": 1, "marketCount": 0}
        with mock.patch.object(run_grok_xbrief, "now_utc", return_value=self.end), \
             mock.patch.object(run_grok_xbrief.push_xbrief, "push", return_value=item) as push_mock, \
             mock.patch.object(run_grok_xbrief.push_xbrief, "publish_to_github") as publish_mock:
            code = run_grok_xbrief.run_observation(git_push=True, mode="digest-evening")

        self.assertEqual(code, 0)
        html_mock.assert_called_once()
        push_mock.assert_called_once()
        publish_mock.assert_called_once_with(
            run_grok_xbrief.push_xbrief.DATA_FILES,
            "外围热点更新 2026-08-04 23:00",
        )
        final_state = save_mock.call_args.args[0]
        self.assertIn(status_id, final_state["seenStatusIds"])
        self.assertEqual(final_state["lastResult"], "published")

    def test_write_desktop_html_creates_files(self):
        status_id = self.snowflake("2026-08-04 22:30")
        posts = run_grok_xbrief.filter_new_posts(
            self.payload([self.post(status_id)]),
            start=self.start,
            end=self.end,
            seen_ids=set(),
        )
        with tempfile.TemporaryDirectory() as tmp:
            desktop = Path(tmp)
            with mock.patch.object(run_grok_xbrief, "DESKTOP_DIR", desktop):
                path = run_grok_xbrief.write_desktop_html(
                    posts=posts,
                    payload=self.payload([self.post(status_id)]),
                    start=self.start,
                    end=self.end,
                    mode="digest-morning",
                )
            self.assertTrue(path.is_file())
            self.assertTrue((desktop / "最新-早报.html").is_file())
            content = path.read_text(encoding="utf-8")
            self.assertIn("早报", content)
            self.assertIn("OpenAI", content)

    def test_launch_agent_runs_every_two_hours_and_23(self):
        plist_path = (
            run_grok_xbrief.ROOT
            / "launchd"
            / "com.stockdashboard.grok-xbrief.plist"
        )
        with plist_path.open("rb") as handle:
            plist = plistlib.load(handle)

        self.assertNotIn("StartInterval", plist)
        intervals = plist["StartCalendarInterval"]
        self.assertIsInstance(intervals, list)
        hours = sorted(item["Hour"] for item in intervals)
        self.assertEqual(hours, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23])
        self.assertTrue(all(item.get("Minute") == 0 for item in intervals))
        self.assertFalse(plist["KeepAlive"])
        self.assertFalse(plist["RunAtLoad"])
        self.assertIn("scripts/run_grok_xbrief.py", plist["ProgramArguments"][1])
        self.assertNotIn("--git-push", plist["ProgramArguments"])
        self.assertIn("auto", plist["ProgramArguments"])


if __name__ == "__main__":
    unittest.main()
