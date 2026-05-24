---
issue_number: 72
issue_title: "issue-to-pr: runbook-heal merge guard, mislabeled empty-commit fixture, and no P2-fix path at Stage 5"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/72"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-006-fix-issue-to-pr-runbook-heal-merge-guard-plan.md"
started_at: "2026-05-24T19:17:33+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T19:17:33+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-24T19:22:06+10:00"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:6cba8ce7c073aa485cb34caf19bac8990e304ad4c42f4a3d8aebae79d0775b95"
batch_contract_digest: "sha256:0ab4f02c55fa216e380f4426dd04c536fd5bf74bb478dea40b3208dfdfcc9f77"
ac_digest: "sha256:4a1d14bb0a7e06950920439c60ff0a548d5ad544dc6a76b76ae647ab57470983"
---

# Issue 72 - issue-to-pr: runbook-heal merge guard, mislabeled empty-commit fixture, and no P2-fix path at Stage 5

This is a per-issue ledger written by the v2 Issue-to-PR runtime in
`~/.claude/runbooks/issue-to-pr-v2/`. Format and protocol: see the v2
references under `~/.claude/runbooks/issue-to-pr-v2/references/`
(`ledger-and-helper.md`, `findings-and-validators.md`, the per-stage
references).

The `runbook_version: "2"` frontmatter field declares which workflow
contract this ledger was authored against. The v2 helper at
`~/.claude/runbooks/issue-to-pr-v2/cli.ts` compares this string verbatim
against the `RUNBOOK_VERSION` constant in `lib/contract.ts`. A
mismatched or missing value is a stop-required signal; the only way to
keep running is to record an operator-authored continuation evidence
row in `## Notes` (see the evidence shape below).

## Acceptance criteria

- [ ] `validateControlPlaneOnlyCommit` explicitly rejects merge commits (test pins it); the closure-table doc claim is true by construction.
- [ ] The runbook-heal empty-commit test uses an honest fixture (genuine no-op or relabeled merge consistent with the merge guard).
- [ ] A decision is recorded on the Stage-5 P2-fix-path gap (intentional vs add a path).
- [ ] (optional, lower priority) fr5-001 binding, fr5-004 reachability, fr5-005 shared-reader extraction addressed or explicitly deferred.

## Batches

Each batch row must include `execution_mode: tdd | proof_first | change_first`.
Replacement batches may include optional `supersedes: <blocked-batch-id>` as
audit metadata. `supersedes` does not satisfy dependencies; downstream
`depends_on` edges must name the replacement batch after helper validation and
user confirmation. Replacement rows may only supersede blocked batches,
preserve every AC index from the superseded row, and include rationale prose
when changing `files`, `acceptance_tests`, or `execution_mode`.
Recommended rationale format: `replacement-contract: <reason>`.
`builder_commits` entries must be reachable git commit refs.
`builder_attempts` is the compact persisted audit trail for well-formed Builder
envelopes. Each attempt row contains `attempt_type`, `status`, `commit_sha`,
`files_touched`, `route_hint`, `blockers`, `probe_results`, and `notes`.
Persisted `blockers` and `probe_results` are YAML lists of compact string
summaries (use `[]` when empty), not raw Builder envelope object arrays;
`notes` is a single string. Rich Builder evidence stays transient for
Validator handoff or summarized in Notes.
Well-formed Builder fail-stops count as Builder attempts and increment
`iterations`; fail-stop attempts use `commit_sha: null` and do not append to
`builder_commits`.
Host readiness failures use frontmatter `blocked_reason:
host-builder-tools-unavailable` before any batch status change. Post-dispatch
host/schema/envelope failures use `blocked_reason:
builder-infrastructure-failure`, leave the current batch `in-progress`, and
record reachable commit refs plus dirty/staged path summaries in Notes without
adding a `builder_attempts` row or incrementing `iterations`.

