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
| 2026-05-25-builder-dispatch-u7 | mixed | adversarial | 3 | 6 | 2 | 0 | 1 |
| 2026-05-25-builder-dispatch-u7 | mixed | correctness | 3 | 3 | 1 | 2 | 1 |
| 2026-05-25-builder-dispatch-u7 | mixed | acceptance-criteria | 3 | 0 | 0 | 0 | 3 |
| 2026-05-25-builder-dispatch-u7 | mixed | maintainability | 3 | 17 | 4 | 1 | 1 |
| 2026-05-25-builder-dispatch-u7 | mixed | testing | 3 | 6 | 0 | 2 | 2 |
| 2026-05-25-builder-dispatch-u7 | mixed | api-contract | 2 | 2 | 0 | 1 | 1 |
| 2026-05-25-builder-dispatch-u7 | mixed | scope-guard | 1 | 1 | 0 | 0 | 0 |
| 2026-05-25-builder-dispatch-u7 | mixed | simplicity | 1 | 5 | 0 | 2 | 0 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | adversarial | 3 | 6 | 1 | 2 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | correctness | 3 | 1 | 0 | 4 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | testing | 3 | 3 | 0 | 2 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | acceptance-criteria | 3 | 0 | 0 | 0 | 3 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | data-integrity | 3 | 2 | 0 | 1 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | maintainability | 3 | 2 | 0 | 1 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | reliability | 2 | 1 | 0 | 1 | 1 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | api-contract | 1 | 1 | 0 | 2 | 0 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | security | 1 | 1 | 0 | 1 | 0 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | scope-guard | 1 | 2 | 0 | 0 | 0 |
| 2026-05-26-builder-dispatch-final-integrated | mixed | simplicity | 1 | 2 | 0 | 1 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | adversarial | 1 | 7 | 0 | 2 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | reliability | 1 | 5 | 0 | 4 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | security | 1 | 4 | 0 | 1 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | scope-guard | 1 | 4 | 0 | 0 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | maintainability | 1 | 4 | 0 | 1 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | acceptance-criteria | 1 | 3 | 0 | 1 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | api-contract | 1 | 3 | 0 | 1 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | correctness | 1 | 2 | 0 | 8 | 0 |
| 2026-05-27-ba-session-u3-u5 | mixed | testing | 1 | 1 | 0 | 4 | 0 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | adversarial | 4 | 8 | 4 | 2 | 1 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | correctness | 4 | 1 | 0 | 1 | 3 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | testing | 4 | 3 | 0 | 1 | 3 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | security | 3 | 3 | 2 | 0 | 1 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | acceptance-criteria | 2 | 0 | 0 | 0 | 2 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | maintainability | 1 | 3 | 0 | 0 | 0 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | scope-guard | 1 | 1 | 0 | 0 | 0 |
| 2026-05-27-ba-session-u6-u8 | docs/contract | api-contract | 1 | 2 | 0 | 1 | 0 |
| 2026-05-28-ba-session-final-integrated | mixed | reliability | 3 | 4 | 1 | 1 | 1 |
| 2026-05-28-ba-session-final-integrated | mixed | adversarial | 3 | 4 | 0 | 1 | 1 |
| 2026-05-28-ba-session-final-integrated | mixed | correctness | 3 | 2 | 0 | 2 | 2 |
| 2026-05-28-ba-session-final-integrated | mixed | maintainability | 1 | 6 | 0 | 1 | 0 |
| 2026-05-28-ba-session-final-integrated | mixed | scope-guard | 1 | 2 | 0 | 0 | 0 |
| 2026-05-28-ba-session-final-integrated | mixed | api-contract | 1 | 1 | 0 | 0 | 0 |
| 2026-05-28-ba-session-final-integrated | mixed | acceptance-criteria | 1 | 0 | 0 | 1 | 0 |
| 2026-05-28-ba-session-final-integrated | mixed | security | 1 | 0 | 0 | 1 | 1 |
| 2026-05-28-ba-session-final-integrated | mixed | testing | 1 | 0 | 0 | 1 | 0 |
<!-- SUPERSEDED (paused R3 snapshot) — replaced by the 6 final rows below after the run RESUMED and CONVERGED at R8. Do not aggregate these:
| 2026-05-28-ba-session-cli-authority | behavioral-code | adversarial | 3 | 4 | 2 | 1 | 0 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | reliability | 3 | 1 | 0 | 0 | 2 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | correctness | 3 | 3 | 0 | 0 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | security | 1 | 0 | 0 | 0 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | acceptance-criteria | 1 | 0 | 0 | 0 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | testing | 1 | 1 | 0 | 0 | 0 |
-->
| 2026-05-28-ba-session-cli-authority | behavioral-code | adversarial | 7 | 8 | 4 | 1 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | reliability | 7 | 5 | 4 | 0 | 3 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | correctness | 7 | 3 | 0 | 0 | 5 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | security | 1 | 0 | 0 | 0 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | acceptance-criteria | 1 | 0 | 0 | 0 | 1 |
| 2026-05-28-ba-session-cli-authority | behavioral-code | testing | 1 | 1 | 0 | 0 | 0 |

