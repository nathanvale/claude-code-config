# Decompose regression fix - iterative review runbook

Single-seam runbook for closing GitHub issue
[#61](https://github.com/nathanvale/claude-code-config/issues/61): 21 pre-existing
test failures in `runbooks/issue-to-pr/decompose.test.ts` (v1) and
`runbooks/issue-to-pr-v2/decompose.test.ts` (v2 byte-for-byte mirror) that the v2
refactor (#48 / #59) merged through unchanged.

Each seam pins one slice of the test/contract surface and converges via repeated
sweeps until the seam's audit produces zero new findings. This area has exactly
one seam.

## Why this seam

Issue #61's hypothesized root cause (`has no files` validator firing before
mode/id-shape checks) turned out to be a downstream symptom, not the cause. The
real cause is **test-fixture fragility against merge-commit HEADs**: the v1 and
v2 `decompose.test.ts` files build their batch `files:` arrays by shelling out
to `git diff-tree --no-commit-id --name-only -r --root HEAD` at test-load time.
For a merge-commit HEAD (the current `main` after #59 / #60), that command
returns an empty list, which in turn makes 21 test fixtures have zero files,
which legitimately trips the `b.files.length === 0` validator. The validator
is doing the right thing; the fixture is wrong.

The fix is therefore scoped to the fixtures, not the validators. v1 and v2
source files in `lib/ledger.ts` and `decompose.ts` stay frozen; only the test
files change.

**Contract-shaped seams**:

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
| Decompose fixture merge-commit fragility | [u1-decompose-validator-order.md](u1-decompose-validator-order.md) | [u1-decompose-validator-order-ledger.md](u1-decompose-validator-order-ledger.md) | Writable: `runbooks/issue-to-pr-v2/decompose.test.ts`, `runbooks/issue-to-pr/decompose.test.ts`. Read-only: everything else, including all `lib/*.ts`, the v1 `decompose.ts` source, all v2 references and templates, the U7 hot router, the U10 cli-smoke surface, `tsconfig.json`, `install.sh`, and all `docs/runbooks/issue-to-pr-v2-refactor/*.md`. |

## Naming note

The seam runbook is named `u1-decompose-validator-order.md` for continuity with
the user-supplied scaffolding request. After diagnosis, the actual seam is
"merge-commit fixture fragility" rather than "validator order"; the file name is
preserved so the original `/loop` invocation continues to point at the right
runbook.

## Invocation

```text
/goal Follow docs/runbooks/decompose-regression-fix/u1-decompose-validator-order.md.
Re-read the runbook and u1-decompose-validator-order-ledger.md at the start of every
turn. Drive every ledger row to status fixed or closed and the most recent
/ce-code-review pass to zero new findings. Echo the full ledger status table
inline at the end of every turn. Stop after 30 turns.
```

## Driver: /goal vs /loop

| | `/goal` (preferred) | `/loop` (fallback) |
| --- | --- | --- |
| Re-fire trigger | Previous turn finishes | Time interval elapses |
| Stop condition | Evaluator model confirms condition holds | You stop it, or agent decides |
| Verifies via | Conversation transcript only | Same |
| Min version | Claude Code v2.1.139+ | Any |

`/goal`'s evaluator (a small fast model, Haiku by default) reads only the
**conversation transcript**, not the filesystem. The runbook is designed so the
agent **echoes the ledger status table inline at the end of each turn**.

## Turn protocol (shared)

The seam runbook defines:

1. Files in scope
2. Suggested reviewer personas (passed to `/ce-code-review` to spawn in parallel)
3. The scoped audit prompt for `/ce-code-review`
4. Seam-specific ADR guardrails

The shared protocol every turn follows:

1. Read the runbook and the seam's ledger fresh
2. Run `/ce-code-review` with the scoped audit prompt and suggested personas
3. For each finding, compute a stable kebab-case signature
4. Dedupe against the ledger (fixed/closed -> drop; open match -> leave; else insert new open row)
5. Classify each open finding `low` | `high` per the risk policy below
6. For `high`: pause and ask the user
7. Apply the [Fix protocol](#fix-protocol-shared) to the approved queue
8. Re-run `/ce-code-review` and repeat dedupe
9. Echo the full ledger status table inline at the end of every turn

Stop condition: every ledger row is `fixed` or `closed`, and the most recent
`/ce-code-review` pass reports zero new findings.

## Fix protocol (shared)

For each open finding:

1. Confirm the signature is not already `fixed` or `closed` in the ledger.
2. If the risk is `high`, stop and ask Nathan before editing.
3. If the risk is `low`, make the smallest contract edit to the writable surface
   in scope that resolves the finding. Keep all anti-list files read-only.
4. Update the ledger row with `status: fixed` or `status: closed` and a concise
   resolution. Ledger bookkeeping and convergence notes are allowed; use
   `closed` only when the runbook's close reasons apply.
5. Re-read the touched test file and confirm v1 and v2 mirrors stay in
   byte-for-byte parity for the modified `currentCommitFiles` block per U3's
   contract.
6. Re-run the focused test commands. New findings get new stable signatures;
   repeat until every row is `fixed` or `closed` and the most recent review
   pass reports zero new findings.

## Risk classification (auto-fix gate)

**Low risk - auto-fix without asking:**

- Edits inside the `currentCommitFiles` initializer block in the two
  `decompose.test.ts` files
- Optional dedup, fall-back, or comment edits inside the same block
- Ledger bookkeeping that records, fixes, closes, or summarizes findings already
  produced by the U1 review loop

**High risk - pause and ask:**

- Any change to any file under `runbooks/issue-to-pr-v2/lib/`
- Any change to `runbooks/issue-to-pr/decompose.ts`
- Any change to the per-test fixture bodies (the test() blocks themselves) -
  including reordering or rewording assertions, populating `files:` per test,
  or skipping any failing test
- Any change to `tsconfig.json`, `install.sh`, the U7 hot router, U10
  cli-smoke, references, templates, or `docs/runbooks/issue-to-pr-v2-refactor/`
- Anything that contradicts ADR 0001 or ADR 0002

## Ledger format

The seam's ledger file holds one row per finding. Status moves
`open -> fixed | closed`. A finding's `signature` is what dedupe matches on
across passes - keep it stable.

```markdown
| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

## Closing reports

When the seam converges, run:

```text
/runbook-orchestrator report docs/runbooks/decompose-regression-fix u1-decompose-validator-order
```

This generates `u1-decompose-validator-order-report-<YYYY-MM-DD>.md` with a
ledger summary, a files-touched list, and a tightness assessment via the
`improve-codebase-architecture` skill.

## Parallel execution

Do **not** run multiple runbooks concurrently in the same checkout - the fix
steps will collide on shared files. Either:

- Run them sequentially in a single checkout
- Use separate worktrees (`compound-engineering:ce-worktree`)
