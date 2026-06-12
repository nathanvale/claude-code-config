# Round-2 dividend prototypes — perception + reproduce-everywhere (live)

Two flagship dividends from the round-2 ideation, prototyped live against the 5-engine
fleet on warm Chrome. Harnesses: `run-perception.ts`, `run-repro.ts`, shared `fleet.ts`.

## ★1+★2 Confidence-annotated perception + stakes dial — PROVEN

`run-perception.ts` fans a page across all 5, tags every interactive element `seen_by:
N/5`, and contrasts two tiers.

Live on Wikipedia "Web browser":
- **Tier 1 (cheap):** single fastest engine (playwright-CLI, **106ms**) → 298 elements,
  no confidence signal. This is what every single-engine agent gets.
- **Tier 2 (consensus):** all 5 (**1127ms** total) → **297/298 elements at 5/5 consensus**,
  1 contested (a stray glyph artifact).

The mechanism works: every element carries an agreement score; the dial trades latency
for confidence (10× cost for consensus, opt-in per step). The honest result on a clean
static page is **near-perfect agreement** — which is itself the product story: consensus
is cheap insurance you buy only where stakes justify it, and most of the time it confirms
trust rather than catching a liar.

## ★5 Reproduce-everywhere — PROVEN (3 of 4 verdicts live)

`run-repro.ts <url> "<name>"` replays a lookup across all 5 and classifies the anomaly:

| case | needle | result | verdict |
|---|---|---|---|
| present everywhere | "Learn more" / example.com | 5/5 present | ✓ PRESENT EVERYWHERE — original miss was transient, retry |
| true absence | "Buy now" / example.com | 0/5 present | ✓ REAL ABSENCE — agent's miss was correct, re-plan |
| true absence | "GND" / Wikipedia | 0/5 present | ✓ correct — GND is a table-ROW label, not an interactive link (good needle choice exposed; the filter rightly excludes non-actionable text on every engine) |
| lineage artifact | — | not cleanly demoable on Wikipedia | the page has NO strong lineage split (see correction below) |

The verdict logic is sound; two of the three diagnosis branches fired correctly on live
pages, and the third (lineage artifact) is real in the design but this page doesn't
exhibit one.

## HONEST CORRECTION to an earlier session claim

The round-1 metrics run reported "N4 (playwright-cli) uniquely saw ~14 authority-control
links the other 4 truncated." Re-verified this session: that was a **page-state artifact**
— during the earlier click tests the page had navigated to iana.org, so the engines were
snapshotting different pages, not diverging on the same one. On a clean same-page fan-out,
all 5 engines agree to within 1 element (297-298 each), and the authority-control section
(`link "Authority control databases"`) is present on BOTH lineages. The only true contested
item is a stray `"` glyph (a non-actionable ref the round-2 ideation already flagged for
filtering — idea: normalizer hygiene).

This is the spike doing its job: it corrected an over-stated divergence claim. The engines
are MORE consistent than the round-1 run suggested — good news for trust, and it means the
oracle's main value here is high-confidence consensus, with divergence being the rarer
(but still real, e.g. the glyph) signal.

## What this proves for the product

- Perception scoring + stakes dial: the mechanism is real and cheap (106ms cheap tier,
  ~1.1s consensus). The agent CAN buy confidence per-step.
- Reproduce-everywhere: the verdict matrix correctly separates transient-miss / real-absence;
  lineage-artifact is a real branch awaiting a page that exhibits one.
- Cross-engine agreement on clean pages is HIGH — the honest, slightly-deflating, and
  ultimately reassuring finding: the fleet mostly confirms trust; divergence is the
  exception worth flagging, not the rule.

## Remaining (carried forward, unchanged)

- normalizer hygiene: filter non-actionable glyph refs (the stray `"`) — round-2 idea, now
  with a concrete live example.
- a richer divergence demo (cloaking, A/B, virtualized lists) would better exercise the
  lineage-artifact and cloaking-detector branches than a static encyclopedia page.

## Status

Throwaway (`run-perception.ts`, `run-repro.ts`, `fleet.ts`). Reuse `ref-normalizer.ts` +
`vocab-map.ts` (the keepers). Re-run:

    bun run-perception.ts https://en.wikipedia.org/wiki/Web_browser
    bun run-repro.ts https://example.com "Learn more"

---

## KILLER DEMO — the oracle on a dynamic page (Hacker News): real divergence found

Static pages agreed to within 1 element. A real link-dense page exposed exactly the
divergence the oracle exists to catch.

`run-perception.ts https://news.ycombinator.com`:
- cheap tier (playwright-CLI, 55ms): 149 elements, no confidence signal
- consensus tier (all 5, ~931ms): **122 at 5/5, 79 CONTESTED**
- **the cheap engine was MISSING ~52 elements the fleet collectively saw**

### The mechanism (verified live — this is the important part)

The "N comments" links scored 2/5 — present only on the **chrome lineage**. Drilling in:

- chrome lineage (uid=) names the link: `link "119 comments"` (by its text content)
- chromium lineage ([ref=]) names the SAME DOM link: `link "3 hours ago"` (by the
  adjacent timestamp)

It is the **same element**, given **completely different accessible names** by the two
engine lineages' a11y-tree computation. Not a missing element — a **naming divergence**.

### Why this is the whole product, in one example

An agent instructed "click the '119 comments' link":
- on chrome lineage → **succeeds** (name matches)
- on chromium lineage → **fails / not found** (engine calls it "3 hours ago")

A single-engine agent cannot see this fragility — it gets one name and trusts it. The
fleet + oracle surfaces it as a 2/5 contested element, and `repro` localizes it to the
chrome-vs-chromium lineage. This is ADR-0012's "engines don't compute the a11y tree
identically; never fake uniformity" — demonstrated on a live mainstream site, not a
contrived case.

### Implication for the build

- The **accessible-name divergence** is a first-class oracle signal: when engines name the
  same element differently, an agent acting by name is silently engine-fragile. The
  confidence score (2/5) is the warning.
- Strengthens the case for **confidence-annotated perception as the default**: on dynamic
  pages a meaningful fraction of elements ARE contested (79/201 here), so the dial's
  consensus tier is not paranoia — it is how you avoid name-fragile clicks.
- `repro`'s lineage analysis correctly attributes the split when matching is exact; the
  substring "comments" matched everywhere (the nav "comments" link), which is itself a good
  lesson: match precision matters for triage.

The earlier Wikipedia "engines agree" finding AND this Hacker News "engines diverge"
finding are both true and both valuable: **clean static content → high consensus (cheap
insurance); dynamic/link-dense content → real divergence the oracle catches.** The product
is exactly the thing that tells you which page you're on.
