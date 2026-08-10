#!/usr/bin/env python3
"""Public-command tests for Agent Attention runtime contracts."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import unittest
from pathlib import Path
from typing import Any


RUNTIME = Path(__file__).with_name("agent-attention.py")
LIST_ID = "32C46BA9-FE7A-4758-AA9E-4C4A249A5DF6"
REMINDER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_REMINDER_ID = "22222222-2222-4222-8222-222222222222"
NEW_REMINDER_ID = "33333333-3333-4333-8333-333333333333"
THREAD_ID = "019fc54e-ff95-7ca1-af49-5720c36fdc0d"
APPROVAL_MEANING = "Approve the bounded outcome-receipt test only."
FINISHED_AT = "2026-08-10T05:45:00Z"


class AgentAttentionCommandTest(unittest.TestCase):
	"""Prove discovery and outcome behavior through the public CLI."""

	def setUp(self) -> None:
		self.temporary = tempfile.TemporaryDirectory()
		self.root = Path(self.temporary.name)
		self.state_dir = self.root / "state"
		self.bin_dir = self.root / "bin"
		self.inventory_path = self.root / "inventory.json"
		self.calls_path = self.root / "calls.jsonl"
		self.poll_count_path = self.root / "poll-count.txt"
		self.bin_dir.mkdir()
		self._write_fake_remindctl()
		self.env = {
			**os.environ,
			"PATH": f"{self.bin_dir}:{os.environ['PATH']}",
			"FAKE_REMINDERS_INVENTORY": str(self.inventory_path),
			"FAKE_REMINDERS_CALLS": str(self.calls_path),
			"FAKE_REMINDERS_POLL_COUNT": str(self.poll_count_path),
		}
		self.mapping = {
			"version": 1,
			"list": {"id": LIST_ID, "name": "Agent Attention"},
			"reminder_id": REMINDER_ID,
			"expected_title": "[APPROVE] Approve outcome receipt test",
			"required_notes_line": f"Approval meaning: {APPROVAL_MEANING}",
			"thread_id": THREAD_ID,
			"approval_meaning": APPROVAL_MEANING,
		}
		self.target = {
			"id": REMINDER_ID,
			"listID": LIST_ID,
			"listName": "Agent Attention",
			"title": self.mapping["expected_title"],
			"notes": (
				"Recommended: approve.\n\n"
				f"Approval meaning: {APPROVAL_MEANING}\n"
				"Tick = approve only this action.\n"
				"Discuss or disagree: open Codex.\n\n"
				f"remindctl URL (managed): agent-attention://threads/{THREAD_ID}"
			),
			"url": f"agent-attention://threads/{THREAD_ID}",
			"priority": "high",
			"isCompleted": True,
			"completionDate": "2026-08-10T05:40:00Z",
			"lastModifiedDate": "2026-08-10T05:40:00Z",
		}
		self.other = {
			"id": OTHER_REMINDER_ID,
			"listID": LIST_ID,
			"listName": "Agent Attention",
			"title": "[APPROVE] Other gate",
			"notes": "Unrelated sentinel",
			"priority": "low",
			"isCompleted": False,
			"lastModifiedDate": "2026-08-10T05:30:00Z",
		}
		self._write_state(delivery_receipt=True)
		self._write_inventory()

	def tearDown(self) -> None:
		self.temporary.cleanup()

	def _write_fake_remindctl(self) -> None:
		path = self.bin_dir / "remindctl"
		path.write_text(
			"""#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

inventory_path = Path(os.environ["FAKE_REMINDERS_INVENTORY"])
calls_path = Path(os.environ["FAKE_REMINDERS_CALLS"])
args = sys.argv[1:]
with calls_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(args) + "\\n")
inventory = json.loads(inventory_path.read_text(encoding="utf-8"))

if args[0] == "show":
    if args[1] == "all" and os.environ.get("FAKE_REMINDERS_COMPLETE_AFTER_POLLS"):
        poll_count_path = Path(os.environ["FAKE_REMINDERS_POLL_COUNT"])
        count = int(poll_count_path.read_text() if poll_count_path.exists() else "0") + 1
        poll_count_path.write_text(str(count))
        if count >= int(os.environ["FAKE_REMINDERS_COMPLETE_AFTER_POLLS"]):
            target = inventory[0]
            if not target.get("isCompleted"):
                target["isCompleted"] = True
                target["completionDate"] = datetime.now(timezone.utc).isoformat()
                inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    if args[1] == "completed":
        inventory = [item for item in inventory if item.get("isCompleted")]
    print(json.dumps(inventory))
