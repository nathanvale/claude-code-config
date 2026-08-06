---
date: 2026-06-13
topic: vision-sixth-lineage
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-vision-lineage.ts
feeds:
  - skills/browser-use/docs/PRODUCT.md
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
---

# Vision sixth-lineage spike — the contract bends, and the moat gains a SENSE

The hardest engine for the architecture: a vision / computer-use lens that perceives
PIXELS, not the DOM. All 5 current engines read the accessibility tree and yield a ref;
a vision engine sees a screenshot and emits a coordinate. Two questions:

- **Claim A (contract):** does `FacadeRef {engine, raw, role, name}` survive an engine with
  no ref?
- **Claim B (moat):** the 5 DOM engines all read the SAME a11y tree, so they agree on
  structure and are blind to a DOM-vs-paint mismatch (an element the DOM says is clickable
  but is visually COVERED). Can a pixel lens catch that — a signal no DOM engine can produce?

## Method (a true test, not a vision-LLM simulation)

The architecture question is separable from model quality. CDP exposes both layers of the
SAME warm page: the DOM/a11y tree (what the fleet sees) and `elementsFromPoint` (what is
actually painted). So the spike compares, for every interactive node's center point, the
**DOM truth** (the node) against the **paint truth** (the top painted element) — which IS
the structural core of what a vision engine contributes, without needing an LLM to read
pixels.

Run via `agent-browser eval` (the fleet's proven CDP path; Playwright's browser-level
`connectOverCDP` hangs when other CDP clients hold the page targets). 173 interactive nodes
probed on Hacker News.

## Result A — FacadeRef BENDS. Vision is a perception MODE, not a 6th parser.

The two-axis mapping assumes every engine yields a **ref token** (`uid=` or `[ref=]`) that a
parser extracts. A vision engine has **no ref** — its observation is an `(x, y)` / bounding
box. So:

> `FacadeRef.raw` has no vision equivalent. A vision observation is reconciled to the fleet
> only by **hit-testing the coordinate back into the DOM** (`elementsFromPoint`). Vision is
> not a 6th parser slotting into the existing model — it is a distinct **PERCEPTION MODE**
> that the facade must represent explicitly: perception becomes a **sum type**
> `{ RefObservation | PixelObservation }`, not "every engine yields a ref."

This is the first engine that does NOT fit the two-axis mapping. Firefox rode the existing
parser for free; vision needs a new shape (`{x, y, box}`) plus a hit-test bridge. The cost
is real and structural — but bounded, and it buys something the others can't.

## Result B — the pixel lens catches what the whole DOM fleet is blind to (demonstrated)

On clean Hacker News: **0 DOM-vs-paint mismatches** — DOM and paint agree, no false
positives. That alone only proves the test is quiet when it should be. So the spike then
**injects a real overlay** and re-probes:

```
with overlay injected:
  DOM still says  <a> clickable
  paint says      <div id=__spike_overlay__> on top
  → COVERED detected ✓
```

A DOM-only agent (every one of the 5 fleet engines) would click the link's ref and the
click would land on the overlay — **silently**, with the a11y tree still reporting the link
as present and actionable. The pixel lens is the **only** lens that sees the coverage.

> This is a genuinely NEW oracle axis. The existing oracle diffs N readers of the same a11y
> tree (catches accessible-NAME ambiguity). It structurally CANNOT catch DOM-vs-paint
> coverage, because all its members read structure, not pixels. A vision lens adds an
> **uncorrelated perception** — the click-target-occlusion failure class (overlays, cookie
> walls, z-index traps, "invisible but in the tree" elements) becomes detectable.

## Verdict — vision is the lineage that EXTENDS the moat, not just scales it

| | Firefox (3rd lineage) | Vision (6th lineage) |
|---|---|---|
| fits two-axis mapping? | yes — 0 new parsers (rides driver axis) | **no — breaks the ref contract** |
| what it adds | a new WORLD (cross-browser parity) | a new **SENSE** (pixels) |
| moat effect | none (separate world, not a lens) | **extends it** — uncorrelated perception on the SAME world |
| integration cost | ~free | real: sum-type perception + hit-test bridge |

The earlier engines all read the same a11y tree — adding them deepens consensus on
*structure*. Vision is the first that perceives the warm-Chrome world a *different way*, so
its disagreement with the DOM fleet is the highest-value kind: not "engine B names this
element differently" but "the structure is lying about what's clickable." Highest moat
value, highest integration cost.

## Implications for PRODUCT.md

1. **Perception model:** the facade's observation type is NOT "ref" — it is
   `{ RefObservation | PixelObservation }`. Document vision as a perception mode with a
   coordinate→DOM hit-test bridge, not as another adapter behind the two-axis mapping.
2. **Moat:** add DOM-vs-paint occlusion as a distinct oracle axis the DOM fleet cannot
   produce. It is the strongest argument that engine *diversity of perception* (not just
   count) is what the moat is made of.
3. **Roadmap framing:** vision is a deliberate, costed addition (post-MVP), not a free
   plug-in. It is the one engine worth the integration cost because it adds a sense.

## Status

Throwaway spike (`run-vision-lineage.ts`, agent-browser eval over warm Chrome). Keepers:
the sum-type contract finding and the demonstrated DOM-vs-paint occlusion signal. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-vision-lineage.ts https://news.ycombinator.com
