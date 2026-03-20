---
title: "iMessage Attachment Collation and Recovery"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines how personal-messages ingests backup attachments, resolves missing live assets, and collates a stable repo-local attachment corpus over time"
related:
  - docs/specs/imessage-attachment-model.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-privacy-and-retention.md
  - /Users/nathanvale/code/personal-messages/AGENTS.md
  - skills/imessage-reader/scripts/lib.ts
  - skills/imessage-reader/scripts/query-imessage.ts
---

# iMessage Attachment Collation and Recovery

## Purpose

Define a safe, repo-local attachment strategy for `~/code/personal-messages` that:

- preserves Apple Messages as the live source of truth when files still exist
- uses Nathan's Google Drive backup archive as a fallback source for missing historical assets
- gradually collates attachment files into the message repo over time without mutating `~/Library/Messages/Attachments/`
- keeps message notes truthful even when an attachment cannot yet be restored or resolved

This spec exists because the current corpus is strong for text and link recall, but binary attachment handling still has two gaps:

- some attachment-backed notes point at fake runtime paths that do not exist yet
- older historical attachments may no longer exist in Apple's live Messages folder even though a backup exists elsewhere

## Design Decision

**Do not restore backup files into `~/Library/Messages/Attachments/`.**

Reasoning:

- Apple's attachment store is an internal sharded layout, not a user-authored archive
- Nathan's Google Drive backup is a flat export, not a byte-for-byte clone of the Apple folder tree
- copying the flat archive back into Apple's tree is not deterministic and risks creating false confidence
- the Memory OS should own the recovery and provenance logic instead of mutating the operating system's live store

Instead:

- `~/Library/Messages/Attachments/` remains the preferred live attachment source
- the Google Drive backup becomes a secondary recovery source
- `~/code/personal-messages/runtime/imessage/attachments/` becomes the stable repo-local collation surface

## Goals

- Keep note writes truthful even when attachment binaries are missing
- Make historical backup assets usable without restoring them into Apple Messages
- Support gradual monthly collation of attachments into the repo
- Allow future extraction, OCR, or Vision enrichment to run against repo-local files when available
- Preserve provenance about where each attachment was resolved from

## Non-Goals

- Reconstruct Apple's internal attachment folder layout
- Rewrite or patch `chat.db`
- Guarantee perfect binary recovery for every historical attachment
- Commit binary attachments to git by default
- Run Gemini Vision during base sync

## Attachment Source Hierarchy

Attachment resolution follows this order:

1. `live`
   - `~/Library/Messages/Attachments/`
   - Use when the Apple-referenced file still exists

2. `resolved`
   - `~/code/personal-messages/runtime/imessage/attachments/resolved/`
   - Use when a file has already been collated into the repo

3. `backup`
   - ingested Google Drive attachment archive under `runtime/imessage/attachments/backup/`
   - Use when the live Apple path is missing and a confident backup match exists

4. `missing`
   - No current file found
   - Preserve metadata and mark the attachment as unresolved

Rules:

- a higher-priority source wins
- once a file is collated into `resolved/`, future note rewrites should prefer that stable repo-local file
- unresolved attachments must remain queryable as metadata-only records

## Runtime Layout

Extend the existing repo-local runtime layout:

```text
personal-messages/
└── runtime/
    └── imessage/
        ├── attachments/
        │   ├── live/
        │   │   └── manifests/
        │   ├── backup/
        │   │   ├── imported/
        │   │   └── manifests/
        │   └── resolved/
        │       └── YYYY/
        │           └── MM/
        │               └── <source-id-slug>/
        │                   └── <filename>
        └── manifests/
            ├── attachment-backup-index.jsonl
            ├── attachment-resolution.jsonl
            └── message-paths.jsonl
```

### Folder Roles

| Path | Role |
|------|------|
| `attachments/live/` | Optional manifest-only surface describing current Apple paths |
| `attachments/backup/imported/` | Repo-local mirror or staged copy of backup archive files |
| `attachments/backup/manifests/` | Import bookkeeping for the backup archive |
| `attachments/resolved/` | Stable repo-local files that notes may safely reference |
| `manifests/attachment-backup-index.jsonl` | Searchable index of ingested backup files |
| `manifests/attachment-resolution.jsonl` | Resolution decisions for each attachment candidate |

### Git Rules

- everything under `runtime/` remains gitignored by default
- the repo may grow large locally; this is expected
- if Nathan later wants selective cloud backup of resolved assets, that should be a separate explicit workflow

## Canonical File Policy

### `filename`

`filename` in note frontmatter must always be the basename only.

Examples:

- good: `IMG_1506.heic`
- bad: `~/Library/Messages/Attachments/96/06/.../IMG_1506.heic`

### `local_path`

`local_path` is the repo-relative path to the stable repo-local file when available.

Examples:

```yaml
local_path: "runtime/imessage/attachments/resolved/2025/03/p-0-abc123/IMG_1506.heic"
```

Rules:

