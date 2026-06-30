# Skill Feedback Task Archive

Retrospective digest for completed skill-feedback work.

Live dashboard: `TASKS.md`. Source lineage: `PROVENANCE.md`. Agent route:
`SKILL.md`.

## Archive Contract

Use this file to understand what trust was gained, which decisions changed
future routing, and where source evidence lives. Do not use it as a queue.

Rules:

1. Start with a timeline index.
2. Keep active work in `TASKS.md`.
3. Name the trust gained, not every checkbox closed.
4. Link source owners instead of copying schemas or CLI JSON.
5. Record decisions only when they affect future routing.
6. Name exceptions and caveats where they change next work.
7. Keep follow-up lines pointed at current `TASKS.md`.
8. Run `git diff --check -- skills/skill-feedback/TASKS.archive.md` after edits.

## Timeline Index

| Date | Outcome | Trust Added | Follow-Up / Current Status |
| --- | --- | --- | --- |
| 2026-06-11 | v0 capture package | Hook-owned report writes, gitignore gate, redaction | Later report-card and review work |
| 2026-06-12 | report-card v1 | Driver closeout, typed gaps, mutation-free review | Claude daily pilot supported; Codex identity deferred |
| 2026-06-13 | claim-safe v2 review | Entry-local claims, owner-path anchors, readiness split | Correlation shipped; Codex identity deferred |
| 2026-06-13 | review merge hardening | Low-signal lane, purge containment, stable refs | Health command shipped |
| 2026-06-15 | health command | False-empty prevention, next-action routing | Correlation health shipped |
| 2026-06-24 | writer proof | Local `.trust/`, proof health, evidence-only fallback | Codex Trusted skill identity stays separate and deferred |
| 2026-06-25 | correlation witnesses | Private Claude hook-to-closeout links | Backfill repair shipped |
| 2026-06-28 | correlation backfill plan | Preview/execute repair contract direction | Durable candidate source resolved in code |
| 2026-06-29 | docs router and tracker uplift | Package docs split, tracker lanes, ICA vocabulary cleanup | Current queue lives in `TASKS.md` |
| 2026-06-29 | correlation backfill shipped | `correlate` preview/execute, durable finalizer-authored candidate source, verified on main | Codex lifecycle watch; Trusted skill identity deferred |
| 2026-06-29 | Claude daily-pilot readiness scoped | Claude readiness separated from Codex Trusted skill identity | Codex lifecycle watch |
| 2026-06-29 | P0/P1 ownership refactor closed | Normalizer, inbox read, and witness workflow owners split from runner/catalog | P2 renderer and harness work later closed |
| 2026-06-30 | Decision Surface Renderer | Plain readiness labels are contract-owned; correlate action text stays result-owned | Branch Station scenario harness later closed |
| 2026-06-30 | P2 queue closed | Station helpers and retention no-build contracts pinned by tests | No open P2 tasks |
| 2026-06-30 | Dirty-tree review follow-ups closed | Artifact and runtime ownership split; plan directives made imperative | One P3 purge output parity question remains |
| 2026-06-30 | Decision surface and bounded review plain closed | Review/health assembly owner split; plain review bounded around next action | One P3 purge output parity question remains |
| 2026-06-30 | Inherited Fallow cleanup closed | Audit, dead-code, dupes, and health clean for skill-feedback | One P3 purge output parity question remains |

## 2026-06-11 - V0 Capture Package

- Outcome: skill-feedback gained a package, facade-backed `record`, capture
  adapter seams, gitignored `.skill-feedback/` writes, and redaction.
- Trust added: reports can be written as repo-local evidence without becoming
  canonical skill instruction.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`;
  `docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`.
- Decisions: capture fires from harness hooks, not agent recall.
- Follow-up: report-card closeout and review moved to v1.

## 2026-06-12 - Report-Card V1

- Outcome: driver closeout, report-card lanes, typed evidence gaps, and a
  mutation-free review surface were planned and implemented.
- Trust added: a driver can enrich capture evidence without giving reports
  instruction authority.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md`;
  `skills/skill-feedback/references/closeout-receipt.md`;
  `skills/skill-feedback/references/report-shape.md`.
- Decisions: closeout is driver-authored; a finished skill does not file its own
  report.
- Follow-up: daily pilot stayed gated on review, correlation, and true Codex
  proof.

## 2026-06-13 - Claim-Safe V2 Review

