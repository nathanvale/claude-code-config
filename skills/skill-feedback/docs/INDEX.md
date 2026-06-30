# Skill Feedback Source Docs

Local home for brainstorms, ideation artifacts, and plans that shaped
`skill-feedback`.

These files moved from root `docs/` into the skill package so skill-feedback
owns its source history beside the implementation.

## Scope

Included:

- primary skill-feedback brainstorms,
- primary skill-feedback ideation,
- primary skill-feedback plans,
- Branch Station pilot docs because `skills/skill-feedback/src/branch-station-catalog.ts`
  is the first package-owned catalog implementation.

Not copied:

- decisions, ADRs, research, and reviews,
- broader repo-workability or create-cli docs that only mention skill-feedback as
  one signal.

Those adjacent docs are linked below.

## Brainstorms

| File | Current path | Role |
| --- | --- | --- |
| [2026-06-10-skill-follow-up-feedback-loop-requirements.md](./brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md) | `skills/skill-feedback/docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md` | Origin requirements for the feedback loop and `.skill-feedback/` inbox. |
| [2026-06-12-skill-feedback-review-pattern-ledger-v2-requirements.md](./brainstorms/2026-06-12-skill-feedback-review-pattern-ledger-v2-requirements.md) | `skills/skill-feedback/docs/brainstorms/2026-06-12-skill-feedback-review-pattern-ledger-v2-requirements.md` | v2 review-ledger requirements before the claim-safe pivot. |
| [2026-06-14-skill-feedback-health-requirements.md](./brainstorms/2026-06-14-skill-feedback-health-requirements.md) | `skills/skill-feedback/docs/brainstorms/2026-06-14-skill-feedback-health-requirements.md` | Health command requirements and false-empty prevention. |
| [2026-06-15-deterministic-cli-branch-confidence-requirements.md](./brainstorms/2026-06-15-deterministic-cli-branch-confidence-requirements.md) | `skills/skill-feedback/docs/brainstorms/2026-06-15-deterministic-cli-branch-confidence-requirements.md` | Branch Station requirements; skill-feedback is the pilot package. |

## Ideation

| File | Current path | Role |
| --- | --- | --- |
| [2026-06-13-skill-feedback-review-pivot-ideation.html](./ideation/2026-06-13-skill-feedback-review-pivot-ideation.html) | `skills/skill-feedback/docs/ideation/2026-06-13-skill-feedback-review-pivot-ideation.html` | Review pivot idea ranking behind claim-safe v2. |
| [2026-06-15-deterministic-cli-branch-confidence-ideation.html](./ideation/2026-06-15-deterministic-cli-branch-confidence-ideation.html) | `skills/skill-feedback/docs/ideation/2026-06-15-deterministic-cli-branch-confidence-ideation.html` | Branch Station idea ranking behind the package-owned catalog. |

## Plans

| File | Current path | Role |
| --- | --- | --- |
| [2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md](./plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md) | `skills/skill-feedback/docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md` | v0 package, record command, adapters, redaction, gitignore gate. |
| [2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md](./plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md) | `skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md` | v1 report card, closeout, review, purge-ready boundary. |
| [2026-06-12-002-feat-skill-feedback-pattern-ledger-v2-plan.md](./plans/2026-06-12-002-feat-skill-feedback-pattern-ledger-v2-plan.md) | `skills/skill-feedback/docs/plans/2026-06-12-002-feat-skill-feedback-pattern-ledger-v2-plan.md` | Superseded v2 anchor-ledger plan; historical context. |
| [2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md](./plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md) | `skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md` | Implemented claim-safe `ReviewResultData` v2 plan; historical source for reducer and review contract. |
| [2026-06-13-002-skill-feedback-ica-vocabulary-convergence-map.md](./plans/2026-06-13-002-skill-feedback-ica-vocabulary-convergence-map.md) | `skills/skill-feedback/docs/plans/2026-06-13-002-skill-feedback-ica-vocabulary-convergence-map.md` | ICA vocabulary convergence map for `CONTEXT.md`. |
| [2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md](./plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md) | `skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md` | Review trust-boundary and low-signal hardening. |
| [2026-06-15-001-feat-skill-feedback-health-command-plan.md](./plans/2026-06-15-001-feat-skill-feedback-health-command-plan.md) | `skills/skill-feedback/docs/plans/2026-06-15-001-feat-skill-feedback-health-command-plan.md` | Health command and read-target resolution. |
| [2026-06-15-002-feat-cli-branch-station-maps-plan.md](./plans/2026-06-15-002-feat-cli-branch-station-maps-plan.md) | `skills/skill-feedback/docs/plans/2026-06-15-002-feat-cli-branch-station-maps-plan.md` | Branch Station Map plan; skill-feedback is first package pilot. |
| [2026-06-24-001-fix-skill-feedback-capture-trust-run-correlation-plan.md](./plans/2026-06-24-001-fix-skill-feedback-capture-trust-run-correlation-plan.md) | `skills/skill-feedback/docs/plans/2026-06-24-001-fix-skill-feedback-capture-trust-run-correlation-plan.md` | Writer proof, `.trust/`, proof health, run correlation. |
| [2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md](./plans/2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md) | `skills/skill-feedback/docs/plans/2026-06-25-001-feat-skill-feedback-correlation-witnesses-plan.md` | Private signed correlation witnesses. |
| [2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md](./plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md) | `skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md` | Correlate preview/execute backfill repair. |
| [2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md](./plans/2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md) | `skills/skill-feedback/docs/plans/2026-06-29-001-refactor-skill-feedback-p1-task-list-plan.md` | P0/P1 task closure, owner split, and no-build decisions. |
| [2026-06-30-001-refactor-skill-feedback-decision-surface-review-plain-plan.md](./plans/2026-06-30-001-refactor-skill-feedback-decision-surface-review-plain-plan.md) | `skills/skill-feedback/docs/plans/2026-06-30-001-refactor-skill-feedback-decision-surface-review-plain-plan.md` | Decision surface module and bounded review plain output plan. |

## Adjacent Root Docs

These stay in root docs because they are not brainstorm, ideation, or plan
artifacts:

- `docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md`
- `docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md`
- `docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md`
- `docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md`
- `docs/reviews/2026-06-15-whole-branch-fallow-reconciliation.md`

## Placement Rule

New skill-feedback brainstorms, ideation artifacts, and plans belong under this
folder, not root `docs/brainstorms`, `docs/ideation`, or `docs/plans`.
