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
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


COMMAND_CATALOG = (
	{"name": "commands", "summary": "List the machine-readable command surface."},
	{"name": "doctor", "summary": "Check Reminders, configuration, and link readiness."},
	{"name": "configure", "summary": "Bind one explicit Agent Attention list."},
	{"name": "create", "summary": "Preview or create one approval gate."},
	{"name": "submit", "summary": "Validate and route one structured approval blocker."},
	{"name": "poll", "summary": "Claim at most one completed approval for delivery."},
	{"name": "watch", "summary": "Poll for one approval within a bounded foreground window."},
	{"name": "record-delivery", "summary": "Record a successful Codex task delivery."},
	{"name": "record-outcome", "summary": "Preview or append one bounded terminal outcome."},
	{"name": "check-stop", "summary": "Check structured owner state before a task stops."},
)
MANAGED_URL_PREFIX = "remindctl URL (managed): "


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


def append_audit(path: Path, value: Any) -> None:
	"""Append one private JSON audit event."""
	path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
	with path.open("a", encoding="utf-8") as handle:
		handle.write(json.dumps(value, sort_keys=True) + "\n")
	os.chmod(path, 0o600)


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


def router_notes(intent: dict[str, Any]) -> tuple[str, str]:
	"""Render one calm recommendation-first approval contract."""
	required_line = f"Approval meaning: {intent['approval_meaning']}"
	lines = [
		f"Recommended: {intent['recommendation']}",
		"Next: Tick to approve. Open Codex to discuss or disagree.",
		"",
		f"Consequence: {intent['consequence']}",
		f"Continuation: {intent['continuation']}",
		"",
		required_line,
		"Tick = approve only this action.",
	]
	return "\n".join(lines), required_line


def validate_text_field(intent: dict[str, Any], field: str, limit: int) -> str:
	"""Require one bounded single-line structured intent field."""
	value = intent.get(field)
	if not isinstance(value, str):
		raise ContractError(f"structured intent field must be text: {field}")
	value = value.strip()
	if not value or "\n" in value or "\r" in value or len(value) > limit:
		raise ContractError(f"structured intent field is invalid: {field}")
	return value


def approval_intent(args: argparse.Namespace) -> dict[str, Any]:
	"""Build the structured intent owned by the public submit parser."""
	thread_id = validate_thread_id(args.thread_id)
	return {
		"version": 1,
		"decision_type": args.decision_type,
		"unblocks_paused_task": args.unblocks_paused_task,
		"action": args.action,
		"recommendation": args.recommendation,
		"consequence": args.consequence,
		"thread_id": thread_id,
		"discussion_link": args.discussion_link,
		"continuation": args.continuation,
		"approval_meaning": args.approval_meaning,
	}


