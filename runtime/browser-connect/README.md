# browser-connect

`browser-connect` provably attaches Browser Adapters to Agent Chrome. One
command CLI: prove the environment, inject the verified endpoint into an
adapter's declared route, exec the adapter — never let an adapter find Chrome
itself.

Success is a Verified Handoff Envelope: a proven connection handed to a
consumer. It consumes `@side-quest/warm-chrome` in-process for the
environment proof.

## Status

Slice one complete: the explicit-CDP door to Agent Chrome. `check`,
`connect`, bare-no-arg `dashboard`, and `run <adapter> -- <cmd>` are
implemented and proven through the 19-station Branch Station catalog. Slice
two (Human Chrome via UI-consent) and slice three (extension door) are
deferred per the plan.

## Start Here

Run the direct source runner in repo-local environments:

```bash
bun run runtime/browser-connect/src/cli.ts
```

Read shared language before interpreting attachment terms:

- [CONTEXT.md](./CONTEXT.md)

For package maintenance, see [AGENTS.md](./AGENTS.md). For architecture and
module ownership, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## What It Does

- Proves Agent Chrome readiness through `@side-quest/warm-chrome` in-process.
- Injects the verified endpoint into a Browser Adapter's declared route.
- Execs the adapter against the proven environment (`run`), passing the
  wrapped command's exit code through unchanged.
- Emits facade-backed JSON envelopes for agents (machine surface): `connect
  <adapter> --json` on stdout, `run`'s envelope on stderr pre-exec.
