---
date: 2026-06-13
topic: ref-staleness-verify-layer
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-staleness.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/STALENESS-NOTES.md
feeds:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
settles: R7 (verify layer)
---

# Ref-staleness characterization → the verify layer spec (R7)

Closes the highest-value remaining gap from the multi-engine facade work. R7 (the verify
layer) was named "required but unproven"; this spike characterizes ref-staleness behavior
live across all 5 engines and settles the verify-layer spec.

## Method

Per engine: snapshot page A → capture a ref to a known element → navigate away (page B)
and back to A (the captured ref is now stale) → use the stale ref (click) → classify the
failure mode by checking whether the page actually changed.

## Result — a clean three-way split

| engine | stale-ref behavior | classification |
|---|---|---|
| chrome-MCP | "Element with uid 1_3 no longer exists on the page" | hard-error |
| playwright-MCP | re-resolved the ref, click landed | auto-recovered |
| playwright-CLI | re-resolved the ref, click landed | auto-recovered |
| chrome-CLI | re-resolved the ref, click landed | auto-recovered |
| **agent-browser** | click reported success, page did NOT change | **SILENT NO-OP** |

Three incompatible staleness contracts across five engines.

## The decisive finding: one engine lies about success

agent-browser's stale-ref click returns success while doing nothing. An agent trusting the
return value would proceed as if the action worked. Because the facade must treat engines
uniformly and one of them silently lies, **no engine's click return value can be trusted.**

## The verify-layer spec, now forced by data

1. **Check POST-STATE, not return values.** "Did the page change as intended?"
   (URL / DOM / expected-element delta) is the only signal that catches all three failure
   modes — hard-error, auto-recover, and silent-no-op. A return-value-trusting verify layer
   is fooled by agent-browser.
2. **No uniform staleness contract exists.** The facade cannot assume error-on-stale,
   re-resolve, or silent-no-op; it must normalize over all three, which only post-state
   verification does.
3. **This is the postcondition-floor answer, now non-optional.** The floor-verb ideation
   argued verbs should be defined by verified post-condition; this spike makes it mandatory
   because a measured engine silently lies.
4. **Re-snapshot-before-action is necessary but not sufficient.** SKILL.md's "re-snapshot
   before element-ref actions" prevents staleness; it does not catch a silent no-op when
   staleness slips through. The verify layer is the safety net behind that discipline.

## Load-bearing for the proven dividends

- **Quorum (R13):** the quorum gate must post-state-verify each witness, not trust each
  engine's confirmation — agent-browser would false-confirm an action that did not happen.
- **Perception (R11):** a `seen_by` score is only safe from fresh snapshots, and any action
  on a perceived element must post-state-verify.

## Status

Spike `run-staleness.ts` is throwaway; the taxonomy and the "verify post-state, not return
value" conclusion are the keepers. R7 is now characterized, not open. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-staleness.ts
