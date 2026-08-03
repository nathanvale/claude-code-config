#!/usr/bin/env python3
"""Query your own local Microsoft Teams cache. Read-only, zero network to Microsoft.

Agent-native CLI: every command has a stable ``--json`` envelope, diagnostics go
to stderr, failures carry a machine-readable category plus a next-step hint, and
``commands --json`` is the discovery path so a driver never scrapes help text.

Run with no arguments for a dashboard of what is available.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from teams_config import Config, ConfigError, load_config  # noqa: E402
from teams_corpus import (  # noqa: E402
    CorpusWriter,
    Cursor,
    NoteInput,
    default_state_dir,
    reindex,
    secure_mkdir,
)
from teams_output import (  # noqa: E402
    EXIT_FAILURE,
    EXIT_OK,
    FAILURE_CONFIG_INVALID,
    FAILURE_NOT_FOUND,
    FAILURE_STORE_NOT_FOUND,
    HEURISTIC_CAVEAT,
    emit_failure,
    emit_json,
    warn,
)
from teams_reader import SelfIdentity, TeamsReader, open_reader  # noqa: E402

# ---------------------------------------------------------------- discovery
# Maintainer-authored command catalog. This is what `commands --json` projects,
# so a driver can choose a command without guessing from prose.
COMMANDS: list[dict] = [
    {"name": "doctor", "group": "diagnostic", "heuristic": False,
     "summary": "Check store, dependencies, config and identity resolution.",
     "usage": "doctor"},
    {"name": "channels", "group": "browse", "heuristic": False,
     "summary": "List named conversations Teams has cached.",
     "usage": "channels [--limit N]"},
    {"name": "digest", "group": "read", "heuristic": False,
     "summary": "Everything that happened in the window, across all conversations.",
     "usage": "digest [--hours N] [--limit N] [--only-watched]"},
    {"name": "poll", "group": "read", "heuristic": False,
     "summary": "New messages in watched channels and @mentions since the last poll.",
     "usage": "poll [--log PATH] [--once] [--interval SECONDS]"},
    {"name": "search", "group": "read", "heuristic": False,
     "summary": "Full-text search across all cached messages, with optional date/sender filters.",
     "usage": "search <query> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--from NAME|MRI] [--limit N]"},
    {"name": "mentions", "group": "read", "heuristic": False,
     "summary": "Messages that @mention you.",
     "usage": "mentions [--unread] [--limit N]"},
    {"name": "thread", "group": "read", "heuristic": False,
     "summary": "Rebuild a reply chain containing a keyword.",
     "usage": "thread <keyword> [--channel NAME]"},
    {"name": "history", "group": "read", "heuristic": False,
     "summary": "Date-bounded history of one channel, optional keyword.",
     "usage": "history <channel> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--query TEXT]"},
    {"name": "ticket", "group": "read", "heuristic": False,
     "summary": "Every mention of a ticket key across all channels, chronological.",
     "usage": "ticket <KEY>"},
    {"name": "links", "group": "extract", "heuristic": False,
     "summary": "Deduplicated URLs shared, with who and when.",
     "usage": "links [--channel NAME] [--since YYYY-MM-DD] [--limit N]"},
    {"name": "code", "group": "extract", "heuristic": False,
     "summary": "Messages containing code or pre blocks.",
     "usage": "code [--channel NAME] [--limit N]"},
    {"name": "sync", "group": "corpus", "heuristic": False,
     "summary": "Backfill every cached message into the markdown corpus and refresh "
                "the BM25 index (fast). Vector embedding is deferred — pass --embed "
                "to include it, or run `embed` afterwards. Incremental; --full rewrites.",
     "usage": "sync [--full] [--embed] [--no-index] [--save-dir PATH]"},
    {"name": "embed", "group": "corpus", "heuristic": False,
     "summary": "Run the deferred vector-embedding pass on its own. Call at the end "
                "of a batch so slow embedding never blocks the sync.",
     "usage": "embed [--save-dir PATH]"},
    {"name": "unread", "group": "read", "heuristic": False,
     "summary": "Unread activity-feed items and conversations. Note: the cache "
                "keeps no per-message read horizon.",
     "usage": "unread [--limit N]"},
    {"name": "reactions", "group": "extract", "heuristic": False,
     "summary": "Emoji reaction counts and the most-reacted messages.",
     "usage": "reactions [--channel NAME] [--since YYYY-MM-DD] [--limit N]"},
    {"name": "people", "group": "identity", "heuristic": False,
     "summary": "Directory of everyone in the local profile cache.",
     "usage": "people [--limit N]"},
    {"name": "whois", "group": "identity", "heuristic": False,
     "summary": "Look up a person by name or email fragment.",
     "usage": "whois <query>"},
    {"name": "whoami", "group": "identity", "heuristic": False,
     "summary": "Show the identity this store belongs to, and how it resolved.",
     "usage": "whoami"},
    {"name": "disambiguate", "group": "identity", "heuristic": False,
     "summary": "Separate distinct people who share a display name.",
     "usage": "disambiguate <display-name>"},
    {"name": "decisions", "group": "heuristic", "heuristic": True,
     "summary": "Messages that look like decisions. Regex-only, noisy.",
     "usage": "decisions [--channel NAME] [--since YYYY-MM-DD]"},
    {"name": "action-items", "group": "heuristic", "heuristic": True,
     "summary": "Messages that look like commitments. Regex-only, noisy.",
     "usage": "action-items [--since YYYY-MM-DD] [--limit N]"},
    {"name": "standup", "group": "heuristic", "heuristic": True,
     "summary": "Bucket recent watched activity for standup. Regex-only, noisy.",
     "usage": "standup [--hours N]"},
]

HEURISTIC_COMMANDS = {c["name"] for c in COMMANDS if c["heuristic"]}


# ---------------------------------------------------------------- helpers
def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)
    except ValueError:
        raise SystemExit(f"invalid date {value!r}: expected YYYY-MM-DD") from None


def fmt_time(dt: datetime | None) -> str:
    return dt.astimezone().strftime("%a %d %b %H:%M") if dt else "??"


def truncate(text: str, width: int = 160) -> str:
    body = " ".join(text.split())
    return body if len(body) <= width else body[: width - 3] + "..."


def resolve_watch(reader: TeamsReader, names: list[str],
                  warnings: list[str]) -> set[str]:
    """Config channel names -> conversationIds.

    Never silently picks one: no match warns with the nearest names, several
    matches warns and uses them all.
    """
    ids: set[str] = set()
    if not names:
        return ids
    resolved = reader.resolve_channels(names)
    for want, matches in resolved.items():
        if not matches:
            nearest = nearest_names(reader, want)
            msg = (f"watch entry {want!r}: NO MATCH. "
                   f"Nearest cached names: {', '.join(nearest) if nearest else '(none)'}")
            warnings.append(msg)
            warn(msg)
            continue
        if len(matches) > 1:
            msg = (f"watch entry {want!r}: {len(matches)} matches, using all "
                   f"({', '.join(repr(c.name) for c in matches[:5])}"
                   f"{', ...' if len(matches) > 5 else ''})")
            warnings.append(msg)
            warn(msg)
        ids.update(c.id for c in matches)
    return ids


def active_conversations(reader: TeamsReader, hours: int,
                         scope: set[str] | None = None) -> list:
    """Conversations with activity inside the window, newest first.

    Uses the cached ``lastMessageTimeUtc`` on each conversation record, so this
    is a cheap metadata read — it does not walk the message store.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    convs = [c for c in reader.conversations().values()
             if c.last and c.last >= cutoff and (scope is None or c.id in scope)]
    convs.sort(key=lambda c: c.last, reverse=True)
    return convs


