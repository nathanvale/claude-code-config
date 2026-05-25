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
batch_contract_confirmation_status: "pending"
batch_contract_confirmed_at: null
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:3e1d3222ac393f9e6a7181e89ced8dcea8b5a14c7c2b9202a050806443afc505"
batch_contract_digest: null
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
batches: []
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