- Outcome: review moved to `ReviewResultData`, review units, ledger entries,
  owner-path anchors, and entry-local allowed claims.
- Trust added: renderers can repeat code-owned facts without inventing global
  trust or readiness claims.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md`;
  `skills/skill-feedback/src/review-ledger-reducer.ts`;
  `skills/skill-feedback/src/ledger-anchor-adapter.ts`.
- Decisions: Trusted run proof stays separate from Trusted skill identity.
- Follow-up: correlation and Codex identity remained open.

## 2026-06-13 - Review Merge Hardening

- Outcome: public telemetry trust was sealed, low-signal capture was separated,
  purge became gated, and raw inbox reads were hardened.
- Trust added: low-signal Codex Stop capture can prove capture health without
  entering primary review claims.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md`;
  `docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md`.
- Decisions: review and health stay mutation-free; purge is the deletion path.
- Follow-up: health command and correlation health.

## 2026-06-15 - Health Command

- Outcome: `health` became the read-only front door for inbox operability,
  readiness, warnings, correlation, and one next action.
- Trust added: agents can distinguish missing, empty, unsafe, low-signal, and
  false-empty states before deep review.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-15-001-feat-skill-feedback-health-command-plan.md`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/src/command-contract.ts`.
- Decisions: explicit `--repo` failure does not fall back to caller cwd.
- Follow-up: proof health and correlation witness health.

## 2026-06-24 - Writer Proof

- Outcome: local writer proof, `.trust/`, proof health, and evidence-only
  fallback were added.
- Trust added: selected writer-owned fields can survive normalization when proof
  verifies; missing or unsafe proof keeps reports evidence-only.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-24-001-fix-skill-feedback-capture-trust-run-correlation-plan.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`.
- Decisions: writer proof does not prove Trusted skill identity or correlation.
- Follow-up: signed correlation witnesses.

## 2026-06-25 - Correlation Witnesses

- Outcome: Claude Stop can finalize private signed witnesses linking one runtime
  hook report to one driver closeout report.
- Trust added: review can overlay `correlation_owned` only after witness, writer
  proof, skill match, and runtime run id checks.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md`;
  `skills/skill-feedback/references/report-shape.md`;
  `skills/skill-feedback/CONTEXT.md`.
- Decisions: public closeout receipts cannot create witnesses or set correlation
  provenance.
- Follow-up: correlation backfill repair.

## 2026-06-28 - Correlation Backfill Plan

- Outcome: `correlate` preview/execute repair path was planned for blocked
  witness diagnostics.
- Trust added: repair has an explicit CLI posture instead of health or review
  mutating inbox state.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`.
- Decisions: execute recomputes current private evidence before writing.
- Follow-up: durable repairable candidate source shipped in the 2026-06-29
  correlation backfill.

## 2026-06-29 - Correlation Backfill Shipped

- Outcome: the 2026-06-28 backfill plan (U1-U5) was implemented and merged to
  main: `correlate` ships with preview default and `--execute`, plain/JSON
  output, `--repo`, and Branch Station coverage for preview, execute,
  already-linked, ambiguous, insufficient-evidence, unsafe-inbox, and
  invalid-usage branches.
- Trust added: the correlation finalizer now embeds a durable
  `repair_candidates[]` source into blocked diagnostic artifacts, so execute
  recomputes and revalidates against current private evidence before writing a
  witness. The durable-candidate-source open question from 2026-06-28 is
  resolved in code; public argv and stdin still cannot mint trust-bearing
  correlation fields.
- Caveat: the 4 pre-existing live diagnostics are legacy sparse artifacts
  (`hook_report_id` + `correlation_candidate_missing` only). They correctly stay
  `insufficient_evidence` per KTD5; live `correlate --plain` reporting
  `no_repair_available` for them is by-design, not a gap. New runs carry
  repairable sources.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/src/branch-station-catalog.ts`;
  `hooks/skill-feedback-stop.ts`.
- Verification: package tests pass (7 files, 274 tests, 0 failed); `tsc_check`
  clean; merged to main at `1c38f90a`.
- Decisions: legacy sparse diagnostics remain unrecoverable by design; durable
  candidate sources are finalizer-authored, never public input.
- Follow-up: Codex Trusted skill identity remains deferred/watchpoint; Claude
  daily pilot is supported.

## 2026-06-29 - Claude Daily-Pilot Readiness Scoped

- Outcome: `health` and `review` now render Claude daily-pilot support as a
  runtime-scoped readiness fact while Codex Trusted skill identity remains
  blocked/deferred.
