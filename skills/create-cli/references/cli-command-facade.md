# Implementing the spec: TypeScript + Bun + cli-command-facade

The clig.dev patterns in this skill (`--json`, exit codes 0/1/2, `--dry-run`,
destructive-op confirmation, structured errors) are conventions you *design*.
`@side-quest/cli-command-facade` is the runtime that *enforces* them — so you
don't hand-roll flag parsing, exit-code mapping, JSON envelopes, or error
shapes. When you implement a CLI you designed with this skill, prefer
**TypeScript + Bun**, and lean on the facade to realise the patterns.

This is the side-quest implementation path. The skill body stays
language-agnostic; this reference is the recommended way to *build* the result.

## Pattern → facade feature

Each convention the skill advocates has a facade field or helper that enforces
it. Design the pattern; let the facade hold it.

- USAGE synopsis → `usage: readonly string[]`, rendered by `renderCommandUsage`.
- Args/flags table (type, required) → `flags: Record<string, CommandFacadeFlag>`
  — `boolean | string | path | json | enum`, each with optional `required`.
- `--json` output rule → `json: boolean` + `createCliRuntimeSuccessEnvelope` /
  `writeJsonEnvelope` (the machine-stable `{ status, run_id, data }` shape).
- Exit-code map → `exitCodes: Record<string, string>` (numeric-string keys).
- `--dry-run` / safety modes → `executionModes: 'normal' | 'check' | 'dry_run'`.
- Destructive-op classification → `sideEffects: 'read' | 'check' | 'write' |
  'destructive' | 'auth' | 'network' | 'browser'`.
- Error shape + recovery → `StructuredRuntimeError` + `AgentHint` (built via
  `createCliRuntimeErrorEnvelope`): `code`, `message`, `exit_code`, `severity`,
  `recoverability`, `retryable`, optional `hint`.
- Result schema → `resultContract: { id, kind?, schema_version? }`.
- Follow-up actions → `actionAffordances` / `RuntimeActionGuidance`.
- Discovery / subcommand projection → `projectCommandDiscoveryTree`.

## Recommended structure (validated by prototype, 2026-05-31)

- **Default to flat multi-command.** The facade record is flat — every command
  is a top-level key. There is no nesting field.
- **"Command trees" are naming + projection, not nesting.** Express a tree with
  `noun:verb` command names (`remote:add`, `remote:list`) plus `audience`-driven
  discovery projection (`projectCommandDiscoveryTree`). Escalate to noun-verb
  naming once a noun has 3+ verbs.
- **Lean hardest on the observability + agent-hint palette** — correlated
  `run_id`, machine-readable `recoverability` + `hint.action`, and
  `runtime_actions` on success *and* error. That payoff (not the structure
  choice) is the create-cli-meets-facade value over a hand-rolled CLI.

## Facade owns the diagnostic flags — don't declare them

`--quiet`, `--verbose`, `--debug`, `--run-id` are facade-reserved (consumed
before your command sees argv). Declaring one as a flag is rejected by the
validator. `--json` is *not* reserved — you declare it (`json: true`) and own
its rendering.

## clig.dev coverage map — what the contract enforces vs. prose-only

The skill teaches the *whole* clig.dev rubric. The typed `CommandFacadeContract`
only enforces the machine-checkable subset. Everything else is real design work
that stays in the prose spec (no contract field — fine for v1).

Contract-enforced:

- The Basics (exit codes, stdout/stderr) → `exitCodes`, `json`.
- Help (`-h/--help`) → `renderCommandUsage`.
- Output (`--json`) → `json` + envelope writers.
- Errors (structured + recovery) → `StructuredRuntimeError` + `AgentHint`.
- Arguments and flags → typed `flags`.
- Destructive classification → `sideEffects`; safety modes → `executionModes`.
- Result schema / follow-ups → `resultContract` / `actionAffordances`.

Prose-only (no contract field — keep in the spec, design deliberately):

- Output: `--plain`, color (`NO_COLOR` / `--no-color`), pager.
- Interactivity: prompts, TTY detection, `--no-input`.
- Signals: Ctrl-C handling, crash-only recovery.
- Configuration: flags > env > project > user > system precedence, XDG dirs.
- Environment variables: names, respected vars, `.env`.
- Documentation: web docs, man pages.
- Future-proofing: deprecation paths; Distribution; Naming; Analytics.

Backfilling some of these into the contract (config/env precedence, `--plain`,
`--no-input`) is tracked upstream: nathanvale/side-quest-engineering#58.

## Validate at construction — write and check collapse into one step

`defineCommandFacadeContract` runs the real drift checker at module load and
throws on a broken contract (e.g. an `enum` flag with no `values`). A subtly
wrong spec can't ship silently. `parseCommandFacadeContract` is the no-throw
variant — returns `{ ok, contracts } | { ok: false, issues }` where each issue
carries a `category` and an imperative `action` an agent loop can apply.

