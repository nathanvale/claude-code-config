---
title: "iMessage Productivity Integration"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines how iMessage connects to the productivity system as a connector, syncs via productivity-sync, federates via QMD, and extracts commitments"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-privacy-and-retention.md
  - skills/productivity-connectors/SKILL.md
  - skills/productivity-setup/SKILL.md
  - skills/productivity-sync/SKILL.md
  - memory/federation/roster.yml
---

# iMessage Productivity Integration

## Purpose

Wire iMessage into the existing productivity system so that `/productivity-sync` pulls recent messages alongside calendar, email, and Jira. Commitments and action items in messages surface during sync triage.

## Connector Primitives

The connector needs three explicit machine-facing primitives:

1. `sync` for incremental read-through persistence
2. `enrich` for patching already-saved notes in place
3. `migrate-notes` for path/schema migrations

Example command shapes:

```sh
bun run query-imessage.ts sync --since 2026-03-19 --save-dir ~/code/personal-messages/docs/messages/imessage
bun run query-imessage.ts enrich --source-id p:0/ABC123 --threads --tapbacks
bun run query-imessage.ts migrate-notes --save-dir ~/code/personal-messages/docs/messages/imessage
```

Agents should not need to re-run a broad historical query just to enrich existing notes or migrate path rules.

## Connector Registration

### productivity-connectors/SKILL.md

Add a new **Messages** category after Chat:

```markdown
## Messages

| Connector | Tools |
|-----------|-------|
| `imessage` | Local CLI: `bun run ~/.claude/skills/imessage-reader/scripts/query-imessage.ts` |

**Common patterns:**
- Default sync: messages from past 2 days, save to ~/code/personal-messages/docs/messages/imessage/
- Deep sync: past 7 days, all contacts, AI commitment extraction
- Read-through persistence: every query auto-saves markdown with frontmatter
```

### productivity-setup/SKILL.md

Add a 6th connector category in the setup wizard:

```
6. Messages:
   (1) iMessage  (2) None
```

Config value in `.productivity.yml`:

```yaml
connectors:
  messages: imessage    # imessage | none
```

## Sync Workflow

### Incremental Cursor Contract

Default sync should use a cursor file in the corpus repo:

```json
{
  "schema_version": 1,
  "source_system": "imessage",
  "mode": "default",
  "last_successful_sent_at": "2026-03-20T20:00:11+11:00",
  "last_successful_source_id": "p:0/ABC123",
  "updated_at": "2026-03-20T20:05:00+11:00"
}
```

Rules:
- stored at `runtime/imessage/cursors/default-sync.json`
- deep sync may use a separate cursor or may intentionally ignore the default cursor
- default sync should still use a small overlap window for safety
- the cursor advances only after message notes, attachment metadata, and any manifests have been written successfully
- a failed sync must not advance the cursor

### Default Mode

Add after Email sync, before Meeting notes in `productivity-sync/SKILL.md`:

```markdown
**Messages** (if configured):
- Incremental sync via cursor: `bun run <skill-path>/scripts/query-imessage.ts sync --cursor-file ~/code/personal-messages/runtime/imessage/cursors/default-sync.json --save-dir ~/code/personal-messages/docs/messages/imessage`
- Messages auto-persist as markdown with frontmatter via read-through cache
- Cross-reference senders against `my-second-brain/memory/people/` or the owning repo's people memory
- AI commitment extraction: read message text and identify outbound/inbound commitments
- Present extracted commitments as "Possible Missing Tasks (from Messages)" for user triage
- Write tasks and memory updates to the owning repo, not back into the raw corpus repo
```

### Deep Mode

Expand scope in the Extra Step sections:

```markdown
**Messages (deep):**
- Expand to 7-day window
- Include separate `--from-me` pass to find outbound commitments
- Surface new contacts not in memory/people/
- Full AI analysis of message threads for missed action items
```

### Message Query Completeness

Search and sync must not miss messages whose plain-text column is null but whose `attributedBody` can be decoded.

Rules:
- query selection must include rows where `text` is null but `attributedBody` is present
- `--search` must match against decoded message text, not only the raw `text` column
- commitment extraction must operate on the best available decoded body text

This prevents blind spots in both search and task extraction.

### Commitment Extraction

After querying messages, Claude reads the message text and identifies:

**Outbound commitments (`--from-me`):**
- Promises: "I'll send that over", "Let me check", "I'll ask Marilyn"
- Scheduled actions: "I'll call tomorrow", "by Friday"
- Offers: "I can pick up Levi"

