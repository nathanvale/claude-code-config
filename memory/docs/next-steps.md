---
title: "Memory OS Next Steps"
type: roadmap
status: active
updated: 2026-03-17
summary: "Queued follow-up work for turning the Memory OS into a repeatable daily workflow."
---

# Memory OS Next Steps

## Purpose

Capture the next high-value patches so they stay inside the shared Memory OS instead of living only in chat.

## Active Queue

### 1. Memory Recall Example Set

Status:
- complete

Canonical prompt shapes now live in `memory-recall-examples.md` and are referenced by the `federated-recall` workflow.

### 2. Repo Bootstrap Templates

Status:
- complete

Bootstrap guidance now lives in `repo-bootstrap-templates.md`, with ready-to-copy profile templates in `templates/repo-bootstrap/`.

### 3. Query Expansion Model Decision

Status:
- complete

Decision and local helper now live in:
- `qmd-query-mode-decision.md`
- `scripts/qmd-recall.sh`

### 4. NotebookLM Source-Pack Workflow

Status:
- complete

Canonical workflow now lives in:
- `docs/notebooklm-source-pack-workflow.md`
- `scripts/notebooklm-pack.sh`

The shared `notebooklm-pack` skill now points agents through recall, pack scaffolding, and write-back guidance.

### 5. Fresh `my-second-brain` Bootstrap

Status:
- complete

Canonical workflow now lives in:
- `docs/my-second-brain-bootstrap.md`
- `scripts/bootstrap-life-hub.sh`
- `templates/repo-bootstrap/CLAUDE.life-hub.md`

The fresh life-hub path now has a dedicated bootstrap workflow, scaffold helper, and hot-memory starter.

## Notes

- Prefer small, proven workflow layers over a giant one-shot redesign.
- Keep the old repos intact until the new bootstrap path is comfortable and tested.
