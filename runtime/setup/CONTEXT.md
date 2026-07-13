# Setup Runtime Context

## Purpose

Own this repository's user runtime wiring and live first-party skill projection through one facade-backed CLI.

## Owners

- Contract: `src/command-contract.ts`
- Model: `src/model.ts`
- Engine: future inspect-plan-apply modules
- Discovery: future catalog, scope, ownership, and inspection modules
- CLI: `src/cli.ts`
- Tests: `tests/`

## Invariants

- No arguments route to read-only user status.
- Project scope requires an explicit repository.
- `commands` emits JSON only.
- Human output owns presentation; JSON stdout contains one facade envelope.
- Diagnostics and child-process output stay on stderr.
- Setup owns first-party links only.
- `bunx skills` owns third-party acquisition.
- A station id names one terminal branch and one package-owned result contract.
- Detailed causes stay in finding ids; stations remain bounded terminal outcomes.

## Verification

```sh
bun --filter @side-quest/setup test
bun --filter @side-quest/setup typecheck
bun run check:workspace-facade
```
