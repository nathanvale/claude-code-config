---
name: cli-execution-auditor
description: "Audit a facade-backed CLI's agent-execution experience against its lane contract. Use when verifying a facade CLI's exit codes, help-flag alignment, redaction, runner discipline, and --json-under-failure before shipping."
role: quality-gate
---

# CLI Execution Auditor

Opt-in tool. Deterministically audits a facade-backed CLI against the per-lane
contract. Two check kinds:

- **Static** — contract assertions caught with zero target invocations.
- **Surface** — run each enumerable invocation, assert its lane clause.

Pass/fail is a fact derived from the contract, not a judge's vote. Scope is the
facade lane only.

## Command

```text
bun run auditor -- audit <target> [--only <clause>] [--ledger <path>] [--json]
```

- `<target>` — path to a facade-backed skill with `@side-quest/cli-command-facade` and a discovered command contract.
- `--only <clause>` — restrict to one clause id (see the catalog).
- `--ledger <path>` — ledger destination (default `docs/cli-audits/<cli-name>/audit.md`).
- Exit: `0` clean, `1` findings, `2` usage error.

Front door: `package.json#scripts` (`auditor`).

## Workflow

1. Run `bun run auditor -- audit <target>` on a facade-backed CLI.
2. Read the plain summary; escalate to `--json` for the structured envelope (repair hints, run correlation).
3. A non-facade target is skipped with a reason, not a crash.
4. Findings write to the ledger; re-running dedupes by signature and preserves resolved history.
5. Fix the flagged clause in the target source, then rerun — the finding's re-check re-runs the clause assertion, not a symptom string.

## Owner Paths

- Lane contract owner (cited by reference, never copied): `runtime/cli-command-facade/AGENTS.md`
- Clause catalog (the load-bearing spec — id, kind, code source, assertion, masking note): `src/clause-catalog.ts`
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
- Opt-in tool, not an enforcement gate (the v2 gate is deferred).

## Verification

- Run `./skills/test-runner/src/test-runner.sh run --cwd skills/cli-execution-auditor -- src/**/*.test.ts` after engine, clause, or ledger changes.
- Run `bun run typecheck` (in the skill dir) after TypeScript edits.
- The fixture corpus (`src/fixtures/`) is the checker-correctness oracle: breaking a checker reddens its fixture.
