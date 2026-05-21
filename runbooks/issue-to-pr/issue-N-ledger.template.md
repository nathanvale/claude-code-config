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
Well-formed Builder fail-stops count as Builder attempts in runbook workflow
language. Do not add executable `builder_attempts` fields here until the
runbook helper/schema supports them.
Host readiness failures use frontmatter `blocked_reason:
host-builder-tools-unavailable` before any batch status change. Post-dispatch
host/schema/envelope failures use `blocked_reason:
builder-infrastructure-failure`, leave the current batch `in-progress`, and
record reachable commit refs plus dirty/staged path summaries in Notes.

```yaml
batches: []
```

## Findings data

This YAML block is the source of truth for gates and convergence checks. Keep
the markdown table below in sync for human scanning. `severity` must be `P0`,
`P1`, `P2`, or `P3`. `status` must be `open`, `fixed`, `accepted-risk`,
`deferred-P2`, `deferred-P3`, `out-of-scope-for-this-issue`,
`ADR-contradicts-<id>`, or `superseded`. An open blocker means `severity` is
`P0` or `P1` and `status` is `open`. Fixed findings must use
`resolution: commit <sha>` recorded in a terminal ledger batch, or
`resolution: patch-batch patch-NNN`. Duplicate findings are identified by
`batch_id + signature`; superseded rows must point to the canonical
non-superseded row with the same batch id and signature.

```yaml
findings: []
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides, host-builder-tools-unavailable evidence, builder-infrastructure-failure evidence, reachable commit refs, dirty/staged path summaries>
