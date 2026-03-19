---
title: "Fresh My-Second-Brain Bootstrap"
type: workflow
status: active
updated: 2026-03-17
summary: "Create a clean life-hub repo that starts from the shared Memory OS contract without importing the old vault all at once."
---

# Fresh My-Second-Brain Bootstrap

## Goal

Create a clean new `my-second-brain` repo that starts from the Memory OS contract, with a minimal `CLAUDE.md` + `memory/` + `docs/` structure and no bulk migration.

Follow `docs/claude-md-contract.md` for hot-memory sizing and placement.

This workflow is for:
- starting a fresh personal control-plane repo
- backing up the old vault before any migration
- creating a calm baseline for gradual import

This workflow is not for:
- designing the full personal ontology
- migrating the entire old vault in one step
- deciding every long-term folder convention up front

## Default Approach

1. Back up the current `my-second-brain` repo.
2. Scaffold a fresh life-hub repo with the shared templates.
3. Add it to QMD federation.
4. Start using it with only the minimum durable structure.
5. Migrate old material in curated batches later.

## Scaffold Command

Use:

```sh
~/.config/memory/scripts/bootstrap-life-hub.sh \
  --repo /Users/nathanvale/code/my-second-brain-v2 \
  --name "my-second-brain"
```

This creates:
- `AGENTS.md`
- `CLAUDE.md`
- `docs/`
- `docs/research/`
- `docs/plans/`
- `docs/specs/`
- `docs/decisions/`
- `docs/logs/`
- `docs/artifacts/`
- `memory/`
- `memory/people/`
- `memory/pets/`
- `memory/projects/`
- `memory/context/`

## Recommended First Commit Shape

Keep the first repo intentionally boring:
- shared Memory OS adapter
- hot-memory starter
- base `docs/` and `memory/` directories
- no imported legacy notes yet

## QMD Join Step

After the repo exists:
1. add it to `~/.config/memory/federation/roster.yml`
2. run `~/.config/memory/scripts/qmd-refresh.sh --skip-embed`

## Recommended First Migrated Material

Bring these over first, in small batches:
- active projects
- durable people context
- stable areas of responsibility
- a few high-value personal operating notes

Leave these for later:
- archives
- stale inbox capture
- duplicated notes
- low-signal historical clutter

## Guardrails

- Do not treat the new repo as a dump target.
- Do not copy the old vault wholesale just to feel complete.
- Keep source-of-truth boundaries explicit for work repos versus life-hub synthesis.
- Treat detailed personal ontology and folder nuance as a separate design pass.
