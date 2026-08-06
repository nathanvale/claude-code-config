# PROTOTYPE — run-outcome telemetry + per-flow dashboard (throwaway)

**Question:** Each time a saved flow runs, what should we record so the
accumulated history is BOTH (a) a value dashboard — "look how much time warm
replay saves vs the cold first run" — AND (b) the input the staleness/quality
gates consume (health from result + heal/drift trend)? One record shape, two
uses.

**Answer: a single `RunOutcome` record per run is enough for both.** The
dashboard derives everything from the ORDERED history — no wall clock, no extra
instrumentation. Same fields the sibling `staleness/` prototype scores.

## Run

```
bun prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts
```

(zero deps, pure deterministic fixture data; timestamps passed in as fixed
strings — no `Date.now()` / `new Date()`)

## The record shape

```ts
interface RunOutcome {
  ts: string;                    // ISO date — PASSED IN, never computed
  flowId: string;
  mode: "cold-discovery" | "warm-replay";
  result: "confirmed" | "failed" | "ambiguous"; // == success-verify outcome
  durationMs: number;
  stepsTotal: number;
  stepsHealed: number;           // drifted-and-recovered selectors this run
  minSelectorConfidence: number; // 0..1, lowest-confidence hit this run
  note: string;
}
```

`confirmed` is the clean pass; `failed`/`ambiguous` are not-a-pass for the gate.
`result` + `stepsHealed` + drift are exactly what `staleness/scoreRunbook` reads.

## Verdict

`dashboard(flowId, outcomes)` turns history into success rate, cold-vs-warm avg
duration (speedup made visible), heal-rate trend (early vs recent half + a
sparkline), a health signal, and the last verified run. Actual run output:

```
=== DASHBOARD: weekly-timesheet ===
runs: 8   success: 6/8 (75%)   health: ✓ HEALTHY
speed: cold 41.2s avg  ->  warm 7.5s avg   = 5.5x faster once learned
heal-rate: early 0.04  ->  recent 0.04   stable   trend ▁▁▂▁▁▂▁▁
last verified: 2026-05-30 (warm-replay) — "clean replay"

=== DASHBOARD: payroll-export ===
runs: 5   success: 5/5 (100%)   health: ⚠ DEGRADING
speed: cold 38.5s avg  ->  warm 7.6s avg   = 5.1x faster once learned
heal-rate: early 0.00  ->  recent 0.42   ⚠ creeping up (rot)   trend ▁▁▂▃▅
last verified: 2026-05-10 (warm-replay) — "three drifted, limping but passed"
```

- **weekly-timesheet → HEALTHY** — cold first run 41.2s, warm replays ~6s =
  **5.5x faster once learned**. One failure (portal 503) and one ambiguous
  (spinner stuck) drag success to 75%, but the recent tail is clean, so health
  stays healthy. This is the value story made observable.
- **payroll-export → DEGRADING** — 100% success, every run still passes, but the
  heal-rate sparkline climbs `▁▁▂▃▅` (early 0.00 → recent 0.42) and
  `minSelectorConfidence` slides 0.96 → 0.55. The dashboard flags it as rotting
  BEFORE it ever fails — the early-warning the gate exists for.

## Findings for browser-domain-memory

1. **One record, two uses — proven.** The same `RunOutcome` log produces the
   value dashboard (5.5x speedup, success rate) and the gate input (heal/drift
   trend, last verified). No second telemetry pipeline needed; append one record
   per replay and both readouts fall out.
2. **Speedup is only legible across the cold/warm split.** Storing `mode` on
   each run is what makes "look how much time this saves" computable — cold avg
   vs warm avg. Without the mode tag you can show duration but not the payoff.
3. **A 100%-success flow can still be unhealthy.** payroll-export never fails yet
   is degrading. Success rate alone hides rot; the heal-rate trend + minimum
   selector confidence are the leading indicators. Health must read the trend,
   not just pass/fail.
4. **Trend from ORDER, not wall clock.** Every number here comes from the ordered
   history and fixed `ts` strings — no clock call. The store can replay/recompute
   a dashboard deterministically from the persisted log alone.
5. **Shape is staleness-compatible.** `result` (three-way, with `confirmed` as
   the pass) + `stepsHealed` + drift map straight onto what `staleness/` scores,
   so recall can render the dashboard AND run the staleness gate off one read.

## Throwaway

Fold the `RunOutcome` shape into browser-domain-memory: append one record per
replay, render `dashboard()` on demand for the value view, and feed the same
records to the staleness gate on recall.
