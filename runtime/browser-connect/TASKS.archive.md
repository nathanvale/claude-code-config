# Browser Connect Tasks Archive

Closed detail and long review rationale for
`runtime/browser-connect/TASKS.md`. Keep active choices in `TASKS.md`; use
this file when history matters.

## Closed Implementation Units

- 2026-07-14 U1 package scaffold closed: `@side-quest/browser-connect` lives
  at `runtime/browser-connect`, source-linked bin `browser-connect`, facade
  and warm-chrome workspace dependencies, typecheck, maintainer doc set, and
  workspace-gate compliance.
- 2026-07-14 U2 envelope model closed: schema, failure classes, affordance
  catalog, redaction chokepoint (`src/model.ts`).
- 2026-07-14 U3 command contract + Branch Station catalog closed: facade
  contract for dashboard/check/connect/run and the authoritative 19 stations
  (`src/command-contract.ts`, `src/branch-station-catalog.ts`).
- 2026-07-14 U4 environment gateway closed: warm-chrome in-process
  prove-or-launch with exhaustive reason→failure-class mapping and the
  diagnostics-reconfigure hazard handled (`src/environment.ts`).
- 2026-07-14 U5 adapter registry closed: two Adapter Definitions
  (chrome-devtools-mcp, agent-browser), route capabilities, pure
  compatibility (`src/adapters/*`, `src/compatibility.ts`).
- 2026-07-14 U6 check/connect/dashboard closed: facade dispatcher, stateless
  dashboard projection, decision-complete envelope (`src/cli.ts`,
  `src/dashboard.ts`).
- 2026-07-14 U7 run wrapper closed: `--` split, stderr-pre-exec envelope,
  endpoint injection, spawn-and-wait passthrough (`src/run-exec.ts`).
- 2026-07-14 U8 catalog-driven integration proof closed: 7 stations real
  process spawns (incl. foreign-listener via `WARM_CHROME_CDP_PORT` + fixture
  server), 12 skipped-with-rationale; root `command-entrypoint:integration`
  registration.
- 2026-07-14 U9 adoption pointers + decision log closed: browser-use owner
  line, CONTEXT-MAP registration, glossary reconciliation, decision log, and
  the `rules/browser-access.md` retirement follow-up (#230).
- 2026-07-14 fix: `parseWarmChromeEnvelope` now parses warm-chrome's
  multi-line pretty JSON (was last-line only); surfaced by U8's process
  boundary proof.
- 2026-07-27 Platform U5 third adapter closed (closeout plan R2/R8/AE3):
  `playwright-cdp`, the public Playwright CLI lane, added to the registry
  (`src/adapters/playwright-cdp.ts`, `src/adapters/registry.ts`). Explicit-CDP
  named-session attach/snapshot/detach; probe pins the `attach`/`detach`
  `--help` contract (fail-closed on upstream CLI drift, no implicit browser
  launch, no Chrome for Testing, no `open`/`install-browser`); isolated-install
  policy operator-owned (exact lock pulls optional fsevents install script,
  R29). Committed integrity source in `adapter-install/playwright-cdp/`
  (git-tracked KTD17 guard). Proofs: `tests/playwright-cdp.test.ts` (unit,
  fake runtime) and `tests/playwright-cdp.integration.test.ts` (process
  boundary — real transport + real fake-CLI subprocess through
  `spawnAdapterCommand`, fixture Warm Chrome, browser left alive). Full suite
  green (549 tests), tsc clean.
