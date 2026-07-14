# browser-connect

`browser-connect` provably attaches Browser Adapters to Agent Chrome. One
command CLI: prove the environment, inject the verified endpoint into an
adapter's declared route, exec the adapter — never let an adapter find Chrome
itself.

Success is a Verified Handoff Envelope: a proven connection handed to a
consumer. It consumes `@side-quest/warm-chrome` in-process for the
environment proof.

## Status

U1 scaffold. `src/cli.ts` is a stub that exits 0; the facade-backed
dispatcher lands in a later unit. Commands and envelopes below describe the
target shape, not current behavior.

## Start Here

Run the direct source runner in repo-local environments:

```bash
bun run runtime/browser-connect/src/cli.ts
```

Read shared language before interpreting attachment terms:

- [CONTEXT.md](./CONTEXT.md)

For package maintenance, see [AGENTS.md](./AGENTS.md). For architecture and
module ownership, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## What It Will Do

- Prove Agent Chrome readiness through `@side-quest/warm-chrome` in-process.
- Inject the verified endpoint into a Browser Adapter's declared route.
- Exec the adapter against the proven environment.
- Emit facade-backed JSON envelopes for agents (machine surface).
