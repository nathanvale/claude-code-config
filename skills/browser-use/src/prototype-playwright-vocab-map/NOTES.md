# Spike 2 verdict — vocab-map (does a mapping table make the dream real?)

**Question:** Spike 1 proved the transport hardcodes chrome-devtools' tool
vocabulary. Does a per-engine Layer-1 name/arg **mapping table** make a second
engine's snapshot reachable, and how bad is the Layer-2 ref-shape diff?

Follows `../prototype-playwright-codec-fit/NOTES.md`. Seeded from
`docs/brainstorms/2026-06-12-browser-facade-playwright-spike-requirements.md`.

## VERDICT (UPDATED — now PROVEN LIVE at N=2): mapping-table direction CONFIRMED end-to-end.

**Update 2026-06-12, second run:** playwright-cdp registered as a configured mcporter
server in `~/.claude.json` (sibling to chrome-devtools, `@playwright/mcp --cdp-endpoint
http://127.0.0.1:9222`), daemon adopted it via `mcporter daemon restart`. The live diff
then ran BOTH halves green:

```
                    chrome-devtools        playwright-cdp
snapshot reachable  ✓ take_snapshot        ✓ browser_snapshot   (Layer-1 map resolved both)
ref style           uid= (a11y tree)       [ref=] (playwright)  (DIFFERENT models — live)
size                361b / 7 lines         1010b / 18 lines     (~3x, same ~5 elements)
```

- Half 1 (Layer-1 map makes 2nd engine reachable): **YES, live.**
- Half 2 (cross-engine diff produces signal): **YES, live** — uid= vs [ref=] is real, not predicted.
- The earlier "blocked by daemon quirk" was just an unregistered ad-hoc stdio server.
  Registering + `daemon restart` fixed it; the spike no longer uses `--stdio`.

**SAFETY FINDING:** playwright's `browser_snapshot` raw output included an "Open tabs"
list with real authenticated URLs (Monash/Ellucian). The production playwright adapter
needs the SAME redaction boundary chrome-devtools' path has. Real input to the adapter work.

---
### Original (pre-live) verdict below — superseded by the live run above but kept for the journey.

## VERDICT: the mapping-table direction is CONFIRMED. Layer-1 is cheap. Layer-2 is the real work (as predicted).

### Half 1 — does the Layer-1 map make snapshot reachable? → YES (proven for the reference; mechanically trivial for playwright)

- The resolver in `vocab-map.ts` is ~10 lines: `resolve(map, verb, intent) ->
  {tool, args}`. It is exactly what `runOperationTransport` should consult instead
  of hardcoding `${adapter}.take_snapshot`.
- **Live proof:** the harness drove `navigate → snapshot` through chrome-devtools
  via the map, through the REAL mcporter transport, against the live warm Chrome
  (Chrome 149, 127.0.0.1:9222). Result: reachable ✓, 361b / 7 lines, `uid=` a11y
  refs. The map layer works end-to-end with zero machinery edits to the transport
  shape — it just supplies the tool name.
- The playwright row in the map (`browser_snapshot`, `browser_navigate`, with
  `--cdp-endpoint http://127.0.0.1:9222`) is the whole "hand-crafted table" — ~12
  lines of data. Writing it was trivial. **Layer-1 is as cheap as the dream hoped.**

### Half 2 — does the cross-engine diff produce signal? → PARTIAL: signal characterized, live playwright run blocked by a transport-mode quirk (not architecture)

- chrome-devtools snapshot ran live: `uid=` ref style (a11y tree).
- playwright snapshot did NOT run live: `mcporter call --stdio` (ad-hoc stdio
  server) fails with "Server 'playwright' is not managed by the daemon." This is a
  **mcporter daemon-mode quirk**, not an architectural blocker — the real fix is to
  register playwright as a configured mcporter server (the same way chrome-devtools
  is registered), which mutates global config and was out of scope for a throwaway
  spike. Stopped per the 2-attempt rabbit-hole rule rather than chase it or mutate
  the user's config.
- **The diff signal is nonetheless known with high confidence** from both engines'
  documented snapshot formats and spike-1's seam map:
  - chrome-devtools: `uid=`-style refs in an a11y-tree text block.
  - playwright: `[ref=...]`-style refs in a YAML-ish accessibility snapshot.
  - **DIFFERENT ref models.** A `click` consuming a ref from `snapshot` must know
    which model produced it. This is the Layer-2 work: a per-engine ref normalizer,
    OR refs that carry their engine origin so `click` dispatches correctly.

## What this confirms for the facade dream

**The dream is real and the path is now concrete — with the cost honestly split:**

1. **Layer-1 (name/arg map): cheap, confirmed.** A flat per-engine table + a ~10-line
   resolver. Unblocks navigate/snapshot/screenshot renames. This is the "just a
   mapping table" intuition, and it holds.

2. **Layer-2 (ref-shape + absent verbs): the actual design work, also bounded.**
   - `snapshot` refs differ in model (uid vs [ref=]) → need a normalizer or
     origin-tagged refs so `click` consumes them correctly. This IS the
     postcondition-floor / "loud divergence" answer from the floor-verb ideation —
     not new work, the same work, now with a concrete shape.
   - `list_pages`/`select_page` absent in playwright-mcp → declare them non-floor
     for that engine (the `absent: []` field models this). Don't fake them.

3. **Warm Chrome shared precondition: holds.** `@playwright/mcp --cdp-endpoint`
   targets the same loopback CDP; chrome-devtools already proven live on it.

## The honest scaling caveat (answers "just hand-craft a table for each engine")

Hand-crafting Layer-1 per engine is genuinely cheap and fine for 3-4 engines. The
cost that scales is **Layer-2 ref normalization** — each engine with a different ref
model needs a normalizer, and that's code, not a table row. The ownership decision
(hand-crafted vs live-probe) was deliberately deferred until this spike measured the
pain. Measured pain: Layer-1 trivial, Layer-2 = one normalizer per distinct ref
model (not per engine — engines sharing a ref model share a normalizer). That's the
input to the ownership decision.

## Next cheap step (if continuing)

Register playwright as a configured mcporter server (one config entry, mirrors
chrome-devtools) and re-run `run.ts` to get the live playwright snapshot + the real
ref-shape diff. That converts Half 2 from "known by docs" to "proven live" — and
gives the first real Layer-2 normalizer to write against actual output.

## Status

Throwaway. `vocab-map.ts` (the table + resolver) is the keeper — it's the proposed
fix in miniature and seeds the real per-adapter mapping layer. `run.ts` is the
disposable harness. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run.ts https://example.com
