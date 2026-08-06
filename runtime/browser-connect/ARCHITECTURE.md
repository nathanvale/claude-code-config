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
  typed repair context (environment/adapter/run causes, bounded repair-chain
  hop), redaction chokepoint.
- `src/repair-path.ts`: pure exhaustive recovery policy — selects one
  automatic or operator repair stage per typed failure context, owns the
  Repair Action Contract catalogue, operator choice and constraint
  catalogues, versioned `REPAIR.md#v1-<action-id>` docs URLs, and the closed
  legacy `data.next_action_id` compatibility selector. Unknown or ambiguous
  context fails closed to an operator stage; gateways own bounded transient
  retries before projection.
- `src/environment.ts`: warm-chrome in-process environment gateway.
- `src/compatibility.ts`: pure route × environment compatibility.
- `src/dashboard.ts`: stateless read-only registry projection.
- `src/run-exec.ts`: `--` split, endpoint injection, spawn-and-wait,
  passthrough.
- `src/adapters/`: registry plus the three Adapter Definitions
  (`chrome-devtools-mcp`, `agent-browser`, `playwright-cdp`). Each definition
  owns identity, executable provenance, endpoint injection, the read-only
  attachment probe, and its isolated-install policy. `playwright-cdp` is the
  public Playwright CLI lane: it attaches over the explicit CDP endpoint with a
  named session, snapshots read-only, and detaches without closing the browser;
  its probe pins the attach/detach `--help` contract so any CLI drift fails
  closed before an implicit browser launch. Its exact lock pulls optional
  fsevents (an install script), so package install stays operator-owned (R29).

## Safety Invariants (R11–R14)

These are the product-absorbed browser-access invariants. R11–R12 and R14 are
enforced in code (fail-closed exit-20 gateway, endpoints only from proof
envelopes, redaction chokepoint). R13 has no process-cleanup surface in v1, so
it holds vacuously in code and lives here as behavioral guidance — this
package is the named successor for the corresponding clause of the retired
`rules/browser-access.md` (rule removed 2026-07-16, migration cleanup U5):

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
- `REPAIR.md`: repair-docs owner. One append-only versioned heading
  (`v1-<action-id>`) per catalogue repair action; the only home for repair
  commands. `src/repair-path.ts` emits its public `#v1-<action-id>`
  fragments; a heading must exist on main before releasing a binary that
  emits it.
- `TASKS.md`: active project-manager dashboard.
- `TASKS.archive.md`: closed task detail and long review rationale.
