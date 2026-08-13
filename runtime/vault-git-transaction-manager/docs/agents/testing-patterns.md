# Testing patterns for vault-git-transaction-manager

How the test suite proves durable-state, concurrency, and recovery claims here. Read before creating or changing a test in this package. Covers the conventions the layout and `package.json` do not confess; for the durable domain language read `CONTEXT.md`, and complete a `test-design` brief before writing.

## Lane map

Tests split by the claim they prove, not by the file they cover.

- **Unit / composition** (`tests/*.test.ts`) — one collaborator graph, fakes at the edges. Most of the suite.
- **Integration** (`tests/*.integration.test.ts`) — real Git against a temp bare remote, real receipt store on a temp dir. Used where the claim is about real git effects or cross-process recovery.
- **Smoke** (`tests/smoke/*.integration.test.ts`) — spawned `vault-git` CLI subprocesses against a real remote, real SIGKILL. The most expensive lane; `mkSmokeFixture` (`tests/smoke/fixture.ts`) owns setup and the ref snapshots.

## The seam rule

Prove each claim at the lowest layer that honestly reaches it. A generated command string or a fake's canned stdout never stands in for a real git effect, a real process exit, or real trust evidence. When a boundary is faked, the test proves ordering and classification logic — not that the fake matches reality. Name that gap; do not let a green unit stand in for an unobserved real boundary.

## Durable state via an independent reader

Assert persisted state through a reader that did not write it, never the writer's return value. The house move: construct a fresh `createReceiptStore({ stateRoot, repositoryIdentity })` (or a fresh engine/doctor on the same `root`) and read through it.

- Engine recovery: `tests/engine-lifecycle.test.ts` — a fresh store+engine on the interrupted `fixture.root` re-reads the receipt.
- Remote at-most-one-owner: `tests/remote-ledger.test.ts` reads the winner straight off the bare remote with raw `git ls-remote`, bypassing both engines.
- Smoke: `RefSnapshot.remoteRefs` (`for-each-ref` dump) is the independent remote oracle; a stray ref fails the comparison.

## Crash injection wraps the real durability port

Recovery tests interrupt at a named point and prove the receipt survives. Two mechanisms:

- **Engine/runtime** — `FakeRuntime(interruptAt)` throws `interrupt:<point>` at the matching production `runtime.interrupt(...)` call. Points live in `src/engine.ts` (`before_remote_cas`, `after_remote_cas`, `after_local_commit`, `after_release_publication`, …). Interruption is pre-operation.
- **Store durability** — `tests/task-store.test.ts` wraps the *real* `createNodeVaultGitDurabilityPort` and interrupts before a chosen syscall index, so crash-at-each-phase runs against real fsync/link, not a fake.

Inject on both sides of every boundary where duplicate or lost work is possible — claim, launch, checkpoint, terminal write.

## Recovery re-drives through doctor, then repair

`complete()` refuses any phase that is not `writing`/`committing`. Recovery from a `push_pending` receipt does **not** call `complete()` again — it goes `doctor(...) → repair(...)`. The adopt-vs-republish split is driven by `receipt.ledgerReleaseId`:

- crash before the atomic close → `ledgerReleaseId` null → doctor routes `retry-push` → one publish.
- crash after the close, before the terminal receipt → `ledgerReleaseId` set → doctor routes `close-verified` → adopts the published release, **no second `atomicClose`**.

When a recovery test needs the `push_pending` doctor branch, the fakes must also supply `remote.reconcileAtomicClose` and `repository.inspectLocalCommit` — the base engine fakes omit them, and without them doctor returns `receipt_corrupt`. Extend them locally (per-test `Object.assign`), leaving the shared fakes untouched.

## Negative controls prove the test can go RED

A guard is only proven if a disposable perturbation makes its owning test fail. Two forms here:

- **In-file** — for a single guard, satisfy every other clause so the flipped one is the sole variable (a compound `||` guard passes on any clause). Assert the refusal, then confirm removing the production clause flips the assertion. Restore production byte-for-byte; a test-only change leaves `git diff src/*.ts` empty.
- **Recompile-and-run harness** — `tests/background-worker-negative-controls.integration.test.ts` copies src+tests to a temp root, asserts the baseline passes, applies one source mutation, and requires the literal `(fail)` in the owning test's output. This proves a real assertion failed, not a compile error.

The domain guards worth a negative control: at-most-one-owner (`priorWriterStopped`), the launch-generation fence, terminal-refinement (`closed` absorbs), and Doctor's never-its-own-continuation invariant (`nextAction.id !== "run_doctor"`).

## Running tests

`bun test` is not run directly. Use the MCP runner tools with `response_format: "json"`:

- `mcp__bun-runner__bun_testFile` for one file — but it caps at 30s.
- The smoke lane sets `setDefaultTimeout(180_000)` and spawns real subprocesses, so it exceeds that cap. Run smoke files (or a `-t` phase filter) through the skill-local runner `skills/test-runner/src/test-runner.sh --json -- <file> [-t <name>]`, which honors the in-file timeout.
- `package.json` owns the script surface (`test`, `test:smoke`, `test:smoke:pr`); read it there rather than trusting a copy.

The `test:smoke:pr` gate is the cheap merge check: it must exercise every persisted lifecycle phase. A phase left off the `-t` filter ships regressions in that phase green.

## What the suite does not prove

Live SSH transport over the constructed `GIT_SSH_COMMAND`; known-hosts content trust (only metadata is bound); real-process timeout/kill; bounded real concurrency beyond scripted `deferred()` barriers. State these as unproved boundaries rather than letting a lower-layer green imply them.