def validate_approval_intent(intent: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
	"""Admit only an explicit yes/no decision that unblocks one paused task."""
	reasons: list[str] = []
	if intent.get("decision_type") != "yes_no":
		reasons.append("decision_type must be yes_no; discussion or multi-choice stays in Codex")
	if intent.get("unblocks_paused_task") is not True:
		reasons.append("the approval must unblock a paused owning task")

	normalized = {**intent}
	for field, limit in (
		("action", 100),
		("recommendation", 200),
		("consequence", 300),
		("continuation", 300),
		("approval_meaning", 300),
	):
		try:
			normalized[field] = validate_text_field(intent, field, limit)
		except ContractError as error:
			reasons.append(str(error))

	thread_id = validate_thread_id(str(intent.get("thread_id", "")))
	normalized["thread_id"] = thread_id
	expected_link = f"agent-attention://threads/{thread_id}"
	if intent.get("discussion_link") != expected_link:
		reasons.append("discussion_link must target the exact owning Codex task")
	normalized["discussion_link"] = expected_link
	meaning = normalized.get("approval_meaning", "")
	if isinstance(meaning, str) and not meaning.casefold().startswith("approve "):
		reasons.append("approval_meaning must explicitly begin with Approve")
	return normalized, reasons


def request_path(state_dir: Path, thread_id: str) -> Path:
	"""Return the exact structured owner-state path for one Codex task."""
	return state_dir / "requests" / f"{validate_thread_id(thread_id)}.json"


def update_request_state(
	state_dir: Path,
	mapping: dict[str, Any],
	status: str,
	**values: Any,
) -> None:
	"""Advance matching router state without requiring it for legacy V1 gates."""
	path = request_path(state_dir, mapping["thread_id"])
	if not path.exists():
		return
	state = load_json(path)
	if state.get("reminder_id") != mapping["reminder_id"]:
		return
	write_json(
		path,
		{
			**state,
			"status": status,
			"updated_at": datetime.now(timezone.utc).isoformat(),
			**values,
		},
	)


def submit_approval(args: argparse.Namespace) -> dict[str, Any]:
	"""Validate, deduplicate, and optionally create one native approval gate."""
	state_dir: Path = args.state_dir
	intent, reasons = validate_approval_intent(approval_intent(args))
	thread_id = intent["thread_id"]
	path = request_path(state_dir, thread_id)
	request_identifier = hashlib.sha256(
		json.dumps(intent, sort_keys=True, separators=(",", ":")).encode()
	).hexdigest()

	if path.exists():
		existing = load_json(path)
		if existing.get("status") in {"gated", "delivered", "completed"}:
			if existing.get("request_id") != request_identifier:
				raise ContractError("the owning task already has a different admitted gate")
			return base_result(
				"already_gated",
				changed=False,
				request_id=request_identifier,
				reminder_id=existing.get("reminder_id"),
				thread_id=thread_id,
			)

	if reasons:
		repair = "; ".join(reasons)
		if args.execute:
			write_json(
				path,
				{
					"version": 1,
					"request_id": request_identifier,
					"thread_id": thread_id,
					"intent": intent,
					"status": "repair",
					"repair": repair,
					"updated_at": datetime.now(timezone.utc).isoformat(),
				},
			)
		return base_result(
			"rejected",
			changed=args.execute,
			request_id=request_identifier,
			thread_id=thread_id,
			repair=repair,
			next_safe_action="repair the structured intent or continue discussion in Codex",
		)

	config = read_config(state_dir)
	notes, required_line = router_notes(intent)
	notification_at = datetime.now(timezone.utc).isoformat()
	preview = {
		"title": f"[APPROVE] {intent['action']}",
		"notes": notes,
		"url": intent["discussion_link"],
		"priority": "none",
		"notification_at": notification_at,
		"list": config["list"],
		"thread_id": thread_id,
	}
	if not args.execute:
		return base_result(
			"admitted_preview",
			changed=False,
			request_id=request_identifier,
			preview=preview,
			side_effect="create one Apple Reminder with one immediate native alert",
			next_safe_action="review the structured gate, then rerun with --execute",
		)

	request_claim_path = state_dir / "request-claims" / f"{thread_id}.json"
	if not write_json(
		request_claim_path,
		{
			"request_id": request_identifier,
			"thread_id": thread_id,
			"claimed_at": datetime.now(timezone.utc).isoformat(),
		},
		exclusive=True,
	):
		return base_result(
			"claimed",
			changed=False,
			request_id=request_identifier,
			thread_id=thread_id,
			repair="inspect exact request state before retry; no second gate was created",
		)

	declared = {
		"version": 1,
		"request_id": request_identifier,
		"thread_id": thread_id,
		"intent": intent,
		"status": "declared",
		"updated_at": notification_at,
	}
	write_json(path, declared)
	try:
		created = run_json(
			[
				"remindctl",
				"add",
				"--title",
				preview["title"],
				"--list-id",
				config["list"]["id"],
				"--notes",
				notes,
				"--url",
				intent["discussion_link"],
				"--priority",
				"none",
				"--alarm",
				notification_at,
				"--json",
				"--no-input",
			]
		)
	except ContractError as error:
		write_json(
			path,
			{
				**declared,
				"status": "repair",
				"repair": f"gate creation failed; inspect exact configured list before retry: {error}",
				"updated_at": datetime.now(timezone.utc).isoformat(),
			},
		)
		raise
	reminder_id = created.get("id") if isinstance(created, dict) else None
	if not reminder_id:
		write_json(
			path,
			{
				**declared,
				"status": "repair",
				"repair": "creation response lacks a stable reminder ID; inspect before retry",
				"updated_at": datetime.now(timezone.utc).isoformat(),
			},
		)
		raise ContractError("created reminder response lacks a stable ID; inspect before retry")
	created_inventory = read_inventory(config)
	created_matches = [item for item in created_inventory if item.get("id") == reminder_id]
	if len(created_matches) != 1:
		write_json(
			path,
			{
				**declared,
				"status": "repair",
				"reminder_id": reminder_id,
				"repair": "created stable reminder ID did not resolve exactly once; inspect before retry",
				"updated_at": datetime.now(timezone.utc).isoformat(),
			},
		)
		raise ContractError("created stable reminder ID did not resolve exactly once")
	created_gate = created_matches[0]
	def fail_created_verification(field: str) -> None:
		message = f"created reminder failed exact verification: {field}"
		write_json(
			path,
			{
				**declared,
				"status": "repair",
				"reminder_id": reminder_id,
				"repair": message,
				"updated_at": datetime.now(timezone.utc).isoformat(),
			},
		)
		raise ContractError(message)

	for field, expected in (
		("listID", config["list"]["id"]),
		("title", preview["title"]),
		("url", intent["discussion_link"]),
		("priority", "none"),
	):
		if created_gate.get(field) != expected:
			fail_created_verification(field)
	if not (created_gate.get("notes") or "").startswith(notes):
		fail_created_verification("notes")
	if created_gate.get("isCompleted"):
		fail_created_verification("isCompleted")

	mapping = {
		"version": 1,
		"list": config["list"],
		"reminder_id": reminder_id,
		"expected_title": preview["title"],
		"required_notes_line": required_line,
		"thread_id": thread_id,
		"approval_meaning": intent["approval_meaning"],
		"created_at": notification_at,
		"request_id": request_identifier,
	}
	if not write_json(
		state_dir / "gates" / f"{reminder_id}.json", mapping, exclusive=True
	):
		write_json(
			path,
			{
				**declared,
				"status": "repair",
				"reminder_id": reminder_id,
				"repair": "stable reminder ID mapping already exists; inspect before retry",
				"updated_at": datetime.now(timezone.utc).isoformat(),
			},
		)
		raise ContractError("stable reminder ID mapping already exists; inspect before retry")
	write_json(
		path,
		{
			**declared,
			"status": "gated",
			"reminder_id": reminder_id,
			"notification_at": notification_at,
			"updated_at": datetime.now(timezone.utc).isoformat(),
		},
	)
	return base_result(
		"gated",
		changed=True,
		request_id=request_identifier,
		reminder_id=reminder_id,
		thread_id=thread_id,
		notification_count=1,
		next_safe_action="keep the owning task paused until exact completion delivery",
	)


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
			"show",
			"all",
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


def outcome_id(mapping: dict[str, Any], outcome: str, finished_at: str) -> str:
	"""Bind one terminal outcome receipt to its delivered approval event."""
	payload = {
		"event_id": event_id(mapping),
		"finished_at": finished_at,
		"outcome": outcome,
	}
	encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
	return hashlib.sha256(encoded).hexdigest()


def validate_outcome(value: str) -> str:
	"""Accept one concise outcome line, never project history."""
	outcome = value.strip()
	if not outcome or "\n" in outcome or "\r" in outcome or len(outcome) > 200:
		raise ContractError("outcome must be one concise line of at most 200 characters")
	return outcome


def validate_finished_at(value: str) -> str:
	"""Require an explicit timezone-aware terminal timestamp."""
	try:
		parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
	except ValueError as error:
		raise ContractError("finished-at must be an ISO 8601 timestamp") from error
	if parsed.tzinfo is None:
		raise ContractError("finished-at must include a timezone")
	return value


def append_outcome_notes(current_notes: str, addition: str) -> str:
	"""Append an outcome while preserving remindctl's managed URL footer."""
	lines = current_notes.rstrip().splitlines()
	managed_url = lines[-1] if lines and lines[-1].startswith(MANAGED_URL_PREFIX) else None
	if managed_url:
		lines = lines[:-1]
	body = "\n".join(lines).rstrip()
	updated = f"{body}\n\n{addition}" if body else addition
	if managed_url:
		updated = f"{updated}\n\n{managed_url}"
	return updated


def contains_outcome_notes(current_notes: str, addition: str) -> bool:
	"""Recognize one exact outcome block with an optional managed URL footer."""
	return current_notes == append_outcome_notes(current_notes.replace(addition, "").strip(), addition)


def read_gate_mapping(state_dir: Path, reminder_id: str) -> dict[str, Any]:
	"""Load only the mapping owned by one exact stable reminder ID."""
	path = state_dir / "gates" / f"{reminder_id}.json"
	if not path.exists():
		raise ContractError("no gate mapping exists for the exact stable reminder ID")
	mapping = load_json(path)
	if mapping.get("reminder_id") != reminder_id:
		raise ContractError("gate mapping stable reminder ID does not match")
	for field in ("approval_meaning", "expected_title", "required_notes_line", "thread_id"):
		if not mapping.get(field):
			raise ContractError(f"gate mapping lacks required field: {field}")
	return mapping


def validate_delivery_receipt(
	receipt: dict[str, Any], mapping: dict[str, Any], identifier: str
) -> None:
	"""Require one receipt bound to the exact delivered approval contract."""
	expected = {
		"approval_meaning": mapping["approval_meaning"],
		"event_id": identifier,
		"reminder_id": mapping["reminder_id"],
		"thread_id": mapping["thread_id"],
	}
	for field, value in expected.items():
		if receipt.get(field) != value:
			raise ContractError(f"delivery receipt does not match gate field: {field}")
	if not receipt.get("delivered_at"):
		raise ContractError("delivery receipt lacks delivered_at")


def read_exact_completed_reminder(reminder_id: str, list_id: str) -> dict[str, Any]:
	"""Resolve one stable ID inside the configured list's Completed view."""
	inventory = run_json(
		[
			"remindctl",
			"show",
			"completed",
			"--list-id",
			list_id,
			"--json",
			"--no-input",
		]
	)
	if not isinstance(inventory, list):
		raise ContractError("completed reminder inventory must be a JSON array")
	matches = [item for item in inventory if item.get("id") == reminder_id]
	if len(matches) != 1:
		raise ContractError("exact stable reminder ID did not resolve once in Completed history")
	return matches[0]


def validate_outcome_target(
	reminder: dict[str, Any], mapping: dict[str, Any], config: dict[str, Any]
) -> None:
	"""Reprove identity, meaning, list, and completed state before mutation."""
	if reminder.get("listID") != config["list"]["id"]:
		raise ContractError("reminder resolved outside the configured list")
	if mapping.get("list", {}).get("id") != config["list"]["id"]:
		raise ContractError("gate mapping list does not match configuration")
	if reminder.get("title") != mapping.get("expected_title"):
		raise ContractError("reminder title changed; refusing outcome update")
	if mapping.get("required_notes_line") not in (reminder.get("notes") or "").splitlines():
		raise ContractError("approval meaning is absent from reminder notes")
	if not reminder.get("isCompleted") or not reminder.get("completionDate"):
		raise ContractError("outcome requires an already completed reminder")


def record_outcome(args: argparse.Namespace) -> dict[str, Any]:
	"""Preview or append one bounded outcome to one delivered completed gate."""
	state_dir: Path = args.state_dir
	outcome = validate_outcome(args.outcome)
	finished_at = validate_finished_at(args.finished_at)
	config = read_config(state_dir)
	mapping = read_gate_mapping(state_dir, args.reminder_id)
	delivery_id = event_id(mapping)
	delivery_path = state_dir / "receipts" / f"{delivery_id}.json"
	if not delivery_path.exists():
		raise ContractError("cannot record outcome without the delivery receipt")
	validate_delivery_receipt(load_json(delivery_path), mapping, delivery_id)

	identifier = outcome_id(mapping, outcome, finished_at)
	receipt_path = state_dir / "outcomes" / f"{delivery_id}.json"
	if receipt_path.exists():
		receipt = load_json(receipt_path)
		if receipt.get("outcome_id") != identifier:
			raise ContractError("a different terminal outcome is already recorded for this gate")
		update_request_state(
			state_dir,
			mapping,
			"completed",
			outcome_id=identifier,
			finished_at=finished_at,
		)
		return base_result(
			"already_recorded",
			changed=False,
			outcome_id=identifier,
			reminder_id=args.reminder_id,
		)

	addition = f"Outcome: {outcome}\nFinished: {finished_at}"
	if not args.execute:
		before = read_exact_completed_reminder(args.reminder_id, config["list"]["id"])
		validate_outcome_target(before, mapping, config)
		return base_result(
			"preview",
			changed=False,
			reminder_id=args.reminder_id,
			append=addition,
			side_effect="append outcome to exact completed Apple Reminder",
			next_safe_action="review preview, then rerun with --execute",
		)

	claim_path = state_dir / "outcome-claims" / f"{delivery_id}.json"
	claim = {
		"event_id": delivery_id,
		"finished_at": finished_at,
		"outcome": outcome,
		"outcome_id": identifier,
		"reminder_id": args.reminder_id,
	}
	claim_created = write_json(claim_path, claim, exclusive=True)
	if not claim_created:
		existing_claim = load_json(claim_path)
		if existing_claim.get("outcome_id") != identifier:
			raise ContractError("a different terminal outcome claim already exists for this gate")

	before = read_exact_completed_reminder(args.reminder_id, config["list"]["id"])
	validate_outcome_target(before, mapping, config)
	current_notes = before.get("notes") or ""
	updated_notes = append_outcome_notes(current_notes, addition)
	if contains_outcome_notes(current_notes, addition):
		receipt = {
			"event_id": delivery_id,
			"finished_at": finished_at,
			"outcome": outcome,
			"outcome_id": identifier,
			"recorded_at": datetime.now(timezone.utc).isoformat(),
			"reminder_id": args.reminder_id,
			"recovered": True,
		}
		if write_json(receipt_path, receipt, exclusive=True):
			append_audit(state_dir / "outcome-audit.jsonl", receipt)
		update_request_state(
			state_dir,
			mapping,
			"completed",
			outcome_id=identifier,
			finished_at=finished_at,
		)
		return base_result(
			"already_recorded",
			changed=False,
			outcome_id=identifier,
			reminder_id=args.reminder_id,
		)

	if not claim_created:
		return base_result(
			"claimed",
			changed=False,
			outcome_id=identifier,
			reminder_id=args.reminder_id,
			repair="inspect the exact reminder before releasing this outcome claim",
		)

	run_json(
		[
			"remindctl",
			"edit",
			args.reminder_id,
			"--notes",
			updated_notes,
			"--json",
			"--no-input",
		]
	)
	after = read_exact_completed_reminder(args.reminder_id, config["list"]["id"])
	validate_outcome_target(after, mapping, config)
	if after.get("notes") != updated_notes:
		raise ContractError("outcome notes failed exact post-update verification")
	for key, value in before.items():
		if key not in {"notes", "lastModifiedDate"} and after.get(key) != value:
			raise ContractError(f"unexpected reminder field changed: {key}")

	receipt = {
		"event_id": delivery_id,
		"finished_at": finished_at,
		"outcome": outcome,
		"outcome_id": identifier,
		"recorded_at": datetime.now(timezone.utc).isoformat(),
		"reminder_id": args.reminder_id,
		"completion_date": after["completionDate"],
	}
	if not write_json(receipt_path, receipt, exclusive=True):
		return base_result(
			"already_recorded",
			changed=False,
			outcome_id=identifier,
			reminder_id=args.reminder_id,
		)
	append_audit(state_dir / "outcome-audit.jsonl", receipt)
	update_request_state(
		state_dir,
		mapping,
		"completed",
		outcome_id=identifier,
		finished_at=finished_at,
	)
	return base_result(
		"recorded",
		changed=True,
		outcome_id=identifier,
		reminder_id=args.reminder_id,
	)


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
		identifier = event_id(mapping)
		receipt_path = state_dir / "receipts" / f"{identifier}.json"
		if receipt_path.exists():
			continue
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

		claim_path = state_dir / "claims" / f"{identifier}.json"
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
			completion_date=reminder["completionDate"],
			thread_id=mapping["thread_id"],
			prompt=(
				f"Agent Attention approval received. {mapping['approval_meaning']} "
				f"Receipt key: {identifier}. This approval applies only to that action."
			),
			next_safe_action="deliver once with the Codex task tool, then record-delivery",
		)

	return base_result("waiting", changed=False, open_gate_count=len(mapping_paths))


