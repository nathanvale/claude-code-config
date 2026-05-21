---
issue_number: <fill in: integer>
issue_title: "<fill in: string>"
issue_url: "<fill in: https://github.com/owner/repo/issues/N>"
target_repo: "<fill in: owner/repo>"
plan_path: null
started_at: "<fill in: ISO 8601 with timezone>"
status: "in-progress"
ac_source: "<fill in: gold-standard | variant-heading | loose-checkbox-block | numbered-requirements | pasted | drafted>"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: null
batch_contract_digest: null
ac_digest: null
---

# Issue {issue_number} - {issue_title}

This is a per-issue ledger written by `~/.claude/runbooks/issue-to-pr/issue-to-pr.md`.
Format and protocol: see [README](file:///Users/nathanvale/.claude/runbooks/issue-to-pr/README.md).

## Acceptance criteria

<populated at stage 1 from user-confirmed AC list. Format: `- [ ]` checkboxes.>

## Batches

Each batch row must include `execution_mode: tdd | proof_first | change_first`.
`builder_commits` entries must be reachable git commit refs.
`builder_attempts` is the compact persisted audit trail for well-formed Builder
envelopes. Each attempt row contains `attempt_type`, `status`, `commit_sha`,
`files_touched`, `route_hint`, `blockers`, `probe_results`, and `notes`.
Persisted `blockers` and `probe_results` are compact string summaries, not raw
Builder envelope object arrays. Rich Builder evidence stays transient for
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
reachable plan/DAG revision that closed them. Other fixed findings must use
`resolution: commit <sha>` recorded in a terminal ledger batch, or
`resolution: patch-batch patch-NNN`. Duplicate findings are identified by
`batch_id + signature`; superseded rows must point to the canonical
non-superseded row with the same batch id and signature. Stage 3 Contract
Review protocol is sourced from
`docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.

```yaml
findings: []
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides, host-builder-tools-unavailable evidence, builder-infrastructure-failure evidence, Validator findings checkpoint evidence, reachable commit refs, dirty/staged path summaries>
