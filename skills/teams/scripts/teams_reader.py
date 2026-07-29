"""
teams_reader.py — reader library for the local (new Teams v2) IndexedDB store.

Reads YOUR already-synced local cache; zero network to Microsoft.

Databases used (all under origin https_teams.microsoft.com_0):
  Teams:replychain-manager        replychains          -> channel/reply messages (messageMap)
  Teams:conversation-manager      conversations        -> id -> name/type/last-activity
  Teams:messaging-slice-manager   mentions-metadata-items -> pointers to msgs @mentioning me
  Teams:profiles                  profiles             -> mri -> displayName/email (identity)
"""
from __future__ import annotations

import contextlib
import html
import logging
import re
import subprocess
import tempfile
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path

from ccl_chromium_reader.ccl_chromium_indexeddb import WrappedIndexDB

CONTAINER = Path.home() / "Library/Containers/com.microsoft.teams2"

log = logging.getLogger("teams_reader")


# ---------------------------------------------------------------- store location
def find_leveldb() -> Path:
    hits = list(CONTAINER.glob(
        "**/https_teams.microsoft.com_0.indexeddb.leveldb"))
    if not hits:
        raise SystemExit("Teams IndexedDB store not found (is new Teams signed in?)")
    return max(hits, key=lambda p: sum(f.stat().st_size for f in p.glob("*")))


@contextlib.contextmanager
def snapshot(leveldb: Path):
    """Read-only cp -R of leveldb + sibling .blob into a temp dir.

    Yields ``(ldb, blob)`` and removes the temp copy on the way out — on the
    happy path, on exception, and on SIGINT alike.

    The cleanup lives here, in the library, rather than in a caller's
    ``finally``: the snapshot is a full plaintext copy of the user's chat
    history, so an early exit that skipped cleanup would orphan it on disk.
    No caller can opt out.

    ``tempfile.mkdtemp`` gives us 0o700 under the per-user TMPDIR, so the
    residual exposure is duration rather than readability.
    """
    tmp = Path(tempfile.mkdtemp(prefix="teams-reader-"))
    try:
        ldb = tmp / leveldb.name
        subprocess.run(["cp", "-R", str(leveldb), str(ldb)], check=True)
        blob_src = leveldb.parent / leveldb.name.replace(".leveldb", ".blob")
        blob = None
        if blob_src.is_dir():
            blob = tmp / blob_src.name
            subprocess.run(["cp", "-R", str(blob_src), str(blob)], check=True)
        yield ldb, blob
    finally:
        # Report rather than swallow: a failed unlink leaves chat data on disk,
        # which the user needs to know about.
        errors: list[str] = []
        shutil.rmtree(tmp, onerror=lambda _fn, path, exc: errors.append(f"{path}: {exc[1]}"))
        if errors or tmp.exists():
            log.error(
                "teams_reader: FAILED to remove snapshot at %s — it contains a "
                "plaintext copy of your chat history and should be deleted manually. %s",
                tmp,
                "; ".join(errors),
            )


@contextlib.contextmanager
def open_reader(leveldb: Path | None = None):
    """Snapshot the live store and yield a ready ``TeamsReader``.

    The single entry point callers should use: it guarantees both the snapshot
    cleanup and the reader close, so neither can be skipped.
    """
    with snapshot(leveldb or find_leveldb()) as (ldb, blob):
        reader = TeamsReader(ldb, blob)
        try:
            yield reader
        finally:
            reader.close()


# ---------------------------------------------------------------- value helpers
def undef(x):
    return None if x is None or type(x).__name__ == "Undefined" else x


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t]+")


def clean(raw) -> str:
    if not raw:
        return ""
    if isinstance(raw, (bytes, bytearray)):
        raw = bytes(raw).decode("utf-8", "replace")
    elif not isinstance(raw, str):
        raw = str(raw)
    raw = re.sub(r'<img[^>]*?(?:alt|title)="([^"]+)"[^>]*>', r"[\1]", raw)
    raw = re.sub(r"</p>|<br\s*/?>", "\n", raw, flags=re.I)
    txt = html.unescape(_TAG.sub("", raw))
    txt = _WS.sub(" ", txt)
    return "\n".join(l.strip() for l in txt.splitlines() if l.strip()).strip()


