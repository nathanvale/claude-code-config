# Agent Skills Agent Guide

`agent-skills` is a repo-local CLI package that projects one skill catalog
into agent runtime roots as managed symlinks, reports projection health, and
recognizes lockfile-managed external skills without owning them.

This file routes maintainers. `README.md` explains the tool to humans.

## Always Read

Read `CONTEXT.md` first. It defines the catalog, projection, blocker, and
external-entry language used across docs, CLI output, and plans. Then read
only the file the Intent Gate routes to.

Front door:

```bash
agent-skills status
agent-skills status --json
agent-skills sync --check --json
agent-skills commands --json
```

Unlinked environments run the same commands through Bun:

```bash
bun run runtime/agent-skills/src/cli.ts status --json
```

## Intent Gate

- **Repair a worktree or repo** -> `README.md` Common Setups, then
  `agent-skills sync --check --json`.
- **Explain to a human** -> `README.md`, then `CONTEXT.md`.
- **Change CLI contract** -> `cli-author`; then Change Recipes, Verification.
- **Change classification, blockers, or external recognition** ->
  `ARCHITECTURE.md`, Change Recipes; keep fail-closed sync intact.
- **Change vocabulary** -> `CONTEXT.md`; keep enums and schemas in code.
- **Trace source lineage or review plan history** ->
  `runtime/agent-skills/docs/INDEX.md`,
  `docs/decisions/2026-07-02-npx-skills-division-of-labor.md`.
- **Choose next work** -> `TASKS.md`.

## Source Owners

`ARCHITECTURE.md` Module Map is the only per-module owner list.
`runtime/agent-skills/tests/docs-drift.test.ts` fails when a `src` module and
that map disagree in either direction.

## Change Recipes

- **New or changed command:** run `cli-author`; update `command-contract.ts`,
  `cli.ts` dispatch, help/discovery tests, integration stations, and
  `README.md` Commands.
- **Result contract:** update `model.ts` and `command-contract.ts`; bump
  schema version on breaking JSON changes; update `README.md` JSON Contract
  field list and both surface tests.
- **Blocker or external classification:** update `projection.ts` and
  `skills-lock.ts`; keep fail-closed behavior for non-lockfile entries; update
  projection and lock tests plus `CONTEXT.md` when vocabulary shifts.
- **Config key:** update `config.ts` and config tests; unsupported keys stay
  rejected; document the key in `README.md` Config.
- **Vocabulary:** update `CONTEXT.md`; keep enum values in `model.ts`.
- **Source owner split or move:** update `ARCHITECTURE.md` Module Map (the
  docs-drift test enforces completeness) and
  `runtime/agent-skills/docs/INDEX.md` when doc scope moved.

## Doc Drift Gate

Run after any source-owner split, CLI contract change, output-envelope
change, or task-status closure.

Check these package docs in the same pass:

- `runtime/agent-skills/README.md`
- `runtime/agent-skills/ARCHITECTURE.md`
- `runtime/agent-skills/AGENTS.md`
- `runtime/agent-skills/CONTEXT.md`
- `runtime/agent-skills/docs/INDEX.md`
- `runtime/agent-skills/TASKS.md`

Pass/fail gates:

```bash
skills/test-runner/src/test-runner.sh run --cwd runtime/agent-skills -- tests/docs-drift.test.ts
bun run skills/skill-author/scripts/check-owner-paths.ts --json runtime/agent-skills/AGENTS.md runtime/agent-skills/ARCHITECTURE.md runtime/agent-skills/README.md runtime/agent-skills/CONTEXT.md runtime/agent-skills/TASKS.md runtime/agent-skills/docs/INDEX.md
```

The docs-drift test proves `src` modules and the `ARCHITECTURE.md` Module Map
agree in both directions; the owner-path check proves every backticked local
path in these docs exists.

## Drift Anti-Patterns

- Do not let `README.md` carry exact JSON schemas or flag tables;
  `model.ts` and `command-contract.ts` own them.
- Do not describe externals as blockers or blockers as auto-fixable.
- Do not document `imports:` as supported; it fails with a migration error.
- Do not use package-relative owner paths where the owner-path checker
  expects repo-relative paths.

## Safety Invariants

- Sync fails closed while blockers exist.
- Never create, modify, or remove external entries in `sync` or `unlink`.
- Never write `skills-lock.json`; it is read-only input.
- Never delete unmanaged entries; repair goes through config or source moves.
- Reject absolute and `..` projection roots.
- Keep the catalog source-only; write only managed links and the snapshot.

## Verification

Run package checks after source changes:

```bash
skills/test-runner/src/test-runner.sh run --cwd runtime/agent-skills -- tests
bun --filter agent-skills typecheck
```

Facade drift and dogfood smoke commands live in `README.md` Verification.

After CLI contract changes, prove:

- discovery metadata (`agent-skills commands --json`),
- rendered help,
- parser accept/reject behavior,
- runtime semantics,
- branch station evidence.

Run docs checks after docs-only changes:

```bash
git diff --check -- runtime/agent-skills
```
