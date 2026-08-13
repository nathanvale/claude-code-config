# Agent-Native Test Pattern Library

Use the Core Pattern Set for every repository-test artifact change. Add only profiles that match the behaviour and boundary.

## Core Pattern Set

### Name the production consumer and workflow

- State the promise visible outside the implementation.
- Name the production consumer, starting condition, public actions, observable outcome, and failure meaning.
- Keep human, programmatic-agent, developer, integrator, and hosted-system contracts distinct when their public surfaces differ.
- Avoid method names, private branches, and internal call counts unless they are the contract.

### Choose the seam and proof layer

- Use the lowest layer that honestly reaches the claimed boundary.
- Prefer the smallest production-like composition that crosses the collaborating units responsible for the workflow. Keep lower layers for pure edge cases and diagnosis.
- Treat unit, integration, public process, browser or host, and hosted evidence as different claims.
- Give one confidence claim one primary proof layer. Use lower layers as supporting evidence.

### Use an independent expected result or observable

- Derive the oracle independently from the code path under test.
- Prefer public output, durable state, exit status, emitted event, or user-visible behaviour.
- Avoid computing expected and actual values through the same helper.

### Define how the test can go RED

- Name the smallest disposable perturbation that must fail the test.
- Restore the source and confirm GREEN in the same harness.
- Treat a passing test with no demonstrated sensitivity as weak evidence.

### Use the smallest focused command

- Start with one agent-runnable command that executes the intended test.
- Confirm discovery, test count, selector, and exit status before expanding.
- Run broad suites once at the end, not as the inner loop.

### State what the evidence does not prove

- Name skipped, disabled, mocked, platform-specific, live-host, and hosted boundaries.
- Distinguish not proved from proved absent.
- Never let a lower-layer GREEN stand in for an unobserved public boundary.

## Specialist Profile Index

- Public executables, streams, exit status, signals, timeouts, or process ownership: `skills/test-design/references/process-and-cli.md`.
- Rendered UI, browser navigation, accessibility, extensions, or browser identity: `skills/test-design/references/browser-and-ui.md`.
- Durable state, concurrency, ownership, idempotency, crash injection, or recovery: `skills/test-design/references/state-concurrency-recovery.md`.
- Packaging, installation, activation, host UI, live-host, or hosted delivery: `skills/test-design/references/installation-host-hosted.md`.
- Bun, Node, CI, operating systems, shells, paths, permissions, or platform compatibility: `skills/test-design/references/runtime-ci-platform.md`.
- Runner mode, isolation, concurrency, cancellation, cleanup, transforms, selectors, reporters, or test-double lifecycle: read `skills/test-design/references/runner-execution.md` only when runner execution semantics can change the confidence claim.

## Provenance

Read `skills/test-design/references/influences.md` only when reviewing rule provenance or refreshing research-backed guidance.

## Vocabulary

- Public-seam canary: a small test that crosses the same public boundary used by the consumer.
- Negative control: a disposable perturbation expected to make the test fail.
- Sensitivity proof: RED from the negative control followed by restored GREEN in the same harness.
- Remaining unproved boundary: behaviour outside the evidence actually collected.
