---
date: 2026-06-13
topic: protocol-vs-cdp-experiment
kind: research
status: decided
settles: PRODUCT.md assumption #1 (is the moat the protocol or CDP?)
feeds:
  - skills/browser-use/docs/PRODUCT.md
---

# Discovery experiment — is the moat the PROTOCOL or CDP?

The make-or-break question from PRODUCT.md Part 2 #2. It decides the product's identity:
is this a general **agent-trust protocol** (browser is just substrate #1), or specifically
a **browser-trust tool** whose moat is physically tied to CDP?

This is a reasoning/research experiment, not a code spike — the answer lives in the
structure of each substrate, not in a browser run.

## Method

Define the exact property CDP gives for free, then test whether any non-browser substrate
gives an agent the SAME property for free. The moat requires ALL FOUR simultaneously, at
near-zero marginal cost per added observer:

1. **One shared ground-truth world** N observers see the SAME instance of (not N copies).
2. **N independent observers** — different implementations, so errors are UNCORRELATED
   (uncorrelated error is what makes disagreement meaningful; correlated observers just
   agree on the same mistake).
3. **Near-free fan-out** — adding an observer does NOT duplicate the world.
4. **Mechanically diffable outputs** — comparable structured output you can Set-diff.

## Result — 9 substrates scored

| substrate | 1 shared | 2 independent | 3 free fan-out | 4 diffable | all 4 free? |
|---|---|---|---|---|---|
| Filesystem | yes | **no** (same bytes via same syscall layer) | yes | partial | NO |
| Database | yes | **partial** (one query planner is the single brain) | yes | yes | NO |
| API / HTTP | partial (load-balanced replicas) | **partial** (server computes; clients dumb) | yes | yes | NO |
| OS / process | yes | **yes** (procfs vs eBPF vs ptrace differ) | partial (attach perturbs) | **no** (no common schema) | NO |
| Kubernetes | yes | partial (all read one API server) | yes | yes | NO |
| LLM N-version | **no** (no shared world; N prompts not N views of one state) | yes | yes | partial | NO |
| Git repo | yes | **no** (all readers implement one spec → MUST agree) | yes | yes | NO |
| Document/spreadsheet | yes | partial | yes | partial | NO |
| Cloud infra | yes | partial (all read one control plane) | yes | yes | NO |

**None clears all four for free.**

## The crux (hypothesis confirmed)

The tension is criterion 2 (independence) vs criterion 3 (free fan-out), and almost every
substrate gives one but not the other:

- **Cheap fan-out, correlated observers** (filesystem, DB, k8s, cloud, git, API): the world
  ships with ONE canonical interpreter (one query planner, one git spec, one API server).
  The "N clients" are thin transports over a single brain → fan-out buys *echoes, not second
  opinions*. An echo is not a witness.
- **Independent observers, expensive/undiffable** (OS/process): genuinely uncorrelated
  (procfs vs eBPF vs ptrace) but attaching perturbs the process and outputs share no schema.
- **No shared world** (LLM N-version): uncorrelated and cheap, but N models answer one
  *prompt*, never observe one *state* — agreement-on-an-answer, never agreement-on-a-state.

## Why CDP is the rare exception

A browser is the one common agent substrate where the world is legible at **multiple
independent abstraction layers simultaneously** — pixels, DOM, a11y tree, network, JS heap
— each with its own implementation and its own blind spots. So uncorrelated observer error
is a **free byproduct of the world's architecture**, not something engineered against the
grain. CDP is the native multi-client bus that lets N debugger-grade engines attach to one
live tab and each re-derive its own view, emitting already-structured output. That exact
combination — shared mutable instance + multiple genuinely-independent reader
implementations + native multi-client attach + structured output — is what no other
substrate gives for free.

## Verdict: (B) CDP — the moat is browser-specific

The trust **pattern** (independent re-derivations of one shared mutable instance, Set-diffed
for consensus) is real and intellectually general. But the **economics that make it free are
CDP-specific.** Everywhere else you would have to *build* independence (against systems
deliberately designed to have one source of truth) or *build* cheap non-perturbing diffable
observation (OS). Branding the product as a general "agent-trust protocol" overclaims.

**Settled product identity:** a browser-trust tool — *CDP-as-a-multi-client-bus, where the
browser's multi-layer legibility gives uncorrelated second opinions for free.* Narrower than
"protocol," and stronger for it.

## The single sharpest insight

**A browser is the only common agent substrate where uncorrelated observer error is a free
byproduct of the world's architecture rather than something you must engineer against the
grain.** Every other substrate is designed to have one source of truth — so adding observers
is cheap but gives correlated echoes. The browser accidentally exposes one live state through
several independent layers. The moat isn't "many tools can read a browser"; it's **"a browser
is one world that honestly disagrees with itself"** — and you cannot manufacture that
disagreement cheaply anywhere a single interpreter owns the truth.

## Honest caveat (the sliver of a split verdict)

OS/process introspection is the *only* other place with genuinely independent observers (it
fails on 3+4, not on 2 — and those are fixable: eBPF gives near-free non-perturbing
observation; a common schema could be imposed). So if a "substrate #2" ever exists, it is
process introspection, not filesystems/DBs/APIs — and it must be *engineered*, not inherited.
Park it; do not market it.

## Decision

- Identity: **browser-trust tool**, not agent-trust protocol. PRODUCT.md updated.
- Lean into the browser; every multi-layer-legibility dividend is moat-pure.
- Do not chase non-browser substrates as a near-term moat.
- One open assumption remains (fingerprint distinctness for Cloak-Catcher) — separate
  property, separate experiment.
