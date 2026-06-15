# Testing And Harness Bad Practices

Use with the package's local test style, `skills/test-runner/SKILL.md`, and
the owner paths for the command or runtime being tested.

## Catalog

### Wrapper-output assertions

- Smell: asserting CLI JSON, help, or stdout through a package workspace wrapper.
- Why it fails: wrappers can truncate, decorate, or reroute output.
- Better substitute: assert output through the direct runner; keep wrapper invocations as smoke only.
- Owner path: `skills/create-cli/references/cli-command-facade.md`.
- Evidence class: observed failure.
- Downstream candidate: `create-cli`, `test-runner`.

### Global cwd mutation

- Smell: using `process.chdir` to test cwd-sensitive behavior.
- Why it fails: tests leak state across files and become order-sensitive.
- Better substitute: pass `{ cwd }` through the runtime, injected runner, or `Bun.spawn`.
- Owner path: local test harness.
- Evidence class: observed failure.
- Downstream candidate: `test-runner`, review skill.

### Silent subprocess setup

- Smell: helper runs a setup command and discards stdout, stderr, and exit code.
- Why it fails: fixture failure appears later as unrelated product failure.
- Better substitute: collect command, cwd, stdout, stderr, and code; fail at setup boundary.
- Owner path: local test harness.
- Evidence class: observed failure.
- Downstream candidate: `test-runner`, review skill.

### Real fixture everywhere

- Smell: every branch uses real git, filesystem, network, or process fixtures.
- Why it fails: tests become slow, flaky, and hard to diagnose.
- Better substitute: use fake runners for semantic branches; keep one real production-path regression.
- Owner path: `skills/test-runner/SKILL.md`.
- Evidence class: observed failure.
- Downstream candidate: `test-runner`, `seam-scaffold`.

### Mock without observable calls

- Smell: fake runtime returns canned results but does not record argv, cwd, writes, or launches.
- Why it fails: tests prove output but miss wrong authority or wrong target behavior.
- Better substitute: fake runtimes record calls and assert cwd, argv, side effects, and skipped destructive calls.
- Owner path: `skills/test-runner/SKILL.md`.
- Evidence class: observed failure.
- Downstream candidate: review skill, `test-runner`.

### Contract tests that run the product

- Smell: command-contract tests spawn the runner or exercise IO behavior.
- Why it fails: contract failures and runtime failures blur together.
- Better substitute: keep contract tests pure; put subprocess and IO behavior in runner tests.
- Owner path: local test harness.
- Evidence class: review finding.
- Downstream candidate: review skill.

### Exit-code-only assertions

- Smell: test only checks exit code for a CLI envelope.
- Why it fails: a command can fail or succeed for the wrong reason.
- Better substitute: assert status, error or data fields, continuation, stderr stance, and exit code.
- Owner path: command contract or runner tests.
- Evidence class: observed failure.
- Downstream candidate: `create-cli`, `test-runner`.

### Snapshot as behavior oracle

- Smell: large snapshots become the only behavior assertion.
- Why it fails: reviewers update noise and miss semantic drift.
- Better substitute: assert stable semantic fields; use snapshots only for compact render shape.
- Owner path: local test harness.
- Evidence class: review finding.
- Downstream candidate: review skill, `test-runner`.
