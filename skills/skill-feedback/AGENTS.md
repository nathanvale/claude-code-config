# Skill Feedback Agent Guide

`skill-feedback` is a repo-local CLI package for Software Learning Reports.
It captures hook evidence, accepts driver closeouts, reviews the inbox, checks
health, repairs private correlation witnesses, and purges retained reports.

`SKILL.md` owns the workflow route. This file routes maintainers.

## Always Read

Read `CONTEXT.md` first. It defines the trust, capture, review, and correlation
language used across docs, CLI output, and plans.

Read only the extra file your intent needs:

- Operate the skill workflow: `SKILL.md`.
- Interpret report or review output: `references/report-shape.md`.
- File driver closeout: `references/closeout-receipt.md`.
- Change redaction: `references/redaction.md`.
- Change source or command behavior: `ARCHITECTURE.md`.
- Read source docs and plans: `skills/skill-feedback/docs/INDEX.md`.
- Pick or file project work: `TASKS.md`.

Front door:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
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
- **Change CLI contract** -> `create-cli`, Source Owners, Change Recipes,
  Verification.
- **Change review, health, purge, or correlate behavior** -> `ARCHITECTURE.md`,
  Source Owners, Change Recipes, Verification.
- **Change vocabulary** -> `CONTEXT.md`; keep schemas and enum values in code.
- **Review plan history** -> `skills/skill-feedback/docs/INDEX.md`, `PROVENANCE.md`,
  `TASKS.archive.md`.
- **Choose next work** -> `TASKS.md`.

## Source Owners

**CLI surface**

- `package.json` - package script names.
- `src/command-contract.ts` - command metadata, result contracts, parser rules,
  help/discovery contracts, schema versions, enums.
- `src/runtime-contract.ts` - runtime and read-target interfaces.
- `src/skill-feedback-runner.ts` - CLI dispatch, argv parsing, process result
  rendering, default runtime, filesystem safety, command orchestration.

**Capture and closeout**

- `src/skill-feedback-runner.ts` - `record`, `closeout`, report writes, writer
  proof, trust store, pilot marker.
- `src/report-normalizer.ts` - persisted report parsing, proof-context
  application, cost-unavailable projection.
- `src/capture-adapters.ts` - Claude OTel and Codex JSON adapter seams.
- `src/redaction.ts` - agent-authored field redaction.
- `references/closeout-receipt.md` - driver closeout receipt guidance.

**Review and health**

- `src/review-ledger-reducer.ts` - review units, ledger entries, evidence tiers,
  entry-local allowed claims.
- `src/ledger-anchor-adapter.ts` - repo-contained owner path anchors.
- `src/inbox-read-model.ts` - safe inbox scans, raw report reads, duplicate and
  proof facts, low-signal classification, health facts, purge candidates.
- `src/skill-feedback-runner.ts` - health, review, process envelopes, plain
  renderers.
- `references/report-shape.md` - result-shape reading rules.

**Correlation and retention**

- `src/command-contract.ts` - writer proof and correlation witness contracts.
- `src/correlation-witness-artifacts.ts` - witness and diagnostic artifact IO,
  safe correlation directory reads, artifact classification.
- `src/correlation-witness-workflow.ts` - finalization, verification overlay,
  repair classification, execute orchestration.
- `src/inbox-read-model.ts` - purge candidate projection and safe report reads.
- `src/skill-feedback-runner.ts` - correlate and purge CLI envelopes, renderers,
  explicit purge deletion.
- `src/branch-station-catalog.ts` - command branch coverage catalog.
- `src/branch-station-evidence.ts` - station evidence projection helpers.

**Tests**

- `src/command-contract.test.ts` - discovery and contract drift.
- `src/report-normalizer.test.ts` - persisted report normalization.
- `src/correlation-witness-artifacts.test.ts` - artifact IO and
  repair-candidate classification.
- `src/correlation-witness-workflow.test.ts` - workflow-owned witness behavior.
- `src/skill-feedback.test.ts` - help, parser, runtime semantics.
- `src/skill-feedback.integration.test.ts` - process-boundary stations.
- `src/review-ledger-reducer.test.ts` - ledger and claim rules.
- `src/ledger-anchor-adapter.test.ts` - owner path anchors.
- `src/capture-adapters.test.ts` - adapter normalization.
- `src/branch-station-catalog.test.ts` - station map drift.

## Change Recipes

- **New or changed command:** run `create-cli`; update `command-contract.ts`,
  runner parsing/dispatch, help/discovery tests, runtime tests, and branch
  stations.
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
- **Source owner split or move:** update `ARCHITECTURE.md` Module Map, Source
  Owners here, `README.md` file map, `references/report-shape.md` when output
  or report semantics moved, and `SKILL.md` only when workflow ownership
  changed.

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

Use runnable probes. Treat `find` and `rg` as inspection aids; treat the
owner-path command as a pass/fail gate.

```bash
find skills/skill-feedback/src -maxdepth 1 -type f | sort
rg -n 'bun --filter skill-feedback-scripts skill-feedback-runner|Active Follow-Up|Active v2|reason ids only|runtime abstraction|witness read' skills/skill-feedback
bun run skills/create-skill/scripts/check-owner-paths.ts --json skills/skill-feedback/README.md skills/skill-feedback/ARCHITECTURE.md skills/skill-feedback/AGENTS.md skills/skill-feedback/SKILL.md skills/skill-feedback/CONTEXT.md skills/skill-feedback/references/report-shape.md skills/skill-feedback/docs/INDEX.md skills/skill-feedback/TASKS.md skills/skill-feedback/TASKS.archive.md
```

## Drift Anti-Patterns

- Do not let `ARCHITECTURE.md` say the runner owns behavior extracted to a
  module.
- Do not leave archive follow-up rows sounding active after closure.
- Do not document diagnostics as reason-id-only when artifacts carry private
  candidate boundaries.
- Do not use package-relative owner paths where the owner-path checker expects
  repo-relative paths.

## Debug

1. Run `health --plain`.
2. Inspect command help.
3. Run read-only `review --plain` or `correlate --plain` when health routes
   there.
4. Inspect `.skill-feedback/` only after checking the report shape reading rule.
5. Fix source owners, not inbox reports, when evidence points to a code or docs
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

## Manage Tasks

`TASKS.md` is the active dashboard. Keep it short. Move completed detail to
`TASKS.archive.md`.

When `TASKS.md` closes a queue item, archive the completed detail in
`TASKS.archive.md` during the same pass.

Leave historical plan docs unchanged unless `skills/skill-feedback/docs/INDEX.md`
or archive wording misleads current agents.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Review Ledger. Done when: observable command, test,
      or doc result. Next: `bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain`.
```

Use these lanes:

- CLI Contract
- Capture Runtime
- Closeout
- Review Ledger
- Correlation
- Inbox Retention
- Redaction Trust
- Docs Language
- Verification

## Manage Architecture

`ARCHITECTURE.md` is the module map and flow source of truth.

Before new modules, command families, or structural changes:

- Run the `context/code-style.md` pressure gate.
- Use `improve-codebase-architecture`.
- Use `create-cli` for CLI surface changes.

After source ownership changes:

- Update `ARCHITECTURE.md` Module Map.
- Update Source Owners here.
- Update `CONTEXT.md` only for new domain language.
- Update `TASKS.md` when the change creates follow-up work.

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
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
```