**Inbound requests:**
- Direct asks: "Can you...", "Could you...", "Please..."
- Implied expectations: "Don't forget to...", "Make sure you..."

### Structured CommitmentCandidate Contract

Commitment extraction should produce a structured intermediate shape before anything is shown in the sync report or matched against `TASKS.md`.

```typescript
type CommitmentCandidate = {
  schema_version: 1;
  source_system: "imessage";
  source_id: string;
  source_thread_id: string;
  sent_at: string;
  direction: "inbound" | "outbound";
  conversation_with: string;
  candidate_type: "promise" | "request" | "offer" | "follow_up";
  quote: string;
  summary: string;
  confidence: number;
  owner_hint?: string;
  owner_status: "resolved" | "ambiguous" | "unknown";
};
```

Rules:
- the sync report renders from `CommitmentCandidate[]`, not from free-form prose alone
- if `owner_status` is `ambiguous` or `unknown`, the agent must ask before writing to a repo task surface
- structured candidates make it possible to dedupe, review, and correlate with existing tasks

### Sync Report Presentation

Same pattern as existing "Flag Missed Todos":

```
## Possible Missing Tasks (from Messages)

1. iMessage to Melanie (Wed 8:00pm):
   "I'll ask Marilyn now"
   -> Add to TASKS.md?

2. iMessage from Mum (Wed 7:55pm):
   "Those ice blocks are hydro so Levi can suck them"
   -> (informational, skip)
```

User picks which to add. Never auto-add.

### Token Cost

~50-100 messages * ~50 tokens each = ~2.5-5K input tokens per sync. Negligible.

### Promotion Boundary

The sync workflow should:
- Read raw recent messages from `~/code/personal-messages`
- Propose tasks in the owning repo's `TASKS.md`
- Update durable memory only when the result is worth promoting
- Never copy the full raw message body into `my-second-brain`

### Owning Repo Resolution

Before writing a task candidate, resolve where it belongs:
- personal or life-admin threads default to `my-second-brain`
- clearly work-scoped threads may write to the owning work repo
- mixed-context or ambiguous group chats must not auto-write to any repo
- unresolved ownership should surface as a triage question, not an automatic task write

## QMD Federation

### roster.yml Entry

Add to `memory/federation/roster.yml`:

```yaml
- name: personal-messages
  profile: reference-corpus
  location: /Users/nathanvale/code/personal-messages
  collection: repo-personal-messages
  update_command: git -C /Users/nathanvale/code/personal-messages fetch --all --prune --quiet || true
  primary_paths:
    - docs/messages
    - docs/specs
```

### Search Patterns

The enriched frontmatter enables these QMD queries:

| Query | Fields Used |
|-------|------------|
| "messages from Melanie about dinner" | semantic on body + `conversation_with` |
| "what did I text mum last week" | date range + `conversation_with` |
| "evening messages on Wednesday" | `time_of_day` + `day_of_week` |
| "commitments I made via text" | `is_from_me` + commitment patterns |
| "threads about school" | `thread_root` grouping + search |

### Search Routing Rules

- `rg` first for exact snippets, GUIDs, phone handles, debugging
- QMD `repo-personal-messages` when the question is fuzzy, time-based, person-based, or spans a large window
- Default broad recall should not always search messages first -- target `repo-personal-messages` only when the user is clearly asking about texts or conversation history

## Implementation Targets

| File | Change |
|------|--------|
| `skills/productivity-connectors/SKILL.md` | Add Messages section |
| `skills/productivity-setup/SKILL.md` | Add messages connector to wizard |
| `skills/productivity-sync/SKILL.md` | Add iMessage to default + deep sync steps |
| `memory/federation/roster.yml` | Add `personal-messages` entry |
| `skills/imessage-reader/scripts/query-imessage.ts` | Add `sync`, `enrich`, `migrate-notes`, cursor handling, and decoded-body search coverage |

## Verification

1. `.productivity.yml` schema accepts `messages: imessage`
2. `/productivity-sync` includes iMessage source in the sync report
3. Default sync advances `runtime/imessage/cursors/default-sync.json` only after a successful write
4. Messages save to `~/code/personal-messages/docs/messages/imessage/`
5. `CommitmentCandidate[]` is emitted before report rendering or task writes
6. Ambiguous ownership yields a triage step rather than an automatic repo write
7. Tasks and memory updates write to the owning repo, not the corpus repo
8. `--search` finds messages whose text is decoded from `attributedBody`
9. `query-imessage.ts enrich` can patch existing notes without a full requery
10. `qmd embed` indexes messages and corpus specs in the `repo-personal-messages` collection
11. QMD can find messages by person, date, and content
