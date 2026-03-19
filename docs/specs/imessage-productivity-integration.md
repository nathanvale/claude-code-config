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
  - skills/productivity-connectors/SKILL.md
  - skills/productivity-setup/SKILL.md
  - skills/productivity-sync/SKILL.md
  - memory/federation/roster.yml
---

# iMessage Productivity Integration

## Purpose

Wire iMessage into the existing productivity system so that `/productivity-sync` pulls recent messages alongside calendar, email, and Jira. Commitments and action items in messages surface during sync triage.

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

### Default Mode

Add after Email sync, before Meeting notes in `productivity-sync/SKILL.md`:

```markdown
**Messages** (if configured):
- Query past 2 days: `bun run <skill-path>/scripts/query-imessage.ts messages --since {2-days-ago} --save-dir ~/code/personal-messages/docs/messages/imessage`
- Messages auto-persist as markdown with frontmatter via read-through cache
- Cross-reference senders against `my-second-brain-v2/memory/people/` or the owning repo's people memory
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

### Commitment Extraction

After querying messages, Claude reads the message text and identifies:

**Outbound commitments (`--from-me`):**
- Promises: "I'll send that over", "Let me check", "I'll ask Marilyn"
- Scheduled actions: "I'll call tomorrow", "by Friday"
- Offers: "I can pick up Levi"

**Inbound requests:**
- Direct asks: "Can you...", "Could you...", "Please..."
- Implied expectations: "Don't forget to...", "Make sure you..."

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
- Never copy the full raw message body into `my-second-brain-v2`

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

## Verification

1. `.productivity.yml` schema accepts `messages: imessage`
2. `/productivity-sync` includes iMessage source in the sync report
3. Messages save to `~/code/personal-messages/docs/messages/imessage/`
4. Commitments surface as "Possible Missing Tasks (from Messages)"
5. Tasks and memory updates write to the owning repo, not the corpus repo
6. `qmd embed` indexes messages in the `repo-personal-messages` collection
7. QMD can find messages by person, date, and content
