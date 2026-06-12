# ref-normalizer — the Layer-2 click piece (3-way, proven live)

**Question:** can one facade-level `click(ref)` work regardless of which engine
produced the ref from `snapshot`? Built + proven against THREE live engines on warm
Chrome. Follows the vocab-map spike (Layer-1).

## VERDICT: YES — proven live across 3 engines, including a non-MCP one.

One intent — `clickByName("Learn more")` — landed a real click on example.com via:

| engine | transport | ref format (parsed) | click dispatch (emitted) | live result |
|---|---|---|---|---|
| chrome-devtools | mcporter / MCP | `uid=8_3` | `chrome-devtools.click {"uid":"8_3"}` | ✓ "Successfully clicked" |
| playwright-cdp | mcporter / MCP | `[ref=e6]` → `e6` | `playwright-cdp.browser_click {"target":"e6"}` | ✓ "Ran Playwright code" |
| agent-browser | **CLI / direct CDP** | `[ref=e2]` → `e2` | `agent-browser --cdp 9222 click @e2` | ✓ "Done" |

## Why the 3rd engine mattered (the user's instinct was right)

A 2-engine spike would have HIDDEN the hardest axis. The two MCP engines both pass the
ref as a JSON field, so a pair-only normalizer could have looked generic while secretly
assuming "ref goes in --args JSON." **agent-browser broke that assumption** — it's a CLI,
not an MCP server, and takes the ref as a positional `@e2` arg over a totally different
transport. The normalizer had to model TWO axes, and only 3 engines reveal both:

- **2 ref FORMATS:** `uid=N_N` (chrome-devtools) vs `[ref=eN]` (playwright + agent-browser share this).
- **3 dispatch SHAPES:** mcp-uid-field · mcp-target-field · cli-@positional.

Format and dispatch are independent — playwright and agent-browser share a ref format
but have different dispatch shapes. A flat "rename table" cannot capture that; you need
an origin-tagged ref + a per-engine dispatch function. That's the normalizer's core design.

## The design that worked (`ref-normalizer.ts`)

1. **`FacadeRef` carries its engine origin** — `{engine, raw, role, name}`. The ref is
   NOT a bare string; it knows who made it. This is the floor-verb ideation's
   "loud divergence, don't fake uniformity" made concrete: the ref advertises its
   vocabulary instead of pretending all refs are interchangeable.
2. **`parseSnapshot(engine, text)`** — one parser per ref FORMAT (2), not per engine (3).
3. **`dispatchClick(ref)`** — one dispatch per SHAPE (3). Switches on `ref.engine`.
4. **`clickByName(refs, name)`** — the engine-agnostic caller surface. Picks a ref by
   accessible NAME (which all 3 engines expose), dispatches by origin. This is the
   write-once-run-anywhere payoff, demonstrated.

## Real bugs the live run caught (why "verify, don't copy docs")

- **playwright schema drift:** docs/older versions show `browser_click({ref, element})`;
  `@playwright/mcp@0.0.76` actually wants `browser_click({target: "<ref>"})` — a STRING.
  The wrong shape failed with "expected string, received undefined at target." Caught
  only by executing live. This is ADR-0012's "static matrix drifts" warning, demonstrated:
  a hand-copied mapping WOULD have been wrong. The mapping must be verified against the
  live engine, which argues for the capability-probe ownership model over pure hand-craft.
- **ref staleness is per-engine and real:** the first 3-way run interleaved navigations;
  MCP refs (`uid=3_3`, `e6`) went stale when the page changed and clicks failed silently,
  while agent-browser's `@e2` re-resolved. Fix: snapshot→click must be one uninterrupted
  per-engine sequence; refs are invalid after the next navigation. This IS the
  postcondition-floor problem — "verify the ref is still live before/after acting" — and
  it differs per engine, so it belongs in the facade verify layer, not the codec.

## What this proves for the facade dream

The dream is now demonstrated end-to-end at **N=3**, across two transport kinds
(MCP-server and direct-CLI/CDP):

- Layer-1 vocab map (tool names): cheap, confirmed.
- Layer-2 ref-normalizer (click across ref models): **written and proven live**, ~120 lines.
- It generalizes beyond a pair — the non-MCP engine rode the same normalizer.
- Remaining real work, now precisely scoped:
  1. **ref staleness / verify** belongs in the facade verify layer (per-engine, postcondition-floor).
  2. **schema must be verified live, not copied** — argues for capability-probe ownership.
  3. **redaction** — agent-browser + playwright snapshots both leak real tab URLs in raw output.

## Status

Throwaway shells (`run-3way.ts`) deletable. **`ref-normalizer.ts` is the keeper** —
the proven Layer-2 design, liftable into the real per-adapter mapping layer alongside
`vocab-map.ts` (Layer-1). Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-3way.ts
