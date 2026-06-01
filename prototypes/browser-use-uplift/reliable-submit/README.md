# reliable-submit (throwaway prototype)

## Question

When an agent re-drives a saved browser flow unattended (e.g. submit a weekly
timesheet every Friday), how do we make a click ACTUALLY TAKE — and detect when
it didn't?

A prior prototype exposed a real hole: synthetic clicks on some web components
(Square's `<market-row>`, custom buttons) don't reliably fire the element's real
handler. The click "succeeds" at the API level but the page never reacts. A human
notices; an unattended Friday auto-run does not. A silently-failed submit is
dangerous.

## How to run

```bash
bun prototypes/browser-use-uplift/reliable-submit/reliable-submit.ts
```

Pure TS, zero deps, no network. The DOM is modelled in-memory so each escalation
tier is exercised deterministically.

## What it proves

`reliableClick(element, expectedEffect)` escalates click fidelity across four tiers
and VERIFIES an `expectedEffect` predicate after each attempt:

1. `element.click()` — native
2. dispatched pointer/mouse sequence (`pointerdown→mousedown→mouseup→click`, bubbles)
3. inner-target click (drill into a web-component wrapper)
4. keyboard activation (focus + Enter/Space)

After each attempt it checks: did the page actually change? A strategy that "ran"
but produced no effect is still a miss → escalate. If all tiers fail, it returns an
honest "click did not take" — never a false success.

The fixture has one element per tier plus one dead element (responds to nothing) to
prove the honest-failure path.

## Verdict

PASS. Actual run output:

```
=== reliableClick: escalation + expectedEffect verification ===

✓ Plain <button>                             → took at tier 1 (element.click()) after 1 attempt(s)
✓ Square <market-row> web-component          → took at tier 2 (dispatched pointer/mouse sequence (pointerdown→mousedown→mouseup→click, bubbles)) after 2 attempt(s)
✓ Custom wrapper (inner radio)               → took at tier 3 (inner-target click (drill into web-component wrapper)) after 3 attempt(s)
✓ Keyboard-only widget                       → took at tier 4 (keyboard activation (focus + Enter/Space)) after 4 attempt(s)
✓ Dead submit (responds to nothing)          → CLICK DID NOT TAKE (all 4 tiers exhausted, honest failure)

VERDICT: PASS — every escalation tier fired for its element, and the dead element
returned an honest 'click did not take' (no false success). expectedEffect
verification is the safety mechanism that makes unattended re-drive safe.
```

Each escalation tier fired for exactly the element that requires it, and the dead
element exhausted all four tiers and reported an honest failure rather than a false
success.

## Findings for browser-domain-memory

- **The click is not the unit of success — the effect is.** Asserting `element.click()`
  "ran" proves nothing. Every recorded step needs an `expectedEffect` predicate (value
  set, class toggled, element appeared, URL changed) checked AFTER the click. Make this
  predicate a first-class part of the saved tape, not an afterthought.
- **Escalating fidelity recovers most real-world misses.** Native `.click()` handles
  plain buttons; a full dispatched pointer/mouse sequence with `bubbles: true` handles
  web components like `<market-row>` that ignore bare `.click()`; drilling to an inner
  target handles custom wrappers; keyboard activation is the last-resort backstop. Order
  matters — cheapest/safest first, escalate only on verified failure.
- **Honest failure is the headline safety property for unattended runs.** When every tier
  is exhausted with no effect, the routine MUST surface "click did not take" loudly
  (abort the flow, alert, do not mark the timesheet submitted). A false success on a
  Friday auto-run is the dangerous outcome this whole design exists to prevent.
- **Record which tier worked per element in domain memory.** Once a known domain's submit
  button is observed to need tier 2, the re-drive can start there and skip cheaper tiers —
  faster and fewer no-op clicks — while still verifying the effect.
- **A missing effect predicate should itself be a hard error.** If a saved step has no way
  to verify its outcome, an unattended run cannot be trusted; treat "no expectedEffect" as
  a capture-time validation failure, not a runtime shrug.
