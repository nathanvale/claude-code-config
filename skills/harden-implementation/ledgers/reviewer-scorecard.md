# Reviewer Scorecard

Cross-run reviewer-performance data for the hardening loop. Append one row per
angle per run; regenerate the aggregate after each run. See
[../references/ledgers.md](../references/ledgers.md) for metric definitions and
the scoring-agent contract.

The metrics separate "found new breaks" from "verified it still holds" so
always-on confirmers are not punished as low-value. A **drop candidate** is an
angle showing `new_breaks: 0` with nonzero `merged_into` across multiple runs of
the same `change_type` — not merely an angle that confirmed without new findings.

## Rows (machine-readable, append-only)

| run_id | change_type | angle | rounds_survived | new_breaks | regressions_caught | merged_into_count | verify_only_rounds |
|--------|-------------|-------|-----------------|------------|--------------------|--------------------|--------------------|
| 2026-05-25-builder-dispatch-u4 | docs/contract | adversarial | 5 | 4 | 2 | 0 | 1 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | correctness | 5 | 1 | 0 | 0 | 4 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | maintainability | 5 | 2 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | acceptance-criteria | 1 | 0 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | testing | 2 | 1 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | api-contract | 1 | 0 | 0 | 1 | 0 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | data-migration | 1 | 0 | 0 | 1 | 0 |
| 2026-05-25-builder-dispatch-u4 | docs/contract | scope-guard | 1 | 0 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | adversarial | 3 | 9 | 2 | 0 | 0 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | correctness | 3 | 1 | 0 | 4 | 1 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | maintainability | 3 | 1 | 0 | 2 | 1 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | testing | 3 | 3 | 0 | 2 | 1 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | acceptance-criteria | 1 | 0 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | data-migrations | 1 | 1 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u3 | docs/contract | scope-guard | 1 | 0 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | adversarial | 2 | 4 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | correctness | 2 | 0 | 0 | 4 | 1 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | maintainability | 2 | 4 | 0 | 3 | 0 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | testing | 2 | 2 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | acceptance-criteria | 2 | 0 | 0 | 0 | 2 |
| 2026-05-25-builder-dispatch-u2 | docs/contract | scope-guard | 1 | 1 | 0 | 1 | 0 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | adversarial | 2 | 3 | 0 | 0 | 1 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | correctness | 2 | 0 | 0 | 1 | 2 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | acceptance-criteria | 2 | 0 | 0 | 1 | 2 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | testing | 2 | 1 | 0 | 1 | 1 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | maintainability | 2 | 1 | 0 | 1 | 1 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | security | 1 | 2 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u5 | behavioral-code | data-integrity | 1 | 2 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | adversarial | 3 | 5 | 0 | 0 | 2 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | correctness | 3 | 2 | 0 | 3 | 2 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | acceptance-criteria | 3 | 4 | 0 | 0 | 2 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | testing | 3 | 7 | 0 | 2 | 2 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | maintainability | 3 | 11 | 1 | 0 | 1 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | security | 1 | 3 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | data-integrity | 1 | 3 | 0 | 2 | 0 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | reliability | 1 | 6 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u6 | behavioral-code | scope-guard | 1 | 1 | 0 | 0 | 0 |

## Aggregate scorecard (regenerated each run)

**Runs recorded:** 5 &nbsp;|&nbsp; **change_types seen:** docs/contract (3), behavioral-code (2)

> 3 docs/contract runs and 2 behavioral-code runs now exist. Verdicts are
> firmer than at n=1 but still below the ~5-run threshold, so treat the
> scorecard as advisory and keep casting the wide default net. Where a verdict
> flipped on new evidence, the change is noted.
>
> The behavioral-code aggregate is NOT folded into the docs/contract numbers:
> the two change types break differently (behavioral-code has runtime logic to
> exercise; docs/contract does not), so cross-type aggregation would corrupt
> both. At n=2 for behavioral-code, the multi-run drop bar is structurally
> meetable for the first time. Any drop-candidate call still requires
> `new_breaks: 0` AND nonzero `merged_into` across BOTH runs of that change_type.

### docs/contract (n=3, advisory)

Aggregated across `2026-05-25-builder-dispatch-u4`,
`2026-05-25-builder-dispatch-u3`, and `2026-05-25-builder-dispatch-u2`.
`avg new_breaks` divides by the number of runs the angle was dispatched in.
`merged_into rate` = total merged_into / (total new_breaks + total merged_into)
summed across all runs the angle appeared in.

