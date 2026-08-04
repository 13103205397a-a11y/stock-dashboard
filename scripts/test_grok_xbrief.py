import json
import plistlib
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from scripts import run_grok_xbrief


class GrokXbriefTest(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 8, 4, 14, 0, tzinfo=timezone.utc)
        self.end = datetime(2026, 8, 4, 15, 0, tzinfo=timezone.utc)

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

    def test_first_daily_run_covers_the_previous_24_hours(self):
        start, end = run_grok_xbrief.observation_window(
            run_grok_xbrief.empty_state(),
            self.end,
        )

        self.assertEqual(end, self.end)
        self.assertEqual(start, self.end - timedelta(hours=24))
        self.assertEqual(run_grok_xbrief.period_label(start, end), "近约 1 天")

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
        payload = self.payload(
            [
                self.post(new_id),
                self.post(seen_id, account="Reuters", published_at="2026-08-04 22:31", category="财经/股市"),
                self.post(old_id, published_at="2026-08-04 19:00"),
                self.post(english_id, published_at="2026-08-04 22:32", title="OpenAI model update"),
                {**self.post(), "url": "https://example.com/not-x"},
            ]
        )

        selected = run_grok_xbrief.filter_new_posts(
            payload,
            start=self.start,
            end=self.end,
            seen_ids={seen_id},
        )

        self.assertEqual([post["statusId"] for post in selected], [new_id])
        self.assertEqual(selected[0]["account"], "@OpenAI")

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
        self.assertIn("本时段未发现相对上期有增量的高价值推文", markdown)

    @mock.patch.object(run_grok_xbrief, "save_state")
    @mock.patch.object(run_grok_xbrief, "existing_status_ids", return_value=set())
    @mock.patch.object(run_grok_xbrief, "load_state", return_value=run_grok_xbrief.empty_state())
    @mock.patch.object(run_grok_xbrief, "run_grok")
    @mock.patch.object(run_grok_xbrief.push_xbrief, "push")
    def test_no_new_posts_does_not_write_or_publish(
        self,
        push_mock,
        grok_mock,
        _load_state,
        _existing,
        save_mock,
    ):
        grok_mock.return_value = self.payload([])
        with mock.patch.object(run_grok_xbrief, "now_utc", return_value=self.end), \
             mock.patch.object(run_grok_xbrief.push_xbrief, "publish_to_github") as publish_mock:
            code = run_grok_xbrief.run_observation(git_push=True)

        self.assertEqual(code, 0)
        push_mock.assert_not_called()
        publish_mock.assert_not_called()
        self.assertEqual(save_mock.call_args.args[0]["lastResult"], "no-new-posts")

    @mock.patch.object(run_grok_xbrief, "save_state")
    @mock.patch.object(run_grok_xbrief, "existing_status_ids", return_value=set())
    @mock.patch.object(run_grok_xbrief, "load_state", return_value=run_grok_xbrief.empty_state())
    @mock.patch.object(run_grok_xbrief, "run_grok")
    def test_new_post_is_written_once_and_published_with_isolated_helper(
        self,
        grok_mock,
        _load_state,
        _existing,
        save_mock,
    ):
        status_id = self.snowflake("2026-08-04 22:30")
        grok_mock.return_value = self.payload([self.post(status_id)])
        item = {"time": "2026-08-04 23:00", "aiCount": 1, "marketCount": 0}
        with mock.patch.object(run_grok_xbrief, "now_utc", return_value=self.end), \
             mock.patch.object(run_grok_xbrief.push_xbrief, "push", return_value=item) as push_mock, \
             mock.patch.object(run_grok_xbrief.push_xbrief, "publish_to_github") as publish_mock:
            code = run_grok_xbrief.run_observation(git_push=True)

        self.assertEqual(code, 0)
        push_mock.assert_called_once()
        self.assertEqual(push_mock.call_args.kwargs["period"], "近约1天")
        publish_mock.assert_called_once_with(
            run_grok_xbrief.push_xbrief.DATA_FILES,
            "外围热点更新 2026-08-04 23:00",
        )
        final_state = save_mock.call_args.args[0]
        self.assertIn(status_id, final_state["seenStatusIds"])
        self.assertEqual(final_state["lastResult"], "published")

    def test_launch_agent_runs_daily_at_23_and_uses_controlled_runner(self):
        plist_path = (
            run_grok_xbrief.ROOT
            / "launchd"
            / "com.stockdashboard.grok-xbrief.plist"
        )
        with plist_path.open("rb") as handle:
            plist = plistlib.load(handle)

        self.assertNotIn("StartInterval", plist)
        self.assertEqual(plist["StartCalendarInterval"], {"Hour": 23, "Minute": 0})
        self.assertFalse(plist["KeepAlive"])
        self.assertFalse(plist["RunAtLoad"])
        self.assertIn("scripts/run_grok_xbrief.py", plist["ProgramArguments"][1])
        self.assertIn("--git-push", plist["ProgramArguments"])


if __name__ == "__main__":
    unittest.main()
