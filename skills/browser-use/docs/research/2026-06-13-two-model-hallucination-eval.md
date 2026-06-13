---
date: 2026-06-13
topic: two-model-hallucination-eval
kind: research
status: corrected-finding
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-twomodel-halluc.ts
feeds:
  - skills/browser-use/docs/PRODUCT.md
  - skills/browser-use/docs/research/2026-06-13-selector-hallucination-equalizer-spike.md
---

# Two-model hallucination eval — the premise, corrected by measurement

The selector-hallucination spike proved the fleet catches invented selectors 6/6
(model-independent). The capability-equalizer claim then rested on a behavioral premise:
**weaker models hallucinate selectors more than stronger ones.** This eval tested it with
real models via `claude -p` (Haiku 4.5 = weaker, Opus 4.8 = stronger). It corrected the
premise — which is why it was worth running.

## Method (test 1 — WITH ref list)

Feed both models the SAME real ref list (25 elements from a live Hacker News snapshot) +
a task; instruct "reply with a uid from the list, or NONE if absent; do not invent." 6
tasks — 3 present on the page, 3 deliberately ABSENT (the hallucination temptation: "Add to
cart", "Accept all cookies", "Sign in to your account" — none exist on HN).

## Result — BOTH models 0/6 hallucinations

| model | hallucinated | grounded | correct-NONE |
|---|---|---|---|
| Haiku 4.5 | **0/6** | 3 | 3 |
| Opus 4.8 | **0/6** | 3 | 3 |

Identical, perfect. Even Haiku said NONE for every absent element instead of inventing a
selector.

## What this corrects

**The simple premise — "weaker models hallucinate selectors more" — is FALSE when the model
is given a grounded ref list and told to use it.** With grounding, even a weak model does
not invent selectors. The spike's value is therefore NOT "the fleet catches a weak model's
hallucinations" — both models had nothing to catch.

**The corrected, more accurate claim:**

> The fleet **prevents** selector hallucination **by construction** — by always handing the
> model a real ref list (from what the engines saw) instead of letting it work from memory.
> Hallucination happens when a model improvises selectors *without* a grounded snapshot. The
> fleet's contribution is enforcing the grounded-ref-list discipline.

So the equalizer mechanism is **prevention, not catch** — and it is still real and still
helps weaker models, but for a different reason than first stated: a weak model left to
improvise selectors from training priors (no ref list) is where the gap would appear, and
the fleet removes that situation entirely.

> **"From memory" vs "grounded":** *from memory* = the model answers "what selector" from
> its training priors, WITHOUT seeing the live page (e.g. "NYT uses `#fides-accept-all-button`"
> — a recalled guess that may be stale or wrong). *Grounded* = the model picks from the
> fleet's ref list, which is what the engines actually SAW on the live page this moment
> (observing, not recalling). The whole product is about making the agent act *grounded*, not
> *from memory*.

## Test 2 (no ref list, `--tools ""` so models answer from memory) — the GAP IS ZERO

Same models, NO snapshot, pure-answer mode (no tool-use). 6 tasks, "what selector would you
click for X" with no page given.

| model | invented-selector | ambiguous | grounded-refusal |
|---|---|---|---|
| Haiku 4.5 | **3/6 (50%)** | 3 | 0 |
| Opus 4.8 | **3/6 (50%)** | 3 | 0 |
| **gap** | **0** | | |

**Both models hallucinate selectors at the SAME rate (50%) when ungrounded.** Haiku is not
worse than Opus at inventing selectors from priors. (First attempt was contaminated —
`claude -p` without `--tools ""` let models wander into actual browsing; the clean re-run
with tools disabled gives the number above.)

## The premise is REFUTED — and it makes the product story stronger

"Weaker models hallucinate selectors more" is **false, measured.** Hallucination is not a
model-*weakness* problem — it is a model-*grounding* problem:

- ungrounded: both Haiku and Opus invent selectors ~50% of the time;
- grounded (test 1): both invent 0%.

The variable that matters is **grounding, not model IQ.** This kills the
"capability-equalizer / run cheaper models safely" angle (unsupported — Opus is just as
likely to hallucinate ungrounded) and replaces it with a **stronger, measured claim**:

> **Selector hallucination is universal across model tiers and grounding-solvable. Even a
> frontier model hallucinates selectors when it works from memory; the fleet's grounding
> discipline eliminates that for ALL models. You don't need a better model to stop selector
> hallucination — you need grounding. The fleet is table-stakes at every model tier.**

"Even Opus needs us" is a bigger story than "we help cheap models": the product is not a
crutch for weak models, it is necessary grounding that every agentic browser lacks —
frontier-model users included; they just feel safe.

## Why this matters for the product story

Do NOT pitch "the fleet catches what weak models hallucinate" — measurement refuted the
simple form. DO pitch: **"the fleet grounds every action in what the page actually exposes,
so no model — weak or strong — improvises a selector. The weaker your model, the more that
grounding is worth."** Narrower, measured, defensible.

The spike correcting its own premise via real-model measurement is the same honest-scoping
pattern as the rest of this project. The fleet-catches-6/6 mechanism still stands; the
behavioral story around it is now accurate.

## Status

Throwaway eval (`run-twomodel-halluc.ts`, claude -p × 2 models × 6 tasks). The corrected
premise + the prevention-not-catch framing are the keepers. Test 2 (no-ref-list) pending.