def nearest_names(reader: TeamsReader, want: str, k: int = 5) -> list[str]:
    """Cheap nearest-name suggestions: shared word, then shared prefix."""
    names = [c.name for c in reader.conversations().values() if c.name]
    words = {w for w in re.split(r"\W+", want.lower()) if len(w) > 2}
    scored = []
    for name in set(names):
        low = name.lower()
        score = sum(1 for w in words if w in low)
        if score:
            scored.append((score, name))
    scored.sort(key=lambda x: (-x[0], x[1]))
    if scored:
        return [n for _, n in scored[:k]]
    return sorted(set(names))[:k]


def one_channel(reader: TeamsReader, name: str) -> str:
    """Resolve a single channel operand to a conversationId, or fail clearly."""
    matches = reader.resolve_channels([name])[name]
    if not matches:
        raise LookupError(
            f"no channel matches {name!r}. "
            f"Nearest: {', '.join(nearest_names(reader, name))}"
        )
    if len(matches) > 1:
        warn(f"{name!r} matched {len(matches)} channels, using most recent: {matches[0].name!r}")
    return matches[0].id


def resolve_identity(reader: TeamsReader, cfg: Config,
                     warnings: list[str]) -> SelfIdentity:
    identity = reader.self_identity(config_mri=cfg.self_mri)
    if identity.confidence == "low":
        msg = (f"self-identity low confidence ({identity.detail}). "
               f"Candidate: {identity.candidate_mri}. "
               f"'to me' flagging is disabled until you set self.mri in config.")
        warnings.append(msg)
        warn(msg)
    elif identity.confidence == "unresolved":
        msg = f"self-identity unresolved ({identity.detail}); 'to me' flagging disabled."
        warnings.append(msg)
        warn(msg)
    return identity


# Per-run handles for the active reader and corpus writer. Set once in main so
# read-through persistence does not have to be threaded through every handler.
_ACTIVE: dict = {}


def persist(reader: TeamsReader, messages, writer: CorpusWriter | None) -> None:
    """Read-through persistence: saving is a side effect of reading.

    Every message a command returns becomes a markdown note, so the corpus
    grows as the user works and QMD can index it. No separate export step.
    """
    if writer is None or not writer.enabled:
        return
    convs = reader.conversations()
    for m in messages:
        conv = convs.get(m.conversation_id)
        writer.write(NoteInput(
            message_id=m.message_id,
            sent_at=m.time,
            author=m.author,
            author_mri=m.creator_mri,
            is_from_me=m.from_me,
            conversation_id=m.conversation_id,
            conversation_name=conv.name if conv else None,
            conversation_type=conv.type if conv else None,
            content=m.content,
        ))


