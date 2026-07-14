# Setup Runtime Context

## Purpose

Own this repository's user runtime wiring and live first-party skill projection through one facade-backed CLI.

## Owners

- Contract: `src/command-contract.ts`
- Model: `src/model.ts`
- Engine: `src/inspection.ts`, `src/planner.ts`, `src/apply.ts`, and `src/unlink.ts`
- Discovery: `src/catalog.ts`, `src/scope.ts`, `src/ownership.ts`, and `src/provider-evidence.ts`
- User domains: `src/setup-domains.ts`, `src/startup-topology.ts`, `src/hook-topology.ts`, `src/instruction-health.ts`, and `src/runbook-health.ts`
- Hook provenance: `src/hook-provenance.ts`
- Branch stations: `src/branch-station-catalog.ts`
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
- A hook provenance receipt is Setup state proving a copied hook destination's installed content.
- Unproven hook state is preserved for human repair.
- A station id names one terminal branch and one package-owned result contract.
- Detailed causes stay in finding ids; stations remain bounded terminal outcomes.

## Verification

```sh
bun --filter @side-quest/setup test
bun --filter @side-quest/setup typecheck
bun run check:workspace-facade
```
