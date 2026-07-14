# Browser Connect Architecture

Package architecture for `@side-quest/browser-connect`.

## Shape

`browser-connect` is a facade-backed CLI that provably attaches Browser
Adapters to Agent Chrome: prove the environment through
`@side-quest/warm-chrome` in-process, inject the verified endpoint into the
adapter's declared route, exec the adapter, and hand a Verified Handoff
Envelope to the consumer.

Its interface will be:

- `browser-connect` bin (`src/cli.ts`, source-linked via the package `bin`).
- A command facade contract built on `@side-quest/cli-command-facade`.
- JSON result envelopes as the machine surface for agents.

## Status

U1 scaffold. `src/cli.ts` is a stub `main` that exits 0. The dispatcher,
command contract, and station catalog land in later units; the Module Map
below grows with them.

## Module Map

- `src/cli.ts`: stub entrypoint; exports `main`, exits 0 when run.

## Maintainer Surfaces

- `AGENTS.md`: maintainer route, intent gate, and verification.
- `README.md`: human front door and target command posture.
- `CONTEXT.md`: package language for Agent Chrome, Human Chrome, Browser
  Adapter, and Verified Handoff Envelope.
- `TASKS.md`: active project-manager dashboard.
- `TASKS.archive.md`: closed task detail and long review rationale.
