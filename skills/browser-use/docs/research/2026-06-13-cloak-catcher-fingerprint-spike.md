---
date: 2026-06-13
topic: cloak-catcher-fingerprint-spike
kind: research
status: decided
settles: PRODUCT.md last open assumption (Cloak-Catcher fingerprint distinctness)
feeds:
  - skills/browser-use/docs/PRODUCT.md
---

# Cloak-Catcher fingerprint spike — the last open question

The final make-or-break unknown from PRODUCT.md: **are the 5 engines' fingerprints distinct
enough for cloaking detection to work?** Cloak-Catcher (detect a site serving different
content to different observers) only exists if N *distinct* fingerprints observe the same
site — otherwise the cross-engine diff is always empty.

## Method

Ask each engine for `navigator.userAgent` (the cheapest fingerprint proxy) and check the
CDP topology. If the engines share one fingerprint, Cloak-Catcher is dead on arrival.

## Result — all engines share ONE fingerprint

| engine | navigator.userAgent |
|---|---|
| N1 chrome-MCP | Chrome/149.0.0.0 |
| N2 playwright-MCP | Chrome/149.0.0.0 |
| N3 agent-browser | Chrome/149.0.0.0 |
| N4 playwright-CLI | Chrome/149.0.0.0 |
| N5 chrome-CLI | (same browser; eval signature differs, UA identical by construction) |

CDP topology: **one browser, one `webSocketDebuggerUrl`.** All 5 engines attach to the
SAME warm Chrome.

## Verdict — Cloak-Catcher is NOT viable in the current architecture

To a cloaking server, all 5 engines are **the same client** — one browser, one UA, one TLS
fingerprint, one cookie jar, one IP. There is nothing to diff. The cross-engine content
comparison that catches *element/perception* divergence (the proven oracle) cannot catch
*serving* divergence, because serving divergence requires distinct observers at the network
layer, and the engines are distinct only at the *observation* layer (different a11y
pipelines) — not the *identity* layer.

## The deeper point — same property, opposite consequence

The architecture's core strength is its Cloak-Catcher killer. The oracle works *because*
all engines share one world (uncorrelated observation of one ground truth). Cloak-Catcher
needs the opposite: **correlated observation of N different deliveries** — distinct
fingerprints/sessions hitting the site. The browser-trust moat (one warm Chrome, N lenses)
and content-integrity monitoring (N identities, one site) are architecturally *opposed*.

So Cloak-Catcher is not a near-term adjacent market for this product. It would require a
fundamentally different setup — N independent browsers / profiles / network identities, not
N lenses on one browser — which is the multi-proxy farm incumbents already run, and which
sacrifices the very thing (shared world) that makes our oracle cheap and trustworthy.

## Consequence

- Remove Cloak-Catcher from the near-term roadmap; it is incompatible with the
  one-warm-Chrome architecture that defines the product.
- The last PRODUCT.md open assumption is now resolved (negatively). **Discovery is
  converged:** core product proven, identity settled (browser-trust tool, verdict B), and
  the one expansion question (Cloak-Catcher) answered — no.
- If content-integrity is ever pursued, it is a *separate product* (N identities, not N
  lenses), not a dividend of this one.

## Honest note

This is the 3rd spike this session to DEFLATE an idea rather than confirm it (after the
"14 unique links" page-state correction and drive-observe demotion). That the architecture
keeps telling us "no" cleanly is the signal the discovery is trustworthy — the moat is
exactly as wide as the evidence, no wider.

## Status

Throwaway check (per-engine UA eval + CDP topology). The verdict is the keeper; no harness.
Re-verify: ask any two engines for navigator.userAgent — they will match.
