"""
teams_reader.py — PROTOTYPE reader library for the local (new Teams v2) IndexedDB store.

THROWAWAY: validates the query design for a future skill. No error handling beyond
what makes it run. Reads YOUR already-synced local cache; zero network to Microsoft.

Databases used (all under origin https_teams.microsoft.com_0):
  Teams:replychain-manager        replychains          -> channel/reply messages (messageMap)
  Teams:conversation-manager      conversations        -> id -> name/type/last-activity
  Teams:messaging-slice-manager   mentions-metadata-items -> pointers to msgs @mentioning me
  Teams:profiles                  profiles             -> mri -> displayName/email (identity)
"""
from __future__ import annotations

import html
import re
import subprocess
import tempfile
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path

from ccl_chromium_reader.ccl_chromium_indexeddb import WrappedIndexDB

CONTAINER = Path.home() / "Library/Containers/com.microsoft.teams2"


# ---------------------------------------------------------------- store location
def find_leveldb() -> Path:
    hits = list(CONTAINER.glob(
        "**/https_teams.microsoft.com_0.indexeddb.leveldb"))
    if not hits:
        raise SystemExit("Teams IndexedDB store not found (is new Teams signed in?)")
    return max(hits, key=lambda p: sum(f.stat().st_size for f in p.glob("*")))


def snapshot(leveldb: Path) -> tuple[Path, Path | None, Path]:
    """Read-only cp -R of leveldb + sibling .blob into a temp dir. Returns (ldb, blob, tmp)."""
    tmp = Path(tempfile.mkdtemp(prefix="teams-reader-"))
    ldb = tmp / leveldb.name
    subprocess.run(["cp", "-R", str(leveldb), str(ldb)], check=True)
    blob_src = leveldb.parent / leveldb.name.replace(".leveldb", ".blob")
    blob = None
    if blob_src.is_dir():
        blob = tmp / blob_src.name
        subprocess.run(["cp", "-R", str(blob_src), str(blob)], check=True)
    return ldb, blob, tmp


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
            existing = out.get(cid)
            conv = Conversation(cid, v.get("type"), name, last,
                                len(members) if isinstance(members, list) else None)
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
        """Every message mentioning `ticket` (e.g. POS-4059), across all conversations, chronological."""
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

    def action_items(self, mri_self: str | None = None, since: datetime | None = None) -> list[dict]:
        """Messages that look like commitments. Flags to_me / from_me using @mention + creator."""
        out = []
        for m in self.iter_messages():
            if since and (not m.time or m.time < since):
                continue
            if not self._ACTION.search(m.content):
                continue
            to_me = bool(mri_self and mri_self in (m.content or "")) or "nathan" in m.content.lower()
            out.append({"time": m.time, "author": m.author, "from_me": m.from_me,
                        "to_me": to_me, "conversation_id": m.conversation_id,
                        "content": m.content})
        out.sort(key=lambda x: x["time"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return out

    # ---- CAP11: standup prep (feature 12) -------------------------------------
    def standup_prep(self, watch_ids: set[str], hours: int = 24) -> dict:
        """Bucket recent watched-channel activity into: my messages, questions to me, PRs/tickets."""
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        mine, questions, tickets = [], [], []
        tk = re.compile(r"\bPOS-\d+\b")
        for m in self.digest(watch_ids, hours=hours, limit=10000):
            if m.from_me:
                mine.append(m)
            if ("?" in m.content or self._ACTION.search(m.content)) and "nathan" in m.content.lower():
                questions.append(m)
            for t in tk.findall(m.content):
                tickets.append((t, m))
        # unique tickets, keep most recent mention
        seen, uniq = set(), []
        for t, m in tickets:
            if t not in seen:
                seen.add(t); uniq.append((t, m))
        return {"since": since, "mine": mine, "questions_to_me": questions, "tickets": uniq}

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
