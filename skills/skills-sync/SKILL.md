---
name: skills-sync
description: "Manage claude-code-config skill source and harness projections: sync skills, check projection drift, run setup sync/catalog/doctor/unlink after editing first-party skills under skills/."
---

# Skills Sync

Manage first-party skills in `$HOME/code/claude-code-config` and keep harness
projections in sync. The `setup` CLI owns every contract; discover verbs and
flags from `setup commands --json`.

## Rules

- Edit canonical source under `skills/<id>/` only; never generated projections
  in `~/.claude/skills/` or `~/.agents/skills/`.
- Machine reads pass `--json`.

## Workflow

1. After any first-party skill change: `setup sync --check --json`.
2. Clean check after content-only edits: done — live projections carry content.
3. After add, rename, or remove, or when asked to sync: `setup sync`.
4. Unexplained drift or findings: `setup doctor --json`; follow its repair or
   handoff.
5. Inspect source visibility or destination occupancy: `setup catalog --json`
   (one id: `setup catalog <id>`).
6. Remove Setup-owned links only through `setup unlink`.

## Blocked

- `setup` absent from PATH: stop and hand off to `runtime/setup/` (its
  `AGENTS.md` names the owners); never hand-link projections.

No args: run `setup sync --check --json` and report drift plus one next safe
action.
