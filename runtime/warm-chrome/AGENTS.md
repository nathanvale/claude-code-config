# Warm Chrome Agent Guide

`@side-quest/warm-chrome` owns Warm Chrome readiness proof: `check`, `status`
(alias), `launch`, `repair` over the cli-command-facade runtime contract with
package-owned exit code `20` (browser-entry failure).

This file routes maintainers. `README.md` explains the tool to humans.

## Hard rules

- The ok envelope is the only endpoint authority; never teach a consumer to
  derive the endpoint from the `9222` convention — a convention-trusting
  adapter attaches to a foreign listener after a rerun on another port (R8).
- One station = one canonical error code = one primary action; fine-grained
  cause lives in the machine-readable `reason` detail. Drift gate:
  `tests/catalog.test.ts`.
- Never terminate a listener the proof did not verify as Warm Chrome. Negative
  test: `tests/repair-stations.test.ts` R11 foreign-listener case.
- Foreign-listener diagnostics carry pid + process basename only. Leak gate:
  `tests/redaction.test.ts`.
- `skills/browser-use/src/preflight-warm-chrome.ts` stays authoritative and
  unmodified until the deferred parity switchover. Parity gate:
  `tests/parity.test.ts`.

## Owners

`ARCHITECTURE.md` Module Map is the single per-module owner list; the
docs-drift gate (`tests/docs-drift.test.ts`) fails when a `src` module and that
map disagree. Read it there.

## Front door

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
```
