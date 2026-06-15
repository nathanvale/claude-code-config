---
title: "requirements: command entrypoint integration tests"
date: 2026-06-14
topic: command-entrypoint-integration-tests
type: requirements
---

# Command Entrypoint Integration Tests

## Summary

Add a durable **Command Entrypoint Integration Test** suite for `wt` and
`agent-worktree`.

The suite proves real command entrypoints across process boundaries:
package scripts, source entries, aliases, JSON contracts, temp git repositories,
worktree lifecycle flows, and recovery references.

This is integration coverage, not smoke coverage. "Smoke" is a run style or
confidence level, not the canonical test layer.

## Problem

The ad hoc 56-check front-door run passed, but it is not durable. It proved the
shape once. It does not protect the repo from drift.

Existing package tests cover important unit and package-local behavior, but they
do not fully prove that repo-local command entrypoints still work when invoked
as separate processes.

The gap:

- `wt`, `agent-worktree`, and `awt` can drift from package scripts.
- Source entrypoints can drift from packaged command behavior.
- Help, discovery, parser acceptance, and runtime JSON can drift independently.
- Lifecycle commands can pass imported tests while failing in real temp repos.
- Recovery references can be lost when an error happens after state changes.

## Naming

Canonical term: **Command Entrypoint Integration Test**.

Definition:

> A process-boundary test that proves a command can be invoked through its
> repo-local command entrypoints while preserving the expected machine contract.

Avoid:

- smoke test
- front-door smoke
- command surface proof

Use "smoke" only when describing a fast confidence run style, not this suite's
name.

## Owners

Test owner:

- `scripts/command-entrypoint.integration.test.ts`

Root script owner:

- `package.json`
- Script name: `command-entrypoint:integration`
- Command: `bun test scripts/command-entrypoint.integration.test.ts`

Contract owners:

- `skills/wt/src/command-contract.ts`
- `skills/wt/src/wt.ts`
- `runtime/agent-worktree/src/cli.ts`
- `runtime/agent-worktree/src/index.ts`

Durable vocabulary owner:

- `CONTEXT.md`

## Requirements

### Invocation

- Add one root integration test file at
  `scripts/command-entrypoint.integration.test.ts`.
- Add one explicit root package script named
  `command-entrypoint:integration`.
- Keep the suite out of default `test` and portability gates for v1.
- Promote to `scripts/prove-workspace-portability.ts` only after three clean
  real runs and an explicit gate decision.

### Harness Shape

- Use Bun test.
- Keep the suite table-driven.
- Keep private helpers inside the test file first.
- Extract helpers only after repeated implementation pressure.
- Use a single invocation-mode enum:
  - `package-cwd`
  - `workspace-filter`
  - `source`
- Use package cwd for runtime JSON assertions.
- Use workspace filter only for minimal `--version` probes.
- Use source entries only for compatibility probes.

### Entrypoint Coverage

- Cover `wt` package script.
- Cover `wt` source entry.
- Cover `agent-worktree` package script.
- Cover `agent-worktree` source entry.
- Cover `awt` alias script.
- Cover workspace-filter version probes for:
  - `wt`
  - `agent-worktree`
  - `awt`

Source-entry probes are intentionally small:

- `--version`
- top-level help

Do not duplicate full per-command JSON or lifecycle coverage through source
entries.

### Discovery Coverage

- Derive command ids mechanically before behavior cases.
- Use package scripts and exported command contracts as the discovery source.
- Assert exact command id sets.
- Do not snapshot full discovery metadata in this suite.
- Leave detailed metadata and help alignment to package-local contract tests.

Required command id surfaces:

- `wt`: `sync`, `focus`, `color`, `open`, `new`, `rm`, `clean`, `commands`
- `agent-worktree`: `doctor`, `list`, `create`, `status`, `check`, `delete`,
  `clean`, `recover`, `refresh`, `inspect`, `handoff`, `commands`

### Help Coverage

- Run top-level help for every CLI entrypoint.
- Run per-command help for every discovered command.
- Assert exit code `0`.
- Assert the usage line only.
- Avoid brittle full help snapshots.

Expected usage assertion shape:

- `Usage: wt <command>`
- `Usage: agent-worktree <command>`

### Runtime JSON Coverage

- Assert stable JSON fields only.
- Assert `status`.
- Assert `data.contract_id`.
- Assert command-owned stable fields when they are the behavior under test:
  - `action`
  - `preview`
  - `changed_state`
  - `run_ref`
  - `failure_ref`
- Avoid full JSON snapshots.
- Include stdout and stderr excerpts in failure messages.
- Include command mode and cwd in failure messages.

### Real Git Coverage

- Use real temp git repositories for lifecycle and render flows.
- Create real commits.
- Seed local `origin/HEAD` evidence where branch logic depends on it.
- Exercise real `git worktree add`.
- Exercise real `git worktree remove`.
- Do not mutate the repo under test outside temp directories.

