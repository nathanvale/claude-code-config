#!/usr/bin/env python3
"""Minimal Apple Reminders approval gates for Codex tasks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ContractError(Exception):
	"""Raised when a gate cannot be handled without guessing."""


def default_state_dir() -> Path:
	"""Return the private user-owned runtime state directory."""
	xdg_state = os.environ.get("XDG_STATE_HOME")
	if xdg_state:
		path = Path(xdg_state)
		if not path.is_absolute():
			raise ContractError("XDG_STATE_HOME must be an absolute path")
		return path / "agent-attention"
	return Path.home() / ".local" / "state" / "agent-attention"


def load_json(path: Path) -> Any:
	"""Load one JSON document from disk."""
	with path.open(encoding="utf-8") as handle:
		return json.load(handle)


def write_json(path: Path, value: Any, *, exclusive: bool = False) -> bool:
	"""Write private JSON atomically enough for single-host gate custody."""
	path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
	flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
	try:
		descriptor = os.open(path, flags, 0o600)
	except FileExistsError:
		return False
	with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
		json.dump(value, handle, sort_keys=True)
		handle.write("\n")
	return True


def run_json(command: list[str]) -> Any:
	"""Run a command whose primary output is one JSON document."""
	completed = subprocess.run(command, capture_output=True, text=True)
	if completed.returncode != 0:
		detail = completed.stderr.strip() or completed.stdout.strip()
		raise ContractError(f"command failed: {detail}")
	try:
		return json.loads(completed.stdout)
	except json.JSONDecodeError as error:
		raise ContractError("command returned invalid JSON") from error


def base_result(status: str, **values: Any) -> dict[str, Any]:
	"""Build one correlated machine-readable result."""
	return {
		"contract_id": "agent-attention.approval-gate",
		"schema_version": "1",
		"run_id": str(uuid.uuid4()),
		"status": status,
		**values,
	}


def read_config(state_dir: Path) -> dict[str, Any]:
	"""Load the explicit list binding and reject incomplete configuration."""
	path = state_dir / "config.json"
	if not path.exists():
		raise ContractError(
			"not configured; run configure with the exact Agent Attention list ID"
		)
	config = load_json(path)
	if config.get("version") != 1:
		raise ContractError("unsupported config version")
	list_config = config.get("list")
	if not isinstance(list_config, dict) or not list_config.get("id") or not list_config.get("name"):
		raise ContractError("configured list ID and name are required")
	return config


def configure(args: argparse.Namespace) -> dict[str, Any]:
	"""Persist one explicit Apple Reminders list binding."""
	state_dir: Path = args.state_dir
	config = {
		"version": 1,
		"list": {"id": args.list_id, "name": args.list_name},
	}
	write_json(state_dir / "config.json", config)
	return base_result(
		"configured",
		changed=True,
		list={"id": args.list_id, "name": args.list_name},
		next_safe_action="run doctor",
	)


def validate_thread_id(value: str) -> str:
	"""Normalize a Codex thread UUID for stable URLs and mappings."""
	try:
		return str(uuid.UUID(value))
	except ValueError as error:
		raise ContractError("thread ID must be one UUID") from error


def gate_notes(recommendation: str, approval_meaning: str) -> tuple[str, str]:
	"""Render concise recommendation-first notes and their required contract line."""
	required_line = f"Approval meaning: {approval_meaning}"
	lines = [
		f"Recommended: {recommendation}",
		"",
		required_line,
		"Tick = approve only this action.",
		"Discuss or disagree: open Codex.",
	]
	return "\n".join(lines), required_line


def create_gate(args: argparse.Namespace) -> dict[str, Any]:
	"""Preview or create one bounded approval reminder and gate mapping."""
	state_dir: Path = args.state_dir
	config = read_config(state_dir)
	thread_id = validate_thread_id(args.thread_id)
	title = f"[APPROVE] {args.title.strip()}"
	if title == "[APPROVE] ":
		raise ContractError("title must not be empty")
	notes, required_line = gate_notes(args.recommendation, args.approval_meaning)
	link = f"agent-attention://threads/{thread_id}"
	preview = {
		"title": title,
		"notes": notes,
		"url": link,
		"priority": args.priority,
		"due": args.due,
		"list": config["list"],
		"thread_id": thread_id,
	}
	if not args.execute:
		return base_result(
			"preview",
			changed=False,
			side_effect="write Apple Reminder",
			preview=preview,
			next_safe_action="review preview, then rerun with --execute",
		)

	command = [
		"remindctl",
		"add",
		"--title",
		title,
		"--list-id",
		config["list"]["id"],
		"--notes",
		notes,
		"--url",
		link,
		"--priority",
		args.priority,
		"--json",
		"--no-input",
	]
	if args.due:
		command.extend(["--due", args.due, "--alarm", args.due])
	created = run_json(command)
	reminder_id = created.get("id") if isinstance(created, dict) else None
	if not reminder_id:
		raise ContractError("created reminder response lacks a stable ID; inspect before retry")

	mapping = {
		"version": 1,
		"list": config["list"],
		"reminder_id": reminder_id,
		"expected_title": title,
		"required_notes_line": required_line,
		"thread_id": thread_id,
		"approval_meaning": args.approval_meaning,
		"created_at": datetime.now(timezone.utc).isoformat(),
	}
	write_json(state_dir / "gates" / f"{reminder_id}.json", mapping, exclusive=True)
	return base_result(
		"created",
		changed=True,
		reminder_id=reminder_id,
		thread_id=thread_id,
		url=link,
		next_safe_action="wait for completion or run poll",
	)


def read_inventory(config: dict[str, Any]) -> list[dict[str, Any]]:
	"""Read only the configured Apple Reminders list."""
	inventory = run_json(
		[
			"remindctl",
			"list",
			"--list-id",
			config["list"]["id"],
			"--json",
			"--no-input",
		]
	)
	if not isinstance(inventory, list):
		raise ContractError("remindctl inventory must be a JSON array")
	return inventory


def event_id(mapping: dict[str, Any]) -> str:
	"""Bind one approval event to its reminder, thread, and exact meaning."""
	payload = {
		"approval_meaning": mapping["approval_meaning"],
		"reminder_id": mapping["reminder_id"],
		"thread_id": mapping["thread_id"],
	}
	encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
	return hashlib.sha256(encoded).hexdigest()


def poll(args: argparse.Namespace) -> dict[str, Any]:
	"""Claim at most one newly completed approval gate for task delivery."""
	state_dir: Path = args.state_dir
	config = read_config(state_dir)
	mapping_paths = sorted((state_dir / "gates").glob("*.json"))
	if not mapping_paths:
		return base_result("waiting", changed=False, open_gate_count=0)
	inventory = read_inventory(config)
	items_by_id = {item.get("id"): item for item in inventory}

	for mapping_path in mapping_paths:
		mapping = load_json(mapping_path)
		reminder = items_by_id.get(mapping.get("reminder_id"))
		if not reminder:
			raise ContractError("configured stable reminder ID did not resolve")
		if reminder.get("listID") != config["list"]["id"]:
			raise ContractError("reminder resolved outside the configured list")
		if reminder.get("title") != mapping.get("expected_title"):
			raise ContractError("reminder title changed; refusing semantic inference")
		if mapping.get("required_notes_line") not in (reminder.get("notes") or "").splitlines():
			raise ContractError("approval meaning is absent from reminder notes")
		if not reminder.get("isCompleted"):
			continue
		if not reminder.get("completionDate"):
			raise ContractError("completed reminder lacks a completion timestamp")

		identifier = event_id(mapping)
		receipt_path = state_dir / "receipts" / f"{identifier}.json"
		claim_path = state_dir / "claims" / f"{identifier}.json"
		if receipt_path.exists():
			continue
		if claim_path.exists():
			return base_result(
				"claimed",
				changed=False,
				event_id=identifier,
				repair="inspect the destination task before releasing this claim",
			)

		claim = {
			"claimed_at": datetime.now(timezone.utc).isoformat(),
			"event_id": identifier,
			"reminder_id": mapping["reminder_id"],
			"completion_date": reminder["completionDate"],
			"thread_id": mapping["thread_id"],
			"approval_meaning": mapping["approval_meaning"],
		}
		if not write_json(claim_path, claim, exclusive=True):
			return base_result("claimed", changed=False, event_id=identifier)
		return base_result(
			"deliver",
			changed=True,
			event_id=identifier,
			thread_id=mapping["thread_id"],
			prompt=(
				f"Agent Attention approval received. {mapping['approval_meaning']} "
				f"Receipt key: {identifier}. This approval applies only to that action."
			),
			next_safe_action="deliver once with the Codex task tool, then record-delivery",
		)

	return base_result("waiting", changed=False, open_gate_count=len(mapping_paths))


def record_delivery(args: argparse.Namespace) -> dict[str, Any]:
	"""Record successful supported task delivery without reopening the reminder."""
	state_dir: Path = args.state_dir
	claim_path = state_dir / "claims" / f"{args.event_id}.json"
	receipt_path = state_dir / "receipts" / f"{args.event_id}.json"
	if receipt_path.exists():
		return base_result("already_delivered", changed=False, event_id=args.event_id)
	if not claim_path.exists():
		raise ContractError("cannot record delivery without an existing claim")
	try:
		tool_result = json.loads(args.tool_result)
	except json.JSONDecodeError as error:
		raise ContractError("tool result must be valid JSON") from error
	if not tool_result.get("delivered"):
		raise ContractError("tool result does not confirm delivery")

	claim = load_json(claim_path)
	receipt = {
		**claim,
		"delivered_at": datetime.now(timezone.utc).isoformat(),
		"tool": "codex_app.send_message_to_thread",
		"tool_result": tool_result,
	}
	if not write_json(receipt_path, receipt, exclusive=True):
		return base_result("already_delivered", changed=False, event_id=args.event_id)
	log_path = state_dir / "audit.jsonl"
	log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
	with log_path.open("a", encoding="utf-8") as handle:
		handle.write(json.dumps(receipt, sort_keys=True) + "\n")
	os.chmod(log_path, 0o600)
	return base_result("recorded", changed=True, event_id=args.event_id)


def doctor(args: argparse.Namespace) -> dict[str, Any]:
	"""Report readiness without reading private message or reminder content."""
	state_dir: Path = args.state_dir
	reminders = run_json(["remindctl", "doctor", "--for-agent", "--json"])
	config_path = state_dir / "config.json"
	config_status: dict[str, Any] = {"configured": False}
	if config_path.exists():
		config = read_config(state_dir)
		config_status = {"configured": True, "list": config["list"]}

	handler_path = Path.home() / "Applications" / "Agent Attention Link.app"
	info_path = handler_path / "Contents" / "Info.plist"
	handler = {"installed": False, "path": str(handler_path)}
	if info_path.exists():
		with info_path.open("rb") as handle:
			info = plistlib.load(handle)
		schemes = [
			scheme
			for item in info.get("CFBundleURLTypes", [])
			for scheme in item.get("CFBundleURLSchemes", [])
		]
		handler["installed"] = "agent-attention" in schemes

	ready = bool(reminders.get("authorization", {}).get("authorized")) and config_status["configured"] and handler["installed"]
	return base_result(
		"ready" if ready else "repair_needed",
		changed=False,
		reminders={"authorized": reminders.get("authorization", {}).get("authorized", False)},
		config=config_status,
		link_handler=handler,
		next_safe_action=(
			"create or poll an approval gate"
			if ready
			else "configure the list and run install-link-handler.sh"
		),
	)


def parser() -> argparse.ArgumentParser:
	"""Build the stable command surface."""
	command = argparse.ArgumentParser(
		prog="agent-attention",
		description="Create and deliver bounded Apple Reminders approval gates.",
	)
	command.add_argument("--state-dir", type=Path, default=default_state_dir())
	subcommands = command.add_subparsers(dest="command", required=True)

	subcommands.add_parser("doctor", help="Check Reminders, configuration, and link readiness.")

	configure_command = subcommands.add_parser("configure", help="Bind one explicit Agent Attention list.")
	configure_command.add_argument("--list-id", required=True)
	configure_command.add_argument("--list-name", required=True)

	create_command = subcommands.add_parser("create", help="Preview or create one approval gate.")
	create_command.add_argument("--thread-id", required=True)
	create_command.add_argument("--title", required=True)
	create_command.add_argument("--recommendation", required=True)
	create_command.add_argument("--approval-meaning", required=True)
	create_command.add_argument("--priority", choices=("low", "medium", "high"), default="high")
	create_command.add_argument("--due")
	create_command.add_argument("--execute", action="store_true")

	subcommands.add_parser("poll", help="Claim at most one completed approval for delivery.")

	record_command = subcommands.add_parser("record-delivery", help="Record a successful Codex task delivery.")
	record_command.add_argument("--event-id", required=True)
	record_command.add_argument("--tool-result", required=True)
	return command


def main() -> int:
	"""Dispatch one command and emit one JSON result."""
	args = parser().parse_args()
	try:
		if args.command == "configure":
			result = configure(args)
		elif args.command == "create":
			result = create_gate(args)
		elif args.command == "poll":
			result = poll(args)
		elif args.command == "record-delivery":
			result = record_delivery(args)
		else:
			result = doctor(args)
	except (ContractError, json.JSONDecodeError, OSError, subprocess.SubprocessError) as error:
		print(str(error), file=sys.stderr)
		print(
			json.dumps(
				base_result(
					"error",
					changed="unknown",
					retry_safe=False,
					error_category="contract_or_runtime",
					next_safe_action="inspect current state before retry",
				)
			)
		)
		return 1
	print(json.dumps(result, sort_keys=True))
	return 0


if __name__ == "__main__":
	sys.exit(main())
