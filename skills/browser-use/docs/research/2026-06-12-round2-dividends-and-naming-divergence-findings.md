---
date: 2026-06-12
topic: round2-dividends-and-naming-divergence
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-perception.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/run-repro.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/fleet.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/DIVIDENDS-ROUND2-NOTES.md
feeds:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
follows:
  - skills/browser-use/docs/research/2026-06-12-multi-engine-facade-n5-spike-findings.md
  - skills/browser-use/docs/ideation/2026-06-12-facade-dividends-round-2-ideation.html
---

# Round-2 dividends + the accessible-name divergence finding

Live-proof research for two round-2 facade dividends, plus the most important new finding
of the session: engines disagree on element *names*, not just presence — and that
disagreement is exactly what makes single-engine agents silently fragile.

## Dividend ★1+★2 — confidence-annotated perception + stakes dial (PROVEN)

`run-perception.ts` fans a page across all 5 engines, tags every interactive element
`seen_by: N/5`, and exposes two tiers:

- **cheap** = fastest single engine (one view, ~55-106ms)
- **consensus** = all 5 fanned out + per-element agreement score (~0.9-1.1s)

Live results:

| page | cheap tier | consensus | contested |
|---|---|---|---|
| Wikipedia "Web browser" | playwright-CLI 106ms, 298 els | all 5, 1127ms | 297/298 agree, 1 glyph |
| Hacker News | playwright-CLI 55ms, 149 els | all 5, 931ms | **122/201 agree, 79 contested** |

The mechanism is real and cheap. The dial trades ~10× latency for confidence on demand;
the agent buys consensus only where stakes justify it.

## Dividend ★5 — reproduce-everywhere (PROVEN)

`run-repro.ts <url> "<name>"` replays a lookup across all 5 and classifies an anomaly:

- "Learn more" / example.com → 5/5 → **PRESENT EVERYWHERE** (transient miss; retry) ✓
- "Buy now" / example.com → 0/5 → **TRUE ABSENCE** (agent was right; re-plan) ✓
- "GND" / Wikipedia → 0/5 → correctly absent (GND is a row LABEL, not an interactive
  link; the role filter rightly excludes non-actionable text) ✓

The verdict logic separates transient-miss from real-absence on live pages. The
lineage-artifact branch is real in design; see the naming-divergence finding below for
where it actually bites.

## THE FINDING — accessible-name divergence (Hacker News, verified live)

Static pages (Wikipedia) agreed to within 1 element. A real link-dense page exposed the
divergence the oracle exists to catch.

On Hacker News, the "N comments" links scored **2/5** — present only on the chrome
lineage. Drilling into the raw snapshots:

- **chrome lineage (`uid=`)** names the link `link "119 comments"` (by its text content)
- **chromium lineage (`[ref=]`)** names the SAME DOM link `link "3 hours ago"` (by the
  adjacent timestamp)

It is the **same element**, given **completely different accessible names** by the two
engine lineages' accessibility-tree computation. Not a missing element — a **naming
divergence**.

### Why this is the product, in one example

An agent instructed "click the '119 comments' link":
- on chrome lineage → **succeeds** (name matches)
- on chromium lineage → **fails / not found** (the engine calls it "3 hours ago")

A single-engine agent cannot see this fragility — it gets one name and trusts it. The
fleet + oracle surfaces it as a 2/5 contested element; `repro` localizes it to the
chrome-vs-chromium lineage. This is ADR 0012's "engines do not compute the a11y tree
identically; never fake uniformity" — demonstrated on a live mainstream site, not a
contrived case.

## Both findings are true and complementary

- **Clean static content → high consensus** (Wikipedia: 297/298). Consensus is cheap
  insurance that mostly *confirms trust*.
- **Dynamic / link-dense content → real divergence** (Hacker News: 79/201 contested),
  driven by per-lineage accessible-name computation.

The product is exactly the thing that tells you which regime a page is in — and warns the
agent before it makes a name-fragile click.

## Honest correction carried from round-1

The round-1 metrics run reported "playwright-cli uniquely saw ~14 authority-control links
the other 4 truncated." Re-verified: that was a **page-state artifact** (the page had
navigated to iana.org during earlier click tests), not a true divergence. On a clean
same-page fan-out the engines agree to within 1 element. The spike corrected its own
overstated claim — the substrate is trustworthy enough to catch its operator.

## Implications for the build (feed the requirements)

1. **Accessible-name divergence is a first-class oracle signal.** When engines name the
   same element differently, an agent acting by name is silently engine-fragile; the
   confidence score (2/5) is the warning. (New requirement — see requirements R5/R11.)
2. **Confidence-annotated perception earns "default" status on dynamic pages** — a
   meaningful fraction of elements are genuinely contested (79/201), so the consensus tier
   is not paranoia, it is how you avoid name-fragile clicks.
3. **Match precision matters for triage** — substring "comments" matched the nav link on
   all engines; exact-name matching is what surfaces the divergence. `repro` should match
   on exact accessible name to attribute lineage splits correctly.
4. **Normalizer hygiene** — the stray `"` glyph remains the one Wikipedia contested item;
   filter non-actionable glyph refs.

## Status

Throwaway harnesses (`run-perception.ts`, `run-repro.ts`, `fleet.ts`); keepers remain
`ref-normalizer.ts` + `vocab-map.ts`. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-perception.ts https://news.ycombinator.com
    bun skills/browser-use/src/prototype-playwright-vocab-map/run-repro.ts https://example.com "Learn more"
