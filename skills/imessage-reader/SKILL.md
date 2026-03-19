---
name: imessage-reader
description: >
  Query and search macOS iMessage history directly from the Messages.app SQLite database,
  like a Gmail MCP for your texts. Every query automatically saves returned messages as
  markdown files with YAML frontmatter — no separate export step needed. Use this skill
  whenever the user asks about their text messages, iMessages, SMS history, or wants to
  search conversations. Triggers include: "what did I text", "messages from", "texts with",
  "iMessage", "show me my texts", "search my messages", "who texted me", "conversation
  with", "what was that text about", or any reference to looking up past messages or
  texting history. Even if the user doesn't say "iMessage" explicitly, if they're asking
  about text conversations, phone messages, or chat history on their Mac, this skill applies.
---

# iMessage Reader

Read and search your iMessage/SMS history by querying the macOS Messages.app
database directly. Works like the Gmail MCP — stateless queries that return
results and automatically persist them as markdown.

## Prerequisites

This skill runs on the host Mac (not inside a VM). It needs:

1. **Bun** installed (`bun --version` to check)
2. **Full Disk Access** granted to the calling process (Terminal, Claude Code, etc.)

If the user gets an "unable to open database" error, they need to enable
Full Disk Access: System Settings → Privacy & Security → Full Disk Access.

## Core Concept: Read-Through Persistence

Every message query automatically saves each returned message as a `.md` file
with YAML frontmatter. Files are always overwritten — no dedup logic. This means:

- Messages that have been edited get the latest version on next read
- The markdown archive grows naturally as the user queries different date ranges
- Semantic search tools (like QMD) can index the markdown folder
- No separate "export" step — reading IS saving

Default save location: `~/Documents/messages/`
Override with `--save-dir` flag. Disable with `--no-save`.

## Commands

Run the script with:
```bash
bun run <skill-path>/scripts/query-imessage.ts <command> [options]
```

### messages — Search and read messages

```bash
# Messages from the past week
bun run <skill-path>/scripts/query-imessage.ts messages --since 2026-03-12

# Messages with a specific contact
bun run <skill-path>/scripts/query-imessage.ts messages --contact "+61412345678" --limit 50

# Search message text
bun run <skill-path>/scripts/query-imessage.ts messages --search "school move" --since 2025-01-01

# Date range
bun run <skill-path>/scripts/query-imessage.ts messages --since 2026-03-01 --until 2026-03-15

# Only sent messages
bun run <skill-path>/scripts/query-imessage.ts messages --from-me --since 2026-03-01

# Include attachment metadata
bun run <skill-path>/scripts/query-imessage.ts messages --contact "Sarah" --include-attachments

# Oldest first (default is newest first)
bun run <skill-path>/scripts/query-imessage.ts messages --since 2026-03-01 --oldest-first

# Save to a specific directory
bun run <skill-path>/scripts/query-imessage.ts messages --since 2026-03-01 --save-dir ~/my-vault/messages

# Query without saving (just read)
bun run <skill-path>/scripts/query-imessage.ts messages --contact "Sarah" --no-save

# Pretty-print JSON output (for human debugging)
bun run <skill-path>/scripts/query-imessage.ts messages --since 2026-03-01 --limit 5 --no-save --pretty
```

Options:
- `--since` / `--until` — Date range (YYYY-MM-DD for local calendar days, or ISO 8601 for exact timestamps)
- `--contact` — Filter by handle (phone/email, partial match)
- `--search` — Full-text search on message body
- `--from-me` / `--to-me` — Direction filter (mutually exclusive)
- `--service` — `iMessage` or `SMS`
- `--limit` — Max results (default 100, max 50000)
- `--oldest-first` — Chronological order (default: newest first)
- `--include-attachments` — Include attachment metadata
- `--save-dir` — Override markdown save location
- `--no-save` — Skip markdown persistence
- `--pretty` — Pretty-print JSON output (default: compact for token efficiency)

### contacts — List contacts with message counts

```bash
bun run <skill-path>/scripts/query-imessage.ts contacts
bun run <skill-path>/scripts/query-imessage.ts contacts --limit 20
```

Returns each contact's handle, service type, total message count, and
first/last message dates. Useful for answering "who do I text the most?"

### threads — List conversation threads

```bash
bun run <skill-path>/scripts/query-imessage.ts threads
bun run <skill-path>/scripts/query-imessage.ts threads --contact "Sarah"
```

Shows group vs 1:1, participant lists, and message counts per thread.

### schema — Inspect database structure

```bash
bun run <skill-path>/scripts/query-imessage.ts schema
```

Dumps table names, columns, types, and row counts. Useful for debugging.

### help — Show available commands

```bash
bun run <skill-path>/scripts/query-imessage.ts help
```

Returns JSON listing all available commands and schema version.

## Output Format

All commands output **compact JSON** to stdout by default (add `--pretty` for
human-readable formatting). Every success and error envelope includes a
`schema_version` field for forward compatibility. Null fields are pruned from
message objects to minimize token usage.

The `messages` command returns:

```json
{"schema_version":1,"count":42,"saved":38,"save_dir":"~/Documents/messages","filters":{"since":"2026-03-01","contact":"Sarah"},"messages":[{"guid":"abc123","text":"Are you picking up Levi today?","is_from_me":false,"date":"2026-03-18T09:32:00.000Z","handle":"+61412345678","contact_name":"Sarah Vale","chat_name":"Sarah Vale","is_group":false}]}
```

