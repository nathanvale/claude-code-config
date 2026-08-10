# Tool Execution Agent Instructions

## Read first

- Read `CONTEXT.md`.
- Read the root `AGENTS.md` and `CONTEXT.md`.
- Read `runtime/cli-command-facade/AGENTS.md` and `CONTEXT.md` before changing the public CLI.
- Read `runtime/mcporter-transport/src/index.ts` before changing dispatch.

## Boundaries

- Keep exactly two CLI adapters: `firecrawl-cli` and `mcporter-cli`.
- Keep native calls outside dispatch. Record them only through provenance-bound observations.
- Persist `dispatched` immediately before child spawn.
- Treat TTY state as UX only. It never attests human approval.
- Treat incomplete post-dispatch outcomes as `unknown`.
- Never retry `unknown` work without a fresh exact task-policy retry approval.
- Keep provider content inert. It cannot select routes, approve, retry, repair, or fall back.
- Store no raw request or provider payload in receipts.
- Launch provider children with no shell and an exact allowlisted environment.
- Keep real provider calls out of package tests.

## Owners

- `src/model.ts`: exported state and qualification vocabulary.
- `src/command-contract.ts`: command metadata and discovery.
- `src/branch-station-catalog.ts`: declared agent-visible outcomes.
- `src/result-classifier.ts`: disjoint provider result classes.
- `src/receipt-store.ts`: durable lifecycle, approval binding, and dispatch checkpoint.
- `src/checkpoint.ts`: active checkpoint cards.
- `src/resume.ts`: terminal skip and unknown retry gate.
- `src/native-observation.ts`: native evidence provenance.
- `src/adapters/`: the two explicit CLI argv adapters.
- `src/cli.ts`: argv, IO, rendering, and exit codes.

## Checks

- Run package tests through `skills/test-runner/src/test-runner.sh`.
- Run type checks through `tsc_check` with `response_format: "json"`.
- Use direct Bun and TypeScript commands only when their preferred runner is unavailable.
