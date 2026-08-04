"""Tests for the Teams local-store reader.

Two layers:

* **Synthetic** — a fake store exercising generalization, identity confidence,
  and config handling. These are the tests that prove the skill works for
  someone who is not the author, and they run anywhere.
* **Live** — characterization against this machine's real Teams cache. Skipped
  automatically when no store is present.

Run:  .venv/bin/python -m pytest scripts/teams_reader_test.py -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import teams_reader as tr  # noqa: E402
from teams_config import ConfigError, load_config  # noqa: E402
from teams_reader import Message, SelfIdentity, TeamsReader  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
CLI = SKILL_DIR / "scripts" / "teams_cli.py"

# Relative to the moment the tests run, NOT a fixed date. standup_prep filters
# through digest()'s rolling `hours` window, so absolute fixture timestamps
# silently fall out of range as they age and the suite rots.
NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------- fakes
class FakeReader(TeamsReader):
    """A TeamsReader with the IndexedDB layer replaced by in-memory fixtures.

    Everything above the store — identity resolution, the name gate, ticket
    extraction, the heuristics — is the real code under test.
    """

    def __init__(self, messages: list[Message], profiles: dict[str, dict],
                 user_guid: str | None = None):
        self._messages = messages
        self._profiles = profiles
        self._user_guid = user_guid
        self._conv_cache = None

    def iter_messages(self, conversation_ids=None):
        for m in self._messages:
            if conversation_ids is None or m.conversation_id in conversation_ids:
                yield m

    def people(self):
        return self._profiles

    def store_user_guid(self):
        return self._user_guid

    def conversations(self):
        return {}


def msg(content: str, *, author: str = "Someone", from_me: bool = False,
        mri: str | None = None, minutes_ago: int = 5,
        conversation_id: str = "conv-1") -> Message:
    return Message(
        time=NOW - timedelta(minutes=minutes_ago),
        author=author,
        from_me=from_me,
        conversation_id=conversation_id,
        seq=1,
        content=content,
        message_id=f"m{abs(hash(content)) % 100000}",
        creator_mri=mri,
    )


# A tenant that is deliberately NOT the author's: different person, different
# ticket shape. This is the generalization fixture.
ACME_MRI = "8:orgid:11111111-2222-3333-4444-555555555555"
ACME_GUID = "11111111-2222-3333-4444-555555555555"
ACME_PROFILES = {
    ACME_MRI: {"displayName": "Priya Raman", "mri": ACME_MRI,
               "email": "priya@acme.example", "office": None,
               "phone": None, "title": "Staff Engineer"},
    "8:orgid:99999999-8888-7777-6666-555555555555": {
        "displayName": "Sam Okonkwo",
        "mri": "8:orgid:99999999-8888-7777-6666-555555555555",
        "email": "sam@acme.example", "office": None, "phone": None,
        "title": "Designer"},
}


def acme_reader(**kwargs) -> FakeReader:
    messages = [
        msg("Can you take a look at ACME-4711 today?", author="Sam Okonkwo",
            mri="8:orgid:99999999-8888-7777-6666-555555555555"),
        msg("Priya please review ACME-4712 when you get a sec",
            author="Sam Okonkwo",
            mri="8:orgid:99999999-8888-7777-6666-555555555555"),
        msg("we decided to go with the queue-based approach",
            author="Sam Okonkwo",
            mri="8:orgid:99999999-8888-7777-6666-555555555555"),
        msg("On it, pushing a fix for ACME-4711 now", author="Priya Raman",
            from_me=True, mri=ACME_MRI),
    ]
    # Enough self-sent volume to clear the auto-detect confidence floor; a
    # thinner store is covered by test_self_identity_refuses_thin_mode.
    messages += [
        msg(f"status update {i}", author="Priya Raman", from_me=True,
            mri=ACME_MRI, minutes_ago=60 + i)
        for i in range(6)
    ]
    return FakeReader(messages, ACME_PROFILES, user_guid=ACME_GUID, **kwargs)


# ---------------------------------------------------------------- identity
def test_self_identity_high_confidence_when_dominant():
    reader = acme_reader()
    identity = reader.self_identity()
    assert identity.mri == ACME_MRI
    assert identity.display_name == "Priya Raman"
    assert identity.confidence == "high"
    assert identity.resolved


def test_self_identity_refuses_thin_mode():
    """A lurker with too few sent messages must not be auto-identified."""
    reader = FakeReader(
        [msg("hi", from_me=True, mri=ACME_MRI)], ACME_PROFILES, user_guid=ACME_GUID)
    identity = reader.self_identity()
    assert identity.confidence == "low"
    assert identity.mri is None, "must not gate on a guess"
    assert identity.candidate_mri == ACME_MRI, "but should still surface the candidate"
    assert not identity.resolved


def test_self_identity_refuses_ambiguous_split():
    """Two identities near 50/50 is a shared/delegated store — refuse to pick."""
    other = "8:orgid:99999999-8888-7777-6666-555555555555"
    messages = ([msg(f"a{i}", from_me=True, mri=ACME_MRI) for i in range(5)]
                + [msg(f"b{i}", from_me=True, mri=other) for i in range(5)])
    identity = FakeReader(messages, ACME_PROFILES, user_guid=ACME_GUID).self_identity()
    assert identity.confidence == "low"
    assert identity.mri is None


def test_self_identity_config_override_wins():
    reader = acme_reader()
    identity = reader.self_identity(config_mri=ACME_MRI)
    assert identity.confidence == "config"
    assert identity.resolved


def test_self_identity_unresolved_without_sent_messages():
    reader = FakeReader([msg("hello", author="Sam")], ACME_PROFILES,
                        user_guid=ACME_GUID)
    identity = reader.self_identity()
    assert identity.confidence == "unresolved"
    assert identity.mri is None


def test_self_identity_hard_stops_on_tenant_mismatch():
    """A candidate from a different account is always wrong — never proceed."""
    reader = acme_reader()
    reader._user_guid = "deadbeef-0000-0000-0000-000000000000"
    with pytest.raises(SystemExit, match="cross-check FAILED"):
        reader.self_identity()


# ---------------------------------------------------------------- name gate
def test_name_gate_derived_from_identity_not_hardcoded():
    reader = acme_reader()
    gate = reader._name_gate(reader.self_identity(), None)
    assert "priya raman" in gate
    assert "priya" in gate
    assert ACME_MRI.lower() in gate


def test_name_gate_empty_when_identity_unresolved():
    """No identity means no guessing: 'to me' detection switches off."""
    reader = acme_reader()
    assert reader._name_gate(None, None) == []


def test_name_gate_skips_very_short_first_names():
    """A 2-letter first name would match half the corpus."""
    mri = "8:orgid:aaaaaaaa-0000-0000-0000-000000000000"
    profiles = {mri: {"displayName": "Bo Zhang", "mri": mri, "email": None,
                      "office": None, "phone": None, "title": None}}
    reader = FakeReader([msg("x", from_me=True, mri=mri)] * 6, profiles,
                        user_guid="aaaaaaaa-0000-0000-0000-000000000000")
    gate = reader._name_gate(reader.self_identity(), None)
    assert "bo zhang" in gate
    assert "bo" not in gate


def test_name_gate_extended_by_config_aliases():
    reader = acme_reader()
    gate = reader._name_gate(reader.self_identity(), ["pri"])
    assert "pri" in gate


# ---------------------------------------------------------------- generalization
def test_second_tenant_ticket_pattern_generalizes():
    """The headline generalization proof: a different tenant, a different key."""
    reader = acme_reader()
    result = reader.standup_prep({"conv-1"}, hours=24,
                                 ticket_pattern=r"\bACME-\d+\b",
                                 identity=reader.self_identity())
    keys = {key for key, _ in result["tickets"]}
    assert keys == {"ACME-4711", "ACME-4712"}


def test_default_ticket_pattern_matches_generic_jira_keys():
    reader = acme_reader()
    result = reader.standup_prep({"conv-1"}, hours=24,
                                 identity=reader.self_identity())
    assert {key for key, _ in result["tickets"]} == {"ACME-4711", "ACME-4712"}


def test_ticket_pattern_excludes_other_shapes():
    """A configured pattern must not leak keys from another tracker."""
    reader = FakeReader(
        [msg("ACME-1 and OTHER-2 both mentioned")], ACME_PROFILES, ACME_GUID)
    result = reader.standup_prep({"conv-1"}, hours=24,
                                 ticket_pattern=r"\bACME-\d+\b")
    assert {key for key, _ in result["tickets"]} == {"ACME-1"}


def test_standup_flags_questions_using_derived_identity():
    reader = acme_reader()
    result = reader.standup_prep({"conv-1"}, hours=24,
                                 ticket_pattern=r"\bACME-\d+\b",
                                 identity=reader.self_identity())
    directed = [m.content for m in result["questions_to_me"]]
    assert any("Priya please review" in c for c in directed)
    assert result["mine"], "own messages should be bucketed separately"


def test_requests_flags_addressed_without_hardcoded_name():
    reader = acme_reader()
    items = reader.requests(identity=reader.self_identity())
    to_me = [i for i in items if i["addressed_to_me"]]
    assert any("Priya please review" in i["content"] for i in to_me)


def test_requests_disables_addressed_when_identity_unresolved():
    reader = acme_reader()
    items = reader.requests(identity=None)
    assert items, "still returns candidates"
    assert not any(i["addressed_to_me"] for i in items), "but never guesses 'to me'"


def test_requests_returns_evidence_not_a_verdict():
    """The contract: retrieval hands back what matched, so the caller can judge."""
    reader = acme_reader()
    items = reader.requests(identity=reader.self_identity())
    assert items
    for item in items:
        assert item["matched"], "every candidate must say which phrase fired"
        assert item["matched"] in item["content"].lower()
        assert "is_question" in item and "automated" in item


def test_requests_ranks_addressed_questions_first():
    reader = acme_reader()
    items = reader.requests(identity=reader.self_identity())
    top = items[0]
    assert top["addressed_to_me"], "messages aimed at you must outrank generic hits"


def test_requests_excludes_automated_notifications_by_default():
    """Bot PR/deploy traffic uses request vocabulary but is never a request."""
    bot = msg("Please review: My PR POS-1 by someone · Pull Request #285 · Acme",
              author="Bot")
    reader = FakeReader([bot], ACME_PROFILES, user_guid=ACME_GUID)
    assert reader.requests() == []
    assert len(reader.requests(include_automated=True)) == 1


def test_decisions_returns_matched_phrase():
    reader = acme_reader()
    items = reader.decisions()
    assert items
    assert all(i["matched"] for i in items)


# ---------------------------------------------------------------- config
def test_config_parses_real_yaml(tmp_path: Path):
    path = tmp_path / "teams-reader.yaml"
    path.write_text(
        'watch:\n  - "Team A"\n  - "Team B"\n'
        'lookback_hours: 72\nmax_per_channel: 5\n'
        'ticket_pattern: "\\\\bACME-\\\\d+\\\\b"\n'
        'self:\n  mri: "8:orgid:abc"\n'
        'name_gate:\n  - "pri"\n'
    )
    cfg = load_config(path)
    assert cfg.watch == ["Team A", "Team B"]
    assert cfg.lookback_hours == 72
    assert cfg.max_per_channel == 5
    assert cfg.ticket_pattern == r"\bACME-\d+\b"
    assert cfg.self_mri == "8:orgid:abc"
    assert cfg.name_gate == ["pri"]


def test_config_malformed_yaml_raises_readable_error(tmp_path: Path):
    path = tmp_path / "bad.yaml"
    path.write_text("watch: [unclosed\n")
    with pytest.raises(ConfigError, match="invalid YAML"):
        load_config(path)


def test_config_rejects_wrong_types(tmp_path: Path):
    path = tmp_path / "bad.yaml"
    path.write_text("watch: 12\n")
    with pytest.raises(ConfigError, match="must be a list"):
        load_config(path)


def test_config_missing_file_raises(tmp_path: Path):
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "nope.yaml")


def test_config_empty_file_gives_defaults(tmp_path: Path):
    path = tmp_path / "empty.yaml"
    path.write_text("")
    cfg = load_config(path)
    assert cfg.watch == []
    assert cfg.lookback_hours == 24


def test_shipped_example_config_is_valid():
    cfg = load_config(SKILL_DIR / "teams-reader.example.yaml")
    assert cfg.watch == [], "example must ship a generic, empty watch list"
    assert cfg.self_mri is None, "example must let auto-detection run"


# ---------------------------------------------------------------- hygiene
def test_no_author_specific_hardcodes_in_source():
    """DoD lint: the library and CLI must carry no author-specific literals."""
    import re
    pattern = re.compile(r"nathan|POS-|8:orgid:[0-9a-f]{8}-|VALE_MRI", re.I)
    for name in ("teams_reader.py", "teams_cli.py", "teams_config.py",
                 "teams_output.py"):
        source = (SKILL_DIR / "scripts" / name).read_text()
        assert not pattern.search(source), f"{name} contains an author-specific literal"


def test_snapshot_cleans_up_on_exception(tmp_path: Path, monkeypatch):
    """The security guarantee: a crash must not orphan a copy of the chat."""
    created: list[Path] = []
    real_mkdtemp = tr.tempfile.mkdtemp

    def spy(*args, **kwargs):
        path = real_mkdtemp(*args, **kwargs)
        created.append(Path(path))
        return path

    monkeypatch.setattr(tr.tempfile, "mkdtemp", spy)
    monkeypatch.setattr(tr.subprocess, "run", lambda *a, **k: None)

    fake_store = tmp_path / "https_teams.microsoft.com_0.indexeddb.leveldb"
    fake_store.mkdir()

    with pytest.raises(RuntimeError):
        with tr.snapshot(fake_store):
            raise RuntimeError("boom")

    assert created, "snapshot should have created a temp dir"
    assert not created[0].exists(), "temp snapshot must not survive an exception"


# ---------------------------------------------------------------- live
def has_store() -> bool:
    try:
        tr.find_leveldb()
        return True
    except SystemExit:
        return False


live = pytest.mark.skipif(not has_store(), reason="no local Teams store on this machine")


def run_cli(*args: str) -> dict:
    proc = subprocess.run(
        [sys.executable, str(CLI), *args, "--json"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, f"{args} failed: {proc.stderr[:400]}"
    return json.loads(proc.stdout)


@live
def test_live_identity_resolves_high_confidence():
    payload = run_cli("whoami")
    assert payload["ok"]
    assert payload["data"]["confidence"] in ("high", "config")
    assert payload["data"]["mri"]


@live
@pytest.mark.parametrize("command", [
    "doctor", "channels", "digest", "mentions", "people", "whoami",
    "links", "code", "unread", "reactions",
])
def test_live_commands_emit_valid_envelope(command: str):
    payload = run_cli(command)
    assert payload["ok"] is True
    assert payload["run_id"]
    assert payload["command"] == command
    assert "data" in payload


@live
@pytest.mark.parametrize("command", ["decisions", "requests", "standup"])
def test_live_heuristic_commands_are_flagged(command: str):
    payload = run_cli(command)
    assert payload["heuristic"] is True, "heuristic output must be labelled as such"


@live
def test_live_unknown_channel_reports_not_found():
    proc = subprocess.run(
        [sys.executable, str(CLI), "history", "No Such Channel Zzz", "--json"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 1
    payload = json.loads(proc.stdout)
    assert payload["ok"] is False
    assert payload["failure"]["category"] == "not_found"
    assert payload["failure"]["retry_safe"] is True


@live
def test_live_commands_discovery_lists_every_handler():
    from teams_cli import COMMANDS, HANDLERS

    listed = {c["name"] for c in COMMANDS}
    assert listed == set(HANDLERS), "discovery catalog must match the dispatch table"
