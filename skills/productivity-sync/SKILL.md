---
name: productivity-sync
description: Sync tasks and refresh memory from calendar, email, meeting notes, project trackers, and GitHub. Reads .productivity.yml for connector config. Surfaces drift between external sources and TASKS.md (open PRs, merged PRs, awaiting-review), writes back action items extracted from meetings to TASKS.md / memory / people notes, and produces a pre-meeting brief for the next 24h of calendar events. Use --deep for comprehensive scan of chat, sent email, and docs.
argument-hint: "[--brief] [--deep] [--full]"
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

**Required for the active-sprint identity check:** when `project-tracker: jira`, `.productivity.yml` must also declare `project-tracker-board: <numeric-board-id>`. This is the load-bearing input for the active-sprint identity check (Step 2's pre-diff audit and Step 11's post-run recheck). If the field is absent, the skill runs a one-shot **board-id discovery procedure** (see Step 2's project-tracker substep) and prompts the operator to persist the resolved id back into `.productivity.yml` before continuing. The skill must never guess a board id.

## Usage

```
/productivity-sync           # delta sync (since cursor)
/productivity-sync --brief   # pre-meeting only (calendar + local context, next 24h)
/productivity-sync --deep    # delta sync + chat / sent email / docs scan
/productivity-sync --full    # ignore cursor, wide-window sync (recovery / first run)
```

**Flag mutual exclusion:**
- `--brief` and `--deep` are mutually exclusive: if both are passed, emit `"--brief and --deep cannot be used together"` and exit without running.
- `--brief` and `--full` are mutually exclusive: if both are passed, emit `"--brief and --full cannot be used together"` and exit without running. (`--full` resets cursor state; `--brief` is read-only preparation.)
- `--deep` and `--full` are compatible: `--full` resets cursor state (wide-window invalidation), `--deep` expands connector scope to chat / sent email / docs. Both flags can be passed together.

## Pre-flight (30s connector check)

Before any sync work, probe each declared connector and surface the result in **one terse table** so the user sees coverage upfront — not buried in the final report.

For each connector in `.productivity.yml`:

| Connector value | Probe (cheap, <1s each) |
|---|---|
| `microsoft-365` (calendar/email) | Confirm an `mcp__*` Microsoft Graph tool is loaded; if not → ❌ |
| `google-calendar` / `gmail` | Confirm `gcal_*` / `gmail_*` MCP tool is loaded; if not → ❌ |
| `gog` | `which gog >/dev/null` AND `<connector>-account` set in `.productivity.yml` → ❌ if either fails |
| `jira` | Confirm `mcp__*jira*search*` tool is loaded; if not → ❌ |
| `notion` / `confluence` (knowledge-base or transcriptions) | Confirm `mcp__*notion*` / `mcp__*confluence*` tool is loaded; if not → ❌ |
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

- If `--brief` was passed, probe **calendar** normally and probe `transcriptions` as cheap informational tool/auth presence only. The transcriptions probe must not search, fetch, or inspect transcript metadata. All other connectors are shown as `⏭ skipped (brief mode)` in the pre-flight table. This is not ❌, not an error, and does not prompt for skipped connectors.
- If `--brief` was passed and `calendar` is ❌, exit clearly with no prompt: `"Calendar unavailable, cannot build Brief Run. Run full sync or fix calendar connector."`
- If `--brief` was passed and `transcriptions` is ❌, show it as `⚠️ transcriptions (...) - unavailable, ignored in brief mode` and continue without prompting.
- If `--brief` was passed and calendar is ✅, continue after pre-flight regardless of skipped connectors and transcriptions warning state.
- For non-brief runs, if **≥1 probed connector is ❌**, pause and ask the user before proceeding (single y/n prompt). Reason: silent partial syncs hide drift; the user should consciously accept reduced coverage. Brief Run handles calendar and transcriptions failures with the two rules above.
- If **all declared connectors are ✅**, print the table and continue without prompting.
- If `--full` was passed, still run pre-flight — the cursor reset doesn't fix a broken connector.
- For non-brief runs, persist the pre-flight result into the cursor's `connectors.<name>.{ok,error}` so the next run knows last-known state without re-probing. Brief Run does not persist pre-flight results.
- **Repeat-failure escalation**: for non-brief runs, when a connector has been ❌ for **3+ consecutive runs**, append a `consecutive_failures: N` count to its cursor entry and surface it in the pre-flight table as `❌ <connector> (Nth consecutive run)`. After 3 runs, also add a one-line recovery hint to the pre-flight prompt (e.g. "M365 has been down 3 runs. Consider running `claude mcp list` to confirm the Graph MCP is loaded"). The prompt itself stays terse; the hint is a single line added beneath the table only when the threshold is hit. Don't repeat it every run after that. Keep nagging signal-to-noise high.
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

**Re-surface deferred action items:** After loading the cursor (Step 1a), check `cursor.pending`. If any entries exist, they will be presented at the **start of the triage pass** (before new action items from this run). Each deferred item is labelled `"Deferred from YYYY-MM-DD: <text> (originally suggested: <routing>)"`.

**Auto-expiry on re-surface:** Before presenting a pending item, check its `defer_count`:
- If `defer_count >= 2`: do **not** present a triage question. Remove the entry from `cursor.pending` immediately. Add an informational line to the Step 9 report: `"Expired (deferred 3x, never applied): <text> (source: <meeting>)"`. No user action required. (Rationale: the item has been deferred twice already; the 3rd re-surface fires expiry without re-presenting.)
- Expiry fires **only on re-surface at the triage pass**, not at cursor load alone and not on a 4th user deferral mid-triage.

**If the deferred item's source meeting file no longer exists**, re-surface it with a `"(source file no longer exists)"` note appended to the text. Still offer the same triage options.

#### 1a. Load the sync cursor

Read `.productivity-sync-cursor.json` from the owning repo root. This file persists per-connector "last successful sync" timestamps so each connector queries only what's changed.

**Schema:**

```json
{
  "version": 1,
  "last_full_sync": "2026-05-08T07:20:00+10:00",
  "connectors": {
    "calendar":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true, "run_history": [{ "run_at": "2026-05-11T09:00:00+10:00", "ok": true }] },
    "email":          { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true, "run_history": [{ "run_at": "2026-05-11T09:00:00+10:00", "ok": true }] },
    "messages":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true, "run_history": [] },
    "meetings":       { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true, "run_history": [] },
    "project-tracker":{ "last_sync": "2026-05-08T07:20:00+10:00", "ok": false, "error": "rate-limited", "run_history": [{ "run_at": "2026-05-08T07:20:00+10:00", "ok": false }] },
    "chat":           { "last_sync": "2026-05-11T09:00:00+10:00", "ok": true, "run_history": [] },
    "git_forges": {
      "_migrated_from_legacy_github": "2026-05-14",
      "github-bunnings":     { "last_sync": "2026-05-14T10:10:00+10:00", "ok": true, "run_history": [] },
      "bitbucket-other":     { "last_sync": "2026-05-14T10:10:00+10:00", "ok": true, "run_history": [] }
    }
  },
  "commitments": [
    {
      "id": "sha256-of-owner+verb_object+source",
      "owner": "Nathan",
      "text": "Nathan to send the onboarding bundle to Kerry by Friday",
      "verb_object": "send the onboarding bundle to Kerry",
      "deadline": "2026-05-23",
      "source": "docs/meetings/2026-05-20-squad-sync.md",
      "extracted_at": "2026-05-20T10:00:00+10:00",
      "status": "open"
    }
  ],
  "pending": [
    {
      "id": "sha256-of-text+source_meeting",
      "text": "Follow up with Michael on the API spec",
      "source_meeting": "docs/meetings/2026-05-20-squad-sync.md",
      "routing_suggestion": "TASKS.md 🔥 Now",
      "defer_count": 1,
      "deferred_at": "2026-05-20T10:00:00+10:00"
    }
  ],
  "post_run_drift_check": {
    "enabled_until": "2026-06-11",
    "first_enabled_at": "2026-05-28",
    "consecutive_clean_runs": 0,
    "last_sentinel_seen": "v1-2026-05-28"
  }
}
```

**New sub-key field definitions:**

`connectors.<name>.run_history` — rolling 7-entry success/failure log per connector:
```
{ run_at: "<ISO-datetime>", ok: boolean }[]
```
Max 7 entries. Drop the oldest entry before appending if the array already contains 7 entries. Initialise as `[]` when key is missing (first run after schema upgrade). Written in the same atomic cursor pass as `last_sync`.

`commitments` (top-level) — cross-connector commitment ledger:
```
{
  id: string,             // hash of owner+verb_object+source — stable across re-extractions
  owner: string,          // always "Nathan" for self-commitments
  text: string,           // full commitment sentence
  verb_object: string,    // extracted action (e.g. "send the onboarding bundle to Kerry")
  deadline?: string,      // ISO date if a deadline was found
  source: string,         // path to meeting note or chat source
  extracted_at: string,   // ISO datetime of extraction
  status: "open" | "resolved" | "dismissed",
  resolved_at?: string,   // ISO datetime when resolved
  dismissed_at?: string,  // ISO datetime when dismissed
  deferred_until?: string // ISO datetime of snooze expiry (for dropped-ball deferrals)
}[]
```
Target cap: 50 open entries. Prune `resolved` and `dismissed` entries first when the array grows; never silently drop `open` entries. If open entries exceed the cap, keep them all and surface a "commitment ledger over cap" note in the report.

`pending` (top-level) — deferred action item triage queue:
```
{
  id: string,                    // hash of text+source_meeting
  text: string,                  // original action item text
  source_meeting: string,        // path to originating meeting note
  routing_suggestion: string,    // original suggested destination
  defer_count: number,           // starts at 1, incremented on each re-deferral
  deferred_at: string            // ISO datetime of most recent deferral
}[]
```
Items auto-expire when `defer_count >= 2` at re-surface time (see auto-expiry rule above in section 1). The 3rd re-surface fires expiry after the item has been deferred twice. Cap: ~10 items (they expire within 3 syncs by design).

`post_run_drift_check` (top-level) — training-wheels state for the post-run TASKS.md drift recheck (see Step 11):
```
{
  enabled_until: string,           // ISO date; while now < enabled_until, the post-run check runs
  first_enabled_at: string,        // ISO date when the check was first enabled
  consecutive_clean_runs: number,  // starts at 0; increments each clean run; resets to 0 on drift
  last_sentinel_seen: string       // version sentinel of SKILL.md the last time the check ran
}
```

Auto-disable when either condition holds:
- `now >= enabled_until` (the 14-day window has elapsed), OR
- `consecutive_clean_runs >= 6` (six successful drift-free runs — training wheels off early)

Auto-re-enable when `SKILL.md`'s current `post_run_drift_check_sentinel` differs from `last_sentinel_seen` (the skill was healed again; re-run training wheels on the new ruleset).

**Current sentinel:** `v2-2026-06-01`. Bump this string in SKILL.md (search anchor: `post-run-drift-check-sentinel:`) whenever the post-run drift check's logic or scope changes — the bump re-enables training wheels for one fresh 14-day window on the next run.

<!-- post-run-drift-check-sentinel: v2-2026-06-01 -->

**Cursor migration note:** When `commitments`, `pending`, or `post_run_drift_check` top-level keys are absent, or `run_history` is absent from a connector entry, initialise them in memory with empty arrays / objects. For `post_run_drift_check`, the initial shape on first run after a sentinel-bump is:
```json
{
  "enabled_until": "<now + 14 days, ISO>",
  "first_enabled_at": "<now, ISO>",
  "consecutive_clean_runs": 0,
  "last_sentinel_seen": "<current sentinel from SKILL.md>"
}
```
Write the initialised shape in the next normal (non-brief) atomic cursor write. No explicit migration step required.

**Parse-error recovery:** If `JSON.parse` of the cursor file throws (truncated bytes, manual edit corruption, OS crash between flush and rename), treat the cursor as missing for this run (wide-window fallback per Step 1a). Emit one line to the report: `cursor file malformed: treating as first run`. Rename the corrupt file to `.productivity-sync-cursor.json.corrupt.<iso-timestamp>` before writing the next clean cursor. The rename preserves the corrupt content for post-mortem without blocking sync continuation.

**Git forge cursor migration (R5 / R7):**

- **Read path** — if `connectors.github` exists and `connectors.git_forges` is absent, migrate the legacy entry into the new shape in memory only, then write under the new shape; the legacy `connectors.github` key is dropped on first successful write. Choose the migration target forge name as follows:
  - If `.productivity.yml`'s `git:` map declares **exactly one** `type: github` forge, migrate into that forge's name (preserves `consecutive_failures` history against the user-declared name).
  - If `.productivity.yml` declares **zero** `type: github` forges but the legacy `github:` block triggers the back-compat shim, migrate into `github-default` (matching the shim's synthesised name).
  - If `.productivity.yml` declares **multiple** `type: github` forges, migration is ambiguous — write under `github-default` with `ok: false`, `error: "legacy cursor migration ambiguous (multiple github forges)"` and surface a pre-flight error asking the user to manually rename the cursor entry. Do NOT silently pick the first one.
- **No legacy-key retention.** The atomic write below provides the crash-safety guarantee on its own. A mid-rename crash leaves the original cursor file intact (the rename either fires or it doesn't), so the next run re-reads the legacy shape and re-migrates. No two-write state machine, no retention bookkeeping.
- **Write atomicity** — cursor writes always serialise to `<cursor>.tmp` first, then atomic `rename()` to the real path. `consecutive_failures` history is preserved across crashes because the original file never enters a partial state.
- **Deprecation note throttling** — on the first migration cycle, write a mandatory sentinel `connectors.git_forges._migrated_from_legacy_github: <iso-date>`. The deprecation note (recommending the user move `github:` → `git:` in `.productivity.yml`) fires once per cursor cycle, gated on this sentinel being absent before the run. Mandatory, not optional.
- **Per-forge keying** — each entry under `connectors.git_forges` is keyed by the forge name from `.productivity.yml`'s `git:` map. Allowed fields per forge: `last_sync`, `ok`, `error`, `consecutive_failures`, `run_history`. Same shape as today's per-connector entries, just one level deeper.

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
4. For each connector that ran or failed pre-flight during a normal sync, append `{ run_at: now, ok: <true/false> }` to `connectors.<name>.run_history`. Drop the oldest entry before appending if the array already contains 7 entries. Track git forge health per declared forge name under `connectors.git_forges.<forge-name>.run_history`, surfaced as labels like `git.bitbucket-monash`. Track `knowledge-base` and `transcriptions` separately. **`--brief` mode must not append to `run_history` for any connector**. Brief runs are not consumed sync windows.
5. Write `commitments` and `pending` arrays in the same atomic pass: any new commitment entries appended during this run are flushed here; any `pending` mutations (new deferrals, expiry removals) are flushed here.
6. Write atomically: serialise to `.productivity-sync-cursor.json.tmp`, then `mv` over the real file. Avoids a half-written cursor if the skill is interrupted.
7. **Never** write the cursor on user abort (e.g. `--dry-run` or user said "no, don't apply"). Cursor advance = "we successfully consumed this window," not "we ran the skill."

**Invalidation triggers — force a wide-window run regardless of cursor:**

- User passes `--full` flag (e.g. `/productivity-sync --full`)
- The file is older than 7 days (treat as stale; user probably skipped a week)
- Connector's previous run had `ok: false`
- Connector's MCP tool name changed (cursor pre-dates the rename)
- Forge `auth` field changed since the last successful run (e.g. `auth: env` upgraded to `auth: bb-pr-plugin`). Detect by comparing the current `.productivity.yml`'s forge `auth` value against the cursor's last recorded value; cache the auth value per forge in `connectors.git_forges.<name>.last_auth` on each successful write. `last_auth` is a new optional field on each git_forges entry, default unset.

**Why a file, not memory:** the skill must survive across sessions. `memory/` is wrong (durable knowledge, not state). `TASKS.md` is wrong (human-edited). A dot-file at repo root is the right surface — `.gitignore` it so the cursor doesn't churn git.

**Before** writing the cursor file for the first time, append `.productivity-sync-cursor.json` to `.gitignore` if not already present. Verify the append succeeded before proceeding to the cursor write. The gitignore update must precede the first cursor write so the file never appears as a tracked candidate.

### 2. Sync from Connected Sources

Read `.productivity.yml` and sync each declared connector. Reference the **productivity-connectors** skill for tool name mappings. If a declared connector's MCP tool is unavailable, skip with a note.

**`--brief` mode: Brief Run gating:** When `--brief` is active, run **calendar only** after pre-flight and build the pre-meeting brief from calendar plus already persisted local context (`TASKS.md`, `memory/`, and existing `docs/meetings/`). Transcriptions are pre-flight awareness only: do not search, fetch, inspect transcript metadata, create meeting notes, extract transcript actions, or enrich people notes. All other connectors are skipped silently. No error, no prompt. The pre-meeting brief section is the only output (Step 9 is gated accordingly). `--brief` is read-only: do not advance `last_sync`, append to `run_history`, update `ok`, or mutate `consecutive_failures` for any connector, including calendar and transcriptions. Rationale: brief mode prepares from local context but does not consume any external sync window. After rendering the pre-meeting briefs, check the stale-cursor trailer (see Step 9 `--brief` report section).

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
| **Dependency** | Someone else promises work Nathan is waiting on | Propose TASKS.md `🔗 I'm waiting on` / dependency update |
| **Commitment** | "@Nathan can you ...", "Nathan to ...", or first-person "I'll ..." / "I'll send ..." / "Will do X by Y" sent by Nathan, with a concrete verb-object | Propose self-owned action item via the write-back flow |

**Commitment ledger extraction (chat):** For each message where sender metadata confirms Nathan is the speaker, check for first-person patterns (`I'll ...`, `I will ...`, `I have ...`) with a concrete verb-object. Do not ledger vague acknowledgements such as "I'll check", "I'll look", or "will do" unless source context supplies the concrete action object. Only ledger commitments when sender identity is unambiguous. Do not ledger based on message content alone when sender is unknown or `ambiguous`. Other people's promises are dependencies, not commitments, and do not enter `cursor.commitments`. Capture: owner ("Nathan"), verb-object, deadline (any `by <date/day>` phrase near the commitment), source (chat message timestamp or thread URL). Write to `cursor.commitments` per the schema in Step 1a. Deduplicate by id (hash of owner+verb_object+source). Do not require user confirmation for ledger writes because the ledger is sync state; the user reviews ledger entries via "Dropped balls" in the report before any task or memory write.

**Filter aggressively — chat is high-volume:**
- Drop reactions / acks / pure social messages
- Drop messages already captured in `docs/logs/*.md` (the project already has a manual capture flow for big directives — match by date + speaker + ticket key)
- Drop messages from yourself unless they're commitments (rule above)
- Drop messages in channels not relevant to the project (use `.productivity.yml` channel allowlist if present, else just the configured project's channels)

**Cross-reference rules:**
- **Ticket-key mentions** — for every `POS-NNNN` found, check if the ticket appears in TASKS.md. If yes and the message implies a status change ("done", "merged", "in test"), surface as drift. If no and the directive is "pull in", **first verify the ticket is in the open sprint**. If yes, propose adding to 🔥 Now. If no, surface as an "Ask <PM>" question — never propose a Watch-list write. TASKS.md is sprint-only.
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
> **Dependencies (1):**
> - **Josh → Nathan, Tue 11:08 (POS Yellow channel):** "I'll get the Octopus pipeline change in by EOD"
>   → Already in TASKS.md `🔗 I'm waiting on` ✓
>
> **Commitments (1):**
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

**Meeting notes** (if `transcriptions:` configured — falls back to `knowledge-base:` if not):

**Connector routing:** Read `transcriptions:` from `.productivity.yml` first. If set, use that connector and tool. If absent, fall back to `knowledge-base:`. For most projects where Zoom auto-transcribes into Notion, `transcriptions: notion` + `transcriptions-db: collection://...` is the correct setup — Confluence is for doc lookup, not transcripts.

**Persistence is mandatory.** Every raw meeting transcript in window must produce a `docs/meetings/YYYY-MM-DD-slug.md` file in the owning repo (or be explicitly skipped to a non-owning repo) *before* any signals from that transcript are extracted into TASKS.md or memory. The transcript is the canonical source — losing it because "I already pulled the action items" is a contract violation, even if the resulting TASKS.md edits look complete.

This substep runs even when calendar is ❌. Calendar enriches matching (attendee names, event titles); without it, fall back to the transcript's own title and the speakers heard in the content. Do not skip meeting-note creation just because calendar is down.

1. **Get calendar events (optional enrichment)** -- If calendar is available, query the past 2 days of events and filter out declined / all-day items. Used for attendee resolution and title matching. If calendar is ❌, skip this step and treat every transcript in window as a candidate.

2. **Check for existing notes** -- Glob `docs/meetings/YYYY-MM-DD-*.md` for each date. Skip any event that already has a notes file (match by date + slug, or by checking the `transcription` frontmatter field for the same Notion page ID).

3. **Find transcriptions** -- Search the transcriptions connector (see routing above) for meeting transcriptions created within the sync window:
   - If `transcriptions: notion` and `transcriptions-db:` is set: call `mcp__notion__notion-search` scoped to `data_source_url: <transcriptions-db value>` with `created_date_range` matching the window. This prevents pulling transcripts from other teams in the same Notion workspace.
   - If `transcriptions: notion` and no `transcriptions-db:`: call `mcp__notion__notion-search` with a title/content query + date filter. Less precise — may surface other teams' meetings.
   - If `transcriptions: confluence`: use `mcp__mcp-atlassian__confluence_search` with CQL date filter.

3a. **Skip-rule classifier (fail-closed, mandatory before triage)** -- For each transcription returned by substep 3, classify it against the project's documented skip rules BEFORE surfacing it to the user or any downstream substep. The classifier must fetch transcript content, not rely on title or summary metadata.

   **What counts as a skip rule:** any `feedback_skip_*` memory note in `~/.claude/projects/<project>/memory/` (e.g. `feedback_skip_monash_meetings_entirely.md`) whose body documents content-based exclusion for the current project. The classifier loads these once per run and builds a signal list per rule:
   - For each skip-rule note, extract the documented trigger signals (named people, project codes, domain terminology). The Monash rule's signals are: SLO2, SLO4, SFA, Ellucian, BSA, Banner, FlyWire, OCI, Ashwini, Rita, Nandini, Zai, Kerry, plus any other markers the rule names.

   **How to classify:**
   1. Call `mcp__notion__notion-fetch` with `include_transcript: true` on the page ID. **Use the `<transcript>` block, not the `<summary>` block** — the AI summary can omit out-of-scope signals (Monash names, project codes), making in-scope misclassification more likely. The full transcript is the only reliable router.
   2. Scan the transcript text for any signal from any skip rule (case-insensitive, word-boundary match).
   3. If ≥1 signal matches: tag the transcript `skip: true`, record `skip_reason` as `"<rule-name>: signals matched [<signal1>, <signal2>, ...]"`, and remove it from the candidate set for substeps 4-7. Add it to the Step 9 report as `Skipped per <rule-name>: <transcript title> (signals: <signal list>)`.
   4. If 0 signals match: pass through to substep 4.

   **Hard rules:**
   - The classifier MUST run before any user-facing `AskUserQuestion` about transcript routing. A skipped transcript should never appear in a triage prompt.
   - The classifier MUST use the raw `<transcript>` block, not the `<summary>` or page title. Surface metadata is unreliable for routing: a Monash sprint discussion can be titled "@Today 4:01 PM (GMT+10)" with no domain markers visible until the transcript loads.
   - Skip-classification is **content-based, not source-based**. Do not assume "this came from the project's transcriptions-db so it must be in scope" — the same workspace can hold transcripts for multiple engagements when calendars overlap (e.g. Nathan's POS Yellow + Monash parallel work per `project_monash_parallel_engagement.md`).
   - If `include_transcript: true` returns an empty `<transcript>` block: do NOT default to "in scope." Default to **skip with reason "transcript unavailable for classification"** and surface to the user as `⚠️ Could not classify <title> — transcript empty. Treat as skip until manual review.` Fail closed, never open.

   **Why this exists:** discovered 2026-05-29 — a Monash transcript was surface-classified as POS Yellow because its title was `@Today 4:01 PM (GMT+10)` and its preview mentioned "sprint management and ticket tagging" (a phrase that fits multiple engagements). The skill asked the user whether to persist/extract; the user said yes; the downstream persist sub-agent fetched the full transcript, hit Monash signals, and correctly refused. The user-facing decision was made on top of a wrong route. The fix is to run the content-based classifier upstream so wrong routes never reach the user.

4. **Match transcriptions to events** -- Match by time alignment: extract the time from the transcription title (Notion auto-transcripts use `@Day HH:MM (GMT+TZ)` titles) and match to the calendar event whose start time is closest (within 15 minutes). Confirm by checking that the raw transcript content mentions keywords from the calendar event summary.

   Once matched, extract the **authoritative participant list** from the calendar event's `attendees` array (filter out room resources and declined invitees). This is the ground truth for who was in the meeting. The Notion-generated title and transcript speaker names are unreliable for this — Notion AI names the page from the meeting topic, not the participants, so a 1:1 between Nathan and Pri about Nithin's work gets titled "Nithin & Prave". Calendar attendees do not have this problem.

   If calendar is ❌ (no match found), fall back to transcript speaker names with an explicit warning in the meeting note: `<!-- attendees: unverified — calendar unavailable, derived from transcript speakers -->`.

5. **Create meeting notes** -- For each matched event, fetch the **raw transcript** content:
   - If `transcriptions: notion`: call `mcp__notion__notion-fetch` with `include_transcript: true` on the page ID. **Use only the `<transcript>` block — never the `<summary>` block.** The summary is Notion AI generated and unreliable (name misattributions, missing context). The raw transcript is the authoritative source.
   - Read the project's meeting template (typically `Templates/meeting.md`) and create `docs/meetings/YYYY-MM-DD-slug.md`.
   - **Frontmatter title:** use the calendar event `summary` field, not the Notion page title. Notion auto-titles pages as `@Day HH:MM` or generates a title from the transcript topic — neither is reliable as a meeting name.
   - **Frontmatter attendees:** use the calendar attendee list from step 4, resolved to full names via `memory/glossary.md` and `memory/people/`. Never derive the attendees list from the Notion title or transcript speaker names.
   - Store the source Notion page ID in the `transcription:` frontmatter field — used to skip reprocessing on subsequent runs.

   **After the meeting note file is confirmed written**, run the transcript enrichment pass before action-item extraction:

   **5a. Transcript speaker enrichment pass:**
   1. Build a known-names lookup set: read `memory/people/*.md` file stems (e.g. `piyush-kumar.md` → candidates: "Piyush Kumar", "Piyush"). Read `memory/glossary.md` for any person names listed there. Add all to the lookup set. Full-name matches win; first-name matches count only when exactly one people-note or glossary entry has that first name.
   2. Scan the raw `<transcript>` block text for any string in the lookup set (case-insensitive, word-boundary match). Collect: matched people-note filenames (unambiguous), ambiguous names (first name matches >1 note), and unmatched names (found in transcript but not in people/ or glossary).
   3. For each **unambiguous** matched existing person: build a structured JSON signal payload:
      ```json
      {
        "signals": ["YYYY-MM-DD: attended <meeting title>. Topic: <one-line summary from transcript title>."],
        "source_handles": { "transcript": ["<notion-page-id>"] }
      }
      ```
      Keep the signal short and factual. Do not include raw transcript excerpts, commitments, or dependencies. Run a dry-run preview (wrapped with `timeout 15s` to defend against script hangs):
      ```bash
      timeout 15s bun run ~/.claude/skills/people-enrich/scripts/apply-person-update.ts \
        --source transcript \
        --handle <person-file-stem> \
        --report /tmp/productivity-sync-enrichment-<stem>.json \
        --output /tmp/productivity-sync-enrichment-<stem>.preview.md
      ```
   4. If any previews were generated, ask the user once per meeting before any live write: "Transcript speaker enrichment: preview generated for N people from <meeting title>. Apply?" For each approved person, run `timeout 15s bun run apply-person-update.ts --write` (timeout wrapper applies to the live `--write` call as well). Do **not** pass `--create-if-missing` for transcript speaker matches. If the user skips, keep the meeting note and continue.
   5. Collect enrichment stats: `proposed`, `applied`, `skipped`, `unmatched` count, `ambiguous` names list.

   **Graceful skip:** If `apply-person-update.ts` is not found at the expected path, or any call exits non-zero, log one line: `"transcript enrichment skipped for <person>: <reason>"`. Continue without blocking meeting note creation or action item extraction. If a `timeout 15s` wrapper fires before exit, treat it identically to non-zero exit: log `transcript enrichment skipped for <person>: timed out` and continue.

   **If the `<transcript>` block is absent or empty**, skip enrichment silently, no error.

   **If the meeting title is empty**, use "untitled meeting" as the topic summary fallback.

6. **Extract action items** -- Collect action items from all newly created meeting notes. These feed into the action item write-back below (substep 7) and the report (Step 9).

   **Ordering rule:** Step 5 (persist meeting note file) must complete before any action-item extraction begins. Never extract signals from a transcript that hasn't been written to disk first — even if the user said "release-day mode, defer." In those cases, persist the meeting note to the appropriate repo (or to `~/code/my-second-brain/docs/meetings/` if it's not owned by the current repo) and then skip the extraction. *Skipping a meeting* means deferring signal extraction; it never means losing the transcript.

   **Skip-rule transcripts are different.** Transcripts tagged `skip: true` by the substep 3a classifier (e.g. Monash transcripts under the skip-entirely rule) are filtered out *before* substep 4, so they never reach this step. They are not persisted, not extracted, not routed — by the time substep 6 runs, they are already gone. Do not treat the "skipping = skip extraction, keep file" rule as applying to skip-rule transcripts; it applies to transcripts that pass the classifier but the user chooses to defer.

   After action item extraction, append the enrichment summary to the per-meeting report line: `"1 speaker update proposed, 1 applied, 2 unmatched."` (or `"transcript enrichment skipped (apply-person-update.ts not found)"` on graceful-skip).

   **Commitment extraction pass (meeting notes):** After action item extraction, scan the meeting note's `<transcript>` block for explicit self-attribution commitment patterns. Match only Nathan-owned obligations with a concrete verb-object:
   - `(Nathan|@Nathan)( to| can you| please)` followed by a concrete verb-object (e.g. "Nathan to send the onboarding bundle to Kerry by Friday")
   - Patterns attributed to Nathan in the action items section of the note (e.g. `- [ ] Nathan to ...`)

   Do **not** ledger unattributed first-person transcript phrases (e.g. "I'll follow up"). Notion transcripts are plain prose without reliable speaker labels; first-person phrases cannot be attributed to Nathan without explicit speaker metadata. Do not ledger vague acknowledgements like "I'll check" unless the concrete action object is present. Capture: owner ("Nathan"), verb-object, deadline (any `by <date/day>` phrase near the commitment), source (meeting note path). Write to `cursor.commitments`. Deduplicate by id (hash of owner+verb_object+source). This ledger write is automatic because it is cursor state; any write to `TASKS.md`, `memory/`, or people notes remains ask-gated via action item triage.

7. **Action item write-back** — never let action items vanish into the report. For every action item extracted in substep 6, decide its destination, then ask the user to apply.

**Extraction rules (run before asking the user):**

- Notion meeting notes use a `### Action Items` H3 with `- [ ]` checkboxes. Local meeting templates use the same convention. Parse both.
- For each item, extract:
  - **owner** — the named person (`Nathan to ...`, `MJ to ...`, `Team to ...`). If unattributed, default `owner = unknown`.
  - **verb + object** — the action itself (`respond to Box file sharing`, `re-test POS-4038`).
  - **deadline** — explicit dates (`by Friday`, `before regression`) or relative phrases. Normalise to absolute date when possible.
  - **ticket key** — any `POS-NNNN` (or configured `ticket-prefix`-NNNN) mention in the surrounding bullet.
- **Filter out** items where `owner != currentUser` AND there's no `Nathan` / `me` mention nearby. Other people's actions are tracked in the `🔗 Dependencies → I'm waiting on` section, not as your own todos.
- **Deduplicate** against TASKS.md by fuzzy match on the verb+object string. Skip items that already appear in `🔥 Now`, `🎯 Ordered queue`, or any project file's open-checkbox list. Do NOT assume TASKS.md has a `📋 Backlog` or `⏸ Watch-list` section — these are anti-patterns per Sonny's Operating Manual rule "sprint board is the source of truth." If a ticket isn't in sprint, Jira's backlog is its home, not TASKS.md.

**Ticket key verification gate (mandatory before any durable write):**

Notion / Teams / Zoom transcripts are unreliable for ticket numbers. Speakers misremember keys, transcribers mishear digits (4154 ↔ 4155 ↔ 4145), and verbatim quotes captured by Notion AI carry the same errors forward. Before writing a transcript-extracted ticket key into TASKS.md, meeting notes' Action Items, or `memory/projects/*.md`:

1. **Cross-check every extracted ticket key against the open-sprint query results** from the project-tracker step (above). The result is one of:
   - **Match + assignee = currentUser** → safe to write as a Nathan-owned commitment.
   - **Match + assignee ≠ currentUser** → **owner mismatch**. The transcript attributed the ticket to the user, but Jira shows someone else owns it. Surface verbatim quote + Jira ground truth side by side; ask the user to confirm before any write. The Jira owner usually wins — transcripts are lossy.
   - **No match in open-sprint** → either (a) the ticket key was mis-transcribed, or (b) the ticket isn't filed yet. Run a targeted lookup (`key in (POS-NNNN-1, POS-NNNN, POS-NNNN+1)`) to test for an adjacent-digit mishear before concluding the ticket doesn't exist. If still no match, surface as "ticket key TBC — transcript said `<key>`, Jira has no such ticket" and **do not** commit the key into 🔥 Now. Use a placeholder like `(ticket TBC — to verify with <owner>)`.
2. **Never copy a verbatim transcript ticket key directly into a durable write** without running step 1, even when the transcript is clear. The verification cost is one extra Jira call; the cleanup cost when a wrong key lands in TASKS.md is much higher (it propagates into PR descriptions, commit messages, and follow-up meeting notes).
3. **The Notion AI `### Action Items` summary is doubly suspect** — it both inherits speaker misattributions AND can hallucinate ticket keys that weren't in the raw transcript. Always run verification against the raw `<transcript>` block, then verify the key against Jira. Two gates, not one.

**Anti-pattern this gate prevents:** anchoring a Nathan commitment to a ticket key that's actually owned by another team member or doesn't exist yet, because the transcript said it confidently.

**Routing rules — pick destination before asking:**

| Item shape | Destination |
|---|---|
| Has a sprint-active ticket key (verified against open-sprint query) | `🔥 Now` section under that ticket's existing entry, or as a new entry if none |
| Has a ticket key, **NOT in active sprint** | **`❓ Ask <PM>` section** as a pull-in question. Never write to 🔥 Now. Even if the transcript says "Nathan to start X" — if X isn't in sprint, surface the conflict to the user before any write |
| Has a ticket key that doesn't exist in Jira | Surface as "ticket key TBC" — see ticket-key verification gate |
| No ticket key, fits an active project | `memory/projects/<project>.md` under an `## Open follow-ups` section |
| No ticket key, no project anchor, **non-sprint work** | Surface to user — ask whether to write at all. Do NOT auto-route to 🔥 Now |
| No ticket key, no project anchor, **clearly sprint-relevant** (e.g., logistics, deploy step) | TASKS.md `🔥 Now` as a free-text item |
| Cross-project commitment to a person | `memory/people/<person>.md` `## Open Threads` section |
| Personal / non-work | Skip — surface to user, don't write to repo task surface |

**Ask the user (batched ≤4 per `AskUserQuestion` call):**

Present deferred items from `cursor.pending` **before** new action items from this run, so the user clears backlogs before adding new work.

For each routed item (new or re-surfaced deferred), present four options:

> "From May 7 standup: '**Nathan** to respond to Box file sharing process for extension handoff'
> Suggested destination: TASKS.md `🔥 Now` (no ticket key, no clear project anchor)
> (a) Apply as suggested
> (b) Different destination: → `memory/projects/monash.md` / `memory/people/daniel-waghorn.md`
> (c) Skip — already handled / not actionable
> (d) Defer to next sync"

For re-surfaced deferred items, label them: `"Deferred from YYYY-MM-DD (deferred N time(s)): ..."` so the user sees the defer history.

When the user selects **(d) Defer to next sync**: write (or update) the item in `cursor.pending`:
- For a new item: `{ id: hash(text+source_meeting), text, source_meeting, routing_suggestion, defer_count: 1, deferred_at: now }`
- For a re-deferred item: increment `defer_count`, update `deferred_at: now`
- Do **not** write to TASKS.md or any memory file.

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
- ❌ Losing a triage item permanently when the user skips — offer defer instead.
- ❌ **Using the Notion AI `<summary>` block as the transcript source** — always fetch with `include_transcript: true` and use the `<transcript>` block. The AI summary misattributes speakers, omits context, and fabricates action items. This is a hard rule, not a preference.
- ❌ **Classifying transcript scope (POS Yellow vs Monash vs other) from page title, page preview, or AI summary alone.** The full `<transcript>` block is the only reliable signal source for routing. A Monash sprint discussion can look indistinguishable from a POS Yellow sprint discussion at the metadata level — both mention "sprint", "ticket", "review", "pickup". Domain signals (named people, project codes, product names) only appear reliably in the transcript body. See substep 3a above.
- ❌ **Asking the user to route a transcript (persist+extract / persist only / skip) before running the skip-rule classifier on its content.** The user-facing triage assumes the transcript is in scope for the current project. Skipped transcripts must be filtered out before the question is asked, otherwise the user makes a routing decision on top of a misclassification (e.g. saying "persist + extract" for a transcript that should never have been surfaced). Failure mode observed 2026-05-29: a Monash transcript reached the routing prompt; only the downstream persist agent's fail-closed read of the transcript prevented memory contamination.
- ❌ **Defaulting an empty `<transcript>` block to "in scope" for skip-rule classification.** If the transcript is empty, the classifier cannot make a defensible call — default to skip-with-warning rather than passing the transcript through. Fail closed.
- ❌ Re-extracting action items from already-processed meeting notes on subsequent runs (use cursor + meeting note's `transcription:` frontmatter ID to skip)
- ❌ Adding other people's actions to the user's TASKS.md (they go in Dependencies / `🔗 I'm waiting on`)
- ❌ Filing personal-life items into work repos
- ❌ **Extracting signals from a transcript without persisting the meeting note first** — even if every signal lands in TASKS.md/memory correctly, the source transcript is now invisible to future syncs (the cursor advances past it). Always write `docs/meetings/YYYY-MM-DD-slug.md` *before* extraction, and never let "the user said skip" mean "skip the file, just keep the signals." Skipping = skip extraction, keep file.
- ❌ Skipping meeting-note creation because calendar is unavailable — the transcriptions connector alone is sufficient. Calendar is an enrichment layer (attendee resolution, event title matching), not a prerequisite.
- ❌ Searching `knowledge-base:` for transcripts — transcripts live in `transcriptions:`. Confluence is for doc/page lookup only. Searching Confluence for meeting transcripts will return nothing useful.
- ❌ Blocking meeting note creation or action item extraction on enrichment failure — graceful skip applies; log the reason and continue.
- ❌ Creating a people-note stub from transcript speaker matching — transcript enrichment can only propose updates to **existing** unambiguous people notes. Never pass `--create-if-missing` for transcript speaker matches.
- ❌ Applying first-name matches when more than one people-note has that first name — ambiguous first-name matches are reported, never written.
- ❌ **Using the Notion page title or transcript speaker names to determine who was in a meeting.** Notion AI generates the page title from the meeting *topic*, not from the *participants*. A 1:1 between Nathan and Pri about Nithin's work gets titled "Nithin & Prave". Always use the calendar event attendees list as the authoritative participant source. If calendar is unavailable, flag the attendees as unverified in the meeting note.
- ❌ **Writing a transcript-extracted ticket key directly into TASKS.md / meeting notes without verifying against Jira's open-sprint query.** Transcripts misattribute ticket keys constantly (4154 ↔ 4155, 4160 ↔ 4116, etc.). Always cross-check via the open-sprint query; if the key isn't there, run an adjacent-digit lookup. Use `(ticket TBC)` placeholders rather than committing a wrong key.
- ❌ **Stopping the project-tracker step after the my-assignee query because "everything I own is already in TASKS.md."** The my-assignee query alone doesn't surface tickets mentioned in meeting transcripts that are owned by other team members, sibling tickets in the same epic, or just-filed release-train / regression-prep tickets that signal next-sprint shape. The open-sprint query is mandatory, not optional.
- ❌ **Guessing a Jira board id when `.productivity.yml` doesn't declare `project-tracker-board:`.** The skill MUST run the board-id discovery procedure (above) and persist the resolved id back to `.productivity.yml` via operator confirmation, not pick a plausible-looking number and hope. A wrong id makes every drift detector run against the wrong sprint and silently return false-clean results. Failure mode observed 2026-06-01: probed board 419 (guessed), got `[]`, surfaced as inconclusive — but if 419 had been a real (wrong) board with an active sprint, the entire identity check would have silently false-passed against a sprint that has nothing to do with the operator's project.
- ❌ **Writing an out-of-sprint ticket into `🔥 Now` because the meeting transcript named it as Nathan's next pickup.** Transcripts often surface "I'll start X next" without speakers checking sprint membership. The skill MUST verify against the open-sprint query before any 🔥 Now write. POS-3275 sat in 🔥 Now for two sync cycles because of this exact failure mode (resolved 2026-05-28 when Sonny explicitly confirmed in standup the ticket was not in sprint).
- ❌ **Letting `⏸ Watch-list`, `📋 Backlog`, "Smaller items", or "Housekeeping" sections accumulate in TASKS.md.** TASKS.md is sprint-only; Jira's backlog is the backlog. On every run, propose removal of these sections if found.
- ❌ **Skipping the TASKS.md sprint-membership audit when "nothing has changed."** Drift accumulates exactly when nothing has changed: tickets fall out of sprint at sprint boundaries, transcripts mention things that don't make the cut. The audit must fire every run.
- ❌ **Trusting the sprint id/name written in TASKS.md's header without verifying against `jira_get_sprints_from_board(state="active")`.** The header is human-edited prose, not a query result, and drifts at every sprint boundary. The pre-diff audit must validate it as step 0 (active-sprint identity check) before the bucket audit; silent header drift means every downstream check runs against a stale frame even when ticket-level queries return correct results. Failure mode observed 2026-05-28: TASKS.md header said `FY2625 id 25194` while the live active sprint was `FY2624 id 25140` — 25194 was a *future* sprint, so every "open-sprint" query was returning correct data, but the header label was wrong and stayed wrong across multiple syncs.
- ❌ **Treating Nathan-assigned tickets in Ready/To Do as "either auto-add to 🔥 Now or send to backlog."** A third bucket exists: assigned to me + in the active sprint + not in the planning commit. That's an open question for the PM ("stretch card or remove?"), not a directive. The diff-table row was previously permissive; the status-aware split (in-flight → 🔥 Now drift; Ready/To Do → Ask PM drift) is mandatory.

**Project tracker** (if configured -- per `.productivity.yml`):

**Sprint-only TASKS.md contract (READ FIRST):**

TASKS.md is intended to mirror the **active sprint only** — not Jira's full backlog. Per Sonny's Operating Manual (POS Yellow standard) and the durable rule in `feedback_sprint_board_workflow.md`: "Sprint board is the source of truth. Only work tickets currently in the active sprint."

This means productivity-sync MUST:

1. **Never write a non-sprint ticket into `🔥 Now` / `🎯 Queue`** under any code path, even when a meeting transcript says "Nathan to start X" — out-of-sprint commitments surface to "Ask <PM>" instead.
2. **Audit TASKS.md against open-sprint membership on every run** (see "Mandatory pre-diff audit" below).
3. **Refuse to create `⏸ Watch-list` or `📋 Backlog` sections** in TASKS.md. If the user already has them, propose removal on the next cleanup pass.

If `feedback_sprint_board_workflow.md` does not exist in the project's memory, the rule still applies — it's the universal "sprint board owns reality" pattern. Document the exception only if the project explicitly disclaims it (and ask the user before assuming).

Run **two** queries in the project-tracker step, not one. Each has a different job:

1. **My-assignee query** (`assignee = currentUser() AND updated >= cursor.project-tracker.last_sync - 1h`, fallback `-7d`) — finds tickets the user owns that moved since the last sync. **This query alone is insufficient** — it shows your own ticket transitions, but not the surrounding context that lets you reconcile a meeting transcript with what's actually on the sprint board.
2. **Open-sprint context query** (`sprint in openSprints() AND project = <PREFIX>` with the same updated-window filter) — finds every recently-touched ticket in the active sprint, including ones owned by other people. This is what catches: (a) tickets *mentioned* in meeting transcripts but assigned to someone else, (b) sibling tickets in the same epic that affect dependency framing, (c) release-train / regression tickets just filed that signal upcoming sprint shape.

**Always diff both queries against TASKS.md** — don't stop after the my-assignee query just because "everything I own is already in TASKS.md." The open-sprint query is the load-bearing drift detector.

**Board-id discovery (run once, persist to `.productivity.yml`):**

If `.productivity.yml` lacks `project-tracker-board:`, run the discovery procedure before the active-sprint identity check below. Never guess a board id — a wrong id makes every drift detector run against the wrong sprint and silently return false-clean results.

1. Call `jira_get_agile_boards(project_key=<configured project>, board_type="scrum")` (or the equivalent for the operator's tracker).
2. If exactly one scrum board is returned, treat it as the candidate.
3. If more than one, present the boards (id + name) via `AskUserQuestion` and have the operator pick.
4. Verify the candidate by calling `jira_get_sprints_from_board(board_id=<candidate>, state="active")`. The result must contain a single sprint object whose name or id matches what TASKS.md's header claims. If it does not, the candidate is wrong — re-prompt the operator (don't auto-pick the next board).
5. After verification, propose adding `project-tracker-board: <id>` to `.productivity.yml` via `AskUserQuestion`. Never silently write the config file — the operator confirms the addition.
6. Once persisted, continue with the active-sprint identity check below using the new id.

This block only runs when the field is missing. On steady-state runs (field present), skip directly to the identity check.

**Mandatory pre-diff audit: TASKS.md sprint-membership check**

**0. Active-sprint identity check (run BEFORE the bucket audit):**

Parse TASKS.md's header lines for the active-sprint id and name. Regex hints: `id\s+(\d+)` for the numeric id, `FY\d{4}` or `Sprint\s+\d+` for the label. Cross-check against the result of `jira_get_sprints_from_board(board_id=<configured board>, state="active")` (the only sprint marked `"state": "active"` is the live one).

**Empty-result handling:** if `jira_get_sprints_from_board(board_id=<configured board>, state="active")` returns `[]`:

- If `.productivity.yml`'s `project-tracker-board:` is **missing** → this is a discovery failure, not a drift signal. Surface as `"active-sprint-identity probe inconclusive: project-tracker-board not configured"` and trigger the board-id discovery procedure above. Do not treat `[]` as evidence of "no drift."
- If `project-tracker-board:` is **present** and the result is genuinely `[]` → the project may be between sprints (last sprint just closed, next sprint not yet started). Cross-check by calling the same tool with `state="future"`. If a future sprint exists, surface as `"no active sprint (next sprint <id> starts <date>)"` — informational, not drift. If no future sprint exists either, surface as drift with `"no active or future sprint — board id may be wrong, please verify"`.
- Never silently increment `consecutive_clean_runs` on an inconclusive identity probe — treat inconclusive as a finding (counter stays at 0).

If the header's id or name **does not match** the live active sprint:

- Surface as a top-priority drift item in the report: `"TASKS.md header says <header id/name>; Jira live active sprint is <live id/name>."`
- Propose patching the header to the live values via `AskUserQuestion`. Show both sides: `"TASKS.md header → FY2625 id 25194; Jira live → FY2624 id 25140."`
- Do NOT auto-write the header — every header rewrite passes through user confirmation like any other durable write.
- This is the load-bearing detector for "the wrong sprint was named when the doc was written and never rebased." Without it, every downstream check still runs against ticket-level queries that work in isolation, so the stale header survives invisibly.

Then run the bucket audit below.

**1. Per-ticket bucket audit:**

Extract every `POS-NNNN` (or configured ticket-prefix-NNNN) reference from TASKS.md's active sections (`🔥 Now`, `🎯 Ordered queue`, `⏸ Watch-list`, `📋 Backlog`, `🟡 Watch / Blocked`, `🔗 Dependencies → I'm waiting on`). For each, cross-check against the open-sprint query results. Buckets:

| Where in TASKS.md | In open-sprint? | Action |
|---|---|---|
| `🔥 Now` / `🎯 Queue` | Yes | Keep (legitimate active work) |
| `🔥 Now` / `🎯 Queue` | **No** | **DRIFT** — propose move out of active section. Ask: "POS-NNNN is in 🔥 Now but not in active sprint. Move to Ask <PM> / remove?" |
| `🌐 Surrounding work` | Yes, assignee ≠ user | Keep (visibility-only is the right surface) |
| `🌐 Surrounding work` | No | Stale — propose removal |
| `⏸ Watch-list` / `📋 Backlog` (any) | n/a | **PROPOSE REMOVAL** — TASKS.md should be sprint-only per Sonny's Operating Manual. Jira backlog IS the backlog. |

Surface drift to the user explicitly: do not let out-of-sprint tickets sit in 🔥 Now silently. This audit fires on every sync run, not just when transcripts mention tickets.

Then run the diff table below.

| External task | TASKS.md match? | Action |
|---------------|-----------------|--------|
| Found in my-assignee + in open-sprint + status ∈ {In Progress, In Review, In Test} | Not in TASKS.md | **DRIFT** — propose adding to `🔥 Now` (assignee + in-flight in active sprint is the strongest signal a ticket belongs in TASKS.md) |
| Found in my-assignee + in open-sprint + status ∈ {Ready, To Do, On Hold} | Not in TASKS.md | **DRIFT** — surface to `❓ Ask <PM>` with note: "assigned but unscheduled in active sprint — confirm: stretch card to commit to this sprint, or remove from sprint board?" Do NOT auto-add to `🔥 Now` (the May 20 planning commit is the source of truth for what's in scope; an unspoken-for assigned ticket is an open question, not a directive). |
| Found in my-assignee + **NOT** in open-sprint | Not in TASKS.md | "Assigned but not in active sprint — backlog only, do not add" |
| Found in my-assignee, already in TASKS.md | Match by title (fuzzy) | Skip |
| In TASKS.md, not in either query | No match | Flag as potentially stale |
| Completed externally (Done in my-assignee) | In active section | Offer to mark done |
| Found in open-sprint, **not in my-assignee**, but **mentioned in a meeting transcript this run** | Surface as "context ticket" | Add to a "🌐 Surrounding work (visibility only — not yours)" section in TASKS.md, never to 🔥 Now |
| Found in open-sprint, ticket key matches one extracted from a transcript, but assignee ≠ currentUser | **Speaker / owner mismatch** | Surface the discrepancy explicitly — the transcript may be misattributing the work. Do not write the ticket into 🔥 Now without user confirmation. |

Present diff and let user decide what to add/complete. The "context ticket" surface keeps surrounding-sprint signal visible without polluting active task lists.

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
| `user` | no | Forge-native username. Required for `auth: env`. Not needed for `auth: bb-pr-plugin`. |
| `auth` | yes | `gh`, `env`, or `bb-pr-plugin` (see Auth modes below). `keychain` reserved, not implemented. |
| `repos` | yes | Forge-native identifiers (see Schema column above per `type`). Not local paths. |
| `repo-dir` | only `auth: bb-pr-plugin` | Absolute or `~`-prefixed path to the local clone of the Bitbucket repo. Required so `bb-api.ts` can detect workspace/slug from `.git/config`. |
| `base_url` | only `bitbucket-server` | Validated at config-load per R10 (see Base-URL validation below). |
| `ticket-prefix` | optional | Used to extract ticket keys from branch/title (default: derive from project-tracker config). |
| `review-as-me` | optional | Include PRs where you are a reviewer (supported for `bb-pr-plugin`). |

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
2. **Address restriction**: the host must NOT resolve to ANY of these five address categories:
   - **RFC1918 private ranges**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - **IPv4 link-local**: `169.254.0.0/16`
   - **Loopback**: `127.0.0.0/8` (IPv4) and `::1` (IPv6)
   - **All-interfaces**: `0.0.0.0`
   - **IPv6 link-local**: `fe80::/10`
   - **IPv6 unique local address (ULA)**: `fc00::/7`

This validation fires at schema-load even though the stub adapter makes no REST calls — the load-bearing validation surface is here so the follow-up real adapter inherits a validated `base_url`. If validation fails, pre-flight emits:
```
❌ git.<name>: config error (base_url must be HTTPS, no RFC1918/loopback/link-local/ULA/all-interfaces)
```

**Auth modes:**

| Mode | Applies to | Probe | Notes |
|---|---|---|---|
| `gh` | `type: github` only | `gh auth status` exits 0 | Today's GitHub probe; canonical truth source for GitHub auth. |
| `env` | any `type:` | `<FORGE>_TOKEN` and `<FORGE>_USER` env vars are present and non-empty | Generic. For Bitbucket: `BITBUCKET_TOKEN` + `BITBUCKET_USER`. For GitHub-via-env: `GITHUB_TOKEN` + `GITHUB_USER`. |
| `bb-pr-plugin` | `type: bitbucket-cloud` only | `~/.config/side-quest/bitbucket-pr/config.yaml` exists AND `forge.repo-dir` resolves to a directory with a Bitbucket remote | Delegates auth entirely to the `bb-pr` plugin (1Password or env var, as configured in the plugin's `config.yaml`). No token handling in productivity-sync. `repo-dir` required — the plugin detects workspace/slug from `.git/config`. |
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
| `bitbucket-cloud` | `bb-pr-plugin` | `~/.config/side-quest/bitbucket-pr/config.yaml` exists AND `repo-dir` resolves to a directory with a Bitbucket remote |

Forge name renders verbatim in the probe line: `✅ git.github-bunnings (gh authed as nathanvale-bunnings)`. Failures surface per-forge with the specific error.

**Zero-valid-forges escalation:**

If config-load + probe leave zero forges in a sync-able state (all forges failed validation, all auth probes failed), surface a top-level pre-flight error:
```
❌ NO FORGES SYNCED — git block configured but no forge is sync-able. Fix the validation errors above.
```
Don't silently proceed with no forge sync. **Partial validity** (some valid, some invalid) syncs the valid forges normally; invalid forges surface their specific errors per-forge in pre-flight. Each forge's `consecutive_failures` count tracks independently.

**Stub forge handling (R4, load-bearing):**

After pre-flight passes, before each forge's query loop, branch on `forge.type` AND `forge.auth`:

- `type: github` → run the GitHub query block below (unchanged from today).
- `type: bitbucket-cloud` AND `auth: bb-pr-plugin` → run the **Bitbucket Cloud (bb-pr-plugin) adapter** block below.
- `type: bitbucket-cloud` AND `auth: env` → **skip the query loop entirely** (stub) and queue the stub-warning line for the final report.
- `type: bitbucket-server` → **skip the query loop entirely** (stub) and queue the stub-warning line for the final report.

**Bitbucket Cloud (bb-pr-plugin) adapter:**

Prerequisites: `~/.config/side-quest/bitbucket-pr/config.yaml` exists; `forge.repo-dir` resolves to a local clone with a Bitbucket remote. Both checked in pre-flight.

The plugin root is auto-detected from the installed plugin cache. `FORGE_REPO_DIR` is read from `.productivity.yml` (the `git.<forge-name>.repo-dir` field) and then `~`-expanded into `REPO_DIR`. Bind to a real bash variable before parameter expansion so the `~` substitution operates on a variable name, not on a literal placeholder string.

```bash
# FORGE_NAME is the current forge key from .productivity.yml's git: map (e.g. "bitbucket-monash").
PLUGIN_ROOT=$(find ~/.claude/plugins/cache/side-quest-engineering/bitbucket-pr -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)
BB_API="$PLUGIN_ROOT/scripts/bb-api.ts"
FORGE_REPO_DIR=$(yq ".git[\"$FORGE_NAME\"][\"repo-dir\"]" .productivity.yml)
REPO_DIR="${FORGE_REPO_DIR/#\~/$HOME}"
```

If `yq` is unavailable, substitute the equivalent extraction (Python `yaml.safe_load`, `bun run` with `js-yaml`, etc.). The constraint is: `FORGE_REPO_DIR` must hold the resolved YAML string before the `${VAR/#\~/$HOME}` line runs. Do not write `FORGE_REPO_DIR="<forge.repo-dir>"`: that assigns a literal placeholder string and breaks the `~` substitution.

> **Important:** Use `find` not `ls -d` for `PLUGIN_ROOT`. On systems where `ls` is aliased to `eza` or colour-enabled, `ls -d` injects ANSI escape codes into the variable, silently corrupting the path and causing `bun run` to fail with "Module not found" even when the file exists.

Each `bun run` invocation is wrapped with `timeout 30s` and a non-zero exit-code check. stderr is captured separately so error text never enters the JSON parsing surface. On non-zero exit or timeout, set the forge's cursor `ok: false`, log the scrubbed stderr to the report (per R9 token-scrubbing rule), and skip this forge for the current run.

`PR_ID` is bound by iterating each entry in the `pr-list OPEN` output before any `pr-statuses` call. The binding step is shown explicitly in the third snippet below. Quote the variable on use to defend against future format changes (PR ids are integers today; quoting closes a defense-in-depth gap).

Consolidated wrapper pattern (used for all three call sites below):
```bash
# Generic pattern: invoke bb-api with timeout + separated stderr + exit-code check.
# Assumes execution inside the per-forge query loop so 'continue' skips remaining work for this forge.
BB_ERR=$(mktemp)
BB_OUT=$(cd "$REPO_DIR" && timeout 30s bun run "$BB_API" <subcommand> <args> 2>"$BB_ERR")
BB_RC=$?
if [ $BB_RC -ne 0 ]; then
  # Scrub stderr per R9 token-scrubbing rule before logging
  SCRUBBED=$(cat "$BB_ERR" | sed -E 's/(BITBUCKET_TOKEN|BITBUCKET_USER|GITHUB_TOKEN)=[^ ]*/\1=<redacted>/g')
  # Set cursor ok: false, log SCRUBBED to report, skip this forge for the current run
  rm -f "$BB_ERR"
  continue  # skip this forge's query loop
fi
rm -f "$BB_ERR"
# Parse "$BB_OUT" as JSON
```

Query open PRs (equivalent to the GitHub `pr-list` query) - apply the wrapper pattern, then capture the parsed result for downstream iteration:
```bash
OPEN_PRS=$(cd "$REPO_DIR" && timeout 30s bun run "$BB_API" pr-list OPEN 2>/tmp/bb-api-err.log)
```

Query recently merged PRs (for "merged, still in-flight" drift bucket) - apply the wrapper pattern:
```bash
MERGED_PRS=$(cd "$REPO_DIR" && timeout 30s bun run "$BB_API" pr-list MERGED 2>/tmp/bb-api-err.log)
```

For each open PR, check CI status. Bind `PR_ID` from the `pr-list OPEN` payload, then invoke `pr-statuses` once per id:
```bash
# Iterate ids from the OPEN PR list (response is a JSON array of PR objects with an integer `id` field).
for PR_ID in $(echo "$OPEN_PRS" | jq -r '.[].id'); do
  STATUS=$(cd "$REPO_DIR" && timeout 30s bun run "$BB_API" pr-statuses "$PR_ID" 2>/tmp/bb-api-err.log)
  # Apply the wrapper pattern's exit-code check around the call above before parsing $STATUS.
done
```

Filter to PRs `updated >= cursor.git_forges.<forge-name>.last_sync - 1h` using the `updated` field on each PR. Fallback if no cursor or `ok: false`: last 7 days.

Extract ticket key from `source` branch name using `ticket-prefix` (e.g. `feat/SMSTSF-3091-*` → `SMSTSF-3091`). PRs without a parseable key go to the "unlinked" bucket.

**Drift buckets — same as GitHub adapter:**

| Bucket | Trigger | Bitbucket field |
|---|---|---|
| Open PR, ticket not in TASKS.md | `state=OPEN`, ticket key not in active section | `state` |
| Merged PR, ticket still in-flight | `state=MERGED`, ticket in 🔥 Now / 🎯 Queue | `state` |
| PR with failed CI | Any status `state=FAILED` | `pr-statuses` response |
| PR with no reviewers after 24h | `reviewers=[]` and PR age > 24h | `reviewers` field |
| Awaiting your review | `review-as-me: true` — PRs where your display name appears in `participants` with `role=REVIEWER` and `approved=false` | `participants` |
| Unlinked PRs | No parseable ticket key | branch `source` |

**Output format:** same terse drift-bucket format as GitHub adapter, prefixed by forge name.

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

**Mandatory post-cursor verification — TASKS.md-tracked PRs:**

Before drift-bucket classification, extract every PR number explicitly tracked in TASKS.md's `🔥 Now`, `🎯 Ordered queue`, or `🔗 Dependencies → I'm waiting on` sections (grep for `#NNN` adjacent to a repo identifier or `gh pr` URL). For each, run `gh pr view <N> --repo <owner/repo> --json number,state,mergedAt,closedAt,reviewDecision,mergeStateStatus,updatedAt` regardless of cursor window. Use this fresh snapshot — not the cursor-windowed `pr list` result — for drift-bucket classification of these PRs.

**Why:** the cursor-windowed query can miss merges that fire minutes before sync runs (`gh pr list --search "updated:>YYYY-MM-DD"` is date-resolution, not timestamp-resolution, and edge-cases at the boundary). PRs that TASKS.md treats as in-flight are load-bearing for the report — a stale-PR drift bucket fires only because the truth wasn't checked.

**Branch-prefix drift detection:** if the PR's `headRefName` does NOT contain the ticket key extracted from the PR title (e.g. PR titled `feat(POS-4058)` but branch is `feature/FERNS-4058-...`), surface a "branch prefix mismatch" warning in the drift report. Jira's PR auto-transition typically keys off branch prefix, not title — a mismatch means the Jira ticket will NOT auto-transition on merge, and a manual transition + merge comment is required.

**Drift buckets — surface only items in these buckets, never the full PR list:**

| Bucket | Trigger | Action |
|---|---|---|
| **Open PR, ticket not in TASKS.md** | PR `state=OPEN`, ticket key not in any active section | "Add to 🔥 Now or 🎯 Queue?" |
| **Merged PR, ticket still in-flight in TASKS.md** | PR `state=MERGED`, ticket appears in 🔥 Now / 🎯 Queue | "Move to ✅ Done table + transition Jira?" |
| **Branch-prefix mismatch on merged PR** | PR `state=MERGED` AND `headRefName` lacks the PR title's ticket key | "Manual Jira transition + merge comment needed — auto-link missed" |
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
- ❌ Trusting only the cursor-windowed `gh pr list` snapshot for PRs explicitly tracked in TASKS.md `🔥 Now` — always run `gh pr view <N>` on those PRs even when the cursor window is empty. Merges that fire minutes before sync are otherwise invisible.
- ❌ Treating "PR is open in cursor-windowed query result" as equivalent to "PR is open right now" — the result is a snapshot of the moment the query ran, not a guarantee of current state.
- ❌ Reporting a PR as `STALE N days` without first running `gh pr view <N>` to confirm it's still open. The stale-PR drift bucket is the most embarrassing one to get wrong.

If no sources are configured or available (no `git:` block, or all forges failed pre-flight), note "No external sources connected -- skipping sync" and continue to Step 3.

### 2b. Commitment Reconciliation

After all connector steps in Step 2 complete, run a reconciliation pass on `cursor.commitments`:

0. **Collapse cross-source duplicates:** Before reconciliation, scan `cursor.commitments` for entries with `status: open` that fuzzy-match by `verb_object`. Match rule: at least 3 meaningful keyword tokens overlap between two entries' `verb_object` fields (meaningful tokens exclude stop words: the, a, to, for, in, on, by, with). When a match is found, keep the earliest `extracted_at` entry and merge the others' `source` paths into a `sources: string[]` field on the surviving entry. Mark the duplicates with `status: dismissed`, `dismissed_at: now`, `dismissed_reason: "duplicate of <surviving-id>"`. Surface the collapse in the Step 9 report: `Commitments: N cross-source duplicates collapsed.`

1. **Reconcile against TASKS.md done items:** Scan the `✅ Done` section of TASKS.md for entries that match open commitments. Exact match: the task's text contains the commitment's `verb_object`. If matched exactly, set `status: resolved`, `resolved_at: now` without asking. Fuzzy match: at least 3 meaningful keyword tokens overlap between the commitment's `verb_object` and the done-section entry. Meaningful tokens exclude stop words (the, a, to, for, in, on, by, with). Present fuzzy matches to the user for confirmation before resolving.

2. **Reconcile against recently-closed Jira tickets:** Use this run's project-tracker results (closed/done tickets in the fetch window). Match open commitments against ticket summaries using the same 3-token fuzzy rule. Require user confirmation before resolving fuzzy Jira matches.
   - If project-tracker did not complete successfully in this run, skip this sub-step and append to the Step 9 report: "Commitment reconciliation: Jira matching skipped (project-tracker failed)."

3. **Dropped balls:** After reconciliation, collect open commitments where (`deadline` exists AND `now > deadline + 1 day`) OR (`deadline` is absent AND `now - extracted_at > 5 days`), and where `deferred_until` is absent or in the past. Dependencies never appear in this section. If any exist, render a `## Dropped balls` section at the **top of the Step 9 report** (before triage pass). For deadline-based entries, use `"Dropped ball (deadline passed): <text> (from <source>)"`. For age-based entries, use `"Dropped ball (N days): <text> (from <source>)"`. Offer three options via `AskUserQuestion`:
   - **Mark resolved** — sets `status: resolved`, `resolved_at: now`
   - **Defer/snooze** — sets `deferred_until: now + 5 days` (commitment stays `status: open`; will not re-surface until snooze expires)
   - **Dismiss** — sets `status: dismissed`, `dismissed_at: now`; does not remove the entry immediately (preserves ledger history)

4. **Ledger cap:** If open entries exceed 50 after pruning resolved/dismissed entries, keep all open entries and add a "commitment ledger over cap (N open entries) — consider resolving older entries" line to the report.

**Note:** Reconciliation depends on the project-tracker connector completing first for Jira matching. TASKS.md matching is unaffected by ordering.

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

**`--brief` mode report:** When `--brief` is active, render **only** the pre-meeting brief section (see "Pre-meeting prep brief" in Step 2). Suppress all of the following: triage pass, git drift, email/Jira summaries, CLAUDE.md health check, stats line, and cursor advancement note.

After the brief section, check the stale-cursor trailer: count connectors in `cursor.connectors` where `last_sync` is absent or `now - last_sync > 4 hours`. Only count **non-brief connectors** (i.e. not `calendar` or `transcriptions`). Count `knowledge-base`, email, project-tracker, chat, messages, and each git forge independently. Missing `last_sync` counts as stale. If count > 0, append one line:

- Singular: `"1 connector not checked. Run full sync when you can."`
- Plural: `"{N} connectors not checked. Run full sync when you can."`

Suppress the trailer entirely if count = 0 (all non-brief connectors are fresh).

Example `--brief` output:
```
### Today's meetings (next 24h)

### Tue 14:00 — Blackhawk catch-up (Tanya)
Attendees: Tanya Hopmans, Nathan
Last interaction with Tanya: 4 days ago (May 7 standup — flagged voucher data field audit)
...

2 connectors not checked. Run full sync when you can.
```

**Full sync report (default / --deep / --full mode):**

The "Dropped balls" section renders at the **top of the report**, before triage, if any open commitments are past their deadline rule or age threshold (see Step 2b). Example:

```
## Dropped balls

- Dropped ball (deadline passed): send the onboarding bundle to Kerry (from docs/meetings/2026-05-14-squad-sync.md)
  → [a] Mark resolved  [b] Defer/snooze  [c] Dismiss
```

Full report example:

```
Update complete (delta sync, cursor: 2026-05-08T07:20+10:00 → 2026-05-11T10:35+10:00):
- Sources: calendar (3 new events), email (5 unread + 2 replies), meetings (2 created), Jira (4 updated), GitHub (3 repos, 4 drift items), chat (Teams, 3 directives)
  Skipped: (none)
  Cursor not advanced: project-tracker (rate-limited, retry next run)
- Tasks: +3 from Jira, +2 from meeting notes, 1 completed, 2 triaged
- Action items: 5 extracted from 2 meetings → 3 written (TASKS.md), 1 to memory/projects/monash.md, 1 skipped
- Deferred items: 2 re-surfaced (1 applied, 1 re-deferred), 1 expired (deferred 3x, never applied)
- Commitments: 2 new extracted, 1 resolved (matched TASKS.md done), 1 dropped ball surfaced
- Chat directives: 1 ticket directive (POS-4058 priority), 1 dependency (Josh), 1 commitment (already done)
- GitHub drift: 1 unreflected open PR, 1 merged-still-in-flight, 2 awaiting your review
- Pre-meeting briefs: 3 meetings in the next 24h (Tanya 14:00, standup tomorrow 11:30, Sonny 1:1 16:00)
- Memory: 2 gaps filled, 1 project enriched
- All tasks decoded
- CLAUDE.md: 3,311 tokens (22% of 15K budget), 4 scaffold items (1 actionable)
- Connector health: email 5/7 ⚠️ | calendar ✅ | project-tracker: insufficient history
```

**Expired deferred items** are reported as informational lines in the Step 9 report (no user action required): `"Expired (deferred 3x, never applied): <text> (source: <meeting>)"`. These appear in the report summary line and as individual informational lines after the Dropped balls section.

**Connector health trend line (Step 9):** After the coverage line, render a health trend line for each connector:

| `run_history` state | Rendered as |
|---|---|
| Missing or empty (0 entries) | `<name>: insufficient history` |
| 1-2 entries | `<name>: insufficient history` |
| 3-7 entries, all `ok: true` | `<name> ✅` (no score shown) |
| 3-7 entries, any `ok: false` | `<name>: N/M` (e.g. `email: 5/7`) |

Only show connectors with less than 100% success rate in the health trend line. Connectors with 7/7 or all-green history show ✅ without a score. Suppress the line entirely if all connectors are green and have sufficient history.

**Post-run drift trailer (rendered at the very bottom, after Step 10's deep-scan nudge):** when training wheels are still on, Step 11 appends either a one-line clean trailer or a `### Self-check: drift still present` block. See Step 11 for the exact rules. The trailer is suppressed when training wheels are off (auto-disabled by elapsed window or 6 consecutive clean runs).

### 10. Suggest Deep Scan

If memory gaps remain or sources were skipped:
```
Some gaps remain. Run /productivity-sync --deep for a comprehensive scan
of chat, sent email, and documents.
```

### 11. Post-run drift recheck (training wheels)

**Purpose:** verify that the changes proposed/applied this run actually closed the TASKS.md drift. If drift remains, surface a `/heal-skill productivity-sync` recommendation with the specific finding embedded as the skill argument. The check is self-disabling — once the skill demonstrates it can hold TASKS.md in sync, the trailer stops firing automatically.

**When to run:**

This step runs at the very end of the sync (after Step 10's deep-scan nudge) on non-brief runs only. Skip entirely when:
- `--brief` mode is active (brief runs don't mutate TASKS.md, so nothing to recheck)
- The project-tracker connector failed pre-flight or errored mid-run (can't recheck without live sprint data)
- TASKS.md doesn't exist in the owning repo

**Gating logic — should this run perform the recheck?**

1. Read `cursor.post_run_drift_check`. If absent, initialise per the schema migration note above, then proceed (this is the first run after a sentinel bump).
2. Read the current `post-run-drift-check-sentinel` from SKILL.md (HTML comment near the schema section). If `cursor.post_run_drift_check.last_sentinel_seen != current_sentinel`, **re-enable**: set `enabled_until = now + 14 days`, `first_enabled_at = now`, `consecutive_clean_runs = 0`, `last_sentinel_seen = current_sentinel`. Emit one line in the report: `Post-run drift check: re-enabled (sentinel <old> → <new>); 14-day training-wheels window restarted.`
3. Evaluate the disable conditions:
   - If `now >= cursor.post_run_drift_check.enabled_until` → **skip the recheck**, do not emit any trailer.
   - If `cursor.post_run_drift_check.consecutive_clean_runs >= 6` → **skip the recheck**, do not emit any trailer.
4. Otherwise → **run the recheck below**.

**The recheck itself:**

Re-run the three drift detectors from Step 2's project-tracker substep, against the post-sync state of TASKS.md and a fresh Jira query (do not reuse the earlier in-memory snapshot — TASKS.md may have been edited mid-run, and the user may have answered AskUserQuestion prompts that changed durable state):

1. **Active-sprint identity check** — parse TASKS.md header for sprint id/name; cross-check against `jira_get_sprints_from_board(board_id=<configured board>, state="active")`. Mismatch → drift. Apply the same **empty-result handling** as the Step 2 pre-diff audit: `[]` with no `project-tracker-board:` configured → inconclusive finding (counter does not increment); `[]` with the field configured → cross-check `state="future"` to distinguish between-sprints state vs wrong-board-id drift.
2. **Per-ticket bucket audit** — for every `<prefix>-NNNN` in TASKS.md's active sections, verify open-sprint membership matches the section it sits in. Bucket violations (e.g. ticket in `🔥 Now` but not in open sprint) → drift.
3. **My-assignee + open-sprint diff** — re-run the my-assignee + open-sprint queries; check that any in-flight tickets assigned to me are reflected in TASKS.md, and that Ready/To Do unscheduled tickets surface in `❓ Ask <PM>`. Missing entries → drift.

Collect findings into a list of `{type, summary, suggested_fix}` records. Examples:
```
{
  type: "active-sprint-identity",
  summary: "TASKS.md header → FY2625 id 25194; Jira live → FY2624 id 25140",
  suggested_fix: "patch TASKS.md header to FY2624 id 25140"
}
{
  type: "unsurfaced-assignee-ticket",
  summary: "POS-3034 (Ready, assigned Nathan) in open sprint, not in TASKS.md",
  suggested_fix: "add to ❓ Ask <PM> as 'stretch card or remove?'"
}
```

**Report rendering:**

If findings is **empty** (clean run):
1. Increment `cursor.post_run_drift_check.consecutive_clean_runs` by 1.
2. If `consecutive_clean_runs >= 6` after increment, emit:
   ```
   Post-run drift check: 6 consecutive clean runs — training wheels off. The post-run recheck will no longer fire unless /heal-skill productivity-sync bumps the sentinel.
   ```
3. Otherwise emit:
   ```
   Post-run drift check: clean (<N>/6 toward training wheels off, window ends <enabled_until>).
   ```

If findings is **non-empty** (drift remains):
1. Reset `cursor.post_run_drift_check.consecutive_clean_runs = 0`.
2. Render a `### Self-check: drift still present` section at the bottom of the report:
   ```
   ### Self-check: drift still present
   The post-run recheck found <N> drift item(s) that this sync did not close. This usually means the skill's drift detectors have a gap — consider healing them.

   Findings:
   - <type>: <summary>
     → Suggested fix: <suggested_fix>
   - <type>: <summary>
     → Suggested fix: <suggested_fix>

   Recommended:
     /heal-skill productivity-sync — <one-line summary of the most load-bearing finding>

   Training wheels: <consecutive_clean_runs>/6 reset to 0. Window ends <enabled_until>.
   ```
3. Do **not** auto-launch `/heal-skill` — the recommendation is informational. The user runs it deliberately.

**Atomic cursor write:** all `post_run_drift_check` mutations land in the same atomic cursor write as Step 9's other cursor advancements (per Step 1a's "Cursor write rules"). On user abort, do not advance.

**Anti-patterns specific to this step:**

- ❌ Running the recheck when the project-tracker connector failed — the comparison would be against stale data, generating false-positive drift findings
- ❌ Auto-invoking `/heal-skill` — the recommendation is surfaced; the user chooses when to heal. Auto-invocation breaks the human-in-the-loop contract that every other write in this skill respects
- ❌ Letting `consecutive_clean_runs` increment on a run where TASKS.md was not actually modified by sync (no PR data, no Jira changes, no meeting transcripts). The recheck must still verify state, but the increment is meaningful: it says "the skill held drift at zero across N real runs," not "the skill ran N times without doing anything." Implementation note: increment is gated only on `findings.length == 0`, not on whether the run mutated anything — a no-op run that confirms zero drift IS a successful clean run by design
- ❌ Continuing to fire the trailer after `enabled_until` has passed — the gate is mandatory; silently keeping training wheels on forever defeats the purpose of the auto-disable
- ❌ Surfacing every drift finding equally — the `Recommended` line should name the single most load-bearing finding (typically active-sprint-identity > unsurfaced-assignee-ticket > section-mismatch). The user clicks `/heal-skill` once per session, not once per finding

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
- **ALWAYS** write the query as a positional arg: `gog email search --account ... --client ... --json "<query>"`
- `gog gmail search` and `gog email search` are both valid aliases for the same command — either works
- Pagination flag is `--max N` (not `--limit`)

Correct examples:
```bash
# Unread emails since a date
gog email search --account nathan.vale@monash.edu --client monash --json "is:unread after:2026/05/18"

# All unread, more results
gog email search --account nathan.vale@monash.edu --client monash --json "is:unread" --max 20

# Read a specific thread body
gog email get --account nathan.vale@monash.edu --client monash --json <threadId>
```
