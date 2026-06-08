---
title: "iMessage Corpus Repo Shape"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines the personal-messages repo layout, ownership boundary, and promotion rules for raw iMessage storage"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-note-contract.md
  - docs/specs/imessage-attachment-model.md
  - docs/specs/imessage-productivity-integration.md
  - docs/specs/imessage-privacy-and-retention.md
---

# iMessage Corpus Repo Shape

## Purpose

Store raw iMessage history in a dedicated repo at `~/code/personal-messages` so that `my-second-brain` stays calm and high-signal. The message corpus belongs inside the Memory OS federation as its own repo and QMD collection, not inside the life hub.

## Repo Profile

**Reference Corpus** -- large indexed content set not authored by us, with provenance and sync infrastructure.

Closest match from repo-profiles.md but with one distinction: this corpus is personal communications rather than vendor docs, so privacy and retention policies are more important.

## Directory Layout

```text
personal-messages/
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── docs/
│   ├── messages/
│   │   └── imessage/
│   │       └── YYYY/
│   │           └── MM/
│   │               └── <message-file>.md
│   └── specs/
│       └── privacy-and-retention.md
└── runtime/
    └── imessage/
        ├── cursors/
        │   └── default-sync.json
        ├── manifests/
        │   ├── message-paths.jsonl
        │   └── runs/
        └── attachments/
            └── YYYY/
                └── MM/
                    └── <source-id-slug>/
                        └── <binary-file>
```

### Surfaces

| Path | Role | QMD-visible |
|------|------|-------------|
| `docs/messages/` | Markdown message notes | Yes |
| `docs/specs/` | Policy documents | Yes |
| `runtime/` | Sync cursors, manifests, attachment binaries | No |

### Rules

- `docs/messages/` is the QMD-searchable Markdown surface
- `runtime/` holds sync cursors, manifests, attachment bookkeeping, and binary files
- Durable people context lives in `my-second-brain/context/people/` or the owning work repo, not here
- Binary attachments live in `runtime/`, never in `docs/`
- `runtime/` state is local operational state and should be gitignored by default

## Ownership Boundary

| Material | Home |
|----------|------|
| Raw message notes | `personal-messages/docs/messages/` |
| Attachment binaries | `personal-messages/runtime/imessage/attachments/` |
| Person notes | `my-second-brain/context/people/` or owning work repo |
| Cross-project synthesis | `my-second-brain` |
| Durable summaries | `my-second-brain` or owning repo |
| Interpreted commitments (tasks) | Owning repo's `TASKS.md` |

### Promotion Rules

Use the corpus repo for **raw evidence**. Use `my-second-brain` for **promoted meaning**:

- Person notes that incorporate message context
- Cross-project synthesis from conversation threads
- Durable summaries of important conversations
- Interpreted commitments once they become tasks or memory updates

Never copy the full raw message body into `my-second-brain`.

## Runtime Contracts

### Cursor files

`runtime/imessage/cursors/default-sync.json` is the canonical incremental sync checkpoint for default-mode productivity sync.

Rules:
- local-only runtime state
- updated only after successful writes
- may intentionally overlap a small lookback window for safety
- deep sync may use a separate cursor or ignore cursors entirely

### Manifests

`runtime/imessage/manifests/message-paths.jsonl` is a local helper index for maintenance operations such as migration and targeted enrichment.

Suggested row shape:

```json
{
  "schema_version": 1,
  "source_id": "p:0/ABC123",
  "relative_path": "docs/messages/imessage/2026/03/2026-03-20-200011-imessage-p-0-abc123.md",
  "slug_version": 2,
  "updated_at": "2026-03-20T20:05:00+11:00"
}
```

Rules:
- local-only helper index, not a second source of truth
- may be rebuilt from the Markdown corpus if lost
- should make migrations and enrich-target resolution faster and more reliable

## Migration and Slug Canonicalization

The repo must support a clean transition from legacy paths and slug rules.

Legacy problems to handle:
- old paths under `YYYY/YYYY-MM-DD/`
- mixed GUID slug behavior such as `/ -> _` versus `/ -> -`

Required primitive:

```sh
bun run query-imessage.ts migrate-notes \
  --save-dir ~/code/personal-messages/docs/messages/imessage
```

Migration rules:
- rewrite legacy paths into the canonical v2 layout
- normalize legacy GUID slug variants into canonical slugifier v2
- patch notes in place rather than leaving stale duplicates behind
- be idempotent and safe to re-run

## Git Hygiene

The repo should include a `.gitignore` that at minimum ignores:

```gitignore
runtime/
```

If a future workflow needs selected runtime files committed, that should be an explicit exception rather than the default.

## AGENTS.md Shape

```yaml
---
title: "Personal Messages"
type: agent-contract
status: active
updated: 2026-03-20
---

# Personal Messages

Raw iMessage corpus for the Memory OS federation.

Profile: reference-corpus
Collection: repo-personal-messages
Primary paths: docs/messages, docs/specs

Rules:
- This repo stores raw message evidence, not synthesized meaning.
- Promote durable people/project context to owning repos, not here.
- Binary attachments live in runtime/, not docs/.
- Privacy-sensitive -- see docs/specs/privacy-and-retention.md.
```

## CLAUDE.md Shape

Lean hot-memory (~30 lines):

```markdown
# Personal Messages

Raw iMessage corpus indexed as `repo-personal-messages` in QMD.

## Search
- `rg` for exact snippets, GUIDs, phone handles
- QMD `repo-personal-messages` for fuzzy, time-based, person-based recall

## Sync
- Default: past 2 days via productivity-sync
- Deep: past 7 days with commitment extraction
- Save target: docs/messages/imessage/YYYY/MM/

## Boundaries
- Raw evidence only -- no synthesis here
- Promote meaning to owning repos or my-second-brain
- Binary attachments in runtime/, searchable metadata in docs/
```

## Verification

1. `~/code/personal-messages` exists as a git repo
2. `docs/messages/imessage/` directory exists
3. `runtime/imessage/{cursors,manifests,attachments}/` directories exist
4. `AGENTS.md` declares the repo as a reference-corpus profile
5. `.gitignore` excludes `runtime/` by default
6. `CLAUDE.md` is under 40 lines
7. `query-imessage.ts migrate-notes` is defined for path and slug migration