def msg_rows(messages, reader: TeamsReader | None = None,
             writer: CorpusWriter | None = None) -> list[dict]:
    # The writer rides on the reader (set once in main) so every handler gets
    # read-through persistence without threading it through each signature.
    reader = reader or _ACTIVE.get("reader")
    writer = writer or _ACTIVE.get("writer")
    if reader is not None:
        persist(reader, messages, writer)
    return [
        {"time": m.time, "author": m.author, "from_me": m.from_me,
         "creator_mri": m.creator_mri, "conversation_id": m.conversation_id,
         "content": m.content, "message_id": m.message_id}
        for m in messages
    ]


def print_messages(reader: TeamsReader, messages, label: str) -> None:
    names = reader.conversations()
    print(f"{label} ({len(messages)} messages)")
    if not messages:
        print("  (nothing found)")
        return
    for m in messages:
        who = "you" if m.from_me else m.author
        conv = names.get(m.conversation_id)
        where = f" · {conv.name}" if conv and conv.name else ""
        print(f"  [{fmt_time(m.time)}]{where}\n    {who}: {truncate(m.content)}")


# ---------------------------------------------------------------- handlers
def cmd_doctor(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    convs = reader.conversations()
    named = [c for c in convs.values() if c.name]
    identity = resolve_identity(reader, cfg, warnings)
    latest = max((c.last for c in convs.values() if c.last), default=None)
    watch_ids = resolve_watch(reader, cfg.watch, warnings)
    data = {
        "store": {"conversations": len(convs), "named": len(named),
                  "profiles": len(reader.people()),
                  "newest_activity": latest},
        "config": {"source": str(cfg.source) if cfg.source else None,
                   "watch_entries": len(cfg.watch),
                   "watch_resolved": len(watch_ids),
                   "ticket_pattern": cfg.ticket_pattern or reader.DEFAULT_TICKET_PATTERN},
        "identity": identity,
    }
    if not args.json:
        print("Teams reader diagnostics")
        print(f"  store        : {len(convs)} conversations ({len(named)} named), "
              f"{len(reader.people())} profiles")
        print(f"  newest msg   : {fmt_time(latest)}")
        print(f"  config       : {cfg.source or '(none found)'}")
        print(f"  watch        : {len(cfg.watch)} entries -> {len(watch_ids)} channels")
        print(f"  identity     : {identity.display_name or '(unresolved)'} "
              f"[{identity.confidence}]")
        print(f"                 {identity.detail}")
    return data


def cmd_channels(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    convs = [c for c in reader.conversations().values() if c.name]
    convs.sort(key=lambda c: c.last or datetime.min.replace(tzinfo=timezone.utc),
               reverse=True)
    convs = convs[: args.limit]
    if not args.json:
        print(f"Cached conversations ({len(convs)} shown)")
        for c in convs:
            print(f"  [{fmt_time(c.last)}] {c.type:<18} {c.name}")
    return [{"id": c.id, "name": c.name, "type": c.type, "last": c.last,
             "members": c.n_members} for c in convs]


def cmd_digest(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    """Everything that happened in the window, across every conversation.

    The time window IS the filter: a conversation with activity in the last N
    hours is relevant by definition, and one without contributes nothing. So
    the digest never narrows by channel — narrowing is what made the old
    watch-list-as-allowlist quietly drop channels nobody had thought to list
    (measured 2026-07-30: a 24h window had 12 active conversations, only 4 of
    which were on the watch list).

    `watch` plays no part here any more; it belongs to the notify path, not the
    pull path. --only-watched restores the old allowlist behaviour on demand.

    Returns a plain list of message rows. Do not change that shape: the
    productivity-sync skill iterates `data[]` from `digest --json` on every run.
    """
    hours = args.hours or cfg.lookback_hours

    scope = None
    if args.only_watched:
        scope = resolve_watch(reader, cfg.watch, warnings) or None
        if scope is None:
            warn("--only-watched given but no watch entries resolved; covering all conversations")

    # Budget scales with how many conversations were actually active. The old
    # `or [1]` collapsed an empty watch list to a single channel's worth of
    # messages spread across the entire store.
    active = active_conversations(reader, hours, scope)
    limit = args.limit or (cfg.max_per_channel * max(1, len(active)))
    messages = reader.digest(scope, hours=hours, limit=limit)

    if not args.json:
        title = f"Digest — last {hours}h"
        if scope is not None:
            title += " (watched only)"
        elif active:
            title += f" — {len(active)} active conversation{'s' if len(active) != 1 else ''}"
        print_messages(reader, messages, title)
    return msg_rows(messages)


def _poll_cursor_path() -> Path:
    return default_state_dir() / "poll-cursor.json"


def _poll_read_cursor() -> datetime | None:
    try:
        raw = json.loads(_poll_cursor_path().read_text()).get("last_seen_at")
        return datetime.fromisoformat(raw) if raw else None
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return None


def _poll_write_cursor(when: datetime | None) -> None:
    if not when:
        return
    path = _poll_cursor_path()
    secure_mkdir(path.parent)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"last_seen_at": when.isoformat()}, indent=2))
    tmp.replace(path)
    with contextlib.suppress(OSError):
        path.chmod(0o600)


