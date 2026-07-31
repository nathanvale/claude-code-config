---
name: ci-testbed
description: "Diagnose a CI failure locally instead of re-pushing to the runner. Use when CI is red but tests pass locally, a check is green on your machine yet fails in CI, or you're about to iterate on a hosted runner to find a failing test — reproduce the CI environment on this machine and name the failure in one local run."
role: tool-workflow
---

# CI Testbed

Reproduce a CI failure on this machine so the failing test is found in one local
run, not a dozen slow runner cycles. Re-pushing to a hosted runner to see the
next error wastes minutes per iteration and hides the failure behind compact
output — reproduce the CI *environment* locally instead.

Use when CI is red but the suite passes in your normal checkout, a check is green
on your machine yet fails on the runner, or you're about to push-to-see-the-error.

## First safe action

Run the mechanical CI-repro setup, then read the diagnosis technique:

```
bun run skills/ci-testbed/scripts/ci-repro.ts --ref origin/main --test "<test glob>"
```

It builds a **fresh worktree off the CI base ref**, runs a real
`bun install --frozen-lockfile`, sets `CI=true`, and runs the target tests with a
**failure-naming reporter** — the four things a hosted runner does that a warm
local checkout does not. The named failing test is the output.

Then read `references/ci-diagnosis.md` for the trap catalogue (why a green local
suite goes red in CI) and how to gate the specific cause.

## Invariants (fail closed)

- **A bare git worktree has NO `node_modules`.** Workspace-package imports fail
  there (`Cannot find module @side-quest/...`) and read as a phantom regression.
  Always `bun install` in the repro worktree before trusting any result — a red
  worktree without an install proves nothing.
- **`bun install --frozen-lockfile` on a fresh checkout catches stale workspace
  manifests** (a deleted workspace still listed in `package.json` → "Workspace
  not found"). A warm checkout masks this via its pre-existing install.
- **The compact test-runner hides which test failed** — it emits a summary only.
  To *name* a CI failure, use raw `bun test <path>` (its reporter lists every
  `(fail)` with the file:line), or the runner's `--mode triage`.
- **`CI=true` changes behavior.** Tests may `skipIf(process.env.CI)` or, worse,
  hard-throw at module load when a machine-local tool/adapter is absent. Set
  `CI=true` locally to surface these.
- **Machine-dep hard-throws are a category, not one test.** A test that
  `throw`s when a local binary/adapter is missing (mcporter, a pinned
  browser-connect adapter, `op`, a codesigning identity) fails the *whole file*
  in CI. Find all of them at once (`grep -rlnE "throw.*is missing|not on PATH"`),
  not one CI cycle each.
- **Never chase a CI-only failure by re-pushing.** If two local repro attempts
  can't reproduce it, the runner differs in a named way (missing tool, OS, env
  var) — find that difference, do not fire another runner cycle blind.

## Owners (link, never restate their contracts)

- Test execution + compact/triage output: `skills/test-runner` (`test-runner.sh`).
- Deep root-cause loop once the failing test is named: the `diagnosing-bugs` skill.
- CI workflow authoring / required-check config: the repo's `.github/workflows/`.

## Next safe action

- Failing test named: gate or fix per `references/ci-diagnosis.md`; a real bug
  routes to `diagnosing-bugs`.
- Repro worktree done: remove it (`git worktree remove --force <path>`) — it is
  throwaway.
- Still can't reproduce after two attempts: name the runner-vs-local difference
  (`references/ci-diagnosis.md` → "When local can't reproduce"), don't re-push.
