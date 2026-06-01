# PROTOTYPE — runbook staleness detection (throwaway)

**Question:** Per-step self-healing recovers when ONE selector drifts mid-run.
But when should the WHOLE runbook be declared stale and force-recaptured? A site
redesign, or selectors slowly rotting across many runs, means the stored runbook
is no longer trustworthy even if healing limps it through. How do we decide that
from Run Outcome history alone?

**Answer: a tunable policy over run-outcome history separates the cases cleanly.**
No live browser needed — the verdict is computable from the JSONL-style history a
runbook already accumulates.

## Run

```
bun prototypes/browser-use-uplift/staleness/staleness.ts
```

(zero deps, pure deterministic data)

## Verdict

The policy (`scoreRunbook`) reads four signals off the history and takes the
worst verdict (stale > degrading > healthy). Run output, four contrasting
trajectories:

```
✓ healthy   furdo-booking        keep using
⚠ degrading cinema-tickets       re-verify proactively next run
✗ stale     portal-invoices      invalidate + force full recapture
✗ stale     council-rates        invalidate + force full recapture
```

- **furdo-booking → healthy** — clean recent runs; one stray heal (0.20) is
  tolerated, no verdict bump.
- **cinema-tickets → degrading** — heal-rate creeps 0.00 → 0.33 → 0.50 → 0.50;
  recent mean 0.44 crosses `HEAL_RATE_DEGRADING` (0.4). Selectors rotting but
  still passing → re-verify proactively before it fails for real.
- **portal-invoices → stale** — two fine runs, then one failed run that drifts
  100% of selectors. Single catastrophic run ≥ `REDESIGN_FAIL_FRACTION` (0.8) =
  site redesign → invalidate, recapture from scratch.
- **council-rates → stale** — limps through on heals, then two failed runs in a
  row (≥ `CONSECUTIVE_FAILURES_STALE`). Healing can't save a runbook that no
  longer reaches the goal.

Each case flips on a DIFFERENT signal, so the four thresholds are independently
exercised.

## The policy (tunable thresholds, top of file)

- `CONSECUTIVE_FAILURES_STALE = 2` — N failed runs from the newest end → stale.
- `REDESIGN_FAIL_FRACTION = 0.8` — one failed run drifting ≥ this fraction of
  steps → redesign → stale.
- `HEAL_RATE_DEGRADING = 0.4` / `HEAL_RATE_STALE = 0.65` — recent mean heal-rate
  bands. Mid = degrading (proactive re-verify), high = stale (rot).
- `RECENT_WINDOW = 3` — trailing runs that define "recent".
- `STALE_AFTER_DAYS_NO_CLEAN = 30` — days since last fully clean (zero-heal)
  success → degrading (age guard, even with no failures).

## Findings for browser-domain-memory

1. **Whole-runbook staleness is a separate decision from per-step healing, and
   it's computable from history we already have.** The Run Outcome log (date,
   result, stepsHealed, driftedSelectors) is enough — no extra instrumentation.
   The store should append a `RunOutcome` after every replay and run this policy
   on recall.
2. **Heal-rate trend is the early-warning signal.** A runbook can pass every run
   while quietly rotting (cinema-tickets). Catching `degrading` lets the agent
   re-verify proactively during a low-stakes moment instead of failing live.
3. **Two distinct stale paths need distinct handling.** Redesign (one-shot mass
   drift) and attrition (consecutive failures) both → recapture, but the redesign
   signal fires on a SINGLE run, so don't wait for a second failure when drift is
   already catastrophic.
4. **Verdict precedence matters.** Take the worst signal, not the first — a
   runbook can be both aging and rotting; the policy must not let a milder reason
   mask a stale one. Implemented as a rank-based `bump`.

## Throwaway

Fold the `RunOutcome` shape + `scoreRunbook` policy into browser-domain-memory:
record an outcome per replay, score on recall, and gate recall on the verdict —
`healthy` use as-is, `degrading` re-verify, `stale` invalidate + recapture.