def watch(args: argparse.Namespace) -> dict[str, Any]:
	"""Wait in the foreground for one bounded completion detection window."""
	if args.interval_seconds <= 0 or args.interval_seconds > 15:
		raise ContractError("interval-seconds must be greater than zero and at most 15")
	if args.timeout_seconds <= 0 or args.timeout_seconds > 3600:
		raise ContractError("timeout-seconds must be greater than zero and at most 3600")
	started = time.monotonic()
	deadline = started + args.timeout_seconds
	polls = 0
	while True:
		result = poll(args)
		polls += 1
		if result["status"] in {"deliver", "claimed"}:
			if result["status"] == "deliver":
				completed = datetime.fromisoformat(
					result["completion_date"].replace("Z", "+00:00")
				)
				result["detection_latency_seconds"] = round(
					max(0.0, (datetime.now(timezone.utc) - completed).total_seconds()), 3
				)
			result["poll_count"] = polls
			result["watch_elapsed_seconds"] = round(time.monotonic() - started, 3)
			return result
		remaining = deadline - time.monotonic()
		if remaining <= 0:
			return base_result(
				"waiting",
				changed=False,
				poll_count=polls,
				watch_elapsed_seconds=round(time.monotonic() - started, 3),
			)
		time.sleep(min(args.interval_seconds, remaining))