### `wt` Required Behavior

Preserve the proven package-script matrix:

- `wt --version`
- `wt` top-level help
- `wt commands --json`
- invalid command failure
- `wt sync`
- `wt focus`
- `wt color`
- `wt clean`
- `wt new`
- `wt rm`
- `wt open --json`

`wt open` coverage is list mode only.

Do not run `wt open <name>` in this suite because GUI launch is outside the
integration boundary.

### `agent-worktree` Required Behavior

Preserve the proven package-script matrix:

- `agent-worktree --version`
- `awt --version`
- `agent-worktree` top-level help
- `awt` top-level help
- `agent-worktree commands --json`
- `awt commands --json`
- invalid command failure
- `agent-worktree doctor`
- `agent-worktree list`
- `agent-worktree status`
- `agent-worktree create --dry-run`
- `agent-worktree create`
- `agent-worktree check`
- `agent-worktree delete --dry-run`
- `agent-worktree refresh --dry-run`
- `agent-worktree refresh`
- `agent-worktree inspect <run_ref>`
- `agent-worktree handoff`
- `agent-worktree clean --preview`
- `agent-worktree delete`

Add branch-deletion preview coverage:

- `agent-worktree delete <branch> --dry-run --delete-branch --json`
- Assert `preview: true`.
- Assert planned changes include branch deletion.
- Do not run full branch deletion in v1.

### Failure And Recovery Coverage

Keep protected-branch failure continuity:

- Run `agent-worktree delete main --force --json` in a temp repo.
- Expect non-zero runtime failure.
- Capture `failure_ref`.
- Run `agent-worktree inspect failure:<id> --json`.
- Run `agent-worktree recover failure:<id> --dry-run --json`.
- Assert recovery is a preview and preserves the ref path.

This guards against state changes or lifecycle failures losing follow-up
recovery metadata.

### Timeout And Cleanup

- Use explicit test block timeouts around `30_000ms`.
- Use a per-command spawn timeout around `15_000ms`, unless implementation
  discovers a reliable lower value.
- Kill timed-out commands.
- Clean temp roots on success.
- Keep temp roots on failure.
- Print kept temp root paths in failure output.

### Adversarial Pass

Run discovery in two passes:

1. Mechanical pass from package scripts and command contracts.
2. Adversarial process-boundary pass.

Add a case only when it proves a distinct command entrypoint or boundary.

Do not add duplicate assertions for confidence theater.

## Acceptance Criteria

- `bun run command-entrypoint:integration` passes from the repo root.
- The suite runs `wt`, `agent-worktree`, and `awt` through process entrypoints.
- The suite covers source-entry `--version` and top-level help.
- The suite covers exact command ids for both CLIs.
- The suite covers per-command help usage lines.
- The suite covers stable JSON behavior for lifecycle commands.
- The suite uses real temp git repositories for lifecycle flows.
- The suite proves `wt new` and `wt rm` through real worktree operations.
- The suite proves `agent-worktree create`, `check`, `refresh`, `delete`,
  `inspect`, `handoff`, and `clean` through process calls.
- The suite proves protected-branch failure refs are inspectable and recoverable.
- The suite proves branch deletion planning with dry-run only.
- The suite launches no GUI.
- The suite leaves no temp roots behind after success.
- The suite prints temp root paths after failure.
- The suite is not part of default test gates until promoted.

## Out Of Scope

- Full source-entry command matrix.
- Full branch deletion execution.
- GUI launch coverage for `wt open <name>`.
- Full JSON snapshots.
- Full help snapshots.
- Replacing package-local unit or contract tests.
- Immediate portability-gate wiring.

## Research Notes

Official docs and community signal support the chosen shape:

- Bun tests have default timeouts and support explicit per-test timeouts.
- Bun test supports lifecycle hooks such as `beforeAll` and `afterAll`.
- Bun spawned processes support `cwd`, environment control, stdout/stderr
  capture, and timeouts.
- Bun kills spawned processes when a test times out.
- Node's test timeout behavior is useful but not a complete cancellation model
  if the app thread is blocked.
- Bun does not currently expose a stable programmatic test-runner API; spawning
  CLI processes is the practical community path.
- Recent community signal is sparse, but the observed pattern is pragmatic:
  spawn real CLIs, create temp projects, assert exit codes and stable stdout,
  use explicit timeouts, and avoid brittle snapshots.

Sources:

- https://bun.com/docs/test
- https://bun.com/docs/test/writing-tests
- https://nodejs.org/api/test.html
- https://github.com/oven-sh/bun/issues/26191
- https://github.com/oven-sh/bun/issues/5411

## Planning Notes

Next safe action:

1. Add the root script.
2. Add the table-driven integration file.
3. Port the proven 56-check matrix.
4. Add source top-level help probes.
5. Add branch-deletion dry-run preview.
6. Run the suite three times from a clean temp context.
7. Decide whether to promote into portability verification.
