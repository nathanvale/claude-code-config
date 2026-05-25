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

## Aggregate scorecard (regenerated each run)

**Runs recorded:** 3 &nbsp;|&nbsp; **change_types seen:** docs/contract (3)

> 3 docs/contract runs now exist. Verdicts are firmer than at n=2 but still
> below the ~5-run threshold, so treat the scorecard as advisory and keep
> casting the wide default net. Where a verdict flipped on new evidence, the
> change is noted.

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
