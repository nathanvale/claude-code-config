---
title: "fix: harden issue-to-pr runbook-heal final-review closure"
type: fix
status: active
created: 2026-05-24
issue: 72
issue_url: "https://github.com/nathanvale/claude-code-config/issues/72"
depth: standard
---

# fix: harden issue-to-pr runbook-heal final-review closure

## Summary

Issue #72 follows up the final review of issue #71. The runbook-heal closure
form now exists, but its merge-commit rejection is only incidental: the
control-plane guard rejects the current merge fixture because its first-parent
diff reports no touched files, not because merge commits are explicitly
invalid. This plan makes that contract true in code, cleans up the misleading
test fixture label, and records the Stage 5 policy decision exposed by the
P2 findings that spawned this issue.

All paths are repo-relative to `nathanvale/claude-code-config`.

## Problem Frame

`runbooks/issue-to-pr-v2/references/findings-and-validators.md` says a
`runbook-heal <sha>` final-review closure rejects merge commits as vacuous
proof. `validateControlPlaneOnlyCommit` in
`runbooks/issue-to-pr-v2/lib/ledger.ts` currently has no merge-specific guard;
it only happens to reject the existing merge fixture because `git diff-tree`
emits zero rows for that merge in the current invocation. A future merge with a
non-empty first-parent diff could slip through, contradicting the contract.

The same review also exposed a workflow policy gap: Stage 5 automatically
defers P2/P3 findings and the Proposer path is P0/P1-only, so there is no
in-stage "fix this P2 now" lane. This plan records that as an intentional
follow-up issue pattern rather than widening Stage 5 patch authority.

## Scope

In scope:

- Add an explicit merge-commit guard to the runbook-heal control-plane commit
  validator.
- Pin that guard with a test that names the real merge fixture honestly.
- Keep the empty/no-op guard covered without pretending the merge fixture is a
  genuine zero-file no-op.
- Record the Stage 5 P2 policy decision: P2/P3 final-review findings remain
  non-blocking follow-up work, not in-stage patch batches.
- Explicitly defer the lower-priority provenance/shared-reader findings from
  the issue body.

Out of scope:

- Changing the `commit <sha>`, `patch-batch`, or `plan-revision <sha>` closure
  forms.
- Adding a P2-eligible Stage 5 Proposer path.
- Extracting the three git diff readers into a shared helper in this PR.

## Requirements Traceability

| AC | Requirement | Where addressed |
| --- | --- | --- |
| 1 | `validateControlPlaneOnlyCommit` explicitly rejects merge commits and tests pin it | U1 |
| 2 | The runbook-heal empty-commit test uses an honest fixture or label | U1 |
| 3 | Decision recorded on the Stage 5 P2-fix-path gap | U2 |
| 4 | Optional lower-priority findings addressed or explicitly deferred | U2 |

## Key Technical Decisions

1. **Reject merge commits before path allowlist checks.** A merge is not a
   valid runbook-heal proof even when its first-parent diff touches only
   control-plane paths. The guard should fail before `touchedFilesForCommit`
   and `rawDiffHasContentBearingChange`, matching the Stage 5 read-only gate's
   parent-count check.
2. **Use the existing merge fixture as a merge fixture.** `dc6868a` is the PR
   70 merge. Rename/reword the test and constant comments so it proves merge
   rejection, not a fake empty-commit scenario. Keep no-file/no-content
   protection covered by the existing `rawDiffHasContentBearingChange` tests
   and the zero-touched guard semantics.
3. **Keep Stage 5 P2 handling intentionally follow-up based.** P2/P3 findings
   are designed to be recorded and deferred from final review. If an operator
   wants to fix one immediately, the honest path is a follow-up issue and PR,
   as issue #72 is doing. This avoids turning final review into a second
   implementation loop for non-blocking findings.

## Implementation Units

### U1. Explicit runbook-heal merge guard

**Goal:** `validateControlPlaneOnlyCommit` rejects merge commits directly, and
the runbook-heal test fixture labels `dc6868a` as a merge rather than a
genuine empty/no-op commit.

**Files:**

- `runbooks/issue-to-pr-v2/lib/ledger.ts`
- `runbooks/issue-to-pr-v2/lib/ledger.test.ts`

