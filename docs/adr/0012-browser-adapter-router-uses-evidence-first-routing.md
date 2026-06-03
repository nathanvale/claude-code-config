---
status: accepted
date: 2026-06-02
---

# Browser Adapter Router Uses Evidence-First Routing

`browser-use` routes a Bounded Browser Outcome by evaluating fresh precondition, attachment, and capability evidence before choosing a Browser Adapter. Evidence beats clever choosing: preference and ranking only order proven candidates; missing, stale, partial, or docs-only evidence produces recovery, not a route.

## Considered Options

- Universal browser API: simpler call site, but hides adapter boundaries and makes false capability claims likely.
- Static docs matrix: useful research, but drifts and cannot prove current attachment or session compatibility.
- Automatic fallback: convenient, but can silently leave Warm Chrome, auth state, or requested adapter constraints.

## Consequences

- Router implementation must make evidence envelope validation a first-class runtime path.
- Route evaluation must accept only a Validated Route Evidence Envelope, not raw caller input.
- Adapter reports and proof stay runtime-owned; skill prose names workflow, not capability truth.
- Forced adapter failures stay strict until the user relaxes policy or supplies fresh proof.
