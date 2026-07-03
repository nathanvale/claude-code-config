# Warm Chrome Agent Guide

`@side-quest/warm-chrome` owns Warm Chrome readiness proof: `check`, `status`
(alias), `launch`, `repair` over the cli-command-facade runtime contract with
package-owned exit code `20` (browser-entry failure).

This file routes maintainers. `README.md` explains the tool to humans.

## Hard rules

- The ok envelope is the only endpoint authority; never teach a consumer to
  derive the endpoint from the `9222` convention.
- One station = one canonical error code = one primary action; fine-grained
  cause lives in the machine-readable `reason` detail.
- Never terminate a listener the proof did not verify as Warm Chrome.
- Foreign-listener diagnostics carry pid + process basename only.
- `skills/browser-use/src/preflight-warm-chrome.ts` stays authoritative and
  unmodified until the deferred parity switchover.

## Owners

- Command contract + discovery: `src/command-contract.ts`
- Station catalog + drift gate: `src/branch-station-catalog.ts`
- Runtime seam + entrypoint: `src/runtime.ts`, `src/cli.ts`
- Proof chain (`check`): `src/proof.ts`
- Lifecycle: `src/launch.ts`, `src/repair.ts`
- Contract id + schema version: `src/model.ts`

## Front door

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
bun run runtime/warm-chrome/src/cli.ts status
```
