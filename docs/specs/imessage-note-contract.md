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
  - docs/specs/imessage-privacy-and-retention.md
  - skills/imessage-reader/scripts/lib.ts
---

# iMessage Note Contract

## Purpose

Lock the Markdown note shape, filename convention, and frontmatter schema before wiring more consumers. Every message saves as one Markdown note with a stable sharded path and provenance-heavy frontmatter.

## Save Path

### Pattern

```text
{save-dir}/YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug-v2}.md
```

### Example

```text
~/code/personal-messages/docs/messages/imessage/2026/03/2026-03-20-200011-imessage-p-0-abc123.md
```

### Components

| Segment | Source | Purpose |
|---------|--------|---------|
| `YYYY/MM/` | Immutable `sent_at` | Year/month sharding to avoid huge flat dirs |
| `YYYY-MM-DD` | Immutable `sent_at` | Human-scannable date prefix |
| `HHmmss` | Immutable `sent_at` | Time component for uniqueness |
| `imessage` | Literal | Source system identifier |
| `{guid-slug-v2}` | Canonical GUID slugifier v2 | Stable unique suffix |

Canonical GUID slugifier v2:
- lowercase the GUID
- replace any non-alphanumeric character with `-`
- collapse repeated `-`
- trim leading/trailing `-`

This replaces older slug variants that used `_` for `/` and produced orphan-prone filenames.

### Migration from Current Path

Current legacy patterns:
- `{save-dir}/YYYY/YYYY-MM-DD/{guid-slug-v1}.md`
- mixed slug variants where `/` becomes `_` or `-`

New canonical pattern:
- `{save-dir}/YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug-v2}.md`

Changes:
- Add month-level sharding (`MM/`)
- Add timestamp and source system to filename
- Remove date-only subfolder in favor of flatter month directory
- Canonicalize GUID slugs under a single v2 rule

Migration rule:
- a dedicated `query-imessage.ts migrate-notes` command must rename legacy files into the canonical v2 layout before v2 sync becomes the default
- the migration must be idempotent and safe to re-run
- once a note exists for a `source_id`, future syncs must reuse that canonical path even if filename rules evolve again

## Frontmatter Schema

### Required Fields

```yaml
---
schema_version: 2
title: "iMessage with Melanie at 2026-03-20 20:00"
type: artifact-sidecar
status: active
updated: 2026-03-20
source_system: imessage
source_id: "p:0/ABC123"
source_thread_id: "chat-123"
sent_at: "2026-03-20T20:00:11+11:00"
direction: outbound
message_kind: text
from: "me"
handle: "+61400000000"
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
| `schema_version` | number | Literal | Note contract version. Start at `2` for the canonical corpus shape |
| `title` | string | Computed | "iMessage with {contact} at {sent_at}" |
| `type` | string | Literal | Always `artifact-sidecar` |
| `status` | string | Literal | Always `active` |
| `updated` | string | Computed | Date-only from `sent_at` |
| `source_system` | string | Literal | Always `imessage` |
| `source_id` | string | `guid` | Stable uniqueness key for idempotent re-sync |
| `source_thread_id` | string | `chat_id` | Chat/thread identifier |
| `sent_at` | string | Raw message timestamp | Immutable local wall time the message was sent |
| `direction` | string | `is_from_me` | `outbound` or `inbound` |

#### Conversation fields (new)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `conversation_with` | string | Computed | Resolved contact name of the other party |
| `conversation_type` | string | `is_group` | `direct` or `group` |
| `day_of_week` | string | `date_local` | e.g. "Friday" |
| `time_of_day` | string | `date_local` hour | `morning` (5-12), `afternoon` (12-17), `evening` (17-21), `night` (21-5) |

#### Preserved raw fields

These fields remain useful and are preserved in v2 when present:
- `message_kind`
- `from`
- `handle`
- `is_from_me`
- `service`
- `thread`
- `is_group`
- `group_guid`
- `part_index`
- `contact_name`
- `thread_originator`
- `reply_to_raw`
- `reply_to`
- `reaction_to_raw`
- `reaction_to`
- `reaction_type`
- `subject`
- `edited`
- `date_edited`
- `date_edited_local`

#### Deprecated compatibility fields

These fields are readable during migration but should not be written by new v2 saves:
- `guid` in favor of `source_id`
- `source_guid` unless a raw upstream identifier distinct from `source_id` is genuinely needed
- `date_local` in favor of `sent_at`
- flat `attachment_*` fields in favor of the structured `attachments:` list from the attachment model spec

### Optional Fields

```yaml
related:
  - /Users/nathanvale/code/my-second-brain-v2/memory/people/melanie.md
attachments:
  - id: "att-001"
    kind: image
    filename: "IMG_1234.HEIC"
tapbacks:
  - type: "Love"
    from: "Melanie"
    guid: "p:0/XYZ789"
thread_depth: 0
thread_root: "p:0/ABC123"
```

The `related` field is populated when the `conversation_with` contact can be resolved to a known person file in the Memory OS. This is a future enhancement -- v1 may omit it.

Additional optional fields:
- `attachments` from the attachment model spec
- `tapbacks`, `thread_depth`, and `thread_root` from the thread/tapback enrichment spec

## Conversation Field Computation

### `conversation_with`

```
if is_from_me:
  use chat's contact_name or chat_id handle
else:
  use contact_name or handle
```

For group chats, this becomes the chat display name when one exists.

For unnamed group chats, use this fallback order:
1. explicit chat display name
2. first 2-3 resolved participant names sorted alphabetically and joined with `, `
3. first 2-3 participant handles sorted alphabetically and joined with `, `
4. `group:{source_thread_id}` as a last resort

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

### Persistence policy by message kind

- Standard text and media-bearing messages save as standalone Markdown notes
- Pure tapback reaction messages do not save as standalone Markdown notes by default
- Tapbacks are aggregated onto the target message via `tapbacks[]`
- A debug or audit mode may persist raw tapback events outside the default QMD-visible surface, but that is not part of the default note contract

### Text messages

```markdown
## Message

Raw message text here.
```

### Messages with attachments

See the attachment model spec for the extended body shape with `## Attachments`, `## Attachment Text`, and optional `## Attachment Analysis` sections.

## Idempotency

- `source_id` (which equals `guid`) is the stable uniqueness key
- Repeated syncs overwrite the existing note at the same path
- Edits, tapbacks, and later enrichments patch the same note deterministically
- The canonical path is derived from immutable `sent_at` plus the canonical GUID slugifier
- Writers must prefer resolving an existing note by `source_id` before generating a fresh path, so future path-rule changes do not orphan the note

## Implementation Target

**File:** `skills/imessage-reader/scripts/lib.ts` -- `saveMessageAsMarkdown()` function

## Verification

1. Saved markdown has all required provenance fields
2. Path follows `YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug-v2}.md` pattern
3. `conversation_with`, `day_of_week`, and `time_of_day` are present and correct
4. Unnamed group chats use participant-name fallback before a raw group identifier
5. Re-running the same sync produces identical files (idempotent)
6. `source_id` remains the stable message identity
7. `title` is human-readable with contact name and time