- do not fabricate nested paths using the full Apple source path as the filename
- `local_path` should point only to repo-local paths
- if no repo-local file exists yet, `local_path` may be `null`

### `source_path`

Add a new field for the original live Apple path when known.

Example:

```yaml
source_path: "~/Library/Messages/Attachments/96/06/0A4F8E2E-5783-4A2F-B3A5-ACDE2A47D584/IMG_1506.heic"
```

Rules:

- `source_path` is provenance
- `source_path` is not assumed to exist forever
- `source_path` should not be overwritten by repo-local resolution

## Frontmatter Schema Changes

Extend the structured `attachments:` entries from the attachment model spec:

```yaml
attachments:
  - id: "att-001"
    kind: image
    filename: "IMG_1506.heic"
    mime_type: "image/heic"
    source_path: "~/Library/Messages/Attachments/96/06/.../IMG_1506.heic"
    source_exists: false
    local_path: "runtime/imessage/attachments/resolved/2025/03/p-0-abc123/IMG_1506.heic"
    local_exists: true
    resolved_from: backup
    backup_path: "runtime/imessage/attachments/backup/imported/2025/03/IMG_1506.heic"
    size_bytes: 1036947
    sha256: null
    extracted_text: null
    ai_caption: null
```

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| `source_path` | string or null | Original live Apple path from `chat.db` or attachment resolution |
| `source_exists` | boolean | Whether `source_path` currently exists |
| `local_exists` | boolean | Whether `local_path` currently exists |
| `resolved_from` | string | `live`, `resolved`, `backup`, or `missing` |
| `backup_path` | string or null | Repo-relative path to the matched backup asset when applicable |

### Field Rules

- `filename` is always basename only
- `source_path` may exist even when `local_path` is null
- `resolved_from: missing` is valid and should not be treated as an error
- `backup_path` is only set when a backup match has been ingested or staged

## Backup Archive Input

Initial backup source:

```text
/Users/nathanvale/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments
```

Observed shape:

- flat file export
- filenames embed date, human contact hint, and original filename
- includes media files and `.url` link files

Example:

```text
2015-07-03 15 57 30 - Richard Johnson - Web link.url
2024-12-07 12 55 49 - Melanie - IMG_0340.HEIC
```

This archive is not structurally compatible with Apple's live sharded tree, so it must be treated as a separate source.

## Backup Ingest Workflow

### Primitive

Add a dedicated command, separate from `sync` and `enrich`:

```sh
bun run query-imessage.ts attachments import-backup \
  --backup-root "/Users/nathanvale/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments" \
  --save-dir ~/code/personal-messages/docs/messages/imessage
```

### Behavior

1. Walk the flat backup archive.
2. Normalize each filename into an index row.
3. Copy or hard-link each file into `runtime/imessage/attachments/backup/imported/` in a deterministic layout.
4. Write `attachment-backup-index.jsonl`.
5. Do not patch notes yet during import.

### Backup Import Layout

```text
runtime/imessage/attachments/backup/imported/
└── YYYY/
    └── MM/
        └── <normalized-backup-file>
```

Suggested normalized filename:

```text
2024-12-07-125549-melanie-img-0340-heic
```

### Backup Index Row

```json
{
  "schema_version": 1,
  "imported_at": "2026-03-20T18:00:00+11:00",
  "backup_root": "/Users/nathanvale/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments",
  "original_name": "2024-12-07 12 55 49 - Melanie - IMG_0340.HEIC",
  "normalized_name": "2024-12-07-125549-melanie-img-0340-heic",
  "relative_import_path": "runtime/imessage/attachments/backup/imported/2024/12/2024-12-07-125549-melanie-img-0340-heic",
  "basename": "IMG_0340.HEIC",
  "contact_hint": "Melanie",
  "timestamp_hint": "2024-12-07T12:55:49+11:00",
  "size_bytes": 2048576
}
```

## Resolution Workflow

### Primitive

Add a dedicated enrichment mode:

```sh
bun run query-imessage.ts attachments resolve \
  --save-dir ~/code/personal-messages/docs/messages/imessage \
  --since 2000-01-01
```

### Behavior

For each attachment-bearing note:

1. Parse the current `attachments:` entries.
2. Check whether `local_path` exists.
3. If not, check whether `source_path` exists in Apple's live tree.
4. If live source exists:
   - optionally collate into `resolved/`
   - set `resolved_from: live`
5. If live source is missing:
   - search the backup index for a likely match
   - if matched, collate into `resolved/`
   - set `resolved_from: backup`
6. If neither exists:
   - keep metadata intact
   - set `resolved_from: missing`
   - leave `local_path` null unless a resolved file exists

### Matching Strategy

Use a weighted match rather than a single exact string comparison.

Match inputs:

- attachment basename from note or DB
- message `sent_at`
- `conversation_with`
- `size_bytes`
- MIME or extension

Weighted heuristics:

| Signal | Weight |
|--------|--------|
| Exact basename match | High |
| Exact size match | High |
| Timestamp within 2 minutes | High |
| Contact hint matches conversation | Medium |
| Same extension | Medium |
| Fuzzy basename match | Low |

