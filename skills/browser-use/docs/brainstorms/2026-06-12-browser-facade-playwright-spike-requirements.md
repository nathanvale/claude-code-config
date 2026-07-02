---
date: 2026-06-12
topic: browser-facade-playwright-spike
status: requirements
mode: deep-feature
seeded_from:
  - docs/ideation/2026-06-12-browser-use-chrome-devtools-agents-ideation.html
  - docs/ideation/2026-06-12-floor-verb-semantics-adr0012-ideation.html
related:
  - skills/browser-use/SKILL.md
  - docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md
  - docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md
---

# Playwright spike — validate (or kill) the browser-use facade dream

## What this is

A **throwaway spike**, built via the `prototype` skill, that answers one question:
**is the browser-use facade dream worth the full build-out?**

The facade dream: browser-use is one stable interface (`operate`/`observe`/`verify`) over
interchangeable browser engines (chrome-devtools today; playwright, agent-browser staged).
The whole value — swappability dividends, the capability contract, the codec-container split —
is **unobservable until a second engine is wired end-to-end**. Today N=1. This spike makes N=2
as cheaply as possible and reads the result.

This is **not** the production contract. The postcondition-floor contract from the floor-verb
ideation is the *hypothesis this spike tests*, not what gets built first.

## Why now (the honest framing)

- Every swappability dividend (cross-engine oracle, failover, record/replay) is structurally
  real but **currently unproven** — they cannot exist at N=1.
- ~17k LOC of Router / manifests / adapter-proof machinery currently serves one destination.
  Its justification rides entirely on a second engine arriving and being cheap to add.
- This is the third architecture ideation on browser-use. The system has a documented history
  of collapsing heavy designs (ADR 0008→0009). Risk: designing the contract substitutes for
  shipping the second engine that would validate it.
- A minimal spike converts the dream from "elegant theory" to "evidence" for the cost of a
  prototype, not a quarter. Evidence before architecture.

## Goal

Two-part success bar. Both must hold to call the dream validated at this scope.

1. **Codec is cheap** — wiring a playwright codec for 3 floor verbs against the *existing*
   Router / adapter-proof machinery is genuinely thin. Measured by: codec LOC, and how hard
   the existing seams (Router binding, proof, target selection) fight a new engine.
2. **Diff produces signal** — running the same `navigate → snapshot` through both chrome-devtools
   and the playwright spike and diffing the output yields something meaningful: it catches a
   real behavioral difference, or confirms genuine cross-engine agreement.

The two findings are separable on purpose — "was the codec thin?" and "did the diff work?" have
different evidence, so a partial result still teaches something.

## Kill condition (what makes this spike honest)

The spike is a success even when it kills the dream. Declare **not-validated-at-this-scope** if:

- the codec fights the existing machinery hard (a new engine is NOT thin → the
  codec-container split is wrong or the machinery is over-fit to chrome-devtools), OR
- the diff is noise / meaningless (the floor does not produce comparable output across engines →
  the swappability claim is hollow at the floor).

Either outcome is a cheap, real finding that redirects the full build-out. Record it.

## Scope

### In

- A deliberately-minimal, throwaway **playwright codec** for three floor verbs:
  `navigate`, `click`, `snapshot`.
- Wired against the **existing** Router / manifests / adapter-proof path — not a parallel
  bypass. The point is to measure the real cost of adding an engine the sanctioned way.
- A **differential harness**: run `navigate → snapshot` through chrome-devtools AND the
  playwright spike against the same page, diff the two outputs.
- Exercise one real behavioral divergence via `click`: playwright auto-waits for actionability;
  chrome-devtools CDP click is fire-and-forget. Enough to *feel* the postcondition-floor
  question against a real second engine.

### Out (deferred until the spike validates the bet)

- The full postcondition-floor contract, the `behavior_realized` result field, verify-blind
  verb tiering, and the conformance-suite admission gate — all stay in the ideation docs as the
  *next* design phase, not this spike.
- Production-quality playwright adapter: full verb set, lifecycle management, error taxonomy,
  staleness handling.
- The other swappability dividends (graceful failover, record-at-facade replay, cost routing,
  N-of-M quorum).
- Any change to the chrome-devtools adapter or the facade-level moat (verify, redaction,
  Warm Chrome, auth).

## Success criteria

- [ ] Playwright codec for `navigate`, `click`, `snapshot` runs end-to-end against a real page.
- [ ] The codec reaches the page through the existing Router + adapter-proof path (not a bypass).
- [ ] Codec LOC and integration friction are recorded as the "is it thin?" evidence.
- [ ] Differential harness runs `navigate → snapshot` through both engines and emits a diff.
- [ ] The diff is characterised: does it catch a real difference, confirm agreement, or produce noise?
- [ ] The `click` divergence is observed concretely (does fire-and-forget vs auto-wait show up?).
- [ ] A written verdict: validated / not-validated-at-this-scope, with the evidence for each half.

## Constraints

- **Throwaway.** This is `prototype`-skill work — optimise for learning speed, not production
  quality. The codec is expected to be ugly and to be deleted or rewritten.
- **steipete-lean** still governs: the spike must not grow new contract machinery. It rides
  existing seams; if it can't, that *is* the finding.
- **Warm Chrome invariant holds** (ADR 0006): real Chrome, dedicated persistent profile,
  loopback CDP. Playwright connects to the same warmed session, not a throwaway launch — this is
  also a test of "Warm Chrome as a shared precondition across CDP engines."
- **Safety** (SKILL.md): no tokens, cookies, or auth-bearing URLs in output; report secrets by
  shape only. The differential diff must respect the existing redaction boundary.
- Do not modify the production chrome-devtools path to make the spike work — if the spike needs
  chrome-devtools changes to function, that is friction evidence, not a license to refactor.

## Open questions (for the prototype run, not blockers)

- Does playwright connect cleanly to the Warm Chrome loopback CDP endpoint, or does it want to
  launch its own browser? (If the latter, that's a real tension with the Warm Chrome invariant
  worth recording.)
- Is `snapshot` output even diffable across engines (a11y-tree vs locator model), or does the
  diff require a normalisation step that itself reveals where the floor contract must live?
- What's the smallest honest diff — structural DOM/a11y comparison, or just "did both reach the
  same URL + element set"?

## Decision trail

- The facade dream verdict: **worth pursuing as a de-risked bet.** Architecture is sound,
  dividends are structurally real, but N=1 makes it all unproven. Pursue via spike; let the
  spike's evidence decide the full build-out.
- Chose spike-first over harden-contract-first: the contract should be designed against a real
  second engine's friction, not in the abstract.
- Chose the two-part bar (codec cheap AND diff works) over either alone: validates both halves
  of the dream — the codec-container split and the swappability dividend — in one spike.
- The floor-verb question (how to handle same-verb-different-behavior without faking uniformity)
  has a converged answer in the companion ideation: postcondition floor + verify-as-leveler +
  loud typed divergence. The spike tests whether that answer survives contact with playwright.

## Next step

Hand off to the `prototype` skill to build the throwaway spike. On completion, the verdict feeds
back into the facade-contract brainstorm (currently paused) — which resumes only if the spike
validates the bet.
