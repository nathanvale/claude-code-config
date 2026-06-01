# Runbook lifecycle (heal + provenance + staleness + recapture)

Throwaway prototype. Chains the sibling pieces into one end-to-end story.

## Question

The siblings each proved a PIECE in isolation — self-heal one drifted selector
(`self-healing/`), score whole-runbook staleness from Run Outcome history
(`staleness/`), decay confidence on heal (`provenance/`), verify-on-capture
(`capture-verify/`). What does the FULL arc look like when you replay a single
runbook week after week and the page underneath mutates: healthy → degrading →
stale → rebuilt?

## How to run

```bash
bun prototypes/browser-use-uplift/lifecycle/lifecycle.ts
```

Zero deps, no live browser. The page is an in-memory selector→resolution map
(`ok` / `drifted` / `dead`) that the simulation MUTATES between runs. The
mutation-over-time is the narrative engine. No `Date.now()` — runs are indexed,
dates are fixtures.

## Verdict

The arc fires at the right line, every transition driven by a real signal:

```
runs 1-20  ✓ HEALTHY     clean replays, 0 heals, result=confirmed
run 21     ⚠ DEGRADING   1 selector drifts; ladder re-finds it by role; run still
                         confirmed; healed selector's provenance decays by-id→by-heal
                         (minConfidence 0.30); staleness sees heal-rate tick 0→0.20
                         → re-verify proactively
run 22     ✗ STALE       site redesign kills 5/5 selectors; ladder exhausted; run
                         FAILS; staleness sees 100% drift in a failed run → invalidate
                         → ↻ cold recapture rebuilds 5 steps with fresh provenance
run 23     ✓ HEALTHY     replay the rebuilt runbook → confirmed, 0 heals; arc closed
```

Each layer did its job: heal kept run 21 alive, provenance decayed trust on the
healed selector, staleness caught the rot (degrading) then the redesign (stale),
recapture rebuilt the runbook with fresh high-confidence selectors.

## Findings for browser-domain-memory

- The four concepts compose cleanly into one lifecycle with no extra glue — each
  reads the same Run Outcome shape (`result`, `stepsHealed`, `minConfidence`,
  `driftedSelectors`). That shape is the integration contract; keep it stable.
- Healing and staleness are complementary, not redundant. Healing is per-step,
  in-run, optimistic (keep the flow alive). Staleness is whole-runbook,
  cross-run, skeptical (is this still trustworthy?). A run can SUCCEED (healed)
  yet still flip the runbook to DEGRADING — that "succeeded but degrading" state
  is the early-warning the system needs.
- An in-run heal must decay provenance/confidence immediately (by-heal = 0.30),
  not next run. The decayed `minConfidence` is what makes "re-verify proactively"
  actionable on the very next replay.
- Two distinct stale triggers fire on the same failed run and that's fine — the
  redesign signal (≥80% drift in a failure) is the one that fired here; the
  consecutive-failures signal is the backstop for slow death. Both → invalidate.
- Recapture must reset history scope: after invalidation the rebuilt runbook is a
  NEW artifact, so staleness scores it against a FRESH outcome history. Carrying
  the dead book's failures forward would keep the rebuilt book pinned stale.
- Degrading needs a tick-up signal, not just a high mean. After 20 clean runs a
  single heal barely moves a 3-run mean (0.20 over 3 ≈ 0.07), so the policy
  watches the LATEST run's heal-rate against a clean baseline to catch rot early.