Rules:

- only auto-resolve when confidence exceeds a strict threshold
- ambiguous candidates must remain unresolved rather than guessed
- log all resolution attempts to `attachment-resolution.jsonl`

### Resolution Row

```json
{
  "schema_version": 1,
  "source_id": "p:0/86BC817B-A399-48B1-B1FB-BA0B711AC356",
  "attachment_id": "att-0",
  "filename": "IMG_1506.heic",
  "resolved_from": "backup",
  "confidence": 0.93,
  "source_path": "~/Library/Messages/Attachments/96/06/.../IMG_1506.heic",
  "backup_match_path": "runtime/imessage/attachments/backup/imported/2025/03/2025-03-20-152329-lara-woolf-img-1506-heic",
  "resolved_path": "runtime/imessage/attachments/resolved/2025/03/p-0-86bc817b-a399-48b1-b1fb-ba0b711ac356/IMG_1506.heic",
  "updated_at": "2026-03-20T18:05:00+11:00"
}
```

## Collation Workflow

### Primitive

Add an explicit copy/collate mode:

```sh
bun run query-imessage.ts attachments collate \
  --source live \
  --since 2026-03-01
```

and

```sh
bun run query-imessage.ts attachments collate \
  --source backup \
  --since 2000-01-01
```

### Behavior

- copy the selected resolved source file into `runtime/imessage/attachments/resolved/YYYY/MM/{source-id-slug}/`
- skip only when the existing resolved file matches expected size
- prefer hard-link or clonefile semantics when cheap and supported, but behave like a copy from the caller's perspective
- do not modify `~/Library/Messages/Attachments/`

### Monthly Operation Model

This workflow is expected to be run periodically rather than on every tiny sync:

- daily or normal sync: write notes and metadata only
- occasional enrich: update thread/tapback and attachment resolution state
- monthly collate: bring in newly discovered live assets and backfill resolved historical assets

## Link File Handling

Backup `.url` files are especially valuable because they preserve URLs even when the original preview asset is gone.

Rules:

- treat `.url` as `kind: document` or `kind: other`
- parse the URL target during backup import when cheap
- store extracted URL text in `extracted_text`
- preserve these even when no Apple live source path exists

This is a high-value fallback because link-style messages remain fully searchable in QMD.

## Note Rewrite Rules

When notes are rewritten after attachment resolution:

- preserve all existing message text
- preserve existing thread and tapback metadata
- update only the attachment entries that changed
- do not invent fake local paths
- do not drop unresolved attachment metadata just because no file currently exists

## Privacy Rules

- backup import must stay local-only under `runtime/`
- no cloud AI provider should read imported attachments by default
- file contents should only be extracted locally in deterministic ways unless a later explicit opt-in enrichment mode is used
- resolution manifests must not leak secrets beyond what is already present in the corpus

## Implementation Targets

Primary files:

- `skills/imessage-reader/scripts/lib.ts`
- `skills/imessage-reader/scripts/query-imessage.ts`
- `skills/imessage-reader/scripts/lib.test.ts`

Likely additions:

- attachment backup filename parser
- backup index writer/reader
- attachment resolver scoring helper
- repo-local collate helper

## Suggested Phases

### Phase A: Schema and path honesty

- fix `filename` to basename only
- add `source_path`
- add `source_exists`, `local_exists`, `resolved_from`, `backup_path`
- stop writing fake runtime paths

### Phase B: Backup ingest

- implement `attachments import-backup`
- create backup import index
- no note patching yet

### Phase C: Resolution

- implement `attachments resolve`
- patch notes using live or backup matches
- write resolution manifest

### Phase D: Collation

- implement `attachments collate`
- populate `resolved/`
- make `local_path` point at stable repo-local files

### Phase E: Optional extraction

- local text extraction for PDFs, `.url`, or text files
- later optional OCR/Vision if explicitly requested

## Verification

1. Attachment-bearing notes no longer store full Apple paths in `filename`.
2. `local_path` is either a real repo-relative path or `null`, never a fabricated nested Apple path.
3. `source_path` preserves the original Apple provenance path when known.
4. Backup import creates a deterministic index under `runtime/imessage/manifests/`.
5. Live Apple assets are not modified during backup import or collate.
6. A known missing historical asset can be matched from the backup archive and written into `resolved/`.
7. Ambiguous backup candidates remain unresolved instead of being guessed.
8. `.url` backup files preserve link text for QMD recall.
9. Monthly collate can be rerun safely without duplicating resolved files.
10. Notes remain searchable and valid even when an attachment remains unresolved.

## Definition of Done

This work is ready to implement when:

- the new attachment fields are accepted
- the backup archive is treated as a secondary source rather than an Apple tree restore
- the commands `attachments import-backup`, `attachments resolve`, and `attachments collate` are locked as the implementation surface

At that point, a fresh session can begin coding without reopening the storage strategy.
