---
name: productivity-sync
description: Sync tasks and refresh memory from calendar, email, meeting notes, and project trackers. Reads .productivity.yml for connector config. Use --deep for comprehensive scan of chat, sent email, and docs.
argument-hint: "[--deep]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
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
/productivity-sync
/productivity-sync --deep
```

## Default Mode

### 1. Load Current State

Read `TASKS.md` and `memory/` directory. If they don't exist, suggest `/productivity-setup` first.

If `~/.config/memory/AGENTS.md` exists, resolve the owning repo first and treat that repo as the local task and memory surface.

### 2. Sync from Connected Sources

Read `.productivity.yml` and sync each declared connector. Reference the **productivity-connectors** skill for tool name mappings. If a declared connector's MCP tool is unavailable, skip with a note.

**Calendar** (if configured):
- Fetch events from the past 2 days + next 3 days
- Extract meeting titles, attendees, and notes
- Surface action items from meeting descriptions

**Email** (if configured):
- Scan unread inbox messages
- Extract action items and commitments received
- Note senders for people cross-referencing

**Messages** (if configured -- `messages: imessage` in `.productivity.yml`):
- Incremental sync via cursor: `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts sync --save-dir ~/code/personal-messages/docs/messages/imessage`
- Messages auto-persist as Markdown with v2 frontmatter via read-through cache
- Cross-reference senders against `memory/people/` in the owning repo
- For durable people updates, prepare structured JSON and call `~/.claude/skills/people-enrich/scripts/apply-person-update.ts`
- AI commitment extraction: read synced message text and identify outbound/inbound commitments
- Render `CommitmentCandidate[]` as structured JSON, then present as "Possible Missing Tasks (from Messages)" for user triage
- If `owner_status` is `ambiguous` or `unknown`, ask before writing to any repo task surface
- Write tasks and memory updates to the owning repo, not back into the raw corpus repo
- Never copy raw message bodies into `my-second-brain`

**Messages (deep)** (if `--deep` and messages configured):
- Expand to 7-day window: `sync --since <7-days-ago>`
- Include separate `--from-me` pass to find outbound commitments
- Surface new contacts not in `memory/people/`
- Full AI analysis of message threads for missed action items

**Meeting notes** (if calendar + knowledge base configured):

Create structured meeting notes from knowledge base transcriptions matched to calendar events.

1. **Get calendar events** -- Query the past 2 days of calendar events (reuse data from Calendar sync above). Filter out declined events and all-day events.

2. **Check for existing notes** -- Glob `docs/meetings/YYYY-MM-DD-*.md` for each date. Skip any event that already has a notes file (match by date + slug, or by checking the `transcription` frontmatter field for the same knowledge base page ID).

3. **Find transcriptions** -- Search the knowledge base for meeting transcriptions created on the same dates. Reference the **productivity-connectors** skill for knowledge base tool names.

4. **Match transcriptions to events** -- Match by time alignment: extract the time from the transcription title and match to the calendar event whose start time is closest (within 15 minutes). Confirm by checking that the transcription content mentions keywords from the calendar event summary.

5. **Create meeting notes** -- For each matched event, fetch the full transcription content. Read the project's meeting template (typically `Templates/meeting.md`) and create `docs/meetings/YYYY-MM-DD-slug.md`. Fill frontmatter from calendar event data and content from transcription. Resolve attendee emails to full names using `memory/glossary.md` and `memory/people/`, with CLAUDE.md only as a fallback pointer surface.

6. **Extract action items** -- Collect action items from all newly created meeting notes. These feed into the report (Step 9).

**Project tracker** (if configured -- per `.productivity.yml`):
- Fetch tasks assigned to the user (open/in-progress)
- Compare against TASKS.md:

| External task | TASKS.md match? | Action |
|---------------|-----------------|--------|
| Found, not in TASKS.md | No match | Offer to add |
| Found, already in TASKS.md | Match by title (fuzzy) | Skip |
| In TASKS.md, not in external | No match | Flag as potentially stale |
| Completed externally | In active section | Offer to mark done |

Present diff and let user decide what to add/complete.

If no sources are configured or available, note "No external sources connected -- skipping sync" and continue to Step 3.

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
Update complete:
- Sources: calendar (12 events), email (5 unread), meetings (2 created, 1 skipped), Jira (8 tasks)
  Skipped: chat (not configured)
- Tasks: +3 from Jira, +2 from meeting notes, 1 completed, 2 triaged
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
- **Chat:** Search recent messages, read active channels and DMs (if configured)
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
- External source links are preserved when available
- Fuzzy matching on task titles handles minor wording differences
- Safe to run frequently -- only updates when there's new info
- `--deep` always runs interactively
- If a source tool is unavailable, skip it -- never fail the entire sync