def poll_once(reader: TeamsReader, cfg: Config, warnings: list[str], *,
              log_path: Path, since: datetime | None,
              fallback_hours: int) -> dict:
    """One pass: append anything new in watched channels or @mentions to the log.

    Two signals, deliberately: watched channels are the ones you always care
    about, and an @mention matters wherever it lands. Everything else is what
    `digest` is for — this path stays quiet enough to leave running.
    """
    watch_ids = resolve_watch(reader, cfg.watch, warnings) if cfg.watch else set()
    cutoff = since or (datetime.now(timezone.utc) - timedelta(hours=fallback_hours))

    fresh = [m for m in reader.iter_messages() if m.time and m.time > cutoff]

    mention_ids = set()
    for item in reader.mentions(unread_only=False, limit=200):
        when = item.get("time")
        if when and when > cutoff and item.get("message_id"):
            mention_ids.add(str(item["message_id"]))

    names = reader.conversations()
    hits = []
    for m in fresh:
        # Never report your own messages back to you.
        if m.from_me:
            continue
        why = []
        if watch_ids and m.conversation_id in watch_ids:
            why.append("watch")
        if str(m.message_id) in mention_ids:
            why.append("mention")
        if why:
            hits.append((m, why))
    hits.sort(key=lambda pair: pair[0].time)

    if hits:
        secure_mkdir(log_path.parent)
        with log_path.open("a", encoding="utf-8") as fh:
            for m, why in hits:
                conv = names.get(m.conversation_id)
                where = (conv.name if conv else None) or m.conversation_id
                stamp = m.time.astimezone().strftime("%Y-%m-%d %H:%M")
                fh.write(f"[{stamp}] ({'+'.join(why)}) {where} | "
                         f"{m.author}: {truncate(m.content, 220)}\n")
        with contextlib.suppress(OSError):
            log_path.chmod(0o600)

    newest = max((m.time for m, _ in hits), default=None) or (
        max((m.time for m in fresh), default=None))
    return {"new": len(hits), "scanned": len(fresh), "newest": newest,
            "log": str(log_path),
            "hits": [{"time": m.time, "author": m.author, "why": why,
                      "conversation_id": m.conversation_id,
                      "creator_mri": m.creator_mri,
                      "content": m.content} for m, why in hits]}


