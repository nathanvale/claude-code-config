# Spike verdict — playwright codec-fit

**Question:** Is the browser-use facade dream worth pursuing? Test it cheaply by
making N=2 — add playwright as a second engine — and read two things: (1) is the
codec cheap (rides existing Router/proof/transport seams)? (2) does a cross-engine
diff produce signal? Full requirements:
`docs/brainstorms/2026-06-12-browser-facade-playwright-spike-requirements.md`.

## VERDICT: not-validated-at-this-scope — but the finding is gold

The spike did its job by **failing the way that teaches the most**. It did not need
a running browser to produce the answer: mapping the real seams + the two engines'
actual tool vocabularies was enough, and that itself is the finding.

### Half 1 — "is the codec cheap?" → NO. Decisively.

`computeFit` over the real seams (file:line in `codec-fit.ts`):

| engine | fits | machinery edits | blocked | codec cheap? |
|---|---|---|---|---|
| chrome-devtools | 6/6 | 0 | 0 | YES (it's the reference) |
| playwright-cdp | **0/6** | 4 | 2 | **NO** |

The playwright codec rides **zero** existing seams. To make it work you must edit
the machinery in at least 6 places:

- `proof-gate` — playwright not in `BROWSER_ADAPTER_PROOF_ADAPTERS` (command-contract.ts:31); fails closed (browser-use-discovery.ts:552).
- `proof-impl` — no `provePlaywrightCdp()` case in the `executeAdapterProof` switch (preflight-browser-adapter.ts:670).
- `discover` — machinery emits `${adapter}.list_pages`; @playwright/mcp has **no `list_pages` tool** (BLOCKED).
- `select` — machinery emits `${adapter}.select_page`; @playwright/mcp has **no `select_page`** (single-context model; BLOCKED).
- `snapshot` — machinery emits `${adapter}.take_snapshot`; @playwright/mcp's tool is `browser_snapshot` (rename → but there's no per-adapter rename hook, so it's a machinery edit) and the ref shape differs.
- `click` — refs come from snapshot; playwright auto-waits actionability, chrome-devtools is fire-and-forget. Shape + behavior mismatch.

### The root cause (the real finding)

**The transport seam is not engine-generic — it is chrome-devtools-MCP-vocabulary-generic.**

`runOperationTransport` looks generic because it templates `${input.adapter}.<verb>`
(browser-use-operations.ts:819-844). But the `<verb>` part is hardcoded to
chrome-devtools-mcp's exact tool names (`take_snapshot`, `list_pages`, `select_page`,
`emulate`). Any engine whose MCP server uses different tool names — i.e. **every other
engine**, including the official `@playwright/mcp` (`browser_*` names) — cannot slot
in. The `${adapter}` template gives the *illusion* of swappability while the verb
vocabulary silently assumes one engine.

This is the **postcondition-floor problem made physical**: the facade fakes uniformity
by assuming chrome-devtools' tool names ARE the floor. It's exactly what ADR 0012
warned about ("universal browser API ... makes false capability claims likely") — the
registry/manifest layer claims playwright-cdp is a known adapter (it's listed, it has a
full 11-capability manifest at 85-90% confidence), but the transport can't actually
reach it. The capability claim is false in precisely the way ADR 0012 predicted.

### Half 2 — "does the diff produce signal?" → couldn't reach it, and that's the answer

The cross-engine diff was supposed to run `navigate→snapshot` through both engines.
We never got to run it, because **the snapshot verb is blocked at the transport seam
for playwright** (different tool name + different ref shape). You cannot diff two
engines' snapshots when the facade can't invoke one of them. The diff being
unreachable IS the signal: swappability isn't real at the current transport layer, so
the dividend that depends on it can't exist yet.

### Warm Chrome note (good news)

`@playwright/mcp` ships `--cdp-endpoint`, so it CAN attach to the verified warm
loopback CDP — the Warm-Chrome-as-shared-precondition idea survives. The blocker is
purely the vocabulary/tool-name seam, not the connection model. That's encouraging
for the dream: the hard infra part (shared warm session) works; the part that needs
design is the verb-vocabulary translation layer.

## What this means for the facade dream

**The dream is still worth pursuing — but the spike relocated the real work.**

The contract that matters is NOT "floor verbs + capability tiers" in the abstract.
It's a **per-adapter verb-vocabulary mapping layer** (engine verb name + arg shape +
ref model ↔ facade floor verb). Today that mapping is implicit and hardcoded to one
engine. The facade can't be a facade over *engines* until it's a facade over
*vocabularies*. That is the postcondition-floor work made concrete: the floor verb
`snapshot` must map to `take_snapshot` on one engine and `browser_snapshot` on
another, normalizing the ref shape, with the divergence surfaced (not faked).

**Recommended next move:** before any more contract design, the genuinely cheap spike
is a **vocabulary-mapping shim** — a tiny per-adapter table {floorVerb → {toolName,
argShape, refAdapter}} that `runOperationTransport` consults instead of hardcoding
chrome-devtools names. If THAT shim makes playwright's snapshot reachable in <1 day,
the dream's transport story is real and the diff dividend becomes testable. If the ref
shapes are too different to normalize cheaply, that's the next honest kill-check.

## Status of this prototype

Throwaway. The `codec-fit.ts` seam map is the keeper — it documents exactly what a
second engine must satisfy, with file:line citations, and can seed the real
vocabulary-mapping design. Delete `prototype.ts` (the TUI shell) once the verdict is
absorbed. Re-run the TUI any time with:

    bun skills/browser-use/src/prototype-playwright-codec-fit/prototype.ts
