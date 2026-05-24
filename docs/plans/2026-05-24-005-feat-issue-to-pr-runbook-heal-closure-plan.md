---
title: "feat: honest closure for issue-to-pr in-run runbook-heal findings"
type: feat
status: active
created: 2026-05-24
issue: 71
issue_url: "https://github.com/nathanvale/claude-code-config/issues/71"
depth: standard
---

# feat: honest closure for issue-to-pr in-run runbook-heal findings

## Summary

When an `issue-to-pr` run heals a defect in its own runbook mid-run, the
resulting Stage 5 final-review finding (`batch_id: final`) has no honest
closure path: `resolution: commit <sha>` requires the commit live in a terminal
batch, `patch-batch` requires the deliverable path, and
`out-of-scope-for-this-issue` means "different issue." This plan adds a guarded
`resolution: runbook-heal <sha>` closure form so status and resolution agree,
adds a Stage 5 read-only enforcement gate, documents the blocked-by-doc-defect
carve-out, and decides the disposition of the historical contradictory rows in
the issue-68 ledger.

All paths are repo-relative to the repo root (`nathanvale/claude-code-config`).
The deliverable is the `issue-to-pr` v2 runbook and its `lib/` code under
`runbooks/issue-to-pr-v2/`.

## Problem Frame

This is the recursion the issue is about: the workflow healing its own runbook
produces findings the workflow cannot honestly close. The finding-closure
contract (`runbooks/issue-to-pr-v2/lib/ledger.ts` `validateFinalFindingResolution`,
`validateLedgerOwnedFixedCommit`) was designed assuming every `fixed` finding
is closed by a Builder commit inside a confirmed batch. A runbook self-heal
commit is reachable but lives in no batch, so the only statuses the validator
accepts misrepresent it. The fix must stay narrow: it must NOT become a backdoor
for closing *deliverable* findings off-batch.

## Scope

In scope:

- A `resolution: runbook-heal <sha>` form under `status: fixed` for
  `batch_id: final` findings ONLY, accepting a reachable commit without
  terminal-batch membership. (Revision r1/CR-003: stage-3 findings keep their
  existing `plan-revision <sha>`-only contract; `validateFindingResolution`
  short-circuits stage-3 before the commit/patch/runbook-heal arms, so adding
  runbook-heal there would be dead code. Mirror the existing
  `validateLedgerOwnedFixedCommit` `final` special-case.)
- An abuse guard: the cited commit's diff must touch ONLY control-plane paths
  under `runbooks/issue-to-pr-v2/` or `skills/issue-to-pr/`. ANY other touched
  path rejects the commit, including deliverable files (`src/**`, `docs/scratch/**`,
  etc.) AND the per-issue ledger path under `docs/runbooks/issue-to-pr/`
  (revision r1/CR-004: the ledger is NOT control-plane; a runbook-heal commit is
  a pure runbook fix, and the ledger checkpoint is always a separate commit). A
  commit touching both a control-plane path and any non-allowlisted path is
  rejected, naming the offending non-allowlisted path. Allowlist match is
  path-prefix.
- A Stage 5 read-only enforcement gate (a validate-time check that a Stage 5
  ledger checkpoint commit touches only the ledger path).
- Documentation: closure-table row, Stage 5 cross-reference, blocked-by-doc-defect
  carve-out.
- A decision (and its execution) on the historical fr-001..fr-004 rows in the
  issue-68 ledger.

### Deferred to Follow-Up Work

- Generalizing the runbook-heal path to runbooks other than `issue-to-pr-v2`
  (the abuse-guard path allowlist can be widened later if needed).
- #69 (Stage 4 trivial-diff reduced-wave) remains a separate concern.

Out of scope:

- Changing the patch-batch or Builder-commit closure forms.
- Relaxing the open-P0/P1 convergence gate.

## Requirements Traceability

