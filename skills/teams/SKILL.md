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
indexed as the `teams` QMD collection. **For anything semantic, query QMD** —
it does BM25 + vector + reranking. The CLI's `search` is a substring match and
should only be used for exact strings (an id, a URL, a specific error).

```bash
qmd query "who raised concerns about the deploy" -c teams
qmd query "bulk print decisions" -c teams -c repo-pos-yellow   # chat + project docs
```

Scope with `-c teams` for "what did someone say". Repeat the flag to widen;
comma-separated names do **not** work. Leave it off only for genuine
cross-source questions — the collection is ~9,000 short chat messages and will
otherwise outweigh curated docs on general queries.

Frontmatter carries `from_mri`, `conversation`, `sent_at` and `direction`, so
retrieved notes can be filtered or attributed without re-reading the store.

`sync` re-indexes automatically after writing. If notes seem missing from
search results, run it — or `cd ~/.local/share/teams && qmd update && qmd embed`.

## Choosing a Command

Discover the command surface instead of guessing from this file:

```bash
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py commands --json
```

Common routes:

| Ask | Command |
|-----|---------|
| what happened recently | `digest [--hours N]` |
| find a message by meaning | **`qmd query "..." -c teams`** (see above) |
| find an exact string | `search "<text>"` |
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
