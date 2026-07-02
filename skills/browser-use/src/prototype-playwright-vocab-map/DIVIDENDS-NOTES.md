# Swappability dividends — prototyped live across 5 adapters

Prototypes the ce-ideate "what does swappability buy" dividends with REAL numbers,
now that N=5 engines run on one warm Chrome. Harness: `run-metrics.ts`.

## 1. Cost-routing dividend — REAL, but the routing table must be MEASURED not assumed

Snapshot-op latency (navigate excluded), example.com, median:

| adapter | cold (npx) | warm (local bin) | bytes | transport |
|---|---|---|---|---|
| N4 playwright-cli | 699 ms | **40 ms** ◄ fastest | 1011 | CLI / attached session |
| N1 chrome-devtools MCP | 111 ms | 122 ms | 366 | MCP daemon |
| N3 agent-browser | 198 ms | 199 ms | 74 | CLI / direct CDP |
| N2 playwright MCP | 219 ms | 228 ms | 1010 | MCP daemon |
| N5 chrome-devtools-cli | 697 ms | 304 ms | 362 | CLI / own daemon socket |

**The big finding: optimizing invocation FLIPPED the leaderboard.** Cold, the CLIs looked
6× slower than MCP — pure npx cold-start artifact. Warm, `@playwright/cli` (40ms) is the
FASTEST of all five, beating both daemon-warm MCP engines.

Lessons:
- **Transport kind (MCP vs CLI) does NOT determine latency** — invocation model does. A
  warm-attached CLI session beats an MCP daemon round-trip.
- N5 chrome-cli stays slow-ish (304ms) even warm: it round-trips through its OWN separate
  daemon socket per call — an extra hop N4's in-process session avoids. Connection
  architecture matters more than CLI-vs-MCP.
- **Cost-routing is viable but the cost table must be built empirically** — you cannot
  predict an engine's latency from its category. Same lesson as the schema-drift finding:
  verify, don't assume.
- Payload varies 14×: agent-browser `-i` = 74 bytes; playwright = ~1010 bytes for the same
  page. Token-cost routing: route token-sensitive work to the lean snapshot.

Speed headline: **25 nav+snapshot cycles across all 5 adapters in ~13s**; fastest single
engine does a full cycle in **40ms**. All 5 share one warm Chrome → zero per-engine launch
cost → fanning out to 5 engines is nearly as cheap as 1.

## 2. Differential oracle dividend — PROVEN: it caught real divergence

example.com (1 link): all 5 agree — consensus, the "confirm trust" case.

Wikipedia "Web browser" (rich page): **24 interactive elements all 5 engines agree on**,
THEN structured divergence:
- **N4 (playwright-cli) uniquely sees ~14 elements** — `GND`, `BnF data`, `Yale LUX`,
  country names (the bottom "Authority control" navbox), plus `List`/`Comparison`/`Category`
  hatnote links.
- 3/5 ([ref=] lineage) see a stray `"` ref; single-char `^`/`a` artifacts on N4.

**This is the dividend working.** The unique-to-N4 elements are real page content
(authority-control navbox + hatnotes) that the other four engines' default snapshots
truncate/skip. Implications:
- Drive ONLY chrome-MCP → you'd silently miss those links → agent reports "not found" and
  is WRONG with no signal.
- The oracle surfaces it, localizes the outlier engine, AND categorizes the divergence
  (deep/late-rendered navbox) — pointing at the cause (per-engine snapshot depth /
  virtualization handling).
- The `"`/`^` artifacts are a second finding: engines include different decorative refs; a
  real normalizer should filter non-actionable glyph refs.

**No single-engine tool can produce a consensus-view + disagreement-flag.** This is
swappability as a CAPABILITY (catch what one engine misses), not just resilience.

## 3. Graceful degradation dividend — observable (healthy pool), not yet stress-tested

All 5 healthy every run → 5-deep fallback pool. Not yet proven with a live mid-run kill
(deferred — would `daemon stop` one engine and watch fallback). The pool depth is real;
the failover path is unexercised.

## 4. Capability/payload tiering — visible in the data

agent-browser `-i` (interactive-only, 74b/2refs) vs full snapshots (1010b/5refs) shows the
floor/ceiling idea concretely: an engine can offer a lean interactive-only observe as a
distinct capability tier.

## What this proves for the dream

The ideation's swappability dividends are no longer theoretical — three of four are
demonstrated with live numbers across 5 real engines:
- cost-routing ✓ (with the caveat: measure, don't assume)
- differential oracle ✓ (caught real divergence on a rich page)
- payload tiering ✓
- graceful degradation: pool proven, failover path still to exercise

Remaining work (unchanged shape, now evidence-backed):
1. **measured cost table** per adapter (this harness is the seed)
2. **verify layer** for ref staleness + the oracle's divergence triage
3. **redaction** (snapshots leak real tab URLs in raw output)
4. **glyph/artifact ref filtering** in the normalizer

## Status

Throwaway harnesses (`run-metrics.ts`, `run-{3,5}way.ts`). `node_modules/` here is
throwaway too (local bins for warm timing). Keepers: `ref-normalizer.ts`, `vocab-map.ts`.
Re-run metrics (uses local bins if installed, else npx):

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-metrics.ts <url> <reps>

---

## 3 (UPDATE) — Graceful degradation: PROVEN LIVE, 4 stages

`run-degrade.ts` — facade takes an ordered preference, tries each engine, falls
through on failure, completes or exhausts. `servedBy` + fallback depth reported;
caller never names an engine.

| stage | condition | result |
|---|---|---|
| 1 | all healthy | served by preferred (playwright-cli), depth 0 ✓ |
| 2 | preferred killed (real: pw-cli session closed) | fell through to chrome-devtools, depth 1, task completed ✓ |
| 3 | top 4 down | cascaded through all 4, served by N5 chrome-devtools-cli, depth 4, task completed ✓ |
| 4 | all 5 down | failed HONESTLY — "pool exhausted", no hang, no false success ✓ |

**The dividend is real:** a real engine failure (Stage 2, pw-cli session genuinely
closed) was absorbed transparently — the task completed on a different engine and the
caller saw only `servedBy=chrome-devtools`. With 5 engines the pool is 4-deep
fault-tolerant; total outage fails loud, not silent.

**Real finding — mcporter self-heals:** `mcporter daemon stop` did NOT simulate an
outage; mcporter auto-restarts the server on the next `call`. So MCP-backed engines are
MORE resilient than expected (a plus), but it means fallback logic must be tested with
genuine unrecoverable failures or a deterministic kill-switch (added `DOWN=` env var,
which is how you'd test a fallback chain in CI anyway).

## The oracle is NOT the LLM (important architecture note)

The differential oracle is a **mechanical diff** (Set comparison over interactive
elements), not model judgment. The LLM CONSUMES the oracle's verdict ("5 engines agree
on these 24, disagree on these 14, here's who saw what") and reasons on top — it does
not PRODUCE it. Deterministic substrate, LLM on top. This is why the oracle catches what
a single-engine LLM can't: an LLM only reasons about the one snapshot it's given; if that
engine silently dropped 14 links, the LLM never knows. N independent ground-truth sources
diffed in code is the thing that surfaces the gap.
