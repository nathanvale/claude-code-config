---
name: productivity-sync
description: Sync tasks and refresh memory from calendar, email, meeting notes, project trackers, and GitHub. Reads .productivity.yml for connector config. Surfaces drift between external sources and TASKS.md (open PRs, merged PRs, awaiting-review), writes back action items extracted from meetings to TASKS.md / memory / people notes, and produces a pre-meeting brief for the next 24h of calendar events. Use --deep for comprehensive scan of chat, sent email, and docs.
argument-hint: "[--deep] [--full]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
  - mcp__plugin_imessage_imessage__sync_archive
  - mcp__plugin_imessage_imessage__search_messages
  - mcp__plugin_imessage_imessage__list_contacts
  - mcp__plugin_imessage_imessage__list_threads
  - mcp__plugin_imessage_imessage__reply
---

# Productivity Sync

Keep your task list and memory current. Two modes:

- **Default:** Sync from calendar, email, meeting notes, and project trackers (per `.productivity.yml`), triage stale items, decode tasks, fill memory gaps
- **`--deep`:** Everything in default, plus deep scan of chat, sent email, docs -- flag missed todos and suggest new memories

Reference the **productivity-connectors** skill for available MCP tool names. If a source is unavailable, skip it gracefully.

## Read Order

1. `~/.config/memory/docs/memory-os-contract.md`
2. `~/.config/memory/docs/productivity-integration.md`

## Prerequisites

Read `.productivity.yml` in the project root. If it doesn't exist, tell the user:
```
No .productivity.yml found. Run /productivity-setup first to configure connectors for this project.
```

## Usage

```
/productivity-sync           # delta sync (since cursor)
/productivity-sync --deep    # delta sync + chat / sent email / docs scan
/productivity-sync --full    # ignore cursor, wide-window sync (recovery / first run)
```

## Pre-flight (30s connector check)

Before any sync work, probe each declared connector and surface the result in **one terse table** so the user sees coverage upfront — not buried in the final report.

For each connector in `.productivity.yml`:

| Connector value | Probe (cheap, <1s each) |
|---|---|
| `microsoft-365` (calendar/email) | Confirm an `mcp__*` Microsoft Graph tool is loaded; if not → ❌ |
| `google-calendar` / `gmail` | Confirm `gcal_*` / `gmail_*` MCP tool is loaded; if not → ❌ |
| `gog` | `which gog >/dev/null` AND `<connector>-account` set in `.productivity.yml` → ❌ if either fails |
| `jira` | Confirm `mcp__*jira*search*` tool is loaded; if not → ❌ |
| `notion` / `confluence` | Confirm `mcp__*notion*` / `mcp__*confluence*` tool is loaded; if not → ❌ |
| `slack` | Confirm `mcp__*slack*` tool is loaded; if not → ❌ |
| `teams` (via notion-search) | Same probe as `notion`; if missing → ❌ |
| `imessage` | Confirm `mcp__*imessage*sync_archive` OR `~/.claude/skills/imessage-reader/scripts/query-imessage.ts` exists; if neither → ❌ |
| `github` | `gh auth status` exits 0; if not → ❌ |
| `none` | Skip silently — not an error |

Do **not** make a real API call here. Tool-presence + auth-presence only. The full availability check still happens per-step (per productivity-connectors skill).

**Output — one compact table before any sync begins:**

```
Pre-flight (2026-05-11 13:15):
  ✅ project-tracker (jira)
  ✅ knowledge-base (notion)
  ✅ github (gh authed as nathanvale-bunnings)
  ❌ calendar (microsoft-365) — no Graph MCP tool loaded; skipping
  ❌ email (microsoft-365) — no Graph MCP tool loaded; skipping
  ⚠️  chat (teams via notion-search) — usable; deferred unless --deep

Proceeding with 3 of 6 declared connectors. Continue? [Y/n]
```

**Rules:**

- If **≥1 connector is ❌**, pause and ask the user before proceeding (single y/n prompt). Reason: silent partial syncs hide drift — the user should consciously accept reduced coverage.
- If **all declared connectors are ✅**, print the table and continue without prompting.
- If `--full` was passed, still run pre-flight — the cursor reset doesn't fix a broken connector.
- Persist the pre-flight result into the cursor's `connectors.<name>.{ok,error}` so the next run knows last-known state without re-probing.
- **Repeat-failure escalation** — when a connector has been ❌ for **3+ consecutive runs**, append a `consecutive_failures: N` count to its cursor entry and surface it in the pre-flight table as `❌ <connector> (Nth consecutive run)`. After 3 runs, also add a one-line recovery hint to the pre-flight prompt (e.g. "M365 has been down 3 runs — consider running `claude mcp list` to confirm the Graph MCP is loaded"). The prompt itself stays terse; the hint is a single line added beneath the table only when the threshold is hit. Don't repeat it every run after that — keep nagging signal-to-noise high.
- Keep it **terse**: one line per connector, no recovery suggestions in the table. Recovery advice belongs in the final report, not here (exception: the repeat-failure hint above).

**Anti-patterns:**

- ❌ Making real API calls to "verify" connectivity (slow, rate-limit risk)
- ❌ Burying connector status only in the final report (user finds out after 60s of work)
- ❌ Failing the whole sync because one connector is down (graceful degradation is the point)
- ❌ Re-probing connectors that were ✅ <5 minutes ago in a same-session re-run (use the cursor)

## Default Mode

### 1. Load Current State

Read `TASKS.md` and `memory/` directory. If they don't exist, suggest `/productivity-setup` first.

If `~/.config/memory/AGENTS.md` exists, resolve the owning repo first and treat that repo as the local task and memory surface.

#### 1a. Load the sync cursor

Read `.productivity-sync-cursor.json` from the owning repo root. This file persists per-connector "last successful sync" timestamps so each connector queries only what's changed.

**Schema:**

```json
{
  "version": 1,
  "last_full_sync": "2026-05-08T07:20:00+10:00",
  "connectors": {
    "calendar":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true },
    "email":          { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true },
    "messages":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true },
    "meetings":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true },
    "project-tracker":{ "last_sync": "2026-05-08T07:20:00+10:00", "ok": false, "error": "rate-limited" },
    "chat":           { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true },
    "git_forges": {
      "_migrated_from_legacy_github": "2026-05-14",
      "github-bunnings":     { "last_sync": "2026-05-14T10:10:00+10:00", "ok": true },
      "bitbucket-other":     { "last_sync": "2026-05-14T10:10:00+10:00", "ok": true }
    }
  }
}
```

**Git forge cursor migration (R5 / R7):**

