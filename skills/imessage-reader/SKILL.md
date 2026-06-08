---
name: imessage-reader
description: "Query and search macOS iMessage history directly from the Messages.app SQLite database, like a Gmail MCP for texts. Use when the user asks about text messages, iMessages, SMS history, message search, phone-message history, or Mac chat history."
role: tool-workflow
---

# iMessage Reader

Read and search your iMessage/SMS history by querying the macOS Messages.app
database directly. Works like the Gmail MCP — stateless queries that return
results and automatically persist them as markdown.

## Owner

- CLI, parser, defaults, flags, exit codes, and JSON envelopes: `skills/imessage-reader/scripts/query-imessage.ts`.
- Message parsing, persistence layout, contact resolution, markdown frontmatter, and migration behavior: `skills/imessage-reader/scripts/lib.ts`.
- Runtime tests: `skills/imessage-reader/scripts/lib.test.ts`.
- Storage routing when save location is unclear: `skills/context-advisor/SKILL.md`.

## Prerequisites

- Run on the host Mac.
- Check Bun with `bun --version`.
- Require Full Disk Access for the calling process.

If the user gets an "unable to open database" error, they need to enable
Full Disk Access: System Settings > Privacy & Security > Full Disk Access.

## Core Concept: Read-Through Persistence

Message queries save returned messages as `.md` files with YAML frontmatter.
Files are overwritten so edited messages refresh on next read. This means:

- Messages that have been edited get the latest version on next read
- The markdown archive grows naturally as the user queries different date ranges
- Search and indexing tools can index the markdown folder
- No separate "export" step — reading IS saving

Save defaults, save overrides, and no-save behavior live in
`skills/imessage-reader/scripts/query-imessage.ts`.

## Storage Safety

- Treat saved message archives as durable sensitive context.
- Use `--no-save` when the user wants a one-off inspection without durable files.
- Use `skills/context-advisor/SKILL.md` when save directory, owning repo, privacy boundary, retention, deletion, or cross-repo promotion is unclear.
- If `context-advisor` is unavailable, read `skills/context-advisor/references/storage-routing.md`.
- Do not save raw message archives into a project repo unless that repo is the accepted owner.

## Commands

- Inspect available commands: `bun run skills/imessage-reader/scripts/query-imessage.ts help`.
- Inspect database shape only when debugging: `bun run skills/imessage-reader/scripts/query-imessage.ts schema`.
- Use `messages` for text search, contact search, date windows, direction filters, attachments, and archive seeding.
- Use `contacts` to find high-volume contacts before narrowing a query.
- Use `threads` for group or 1:1 conversation summaries.
- Use `sync` for incremental corpus sync.
- Use `migrate-notes` only when rewriting legacy saved notes.

Examples:

```bash
bun run skills/imessage-reader/scripts/query-imessage.ts messages --since 2026-03-01
bun run skills/imessage-reader/scripts/query-imessage.ts messages --contact "+61412345678" --limit 50
bun run skills/imessage-reader/scripts/query-imessage.ts messages --search "school move" --since 2025-01-01
bun run skills/imessage-reader/scripts/query-imessage.ts messages --contact "Sarah" --no-save
```

## Verification

- Run `bun test skills/imessage-reader/scripts/lib.test.ts` after parser, persistence, migration, or contact-resolution changes.
- Run `bun run skills/imessage-reader/scripts/query-imessage.ts help` after CLI interface edits.
- Run host-Mac database checks only when debugging permissions, database shape, or saved-message behavior.

## Output And Errors

- Parse JSON stdout.
- Read success fields, error fields, exit codes, date parsing, strict flags, and message part semantics from `skills/imessage-reader/scripts/query-imessage.ts`.
- Read saved-note shape and migration behavior from `skills/imessage-reader/scripts/lib.ts`.
- Do not copy output envelopes, frontmatter fields, parser rules, or exit tables into this file.

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

## Saved-Message Shape

Saved-message shape and persistence (markdown structure, frontmatter fields,
tapback codes, contact resolution) are owned by
`skills/imessage-reader/scripts/lib.ts` — see its TypeScript types and output
contract. This file covers when to run the CLI, not the output shape.

## Presenting Results

When showing messages to the user conversationally:

- Format dates in natural language ("last Tuesday at 3pm"), not raw ISO
- Show the contact name/handle clearly
- For group chats, note the chat name and that it's a group
- Decode tapback reaction codes to their labels (owner: `lib.ts`)
- For replies, surface the parent message they thread from

## Seeding a Full Archive

To build up a complete searchable archive, the user just needs to run a
broad query. Since every read persists, a wide date range seeds the folder:

```bash
bun run skills/imessage-reader/scripts/query-imessage.ts messages --since 2024-01-01 --limit 10000 \
  --oldest-first --save-dir ~/code/personal-messages/docs/messages/imessage
```

Subsequent queries for the same date range will overwrite the same files
(capturing any edits). There's no state file or checkpoint — it's idempotent
by design.

For large histories, run multiple date-range queries to keep memory usage
reasonable. Check the runtime owner for current limits.

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
- **Search behavior**: broad searches may be slower than narrow date or contact filters.