| AC | Requirement | Where addressed |
| --- | --- | --- |
| 1 | runbook-heal finding closeable as `fixed` with agreeing status+resolution | U1 |
| 2 | Closure form rejects a commit whose diff touches deliverable files | U1 (abuse guard) |
| 3 | Stage 5 ledger checkpoint touches only the ledger path; violations surfaced | U2 |
| 4 | Blocked-by-doc-defect carve-out documented | U4 |
| 5 | Tests pin accept / deliverable-reject / Stage-5-read-only-violation | U1 + U2 (test-first) |
| 6 | Decide + execute disposition of historical fr-001..fr-004 rows | U5 (Stage 3 user gate) |

## Key Technical Decisions

1. **`runbook-heal <sha>` is a new RESOLUTION grammar under the existing
   `status: fixed`, not a new status, and only for `batch_id: final`.** Keeps
   `FINDING_STATUSES` unchanged, keeps "fixed means fixed," and avoids touching
   the open-P0/P1 predicate and the rendered-table/status machinery. Rationale:
   the finding *was* fixed; only the *provenance* of the fixing commit differs.
   The new arm sits beside the `commit <sha>` and `patch-batch` arms inside the
   `batch_id: final` path of `validateFindingResolution` (`lib/ledger.ts`
   ~L2497-2554), AFTER the stage-3 plan-revision short-circuit (~L2503-2509) so
   it never shadows that contract.
2. **Abuse guard reuses `touchedFilesForCommit(ref, context)`** (already in
   `lib/ledger.ts` ~L2163) to get the commit's changed paths, then asserts EVERY
   touched path is prefix-matched by the control-plane allowlist
   (`runbooks/issue-to-pr-v2/`, `skills/issue-to-pr/`). Any path outside that
   allowlist rejects the commit, naming the offending path. This excludes
   deliverable files AND the per-issue ledger path
   (`docs/runbooks/issue-to-pr/`): a runbook-heal commit is a pure runbook fix,
   never a ledger or deliverable commit.
3. **Stage 5 read-only gate is a validate-time helper assertion**, not just
   prose: given a candidate Stage 5 checkpoint commit, assert its diff touches
   only the per-issue ledger path. Surfaced as a fail, not silent. (The exact
   wiring point: the implementer decides whether this is a new `decompose.ts`
   flag or a check inside an existing validation; pin the behavior test-first.)

## Implementation Units

### U1. Guarded `runbook-heal <sha>` closure form

**Goal:** A `batch_id: final` finding fixed by an orchestrator runbook-heal
commit can be recorded `status: fixed` with `resolution: runbook-heal <sha>`,
accepted only when the commit is reachable AND its diff touches only the
control-plane allowlist (`runbooks/issue-to-pr-v2/`, `skills/issue-to-pr/`).

**Requirements:** AC1, AC2 (and AC5 test coverage for this unit).

**Dependencies:** None.

**Files:**

- `runbooks/issue-to-pr-v2/lib/ledger.ts` (modify `validateFindingResolution`
  ~L2497-2554 — add the `runbook-heal <sha>` arm inside the `batch_id: final`
  path, AFTER the stage-3 plan-revision short-circuit ~L2503-2509; add an
  abuse-guard helper alongside `validateLedgerOwnedFixedCommit` ~L2556-2572)
- `runbooks/issue-to-pr-v2/lib/contract.ts` (only if the resolution grammar set
  is enumerated there; otherwise no change)
- `runbooks/issue-to-pr-v2/lib/ledger.test.ts` (tests)

**Approach:** Add a `runbook-heal <sha>` arm to the `fixed`-resolution matcher
on the `batch_id: final` path (sibling to the `commit <sha>` and `patch-batch`
arms; NOT reachable for `batch_id: stage-3`, which short-circuits to
`plan-revision` first). It calls `validateReachableCommit` for reachability,
then a new abuse-guard helper that runs `touchedFilesForCommit` and asserts
every touched path is prefix-matched by the control-plane allowlist. Any path
outside the allowlist (deliverable files, AND the per-issue ledger path under
`docs/runbooks/issue-to-pr/`) rejects the commit with a message naming the
offending path.