elif args[0] == "add":
    reminder = {
        "id": os.environ.get("FAKE_REMINDERS_NEW_ID", "33333333-3333-4333-8333-333333333333"),
        "listID": args[args.index("--list-id") + 1],
        "listName": "Agent Attention",
        "title": args[args.index("--title") + 1],
        "notes": args[args.index("--notes") + 1],
        "url": args[args.index("--url") + 1],
        "priority": args[args.index("--priority") + 1],
        "alarm": args[args.index("--alarm") + 1],
        "isCompleted": False,
        "lastModifiedDate": datetime.now(timezone.utc).isoformat(),
    }
    inventory.append(reminder)
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    print(json.dumps(reminder))
elif args[0] == "edit":
    reminder_id = args[1]
    notes = args[args.index("--notes") + 1]
    matches = [item for item in inventory if item.get("id") == reminder_id]
    if len(matches) != 1:
        raise SystemExit(4)
    matches[0]["notes"] = notes
    matches[0]["lastModifiedDate"] = "2026-08-10T05:45:01Z"
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    if os.environ.get("FAKE_REMINDERS_FAIL_AFTER_EDIT") == "1":
        print("unknown result after write", file=sys.stderr)
        raise SystemExit(5)
    print(json.dumps(matches[0]))
else:
    print(json.dumps({"authorization": {"authorized": True}}))