def record_delivery(args: argparse.Namespace) -> dict[str, Any]:
	"""Record successful supported task delivery without reopening the reminder."""
	state_dir: Path = args.state_dir
	claim_path = state_dir / "claims" / f"{args.event_id}.json"
	receipt_path = state_dir / "receipts" / f"{args.event_id}.json"
	if receipt_path.exists():
		receipt = load_json(receipt_path)
		update_request_state(
			state_dir,
			receipt,
			"delivered",
			event_id=args.event_id,
			delivered_at=receipt.get("delivered_at"),
		)
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
	update_request_state(
		state_dir,
		claim,
		"delivered",
		event_id=args.event_id,
		delivered_at=receipt["delivered_at"],
	)
	return base_result("recorded", changed=True, event_id=args.event_id)


def check_stop(args: argparse.Namespace) -> dict[str, Any]:
	"""Return a stop-hook decision from exact structured owner state only."""
	state_dir: Path = args.state_dir
	thread_id = validate_thread_id(args.thread_id)
	path = request_path(state_dir, thread_id)
	if not path.exists():
		return base_result(
			"clear",
			changed=False,
			thread_id=thread_id,
			hook_action="allow",
		)
	state = load_json(path)
	if state.get("thread_id") != thread_id or state.get("version") != 1:
		return base_result(
			"repair_needed",
			changed=False,
			thread_id=thread_id,
			hook_action="continue",
			reason="Agent Attention owner state is malformed. Repair the exact request state before stopping.",
		)
	status = state.get("status")
	if status == "declared":
		return base_result(
			"repair_needed",
			changed=False,
			thread_id=thread_id,
			hook_action="continue",
			reason="Agent Attention blocker was declared but has no gate or repair result. Finish submit or record an actionable repair.",
		)
	if status == "delivered":
		continuation = state.get("intent", {}).get("continuation")
		return base_result(
			"resume_needed",
			changed=False,
			thread_id=thread_id,
			hook_action="continue",
			reason=f"Agent Attention approval was delivered. Resume: {continuation}",
		)
	if status in {"gated", "repair", "completed"}:
		values: dict[str, Any] = {}
		if status == "repair":
			values["repair"] = state.get("repair")
		return base_result(
			status,
			changed=False,
			thread_id=thread_id,
			hook_action="allow",
			**values,
		)
	return base_result(
		"repair_needed",
		changed=False,
		thread_id=thread_id,
		hook_action="continue",
		reason=f"Agent Attention owner state has unsupported status: {status}",
	)


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


