---
title: GoF Pattern Naming for the Multi-Engine Architecture
slug: gof-pattern-naming
type: decision-log
status: complete
date: "2026-06-13"
timezone: Australia/Melbourne
owner: gof-pattern-naming
source:
  - skills/browser-use/docs/research/2026-06-12-multi-engine-facade-n5-spike-findings.md
  - skills/browser-use/docs/research/2026-06-13-protocol-vs-cdp-experiment.md
  - skills/browser-use/docs/PRODUCT.md
  - docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md
decision_metadata_format: fenced-yaml-per-decision
---

# GoF Pattern Naming for the Multi-Engine Architecture

## Frame

Decision 1 and Decision 3 are superseded by ADR 0031. Their pressure evidence
remains useful, but Browser Use no longer owns the mapping or facade they named.

The session settled the product (one warm Chrome, N independent CDP engines, a mechanical
differential oracle). Three GoF labels were in informal use across docs/code — Facade,
Adapter, Strategy. Ran the `gof-pressure-lens` (Pattern Referee Mode) to test whether each
name is pressure-earned against the session's prototype + decision evidence, under the rule
`No pressure -> no pattern`. This log records the verdicts so the vocabulary stays honest.

## Decision 1 — Adapter: KEPT (fully earned)

```yaml
pattern: Adapter
verdict: superseded
superseded_by: docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md
seam_owner: two-axis mapping layer (src/ref-normalizer.ts parser-per-ref-format + src/vocab-map.ts dispatch-per-transport; engine-origin-tagged FacadeRef)
pressure_source: n5-spike Finding 1 — transport seam is vocabulary-bound; playwright fit 0/6 seams; 5 engines speak different tool-name vocabularies AND dispatch shapes
deletion_test: remove the mapping layer -> facade reaches only chrome-devtools; other 4 engines unreachable -> N collapses to 1
```

The "two-axis mapping is more than a thin wrapper" objection does NOT weaken Adapter — it
is the strongest Adapter evidence. GoF Adapter exists to convert one interface to another
the client expects; a two-axis impedance mismatch (ref-format ⊥ dispatch-shape, proven
independent) is Adapter pressure with teeth. A thin wrapper would be the *weak* case.

## Decision 2 — Strategy: REJECTED, relabel "Evidence-First Selection"

```yaml
pattern: Strategy
verdict: reject
relabel: evidence-first selection (non-GoF locality label; already named "Router / evidence-first routing" in ADR 0012)
seam_owner: Browser Adapter Router (ADR 0012)
reason: GoF Strategy = interchangeable algorithms presumed valid, freely swapped. The Router presumes candidates INVALID until proven (attachment proof + capability match); missing/stale evidence yields recovery, not a route. That is an admission gate, not an algorithm swap.
deletion_test: remove the Router -> engines route on unproven manifests -> false capability claims (the exact ADR 0012 failure). The MODULE is earned; the NAME Strategy is not.
```

Forcing "Strategy" would be decorative abstraction (a lens reject criterion) — the ICA
vocabulary "evidence-first routing" already names the pressure precisely; GoF adds nothing.

## Decision 3 — Facade: QUALIFIED KEEP (action surface only) + name the oracle separately

```yaml
pattern: Facade
verdict: superseded
superseded_by: docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md
scope: the operate/observe/verify ACTION surface only
seam_owner: the facade interface (caller never names an engine; vocab/dispatch hidden on the common path)
pressure_source: common-path callers genuinely get a simpler interface over a 5-engine subsystem
limit: the differential ORACLE is NOT a Facade — a Facade HIDES subsystem internals; the oracle's entire value (the moat) is to SURFACE per-engine divergence. Naming the oracle "Facade" inverts the pattern's intent.
deletion_test (facade surface): remove it -> caller must name engines and handle 5 vocabularies
```

```yaml
pattern: N-version programming (quorum-comparator)
verdict: keep (new, correct name for the oracle)
seam_owner: the differential oracle (mechanical Set-diff over N independent engines)
pressure_source: protocol-vs-CDP experiment — the moat IS independent implementations disagreeing; consensus/quorum/confidence are votes over N re-derivations of one shared state
deletion_test: remove the oracle -> lose the moat (the disagreement signal is the product)
```

The whole product is **a Facade-fronted system whose differentiator is explicitly
anti-Facade** (N-version programming). Calling the entire product "the facade" overclaims;
the facade names the action surface, N-version names the moat.

## Consequences

- "facade" stays as the action-surface term and as informal product shorthand, but PRODUCT.md
  is corrected so the **moat** is named N-version / quorum-comparator, not facade.
- Router language must not drift toward "Strategy"; use "evidence-first routing/selection."
- Adapter is the load-bearing, fully-earned pattern name — safe to use freely.

## Next safe action

Apply the PRODUCT.md correction (done with this log): distinguish the Facade action surface
from the N-version oracle moat; keep Adapter; avoid Strategy for the Router.