| angle | runs | avg new_breaks | regressions_caught | merged_into rate | verdict |
|-------|------|----------------|--------------------|--------------------|---------|
| adversarial | 3 | 5.67 (17/3) | 4 | 0% (0/17) | **earned keep** (sole/first raiser of every loop-introduced regression: 4 across 3 runs; first raiser of 17 breaks, 0 redundant; the clear MVP) |
| maintainability | 3 | 2.33 (7/3) | 0 | 42% (5/12) | **earned keep** (independent break every run: docstring-overreach u4, dup-body scope call u3, authority-boundary 4x-dup + satellite-file contradictions u2; merges are co-raised facets, never new_breaks:0) |
| testing | 3 | 2.0 (6/3) | 0 | 25% (2/8) | **earned keep** (independent test-pinning breaks all 3 runs; u2 it led the vacuous-R5-test reframing and owned the F8b-g gap cluster) |
| correctness | 3 | 0.67 (2/3) | 0 | 80% (8/10) | **earned keep / confirmer** (heavy co-raiser + verify-only; high merge rate and a new_breaks:0 run in u2, but merged_into is nonzero only because it corroborates, and it had independent breaks in u4+u3, so NOT a drop candidate) |
| data-migration(s) | 2 | 0.5 (1/2) | 0 | 50% (1/2) | **earned keep** (u4 finding merged, but u3 independently raised F-route-precedence; not dispatched in u2; the u4 drop call stays overturned) |
| acceptance-criteria | 3 | 0.0 (0/3) | 0 | 0% (0/0) | **confirmer** (new_breaks:0 all 3 runs AND merged_into:0; pure convergence-honesty confirmer, NOT a drop candidate) |
| scope-guard | 3 | 0.33 (1/3) | 0 | 50% (1/2) | **earned keep / confirmer** (u4+u3 zero/zero, but u2 it independently raised the F9 U6-overlap gate and co-raised F8a; new_breaks is no longer 0 across runs, so the confirmer-only read from n=2 is upgraded) |
| api-contract | 1 | 0.0 (0/1) | 0 | 100% (1/1) | **drop candidate (1 run only)** (new_breaks:0 + merged_into:1 in u4; not dispatched in u3 or u2, so the multi-run drop bar is still unmet) |

**Read after 3 runs:** the only standing **drop candidate** remains
api-contract, still on a single run of evidence (u4 only), so the
"multiple runs of the same change_type" bar for a drop is not met. No angle
qualifies as a drop candidate under the strict rule (new_breaks:0 WITH nonzero
merged_into across multiple runs of the same change_type).

Two verdicts moved on u2 evidence:

- **scope-guard** is upgraded from pure confirmer toward earned keep. In u2 it
  was the sole/primary raiser of the F9 U6-overlap ownership gate (a recorded
  note-only/gate that survived triage as actionable) and co-raised F8a. Its
  cross-run new_breaks is now 1, not 0, so it is no longer a candidate for
  pruning even on a confirmer argument.
- **acceptance-criteria** holds firm as a confirmer: new_breaks:0 across all 3
  runs with merged_into:0. It adds convergence honesty (verified every criterion
  MET with evidence each round) without redundancy, so it is explicitly NOT a
  drop candidate.

adversarial stays the unambiguous MVP: first/independent raiser of all 4
loop-introduced regressions and the lead raiser on the highest-severity findings
in every run (in u2: F1 blocking, plus first-raiser on F2/F3 should-fix and F10
note-only). maintainability and testing both keep earning their slots with an
independent break every run. correctness is a high-value corroborator: its 80%
merge rate looks redundant in isolation, but it had independent breaks in u4 and
u3 and its u2 verify-only round confirmed every fix held, so it protects against
false convergence rather than padding the net. Do not prune below the wide net
until ~5 runs of docs/contract accumulate.

### behavioral-code (n=2, advisory)

Aggregated across `2026-05-25-builder-dispatch-u5` and
`2026-05-25-builder-dispatch-u6`. At n=2 the multi-run drop bar is meetable for
the first time; verdicts remain provisional until ~5 behavioral-code runs
accumulate. `avg new_breaks` divides by the number of runs the angle was
dispatched in. `merged_into rate` = total merged_into / (total new_breaks +
total merged_into) summed across all runs the angle appeared in.

