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

## Aggregate scorecard (regenerated each run)

**Runs recorded:** 1 &nbsp;|&nbsp; **change_types seen:** docs/contract (1)

> Only 1 run exists. Verdicts below are provisional; the scorecard is advisory
> until ~5 runs of a given change_type accumulate. Keep casting the wide default
> net until then.

### docs/contract (n=1, provisional)

| angle | avg new_breaks | regressions_caught | merged_into rate | verdict (provisional) |
|-------|----------------|--------------------|--------------------|-----------------------|
| adversarial | 4.0 | 2 | 0% | **earned keep** (only angle that caught its own loop's regressions) |
| maintainability | 2.0 | 0 | 0% | **earned keep** (caught the docstring-overreach root cause) |
| correctness | 1.0 | 0 | 0% | **earned keep / confirmer** (1 break + 4 verify-only rounds; convergence backstop) |
| testing | 1.0 | 0 | 0% | **earned its R1 seat**, retired correctly after going note-only |
| acceptance-criteria | 0.0 | 0 | 0% | **fold into correctness** (verified only; correctness produced the AC table anyway) |
| scope-guard | 0.0 | 0 | 0% | **keep as late-round** (cheap, confirmed version-bump fallout was legit) |
| api-contract | 0.0 | 0 | 100% | **drop candidate** for docs/contract (its finding merged into data-migration + adversarial) |
| data-migration | 0.0 | 0 | 100% | **drop candidate** for docs/contract (same root as api-contract + adversarial) |

**Provisional read:** for a `docs/contract` slice, api-contract and
data-migration both surfaced the *same* version-skew/legacy-ledger finding that
adversarial also found — three dispatches, one finding. Candidate optimization
once more docs/contract runs confirm it: Round 1 = adversarial + correctness(+AC) +
maintainability + one migration-aware angle, instead of seven. Do not act on n=1.
