---
title: "iMessage Attachment Sidecars and Google Drive Recovery"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines how personal-messages points at Google Drive backed attachment archives, resolves missing live assets, and keeps repo-local manifests plus optional cache"
related:
  - docs/specs/imessage-attachment-model.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-privacy-and-retention.md
  - /Users/nathanvale/code/personal-messages/AGENTS.md
  - skills/imessage-reader/scripts/lib.ts
  - skills/imessage-reader/scripts/query-imessage.ts
---

# iMessage Attachment Sidecars and Google Drive Recovery

## Purpose

Define a safe attachment strategy for `~/code/personal-messages` that:

- preserves Apple Messages as the live source of truth when files still exist
- uses Nathan's Google Drive backup archive as the managed fallback source for missing historical assets
- keeps long-term backup binaries in Google Drive rather than in the git repo
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

Also:

- `~/Library/Messages/Attachments/` remains the preferred live attachment source
- the Google Drive backup becomes the canonical managed recovery source for historical assets
- `~/code/personal-messages/runtime/imessage/attachments/` becomes a manifest and optional cache surface, not the canonical long-term backup store
- the Google Drive design should support both a read-only legacy archive and a canonical archive with stable naming

## Goals

- Keep note writes truthful even when attachment binaries are missing
- Make historical backup assets usable without restoring them into Apple Messages
- Support gradual monthly indexing and optional cache hydration from Google Drive
- Allow future extraction, OCR, or Vision enrichment to run against live files or temporary cache files when available
- Preserve provenance about where each attachment was resolved from

## Non-Goals

- Reconstruct Apple's internal attachment folder layout
- Rewrite or patch `chat.db`
- Guarantee perfect binary recovery for every historical attachment
- Store the full Google Drive backup corpus in git
- Run Gemini Vision during base sync

## Attachment Source Hierarchy

Attachment resolution follows this order:

1. `live`
   - `~/Library/Messages/Attachments/`
   - Use when the Apple-referenced file still exists

2. `gdrive`
   - configured Google Drive backup root
   - Use when the live Apple path is missing and a confident backup match exists

3. `cache`
   - `~/code/personal-messages/runtime/imessage/attachments/cache/`
   - Use when a file has been materialized locally for extraction or inspection

4. `missing`
   - No current file found
   - Preserve metadata and mark the attachment as unresolved

Rules:

- a higher-priority source wins
- once a file is cached locally, future enrich steps may reuse that local cache
- unresolved attachments must remain queryable as metadata-only records

## Google Drive Archive Model

Use two Google Drive roots over time:

1. `legacy`
   - existing iMazing-style export
   - read-only migration input
   - filenames may be inconsistent or overly human-oriented

2. `canonical`
   - future managed archive for attachments copied out of Apple Messages
   - deterministic folder layout
   - immutable identity baked into the path and filename
   - descriptive suffix may improve over time

Rules:

- do not mass-rename the legacy archive in place
- all new copied attachments should land in the canonical archive
- the resolver should prefer `live`, then `canonical`, then `legacy`
- future Gemini Vision enrichment may improve descriptive naming, but must not change immutable attachment identity

## Runtime Layout

Extend the existing repo-local runtime layout:

```text
personal-messages/
└── runtime/
    └── imessage/
        ├── attachments/
        │   ├── cache/
        │   │   └── YYYY/
        │   │       └── MM/
        │   │           └── <source-id-slug>/
        │   │               └── <filename>
        │   └── manifests/
        │       ├── backup-index.jsonl
        │       └── cache-index.jsonl
        └── manifests/
            ├── attachment-resolution.jsonl
            └── message-paths.jsonl
```

### Folder Roles

| Path | Role |
|------|------|
| `attachments/cache/` | Optional local cache for extraction or inspection |
| `attachments/manifests/backup-index.jsonl` | Searchable index of configured Google Drive backup files |
| `attachments/manifests/cache-index.jsonl` | Local cache bookkeeping |
| `manifests/attachment-resolution.jsonl` | Resolution decisions for each attachment candidate |

### Git Rules

- everything under `runtime/` remains gitignored by default
- local cache may grow, but the canonical backup corpus should remain outside git
- if Nathan later wants selected assets mirrored elsewhere, that should be an explicit opt-in workflow

## Canonical File Policy

### `filename`

`filename` in note frontmatter must always be the basename only.

Examples:

- good: `IMG_1506.heic`
- bad: `~/Library/Messages/Attachments/96/06/.../IMG_1506.heic`

### `local_path`

`local_path` is the repo-relative path to an optional local cache file when available.

Examples:

```yaml
local_path: "runtime/imessage/attachments/cache/2025/03/p-0-abc123/IMG_1506.heic"
```

Rules:

- do not fabricate nested paths using the full Apple source path as the filename
- `local_path` should point only to repo-local cache paths
- if no local cache exists, `local_path` may be `null`

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

### `backup_path`

Add a new field for the configured Google Drive backed fallback file when known.

Example:

```yaml
backup_path: "~/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments/2024-12-07 12 55 49 - Melanie - IMG_0340.HEIC"
```

Rules:

- `backup_path` points at the Google-managed archive location, not a git-tracked repo file
- `backup_path` is allowed even when `source_path` no longer exists
- `backup_path` should only be set after a confident match

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
    backup_path: "~/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments/2025-03-20 15 23 29 - Lara Woolf - IMG_1506.heic"
    backup_exists: true
    local_path: null
    local_exists: false
    resolved_from: gdrive
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
| `backup_path` | string or null | Google Drive archive path for the matched fallback asset |
| `backup_exists` | boolean | Whether `backup_path` currently exists |
| `local_exists` | boolean | Whether `local_path` currently exists |
| `resolved_from` | string | `live`, `gdrive`, `cache`, or `missing` |

### Field Rules

- `filename` is always basename only
- `source_path` may exist even when `local_path` is null
- `backup_path` may exist even when `local_path` is null
- `resolved_from: missing` is valid and should not be treated as an error
- `backup_path` is only set when a Google Drive match has been resolved

## Repo Config

Attachment recovery should be configured from a repo-local YAML file rather than hard-coded paths.

Suggested file:

```text
~/code/personal-messages/.imessage.yml
```

Suggested shape:

```yaml
schema_version: 1
attachments:
  live_roots:
    - "~/Library/Messages/Attachments"
  backup_roots:
    - name: "gdrive-legacy"
      provider: "gdrive"
      path: "~/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments"
      mode: "legacy"
    - name: "gdrive-canonical"
      provider: "gdrive"
      path: "~/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments Canonical"
      mode: "canonical"
  cache_root: "runtime/imessage/attachments/cache"
  prefer_local_cache: true
```

Rules:

- this file lives in `personal-messages`, not in `claude-code-config`
- `backup_roots` may contain one or more Google Drive locations
- canonical and legacy Drive roots should be distinguishable by `mode`
- future machines can override the paths without changing code
- if the file is missing, the reader should default to live Apple roots only

## Canonical Google Drive Naming

### Identity Rule

Every canonical Google Drive attachment filename must include an immutable attachment identity prefix.

Recommended identity components:

- `source-id-slug`
- `attachment-id`

The human-readable suffix may change later, but the immutable identity prefix must not.

### Canonical Pattern

```text
YYYY/MM/{source-id-slug}/{source-id-slug}__{attachment-id}__{descriptive-slug}.{ext}
```

Example:

```text
2025/03/p-0-86bc817b-a399-48b1-b1fb-ba0b711ac356/p-0-86bc817b-a399-48b1-b1fb-ba0b711ac356__att-0__lara-photo-at-playground.heic
```

### Rules

- the immutable prefix is mandatory
- the descriptive suffix is optional at first and may start as the original basename
- later renames may improve only the descriptive suffix
- future Gemini Vision enrichment may propose better suffixes, but must not change the immutable prefix
- sidecars should preserve both the current canonical path and the original basename

## Backup Archive Input

Initial legacy backup source:

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

This archive is not structurally compatible with Apple's live sharded tree, so it must be treated as a separate sidecar source.

Future canonical source:

- a dedicated Google Drive folder for deterministic attachment storage
- new attachments copied from Apple Messages should land there with canonical filenames

## Backup Ingest Workflow

### Primitive

Add a dedicated command, separate from `sync` and `enrich`:

```sh
bun run query-imessage.ts attachments index-backup \
  --save-dir ~/code/personal-messages/docs/messages/imessage
```

### Behavior

1. Walk the flat backup archive.
2. Normalize each filename into an index row.
3. Do not copy the full archive into the repo.
4. Write `runtime/imessage/attachments/manifests/backup-index.jsonl`.
5. Do not patch notes yet during import.

### Backup Index Row

```json
{
  "schema_version": 1,
  "indexed_at": "2026-03-20T18:00:00+11:00",
  "backup_root_name": "gdrive-legacy",
  "provider": "gdrive",
  "backup_root": "/Users/nathanvale/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments",
  "original_name": "2024-12-07 12 55 49 - Melanie - IMG_0340.HEIC",
  "backup_path": "/Users/nathanvale/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments/2024-12-07 12 55 49 - Melanie - IMG_0340.HEIC",
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
   - optionally hydrate local cache
   - set `resolved_from: live`
5. If live source is missing:
   - search the canonical Drive index for a likely match
   - if matched, set `backup_path`
   - optionally hydrate local cache
   - set `resolved_from: gdrive`
6. If no canonical match exists:
   - search the backup index for a likely match
   - if matched, set `backup_path`
   - optionally hydrate local cache
   - set `resolved_from: gdrive`
7. If neither exists:
   - keep metadata intact
   - set `resolved_from: missing`
   - leave `local_path` null unless a cache file exists

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
  "resolved_from": "gdrive",
  "confidence": 0.93,
  "source_path": "~/Library/Messages/Attachments/96/06/.../IMG_1506.heic",
  "backup_match_path": "~/Library/CloudStorage/GoogleDrive-hi@nathanvale.com/My Drive/04 Archives/Text Message History/Attachments/2025-03-20 15 23 29 - Lara Woolf - IMG_1506.heic",
  "cache_path": null,
  "updated_at": "2026-03-20T18:05:00+11:00"
}
```