| angle | runs | avg new_breaks | regressions_caught | merged_into rate | verdict |
|-------|------|----------------|--------------------|--------------------|---------|
| maintainability | 2 | 6.0 (12/2) | 1 | 8% (1/13) | **earned keep** (sole raiser of the only loop-introduced regression F42 in u6 R2; 11 independent breaks in u6 spanning the F26-F35 cluster and the fixture-duplication regression; merge rate dropped from 50% (u5) to 8% (combined) as solo cluster ownership emerged) |
| adversarial | 2 | 4.0 (8/2) | 0 | 0% (0/8) | **earned keep** (primary raiser on every co-raised signature both runs: u5 F1 P0 inline-fixture, u6 F16 range-commit + F12/F14/F17 backlog; 8 independent breaks, 0 redundant; consistent MVP across both runs) |
| testing | 2 | 4.0 (8/2) | 0 | 27% (3/11) | **earned keep** (7 sole-raised test-coverage gaps in u6 alone covering cross-lane, persona-membership, duplicate evidence, renderer error, YAML markdown shape; co-raised the P0 in u5 and F1/F2 in u6; never new_breaks:0) |
| reliability | 1 | 6.0 (6/1) | 0 | 0% (0/6) | **earned keep (provisional, 1 run)** (u6-only dispatch produced the F36-F41 cluster: unmemoized validateReachableCommit, spawnSync no timeout, dedup idempotency, partial-write recovery, rebase flake, misleading section-missing error; all sole-raised, none redundant; not dispatched in u5) |
| security | 2 | 2.5 (5/2) | 0 | 0% (0/5) | **earned keep** (sole raiser of all 5 security findings across both runs: u5 F3 control-byte stderr + F6 notes-sanitize, u6 F22 CLI control-byte leak + F23 wave-list gap + F24 skew-gate widening GATE; only dispatched R1 by design both runs, converged to gates; zero redundancy) |
| data-integrity | 2 | 2.5 (5/2) | 0 | 29% (2/7) | **earned keep** (u5: 2 sole-raised gates (F4 skew + F7 matched-version); u6: 3 sole-raised P3 gaps (F15 findings cross-check, F20 ISO timestamp, F21 personas duplicates) plus 2 merged (F14, F24 into adversarial/security); the merge rate stayed below 50% even as security took primary on the widened skew-gate — independent breaks every run) |
| acceptance-criteria | 2 | 2.0 (4/2) | 0 | 20% (1/5) | **earned keep — upgraded from confirmer** (u5: pure confirmer with new_breaks:0; u6: primary raiser of F1 R6 findings-recorded test, F2 R7 skew-bypass test, F5 target_commit mismatch, F6 inline-lane missing-wave; flipped from "confirmer (provisional)" to earned keep because new_breaks is no longer 0 across runs) |
| correctness | 2 | 1.0 (2/2) | 0 | 67% (4/6) | **earned keep / confirmer** (u5: new_breaks:0 with one false positive correctly dropped; u6: 2 sole-raised P3 backlog items F18/F19 plus 3 merged into adversarial F12/F16/F17; high merge rate reflects corroboration not redundancy; NOT a drop candidate because u6 independent breaks lifted new_breaks above zero) |
| scope-guard | 1 | 1.0 (1/1) | 0 | 0% (0/1) | **earned keep (provisional, 1 run)** (u6-only dispatch raised F25 plan-metadata gap for cli.ts; not dispatched in u5; one independent break, no merges) |

**Read after 2 behavioral-code runs:** the wide net is paying off. U6 stress
tested the loop with a much larger surface (1087 lines added, 9 R1 angles, 28
distinct root causes, plus the F26-F35 maintainability cluster and F36-F41
reliability cluster). Every angle that was dispatched in both runs (the 5
always-on: adversarial, correctness, acceptance-criteria, testing,
maintainability) has nonzero `new_breaks` across the combined set, so none
qualifies as a drop candidate even though the multi-run bar is now meetable for
the first time.

**Verdict flips from the u5-only read:**
- **acceptance-criteria** flips from `confirmer (provisional)` to **earned keep**.
  U5 it scored `new_breaks:0` (co-raised the P0, returned findings:[] in R2).
  U6 it was the primary raiser of 4 independent breaks (F1, F2, F5, F6) directly
  pinning R6 and R7 test gaps. Cross-run new_breaks is now 4, not 0, so the
  confirmer-only read is upgraded.
- **maintainability** holds **earned keep** but the verdict basis hardens: u5
  flagged 1 break with a co-raise merge; u6 it owned 11 sole-raised findings
  AND caught the only loop-introduced regression (F42, the Round-1 test
  fixture-duplication). Regressions_caught:1 weights heavily.
- **correctness** stays **earned keep / confirmer** but for stronger reasons:
  u5 it scored 0 with a correctly-dropped false positive; u6 it scored 2
  independent breaks (F18 evidence-list-header gap, F19 timestamp validation)
  plus 3 merged-into-adversarial corroborations. The 67% merge rate looks high
  but adversarial owns the primary credit on every co-raised signature, which
  is exactly the confirmer role at work.

No angle is a **drop candidate** for behavioral-code: at n=2 the bar is met but
no angle satisfies `new_breaks:0` WITH nonzero `merged_into` across BOTH runs.
adversarial, testing, and maintainability are the unambiguous MVPs (high
new_breaks, zero or near-zero merge rates, consistent independent contribution).
security and data-integrity continue to converge to single-round gates by
design (correct dispatch economy, not coverage gaps). reliability and
scope-guard are 1-run-only so their verdicts remain provisional. One regression
caught by maintainability across two runs of behavioral-code is the highest
signal in the entire scorecard: the loop caught its own mistake. Keep the wide
default net for the next behavioral-code run; revisit verdicts once ~5
behavioral-code runs accumulate.
