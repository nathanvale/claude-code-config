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

- Keep `cli-author` as the design front door.
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

## Testing Strategy

Every facade-backed CLI needs three test layers. Missing a layer leaves a
category of drift undetectable.

| Layer | What it proves | Owner pattern |
|-------|---------------|---------------|
| **Unit tests** | In-process command semantics, readiness engine logic, contract validation | `<package>/tests/*.test.ts` using `runForTest()` or equivalent in-process harness |
| **Branch Station catalog tests** | Catalog validates against live command discovery; synthetic evidence covers required stations; station map projects declared branch coverage | `<package>/tests/branch-station-catalog.test.ts` |
| **Catalog-driven integration tests** | Real `bun run` process spawns prove exit codes, stdout/stderr separation, JSON envelope integrity, and station coverage through the process boundary | `<package>/tests/<name>.integration.test.ts` |

### Catalog-driven integration test pattern

The integration test iterates every station in the Branch Station catalog
through real process spawns. This is the pattern that catches broken shebangs,
missing exports, package script typos, and stdout/stderr encoding issues that
unit tests cannot reach.

Required structure:

1. **Station scenario map** — `Record<StationId, StationScenario>` keyed by
   every station ID in the catalog. Compile-time type safety ensures a new
   catalog station forces a new scenario row. Use `StationScenario<T>` from
   `@side-quest/cli-command-facade/testing`.
2. **Scenario rows** — each row spawns a real process with filesystem fixtures
   (temp dirs, `package.json` files, config files), asserts exit code and
   envelope shape against the catalog's expectations using
   `assertStationEnvelope()`, and returns `BranchStationEvidence` via
   `buildStationEvidence()`.
3. **Skipped stations** — stations needing infrastructure (live server, network,
   specific runtime environment) use `buildSkippedStationEvidence()` with a
   rationale string.
4. **Evidence collection** — after all scenarios run, feed the
   `BranchStationEvidence[]` directly to the package-owned station map
   projector. Assert no drift and that every station is covered or skipped.
5. **Catalog alignment** — a standalone test asserts the scenario map keys equal
   the catalog station IDs, catching additions or removals.

### Shared testing helpers

`@side-quest/cli-command-facade/testing` exports station integration helpers.
Use these instead of writing package-local equivalents.

| Helper | Purpose |
|--------|---------|
| `StationScenario<T>` | Generic scenario type: `{ run: (station: T) => Promise<BranchStationEvidence> }` |
| `StationRuntimeEnvelope` | Shared envelope type: `{ status?, data?, error? }` |
| `assertStationEnvelope(station, result)` | Validates exit code, envelope status, contract ID, and error code against catalog expectations. Throws on mismatch with process context. |
| `buildStationEvidence(station, result, envelope)` | Constructs covered `BranchStationEvidence` from process result and envelope. |
| `buildSkippedStationEvidence(station, rationale)` | Constructs skipped evidence with rationale. |
| `extractEnvelopeContractId(envelope)` | Reads `contract_id` or `contract` from envelope data. |

Reference implementations:
- `skills/skill-feedback/src/skill-feedback.integration.test.ts` — full
  coverage, no skipped stations (uses package-local helpers, predates shared
  extraction).
- `skills/use-storybook/tests/storybook-doctor.integration.test.ts` — partial
  coverage with skipped stations, uses shared helpers from the facade testing
  subpath.

### Shared test fixture package

`@side-quest/cli-test-fixtures` provides process-boundary test infrastructure
shared across facade-backed CLI integration tests: temp dirs, fake binaries,
fixture servers, and cleanup.

- Context and vocabulary: `runtime/cli-test-fixtures/CONTEXT.md`

| Helper | Purpose |
|--------|---------|
| `createCleanupRegistry()` | Creates a registry for tracking temp dirs and servers for `afterEach` drain |
| `drainCleanup(registry)` | Stops servers then deletes temp dirs in correct order |
| `makeTempDir(registry, prefix)` | Creates an isolated temp dir registered for cleanup |
| `writePackageJson(dir, content)` | Writes a fixture `package.json` with formatted JSON |
| `writeFakeToolBinary(dir, toolName, script)` | Writes an executable shell script to `node_modules/.bin/<tool>` |
| `startFixtureServer(registry, handler)` | Starts `Bun.serve` on random port with caller-owned route handler, returns `{ url, port, server }` |

Use `@side-quest/cli-test-fixtures` for fixture setup, and
`@side-quest/cli-command-facade/testing` for process spawning and station
evidence.

### Fixture server pattern

When a CLI probes network endpoints (HTTP health checks, MCP endpoints, API
calls), use a fixture server on a random port. Pass the URL via `--url` or
equivalent flag.

`startFixtureServer` from `@side-quest/cli-test-fixtures` handles lifecycle
(random port, cleanup registration, server handle). The consuming test provides
the route handler with canned responses per route.

- Return canned responses per route (e.g. `/` returns 200, `/mcp` returns
  tools list or 404).
- Stop the server before probing to test unreachable-endpoint stations.
- Never hardcode ports.

### Fake binary pattern

When a CLI shells out to a local tool (e.g. `npx storybook doctor`), write a
fake tool binary to `node_modules/.bin/<tool>` in the temp dir fixture.

