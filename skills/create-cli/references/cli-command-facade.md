# Facade-Backed CLI Path

Use this only for explicit facade-backed implementation, reusable facade code,
facade runtime validation, `@side-quest/cli-command-facade`, or an existing
facade-owned surface.

Facade-backed means: apply Agent-native CLI design, then use the facade runtime
as the enforcement backend.

Every facade-backed CLI is agent-native by construction, but not every
agent-native CLI needs the facade. Use `agent-native-cli-design.md` for the
language-agnostic design goal; use this reference when the facade is the chosen
runtime owner for machine-checkable contracts.

## Boundary

- Keep `create-cli` as the design front door.
- Keep exact contract shape in `@side-quest/cli-command-facade`.
- Keep command catalog meaning, route policy, result vocabulary, redaction, and
  runtime semantics in the consuming package.
- Do not copy facade fields, generated envelopes, parser rules, validator
  categories, or helper signatures into skill prose.
- Prefer owner paths over remembered API details.

## Owner Paths

- Package instructions:
  `runtime/cli-command-facade/AGENTS.md`
- Package vocabulary:
  `runtime/cli-command-facade/CONTEXT.md`
- Public production interface:
  `runtime/cli-command-facade/src/index.ts`
- Root export barrel:
  `runtime/cli-command-facade/src/command-facade.ts`
- Command and result contract types:
  `runtime/cli-command-facade/src/command-contract.ts`
- Contract validation and no-throw parse path:
  `runtime/cli-command-facade/src/command-metadata.ts`
- Discovery projection and drift checks:
  `runtime/cli-command-facade/src/command-discovery.ts`
- Usage and help helpers:
  `runtime/cli-command-facade/src/usage.ts`
- JSON writer mechanics:
  `runtime/cli-command-facade/src/cli-writer.ts`
- Runtime envelopes, structured errors, hints, actions, continuations, and
  diagnostic-trail shape:
  `runtime/cli-command-facade/src/runtime-envelope.ts`
- Projected text safety:
  `runtime/cli-command-facade/src/runtime-text-safety.ts`
- Branch Station model and Station Map projection:
  `runtime/cli-command-facade/src/station-map.ts`
- Diagnostics mechanics:
  `runtime/cli-command-facade/src/cli-diagnostics.ts`
- Test-support subpath:
  `runtime/cli-command-facade/src/testing.ts`
- Package tests and fixtures:
  `runtime/cli-command-facade/tests/command-facade.test.ts`
- Cross-package Station Map report:
  `skills/cli-execution-auditor/src/station-map.ts`
  This path appears here because the facade owns the generic Station Map model;
  the auditor owns the cross-package report that applies it to target CLIs.

## Capability Map

- Command contracts: declare package-owned route metadata, flags, exits,
  side-effect stance, output modes, result contracts, diagnostics capability,
  and action affordances.
- Construction-time validation: reject drift before a CLI ships or writes
  machine-facing output.
- Discovery: project an agent-facing command catalog without package-specific
  route policy.
- Usage helpers: render help, parse common enum/value flags, compose aliases,
  and keep parser acceptance aligned with rendered help.
- JSON output: write stdout data and runtime envelopes without hand-built
  envelope literals.
- Result data: attach result-contract metadata through the Result Data Helper
  while keeping package result vocabulary package-owned.
- Runtime errors: construct structured errors, recoverability, retryability,
  hints, failure domains, runtime actions, continuations, and diagnostic trails.
- Diagnostics: parse facade diagnostic flags, manage run correlation, redact
  diagnostics, and keep diagnostic output separate from primary stdout data.
- Text safety: reject unsafe projected text before it reaches agent catalogs or
  runtime envelopes.
- Station Map: publish declared branch-coverage evidence for agent-visible
  command paths from package-owned Branch Station catalogs.
- Testing helpers: assert rendered help, public argv behavior, result contract
  metadata, error envelopes, process output, and runtime semantics.

## Workflow

- Capture the Minimum CLI design brief from `SKILL.md`.
- Apply `agent-native-cli-design.md`.
- Name owners before implementation:
  - Contract owner.
  - Model owner.
  - Engine owner.
  - Discovery owner.
  - CLI owner.
  - Test owner.
- Read the owner paths above for exact runtime shape.
- Emit or update the package-owned command contract in the consuming package.
- For new or expanded facade-backed CLIs, name the initial Branch Station ids
  in the plan before implementation writes code.
- Scaffold a package-owned Branch Station Catalog beside `command-contract.ts`
  before runner behavior or process integration rows.
- Use the facade result-data helper when a command result declares
  `resultContract`.
