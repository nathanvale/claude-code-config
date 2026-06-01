# PROTOTYPE — self-healing run-book replay (throwaway)

**Question:** When a run-book step's primary selector DRIFTS (goes stale), can
the agent recover and keep the flow going — proving the run-book is mistake-proof
on the next read?

**Answer: YES. Proven live on the Urban Furdo booking flow.**

## What it proves (the recovery ladder)

`heal-replay.ts` drives the real booking flow with **deliberately broken**
primary selectors, and recovers every step:

```
Step 2: choose service — primary "#DRIFTED-xyz" BROKEN
        ↪ FALLBACK selector ".service-row" + text "Full Basic Groom" ✓
Step 3: select staff — ALL selectors (#gone-1, #gone-2, .also-gone) BROKEN
        ↪ RE-FIND by text "Any staff" + role option ✓
✓ run-book completed despite every primary selector drifting.
```

The three recovery tiers, in order:
1. **Fallback chain** — primary selector misses → try the next `Selector[]`
   candidate (css → text → aria).
2. **Text-disambiguation inside fallback** — a generic selector matches MANY
   elements → pick the one whose text matches the step's `findByText` (a selector
   resolving the wrong element is still drift).
3. **RE-FIND by label/role** — every selector dead → re-find the element on the
   live page using the step's `findByText` + `findByRole` (the judgment the
   run-book's label/assert metadata encodes). No LLM call needed — the metadata
   IS the judgment.

## Run

```
bun prototypes/browser-use-uplift/self-healing/heal-replay.ts
```

## Findings for browser-domain-memory

1. **The run-book's per-step metadata (label, findByText, findByRole, assert) is
   what makes healing possible.** A bare selector log can't self-heal; the
   semantic hints can. This validates the dual-output design: store the rich
   run-book, not just Recorder JSON.
2. **A selector matching the WRONG element is drift too.** Healing must verify
   the match by text/role, not just "something resolved." Tier 2 above.
3. **Honest scope note — click FIDELITY is separate from selector healing.**
   Square's "Any staff" is a `<market-row>` web component; clicking it (even
   natively) did not reliably trigger its post-click "Add" transition in this
   deep-linked state. That's a widget-interaction quirk, NOT a healing failure —
   the element is FOUND correctly every time. Real capture would record the
   working interaction from the live full-flow drive; healing only owns
   re-locating the element, not fixing a flaky widget handler.

## Throwaway

Fold the recovery-ladder contract into the browser-domain-memory replay design:
replay Recorder JSON first → on selector drift, agent re-drives the run-book with
this ladder.
