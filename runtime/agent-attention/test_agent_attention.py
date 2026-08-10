#!/usr/bin/env python3
"""Public CLI regression tests for Agent Attention approval gates."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


RUNTIME = Path(__file__).with_name("agent-attention.py")
LIST_ID = "11111111-1111-4111-8111-111111111111"
REMINDER_ID = "22222222-2222-4222-8222-222222222222"
THREAD_ID = "019fc54e-ff95-7ca1-af49-5720c36fdc0d"
APPROVAL_MEANING = "Approve the bounded regression proof only."


class AgentAttentionPollTest(unittest.TestCase):
	"""Prove delivered gates do not remain open through the public CLI."""

	def test_delivered_gate_returns_waiting_with_zero_open_gates(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary)
			state_dir = root / "state"
			bin_dir = root / "bin"
			bin_dir.mkdir()
			mapping = self._write_delivered_gate(state_dir)
			self._write_fake_remindctl(bin_dir, mapping)

			completed = subprocess.run(
				[
					sys.executable,
					str(RUNTIME),
					"--state-dir",
					str(state_dir),
					"poll",
				],
				capture_output=True,
				check=False,
				text=True,
				env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
			)

			self.assertEqual(completed.returncode, 0, completed.stderr)
			result = json.loads(completed.stdout)
			self.assertEqual(result["status"], "waiting")
			self.assertEqual(result["open_gate_count"], 0)

	def _write_delivered_gate(self, state_dir: Path) -> dict[str, object]:
		mapping = {
			"version": 1,
			"list": {"id": LIST_ID, "name": "Agent Attention"},
			"reminder_id": REMINDER_ID,
			"expected_title": "[APPROVE] Regression proof",
			"required_notes_line": f"Approval meaning: {APPROVAL_MEANING}",
			"thread_id": THREAD_ID,
			"approval_meaning": APPROVAL_MEANING,
		}
		(state_dir / "gates").mkdir(parents=True)
		(state_dir / "receipts").mkdir()
		(state_dir / "config.json").write_text(
			json.dumps({"version": 1, "list": mapping["list"]}), encoding="utf-8"
		)
		(state_dir / "gates" / f"{REMINDER_ID}.json").write_text(
			json.dumps(mapping), encoding="utf-8"
		)
		payload = {
			"approval_meaning": APPROVAL_MEANING,
			"reminder_id": REMINDER_ID,
			"thread_id": THREAD_ID,
		}
		identifier = hashlib.sha256(
			json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
		).hexdigest()
		(state_dir / "receipts" / f"{identifier}.json").write_text(
			json.dumps({"event_id": identifier, **payload}), encoding="utf-8"
		)
		return mapping

	def _write_fake_remindctl(
		self, bin_dir: Path, mapping: dict[str, object]
	) -> None:
		inventory = [
			{
				"id": REMINDER_ID,
				"listID": LIST_ID,
				"title": mapping["expected_title"],
				"notes": mapping["required_notes_line"],
				"isCompleted": True,
				"completionDate": "2026-08-10T05:00:00Z",
			}
		]
		path = bin_dir / "remindctl"
		path.write_text(
			"#!/bin/sh\nprintf '%s\\n' '" + json.dumps(inventory) + "'\n",
			encoding="utf-8",
		)
		path.chmod(0o755)


if __name__ == "__main__":
	unittest.main()
