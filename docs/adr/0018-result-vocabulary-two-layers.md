---
status: accepted
---

# Result vocabulary: facade envelope + Skillporter operation enum

Skillporter result output has two layers with two different owners, and they
must not be collapsed into one enum.

**Envelope layer (call outcome)** is owned by `@side-quest/cli-command-facade`
(`runtime/cli-command-facade/src/runtime-envelope.ts`): `status` `ok`/`error`,
plus `recoverability`, agent hint, structured error, and continuation guidance.
Skillporter *names and reuses* these types; it never redefines them in prose or
in its own code.

**Operation layer (plan items)** is Skillporter domain vocabulary the facade
cannot own: the closed set `add | remove | noop | blocked` (R6). It is a
code-owned union in `runtime/skill-porter/`, surfaced inside the envelope's
`data` payload.

## Envelope mapping for blocked plans

`blocked` exists in both layers and means different things, so the envelope
depends on the command:

- `plan add` / `plan remove` that yields blocked operations →
  `status: "ok"`, exit 0. Producing the plan succeeded; the agent reads
  `data` items, sees `blocked`, and decides. A preview is informational.
- `apply` on a plan that contains a blocked operation → `status: "error"` via
  the facade structured-error path (recoverability + repair hint), non-zero
  exit. This enforces R7 ("a blocked plan must never execute") and matches AE5's
  structured-error-with-repair-hint shape.

## Why two layers

- Conflating them (one flat enum) loses the distinction between "this operation
  is a noop" and "the whole command errored", which the agent must branch on.
- Freeform status strings are not a closed set, so agents cannot branch safely.
- The facade already owns recoverability/hint/continuation (R20); re-inventing
  them in Skillporter would fork a contract the workspace already provides.

## Consequences

- The Command Surface Alignment Proof asserts both layers: facade envelope shape
  via the facade testing harness, and the operation union via Skillporter's own
  tests.
- Deterministic values (the four operation names, the envelope statuses) live in
  code and tests, never in a doc table.