- Trust added: agents can use Claude Code daily-pilot wording without claiming
  Codex can prove Trusted skill identity.
- Evidence: `docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md`;
  `skills/skill-feedback/CONTEXT.md`;
  `skills/skill-feedback/references/report-shape.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`.
- Verification: `health --plain` shows Claude daily pilot `ready` and Codex
  Trusted skill identity `blocked`; `review` JSON schema is `7`; health schema
  is `4`; package tests pass (7 files, 274 tests, 0 failed); typecheck clean.
- Caveat: Fallow still reports reviewed introduced private-helper prompts
  around the Claude Stop trust predicate; behavior is covered through public
  health and review tests.
- Decisions: Decision 44 supersedes the old Codex E2E daily-pilot blocker for
  Claude-supported daily use.
- Follow-up: Codex Trusted skill identity remains deferred/watchpoint; no
  active `TASKS.md` item tracks it until an engine-owned source appears.

## 2026-06-29 - P0/P1 Ownership Refactor Closed

- Outcome: the six open P1s from `TASKS.md` closed without expanding into the
  P2 queue. Codex lifecycle support remains a watchpoint, native
  skill-attributed cost remains `cost_unavailable`, and `report:<id>` remains a
  documented review JSON lookup.
- Trust added: command discovery, help, parser rules, result contracts, and
  schema versions remain facade-owned while persisted report normalization,
  inbox evidence reads, and correlation witness workflow behavior have narrower
  source owners.
- Evidence: `skills/skill-feedback/docs/plans/2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/report-normalizer.ts`;
  `skills/skill-feedback/src/inbox-read-model.ts`;
  `skills/skill-feedback/src/correlation-witness-workflow.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/references/report-shape.md`;
  `docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md`.
- Verification: package tests pass (9 files, 276 tests, 0 failed); typecheck
  clean; help, health, review, and whitespace gates pass.
- Decisions: official Codex docs refreshed on 2026-06-29 showed skill
  invocation and hook events but no engine-owned skill-use lifecycle event, so
  Codex Trusted skill identity remains deferred. No trusted native
  skill-attributed cost source was named. No downstream raw report lookup
  friction justified a public resolver command.
- Follow-up: P2 renderer and harness work later closed on 2026-06-30.

## 2026-06-29 - Docs Router And Tracker Uplift

- Outcome: Component Tracker's package-doc pattern was transferred to
  skill-feedback through a package-local agent guide, README, architecture map,
  active tracker, archive, and CONTEXT vocabulary cleanup.
- Trust added: agents get read order, owners, command postures, lanes, and next
  safe actions without copied command schemas.
- Evidence: `skills/skill-feedback/AGENTS.md`;
  `skills/skill-feedback/README.md`;
  `skills/skill-feedback/ARCHITECTURE.md`;
  `skills/skill-feedback/TASKS.md`;
  `skills/skill-feedback/CONTEXT.md`.
- Decisions: `SKILL.md` remains workflow owner; `AGENTS.md` routes package
  maintenance.
- Follow-up: use `TASKS.md` for current queue.

## 2026-06-30 - Decision Surface Renderer

- Outcome: `health --plain` and `review --plain` now render readiness labels
  from `SKILL_FEEDBACK_DECISION_READINESS_SURFACES`; `correlate --plain`
  next-action text is asserted from correlate result data.
- Trust added: plain renderers repeat contract-owned decision surfaces and
  result-owned actions instead of choosing readiness claims in renderer code.
- Evidence: `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/src/command-contract.test.ts`;
  `skills/skill-feedback/src/skill-feedback.test.ts`.
- Verification: package tests pass (9 files, 277 tests, 0 failed); typecheck,
  help, health, review, correlate, and whitespace gates pass.
- Follow-up: Branch Station scenario harness later closed on 2026-06-30.

## 2026-06-30 - P2 Queue Closed

- Outcome: the remaining P2 queue closed. Branch Station integration rows now
  use named station helpers for repeated ignored-git setup, runner execution,
  envelope parsing, and evidence return. Retention decisions stayed no-build:
  interrupted temp artifacts remain invalid-health evidence only; purge skips
  `.correlation/` witness and diagnostic artifacts; `pilot_started_at` remains
  manual source evidence with no purge coupling.
- Trust added: process-boundary station coverage stays catalog-driven while
  repeated fixture setup is behind named helpers, and retention boundaries are
  proved by behavior tests instead of future-command prose.