def ms_to_dt(v) -> datetime | None:
    v = undef(v)
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(v, (int, float)) and v > 1e12:
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc)
    return None


def msg_time(m: dict) -> datetime | None:
    for k in ("originalArrivalTime", "composeTime", "clientArrivalTime"):
        dt = ms_to_dt(m.get(k))
        if dt:
            return dt
    return None


# ---------------------------------------------------------------- data classes
@dataclass
class Message:
    time: datetime | None
    author: str
    from_me: bool
    conversation_id: str
    seq: int | None
    content: str
    message_id: str
    creator_mri: str | None = None   # stable identity (disambiguates same display name)


@dataclass
class Conversation:
    id: str
    type: str
    name: str | None
    last: datetime | None
    n_members: int | None = None
    # threadProperties.isRead inverted. None where Teams keeps no read flag at
    # all, which is the case for channel/topic threads.
    unread: bool | None = None


@dataclass
class SelfIdentity:
    """Who the store belongs to.

    ``confidence`` is one of:
      ``high``      auto-detected and cross-checked against the store's own
                    user GUID — safe to gate on.
      ``config``    supplied by the user via config; trusted as given.
      ``low``       a candidate exists but did not clear the margin. Never
                    used for gating; surfaced so the user can confirm it.
      ``unresolved`` nothing usable. Name-gating must be disabled, not guessed.
    """

    mri: str | None
    display_name: str | None
    confidence: str
    detail: str = ""
    candidate_mri: str | None = None

    @property
    def resolved(self) -> bool:
        return self.confidence in ("high", "config") and bool(self.mri)