## Aggregate scorecard (regenerated each run)

**Runs recorded:** 11 &nbsp;|&nbsp; **change_types seen:** docs/contract (4), behavioral-code (3), mixed (4)

> 4 docs/contract runs, 3 behavioral-code runs, and 4 mixed runs now exist.
> Verdicts are firmer than at n=1 for every change_type but still below the
> ~5-run threshold, so treat the scorecard as advisory and keep casting the
> wide default net. Where a verdict flipped on new evidence, the change is
> noted. The third behavioral-code run
> (`2026-05-28-ba-session-cli-authority`) was scored TWICE: once at its Round-3
> PAUSE, then re-scored after it RESUMED and CONVERGED at Round 8. The Round-3
> rows are SUPERSEDED (commented out in `## Rows`); only the 6 final cumulative
> rows feed the behavioral-code aggregate.
>
> NOTE on the newest run (FINAL, RESUMED→CONVERGED): the prior PAUSED Round-3
> rows for `2026-05-28-ba-session-cli-authority` have been SUPERSEDED (commented
> out in `## Rows`) by 6 final cumulative rows for the full 8-round run. This is
> the THIRD behavioral-code run, the DEEPEST behavioral-code run on the scorecard
> (8 rounds vs the prior max of 3), and the first to chase a REGRESSION CHAIN:
> each in-loop fix exposed a subtler regression in the shared debug-session-store
> lock model — C2-01 lock fix exposed C3-01/C3-02 (paused, then user-fixed and
> verified R4), the C3 fix exposed C4-01/C4-02 (pid-reuse wedge + EPERM), the C4
> hard-TTL fix exposed C5-01 (TTL < unbounded wait), and the C5 clamp exposed
> C7-01 (clamp bounded sleeps, not wall-clock hold). reliability + adversarial
> CO-DISCOVERED all four fix-exposed regressions (C4-01, C4-02, C5-01, C7-01) —
> credited as regressions_caught:4 to EACH per the co-discovery split below.
> Convergence at R8: a full reliability+adversarial+correctness round found zero
> new findings; both timing-savvy angles independently judged the
> wait-loop-holds-a-lock mechanism soundly wall-clock-bounded below the hard TTL.
>
> NOTE on this run: `2026-05-28-ba-session-final-integrated` is the FIRST
> mixed run that BOTH applied fixes across rounds AND caught a loop-introduced
> regression in mixed (the prior fix-running mixed runs u7 and
> final-integrated caught regressions; ba-session-u3-u5 was report-only). It
> re-verifies the committed ba-session lane (U0-U9) after the post-handoff
> hardening commits. Per the strict rule, NO mixed angle qualifies as a drop
> candidate at this maturity regardless of its row — the bar additionally
> requires `new_breaks: 0` WITH nonzero `merged_into` across MULTIPLE mixed
> runs, and after this run no always-on mixed angle holds new_breaks:0 across
> the set (see below).
>
> The behavioral-code aggregate is NOT folded into the docs/contract numbers,
> and the mixed aggregate is NOT folded into either: the three change types
> break differently (behavioral-code has runtime logic to exercise;
> docs/contract does not; mixed has both), so cross-type aggregation would
> corrupt all three. At n=2 for both behavioral-code and mixed, the multi-run
> drop bar is structurally meetable; check honestly each run. Any drop-candidate
> call still requires `new_breaks: 0` AND nonzero `merged_into` across MULTIPLE
> runs of that change_type.

### docs/contract (n=4, advisory)

Aggregated across `2026-05-25-builder-dispatch-u4`,
`2026-05-25-builder-dispatch-u3`, `2026-05-25-builder-dispatch-u2`, and
`2026-05-27-ba-session-u6-u8`. `avg new_breaks` divides by the number of runs
the angle was dispatched in. `merged_into rate` = total merged_into / (total
new_breaks + total merged_into) summed across all runs the angle appeared in.

