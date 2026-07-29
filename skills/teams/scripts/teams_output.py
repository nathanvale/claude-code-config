"""Output contract for the Teams reader CLI.

Owns the machine-facing envelope, failure categories, and the stdout/stderr
split. Agent-native rules this enforces:

* primary data goes to stdout, diagnostics go to stderr — so ``--json`` stdout
  stays parseable even when warnings fire
* every run carries a ``run_id`` so a driver can correlate output with the
  warnings printed alongside it
* failures answer "what happened / can I retry / what next / where do I look"
"""

from __future__ import annotations

import dataclasses
import json
import sys
import uuid
from datetime import datetime
from typing import Any

# Stable failure categories. A driver branches on these, not on message text.
FAILURE_STORE_NOT_FOUND = "store_not_found"
FAILURE_STORE_UNREADABLE = "store_unreadable"
FAILURE_DEPENDENCY_MISSING = "dependency_missing"
FAILURE_CONFIG_INVALID = "config_invalid"
FAILURE_IDENTITY_UNRESOLVED = "identity_unresolved"
FAILURE_NOT_FOUND = "not_found"
FAILURE_INTERNAL = "internal_error"

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_USAGE = 2

RUN_ID = uuid.uuid4().hex[:12]


def _plain(value: Any) -> Any:
    """JSON-safe projection: datetimes to ISO 8601, dataclasses to dicts."""
    if isinstance(value, datetime):
        return value.isoformat()
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {k: _plain(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_plain(v) for v in value]
    return value


def warn(message: str) -> None:
    """Diagnostics go to stderr, never stdout — stdout must stay parseable."""
    print(f"[teams:{RUN_ID}] {message}", file=sys.stderr)


def emit_json(command: str, data: Any, *, heuristic: bool = False,
              warnings: list[str] | None = None) -> int:
    """Write a success envelope to stdout. Returns the process exit code."""
    envelope = {
        "ok": True,
        "run_id": RUN_ID,
        "command": command,
        "heuristic": heuristic,
        "warnings": warnings or [],
        "data": _plain(data),
    }
    json.dump(envelope, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return EXIT_OK


def emit_failure(command: str, category: str, message: str, *,
                 hint: str | None = None, as_json: bool = False,
                 retry_safe: bool = True) -> int:
    """Report a failure on stderr (text) or as a stdout envelope (json).

    ``retry_safe`` is always true for this CLI — every command is read-only, so
    the same input can be retried without side effects. It is stated explicitly
    because a driver should not have to infer it.
    """
    if as_json:
        envelope = {
            "ok": False,
            "run_id": RUN_ID,
            "command": command,
            "failure": {
                "category": category,
                "message": message,
                "hint": hint,
                "retry_safe": retry_safe,
                # Nothing is ever mutated: the CLI only reads a snapshot copy.
                "changed": "nothing (read-only)",
                "diagnostics": "teams_cli.py doctor --json",
            },
        }
        json.dump(envelope, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        print(f"error [{category}]: {message}", file=sys.stderr)
        if hint:
            print(f"  next: {hint}", file=sys.stderr)
        print(f"  diagnostics: teams_cli.py doctor  (run {RUN_ID})", file=sys.stderr)
    return EXIT_FAILURE


# The caveat attached to every regex-derived capability, in both output modes.
HEURISTIC_CAVEAT = (
    "HEURISTIC: this is a regex grep over message text, not a summarizer. "
    "Expect false positives and missed items."
)
