---
issue_number: <fill in: integer>
issue_title: "<fill in: string>"
issue_url: "<fill in: https://github.com/owner/repo/issues/N>"
target_repo: "<fill in: owner/repo>"
plan_path: null
started_at: "<fill in: ISO 8601 with timezone>"
status: "in-progress"
runbook_version: "3"
ac_source: "<fill in: gold-standard | variant-heading | loose-checkbox-block | numbered-requirements | pasted | drafted>"
ac_confirmation_status: "pending"
ac_confirmed_at: null
batch_contract_confirmation_status: "pending"
batch_contract_confirmed_at: null
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: null
batch_contract_digest: null
ac_digest: null
---

# Issue {issue_number} - {issue_title}

This is a per-issue ledger written by the v2 Issue-to-PR runtime in
`~/.claude/runbooks/issue-to-pr-v2/`. Format and protocol: see the v2
references under `~/.claude/runbooks/issue-to-pr-v2/references/`
(`ledger-and-helper.md`, `findings-and-validators.md`, the per-stage
references).

The `runbook_version: "3"` frontmatter field declares which workflow
contract this ledger was authored against. The v2 helper at
`~/.claude/runbooks/issue-to-pr-v2/cli.ts` compares this string verbatim
against the `RUNBOOK_VERSION` constant in `lib/contract.ts`. A
mismatched or missing value is a stop-required signal; the only way to
keep running is to record an operator-authored continuation evidence
row in `## Notes` (see the evidence shape below).

## Acceptance criteria

<populated at stage 1 from user-confirmed AC list. Format: `- [ ]` checkboxes.>

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
`orchestrator_inline_attempts` is the compact persisted audit trail for
committed Orchestrator-inline `change_first` attempts. It is initialized to
`[]` on each current batch row. Each inline attempt row contains exactly
`commit_sha`, `files_touched`, and `notes`; it never carries Builder-only
fields such as `attempt_type`, `status`, `route_hint`, `blockers`, or
`probe_results`. Inline rows are committed-only evidence: if a dispatch trigger
appears before the inline implementation commit, append no inline row and
route the work to Builder dispatch instead. Inline commits are found through
this lane, not through `builder_commits`.
Well-formed Builder fail-stops count as Builder attempts and increment
`iterations`; committed Orchestrator-inline attempts also increment
`iterations`. Builder infrastructure failures stay outside both attempt lanes
and outside the iteration cap. Fail-stop attempts use `commit_sha: null` and
do not append to `builder_commits`.
Host readiness failures use frontmatter `blocked_reason:
host-builder-tools-unavailable` before any Stage 4 implementation attempt,
including bounded Orchestrator-inline work. They leave every batch status
unchanged, append no implementation attempt evidence, do not increment
`iterations`, and dispatch no Validators. Post-dispatch host/schema/envelope
failures use `blocked_reason: builder-infrastructure-failure`, leave the
current batch `in-progress`, and record reachable commit refs plus dirty/staged
path summaries in Notes without adding a `builder_attempts` or
`orchestrator_inline_attempts` row, incrementing `iterations`, or dispatching
Validators.

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

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

### runbook_version skew continuation evidence (U6)

When the v2 runtime detects `runbook_version` skew (a missing or mismatched
frontmatter value) and the operator decides to continue against the new
contract anyway, append a continuation evidence row to this section using the
exact shape below. The v2 helper parses it; partial rows are rejected and the
skew remains a stop-required signal.

The marker comment line must appear immediately before the fenced YAML block
(no blank line between them is required, but blank lines are allowed). Every
listed field is required; omitting one disqualifies the row.

```text
<!-- runbook-version-skew-continuation -->
```

```yaml
runbook_version_skew_continuation:
  ledger_version: "<quoted-version-string OR bare null>"
  runtime_version: "<quoted-version-string>"
  operator_decision: "<actor>"          # e.g. "Nathan @ 2026-05-22T19:00"
  timestamp: "<ISO 8601>"
  route_context: "<route id at the time of decision>"
  reference_context: "<reference file the operator consulted>"
  accepted_risk: "<one-line reason>"
```

`ledger_version` is special: write a **bare** `null` (no quotes) when the
ledger frontmatter has no `runbook_version` field at all. Write a quoted
string like `"1"` when the frontmatter has a value but it doesn't match
`RUNBOOK_VERSION`. Writing `"null"` (quoted) stores the literal four-char
string and will NOT match an absent frontmatter — the parser treats it as
a real ledger_version of "null" and rejects the evidence. Every other
field must be a quoted scalar string.

The first complete evidence row wins; later rows in the append-only Notes log
are ignored so a stale row cannot silently override a current one.

## Workflow Learnings

This section records **what this run observed** about the Issue-to-PR workflow
itself — durable observations about its skills, references, CLI/observability
surface, contracts, and gotchas that surfaced while shipping this issue.

Each entry is a per-run reference into the cross-run **Workflow Learnings
registry** at
[`references/workflow-learnings-registry.md`](references/workflow-learnings-registry.md).
The registry owns canonical lifecycle metadata and dedupe across runs: each
learning is recorded there once, keyed by a stable `signature`, with canonical
fields (`summary`, `owner`, `retirement_condition`) and lifecycle fields
(`disposition`, `status`, `confidence`, `follow_up`). The ledger never
duplicates those canonical or lifecycle fields — it carries only the
run-scoped evidence shape below plus the `signature` cross-reference so a
future reader can look up the canonical entry.

`workflow_learnings: []` is the valid empty case: a run with no observed
workflow learnings is the common path and must not block. The helper
`bun ~/.claude/runbooks/issue-to-pr-v2/decompose.ts --validate-workflow-learnings <ledger-path>`
validates the section's shape (single fenced yaml block, top-level
`workflow_learnings` array, every entry a mapping with required string fields
`signature`, `affected_surface`, `what_was_wrong` non-empty, and unknown keys
rejected against a closed whitelist symmetric with the registry's
`ALLOWED_EVIDENCE_KEYS`).

Required entry fields:

- `signature` (string) — `sha256:<hex>` or stable slug. Resolves to the
  canonical entry in the cross-run registry.
- `affected_surface` (string) — which workflow surface the learning concerns
  (matches the registry's evidence key by the same name).
- `what_was_wrong` (string) — the observation captured during the run.

Optional entry fields (capture what is known; absence is fine):

- `discovery_method` — how the issue was found during the run.
- `root_cause` — why it happened.
- `scope` — blast radius / where else this would surface.
- `proposed_fix` — suggested change at observation time.
- `verification_idea` — how a later fix would be confirmed.

Canonical and lifecycle fields (`summary`, `owner`, `retirement_condition`,
`disposition`, `status`, `confidence`, `follow_up`) live exclusively in the
registry. Including any of them in a ledger entry is a validator error.

```yaml
workflow_learnings: []
```
