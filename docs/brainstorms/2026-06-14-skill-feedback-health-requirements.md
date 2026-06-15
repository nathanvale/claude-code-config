---
date: "2026-06-14"
topic: skill-feedback-health
title: Skill-feedback health requirements
type: brainstorm
---

# Skill-feedback health requirements

## Summary

Make `skill-feedback` usable by adding a truthful health surface before adding richer review intelligence. The next slice fixes false-empty review output and adds a compact `health` command that tells an agent whether the inbox is present, trustworthy, noisy, correlated, and safe to act on.

---

## Problem Frame

`skill-feedback review` already carries useful data: coverage, inbox health, low-signal counts, ledger entries, open actions, and claim readiness. The product still fails the operator test when one invocation path can report no evidence while another sees a populated inbox.

This is a trust problem, not a dashboard problem. A user or agent needs one command that answers whether the report system is healthy enough to use before reading the ledger.

---

## Key Decisions

- **Health before intelligence.** Fix command trust and health reporting before taxonomy, dashboards, or narrative suggestions.
- **Truthful empty states.** Empty review output is allowed only when the resolved inbox is actually empty or absent, and the output says which case happened.
- **Git-root default with escape hatch.** `review` and `health` resolve the caller's git root by default, and support an explicit `--repo` override for unusual invocation contexts.
- **Health is separate from review.** `review` can stay evidence-rich; `health` is the compact operability check.
- **Low-signal is capture evidence.** Unknown-skill Stop reports are not junk; they prove hooks are firing without trusted skill identity.
- **Correlation is not optional language.** Until reports are linked by trusted run proof, health must say report-level evidence only.

---

## Actors

- A1. **Driver agent:** Runs health before using report evidence.
- A2. **Human operator:** Reads the health result to decide whether to trust, inspect, purge, or repair.
- A3. **Skill-feedback runtime:** Resolves repo root, scans the inbox, and emits command envelopes.
- A4. **Planner or reviewer:** Uses health output to distinguish product defects from noisy evidence.

---

## Key Flows

- F1. Health check before review
  - **Trigger:** Agent wants to inspect skill-feedback evidence.
  - **Actors:** A1, A3
  - **Steps:** Agent runs `skill-feedback health`; runtime resolves the owning repo; command scans primary and low-signal lanes; output returns state, counts, blockers, and one next action.
  - **Outcome:** Agent knows whether `review` is safe to trust.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. False-empty prevention
  - **Trigger:** A documented invocation path runs from a package or workspace context.
  - **Actors:** A1, A3
  - **Steps:** Runtime resolves the intended repo root before scanning; if the command would scan a different root, output exposes the resolved root and inbox path.
  - **Outcome:** Reports on disk cannot be hidden by package working-directory drift.
  - **Covered by:** R1, R2, R12

- F3. Noisy capture triage
  - **Trigger:** Low-signal reports accumulate.
  - **Actors:** A1, A2, A3
  - **Steps:** Health reports low-signal count, newest low-signal timestamp, dominant reason ids, and capture-readiness implication.
  - **Outcome:** Unknown-skill noise becomes a hook identity repair signal.
  - **Covered by:** R6, R7, R8

---

## Requirements

**Truthful Inbox Resolution**

- R1. `review` and `health` must resolve the same repo root for the same user intent.
- R2. `review` and `health` must default to the caller's git root and expose `--repo` as an explicit override.
- R3. Health output must show whether the inbox is missing, empty, populated, unsafe, or partially readable.
- R4. Health output must include primary report count, low-signal count, invalid count, and skipped-unsafe count.
- R5. Health output must expose the newest report age or timestamp for primary and low-signal lanes when present.

**Health Product Surface**

- R6. Add `skill-feedback health` as a read-only command with JSON and plain output.
- R7. Health must classify low-signal reports as capture-health evidence, not primary learning evidence.
- R8. Health must summarize readiness as runtime capture, Trusted skill identity, and Daily pilot.
- R9. Health must summarize correlation state, including unlinked primary report count.
- R10. Health must return one recommended next action based on the highest-risk health problem.
- R11. Health must keep output compact enough to read before `review`.

