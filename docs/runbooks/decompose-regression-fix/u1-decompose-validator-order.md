# Runbook: Decompose fixture merge-commit fragility (U1)

**Seam:** Repair `currentCommitFiles` in `runbooks/issue-to-pr-v2/decompose.test.ts`
(and its v1 mirror) so that when HEAD is a merge commit, the helper still
returns a non-empty list of files touched in HEAD. The 21 failing tests in both
files all have fixtures built from `currentCommitFiles`, so an empty list
silently makes every fixture have empty `files:` arrays, which legitimately
trips the `b.files.length === 0` validator.

**Naming note.** The file name `u1-decompose-validator-order.md` is preserved for
continuity with the original `/loop` invocation. After diagnosis the actual seam
is "fixture fragility against merge-commit HEAD"; the validator-order hypothesis
turned out to be a downstream symptom, not the cause. See ledger row 1.

## Central risk

Test fixtures that rely on shelling out to git at module-load time are
fragile against environmental git state (merge commits, shallow clones, detached
HEAD). The fix has to make the fixture **resilient** without changing what the
fixture means - the digest computations (`oneBatchContractDigest`, batch
contract digests inside the ledger) rely on `currentCommitFiles` being the
**same** value on both sides of the comparison: the value used to build the plan
fixture and the value used to compute the expected digest. So the fix must (a)
return a non-empty list for merge-commit HEADs, (b) return the same list
deterministically each time, and (c) preserve the byte-for-byte parity between
v1 and v2 mirrors per U3's contract.

## Pre-existing test surface (read-only context)

