---
date: 2026-06-13
topic: firefox-third-lineage
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-firefox-lineage.ts
feeds:
  - skills/browser-use/docs/PRODUCT.md
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
---

# Firefox third-lineage spike — the scaling claim, made precise; the moat boundary, drawn

Adds a genuinely-new RENDERING lineage (Firefox via Playwright) to test two things the
N=5 proof left open:

- **Claim A (scaling):** the sub-linear "add any engine" promise rests on ref-FORMAT
  clustering into lineages (Chrome `uid=`, Chromium/Playwright `[ref=]`). Does a 3rd
  *rendering* engine need a 3rd parser, or does it ride an existing one?
- **Claim B (moat):** all 5 current engines attach to ONE warm Chrome over CDP — same
  world, so the oracle's divergence = uncorrelated observer error ("no engine is a second
  opinion on itself"). Firefox CANNOT attach to Chrome's CDP; it is a separate process.
  What does that separate world cost the moat?

## Method

- Chrome-world baseline through the browser-use skill's warm-Chrome front door
  (`requireWarmChrome`): snapshot via playwright-cdp (`[ref=]`) + chrome-devtools (`uid=`).
- Firefox: `playwright-cli open --browser firefox` — its OWN process. The spike does not
  (cannot) route Firefox through warm Chrome; that impossibility IS finding B.
- Parse Firefox's snapshot with the EXISTING ref-normalizer (both parsers); count new
  parsers needed. Diff interactive-name Sets: Chrome-world vs Firefox-world.
- Two pages: example.com (1 control) and news.ycombinator.com (152 controls).

## Result A — 0 new parsers. Ref-format clusters by DRIVER, not rendering engine.

```
Firefox snapshot → [ref=] parser (Playwright lineage)  → 650 refs  ✓
                 → uid= parser   (Chrome lineage)      →   0 refs  ·
new parsers needed for Firefox: 0
```

Firefox — a completely different rendering + a11y engine (Gecko, not Blink) — emits
`[ref=]` because **Playwright is the driver.** The "lineage" axis in the two-axis mapping
is really a **driver axis**, not a rendering-engine axis:

> ref-FORMAT is bound to the DRIVER (Playwright → `[ref=]`, chrome-devtools → `uid=`),
> NOT to the rendering engine underneath. Any browser Playwright can drive (Chromium,
> Firefox, WebKit) is **free on the parser axis** — same `[ref=]`, same dispatch shape.

This is STRONGER than the original sub-linear claim. The original framing implied each new
rendering lineage might cost a parser. Measured: it doesn't. Parser cost scales with the
number of DRIVERS (2 today), not the number of rendering engines (now 3: Blink, Gecko, and
WebKit comes free the same way). Adding WebKit = 0 new parsers, 0 new dispatch shapes — it
is the same playwright-cli code path with `--browser webkit`.

## Result B — the moat is intra-world. Firefox is a new WORLD, not a new LENS.

On Hacker News (152 interactive elements):

```
Chrome-world interactive names:  152
Firefox-world interactive names: 152
shared: 152   only-Chrome: 0   only-Firefox: 0
```

Zero divergence. That zero is the finding. The N=5 oracle's power comes from N engines
disagreeing about the SAME world (the proven "119 comments" vs "3 hours ago" accessible-name
split on one Chrome) — uncorrelated observer error a single engine cannot self-check.
Firefox does not produce that kind of divergence because **it is not looking at the same
world** — it rendered its own copy of the page in its own process.

> The oracle's irreducible property — "no engine can be a second opinion on itself" —
> is **INTRA-WORLD**. It holds for N engines on one warm Chrome. It does NOT extend across
> browsers for free: a Chrome ref and a Firefox ref describe DIFFERENT browser instances,
> so a cross-browser diff measures cross-BROWSER rendering parity, not same-world observer
> error. Different question, different (also-useful) tool.

So Firefox slots in cheap on the mechanics (0 parsers) but it is a **cheap additional
WORLD**, not another **lens on the warm-Chrome world**:

- **As a lens (what the moat needs):** it can't be — it's a separate process. Adding
  Firefox does NOT deepen the warm-Chrome consensus/quorum.
- **As a world (what it's good for):** cross-browser parity checks ("does this render +
  behave the same in Gecko/WebKit as in Blink?") — a real, separate use case that the
  same facade contract + the same `[ref=]` parser already serve.

## Verdict — both claims resolve, both get more precise

| claim | pre-spike framing | measured |
|---|---|---|
| scaling | "each rendering lineage may cost a parser" | parsers scale with DRIVERS (2), not rendering engines (3+); Firefox + WebKit are free |
| moat | "more engines = deeper consensus" | TRUE only intra-world; a separate browser is a new world, not a new lens — no free consensus across browsers |

## Implications

1. **PRODUCT.md scaling claim:** restate as "parser cost scales with drivers, not engines
   — every browser a driver supports is free." Firefox + WebKit join at zero parser cost.
2. **PRODUCT.md moat:** add the intra-world boundary explicitly. The "no second opinion on
   itself" moat is about N lenses on ONE world; cross-browser is a different (compatible)
   capability, not an extension of the moat.
3. **USE-CASES.md (engineering driver):** cross-browser parity (Gecko/WebKit vs Blink) is a
   natural addition to the human-supervised mode — same contract, `--browser` flag, no new
   parser. NOT part of the unattended-trust mode (that one wants N lenses on the live
   logged-in Chrome world, which Firefox cannot join).

## Status

Throwaway spike (`run-firefox-lineage.ts`). Keepers: the driver-axis correction (0 parsers,
free WebKit) and the intra-world moat boundary. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-firefox-lineage.ts https://news.ycombinator.com
