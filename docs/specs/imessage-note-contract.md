---
title: "iMessage Note Contract"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines the Markdown note schema, filename convention, save path sharding, and conversation-level frontmatter fields for persisted iMessage notes"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-thread-tapback-enrichment.md
  - docs/specs/imessage-attachment-model.md
  - skills/imessage-reader/scripts/lib.ts
---

# iMessage Note Contract

## Purpose

Lock the Markdown note shape, filename convention, and frontmatter schema before wiring more consumers. Every message saves as one Markdown note with a stable sharded path and provenance-heavy frontmatter.

## Save Path

### Pattern

```text
{save-dir}/YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug}.md
```

### Example

```text
~/code/personal-messages/docs/messages/imessage/2026/03/2026-03-20-200011-imessage-p-0-abc123.md
```

### Components

| Segment | Source | Purpose |
|---------|--------|---------|
| `YYYY/MM/` | `date_local` | Year/month sharding to avoid huge flat dirs |
| `YYYY-MM-DD` | `date_local` | Human-scannable date prefix |
| `HHmmss` | `date_local` | Time component for uniqueness |
| `imessage` | Literal | Source system identifier |
| `{guid-slug}` | `guid` with `/` -> `-`, `:` -> `-` | Stable unique suffix |

### Migration from Current Path

Current: `{save-dir}/YYYY/YYYY-MM-DD/{guid-slug}.md`

New: `{save-dir}/YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug}.md`

Changes:
- Add month-level sharding (`MM/`)
- Add timestamp and source system to filename
- Remove date-only subfolder in favor of flatter month directory

## Frontmatter Schema

### Required Fields

```yaml
---
title: "iMessage with Melanie at 2026-03-20 20:00"
type: artifact-sidecar
status: active
updated: 2026-03-20
source_system: imessage
source_id: "p:0/ABC123"
source_thread_id: "chat-123"
sent_at: "2026-03-20T20:00:11+11:00"
direction: outbound
guid: "p:0/ABC123"
source_guid: "ABC123"
message_kind: text
from: "me"
handle: "+61400000000"
date: 2026-03-20T09:00:11.000Z
date_local: 2026-03-20T20:00:11+11:00
is_from_me: true
service: iMessage
thread: "Melanie"
is_group: false
conversation_with: "Melanie"
conversation_type: direct
day_of_week: "Friday"
time_of_day: "evening"
---
```

### Field Descriptions

#### Provenance fields (new)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `title` | string | Computed | "iMessage with {contact} at {date_local}" |
| `type` | string | Literal | Always `artifact-sidecar` |
| `status` | string | Literal | Always `active` |
| `updated` | string | Computed | Date-only from `date_local` |
| `source_system` | string | Literal | Always `imessage` |
| `source_id` | string | `guid` | Stable uniqueness key for idempotent re-sync |
| `source_thread_id` | string | `chat_id` | Chat/thread identifier |
| `sent_at` | string | `date_local` | Local wall time the message was sent |
| `direction` | string | `is_from_me` | `outbound` or `inbound` |

#### Conversation fields (new)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `conversation_with` | string | Computed | Resolved contact name of the other party |
| `conversation_type` | string | `is_group` | `direct` or `group` |
| `day_of_week` | string | `date_local` | e.g. "Friday" |
| `time_of_day` | string | `date_local` hour | `morning` (5-12), `afternoon` (12-17), `evening` (17-21), `night` (21-5) |

#### Existing fields (preserved)

All current frontmatter fields are retained: `guid`, `source_guid`, `message_kind`, `from`, `handle`, `date`, `date_local`, `is_from_me`, `service`, `thread`, `is_group`, `group_guid`, `part_index`, `contact_name`, `thread_originator`, `reply_to_raw`, `reply_to`, `reaction_to_raw`, `reaction_to`, `reaction_type`, `subject`, `edited`, `date_edited`, `date_edited_local`, attachment fields.

### Optional Fields

```yaml
related:
  - /Users/nathanvale/code/my-second-brain-v2/memory/people/melanie.md
```

The `related` field is populated when the `conversation_with` contact can be resolved to a known person file in the Memory OS. This is a future enhancement -- v1 may omit it.

## Conversation Field Computation

### `conversation_with`

```
if is_from_me:
  use chat's contact_name or chat_id handle
else:
  use contact_name or handle
```

For group chats, this becomes the chat display name or "group" if unnamed.

### `conversation_type`

```
is_group ? "group" : "direct"
```

### `day_of_week`

```typescript
new Date(date_local).toLocaleDateString('en-AU', { weekday: 'long' })
```

### `time_of_day`

```typescript
const hour = new Date(date_local).getHours();
if (hour >= 5 && hour < 12) return "morning";
if (hour >= 12 && hour < 17) return "afternoon";
if (hour >= 17 && hour < 21) return "evening";
return "night";
```

## Body Shape

### Text messages

```markdown
## Message

Raw message text here.
```

### Messages with attachments

See the attachment model spec for the extended body shape with `## Attachments` and `## Attachment Text` sections.

## Idempotency

- `source_id` (which equals `guid`) is the stable uniqueness key
- Repeated syncs overwrite the existing note at the same path
- Edits, tapbacks, and later enrichments patch the same note deterministically
- The filename includes the GUID slug, so the same message always lands at the same path

## Implementation Target

**File:** `skills/imessage-reader/scripts/lib.ts` -- `saveMessageAsMarkdown()` function

## Verification

1. Saved markdown has all required provenance fields
2. Path follows `YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug}.md` pattern
3. `conversation_with`, `day_of_week`, `time_of_day` are present and correct
4. Re-running the same sync produces identical files (idempotent)
5. `source_id` matches the message `guid`
6. `title` is human-readable with contact name and time
