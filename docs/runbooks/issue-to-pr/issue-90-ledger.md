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
final_reviewed_at: "2026-05-25T10:39:45+1000"
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
    status: converged
    builder_commits:
      - 8521ec3c5aac3ed0e15a4b053ef36a5a774330b8
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: 8521ec3c5aac3ed0e15a4b053ef36a5a774330b8
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
        route_hint: "upsert-op batch (signature derivation + upsert + serializeRegistry + --upsert wiring)"
        blockers: []
        probe_results: []
        notes: "loadCandidate (JSON/YAML by extension, actionable file-naming errors) + validateCandidate (shape + reused enums); shared checkEnumFields refactor; candidate evidence is a single record object (upsert-op appends to entry list); 34/34 tests green, tsc/biome clean."
    iterations: 1
    final_verdict: converged
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
    status: converged
    builder_commits:
      - a53320e84a696d61a0271c809ba20c79533e67b4
      - bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc
      - e4c76c8d3b12b6ed728824d55e7ad5a0c5f31433
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: a53320e84a696d61a0271c809ba20c79533e67b4
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.ts"
        route_hint: "write-scope batch next"
        blockers: []
        probe_results: []
        notes: "signatureFor + upsert + serializeRegistry (with hand-rolled block-style YAML emitter) + --upsert dispatcher wiring; 56 new tests green, full v2 suite 668/668."
      - attempt_type: repair
        status: committed
        commit_sha: bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.ts"
        route_hint: "wave repair closing F22+F23+F24+F25"
        blockers: []
        probe_results:
          - "65/65 lib tests green, 677/677 v2 suite, tsc/biome clean"
        notes: "Wave fix: emitScalar escapes C0 controls + DEL (F22); ALLOWED_EVIDENCE_KEYS whitelist in validateCandidate (F23); parseRegistryFromString + dispatcher re-validate gate before write (F24); lifecycle-omission contract pinned by new tests (F25)."
      - attempt_type: repair
        status: committed
        commit_sha: e4c76c8d3b12b6ed728824d55e7ad5a0c5f31433
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/lib/learnings.test.ts"
        route_hint: "extend whitelist to validateRegistry symmetry"
        blockers: []
        probe_results:
          - "68/68 lib tests, 680/680 v2 suite, tsc/biome clean"
        notes: "Extended ALLOWED_EVIDENCE_KEYS whitelist to validateRegistry so stored entries with poisoned keys are rejected EARLY with an actionable error rather than DoS-ing future upserts at the late re-validate gate (F33)."
    iterations: 3
    final_verdict: converged
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
    status: converged
    builder_commits:
      - f08f72e3965d6bc98874bdf30add916f20c0c56a
      - b6bbeb03c953852f5832b05fa6c99420e1ab9ad2
      - 5d56aa7d579023ad9377ea30aae7ea4e2ac92794
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: f08f72e3965d6bc98874bdf30add916f20c0c56a
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.test.ts"
        route_hint: "ready for validator"
        blockers: []
        probe_results: []
        notes: "assertRegistryWriteTarget initial implementation (denylist approach); 16 new tests, 696/696 v2 suite green."
      - attempt_type: repair
        status: committed
        commit_sha: b6bbeb03c953852f5832b05fa6c99420e1ab9ad2
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.test.ts"
        route_hint: "wave repair closing F40+F41+F42"
        blockers: []
        probe_results:
          - "33/33 ws + 68/68 lib + 713/713 v2"
        notes: "Switched from denylist to tail-match allowlist + os.tmpdir() escape; case-insensitive comparisons; SOURCE_EXTENSIONS covers .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs."
      - attempt_type: repair
        status: committed
        commit_sha: 5d56aa7d579023ad9377ea30aae7ea4e2ac92794
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/learnings.ts"
          - "runbooks/issue-to-pr-v2/learnings-registry.test.ts"
        route_hint: "wave repair closing F48+F49"
        blockers: []
        probe_results:
          - "41/41 ws + 68/68 lib + 721/721 v2"
        notes: "Repo-root anchoring via git rev-parse + package.json fallback; production accept rule requires resolved candidate path equals canonical absolute path; tightened tmpdir-escape to only allow registry.md or workflow-learnings-registry.md leaves with no bare .md and no control chars."
    iterations: 3
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
  - id: F15
    batch_id: candidate-ingest
    signature: ac4-json-valid-non-object-edge-untested
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "No test for a .json file containing valid JSON that is not an object (e.g. 42 or a bare string); load->validate boundary for valid-but-non-object JSON is unpinned (code path verified correct)"
    resolution: deferred-P2
  - id: F16
    batch_id: candidate-ingest
    signature: yaml-numeric-string-coercion-vs-json-parity
    persona: ce-correctness-reviewer
    severity: P3
    status: deferred-P3
    summary: "JSON/YAML parity is exact for string/null/boolean scalars but an unquoted numeric-looking value parses to number in YAML vs string in JSON; contained because validateCandidate rejects non-strings (fails loud rather than diverging silently)"
    resolution: deferred-P3
  - id: F17
    batch_id: candidate-ingest
    signature: ac4-empty-file-edges-untested
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "Empty-file edges unpinned: an empty .yaml parses to null (no throw) and an empty .json throws; neither path has a regression guard"
    resolution: deferred-P3
  - id: F18
    batch_id: candidate-ingest
    signature: unrecognized-ext-msg-incomplete-assertion
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "Unrecognized-extension test asserts the message names the file and the bad ext but does not assert it lists the supported extensions; part of the actionable message is unverified"
    resolution: deferred-P3
  - id: F19
    batch_id: candidate-ingest
    signature: checkenumfields-label-empty-branch-unreachable
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "checkEnumFields documents an empty-string label as the top-level/candidate convention, but neither caller passes empty; the label-empty branch is unreachable and the doc comment misdescribes actual usage"
    resolution: deferred-P3
  - id: F20
    batch_id: candidate-ingest
    signature: candidate-required-strings-implicit-coupling-to-registry
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "validateCandidate derives required fields as REQUIRED_STRING_FIELDS minus signature; a future addition to the registry required list silently becomes required on candidates too, an implicit coupling"
    resolution: deferred-P3
  - id: F21
    batch_id: candidate-ingest
    signature: candidate-missing-test-pushes-file-not-dir-to-cleanup
    persona: ce-correctness-reviewer
    severity: P3
    status: deferred-P3
    summary: "In the unreadable-candidate test the file path is pushed to tempDirs instead of the parent temp dir, so afterEach rmSync best-effort-skips it and the created temp dir leaks; test correctness unaffected"
    resolution: deferred-P3
  - id: F22
    batch_id: upsert-op
    signature: emit-scalar-nul-byte-breaks-yaml-roundtrip
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "emitScalar leaves a NUL byte (U+0000) literal in the double-quoted scalar, so any candidate whose summary or evidence field contains a NUL crashes Bun.YAML.parse on re-read and the registry file on disk becomes unparseable"
    resolution: "commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc"
  - id: F23
    batch_id: upsert-op
    signature: emit-yaml-unescaped-mapping-keys-corrupt-file
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "emitYaml writes mapping keys verbatim (evidence record keys) with no escaping; an adversarial key containing a colon or newline produces a corrupt YAML body the next parseRegistry rejects"
    resolution: "commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc"
  - id: F24
    batch_id: upsert-op
    signature: dispatcher-writes-without-reparse-validate
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "The --upsert dispatcher serializes then writeFileSyncs the new markdown with no parseRegistry + validateRegistry round-trip on the emitted bytes; any emitter defect silently overwrites the registry with an unparseable file and the prior good state is lost"
    resolution: "commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc"
  - id: F25
    batch_id: upsert-op
    signature: lifecycle-omission-not-tested
    persona: ce-testing-reviewer
    severity: P1
    status: fixed
    summary: "No test asserts that omitting a lifecycle field (e.g. follow_up) on a candidate preserves the existing entry's value rather than blanking it; the contract is not pinned"
    resolution: "commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc"
  - id: F26
    batch_id: upsert-op
    signature: upsert-follow-up-omitted-not-blanked
    persona: ce-correctness-reviewer
    severity: P2
    status: deferred-P2
    summary: "Lifecycle merge uses `field in cand` for follow_up which means an explicit null in the candidate overwrites prior follow_up while an omitted follow_up preserves it; verify the intent (related to F25)"
    resolution: deferred-P2
  - id: F27
    batch_id: upsert-op
    signature: backtick-fence-value-test-too-weak
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "The validate-op-guard round-trip test embeds the backtick sequence as an escaped string literal; the in-memory value never contains a real newline or a real column-0 fence-sequence; the emitted yaml therefore cannot reproduce the truncation scenario it claims to guard"
    resolution: deferred-P2
  - id: F28
    batch_id: upsert-op
    signature: canonical-update-partial-omission-untested
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "The canonical-update branch only tests the all-fields-present case; no test covers canonical_update: true with one canonical field omitted, to confirm the omitted field is preserved rather than overwritten with undefined"
    resolution: deferred-P2
  - id: F29
    batch_id: upsert-op
    signature: emit-yaml-empty-evidence-record-produces-invalid-shape
    persona: ce-correctness-reviewer
    severity: P2
    status: deferred-P2
    summary: "emitYaml writes an `evidence:` parent line then iterates records; an empty record yields no list items so re-parse produces `evidence: null` which validateRegistry rejects (validateCandidate currently does not enforce per-evidence-field shape)"
    resolution: deferred-P2
  - id: F30
    batch_id: upsert-op
    signature: validate-candidate-skips-evidence-record-shape
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "validateCandidate accepts any object as the evidence record without checking key shape or value types; adversarial keys and non-string values flow into emitYaml which assumes safe input"
    resolution: deferred-P2
  - id: F31
    batch_id: upsert-op
    signature: serialize-reads-file-second-time-tocttou
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "serializeRegistry re-reads the registry from disk to capture surrounding prose, so between the dispatcher's parseRegistry call and this second read the file may have changed; produces a hybrid file. Combined with no file lock, concurrent runs silently last-write-wins"
    resolution: deferred-P2
  - id: F32
    batch_id: upsert-op
    signature: regex-parity-parseRegistry-serializeRegistry
    persona: ce-maintainability-reviewer
    severity: P2
    status: deferred-P2
    summary: "The fenced-yaml regex is duplicated (slightly differently) in parseRegistry and serializeRegistry; the two patterns can drift silently since neither references a shared constant"
    resolution: deferred-P2
  - id: F33
    batch_id: upsert-op
    signature: f23-whitelist-only-covers-candidate-evidence-keys-not-registry-keys
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "F23 whitelist guards candidate evidence keys only; existing-registry entries with arbitrary or YAML-special evidence keys flow through validateRegistry, get emitted verbatim by emitYaml, and would DoS every future upsert via the F24 gate"
    resolution: "commit e4c76c8d3b12b6ed728824d55e7ad5a0c5f31433"
  - id: F34
    batch_id: upsert-op
    signature: f23-evidence-value-types-not-validated-nested-shape-drifts-silently
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "validateCandidate enforces evidence KEYS but not VALUE types; an evidence value of nested object or array is upserted and emitted via JSON.stringify fallback, round-trips cleanly, and silently drifts the stored shape away from the documented string-scalar schema"
    resolution: deferred-P2
  - id: F35
    batch_id: upsert-op
    signature: f24-dispatcher-write-is-non-atomic-and-races-serializeregistry-second-read
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "Dispatcher writeFileSync is not atomic and serializeRegistry performs a second readFileSync on the same path; a concurrent upsert or mid-write process kill produces lost-update or truncated registry"
    resolution: deferred-P2
  - id: F36
    batch_id: upsert-op
    signature: f22-lone-utf16-surrogate-silently-replaced-with-u-fffd-on-roundtrip
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "A string containing an unpaired UTF-16 surrogate (e.g. U+D800) survives emitScalar unchanged but Bun.YAML.parse replaces it with U+FFFD on re-read; the re-validate gate passes and the value is silently mutated"
    resolution: deferred-P3
  - id: F37
    batch_id: upsert-op
    signature: validateregistry-allows-evidence-list-items-that-are-not-mappings
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "validateRegistry only checks Array.isArray on evidence and does not enforce per-item shape; a hand-edited registry whose evidence list contains a scalar item passes validation but makes the next serializeRegistry throw in emitYaml, blocking all subsequent upserts"
    resolution: deferred-P3
  - id: F38
    batch_id: upsert-op
    signature: f24-late-gate-no-longer-has-test-coverage
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The F24 re-validate gate code still exists in the dispatcher but no test exercises it after the F33 repair repurposed its fixture to the earlier gate; an emitYaml regression that produces parser-rejectable bytes would be undetectable by the suite (gate still catches at runtime)"
    resolution: deferred-P2
  - id: F39
    batch_id: upsert-op
    signature: validateregistry-silently-skips-malformed-evidence-records
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "validateRegistry's new whitelist loop skips evidence records that are null, scalar, or array via early return without recording an error; a hand-edited registry trips emitYaml with a generic message rather than an actionable validateRegistry error naming the entry"
    resolution: deferred-P3
  - id: F40
    batch_id: write-scope
    signature: write-scope-case-insensitive-fs-bypass
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "All denylist checks are case-sensitive but macOS default APFS is case-insensitive; paths like Skills/, References/, or Issue-90-Ledger.md bypass the guard and overwrite the real lowercase files on macOS"
    resolution: "commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2"
  - id: F41
    batch_id: write-scope
    signature: write-scope-non-ts-source-extension-bypass
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "Source-file denylist only matches .ts extension; legitimate TypeScript/JS source files with .mts, .cts, .tsx, .js, .jsx, .mjs, .cjs extensions slip through and can be overwritten with registry markdown"
    resolution: "commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2"
  - id: F42
    batch_id: write-scope
    signature: write-scope-denylist-vs-allowlist-foreign-path
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "Denylist accepts arbitrary unrelated paths (e.g. /tmp/random.md, README.md, package.json); AC5 spirit (cannot write any surface outside the registry it owns) materially violated; correct fix is a tail-match allowlist that keeps prior-batch tmp-path tests green"
    resolution: "commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2"
  - id: F43
    batch_id: write-scope
    signature: write-scope-symlink-bypass
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "Guard does no realpath/lstat resolution; a symlink at a non-canonical path is refused but a symlink at the canonical path could still trick the guard; narrow attack surface, mitigation requires realpathSync"
    resolution: deferred-P2
  - id: F44
    batch_id: write-scope
    signature: write-scope-references-deep-nesting-bypass
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The sibling-reference check only fires when parentDir is literally references; nested paths like references/subfolder/other.md bypass; tail-match allowlist would close this"
    resolution: deferred-P2
  - id: F45
    batch_id: write-scope
    signature: write-scope-references-non-md-bypass
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The references-sibling check requires filename.endsWith(.md); references/schema.json or references/notes.txt bypass the check"
    resolution: deferred-P2
  - id: F46
    batch_id: write-scope
    signature: write-scope-ledger-filename-prefix-bypass
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The per-issue ledger regex is filename-prefix-anchored; filenames with any prefix before issue- (e.g. preview-issue-90-ledger.md) bypass the check"
    resolution: deferred-P2
  - id: F47
    batch_id: write-scope
    signature: ws-tests-unrelated-tmp-path-acceptance-unpinned
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "No test pins the dispatcher behavior for a totally unrelated writable path; the deny-list accept rule is documented in a code comment but not asserted by a test"
    resolution: deferred-P2
  - id: F48
    batch_id: write-scope
    signature: f42-tmpdir-escape-still-accepts-arbitrary-md-files
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "F42 only partially closed: tmpdir-escape accepts ANY .md filename under os.tmpdir() (including /tmp/i_just_pwned_you.md) so long as no tripwire fires; AC5 spirit still violated for tmpdir-rooted paths"
    resolution: "commit 5d56aa7d579023ad9377ea30aae7ea4e2ac92794"
  - id: F49
    batch_id: write-scope
    signature: foreign-tail-match-no-repo-containment
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "Tail-match allowlist has no repo-root anchor; any absolute path that ends with the canonical relative path (e.g. /Users/attacker/runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md) is accepted; a caller in a wrong cwd, worktree, or attacker-staged decoy directory writes outside the real repo"
    resolution: "commit 5d56aa7d579023ad9377ea30aae7ea4e2ac92794"
  - id: F50
    batch_id: write-scope
    signature: tmpdir-escape-inconsistent-with-non-tmpdir-branch
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "Inconsistent contract: references/*.md is refused outside tmpdir but accepted under tmpdir; tmpdir tripwires only catch skills/, issue-*-ledger.md, source extensions; foreign reference markdown is not gated under tmpdir"
    resolution: deferred-P2
  - id: F51
    batch_id: write-scope
    signature: control-chars-and-bare-dotmd-accepted-under-tmpdir
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "Edge cases accepted under tmpdir: a file literally named .md, leaf names with embedded newline, segments containing skills as substring; defense-in-depth opportunity to tighten leaf shape under tmpdir"
    resolution: deferred-P3
  - id: F52
    batch_id: final
    signature: helper-zero-discovery-from-runbook-stages
    persona: ce-agent-native-reviewer
    severity: P1
    status: out-of-scope-for-this-issue
    summary: "Helper has zero discovery surface from any runbook stage or skill; the plan explicitly accepts this (Deferred to Follow-Up Work) since wiring into Stage 5 ship-tail is a separate slice of PRD #88"
    resolution: "out-of-scope-for-this-issue: wiring into Stage 5 / fail-stops is a separate sibling slice of PRD #88; this issue ships only the helper surface and registry per its scope boundaries"
  - id: F53
    batch_id: final
    signature: candidate-schema-not-documented
    persona: ce-agent-native-reviewer
    severity: P1
    status: out-of-scope-for-this-issue
    summary: "Candidate-file schema (extensions, evidence-record shape, allowed keys, dedupe rule) is not documented in references/workflow-learnings-registry.md; lives only in JSDoc on lib/learnings.ts"
    resolution: "out-of-scope-for-this-issue: candidate-schema docs follow-up; the helper IS the source of truth today; track as a follow-up issue to extend the registry doc with the candidate schema and a worked example before the helper is wired into a stage"
  - id: F54
    batch_id: final
    signature: dispatcher-toctou-lost-update-on-concurrent-upsert
    persona: ce-adversarial-reviewer
    severity: P1
    status: out-of-scope-for-this-issue
    summary: "Dispatcher pipeline is non-atomic (parseRegistry reads file, serializeRegistry re-reads); concurrent --upsert invocations can silently drop learnings via lost-update. No file lock or compare-and-swap"
    resolution: "out-of-scope-for-this-issue: helper is not wired into any stage yet so realistic concurrency is zero today; atomicity hardening (file lock or temp + rename with content-equality check) is a follow-up issue to land before the helper is wired into Stage 5 ship-tail"
  - id: F55
    batch_id: final
    signature: stage5-yaml-dispatcher-test-missing
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "AC4 parity (JSON + YAML candidate ingestion) is tested at lib level but no end-to-end --upsert dispatcher test exercises a .yaml candidate"
    resolution: deferred-P2
  - id: F56
    batch_id: final
    signature: stage5-candidate-factory-drift-across-tests
    persona: ce-testing-reviewer
    severity: P3
    status: deferred-P3
    summary: "Candidate factories duplicated across learnings-registry.test.ts (makeCandidate) and lib/learnings.test.ts (validCandidateObject + writeCandidate); schema evolution requires lockstep updates"
    resolution: deferred-P3
  - id: F57
    batch_id: final
    signature: stage5-readme-file-map-compounds-three-omissions
    persona: ce-project-standards-reviewer
    severity: P2
    status: deferred-P2
    summary: "README File map drift compounds: new top-level helper learnings-registry.ts AND new references/workflow-learnings-registry.md AND new lib/learnings.ts (F11) absent from maintainer finder; promote follow-up to update all three enumerations"
    resolution: deferred-P2
  - id: F58
    batch_id: final
    signature: stage5-unknown-top-level-fields-bleed-through-upsert
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "validateRegistry tolerates unknown top-level entry fields; upsert spread copies them through; emitYaml writes them verbatim; unknown fields persist forward (including potential prototype-pollution-shaped keys)"
    resolution: deferred-P2
  - id: F59
    batch_id: final
    signature: stage5-explicit-signature-collision-silent-merge
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "Candidate with explicit signature matching another entry silently merges unrelated evidence into that entry; signatureFor does not verify explicit vs derived signature consistency"
    resolution: deferred-P2
  - id: F60
    batch_id: final
    signature: stage5-duplicate-signature-registry-tolerated
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "validateRegistry does not enforce signature uniqueness across learnings; upsert's loop has no break so a duplicate is amplified, not orphaned; tolerated hand-edit corruption"
    resolution: deferred-P2
  - id: F61
    batch_id: final
    signature: stage5-module-cohesion-write-scope-seam
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "lib/learnings.ts is 1117 lines mixing schema constants, write-scope guard (~325 lines), parse, validate, upsert, and emit; natural seam at write-scope to extract before the next batch grows it"
    resolution: deferred-P3
  - id: F62
    batch_id: final
    signature: stage5-constants-split-canonical-fields-stranded
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "8 of 10 schema constants live in top-of-file block but CANONICAL_FIELDS and LIFECYCLE_FIELDS are stranded mid-file above signatureFor; incremental authorship left them inconsistent"
    resolution: deferred-P3
  - id: F63
    batch_id: final
    signature: stale-batch-status-jsdoc
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "lib/learnings.ts header and learnings-registry.ts comments say later-batch features are intentionally absent, but those features have all since landed in the same file; stale comments erode JSDoc trust"
    resolution: deferred-P3
  - id: F64
    batch_id: final
    signature: stage5-cli-output-unstructured-strings
    persona: ce-agent-native-reviewer
    severity: P2
    status: deferred-P2
    summary: "Dispatcher output is plain text not JSON envelopes; breaks the M2M tool-routing convention and the cli.ts fact-emitter pattern; future agents must regex prose"
    resolution: deferred-P2
  - id: F65
    batch_id: final
    signature: stage5-readme-inventory-missing-dispatcher
    persona: ce-agent-native-reviewer
    severity: P2
    status: deferred-P2
    summary: "README helper inventory omits learnings-registry.ts as a peer dispatcher to decompose.ts; orchestrator cannot enumerate the helper surface without source-tree grep"
    resolution: deferred-P2
  - id: F66
    batch_id: final
    signature: stage5-validation-errors-lack-remediation-hint
    persona: ce-agent-native-reviewer
    severity: P3
    status: deferred-P3
    summary: "Validation errors name the violation precisely but do not point at the schema doc or remediation; cheap to add a one-line hint for self-correcting agent loops"
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
| F15 | candidate-ingest | ac4-json-valid-non-object-edge-untested | ce-testing-reviewer | P2 | deferred-P2 | No test for a .json file containing valid JSON that is not an object (e.g. 42 or a bare string); load->validate boundary for valid-but-non-object JSON is unpinned (code path verified correct) | deferred-P2 |
| F16 | candidate-ingest | yaml-numeric-string-coercion-vs-json-parity | ce-correctness-reviewer | P3 | deferred-P3 | JSON/YAML parity is exact for string/null/boolean scalars but an unquoted numeric-looking value parses to number in YAML vs string in JSON; contained because validateCandidate rejects non-strings (fails loud rather than diverging silently) | deferred-P3 |
| F17 | candidate-ingest | ac4-empty-file-edges-untested | ce-testing-reviewer | P3 | deferred-P3 | Empty-file edges unpinned: an empty .yaml parses to null (no throw) and an empty .json throws; neither path has a regression guard | deferred-P3 |
| F18 | candidate-ingest | unrecognized-ext-msg-incomplete-assertion | ce-testing-reviewer | P3 | deferred-P3 | Unrecognized-extension test asserts the message names the file and the bad ext but does not assert it lists the supported extensions; part of the actionable message is unverified | deferred-P3 |
| F19 | candidate-ingest | checkenumfields-label-empty-branch-unreachable | ce-maintainability-reviewer | P3 | deferred-P3 | checkEnumFields documents an empty-string label as the top-level/candidate convention, but neither caller passes empty; the label-empty branch is unreachable and the doc comment misdescribes actual usage | deferred-P3 |
| F20 | candidate-ingest | candidate-required-strings-implicit-coupling-to-registry | ce-maintainability-reviewer | P3 | deferred-P3 | validateCandidate derives required fields as REQUIRED_STRING_FIELDS minus signature; a future addition to the registry required list silently becomes required on candidates too, an implicit coupling | deferred-P3 |
| F21 | candidate-ingest | candidate-missing-test-pushes-file-not-dir-to-cleanup | ce-correctness-reviewer | P3 | deferred-P3 | In the unreadable-candidate test the file path is pushed to tempDirs instead of the parent temp dir, so afterEach rmSync best-effort-skips it and the created temp dir leaks; test correctness unaffected | deferred-P3 |
| F22 | upsert-op | emit-scalar-nul-byte-breaks-yaml-roundtrip | ce-adversarial-reviewer | P1 | fixed | emitScalar leaves a NUL byte (U+0000) literal in the double-quoted scalar, so any candidate whose summary or evidence field contains a NUL crashes Bun.YAML.parse on re-read and the registry file on disk becomes unparseable | commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc |
| F23 | upsert-op | emit-yaml-unescaped-mapping-keys-corrupt-file | ce-adversarial-reviewer | P1 | fixed | emitYaml writes mapping keys verbatim (evidence record keys) with no escaping; an adversarial key containing a colon or newline produces a corrupt YAML body the next parseRegistry rejects | commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc |
| F24 | upsert-op | dispatcher-writes-without-reparse-validate | ce-adversarial-reviewer | P1 | fixed | The --upsert dispatcher serializes then writeFileSyncs the new markdown with no parseRegistry + validateRegistry round-trip on the emitted bytes; any emitter defect silently overwrites the registry with an unparseable file and the prior good state is lost | commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc |
| F25 | upsert-op | lifecycle-omission-not-tested | ce-testing-reviewer | P1 | fixed | No test asserts that omitting a lifecycle field (e.g. follow_up) on a candidate preserves the existing entry's value rather than blanking it; the contract is not pinned | commit bf8b7195694db4636fd7a1113a9bc1f6fe12dbfc |
| F26 | upsert-op | upsert-follow-up-omitted-not-blanked | ce-correctness-reviewer | P2 | deferred-P2 | Lifecycle merge uses `field in cand` for follow_up which means an explicit null in the candidate overwrites prior follow_up while an omitted follow_up preserves it; verify the intent (related to F25) | deferred-P2 |
| F27 | upsert-op | backtick-fence-value-test-too-weak | ce-testing-reviewer | P2 | deferred-P2 | The validate-op-guard round-trip test embeds the backtick sequence as an escaped string literal; the in-memory value never contains a real newline or a real column-0 fence-sequence; the emitted yaml therefore cannot reproduce the truncation scenario it claims to guard | deferred-P2 |
| F28 | upsert-op | canonical-update-partial-omission-untested | ce-testing-reviewer | P2 | deferred-P2 | The canonical-update branch only tests the all-fields-present case; no test covers canonical_update: true with one canonical field omitted, to confirm the omitted field is preserved rather than overwritten with undefined | deferred-P2 |
| F29 | upsert-op | emit-yaml-empty-evidence-record-produces-invalid-shape | ce-correctness-reviewer | P2 | deferred-P2 | emitYaml writes an `evidence:` parent line then iterates records; an empty record yields no list items so re-parse produces `evidence: null` which validateRegistry rejects (validateCandidate currently does not enforce per-evidence-field shape) | deferred-P2 |
| F30 | upsert-op | validate-candidate-skips-evidence-record-shape | ce-adversarial-reviewer | P2 | deferred-P2 | validateCandidate accepts any object as the evidence record without checking key shape or value types; adversarial keys and non-string values flow into emitYaml which assumes safe input | deferred-P2 |
| F31 | upsert-op | serialize-reads-file-second-time-tocttou | ce-adversarial-reviewer | P2 | deferred-P2 | serializeRegistry re-reads the registry from disk to capture surrounding prose, so between the dispatcher's parseRegistry call and this second read the file may have changed; produces a hybrid file. Combined with no file lock, concurrent runs silently last-write-wins | deferred-P2 |
| F32 | upsert-op | regex-parity-parseRegistry-serializeRegistry | ce-maintainability-reviewer | P2 | deferred-P2 | The fenced-yaml regex is duplicated (slightly differently) in parseRegistry and serializeRegistry; the two patterns can drift silently since neither references a shared constant | deferred-P2 |
| F33 | upsert-op | f23-whitelist-only-covers-candidate-evidence-keys-not-registry-keys | ce-adversarial-reviewer | P1 | fixed | F23 whitelist guards candidate evidence keys only; existing-registry entries with arbitrary or YAML-special evidence keys flow through validateRegistry, get emitted verbatim by emitYaml, and would DoS every future upsert via the F24 gate | commit e4c76c8d3b12b6ed728824d55e7ad5a0c5f31433 |
| F34 | upsert-op | f23-evidence-value-types-not-validated-nested-shape-drifts-silently | ce-adversarial-reviewer | P2 | deferred-P2 | validateCandidate enforces evidence KEYS but not VALUE types; an evidence value of nested object or array is upserted and emitted via JSON.stringify fallback, round-trips cleanly, and silently drifts the stored shape away from the documented string-scalar schema | deferred-P2 |
| F35 | upsert-op | f24-dispatcher-write-is-non-atomic-and-races-serializeregistry-second-read | ce-adversarial-reviewer | P2 | deferred-P2 | Dispatcher writeFileSync is not atomic and serializeRegistry performs a second readFileSync on the same path; a concurrent upsert or mid-write process kill produces lost-update or truncated registry | deferred-P2 |
| F36 | upsert-op | f22-lone-utf16-surrogate-silently-replaced-with-u-fffd-on-roundtrip | ce-adversarial-reviewer | P3 | deferred-P3 | A string containing an unpaired UTF-16 surrogate (e.g. U+D800) survives emitScalar unchanged but Bun.YAML.parse replaces it with U+FFFD on re-read; the re-validate gate passes and the value is silently mutated | deferred-P3 |
| F37 | upsert-op | validateregistry-allows-evidence-list-items-that-are-not-mappings | ce-adversarial-reviewer | P3 | deferred-P3 | validateRegistry only checks Array.isArray on evidence and does not enforce per-item shape; a hand-edited registry whose evidence list contains a scalar item passes validation but makes the next serializeRegistry throw in emitYaml, blocking all subsequent upserts | deferred-P3 |
| F38 | upsert-op | f24-late-gate-no-longer-has-test-coverage | ce-adversarial-reviewer | P2 | deferred-P2 | The F24 re-validate gate code still exists in the dispatcher but no test exercises it after the F33 repair repurposed its fixture to the earlier gate; an emitYaml regression that produces parser-rejectable bytes would be undetectable by the suite (gate still catches at runtime) | deferred-P2 |
| F39 | upsert-op | validateregistry-silently-skips-malformed-evidence-records | ce-adversarial-reviewer | P3 | deferred-P3 | validateRegistry's new whitelist loop skips evidence records that are null, scalar, or array via early return without recording an error; a hand-edited registry trips emitYaml with a generic message rather than an actionable validateRegistry error naming the entry | deferred-P3 |
| F40 | write-scope | write-scope-case-insensitive-fs-bypass | ce-adversarial-reviewer | P1 | fixed | All denylist checks are case-sensitive but macOS default APFS is case-insensitive; paths like Skills/, References/, or Issue-90-Ledger.md bypass the guard and overwrite the real lowercase files on macOS | commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2 |
| F41 | write-scope | write-scope-non-ts-source-extension-bypass | ce-adversarial-reviewer | P1 | fixed | Source-file denylist only matches .ts extension; legitimate TypeScript/JS source files with .mts, .cts, .tsx, .js, .jsx, .mjs, .cjs extensions slip through and can be overwritten with registry markdown | commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2 |
| F42 | write-scope | write-scope-denylist-vs-allowlist-foreign-path | ce-adversarial-reviewer | P1 | fixed | Denylist accepts arbitrary unrelated paths (e.g. /tmp/random.md, README.md, package.json); AC5 spirit (cannot write any surface outside the registry it owns) materially violated; correct fix is a tail-match allowlist that keeps prior-batch tmp-path tests green | commit b6bbeb03c953852f5832b05fa6c99420e1ab9ad2 |
| F43 | write-scope | write-scope-symlink-bypass | ce-adversarial-reviewer | P2 | deferred-P2 | Guard does no realpath/lstat resolution; a symlink at a non-canonical path is refused but a symlink at the canonical path could still trick the guard; narrow attack surface, mitigation requires realpathSync | deferred-P2 |
| F44 | write-scope | write-scope-references-deep-nesting-bypass | ce-adversarial-reviewer | P2 | deferred-P2 | The sibling-reference check only fires when parentDir is literally references; nested paths like references/subfolder/other.md bypass; tail-match allowlist would close this | deferred-P2 |
| F45 | write-scope | write-scope-references-non-md-bypass | ce-adversarial-reviewer | P2 | deferred-P2 | The references-sibling check requires filename.endsWith(.md); references/schema.json or references/notes.txt bypass the check | deferred-P2 |
| F46 | write-scope | write-scope-ledger-filename-prefix-bypass | ce-adversarial-reviewer | P2 | deferred-P2 | The per-issue ledger regex is filename-prefix-anchored; filenames with any prefix before issue- (e.g. preview-issue-90-ledger.md) bypass the check | deferred-P2 |
| F47 | write-scope | ws-tests-unrelated-tmp-path-acceptance-unpinned | ce-testing-reviewer | P2 | deferred-P2 | No test pins the dispatcher behavior for a totally unrelated writable path; the deny-list accept rule is documented in a code comment but not asserted by a test | deferred-P2 |
| F48 | write-scope | f42-tmpdir-escape-still-accepts-arbitrary-md-files | ce-adversarial-reviewer | P1 | fixed | F42 only partially closed: tmpdir-escape accepts ANY .md filename under os.tmpdir() (including /tmp/i_just_pwned_you.md) so long as no tripwire fires; AC5 spirit still violated for tmpdir-rooted paths | commit 5d56aa7d579023ad9377ea30aae7ea4e2ac92794 |
| F49 | write-scope | foreign-tail-match-no-repo-containment | ce-adversarial-reviewer | P1 | fixed | Tail-match allowlist has no repo-root anchor; any absolute path that ends with the canonical relative path (e.g. /Users/attacker/runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md) is accepted; a caller in a wrong cwd, worktree, or attacker-staged decoy directory writes outside the real repo | commit 5d56aa7d579023ad9377ea30aae7ea4e2ac92794 |
| F50 | write-scope | tmpdir-escape-inconsistent-with-non-tmpdir-branch | ce-adversarial-reviewer | P2 | deferred-P2 | Inconsistent contract: references/*.md is refused outside tmpdir but accepted under tmpdir; tmpdir tripwires only catch skills/, issue-*-ledger.md, source extensions; foreign reference markdown is not gated under tmpdir | deferred-P2 |
| F51 | write-scope | control-chars-and-bare-dotmd-accepted-under-tmpdir | ce-adversarial-reviewer | P3 | deferred-P3 | Edge cases accepted under tmpdir: a file literally named .md, leaf names with embedded newline, segments containing skills as substring; defense-in-depth opportunity to tighten leaf shape under tmpdir | deferred-P3 |
| F52 | final | helper-zero-discovery-from-runbook-stages | ce-agent-native-reviewer | P1 | out-of-scope-for-this-issue | Helper has zero discovery surface from any runbook stage or skill; the plan explicitly accepts this (Deferred to Follow-Up Work) since wiring into Stage 5 ship-tail is a separate slice of PRD #88 | out-of-scope-for-this-issue: wiring into Stage 5 / fail-stops is a separate sibling slice of PRD #88; this issue ships only the helper surface and registry per its scope boundaries |
| F53 | final | candidate-schema-not-documented | ce-agent-native-reviewer | P1 | out-of-scope-for-this-issue | Candidate-file schema (extensions, evidence-record shape, allowed keys, dedupe rule) is not documented in references/workflow-learnings-registry.md; lives only in JSDoc on lib/learnings.ts | out-of-scope-for-this-issue: candidate-schema docs follow-up; the helper IS the source of truth today; track as a follow-up issue to extend the registry doc with the candidate schema and a worked example before the helper is wired into a stage |
| F54 | final | dispatcher-toctou-lost-update-on-concurrent-upsert | ce-adversarial-reviewer | P1 | out-of-scope-for-this-issue | Dispatcher pipeline is non-atomic (parseRegistry reads file, serializeRegistry re-reads); concurrent --upsert invocations can silently drop learnings via lost-update. No file lock or compare-and-swap | out-of-scope-for-this-issue: helper is not wired into any stage yet so realistic concurrency is zero today; atomicity hardening (file lock or temp + rename with content-equality check) is a follow-up issue to land before the helper is wired into Stage 5 ship-tail |
| F55 | final | stage5-yaml-dispatcher-test-missing | ce-testing-reviewer | P2 | deferred-P2 | AC4 parity (JSON + YAML candidate ingestion) is tested at lib level but no end-to-end --upsert dispatcher test exercises a .yaml candidate | deferred-P2 |
| F56 | final | stage5-candidate-factory-drift-across-tests | ce-testing-reviewer | P3 | deferred-P3 | Candidate factories duplicated across learnings-registry.test.ts (makeCandidate) and lib/learnings.test.ts (validCandidateObject + writeCandidate); schema evolution requires lockstep updates | deferred-P3 |
| F57 | final | stage5-readme-file-map-compounds-three-omissions | ce-project-standards-reviewer | P2 | deferred-P2 | README File map drift compounds: new top-level helper learnings-registry.ts AND new references/workflow-learnings-registry.md AND new lib/learnings.ts (F11) absent from maintainer finder; promote follow-up to update all three enumerations | deferred-P2 |
| F58 | final | stage5-unknown-top-level-fields-bleed-through-upsert | ce-adversarial-reviewer | P2 | deferred-P2 | validateRegistry tolerates unknown top-level entry fields; upsert spread copies them through; emitYaml writes them verbatim; unknown fields persist forward (including potential prototype-pollution-shaped keys) | deferred-P2 |
| F59 | final | stage5-explicit-signature-collision-silent-merge | ce-adversarial-reviewer | P2 | deferred-P2 | Candidate with explicit signature matching another entry silently merges unrelated evidence into that entry; signatureFor does not verify explicit vs derived signature consistency | deferred-P2 |
| F60 | final | stage5-duplicate-signature-registry-tolerated | ce-adversarial-reviewer | P2 | deferred-P2 | validateRegistry does not enforce signature uniqueness across learnings; upsert's loop has no break so a duplicate is amplified, not orphaned; tolerated hand-edit corruption | deferred-P2 |
| F61 | final | stage5-module-cohesion-write-scope-seam | ce-maintainability-reviewer | P3 | deferred-P3 | lib/learnings.ts is 1117 lines mixing schema constants, write-scope guard (~325 lines), parse, validate, upsert, and emit; natural seam at write-scope to extract before the next batch grows it | deferred-P3 |
| F62 | final | stage5-constants-split-canonical-fields-stranded | ce-maintainability-reviewer | P3 | deferred-P3 | 8 of 10 schema constants live in top-of-file block but CANONICAL_FIELDS and LIFECYCLE_FIELDS are stranded mid-file above signatureFor; incremental authorship left them inconsistent | deferred-P3 |
| F63 | final | stale-batch-status-jsdoc | ce-maintainability-reviewer | P3 | deferred-P3 | lib/learnings.ts header and learnings-registry.ts comments say later-batch features are intentionally absent, but those features have all since landed in the same file; stale comments erode JSDoc trust | deferred-P3 |
| F64 | final | stage5-cli-output-unstructured-strings | ce-agent-native-reviewer | P2 | deferred-P2 | Dispatcher output is plain text not JSON envelopes; breaks the M2M tool-routing convention and the cli.ts fact-emitter pattern; future agents must regex prose | deferred-P2 |
| F65 | final | stage5-readme-inventory-missing-dispatcher | ce-agent-native-reviewer | P2 | deferred-P2 | README helper inventory omits learnings-registry.ts as a peer dispatcher to decompose.ts; orchestrator cannot enumerate the helper surface without source-tree grep | deferred-P2 |
| F66 | final | stage5-validation-errors-lack-remediation-hint | ce-agent-native-reviewer | P3 | deferred-P3 | Validation errors name the violation precisely but do not point at the schema doc or remediation; cheap to add a one-line hint for self-correcting agent loops | deferred-P3 |
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
