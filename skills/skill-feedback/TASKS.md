# Skill Feedback Tasks

Hot-path project-manager dashboard.

Archive: `TASKS.archive.md`. Source lineage: `PROVENANCE.md`. Agent route:
`SKILL.md`. Architecture: `ARCHITECTURE.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md`.
- Add at most 10 open tasks per priority group.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Correlation. Done when: observable command, test,
      or doc result. Next: `command`.
```

Lanes: CLI Contract, Capture Runtime, Closeout, Review Ledger, Correlation,
Inbox Retention, Redaction Trust, Docs Language, Verification.

## Current Priority

P0/P1 ownership refactor closed on 2026-06-29. P2 closure slice closed on
2026-06-30. Dirty-tree review follow-ups closed on 2026-06-30. Codex Trusted
skill identity stays deferred, native cost stays `cost_unavailable`, and
`report:<id>` stays a documented JSON lookup.

Source owners are now split across `command-contract.ts`,
`report-normalizer.ts`, `inbox-read-model.ts`,
`correlation-witness-artifacts.ts`, `correlation-witness-workflow.ts`, and
`runtime-contract.ts`; `skill-feedback-runner.ts` keeps CLI dispatch, rendering,
writes, and command orchestration.

Next safe action:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain
```

## Now

No active P1 tasks.

## Next

No active P2 tasks.

## Later

- [ ] P3 Decide purge plain-output parity Lane: CLI Contract. Done when:
      `purge` either advertises and tests `--plain`, or the smoke matrix records
      JSON-only purge output as intentional. Next: inspect
      `skillFeedbackContracts.purge` output modes and purge renderer ownership.

## Latest Signals

- 2026-06-30: Focused skill-feedback CLI smoke passed: package runner passed 10
  files, 282 tests; typecheck passed; `git diff --check -- skills/skill-feedback
  docs/decisions docs/research` clean; help rendered for root, `record`,
  `closeout`, `review`, `health`, `purge`, and `correlate`; read-only live
  smokes passed for `health --plain`, `review --plain`, `correlate --plain`,
  purge preview selectors, and explicit `--repo` read targets. JSON contracts
  parsed for health schema 4, review schema 7, correlate schema 1, and purge
  schema 1. Usage failures returned exit 2 with structured envelopes. Follow-up:
  decide whether `purge --plain` should exist or stay JSON-only.
- 2026-06-30: Dirty-tree review follow-ups closed:
  `correlation-witness-artifacts.ts` owns artifact read/parse/classify and safe
  witness filesystem helpers; `runtime-contract.ts` owns
  `SkillFeedbackRuntime`; KTD2/KTD7 use imperative directives. Verification:
  `skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src`
  passed 10 files, 282 tests; `bun --filter skill-feedback-scripts typecheck`
  passed; `git diff --check -- skills/skill-feedback docs/decisions
  docs/research` clean.
- 2026-06-30: Earlier dirty-tree code review filed three follow-ups later
  closed by the latest 2026-06-30 signal: split the 1,411-line correlation
  workflow owner, move `SkillFeedbackRuntime` out of the runner dependency
  cycle, and rewrite two plan directives in imperative voice. Review also fixed
  explicit `--repo` correlate execute target wiring and duplicate
  repair-diagnostic witness writes. Package tests passed: 9 files, 281 tests;
  `tsc_check` clean.
- 2026-06-29: P0/P1 ownership refactor closed: no open P0/P1 tasks remain;
  report normalization, inbox reads, and correlation witnesses have source
  owners; command facade behavior preserved; Codex lifecycle, cost, and
  `report:<id>` resolver stayed no-build decisions from source evidence.
- 2026-06-30: Decision Surface Renderer closed: review and health plain
  readiness labels now come from `SKILL_FEEDBACK_DECISION_READINESS_SURFACES`
  in `command-contract.ts`; correlate plain next action is asserted from
  result data. Package tests pass: 9 files, 277 tests.
- 2026-06-30: P2 queue closed: Branch Station scenario helpers now own repeated
  process setup and envelope evidence; temp artifacts stay invalid-health
  evidence only; purge keeps `.correlation/` witness and diagnostic artifacts;
  `pilot_started_at` remains manual source evidence with no purge coupling;
  package tests pass: 9 files, 279 tests.
- 2026-06-29: Claude daily-pilot readiness is runtime-scoped in `health` and
  `review`: Claude renders `ready`, Codex Trusted skill identity renders
  `blocked`; review schema `7`, health schema `4`; package tests 274 pass and
  typecheck clean. Fallow still reports reviewed introduced private-helper
  prompts around `isTrustedClaudeStopReport`.
- 2026-06-29: ICA plus GoF pressure review kept six non-GoF architecture
  patterns for agent maintainability: Inbox Read Model, Contract Catalog split,
  Correlation Witness Workflow, Report Normalizer, Decision Surface Renderer,
  and Branch Station Scenario Harness.
- 2026-06-29: correlation backfill (U1-U5) merged to main at `1c38f90a`;
  package tests 274 pass, `tsc_check` clean.
- 2026-06-29: accepted direction: support Claude Code daily-pilot use now;
  defer Codex Trusted skill identity until Codex ships an engine-owned skill
  invocation feature.
- 2026-06-29: durable-candidate-source open question resolved in code; finalizer
  embeds `repair_candidates[]` into blocked diagnostics, execute revalidates.
- 2026-06-29: `correlate --plain` preview found 4 legacy sparse candidates, all
  `insufficient_evidence` -> `no_repair_available`; correct by design (KTD5).
- 2026-06-29: earlier `health --plain` showed daily pilot blocked on
  `trusted_skill_identity_missing`; Decision 44 supersedes this as a
  Claude-supported pilot wording task.
- 2026-06-29: package docs split added from the Component Tracker pattern.

## Command Shortcuts

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts review --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts correlate --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts purge --help
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
bun --filter skill-feedback-scripts typecheck
```