def commands(_: argparse.Namespace) -> dict[str, Any]:
	"""Expose the same command catalog used to build rendered help."""
	return base_result("ok", changed=False, commands=list(COMMAND_CATALOG))


def parser() -> argparse.ArgumentParser:
	"""Build the stable command surface."""
	command = argparse.ArgumentParser(
		prog="agent-attention",
		description="Create and deliver bounded Apple Reminders approval gates.",
	)
	command.add_argument("--state-dir", type=Path, default=default_state_dir())
	subcommands = command.add_subparsers(dest="command", required=True)
	help_by_name = {item["name"]: item["summary"] for item in COMMAND_CATALOG}

	commands_command = subcommands.add_parser("commands", help=help_by_name["commands"])
	commands_command.set_defaults(handler=commands)

	doctor_command = subcommands.add_parser("doctor", help=help_by_name["doctor"])
	doctor_command.set_defaults(handler=doctor)

	configure_command = subcommands.add_parser("configure", help=help_by_name["configure"])
	configure_command.add_argument("--list-id", required=True)
	configure_command.add_argument("--list-name", required=True)
	configure_command.set_defaults(handler=configure)

	create_command = subcommands.add_parser("create", help=help_by_name["create"])
	create_command.add_argument("--thread-id", required=True)
	create_command.add_argument("--title", required=True)
	create_command.add_argument("--recommendation", required=True)
	create_command.add_argument("--approval-meaning", required=True)
	create_command.add_argument("--priority", choices=("low", "medium", "high"), default="high")
	create_command.add_argument("--due")
	create_command.add_argument("--execute", action="store_true")
	create_command.set_defaults(handler=create_gate)

	submit_command = subcommands.add_parser("submit", help=help_by_name["submit"])
	submit_command.add_argument("--thread-id", required=True, help="Exact owning Codex task UUID.")
	submit_command.add_argument("--decision-type", required=True, help="Use yes_no only for an approvable gate.")
	submit_command.add_argument("--unblocks-paused-task", action="store_true", help="Declare that the answer resumes paused work.")
	submit_command.add_argument("--action", required=True, help="Short action shown in the reminder title.")
	submit_command.add_argument("--recommendation", required=True, help="Recommendation-first decision guidance.")
	submit_command.add_argument("--consequence", required=True, help="Bounded consequence of approval.")
	submit_command.add_argument("--discussion-link", required=True, help="Exact agent-attention task link.")
	submit_command.add_argument("--continuation", required=True, help="Exact work to resume after delivery.")
	submit_command.add_argument("--approval-meaning", required=True, help="Sentence beginning with Approve.")
	submit_command.add_argument("--execute", action="store_true", help="Create the admitted reminder and one alert.")
	submit_command.set_defaults(handler=submit_approval)

	poll_command = subcommands.add_parser("poll", help=help_by_name["poll"])
	poll_command.set_defaults(handler=poll)

	watch_command = subcommands.add_parser("watch", help=help_by_name["watch"])
	watch_command.add_argument("--interval-seconds", type=float, default=5.0, help="Poll interval above 0 and at most 15 seconds.")
	watch_command.add_argument("--timeout-seconds", type=float, default=30.0, help="Bounded foreground window above 0 and at most 3600 seconds.")
	watch_command.set_defaults(handler=watch)

	record_command = subcommands.add_parser("record-delivery", help=help_by_name["record-delivery"])
	record_command.add_argument("--event-id", required=True)
	record_command.add_argument("--tool-result", required=True)
	record_command.set_defaults(handler=record_delivery)

	outcome_command = subcommands.add_parser("record-outcome", help=help_by_name["record-outcome"])
	outcome_command.add_argument("--reminder-id", required=True)
	outcome_command.add_argument("--outcome", required=True)
	outcome_command.add_argument("--finished-at", required=True)
	outcome_command.add_argument("--execute", action="store_true")
	outcome_command.set_defaults(handler=record_outcome)

	stop_command = subcommands.add_parser("check-stop", help=help_by_name["check-stop"])
	stop_command.add_argument("--thread-id", required=True, help="Exact Codex task UUID from the Stop event.")
	stop_command.set_defaults(handler=check_stop)
	return command


def main() -> int:
	"""Dispatch one command and emit one JSON result."""
	args = parser().parse_args()
	try:
		result = args.handler(args)
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
