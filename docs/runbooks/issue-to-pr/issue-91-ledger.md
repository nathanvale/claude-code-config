---
issue_number: 91
issue_title: "Add run-specific Workflow Learnings to the per-issue ledger"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/91"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-25-003-feat-ledger-workflow-learnings-section-plan.md"
started_at: "2026-05-25T01:24:29Z"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-25T01:24:29Z"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-25T01:43:09Z"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:6e2796d8e896d08b9746fc934c8219bfb8ff7fe66c85dd46ed25a75c07c80d01"
batch_contract_digest: "sha256:b3f06b4deacf12bbc8bc205b99baabee96272ba5adafd38593660d16ab6f9395"
ac_digest: "sha256:44a0cb3a65a607696f9955f8b8f1b20cc804e3ea28c59c737b226e73d27e8f1d"
---

# Issue 91 - Add run-specific Workflow Learnings to the per-issue ledger

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

- [ ] The ledger template includes a required Workflow Learnings section in a stable location and with a clear run-specific evidence shape.
- [ ] Ledger/reference prose explains that the per-issue ledger records what this run observed, while the registry owns canonical lifecycle metadata and dedupe.
- [ ] Helper validation rejects ledgers missing the required Workflow Learnings section once they are authored against the updated contract.
- [ ] Run-specific learning references can point to registry signatures without duplicating the full canonical registry entry.
- [ ] Tests cover the required section and the expected run-specific reference/evidence shape.

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
  - id: "ledger-template-section"
    name: "Ledger template + schema"
    goal: "AC 1 holds: The ledger template includes a required Workflow Learnings section in a stable location and with a clear run-specific evidence shape."
    files:
      - "runbooks/issue-to-pr-v2/issue-N-ledger.template.md"
    depends_on: []
    execution_mode: change_first
    acceptance_tests:
      - "AC 1 holds: the template file contains a ## Workflow Learnings section at the tail of the body, with a prose preamble, with exactly one fenced yaml block at column 0, and the block body is `workflow_learnings: []`"
      - "AC 4 holds: the prose explains entries use signature to point at registry canonical entries without duplicating canonical fields"
    ac_mapping:
      - 1
      - 4
    rationale: "change_first-exception: pure docs/template change; behaviour is verified by U3 (validator + tests)"
    status: converged
    builder_commits:
      - "fb06b53"
    builder_attempts:
      - attempt_type: "implementation"
        status: "committed"
        commit_sha: "fb06b53"
        files_touched:
          - "runbooks/issue-to-pr-v2/issue-N-ledger.template.md"
        route_hint: null
        blockers: []
        probe_results: []
        notes: "Appended ## Workflow Learnings section at tail of template with workflow_learnings: [] seed; ce-correctness-reviewer validator wave returned zero findings."
    iterations: 1
    final_verdict: converged
  - id: "reference-prose"
    name: "Reference prose updates"
    goal: "AC 2 holds: Ledger/reference prose explains that the per-issue ledger records what this run observed, while the registry owns canonical lifecycle metadata and dedupe."
    files:
      - "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"
      - "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md"
    depends_on:
      - "ledger-template-section"
    execution_mode: change_first
    acceptance_tests:
      - "AC 2 holds: ledger-and-helper.md body-sections list includes ## Workflow Learnings and a Workflow Learnings entry fields subsection names the required keys and the canonical-fields-live-in-registry boundary"
      - "AC 2 holds: workflow-learnings-registry.md prose points at the new ledger section as the per-run evidence home and states which fields the ledger does NOT carry"
      - "AC 4 holds: both files name the signature cross-reference rule"
    ac_mapping:
      - 2
      - 4
    rationale: "change_first-exception: pure docs change to reference files; behaviour is the documented split, verified by reading"
    status: in-progress
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "ledger-validator"
    name: "Ledger validator, CLI dispatch, and tests (tdd)"
    goal: "AC 3 + AC 5 hold: helper validation rejects ledgers missing the required Workflow Learnings section, and the full test suite (happy paths + every documented failure mode) is authored alongside the validator in tdd order."
    files:
      - "runbooks/issue-to-pr-v2/lib/ledger.ts"
      - "runbooks/issue-to-pr-v2/decompose.ts"
      - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
    depends_on:
      - "ledger-template-section"
    execution_mode: tdd
    acceptance_tests:
      - "AC 3 holds: validateWorkflowLearnings throws on a ledger missing the ## Workflow Learnings section"
      - "AC 3 holds: validateWorkflowLearnings accepts an empty workflow_learnings: [] block"
      - "AC 3 holds: validateWorkflowLearnings rejects entries missing signature, affected_surface, or what_was_wrong"
      - "AC 3 holds: --validate-workflow-learnings flag dispatches to the new validator and exits non-zero on failure"
      - "AC 5 holds: tests cover happy path (empty + populated), missing section, no fenced block, multiple blocks, yaml parse error, missing workflow_learnings key, non-array, entry-not-mapping, missing required fields, empty-string required fields, unknown keys (including canonical/lifecycle field rejection), and entry-labeling-by-signature-vs-index"
    ac_mapping:
      - 3
      - 5
    rationale: null
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
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
findings:
  - id: "f-stage3-001"
    batch_id: "stage-3"
    signature: "tdd-mode-split-across-impl-and-test-batches"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Candidate U3 (ledger-validator) was tdd-mode but contained only impl files; U4 (validator-tests) was tdd-mode but contained only the test file. The DAG forced impl-then-tests, contradicting the per-batch tdd contract."
    resolution: "plan-revision 34f61b9"
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| f-stage3-001 | stage-3 | tdd-mode-split-across-impl-and-test-batches | ce-correctness-reviewer | P1 | fixed | Candidate U3 (ledger-validator) was tdd-mode but contained only impl files; U4 (validator-tests) was tdd-mode but contained only the test file. The DAG forced impl-then-tests, contradicting the per-batch tdd contract. | plan-revision 34f61b9 |

## Notes

