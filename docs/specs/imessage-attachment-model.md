---
title: "iMessage Attachment Model"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines binary attachment storage, metadata in frontmatter, extracted text in body, and future Gemini Vision enrichment rules"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-privacy-and-retention.md
  - skills/imessage-reader/scripts/lib.ts
---

# iMessage Attachment Model

## Purpose

Define how binary attachments are stored, referenced in Markdown frontmatter, and enriched over time. The message note is the provenance record for attachment metadata, not the storage location for the binary itself.

## Binary Storage

### Layout

```text
~/code/personal-messages/runtime/imessage/attachments/YYYY/MM/{source-id-slug}/
├── IMG_1234.HEIC
└── invoice.pdf
```

### Path Components

| Segment | Source | Purpose |
|---------|--------|---------|
| `YYYY/MM/` | Immutable parent message `sent_at` | Year/month sharding |
| `{source-id-slug}` | Canonical GUID slugifier v2 | Groups attachments by parent message |

### Rules

- Binary files live in `runtime/`, never in `docs/`
- The Markdown note in `docs/messages/` references attachments by relative path
- Attachments are copied from `~/Library/Messages/Attachments/` on first sync
- Subsequent syncs skip files only when the target path exists and the existing file matches expected metadata
- Filename match alone is not sufficient for idempotency
- In v1, use `size_bytes` as the minimum integrity check before skipping
- When a size mismatch is detected, recopy the file and log the repair in the sync report
- When `sha256` becomes available, it should become the preferred integrity check

## Frontmatter Schema

### Structured Attachments Field

Replace the current flat `attachment_*` fields with a structured `attachments:` list:

```yaml
attachments:
  - id: "att-001"
    kind: image
    filename: "IMG_1234.HEIC"
    mime_type: "image/heic"
    local_path: "runtime/imessage/attachments/2026/03/p-0-ABC123/IMG_1234.HEIC"
    size_bytes: 2849301
    sha256: null
    extracted_text: null
    ai_caption: null
  - id: "att-002"
    kind: document
    filename: "invoice.pdf"
    mime_type: "application/pdf"
    local_path: "runtime/imessage/attachments/2026/03/p-0-ABC123/invoice.pdf"
    size_bytes: 90321
    sha256: null
    extracted_text: "Invoice total $128.00 due Friday"
    ai_caption: null
    ai_keywords: []
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Sequential attachment ID within the message (`att-001`, `att-002`, ...) |
| `kind` | string | `image`, `video`, `audio`, `document`, `other` |
| `filename` | string | Original filename from Messages |
| `mime_type` | string | MIME type from Messages DB |
| `local_path` | string | Relative path from repo root to the binary in `runtime/` |
| `size_bytes` | number | File size from Messages DB |
| `sha256` | string or null | Hash for integrity (future -- null in v1) |
| `extracted_text` | string or null | Text extracted via OCR or native parsing |
| `ai_caption` | string or null | Gemini Vision caption (future enrichment) |
| `ai_keywords` | array | Optional Gemini-derived keywords for retrieval |

### Kind Mapping

```typescript
function attachmentKind(mimeType: string | null): string {
  if (!mimeType) return "other";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "document";
  if (mimeType.startsWith("text/")) return "document";
  return "other";
}
```

### Backwards Compatibility and Migration

The flat `has_attachment`, `attachment_filename`, `attachment_path`, `attachment_original_path`, `attachment_name`, `attachment_mime_type`, `attachment_uti`, `attachment_size`, `attachment_exists` fields are removed in favor of the structured `attachments:` list.

Migration rules:
- legacy notes may still contain flat attachment fields until they are migrated
- new v2 writes must emit only the structured `attachments:` list
- `query-imessage.ts migrate-notes` is responsible for normalizing old notes into the new schema before v2 sync is considered complete
- readers may accept both schemas during the migration window, but writers must not keep reintroducing flat fields

## Body Shape Extension

When a message has attachments, the body gains two new sections:

```markdown
## Message

Raw message text here.

## Attachments

- `IMG_1234.HEIC` - image
- `invoice.pdf` - document

## Attachment Text

### invoice.pdf

Invoice total $128.00 due Friday
```

### Rules

- `## Attachments` always appears if any attachments exist
- `## Attachment Text` only appears if at least one attachment has `extracted_text`
- Each attachment with extracted text gets its own `### filename` subsection
- QMD can search attachment-derived text without indexing binaries

## Text Extraction

### V1: Deterministic Extraction

Run automatically during sync when cheap:

- **PDFs**: Native text extraction via `pdf-parse` or similar
- **Text files**: Direct read
- **Images**: Skip (no OCR in v1)

Text extraction should be written back into the parent Markdown note so QMD and `rg` can search it without indexing binaries.

### Future: Gemini Vision Enrichment

Run as a second-stage enrichment workflow, not during initial sync:

- Write results back as `ai_caption`, `ai_keywords`, or a `## Attachment Analysis` section
- Keep the raw binary as source-of-truth evidence, Vision output as derived enrichment
- Only enrich images that are user-queried, low-metadata, or high-value
- Gate behind explicit opt-in per the privacy spec

### Budget Rules

- OCR first, Vision second
- Small deterministic extraction runs automatically
- Gemini Vision runs only on user-queried, low-metadata, or high-value images
- Cap image count, file size, retries, and total run cost per sync or per day

## Attachment Promotion

Not every attachment should stay buried inside a message note. Candidates for promotion to their own durable note:

- Receipts, invoices
- School documents, medical forms
- Travel confirmations, contracts

Promoted attachments:
- Get their own `artifact-sidecar` note
- Link back to the parent message note via `related:`
- Live in `docs/artifacts/` or similar, not in `docs/messages/`

This is a manual/agent-assisted process, not automated in v1.

## Implementation Target

**File:** `skills/imessage-reader/scripts/lib.ts`

Modified functions:
- `saveMessageAsMarkdown()` -- write structured `attachments:` and body sections
- `buildParsedAttachment()` -- add `kind` field

New functions:
- `attachmentKind()` -- map MIME type to kind
- `copyAttachmentBinary()` -- copy from Messages to corpus repo (future)

Optional follow-up primitive:
- `query-imessage.ts enrich --attachments --source-id <id>` patches extracted text, captions, and keywords onto existing notes without re-running a broad sync window

## Verification

1. Saved markdown has structured `attachments:` list, not flat fields
2. `kind` is correctly derived from MIME type
3. `local_path` is a valid relative path from repo root
4. `## Attachments` section lists all attachments
5. `## Attachment Text` section contains extracted text when available
6. Binary files land in `runtime/imessage/attachments/YYYY/MM/{slug}/`
7. Re-sync does not duplicate binary files
8. Existing files are not skipped solely by filename match when `size_bytes` disagrees
9. Vision-derived `ai_caption` or `ai_keywords` are added only during explicit enrichment, not during base sync
