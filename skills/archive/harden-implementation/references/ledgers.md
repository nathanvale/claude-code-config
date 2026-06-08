# Ledgers

The hardening loop writes two durable ledgers so knowledge compounds across
runs and a crashed/interrupted run can resume instead of re-deriving findings.
Both live beside the skill under `ledgers/`.

```
skills/harden-implementation/ledgers/
├── reviewer-scorecard.md   committed   cross-run, append-only reviewer data
└── runs/                   gitignored  per-run findings ledgers (resumable)
    └── <run-id>.md
```

`runs/` is gitignored: per-run ledgers are transient resumability state and may
reference other repositories' internals. `reviewer-scorecard.md` and this
contract are committed: they are the compounding knowledge.

## run-id

A stable slug derived from the plan and the subject so a re-run or resumed
hardening of the same work finds its prior ledger. Shape:
`<plan-date>-<plan-slug>-<slice-or-scope>`, e.g.
`2026-05-25-builder-dispatch-u4`. Keep it deterministic: the same plan + slice
must produce the same run-id every time.

## Ledger 1 — per-run findings ledger (`runs/<run-id>.md`)

The resilience layer. Write it **incrementally after each round**, not only at
the end, so a crash mid-loop leaves completed rounds on disk. On a fresh
invocation, check for an existing ledger with this run-id **before dispatching
Round 1**: if found with `status: in-progress`, resume from `last_round + 1`
with the resolved findings already on disk (do not re-derive them).

```markdown
---
run_id: 2026-05-25-builder-dispatch-u4
plan: claude-code-config/docs/plans/2026-05-21-001-...md
subject_repo: claude-code-config
scope: U4
status: in-progress        # in-progress | converged | capped | paused
rounds_run: 3
last_round: 3
change_type: docs/contract # see change_type vocabulary below
acceptance_criteria: [R4, R6, R8]
---

## Findings
| id | signature | round | angle(s) | severity | status | summary | fix | reverified |
|----|-----------|-------|----------|----------|--------|---------|-----|------------|

## Deferred audit backlog (P2/P3)
<carried forward across rounds/runs; status deferred-P2 / deferred-P3>

## Resume hint
Next round re-runs: <angles>. Resolved finding ids to suppress: <ids>.
```

`severity` is `P0 | P1 | P2 | P3` (shared with the issue-to-pr Validator
finding scale). It governs fix-vs-defer: the loop fixes P0/P1 in-round and
defers P2/P3 to the audit backlog. It does NOT govern convergence — the loop
runs until a round finds nothing new at any level. `grep '| P0 \|| P1 '` is the
fix list; `grep deferred` is the audit backlog.

`status` is `fixed | deferred-P2 | deferred-P3 | out-of-scope | open`, optionally
suffixed `(regression)` when the finding was introduced by a hardening fix in a
prior round (high-signal: the loop caught its own mistake). `signature` is the
stable kebab-case root-cause slug from the reviewer envelope
([reviewer-envelope.md](reviewer-envelope.md)); the same root issue raised by
multiple angles shares one signature, recorded once.

## Ledger 2 — cross-run reviewer scorecard (`reviewer-scorecard.md`)

Append-only machine-readable rows (one per angle per run) plus a human
aggregate regenerated after each run. This is the data that answers "which
angles earn their keep, by change type" with evidence rather than hunch.

### change_type vocabulary

Keep this small and stable so rows aggregate. Pick the dominant material of the
change:

- `docs/contract` — prose, constants, schema/version definitions, no behavioral code.
- `behavioral-code` — logic with runtime behavior to break.
- `data-migration` — migrations, backfills, persisted-state transforms.
- `api-surface` — request/response types, serialization, versioned contracts.
- `ui` — frontend/interaction code.
- `mixed` — genuinely spans several; note the components in the run ledger.

### Metric definitions (must be comparable across runs)

- `rounds_survived` — how many rounds this angle was dispatched before being dropped.
- `new_breaks` — findings this angle raised first/independently that survived
  triage as actionable (in-scope **or** out-of-scope). The core value signal.
- `regressions_caught` — `new_breaks` that were regressions introduced by the
  hardening fixes themselves. Highest signal; weight heavily.
- `merged_into_count` — times this angle's finding duplicated another angle's
  same-root finding (matched by the shared `signature` in the reviewer
  envelope; see [reviewer-envelope.md](reviewer-envelope.md)). High value here =
  redundancy = drop candidate.
- `verify_only_rounds` — rounds the angle ran and confirmed-without-new-findings.
  Value, **not** waste: confirmers protect convergence honesty. Counted
  separately so they are never punished as "found nothing."

## The scoring agent

At the end of every run (converged, capped, or paused), dispatch **one**
`general-purpose` agent as an arms-length grader. It did not make the dispatch
decisions, so it grades without self-justification bias. Charter:

1. Read the completed `runs/<run-id>.md` findings ledger and the round-by-round
   dispatch history from the run.
2. For each angle dispatched in the run, compute the metrics above from the
   ledger (not from impressions).
3. Append one row per angle to the `## Rows` table in `reviewer-scorecard.md`.
4. Regenerate the `## Aggregate scorecard` section from all rows: per angle and
   per change_type, report avg `new_breaks`, total `regressions_caught`, the
   `merged_into` rate, and an "earned keep / drop candidate / confirmer" verdict.
   An angle is a **drop candidate** only when it shows `new_breaks: 0` with a
   nonzero `merged_into` across multiple runs of the same change_type. A
   confirmer (low new_breaks, high verify_only) is **not** a drop candidate.
5. Return the appended rows and the refreshed verdicts.

Do not let the scoring agent edit the implementation or the findings ledger; it
only reads them and writes the scorecard.

## Reading the scorecard before a run

When picking the Round 1 angle set, consult the aggregate scorecard for the
matching `change_type`. If an angle is a standing drop candidate for that type,
omit it or fold it into an overlapping angle. This is how the data feeds back
into angle selection. Until ~5 runs of a given change_type exist, treat the
scorecard as advisory and keep casting the wide default net.
