# N=5 — the facade dream, proven live across 5 adapters & 2 transport kinds

One facade intent — `clickByName("Learn more")` — landed a REAL click on all five.

## The matrix (live result)

| # | adapter | engine | transport | ref format (parsed) | dispatch shape (emitted) | live |
|---|---|---|---|---|---|---|
| N1 | chrome-devtools | Chrome | MCP server | `uid=10_3` | `mcporter chrome-devtools.click {"uid":...}` | ✓ |
| N2 | playwright-cdp | Playwright | MCP server | `[ref=]→e6` | `mcporter playwright-cdp.browser_click {"target":"e6"}` | ✓ |
| N3 | agent-browser | Chromium | CLI / direct CDP | `[ref=]→e2` | `agent-browser click @e2` | ✓ |
| N4 | playwright-cli | Playwright | CLI / direct CDP | `[ref=]→e6` | `playwright-cli --s=default click e6` | ✓ |
| N5 | chrome-devtools-cli | Chrome | CLI / direct CDP | `uid=2_3` | `chrome-devtools click 2_3` | ✓ |

N4 = `@playwright/cli` ("run playwright mcp commands from terminal").
N5 = `chrome-devtools` CLI from chrome-devtools-mcp@1.2.0 — Chrome's DevTools-for-Agents
1.0 release, the same thing the very first research turned up. Full circle.

## The thesis the 5-way matrix proved (couldn't be shown with fewer)

**Ref-format and dispatch-shape are INDEPENDENT axes.** Each engine appears via two
transports; the run confirmed:

- **Format is ENGINE-bound, not transport-bound:** both Chrome transports (MCP + CLI)
  emit `uid=` and parse with the SAME parser. All three Playwright-lineage adapters
  (MCP, CLI, agent-browser) emit `[ref=]` and parse with the same parser. → only
  **2 parsers** cover **5 adapters**.
- **Dispatch is TRANSPORT-bound:** the same 2 ref formats fan out to **5 distinct
  dispatch shapes** (mcp-uid-json, mcp-target-json, cli-@ref, cli-positional-ref,
  cli-positional-uid).

A flat rename table cannot express "2 formats × 5 dispatches." The proven design —
**origin-tagged FacadeRef + (parser per format) + (dispatch per transport)** — is the
minimal thing that does. This is exactly the floor-verb ideation's "loud divergence,
don't fake uniformity" answer, now validated at N=5.

## What the scaling actually looks like (answers "hand-craft a table per engine")

Adding an adapter costs, at most:
- **0 new parsers** if it shares a ref format (N4 and N5 added zero — reused existing parsers).
- **1 dispatch function** (~6 lines) for its transport shape.
- **1 snapshot mapping** (Layer-1 vocab row) in the harness.

So the cost is sub-linear: ref-format work amortizes across an engine LINEAGE, only
dispatch is per-adapter. The dream scales better than "a table per engine" — it's
"a parser per lineage + a dispatch per transport."

## Real findings from the N4/N5 wiring (the honest part)

- **N5 chrome-devtools CLI runs its OWN daemon** (`chrome-devtools start --browserUrl`),
  separate from our mcporter-managed chrome-devtools-mcp. Its start args showed
  `--headless --isolated` — i.e. the CLI may spin its own context rather than honoring
  the warm-Chrome invariant the way the MCP does. **Flag for the real adapter:** verify
  N5 actually drives warm Chrome vs an isolated headless instance. (Snapshots returned
  valid refs and clicks landed, but the warm-session guarantee is unconfirmed for N5.)
- **N4 playwright-cli uses a named session** (`attach --cdp` → `--s=default`); the attach
  is a one-time setup the adapter must own, not a per-call cost.
- **Two daemons + mcporter + agent-browser now coexist** against one warm Chrome on 9222
  — the shared-precondition idea holds across 5 adapters and 2 transport kinds.
- npx-per-call (N4/N5) is slow; a real adapter would resolve the bin once. Spike kept npx
  for zero-install reproducibility.

## Status

The dream is demonstrated at **N=5**. Remaining real work is unchanged in shape, now
precisely scoped by evidence:
1. **verify layer** — ref staleness + N5's warm-vs-isolated question are postcondition-floor concerns.
2. **mapping ownership** — schema drift (playwright `{target}` not `{ref,element}`) argues for live capability-probe over hand-copy.
3. **redaction** — every CLI/MCP snapshot leaked real tab URLs in raw output.

Keepers: `ref-normalizer.ts` (2 parsers + 5 dispatches), `vocab-map.ts` (Layer-1).
Throwaway: the `run-*way.ts` harnesses. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-5way.ts
