---
date: 2026-06-12
topic: multi-engine-facade-n5-spike-findings
kind: research
status: proven
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-codec-fit/
  - skills/browser-use/src/prototype-playwright-vocab-map/
feeds:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
---

# Multi-engine facade — N=5 spike findings

Live-proof research for the browser-use multi-engine facade. Throwaway spikes drove
five browser engines through one facade interface against a shared warm Chrome, and
measured the swappability dividends. This is the durable record of what was proven; the
requirements doc turns it into a build.

## The five adapters (proven live, one warm Chrome on :9222)

| # | adapter | engine | transport | ref format | click dispatch |
|---|---|---|---|---|---|
| N1 | chrome-devtools | Chrome | MCP (mcporter) | `uid=` | `click {uid}` |
| N2 | playwright-cdp | Playwright | MCP (mcporter) | `[ref=]` | `browser_click {target}` |
| N3 | agent-browser | Chromium | CLI / direct CDP | `[ref=]` | `click @ref` |
| N4 | playwright-cli | Playwright | CLI / attached session | `[ref=]` | `click <ref>` |
| N5 | chrome-devtools CLI | Chrome | CLI / own daemon | `uid=` | `click <uid>` |

N4 = `@playwright/cli`. N5 = the `chrome-devtools` bin from `chrome-devtools-mcp@1.2.0`
(Chrome's DevTools-for-Agents 1.0 release).

## Finding 1 — the transport seam is vocabulary-bound, not engine-generic

The original transport (`browser-use-operations.ts` `runOperationTransport`) looks
adapter-generic — it templates `${adapter}.<verb>` — but `<verb>` is hardcoded to
chrome-devtools-mcp tool names (`take_snapshot`, `list_pages`, `select_page`). Every
other engine uses different names (`browser_snapshot`, etc.). So the `${adapter}` template
gives the *illusion* of swappability while assuming one engine's vocabulary. This is
exactly the ADR 0012 "false capability claim" risk made physical: the registry lists
`playwright-cdp` with a full manifest, but the transport cannot reach it.

Proof: `prototype-playwright-codec-fit/` (pure-logic seam map; playwright fits 0/6 seams).

## Finding 2 — a two-axis mapping fixes it, and scales sub-linearly

The fix is a per-engine mapping with TWO independent axes:

- **Ref FORMAT is engine-lineage-bound:** both Chrome transports emit `uid=` and parse
  with one parser; all three Playwright/Chromium adapters emit `[ref=]` and parse with
  one parser. **2 parsers cover 5 adapters.**
- **Dispatch SHAPE is transport-bound:** the same 2 formats fan out to 5 distinct click
  dispatches.

These are independent — playwright-mcp and playwright-cli share a ref format but differ
in dispatch. A flat rename table cannot express "2 formats × 5 dispatches"; the proven
design is an **engine-origin-tagged ref** + parser-per-format + dispatch-per-transport.
Adding an engine in an existing lineage = 0 new parsers + 1 dispatch fn.

Proof: `prototype-playwright-vocab-map/{vocab-map,ref-normalizer}.ts`;
`N5-MATRIX-NOTES.md`. One facade `clickByName("Learn more")` landed a live click on all 5.

## Finding 3 — swappability dividends, measured live

### Cost-routing — real, but cost must be MEASURED not inferred
Snapshot-op latency (median, warm/local bins):

| adapter | warm med-ms | payload bytes |
|---|---|---|
| N4 playwright-cli | **40** (fastest) | 1011 |
| N1 chrome MCP | 122 | 366 |
| N3 agent-browser | 199 | 74 |
| N2 playwright MCP | 228 | 1010 |
| N5 chrome CLI | 304 | 362 |

Optimizing invocation (local bin vs npx cold-start) FLIPPED the leaderboard — cold, CLIs
looked 6× slower; warm, a CLI is fastest. **Transport kind does NOT predict latency;
invocation model does.** Cost-routing is viable only with an empirical cost table.
Payload spans 14× (agent-browser `-i` = 74b vs playwright = 1010b) → token-cost tiering.

### Differential oracle — caught real divergence (and it is NOT the LLM)
On a rich page (Wikipedia "Web browser"): 24 interactive elements all 5 engines agreed
on, then N4 uniquely surfaced ~14 (the Authority-control navbox + hatnotes) the other
four snapshots truncated. The oracle is a **mechanical diff** (Set comparison), not model
judgment — the LLM consumes its verdict. A single-engine LLM driving chrome-MCP would
silently miss those 14 links and report "not found," wrong, with no signal. N independent
ground-truth sources diffed in code is what surfaces the gap.

### Graceful degradation — 4-stage live kill test
Ordered preference, fall through on failure, report `servedBy` + depth:
1. all healthy → served by preferred (depth 0)
2. preferred genuinely killed → fell through, task completed (depth 1)
3. top 4 down → cascaded to N5, task completed (depth 4)
4. all 5 down → failed HONESTLY ("pool exhausted"), no hang, no false success

A 5-engine pool is 4-deep fault-tolerant; total outage fails loud.

Proof: `prototype-playwright-vocab-map/{run-metrics,run-degrade,run-5way}.ts`,
`DIVIDENDS-NOTES.md`.

## Finding 4 — real gaps the live runs exposed (became required sub-tasks)

- **Schema drift:** `@playwright/mcp@0.0.76` `browser_click` wants `{target:"<ref>"}`, not
  the documented `{ref, element}` — a hand-copied mapping would have been wrong. Argues
  for live capability-probe over static tables (ADR 0012 "static matrix drifts," shown).
- **Ref staleness is per-engine:** MCP refs go stale on navigation and fail silently;
  agent-browser re-resolves. "Is this ref still live?" belongs in a facade verify layer.
- **Redaction non-optional:** every engine's raw snapshot leaked real authenticated tab
  URLs. One facade-level redaction boundary required.
- **Glyph/artifact refs:** snapshots include decorative refs (`"`, `^`, single chars);
  the normalizer must filter non-actionable refs.
- **mcporter self-heals:** `mcporter daemon stop` is not a real outage (auto-restarts on
  next call) — a resilience plus, but fallback logic needs genuine-failure testing.
- **N5 connection model UNRESOLVED:** the chrome-devtools CLI daemon started
  `--headless --isolated`; whether it drives warm Chrome or its own context is unconfirmed.

## Status

Prototypes are throwaway (`run-*way.ts`, `run-metrics.ts`, `run-degrade.ts`). The keepers
seed production: `ref-normalizer.ts` + `vocab-map.ts` → the mapping layer. Verdict: the
facade dream is proven at N=5; build it per the requirements doc.
