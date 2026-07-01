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
`decision-surface.ts`, `report-normalizer.ts`, `inbox-read-model.ts`,
`correlation-witness-artifacts.ts`, `correlation-witness-workflow.ts`,
`runtime-contract.ts`, `runtime-file-safety.ts`, and `raw-object.ts`;
`skill-feedback-runner.ts` keeps CLI dispatch, rendering, writes, and command
orchestration.

Next safe action:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts
```

## Now

- [ ] P0 Human reports MVP Lane: CLI Contract. Done when:
      `skill-feedback reports` shows recent reports in a readable table with
      timestamp, skill, outcome, one-line goal, and `report:<id>`; no jq,
      filenames, or schema knowledge needed. Next: build from existing inbox
      scan and add plain-output tests.
- [ ] P0 Human report detail MVP Lane: CLI Contract. Done when:
      `skill-feedback report <id>` shows the report goal, friction,
      verification burden, touched surfaces, observations, and evidence gaps in
      readable plain text; `--json` stays available for scripts. Next: resolve
      `report:<id>` through inbox data, not filesystem naming.
- [ ] P0 Human usage MVP Lane: Review Ledger. Done when:
      `skill-feedback usage` answers "what skills are being used and how did
      they go?" with ranked skills, counts, outcomes, last used, and common
      friction. Next: aggregate from normalized reports and low-signal lane.
- [ ] P0 Human improvement queue MVP Lane: Review Ledger. Done when:
      `skill-feedback queue` answers "what should I improve next?" with ranked
      skills or owner paths, reason, supporting `report:<id>` refs, and next
      safe action. Next: start from repeated friction, high verification burden,
      and repeated observations already present in review data.
- [ ] P0 Default UX repair Lane: CLI Contract. Done when: running
      `skill-feedback` without args shows a short human dashboard with only
      useful next commands: `reports`, `usage`, `queue`, and `review`; internal
      diagnostics appear only behind `health` or explicit debug commands. Next:
      rewrite dashboard plain renderer and tests.

## Next

- [ ] P1 Human promotion loop Lane: Docs Language. Done when: the queue makes a
      clear jump from evidence to action: "inspect these reports, edit this
      skill owner path, or record no-build"; docs explain this with one example.
      Next: write after `reports`, `report`, `usage`, and `queue` exist.

## Later

- [ ] P3 Decide purge plain-output parity Lane: CLI Contract. Done when:
      `purge` either advertises and tests `--plain`, or the smoke matrix records
      JSON-only purge output as intentional. Next: inspect
      `skillFeedbackContracts.purge` output modes and purge renderer ownership.

## Latest Signals

- 2026-07-01: Zero-arg front door now aliases contract-backed `dashboard`,
  grouped into good and needs-work checks. `health` keeps JSON/plain output for
  scripts and agents. Unit and process-boundary tests cover empty, populated,
  and unsafe dashboard paths; review engineering signals now preserve every
  owner path on open ledger entries.
- 2026-06-30: Decision surface and bounded review plain output closed:
  `decision-surface.ts` owns review and health result assembly; runner keeps
  process envelopes and plain renderers. `review --plain` now surfaces health,
  top warning, next action, top open actions, top ledger anchors, truncation
  facts, and `full_evidence=json`; review JSON remains complete.
- 2026-06-30: Inherited Fallow cleanup closed. `audit` reports
  `introduced=0 inherited=0`; `dead-code`, `dupes`, and `health` report zero
  findings for `skills/skill-feedback`. Shared raw-object helpers removed the
  production duplicate; adjacent suppressions now document analyzer blind spots
  for public seams, test entrypoints, fixture duplication, and covered
  parser/orchestration complexity. Package runner passed 13 files, 299 tests;
  typecheck passed.
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
bun run skills/skill-feedback/src/skill-feedback-runner.ts
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts review --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts correlate --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts purge --help
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
bun --filter skill-feedback-scripts typecheck
```