```yaml
batches:
  - id: "runbook-heal-merge-guard"
    name: "Explicit runbook-heal merge guard"
    goal: "validateControlPlaneOnlyCommit explicitly rejects merge commits and the runbook-heal test fixture labels the merge honestly."
    files:
      - "runbooks/issue-to-pr-v2/lib/ledger.ts"
      - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
    depends_on: []
    execution_mode: tdd
    acceptance_tests:
      - "AC 1 holds: a batch_id-final finding fixed by runbook-heal dc6868a is rejected by an explicit merge-commit guard, not only by an empty touched-files side effect."
      - "AC 2 holds: the runbook-heal fixture commentary and test name describe dc6868a as a merge commit, consistent with the new guard."
    ac_mapping:
      - 1
      - 2
    rationale: "replacement-contract: AC1 and AC2 are inseparable because the same runbook-heal validation test fixture proves the merge guard and fixes the misleading empty-commit label."
    status: converged
    builder_commits:
      - "e4f0b342a614d62740e4abf3c34b836d430fa4bd"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "e4f0b342a614d62740e4abf3c34b836d430fa4bd"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "dc6868a is a reachable merge commit with two parents."
          - "git diff-tree default output for dc6868a reports no touched files, confirming the old rejection path was a side effect."
        notes: "Builder added explicit parent-count merge guard, renamed the dc6868a fixture/commentary to merge semantics, and verified focused ledger tests red then green."
    iterations: 1
    final_verdict: converged
  - id: "stage5-p2-policy"
    name: "Stage 5 P2 policy decision and deferrals"
    goal: "Record the Stage 5 P2-fix-path decision and explicitly defer lower-priority follow-up findings."
    files:
      - "runbooks/issue-to-pr-v2/references/stage-5-final-review.md"
      - "runbooks/issue-to-pr-v2/references/findings-and-validators.md"
    depends_on:
      - "runbook-heal-merge-guard"
    execution_mode: change_first
    acceptance_tests:
      - "AC 3 holds: the Stage 5 reference records that P2/P3 final-review findings are follow-up work rather than in-stage patch batches."
      - "AC 4 holds: fr5-001 binding, fr5-004 reachability, and fr5-005 shared-reader extraction are explicitly deferred as lower-priority follow-ups."
    ac_mapping:
      - 3
      - 4
    rationale: "docs-only policy recording; no red test would add signal beyond grep-visible documentation checks."
    status: converged
    builder_commits:
      - "395a8aad8a5ff0aec4c654e2b206b705bc6a74ee"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "395a8aad8a5ff0aec4c654e2b206b705bc6a74ee"
        files_touched:
          - "runbooks/issue-to-pr-v2/references/stage-5-final-review.md"
          - "runbooks/issue-to-pr-v2/references/findings-and-validators.md"
        route_hint: validator
        blockers: []
        probe_results:
          - "git diff --check passed for both reference files."
          - "rg checks found P2/P3 follow-up policy wording, in-stage patch-batch exclusion, and fr5-001/fr5-004/fr5-005 deferrals."
        notes: "Builder recorded that Stage 5 P2/P3 findings are follow-up work, reserved patch-batches for P0/P1, and explicitly deferred fr5-001/fr5-004/fr5-005."
    iterations: 1
    final_verdict: converged
```

## Findings data

This YAML block is the source of truth for gates and convergence checks. Keep
the markdown table below in sync for human scanning. `severity` must be `P0`,
`P1`, `P2`, or `P3`. `status` must be `open`, `fixed`, `accepted-risk`,
`deferred-P2`, `deferred-P3`, `out-of-scope-for-this-issue`,
`ADR-contradicts-<id>`, or `superseded`. An open blocker means `severity` is
`P0` or `P1` and `status` is `open`. Use `batch_id: stage-3` for Stage 3
Contract Review findings before batch confirmation, `batch_id: final` for
final review findings, or a confirmed ledger batch id for batch-loop findings.
Fixed Stage 3 findings must use `resolution: plan-revision <sha>` for the
reachable plan/DAG revision that closed them. Fixed `batch_id: final` findings
closed by an in-run orchestrator runbook self-heal use `resolution:
runbook-heal <sha>`, where the cited commit is control-plane-only
(`runbooks/issue-to-pr-v2/` or `skills/issue-to-pr/`, never a deliverable or
the per-issue ledger path). Other fixed findings must use `resolution: commit
<sha>` recorded in a terminal ledger batch, or `resolution: patch-batch
patch-NNN`. Duplicate findings are identified by
`batch_id + signature`; superseded rows must point to the canonical
non-superseded row with the same batch id and signature.