What the validator actually checks (it enforces *shape*, not judgment):

- enum flag with empty `values` → `command-enum-flag-values-missing`.
- a flag key not starting with `--` → `command-flag-name-invalid`.
- a reserved diagnostic flag declared → `command-reserved-diagnostic-flag`.
- a non-numeric exit-code key (`"success"` not `"0"`) → `command-exit-code-invalid`.
- an audience outside `agent|operator|smoke|governance` → `command-audience-invalid`.
- an alias at a missing target / with empty default args → `command-alias-*`.

It does NOT range-check exit codes or judge whether codes are *sensible* — that
judgment is yours (recommend sysexits / 0-1-2). A minimal legal contract needs
only: `script, summary, usage, json, audience, mutation, flags, exitCodes`;
everything else is optional, so emit minimal and enrich later.

## Self-correction loop (autonomous mode)

When an agent emits a contract, pair it with a `parse → fix → re-parse` loop:
`parseCommandFacadeContract` returns *all* issues at once, so one pass can fix a
batch (rename a flag, fill enum values, repoint an alias) and re-run. The loop
converges in 1–2 passes for shape errors. Bound it: if a pass applies no fix
(an issue with no known correction), STOP and hand the `action` string to a
human — this is the build-time analog of the high-stakes pause. Never spin.

## What command output actually looks like

The facade *writers* produce the output; the command supplies only the payload.

- `--json` success (object payload) → the writer injects top-level `run_id` and
  `duration_ms` into your object: `{ ...data, run_id, duration_ms }`.
- `--json` success (array payload) → written as-is, **NOT wrapped** — arrays get
  no `run_id`/`duration_ms` spine. Prefer object payloads when you want correlation.
- `--json` error → `{ status: "error", run_id, error, runtime_actions? }` where
  `error` is the full `StructuredRuntimeError`. `severity`/`recoverability`/
  `retryable` drive agent behavior: `retry`+`retryable:true` → retry same input;
  `authenticate`/`change_input`/`repair_state` → act first; `fatal`+`none` → stop.
- a result trying to own top-level `run_id` or `duration_ms` makes the writer
  throw `CliWriterContractError` (exit 70) — those fields are facade-owned in
  output too.

## The whole-tool surface is generated from the contracts

For a multi-command tool, the contract record is the single source for:

- **Directory:** one `scripts/<command>.ts` per command (noun:verb → `noun-verb.ts`)
  plus an entry that parses argv and dispatches. The dir is flat; the tree is naming.
- **Root `--help`:** generate the command list, summaries, and danger markers
  (destructive / auth) from `sideEffects` — don't hand-write it. List the
  facade-owned diagnostic flags once, in a global section.
- **`agent-context`:** `projectCommandDiscoveryTree` with an `audience` filter is
  the machine catalog an agent reads. The filter IS the "agent view vs human view"
  split — `audience:operator|governance` commands are absent from the agent catalog.

## Wire-up (copy, adjust names)

```ts
import {
  type CommandFacadeContract,
  defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

type CommandName = "build";

// Key each (sub)command by name — the contract record is flat.
const contracts = {
  build: {
    script: "scripts/build.ts",
    summary: "Build the project.",
    usage: ["build [--out <path>] [--json] [--dry-run]"],
    json: true,
    audience: "agent",
    mutation: "write",
    sideEffects: ["write"],
    executionModes: ["normal", "dry_run"],
    flags: {
      "--out": { type: "path" },
      "--json": { type: "boolean" },
      "--dry-run": { type: "boolean" },
    },
    exitCodes: {
      "0": "build succeeded",
      "1": "build failed",
      "2": "usage error",
    },
  },
} as const satisfies Record<CommandName, CommandFacadeContract<CommandName>>;

// Throws at load if the contract drifts. Called for its throw; the widened
// return is ignored so the per-key `as const` narrowing above stays intact.
defineCommandFacadeContract(contracts, { path: "scripts/command-contract.ts" });
```

Run/typecheck with Bun: `bun run scripts/command-contract.ts`,
`bunx --bun tsc --noEmit`.

## Local link

This skill's `scripts/` folder npm-links the package (`npm link
@side-quest/cli-command-facade`) so a generated contract can be type-checked and
run against real source. The link is machine-local (the package is private,
cross-repo); a portable consumer needs its own link or a published version.

These findings were validated against the linked package by throwaway prototypes
(70 contract shapes, output cases, and whole-tool surfaces) since deleted — the
conclusions above are what they proved.

## Reference

Exact field shapes and validators live in the package source:
`@side-quest/cli-command-facade` →
`packages/cli-command-facade/src/command-facade.ts` (in side-quest-engineering).
Integration rationale: `docs/brainstorms/2026-05-29-002-facade-aware-create-cli-integration.md`.
