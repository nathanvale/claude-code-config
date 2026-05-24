# Stop conditions - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| 001 | contract-review-cycle-cap-no-resume-row | fixed | low | `contract-review-cycle-cap` (Stage 3 shell L274-276) has no distinct `<fail_stops>` resume row; the two nearest rows cover different semantics. | commit 9e97cc0 |
| 002 | stage-6-smoke-direct-no-fail-stop-row | fixed | low | Stage 6 `smoke-direct-on-non-disposable` (shell L341) has no `<fail_stops>` row; resume contract lives only in `stage-6-ship.md`. | commit 9e97cc0 |
| 003 | stage-5-reviewer-cap-no-fail-stop-row | fixed | low | Stage 5 reviewer-cap failure (shell L327) has no `<fail_stops>` row carrying the broad-reviewer-fallback resume. | commit 9e97cc0 |
| 004 | stage-1-stops-no-fail-stop-rows | fixed | low | Stage 1 stops (closed-issue / open-blocker / abort / unsafe-branch, shell L247-248) have no `<fail_stops>` rows; resume conditions named nowhere in the skill. | commit 9e97cc0 |
| 005 | stage-2-plan-stops-stage-shell-only | closed | low | `ce-plan-no-output` / `no-implementation-units` (Stage 2 shell L261-262) absent from `<fail_stops>`. | out-of-scope: covered-by-stage-shells |
| 006 | stage-3-input-validation-stops-stage-shell-only | closed | low | `decompose-parse-error` / `cyclic-dag` / uncovered-AC / missing-contract-field (Stage 3 shell L274-276) absent from `<fail_stops>`. | out-of-scope: covered-by-stage-shells |
| 007 | stop-and-ask-checklist-reflected-in-loops | closed | low | All five checklist preconditions (cli.ts state first, route id in catalog, references loaded, ledger committed, ledger echo) are reflected in `<orchestration_loop>` steps 4/6/7/9/10. | false-positive: verified-present |
| 008 | escape-hatch-detail-correctly-in-reference | closed | low | Hatch names (`same-signature-twice`, `finding-count-rises`, `tautological-test`) and patch-batch rationale prefixes are NOT inlined in the skill; detail stays in `findings-and-validators.md`. | false-positive: ADR-0002 |
| 009 | stage-6-pr-creation-failure-no-fail-stop-row | fixed | low | Stage 6 shell L341 lists "PR creation failure requiring operator input" but `<fail_stops>` has no row; resume (operator resolves gh/push failure, PR URL recorded) lives only in `stage-6-ship.md`. Missed in first pass. | commit a29b5c5 |
| 010 | stage-5-patch-batch-confirmation-no-fail-stop-row | fixed | low | Stage 5 shell L329 lists "patch-batch confirmation is required" (runbook L359 "patch-batch flow itself stop-required") but `<fail_stops>` has no row distinct from final-review-needs-replan; resume (user confirms or declines the patch batch) lives in `stage-4-batch-loop.md`. Missed in first pass. | commit a29b5c5 |