# ---------------------------------------------------------------- the reader
class TeamsReader:
    def __init__(self, leveldb: Path, blob: Path | None):
        self.db = WrappedIndexDB(leveldb, blob)
        self._conv_cache: dict[str, Conversation] | None = None

    def close(self):
        self.db.close()

    def _find_db(self, sub: str):
        for did in self.db.database_ids:
            if did.name.startswith(f"Teams:{sub}:"):
                return self.db[did.dbid_no]
        return None

    @staticmethod
    def _skip_bad(k, d):  # bad_deserializer handler: swallow undecodable records
        return None

    # ---- self-identity ---------------------------------------------------------
    # Auto-accept thresholds. The modal self-sent creator is a safe signal for an
    # active single-tenant account, but it degrades badly for low-volume lurkers,
    # shared/delegated mailboxes, and guest/B2B stores holding several orgids. We
    # require both an absolute floor and a dominant share before trusting it.
    SELF_MIN_MESSAGES = 5
    SELF_MIN_SHARE = 0.6

    _GUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

    def store_user_guid(self) -> str | None:
        """The signed-in user's GUID, read from the IndexedDB database names.

        Teams names its databases
        ``Teams:<manager>:react-web-client:<clientId>:<userGuid>:<locale>``. The
        second GUID is the account the store belongs to, and it is the suffix of
        that account's MRI — which makes it an independent cross-check on the
        message-derived candidate.
        """
        counts: dict[str, int] = {}
        for did in self.db.database_ids:
            parts = (did.name or "").split(":")
            guids = [p for p in parts if self._GUID.fullmatch(p)]
            # parts: Teams, <manager>, react-web-client, <clientId>, <userGuid>, <locale>
            if len(guids) >= 2:
                counts[guids[-1].lower()] = counts.get(guids[-1].lower(), 0) + 1
        if not counts:
            return None
        return max(counts, key=counts.get)

    def self_identity(self, config_mri: str | None = None) -> SelfIdentity:
        """Resolve who this store belongs to, refusing to guess when unsure."""
        people = self.people()

        if config_mri:
            prof = people.get(config_mri) or {}
            return SelfIdentity(
                mri=config_mri,
                display_name=prof.get("displayName"),
                confidence="config",
                detail="supplied by config (self.mri)",
            )

        counts: dict[str, int] = {}
        for m in self.iter_messages():
            if m.from_me and m.creator_mri:
                counts[m.creator_mri] = counts.get(m.creator_mri, 0) + 1

        if not counts:
            return SelfIdentity(
                None, None, "unresolved",
                "no messages flagged isSentByCurrentUser; set self.mri in config",
            )

        total = sum(counts.values())
        candidate = max(counts, key=counts.get)
        n = counts[candidate]
        share = n / total
        prof = people.get(candidate) or {}
        display_name = prof.get("displayName")

        # Cross-check against the store's own user GUID. A mismatch means we
        # picked someone else's identity, which is always wrong — hard-stop
        # rather than proceeding with mis-attributed "to me" flags.
        store_guid = self.store_user_guid()
        if store_guid and store_guid not in candidate.lower():
            raise SystemExit(
                "teams_reader: self-identity cross-check FAILED.\n"
                f"  message-derived candidate: {candidate}\n"
                f"  store's own user GUID:     {store_guid}\n"
                "The candidate does not belong to the account this store was "
                "written for. Refusing to guess — set self.mri in your config."
            )

        if n < self.SELF_MIN_MESSAGES or share < self.SELF_MIN_SHARE or not display_name:
            reasons = []
            if n < self.SELF_MIN_MESSAGES:
                reasons.append(f"only {n} self-sent message(s), need {self.SELF_MIN_MESSAGES}")
            if share < self.SELF_MIN_SHARE:
                reasons.append(f"share {share:.0%} below {self.SELF_MIN_SHARE:.0%}")
            if not display_name:
                reasons.append("no profile display name resolved")
            return SelfIdentity(
                None, display_name, "low",
                "; ".join(reasons) + " — confirm this MRI or set self.mri in config",
                candidate_mri=candidate,
            )

        return SelfIdentity(
            candidate, display_name, "high",
            f"{n}/{total} self-sent messages ({share:.0%}), cross-checked against store user GUID",
            candidate_mri=candidate,
        )

    # ---- conversations (id -> name/type) --------------------------------------
    def conversations(self) -> dict[str, Conversation]:
        if self._conv_cache is not None:
            return self._conv_cache
        out: dict[str, Conversation] = {}
        store = self._find_db("conversation-manager")["conversations"]
        for rec in store.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            cid = v.get("id")
            if not cid:
                continue
            tp = v.get("threadProperties") if isinstance(v.get("threadProperties"), dict) else {}
            ct = v.get("chatTitle")
            space, topic = undef(tp.get("spaceThreadTopic")), undef(tp.get("topic"))
            if space and topic:
                name = f"{space} / {topic}"
            elif topic:
                name = topic
            elif isinstance(ct, dict):
                name = undef(ct.get("longTitle")) or undef(ct.get("shortTitle"))
            elif isinstance(ct, str):
                name = ct
            else:
                name = None
            last = None
            for k in ("lastMessageTimeUtc", "nonFilteredLastMessageTimeUtc", "clientUpdateTime"):
                last = ms_to_dt(v.get(k))
                if last:
                    break
            members = v.get("members")
            is_read = undef(tp.get("isRead"))
            existing = out.get(cid)
            conv = Conversation(cid, v.get("type"), name, last,
                                len(members) if isinstance(members, list) else None,
                                unread=(not is_read) if isinstance(is_read, bool) else None)
            # keep the record with the newest last-activity (dedupe LevelDB versions)
            if not existing or (conv.last and (not existing.last or conv.last > existing.last)):
                out[cid] = conv
        self._conv_cache = out
        return out

    def resolve_channels(self, names: list[str]) -> dict[str, list[Conversation]]:
        """Fuzzy-match config names -> conversations. Case-insensitive substring."""
        convs = [c for c in self.conversations().values() if c.name]
        result: dict[str, list[Conversation]] = {}
        for want in names:
            wl = want.lower()
            matches = [c for c in convs if wl in c.name.lower()]
            # collapse duplicate ids
            seen, uniq = set(), []
            for c in sorted(matches, key=lambda c: c.last or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
                if c.id not in seen:
                    seen.add(c.id); uniq.append(c)
            result[want] = uniq
        return result

    # ---- messages (the core) --------------------------------------------------
    def iter_messages(self, conversation_ids: set[str] | None = None):
        """Yield Message objects from replychains, optionally filtered to conversation_ids.

        message_id is the SERVER id (m['id']) so mentions (whose sourceMessageId is a
        server id) can join against it. Dedupe still uses clientMessageId when present.
        """
        store = self._find_db("replychain-manager")["replychains"]
        seen: set[str] = set()
        for rec in store.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            cid = v.get("conversationId")
            if conversation_ids is not None and cid not in conversation_ids:
                continue
            mm = v.get("messageMap")
            if not isinstance(mm, dict):
                continue
            for mid, m in mm.items():
                if not isinstance(m, dict) or m.get("type") != "Message":
                    continue
                mtype = (m.get("messageType") or "").lower()
                if mtype and mtype not in ("text", "richtext/html", "richtext"):
                    continue
                content = clean(m.get("content"))
                if not content or (content.startswith("{") and not m.get("imDisplayName")):
                    continue
                server_id = str(undef(m.get("id")) or mid)
                dedupe = str(undef(m.get("clientMessageId")) or server_id)
                if dedupe in seen:
                    continue
                seen.add(dedupe)
                yield Message(
                    time=msg_time(m),
                    author=undef(m.get("imDisplayName")) or "(unknown)",
                    from_me=bool(m.get("isSentByCurrentUser")),
                    conversation_id=cid,
                    seq=undef(m.get("sequenceId")),
                    content=content,
                    message_id=server_id,
                    creator_mri=undef(m.get("creator")),
                )

    # ---- CAP 1: digest --------------------------------------------------------
    def digest(self, conversation_ids: set[str] | None, hours: int, limit: int) -> list[Message]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        msgs = [m for m in self.iter_messages(conversation_ids) if m.time and m.time >= cutoff]
        msgs.sort(key=lambda m: m.time, reverse=True)
        return msgs[:limit]

    # ---- CAP 2: search --------------------------------------------------------
    def search(self, query: str, limit: int = 50) -> list[Message]:
        ql = query.lower()
        hits = [m for m in self.iter_messages() if ql in m.content.lower() or ql in m.author.lower()]
        hits.sort(key=lambda m: m.time or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return hits[:limit]

    # ---- CAP 3: mentions ------------------------------------------------------
    def mentions(self, unread_only: bool = False, limit: int = 50) -> list[dict]:
        msm = self._find_db("messaging-slice-manager")
        store = next(msm[s] for s in msm.object_store_names if s == "mentions-metadata-items")
        pointers = {}
        for rec in store.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            sm = v.get("sourceMessageId")
            if not sm:
                continue
            # keep newest version per message (isRead may flip false->true)
            prev = pointers.get(sm)
            if not prev or str(v.get("version", "")) > str(prev.get("version", "")):
                pointers[sm] = v
        # join to message text
        by_id = {m.message_id: m for m in self.iter_messages()}
        out = []
        for sm, p in pointers.items():
            if unread_only and p.get("isRead"):
                continue
            msg = by_id.get(str(sm))
            out.append({
                "time": ms_to_dt(p.get("timestamp")),
                "is_read": bool(p.get("isRead")),
                "conversation_id": p.get("sourceThreadId"),
                "content": msg.content if msg else "(message text not in cache)",
                "author": msg.author if msg else "?",
            })
        out.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out[:limit]

    # ---- CAP 4: thread reconstruction ----------------------------------------
    def thread(self, conversation_id: str, contains: str | None = None) -> list[Message]:
        """Rebuild the reply chain(s) for a conversation, ordered by sequenceId."""
        store = self._find_db("replychain-manager")["replychains"]
        msgs: list[Message] = []
        for rec in store.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict) or v.get("conversationId") != conversation_id:
                continue
            mm = v.get("messageMap")
            if not isinstance(mm, dict):
                continue
            chain = []
            for mid, m in mm.items():
                if not isinstance(m, dict) or m.get("type") != "Message":
                    continue
                content = clean(m.get("content"))
                if not content:
                    continue
                chain.append(Message(
                    time=msg_time(m), author=undef(m.get("imDisplayName")) or "(unknown)",
                    from_me=bool(m.get("isSentByCurrentUser")), conversation_id=conversation_id,
                    seq=undef(m.get("sequenceId")), content=content,
                    message_id=str(m.get("id") or mid)))
            if contains and not any(contains.lower() in c.content.lower() for c in chain):
                continue
            msgs.extend(chain)
        msgs.sort(key=lambda m: m.seq or 0)
        return msgs

    # ---- CAP5: historical channel search (feature 1) --------------------------
    def history(self, conversation_id: str, since: datetime | None = None,
                until: datetime | None = None, query: str | None = None) -> list[Message]:
        """Full history of ONE conversation, date-bounded + optional keyword. Chronological."""
        ql = query.lower() if query else None
        out = []
        for m in self.iter_messages({conversation_id}):
            if since and (not m.time or m.time < since):
                continue
            if until and (not m.time or m.time > until):
                continue
            if ql and ql not in m.content.lower() and ql not in m.author.lower():
                continue
            out.append(m)
        out.sort(key=lambda m: (m.time or datetime.min.replace(tzinfo=timezone.utc), m.seq or 0))
        return out

    # ---- CAP6: ticket timeline across all channels (feature 3) ----------------
    def ticket_timeline(self, ticket: str) -> list[Message]:
        """Every message mentioning `ticket` (e.g. PROJ-1234), across all conversations, chronological."""
        tl = ticket.lower()
        out = [m for m in self.iter_messages() if tl in m.content.lower()]
        out.sort(key=lambda m: m.time or datetime.min.replace(tzinfo=timezone.utc))
        return out

    # ---- CAP7: link extractor (feature 5) -------------------------------------
    _URL = re.compile(r"https?://[^\s\"'<>)\]]+")

    def links(self, conversation_id: str | None = None, since: datetime | None = None) -> list[dict]:
        """Dedup'd URLs shared in a channel (or everywhere), with who/when/context."""
        seen, out = set(), []
        it = self.iter_messages({conversation_id} if conversation_id else None)
        for m in it:
            if since and (not m.time or m.time < since):
                continue
            for url in self._URL.findall(m.content):
                url = url.rstrip(".,;")
                if url in seen:
                    continue
                seen.add(url)
                out.append({"url": url, "author": m.author, "time": m.time,
                            "conversation_id": m.conversation_id,
                            "context": m.content[:120]})
        out.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ---- CAP8: code-snippet miner (feature 6) ---------------------------------
    def code_snippets(self, conversation_id: str | None = None) -> list[dict]:
        """Messages that contained <code>/<pre> blocks. We re-fetch raw HTML to keep the code."""
        store = self._find_db("replychain-manager")["replychains"]
        out = []
        want = {conversation_id} if conversation_id else None
        for rec in store.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            if want is not None and v.get("conversationId") not in want:
                continue
            mm = v.get("messageMap")
            if not isinstance(mm, dict):
                continue
            for mid, m in mm.items():
                if not isinstance(m, dict) or m.get("type") != "Message":
                    continue
                raw = m.get("content")
                raw = bytes(raw).decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else (raw or "")
                blocks = re.findall(r"<(?:code|pre)[^>]*>(.*?)</(?:code|pre)>", raw, re.S | re.I)
                if not blocks:
                    continue
                out.append({"author": undef(m.get("imDisplayName")),
                            "time": msg_time(m),
                            "snippets": [clean(b) for b in blocks]})
        out.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ---- CAP9: decision extractor (feature 10) --------------------------------
    _DECISION = re.compile(
        r"\b(we (?:decided|agreed|will go with|should)|let'?s (?:go with|do)|"
        r"final(?:ised|ized)?|the plan is|conclusion|going with|agreed to)\b", re.I)

    def decisions(self, conversation_id: str | None = None, since: datetime | None = None) -> list[Message]:
        """Messages that look like decisions.

        HEURISTIC: a regex grep over message text, not a summarizer. Expect
        false positives.
        """
        out = []
        for m in self.iter_messages({conversation_id} if conversation_id else None):
            if since and (not m.time or m.time < since):
                continue
            if self._DECISION.search(m.content):
                out.append(m)
        out.sort(key=lambda m: m.time or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ---- CAP10: action-item detector (feature 11) -----------------------------
    _ACTION = re.compile(
        r"\b(can you|could you|please|pls|will you|need you to|"
        r"assigned to|todo|to-do|action item|follow up|by (?:eod|tomorrow|friday|monday))\b", re.I)

    def _name_gate(self, identity: SelfIdentity | None,
                   name_gate: list[str] | None) -> list[str]:
        """Lowercased substrings that mean "this message is addressed to me".

        Derived from the resolved identity (its MRI and display name, plus the
        first name people actually type), and extended by any config-supplied
        aliases. Returns empty when identity is unresolved and no config gate is
        given — callers must then skip "to me" detection rather than guess.
        """
        gate: list[str] = []
        if identity and identity.resolved:
            if identity.mri:
                gate.append(identity.mri.lower())
            if identity.display_name:
                full = identity.display_name.lower()
                gate.append(full)
                first = full.split()[0] if full.split() else ""
                # A one- or two-character first name would match far too much.
                if len(first) >= 3:
                    gate.append(first)
        gate.extend(g.lower() for g in (name_gate or []) if g)
        return list(dict.fromkeys(gate))

    def action_items(self, identity: SelfIdentity | None = None,
                     name_gate: list[str] | None = None,
                     since: datetime | None = None) -> list[dict]:
        """Messages that look like commitments. Flags to_me / from_me.

        HEURISTIC: a regex grep over message text, not a summarizer. Expect
        false positives.
        """
        gate = self._name_gate(identity, name_gate)
        out = []
        for m in self.iter_messages():
            if since and (not m.time or m.time < since):
                continue
            if not self._ACTION.search(m.content):
                continue
            lowered = m.content.lower()
            to_me = any(g in lowered for g in gate) if gate else False
            out.append({"time": m.time, "author": m.author, "from_me": m.from_me,
                        "to_me": to_me, "conversation_id": m.conversation_id,
                        "content": m.content})
        out.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ---- CAP11: standup prep (feature 12) -------------------------------------
    # Generic Jira-style key. Trackers with another shape (GitHub #1234,
    # numeric-only ids) need a ticket_pattern override in config.
    DEFAULT_TICKET_PATTERN = r"\b[A-Z][A-Z0-9]+-\d+\b"

    def standup_prep(self, watch_ids: set[str], hours: int = 24,
                     ticket_pattern: str | None = None,
                     identity: SelfIdentity | None = None,
                     name_gate: list[str] | None = None) -> dict:
        """Bucket recent watched-channel activity into: my messages, questions to me, tickets.

        HEURISTIC: regex extraction over message text, not a summarizer. Expect
        false positives.
        """
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        mine, questions, tickets = [], [], []
        tk = re.compile(ticket_pattern or self.DEFAULT_TICKET_PATTERN)
        gate = self._name_gate(identity, name_gate)
        for m in self.digest(watch_ids, hours=hours, limit=10000):
            if m.from_me:
                mine.append(m)
            lowered = m.content.lower()
            addressed = any(g in lowered for g in gate) if gate else False
            if addressed and ("?" in m.content or self._ACTION.search(m.content)):
                questions.append(m)
            for t in tk.findall(m.content):
                tickets.append((t, m))
        # unique tickets, keep most recent mention
        seen, uniq = set(), []
        for t, m in tickets:
            if t not in seen:
                seen.add(t); uniq.append((t, m))
        return {"since": since, "mine": mine, "questions_to_me": questions, "tickets": uniq}

    # ---- CAP14: unread catch-up ----------------------------------------------
    def unread(self, limit: int = 50) -> dict:
        """What is waiting for you, from the read-state the store actually keeps.

        NOT a message-level unread list. A spike against the real store found no
        per-message read horizon: ``oldConsumptionHorizonKeys`` is always empty,
        and there is no ``lastReadMessageId``. What exists is:

        * ``activity-manager/feed-items`` — the activity feed (mentions,
          reactions, meeting changes), each with ``isRead`` and a pointer to its
          source message. This is the useful signal.
        * ``threadProperties.isRead`` — a single bool per conversation, present
          on chats and meetings but absent on channel/topic threads.

        So this returns unread *activities* and unread *conversations*, which is
        what "unread" can honestly mean here.
        """
        by_id = {m.message_id: m for m in self.iter_messages()}
        convs = self.conversations()

        activities = []
        am = self._find_db("activity-manager")
        if am is not None:
            newest: dict[str, dict] = {}
            for rec in am["feed-items"].iterate_records(
                    live_only=True, bad_deserializer_data_handler=self._skip_bad):
                v = rec.value
                if not isinstance(v, dict) or not v.get("activityId"):
                    continue
                # isRead flips false->true in place; keep the newest version.
                prev = newest.get(v["activityId"])
                if not prev or str(v.get("version", "")) > str(prev.get("version", "")):
                    newest[v["activityId"]] = v
            for v in newest.values():
                if v.get("isRead"):
                    continue
                msg = by_id.get(str(undef(v.get("sourceMessageId")) or ""))
                conv = convs.get(undef(v.get("sourceThreadId")))
                activities.append({
                    "activity_type": undef(v.get("activityType")),
                    "activity_subtype": undef(v.get("activitySubtype")),
                    "time": ms_to_dt(v.get("timestamp")),
                    "conversation_id": undef(v.get("sourceThreadId")),
                    "conversation_name": conv.name if conv else None,
                    "author": msg.author if msg else None,
                    "content": msg.content if msg else None,
                })
            activities.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc),
                            reverse=True)

        conversations = []
        for conv in convs.values():
            if conv.unread is True:
                conversations.append({
                    "conversation_id": conv.id, "name": conv.name,
                    "type": conv.type, "last": conv.last,
                })
        conversations.sort(key=lambda x: x["last"] or datetime.min.replace(tzinfo=timezone.utc),
                           reverse=True)

        return {
            "activities": activities[:limit],
            "conversations": conversations[:limit],
            "note": (
                "The Teams cache keeps no per-message read horizon. 'Unread' here "
                "means unread activity-feed items (mentions, reactions, meeting "
                "changes) and conversations flagged unread. Channel/topic threads "
                "carry no read flag at all."
            ),
        }

    # ---- CAP15: reaction summary ----------------------------------------------
    def reactions(self, conversation_id: str | None = None,
                  since: datetime | None = None, limit: int = 25) -> dict:
        """Aggregate emoji reactions and surface the most-reacted messages.

        Reactions live inline on the messages we already traverse, at
        ``properties.emotions``: ``[{key, users: [{mri, time}]}]``.

        Emoji counts only — no sentiment inference is attempted.
        """
        store = self._find_db("replychain-manager")["replychains"]
        want = {conversation_id} if conversation_id else None
        convs = self.conversations()
        people = self.people()

        totals: dict[str, int] = {}
        by_reactor: dict[str, int] = {}
        messages: dict[str, dict] = {}

        for rec in store.iterate_records(live_only=True,
                                         bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            cid = v.get("conversationId")
            if want is not None and cid not in want:
                continue
            mm = v.get("messageMap")
            if not isinstance(mm, dict):
                continue
            for mid, m in mm.items():
                if not isinstance(m, dict):
                    continue
                props = m.get("properties")
                if not isinstance(props, dict):
                    continue
                emotions = undef(props.get("emotions"))
                if not isinstance(emotions, list) or not emotions:
                    continue
                when = msg_time(m)
                if since and (not when or when < since):
                    continue

                per_message: dict[str, int] = {}
                total = 0
                for emotion in emotions:
                    if not isinstance(emotion, dict):
                        continue
                    key = undef(emotion.get("key"))
                    users = undef(emotion.get("users")) or []
                    if not key or not isinstance(users, list) or not users:
                        continue
                    per_message[key] = per_message.get(key, 0) + len(users)
                    totals[key] = totals.get(key, 0) + len(users)
                    total += len(users)
                    for user in users:
                        if isinstance(user, dict):
                            mri = undef(user.get("mri"))
                            if mri:
                                by_reactor[mri] = by_reactor.get(mri, 0) + 1
                if not total:
                    continue

                # Dedupe LevelDB record versions: keep the richest reaction set.
                key_id = str(undef(m.get("id")) or mid)
                prev = messages.get(key_id)
                if prev and prev["total_reactions"] >= total:
                    continue
                conv = convs.get(cid)
                messages[key_id] = {
                    "time": when,
                    "author": undef(m.get("imDisplayName")) or "(unknown)",
                    "conversation_id": cid,
                    "conversation_name": conv.name if conv else None,
                    "content": clean(m.get("content")),
                    "reactions": per_message,
                    "total_reactions": total,
                }

        top = sorted(messages.values(), key=lambda x: -x["total_reactions"])[:limit]
        top_reactors = [
            {"mri": mri, "display_name": (people.get(mri) or {}).get("displayName"),
             "count": n}
            for mri, n in sorted(by_reactor.items(), key=lambda kv: -kv[1])[:10]
        ]
        return {
            "messages_with_reactions": len(messages),
            "by_emoji": dict(sorted(totals.items(), key=lambda kv: -kv[1])),
            "top_reactors": top_reactors,
            "most_reacted": top,
        }

    # ---- CAP12: people directory (feature 16) ---------------------------------
    def people(self) -> dict[str, dict]:
        """mri -> {displayName, email, office, phone, title}. Also keyed by lowercase name."""
        prof = self._find_db("profiles")["profiles"]
        by_mri = {}
        for rec in prof.iterate_records(live_only=True, bad_deserializer_data_handler=self._skip_bad):
            v = rec.value
            if not isinstance(v, dict):
                continue
            name = undef(v.get("displayName"))
            mri = undef(v.get("mri"))
            if not name:
                continue
            rec_out = {"displayName": name, "mri": mri,
                       "email": undef(v.get("email")) or undef(v.get("mail")),
                       "office": undef(v.get("physicalDeliveryOfficeName")),
                       "phone": undef(v.get("telephoneNumber")),
                       "title": undef(v.get("jobTitle"))}
            if mri:
                by_mri[mri] = rec_out
        return by_mri

    def whois(self, query: str) -> list[dict]:
        ql = query.lower()
        return [p for p in self.people().values()
                if (p["displayName"] and ql in p["displayName"].lower())
                or (p["email"] and ql in p["email"].lower())]

    # ---- CAP13: two-Nathans disambiguation (feature 18) -----------------------
    def disambiguate(self, display_name: str) -> dict[str, dict]:
        """Given a display name, return every distinct MRI using it + identity from profiles.
        Solves the Vale-vs-Liu problem: attribute messages by creator_mri, not name."""
        ppl = self.people()
        # profiles keyed by name
        by_name_mris = {}
        for mri, p in ppl.items():
            if p["displayName"] and display_name.lower() in p["displayName"].lower():
                by_name_mris[mri] = p
        # also scan messages for creator MRIs actually used under this display name
        used = {}
        for m in self.iter_messages():
            if m.creator_mri and display_name.lower() in (m.author or "").lower():
                used.setdefault(m.creator_mri, {"count": 0, "sample": None})
                used[m.creator_mri]["count"] += 1
                if not used[m.creator_mri]["sample"]:
                    used[m.creator_mri]["sample"] = m.content[:60]
        out = {}
        for mri in set(by_name_mris) | set(used):
            out[mri] = {**(by_name_mris.get(mri) or {"mri": mri}),
                        "msg_count": used.get(mri, {}).get("count", 0),
                        "sample": used.get(mri, {}).get("sample")}
        return out