def cmd_poll(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    """Append new watched-channel and @mention activity to a tailable log.

    The corpus answers "what was said"; this answers "tell me when something
    I care about lands". Watch exists for exactly this — `digest` no longer
    narrows by channel, so the watch list's only job is deciding what is worth
    interrupting you for.

    --once does a single pass (cron-friendly). Without it, loops in-process.
    """
    log_path = Path(args.log).expanduser() if args.log else default_state_dir() / "watch.log"
    if not cfg.watch:
        warn("no watch list configured; poll will only report @mentions")

    result = poll_once(reader, cfg, warnings, log_path=log_path,
                       since=_poll_read_cursor(),
                       fallback_hours=args.hours or cfg.lookback_hours)
    _poll_write_cursor(result["newest"])

    # Loop mode re-opens the store each pass: `reader` holds a snapshot taken at
    # startup, so reusing it would re-read the same frozen bytes forever and the
    # poller would never see a new message.
    if not args.once and not args.json:
        interval = max(30, args.interval)
        total = result["new"]
        try:
            while True:
                time.sleep(interval)
                with open_reader() as fresh_reader:
                    result = poll_once(fresh_reader, cfg, warnings, log_path=log_path,
                                       since=_poll_read_cursor(),
                                       fallback_hours=args.hours or cfg.lookback_hours)
                _poll_write_cursor(result["newest"])
                total += result["new"]
                if result["new"]:
                    print(f"{result['new']} new -> {result['log']}")
                    for h in result["hits"]:
                        print(f"  ({'+'.join(h['why'])}) {h['author']}: "
                              f"{truncate(h['content'], 100)}")
        except KeyboardInterrupt:
            print(f"\nstopped. {total} logged this run -> {log_path}")
            return result

    if not args.json:
        if result["new"]:
            print(f"{result['new']} new -> {result['log']}")
            for h in result["hits"]:
                print(f"  ({'+'.join(h['why'])}) {h['author']}: "
                      f"{truncate(h['content'], 100)}")
        else:
            print(f"nothing new (scanned {result['scanned']} messages since last poll)")
    return result


def cmd_search(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    messages = reader.search(
        args.query, limit=args.limit,
        since=parse_date(args.since), until=parse_date(args.until),
        sender=args.sender)
    if not args.json:
        print_messages(reader, messages, f"Search {args.query!r}")
    return msg_rows(messages)


def cmd_mentions(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    items = reader.mentions(unread_only=args.unread, limit=args.limit)
    names = reader.conversations()
    for item in items:
        conv = names.get(item.get("conversation_id"))
        item["conversation_name"] = conv.name if conv else None
    if not args.json:
        label = "Unread mentions" if args.unread else "Mentions"
        print(f"{label} ({len(items)})")
        for x in items:
            flag = "UNREAD" if not x["is_read"] else "read  "
            where = x.get("conversation_name") or x.get("conversation_id")
            print(f"  [{fmt_time(x['time'])}] {flag} · {where}\n"
                  f"    {x['author']}: {truncate(x['content'], 140)}")
    return items


def cmd_thread(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    if args.channel:
        conv_id = one_channel(reader, args.channel)
    else:
        hit = next(iter(reader.search(args.keyword, limit=1)), None)
        if not hit:
            raise LookupError(f"no message matches {args.keyword!r}")
        conv_id = hit.conversation_id
    chain = reader.thread(conv_id, contains=args.keyword)
    if not args.json:
        conv = reader.conversations().get(conv_id)
        print_messages(reader, chain,
                       f"Thread in {conv.name if conv else conv_id!r} matching {args.keyword!r}")
    return msg_rows(chain)


def cmd_history(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    conv_id = one_channel(reader, args.channel)
    messages = reader.history(conv_id, since=parse_date(args.since),
                              until=parse_date(args.until), query=args.query)
    if not args.json:
        print_messages(reader, messages, f"History — {args.channel!r}")
    return msg_rows(messages)


def cmd_ticket(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    messages = reader.ticket_timeline(args.key)
    if not args.json:
        print_messages(reader, messages, f"Timeline for {args.key}")
    return msg_rows(messages)


def cmd_links(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    conv_id = one_channel(reader, args.channel) if args.channel else None
    items = reader.links(conv_id, since=parse_date(args.since))[: args.limit]
    if not args.json:
        print(f"Links ({len(items)})")
        for x in items:
            print(f"  [{fmt_time(x['time'])}] {x['author']}\n    {x['url']}")
    return items


def cmd_code(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    conv_id = one_channel(reader, args.channel) if args.channel else None
    items = reader.code_snippets(conv_id)[: args.limit]
    if not args.json:
        print(f"Code snippets ({len(items)})")
        for x in items:
            print(f"  [{fmt_time(x['time'])}] {x['author']}")
            for snippet in x["snippets"][:2]:
                print(f"    | {truncate(snippet, 120)}")
    return items


def cmd_unread(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    result = reader.unread(limit=args.limit)
    if not args.json:
        print(result["note"] + "\n")
        acts = result["activities"]
        print(f"Unread activity ({len(acts)})")
        for a in acts:
            label = a["activity_subtype"] or a["activity_type"] or "activity"
            where = a["conversation_name"] or a["conversation_id"] or "?"
            print(f"  [{fmt_time(a['time'])}] {label} · {where}")
            if a["content"]:
                print(f"    {a['author']}: {truncate(a['content'], 130)}")
        convs = result["conversations"]
        print(f"\nUnread conversations ({len(convs)})")
        for c in convs:
            print(f"  [{fmt_time(c['last'])}] {c['type']:<10} {c['name']}")
    return result


def cmd_reactions(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    conv_id = one_channel(reader, args.channel) if args.channel else None
    result = reader.reactions(conv_id, since=parse_date(args.since), limit=args.limit)
    if not args.json:
        print(f"Reactions across {result['messages_with_reactions']} messages\n")
        by_emoji = result["by_emoji"]
        top_emoji = list(by_emoji.items())[:10]
        print("  By emoji: " + ", ".join(f"{k} x{v}" for k, v in top_emoji))
        print("  Top reactors: " + ", ".join(
            f"{r['display_name'] or r['mri'][:20]} ({r['count']})"
            for r in result["top_reactors"][:5]))
        print(f"\nMost-reacted messages ({len(result['most_reacted'])})")
        for m in result["most_reacted"]:
            emojis = ", ".join(f"{k} x{v}" for k, v in m["reactions"].items())
            where = m["conversation_name"] or m["conversation_id"]
            print(f"  [{fmt_time(m['time'])}] {m['total_reactions']} reactions "
                  f"({emojis}) · {where}")
            print(f"    {m['author']}: {truncate(m['content'], 130)}")
    return result


def cmd_sync(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    """Backfill the whole cache into the markdown corpus.

    Incremental by default: the cursor records the newest message already
    written, so repeat runs only add what arrived since. --full rewrites
    everything, which is also the repair path if the corpus is damaged (it is
    rebuildable from the Teams cache).
    """
    writer = _ACTIVE.get("writer") or CorpusWriter(args.save_dir)
    writer.enabled = True
    cursor = Cursor()
    since = None if args.full else cursor.last_synced()

    messages = [m for m in reader.iter_messages()
                if m.time and (since is None or m.time > since)]
    messages.sort(key=lambda m: m.time)
    persist(reader, messages, writer)

    newest = messages[-1].time if messages else since
    cursor.write(newest, writer.written)

    # Re-index so the notes just written are actually searchable. A corpus QMD
    # has not seen is invisible, which defeats the point of writing it.
    # BM25 (`qmd update`) only by default — it is fast and makes keyword search
    # (`qmd search`) live immediately. Vector embedding (`qmd embed`) is the slow
    # step; it is deferred so it never blocks a sync. Pass --embed to run both, or
    # run the standalone `embed` command afterwards (e.g. at the end of a batch).
    index = None
    if writer.written and not args.no_index:
        index = reindex(writer.dir, embed=args.embed)
        if not index["ok"]:
            warn(f"corpus written but reindex failed: {index.get('reason') or index}")

    data = {**writer.summary(), "cursor": str(cursor.path),
            "since": since, "newest_message": newest,
            "mode": "full" if args.full else "incremental",
            "reindex": index}
    if not args.json:
        mode = "full" if args.full else "incremental"
        print(f"Synced corpus ({mode})")
        print(f"  corpus  : {writer.dir}")
        print(f"  written : {writer.written} notes"
              + (f" (skipped {writer.skipped})" if writer.skipped else ""))
        print(f"  newest  : {fmt_time(newest)}")
        print(f"  cursor  : {cursor.path}")
        if index:
            # Name the collection state alongside the verdict: "yes" on its own
            # once hid a pass that indexed nothing because the collection was
            # never registered, and `qmd update` exits 0 when it skips it.
            state = index.get("collection_state")
            if not index["ok"]:
                detail = "FAILED"
            elif state == "registered":
                detail = f"yes (registered '{index.get('collection')}')"
            elif state == "unknown":
                detail = "yes (collection state unverified)"
            else:
                detail = "yes"
            print(f"  indexed : {detail}")
            if hint := index.get("hint"):
                print(f"            {hint}")
        elif writer.written:
            print("  indexed : skipped (--no-index)")
    return data


def cmd_embed(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    """Run the deferred vector-embedding pass on its own.

    `sync` writes notes and refreshes the BM25 index (fast) but skips embedding by
    default. Call this at the end of a batch (e.g. the tail of a productivity sync)
    to bring vectors current without ever blocking the sync's real work. Embedding
    is incremental, so this is cheap when little changed.
    """
    writer = _ACTIVE.get("writer") or CorpusWriter(args.save_dir)
    result = reindex(writer.dir, update=False, embed=True)
    if not result["ok"]:
        warn(f"embed failed: {result.get('reason') or result}")
    data = {"corpus_dir": str(writer.dir), "embed": result}
    if not args.json:
        print(f"Embed (vectors) : {'ok' if result['ok'] else 'FAILED'}")
        print(f"  corpus : {writer.dir}")
    return data


def cmd_people(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    ppl = sorted(reader.people().values(), key=lambda p: (p["displayName"] or "").lower())
    ppl = ppl[: args.limit]
    if not args.json:
        print(f"People ({len(ppl)} shown)")
        for p in ppl:
            print(f"  {p['displayName']:<28} {p['email'] or '':<34} {p['title'] or ''}")
    return ppl


def cmd_whois(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    hits = reader.whois(args.query)
    if not args.json:
        print(f"whois {args.query!r} ({len(hits)})")
        for p in hits:
            print(f"  {p['displayName']}\n    email: {p['email']}\n"
                  f"    title: {p['title']}\n    mri:   {p['mri']}")
    return hits


def cmd_whoami(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    identity = resolve_identity(reader, cfg, warnings)
    if not args.json:
        print(f"  name       : {identity.display_name or '(unresolved)'}")
        print(f"  mri        : {identity.mri or identity.candidate_mri or '(none)'}")
        print(f"  confidence : {identity.confidence}")
        print(f"  detail     : {identity.detail}")
    return identity


def cmd_disambiguate(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    found = reader.disambiguate(args.name)
    if not args.json:
        print(f"Distinct identities matching {args.name!r} ({len(found)})")
        for mri, info in sorted(found.items(), key=lambda kv: -kv[1]["msg_count"]):
            print(f"  {info.get('displayName') or '(no profile)'}"
                  f"  · {info['msg_count']} messages")
            print(f"    mri:   {mri}")
            print(f"    email: {info.get('email')}")
    return [{"mri": mri, **info} for mri, info in found.items()]


def cmd_decisions(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    conv_id = one_channel(reader, args.channel) if args.channel else None
    messages = reader.decisions(conv_id, since=parse_date(args.since))[: args.limit]
    if not args.json:
        print(HEURISTIC_CAVEAT)
        print_messages(reader, messages, "Possible decisions")
    return msg_rows(messages)


def cmd_action_items(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    identity = resolve_identity(reader, cfg, warnings)
    items = reader.action_items(identity=identity, name_gate=cfg.name_gate,
                                since=parse_date(args.since))[: args.limit]
    if not args.json:
        print(HEURISTIC_CAVEAT)
        print(f"Possible action items ({len(items)})")
        for x in items:
            tag = "FROM-YOU" if x["from_me"] else ("TO-YOU" if x["to_me"] else "        ")
            print(f"  [{fmt_time(x['time'])}] {tag} {x['author']}: {truncate(x['content'], 130)}")
    return items


def cmd_standup(reader: TeamsReader, cfg: Config, args, warnings: list[str]):
    identity = resolve_identity(reader, cfg, warnings)
    hours = args.hours or cfg.lookback_hours
    # Same rule as digest: the window is the filter. Narrowing to the watch list
    # hides tickets and questions raised in channels you did not think to list,
    # which is exactly what standup prep must not miss. --only-watched opts back in.
    watch_ids = resolve_watch(reader, cfg.watch, warnings) if cfg.watch else set()
    scope = watch_ids if (args.only_watched and watch_ids) else None
    if args.only_watched and not watch_ids:
        warn("--only-watched given but no watch entries resolved; covering all conversations")
    result = reader.standup_prep(scope, hours=hours,
                                 ticket_pattern=cfg.ticket_pattern,
                                 identity=identity, name_gate=cfg.name_gate)
    data = {
        "since": result["since"],
        "mine": msg_rows(result["mine"]),
        "questions_to_me": msg_rows(result["questions_to_me"]),
        "tickets": [{"key": key, "time": m.time, "author": m.author,
                     "content": m.content} for key, m in result["tickets"]],
    }
    if not args.json:
        print(HEURISTIC_CAVEAT)
        print(f"Standup prep — last {hours}h")
        print(f"\n  You said ({len(result['mine'])}):")
        for m in result["mine"][:10]:
            print(f"    [{fmt_time(m.time)}] {truncate(m.content, 120)}")
        print(f"\n  Directed at you ({len(result['questions_to_me'])}):")
        for m in result["questions_to_me"][:10]:
            print(f"    [{fmt_time(m.time)}] {m.author}: {truncate(m.content, 120)}")
        keys = [k for k, _ in result["tickets"]]
        print(f"\n  Tickets mentioned ({len(keys)}): {', '.join(keys) if keys else '(none)'}")
    return data


HANDLERS = {
    "doctor": cmd_doctor,
    "channels": cmd_channels,
    "digest": cmd_digest,
    "poll": cmd_poll,
    "search": cmd_search,
    "mentions": cmd_mentions,
    "thread": cmd_thread,
    "history": cmd_history,
    "ticket": cmd_ticket,
    "links": cmd_links,
    "code": cmd_code,
    "unread": cmd_unread,
    "reactions": cmd_reactions,
    "sync": cmd_sync,
    "embed": cmd_embed,
    "people": cmd_people,
    "whois": cmd_whois,
    "whoami": cmd_whoami,
    "disambiguate": cmd_disambiguate,
    "decisions": cmd_decisions,
    "action-items": cmd_action_items,
    "standup": cmd_standup,
}


# ---------------------------------------------------------------- front door
def dashboard(cfg: Config, as_json: bool) -> int:
    """No-arg front door.

    A launcher, not a report dump: it answers what exists, what state the tool
    is in, and what to run next. Unreadable state stops before anything else.
    """
    venv = Path(__file__).resolve().parent.parent / ".venv"
    if not venv.exists():
        return emit_failure(
            "dashboard", "dependency_missing",
            "dependencies are not installed yet",
            hint="run scripts/bootstrap.sh (one-time, needs network + git)",
            as_json=as_json,
        )
    try:
        with open_reader() as reader:
            warnings: list[str] = []
            convs = reader.conversations()
            named = [c for c in convs.values() if c.name]
            identity = resolve_identity(reader, cfg, warnings)
            latest = max((c.last for c in convs.values() if c.last), default=None)
            watch_ids = resolve_watch(reader, cfg.watch, warnings)

            if as_json:
                return emit_json("dashboard", {
                    "identity": identity,
                    "store": {"conversations": len(convs), "named": len(named),
                              "newest_activity": latest},
                    "watch": {"entries": cfg.watch, "resolved": len(watch_ids)},
                    "next_commands": [c["name"] for c in COMMANDS
                                      if c["group"] in ("read", "browse")][:5],
                }, warnings=warnings)

            print("Teams local reader — your own cached Teams data, read-only.\n")
            print(f"  signed in as : {identity.display_name or '(unresolved)'}")
            print(f"  cached       : {len(named)} named conversations, "
                  f"newest activity {fmt_time(latest)}")
            if cfg.watch:
                print(f"  watching     : {len(cfg.watch)} entries -> {len(watch_ids)} channels")
            else:
                print("  watching     : (no watch list configured)")

            print("\nStart here:")
            print("  digest                 what happened recently in your channels")
            print("  mentions --unread      what needs your attention")
            print("  search <text>          find any message")
            print("  channels               see what is cached")
            print("  whois <name>           look someone up")
            print("\n  teams_cli.py --help        all commands")
            print("  teams_cli.py commands --json   machine-readable command list")
            if not cfg.watch:
                print("\n  Tip: copy teams-reader.example.yaml to teams-reader.yaml "
                      "and add a watch list to focus the digest.")
            return EXIT_OK
    except SystemExit as exc:
        return emit_failure("dashboard", FAILURE_STORE_NOT_FOUND, str(exc),
                            hint="is the new Teams (v2) app installed and signed in?",
                            as_json=as_json)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="teams_cli.py",
        description="Query your own local Microsoft Teams cache. "
                    "Read-only; no network to Microsoft.",
        epilog="Examples:\n"
               "  teams_cli.py                      dashboard\n"
               "  teams_cli.py digest --hours 48\n"
               "  teams_cli.py search 'release notes' --json\n"
               "  teams_cli.py ticket PROJ-1234\n"
               "  teams_cli.py mentions --unread\n",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--json", action="store_true",
                        help="emit a structured envelope on stdout")
    parser.add_argument("--config", type=Path, default=None,
                        help="config file (default: $XDG_CONFIG_HOME/teams/teams-reader.yaml, "
                             "then in-skill teams-reader.yaml, then teams-reader.example.yaml)")
    sub = parser.add_subparsers(dest="command")

    def add(name: str, help_text: str) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text, description=help_text)
        p.add_argument("--json", action="store_true", help="structured output")
        p.add_argument("--config", type=Path, default=None, help="config file")
        p.add_argument("--save-dir", type=Path, default=None,
                       help="markdown corpus directory "
                            "(default: $XDG_DATA_HOME/teams)")
        p.add_argument("--no-save", action="store_true",
                       help="do not write returned messages to the corpus")
        return p

    # Discovery: always emits JSON, but accepts --json so a driver can pass it
    # uniformly across every command without special-casing this one.
    p = sub.add_parser("commands", help="list commands as machine-readable JSON")
    p.add_argument("--json", action="store_true", help="(always on for this command)")
    p.add_argument("--config", type=Path, default=None, help="unused; accepted for uniformity")

    add("doctor", "Check store, dependencies, config and identity resolution.")

    p = add("channels", "List named conversations Teams has cached.")
    p.add_argument("--limit", type=int, default=60)

    p = add("digest", "Everything that happened in the window, all conversations.")
    p.add_argument("--hours", type=int, default=None)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--only-watched", action="store_true",
                   help="narrow to the config watch list instead of all conversations")

    p = add("poll", "Append new watched-channel and @mention activity to a log.")
    p.add_argument("--log", default=None,
                   help="log file to append to (default: $XDG_STATE_HOME/teams/watch.log)")
    p.add_argument("--hours", type=int, default=None,
                   help="lookback for the FIRST poll, before a cursor exists")
    p.add_argument("--once", action="store_true",
                   help="single pass then exit (cron-friendly); default loops")
    p.add_argument("--interval", type=int, default=300,
                   help="seconds between passes when looping (default 300)")

    p = add("search", "Full-text search across all cached messages.")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--since", default=None, help="only messages at/after YYYY-MM-DD")
    p.add_argument("--until", default=None, help="only messages at/before YYYY-MM-DD")
    p.add_argument("--from", dest="sender", default=None,
                   help="filter by author name substring or exact creator_mri")

    p = add("mentions", "Messages that @mention you.")
    p.add_argument("--unread", action="store_true")
    p.add_argument("--limit", type=int, default=50)

    p = add("thread", "Rebuild a reply chain containing a keyword.")
    p.add_argument("keyword")
    p.add_argument("--channel", default=None)

    p = add("history", "Date-bounded history of one channel.")
    p.add_argument("channel")
    p.add_argument("--since", default=None)
    p.add_argument("--until", default=None)
    p.add_argument("--query", default=None)

    p = add("ticket", "Every mention of a ticket key, chronological.")
    p.add_argument("key")

    p = add("links", "Deduplicated URLs shared, with who and when.")
    p.add_argument("--channel", default=None)
    p.add_argument("--since", default=None)
    p.add_argument("--limit", type=int, default=50)

    p = add("code", "Messages containing code or pre blocks.")
    p.add_argument("--channel", default=None)
    p.add_argument("--limit", type=int, default=30)

    p = add("sync", "Backfill every cached message into the markdown corpus.")
    p.add_argument("--full", action="store_true",
                   help="rewrite the whole corpus, ignoring the cursor")
    p.add_argument("--no-index", action="store_true",
                   help="skip the QMD reindex after writing")
    p.add_argument("--embed", action="store_true",
                   help="also run vector embedding now (slow); default is BM25-only, "
                        "with embedding deferred to the standalone `embed` command")

    add("embed", "Run the deferred vector-embedding pass on the corpus.")

    p = add("unread", "Unread activity-feed items and conversations.")
    p.add_argument("--limit", type=int, default=50)

    p = add("reactions", "Emoji reaction counts and most-reacted messages.")
    p.add_argument("--channel", default=None)
    p.add_argument("--since", default=None)
    p.add_argument("--limit", type=int, default=25)

    p = add("people", "Directory of everyone in the local profile cache.")
    p.add_argument("--limit", type=int, default=100)

    p = add("whois", "Look up a person by name or email fragment.")
    p.add_argument("query")

    add("whoami", "Show the identity this store belongs to.")

    p = add("disambiguate", "Separate distinct people sharing a display name.")
    p.add_argument("name")

    p = add("decisions", "HEURISTIC: messages that look like decisions.")
    p.add_argument("--channel", default=None)
    p.add_argument("--since", default=None)
    p.add_argument("--limit", type=int, default=50)

    p = add("action-items", "HEURISTIC: messages that look like commitments.")
    p.add_argument("--since", default=None)
    p.add_argument("--limit", type=int, default=50)

    p = add("standup", "HEURISTIC: bucket recent activity for standup.")
    p.add_argument("--hours", type=int, default=None)
    p.add_argument("--only-watched", action="store_true",
                   help="narrow to the config watch list instead of all conversations")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    as_json = bool(getattr(args, "json", False))

    if args.command == "commands":
        return emit_json("commands", COMMANDS)

    try:
        cfg = load_config(getattr(args, "config", None))
    except ConfigError as exc:
        return emit_failure("config", FAILURE_CONFIG_INVALID, str(exc),
                            hint="fix the YAML, or pass --config to point elsewhere",
                            as_json=as_json)

    if not args.command:
        return dashboard(cfg, as_json)

    handler = HANDLERS[args.command]
    warnings: list[str] = []
    writer = CorpusWriter(getattr(args, "save_dir", None),
                          enabled=not getattr(args, "no_save", False))
    try:
        with open_reader() as reader:
            _ACTIVE["reader"] = reader
            _ACTIVE["writer"] = writer
            data = handler(reader, cfg, args, warnings)
            if writer.written and not as_json:
                warn(f"saved {writer.written} messages to {writer.dir}")
            if as_json:
                return emit_json(args.command, data,
                                 heuristic=args.command in HEURISTIC_COMMANDS,
                                 warnings=warnings)
            return EXIT_OK
    except LookupError as exc:
        return emit_failure(args.command, FAILURE_NOT_FOUND, str(exc),
                            hint="run 'channels' to see what is cached",
                            as_json=as_json)
    except SystemExit as exc:
        if isinstance(exc.code, int):
            raise
        return emit_failure(args.command, FAILURE_STORE_NOT_FOUND, str(exc.code),
                            hint="is the new Teams (v2) app installed and signed in?",
                            as_json=as_json)


if __name__ == "__main__":
    sys.exit(main())
