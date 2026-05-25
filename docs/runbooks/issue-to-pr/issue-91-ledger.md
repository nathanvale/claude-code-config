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
final_reviewed_at: "2026-05-25T02:23:34Z"
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
    status: converged
    builder_commits:
      - "09bdac7"
    builder_attempts:
      - attempt_type: "implementation"
        status: "committed"
        commit_sha: "09bdac7"
        files_touched:
          - "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"
          - "runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md"
        route_hint: null
        blockers: []
        probe_results: []
        notes: "Added body-sections item 7 plus entry-fields subsection in ledger-and-helper.md; tightened per-issue-vs-registry split prose in workflow-learnings-registry.md; ce-correctness-reviewer validator wave confirmed schema consistency across template + both references and returned zero findings."
    iterations: 1
    final_verdict: converged
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
    status: converged
    builder_commits:
      - "1854690"
    builder_attempts:
      - attempt_type: "implementation"
        status: "committed"
        commit_sha: "1854690"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/decompose.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: null
        blockers: []
        probe_results: []
        notes: "General-purpose Builder sub-agent dispatched with rendered Work Packet; tdd flow: red (TS2305 confirmed), then green (validator + CLI dispatch + 20 tests); 96/96 ledger tests pass, tsc 0 errors, biome clean on new code. ce-correctness-reviewer validator wave returned zero findings, confirmed whitelist symmetry with registry ALLOWED_EVIDENCE_KEYS (minus run, plus signature) and template/validator parity."
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
findings:
  - id: "f-stage3-001"
    batch_id: "stage-3"
    signature: "tdd-mode-split-across-impl-and-test-batches"
    persona: "ce-correctness-reviewer"
    severity: "P1"
    status: "fixed"
    summary: "Candidate U3 (ledger-validator) was tdd-mode but contained only impl files; U4 (validator-tests) was tdd-mode but contained only the test file. The DAG forced impl-then-tests, contradicting the per-batch tdd contract."
    resolution: "plan-revision 34f61b9"
  - id: "f-final-001"
    batch_id: "final"
    signature: "section-regex-not-column-anchored"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "lib/ledger.ts section regex lacks start-of-line anchor. A column-0 ## Workflow Learnings line inside any code fence above the real section triggers spurious duplicate-section gate."
    resolution: "deferred-P2"
  - id: "f-final-002"
    batch_id: "final"
    signature: "section-lookahead-truncates-on-inner-h2"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "lib/ledger.ts section terminator lookahead truncates section capture if a column-0 ## appears inside a multiline YAML literal value (e.g. quoting a markdown heading); reports as no fenced yaml block."
    resolution: "deferred-P2"
  - id: "f-final-003"
    batch_id: "final"
    signature: "fenced-block-close-not-line-anchored"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "lib/ledger.ts fenced-block regex closing fence is not line-anchored; inline triple-backticks inside a value (e.g. quoting a markdown fence) truncate the captured body. Registry helper uses stricter line-anchored close."
    resolution: "deferred-P2"
  - id: "f-final-004"
    batch_id: "final"
    signature: "outer-4backtick-fence-naive"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "lib/ledger.ts fenced-block regex has no outer 4-backtick wrapper awareness; today the multiple-blocks gate prevents silent corruption, but regex is fence-naive and could regress if that check is loosened."
    resolution: "deferred-P3"
  - id: "f-final-005"
    batch_id: "final"
    signature: "yaml-coerced-scalar-misleading-error"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "Bun.YAML.parse coerces signature: 1 -> number and signature: null -> null. Validator typeof catches these but emits 'missing required string field' even though the value is present. Docs do not warn that string fields need quoting."
    resolution: "deferred-P3"
  - id: "f-final-006"
    batch_id: "final"
    signature: "yaml-duplicate-keys-silently-accepted"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "Bun.YAML.parse silently accepts duplicate mapping keys (later wins). Other ledger validators (parseFlatBatchBlock, parseLedgerFindings) walk lines and detect duplicates; validateWorkflowLearnings does not. Duplicate signature would silently survive."
    resolution: "deferred-P2"
  - id: "f-final-007"
    batch_id: "final"
    signature: "no-required-keys-constant-drift-risk"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "Required-keys triple is inlined in validator instead of a named WORKFLOW_LEARNINGS_REQUIRED_KEYS constant. Same triple restated in docstring, template, and two reference docs. Four-five parallel sources of truth that can drift independently."
    resolution: "deferred-P3"
  - id: "f-final-008"
    batch_id: "final"
    signature: "unknown-key-check-before-required-key-check"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "Unknown-field check fires before required-field check. An entry that both leaks a canonical field and omits signature reports only the leak; operator round-trips to discover the missing field. UX regression vs validateFindingsData."
    resolution: "deferred-P3"
  - id: "f-final-009"
    batch_id: "final"
    signature: "canonical-leak-emits-generic-unknown-field"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "When a canonical/lifecycle registry field leaks into a ledger entry, validator emits generic 'unknown field' instead of the registry-vs-ledger context the docstring promises operators."
    resolution: "deferred-P3"
  - id: "f-final-010"
    batch_id: "final"
    signature: "validator-not-re-exported-from-validate-ts"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "validateWorkflowLearnings is not re-exported from lib/validate.ts (the documented re-export surface for validators). decompose.ts imports it directly from ./lib/ledger; lib/validate.test.ts has no identity test pinning the new export."
    resolution: "deferred-P2"
  - id: "f-final-011"
    batch_id: "final"
    signature: "no-decompose-char-suite-coverage"
    persona: "code-review"
    severity: "P2"
    status: "deferred-P2"
    summary: "decompose.test.ts has zero references to --validate-workflow-learnings. In-process coverage exists in lib/ledger.test.ts but the process-boundary char suite (exit codes, stderr formatting) is uncovered. Validator dispatch block in decompose.ts could be deleted without test failure."
    resolution: "deferred-P2"
  - id: "f-final-012"
    batch_id: "final"
    signature: "no-blocked-route-id-for-missing-section"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "lib/route.ts BLOCKED_ROUTE_IDS has no entry for missing/invalid Workflow Learnings section. Today the validator is opt-in via its own flag; will become an integration gap when scan/upsert lands."
    resolution: "deferred-P3"
  - id: "f-final-013"
    batch_id: "final"
    signature: "ledger-registry-schema-asymmetry-undocumented-transform"
    persona: "code-review"
    severity: "P3"
    status: "deferred-P3"
    summary: "WORKFLOW_LEARNINGS_ALLOWED_KEYS and registry's ALLOWED_EVIDENCE_KEYS differ by +signature/-run (intentional per plan). No transform pipeline yet exists to drop signature and inject run when upserting a ledger entry to the registry. Future-slice integration risk."
    resolution: "deferred-P3"
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| f-stage3-001 | stage-3 | tdd-mode-split-across-impl-and-test-batches | ce-correctness-reviewer | P1 | fixed | Candidate U3 (ledger-validator) was tdd-mode but contained only impl files; U4 (validator-tests) was tdd-mode but contained only the test file. The DAG forced impl-then-tests, contradicting the per-batch tdd contract. | plan-revision 34f61b9 |
| f-final-001 | final | section-regex-not-column-anchored | code-review | P2 | deferred-P2 | lib/ledger.ts section regex lacks start-of-line anchor. A column-0 ## Workflow Learnings line inside any code fence above the real section triggers spurious duplicate-section gate. | deferred-P2 |
| f-final-002 | final | section-lookahead-truncates-on-inner-h2 | code-review | P2 | deferred-P2 | lib/ledger.ts section terminator lookahead truncates section capture if a column-0 ## appears inside a multiline YAML literal value (e.g. quoting a markdown heading); reports as no fenced yaml block. | deferred-P2 |
| f-final-003 | final | fenced-block-close-not-line-anchored | code-review | P2 | deferred-P2 | lib/ledger.ts fenced-block regex closing fence is not line-anchored; inline triple-backticks inside a value (e.g. quoting a markdown fence) truncate the captured body. Registry helper uses stricter line-anchored close. | deferred-P2 |
| f-final-004 | final | outer-4backtick-fence-naive | code-review | P3 | deferred-P3 | lib/ledger.ts fenced-block regex has no outer 4-backtick wrapper awareness; today the multiple-blocks gate prevents silent corruption, but regex is fence-naive and could regress if that check is loosened. | deferred-P3 |
| f-final-005 | final | yaml-coerced-scalar-misleading-error | code-review | P3 | deferred-P3 | Bun.YAML.parse coerces signature: 1 -> number and signature: null -> null. Validator typeof catches these but emits 'missing required string field' even though the value is present. Docs do not warn that string fields need quoting. | deferred-P3 |
| f-final-006 | final | yaml-duplicate-keys-silently-accepted | code-review | P2 | deferred-P2 | Bun.YAML.parse silently accepts duplicate mapping keys (later wins). Other ledger validators (parseFlatBatchBlock, parseLedgerFindings) walk lines and detect duplicates; validateWorkflowLearnings does not. Duplicate signature would silently survive. | deferred-P2 |
| f-final-007 | final | no-required-keys-constant-drift-risk | code-review | P3 | deferred-P3 | Required-keys triple is inlined in validator instead of a named WORKFLOW_LEARNINGS_REQUIRED_KEYS constant. Same triple restated in docstring, template, and two reference docs. Four-five parallel sources of truth that can drift independently. | deferred-P3 |
| f-final-008 | final | unknown-key-check-before-required-key-check | code-review | P3 | deferred-P3 | Unknown-field check fires before required-field check. An entry that both leaks a canonical field and omits signature reports only the leak; operator round-trips to discover the missing field. UX regression vs validateFindingsData. | deferred-P3 |
| f-final-009 | final | canonical-leak-emits-generic-unknown-field | code-review | P3 | deferred-P3 | When a canonical/lifecycle registry field leaks into a ledger entry, validator emits generic 'unknown field' instead of the registry-vs-ledger context the docstring promises operators. | deferred-P3 |
| f-final-010 | final | validator-not-re-exported-from-validate-ts | code-review | P2 | deferred-P2 | validateWorkflowLearnings is not re-exported from lib/validate.ts (the documented re-export surface for validators). decompose.ts imports it directly from ./lib/ledger; lib/validate.test.ts has no identity test pinning the new export. | deferred-P2 |
| f-final-011 | final | no-decompose-char-suite-coverage | code-review | P2 | deferred-P2 | decompose.test.ts has zero references to --validate-workflow-learnings. In-process coverage exists in lib/ledger.test.ts but the process-boundary char suite (exit codes, stderr formatting) is uncovered. Validator dispatch block in decompose.ts could be deleted without test failure. | deferred-P2 |
| f-final-012 | final | no-blocked-route-id-for-missing-section | code-review | P3 | deferred-P3 | lib/route.ts BLOCKED_ROUTE_IDS has no entry for missing/invalid Workflow Learnings section. Today the validator is opt-in via its own flag; will become an integration gap when scan/upsert lands. | deferred-P3 |
| f-final-013 | final | ledger-registry-schema-asymmetry-undocumented-transform | code-review | P3 | deferred-P3 | WORKFLOW_LEARNINGS_ALLOWED_KEYS and registry's ALLOWED_EVIDENCE_KEYS differ by +signature/-run (intentional per plan). No transform pipeline yet exists to drop signature and inject run when upserting a ledger entry to the registry. Future-slice integration risk. | deferred-P3 |

## Notes

