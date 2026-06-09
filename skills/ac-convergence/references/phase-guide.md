# Phase Guide

Detailed execution notes for each convergence phase.

## Prerequisites

Before starting Phase 1:

1. Locate the AC baseline and ledger — e.g.
   `extensions/MON-EXT-SL-04-Admin-Charges-Fees/docs/jira-ac-baseline-2026-06-09.md`
   and `jira-ac-convergence-ledger.md`.
2. Confirm the tier split (component vs live-host vs backend-gated).
3. Confirm test runner works: `cd skills/test-runner && bun run test-runner --help`.
4. Confirm `var/ac-convergence/` exists or create it (local scratch only, not committed).

## Phase 1 — Harvest

**Fan-out pattern:** one agent per AC tier cluster. Clusters should be small enough
(~10–20 ACs) that a single context window can hold all test output.

For each cluster agent:
- Scope: the AC IDs in that cluster.
- Command: run `skills/test-runner/SKILL.md` triage mode against the cluster's test files.
- Collect stdout JSON from the runner.
- Map each failure to the finding schema in `findings-schema.md`.
- Return a flat `findings[]` array — no synthesis.

**Pitfall:** agents must not fix findings during Phase 1 — harvest only.
Record the raw error; do not attempt a repair.

**Output:** write each agent's findings array to
`var/ac-convergence/harvest-<cluster>.json`.

## Phase 2 — Triage

Single agent. Input: all `harvest-*.json` files concatenated.

Steps:
1. Load all findings.
2. Group by `root_cause` (same error + same source location = same cause).
3. Tag each canonical finding (see `findings-schema.md#tags`).
4. Sort: `fixable-now` → `needs-fixture` → `blocked-backend` → `flake`.
5. Write triage manifest to `var/ac-convergence/triage-manifest.json`.

**Pitfall:** do not mark `blocked-backend` as `fixable-now` even if the AC looks
testable — check whether the fixture captures real data or is stubbed.

## Phase 3 — Synthesise

Single agent. Input: `triage-manifest.json`.

Steps:
1. Open the ledger file.
2. For each `fixable-now` finding: apply the `fix_hint`, write a fixture-backed test,
   update the ledger row to PASS (or FAIL with evidence if fix fails).
3. For each `needs-fixture`: write a `test.skip('needs-fixture AC-xxx')` stub + ledger note.
4. For each `blocked-backend`: update the ledger row to BLOCKED with reason.
5. For each `flake`: mark PARTIAL + note isolation needed.
6. Emit the delta report to stdout (see `findings-schema.md#phase-3-delta-report`).
7. Commit ledger patch only when all rows updated — use dry-run first.

**Pitfall:** never mark PASS without a fixture-backed assertion.
A test that passes against an empty/stub fixture is not convergence evidence.

## Handoff Contract Between Agents

- Phase 1 → 2: findings array JSON file path (`var/ac-convergence/harvest-*.json`).
- Phase 2 → 3: triage manifest JSON file path (`var/ac-convergence/triage-manifest.json`).
- Phase 3 → human: delta report stdout + ledger diff.

Keep handoff via file path, not prose — the synthesis agent must be ignorant of
test mechanics and read only the manifest.

## Stopping Conditions

- **Converged:** all AC rows are PASS, BLOCKED (with named backend owner), or N/A.
- **Blocked:** no `fixable-now` findings remain and `needs-fixture` requires live browser
  access unavailable in the current session. Record state; hand off to browser session.
- **Flake loop:** same finding tagged `flake` across 2+ runs — escalate to human,
  do not loop indefinitely.