| Test surface | What it covers | This seam's boundary |
| --- | --- | --- |
| `runbooks/issue-to-pr-v2/cli-smoke.test.ts` | Process-boundary smoke for every `cli.ts` command x every documented contract (U10 surface) | Read-only; 51/51 must stay green |
| `runbooks/issue-to-pr-v2/cli.test.ts` | Unit-level envelope shape, AC1-AC7 contracts, U6 version-skew, U5 packet rendering | Read-only; must stay green |
| `runbooks/issue-to-pr-v2/lib/*.test.ts` | lib internals - route classification, packet rendering, ledger parsing, digest, validate | Read-only; must stay green |
| `runbooks/issue-to-pr-v2/decompose.test.ts` | v1-compat helper surface | Writable (fixture block only) |
| `runbooks/issue-to-pr/decompose.test.ts` | v1 mirror | Writable (fixture block only, byte-for-byte parity with v2) |

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/decompose.test.ts` - edit only the
  `currentCommitFiles` initializer block (around lines 17-31). Do NOT modify
  any `test()` body, any `describe()` block, any helper function body, or any
  per-test fixture string. The block must keep `currentCommit` and `currentCommitFull`
  unchanged - only `currentCommitFiles` is touched.
- `runbooks/issue-to-pr/decompose.test.ts` - apply the byte-for-byte equivalent
  edit to the v1 mirror per U3's parity contract.

**Read-only (frozen):**

- `runbooks/issue-to-pr-v2/lib/ledger.ts` - the validator under suspicion in
  issue #61. Confirmed not the cause; do NOT modify.
- `runbooks/issue-to-pr-v2/lib/*.ts` - all lib source. Same rule.
- `runbooks/issue-to-pr-v2/lib/*.test.ts` - all lib tests.
- `runbooks/issue-to-pr-v2/cli.ts` and `cli.test.ts` (U4 surface)
- `runbooks/issue-to-pr-v2/cli-smoke.test.ts` (U10 surface - 51/51 must stay
  green)
- `runbooks/issue-to-pr-v2/decompose.ts` (the v2 compatibility shim - just
  re-exports from lib/ledger.ts, no logic to fix here)
- `runbooks/issue-to-pr/decompose.ts` - v1 source. Frozen baseline.
- `runbooks/issue-to-pr-v2/issue-to-pr.md` (U7 hot router)
- All `runbooks/issue-to-pr-v2/references/*.md` and `templates/*.md`
- `runbooks/issue-to-pr-v2/README.md` and `runbooks/issue-to-pr/README.md`
- All `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` files
- `tsconfig.json`, `install.sh`
- All `docs/runbooks/issue-to-pr-v2-refactor/*.md` (those seams are
  already converged)

## What this seam is NOT - explicit anti-list

- **No edits to `lib/ledger.ts`.** Issue #61's hypothesis that the validator
  order is the bug turned out to be wrong; the fix is in the test fixture, not
  the validator. If a follow-on bug is found in validator order while
  investigating, file it as a separate GitHub issue and flag it in the ledger.
- **No edits to per-test fixture bodies.** Each of the 21 failing tests builds
  its own fixture string that may interpolate `currentCommitFiles`. Do not
  touch those interpolations - the fix is upstream, in the
  `currentCommitFiles` initializer.
- **No deletion or `test.skip` on any of the 21 failing tests.** Each one is
  asserting a real contract; the fix is the fixture, not the test set.
- **No changes to `tsconfig.json`, `install.sh`, or hot-router/references/templates.**
  None are involved in this regression.
- **No new test files.** This is a one-line-style fixture repair.
- **No git history rewrites.** The merge commit at `7650a38` is on `main` and
  stays there.

## Matrix structure

The fix MUST cover, in order:

1. **Diagnose**: confirm the suspected root cause from issue #61. Confirmed
   refuted: `git diff-tree --no-commit-id --name-only -r --root HEAD` returns
   empty for merge commits without `-m`. Recorded in ledger row 1.
2. **Decide approach**: prefer `-m` flag with dedup over `ls-tree -r` because
   `-m` preserves the semantics "files touched in HEAD" (which is what the test
   digests and `currentCommittedAttemptYaml(touched)` invariants rely on).
   Recorded in ledger row 2.
3. **Implement on v2 first**: modify the `currentCommitFiles` block in
   `runbooks/issue-to-pr-v2/decompose.test.ts`. Pass `-m`. Dedup the result.
   Verify with a focused failing test that the fixture now populates files
   correctly.
4. **Run the v2 test suite focused**: `bun test
   runbooks/issue-to-pr-v2/decompose.test.ts` - expect 78/78 pass.
5. **Mirror to v1**: apply byte-for-byte equivalent change to
   `runbooks/issue-to-pr/decompose.test.ts`. U3's contract is that the v1
   mirror and v2 source stay in lockstep.
6. **Run the v1 test suite focused**: `bun test
   runbooks/issue-to-pr/decompose.test.ts` - expect 78/78 pass.
7. **Run the full v2 suite paranoia check**: `bun_runTests pattern:
   "issue-to-pr-v2"`. Zero failures. U10's cli-smoke must stay 51/51.
8. **Run tsc + biome on every touched file**: zero errors, zero warnings.
9. **Run /ce-code-review** with reviewers: correctness, testing,
   maintainability, api-contract, scope-guardian. Iterate to zero new
   findings per the U10 pattern (4 passes max).

## Implementation pattern

The fix is scoped to `runbooks/issue-to-pr-v2/decompose.test.ts` lines around
17-31 (and the matching v1 block). The intent is:

```typescript
// Before:
const currentCommitFiles = new TextDecoder()
  .decode(
    Bun.spawnSync([
      "git",
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--root",
      currentCommit,
    ]).stdout,
  )
  .trim()
  .split("\n")
  .filter((file) => file.length > 0);

// After:
const currentCommitFiles = [
  ...new Set(
    new TextDecoder()
      .decode(
        Bun.spawnSync([
          "git",
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-m",
          "--root",
          currentCommit,
        ]).stdout,
      )
      .trim()
      .split("\n")
      .filter((file) => file.length > 0),
  ),
];
```

The `-m` flag tells `git diff-tree` to emit per-parent diffs for merge commits
(otherwise merge commits show an empty diff). `[...new Set(...)]` dedupes the
union when the same file appears in both parents' diffs. For non-merge
commits, the dedup is a no-op (each file appears once already).

## Suggested reviewer personas

Always-on:

- `compound-engineering:ce-correctness-reviewer` - the fix actually resolves
  the 21 failing tests; no new failures elsewhere in the v1/v2 suites; the
  `-m` flag plus dedup returns the right semantics for both merge-commit and
  non-merge-commit HEADs.
- `compound-engineering:ce-testing-reviewer` - the 21 tests still test what
  their titles claim (mode/id/dependency contract violations and confirmation
  state derivation); the fix does not loosen test intent; no test was deleted
  or skipped.
- `compound-engineering:ce-maintainability-reviewer` - the fixture change is
  the smallest possible and explains itself (a single comment line is
  acceptable for the `-m` flag rationale).
- `compound-engineering:ce-api-contract-reviewer` - the validator order in
  `lib/ledger.ts` was correctly NOT changed; the `b.files.length === 0`
  contract stays first; no caller depending on `has no files` being the first
  error sees a different error.
- `compound-engineering:ce-scope-guardian-reviewer` - the diff respects the
  anti-list (no `lib/ledger.ts` edits, no `decompose.ts` edits, no per-test
  fixture-body edits, no new files, no skipped tests).

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split).** The fix is mechanic-only -
  fixing how tests bootstrap their fixture data. No orchestration claims.
- **ADR 0002 (CLI emits facts, not orchestration).** Untouched.
- **U3 byte-for-byte parity.** v1 and v2 `decompose.test.ts` files must remain
  byte-for-byte identical for the modified block. The `bun_runTests` pattern
  must stay green for both trees.

## Scoped audit prompt

```text
Review the decompose fixture merge-commit fragility fix. Two files changed:
`runbooks/issue-to-pr-v2/decompose.test.ts` and
`runbooks/issue-to-pr/decompose.test.ts`. The edit is scoped to the
`currentCommitFiles` initializer block - adds the `-m` flag to `git diff-tree`
and dedupes the result with `[...new Set(...)]`. No other test code or source
code is changed.

Audit items:

1. Does the fix make `bun test runbooks/issue-to-pr-v2/decompose.test.ts`
   return 78/78 pass, with all 21 originally-failing tests now green?
2. Does the v1 mirror return the same 78/78 pass count?
3. Does the full v2 pattern (`issue-to-pr-v2`) return zero failures?
4. Does the cli-smoke suite stay 51/51 green (U10 surface untouched)?
5. Are the v1 and v2 fixture blocks byte-for-byte identical inside the
   modified region?
6. Does the dedup preserve the **order** of the original `git diff-tree -m`
   output? Order matters because `oneBatchContractDigest` and other digests
   hash a JSON.stringify(batch list) where the file array order is
   deterministic.
7. Did the fix touch any `test()` body, `describe()` block, helper function,
   or per-test fixture string outside the `currentCommitFiles` initializer?
   If yes, that is out of scope.
8. Did the fix touch any file under `runbooks/issue-to-pr-v2/lib/` or the v1
   `runbooks/issue-to-pr/decompose.ts`? If yes, that is out of scope - the
   validator order is correct.
9. Does the fix introduce a fallback for the case where even `git diff-tree -m`
   returns empty? (E.g., initial-commit repos, shallow clones with no commit
   history.) Is the lack of fallback acceptable given the test runs only in
   this repo where HEAD always has at least one parent?

Severity:
- P0: any of the 21 originally-failing tests is still failing; any previously
  passing test is now failing; the fix modified `lib/*.ts` or the v1
  `decompose.ts` source; the v1 and v2 fixture blocks have drifted.
- P1: the dedup loses ordering and produces a different digest for the same
  HEAD on different runs (non-deterministic); a `test()` body or per-test
  fixture string was touched outside the agreed-scope block.
- P2: the comment explaining the `-m` flag is missing or unclear; the dedup
  uses an O(n^2) approach where Set is available.
- P3: minor formatting or comment cleanup.

Return findings with stable kebab-case signatures (e.g.
`fix-21-failing-tests-still-red`,
`v1-v2-fixture-block-drifted`,
`dedup-loses-original-order`,
`fix-touched-out-of-scope-source`).

Do NOT propose edits to `lib/ledger.ts`. Do NOT propose validator-order
changes - the validator order is correct. Do NOT propose new tests or
test-file restructuring; the seam is the fixture initializer.
```

## Closing a finding without fixing it

Seam-specific close reasons:

- `not-in-this-seams-scope` - finding belongs to a different unit or follow-on
  (e.g. a real lib/ledger.ts bug surfaced while investigating; a request to
  add new validator paths).
- `out-of-scope-validator-reorder` - finding requests reordering the batch
  validators per issue #61's original hypothesis. Refuted; the validator order
  is correct.
- `fixture-bootstrap-fragility-out-of-scope` - finding requests harder-bounded
  protection against future git environmental drift (e.g. shallow clones,
  initial-commit repos). Out of scope; document as residual risk.

## Stop condition

Stop when ALL of the following hold:

1. `bun test runbooks/issue-to-pr-v2/decompose.test.ts` returns 78/78 pass.
2. `bun test runbooks/issue-to-pr/decompose.test.ts` returns 78/78 pass.
3. `bun_runTests pattern: "issue-to-pr-v2"` returns zero failures.
4. `bun_runTests pattern: "cli-smoke"` returns 51/51 (U10 untouched).
5. `tsc_check` clean across all touched files.
6. `biome_lintCheck` clean across all touched files.
7. The most recent `/ce-code-review` pass returns zero new findings.
8. Every ledger row in `u1-decompose-validator-order-ledger.md` is `fixed` or
   `closed`.
9. v1 and v2 fixture blocks (`runbooks/issue-to-pr/decompose.test.ts` and
   `runbooks/issue-to-pr-v2/decompose.test.ts`) are byte-for-byte identical
   inside the modified `currentCommitFiles` region per U3's contract.

## /loop fallback

```text
/loop 5 Follow docs/runbooks/decompose-regression-fix/u1-decompose-validator-order.md.
Re-read the runbook and u1-decompose-validator-order-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