- Evidence: `skills/skill-feedback/src/skill-feedback.integration.test.ts`;
  `skills/skill-feedback/src/skill-feedback.test.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/references/report-shape.md`;
  `skills/skill-feedback/ARCHITECTURE.md`;
  `skills/skill-feedback/CONTEXT.md`.
- Verification: package tests pass (9 files, 279 tests, 0 failed); typecheck,
  help, health, review, correlate, and whitespace gates pass.
- Decisions: no temp-GC command, correlation-artifact purge command, or pilot
  marker cleanup command was added because current evidence supports preserving
  those artifacts as health or source evidence.
- Follow-up: no open P2 tasks remain in `TASKS.md`.

## 2026-06-30 - Dirty-Tree Review Follow-Ups Closed

- Outcome: dirty-tree review follow-ups closed. Correlation artifact ownership
  moved to `src/correlation-witness-artifacts.ts`; runtime contract ownership
  moved to `src/runtime-contract.ts`; KTD2 and KTD7 in the P0/P1 plan now use
  imperative directives.
- Trust added: artifact read/parse/classify helpers and safe witness filesystem
  helpers have a narrow owner; runtime interfaces no longer live in the runner
  dependency cycle; plan text no longer reads like implementation-ready policy.
- Evidence: `skills/skill-feedback/src/correlation-witness-artifacts.ts`;
  `skills/skill-feedback/src/runtime-contract.ts`;
  `skills/skill-feedback/docs/plans/2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md`;
  `skills/skill-feedback/TASKS.md`.
- Verification: package runner passed 10 files and 282 tests; `bun --filter
  skill-feedback-scripts typecheck` passed; `git diff --check --
  skills/skill-feedback docs/decisions docs/research` clean.
- Decisions: no active P1/P2 queue remains. The only later item is the P3 purge
  plain-output parity question in `TASKS.md`.
- Follow-up: review/commit prep only unless new tasks appear.

## 2026-06-30 - Decision Surface And Bounded Review Plain Closed

- Outcome: review and health result assembly moved to
  `skills/skill-feedback/src/decision-surface.ts`; `review --plain` became a
  bounded decision surface around health, next action, top open actions, and top
  ledger anchors.
- Trust added: maintainers can change warnings, next action, readiness,
  retention, pilot checkpoint, and read-target projection without treating the
  runner as the decision owner. Agents get bounded plain output plus
  `full_evidence=json` when full arrays are needed.
- Evidence: `skills/skill-feedback/src/decision-surface.ts`;
  `skills/skill-feedback/src/decision-surface.test.ts`;
  `skills/skill-feedback/src/skill-feedback-runner.ts`;
  `skills/skill-feedback/src/skill-feedback.test.ts`;
  `skills/skill-feedback/references/report-shape.md`.
- Verification: focused decision-surface tests, runner tests, command-contract
  tests, branch-station catalog tests, and typecheck passed during the slice.
- Decisions: no schema version, parser rule, command flag, or JSON evidence
  field changed; caps stay runner-owned and fixed.
- Follow-up: the P3 purge plain-output parity question remains the only tracker
  item.

## 2026-06-30 - Inherited Fallow Cleanup Closed

- Outcome: inherited Fallow debt for `skills/skill-feedback` closed. `audit`
  reports `introduced=0 inherited=0`; `dead-code`, `dupes`, and `health`
  report zero findings.
- Trust added: public Branch Station and capture adapter seams are retained with
  local analyzer proof; Bun test entrypoints are marked as runner-invoked; test
  fixture duplication is marked where scenario literals are intentional;
  line-level complexity suppressions sit next to covered owner-local defensive
  branches; shared raw-object helpers remove the one production duplicate.
- Evidence: `skills/skill-feedback/src/raw-object.ts`;
  `skills/skill-feedback/src/command-contract.ts`;
  `skills/skill-feedback/src/report-normalizer.ts`;
  `skills/skill-feedback/src/branch-station-catalog.ts`;
  `skills/skill-feedback/src/capture-adapters.ts`;
  `skills/skill-feedback/AGENTS.md`.
- Verification: Fallow `audit`, `dead-code`, `dupes`, and `health` are clean;
  package tests pass (13 files, 299 tests, 0 failed); typecheck passed.
- Decisions: no public command flags, schema versions, parser acceptance,
  result contract ids, or JSON result fields changed.
- Follow-up: the P3 purge plain-output parity question remains the only tracker
  item.