## Canonical Drive Copy Workflow

### Primitive

Add an explicit command for moving newly discovered attachments into the canonical Google Drive archive:

```sh
bun run query-imessage.ts attachments copy-to-drive \
  --since 2026-03-01 \
  --drive-root gdrive-canonical
```

### Behavior

- use the live Apple file when available
- compute the canonical Drive destination path from message identity and attachment identity
- preserve immutable identity prefix in the final Drive filename
- initially use a safe descriptive suffix derived from the original basename
- record the resulting canonical Drive path in note sidecars and manifests
- do not rename legacy archive files in place

### Future Rename Workflow

Gemini Vision may later enrich or improve the descriptive suffix for canonical Drive files.

Rules:

- do not change the immutable identity prefix
- record rename history in sidecar metadata or manifests
- update `backup_path` to the current canonical Drive path after a successful rename
- preserve the original basename separately for traceability

## Cache Hydration Workflow

### Primitive

Add an explicit cache mode:

```sh
bun run query-imessage.ts attachments hydrate-cache \
  --source live \
  --since 2026-03-01
```

and

```sh
bun run query-imessage.ts attachments hydrate-cache \
  --source gdrive \
  --since 2000-01-01
```

### Behavior

- copy or link the selected source file into `runtime/imessage/attachments/cache/YYYY/MM/{source-id-slug}/`
- skip only when the existing cache file matches expected size
- prefer hard-link or clonefile semantics when cheap and supported, but behave like a copy from the caller's perspective
- do not modify `~/Library/Messages/Attachments/`
- do not treat cache files as canonical long-term storage

### Monthly Operation Model

This workflow is expected to be run periodically rather than on every tiny sync:

- daily or normal sync: write notes and metadata only
- occasional enrich: update thread/tapback and attachment resolution state
- monthly index/resolve: refresh Google Drive sidecars and missing-asset matches
- optional cache hydration: materialize only the files needed for extraction or review

## Link File Handling

Backup `.url` files are especially valuable because they preserve URLs even when the original preview asset is gone.

Rules:

- treat `.url` as `kind: document` or `kind: other`
- parse the URL target during backup indexing when cheap
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
- Google Drive archive paths are treated as configured sidecars, not as repo-owned binaries
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
- repo config reader for `.imessage.yml`
- backup index writer/reader
- attachment resolver scoring helper
- canonical Drive destination builder
- repo-local cache hydration helper

## Suggested Phases

### Phase A: Schema and path honesty

- fix `filename` to basename only
- add `source_path`
- add `source_exists`, `local_exists`, `resolved_from`, `backup_path`
- stop writing fake runtime paths

### Phase B: Backup ingest

- implement `.imessage.yml` config loading
- implement `attachments index-backup`
- create backup sidecar index
- no note patching yet

### Phase B2: Canonical Drive model

- add canonical Drive root support to config
- implement canonical destination naming with immutable identity prefix
- add `attachments copy-to-drive` contract

### Phase C: Resolution

- implement `attachments resolve`
- patch notes using live or Google Drive matches
- write resolution manifest

### Phase D: Optional cache

- implement `attachments hydrate-cache`
- populate `cache/` only when needed
- make `local_path` point at local cache files when present

### Phase E: Optional extraction

- local text extraction for PDFs, `.url`, or text files
- later optional OCR/Vision if explicitly requested
- later optional descriptive-suffix renaming for canonical Drive files, preserving immutable identity prefix

## Verification

1. Attachment-bearing notes no longer store full Apple paths in `filename`.
2. `local_path` is either a real repo-relative path or `null`, never a fabricated nested Apple path.
3. `source_path` preserves the original Apple provenance path when known.
4. Backup indexing creates a deterministic sidecar index under `runtime/imessage/attachments/manifests/`.
5. Live Apple assets are not modified during backup indexing or cache hydration.
6. A known missing historical asset can be matched from the Google Drive archive without copying the full archive into the repo.
7. Ambiguous backup candidates remain unresolved instead of being guessed.
8. `.url` backup files preserve link text for QMD recall.
9. Monthly index/resolve can be rerun safely without duplicating cache files or corrupting notes.
10. Notes remain searchable and valid even when an attachment remains unresolved.
11. Canonical Drive filenames always retain the immutable identity prefix even after descriptive renames.

## Definition of Done

This work is ready to implement when:

- the new attachment fields are accepted
- the backup archive is treated as a Google Drive sidecar source rather than an Apple tree restore
- the repo-local `.imessage.yml` config shape is accepted
- the commands `attachments index-backup`, `attachments resolve`, and `attachments hydrate-cache` are locked as the implementation surface

At that point, a fresh session can begin coding without reopening the storage strategy.