- Keep package result payloads as named structured object types. Do not force
  interface-shaped payloads through `Record<string, unknown>`.
- Do not use a bare `object` payload type without the facade's plain-object
  runtime guard.
- Keep facade metadata keys owned by the helper; payload types block
  `contract_id` and `schema_version`, and runtime guards reject collisions.
- For generic error payloads, use a lifecycle or error-owned result contract.
  Do not stamp generic error data with a command-specific success
  `resultContract`.
- Validate at construction with the facade runtime.
- Use the no-throw parse path when an autonomous loop needs repair hints.
- Stop and hand off when validation returns an issue with no known correction.
- For broad CLI migrations, settle the facade helper API first, prove it with
  fake facade tests, update one consuming CLI, run the Command Surface Alignment
  Proof, then fan out.

## Proof Expectations

- Prove discovery metadata, rendered help, public argv outcomes, and runtime
  semantics cannot drift.
- Prefer facade testing-subpath helpers when available.
- Keep proof scenario-based.
- Cover advertised flags in help.
- Cover command-foreign flags excluded from help.
- Cover public argv acceptance and rejection.
- Cover command semantics through runtime probes.
- Assert package-owned result vocabulary from package-owned constants.
- For Branch Station work, prove the Station Map only claims Declared Branch
  Coverage and reports missing, drifted, skipped, or declared-unreachable
  stations mechanically.

## Coach-Filled Gaps

The facade validates machine-checkable runtime shape. The CLI coach still owns
judgment for:

- Naming.
- User mental model.
- Human help quality.
- Examples.
- Config precedence.
- TTY behavior.
- Color and pager behavior.
- Ctrl-C handling.
- Deprecation and migration posture.
- Package-owned safety policy.
- Package-owned recovery meaning.

## Result Data Helper

- Use the package-root facade helper to attach `resultContract` metadata to
  successful command data.
- Keep exact helper signatures in the facade package, not in this reference.
- Treat `contract_id` and `schema_version` as reserved helper-owned keys.
- Runtime guard expectations:
  - Reject null.
  - Reject arrays.
  - Reject functions.
  - Reject reserved metadata collisions.
- Payload type stance:
  - Prefer named structured object payloads for package result data.
  - Avoid `Record<string, unknown>` when the payload is an interface-shaped
    object without an index signature.
  - Avoid bare `object` unless the runtime guard proves a plain object before
    spreading or writing.
- Error payload stance:
  - Use lifecycle or error-owned contracts for generic failure data.
  - Use command-specific result contracts only for that command's success shape
    or failure shape when the package explicitly owns that shape.
- Structured error stance:
  - Build structured runtime errors through facade helper constructors.
  - Use typed convenience helpers for usage, repair-state, and retry failures.
  - Use the generic structured error builder when the package owns
    recoverability directly.
  - Do not hand-build structured runtime error literals in CLI front doors.

## Gotchas

### Error hints reject commands and local paths

- The facade scans every agent-facing envelope text and refuses commands
  (`bun`, `npm`, `git`, ...) and local paths (`/Users/...`).
- Rule owner: `runtime/cli-command-facade/src/runtime-text-safety.ts`.
- A hint that inlines a fix command throws at envelope construction, not in a
  test; the command path never runs.
- Repair channel: keep the hint prose-only `summary`, set a structured
  `action`, and point `docs_url` at the doc that owns the real command.
- Commands live in docs; hints reference docs. No command string, no drift.

### `bun --filter` is a display wrapper, not a CLI surface

- `bun --filter <pkg> <script>` (Bun 1.3.14) elides child stdout to ~10 lines
  and does not forward parent stdin to the child.
- Never pipe a stdin receipt through `--filter`; the child sees empty stdin.
- Never assert program help or output through `--filter`; the wrapper truncates
  it and the assertion tests display budget, not the program.
- Invoke the runner directly for stdin-fed commands and for output assertions:
  `bun run <path-to-runner> <command>`.

## Local Link

- This repo wires the facade through Bun workspaces.
- Portable consumers need a published package or export payload that includes
  `runtime/cli-command-facade`.

## Review

- Was Facade-backed explicitly requested, or is the surface already
  facade-owned?
- Did Agent-native design happen before facade implementation?
- Does the facade-backed surface still satisfy the runtime-contract minimum in
  `agent-native-cli-design.md`?
- Are exact contract details read from owner paths?
- Are package-owned literals kept near the package command contract?
- Does validation run against the runtime rather than prose?
- Are coach-filled gaps still designed outside the facade?
- Does the Command Surface Alignment Proof cover the four drift surfaces?
