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

| Date | Outcome | Trust Added | Active Follow-Up |
| --- | --- | --- | --- |
| 2026-06-11 | v0 capture package | Hook-owned report writes, gitignore gate, redaction | Later report-card and review work |
| 2026-06-12 | report-card v1 | Driver closeout, typed gaps, mutation-free review | Daily pilot gate |
| 2026-06-13 | claim-safe v2 review | Entry-local claims, owner-path anchors, readiness split | Correlation and Codex identity |
| 2026-06-13 | review merge hardening | Low-signal lane, purge containment, stable refs | Health command |
| 2026-06-15 | health command | False-empty prevention, next-action routing | Correlation health |
| 2026-06-24 | writer proof | Local `.trust/`, proof health, evidence-only fallback | Trusted identity remains separate |
| 2026-06-25 | correlation witnesses | Private Claude hook-to-closeout links | Backfill repair |
| 2026-06-28 | correlation backfill plan | Preview/execute repair contract direction | Durable candidate source |
| 2026-06-29 | docs router and tracker uplift | Package docs split, tracker lanes, ICA vocabulary cleanup | `TASKS.md` active queue |

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
- Follow-up: define durable repairable candidate source or narrow execute scope
  in `TASKS.md`.

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