| angle | runs | avg new_breaks | regressions_caught | merged_into rate | verdict |
|-------|------|----------------|--------------------|--------------------|---------|
| adversarial | 4 | 6.25 (25/4) | 8 | 7% (2/27) | **earned keep** (first/sole raiser of every loop-introduced regression across the family: 4 in builder-dispatch + 4 in ba-session-u6-u8 (3 leak-denylist regressions in R2 + the decimal-bracket false-match in R3); 25 independent breaks, the clear MVP; the 2 merges in u6-u8 are co-raises onto its own primary signatures) |
| maintainability | 4 | 2.5 (10/4) | 0 | 33% (5/15) | **earned keep** (independent break every dispatched run: docstring-overreach u4, dup-body scope call u3, authority-boundary 4x-dup + satellite-file contradictions u2, 3 sole-raised matest-fixture findings (magic-ordinals, orphan-stage-machine, coarse-authority-vocabulary) in u6-u8 R1; merges are co-raised facets, never new_breaks:0) |
| testing | 4 | 2.25 (9/4) | 0 | 25% (3/12) | **earned keep** (independent test-pinning break every run: u2 vacuous-R5-test reframing + F8b-g cluster; u6-u8 it FIRST-raised the matest-failure-stages-uncovered P1 (3 angles merged in) plus ttl-boundary and authwall-branch gaps; the one merge (vacuous-redaction-proof into security) is corroboration, never new_breaks:0) |
| correctness | 4 | 0.75 (3/4) | 0 | 75% (9/12) | **earned keep / confirmer** (heavy co-raiser + verify-only; high merge rate (75%) and verify-only in u2 + 3 of 4 ba-session rounds, but it had independent breaks in u4, u3, and u6-u8 (the base-fields-leak P3), so new_breaks is never 0 across the family — NOT a drop candidate. In u6-u8 it protected convergence honesty across 3 verify-only rounds confirming each fix held) |
| security | 1 | 3.0 (3/1) | 2 | 0% (0/3) | **earned keep (provisional, 1 run)** (FIRST docs/contract run to dispatch security; sole/first raiser of vacuous-redaction-proof P1 in R1 (adversarial+testing merged in) plus 2 R2 regressions (nonloopback-cdp, wss-only-ws); 0 redundancy; only dispatched in u6-u8 so the verdict is provisional) |
| data-migration(s) | 2 | 0.5 (1/2) | 0 | 50% (1/2) | **earned keep** (u4 finding merged, but u3 independently raised F-route-precedence; not dispatched in u2 or u6-u8; the u4 drop call stays overturned) |
| acceptance-criteria | 4 | 0.0 (0/4) | 0 | 0% (0/0) | **confirmer** (new_breaks:0 in all 4 docs/contract runs AND merged_into:0; the only angle approaching a drop shape, but the rule requires nonzero merged_into and its merged_into is 0 — pure convergence-honesty confirmer, explicitly NOT a drop candidate. In u6-u8 it verified every U6/U7/U8 criterion MET, then re-verified the redaction criteria were non-vacuous after the fix) |
| scope-guard | 4 | 0.5 (2/4) | 0 | 33% (1/3) | **earned keep / confirmer** (u4+u3 zero, but u2 raised the F9 U6-overlap gate and u6-u8 raised the skill-step3-notification-ahead-of-code out-of-scope gate; new_breaks is 2 across the family, never 0 — not a pruning candidate) |
| api-contract | 2 | 1.0 (2/2) | 0 | 50% (2/4) | **earned keep / confirmer (watch)** (u4 was new_breaks:0 + 1 merge (the prior drop-candidate flag); u6-u8 cleared it with 2 sole-raised breaks (bounded-write-verb-unreachable P1 gate, usage-error-exit-code-2 P2) and 1 merge (teardown-vocabulary into maintainability). Cross-run new_breaks now 2, not 0, so the single-run drop flag is RETIRED — but the 50% merge rate is the highest of any multi-run docs/contract angle, so keep watching) |

**Read after 4 runs:** **no angle qualifies as a drop candidate.** The strict
rule needs `new_breaks: 0` WITH nonzero `merged_into` across multiple runs of
the same change_type. After u6-u8:

- **api-contract** — the prior standing drop candidate (n=1, u4 only) — is
  cleared. u6-u8 dispatched it a second time and it posted 2 sole-raised breaks
  including the bounded-write-verb-unreachable P1 gate. Cross-run new_breaks is
  now 2, not 0, so the drop flag is retired; it firms to earned keep but holds
  the highest multi-run docs/contract merge rate (50%), so it stays on watch.
