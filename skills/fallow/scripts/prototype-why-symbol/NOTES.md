# Prototype: `why <symbol>` via fallow-mcp trace_export

Throwaway spike for item 2 in `docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md`.

## Question

Can a Bun/TS script do the `fallow-mcp` JSON-RPC handshake and call `trace_export`, and is the returned reachability evidence genuinely useful for resolving a flagged-but-actually-used export?

## Answer: YES — build it.

The handshake works first try (stdio, protocol `2024-11-05`, fallow 2.88.2). `trace_export` returns deterministic evidence that cleanly separates false positives from genuinely-dead exports — the exact judgment that took a manual coverage-intersect earlier this session.

Validated against 4 real exports Fallow flags `remove-export` on in `browser-use/scripts`:

| symbol | verdict | evidence |
|---|---|---|
| `createDefaultBrowserUseRuntime` | false-positive | `is_used=true`, imported by `browser-use.test.ts` |
| `runBrowserUseCli` | likely-dead | `is_used=false`, 0 refs |
| `browserUseContracts` | false-positive | `is_used=true`, 2 importers (test + entry) |
| `createRouterEngine` | error | symbol not found (see gotcha 3) |

`is_used: true` + `direct_references[]` = "flagged but referenced, do not remove." That is the resolver.

## Confirmed shapes

- `trace_export` args: `{ root, file, export_name }`. `file` is root-relative; `export_name` required (a bare symbol is not enough — resolve symbol→file from the finding first).
- Success payload (inside `result.content[0].text` as a JSON string):
  `{ file, export_name, file_reachable, is_entry_point, is_used, direct_references[{from_file, kind}], re_export_chains[] }`.
- Verdict derivation that worked: `is_entry_point` → keep; `is_used` → false-positive; `!file_reachable && !is_used` → likely-dead.

## Gotchas for the runner (all confirmed live)

1. **Two-layer JSON.** The tool result is a JSON string nested inside the MCP `content[0].text` field. Parse twice.
2. **MCP-only, no CLI fallback.** There is no `fallow trace ...` command. The runner must own a stdio MCP client (spawn `fallow-mcp`, initialize → notifications/initialized → tools/call). One-shot session is fine; a real runner could pool it.
3. **Missing symbol = tool-level error object, NOT a JSON-RPC error.** Returns `{ error: true, message, exit_code: 2 }` inside the content text. Detect this shape (see `SymbolNotFoundError` in `trace-client.ts`); do not assume evidence fields are always present.
4. Trust schema key names `file_reachable` / `is_entry_point`. (Recon noted sibling `is_reachable` / `entry_point` can be null.)

## Transport decision: use mcporter, not the hand-rolled stdio client

A second spike (`trace-client-mcporter.ts`) tested the house transport — `mcporter`,
the same MCP-client runner `browser-use/scripts/mcporter-transport.ts` already uses —
against the hand-rolled JSON-RPC client. **mcporter wins. Build on it.**

`mcporter call --stdio fallow-mcp --tool trace_export --cwd <root> --output json --args '<json>'`
returns identical verdicts across all 4 symbols, and:

- Does the full initialize/notify/call handshake — no protocol code to own.
- **Unwraps the two-layer content JSON automatically** — gotcha #1 disappears; the payload is the parsed evidence directly.
- **Separates failure layers**: tool-level (`{error:true, message}` — symbol not found) vs transport-level (`{error:"…ENOENT", issue:{kind:"offline"}}` — server unreachable). The hand-rolled client conflated these.
- ~40% the code; owns no MCP plumbing.

Trade-off: mcporter is not on PATH; it runs via `bunx mcporter` (or the
`BROWSER_USE_MCPORTER_COMMAND_JSON`-style override the house transport already models).
First `bunx` run resolves the package (cached after). The runner should reuse the
existing mcporter command-vector contract from `mcporter-transport.ts`, not invent a new one.

Gotcha 1 (two-layer JSON) is now mcporter's problem, not ours. Gotchas 2–4 still hold,
but 2 (no CLI fallback) is satisfied by mcporter rather than a bespoke client.

## Files

- `trace-client.ts` — hand-rolled stdio client + verdict derivation (`deriveVerdict`, `explainVerdict`, `SymbolNotFoundError`). The **verdict logic is the keeper**; the stdio plumbing is superseded by mcporter.
- `trace-client-mcporter.ts` — **the transport keeper**. Thin mcporter-backed client. Lift its call shape into the runner, reusing `mcporter-transport.ts` semantics.
- `tui.ts` — throwaway shell. Run `bun run prototype-why-symbol/tui.ts` from `skills/fallow/scripts/` (needs a TTY; `t` trace selected, `a` trace all, `j/k` move, `q` quit). Currently wired to the hand-rolled client.

## Next

Build the runner `why <file> <export>` subcommand from:
- `trace-client-mcporter.ts` call shape (transport) + the shared `mcporter-transport.ts` command-vector contract.
- `deriveVerdict` / `explainVerdict` (verdict logic) from `trace-client.ts`.
- Both error classes (`SymbolNotFoundError` tool-level, `TraceTransportError` transport-level) mapped onto the runner's failure taxonomy.

Then delete this folder.
