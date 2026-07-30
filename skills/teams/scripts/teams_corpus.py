"""Markdown corpus writer for the Teams reader.

One file per message, YAML frontmatter on top, so QMD can index the folder and
Teams joins the same searchable surface as notes, memory and repo docs.

Storage routing (per the repo's storage-routing contract):

* corpus -> ``$XDG_DATA_HOME/teams`` (default ``~/.local/share/teams``) — durable
  user-owned data, rebuildable from the Teams cache
* cursor -> ``$XDG_STATE_HOME/teams`` (default ``~/.local/state/teams``) —
  mutable operational state, restartable

This is corporate chat, so directories are created ``0700`` and files ``0600``.
Nothing here belongs in a git repo, and the writer refuses to target one.

Path convention mirrors the sibling imessage-reader corpus:
``YYYY/MM/YYYY-MM-DD-HHMMSS-teams-<slug>.md``
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 2
SOURCE_SYSTEM = "teams"

DIR_MODE = 0o700
FILE_MODE = 0o600


def _xdg(env: str, fallback: str) -> Path:
    """Resolve an XDG base dir, ignoring relative values per the spec."""
    raw = os.environ.get(env)
    if raw and raw.startswith("/"):
        return Path(raw)
    return Path.home() / fallback


def default_corpus_dir() -> Path:
    return _xdg("XDG_DATA_HOME", ".local/share") / "teams"


def default_state_dir() -> Path:
    return _xdg("XDG_STATE_HOME", ".local/state") / "teams"


def _secure_mkdir(path: Path) -> None:
    """Create a directory tree with private permissions at every new level."""
    missing = []
    probe = path
    while not probe.exists():
        missing.append(probe)
        probe = probe.parent
    path.mkdir(parents=True, exist_ok=True)
    for created in missing:
        try:
            created.chmod(DIR_MODE)
        except OSError:
            pass


# Public alias: other modules in this skill write private state too (the poll
# log and its cursor), and they should reuse this instead of re-implementing
# the permission handling or reaching for the underscore name.
secure_mkdir = _secure_mkdir


def assert_not_in_repo(path: Path) -> None:
    """Refuse to write corporate chat anywhere inside a git working tree."""
    probe = path.resolve()
    for candidate in (probe, *probe.parents):
        if (candidate / ".git").exists():
            raise SystemExit(
                f"refusing to write the Teams corpus inside a git repository: {candidate}\n"
                "This is corporate chat. Choose a path outside any repo "
                "(default: ~/.local/share/teams)."
            )


_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def slug_for(message_id: str) -> str:
    """Stable, filesystem-safe slug for a message id.

    Teams ids are numeric strings, but they are joined with a hash so a weird id
    can never escape the corpus directory.
    """
    digest = hashlib.sha256(message_id.encode("utf-8")).hexdigest()[:12]
    safe = _UNSAFE.sub("", message_id)[-12:] or "msg"
    return f"{safe}-{digest}"


def note_relpath(when: datetime, message_id: str) -> Path:
    local = when.astimezone()
    return Path(
        f"{local:%Y}", f"{local:%m}",
        f"{local:%Y-%m-%d-%H%M%S}-{SOURCE_SYSTEM}-{slug_for(message_id)}.md",
    )


def _yaml_str(value) -> str:
    """Quote a scalar for YAML, escaping what would break the document."""
    if value is None:
        return '""'
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    text = text.replace("\n", " ").replace("\r", " ")
    return f'"{text}"'


@dataclass
class NoteInput:
    message_id: str
    sent_at: datetime
    author: str
    author_mri: str | None
    is_from_me: bool
    conversation_id: str
    conversation_name: str | None
    conversation_type: str | None
    content: str
    reactions: dict[str, int] | None = None


def render_note(note: NoteInput) -> str:
    local = note.sent_at.astimezone()
    title = (f"Teams message from {note.author} in "
             f"{note.conversation_name or 'unnamed conversation'} "
             f"at {local:%Y-%m-%d %H:%M}")

    lines = [
        "---",
        f"schema_version: {SCHEMA_VERSION}",
        f"title: {_yaml_str(title)}",
        "type: artifact-sidecar",
        "status: active",
        f"updated: {local:%Y-%m-%d}",
        f"source_system: {SOURCE_SYSTEM}",
        f"source_id: {_yaml_str(note.message_id)}",
        f"source_thread_id: {_yaml_str(note.conversation_id)}",
        f"sent_at: {_yaml_str(note.sent_at.isoformat())}",
        f"sent_at_local: {_yaml_str(local.isoformat())}",
        f"direction: {'outgoing' if note.is_from_me else 'incoming'}",
        f"from: {_yaml_str(note.author)}",
        # The stable identity. Display names collide; MRIs do not.
        f"from_mri: {_yaml_str(note.author_mri)}",
        f"is_from_me: {str(note.is_from_me).lower()}",
        f"conversation: {_yaml_str(note.conversation_name)}",
        f"conversation_type: {_yaml_str(note.conversation_type)}",
        f"day_of_week: {_yaml_str(f'{local:%A}')}",
        f"time_of_day: {_yaml_str(f'{local:%H:%M}')}",
    ]

    if note.reactions:
        lines.append("reactions:")
        for key, count in sorted(note.reactions.items(), key=lambda kv: -kv[1]):
            lines.append(f"  - emoji: {_yaml_str(key)}")
            lines.append(f"    count: {count}")

    lines.append("---")
    return "\n".join(lines) + f"\n\n## Message\n\n{note.content.strip()}\n"


class CorpusWriter:
    """Writes messages as markdown notes, overwriting in place.

    Overwrite rather than dedupe, matching the sibling corpus: re-reading a
    message that was edited in Teams refreshes the note.
    """

    def __init__(self, corpus_dir: Path | None = None, *, enabled: bool = True):
        self.dir = Path(corpus_dir) if corpus_dir else default_corpus_dir()
        self.enabled = enabled
        self.written = 0
        self.skipped = 0
        self._checked = False

    def _ensure_root(self) -> None:
        if self._checked:
            return
        assert_not_in_repo(self.dir)
        _secure_mkdir(self.dir)
        self._checked = True

    def write(self, note: NoteInput) -> Path | None:
        if not self.enabled:
            return None
        # A message with no timestamp has no home in a dated tree, and empty
        # bodies add nothing to the index.
        if not note.sent_at or not note.content.strip():
            self.skipped += 1
            return None

        self._ensure_root()
        path = self.dir / note_relpath(note.sent_at, note.message_id)
        _secure_mkdir(path.parent)
        path.write_text(render_note(note), encoding="utf-8")
        try:
            path.chmod(FILE_MODE)
        except OSError:
            pass
        self.written += 1
        return path

    def summary(self) -> dict:
        return {"corpus_dir": str(self.dir), "written": self.written,
                "skipped": self.skipped}


def reindex(corpus_dir: Path, *, update: bool = True, embed: bool = True) -> dict:
    """Refresh the QMD index over the corpus so new notes become searchable.

    Run from inside the corpus directory: ``qmd collection add`` resolves paths
    relative to cwd, and ``qmd update`` scopes its work the same way.

    Two independent steps, so callers can order them by cost:
      - ``update`` (BM25 index) is cheap and makes ``qmd search`` live immediately.
      - ``embed`` (vector embeddings) is the slow step; defer it so it never blocks
        a sync. ``reindex(embed=False)`` runs BM25 only; ``reindex(update=False)``
        runs the deferred vector pass on its own (the standalone ``embed`` command).

    Note ``qmd update`` re-scans every registered collection, not just this one,
    which is why this is an explicit step on ``sync`` rather than a silent side
    effect of every query. Embedding is incremental — only new chunks cost time.
    """
    import shutil
    import subprocess

    if shutil.which("qmd") is None:
        return {"ok": False, "reason": "qmd not installed",
                "hint": "install qmd, or index the corpus with your own tool"}
    if not corpus_dir.is_dir():
        return {"ok": False, "reason": f"corpus directory not found: {corpus_dir}"}

    steps: list[dict] = []
    for name, argv in (("update", ["qmd", "update"]) if update else (None, None),
                       ("embed", ["qmd", "embed"]) if embed else (None, None)):
        if name is None:
            continue
        try:
            proc = subprocess.run(argv, cwd=corpus_dir, capture_output=True,
                                  text=True, timeout=1800)
        except (subprocess.SubprocessError, OSError) as exc:
            steps.append({"step": name, "ok": False, "error": str(exc)})
            break
        steps.append({"step": name, "ok": proc.returncode == 0,
                      "output": (proc.stdout or proc.stderr).strip()[-400:]})
        if proc.returncode != 0:
            break

    return {"ok": all(s["ok"] for s in steps) if steps else False, "steps": steps}


class Cursor:
    """Sync watermark: the newest message already written to the corpus.

    Lets ``sync`` do incremental work instead of rewriting the whole corpus.
    Losing it is harmless — the corpus is rebuildable, so a missing cursor just
    means a full pass.
    """

    def __init__(self, state_dir: Path | None = None):
        self.dir = Path(state_dir) if state_dir else default_state_dir()
        self.path = self.dir / "cursor.json"

    def read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return {}

    def last_synced(self) -> datetime | None:
        raw = self.read().get("last_message_at")
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return None

    def write(self, last_message_at: datetime | None, written: int) -> None:
        _secure_mkdir(self.dir)
        payload = {
            "last_message_at": last_message_at.isoformat() if last_message_at else None,
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "notes_written": written,
        }
        self.path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        try:
            self.path.chmod(FILE_MODE)
        except OSError:
            pass
