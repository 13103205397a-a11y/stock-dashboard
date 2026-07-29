import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import push_xbrief


def brief(brief_id, time, content):
    return {"id": brief_id, "time": time, "title": "外围热点", "content": content}


class PushXbriefMergeTest(unittest.TestCase):
    def test_merge_preserves_unique_remote_and_local_briefs_in_newest_first_order(self):
        remote = {
            "updated": "2026-07-29 11:00",
            "generatedAt": "2026-07-29 11:00",
            "briefs": [
                brief("20260729-110000", "2026-07-29 11:00", "remote-new"),
                brief("20260729-090000", "2026-07-29 09:00", "remote-old"),
            ],
        }
        local = {
            "updated": "2026-07-29 12:00",
            "generatedAt": "2026-07-29 12:00",
            "briefs": [
                brief("20260729-120000", "2026-07-29 12:00", "local-new"),
                brief("20260729-080000", "2026-07-29 08:00", "local-old"),
            ],
        }

        merged = push_xbrief.merge_xbriefs(local, remote)

        self.assertEqual(
            [item["id"] for item in merged["briefs"]],
            [
                "20260729-120000",
                "20260729-110000",
                "20260729-090000",
                "20260729-080000",
            ],
        )
        self.assertEqual(merged["updated"], "2026-07-29 12:00")
        self.assertEqual(merged["generatedAt"], "2026-07-29 12:00")

    def test_same_id_keeps_newer_item_and_remote_wins_equal_timestamp_conflict(self):
        shared_id = "20260729-100000"
        newer_local = {
            "updated": "2026-07-29 11:00",
            "generatedAt": "2026-07-29 11:00",
            "briefs": [brief(shared_id, "2026-07-29 11:00", "local-newer")],
        }
        older_remote = {
            "updated": "2026-07-29 10:00",
            "generatedAt": "2026-07-29 10:00",
            "briefs": [brief(shared_id, "2026-07-29 10:00", "remote-older")],
        }
        self.assertEqual(
            push_xbrief.merge_xbriefs(newer_local, older_remote)["briefs"][0]["content"],
            "local-newer",
        )

        equal_local = {
            "updated": "2026-07-29 10:00",
            "generatedAt": "2026-07-29 10:00",
            "briefs": [brief(shared_id, "2026-07-29 10:00", "local-conflict")],
        }
        self.assertEqual(
            push_xbrief.merge_xbriefs(equal_local, older_remote)["briefs"][0]["content"],
            "remote-older",
        )

    def test_remote_top_level_timestamp_is_not_rolled_back(self):
        local = {
            "updated": "2026-07-29 09:00",
            "generatedAt": "2026-07-29 09:00",
            "briefs": [],
        }
        remote = {
            "updated": "2026-07-29 12:00",
            "generatedAt": "2026-07-29 12:00",
            "briefs": [],
        }
        merged = push_xbrief.merge_xbriefs(local, remote)
        self.assertEqual(merged["updated"], "2026-07-29 12:00")
        self.assertEqual(merged["generatedAt"], "2026-07-29 12:00")

    def test_merge_deduplicates_and_caps_retention_to_newest_48(self):
        remote_items = [
            brief(f"20260729-{hour:02d}{minute:02d}00", f"2026-07-29 {hour:02d}:{minute:02d}", "remote")
            for hour in range(8, 24)
            for minute in (0, 20, 40)
        ]
        local_items = [
            dict(remote_items[-1]),
            brief("20260730-000000", "2026-07-30 00:00", "local-new"),
        ]
        merged = push_xbrief.merge_xbriefs(
            {"updated": "2026-07-30 00:00", "generatedAt": "2026-07-30 00:00", "briefs": local_items},
            {"updated": "2026-07-29 23:40", "generatedAt": "2026-07-29 23:40", "briefs": remote_items},
        )
        self.assertEqual(len(merged["briefs"]), 48)
        self.assertEqual(merged["briefs"][0]["id"], "20260730-000000")
        self.assertEqual(len({item["id"] for item in merged["briefs"]}), 48)

    def test_round_trip_loader_rejects_invalid_publish_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "xbriefs.js"
            push_xbrief.write_js(
                {
                    "updated": "2026-07-29 12:00",
                    "generatedAt": "2026-07-29 12:00",
                    "briefs": [brief("20260729-120000", "2026-07-29 12:00", "content")],
                },
                path,
            )
            self.assertEqual(push_xbrief.load_xbriefs(path, strict=True)["briefs"][0]["content"], "content")
            path.write_text("window.XBRIEFS = broken;", encoding="utf-8")
            with self.assertRaises(ValueError):
                push_xbrief.load_xbriefs(path, strict=True)

    def test_publish_merges_latest_remote_and_validates_before_commit(self):
        calls = []
        validated = []
        with tempfile.TemporaryDirectory() as temp:
            local_root = Path(temp)
            push_xbrief.write_js(
                {
                    "updated": "2026-07-29 12:00",
                    "generatedAt": "2026-07-29 12:00",
                    "briefs": [brief("20260729-120000", "2026-07-29 12:00", "local")],
                },
                local_root / "xbriefs.js",
            )

            def fake_run(command, *, cwd=local_root, check=False, timeout=120):
                calls.append(tuple(command))
                if command[:4] == ["git", "worktree", "add", "--detach"]:
                    worktree = Path(command[-2])
                    worktree.mkdir(parents=True)
                    push_xbrief.write_js(
                        {
                            "updated": "2026-07-29 11:00",
                            "generatedAt": "2026-07-29 11:00",
                            "briefs": [brief("20260729-110000", "2026-07-29 11:00", "remote")],
                        },
                        worktree / "xbriefs.js",
                    )
                elif command == ["node", "scripts/validate_data.js"]:
                    validated.append(push_xbrief.load_xbriefs(Path(cwd) / "xbriefs.js", strict=True))
                stdout = "xbriefs.js\n" if command[:3] == ["git", "diff", "--name-only"] else ""
                return mock.Mock(returncode=0, stdout=stdout, stderr="")

            with mock.patch.object(push_xbrief, "ROOT", local_root), \
                 mock.patch.object(push_xbrief, "run", side_effect=fake_run):
                self.assertEqual(
                    push_xbrief.publish_to_github(["xbriefs.js"], "test merge"),
                    ["xbriefs.js"],
                )

        self.assertEqual(
            [item["content"] for item in validated[0]["briefs"]],
            ["local", "remote"],
        )
        validate_index = calls.index(("node", "scripts/validate_data.js"))
        commit_index = next(index for index, call in enumerate(calls) if "commit" in call)
        self.assertLess(validate_index, commit_index)


if __name__ == "__main__":
    unittest.main()
