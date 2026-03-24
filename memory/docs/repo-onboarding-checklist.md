---
title: "Repo Onboarding Checklist"
type: checklist
status: active
updated: 2026-03-17
summary: "Minimal checklist for bringing a new repo into the shared Memory OS."
---

# Repo Onboarding Checklist

## For Any New Repo

- Pick the closest repo profile.
- Declare what the repo owns as source of truth.
- Reuse the shared note taxonomy where possible.
- Reuse the shared frontmatter philosophy.
- Decide what gets promoted to `my-second-brain`.
- Decide what should never be duplicated.
- Add the repo to the federated recall roster.
- Keep QMD indexing broad and NotebookLM packs selective.

## Minimum Local Files

- `AGENTS.md` or repo-local instructions that point at `~/.config/memory/AGENTS.md`
- one canonical repo-level hot-memory file if the repo benefits from one
- a task surface if work is ongoing
- any repo-specific metadata contract only if the global contract is not enough

If you use a hot-memory file:
- prefer `CLAUDE.md`
- or use `.claude/CLAUDE.md`
- do not keep both at the same repo root
- keep it aligned with `docs/claude-md-contract.md`

## Bootstrap Templates

- Use `docs/repo-bootstrap-templates.md` for the bootstrap flow.
- Use `templates/repo-bootstrap/` for ready-to-copy `AGENTS.md` profile templates.
