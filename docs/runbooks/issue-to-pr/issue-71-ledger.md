---
issue_number: 71
issue_title: "issue-to-pr: no honest closure for final-review findings fixed by in-run runbook heals (+ Stage 5 read-only gate gap)"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/71"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-005-feat-issue-to-pr-runbook-heal-closure-plan.md"
started_at: "2026-05-24T16:47:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T16:47:00+10:00"
batch_contract_confirmation_status: "blocked"
batch_contract_confirmed_at: null
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:75ad02fa6c12b21c92af9831270be275150836f08c693372f068d220897aab24"
batch_contract_digest: null
ac_digest: "sha256:b424d7bd4f91af17b31d4122a02728760d76765dc5cd4b496a84f4f7e47b0ed2"
---

# Issue 71 - issue-to-pr: no honest closure for final-review findings fixed by in-run runbook heals (+ Stage 5 read-only gate gap)

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

- [ ] A final-review finding fixed by an orchestrator runbook-heal commit can be recorded `fixed` with status and resolution that agree (no `out-of-scope` fudge)
- [ ] The closure form is guarded: it rejects a cited commit whose diff touches deliverable files
- [ ] A gate exists (or a documented check) that a Stage 5 ledger checkpoint touches only the ledger path; an in-run non-ledger edit is surfaced, not silent
- [ ] The blocked-by-doc-defect carve-out is documented
- [ ] Tests pin the accept case, the deliverable-file reject case, and the Stage 5 read-only violation case
- [ ] Decide whether to amend the historical self-contradictory rows fr-001..fr-004 in issue-68-ledger.md or leave them as audit precedent

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
reachable plan/DAG revision that closed them. Other fixed findings must use
`resolution: commit <sha>` recorded in a terminal ledger batch, or
`resolution: patch-batch patch-NNN`. Duplicate findings are identified by
`batch_id + signature`; superseded rows must point to the canonical
non-superseded row with the same batch id and signature.

```yaml
findings:
  - id: cr-001
    batch_id: stage-3
    signature: shared-test-file-no-dependency-edge
    persona: contract-reviewer
    severity: P1
    status: open
    summary: "Both runbook-heal-resolution and stage5-readonly-gate list lib/ledger.test.ts with depends_on []; no ordering constraint means the second Builder can clobber the first's test additions to the shared file."
    resolution: null
  - id: cr-003
    batch_id: stage-3
    signature: stage-3-batch-id-collides-with-plan-revision-requirement
    persona: contract-reviewer
    severity: P1
    status: open
    summary: "Plan scopes runbook-heal to batch_id stage-3 too, but validateFindingResolution short-circuits stage-3 findings to plan-revision only, so the new arm is unreachable for stage-3; behavior is unspecified and untested."
    resolution: null
  - id: cr-004
    batch_id: stage-3
    signature: deliverable-path-definition-undefined-plan-wide
    persona: contract-reviewer
    severity: P1
    status: open
    summary: "The abuse guard's deliverable-path/control-plane-allowlist concept is new and plan-wide but leaves edges undefined: mixed control-plane+deliverable commits, and crucially whether the per-issue ledger path docs/runbooks/issue-to-pr/ is in the allowlist (U5 amend and Stage 5 checkpoints touch it)."
    resolution: null
  - id: cr-002
    batch_id: stage-3
    signature: cited-function-name-does-not-exist
    persona: contract-reviewer
    severity: P2
    status: open
    summary: "Plan cites validateFinalFindingResolution; the real function is validateFindingResolution (the cited line range is correct). Mild plan/DAG drift."
    resolution: null
  - id: cr-005
    batch_id: stage-3
    signature: stage5-gate-wiring-choice-bounded
    persona: contract-reviewer
    severity: P3
    status: open
    summary: "Stage 5 gate wiring choice (decompose.ts flag vs in-validator) is a legitimately bounded implementation choice pinned by acceptance tests; no change required. Advisory only."
    resolution: null
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| cr-001 | stage-3 | shared-test-file-no-dependency-edge | contract-reviewer | P1 | open | Both runbook-heal-resolution and stage5-readonly-gate list lib/ledger.test.ts with depends_on []; no ordering constraint means the second Builder can clobber the first's test additions to the shared file. |  |
| cr-003 | stage-3 | stage-3-batch-id-collides-with-plan-revision-requirement | contract-reviewer | P1 | open | Plan scopes runbook-heal to batch_id stage-3 too, but validateFindingResolution short-circuits stage-3 findings to plan-revision only, so the new arm is unreachable for stage-3; behavior is unspecified and untested. |  |
| cr-004 | stage-3 | deliverable-path-definition-undefined-plan-wide | contract-reviewer | P1 | open | The abuse guard's deliverable-path/control-plane-allowlist concept is new and plan-wide but leaves edges undefined: mixed control-plane+deliverable commits, and crucially whether the per-issue ledger path docs/runbooks/issue-to-pr/ is in the allowlist (U5 amend and Stage 5 checkpoints touch it). |  |
| cr-002 | stage-3 | cited-function-name-does-not-exist | contract-reviewer | P2 | open | Plan cites validateFinalFindingResolution; the real function is validateFindingResolution (the cited line range is correct). Mild plan/DAG drift. |  |
| cr-005 | stage-3 | stage5-gate-wiring-choice-bounded | contract-reviewer | P3 | open | Stage 5 gate wiring choice (decompose.ts flag vs in-validator) is a legitimately bounded implementation choice pinned by acceptance tests; no change required. Advisory only. |  |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

- 2026-05-24T16:47+10:00 — Stage 1: AC confirmed by Nathan (source: gold-standard, high confidence, 6 criteria). Full scope: Reading A guarded runbook-heal resolution + Stage 5 read-only gate + carve-out doc + tests. Feature branch feat/issue-71-pending created from main (post-PR-70 merge, commit dc6868a). Recursion noted: the deliverable is the issue-to-pr runbook + lib code itself.

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
