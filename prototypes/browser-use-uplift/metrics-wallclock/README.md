# metrics-wallclock — cold discover vs warm replay (wall-clock)

Throwaway prototype for **browser-domain-memory**.

## Question

A second run of a known browser flow should be faster because it replays
selectors from stored memory instead of rediscovering them live. A prior
prototype proved this in **operation count** (cold = 22 discovery ops, warm = 0).
This one proves it in **wall-clock time** — the "N× faster / saves M seconds"
number a human actually feels.

It MEASURES real elapsed time (`performance.now()` around real awaited
`setTimeout` delays). The totals are observed, not summed estimates. Delays are
scaled down so the whole thing runs in ~4s while keeping the ratio meaningful.

## How to run

```bash
bun prototypes/browser-use-uplift/metrics-wallclock/wallclock.ts
```

Zero deps, pure TS. Retune the cost model via the constants at the top of
`wallclock.ts` (`DISCOVERY_MS_PER_CANDIDATE`, `ACTION_MS`, `RECALL_MS`, `FLOW`).

## Cost model

- **COLD** per step: probe `candidates × DISCOVERY_MS_PER_CANDIDATE` (enumerate +
  resolve the selector live) **plus** `ACTION_MS` (the click/type/submit).
- **WARM** per step: `RECALL_MS` (read selector from memory, ~0) **plus** the same
  `ACTION_MS`.
- The action is paid by **both** runs. Warm isn't free — it just skips discovery.

Defaults: discovery 80ms/candidate, action 50ms, recall 1ms, 8-step login +
timesheet flow averaging 5.4 candidates/step.

## Verdict

**Warm replay is 9.2× faster — saves 3.44s per run.** (real measured run below)

```
cold total : 3856ms
warm total :  417ms
saved      : 3439ms  (89% of cold was discovery)
speedup    : 9.2× faster
```

Memory replay wins decisively. The cost is discovery, and warm pays none of it —
only the unavoidable actions remain. The action floor (warm total ≈ 417ms) is the
hard limit: you can't replay your way below "actually doing the clicks."

## Findings for browser-domain-memory

- **The win is real wall-clock, not just op count.** At this scale, ~89% of a cold
  run is discovery time. Eliminating it is the entire value proposition.
- **Speedup scales with form complexity.** The ratio is driven by
  `AVG_CANDIDATES_PER_STEP`. Pages with many similar inputs (the 9-candidate
  "enter hours" step cost 721ms cold vs 52ms warm) benefit most. Simple pages
  benefit least — memory pays off where discovery is expensive.
- **Warm has a floor: the actions.** Warm total ≈ `steps × ACTION_MS`. To beat that
  you'd need faster actions (batching, fewer round-trips), which memory can't give
  you. So "N× faster" depends on how discovery-heavy the domain is, not on memory
  being magic.
- **Honest framing for the headline:** "warm run skips discovery" is accurate;
  "warm run is instant" is not. Lead with the saved-seconds figure (3.44s here) and
  the discovery share (89%) so the claim survives scrutiny.
- **Implication:** prioritize storing memory for domains with deep/ambiguous forms.
  A trivial 1-input page caches little time; a timesheet/login flow caches seconds
  every single run.
```
