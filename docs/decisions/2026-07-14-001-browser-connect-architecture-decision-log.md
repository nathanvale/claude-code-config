---
title: Browser Connect Connection Architecture
slug: browser-connect-architecture
type: decision-log
status: in-progress
date: "2026-07-14"
timezone: Australia/Melbourne
owner: browser-connect
source:
  - docs/plans/2026-07-14-001-feat-browser-connect-plan.md
  - lessons/0001-chrome-150-and-warm-chrome.html
  - lessons/0002-auto-connect-is-not-a-protocol.html
  - lessons/0003-chrome-150-adapter-connection-map.html
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Connect Connection Architecture

## Frame

Browser automation in this repo kept failing at the same seam: connecting a
tool to the right Chrome. The Chrome 150 incident sent an everyday-Chrome
debugging listener through the Warm Chrome proof, which correctly rejected it
as foreign; earlier, adapters guessing port 9222 stranded orphaned headless
browsers. The old system conflated four concerns — browser environment,
attachment route, Browser Adapter, and proof. `browser-connect`
(`@side-quest/browser-connect`, home `runtime/browser-connect`) separates
them into a modeled product whose only job is a proven connection handoff.

## Decision 1: environment × route × adapter connection model (slice one)

```yaml
id: browser-connect-architecture-001
status: accepted
decided_at: "2026-07-14"
decision: ship a facade-backed CLI that provably attaches Browser Adapters to Agent Chrome, modeling environment, route, and adapter as separate things
owner: browser-connect
source:
  - docs/plans/2026-07-14-001-feat-browser-connect-plan.md
```

Decision:

- Ship `runtime/browser-connect` as a private, facade-backed CLI. Humans get
  one command — `browser-connect run <adapter> -- <cmd>` — that proves the
  environment, injects the verified endpoint, and execs the tool. Agents get
  the same guarantee as a Verified Handoff Envelope (JSON machine surface).
  The product ends at proven connection; it never performs browser operations.
- Model **environment × route × adapter** as three separate things. Doors into
  Chrome move (the 9222 flag died for default profiles; Chrome 144 added a
  consent toggle), so a route implementation is swapped without redesigning
  the product.
- **Three-door route model, sequenced.** Explicit-CDP (Agent Chrome) is built
  in slice one; UI-consent discovery (Human Chrome) is slice two; extension
  attachment is slice three. All three are first-class route capabilities in
  the model from day one so door assumptions never leak into the envelope
  schema.
- **No-fallback v1.** The caller names the adapter; there is no ranked
  fallback selection. Evidence ranking fails the deletion test, so the
  browser-use router engine is deliberately not consumed in v1.
- **warm-chrome consumed in-process.** `@side-quest/warm-chrome` is the Agent
  Chrome implementation; browser-connect imports its `main` and parses its
  JSON envelope, preserving the exit-20 fail-closed contract and proof
  semantics intact.
- **Verified Handoff Envelope as the adapter-agnostic connection contract.**
  One neutral shape — environment, endpoint, route, proof, single next safe
  action as an enumerated affordance id — identical across all adapters.

Rationale:

- The durable core is the model, not any one Chrome door. Google keeps moving
  the way in; a modeled product absorbs that with a route swap.
- Agent Chrome is fully controlled, already provable via warm-chrome, and
  offers explicit CDP — the route with the widest adapter support — so it is
  the primary environment for slice one.
- No-fallback keeps v1 honest: an adapter appears only when installed and
  proven, and a failed connection ends in exactly one named next safe action,
  never a guessed port or a cold browser.

Consequences:

- browser-use becomes a consumer: it keeps operational policy and delegates
  the proven connection to browser-connect. The canonical **Browser Adapter**
  definition moves to browser-connect's CONTEXT.md; browser-use keeps a
  consumer view. **Verified Handoff Envelope** (success-direction) and
  **Browser Entry Handoff** (failure-direction) are deliberate mirrors.
- `rules/browser-access.md` R11–R14 are now absorbed into this Product
  Contract and carried verbatim in browser-connect's ARCHITECTURE.md. The rule
  retires **pointer-first** via the prompt-system workflow — a committed
  follow-up, not this diff. Until it lands, both texts coexist and a
  rule-following agent double-gates rather than trusting browser-connect's
  envelope.
- warm-chrome gains its first in-process contract-pinned consumer; its
  `schema_version` is the drift tripwire.

Next:

- File the prompt-system-workflow follow-up to retire `rules/browser-access.md`
  now that the browser-connect pointer exists (the coexistence window's closing
  trigger). Filed as issue #230.
- Slice two: Human Chrome via the UI-consent door, which freshly verifies the
  territory ADR 0006 recorded as a dead end.

V2 Ideas:

- Adapter fallback: ranked selection when the named adapter cannot connect —
  the browser-use router engine's evidence-first ranking is the recorded
  candidate mechanism.
- Per-agent target/context allocation for concurrent agents on one Agent
  Chrome (lesson 0003 boundary).
- A shared operation floor (verbs defined by verified postconditions) layered
  on browser-connect, earned only after multiple adapters connect reliably.

## Notes

- v1 has exactly one Agent Chrome instance (the warm-chrome convention
  profile). Future multi-identity means multiple Agent Chrome instances
  distinguished by envelope environment identity, never new environment names.

## Decision 2: relationship to prior decisions (ADR 0006 / 0009 / 0012)

```yaml
id: browser-connect-architecture-002
status: accepted
decided_at: "2026-07-14"
decision: "Consume ADR 0009 intact, do not reverse ADR 0012, defer ADR 0006's superseding note to slice two"
owner: "browser-connect"
source:
  - "docs/plans/2026-07-14-001-feat-browser-connect-plan.md"
  - "docs/adr/0006"
  - "docs/adr/0009"
  - "docs/adr/0012"
```

Decision:

- **ADR 0009 (endpoint authority) is consumed intact.** Endpoints come only from warm-chrome's verified ok envelope; browser-connect never derives an endpoint from convention. R12 restates this invariant.
- **ADR 0012 (browser-use router) is NOT reversed.** The router is deliberately unused in browser-connect v1 (no-fallback makes its ranking dead weight), and it still governs browser-use until migration. This is a scoped non-consumption, not a reversal.
- **ADR 0006's superseding note stays deferred to slice two.** ADR 0006 recorded the UI-consent territory as a dead end on the old `chrome://inspect` evidence. Whether it needs a superseding note is answered when slice two's live consent-flow verification runs — not now.

Rationale:

- Naming the relationship prevents a future agent from reading browser-connect as an implicit reversal of the router decision or the endpoint authority.
- Deferring the ADR 0006 note avoids recording a supersession on unverified territory; the answer is empirical and belongs to slice two.

Consequences:

- No ADR files are edited in the browser-connect slice-one diff.
- The router engine remains the recorded candidate for the future adapter fallback feature.

Next:

- Revisit ADR 0006 during slice two's live consent-flow verification.

V2 Ideas:

- When adapter fallback lands, record whether it consumes ADR 0012's router engine or a fresh ranking mechanism.