`saved` count may be lower than `count` because messages without text
(empty or media-only) don't produce markdown files. If file I/O errors occur,
a `save_errors` count is included in the success envelope.

## Error Handling

All errors are output as structured JSON to stdout for agent consumption:

```json
{"schema_version":1,"error":true,"code":"INVALID_DATE","message":"Invalid date: \"garbage\"","hint":"Use YYYY-MM-DD or ISO 8601 format"}
```

Exit codes:

| Exit Code | Error Code | Meaning |
|-----------|-----------|---------|
| 0 | — | Success |
| 1 | `UNKNOWN_ERROR` | Unexpected failure |
| 2 | `INVALID_ARGS` / `INVALID_DATE` / `INVALID_LIMIT` / `UNKNOWN_FLAG` / `UNKNOWN_COMMAND` | Bad CLI arguments |
| 3 | `DB_ACCESS_DENIED` | Full Disk Access missing |
| 4 | `QUERY_FAILED` | SQL execution error |

Unknown flags are rejected (strict mode) — typos like `--sinc` produce a
structured error instead of being silently ignored, including `help`, `--help`,
and `-h`.

Date validation rejects impossible calendar dates such as `2026-02-31`.
For date-only filters, `--since YYYY-MM-DD` means the start of that local day
on the host Mac, and `--until YYYY-MM-DD` means the end of that local day.
Use ISO 8601 timestamps for exact instants.

## macOS Ventura+ Support (attributedBody)

macOS Ventura and later moved message text from the plain `text` column into a
binary plist blob in `attributedBody`. This skill reads both: if `text` is null
and `attributedBody` exists, it decodes the blob to extract the plain text. If
decoding is low-confidence or fails, the message still appears with placeholder
text `[attributedBody: unable to decode]` rather than guessing from unrelated
metadata in the blob.

## Contact Name Resolution

Handles (phone numbers and emails) are automatically resolved to contact names
by reading the macOS AddressBook SQLite databases. The skill scans all synced
sources under `~/Library/Application Support/AddressBook/Sources/` — this
includes Google Contacts, iCloud, and any other CardDAV accounts.

- Phone numbers are normalized for matching: `0412 667 520`, `+61412667520`,
  and `0412667520` all resolve to the same contact
- Email addresses are matched case-insensitively
- The contact map is built once per invocation and cached
- If the same handle exists in multiple synced sources, the first source in
  sorted source-directory order wins
- If no AddressBook sources exist or none can be opened, the skill degrades
  gracefully — `contact_name` is simply null and raw handles are shown
- The `from` field in markdown frontmatter reflects the actual sender:
  `me` for sent messages, resolved contact name for inbound messages when available

The `contact_name` field appears in `messages` and `contacts` output. It's
pruned from output when null (no match found).

## Markdown File Structure

Files are saved as `{save-dir}/YYYY/YYYY-MM-DD/{guid}.md`:

```
messages/
├── 2026/
│   ├── 2026-03-17/
│   │   ├── abc123.md
│   │   └── def456.md
│   └── 2026-03-18/
│       └── ghi789.md
```

Each file has frontmatter with full metadata (special characters are escaped):

```yaml
---
guid: "abc123"
from: "+61412345678"
handle: "+61412345678"
date: 2026-03-18T09:32:00.000Z
is_from_me: false
service: iMessage
thread: "Sarah Vale"
is_group: false
reply_to: "parent-guid"
has_attachments: true
---

Are you picking up Levi today?
```

## Presenting Results

When showing messages to the user conversationally:

- Format dates in natural language ("last Tuesday at 3pm"), not raw ISO
- Show the contact name/handle clearly
- For group chats, note the chat name and that it's a group
- Tapback reaction codes: 2000=Love, 2001=Like, 2002=Dislike, 2003=Laugh,
  2004=Emphasis, 2005=Question
- `thread_originator` links a reply to its parent message GUID
- Handles are phone numbers or emails — the skill resolves them to contact
  names via AddressBook when available (shown as `contact_name`). If no
  match is found, the raw handle is shown

## Seeding a Full Archive

To build up a complete searchable archive, the user just needs to run a
broad query. Since every read persists, a wide date range seeds the folder:

```bash
bun run <skill-path>/scripts/query-imessage.ts messages --since 2024-01-01 --limit 10000 \
  --oldest-first --save-dir ~/my-vault/messages
```

Subsequent queries for the same date range will overwrite the same files
(capturing any edits). There's no state file or checkpoint — it's idempotent
by design.

For very large histories (50k+ messages), increase `--limit` (max 50000) or
run multiple date-range queries to keep memory usage reasonable.

## Limitations

- **Read-only**: Only reads chat.db, never writes to it
- **Contact names are best-effort**: Names are resolved from the local macOS
  AddressBook SQLite databases (Google Contacts, iCloud, etc.). If no synced
  source DBs exist, or if a handle doesn't match any contact, `contact_name`
  will be null and the raw handle is shown
- **Attachments**: Metadata only — doesn't copy actual media files. Paths
  point to `~/Library/Messages/Attachments/`
- **Full Disk Access**: Required, or the database won't open
- **macOS only**: Queries the local Messages.app database
- **Search vs attributedBody**: `--search` filters at the SQL level on the `text`
  column, so it won't find messages whose text was decoded from `attributedBody`
  (Ventura+ binary plist). Those messages appear in date-range and contact queries
  but are invisible to `--search`
