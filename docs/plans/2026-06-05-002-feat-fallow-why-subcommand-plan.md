# Fallow Runner: `why` Subcommand (item 2 promotion)

Status: plan for approval. Owner: fallow skill. Source: spike in `skills/fallow/scripts/prototype-why-symbol/` (mcporter transport decided), plan item 2 in `2026-06-05-001-feat-fallow-agent-actionability-plan.md`.

## Goal

Add a `why <file> <export>` runner subcommand that resolves a flagged-but-maybe-used export to a verdict (`false-positive` / `likely-dead` / `entry-point`) using the `fallow-mcp` `trace_export` tool via `mcporter`. This is the deterministic false-positive resolver the CLI cannot provide (trace family is MCP-only, confirmed live).

## What makes `why` different from existing subcommands

- Takes **positional args** (`<file> <export>`); every existing command takes only flags.
- Calls **MCP (`mcporter call fallow-mcp.trace_export`)**, not the Fallow CLI.
- Returns a **verdict over one symbol**, not a findings list — does not fit `isEvidenceCommand`/`isWriteCommand`.
- New failure modes: symbol-not-found (tool-level) and transport-unreachable (mcporter offline).

## Transport reuse decision

`browser-use/scripts/mcporter-transport.ts` is in the SAME repo (claude-code-config) and is ~80% generic: `resolveMcporterCommandVector`, `runMcporter`, `spawnMcporterCommand`, missing-command + timeout handling are surface-neutral. The browser-use-specific parts are only the env var name (`BROWSER_USE_MCPORTER_COMMAND_JSON`) and hint wording.

Decision (for confirmation): **do NOT cross-import browser-use into fallow** (couples two skills' deploy units; browser-use's transport carries a Chrome-DevTools parity checklist irrelevant to fallow). Instead create a small fallow-owned `why-trace.ts` that mirrors the same command-vector contract shape with a fallow env var (`FALLOW_MCPORTER_COMMAND_JSON`). The shared *pattern* is the contract, not the file. If a third consumer appears, promote a genuine shared package then.

Alternative if you prefer DRY over decoupling: extract a neutral `mcporter-transport` into a shared location both skills import. Larger change; defer unless you want it now.

## Files and changes

### 1. `skills/fallow/scripts/why-trace.ts` (new — the keeper)
Lift from the spike, fallow-owned:
- `traceExportViaMcporter({root, file, exportName, mcporterCommand?, timeoutMs?})` — builds the `mcporter call --stdio fallow-mcp --tool trace_export --cwd <root> --output json --args <json>` argv; runs it; parses.
- `resolveMcporterCommand(env)` — `FALLOW_MCPORTER_COMMAND_JSON` JSON-array override, default `["mcporter"]` (now on PATH via brew; `["bunx","mcporter"]` fallback documented).
- `deriveVerdict(evidence)` / `explainVerdict(evidence)` — pure verdict logic from the spike.
- Error classes: `SymbolNotFoundError` (tool-level), `TraceTransportError` (mcporter offline / spawn / timeout).
- Types: `TraceExportEvidence`, `WhyVerdict`.
- No terminal code; pure over inputs so the runner can unit-test it with an injected command runner.

### 2. `skills/fallow/scripts/command-contract.ts`
- Add `"why"` to `FALLOW_RUNNER_COMMANDS`.
- Add a `why` entry to `fallowRunnerContracts`:
  - `script`, `summary: "Trace why an export is flagged and whether it is used."`
  - `usage: ["why <file> <export> [--root <repo>] [--plain] [--max-output-bytes <bytes>]"]`
  - `audience: "agent"`, `mutation: "diagnostic"`, `sideEffects: ["check"]`, `executionModes: ["check"]`, `interactivity: "none"`, `outputModes: ["json","plain"]`, `resultContract`, `exitCodes`.
  - positional args declared per the facade contract's positional mechanism (confirm the facade supports positionals; if not, accept `--file`/`--export` flags instead — decide during build).
  - failure affordances: reuse `fallowFailureActions` plus consider a `symbol-not-found` note (may map to existing `fix-input`).

### 3. `skills/fallow/scripts/fallow-runner.ts`
- Parse positional `<file> <export>` for `why` in the arg parser (`ParsedCommand` gains optional `file`/`exportName`).
- New branch in `runParsedCommand` before the evidence/write branches: readiness check (root + git optional; fallow binary not required, but `mcporter`/`fallow-mcp` reachability is), then call `why-trace.ts`, map to an envelope:
  - success -> `status: "issues"` when verdict is `likely-dead`, `status: "ok"` when `false-positive`/`entry-point`; `mode_evidence` carries `{verdict, reason, is_used, file_reachable, is_entry_point, direct_references}`.
  - `SymbolNotFoundError` -> `status: "blocked"`, `failure_category: "input"`, repair hint `fix-input`.
  - `TraceTransportError` -> `status: "blocked"`, `failure_category: "setup"`, repair hint `setup-fallow` (mcporter/fallow-mcp not reachable).
- Plain output: a one-line `why <export> verdict=<v> used=<bool> refs=<n>` plus the explanation; `next_action` reflects verdict.
- `fallowArgsFor` is CLI-arg only; `why` bypasses it (different transport). Keep that seam clean.

### 4. Tests `skills/fallow/scripts/fallow-runner.test.ts`
- Inject a fake command runner (no live mcporter) returning the three captured shapes:
  - success evidence (`is_used:true` + refs) -> verdict false-positive, status ok.
  - dead evidence (`is_used:false`, 0 refs) -> verdict likely-dead, status issues.
  - `{error:true, message}` -> SymbolNotFound -> blocked/input/fix-input.
  - `{error:"…ENOENT", issue:{kind:"offline"}}` -> transport -> blocked/setup/setup-fallow.
- Positional parsing: `why` with missing `<export>` -> usage error (exit 2).
- Plain output assertion for the verdict line.
- U10 doc-drift guards: keep `next_action=` out of SKILL.md; route-index test additions if a `why` route bullet is added.

### 5. Docs
- SKILL.md route index: add a `Why / false-positive check` route bullet (no runner-output literals).
- `references/commands.md`: add `why` to the mode map.
- `references/workflows.md`: note `why <file> <export>` as the deterministic resolver that supersedes manual coverage-intersect for a single suspected export.
- Delete `skills/fallow/scripts/prototype-why-symbol/` after the keeper logic lands.

## Open decisions to confirm before building

1. Transport: fallow-owned `why-trace.ts` (decouple) vs extract a shared mcporter util (DRY). Plan assumes decouple.
2. Positional args vs `--file`/`--export` flags — depends on whether `@side-quest/cli-command-facade` models positionals. Verify first; fall back to flags.
3. `mcporter` invocation default: now on PATH via brew, so `["mcporter"]`. Keep `bunx` fallback documented in the override hint.
4. Verdict→status mapping: is `likely-dead` an `issues` status (actionable) or `ok` (just information)? Plan treats it as `issues`.

## Sequencing

1. Confirm facade positional support (decision 2).
2. `why-trace.ts` + unit tests (pure, injected runner).
3. Contract entry + runner branch + parser.
4. Runner tests (four shapes + usage error + plain).
5. Docs + delete prototype.
6. Full test file + typecheck green.

## Out of scope

- Pooling the mcporter/MCP session (one-shot per call is fine for v1).
- Wrapping other trace tools (`trace_dependency`/`trace_clone`) — separate items.
- Resolving a bare symbol name to its file (caller passes `<file> <export>`; symbol->file resolution deferred).
