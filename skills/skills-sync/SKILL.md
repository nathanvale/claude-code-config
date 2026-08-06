---
name: skills-sync
description: "Sync first-party projections and manifest-managed third-party skills; check monthly for gog CLI and upstream skill updates."
---

# Skills Sync

Keep first-party skills live-linked and third-party skills reproducible. The
repository-local `./setup` CLI owns first-party projection.
`skills-sources.yml` owns reviewed providers, commits, and allowlists;
`src/third-party-skills-cli.ts` owns lock generation, restore, and integrity.
The pinned `skills` CLI remains the copy installer behind that owner.

Read [references/third-party-skills.md](references/third-party-skills.md) for
registry operations. For official gog skills and the monthly CLI check, read
[references/gog-skills.md](references/gog-skills.md).
For Matt Pocock skills, read
[references/mattpocock-skills.md](references/mattpocock-skills.md).

## Rules

- Before any Setup action, `cd "$HOME/code/claude-code-config"` and invoke
  `./setup`; never resolve `setup` through PATH.
- Edit canonical source under `skills/<id>/` only; never generated projections
  in `~/.claude/skills/` or `~/.agents/skills/`.
- Machine reads pass `--json`.
- Never invoke third-party package mutation directly. Use
  `bun run skills/skills-sync/src/third-party-skills-cli.ts`.
- Removed selections use previewed `prune` before lock regeneration; its hash
  gates protect locally changed copies. Execution requires an explicit scope.

## Workflow

1. After any first-party skill change: `./setup sync --check --json`.
2. Clean check after content-only edits: done — live projections carry content.
3. After add, rename, or remove, or when asked to sync: `./setup sync`.
4. Unexplained drift or findings: `./setup doctor --json`; follow its repair or
   handoff.
5. Inspect source visibility or destination occupancy: `./setup catalog --json`
   (one id: `./setup catalog <id>`).
6. Remove Setup-owned links only through `./setup unlink`.

## Gog Skills

- Refresh requested: follow `references/gog-skills.md`, then run
  `./setup sync --check --json`.
- Any skills-sync run: perform the monthly gog freshness gate when due.
- Do not copy upstream gog skills into `skills/`; keep selection policy in
  `skills-sources.yml` and generated hash evidence in `skills-lock.json`.

## Matt Pocock Skills

- Treat the `mattpocock/skills` allowlist in `skills-sources.yml` as the
  selected set.
- Any skills-sync run: perform the monthly Matt freshness gate when due.
- Selection or refresh requested: follow `references/mattpocock-skills.md`.

## Blocked

- `$HOME/code/claude-code-config/setup` absent or not executable: stop and hand
  off to `runtime/setup/` (its `AGENTS.md` names the owners); never hand-link
  projections.

No args: run due monthly source gates, then `./setup sync --check --json`;
run the third-party `check --json`; report drift plus one next safe action.
