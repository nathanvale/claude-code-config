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

- `~/.config/context/templates/repo-bootstrap/AGENTS.work-repo.md`
- `~/.config/context/templates/repo-bootstrap/AGENTS.infra-repo.md`
- `~/.config/context/templates/repo-bootstrap/AGENTS.personal-product.md`
- `~/.config/context/templates/repo-bootstrap/AGENTS.life-hub.md`
- `~/.config/context/templates/repo-bootstrap/CLAUDE.work-repo.md`
- `~/.config/context/templates/repo-bootstrap/CLAUDE.infra-repo.md`
- `~/.config/context/templates/repo-bootstrap/CLAUDE.personal-product.md`
- `~/.config/context/templates/repo-bootstrap/CLAUDE.life-hub.md`

For feature and product note flows, also use:

- `~/.config/context/templates/brainstorm.md`
- `~/.config/context/templates/product-brief.md`
- `~/.config/context/templates/spec-prd.md`
- `~/.config/context/templates/implementation-plan.md`
- `~/.config/context/templates/TASKS.md`

## Bootstrap Flow

1. Pick the closest repo profile.
2. Copy the matching `AGENTS.*.md` template into the new repo as `AGENTS.md`.
3. Replace placeholder repo and project names.
4. Add one compact hot-memory file if the repo benefits from one.
5. Add the repo to `~/.config/context/federation/roster.yml`.
6. Run `~/.config/context/scripts/qmd-refresh.sh --skip-embed`.

## Recommended Local Files

For most repos:
- `AGENTS.md`
- exactly one repo-level hot-memory file, usually `CLAUDE.md`
- `TASKS.md` if the repo has active ongoing work
- `docs/brainstorms/`, `docs/specs/`, and `docs/plans/` when the repo does regular feature shaping

When useful:
- `docs/`
- `context/`
- `todos/` when the repo needs one-file-per-item task tracking
- repo-specific metadata docs only when the shared contract is not enough

## Notes

- Start lean. Add local complexity only when the repo actually needs it.
- Keep source-of-truth boundaries explicit from day one.
- Prefer changing the template text after use, not before use.
- Follow `~/.config/context/docs/claude-md-contract.md` for hot-memory sizing and placement.

## Dedicated Life-Hub Bootstrap

For a fresh `my-second-brain` style repo, use:

- `~/.config/context/docs/my-second-brain-bootstrap.md`
- `~/.config/context/scripts/bootstrap-life-hub.sh`
