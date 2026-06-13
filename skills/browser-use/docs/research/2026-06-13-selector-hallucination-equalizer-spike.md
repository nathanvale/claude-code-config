---
date: 2026-06-13
topic: selector-hallucination-equalizer
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-hallucination.ts
feeds:
  - skills/browser-use/docs/PRODUCT.md
  - skills/browser-use/docs/USE-CASES.md
---

# Selector-hallucination spike — the capability equalizer, proven

The sharpest, most provable form of "the trust layer helps weaker models": it
**structurally eliminates selector/element hallucination** — the failure mode weaker
models hit hardest — and the catch is model-independent.

## The failure mode

A model (especially a weaker one) told "click Submit" invents a plausible selector from
training priors — `#submit-btn`, `.cta-primary`, `button[type=submit]` — instead of using a
ref the page actually exposes. Weaker models do this far more; it is a hallucination, not a
reasoning gap.

## Method

Snapshot a real page (example.com) across two lineages → collect the REAL ref + accessible-
name set → simulate a model emitting a mix of real targets (read from the snapshot) and
hallucinated selectors (invented from priors) → run each through the facade gate
(actionable only if present in the snapshot set) vs a single engine acting on the raw
selector.

## Result — 6/6 hallucinations caught, 0 false rejects

```
real targets (from snapshot)  → ✓ actionable      (3/3)
#submit-btn                   → ✗ REJECTED (not in snapshot)
.cta-primary                  → ✗ REJECTED
button[type=submit]           → ✗ REJECTED
"Sign in" (plausible label)   → ✗ REJECTED
#app > div.modal .confirm     → ✗ REJECTED
uid=999_99 (invented ref)     → ✗ REJECTED
```

The fleet gate is a **Set-membership test** against what the engines actually saw —
identical for Qwen 3.5 and Opus 4.6.

## The honest nuance (it strengthens the claim)

In the contrast, playwright-cli *errored* on the raw hallucinated CSS ("does not match any")
rather than silently missing. So a single GOOD engine catches *some* hallucinations via
errors. But that is the weaker guarantee:

- **Single engine:** catches erroring hallucinations — but at ACTION time (it tried), and
  **silently passes** a hallucinated selector that happens to match the WRONG real element
  (e.g. a `.btn-primary` that exists but isn't what the model meant).
- **The fleet:** rejects hallucinations **before any action**, by membership against the
  real snapshot set; AND the oracle catches the "matched the wrong real element" case via
  the proven naming-divergence signal.

So the precise claim: **the fleet moves selector hallucination from a runtime gamble to a
pre-action structural impossibility.** A weak model literally cannot get the fleet to act on
an invented selector, because refs come from what the engines SAW, not from the model's
priors.

## Why this is the equalizer at its most provable

The guard is `Set.has(target)` — it has no IQ. It moves the selector-hallucination defense
OFF the model and INTO code. A cheaper model gets the SAME structural protection as a
frontier one for this failure mode. That reframes the cost equation: **run a cheaper model
safely (architecture) instead of paying for a frontier model to be careful (tokens)** — at
least for the large class of failures that are selector/element hallucination.

## The limit (do not overclaim)

This equalizes the *perception/targeting* failure mode, not *reasoning*. A weak model handed
a correct ref set can still choose the wrong action, mis-plan, or misread an ambiguous task.
The fleet improves the inputs and the guardrails; it does not raise the model's judgment in
between. The full "weak+fleet ≈ strong on safety" claim needs the two-model eval (below).

## Next: the two-model eval (scoped, follow-on)

To prove the *size* of the equalization end-to-end:

- Same daily-driver task (e.g. a multi-step form or booking flow), run by a weaker model
  (Qwen 3.5) and a stronger model (Opus 4.6), each WITH and WITHOUT the trust layer.
- Measure: task success rate, selector-hallucination rate, silent-failure rate, wrong-
  irreversible-action rate.
- Hypothesis: the trust layer closes most of the weak-vs-strong SAFETY gap (hallucination,
  silent failure, bad commits) while leaving a reasoning gap. If the safety gap closes to
  near-zero, the cost-economics angle is real.
- Heavier than this spike (needs two LLMs wired to the facade); deferred to a build/eval
  phase. This spike proves the mechanism is model-independent; the eval would prove the
  effect is large.

## Status

Throwaway spike (`run-hallucination.ts`). The structural-catch result + the equalizer
framing + the scoped two-model eval are the keepers. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-hallucination.ts https://example.com
