# Ref-staleness characterization — the verify-layer gap (R7), PROVEN

Spike: `run-staleness.ts`. Closes the highest-value remaining gap. Per engine: snapshot
page A → capture a ref → navigate away and back (ref now stale) → use the stale ref →
classify the failure mode.

## Live result — a clean THREE-WAY split

| engine | stale-ref behavior | classification | verify-layer burden |
|---|---|---|---|
| chrome-MCP | "Element with uid 1_3 no longer exists" | **hard-error** | easy — loud, just retry |
| playwright-MCP | re-resolved the ref, click landed | **auto-recovered** | none |
| playwright-CLI | re-resolved the ref, click landed | **auto-recovered** | none |
| chrome-CLI | re-resolved the ref, click landed | **auto-recovered** | none |
| **agent-browser** | click "succeeded" but page did NOT change | **🔴 SILENT NO-OP** | **CRITICAL** |

Three incompatible staleness contracts across five engines: hard-error (1), auto-recover
(3), silent-no-op (1).

## The decisive finding: agent-browser lies about success

agent-browser's stale-ref click returns success while doing nothing. This is the dangerous
case — an agent trusting the return value proceeds as if the action worked when it did not.
**This single engine proves you cannot trust any engine's click return value**, because the
facade must treat all engines uniformly and one of them silently lies.

## Verify-layer design — now forced by data, not asserted

R7's spec is settled by this measurement:

1. **The verify layer must check POST-STATE, not return values.** "Did the page change as
   intended?" (URL/DOM/expected-element delta) is the only signal that catches all three
   failure modes — hard-error, auto-recover, AND silent-no-op. A return-value-trusting
   verify layer would be fooled by agent-browser.
2. **No uniform staleness contract.** The facade cannot assume refs error-on-stale (chrome-
   MCP), re-resolve (the 3 auto-recoverers), or silently no-op (agent-browser). It must
   normalize over all three — which only post-state verification does.
3. **This is the postcondition-floor answer, now forced.** The floor-verb ideation argued
   verbs should be defined by verified post-condition. This spike makes it non-optional: a
   measured engine (agent-browser) silently lies, so post-condition verification is the
   only safe contract.
4. **Re-snapshot-before-action is necessary but NOT sufficient.** SKILL.md already says
   "re-snapshot before element-ref actions" — but that prevents staleness, it doesn't catch
   a silent no-op when staleness slips through. The verify layer is the safety net behind
   the re-snapshot discipline.

## Implication for quorum + perception (the dividends R7 is load-bearing for)

- **Quorum (R13):** the quorum gate must verify post-state per witness, not trust each
  engine's confirmation — agent-browser would false-confirm.
- **Perception (R11):** a `seen_by` score built from engines that silently no-op on stale
  refs would be wrong; perception must be taken from fresh snapshots, and any action on a
  perceived element must post-state-verify.

## Status

Throwaway (`run-staleness.ts`). The taxonomy + the "verify post-state not return-value"
conclusion are the keepers. Feeds requirement R7. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-staleness.ts
