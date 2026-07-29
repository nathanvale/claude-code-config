---
name: teams
description: "Read your own local Microsoft Teams cache: what was said in a channel, who mentioned you, unread items, a ticket's discussion timeline, links or code someone shared, who a person is, or which of two same-named people said something. Triggers include \"what did X say in Teams\", \"Teams digest\", \"who mentioned me\", \"catch me up on the channel\", \"find that Teams message\", \"what was discussed about TICKET-123\". macOS only, read-only, no network to Microsoft."
---

# Teams Local Reader

Queries the new Teams (v2) IndexedDB cache already on this Mac. Read-only:
no Graph API, no app registration, no network to Microsoft.

## First Safe Action

Run the CLI with no arguments — it prints a dashboard of what is cached and
which command to use next.

```bash
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py
```

If `.venv` does not exist, run `skills/teams/scripts/bootstrap.sh` first
(one-time; needs network + git + Xcode command line tools).

## Searching: use QMD, not `search`

Every message read is saved as a markdown note in `~/.local/share/teams/` and
also indexed as the `teams` QMD collection. There are **three retrieval engines**;
pick by the shape of the question, not by habit.

### Retrieval router

| You want… | Use | Why |
|---|---|---|
| An exact string, ticket key, or **recent** message (last days/weeks) | `search "<text>"` / `ticket <KEY>` / `digest [--hours N]` | Direct **live-cache** read. Fast enough (~sub-second to a few seconds) and catches fresh messages not yet in the corpus. |
| Keyword recall on recent chat, scoped by date or person | `search "<kw>" --since YYYY-MM-DD [--until …] [--from NAME\|MRI]` | Live-cache substring with frontmatter-equivalent filters (`m.time`, author, `creator_mri`). The default for scoped **recent** keyword lookups. |
| **Fast** keyword recall over **months** of history | `qmd search "<kw>" -c teams` | BM25 over the durable corpus. **Sub-second**, and retains messages the live cache has already aged out. Fastest historical path. |
| A **meaning-based** question over months — paraphrases, "who worried about X" | `qmd query "<question>" -c teams` | Vector + rerank. The **only** engine that finds paraphrases, but **10s–160s** per call. Deep one-shot recall only. |

**Fast path wins — route by speed, then reach for semantics only when you must.**
Measured on this corpus (formal A/B, 2026-07-29):

- **Direct CLI** (`search`/`digest`/`ticket`) — reads the **live cache**, ~sub-second
  to a few seconds. Catches fresh and not-yet-corpused messages. Can miss history that
  has aged out of the cache. **Default for anything recent.**
- **`qmd search` (BM25)** — reads the **durable corpus**, **~0.5s**. Retains aged-out
  history the live cache dropped, and is ~10× faster than the direct CLI for old
  keyword lookups. **Use it for fast historical keyword recall.** (This is a real niche:
  it beats the CLI on old messages and beats `qmd query` on speed.)
- **`qmd query` (vector+rerank)** — **10s–160s**, wildly variable. The only engine that
  recalls paraphrases with no shared keyword. **Never wire into a sync/batch path** —
  reserve for deep, one-shot "find where someone said X" questions where waiting is fine.

Rule of thumb: try the **fast** path first (direct CLI for recent, `qmd search` for old),
and escalate to `qmd query` only when a keyword search comes back empty and the question
is genuinely about meaning, not words.

**`qmd query` returns references, not attribution — always resolve before quoting.**
A hit gives you the message's file path (`qmd://teams/YYYY/MM/…​.md:NN`), the date
(in the path), a text snippet, and a score — but **not** the author, `from_mri`,
`conversation`, or exact timestamp. Those live in the note's frontmatter. Before you
attribute or ledger a semantic hit, run `qmd get "<path>"` on it and read the
frontmatter (`from`, `from_mri`, `conversation`, `sent_at`, `direction`). This
two-step is what keeps QMD recall attribution-safe when a display name is shared —
never quote a `qmd query` snippet's implied speaker without the `qmd get` resolve.

```bash
# semantic recall over the whole corpus
qmd query "who raised concerns about the deploy" -c teams
qmd query "bulk print decisions" -c teams -c repo-pos-yellow   # chat + project docs

# scoped keyword recall — fast, deterministic
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py \
  search "deploy" --since 2026-07-20 --from "Sonny" --json
```