**Approach:** Add a small parent-count helper near the existing git helpers in
`lib/ledger.ts`, mirroring the `decompose.ts` Stage 5 read-only gate. Call it
at the start of `validateControlPlaneOnlyCommit` after reachability has already
resolved the ref. Update the runbook-heal tests so the `dc6868a` case asserts a
merge-specific rejection message and no longer describes the commit as a
genuine empty/no-op. Preserve the zero-touched and mode-only guards as defense
in depth for non-merge vacuous proofs.

**Test scenarios:**

- A `runbook-heal <sha>` final finding citing `dc6868a` fails with a
  merge-specific message.
- A control-plane-only non-merge runbook-heal commit still validates.
- Existing deliverable, mixed, ledger-path, unreachable, grammar, stage-3, and
  batch-loop rejects still behave as before.

```yaml
id: runbook-heal-merge-guard
name: Explicit runbook-heal merge guard
goal: validateControlPlaneOnlyCommit explicitly rejects merge commits and the runbook-heal test fixture labels the merge honestly.
files:
  - runbooks/issue-to-pr-v2/lib/ledger.ts
  - runbooks/issue-to-pr-v2/lib/ledger.test.ts
depends_on: []
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds: a batch_id-final finding fixed by runbook-heal dc6868a is rejected by an explicit merge-commit guard, not only by an empty touched-files side effect."
  - "AC 2 holds: the runbook-heal fixture commentary and test name describe dc6868a as a merge commit, consistent with the new guard."
ac_mapping:
  - 1
  - 2
rationale: "replacement-contract: AC1 and AC2 are inseparable because the same runbook-heal validation test fixture proves the merge guard and fixes the misleading empty-commit label."
```

### U2. Stage 5 P2 policy decision and deferrals

**Goal:** The runbook records that Stage 5 P2/P3 final-review findings remain
follow-up work, not in-stage patch batches, and explicitly defers the optional
lower-priority findings from issue #72.

**Files:**

- `runbooks/issue-to-pr-v2/references/stage-5-final-review.md`
- `runbooks/issue-to-pr-v2/references/findings-and-validators.md`

**Approach:** Add a short decision note to the Stage 5 final-review reference
and cross-link it from the findings closure rules. Keep the rule narrow:
Proposer/patch-batch remains for P0/P1 blockers; P2/P3 findings are recorded
as deferred follow-ups unless the operator opens a new issue/PR. Name the
issue #72 lower-priority findings as explicitly deferred follow-ups rather than
quietly leaving them ambiguous.

**Test scenarios:**

- Documentation states that P2/P3 final-review findings are deferred follow-up
  work, not eligible for Stage 5 Proposer/patch-batch routing.
- Documentation points operators at the follow-up issue pattern used by issue
  #72 for genuine P2s they choose to fix promptly.
- Documentation explicitly defers fr5-001 binding, fr5-004 reachability, and
  fr5-005 shared-reader extraction from the issue body.

```yaml
id: stage5-p2-policy
name: Stage 5 P2 policy decision and deferrals
goal: Record the Stage 5 P2-fix-path decision and explicitly defer lower-priority follow-up findings.
files:
  - runbooks/issue-to-pr-v2/references/stage-5-final-review.md
  - runbooks/issue-to-pr-v2/references/findings-and-validators.md
depends_on:
  - runbook-heal-merge-guard
execution_mode: change_first
acceptance_tests:
  - "AC 3 holds: the Stage 5 reference records that P2/P3 final-review findings are follow-up work rather than in-stage patch batches."
  - "AC 4 holds: fr5-001 binding, fr5-004 reachability, and fr5-005 shared-reader extraction are explicitly deferred as lower-priority follow-ups."
ac_mapping:
  - 3
  - 4
rationale: "docs-only policy recording; no red test would add signal beyond grep-visible documentation checks."
```

## Validation

- Run the focused ledger tests for `runbooks/issue-to-pr-v2/lib/ledger.test.ts`.
- Run type checking for the repo.
- Run the issue-to-pr helper checks for the ledger batches, AC coverage, and
  findings data before Stage 4 starts.

