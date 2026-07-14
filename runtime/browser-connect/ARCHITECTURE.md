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

Slice one complete: explicit-CDP door to Agent Chrome. `check`, `connect`,
bare-no-arg `dashboard`, and `run <adapter> -- <cmd>` are implemented and
proven through the 19-station Branch Station catalog. Slices two (Human
Chrome via UI-consent) and three (extension door) are deferred per the plan.

## Module Map

- `src/cli.ts`: facade-backed dispatcher; exit policy; `check`/`connect`/
  dashboard wiring; the shared `runConnectGate`.
- `src/command-contract.ts`: facade command contract for the four commands.
- `src/branch-station-catalog.ts`: the authoritative 19-station catalog.
- `src/model.ts`: envelope schema, failure classes, affordance catalog,
  redaction chokepoint.
- `src/environment.ts`: warm-chrome in-process environment gateway.
- `src/compatibility.ts`: pure route × environment compatibility.
- `src/dashboard.ts`: stateless read-only registry projection.
- `src/run-exec.ts`: `--` split, endpoint injection, spawn-and-wait,
  passthrough.
- `src/adapters/`: registry plus the two Adapter Definitions
  (`chrome-devtools-mcp`, `agent-browser`).

## Safety Invariants (R11–R14)

These are the product-absorbed browser-access invariants. R11–R12 and R14 are
enforced in code (fail-closed exit-20 gateway, endpoints only from proof
envelopes, redaction chokepoint). R13 has no process-cleanup surface in v1, so
it holds vacuously in code and lives here as behavioral guidance — this
package is the named successor for the corresponding `rules/browser-access.md`
clause when that rule retires:

- **R11 — Fail closed.** On any proof failure, stop with one next safe action.
  Never fall back to a cold or headless browser, never launch Chrome for
  Testing, never retry against a convention port.
- **R12 — No convention endpoints.** Endpoints come only from proof envelopes;
  `127.0.0.1:9222` is never assumed.
- **R13 — Never mass-kill by port.** Reap stray adapters by process pattern
  (`pkill -f '@playwright/mcp'`), not by assuming what holds a port. Never
  terminate a listener `warm-chrome` did not verify.
- **R14 — Agent Chrome is auth-bearing.** Cookies, secrets, auth-bearing URLs,
  and profile contents stay out of envelopes, diagnostics, and logs —
  including passed-through wrapper arguments.

## Maintainer Surfaces

- `AGENTS.md`: maintainer route, intent gate, and verification.
- `README.md`: human front door and target command posture.
- `CONTEXT.md`: package language for Agent Chrome, Human Chrome, Browser
  Adapter, and Verified Handoff Envelope.
- `TASKS.md`: active project-manager dashboard.
- `TASKS.archive.md`: closed task detail and long review rationale.
