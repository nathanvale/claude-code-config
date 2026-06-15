---
name: cli-execution-auditor
description: "Audit facade-backed CLI execution, lane contracts, or Station Maps."
role: quality-gate
---

# CLI Execution Auditor

Opt-in tool. Deterministically audits a facade-backed CLI against the per-lane
contract and can project a Branch Station Map. Lane audit check kinds:

- **Static** — contract assertions caught with zero target invocations.
- **Surface** — run each enumerable invocation, assert its lane clause.

Pass/fail is a fact derived from the contract, not a judge's vote. Scope is the
facade lane only.

## Command

```text
bun run auditor -- audit <target> [--only <clause>] [--ledger <path>] [--json]
bun run auditor -- station-map <target> [--ledger <path>] [--json]
```

- `<target>` — path to a facade-backed skill with `@side-quest/cli-command-facade` and a discovered command contract.
- `--only <clause>` — restrict to one clause id (see the catalog).
- `--ledger <path>` — ledger destination (default `docs/cli-audits/<cli-name>/audit.md`).
- Exit: `0` clean, `1` findings, `2` usage error.
- `station-map` — reconcile command discovery, package Branch Station Catalog,
  and station evidence into Declared Branch Coverage.

Front door: `package.json#scripts` (`auditor`).

## Workflow

1. Run `bun run auditor -- audit <target>` on a facade-backed CLI.
2. Run `bun run auditor -- station-map <target> --json` after a package owns a Branch Station Catalog.
3. Read the plain summary; use `--json` for the structured envelope.
4. Treat non-facade and no-catalog targets as skipped with a reason.
5. Fix the flagged clause, catalog, evidence, or runner behavior in the target source.
6. Rerun; findings dedupe by signature and preserve resolved history.

## Owner Paths

- Lane contract owner (cited by reference, never copied): `runtime/cli-command-facade/AGENTS.md`
- Clause catalog (the load-bearing spec — id, kind, code source, assertion, masking note): `src/clause-catalog.ts`
- Station Map engine: `src/station-map.ts`
- Branch Station model routing: `references/station-map-model.md`
- Human clause → code-owner map: `references/lane-contract-clauses.md`
- Agent-native floor clauses: `skills/create-cli/references/agent-native-cli-design.md`
- Findings-model semantics (states, dedupe, never-delete): `skills/skill-self-audit-loop/SKILL.md`

## Ledger

Auditor-local findings ledger at `src/ledger/`. Owns the findings-table subset of
`skill-self-audit-loop`'s template (Open Findings / Finding History, states,
signature dedupe, never-delete). Format-compatible with that template; a shared
module is extracted only when a second code consumer exists — until then the
deferral keeps extraction mechanical.

## Scope

- Facade lane only (the enumerable lane). Hand-rolled CLIs are out of v1 scope.
- Audits runtime CLI behavior, not source code review (`ce-code-review`'s job).
- Station Map mode reports Declared Branch Coverage, not whole-program branch coverage.
- Opt-in tool, not an enforcement gate (the v2 gate is deferred).

## Verification

- Run `./skills/test-runner/src/test-runner.sh run --cwd skills/cli-execution-auditor -- src/**/*.test.ts` after engine, clause, or ledger changes.
- Run `bun run typecheck` (in the skill dir) after TypeScript edits.
- The fixture corpus (`src/fixtures/`) is the checker-correctness oracle: breaking a checker reddens its fixture.