```yaml
findings: []
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |

## Notes

- 2026-05-24T19:17:33+10:00 - Stage 1 AC confirmation: extracted from issue `## Acceptance criteria` checkbox list (`gold-standard`, high confidence). Nathan invoked the issue-to-pr skill inline for issue 72, so these issue-authored ACs are the confirmed run contract.
- 2026-05-24T19:20:05+10:00 - Stage 2 planning: rendered the `ce-plan` addendum packet with `cli.ts packet ce-plan --json`, wrote plan `docs/plans/2026-05-24-006-fix-issue-to-pr-runbook-heal-merge-guard-plan.md`, and persisted plan digest `sha256:6cba8ce7c073aa485cb34caf19bac8990e304ad4c42f4a3d8aebae79d0775b95`.
- 2026-05-24T19:22:06+10:00 - Stage 3 batch contract confirmation: plan decomposed to 2 batches; AC coverage helper reported 4/4 covered; inline Contract Review found no P0/P1 blockers and no nonblocking findings. Nathan's inline run request is treated as confirmation of the exact AC text, DAG, execution modes, rationales, and digest triple.
- 2026-05-24T19:24:26+10:00 - Stage 4 lifecycle: started `runbook-heal-merge-guard` batch after host readiness check passed (Builder/Validator agents available, scoped files editable, checks available).
- 2026-05-24T19:34:05+10:00 - Stage 4 validator wave for `runbook-heal-merge-guard`: Builder commit `e4f0b342a614d62740e4abf3c34b836d430fa4bd` touched only confirmed batch files. Validators `ce-correctness-reviewer`, `ce-testing-reviewer`, `ce-maintainability-reviewer`, `ce-project-standards-reviewer`, `ce-adversarial-reviewer`, and `ce-kieran-typescript-reviewer` all returned zero findings, zero residual risks, and zero testing gaps. Batch converged with no open P0/P1 and no P2/P3 to auto-defer.
- 2026-05-24T19:35:04+10:00 - Stage 4 lifecycle: started `stage5-p2-policy` batch after dependency `runbook-heal-merge-guard` converged and host readiness check passed.
- 2026-05-24T19:41:58+10:00 - Stage 4 validator wave for `stage5-p2-policy`: Builder commit `395a8aad8a5ff0aec4c654e2b206b705bc6a74ee` touched only confirmed batch files. Validators `ce-correctness-reviewer`, `ce-testing-reviewer`, `ce-maintainability-reviewer`, `ce-project-standards-reviewer`, and `ce-adversarial-reviewer` all returned zero findings, zero residual risks, and zero testing gaps. Batch converged with no open P0/P1 and no P2/P3 to auto-defer.

### runbook_version skew continuation evidence (U6)

When the v2 runtime detects `runbook_version` skew (a missing or mismatched
frontmatter value) and the operator decides to continue against the new
contract anyway, append a continuation evidence row to this section using the
exact shape below. The v2 helper parses it; partial rows are rejected and the
skew remains a stop-required signal.

The marker comment line must appear immediately before the fenced YAML block
(no blank line between it is required, but blank lines are allowed). Every
listed field is required; omitting one disqualifies the row.

```text
<!-- runbook-version-skew-continuation -->
```

```yaml
runbook_version_skew_continuation:
  ledger_version: "<quoted-version-string OR bare null>"
  runtime_version: "<quoted-version-string>"
  operator_decision: "<actor>"
  timestamp: "<ISO 8601>"
  route_context: "<route id at the time of decision>"
  reference_context: "<reference file the operator consulted>"
  accepted_risk: "<one-line reason>"
```
