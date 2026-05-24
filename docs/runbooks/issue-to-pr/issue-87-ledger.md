---
issue_number: 87
issue_title: "issue-to-pr: retire first-run-gotchas recipe 2.3 (blocked-digests-stale) and close its targeting gaps"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/87"
target_repo: "nathanvale/claude-code-config"
plan_path: null
started_at: "2026-05-25T07:40:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-25T07:40:00+10:00"
batch_contract_confirmation_status: "pending"
batch_contract_confirmed_at: null
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: null
batch_contract_digest: null
ac_digest: "sha256:91d190d541ba670ae0ccc2e8b6df99f5ad2b946427be4202c2edf4be188ce30e"
---

# Issue 87 - issue-to-pr: retire first-run-gotchas recipe 2.3 (blocked-digests-stale) and close its targeting gaps

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

- [ ] The "Stage-transition digest recheck" paragraph in `ledger-and-helper.md` links to `first-run-gotchas.md` recipe 2.3 (`blocked-digests-stale`) by name, for the recovery sequence.
- [ ] The `<route_catalog>` `blocked-batch-contract-stale` and `blocked-digests-stale` bullet in `SKILL.md` links to `first-run-gotchas.md` recipe 2.3 by name (in addition to the existing recipe 2.2 link).
- [ ] Recipe 2.3's retire-when bar in `first-run-gotchas.md` is retired (marked retired per the guide's entry-governance contract; recipe body retained), recording that both links above now satisfy it.
- [ ] No change to `lib/route.ts`, `requiredReferenceIdsFor`, or CLI runtime behavior.
- [ ] `route.test.ts` stays green (77/77) and `contract-drift.test.ts` stays green (109/109).
- [ ] No contradiction across the SKILL.md route_catalog bullet, the ledger-and-helper digest-recheck paragraph, and the recipe 2.3 retire-when record after the change.

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

- 2026-05-25: Stage 1 started. ACs extracted from issue #87 `## Acceptance criteria` heading (gold-standard, high confidence), confirmed as-is by Nathan. No `## Blocked by` section; issue open; no override needed. Branch `feat/issue-87-pending` created from clean `main` HEAD before ledger mutation.

### runbook_version skew continuation evidence (U6)

When the v2 runtime detects `runbook_version` skew (a missing or mismatched
frontmatter value) and the operator decides to continue against the new
contract anyway, append a continuation evidence row to this section using the
exact shape below. The v2 helper parses it; partial rows are rejected and the
skew remains a stop-required signal.