- **Read path** — if `connectors.github` exists and `connectors.git_forges` is absent, migrate the legacy entry into the new shape in memory only, then write under the new shape; the legacy `connectors.github` key is dropped on first successful write. Choose the migration target forge name as follows:
  - If `.productivity.yml`'s `git:` map declares **exactly one** `type: github` forge, migrate into that forge's name (preserves `consecutive_failures` history against the user-declared name).
  - If `.productivity.yml` declares **zero** `type: github` forges but the legacy `github:` block triggers the back-compat shim, migrate into `github-default` (matching the shim's synthesised name).
  - If `.productivity.yml` declares **multiple** `type: github` forges, migration is ambiguous — write under `github-default` with `ok: false`, `error: "legacy cursor migration ambiguous (multiple github forges)"` and surface a pre-flight error asking the user to manually rename the cursor entry. Do NOT silently pick the first one.
- **No legacy-key retention.** The atomic write below provides the crash-safety guarantee on its own. A mid-rename crash leaves the original cursor file intact (the rename either fires or it doesn't), so the next run re-reads the legacy shape and re-migrates. No two-write state machine, no retention bookkeeping.
- **Write atomicity** — cursor writes always serialise to `<cursor>.tmp` first, then atomic `rename()` to the real path. `consecutive_failures` history is preserved across crashes because the original file never enters a partial state.
- **Deprecation note throttling** — on the first migration cycle, write a mandatory sentinel `connectors.git_forges._migrated_from_legacy_github: <iso-date>`. The deprecation note (recommending the user move `github:` → `git:` in `.productivity.yml`) fires once per cursor cycle, gated on this sentinel being absent before the run. Mandatory, not optional.
- **Per-forge keying** — each entry under `connectors.git_forges` is keyed by the forge name from `.productivity.yml`'s `git:` map. Allowed fields per forge: `last_sync`, `ok`, `error`, `consecutive_failures`. Same shape as today's per-connector entries, just one level deeper.

**Behaviour:**

- **First run or missing file** — treat as a wide-window sync. Default fallback windows (also used when a connector has `ok: false` from the previous run):
  - Calendar: past 2 days + next 3 days (current default)
  - Email: unread + last 7 days
  - Messages / chat: last 7 days
  - Meetings: last 2 days
  - Project tracker: `updated >= -7d`
  - GitHub: `updatedAt >= -7d`
- **Subsequent runs** — pass `since: <last_sync>` (or the equivalent JQL / `--search` clause) to each connector. Always apply a 1-hour overlap (subtract 1h from cursor) to absorb clock drift and late-arriving events. iMessage's `sync_archive` already does this internally — match its pattern for the others.
- **Per-connector independence** — a Jira failure doesn't reset the GitHub cursor. Only update each connector's `last_sync` when *that* connector completed successfully. Persist `ok: false` plus `error: "<short reason>"` on failure so the next run knows to widen its window.
- **Bounded growth** — cursors only ever store a single timestamp per connector. The file stays tiny (~500 bytes).

**Cursor write rules (write-after-success, never-before):**

1. At skill end, for each connector that completed without error, set `connectors.<name>.last_sync = now` and `ok = true`.
2. For each connector that errored, leave `last_sync` unchanged (so next run retries the same window) and set `ok = false`, `error = "<reason>"`.
3. If `--deep` was used, also bump `last_full_sync` so deep-mode-specific cursors (chat 7d, sent email) shift forward.
4. Write atomically: serialise to `.productivity-sync-cursor.json.tmp`, then `mv` over the real file. Avoids a half-written cursor if the skill is interrupted.
5. **Never** write the cursor on user abort (e.g. `--dry-run` or user said "no, don't apply"). Cursor advance = "we successfully consumed this window," not "we ran the skill."

**Invalidation triggers — force a wide-window run regardless of cursor:**

- User passes `--full` flag (e.g. `/productivity-sync --full`)
- The file is older than 7 days (treat as stale; user probably skipped a week)
- Connector's previous run had `ok: false`
- Connector's MCP tool name changed (cursor pre-dates the rename)

**Why a file, not memory:** the skill must survive across sessions. `memory/` is wrong (durable knowledge, not state). `TASKS.md` is wrong (human-edited). A dot-file at repo root is the right surface — `.gitignore` it so the cursor doesn't churn git.

**Add to `.gitignore` automatically** when the cursor file is first written. Append the line `.productivity-sync-cursor.json` if not already present. Avoids the cursor showing up as an untracked file forever.

### 2. Sync from Connected Sources

Read `.productivity.yml` and sync each declared connector. Reference the **productivity-connectors** skill for tool name mappings. If a declared connector's MCP tool is unavailable, skip with a note.

**Calendar** (if configured):
- Window: `since = max(cursor.calendar.last_sync - 1h, now - 2d)`, plus next 3 days. Cursor narrows the past side; future is always +3d.
- Extract meeting titles, attendees, and notes
- Surface action items from meeting descriptions
- **Pre-meeting prep brief** (next 24h only) — for each meeting in the next 24 hours, build a one-paragraph brief the user can read before walking in. The morning sync becomes the standup brief; the afternoon sync warms you up for tomorrow's first meetings. Detail in substep below.

#### Pre-meeting prep brief

For each calendar event in the next 24 hours that meets all of these:

- Not declined
- Not all-day
- Not a recurring focus block / no-meeting block (heuristic: title contains "focus", "DND", "block", or organiser = self with no other attendees)

…assemble a brief in this shape:

```
### Tue 14:00 — Blackhawk catch-up (Tanya)
Attendees: Tanya Hopmans, Sonny Hartley, Nathan
Last interaction with Tanya: 4 days ago (May 7 standup — flagged voucher data field audit)
Open threads (TASKS.md / memory):
- 🟡 Watch: Blackhawk barcode/UPC check-digit confusion (sprint-24.md risks)
- ⏸ Watch-list: POS-3877 CuC API auth — pull-in candidate now 1.4 ships
Suggested talking points:
- Voucher 1.5 UAT progress
- Whether barcode confusion is resolved before Lithocraft run
Last meeting note: docs/meetings/2026-05-07-team-standup-meeting.md
```

**Assembly rules — keep it tight:**

- **Header** — `### <Day HH:MM> — <Title> (<organiser-or-key-attendee>)`. One line.
- **Attendees** — full names resolved via `memory/people/` and `memory/glossary.md`. Limit to 5 names; if more, suffix `+ N others`. Skip attendees you've never interacted with (no people-note + not in glossary).
- **Last interaction with key attendee** — derived from `memory/people/<person>.md` `## Signals` section's most recent entry. Format: "N days ago (<source> — <one-line summary>)". Skip if the person has no people-note or zero signals.
- **Open threads** — grep TASKS.md + active project memory files for entries that mention any attendee, any keyword from the meeting title, or any topic linked from the meeting description. Cap at 3 items. Prefer items in `🟡 Watch / Blocked`, `🔗 Dependencies`, `⏸ Watch-list` over `📋 Backlog`.
- **Suggested talking points** — 2 max, derived from open threads. Skip if the open-threads section was empty.
- **Last meeting note** — most recent `docs/meetings/*.md` file that mentions a key attendee or the meeting title. Skip if none found in the last 30 days.

**Heuristics for "key attendee":**

- The non-self attendee with the most signal entries in `memory/people/`
- Tie-breaker: alphabetical
- 1:1s — easy: the other person
- Standups / large meetings — pick the organiser if not self, else the highest-signal attendee
- If all attendees have zero signal, skip the "Last interaction" line entirely

**Routing rules — choose where to surface:**

- **All briefs go in the report (Step 9)** under a new section `### Today's meetings (next 24h)` — this is the morning standup brief
- **Optionally** persist to `~/.claude/cache/productivity-sync-briefs-<date>.md` (matches the existing kickoff-drafts cache pattern from `new-sprint` Step 11). User can re-open without re-running sync.
- **Never** write briefs to TASKS.md or repo files — they're ephemeral, regenerated each run

**Skip conditions:**

- No meetings in the next 24h → render `*No meetings in the next 24h.*` under the heading, don't omit
- All meetings are focus blocks → same
- Calendar source is unavailable → skip silently (this is a value-add layer; calendar's main job is event sync)

**Cross-cutting integrations (already built, just reuse):**

- People-note `## Signals` reads — the same surface `productivity-sync` already writes to via `apply-person-update.ts`. Pre-meeting prep is the *read-back* of that data, finally giving the people-notes a daily payoff.
- TASKS.md grep — same parsing the action item write-back uses.
- Meeting note glob — same as Step 2 substep 2.

**Anti-patterns specific to this brief:**

- ❌ Generating a brief for every event including focus blocks, DNDs, and own-calendar-blocks (the filter exists for a reason)
- ❌ Surfacing more than 3 open threads per meeting (the brief becomes wallpaper if it's long)
- ❌ Persisting briefs to TASKS.md or memory files (they're ephemeral)
- ❌ Inventing "talking points" with no grounding in actual TASKS.md / memory entries
- ❌ Resolving attendee names by guessing — only via memory/glossary, fall back to the raw email address

**Email** (if configured):
- Window: `since = cursor.email.last_sync - 1h` (fallback: unread + last 7d)
- Scan inbox messages updated in window — treat unread as a stronger signal but include read-then-replied threads
- Extract action items and commitments received
- Note senders for people cross-referencing

**Messages** (if configured -- `messages: imessage` in `.productivity.yml`):
- Prefer MCP tools when `plugin:imessage` is available; fall back to CLI if not
- Incremental sync: call `sync_archive(save_dir: "~/code/personal-messages")`
  - Cursor-based with 1-hour overlap safety — persists markdown, manifest, and cursor automatically
  - Returns `commitment_candidates` directly in the response
- Cross-reference senders against `memory/people/` in the owning repo
- For durable people updates, prepare structured JSON and call `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
- Present returned `commitment_candidates` as "Possible Missing Tasks (from Messages)" for user triage
- If commitments have actionable follow-ups and the chat is allowlisted, offer to reply via `reply(chat_id, text)`
- If `owner_status` is `ambiguous` or `unknown`, ask before writing to any repo task surface
- Write tasks and memory updates to the owning repo, not back into the raw corpus repo
- Never copy raw message bodies into `my-second-brain`
- **CLI fallback:** `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts sync --save-dir ~/code/personal-messages/docs/messages/imessage`

**Chat** (if configured -- `chat: teams` / `chat: slack` in `.productivity.yml`):

Chat is now part of default mode when configured. Reasoning: in projects where `chat:` is the primary directive channel (e.g. Bunnings POS Yellow → Teams), the most load-bearing decisions land there. Gating chat behind `--deep` means daily sync misses Sonny's "POS-4058 outranks POS-3867" until you remember to run deep mode.

**Window — narrower than deep mode:**
- Default mode: `since = cursor.chat.last_sync - 1h` (fallback: last 24h). Tight window — chat is high-volume, low signal-per-message.
- Deep mode (see below): expands to 7d for retrospective scan.

**Sources by `chat:` value:**
- `chat: teams` — Microsoft Teams via Notion's connected-source search (`notion-search` with Teams as the source). Notion indexes Teams content under the user's account if the connector is set up. Falls back to skipping if Notion search returns no Teams results.
- `chat: slack` — Slack MCP if available (`mcp__slack__*`). Falls back to skip-with-note if not installed.
- `chat: none` (or omitted) — skip silently, no warning.

**Transcript detection — route to Meetings persistence FIRST (load-bearing):**

Before extracting any signals, classify each chat-path result:

| Result shape | Examples | Route |
|---|---|---|
| **Meeting transcript** | Notion page with `<meeting-notes>` block, `### Action Items` H3, attendee list, `<transcript>` reference, or Notion AI summary of a Teams/Zoom recording | Route to Meetings substep (above). **Persist `docs/meetings/YYYY-MM-DD-slug.md` BEFORE extraction.** Then return here for any non-meeting-format signals (rare). |
| **Chat message / DM / channel post** | One-shot Teams message, Slack message, DM thread reply | Stay in Chat substep. Extract per the signal-class table below. |

**Detection heuristics (any one is sufficient):**
- Notion result has `<meeting-notes>` XML wrapper
- Notion result title matches `@Today HH:MM`, `Daily Standup`, `<event-name> - Event instance`, or contains `(GMT...)` timezone tag
- Notion result has `### Action Items` H3 with `- [ ]` checkboxes
- Notion result has an attendee list block or `<transcript>` tag
- Result spans >5 minutes of speech (length signal — chat messages are short)

**The contract is identical to the Meetings substep:** persistence is mandatory; extraction is forbidden until the `docs/meetings/` file exists; "skip extraction" never means "skip the file." A transcript surfaced via the chat path is still a transcript — it carries the same evidentiary value and the same future-sync-invisibility risk if not persisted.

**Per-message extraction (each message in window — chat-message results only):**

For each message, decide if it carries a directive or commitment worth surfacing. Three signal classes:

| Signal | Pattern | Action |
|---|---|---|
| **Ticket-key directive** | Mentions `POS-NNNN` + verb phrase ("pull in X", "park X", "X outranks Y", "let's hold X", "pick X first") | Propose TASKS.md update or sprint-doc Decisions Locked entry |
| **Commitment to you** | "@Nathan can you ...", "Nathan to ...", "@<user> please ..." | Propose action item via the same write-back flow as meeting notes (Step 2 substep 7 routing table) |
| **Commitment from you** | First-person "I'll ..." / "I'll send ..." / "Will do X by Y" sent by the user | Propose self-commitment as TASKS.md `🔥 Now` entry |

**Filter aggressively — chat is high-volume:**
- Drop reactions / acks / pure social messages
- Drop messages already captured in `docs/logs/*.md` (the project already has a manual capture flow for big directives — match by date + speaker + ticket key)
- Drop messages from yourself unless they're commitments (rule above)
- Drop messages in channels not relevant to the project (use `.productivity.yml` channel allowlist if present, else just the configured project's channels)

**Cross-reference rules:**
- **Ticket-key mentions** — for every `POS-NNNN` found, check if the ticket appears in TASKS.md. If yes and the message implies a status change ("done", "merged", "in test"), surface as drift. If no and the directive is "pull in", propose a Watch-list → active move.
- **Verbatim quote capture** — for high-stakes directives ("X outranks Y", "deadline is Friday"), preserve the exact quote with speaker + timestamp. Match the existing `feedback_verify_quote_speaker_with_nathan.md` rule — surface back to user before writing it into a sprint doc.
- **Multi-channel duplication** — same directive in DM + channel = single ask, not two.
- **Transcript misclassification** — if any one of the transcript-detection heuristics above hits, route to Meetings persistence BEFORE extraction. Never extract action items from a meeting transcript via the chat path. Even if the signals look identical to chat directives, the source has different evidentiary weight and must land in `docs/meetings/` first.

**Output format — terse, grouped by signal class:**

> ### Chat directives (Teams, since 2026-05-08 07:20)
>
> **Ticket directives (1):**
> - **Sonny → Nathan, Wed 14:32 (DM):** "POS-4058 / POS-4059 are more important than POS-3867 / POS-3795. As they're not ready, pick the others first."
>   → Propose: add to `memory/projects/sprint-24.md` Decisions Locked
>
> **Commitments to you (1):**
> - **Josh → Nathan, Tue 11:08 (POS Yellow channel):** "I'll get the Octopus pipeline change in by EOD"
>   → Already in TASKS.md `🔗 I'm waiting on` ✓
>
> **Commitments from you (1):**
> - **Nathan → Sonny, Tue 16:45 (DM):** "I'll have the cypress backfill ticket filed tomorrow morning"
>   → Already done (POS-4080 filed) ✓

**Anti-patterns specific to this connector:**

- ❌ Pulling the full chat history every run — cursor is mandatory; default to 24h if missing
- ❌ Surfacing every message — filter hard; this is signal extraction, not a chat log
- ❌ Quoting load-bearing directives without confirming speaker per `feedback_verify_quote_speaker_with_nathan.md`
- ❌ Auto-writing chat-extracted directives to sprint docs / TASKS.md — same surface-only rule as everywhere else
- ❌ Treating channel mentions as directives unless they're @-tagging the user

**Messages (deep)** (if `--deep` and messages configured):
- Expand to 7-day window: `sync_archive(save_dir: "~/code/personal-messages", since: "<7-days-ago-ISO>")`
- Separate outbound commitments pass: `search_messages(from_me: true, since: "<7-days-ago-ISO>", save: true, save_dir: "~/code/personal-messages")`
- Surface new contacts not in `memory/people/` using `list_contacts()`
- Full AI analysis of returned message threads for missed action items
- Use `search_messages` for targeted follow-up queries on flagged threads

**Meeting notes** (if knowledge base configured):

**Persistence is mandatory.** Every raw meeting transcript in window must produce a `docs/meetings/YYYY-MM-DD-slug.md` file in the owning repo (or be explicitly skipped to a non-owning repo) *before* any signals from that transcript are extracted into TASKS.md or memory. The transcript is the canonical source — losing it because "I already pulled the action items" is a contract violation, even if the resulting TASKS.md edits look complete.

This substep runs even when calendar is ❌. Calendar enriches matching (attendee names, event titles); without it, fall back to the transcript's own title and the speakers heard in the content. Do not skip meeting-note creation just because calendar is down.

1. **Get calendar events (optional enrichment)** -- If calendar is available, query the past 2 days of events and filter out declined / all-day items. Used for attendee resolution and title matching. If calendar is ❌, skip this step and treat every transcript in window as a candidate.

2. **Check for existing notes** -- Glob `docs/meetings/YYYY-MM-DD-*.md` for each date. Skip any event that already has a notes file (match by date + slug, or by checking the `transcription` frontmatter field for the same knowledge base page ID).

3. **Find transcriptions** -- Search the knowledge base for meeting transcriptions created on the same dates. Reference the **productivity-connectors** skill for knowledge base tool names.

4. **Match transcriptions to events** -- Match by time alignment: extract the time from the transcription title and match to the calendar event whose start time is closest (within 15 minutes). Confirm by checking that the transcription content mentions keywords from the calendar event summary.

5. **Create meeting notes** -- For each matched event, fetch the full transcription content. Read the project's meeting template (typically `Templates/meeting.md`) and create `docs/meetings/YYYY-MM-DD-slug.md`. Fill frontmatter from calendar event data and content from transcription. Resolve attendee emails to full names using `memory/glossary.md` and `memory/people/`, with CLAUDE.md only as a fallback pointer surface.

6. **Extract action items** -- Collect action items from all newly created meeting notes. These feed into the action item write-back below (substep 7) and the report (Step 9).

   **Ordering rule:** Step 5 (persist meeting note file) must complete before any action-item extraction begins. Never extract signals from a transcript that hasn't been written to disk first — even if the user said "skip Monash meetings" or "release-day mode, defer." In those cases, persist the meeting note to the appropriate repo (or to `~/code/my-second-brain/docs/meetings/` if it's not owned by the current repo) and then skip the extraction. *Skipping a meeting* means deferring signal extraction; it never means losing the transcript.

7. **Action item write-back** — never let action items vanish into the report. For every action item extracted in substep 6, decide its destination, then ask the user to apply.

**Extraction rules (run before asking the user):**

- Notion meeting notes use a `### Action Items` H3 with `- [ ]` checkboxes. Local meeting templates use the same convention. Parse both.
- For each item, extract:
  - **owner** — the named person (`Nathan to ...`, `MJ to ...`, `Team to ...`). If unattributed, default `owner = unknown`.
  - **verb + object** — the action itself (`respond to Box file sharing`, `re-test POS-4038`).
  - **deadline** — explicit dates (`by Friday`, `before regression`) or relative phrases. Normalise to absolute date when possible.
  - **ticket key** — any `POS-NNNN` mention in the surrounding bullet.
- **Filter out** items where `owner != currentUser` AND there's no `Nathan` / `me` mention nearby. Other people's actions are tracked in the `🔗 Dependencies → I'm waiting on` section, not as your own todos.
- **Deduplicate** against TASKS.md by fuzzy match on the verb+object string. Skip items that already appear in `🔥 Now`, `🎯 Ordered queue`, or any project file's open-checkbox list. If a near-match exists in `📋 Backlog`, surface as "already backlogged — promote?"

**Routing rules — pick destination before asking:**

| Item shape | Destination |
|---|---|
| Has a sprint-active ticket key | `🔥 Now` section under that ticket's existing entry, or as a new entry if none |
| Has a non-active ticket key (backlog / watch-list) | `⏸ Watch-list` annotation: "from <meeting>: <action>" |
| No ticket key, fits an active project | `memory/projects/<project>.md` under an `## Open follow-ups` section |
| No ticket key, no project anchor | TASKS.md `🔥 Now` as a free-text item |
| Cross-project commitment to a person | `memory/people/<person>.md` `## Open Threads` section |
| Personal / non-work | Skip — surface to user, don't write to repo task surface |

**Ask the user (batched ≤4 per `AskUserQuestion` call):**

For each routed item, present:

> "From May 7 standup: '**Nathan** to respond to Box file sharing process for extension handoff'
> Suggested destination: TASKS.md `🔥 Now` (no ticket key, no clear project anchor)
> (a) Apply as suggested
> (b) Different destination: → `memory/projects/monash.md` / `memory/people/daniel-waghorn.md` / skip
> (c) Skip — already handled / not actionable"

Group items by source meeting so the user sees them in context, not as a flat list.

**Write rules:**

- Always include the source pointer in the written entry: `(from docs/meetings/<file>.md, <date>)`
- Preserve the original `- [ ]` checkbox state
- Append, never overwrite — write to the end of the destination section unless the user picks a specific position
- For `memory/people/*.md`, follow the people-note contract from "People Note Writes" above — use `apply-person-update.ts` with structured JSON, don't freehand edit
- **Never auto-write** — every item passes through `AskUserQuestion`. The skill's "never auto-add tasks or memories without user confirmation" rule applies here too.

**Cross-source action items:**

The same action can appear in multiple meetings (e.g. "Nathan to respond to Box" said Mon, repeated Wed). Detect by fuzzy match on verb+object across all extracted items; collapse to a single ask: "This action appeared in 2 meetings (Mon + Wed). Apply once?"

**Anti-patterns specific to this substep:**

- ❌ Writing action items directly without user confirmation
- ❌ Treating Notion AI summary's action-item block as authoritative — verify against raw transcript per `feedback_use_raw_notion_transcripts.md`
- ❌ Re-extracting action items from already-processed meeting notes on subsequent runs (use cursor + meeting note's `transcription:` frontmatter ID to skip)
- ❌ Adding other people's actions to the user's TASKS.md (they go in Dependencies / `🔗 I'm waiting on`)
- ❌ Filing personal-life items into work repos
- ❌ **Extracting signals from a transcript without persisting the meeting note first** — even if every signal lands in TASKS.md/memory correctly, the source transcript is now invisible to future syncs (the cursor advances past it). Always write `docs/meetings/YYYY-MM-DD-slug.md` *before* extraction, and never let "the user said skip" mean "skip the file, just keep the signals." Skipping = skip extraction, keep file.
- ❌ Skipping meeting-note creation because calendar is unavailable — the knowledge base alone is sufficient. Calendar is an enrichment layer (attendee resolution, event title matching), not a prerequisite.

**Project tracker** (if configured -- per `.productivity.yml`):
- Window: `updated >= cursor.project-tracker.last_sync - 1h` in the JQL (fallback: `updated >= -7d`). This catches transitions you missed (Ready → Done overnight) without re-reading the entire backlog.
- Fetch tasks assigned to the user (open/in-progress)
- Compare against TASKS.md:

| External task | TASKS.md match? | Action |
|---------------|-----------------|--------|
| Found, not in TASKS.md | No match | Offer to add |
| Found, already in TASKS.md | Match by title (fuzzy) | Skip |
| In TASKS.md, not in external | No match | Flag as potentially stale |
| Completed externally | In active section | Offer to mark done |

Present diff and let user decide what to add/complete.

**Git forges** (configured via `git:` block in `.productivity.yml`):

Multi-forge support. One `.productivity.yml` can declare one or more git forges (GitHub, Bitbucket Cloud, Bitbucket Server) keyed by forge name. **Explicit `git:` block required** — there is no implicit-mode sweep. A consumer with no `git:` block gets no forge sync (the connector simply skips).

`.productivity.yml` schema for this connector:

```yaml
git:
  github-bunnings:
    type: github
    user: nathanvale-bunnings        # required — username for `--author "@me"` queries
    auth: gh                         # gh | env  (keychain reserved, not implemented)
    ticket-prefix: POS               # optional — used to extract ticket keys from branch/title
    review-as-me: true               # optional — include `--review-requested @me` query
    repos:                           # forge-native identifiers (org/repo for GitHub)
      - Bunnings-Technology-Delivery/gms.app
      - Bunnings-Technology-Delivery/gms.api
      - Bunnings-Technology-Delivery/voucher

  bitbucket-other-machine:           # example — not shipping logic, stub-only
    type: bitbucket-cloud
    user: nathan.example
    auth: env                        # reads BITBUCKET_TOKEN, BITBUCKET_USER
    ticket-prefix: PROJ
    review-as-me: true
    repos:                           # workspace/repo_slug for Bitbucket Cloud
      - example-workspace/some-repo

  bitbucket-internal:                # example — stub-only
    type: bitbucket-server
    user: nathan.example
    auth: env
    base_url: https://bitbucket.example.com   # required for bitbucket-server; HTTPS-only
    ticket-prefix: INT
    review-as-me: true
    repos:                           # projectKey/repoSlug for Bitbucket Server
      - PROJ/internal-tooling
```

**Schema rules:**

| Field | Required | Notes |
|---|---|---|
| `type` | yes | One of: `github`, `bitbucket-cloud`, `bitbucket-server`. Open for future values; no others ship today. |
| `user` | yes | Forge-native username. |
| `auth` | yes | `gh` or `env` (see Auth modes below). `keychain` reserved, not implemented. |
| `repos` | yes | Forge-native identifiers (see Schema column above per `type`). Not local paths. |
| `base_url` | only `bitbucket-server` | Validated at config-load per R10 (see Base-URL validation below). |
| `ticket-prefix` | optional | Used to extract ticket keys from branch/title (default: derive from project-tracker config). |
| `review-as-me` | optional | Include the `--review-requested @me` query (GitHub) or its forge equivalent. |

**Forge name allowlist:**

Map keys (the forge names) must match `^[a-z][a-z0-9-]{0,62}$`. The allowlist closes a keychain-injection vector (future `auth: keychain` will look up secrets by forge name) and keeps names safe as display labels — forge names render verbatim into cursor JSON and the sync report.

**The allowlist applies only to `git:` map keys (forge names), NOT to repo identifiers in `repos:` lists.** A repo entry like `Bunnings-Technology-Delivery/gms.app` is valid even though it has uppercase characters and dots — `repos:` entries are forge-native identifiers (org/repo, workspace/slug, projectKey/repoSlug) and the forge's own API addressing rules apply, not the allowlist.

If a forge name fails the allowlist, pre-flight emits a specific config-load error naming the offending key:
```
❌ git.<name> — forge name must match ^[a-z][a-z0-9-]{0,62}$
```

**Base-URL validation (R10, `bitbucket-server` only):**

At config-load, the `base_url` value must satisfy BOTH:

1. **Regex** — `^https://[a-z0-9.-]+(\:[0-9]+)?(/.*)?$` (HTTPS-only; `http://` is rejected; no other schemes).
2. **Address restriction** — the host must NOT resolve to RFC1918 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or link-local (`169.254.0.0/16`).

This validation fires at schema-load even though the stub adapter makes no REST calls — the load-bearing validation surface is here so the follow-up real adapter inherits a validated `base_url`. If validation fails, pre-flight emits:
```
❌ git.<name> — config error (base_url must be HTTPS, no RFC1918)
```

**Auth modes:**

| Mode | Applies to | Probe | Notes |
|---|---|---|---|
| `gh` | `type: github` only | `gh auth status` exits 0 | Today's GitHub probe; canonical truth source for GitHub auth. |
| `env` | any `type:` | `<FORGE>_TOKEN` and `<FORGE>_USER` env vars are present and non-empty | Generic. For Bitbucket: `BITBUCKET_TOKEN` + `BITBUCKET_USER`. For GitHub-via-env: `GITHUB_TOKEN` + `GITHUB_USER`. |
| `keychain` | reserved | — | Not implemented in v1. The forge-name allowlist (above) pre-closes the injection vector so adding `keychain` later is a low-risk extension. |

**Legacy back-compat shim (R5):**

If `.productivity.yml` has a top-level `github:` block and no `git:` block, treat it as:
```yaml
git:
  github-default:
    type: github
    ...legacy fields
```
…in memory only. The legacy key (`github-default`) is itself allowlist-valid. Emit a one-line deprecation note in the final sync report (NOT in pre-flight) recommending migration to the new `git:` shape. Throttle the note to once per cursor cycle, gated on the cursor sentinel described in Step 1a (`connectors.git_forges._migrated_from_legacy_github`).

**Pre-flight probe table — per-forge rows:**

| `type` | `auth` | Probe |
|---|---|---|
| `github` | `gh` | `gh auth status` exits 0 |
| `github` | `env` | `GITHUB_TOKEN` env var present and non-empty |
| `bitbucket-cloud` | `env` | `BITBUCKET_TOKEN` AND `BITBUCKET_USER` env vars present and non-empty |
| `bitbucket-server` | `env` | `BITBUCKET_TOKEN` AND `BITBUCKET_USER` env vars present AND `base_url` validates per R10 |

Forge name renders verbatim in the probe line: `✅ git.github-bunnings (gh authed as nathanvale-bunnings)`. Failures surface per-forge with the specific error.

**Zero-valid-forges escalation:**

If config-load + probe leave zero forges in a sync-able state (all forges failed validation, all auth probes failed), surface a top-level pre-flight error:
```
❌ NO FORGES SYNCED — git block configured but no forge is sync-able. Fix the validation errors above.
```
Don't silently proceed with no forge sync. **Partial validity** (some valid, some invalid) syncs the valid forges normally; invalid forges surface their specific errors per-forge in pre-flight. Each forge's `consecutive_failures` count tracks independently.

**Stub forge handling (R4, load-bearing):**

After pre-flight passes, before each forge's query loop, branch on `forge.type`:

- `type: github` → run the GitHub query block below (unchanged from today).
- `type: bitbucket-cloud` or `type: bitbucket-server` → **skip the query loop entirely** and queue the stub-warning line (verbatim, defined once below) for the final report. No REST calls. No cursor write beyond the standard per-forge tracking (`last_sync`, `ok: true`, no `error`).

**Stub-warning text (canonical, single emission point):**

When a sync would have queried a stub forge, emit exactly this line in the final report (once per sync per stub forge, not throttled across syncs):

```
⚠️ <forge-name> — config valid, sweep skipped (stub adapter v0, see Deferred to Follow-Up Work)
```

**Forward-compatibility constraint:** the real Bitbucket Cloud / Server adapter, when it ships in a follow-up plan, **MUST NOT** re-emit the canonical warning string under any failure mode. Missing config fields produce a distinct config-load error in pre-flight; auth failures produce sanitised `auth failed (...)` strings; PR data fills the drift buckets normally. The version-sentinel suffix in the canonical string distinguishes "still stubbed" from "real adapter, different problem."

**Sentinel uniqueness contract (grep-test enforcement):**

Running the grep `grep -c` for the canonical warning's version-sentinel suffix against `skills/productivity-sync/SKILL.md` from the claude-code-config repo root MUST return **exactly 1** — the canonical warning-text definition above is the sole emission point in spec. This grep is the load-bearing enforcement mechanism for the "MUST NOT re-emit" constraint: after the follow-up real-adapter plan ships, the same grep against the post-adapter SKILL.md must STILL return exactly 1. Any additional appearance is a regression the follow-up plan's reviewer must catch. A pinned memory entry in the consuming project (POS Yellow) carries this contract forward (with the exact grep command) for `ce-learnings-researcher` to surface during the follow-up plan's grounding pass.

**Token-scrubbing rule (R9):**

Token values (`BITBUCKET_TOKEN`, `GITHUB_TOKEN`, `BITBUCKET_USER`, etc.) are **never** interpolated into report text, warning lines, or cursor `error` strings. Only sanitised messages are recorded. Enumerated error paths:

| Trigger | Sanitised message (cursor `error` and report text) |
|---|---|
| `auth: env`, required env var missing | `auth failed (env var <NAME> not set)` |
| `auth: env`, token rejected by API | `auth failed (HTTP <status>)` |
| `auth: gh`, `gh auth status` non-zero | `auth failed (gh not authenticated)` |
| `base_url` regex or RFC1918 check failed | `config error (base_url must be HTTPS, no RFC1918)` |
| Forge-name allowlist failure | `config error (forge name must match ^[a-z][a-z0-9-]{0,62}$)` |

**Never** include the env-var value, response body, token substring, header, or any user-supplied secret in any of these strings. The rule applies uniformly to cursor `error` field writes, pre-flight error lines, and final-report warnings. A negative canary test (`BITBUCKET_TOKEN=secret-canary-value-do-not-leak` → trigger probe failure → grep cursor + report for canary) verifies the rule end-to-end.

**GitHub query (preserved verbatim — semantic parity per R3):**

For each repo declared on a `type: github` forge, run a single bounded query (do not paginate beyond the limit — keeps token cost flat):

```bash
gh pr list --state all --author "@me" \
  --json number,title,state,mergedAt,createdAt,updatedAt,headRefName,reviewDecision,mergeStateStatus,statusCheckRollup,reviewRequests,latestReviews \
  --limit 30
```

Filter to PRs `updatedAt >= cursor.git_forges.<forge-name>.last_sync - 1h` (see Step 1a). Fallback if no cursor or `ok: false` from previous run: last 7 days.

For each PR, extract the ticket key from branch name (`feat/POS-NNNN-*` → POS-NNNN) or PR title (`feat(POS-NNNN): ...`) using `ticket-prefix` from the forge entry. PRs without a parseable key go to the "unlinked" bucket.

If `review-as-me: true`, also run one query for review-requests-on-you, scoped to the same repos:

```bash
gh search prs --review-requested "@me" --state open \
  --json number,title,repository,author,updatedAt --limit 20
```

**Drift buckets — surface only items in these buckets, never the full PR list:**

| Bucket | Trigger | Action |
|---|---|---|
| **Open PR, ticket not in TASKS.md** | PR `state=OPEN`, ticket key not in any active section | "Add to 🔥 Now or 🎯 Queue?" |
| **Merged PR, ticket still in-flight in TASKS.md** | PR `state=MERGED`, ticket appears in 🔥 Now / 🎯 Queue | "Move to ✅ Done table + transition Jira?" |
| **PR blocked on `REVIEW_REQUIRED`** | `reviewDecision=REVIEW_REQUIRED` for >24h | "Tag a reviewer?" |
| **PR with failed CI** | Any `statusCheckRollup[].conclusion=FAILURE` | "Re-run failed checks?" (offer the `gh run rerun --failed` command) |
| **PR with merge conflicts** | `mergeStateStatus=DIRTY` | "Rebase needed" |
| **Stale review threads on YOUR open PRs** | `latestReviews[].state=CHANGES_REQUESTED` and `updatedAt > yours` | "X reviewer(s) requested changes — address?" |
| **Awaiting your review** | from `--review-requested @me` query | "N PRs need your review" — list briefly with author + age |
| **Unlinked PRs** | PR with no parseable ticket key | "Want to link this to a ticket?" |

Drift bucket logic is **unchanged from today** — same buckets, same triggers, same actions. Only the *mapping* from forge-native fields to bucket changes per adapter (and only GitHub's mapping ships today). Bitbucket mapping defers to the follow-up adapter plan where field names can be verified against real API responses.

**Output format — terse, one section per non-empty bucket, prefixed by forge name when more than one forge is in scope:**

> ### Git drift — github-bunnings
> **Open PRs not in TASKS.md (1):**
> - gms.app #521 [open, CI green, awaiting review] — POS-4080 — TASKS.md treats Cypress backfill as "to file"
>
> **Merged since last sync, still treated as in-flight (1):**
> - gms.app #522 [merged Fri 15:18] — POS-3934 — TASKS.md `🔥 Now` says "Sonny revisit, parked"
>
> **Awaiting your review (2):**
> - gms.api #538 by mjalil — Idempotency length error message (3 days old)
> - voucher #112 by jxu — PART 1 ACTIVATE_CHECK (1 day old)
>
> ### Git drift — bitbucket-other-machine
> ⚠️ <forge-name> — config valid, sweep skipped (see canonical warning above)

**Cross-reference rules:**
- **PR ticket key matches an existing tracker (Jira) row** — combine signals: "POS-3934 — Jira: In Progress, GitHub PR #522: merged. Out of sync — transition Jira?"
- **PR exists for someone else's Jira ticket** — surface only if you authored it (skip if you reviewed only — that's separate)
- **Multiple PRs for one ticket** — group together (e.g. POS-4038 had #518 + #520 + #522). Show the most recent state.

**Anti-patterns (specific to this connector):**
- ❌ Enumerating every PR — only the bucket items above
- ❌ Auto-tagging reviewers (the user picks who, even when surfaced as actionable)
- ❌ Auto-rerunning CI (it's a write — confirm first)
- ❌ Auto-transitioning Jira from a merged PR (matches `new-sprint`'s same rule)
- ❌ Counting PRs you only reviewed as your own work
- ❌ Re-emitting the canonical stub-warning string from a real adapter — that text is the version sentinel for "still stubbed," not a generic Bitbucket failure marker (see "Sentinel uniqueness contract" above)
- ❌ Interpolating any token / env-var value / response body into cursor `error` or report text — use the sanitised messages enumerated in the token-scrubbing rule above
- ❌ Path-resolving or `.git/config`-sniffing repos — `repos:` entries are forge-native identifiers, declared explicitly
- ❌ Auto-detecting forge type from a remote URL — `type:` is declared, never inferred

If no sources are configured or available (no `git:` block, or all forges failed pre-flight), note "No external sources connected -- skipping sync" and continue to Step 3.

### 3. Cross-Reference Attendees

If calendar data was fetched, cross-reference attendees against memory:
- Known people: note recent meetings in their context
- Unknown people: flag for memory gap filling in Step 6

### People Note Writes

Treat people memory as one shared contract, not a separate sync-owned note system.

When `productivity-sync` updates a person note:
- do not freehand edit `memory/people/*.md`
- prepare structured JSON and call `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
- append short durable observations to `## Signals`
- place conflicts, ambiguity, and unresolved identity issues in `## Open Questions`
- keep relationship-profile edits conservative and scoped to explicit H3 blocks
- use `--create-if-missing` only for safe minimal stubs when identity is unambiguous enough to justify creation
- prefer creating a minimal stub plus an enqueue for `/people-enrich` over writing rich profile prose directly
- never copy raw email or message bodies into durable people notes

Structured payload example:

```json
{
  "signals": [
    "2026-03-22: Calendar invite suggests works at Example Co."
  ],
  "conflicts": [
    "Confirm employer and role before enriching profile."
  ],
  "source_handles": {
    "calendar": ["sarah.chen@example.com"]
  }
}
```

Safe dry-run proof for an existing note:

```bash
bun run ~/.claude/skills/people-enrich/scripts/apply-person-update.ts \
  --people-dir ~/code/my-second-brain/memory/people \
  --source imessage \
  --handle +61412667520 \
  --report /tmp/productivity-sync-person.json \
  --output /tmp/productivity-sync-person.preview.md
```

Safe dry-run proof for a minimal stub:

```bash
bun run ~/.claude/skills/people-enrich/scripts/apply-person-update.ts \
  --people-dir ~/code/my-second-brain/memory/people \
  --title "Sarah Chen" \
  --source calendar \
  --handle sarah.chen@example.com \
  --create-if-missing \
  --report /tmp/productivity-sync-person.json \
  --output /tmp/productivity-sync-person.preview.md
```

Treat these as the proof path before any live `--write` run against real connector output.

### 4. Triage Stale Items

Review active tasks in TASKS.md and flag:
- Tasks with due dates in the past
- Tasks in active sections for 30+ days
- Tasks with no context (no person, no project)

Present each for triage: Mark done? Reschedule? Move to later?

### 5. Decode Tasks for Memory Gaps

For each task, attempt to decode all entities (people, projects, acronyms, tools, links):

```
Task: "Send PSR to Todd re: Phoenix blockers"

Decode:
- PSR -> Pipeline Status Report (in glossary)
- Todd -> Todd Martinez (in people/)
- Phoenix -> ? Not in memory
```

Track what's fully decoded vs. what has gaps.

### 6. Fill Gaps

Present unknown terms grouped:
```
I found terms in your tasks I don't have context for:

1. "Phoenix" (from: "Send PSR to Todd re: Phoenix blockers")
   -> What's Phoenix?

2. "Maya" (from: "sync with Maya on API design")
   -> Who is Maya?
```

Add answers to the appropriate memory files (people/, projects/, glossary.md).

When the shared Memory OS is present, keep those writes local to the owning repo unless the result is clearly durable and cross-context.

### 7. Capture Enrichment

Tasks often contain richer context than memory. Extract and update:
- **Links** from tasks -- add to project/people files
- **Status changes** ("launch done") -- update project status, demote from CLAUDE.md
- **Relationships** ("Todd's sign-off on Maya's proposal") -- cross-reference people
- **Deadlines** -- add to project files

Recommend promotion to `my-second-brain` only when the enrichment becomes durable beyond the owning repo.

### 8. CLAUDE.md Health Check

Scan the canonical repo-level hot-memory file plus the user-level file for token budget and scaffold markers.

**Token budget:**
- Count words in the canonical repo-level hot-memory file plus `~/.claude/CLAUDE.md`
- Estimate tokens (words * 1.3)
- Compare against norms: global 1-3K, project 3-10K, local 500-2K

**Duplicate check:**
- If both `./CLAUDE.md` and `./.claude/CLAUDE.md` exist, flag this as a contract violation unless the user is actively migrating

**Scaffold markers:**
- Grep all CLAUDE.md files for `<!-- scaffold:` comments
- Cross-reference against sync results from Steps 2-3:
  - If update synced from Jira and found assigned tasks -> flag "Jira pending" scaffold as actionable
  - If update synced personal Gmail -> flag "Gmail disconnected" scaffold as actionable
  - If no signal for a scaffold item, mark as "not yet actionable"
- Report count and any actionable items

Include in the report summary (Step 9).

### 9. Report

```
Update complete (delta sync, cursor: 2026-05-08T07:20+10:00 → 2026-05-11T10:35+10:00):
- Sources: calendar (3 new events), email (5 unread + 2 replies), meetings (2 created), Jira (4 updated), GitHub (3 repos, 4 drift items), chat (Teams, 3 directives)
  Skipped: (none)
  Cursor not advanced: project-tracker (rate-limited, retry next run)
- Tasks: +3 from Jira, +2 from meeting notes, 1 completed, 2 triaged
- Action items: 5 extracted from 2 meetings → 3 written (TASKS.md), 1 to memory/projects/monash.md, 1 skipped
- Chat directives: 1 ticket directive (POS-4058 priority), 1 inbound commitment (Josh), 1 outbound commitment (already done)
- GitHub drift: 1 unreflected open PR, 1 merged-still-in-flight, 2 awaiting your review
- Pre-meeting briefs: 3 meetings in the next 24h (Tanya 14:00, standup tomorrow 11:30, Sonny 1:1 16:00)
- Memory: 2 gaps filled, 1 project enriched
- All tasks decoded
- CLAUDE.md: 3,311 tokens (22% of 15K budget), 4 scaffold items (1 actionable)
```

### 10. Suggest Deep Scan

If memory gaps remain or sources were skipped:
```
Some gaps remain. Run /productivity-sync --deep for a comprehensive scan
of chat, sent email, and documents.
```

## Deep Mode (`--deep`)

Everything in Default Mode, plus a deep scan of recent activity.

### Extra Step: Scan Activity Sources

Gather data from all configured MCP sources (reference the **productivity-connectors** skill):
- **Chat (deep):** Expand window to 7d (vs 24h default), include channels not on the project allowlist, include reactions / threads. Default-mode chat already covers signal extraction; deep mode is for retrospective scans (e.g. "what did the team discuss about voucher 1.5 last week?").
- **Sent email:** Search sent messages for commitments made
- **Documents:** List recently touched docs
- **Calendar:** Expand to full week scan (vs 2+3 day default)

### Extra Step: Flag Missed Todos

Compare activity against TASKS.md. Surface action items that aren't tracked:

```
## Possible Missing Tasks

From your activity, these look like todos you haven't captured:

1. From chat (Jan 18):
   "I'll send the updated mockups by Friday"
   -> Add to TASKS.md?

2. From meeting "Phoenix Standup" (Jan 17):
   You have a recurring meeting but no Phoenix tasks active
   -> Anything needed here?

3. From email (Jan 16):
   "I'll review the API spec this week"
   -> Add to TASKS.md?
```

Let user pick which to add.

### Extra Step: CLAUDE.md Deep Health

Everything from the default health check (Step 8), plus:

- **Show each scaffold marker** with surrounding context (2 lines above/below)
- **Interactive triage** for each: keep / update / delete
- **Scan for unmarked scaffold candidates** -- grep CLAUDE.md files for patterns like "pending", "TBD", "disconnected", "TODO", "not yet", "access needed" that aren't already marked as scaffold
- **Suggest new scaffold markers** for any matches found
- **Token trend** -- if a previous budget comment exists, compare current vs. previous and note direction

### Extra Step: Suggest New Memories

Surface new entities not in memory:

```
## New People (not in memory)
| Name | Frequency | Context |
|------|-----------|---------|
| Maya Rodriguez | 12 mentions | design, UI reviews |
| Alex K | 8 mentions | DMs about API |

## New Projects/Topics
| Name | Frequency | Context |
|------|-----------|---------|
| Starlight | 15 mentions | planning docs, product |

## Suggested Cleanup
- **Horizon project** -- No mentions in 30 days. Mark completed?
```

Present grouped by confidence. High-confidence items offered to add directly; low-confidence items asked about.

## Notes

- Never auto-add tasks or memories without user confirmation
- Never auto-transition Jira tickets, auto-tag PR reviewers, or auto-rerun CI — surface only, ask first
- External source links are preserved when available
- Fuzzy matching on task titles handles minor wording differences
- Safe to run frequently — incremental cursors persist last-sync per connector (`.productivity-sync-cursor.json`); subsequent runs query only the delta with a 1h overlap. Use `--full` to force a wide-window run.
- `--deep` always runs interactively
- If a source tool is unavailable, skip it -- never fail the entire sync
- GitHub connector requires the `gh` CLI authenticated for the configured user — soft-fails with a clear message if not

## Gotchas

### Email body decoding — no inline interpreters

`gog gmail read` returns base64-encoded HTML bodies. To decode them:

- **NEVER** use `python3 -c "..."` or any inline `-c/-e/-r/--eval` — blocked by the git-safety hook
- Write a temp script file first, then run it:
  ```bash
  cat > /tmp/decode-email.py << 'EOF'
  import base64, json, re, sys
  data = json.load(open(sys.argv[1]))
  body = data['thread']['messages'][0]['payload']['body']['data']
  decoded = base64.urlsafe_b64decode(body + '==').decode('utf-8', errors='ignore')
  print(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', decoded))[:3000])
  EOF
  python3 /tmp/decode-email.py /path/to/email.json
  ```
- For most sync purposes, the email subject + sender is sufficient to triage action items — only decode the body when the subject is ambiguous

### Email search — query is a positional argument, not a flag

`gog email search` takes the Gmail query as a **positional argument**, not a `--query` flag.

- **NEVER** write: `gog email search --account ... --query "is:unread"` — exits code 2 with "unknown flag --query", produces no output, and looks identical to an auth or rate-limit failure
- **ALWAYS** write: `gog email search --account ... --client ... --json "<query>"`

Correct examples:
```bash
# Unread emails since a date
gog email search --account nathan.vale@monash.edu --client monash --json "is:unread after:2026/05/18"

# All unread
gog email search --account nathan.vale@monash.edu --client monash --json "is:unread" --limit 15

# Read a specific thread body
gog email get --account nathan.vale@monash.edu --client monash --json <threadId>
```