- **acceptance-criteria** is the only angle with the confirmer shape
  (new_breaks:0 across all 4 runs) but it has merged_into:0, so it fails the
  drop rule's "nonzero merged_into" leg. It is a pure convergence-honesty
  confirmer, NOT a drop candidate. In u6-u8 it did high-value work: it counted
  R11a/R22 as MET in R1 (the fixture asserts redaction) while security/
  adversarial/testing simultaneously showed that assertion was vacuous — the
  exact gap between "criterion has a test" and "the test proves the criterion,"
  then re-verified the criteria after the fix made the proof non-vacuous.

**ba-session-u6-u8 specifics.** This run is the docs/contract family's first
regression generator: the user's R1 redaction fix (commit 51c5e3b2) introduced
an incomplete leak-pattern denylist, and the loop's own R2 fix introduced the
decimal-bracket false-match. adversarial first-raised 3 of the 4 leak
regressions plus the decimal-bracket regression (regressions_caught:4 this run
alone); security first-raised the other 2 R2 regressions (nonloopback-cdp,
wss-only-ws) → regressions_caught:2. These are the highest-signal events on the
scorecard: the loop catching regressions in code the fix-loop itself touched.

correctness and testing leaned **confirmer** in R2-R4 (verify_only_rounds 3 each)
and earned their keep there honestly — they did NOT find new breaks in those
rounds because they were confirming that the leak-pattern fixes held and that
the new negative redaction test was genuinely non-tautological. That is
convergence-honesty work, not waste; both still cleared new_breaks:0 on the run
via their R1 independent breaks, so neither drifts toward a drop call.

adversarial remains the unambiguous docs/contract MVP (avg 6.25 breaks/run, 8
regressions caught across the family). security enters with a strong provisional
1-run profile (3 sole-raised breaks, 2 regressions, 0 redundancy) and should be
re-dispatched on the next redaction-bearing docs/contract run to firm the
verdict. Do not prune below the wide net until ~5 docs/contract runs accumulate.

### behavioral-code (n=3, advisory)

Aggregated across `2026-05-25-builder-dispatch-u5`,
`2026-05-25-builder-dispatch-u6`, and `2026-05-28-ba-session-cli-authority`.
At n=3 the multi-run drop bar is comfortably meetable; verdicts remain
provisional until ~5 behavioral-code runs accumulate. `avg new_breaks` divides
by the number of runs the angle was dispatched in. `merged_into rate` = total
merged_into / (total new_breaks + total merged_into) summed across all runs the
angle appeared in.