Scope QMD with `-c teams` for "what did someone say". Repeat the flag to widen;
comma-separated names do **not** work. Leave it off only for genuine
cross-source questions — the collection is ~9,000 short chat messages and will
otherwise outweigh curated docs on general queries.

Note frontmatter carries `from_mri`, `conversation`, `sent_at` and `direction`,
so retrieved notes can be filtered or attributed without re-reading the store.

`sync` refreshes the **BM25 index only** after writing (fast) — so `qmd search -c
teams` is live immediately, but **vector embeddings are deferred**. Run vectors as a
separate, slow step at the end of a batch: `teams embed` (or `sync --embed` to do both
at once, or `cd ~/.local/share/teams && qmd embed` by hand). This is deliberate: a
freshly-synced corpus is keyword-searchable at once, and the expensive embed never
blocks the sync. Until `embed` runs, `qmd query` (vector) may miss the newest messages
while `qmd search` (BM25) already has them.

(The collection is registered as `teams` → `~/.local/share/teams`; if `qmd query
-c teams` ever returns nothing, confirm with `qmd collection show teams` that its
path is the corpus root and not a phantom subdirectory.)

## Choosing a Command

Discover the command surface instead of guessing from this file:

```bash
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py commands --json
```

Common routes:

| Ask | Command |
|-----|---------|
| what happened recently | `digest [--hours N]` |
| find an exact string (recent) | `search "<text>"` |
| keyword recall on recent chat, scoped | `search "<kw>" --since YYYY-MM-DD [--from NAME\|MRI]` |
| fast keyword recall over months | `qmd search "<kw>" -c teams` (durable corpus, ~0.5s) |
| find a message by meaning over months | `qmd query "..." -c teams` (slow, 10-160s; see router above) |
| backfill + reindex the corpus | `sync` |
| who pinged me | `mentions [--unread]` |
| what is waiting | `unread` |
| everything about a ticket | `ticket <KEY>` |
| one channel over a date range | `history "<channel>" --since YYYY-MM-DD` |
| rebuild a conversation | `thread "<keyword>"` |
| links / code someone shared | `links`, `code` |
| who is this person | `whois "<name>"`, `people` |
| two people, same name | `disambiguate "<name>"` |
| what got reacted to | `reactions` |

Add `--json` to any command for a structured envelope. Diagnostics go to
stderr, so `--json` stdout stays parseable.

## Gotchas That Change Results

- **Freshness.** The newest messages are not in the cache until Teams flushes
  its LevelDB memtable. Keep Teams running for a current cache. A missing
  recent message is usually lag, not absence.
- **Attribution.** Two people can share a display name. Attribute by
  `creator_mri`, not by `author`, and run `disambiguate` when it matters.
- **Unread is not per-message.** This cache keeps no per-message read horizon.
  `unread` reports unread *activity-feed items* and *conversations*; channel
  threads carry no read flag at all.
- **`decisions`, `action-items` and `standup` are regex heuristics**, not
  summarizers. They are flagged `heuristic: true` in JSON and carry a caveat in
  text. Treat their output as candidates to check, never as findings.

## The Corpus

Reading is saving. Every command that returns messages writes them as notes:

- corpus: `~/.local/share/teams/YYYY/MM/*.md` (`$XDG_DATA_HOME`), dirs `0700`,
  files `0600` — this is corporate chat, so it never goes in a repo or in
  `~/Documents` (which may be iCloud-synced)
- cursor: `~/.local/state/teams/cursor.json` (`$XDG_STATE_HOME`)

`--no-save` opts a command out; `--save-dir` relocates. The corpus is
rebuildable from the Teams cache at any time with `sync --full`.

## Configuration

Optional. Copy `teams-reader.example.yaml` to
`$XDG_CONFIG_HOME/teams/teams-reader.yaml` (default `~/.config/teams/`) to set a
watch list, a ticket pattern for your tracker, and lookback defaults. An
in-skill `teams-reader.yaml` (gitignored) still works as a legacy fallback.
Without any config, everything still works over all cached conversations.

Identity is auto-detected and cross-checked against the store; set `self.mri`
only if `whoami` reports low confidence.

## Owner Anchors

- Command contract, flags, JSON envelope: `scripts/teams_cli.py commands --json`.
- Prerequisites, store layout, troubleshooting: `references/operations.md`.
- Config keys: `teams-reader.example.yaml`.

## Verification

```bash
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py doctor --json
skills/teams/.venv/bin/python -m pytest skills/teams/scripts/teams_reader_test.py -q
```
