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

## Choosing a Command

Discover the command surface instead of guessing from this file:

```bash
skills/teams/.venv/bin/python skills/teams/scripts/teams_cli.py commands --json
```

Common routes:

| Ask | Command |
|-----|---------|
| what happened recently | `digest [--hours N]` |
| find a message | `search "<text>"` |
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

## Configuration

Optional. Copy `teams-reader.example.yaml` to `teams-reader.yaml` (gitignored)
to set a watch list, a ticket pattern for your tracker, and lookback defaults.
Without it, everything still works over all cached conversations.

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
