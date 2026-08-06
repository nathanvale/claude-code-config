---
title: "Memory OS"
type: agent-contract
status: archived
updated: 2026-07-13
---

# Memory OS

This directory preserves the retired user-scope contract for Nathan's Markdown-first memory system. Archived reference only; current durable context lives in the repository root `context/` and is wired by `./setup sync`.

It lives at `context/archive/legacy-memory-framework/` and was exposed at the stable runtime path `~/.config/context`.

It is shared by:
- Claude Code
- Codex
- user-level skills
- repo-level adapters

Read in this order:
1. `docs/memory-os-contract.md`
2. `docs/review-note-contract.md`
3. `docs/claude-md-contract.md`
4. `docs/feature-note-flow.md`
5. `docs/repo-profiles.md`
6. `docs/retrieval-and-synthesis.md`
7. `docs/notebooklm-source-pack-workflow.md`
8. `docs/notebooklm-operations.md`
9. `docs/repo-onboarding-checklist.md`
10. `docs/repo-bootstrap-templates.md`
11. `docs/my-second-brain-bootstrap.md`
12. `docs/productivity-integration.md`
13. `docs/next-steps.md`

Rules:
- Repos own operational truth.
- `CLAUDE.md` is repo-local hot memory, not durable memory.
- `my-second-brain` owns synthesis, personal control-plane context, and promoted durable knowledge.
- Frontmatter is routing, not a second body.
- Promotion is selective.
- QMD is the broad recall layer.
- NotebookLM is the selective synthesis layer.
- Skills teach agents how to operate the system. They do not replace source-of-truth docs.