""",
			encoding="utf-8",
		)
		path.chmod(0o755)

	def _write_inventory(self) -> None:
		self.inventory_path.write_text(
			json.dumps([self.target, self.other]), encoding="utf-8"
		)

	def _write_state(self, *, delivery_receipt: bool) -> None:
		(self.state_dir / "gates").mkdir(parents=True)
		(self.state_dir / "config.json").write_text(
			json.dumps({"version": 1, "list": self.mapping["list"]}),
			encoding="utf-8",
		)
		(self.state_dir / "gates" / f"{REMINDER_ID}.json").write_text(
			json.dumps(self.mapping), encoding="utf-8"
		)
		if delivery_receipt:
			identifier = self._event_id()
			(self.state_dir / "receipts").mkdir()
			(self.state_dir / "receipts" / f"{identifier}.json").write_text(
				json.dumps(
					{
						"event_id": identifier,
						"reminder_id": REMINDER_ID,
						"thread_id": THREAD_ID,
						"approval_meaning": APPROVAL_MEANING,
						"delivered_at": "2026-08-10T05:41:00Z",
					}
				),
				encoding="utf-8",
			)

	def _event_id(self) -> str:
		import hashlib

		payload = {
			"approval_meaning": APPROVAL_MEANING,
			"reminder_id": REMINDER_ID,
			"thread_id": THREAD_ID,
		}
		encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
		return hashlib.sha256(encoded).hexdigest()

	def _outcome_id(self, outcome: str) -> str:
		import hashlib

		payload = {
			"event_id": self._event_id(),
			"finished_at": FINISHED_AT,
			"outcome": outcome,
		}
		encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
		return hashlib.sha256(encoded).hexdigest()

	def run_cli(
		self, *arguments: str, env_update: dict[str, str] | None = None
	) -> subprocess.CompletedProcess[str]:
		env = {**self.env, **(env_update or {})}
		return subprocess.run(
			[
				sys.executable,
				str(RUNTIME),
				"--state-dir",
				str(self.state_dir),
				*arguments,
			],
			capture_output=True,
			text=True,
			env=env,
		)

	def result(self, completed: subprocess.CompletedProcess[str]) -> dict[str, Any]:
		self.assertEqual(completed.returncode, 0, completed.stderr)
		return json.loads(completed.stdout)

	def calls(self) -> list[list[str]]:
		if not self.calls_path.exists():
			return []
		return [json.loads(line) for line in self.calls_path.read_text().splitlines()]

	def submit_arguments(self, **overrides: str | bool) -> tuple[str, ...]:
		values: dict[str, str | bool] = {
			"decision_type": "yes_no",
			"unblocks_paused_task": True,
			"action": "Approve local router test",
			"recommendation": "Approve the bounded local router test.",
			"consequence": "The paused task will resume and run its focused tests.",
			"discussion_link": f"agent-attention://threads/{THREAD_ID}",
			"continuation": "Run the focused tests, then record the terminal outcome.",
			"approval_meaning": "Approve the bounded local router test only.",
		}
		values.update(overrides)
		arguments = ["submit", "--thread-id", THREAD_ID]
		for field, value in values.items():
			flag = f"--{field.replace('_', '-')}"
			if isinstance(value, bool):
				if value:
					arguments.append(flag)
			else:
				arguments.extend([flag, value])
		return tuple(arguments)

	def test_command_discovery_help_and_parser_stay_aligned(self) -> None:
		discovery = self.result(self.run_cli("commands"))
		command_names = [item["name"] for item in discovery["commands"]]
		self.assertIn("record-outcome", command_names)

		help_result = self.run_cli("--help")
		self.assertEqual(help_result.returncode, 0)
		for command_name in command_names:
			self.assertIn(command_name, help_result.stdout)
			self.assertEqual(self.run_cli(command_name, "--help").returncode, 0)
		submit_help = self.run_cli("submit", "--help").stdout
		for term in ("yes_no", "paused", "Approve", "one alert"):
			self.assertIn(term, submit_help)

	def test_outcome_preview_is_read_only_and_exact(self) -> None:
		result = self.result(
			self.run_cli(
				"record-outcome",
				"--reminder-id",
				REMINDER_ID,
				"--outcome",
				"Review-ready PR opened; local checks passed.",
				"--finished-at",
				FINISHED_AT,
			)
		)
		self.assertEqual(result["status"], "preview")
		self.assertFalse(result["changed"])
		self.assertEqual(result["reminder_id"], REMINDER_ID)
		self.assertEqual(
			self.calls(),
			[
				[
					"show",
					"completed",
					"--list-id",
					LIST_ID,
					"--json",
					"--no-input",
				]
			],
		)
		self.assertNotIn("Outcome:", self.target["notes"])

	def test_outcome_execute_updates_only_exact_completed_gate_once(self) -> None:
		arguments = (
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Review-ready PR opened; local checks passed.",
			"--finished-at",
			FINISHED_AT,
			"--execute",
		)
		first = self.result(self.run_cli(*arguments))
		self.assertEqual(first["status"], "recorded")
		self.assertTrue(first["changed"])
		inventory = json.loads(self.inventory_path.read_text())
		target = next(item for item in inventory if item["id"] == REMINDER_ID)
		other = next(item for item in inventory if item["id"] == OTHER_REMINDER_ID)
		self.assertTrue(target["isCompleted"])
		self.assertEqual(target["completionDate"], "2026-08-10T05:40:00Z")
		self.assertIn(
			(
				"Outcome: Review-ready PR opened; local checks passed.\n"
				f"Finished: {FINISHED_AT}"
			),
			target["notes"],
		)
		self.assertTrue(
			target["notes"].endswith(
				f"remindctl URL (managed): agent-attention://threads/{THREAD_ID}"
			)
		)
		self.assertEqual(other, self.other)
		outcome_receipts = list((self.state_dir / "outcomes").glob("*.json"))
		self.assertEqual(len(outcome_receipts), 1)
		audit_lines = (self.state_dir / "outcome-audit.jsonl").read_text().splitlines()
		self.assertEqual(len(audit_lines), 1)
		self.assertEqual(json.loads(audit_lines[0]), json.loads(outcome_receipts[0].read_text()))
		self.assertEqual(
			self.calls(),
			[
				["show", "completed", "--list-id", LIST_ID, "--json", "--no-input"],
				["edit", REMINDER_ID, "--notes", target["notes"], "--json", "--no-input"],
				["show", "completed", "--list-id", LIST_ID, "--json", "--no-input"],
			],
		)

		second = self.result(self.run_cli(*arguments))
		self.assertEqual(second["status"], "already_recorded")
		self.assertFalse(second["changed"])
		self.assertEqual(len([call for call in self.calls() if call[0] == "edit"]), 1)
		self.assertEqual(
			len((self.state_dir / "outcome-audit.jsonl").read_text().splitlines()), 1
		)

	def test_outcome_rejects_a_second_terminal_result(self) -> None:
		first = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"First terminal result.",
			"--finished-at",
			FINISHED_AT,
			"--execute",
		)
		self.assertEqual(first.returncode, 0, first.stderr)
		second = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Different terminal result.",
			"--finished-at",
			FINISHED_AT,
			"--execute",
		)
		self.assertEqual(second.returncode, 1)
		self.assertIn("different terminal outcome", second.stderr)
		self.assertEqual(len([call for call in self.calls() if call[0] == "edit"]), 1)

	def test_outcome_unknown_result_recovers_by_exact_reread_without_second_edit(self) -> None:
		arguments = (
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Recovered terminal result.",
			"--finished-at",
			FINISHED_AT,
			"--execute",
		)
		unknown = self.run_cli(
			*arguments, env_update={"FAKE_REMINDERS_FAIL_AFTER_EDIT": "1"}
		)
		self.assertEqual(unknown.returncode, 1)
		self.assertIn("inspect current state before retry", unknown.stdout)

		recovered = self.result(self.run_cli(*arguments))
		self.assertEqual(recovered["status"], "already_recorded")
		self.assertEqual(len([call for call in self.calls() if call[0] == "edit"]), 1)
		receipt = json.loads(next((self.state_dir / "outcomes").glob("*.json")).read_text())
		self.assertTrue(receipt["recovered"])

	def test_existing_outcome_claim_suppresses_a_concurrent_edit(self) -> None:
		outcome = "Concurrent terminal result."
		claim_dir = self.state_dir / "outcome-claims"
		claim_dir.mkdir()
		(claim_dir / f"{self._event_id()}.json").write_text(
			json.dumps(
				{
					"event_id": self._event_id(),
					"finished_at": FINISHED_AT,
					"outcome": outcome,
					"outcome_id": self._outcome_id(outcome),
					"reminder_id": REMINDER_ID,
				}
			),
			encoding="utf-8",
		)
		result = self.result(
			self.run_cli(
				"record-outcome",
				"--reminder-id",
				REMINDER_ID,
				"--outcome",
				outcome,
				"--finished-at",
				FINISHED_AT,
				"--execute",
			)
		)
		self.assertEqual(result["status"], "claimed")
		self.assertEqual(
			self.calls(),
			[["show", "completed", "--list-id", LIST_ID, "--json", "--no-input"]],
		)

	def test_outcome_rejects_incomplete_gate(self) -> None:
		self.target["isCompleted"] = False
		self.target.pop("completionDate")
		self._write_inventory()
		completed = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Should fail.",
			"--finished-at",
			FINISHED_AT,
		)
		self.assertEqual(completed.returncode, 1)
		self.assertIn("Completed history", completed.stderr)

	def test_outcome_rejects_missing_delivery_receipt(self) -> None:
		for path in (self.state_dir / "receipts").glob("*.json"):
			path.unlink()
		completed = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Should fail.",
			"--finished-at",
			FINISHED_AT,
		)
		self.assertEqual(completed.returncode, 1)
		self.assertIn("delivery receipt", completed.stderr)

	def test_outcome_rejects_delivery_receipt_for_a_different_task(self) -> None:
		receipt_path = next((self.state_dir / "receipts").glob("*.json"))
		receipt = json.loads(receipt_path.read_text())
		receipt["thread_id"] = "33333333-3333-4333-8333-333333333333"
		receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
		completed = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"Should fail.",
			"--finished-at",
			FINISHED_AT,
		)
		self.assertEqual(completed.returncode, 1)
		self.assertIn("does not match gate field: thread_id", completed.stderr)
		self.assertEqual(self.calls(), [])

	def test_outcome_rejects_multiline_history(self) -> None:
		completed = self.run_cli(
			"record-outcome",
			"--reminder-id",
			REMINDER_ID,
			"--outcome",
			"First line.\nSecond line.",
			"--finished-at",
			FINISHED_AT,
		)
		self.assertEqual(completed.returncode, 1)
		self.assertIn("one concise line", completed.stderr)
		self.assertEqual(self.calls(), [])

	def test_submit_admits_one_gate_with_one_alert_and_suppresses_duplicate(self) -> None:
		preview = self.result(self.run_cli(*self.submit_arguments()))
		self.assertEqual(preview["status"], "admitted_preview")
		self.assertFalse(preview["changed"])
		self.assertEqual(self.calls(), [])
		self.assertEqual(preview["preview"]["priority"], "none")

		arguments = (*self.submit_arguments(), "--execute")
		first = self.result(self.run_cli(*arguments))
		self.assertEqual(first["status"], "gated")
		self.assertEqual(first["notification_count"], 1)
		add_calls = [call for call in self.calls() if call[0] == "add"]
		self.assertEqual(len(add_calls), 1)
		self.assertIn("--alarm", add_calls[0])
		self.assertNotIn("--due", add_calls[0])
		self.assertEqual(add_calls[0][add_calls[0].index("--priority") + 1], "none")
		inventory = json.loads(self.inventory_path.read_text())
		self.assertEqual(next(item for item in inventory if item["id"] == REMINDER_ID), self.target)
		self.assertEqual(next(item for item in inventory if item["id"] == OTHER_REMINDER_ID), self.other)
		self.assertEqual(len([item for item in inventory if item["id"] == NEW_REMINDER_ID]), 1)

		second = self.result(self.run_cli(*arguments))
		self.assertEqual(second["status"], "already_gated")
		self.assertFalse(second["changed"])
		self.assertEqual(len([call for call in self.calls() if call[0] == "add"]), 1)

	def test_submit_rejects_multi_choice_and_records_actionable_repair(self) -> None:
		result = self.result(
			self.run_cli(
				*self.submit_arguments(decision_type="multi_choice"),
				"--execute",
			)
		)
		self.assertEqual(result["status"], "rejected")
		self.assertIn("multi-choice", result["repair"])
		self.assertEqual(self.calls(), [])
		stop = self.result(self.run_cli("check-stop", "--thread-id", THREAD_ID))
		self.assertEqual(stop["status"], "repair")
		self.assertEqual(stop["hook_action"], "allow")

	def test_submit_rejects_information_updates_and_non_blockers(self) -> None:
		for overrides, expected in (
			({"decision_type": "information"}, "decision_type"),
			({"unblocks_paused_task": False}, "paused owning task"),
			({"discussion_link": "agent-attention://threads/wrong"}, "exact owning"),
		):
			with self.subTest(overrides=overrides):
				result = self.result(self.run_cli(*self.submit_arguments(**overrides)))
				self.assertEqual(result["status"], "rejected")
				self.assertIn(expected, result["repair"])
		self.assertEqual(self.calls(), [])

	def test_existing_submit_claim_suppresses_a_concurrent_gate_and_alert(self) -> None:
		claim_dir = self.state_dir / "request-claims"
		claim_dir.mkdir()
		(claim_dir / f"{THREAD_ID}.json").write_text(
			json.dumps({"thread_id": THREAD_ID, "request_id": "winner"}),
			encoding="utf-8",
		)
		result = self.result(
			self.run_cli(*self.submit_arguments(), "--execute")
		)
		self.assertEqual(result["status"], "claimed")
		self.assertFalse(result["changed"])
		self.assertEqual(self.calls(), [])

	def test_stop_check_continues_declared_or_delivered_state_without_reading_prose(self) -> None:
		request_dir = self.state_dir / "requests"
		request_dir.mkdir()
		path = request_dir / f"{THREAD_ID}.json"
		path.write_text(
			json.dumps(
				{
					"version": 1,
					"thread_id": THREAD_ID,
					"status": "declared",
					"intent": {"continuation": "Run the exact continuation."},
				}
			),
			encoding="utf-8",
		)
		declared = self.result(self.run_cli("check-stop", "--thread-id", THREAD_ID))
		self.assertEqual(declared["hook_action"], "continue")
		self.assertNotIn("assistant", json.dumps(declared).casefold())

		state = json.loads(path.read_text())
		state["status"] = "delivered"
		path.write_text(json.dumps(state), encoding="utf-8")
		delivered = self.result(self.run_cli("check-stop", "--thread-id", THREAD_ID))
		self.assertEqual(delivered["hook_action"], "continue")
		self.assertIn("Run the exact continuation", delivered["reason"])

	def test_watch_detects_and_records_delivery_under_fifteen_seconds(self) -> None:
		self.target["isCompleted"] = False
		self.target.pop("completionDate")
		self._write_inventory()
		for path in (self.state_dir / "receipts").glob("*.json"):
			path.unlink()
		result = self.result(
			self.run_cli(
				"watch",
				"--interval-seconds",
				"0.05",
				"--timeout-seconds",
				"1",
				env_update={"FAKE_REMINDERS_COMPLETE_AFTER_POLLS": "2"},
			)
		)
		self.assertEqual(result["status"], "deliver")
		self.assertEqual(result["poll_count"], 2)
		self.assertLess(result["detection_latency_seconds"], 15)
		recorded = self.result(
			self.run_cli(
				"record-delivery",
				"--event-id",
				result["event_id"],
				"--tool-result",
				'{"delivered":true,"fixture":"exact-task"}',
			)
		)
		self.assertEqual(recorded["status"], "recorded")
		completion = datetime.fromisoformat(result["completion_date"])
		self.assertLess((datetime.now(timezone.utc) - completion).total_seconds(), 15)
		duplicate = self.result(self.run_cli("poll"))
		self.assertEqual(duplicate["status"], "waiting")
		self.assertEqual(
			len((self.state_dir / "audit.jsonl").read_text().splitlines()), 1
		)

	def test_delivered_historical_gate_may_be_human_deleted_without_blocking_poll(self) -> None:
		self.inventory_path.write_text(json.dumps([self.other]), encoding="utf-8")
		result = self.result(self.run_cli("poll"))
		self.assertEqual(result["status"], "waiting")
		self.assertFalse(result["changed"])
		self.assertEqual(
			self.calls(),
			[["show", "all", "--list-id", LIST_ID, "--json", "--no-input"]],
		)


if __name__ == "__main__":
	unittest.main()
