---
name: browser-use-ledger
description: "Manage the Browser Use daily-driver acceptance ledger: triage rows, prioritise P0-P3, harvest edge-case candidates, flip verdicts with test receipts. Use for ledger status, what's next on the ledger, or regression gating."
---

# Browser Use Ledger

Steward the acceptance ledger at
`skills/browser-use/docs/plans/2026-07-27-daily-driver-acceptance-ledger.md`.
The ledger owns verdicts, tiers, and admission rules (its `Rules` and
`Proof tiers` sections); receipts live in `skills/browser-use/TEST_MATRIX.md`.

## Workflow

1. Read the ledger status summary; report counts and the open
   FAIL/BLOCKED/UNASSESSED clusters.
2. Prioritise open rows:
   - P0: safety invariants — default-profile isolation, mutation truth,
     secret handling.
   - P1: daily-driver capability gaps blocking a tier-required PASS.
   - P2: coverage and robustness gaps on existing capability.
   - P3: polish, wording, duplicated-surface cleanup.
3. Verdict flips follow the ledger Rules verbatim: PASS needs a named fixture,
   test path, or live receipt recorded first; BLOCKED stays BLOCKED until its
   gate clears — never skipped or passed.
4. Regression gate: fix a FAIL test-first with the external `tdd` skill; the new test
   path lands in the ledger row and TEST_MATRIX before the flip.
5. Edge-case harvest: propose new rows as UNASSESSED with a tier from the
   ledger's tier table; park unadmitted candidates in the deferred-candidates
   appendix, never as silent omissions.
6. Live proof routes through `skills/browser-use/SKILL.md` — Warm Chrome only,
   never human Chrome on port 9222.

## Blocked

- Operator gates (pinned adapter installs, owner decisions) stay BLOCKED rows
  with the gate named; report them, do not work around them.

No args: read the ledger, report verdict counts, the top P0/P1 queue, and one
next safe action.
