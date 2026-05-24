---
issue_number: 90
issue_title: "Add the workflow learnings registry helper"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/90"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-25-002-feat-workflow-learnings-registry-helper-plan.md"
started_at: "2026-05-25T08:25:02+1000"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-25T08:25:02+1000"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-25T08:37:14+1000"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:9da9ab9f9c9043088d83213851d61f5ae5f1b19234aa6ada735d51c07c29dfd1"
batch_contract_digest: "sha256:9ce54fc1c34c46a2e3ccf5a08154e793b749e3ed10d0bae4837f65f2aca81a21"
ac_digest: "sha256:17e9d98826395a5c32a2439fe846e176880adcd0af5e4d768d376476d59eb6f9"
---

# Issue 90 - Add the workflow learnings registry helper

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

- [ ] A repo-level Workflow Learnings registry exists in the Issue-to-PR runbook documentation area as human-readable Markdown with a structured YAML block.
- [ ] A focused helper validates required fields, allowed dispositions, allowed lifecycle statuses, owner classifications, confidence values, candidate-file shape, and duplicate/upsert behavior.
- [ ] Upsert appends run evidence and updates lifecycle fields without silently overwriting canonical fields such as summary, owner, or retirement condition unless the candidate explicitly marks a canonical update.
- [ ] The helper accepts both JSON and YAML candidate files, and malformed candidate files fail with actionable errors.
- [ ] The helper cannot write skills, runbook references, source code, per-issue ledgers, or any surface outside the registry metadata it owns.
- [ ] Tests cover accepted inputs, rejected malformed entries, dedupe/upsert behavior, evidence append behavior, lifecycle updates, canonical-field overwrite protection, and write-scope limits.

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
  - id: "registry-file"
    name: "Create the workflow learnings registry file"
    goal: "A repo-level Workflow Learnings registry exists in the Issue-to-PR runbook documentation area as human-readable Markdown with a structured YAML block."
    files:
      - "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md"
    depends_on: []
    execution_mode: proof_first
    acceptance_tests:
      - "AC 1 holds: the registry file exists at runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md as Markdown, and its single fenced yaml block parses to { learnings: [] }."
    ac_mapping:
      - 1
    rationale: "proof_first: greenfield scaffold file; the right first move is a target-state parse check (Bun.YAML.parse yields { learnings: [] }) before/with creating it, as a red test would be artificial for a static doc."
    status: converged
    builder_commits:
      - 3c523726d94866396b9894543d0663d300e6e3c2
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: 3c523726d94866396b9894543d0663d300e6e3c2
        files_touched:
          - "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md"
        route_hint: "validate registry-file batch (AC1); proceed to next batch"
        blockers: []
        probe_results:
          - "bun -e '...' is a silent no-op in this sandbox; proof must run from a script file"
        notes: "Created workflow-learnings-registry.md with documented schema and a single seeded learnings: [] yaml block; proof passes (caught and fixed an inline-prose phantom second yaml block)."
    iterations: 1
    final_verdict: converged
  - id: "validate-op"
    name: "Registry parse, schema validation, and the --validate operation"
    goal: "A focused helper validates required fields, allowed dispositions, allowed lifecycle statuses, owner classifications, and confidence values."
    files:
      - "runbooks/issue-to-pr-v2/lib/learnings.ts"
      - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
      - "runbooks/issue-to-pr-v2/learnings-registry.ts"
    depends_on:
      - "registry-file"
    execution_mode: tdd
    acceptance_tests:
      - "AC 2 holds: validateRegistry accepts a well-formed entry and rejects each of missing-required-field, bad disposition, bad status, bad owner, and bad confidence with an actionable error; --validate surfaces the same via exit code."
    ac_mapping:
      - 2
    rationale: null
    status: converged
    builder_commits:
      - 72778e02eb374f15ee7e483f48fe05b10b367499
      - fad4c0a666c8616c4c178347a5f10a331b24a236
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: 72778e02eb374f15ee7e483f48fe05b10b367499
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.ts"
        route_hint: "candidate-ingest batch, then upsert-op"
        blockers: []
        probe_results: []
        notes: "parseRegistry + validateRegistry + --validate dispatcher; 18/18 tests green, tsc/biome clean."
      - attempt_type: repair
        status: committed
        commit_sha: fad4c0a666c8616c4c178347a5f10a331b24a236
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
        route_hint: "repair P1 roundtrip-backtick-in-value-truncates-block"
        blockers: []
        probe_results:
          - "red 18/19 then green 19/19; column-0 line-anchored fence close"
        notes: "Fixed parseRegistry fence-close to a column-0 line-anchored fence so inline backticks in YAML scalars no longer truncate the block; closes F7 P1."
    iterations: 2
    final_verdict: converged
  - id: "candidate-ingest"
    name: "Candidate-file ingestion (JSON + YAML) and candidate-shape validation"
    goal: "The helper accepts both JSON and YAML candidate files, and malformed candidate files fail with actionable errors."
    files:
      - "runbooks/issue-to-pr-v2/lib/learnings.ts"
      - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
    depends_on:
      - "validate-op"
    execution_mode: tdd
    acceptance_tests:
      - "AC 4 holds: a valid JSON candidate and an equivalent valid YAML candidate both load to the same validated structure; malformed JSON, malformed YAML, and unrecognized-extension inputs each fail with an actionable error naming the file."
    ac_mapping:
      - 4
    rationale: null
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "upsert-op"
    name: "Signature dedupe, evidence append, lifecycle update, and canonical-overwrite protection"
    goal: "Upsert appends run evidence and updates lifecycle fields without silently overwriting canonical fields such as summary, owner, or retirement condition unless the candidate explicitly marks a canonical update."
    files:
      - "runbooks/issue-to-pr-v2/lib/learnings.ts"
      - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
      - "runbooks/issue-to-pr-v2/learnings-registry.ts"
    depends_on:
      - "candidate-ingest"
    execution_mode: tdd
    acceptance_tests:
      - "AC 3 holds: upsert by matching signature appends evidence and updates lifecycle fields, preserves canonical summary/owner/retirement_condition by default, and replaces them only when the candidate sets canonical_update: true; a non-matching signature appends a new entry."
    ac_mapping:
      - 3
      - 2
    rationale: "ac_mapping includes 2 because this unit also satisfies AC2's dedupe/upsert-behavior clause; AC2's enum-validation clause is covered by U2."
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "write-scope"
    name: "Write-scope enforcement - registry-only writes"
    goal: "The helper cannot write skills, runbook references, source code, per-issue ledgers, or any surface outside the registry metadata it owns."
    files:
      - "runbooks/issue-to-pr-v2/lib/learnings.ts"
      - "runbooks/issue-to-pr-v2/learnings-registry.ts"
      - "runbooks/issue-to-pr-v2/learnings-registry.test.ts"
    depends_on:
      - "upsert-op"
    execution_mode: tdd
    acceptance_tests:
      - "AC 5 holds: --upsert writes only the owned registry path; targeting a skill, another reference, a lib source file, a per-issue ledger, or a traversal path is refused before any write, and the forbidden file is proven unmodified."
      - "AC 6 holds: the co-located test suites across U2-U5 cover accepted inputs, rejected malformed entries, dedupe/upsert behavior, evidence append, lifecycle updates, canonical-field overwrite protection, and write-scope limits."
    ac_mapping:
      - 5
      - 6
    rationale: "ac_mapping includes 6 because AC6 is a cross-cutting test-coverage requirement satisfied by the co-located test suites across U2-U5, not by a standalone unit; it is anchored here on the final test-bearing unit (which also delivers AC6's explicitly-named write-scope-limits tests)."
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
  - id: F1
    batch_id: stage-3
    signature: u4-forward-references-u5-write-guard
    persona: correctness
    severity: P2
    status: open
    summary: "U4 approach text forward-references the U5 write-scope guard; advisory sequencing note"
    resolution: null
  - id: F2
    batch_id: stage-3
    signature: ac6-coverage-anchored-only-on-write-scope
    persona: correctness
    severity: P2
    status: open
    summary: "AC6 cross-cutting test coverage is machine-mapped only to U5; per-unit test scenarios cover the behaviors"
    resolution: null
  - id: F3
    batch_id: registry-file
    signature: readme-file-map-missing-registry-entry
    persona: ce-project-standards-reviewer
    severity: P2
    status: deferred-P2
    summary: "New references/workflow-learnings-registry.md is not added to the README 'File map' item 6 which enumerates every references/*.md file by name; index is now stale"
    resolution: deferred-P2
  - id: F4
    batch_id: registry-file
    signature: registry-single-yaml-block-no-committed-regression-guard
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "Single-fenced-yaml-block invariant verified by a one-off parse check, not a committed regression test; later helper batches own the durable scan test"
    resolution: deferred-P3
  - id: F5
    batch_id: registry-file
    signature: invariant-claim-mismatches-cited-helper-scope
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "Prose claims the future helper uses the same fenced-yaml scan as the ledger helper, but the ledger helper is section-scoped not whole-file; registry's stricter whole-file invariant is safe but the precedent description is imprecise"
    resolution: deferred-P3
  - id: F6
    batch_id: registry-file
    signature: read-trigger-callout-not-near-top
    persona: ce-project-standards-reviewer
    severity: P3
    status: deferred-P3
    summary: "Sibling references place the Read trigger callout in the header block; this file places it after three intro paragraphs (callout exists, position deviates)"
    resolution: deferred-P3
  - id: F7
    batch_id: validate-op
    signature: roundtrip-backtick-in-value-truncates-block
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "parseRegistry lazy fenced-yaml regex closes at the first code-fence sequence anywhere in the block, so any registry value containing a backtick-fence sequence truncates the YAML and parse throws; latent round-trip trap for upsert-op when real entries hold fence references"
    resolution: "commit fad4c0a666c8616c4c178347a5f10a331b24a236"
  - id: F8
    batch_id: validate-op
    signature: case-insensitive-fence-accepts-uppercase-YAML
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "The case-insensitive flag accepts an uppercase or suffixed yaml fence as the data block, weaker than the doc single-block wording (mirrors ledger.ts, so consistent)"
    resolution: deferred-P3
  - id: F9
    batch_id: validate-op
    signature: empty-string-enum-double-report
    persona: ce-correctness-reviewer
    severity: P3
    status: deferred-P3
    summary: "An empty-string enum field emits two error lines (missing-required AND invalid-value); still rejects correctly but double-reports"
    resolution: deferred-P3
  - id: F10
    batch_id: validate-op
    signature: validate-op-secondary-error-branches-untested
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "Secondary error branches untested: non-object/null entry, evidence-not-array, malformed-yaml parse failure, index-fallback label, and multi-entry error aggregation; AC2 core enum/required behaviors are covered with strong assertions"
    resolution: deferred-P3
  - id: F11
    batch_id: validate-op
    signature: readme-file-map-omits-learnings-modules
    persona: ce-project-standards-reviewer
    severity: P3
    status: deferred-P3
    summary: "README File map enumerates lib/ modules and root helpers by name but is not updated for new lib/learnings.ts or root learnings-registry.ts; README is outside this batch's files list"
    resolution: deferred-P3
  - id: F12
    batch_id: validate-op
    signature: parseregistry-jsdoc-claims-ledger-parity-now-false
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "parseRegistry JSDoc still claims it mirrors ledger.ts with the same fenced-yaml regex, but the repair diverged them; ledger.ts keeps the old regex while learnings.ts is now column-0 anchored, so the documented parity is stale"
    resolution: deferred-P3
  - id: F13
    batch_id: validate-op
    signature: closing-fence-trailing-whitespace-tolerance-untested
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "New regex adds trailing-whitespace tolerance on the closing fence but no test exercises a closing fence with trailing spaces, so that branch is unguarded"
    resolution: deferred-P3
  - id: F14
    batch_id: validate-op
    signature: column-0-fence-inside-value-still-truncates-undocumented-in-tests
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "The fix relies on the assumption that a column-0 fence cannot appear inside a yaml scalar value (not producible by a real serializer); this residual limitation is asserted only in a source comment, not pinned by a test"
    resolution: deferred-P3
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| F1 | stage-3 | u4-forward-references-u5-write-guard | correctness | P2 | open | U4 approach text forward-references the U5 write-scope guard; advisory sequencing note | |
| F2 | stage-3 | ac6-coverage-anchored-only-on-write-scope | correctness | P2 | open | AC6 cross-cutting test coverage is machine-mapped only to U5; per-unit test scenarios cover the behaviors | |
| F3 | registry-file | readme-file-map-missing-registry-entry | ce-project-standards-reviewer | P2 | deferred-P2 | New references/workflow-learnings-registry.md is not added to the README 'File map' item 6 which enumerates every references/*.md file by name; index is now stale | deferred-P2 |
| F4 | registry-file | registry-single-yaml-block-no-committed-regression-guard | ce-testing-reviewer | P3 | deferred-P3 | Single-fenced-yaml-block invariant verified by a one-off parse check, not a committed regression test; later helper batches own the durable scan test | deferred-P3 |
| F5 | registry-file | invariant-claim-mismatches-cited-helper-scope | ce-maintainability-reviewer | P3 | deferred-P3 | Prose claims the future helper uses the same fenced-yaml scan as the ledger helper, but the ledger helper is section-scoped not whole-file; registry's stricter whole-file invariant is safe but the precedent description is imprecise | deferred-P3 |
| F6 | registry-file | read-trigger-callout-not-near-top | ce-project-standards-reviewer | P3 | deferred-P3 | Sibling references place the Read trigger callout in the header block; this file places it after three intro paragraphs (callout exists, position deviates) | deferred-P3 |
| F7 | validate-op | roundtrip-backtick-in-value-truncates-block | ce-adversarial-reviewer | P1 | fixed | parseRegistry lazy fenced-yaml regex closes at the first code-fence sequence anywhere in the block, so any registry value containing a backtick-fence sequence truncates the YAML and parse throws; latent round-trip trap for upsert-op when real entries hold fence references | commit fad4c0a666c8616c4c178347a5f10a331b24a236 |
| F8 | validate-op | case-insensitive-fence-accepts-uppercase-YAML | ce-adversarial-reviewer | P3 | deferred-P3 | The case-insensitive flag accepts an uppercase or suffixed yaml fence as the data block, weaker than the doc single-block wording (mirrors ledger.ts, so consistent) | deferred-P3 |
| F9 | validate-op | empty-string-enum-double-report | ce-correctness-reviewer | P3 | deferred-P3 | An empty-string enum field emits two error lines (missing-required AND invalid-value); still rejects correctly but double-reports | deferred-P3 |
| F10 | validate-op | validate-op-secondary-error-branches-untested | ce-testing-reviewer | P3 | deferred-P3 | Secondary error branches untested: non-object/null entry, evidence-not-array, malformed-yaml parse failure, index-fallback label, and multi-entry error aggregation; AC2 core enum/required behaviors are covered with strong assertions | deferred-P3 |
| F11 | validate-op | readme-file-map-omits-learnings-modules | ce-project-standards-reviewer | P3 | deferred-P3 | README File map enumerates lib/ modules and root helpers by name but is not updated for new lib/learnings.ts or root learnings-registry.ts; README is outside this batch's files list | deferred-P3 |
| F12 | validate-op | parseregistry-jsdoc-claims-ledger-parity-now-false | ce-adversarial-reviewer | P3 | deferred-P3 | parseRegistry JSDoc still claims it mirrors ledger.ts with the same fenced-yaml regex, but the repair diverged them; ledger.ts keeps the old regex while learnings.ts is now column-0 anchored, so the documented parity is stale | deferred-P3 |
| F13 | validate-op | closing-fence-trailing-whitespace-tolerance-untested | ce-testing-reviewer | P3 | deferred-P3 | New regex adds trailing-whitespace tolerance on the closing fence but no test exercises a closing fence with trailing spaces, so that branch is unguarded | deferred-P3 |
| F14 | validate-op | column-0-fence-inside-value-still-truncates-undocumented-in-tests | ce-testing-reviewer | P3 | deferred-P3 | The fix relies on the assumption that a column-0 fence cannot appear inside a yaml scalar value (not producible by a real serializer); this residual limitation is asserted only in a source comment, not pinned by a test | deferred-P3 |
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
