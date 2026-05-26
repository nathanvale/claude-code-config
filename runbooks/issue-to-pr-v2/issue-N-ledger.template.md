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

Confirmation-state membership is
`cli.ts contract confirmation_states --json`.

## Acceptance criteria

<populated at stage 1 from user-confirmed AC list. Format: `- [ ]` checkboxes.>

## Batches

Batch schema facts are runtime-owned. Query:

- `cli.ts contract candidate_batch_fields --json`
- `cli.ts contract ledger_batch_lifecycle_fields --json`
- `cli.ts contract builder_attempt_fields --json`
- `cli.ts contract orchestrator_inline_attempt_fields --json`
- `cli.ts contract builder_attempt_types --json`
- `cli.ts contract execution_modes --json`
- `cli.ts contract batch_statuses --json`
- `cli.ts contract builder_attempt_statuses --json`
- `cli.ts contract final_verdicts --json`

Replacement batches may include optional `supersedes: <blocked-batch-id>` as
audit metadata. `supersedes` does not satisfy dependencies; downstream
`depends_on` edges must name the replacement batch after helper validation and
user confirmation. Replacement rows may only supersede blocked batches,
preserve every AC index from the superseded row, and include rationale prose
when changing `files`, `acceptance_tests`, or `execution_mode`.
Recommended rationale format: `replacement-contract: <reason>`.
Replacement row scaffold: `cli.ts scaffold replacement-candidate-batch --json`.

<!-- scaffold-pointer id=replacement-candidate-batch source="cli.ts scaffold replacement-candidate-batch --json" -->

Lifecycle-default scaffold: `cli.ts scaffold ledger-batch-lifecycle-defaults --json`.

<!-- scaffold-pointer id=ledger-batch-lifecycle-defaults source="cli.ts scaffold ledger-batch-lifecycle-defaults --json" -->

`builder_commits` entries must be reachable git commit refs.
`builder_attempts` is the compact persisted audit trail for well-formed Builder
envelopes. Persisted `blockers` and `probe_results` are YAML lists of compact
string summaries (use `[]` when empty), not raw Builder envelope object arrays.
Rich Builder evidence stays transient for Validator handoff or summarized in
Notes.
`orchestrator_inline_attempts` is the compact persisted audit trail for
committed Orchestrator-inline `change_first` attempts. It is initialized to
`[]` on each current batch row. Inline rows are committed-only evidence: if a
dispatch trigger appears before the inline implementation commit, append no
inline row and route the work to Builder dispatch instead. Inline commits are
found through this lane, not through `builder_commits`.
Well-formed Builder fail-stops count as Builder attempts and increment
`iterations`; committed Orchestrator-inline attempts also increment
`iterations`. Builder infrastructure failures stay outside both attempt lanes
and outside the iteration cap. Fail-stop attempts use `commit_sha: null` and
do not append to `builder_commits`.
`final_verdict` records the terminal Stage 4 outcome for the batch.
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

<!-- generated-scaffold:start id=ledger-empty-batches source="cli.ts scaffold ledger-empty-batches --json" -->
```yaml
batches: []
```
<!-- generated-scaffold:end id=ledger-empty-batches -->

## Findings data

This YAML block is the source of truth for gates and convergence checks. Keep
the markdown table below in sync for human scanning. Query
`cli.ts contract finding_fields --json`,
`cli.ts contract finding_severities --json`, and
`cli.ts contract finding_statuses --json` for runtime-owned field and finite
enum membership. Parameterized `ADR-contradicts-<id>` status handling lives in
`findings-and-validators.md`. An open blocker means `severity` is `P0` or `P1`
and `status` is `open`. Use `batch_id: stage-3` for Stage 3 Contract Review
findings before batch confirmation, `batch_id: final` for final review
findings, or a confirmed ledger batch id for batch-loop findings.
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

Finding row scaffold: `cli.ts scaffold ledger-finding-row --json`.

<!-- scaffold-pointer id=ledger-finding-row source="cli.ts scaffold ledger-finding-row --json" -->

<!-- generated-scaffold:start id=ledger-empty-findings-data source="cli.ts scaffold ledger-empty-findings-data --json" -->
```yaml
findings: []
```
<!-- generated-scaffold:end id=ledger-empty-findings-data -->

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, implementation attempt checkpoints, completed Validator-wave
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

### Implementation attempt checkpoint evidence (U6)

Before rendering Validator packets for a committed implementation attempt,
append this ledger-only checkpoint. The checkpoint is tied to the
implementation commit and the lane that owns it.

Scaffold: `cli.ts scaffold notes-implementation-attempt-checkpoint --json`.

<!-- scaffold-pointer id=notes-implementation-attempt-checkpoint source="cli.ts scaffold notes-implementation-attempt-checkpoint --json" -->

### Completed Validator-wave evidence (U6)

After the full Validator wave completes, append durable wave evidence tied to
the same implementation commit and lane. Clean waves are explicit, not
inferred: use `outcome: clean` and `findings: []`.

Scaffold: `cli.ts scaffold notes-validator-wave-completed --json`.

<!-- scaffold-pointer id=notes-validator-wave-completed source="cli.ts scaffold notes-validator-wave-completed --json" -->

### runbook_version skew continuation evidence (U6)

When the v2 runtime detects `runbook_version` skew (a missing or mismatched
frontmatter value) and the operator decides to continue against the new
contract anyway, append a continuation evidence row to this section using the
runtime-owned scaffold. The v2 helper parses it; partial rows are rejected and
the skew remains a stop-required signal.

Scaffold: `cli.ts scaffold notes-runbook-version-skew-continuation --json`.

<!-- scaffold-pointer id=notes-runbook-version-skew-continuation source="cli.ts scaffold notes-runbook-version-skew-continuation --json" -->

The scaffold response includes the marker comment and YAML body. The marker
comment line must appear immediately before the fenced YAML block (no blank
line between them is required, but blank lines are allowed).

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
validates the section's shape and closed-key whitelist against runtime code
and the registry contract. Canonical and lifecycle fields live exclusively in
the registry; including them in a ledger entry is a validator error.

<!-- generated-scaffold:start id=workflow-learnings-empty source="cli.ts scaffold workflow-learnings-empty --json" -->
```yaml
workflow_learnings: []
```
<!-- generated-scaffold:end id=workflow-learnings-empty -->
