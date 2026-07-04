# Warm Chrome Agent Guide

`@side-quest/warm-chrome` owns Warm Chrome readiness proof: `check`, `status`
(alias), `launch`, `repair` over the cli-command-facade runtime contract with
package-owned exit code `20` (browser-entry failure).

This file routes maintainers. `README.md` explains the tool to humans.
`CONTEXT.md` owns package language.

## Always Read

Read `CONTEXT.md` first. It defines station, proof, endpoint authority,
mutation pin, and switchover terms used across CLI output, tests, and plans.
Then read only the file the Intent Gate routes to.

Front door:

```bash
bun run runtime/warm-chrome/src/cli.ts
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
bun run runtime/warm-chrome/src/cli.ts launch --help
bun run runtime/warm-chrome/src/cli.ts repair --help
```

Use `bun --filter @side-quest/warm-chrome ...` for package maintenance.
Use the direct runner above for agent-operational examples.

## Intent Gate

- **Operate or inspect Warm Chrome** -> `README.md`, then CLI help.
- **Explain package language** -> `CONTEXT.md`.
- **Change CLI contract, flags, help, outputs, exit codes, or command posture** ->
  `cli-author`, then Change Recipes and Verification below.
- **Change station id, canonical code, action, mutation pin, or reason union** ->
  `ARCHITECTURE.md`, `src/model.ts`, `src/branch-station-catalog.ts`,
  `src/branch-station-evidence.ts`, and station tests.
- **Change proof behavior** -> `ARCHITECTURE.md` Proof Flow, `src/proof.ts`,
  `tests/check-stations.test.ts`, `tests/parity.test.ts`.
- **Change launch lifecycle** -> `src/launch.ts`,
  `tests/launch-stations.test.ts`, and the Branch Station Catalog when station
  posture changes.
- **Change repair lifecycle** -> `src/repair.ts`,
  `tests/repair-stations.test.ts`, and redaction tests when diagnostics move.
- **Change redaction** -> `src/runtime.ts`, `src/cli.ts`,
  `tests/redaction.test.ts`, and station tests for the emitting branch.
- **Change old/new parity or browser-use switchover** -> `tests/parity.test.ts`,
  `skills/browser-use/src/preflight-warm-chrome.ts`, and
  `runtime/warm-chrome/TASKS.md`; keep the old preflight unmodified until the
  switchover task closes.
- **Choose next work** -> `TASKS.md`.
- **Close or reclassify task detail** -> update `TASKS.md` and
  `TASKS.archive.md` in the same pass.

## Source Owners

`ARCHITECTURE.md` Module Map is the only per-module owner list.
`tests/docs-drift.test.ts` fails when a `src` module and that map disagree in
either direction, and when the maintainer doc set is incomplete.

Reference owners:

- Decision lineage:
  `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.
- Implementation plan:
  `docs/plans/2026-07-03-001-feat-warm-chrome-runtime-package-plan.md`.
- Current browser-use authority:
  `skills/browser-use/src/preflight-warm-chrome.ts`.
- Warm Chrome research:
  `skills/browser-use/docs/research/2026-07-03-warm-chrome-cdp-gotchas-and-port-policy.md`.

## Change Recipes

- **New or changed command:** run `cli-author`; update
  `src/command-contract.ts`, `src/cli.ts`, rendered help tests,
  parser accept/reject tests, runtime tests, and station evidence.
- **Result contract:** update `src/command-contract.ts`, envelope emitters in
  `src/cli.ts`, command-surface tests, and `README.md` output posture.
- **Station contract:** update `src/model.ts`,
  `src/branch-station-catalog.ts`, `src/branch-station-evidence.ts`, the
  owning station test, and `CONTEXT.md` only when public language changes.
- **Proof reason:** update the closed reason union in `src/model.ts`, then pin
  one fixture in `tests/check-stations.test.ts` before runtime emission.
- **Launch lifecycle:** keep no-spawn, race, and post-spawn mutation facts
  explicit in tests before changing `src/launch.ts`.
- **Repair lifecycle:** keep foreign-listener refusal and no-symlink-write
  negative tests before changing `src/repair.ts`.
- **Redaction:** add or update the leak fixture first; route every emitted
  foreign-listener field through the redaction chokepoint.
- **Parity:** record old/new divergence in `tests/parity.test.ts`; do not edit
  the old browser-use preflight until the switchover task closes.
- **Source owner split or move:** update `ARCHITECTURE.md` Module Map and run
  the Doc Drift Gate.
- **Task closure:** move closed rationale from `TASKS.md` to
  `TASKS.archive.md`; keep active tasks short and verifiable.

## Doc Drift Gate

Run after source-owner moves, CLI contract changes, station changes, output
changes, or task-status closure.

Check these package docs in the same pass:

- `runtime/warm-chrome/README.md`
- `runtime/warm-chrome/ARCHITECTURE.md`
- `runtime/warm-chrome/AGENTS.md`
- `runtime/warm-chrome/CONTEXT.md`
- `runtime/warm-chrome/TASKS.md`
- `runtime/warm-chrome/TASKS.archive.md`

Pass/fail gates:

```bash
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/docs-drift.test.ts
bun run skills/skill-author/scripts/check-owner-paths.ts --json runtime/warm-chrome/README.md runtime/warm-chrome/ARCHITECTURE.md runtime/warm-chrome/AGENTS.md runtime/warm-chrome/CONTEXT.md runtime/warm-chrome/TASKS.md runtime/warm-chrome/TASKS.archive.md
```

The docs-drift test proves `src` modules and the `ARCHITECTURE.md` Module Map
agree in both directions. The owner-path check proves backticked repo-local
owner paths exist.

Stale-phrase inspection aid:

```bash
rg -ni 'runners/warm-chrome-runner|(fifteen|seventeen|15|17)[ -]station|\b(fifteen|seventeen)\b stations|derive the endpoint from.*9222|authoritative package|TASKS.archive.md once it exists' runtime/warm-chrome --glob '!AGENTS.md'
```

## Drift Anti-Patterns

- Do not let `README.md` or `AGENTS.md` repeat per-module ownership; point to
  `ARCHITECTURE.md`.
- Do not copy exact flags, schemas, reason unions, or envelope fields into
  prose when `src/command-contract.ts`, CLI help, or tests own them.
- Do not let `TASKS.md` become a review transcript; move closed detail to
  `TASKS.archive.md`.
- Do not mark browser-use switchover closed while
  `skills/browser-use/src/preflight-warm-chrome.ts` remains authoritative.
- Do not route agents on `data.reason`; route on station action.

## Debug

1. Run `status` for human-readable posture.
2. Run `check --json` for the authoritative endpoint envelope.
3. Inspect command help for flag or output-mode questions.
4. Run the owning station test before source edits.
5. Run `tests/parity.test.ts` before changing browser-use behavior.
6. Fix source owners, not docs, when evidence points to contract drift.

## Safety Invariants

- The ok envelope is the only endpoint authority; convention-derived `9222`
  endpoints are not proof.
- One station has one canonical error code and one primary action.
- Fine-grained cause lives in `data.reason`; agents do not route on it.
- Never terminate a listener the proof did not verify as Warm Chrome.
- Foreign-listener diagnostics expose pid and process basename only.
- `check` and `status` are read-only.
- `launch` may write browser state only through declared mutation pins.
- `repair` may write dedicated-profile proof state only after refusal gates.
- `skills/browser-use/src/preflight-warm-chrome.ts` stays authoritative until
  the switchover task closes.

## Verification

Run package checks after source changes:

```bash
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/
bun --filter @side-quest/warm-chrome typecheck
```

After CLI contract changes, prove:

- discovery metadata,
- rendered help,
- parser accept/reject behavior,
- runtime semantics,
- branch station evidence,
- parity divergence report.

Run docs checks after docs-only changes:

```bash
git diff --check -- runtime/warm-chrome
skills/test-runner/src/test-runner.sh run -- runtime/warm-chrome/tests/docs-drift.test.ts
bun run runtime/warm-chrome/src/cli.ts --help
```
