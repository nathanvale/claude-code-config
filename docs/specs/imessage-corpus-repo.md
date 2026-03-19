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
---

# iMessage Corpus Repo Shape

## Purpose

Store raw iMessage history in a dedicated repo at `~/code/personal-messages` so that `my-second-brain-v2` stays calm and high-signal. The message corpus belongs inside the Memory OS federation as its own repo and QMD collection, not inside the life hub.

## Repo Profile

**Reference Corpus** -- large indexed content set not authored by us, with provenance and sync infrastructure.

Closest match from repo-profiles.md but with one distinction: this corpus is personal communications rather than vendor docs, so privacy and retention policies are more important.

## Directory Layout

```text
personal-messages/
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
        ├── manifests/
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
- Durable people context lives in `my-second-brain-v2/memory/people/` or the owning work repo, not here
- Binary attachments live in `runtime/`, never in `docs/`

## Ownership Boundary

| Material | Home |
|----------|------|
| Raw message notes | `personal-messages/docs/messages/` |
| Attachment binaries | `personal-messages/runtime/imessage/attachments/` |
| Person notes | `my-second-brain-v2/memory/people/` or owning work repo |
| Cross-project synthesis | `my-second-brain-v2` |
| Durable summaries | `my-second-brain-v2` or owning repo |
| Interpreted commitments (tasks) | Owning repo's `TASKS.md` |

### Promotion Rules

Use the corpus repo for **raw evidence**. Use `my-second-brain-v2` for **promoted meaning**:

- Person notes that incorporate message context
- Cross-project synthesis from conversation threads
- Durable summaries of important conversations
- Interpreted commitments once they become tasks or memory updates

Never copy the full raw message body into `my-second-brain-v2`.

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
Primary paths: docs/messages

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
- Promote meaning to owning repos or my-second-brain-v2
- Binary attachments in runtime/, searchable metadata in docs/
```

## Verification

1. `~/code/personal-messages` exists as a git repo
2. `docs/messages/imessage/` directory exists
3. `runtime/imessage/{cursors,manifests,attachments}/` directories exist
4. `AGENTS.md` declares the repo as a reference-corpus profile
5. `CLAUDE.md` is under 40 lines
