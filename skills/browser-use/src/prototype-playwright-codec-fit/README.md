# prototype-playwright-codec-fit (THROWAWAY)

Spike answering: **does a second browser engine (playwright) ride the browser-use
facade's existing transport seams, or does the seam secretly assume chrome-devtools'
MCP vocabulary?**

Seeded from `docs/brainstorms/2026-06-12-browser-facade-playwright-spike-requirements.md`.

## Run

    bun skills/browser-use/src/prototype-playwright-codec-fit/prototype.ts

`[tab]` switch engine · `[↑/↓ or j/k]` walk seams · `[q]` quit.
Watch the verdict flip between chrome-devtools (6/6, codec cheap) and
playwright-cdp (0/6, 4 machinery edits + 2 blocked).

## Files

- `codec-fit.ts` — **the keeper.** Pure module: the real seams the machinery demands
  (with file:line), what each engine offers, and the fit computation. Liftable into
  the real vocabulary-mapping design.
- `prototype.ts` — throwaway TUI shell. Delete once the verdict is absorbed.
- `NOTES.md` — the verdict and what it means for the facade dream.

## TL;DR verdict

Not-validated-at-this-scope. The transport is chrome-devtools-vocabulary-generic, not
engine-generic — playwright fits 0/6 seams. The real next spike is a per-adapter
verb-vocabulary mapping shim. Warm-Chrome-as-shared-precondition survives
(`@playwright/mcp --cdp-endpoint` works). See `NOTES.md`.