**Execution note:** Implement test-first (`tdd`). The abuse guard is the
highest-risk piece; write the deliverable-file-reject test red before the guard.

**Patterns to follow:** mirror the existing `commit <sha>` arm and
`validateLedgerOwnedFixedCommit`; reuse `touchedFilesForCommit` and
`validateReachableCommit` rather than re-deriving git access.

**Test scenarios:**
- Happy path: a `batch_id: final` finding with `status: fixed`, `resolution: runbook-heal <reachable commit touching only runbooks/issue-to-pr-v2/>` validates clean.
- Abuse reject (deliverable): `runbook-heal <sha>` where the commit's diff touches a deliverable file (e.g. `docs/scratch/x.md` or `src/**`) is REJECTED, naming the offending path.
- Abuse reject (mixed): `runbook-heal <sha>` where the commit touches BOTH a control-plane path AND a non-allowlisted path is REJECTED, naming the non-allowlisted path (every path must be allowlisted, not just one).
- Abuse reject (ledger path): `runbook-heal <sha>` where the commit touches the per-issue ledger path `docs/runbooks/issue-to-pr/issue-N-ledger.md` is REJECTED (the ledger is not control-plane; heal commits are separate from ledger checkpoints).
- Unreachable reject: `runbook-heal <nonexistent-sha>` is rejected as unreachable.
- Grammar reject: malformed `runbook-heal` (no sha / bad sha) is rejected.
- Stage-3 scope: a `batch_id: stage-3` finding with `resolution: runbook-heal <sha>` is REJECTED (stage-3 keeps plan-revision-only; the runbook-heal arm must not be reachable there).
- Non-regression: existing `commit <sha>` (terminal-batch), `patch-batch`, and stage-3 `plan-revision` closures still validate exactly as before.

**Verification:** `bun_runTests` over `lib/ledger.test.ts` passes including the
new cases; `tsc_check` clean; existing resolution tests unchanged in behavior.

```yaml
id: runbook-heal-resolution
name: Guarded runbook-heal closure form
goal: A batch_id-final finding fixed by an orchestrator runbook-heal commit can be recorded fixed with status and resolution that agree, guarded so the commit touches only control-plane paths.
files:
  - runbooks/issue-to-pr-v2/lib/ledger.ts
  - runbooks/issue-to-pr-v2/lib/ledger.test.ts
depends_on: []
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds: a batch_id-final finding with status fixed + resolution 'runbook-heal <reachable commit touching only control-plane paths>' validates clean (status and resolution agree, no out-of-scope fudge)."
  - "AC 2 holds: 'runbook-heal <sha>' is REJECTED when the commit touches any non-allowlisted path - a pure deliverable commit, a mixed control-plane+deliverable commit, and a commit touching the per-issue ledger path all fail, naming the offending path."
  - "AC 5 holds (partial): tests pin the accept case, the deliverable-reject case, the mixed-commit reject, the ledger-path reject, and a stage-3-scope reject for the runbook-heal form."
ac_mapping:
  - 1
  - 2
  - 5
rationale: "replacement-contract r1: merge AC1+AC2 (form and abuse guard live in the same validateFindingResolution function with inseparable tests); narrowed to batch_id final only (CR-003); allowlist excludes the ledger path (CR-004)."
```

### U2. Stage 5 read-only enforcement gate

**Goal:** A Stage 5 ledger checkpoint that touches any non-ledger path is
surfaced as a failure, not silently accepted.

**Requirements:** AC3 (and AC5 test coverage for this unit).

**Dependencies:** None (independent of U1; runs in parallel — file sets are now
disjoint after revision r1/CR-001).

**Files:**

- `runbooks/issue-to-pr-v2/decompose.ts` (add the gate as an assertion flag
  mirroring the existing `--assert-no-open-p0p1` shape; if the implementer
  instead wires it inside an existing validator in `lib/ledger.ts`, that is
  acceptable, but U1 owns `lib/ledger.ts` so coordinate via the dependency-free
  parallel order — prefer the `decompose.ts` flag route to keep file sets
  disjoint)
