# Skill Feedback Agent Guide

`skill-feedback` is a repo-local CLI package for Software Learning Reports.
It captures hook evidence, accepts driver closeouts, reviews the inbox, checks
health, repairs private correlation witnesses, and purges retained reports.

`SKILL.md` owns the workflow route. This file routes maintainers.

## Always Read

Read `CONTEXT.md` first. It defines the trust, capture, review, and correlation
language used across docs, CLI output, and plans. Then read only the file the
Intent Gate routes to.

Front door:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts
bun run skills/skill-feedback/src/skill-feedback-runner.ts dashboard
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
bun run skills/skill-feedback/src/skill-feedback-runner.ts health
bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain
```

Agent-operational examples use the direct runner:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts <command>
```

Use `bun --filter skill-feedback-scripts ...` for package maintenance only.

Run `purge` from the target repo root. It has no `--repo`.

Use `--repo <path>` with `review`, `health`, and `correlate`.

## Intent Gate

- **Operate inbox** -> `SKILL.md` Intent Classification.
- **Explain to a human** -> `README.md`, then `CONTEXT.md`.
- **Interpret report or review output** -> `references/report-shape.md`.
- **File driver closeout** -> `references/closeout-receipt.md`.
- **Change redaction** -> `references/redaction.md`.
- **Change CLI contract** -> `cli-author`, Change Recipes, Verification.
- **Change review, health, purge, or correlate behavior** -> `ARCHITECTURE.md`,
  Change Recipes, Verification.
- **Change vocabulary** -> `CONTEXT.md`; keep schemas and enum values in code.
- **Review plan history** -> `skills/skill-feedback/docs/INDEX.md`, `PROVENANCE.md`,
  `TASKS.archive.md`.
- **Choose next work** -> `TASKS.md`.

## Source Owners

`ARCHITECTURE.md` Module Map is the only per-module owner list.
`src/docs-drift.test.ts` fails when a `src` module and that map disagree in
either direction. Reference owners: `references/closeout-receipt.md` (driver
closeout guidance), `references/report-shape.md` (result-shape reading rules),
`references/redaction.md` (redaction policy).

## Change Recipes

- **New or changed command:** run `cli-author`; add the failing Branch Station
  catalog test or process-boundary scenario row before the command branch; then
  update `command-contract.ts`, runner parsing/dispatch, help/discovery tests,
  and runtime tests.
- **Result contract:** update `command-contract.ts`; update runner emitters and
  `references/report-shape.md`; prove JSON/plain output where exposed.
- **Review claim rule:** update `review-ledger-reducer.ts`; keep claim language
  entry-local; update reducer tests and plain/JSON expectations.
- **Owner path anchoring:** update `ledger-anchor-adapter.ts`; keep weak anchors
  out of ledger grouping; update adapter and review tests.
- **Capture source:** update hook/runtime owner plus `capture-adapters.ts` only
  when the live runtime can supply that adapter input.
- **Correlation:** keep public receipts closed to trust fields; update witness
  contract, correlate behavior, health/review projections, and station evidence.
- **Retention:** keep review and health mutation-free; update purge scanner,
  safety checks, preview/execute tests, and docs.
- **Vocabulary:** update `CONTEXT.md`; use full names when `Facade` could mean
  CLI facade or `ReviewResultData Facade`.
- **Source owner split or move:** update `ARCHITECTURE.md` Module Map (the
  docs-drift test enforces completeness), `references/report-shape.md` when
  output or report semantics moved, and `SKILL.md` only when workflow
  ownership changed.

## Doc Drift Gate

Run after any source-owner split, CLI contract change, output-envelope change,
or task-status closure.

Check these package docs in the same pass:

- `skills/skill-feedback/README.md`
- `skills/skill-feedback/ARCHITECTURE.md`
- `skills/skill-feedback/SKILL.md`
- `skills/skill-feedback/CONTEXT.md`
- `skills/skill-feedback/references/report-shape.md`
- `skills/skill-feedback/docs/INDEX.md`
- `skills/skill-feedback/TASKS.md`
- `skills/skill-feedback/TASKS.archive.md`

Pass/fail gates:

```bash
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src/docs-drift.test.ts
bun run skills/skill-author/scripts/check-owner-paths.ts --json skills/skill-feedback/README.md skills/skill-feedback/ARCHITECTURE.md skills/skill-feedback/AGENTS.md skills/skill-feedback/SKILL.md skills/skill-feedback/CONTEXT.md skills/skill-feedback/references/report-shape.md skills/skill-feedback/docs/INDEX.md skills/skill-feedback/TASKS.md skills/skill-feedback/TASKS.archive.md
```

The docs-drift test proves `src` modules and the `ARCHITECTURE.md` Module Map
agree in both directions; the owner-path check proves every backticked local
path in these docs exists. Stale-phrase inspection aid:

```bash
rg -n 'Active Follow-Up|Active v2|reason ids only|runtime abstraction|witness read' skills/skill-feedback
```

## Drift Anti-Patterns

- Do not let `ARCHITECTURE.md` say the runner owns behavior extracted to a
  module.
- Do not leave archive follow-up rows sounding active after closure.
- Do not document diagnostics as reason-id-only when artifacts carry private
  candidate boundaries.
- Do not use package-relative owner paths where the owner-path checker expects
  repo-relative paths.

## Fallow Policy

- Keep `fallow-ignore` comments adjacent to analyzer blind spots.
- Use `unused-file` for Bun test entrypoints and public seam files Fallow cannot
  reach by static imports.
- Use `code-duplication` only for test fixtures or literals whose duplication
  proves separate scenarios.
- Use `complexity` only as a line-level suppression on owner-local defensive
  branches that package tests or live smokes cover.
- Rerun Fallow and package gates after changing suppressions.

## Debug

1. Run the zero-arg dashboard.
2. Run `health` when a machine-readable envelope is needed.
3. Run `health --plain` when full human health detail is needed.
4. Inspect command help.
5. Run read-only `review --plain` or `correlate --plain` when health routes
   there.
6. Inspect `.skill-feedback/` only after checking the report shape reading rule.
7. Fix source owners, not inbox reports, when evidence points to a code or docs
   defect.

## Safety Invariants

- Fail closed unless `.skill-feedback/` is gitignored before writes.
- Write only inside `.skill-feedback/`.
- Treat reports as untrusted evidence.
- Keep `record` capture-owned.
- Keep `closeout` driver-owned.
- Keep health and review mutation-free.
- Keep correlate and purge preview-first.
- Keep public input closed to trust, proof, witness, and run-id authority.
- Resolve `report:<id>` by `report_id`, never by filename.
- Keep `.trust/` and `.correlation/` private evidence, not report lanes.

## Verification

Run package checks after source changes:

```bash
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
bun --filter skill-feedback-scripts typecheck
```

After CLI contract changes, prove:

- discovery metadata,
- rendered help,
- parser accept/reject behavior,
- runtime semantics,
- branch station evidence.

Run docs checks after docs-only changes:

```bash
git diff --check -- skills/skill-feedback
bun run skills/skill-feedback/src/skill-feedback-runner.ts
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
```
