---
title: "feat: Add Storybook Doctor integration tests"
type: feat
date: 2026-06-17
depth: lightweight
---

# feat: Add Storybook Doctor Integration Tests

## Summary

Add `storybook-doctor` to the shared Command Entrypoint Integration Test suite at `scripts/command-entrypoint.integration.test.ts`. The in-process unit tests prove command semantics; this suite proves the process boundary those tests cannot reach: real `bun run` spawns, stdout/stderr separation, exit code semantics, and JSON envelope integrity through pipes.

---

## Problem Frame

The storybook-doctor CLI has 38 in-process unit tests covering readiness engine, deep doctor, command contracts, branch stations, and CLI front door behavior. None of these tests cross a process boundary. A broken shebang, a missing export, a package script typo, or a stdout/stderr encoding issue would pass all unit tests and fail at runtime. Every other facade-backed CLI in the repo (worktree, agent-worktree) already has integration coverage in this suite.

---

## Requirements

- R1. Derive storybook-doctor command IDs mechanically from exported contracts, not copied strings.
- R2. Prove every discovered command's `--help` renders its first contract usage line through a real process spawn.
- R3. Prove `--version` writes version text to stdout and exits 0 through a process spawn.
- R4. Prove `commands --json` emits a valid success envelope with the correct contract ID through a process spawn.
- R5. Prove `check --json` against a directory with no `package.json` emits a success envelope with `blocked` status and exit 0 (diagnostics completed, not a runtime failure).
- R6. Prove `deep --json` against the same empty target also emits a success envelope with `blocked` status and exit 0.
- R7. Prove usage errors (unknown command with `--json`, missing `--json` flag) emit error envelopes with exit 2.

---

## Key Technical Decisions

- KTD1. **Follow the existing runner pattern, not a new harness:** Use the same `runners.packageCwd` builder, `runCommand` wrapper, and assertion helpers (`expectOkEnvelope`, `expectUsageError`, `firstUsageLine`) that worktree and agent-worktree use. No new test framework or helper extraction.
- KTD2. **Empty temp directory for target isolation:** `check` and `deep` need a `--repo` pointing at a directory with no `package.json` to produce `blocked` without network probes. Use `mkdtempSync` (already imported in the test file) and clean up after.
- KTD3. **No running Storybook required:** Tests verify the CLI handles missing targets gracefully. No Storybook server, no MCP endpoint, no network access needed.
- KTD4. **Blocked status is exit 0:** The CLI treats completed diagnostics (including `blocked`) as exit 0. Tests assert `expectOkEnvelope` for `check --json` and `deep --json` against a missing target, not `expectErrorEnvelope`.

---

## Implementation Units

### U1. Register Storybook Doctor in the integration test suite

**Goal:** Add storybook-doctor contract imports, package root, script name, discovered command IDs, and a `describe` block following the existing worktree/agent-worktree shape.

**Requirements:** R1.

**Dependencies:** None.

**Files:**
- `scripts/command-entrypoint.integration.test.ts`
- `skills/storybook/src/command-contract.ts` (read-only — import)

**Approach:** Import `storybookDoctorContracts` and `StorybookDoctorCommand` from `skills/storybook/src/command-contract.ts`. Derive command IDs with `Object.keys(storybookDoctorContracts).sort()`. Add `packageRoots.storybookDoctor` pointing at the storybook skill directory. Read package scripts from `package.json` the same way worktree and agent-worktree do.

**Patterns to follow:** Lines 37-48 of the integration test (worktree/agent-worktree imports and contract entry derivation). Lines 550-585 (package root resolution and script discovery).

**Test scenarios:**
- Discovered command ID set equals `["check", "commands", "deep"]` (sorted).
- Package scripts object contains `"storybook-doctor"` key.

**Verification:** The `mechanical discovery` describe block includes storybook-doctor assertions and they pass.

### U2. Add help and version integration tests

**Goal:** Prove `--help`, per-command help, and `--version` work through real process spawns.

**Requirements:** R2, R3.

**Dependencies:** U1.

**Files:**
- `scripts/command-entrypoint.integration.test.ts`

**Approach:** Add storybook-doctor to the existing `help contracts` describe block. Use `firstUsageLine(storybookDoctorContracts.check)` for top-level help. Iterate discovered command IDs with `expectDiscoveredCommandHelp`. Add a `--version` test asserting stdout contains `storybook-doctor` and exit 0.

**Patterns to follow:** Lines 663-750 of the integration test (worktree/agent-worktree help and version tests).

**Test scenarios:**
- Top-level `--help` exits 0 and stdout contains the first usage line from the `check` contract.
- Every discovered command's `--help` exits 0 and stdout contains its first contract usage line.
- `--version` exits 0 and stdout contains `"storybook-doctor"`.

**Verification:** All help and version tests pass through process spawns.

### U3. Add discovery, readiness, and usage-error integration tests

**Goal:** Prove `commands --json`, `check --json`, `deep --json`, and usage errors through process spawns.

**Requirements:** R4, R5, R6, R7.

**Dependencies:** U1.

**Files:**
- `scripts/command-entrypoint.integration.test.ts`
- `skills/storybook/src/readiness-model.ts` (read-only — import contract IDs)

**Approach:** Add a `storybook-doctor runtime JSON` describe block. Use a temp directory (via `mkdtempSync`) with no `package.json` as the `--repo` target for `check` and `deep`. Assert `commands --json` returns `expectOkEnvelope` with `STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID`. Assert `check --json --repo <empty>` returns exit 0 with `status: "ok"` and `data.status: "blocked"`. Same for `deep --json`. Assert unknown command with `--json` returns `expectUsageError`. Clean up temp directory in test teardown.

**Patterns to follow:** Lines 760-900 of the integration test (worktree/agent-worktree runtime JSON tests). The `withTempRepo` pattern for temp directory lifecycle.

**Test scenarios:**
- `commands --json` exits 0, envelope status "ok", data.contract_id matches `STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID`.
- `check --json --repo <empty-temp-dir>` exits 0, envelope status "ok", data.status is "blocked", data.contract_id matches `STORYBOOK_DOCTOR_CONTRACT_ID`.
- `deep --json --repo <empty-temp-dir>` exits 0, envelope status "ok", data.status is "blocked", data.contract_id matches `STORYBOOK_DOCTOR_DEEP_CONTRACT_ID`.
- `bogus --json` exits 2, envelope status "error", error code is "usage_error".
- `check` (no `--json`) exits 2 with usage error on stderr.

**Verification:** All runtime JSON tests pass through process spawns. No network access, no running Storybook needed.

---

## Scope Boundaries

- Tests do not require a running Storybook server.
- Tests do not probe MCP endpoints or network.
- Tests do not cover `ready` or `degraded` readiness states (those need a live Storybook and belong in a future integration suite).
- Tests do not cover branch station catalog or evidence projection (covered by unit tests).

### Deferred to Follow-Up Work

- Add integration tests for `ready` state with a local Storybook server (requires test fixture infrastructure).
- Add source-entry and workspace-filter runner modes for storybook-doctor if those invocation paths become relevant.

---

## Sources & Research

- `scripts/command-entrypoint.integration.test.ts` defines the existing integration test patterns.
- `runtime/cli-command-facade/src/testing.ts` and `runtime/cli-command-facade/src/process-testing.ts` export the shared test helpers.
- `skills/storybook/src/command-contract.ts` exports `storybookDoctorContracts`.
- `skills/storybook/src/readiness-model.ts` exports contract ID constants.
