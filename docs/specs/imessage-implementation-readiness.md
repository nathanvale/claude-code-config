---
title: "iMessage Implementation Readiness Pack"
type: spec
status: planned
updated: 2026-03-20
summary: "Fixture matrix, golden output expectations, migration cases, and pilot acceptance gates for implementing the iMessage corpus and productivity integration"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-attachment-model.md
  - docs/specs/imessage-thread-tapback-enrichment.md
  - docs/specs/imessage-productivity-integration.md
  - docs/specs/imessage-privacy-and-retention.md
---

# iMessage Implementation Readiness Pack

## Purpose

Turn the iMessage spec set into an implementation-ready test target. This doc defines the minimum fixture set, the expected golden outputs, migration cases, and the pilot acceptance checklist so coding can start without more architecture churn.

## Locked Assumptions

These decisions are now locked for implementation unless a later spec explicitly changes them:

- canonical note identity is `source_id`
- note files use canonical GUID slugifier v2, not the legacy `_` variant
- unnamed group chats fall back to sorted participant names before raw handles or `group:{source_thread_id}`
- pure tapback events do not save as standalone Markdown notes by default
- attachment binaries live under `runtime/` and are not QMD-visible
- cloud Vision enrichment is opt-in and out-of-band

## Fixture Pack Scope

Create a small sanitized fixture pack under the implementation repo or test fixtures folder with:

- raw input rows or JSON snapshots needed to simulate Messages DB output
- expected saved Markdown notes
- expected cursor/manifests where relevant
- expected `CommitmentCandidate[]` output where relevant

Target size:
- 10-12 fixtures total
- small enough to reason about by hand
- broad enough to cover every behavior locked by the specs

## Fixture Matrix

| ID | Scenario | Why it exists | Expected outputs |
|----|----------|---------------|------------------|
| `fx-01` | Plain inbound text message | Baseline note save path and frontmatter | 1 Markdown note |
| `fx-02` | Plain outbound text message | Verifies `direction: outbound` and title formatting | 1 Markdown note |
| `fx-03` | Message where `text` is null but `attributedBody` decodes | Covers decoded search and commitment extraction blind spot | 1 Markdown note, searchable decoded body |
| `fx-04` | Message with PDF attachment containing extractable text | Covers `attachments:` plus `## Attachment Text` | 1 Markdown note, 1 binary file |
| `fx-05` | Message with image attachment and no useful metadata | Covers deferred Vision enrichment path | 1 Markdown note, 1 binary file, later enrichment patch |
| `fx-06` | Root message plus direct reply | Covers `thread_depth: 0/1` and `thread_root` | 2 Markdown notes |
| `fx-07` | Nested reply chain of depth 3 | Covers thread walk and caching behavior | 3+ Markdown notes |
| `fx-08` | Tapback add then remove from same sender | Covers tapback cancellation semantics | target note patched, no standalone tapback note |
| `fx-09` | Unnamed group chat with three resolvable participants | Covers sorted participant fallback for `conversation_with` | 1 Markdown note |
| `fx-10` | Ambiguous mixed-context message that looks task-like | Covers `CommitmentCandidate.owner_status = ambiguous` | 1 note, structured candidate, no auto-write |
| `fx-11` | Legacy saved note using old path and old slug variant | Covers `migrate-notes` path normalization | migrated note path, no orphan duplicate |
| `fx-12` | Re-sync of an already-saved message with edited metadata | Covers idempotent patching and cursor safety | existing note updated in place |

## Golden Output Expectations

Each fixture should define one or more golden artifacts.

### Golden note output

For fixtures that save a note, capture:

- relative save path
- full frontmatter
- body sections
- presence or absence of optional fields

Minimum golden assertions:
- `schema_version: 2`
- canonical path matches `YYYY/MM/YYYY-MM-DD-HHmmss-imessage-{guid-slug-v2}.md`
- no deprecated flat `attachment_*` fields on v2 writes
- no duplicate `guid`/`source_id` or `date_local`/`sent_at` duplication in canonical saves

