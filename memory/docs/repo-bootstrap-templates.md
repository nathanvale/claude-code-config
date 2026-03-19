---
title: "Repo Bootstrap Templates"
type: reference
status: active
updated: 2026-03-17
summary: "Starter templates for bringing new repos into the Memory OS with minimal setup."
---

# Repo Bootstrap Templates

## Purpose

Make a new repo join the Memory OS with a small amount of copying and editing, instead of redesigning the system each time.

## Template Directory

Use the profile templates in:

- `~/.config/memory/templates/repo-bootstrap/AGENTS.work-repo.md`
- `~/.config/memory/templates/repo-bootstrap/AGENTS.infra-repo.md`
- `~/.config/memory/templates/repo-bootstrap/AGENTS.personal-product.md`
- `~/.config/memory/templates/repo-bootstrap/AGENTS.life-hub.md`
- `~/.config/memory/templates/repo-bootstrap/CLAUDE.work-repo.md`
- `~/.config/memory/templates/repo-bootstrap/CLAUDE.infra-repo.md`
- `~/.config/memory/templates/repo-bootstrap/CLAUDE.personal-product.md`
- `~/.config/memory/templates/repo-bootstrap/CLAUDE.life-hub.md`

For feature and product note flows, also use:

- `~/.config/memory/templates/brainstorm.md`
- `~/.config/memory/templates/product-brief.md`
- `~/.config/memory/templates/spec-prd.md`
- `~/.config/memory/templates/implementation-plan.md`
- `~/.config/memory/templates/TASKS.md`

## Bootstrap Flow

1. Pick the closest repo profile.
2. Copy the matching `AGENTS.*.md` template into the new repo as `AGENTS.md`.
3. Replace placeholder repo and project names.
4. Add one compact hot-memory file if the repo benefits from one.
5. Add the repo to `~/.config/memory/federation/roster.yml`.
6. Run `~/.config/memory/scripts/qmd-refresh.sh --skip-embed`.

## Recommended Local Files

For most repos:
- `AGENTS.md`
- exactly one repo-level hot-memory file, usually `CLAUDE.md`
- `TASKS.md` if the repo has active ongoing work
- `docs/brainstorms/`, `docs/specs/`, and `docs/plans/` when the repo does regular feature shaping

When useful:
- `docs/`
- `memory/`
- `todos/` when the repo needs one-file-per-item task tracking
- repo-specific metadata docs only when the shared contract is not enough

## Notes

- Start lean. Add local complexity only when the repo actually needs it.
- Keep source-of-truth boundaries explicit from day one.
- Prefer changing the template text after use, not before use.
- Follow `~/.config/memory/docs/claude-md-contract.md` for hot-memory sizing and placement.

## Dedicated Life-Hub Bootstrap

For a fresh `my-second-brain` style repo, use:

- `~/.config/memory/docs/my-second-brain-bootstrap.md`
- `~/.config/memory/scripts/bootstrap-life-hub.sh`