- `runbooks/issue-to-pr-v2/lib/stage5-readonly.test.ts` (tests — a NEW file,
  distinct from U1's `lib/ledger.test.ts`, per CR-001 to avoid shared-file
  ownership across the two parallel-eligible tdd batches)

**Approach:** Given a candidate Stage 5 checkpoint commit (or the staged diff),
assert the changed paths are exactly the per-issue ledger path. If any other
path appears, fail with a message naming it. Mirror the existing assertion-flag
pattern (`--assert-no-open-p0p1`). The exact invocation surface is an
implementation decision; pin the accept/reject behavior test-first.

**Execution note:** Implement test-first (`tdd`).

**Patterns to follow:** the existing `decompose.ts --assert-*` flags and their
non-zero-exit-on-violation contract; `touchedFilesForCommit`.

**Test scenarios:**
- Happy path: a checkpoint commit touching only the ledger path passes.
- Violation: a checkpoint commit touching the ledger PLUS a runbook reference file fails with the offending path named (this is exactly the 8be31d4 case from issue #68).
- Edge: an empty/no-op diff passes (no violation).

**Verification:** `bun_runTests` over the gate's test file passes;
`tsc_check` clean.

```yaml
id: stage5-readonly-gate
name: Stage 5 read-only enforcement gate
goal: A Stage 5 ledger checkpoint touching any non-ledger path is surfaced as a failure rather than silently accepted.
files:
  - runbooks/issue-to-pr-v2/decompose.ts
  - runbooks/issue-to-pr-v2/lib/stage5-readonly.test.ts
depends_on: []
execution_mode: tdd
acceptance_tests:
  - "AC 3 holds: a gate exists that, given a Stage 5 checkpoint touching a non-ledger path, fails (non-zero / surfaced finding) and names the offending path; a ledger-only checkpoint passes."
  - "AC 5 holds (partial): tests pin the Stage 5 read-only violation case (the 8be31d4 scenario) and the ledger-only pass case."
ac_mapping:
  - 3
  - 5
rationale: null
```

### U3. Documentation: closure table, Stage 5 cross-ref, blocked-by-doc-defect carve-out

**Goal:** The findings closure table documents `runbook-heal <sha>`, Stage 5
references the new gate and closure form, and the blocked-by-doc-defect carve-out
is written down.

**Requirements:** AC4 (and documents AC1/AC3 surfaces).

**Dependencies:** U1, U2 (document the behavior they implement).

**Files:**

- `runbooks/issue-to-pr-v2/references/findings-and-validators.md` (new closure-table row ~L187-200)
- `runbooks/issue-to-pr-v2/references/stage-5-final-review.md` (read-only authority ~L18-26 + cross-ref + carve-out)
- `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` (findings-data status/resolution note, if grammar text needs it)

**Approach:** Add a `fixed` / `runbook-heal <sha>` row to the closure table with
the abuse-guard constraint stated. In the Stage 5 reference, add the read-only
gate reference and a "blocked-by-doc-defect carve-out" subsection: when a runbook
prose defect blocks the run from continuing (the prose is the sole carrier of a
runtime-affecting instruction), an in-branch heal is permitted and recorded via
`runbook-heal <sha>`; otherwise unrelated-runbook defects route off-branch.

**Execution note:** Docs-only; `change_first`.

**Test scenarios:** Test expectation: none -- documentation prose. Verification
is by `render --check` (if the runbook has one) and consistency with U1/U2 behavior.

**Verification:** the closure-table row matches the validator grammar in U1; the
Stage 5 carve-out is internally consistent with the read-only gate in U2; no
broken cross-references.

```yaml
id: runbook-heal-docs
name: Closure table, Stage 5 cross-ref, blocked-by-doc-defect carve-out
goal: Document the runbook-heal closure form, the Stage 5 read-only gate, and the blocked-by-doc-defect carve-out.
files:
  - runbooks/issue-to-pr-v2/references/findings-and-validators.md
  - runbooks/issue-to-pr-v2/references/stage-5-final-review.md
  - runbooks/issue-to-pr-v2/issue-N-ledger.template.md
depends_on:
  - runbook-heal-resolution
  - stage5-readonly-gate
execution_mode: change_first
acceptance_tests:
  - "AC 4 holds: the blocked-by-doc-defect carve-out is documented in stage-5-final-review.md, and the findings-and-validators.md closure table has a runbook-heal row consistent with the U1 validator grammar."
ac_mapping:
  - 4
rationale: "docs-only change_first; documents the behavior U1/U2 implement."
```

### U5. Historical fr-001..fr-004 disposition

**Goal:** A decision is recorded and executed on whether to amend the
self-contradictory fr-001..fr-004 rows in the issue-68 ledger (out-of-scope
status + "fixed in commit" resolution text) to the new `runbook-heal` form, or
leave them as audit precedent.

**Requirements:** AC6.

**Dependencies:** U1 (the `runbook-heal` form must exist before rows can adopt
it).

**Files:**

- `docs/runbooks/issue-to-pr/issue-68-ledger.md` (amend the four rows if the
  decision is to amend; otherwise add a one-line audit note explaining why they
  are left as precedent)

**Approach:** This is a decision criterion surfaced at the Stage 3 user gate.
If "amend": rewrite fr-001..fr-004 to `status: fixed`,
`resolution: runbook-heal 8be31d4` in both the YAML and the rendered table, and
re-validate the issue-68 ledger. If "leave as precedent": add a Notes line in
issue-68-ledger.md recording the deliberate decision so the contradictory rows
are not copied as a template.

**Execution note:** `change_first` (ledger doc edit). Surface the amend-vs-leave
choice at Stage 3.

**Test scenarios:** Test expectation: none -- ledger doc edit. Verification: if
amended, `decompose.ts --validate-findings` on issue-68-ledger.md passes with the
runbook-heal grammar; if left, the audit note is present.

**Verification:** the issue-68 ledger either validates clean under the new
grammar (amend) or carries the documented decision (leave).

```yaml
id: historical-rows-disposition
name: Historical fr-001..fr-004 disposition
goal: Decide and execute whether to amend the self-contradictory fr-001..fr-004 rows in the issue-68 ledger to the runbook-heal form or leave them as audit precedent.
files:
  - docs/runbooks/issue-to-pr/issue-68-ledger.md
depends_on:
  - runbook-heal-resolution
execution_mode: change_first
acceptance_tests:
  - "AC 6 holds: a decision on fr-001..fr-004 is recorded and executed -- either the rows are amended to status fixed + resolution runbook-heal 8be31d4 and the issue-68 ledger validates clean, or a Notes line records the deliberate leave-as-precedent decision."
ac_mapping:
  - 6
rationale: "change_first ledger doc edit; AC6 is a decision criterion surfaced at the Stage 3 user gate (amend vs leave)."
```

## System-Wide Impact

- `lib/ledger.ts` `validateFinalFindingResolution` is consumed by
  `decompose.ts --validate-findings`, which every stage's findings checkpoint
  runs. The new arm is additive (a new accepted grammar); existing closures must
  keep validating identically (non-regression test in U1).
- The Stage 5 gate (U2) adds a new check the orchestrator runs at Stage 5; it
  must not fire on a legitimate ledger-only checkpoint.

## Risks

- **Abuse-guard allowlist too narrow or too wide.** Too narrow rejects
  legitimate heals; too wide reopens the deliverable-finding backdoor. Mitigation:
  pin both the accept and the deliverable-reject case test-first (U1).
- **Non-regression.** The new resolution arm must not change how `commit <sha>`,
  `patch-batch`, or `plan-revision` validate. Mitigation: explicit non-regression
  test in U1.
- **Stage 5 gate false positives.** The gate must pass a normal ledger-only
  checkpoint. Mitigation: U2 happy-path + edge (empty diff) tests.