**Review Usability**

- R12. `review` must fail or warn loudly when root resolution prevents it from seeing an existing inbox.
- R13. `review --plain` should keep the current rich evidence view but avoid flooding the first screen before health-critical warnings.
- R14. Open actions should be rankable by severity, recurrence, owner clarity, and next-action clarity.

**Retention And Repair**

- R15. Health must warn when low-signal count crosses a configured threshold.
- R16. Health must warn when report age or count suggests a purge preview.
- R17. Health must never delete or mutate inbox files.
- R18. Health must point deletion work to `purge`, not inline cleanup.

**Command Contract**

- R19. `health` must be facade-backed with discovery metadata, rendered help, argv acceptance tests, and runtime semantics tests.
- R20. `health` must use package-owned constants for result contract id, schema version, statuses, reason ids, and next-action ids.
- R21. Existing `review` and `purge` command contracts must continue to align with discovery metadata and rendered help after health lands.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given `.skill-feedback/` contains safe reports, when the documented package-filter review command runs, then output reports the same nonzero counts as the direct runner.
- AE2. **Covers R3, R4.** Given the inbox is missing, when health runs, then it reports `missing` rather than `healthy`.
- AE3. **Covers R6, R10.** Given primary reports exist and all are unlinked, when health runs, then the top next action is to repair correlation or treat evidence as report-level only.
- AE4. **Covers R7, R8.** Given many unknown-skill Codex Stop reports exist, when health runs, then it reports hook firing as `runtime capture evidence` while keeping Trusted skill identity blocked.
- AE5. **Covers R15, R16, R17.** Given low-signal count exceeds the threshold, when health runs, then it recommends purge preview or identity repair and deletes nothing.
- AE6. **Covers R19, R20.** Given `health --help` renders, when command metadata is inspected, then discovery, help, parser, and runtime contract use the same command vocabulary.

---

## Success Criteria

- A tired agent can run one command and know whether the inbox is usable.
- A false-empty review path is caught by tests and cannot silently recur.
- Low-signal growth is framed as capture-health evidence with a repair path.
- Unlinked primary reports are reported as correlation health before target-skill quality.
- `review` remains useful for evidence inspection after `health` answers operability.

---

## Scope Boundaries

**Deferred for later**

- Failure-class taxonomy.
- Narrative-assisted suggestions.
- Daily pilot launch claims.
- Dashboard or browser UI.
- Automatic report repair.
- Trusted skill identity support, unless an engine-owned source becomes available during planning.

**Outside this slice**

- Treating low-signal reports as primary learning evidence.
- Deleting reports during health or review.
- Inferring `corroborated` from shared paths or timestamps.
- Replacing `review` with a new dashboard.

---

## Dependencies And Assumptions

- `.skill-feedback/` remains gitignored and repo-local.
- `purge` remains the only deletion workflow.
- `skills/skill-feedback/src/command-contract.ts` owns command vocabulary and result contracts.
- `skills/skill-feedback/src/skill-feedback-runner.ts` owns repo-root resolution and inbox scanning.
- `skills/skill-feedback/references/report-shape.md` remains the field ownership map.

---

## Outstanding Questions

### Resolve Before Planning

- What thresholds should health use for low-signal count, report age, and report count warnings?

### Deferred To Planning

- Should health be a separate result contract or a compact projection of review result data?
- Should health support `--json` only by default, or mirror review's plain/JSON behavior?
- How should `review --plain` rank open actions without hiding evidence needed for inspection?

---

## Sources

- `skills/skill-feedback/SKILL.md`
- `skills/skill-feedback/CONTEXT.md`
- `skills/skill-feedback/references/report-shape.md`
- `skills/skill-feedback/src/command-contract.ts`
- `skills/skill-feedback/src/skill-feedback-runner.ts`
- `docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md`
- `docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md`