| angle | runs | avg new_breaks | regressions_caught | merged_into rate | verdict |
|-------|------|----------------|--------------------|--------------------|---------|
| maintainability | 2 | 6.0 (12/2) | 1 | 8% (1/13) | **earned keep** (sole raiser of the only loop-introduced regression F42 in u6 R2; 11 independent breaks in u6 spanning the F26-F35 cluster and the fixture-duplication regression; not dispatched in cli-authority; merge rate 8% combined) |
| adversarial | 3 | 5.33 (16/3) | 4 | 6% (1/17) | **earned keep / MVP** (primary or co-equal raiser on every co-raised signature all three runs: u5 F1 P0 inline-fixture, u6 F16 range-commit, cli-authority sole C1-02/C2-01/C3-01/C3-02 + co-discovery of all four fix-exposed regressions C4-01/C4-02/C5-01/C7-01; 16 independent breaks; 4 regressions caught, ALL in cli-authority's regression chain; the one merge is the C1-01 co-raise into reliability. The unambiguous behavioral-code MVP) |
| reliability | 2 | 5.5 (11/2) | 4 | 0% (0/11) | **earned keep / co-MVP on regressions** (u6 F36-F41 cluster (6 sole); cli-authority primary on C1-01 P1 readFileSync-throw-bypasses-failclosed + CO-DISCOVERY of all four fix-exposed regressions C4-01/C4-02/C5-01/C7-01 (5 breaks), 0 redundant, plus 3 verify-only rounds (R2/R3/R8) confirming fixes held. 11 independent breaks, 4 regressions caught; the timing-fault co-MVP and convergence-honesty anchor of the deepest behavioral-code run) |
| testing | 3 | 4.0 (8/3) | 0 | 20% (2/10) | **earned keep** (7 sole-raised coverage gaps in u6, the P0 co-raise in u5, and the cli-authority R1 promoted-guard cluster (5 CLI auth-invariant regression guards added in-loop); never new_breaks:0; the cli-authority guards pinned forged-source, path-traversal, bogus-ref, cross-session, and directory-EISDIR invariants) |
| security | 3 | 1.67 (5/3) | 0 | 0% (0/5) | **earned keep / confirmer** (u5 F3+F6, u6 F22-F24 — all sole-raised across both, zero redundancy; cli-authority new_breaks:0 (R1 findings:[] confirming the file-trust → runtime-verify chain is CLOSED: provider grants no authority, every receipt re-verified, path-traversal blocked, secrets resolve only at paste) — a verify-only/confirmer round, NOT waste. Cross-run new_breaks 5 so NOT a drop candidate; its first zero-break behavioral-code run puts it on watch) |
| data-integrity | 2 | 2.5 (5/2) | 0 | 29% (2/7) | **earned keep** (u5: 2 sole-raised gates; u6: 3 sole-raised P3 gaps plus 2 merged; not dispatched in cli-authority; independent breaks every dispatched run) |
| acceptance-criteria | 3 | 1.33 (4/3) | 0 | 20% (1/5) | **earned keep — holds, with confirmer drift** (u5 confirmer new_breaks:0; u6 primary raiser of 4 breaks (F1/F2/F5/F6); cli-authority new_breaks:0 (confirmed GATE-1 substantially CLOSED + GATE-3 verb reconciliation RESOLVED via residual-risk verification) — a verify-only round. 2 of 3 runs now zero-break; clears the drop rule on cross-run new_breaks:4 but drifts toward confirmer — watch) |
| correctness | 3 | 1.67 (5/3) | 0 | 44% (4/9) | **earned keep / confirmer** (u5 new_breaks:0 with a correctly-dropped false positive; u6 2 sole P3 + 3 merges; cli-authority 3 sole (C1-03 wait-busy-poll P2, C1-04 value-parser P3, C2-02 duplicate-helper P1) + FIVE verify-only rounds (R3/R4/R5/R7/R8) confirming each fix in the regression chain was correct in isolation. Cross-run new_breaks 5, never 0 — NOT a drop candidate; the merge rate reflects corroboration. The disciplined confirmer that let the loop trust each fix before chasing the next regression) |
| scope-guard | 1 | 1.0 (1/1) | 0 | 0% (0/1) | **earned keep (provisional, 1 run)** (u6-only dispatch raised F25 plan-metadata gap for cli.ts; not dispatched in u5 or cli-authority; one independent break, no merges) |

**Read after 3 behavioral-code runs:** the wide net keeps paying off, and
cli-authority is the family's marquee regression-chain run — the deepest on the
whole scorecard at 8 rounds. The dispatch economy held: every round after R1 ran
only 3 always-on angles (reliability + adversarial + correctness), correctness
returned findings:[] on FIVE of seven rounds to confirm each fix held in
isolation, and reliability + adversarial together caught all four fix-exposed
timing regressions in the chain. Checked honestly: **no angle qualifies as a
drop candidate.** Every always-on angle dispatched across multiple
behavioral-code runs holds nonzero cross-run `new_breaks`.

**Regression-classification note (cli-authority chain).** The metric defines
`regressions_caught` as new_breaks that were regressions introduced by the
hardening fixes themselves. cli-authority produced a CHAIN:
- C3-01/C3-02 (paused at R3) were EXPOSED by the loop's C2-01 withSessionLock fix
  (routing sensitive verbs + in-lock waits through the shared store made them
  reachable), not strictly CREATED by it — pre-existing shared-store defects. The
  prior Round-3 snapshot credited these to adversarial as regressions_caught:2.
  In this FINAL scoring I do NOT count C3-01/C3-02 toward regressions_caught:
  they were exposed-by-fix, the user (not the loop) fixed them between R3 and R4,
  and the loop's role was to verify that user fix at R4 — which then exposed the
  next layer. Counting both the exposure AND the downstream-fix-exposed C4/C5/C7
  regressions would inflate the chain. I credit the four CLEAN fix-exposed
  regressions instead (below).
- C4-01 (pid-reuse wedge), C4-02 (EPERM), C5-01 (hard-TTL < unbounded wait),
  C7-01 (clamp bounded sleeps not wall-clock hold) — each was introduced or
  exposed by the IMMEDIATELY PRIOR in-loop hardening fix (C3 fix→C4, C4 fix→C5,
  C5 fix→C7) and caught the next round. These are the textbook
  `regressions_caught` shape. reliability + adversarial CO-DISCOVERED all four
  (ledger: "same root", "both independent"). **Co-discovery split:** I credit
  regressions_caught:4 to EACH of reliability and adversarial. They are
  genuinely independent co-raises, not one merging into the other — the ledger
  never marks either as merged_into on these — so neither is penalized with a
  merge and both earn the regression credit. This is the rare case where the same
  break is a true new_break for two angles.
- C2-01 was a re-rate of a deferred-P2 latent item made live by the new CLI
  write path — a pre-existing defect, NOT a loop-introduced regression — so it
  does NOT count toward regressions_caught (it is adversarial new_breaks).
- C2-02 (duplicate-helper TS2393) WAS introduced by the in-loop R1 test-guard
  addition and caught same-loop by correctness in R2, but it is a
  build-hygiene/dead-code break, not a runtime behavioral regression; left as
  correctness new_break, regressions_caught:0.
- C6-ENV (R8) was surfaced by the orchestrator's test run, not a reviewer angle,
  and is out-of-scope — credited to NO angle.

**Verdict movement from the n=2 behavioral-code read (and from the superseded
Round-3 snapshot):**
- **adversarial** firms to **earned keep / MVP**; the final tally lifts it to 16
  independent breaks and regressions_caught:4 (was provisionally 2 at the R3
  pause). The whole regression chain ran through it.
- **reliability** vaults from `provisional (1 run)` past plain earned keep to
  **co-MVP on regressions**: the final run credits it 5 breaks AND
  regressions_caught:4 (was 0 at the R3 snapshot, because the regression chain
  C4→C5→C7 all happened R4-R7, AFTER the pause). It also anchored convergence
  honesty with 3 verify-only rounds. This is the biggest verdict movement on the
  scorecard this run.
- **correctness** stays **earned keep / confirmer**; the resumed rounds turned it
  into the disciplined fix-verifier — 5 verify-only rounds (R3-R8) confirming
  each link of the chain was sound in isolation while reliability+adversarial
  hunted the next layer. Cross-run new_breaks 5.
- **security** stays earned keep but enters **watch**: cli-authority was its
  first zero-break behavioral-code run (R1-only confirmer on the closed authority
  chain). Cross-run new_breaks 5 keeps it off the drop list.
- **acceptance-criteria** holds **earned keep** but drifts toward confirmer:
  2 of its 3 behavioral-code runs are now zero-break (closest behavioral-code
  angle to a future drop call; watch the next run).
- **testing** holds **earned keep**; the cli-authority promoted-guard cluster
  (5 in-loop auth-invariant regression guards) is independent, actionable value.

**How this run shifts the behavioral-code aggregate.** Before cli-authority,
behavioral-code had recorded ZERO fix-exposed runtime regression catches across
u5 and u6 (u6's lone regression F42 was a fixture-duplication, maintainability).
cli-authority is the family's first true regression-CHAIN run and contributes all
8 of the family's regression catches that are runtime behavioral
(adversarial 4 + reliability 4 on the same four signatures via co-discovery). It
also doubles the family's max depth (8 rounds vs 3) and supplies the family's
first PAUSE-then-RESUME-to-CONVERGENCE arc. The headline: the two always-on
timing-savvy angles (reliability, adversarial) are the behavioral-code
regression engine, and correctness is the convergence-honesty confirmer that
makes chasing a chain safe. Keep the wide default net for the next
behavioral-code run; revisit verdicts once ~5 behavioral-code runs accumulate.

### mixed (n=4, advisory)

Aggregated across `2026-05-25-builder-dispatch-u7`,
`2026-05-26-builder-dispatch-final-integrated`, `2026-05-27-ba-session-u3-u5`,
and `2026-05-28-ba-session-final-integrated`. All four spanned docs/contract
surfaces AND behavioral code (u7: SKILL telegraph + matrix rows + lifecycle
drift check; final-integrated: whole-feature pass over U1-U7
prose/ADRs/refs/templates PLUS behavioral helpers in `lib/ledger.ts`,
`decompose.ts`, `contract.ts`, `route.ts`, `cli.ts`, `contract-drift.ts`;
ba-session-u3-u5: session runtime adapter + identity probe +
write-arming/secret/operator-copy behavioral code PLUS contract/command-map
surfaces; ba-session-final-integrated: re-verification of the committed
ba-session lane U0-U9 — runtime adapter + policy + skill prose + package map),
so all four fold into this bucket. At n=4 the multi-run drop bar is met for the
always-on angles; verdicts remain advisory below the ~5-run threshold.
`avg new_breaks` divides by the number of runs the angle was dispatched in.
`merged_into rate` = total merged_into / (total new_breaks + total merged_into)
summed across all runs the angle appeared in.

ba-session-u3-u5 was a report-only run (Round 1 only, no fixes applied), so no
angle could catch a fix-induced regression that run; `regressions_caught` is 0
for every angle there by construction. ba-session-final-integrated DID apply
fixes across 3 rounds and caught exactly one loop-introduced regression (R2-01,
the external-attach cleanup misreporting "complete"), credited to reliability
as first-listed primary on the shared `reliability+adversarial` signature.

| angle | runs | avg new_breaks | regressions_caught | merged_into rate | verdict |
|-------|------|----------------|--------------------|--------------------|---------|
| maintainability | 4 | 7.25 (29/4) | 4 | 12% (4/33) | **earned keep** (u7 caught all 4 loop-introduced regressions; final-integrated +2; ba-session-u3-u5 +4; ba-session-final-integrated owned the 6-item P2/P3 dead-code/duplication cluster sole (R1-11/12/13/17/18/19), one merge (R1-16 to correctness); never new_breaks:0; the cross-run regression magnet) |
| adversarial | 4 | 5.75 (23/4) | 3 | 18% (5/28) | **earned keep** (first/sole raiser of a loop-induced regression in 2 of 3 fix-running mixed runs (u7 F37+F40, final-integrated F5); ba-session-final-integrated: first-raiser of the merged CLI-wiring gate R1-04 + sole R1-09 warm-reuse-stomp + primary on co-raised R1-08/R1-10 = 4 breaks; 23 independent breaks across the quartet; the consistent MVP) |
| correctness | 4 | 2.0 (8/4) | 1 | 67% (16/24) | **earned keep / confirmer** (u7 F36 sole regression; final-integrated D12 sole; ba-session-u3-u5 2 sole P2; ba-session-final-integrated 2 sole (R1-14 ipv6-false-refusal P3, R1-16 dead-injection-option primary) + 2 merges (R1-04, R1-10) + verify-only R2 and R3 confirming the fix held. 67% combined merge rate is corroboration not redundancy; new_breaks 8 across runs, never 0. NOT a drop candidate) |
| testing | 4 | 2.5 (10/4) | 0 | 47% (9/19) | **earned keep / confirmer (watch)** (sole/first raiser of test-integrity gaps in u7+final-integrated; ba-session-u3-u5 1 sole + 4 merges; ba-session-final-integrated new_breaks:0 with 1 merge (into the R1-04 CLI-wiring gate). Two consecutive low-break/high-merge mixed runs now; combined merge rate 47%, the highest multi-run mixed rate. new_breaks stays 10 across runs so NOT a drop candidate, but it has leaned confirmer two runs running — keep on the drop-watch list) |
| acceptance-criteria | 4 | 0.75 (3/4) | 0 | 25% (2/8) | **earned keep — holds, with confirmer drift** (new_breaks:0 in u7, final-integrated, AND ba-session-final-integrated; the only nonzero-break run is ba-session-u3-u5 (3 breaks incl. a P0). This run it raised nothing sole and merged once into the R1-04 gate. Cross-run new_breaks is 3 so it clears the drop rule, but 3 of its 4 mixed runs are now zero-break — the closest mixed angle to a future drop call; watch) |
| scope-guard | 4 | 2.25 (9/4) | 0 | 0% (0/9) | **earned keep** (sole raiser of out-of-plan/contract gates every run (u7 F8; final-integrated D8+D9; ba-session-u3-u5 4; ba-session-final-integrated 2: R1-05 U9-prototype-retirement P0 gate + R1-06 issue-to-pr-scope-bleed P1 gate); zero merges all four runs — every break independent. The only sustained zero-merge mixed angle) |
| simplicity | 2 | 3.5 (7/2) | 0 | 30% (3/10) | **earned keep (2 runs)** (R1-only dispatch in u7+final-integrated by design; 7 sole-raised deferred items across the pair; not dispatched in either ba-session run; new_breaks well above 0) |
| reliability | 3 | 4.67 (14/3) | 1 | 30% (6/20) | **earned keep** (final-integrated 1 sole; ba-session-u3-u5 5 sole; ba-session-final-integrated 4 breaks (R1-01+R1-02 the two in-scope fixed P1s sole, R1-15 sole P3, R2-01 the loop's only regression as primary) + 1 merge + 1 verify-only R3. First regression-catch for reliability in mixed; independent breaks all 3 dispatched runs; not dispatched in u7) |
| api-contract | 4 | 1.75 (7/4) | 0 | 36% (4/11) | **earned keep (watch)** (u7 F16+F25 sole; final-integrated D5; ba-session-u3-u5 3 sole; ba-session-final-integrated 1 sole (R1-07 bounded-write-undeclared-verb P1 gate; its other R1 raise R1-03 was adjudicated NOT-a-defect and does not count) with 0 merges this run. Combined new_breaks 7, merge rate eased to 36%; firms but stays on watch) |
| security | 3 | 1.67 (5/3) | 0 | 38% (3/8) | **earned keep / confirmer (watch)** (final-integrated D2 sole; ba-session-u3-u5 4 sole incl. the sharpest P0; ba-session-final-integrated new_breaks:0 (Round-1 findings:[] confirming the authority floor holds; merged into R1-04) — a verify-only/confirmer run. Cross-run new_breaks 5 so NOT a drop candidate, but its first zero-break mixed run pushes it onto the watch list) |
| data-integrity | 1 | 2.0 (2/1) | 0 | 33% (1/3) | **earned keep (provisional, 1 run)** (final-integrated only; first raiser of F2 vacuous-proof P0 and F4 P1; F7 merged into adversarial. Not dispatched in either ba-session run) |

**Read after 4 mixed runs:** the multi-run drop bar is met for every always-on
angle. Checked honestly: **no angle qualifies as a drop candidate.** The rule
needs `new_breaks: 0` WITH nonzero `merged_into` across MULTIPLE runs of the
same change_type. After this run, three angles posted a zero-break run for the
first time or repeatedly — testing, acceptance-criteria, and security — but
each still carries nonzero cross-run new_breaks, so none crosses the bar.

**Attribution note (shared signatures this run).** Four ba-session-final-integrated
findings had shared signatures; I credited the first-listed angle as primary
(new_break) and the rest as merged_into, matching the ledger's "Both angles
independent / co-raise" notes and the run brief's explicit instruction:
- R1-04 (cli-authority-not-wired) listed `adversarial+acceptance-criteria+correctness+security+testing` → adversarial new_break; the other four merged_into.
- R1-08 listed `adversarial+reliability` → adversarial new_break, reliability merged_into.
- R1-10 listed `adversarial+correctness` → adversarial new_break, correctness merged_into.
- R1-16 listed `correctness+maintainability` → correctness new_break, maintainability merged_into.
- R2-01 (regression) listed `reliability+adversarial` → reliability new_break + regressions_caught:1, adversarial merged_into (per the brief: credit reliability when listed primary).
- R1-03 (unknown-future-fields) was adjudicated NOT-a-defect, so it counts for NO angle's new_breaks (api-contract's only counted break this run is R1-07).

**Verdict movement from the n=3 mixed read:**
- **maintainability** holds **earned keep**; avg eased to 7.25 as the 6-item
  dead-code cluster was sole-raised but lower-volume than ba-session-u3-u5.
  Still the cross-run regression magnet (4, all from u7).
- **adversarial** holds **earned keep / MVP**; 23 independent breaks across 4
  runs, first-raiser on the big CLI-wiring gate this run.
- **reliability** strengthens: this run gave it its first mixed regression-catch
  (R2-01) plus the two in-scope fixed P1s (R1-01, R1-02) — the only in-scope
  P0/P1 fixed by the whole loop, both sole-raised by reliability.
- **testing** stays **earned keep / confirmer (watch)** but the watch hardens:
  two consecutive zero-or-low-break mixed runs (1 then 0 new_breaks) with merges
  both times. A third low-break/high-merge mixed run would move it to the
  active drop-watch bucket.
- **acceptance-criteria** stays **earned keep** but drifts toward confirmer:
  3 of its 4 mixed runs are now zero-break. It is the closest mixed angle to a
  future drop call; watch the next mixed run.
- **security** stays **earned keep** but enters watch: ba-session-final-integrated
  was its first zero-break mixed run (Round-1 findings:[] confirming the
  authority floor). Pure convergence-honesty confirmer this run, not waste.
- **api-contract** firms but stays on watch (36% merge rate, only R1-07 counted
  this run; R1-03 adjudicated out).
- **scope-guard** holds **earned keep** with a 0% merge rate sustained across
  all 4 mixed runs — every gate independent, including this run's two ship-block
  gates (U9 retirement, issue-to-pr scope bleed).
- **data-integrity** stays provisional (1 run, final-integrated only).

Cross-type observation: this is the first mixed run where the loop's OWN fix
introduced a regression that the loop then caught (R2-01) — the highest-signal
event type, and reliability's first mixed regression-catch. The run also
demonstrates the wide net's economy at convergence: Rounds 2 and 3 ran only the
3 always-on angles (adversarial, correctness, reliability), and correctness +
adversarial + (R3) reliability returned findings:[] to confirm the regression
fix introduced nothing new. Keep the wide default net for the next mixed run;
revisit verdicts once ~5 mixed runs accumulate. Three angles are now on watch
(testing, acceptance-criteria, security) — none is a drop candidate yet, but
all three need a nonzero-break mixed run to stay off the list.