### Golden attachment output

For attachment-bearing fixtures, capture:

- expected binary target path under `runtime/imessage/attachments/`
- expected `attachments:` entries
- expected extracted text in note body when applicable
- expected no-Vision state before enrichment

### Golden enrichment output

For thread/tapback fixtures, capture:

- expected `thread_depth`
- expected `thread_root`
- expected final `tapbacks[]` after add/remove reconciliation
- expected absence of standalone tapback note files

### Golden commitment output

For task-like fixtures, capture:

```json
[
  {
    "schema_version": 1,
    "source_system": "imessage",
    "source_id": "p:0/ABC123",
    "source_thread_id": "chat-123",
    "sent_at": "2026-03-20T20:00:11+11:00",
    "direction": "outbound",
    "conversation_with": "Melanie",
    "candidate_type": "promise",
    "quote": "I'll ask Marilyn now",
    "summary": "Ask Marilyn and report back",
    "confidence": 0.92,
    "owner_hint": "my-second-brain-v2",
    "owner_status": "resolved"
  }
]
```

The point is not exact wording. The point is that implementation emits a stable structured candidate shape.

## Migration Cases

The migration command needs its own test fixtures because this is where orphaned files happen.

### Migration case A: legacy path

Input:
- `docs/messages/imessage/2026/2026-03-20/p_0_ABC123.md`

Expected:
- file moved to `docs/messages/imessage/2026/03/2026-03-20-200011-imessage-p-0-abc123.md`
- frontmatter patched to `schema_version: 2`
- stale legacy file removed

### Migration case B: duplicate slug variants

Input:
- old file using `_`
- old file using `-`
- same `source_id`

Expected:
- one canonical v2 note remains
- duplicate legacy path removed or quarantined deterministically
- manifest points at the canonical path only

### Migration case C: legacy flat attachment fields

Input:
- note with `has_attachment`, `attachment_filename`, `attachment_path`

Expected:
- note rewritten with structured `attachments:`
- deprecated flat fields removed from canonical v2 write

## Pilot Acceptance Checklist

Implementation is ready for a real 7-day pilot only when all of these pass:

1. Repo scaffold exists with `docs/messages/imessage/`, `runtime/imessage/{cursors,manifests,attachments}/`, and `.gitignore`.
2. `sync` can write canonical v2 notes from the fixture pack without manual cleanup.
3. `migrate-notes` rewrites legacy path fixtures idempotently.
4. `enrich` can patch existing notes for threads and tapbacks without broad re-query.
5. Decoded `attributedBody` content is searchable and included in commitment extraction.
6. Attachment fixtures land binaries in `runtime/` and searchable text in Markdown.
7. Group chat fallback uses sorted participant names.
8. Re-running the same sync window does not create duplicate notes or duplicate binaries.
9. Tapback add/remove behavior produces the expected final `tapbacks[]`.
10. Commitment extraction emits `CommitmentCandidate[]` before any task write.
11. Ambiguous ownership does not auto-write into a repo task surface.
12. Base sync runs without cloud AI dependency.
13. Vision enrichment only runs through explicit opt-in.
14. QMD indexes the corpus collection cleanly after the pilot sync.

## Suggested Build Order

Use the fixture pack to drive implementation in this order:

1. repo scaffold and `.gitignore`
2. canonical note contract and save path
3. `migrate-notes`
4. cursor-based `sync`
5. decoded-body search coverage
6. attachment schema and binary copy rules
7. thread/tapback enrichment
8. `enrich` subcommand
9. structured commitment extraction
10. productivity-sync wiring
11. QMD federation verification

## Definition of Ready

The iMessage work is ready to code when:

- the spec set is internally consistent
- the fixture pack exists
- golden outputs are agreed
- the 7-day pilot gate is explicit

At that point, implementation can start without reopening architecture decisions on every code review.