`writeFakeToolBinary` from `@side-quest/cli-test-fixtures` handles the
mkdir + write + chmod dance. The consuming test provides the script body and
tool name.

- Control exit code, stdout, and stderr via the script body.
- `#!/bin/sh` works on macOS and Linux; note this in portability constraints
  if the test suite must run on Windows.

### When to scaffold each layer

- **Unit tests**: always. Scaffold alongside `command-contract.ts`.
- **Branch Station catalog + catalog test**: when the CLI has 2+ commands or
  any command with multiple outcome branches. Scaffold alongside
  `branch-station-catalog.ts`.
- **Catalog-driven integration test**: when the Branch Station catalog exists.
  The integration test is the proof that the catalog's declared coverage is
  real. Without it, the catalog is an assertion about tests that don't exist.

### Repair guide for partially-aligned packages

Use this when a facade-backed CLI has integration tests but lacks the
catalog-driven pattern. Signs of partial alignment:

- Integration test exists but has no `branch-station-catalog.ts`.
- Tests spawn real processes but don't iterate the catalog.
- No `Record<StationId, StationScenario>` exhaustiveness check.
- No `BranchStationEvidence` collection or station map projection.

Repair steps:

1. Identify all command outcome branches from the existing integration test
   scenarios and the command contract.
2. Create `branch-station-catalog.ts` with a `BranchStation` entry per branch.
   Set `expectedExitCode`, `expectedEnvelopeStatus`, and
   `expectedResultContractId` from the existing test assertions.
3. Create `branch-station-catalog.test.ts` that validates the catalog against
   live command discovery and projects a station map with synthetic evidence.
4. Create or refactor the integration test to use the catalog-driven pattern:
   station scenario map keyed by `StationId`, shared helpers from
   `@side-quest/cli-command-facade/testing`, evidence fed to the station map
   projector.
5. Mark infrastructure-dependent stations as skipped with rationale.

Current repo alignment:

| Package | Unit | Catalog | Integration | Status |
|---------|------|---------|-------------|--------|
| `skills/use-storybook` | Yes | Yes | Yes (shared helpers) | Fully aligned |
| `skills/skill-feedback` | Yes | Yes | Yes (local helpers) | Aligned, could adopt shared helpers |
| `skills/worktree` | Yes | No | Yes (no catalog) | Needs catalog + refactor |
| `runtime/agent-worktree` | Yes | No | Yes (no catalog) | Needs catalog + refactor |

### Growing the test fixture library

When implementing a process-boundary test pattern that 3+ integration tests
would share, add it to `@side-quest/cli-test-fixtures` instead of keeping it
test-local.

Follow the admission criteria in `runtime/cli-test-fixtures/CONTEXT.md`:
- Must be process-boundary infrastructure (not facade contract logic).
- Must not encode domain-specific fixture content.
- Must be used by 3+ test files.

Update this testing strategy when new helpers are added so future CLIs discover
them.

### Migrating existing tests to shared helpers

Use this when an integration test already works but uses local duplicates of
the shared helpers. Signs: local `cleanupPaths`/`cleanupServers` arrays, local
`makeTempDir`, local `writePackageJson`, local `writeFakeXBinary`, local
`startFixtureServer`.

**Fixture infrastructure migration** (to `@side-quest/cli-test-fixtures`):

1. Add `"@side-quest/cli-test-fixtures": "workspace:*"` to the package's
   `devDependencies`. Run `bun install`.
2. Replace local cleanup arrays and `afterEach` drain with
   `createCleanupRegistry()` and `drainCleanup(registry)`.
3. Replace local `makeTempDir(prefix)` with `makeTempDir(registry, prefix)`.
4. Replace local `writePackageJson` with the imported version (same signature).
5. Replace local fake binary writers with
   `writeFakeToolBinary(dir, toolName, script)`.
6. Replace local fixture server helpers with
   `startFixtureServer(registry, handler)`. Extract the route handler into a
   named function in the test file — the handler owns domain-specific canned
   responses.
7. Delete the replaced local helpers. Keep domain-specific helpers (config
   writers, full-setup-dir composers) test-local.
8. Run the tests. Behavior must not change.

**Station evidence migration** (to `@side-quest/cli-command-facade/testing`):

1. Replace local `RuntimeEnvelope` type with `StationRuntimeEnvelope`.
2. Replace local `StationScenario` type with `StationScenario<T>`.
3. Replace local `expectStationEnvelope` with `assertStationEnvelope`.
4. Replace local `evidenceFor` with `buildStationEvidence`.
5. Replace local `skipStation` with `buildSkippedStationEvidence`.
6. Replace local `observedResultContractId` with `extractEnvelopeContractId`.
7. If the test used a package-specific evidence type (e.g.
   `StationTestResult`), switch scenarios to return `BranchStationEvidence`
   directly and feed the array to the station map projector without a mapping
   step.
8. Delete the replaced local helpers and unused imports.
9. Run the tests. Behavior must not change.

Reference migration:
- `skills/use-storybook/tests/storybook-doctor.integration.test.ts` — migrated to
  both shared packages. Domain-specific helpers (`writeStorybookConfig`,
  `makeFullSetupDir`, route handlers) stayed test-local.

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
