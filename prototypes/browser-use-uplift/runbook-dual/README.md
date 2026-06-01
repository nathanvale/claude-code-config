# PROTOTYPE — dual output: Recorder JSON + agent run-book (throwaway)

**Question:** What should browser-use hand back so the NEXT run is perfect — no
mistakes — whether replayed by Puppeteer OR interpreted by an agent reading a
run-book?

**Answer: hand back TWO artifacts from one rich capture.**

## Why two (the lesson that forced this)

The naive E2E capture (`../booking-furdo/flow-e2e.json`) BROKE on cold replay:
- it **missed a required step** (staff-select must happen before "Add" appears),
- used **fragile single selectors** with no fallback,
- had **no waits** for dynamic content.

Raw capture ≠ a replayable run-book. So the output must be *hardened*:

- **OUTPUT 1 — strict Chrome Recorder JSON.** Valid (passes `@puppeteer/replay
  parse()` — ✓ 8 steps), deterministic Puppeteer replay. Each click carries a
  **Selector[] fallback chain** (css + text + aria), not one brittle selector.
- **OUTPUT 2 — agent run-book.** Each step has: a human **label**, ordered
  **selectors (try-in-order)**, an explicit **wait-for**, and an **assert-after**
  (what the page must show next). An agent reads this and re-drives with
  judgment when a selector drifts — self-healing where deterministic replay
  can't recover.

Both project from one **rich internal step shape** (action + selectors[] +
waitFor + assert). The capture is the CORRECT complete flow — including the
staff step the naive version missed.

## Run

```
bun prototypes/browser-use-uplift/runbook-dual/build-runbook.ts
```

## Findings for the browser-domain-memory capture contract

1. **Capture must include order-dependent steps, or replay breaks.** "Add" only
   appears after staff-select; "Next" only after "Added". The capture has to
   record these gating steps + their wait-for conditions. A raw click-log misses
   them.

2. **Selectors need a fallback chain, not one selector.** Square's dynamic
   classes are unstable; `text/` + `aria/` + structural css give resilience.
   Recorder's `Selector[]` shape carries exactly this — use it, don't emit a
   single selector.

3. **Dual output is the right contract.** Deterministic Recorder JSON for the
   happy path; the agent run-book for recovery/interpretation. The memory skill
   can store both: replay first, fall back to agent-drives-the-run-book on drift.

4. **`wait-for` + `assert-after` per step is what makes it mistake-free.** They
   give the replay/agent a checkpoint to know the step landed before proceeding
   — the thing the naive flow lacked (it clicked Next before Add registered).

## Throwaway

Fold the rich-step shape + dual-output contract into the browser-domain-memory
capture design once decided.
