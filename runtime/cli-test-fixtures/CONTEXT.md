# CLI Test Fixtures Context

CLI Test Fixtures is a package for process-boundary test infrastructure shared
across facade-backed CLI integration tests. It owns fixture lifecycle
mechanics — temp dirs, fake binaries, fixture servers, cleanup — not facade
contracts, station evidence, or envelope assertions.

## Language

**CLI Test Fixtures** is the shared package identity for process-boundary test
infrastructure reused across facade-backed CLI integration tests.
_Avoid_: facade testing, station evidence, envelope assertions, contract
validation — those belong in `@side-quest/cli-command-facade/testing`.
_Avoid_: test framework, test runner, assertion library — those belong in
`bun:test` or the consuming test file.

**Process-Boundary Test** is an integration test that spawns a real child
process and asserts its exit code, stdout, stderr, and JSON envelope shape.
The child runs the same binary a user or agent would invoke. This is what
CLI Test Fixtures supports.
_Avoid_: in-process unit tests (those mock at the runtime interface, not the
process boundary).

**Temp Dir Fixture** is a managed temporary directory with automatic cleanup
registration. Tests create temp dirs as isolated filesystem targets for CLI
commands via `--repo` or equivalent flags.
_Avoid_: persistent test state, shared mutable directories across tests,
directories that outlive a single test case.

**Cleanup Registry** is a pair of arrays (paths, servers) that collects
resources for draining in `afterEach`. Servers stop before paths are deleted.
Order matters: a fixture server may hold a file descriptor inside a temp dir.
_Avoid_: afterAll cleanup (leaks state between tests), manual cleanup,
forgetting to drain.

**Fixture File Writer** is a helper that writes one fixture file to a temp dir.
Each writer owns one file shape (package.json, shell script). The writer does
not own the content — the consuming test decides what goes in the file.
_Avoid_: multi-file orchestrators, project scaffolders, template engines,
domain-specific config writers (storybook, tsconfig — those stay test-local).

**Fake Tool Binary** is an executable shell script written to
`node_modules/.bin/<tool>` in a temp dir. It simulates a local tool that a CLI
shells out to via `runtime.execCommand` or `spawnSync`. The test controls exit
code, stdout, and stderr through the script body.
_Avoid_: real tool installation, npm install, binary downloads, mocking at the
runtime interface (that's a unit test concern).

**Fixture HTTP Server** is a `Bun.serve({ port: 0 })` instance on a random
port that answers canned responses on caller-configured routes. Tests point
the CLI at the server URL via `--url` or equivalent flag. Each test owns its
own route handler — the server helper owns lifecycle only.
_Avoid_: shared global server, hardcoded ports, persistent server state, route
handlers that encode domain knowledge (the test owns the canned responses).

**Full-Setup Dir** is a test-local helper (not in this package) that composes
multiple Fixture File Writers and optionally a Fake Tool Binary to create a
temp dir that passes all static checks so the readiness engine reaches network
probes. Each CLI defines its own full-setup shape.
_Avoid_: extracting full-setup helpers to this package — they encode domain
fixture shapes.

**Fixture Axis** is one dimension of test fixture composition: filesystem state
(empty → partial → full setup), network state (no server → server with tools →
server returning 404), tool state (no binary → binary exit 0 → binary exit 1 →
binary with huge output). Station scenarios compose fixture axes orthogonally.
_Avoid_: treating fixture axes as a formal type system — they're a mental model
for scenario design.

**Server-Stop-Then-Probe** is a temporal fixture technique: start a fixture
server to claim a random port, stop it immediately, then let the CLI probe the
dead port. Proves the CLI handles unreachable endpoints correctly.
_Avoid_: relying on this in CI with high port contention — the port may be
rebound between stop and probe (acceptable risk in fast test runs).

## Boundary

This package owns:
- Temp dir creation with prefix and cleanup registration.
- Cleanup registry creation and drain.
- Package.json fixture writer.
- Fake tool binary writer (shell script + chmod).
- Fixture HTTP server lifecycle (start on random port, register for cleanup,
  return URL and server handle).

This package does NOT own:
- Facade contracts, envelopes, or station maps — `@side-quest/cli-command-facade`.
- Station evidence, scenario types, or assertion helpers —
  `@side-quest/cli-command-facade/testing`.
- Process spawning or CLI result capture —
  `@side-quest/cli-command-facade/testing`.
- Domain-specific fixture content (storybook configs, git repos, inbox files,
  full-setup dirs).
- Test framework integration (`bun:test` imports stay in the consuming test).
- Route handlers for fixture servers (the consuming test owns canned responses).

## Relationships

- Consuming tests import `@side-quest/cli-test-fixtures` for filesystem and
  server fixture setup, and `@side-quest/cli-command-facade/testing` for
  process spawning, envelope assertions, and station evidence collection.
- CLI Test Fixtures has no dependency on CLI Command Facade.
- Domain-specific fixture shapes (storybook config, git repo scaffolding, full
  setup dirs) stay in the consuming test file. This package provides generic
  building blocks that every facade-backed CLI integration test needs.
- The `create-cli` testing strategy (`skills/create-cli/references/cli-command-facade.md`)
  documents how these building blocks compose with the facade testing helpers.

## Admission criteria

A helper belongs in this package when:
1. It is used by 3+ integration test files across different packages.
2. It is process-boundary test infrastructure, not facade contract logic.
3. It does not encode domain-specific fixture content.
4. Deleting it would cause 3+ test files to rewrite the same 5+ line helper.

A helper does NOT belong here when:
- It encodes domain fixture shapes (storybook config, git commit structure).
- It asserts envelope shape, contract IDs, or station evidence.
- It is used by only 1-2 test files (keep it test-local until the third).
- It wraps a single standard library call with no cleanup or registration logic.

## Example dialogue

> **Dev:** "Should the fixture server helper go in cli-command-facade/testing?"
> **Domain expert:** "No. Fixture servers are process-boundary test
> infrastructure, not facade contract assertions. They belong in
> cli-test-fixtures."

> **Dev:** "Should we add a git repo scaffolder here?"
> **Domain expert:** "No. Git scaffolding varies too much per test — each test
> needs its own commit structure and branch layout. Only extract when 3+ tests
> share identical git setup, and that hasn't happened."

> **Dev:** "Should domain-specific config writers (storybook, tsconfig) go here?"
> **Domain expert:** "No. Those are domain fixture shapes owned by the consuming
> test. This package provides writePackageJson and writeFakeToolBinary — generic
> shapes that cross package boundaries."

> **Dev:** "Should we add a `makeFullSetupDir` helper here?"
> **Domain expert:** "No. Full-setup dirs compose domain-specific fixtures —
> each CLI has different deps, config files, and scripts that constitute 'fully
> set up.' The consuming test owns that composition."

> **Dev:** "What's the difference between this package and the facade testing
> subpath?"
> **Domain expert:** "Facade testing owns the contract layer: station evidence
> types, envelope assertions, process result capture. CLI Test Fixtures owns the
> fixture layer: temp dirs, fake binaries, fixture servers, cleanup. A consuming
> test imports both — fixtures to set up the world, facade testing to spawn the
> CLI and assert the results."
