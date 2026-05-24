---
issue_number: 71
issue_title: "issue-to-pr: no honest closure for final-review findings fixed by in-run runbook heals (+ Stage 5 read-only gate gap)"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/71"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-005-feat-issue-to-pr-runbook-heal-closure-plan.md"
started_at: "2026-05-24T16:47:00+10:00"
status: "shipped"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T16:47:00+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-24T17:11:00+10:00"
blocked_reason: null
pr_url: "https://github.com/nathanvale/claude-code-config/pull/73"
ship_mode: "standard"
final_reviewed_at: "2026-05-24T18:37:00+10:00"
plan_digest: "sha256:d86c6a18c2eb82b81266b966e04fa91bb95f15b590ac4b850d0df9493427d972"
batch_contract_digest: "sha256:d1e6c9a1f380d50763f7fe335004fc07a1bbaaf2a39ab85904dfce65fbdf44fd"
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
batches:
  - id: "runbook-heal-resolution"
    name: "Guarded runbook-heal closure form"
    goal: "A batch_id-final finding fixed by an orchestrator runbook-heal commit can be recorded fixed with status and resolution that agree, guarded so the commit touches only control-plane paths."
    files:
      - "runbooks/issue-to-pr-v2/lib/ledger.ts"
      - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
    depends_on: []
    execution_mode: tdd
    acceptance_tests:
      - "AC 1 holds: a batch_id-final finding with status fixed + resolution 'runbook-heal <reachable commit touching only control-plane paths>' validates clean (status and resolution agree, no out-of-scope fudge)."
      - "AC 2 holds: 'runbook-heal <sha>' is REJECTED when the commit touches any non-allowlisted path - a pure deliverable commit, a mixed control-plane+deliverable commit, and a commit touching the per-issue ledger path all fail, naming the offending path."
      - "AC 5 holds (partial): tests pin the accept case, the deliverable-reject case, the mixed-commit reject, the ledger-path reject, and a stage-3-scope reject for the runbook-heal form."
    ac_mapping:
      - 1
      - 2
      - 5
    rationale: "replacement-contract r1: merge AC1+AC2 (form and abuse guard live in the same validateFindingResolution function with inseparable tests); narrowed to batch_id final only (CR-003); allowlist excludes the ledger path (CR-004)."
    status: converged
    iterations: 4
    builder_commits:
      - "a83bbd1c86f2f31caf7a47b0016f2ff187f601b2"
      - "c93f5a0c3e77a24020cf08a2dad6d48bb20a9fa2"
      - "fd1839c9fd40e5fe78d6a016ee67e03cffa3f2d8"
      - "c3b6cb3cf2d555cc58da021a209442b049163918"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "a83bbd1c86f2f31caf7a47b0016f2ff187f601b2"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Fixtures (reachable branch commits): 8be31d4 control-plane-only ACCEPT; 915f666 deliverable REJECT; 7c6b569 mixed REJECT names docs path; 67f2163 ledger-path REJECT."
        notes: "TDD red-first: 4 new-arm cases (incl. 3 abuse-guard rejects) red before guard, green after. Arm placed after stage-3 short-circuit; startsWith prefix-match allowlist. 64/64 ledger tests, tsc clean (orchestrator re-verified)."
      - attempt_type: repair
        status: committed
        commit_sha: "c93f5a0c3e77a24020cf08a2dad6d48bb20a9fa2"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "No FINAL_BATCH_ID constant; code uses bare \"final\" literal (ledger.ts 2407/2475/2570). Gated runbook-heal arm on finding.batch_id === final."
        notes: "Repair of vw-001. RED batch-loop-reject test (batch_id b1) red before gate, green after. 65/65 ledger tests, tsc clean (orchestrator re-verified). vw-002 empty-commit left for separate repair."
      - attempt_type: repair
        status: committed
        commit_sha: "fd1839c9fd40e5fe78d6a016ee67e03cffa3f2d8"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Hermetic empty-commit fixture: PR-70 merge dc6868a is reachable from HEAD and touchedFilesForCommit returns [] (merge records zero changes vs first parent); no git object created, no ref advanced."
        notes: "Repair of vw-002. Added touched.length === 0 reject before the allowlist loop. RED empty-commit test (dc6868a) red before fix, green after. 66/66 ledger tests, tsc clean (orchestrator re-verified)."
      - attempt_type: repair
        status: committed
        commit_sha: "c3b6cb3cf2d555cc58da021a209442b049163918"
        files_touched:
          - "runbooks/issue-to-pr-v2/lib/ledger.ts"
          - "runbooks/issue-to-pr-v2/lib/ledger.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Mode-only detection via git diff-tree --raw: pure chmod is status M with oldSha===newSha. New exported rawDiffHasContentBearingChange rejects when every entry is mode-only; renames/deletes/binary modifies stay accepted. No reachable mode-only commit on branch, so reject pinned at parser seam (sanctioned)."
        notes: "Repair of vw-007 (P2). 10 new mode-only guard tests; 76/76 ledger tests, 78/78 decompose, tsc clean (orchestrator re-verified)."
    final_verdict: converged
  - id: "stage5-readonly-gate"
    name: "Stage 5 read-only enforcement gate"
    goal: "A Stage 5 ledger checkpoint touching any non-ledger path is surfaced as a failure rather than silently accepted."
    files:
      - "runbooks/issue-to-pr-v2/decompose.ts"
      - "runbooks/issue-to-pr-v2/lib/stage5-readonly.test.ts"
    depends_on: []
    execution_mode: tdd
    acceptance_tests:
      - "AC 3 holds: a gate exists that, given a Stage 5 checkpoint touching a non-ledger path, fails (non-zero / surfaced finding) and names the offending path; a ledger-only checkpoint passes."
      - "AC 5 holds (partial): tests pin the Stage 5 read-only violation case (synthetic ledger-plus-extra-path fixture) and the ledger-only pass case."
    ac_mapping:
      - 3
      - 5
    rationale: null
    status: converged
    iterations: 2
    builder_commits:
      - "85cefeb14d9a7cb5fbccf242ad44af1632e93e4e"
      - "22912cef8139f0d4b4d4b04a2d6a30a82c48a021"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "85cefeb14d9a7cb5fbccf242ad44af1632e93e4e"
        files_touched:
          - "runbooks/issue-to-pr-v2/decompose.ts"
          - "runbooks/issue-to-pr-v2/lib/stage5-readonly.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Flag --assert-stage5-readonly <ledger-path> <commit-ref>. touchedFilesForCommit private, so local touchedFilesForRef git diff-tree read in decompose.ts (documented dup). Fixtures: 8be31d4 non-ledger VIOLATION; 1315477 ledger-only PASS. Empty commit = vacuous PASS."
        notes: "TDD red-first (3/4 fail before flag). Gate exercised live by orchestrator: 1315477 PASS exit 0, 8be31d4 FAIL exit 1 naming the offending path. 4/4 gate tests, 76/76 ledger, 78/78 decompose, tsc clean."
      - attempt_type: repair
        status: committed
        commit_sha: "22912cef8139f0d4b4d4b04a2d6a30a82c48a021"
        files_touched:
          - "runbooks/issue-to-pr-v2/decompose.ts"
          - "runbooks/issue-to-pr-v2/lib/stage5-readonly.test.ts"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Merge detection via git rev-list --parents -n 1 (>=3 tokens = 2+ parents = merge); fails fast before touched-files check. dc6868a confirmed 2-parent merge."
        notes: "Repair of s5-001. RED merge-reject test (dc6868a) red before fix, green after. Gate exercised live by orchestrator: dc6868a REJECTS exit 1 as merge, 1315477 still PASS exit 0. 5/5 gate, 76/76 ledger, 78/78 decompose, tsc clean."
    final_verdict: converged
  - id: "historical-rows-disposition"
    name: "Historical fr-001..fr-004 disposition"
    goal: "Decide and execute whether to amend the self-contradictory fr-001..fr-004 rows in the issue-68 ledger to the runbook-heal form or leave them as audit precedent."
    files:
      - "docs/runbooks/issue-to-pr/issue-68-ledger.md"
    depends_on:
      - "runbook-heal-resolution"
    execution_mode: change_first
    acceptance_tests:
      - "AC 6 holds: a decision on fr-001..fr-004 is recorded and executed -- either the rows are amended to status fixed + resolution runbook-heal 8be31d4 and the issue-68 ledger validates clean, or a Notes line records the deliberate leave-as-precedent decision."
    ac_mapping:
      - 6
    rationale: "change_first ledger doc edit; AC6 is a decision criterion surfaced at the Stage 3 user gate (amend vs leave)."
    status: converged
    iterations: 1
    builder_commits:
      - "71a4a9f9e73d8f77413999b20d09be33ab5affef"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "71a4a9f9e73d8f77413999b20d09be33ab5affef"
        files_touched:
          - "docs/runbooks/issue-to-pr/issue-68-ledger.md"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "8be31d4 confirmed control-plane-only (5 files all under runbooks/issue-to-pr-v2/). issue-68 ledger validate-findings exit 0 after amend (runbook-heal grammar accepts batch_id:final + control-plane commit)."
        notes: "AC6 amend (user decision). fr-001..fr-004 in issue-68 ledger changed from out-of-scope-for-this-issue to status:fixed / resolution:runbook-heal 8be31d4, resolving the self-contradiction. cr-001 untouched. Orchestrator re-verified issue-68 ledger validates clean."
    final_verdict: converged
  - id: "runbook-heal-docs"
    name: "Closure table, Stage 5 cross-ref, blocked-by-doc-defect carve-out"
    goal: "Document the runbook-heal closure form, the Stage 5 read-only gate, and the blocked-by-doc-defect carve-out."
    files:
      - "runbooks/issue-to-pr-v2/references/findings-and-validators.md"
      - "runbooks/issue-to-pr-v2/references/stage-5-final-review.md"
      - "runbooks/issue-to-pr-v2/issue-N-ledger.template.md"
    depends_on:
      - "runbook-heal-resolution"
      - "stage5-readonly-gate"
    execution_mode: change_first
    acceptance_tests:
      - "AC 4 holds: the blocked-by-doc-defect carve-out is documented in stage-5-final-review.md, and the findings-and-validators.md closure table has a runbook-heal row consistent with the U1 validator grammar."
    ac_mapping:
      - 4
    rationale: "docs-only change_first; documents the behavior runbook-heal-resolution and stage5-readonly-gate implement."
    status: converged
    iterations: 1
    builder_commits:
      - "a55b841af84e61a5dd46a70fd9339247c6341a65"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "a55b841af84e61a5dd46a70fd9339247c6341a65"
        files_touched:
          - "runbooks/issue-to-pr-v2/references/findings-and-validators.md"
          - "runbooks/issue-to-pr-v2/references/stage-5-final-review.md"
          - "runbooks/issue-to-pr-v2/issue-N-ledger.template.md"
        route_hint: validator-wave
        blockers: []
        probe_results:
          - "Closure table: runbook-heal <sha> row added (batch_id final only, control-plane allowlist, merge+content-empty rejected) verified against the lib/ledger.ts arm. Stage 5: --assert-stage5-readonly wired into step 5 (closes s5-002) + blocked-by-doc-defect carve-out (AC4). Template enumeration updated. Both ledgers validate exit 0."
        notes: "AC4 docs + wires s5-002 (Stage 5 gate invocation instruction) + documents runbook-heal closing hr-001's drift. Orchestrator re-verified: doc matches validator code, both ledgers validate, only 3 files changed."
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
    status: fixed
    summary: "Both runbook-heal-resolution and stage5-readonly-gate list lib/ledger.test.ts with depends_on []; no ordering constraint means the second Builder can clobber the first's test additions to the shared file."
    resolution: "plan-revision 89c6b5e"
  - id: cr-003
    batch_id: stage-3
    signature: stage-3-batch-id-collides-with-plan-revision-requirement
    persona: contract-reviewer
    severity: P1
    status: fixed
    summary: "Plan scopes runbook-heal to batch_id stage-3 too, but validateFindingResolution short-circuits stage-3 findings to plan-revision only, so the new arm is unreachable for stage-3; behavior is unspecified and untested."
    resolution: "plan-revision 89c6b5e"
  - id: cr-004
    batch_id: stage-3
    signature: deliverable-path-definition-undefined-plan-wide
    persona: contract-reviewer
    severity: P1
    status: fixed
    summary: "The abuse guard's deliverable-path/control-plane-allowlist concept is new and plan-wide but leaves edges undefined: mixed control-plane+deliverable commits, and crucially whether the per-issue ledger path docs/runbooks/issue-to-pr/ is in the allowlist (U5 amend and Stage 5 checkpoints touch it)."
    resolution: "plan-revision 89c6b5e"
  - id: cr-002
    batch_id: stage-3
    signature: cited-function-name-does-not-exist
    persona: contract-reviewer
    severity: P2
    status: fixed
    summary: "Plan cites validateFinalFindingResolution; the real function is validateFindingResolution (the cited line range is correct). Mild plan/DAG drift."
    resolution: "plan-revision 89c6b5e"
  - id: cr-005
    batch_id: stage-3
    signature: stage5-gate-wiring-choice-bounded
    persona: contract-reviewer
    severity: P3
    status: fixed
    summary: "Stage 5 gate wiring choice (decompose.ts flag vs in-validator) is a legitimately bounded implementation choice pinned by acceptance tests; no change required. Advisory only."
    resolution: "plan-revision 89c6b5e"
  - id: cr-006
    batch_id: stage-3
    signature: traceability-table-cites-nonexistent-u4
    persona: contract-reviewer
    severity: P3
    status: fixed
    summary: "Cycle-2: Requirements Traceability table mapped AC4 to U4 (no such unit; AC4 is covered by U3 runbook-heal-docs). Cosmetic label typo; binding batch YAML correct."
    resolution: "plan-revision 55f4357"
  - id: cr-007
    batch_id: stage-3
    signature: u2-test-scenario-mislabels-8be31d4
    persona: contract-reviewer
    severity: P3
    status: fixed
    summary: "Cycle-2: U2 violation test scenario labeled 8be31d4 as a ledger+runbook mixed commit, but 8be31d4 touched only control-plane paths. Reworded to use a synthetic fixture; behavior unaffected."
    resolution: "plan-revision 55f4357"
  - id: cr-008
    batch_id: stage-3
    signature: stale-old-function-name-in-plan-prose
    persona: contract-reviewer
    severity: P3
    status: fixed
    summary: "Cycle-2: two stale validateFinalFindingResolution references survived at plan Problem Frame and System-Wide Impact; corrected to validateFindingResolution. Completes cr-002."
    resolution: "plan-revision 55f4357"
  - id: vw-001
    batch_id: runbook-heal-resolution
    signature: runbook-heal-arm-not-scoped-to-final
    persona: ce-correctness-reviewer
    severity: P1
    status: fixed
    summary: "The runbook-heal arm fires for any non-stage-3 fixed finding, not just batch_id final as the confirmed contract requires; a batch-loop finding can be closed by runbook-heal with no terminal-batch ownership check (the commit arm enforces that), weakening per-batch closure provenance."
    resolution: "commit c93f5a0c3e77a24020cf08a2dad6d48bb20a9fa2"
  - id: vw-002
    batch_id: runbook-heal-resolution
    signature: runbook-heal-empty-commit-vacuous-pass
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "validateControlPlaneOnlyCommit accepts a zero-file (empty) commit vacuously: the allowlist loop never executes so no path is checked, letting runbook-heal <empty-sha> close a finding while proving nothing changed. The guard needs touched.length > 0 plus at least one allowlist match."
    resolution: "commit fd1839c9fd40e5fe78d6a016ee67e03cffa3f2d8"
  - id: vw-003
    batch_id: runbook-heal-resolution
    signature: test-fixtures-pinned-to-live-branch-shas
    persona: ce-maintainability-reviewer
    severity: P2
    status: deferred-P2
    summary: "New tests pin four real branch shas plus a transcribed control-plane file list; a rebase/squash/amend would rot the reachable and non-regression assertions. Branch-history coupling is partly inherent to a git-reachability validator but the manual file-list transcription is fragile."
    resolution: deferred-P2
  - id: vw-004
    batch_id: runbook-heal-resolution
    signature: runbook-heal-skill-artifact-allowlisted-backdoor
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "skills/issue-to-pr/ is allowlisted, but skills/issue-to-pr/SKILL.md is a shippable artifact; for an issue whose deliverable IS the skill, a runbook-heal citing a SKILL.md-only commit passes despite mutating a deliverable. Allowlist conflates control-plane tooling with shipped skill content."
    resolution: deferred-P2
  - id: vw-005
    batch_id: runbook-heal-resolution
    signature: stale-fixed-resolution-catch-all-message
    persona: ce-kieran-typescript-reviewer
    severity: P3
    status: deferred-P3
    summary: "The fixed-resolution catch-all message still lists only commit <sha> and patch-batch patch-NNN, omitting the new runbook-heal <sha> form; a malformed runbook-heal falls through to a message that never names the intended form."
    resolution: deferred-P3
  - id: vw-006
    batch_id: runbook-heal-resolution
    signature: inline-control-plane-allowlist-vs-named-constant
    persona: ce-kieran-typescript-reviewer
    severity: P3
    status: deferred-P3
    summary: "The control-plane allowlist is an inline literal array in validateControlPlaneOnlyCommit; the file idiom puts policy literals in contract.ts named constants. Defensible single-use, but a named constant would make the control-plane boundary the single source of truth (relevant once stage5-readonly-gate also needs it)."
    resolution: deferred-P3
  - id: vw-007
    batch_id: runbook-heal-resolution
    signature: runbook-heal-mode-only-commit-vacuous-pass
    persona: ce-adversarial-reviewer
    severity: P2
    status: fixed
    summary: "Re-validation residual: vw-002's literal empty-commit case is closed, but the guard requires at least one touched path, not a real content change. A mode-only (chmod) or delete-only control-plane commit emits a path and passes, the same vacuous-proof class. Edge case (requires a deliberately crafted mode-only commit); common no-op accident is closed."
    resolution: "commit c3b6cb3cf2d555cc58da021a209442b049163918"
  - id: s5-001
    batch_id: stage5-readonly-gate
    signature: merge-commit-bypasses-stage5-readonly-gate
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "The gate's git diff-tree omits -m/-c, so a merge commit that pulls non-ledger files into the branch reports zero touched files and PASSES as a vacuous read-only checkpoint (proven live). This is the exact non-ledger-touched-but-passes class the gate exists to catch; a merge Stage 5 checkpoint defeats it silently."
    resolution: "commit 22912cef8139f0d4b4d4b04a2d6a30a82c48a021"
  - id: s5-002
    batch_id: runbook-heal-docs
    signature: stage5-readonly-gate-never-invoked-by-protected-flow
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "The gate is opt-in: the only references to --assert-stage5-readonly are the implementation, its test, and a ledger note. stage-5-final-review.md commits the final-review checkpoint but never runs the gate against it, so AC3's in-run-non-ledger-edit-is-surfaced is not satisfied at runtime. Re-keyed to runbook-heal-docs (U3): the wiring lives in stage-5-final-review.md, which is U3's file; U3 must add an explicit orchestrator instruction to run --assert-stage5-readonly against the final-review checkpoint and close this finding."
    resolution: "commit a55b841af84e61a5dd46a70fd9339247c6341a65"
  - id: s5-003
    batch_id: stage5-readonly-gate
    signature: unvalidated-ref-tree-ish-and-range-vacuous-pass
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "touchedFilesForRef does no ref validation (unlike lib validateReachableCommit); a tree-ish (HEAD^{tree}) or range (A..B) makes git diff-tree exit 0 with empty stdout, so the gate sees zero files = vacuous PASS. A non-commit ref gets a false green instead of an error."
    resolution: deferred-P2
  - id: s5-004
    batch_id: stage5-readonly-gate
    signature: stage5-gate-mixed-and-rename-status-untested
    persona: ce-testing-reviewer
    severity: P2
    status: deferred-P2
    summary: "The violation fixture (8be31d4) is a pure non-ledger commit; no test covers a mixed ledger+non-ledger commit (the skip-ledger-then-flag-nonledger branch) or the rename/copy/delete (R/C/D) status-parsing branch in touchedFilesForRef, both of which are live behavior."
    resolution: deferred-P2
  - id: s5-005
    batch_id: stage5-readonly-gate
    signature: stage5-gate-duplicates-private-touchedfiles-helper
    persona: ce-kieran-typescript-reviewer
    severity: P3
    status: deferred-P3
    summary: "touchedFilesForRef near-verbatim duplicates the private touchedFilesForCommit in lib/ledger.ts (two copies of diff-tree parsing that can drift); the local copy also drops validateRepoRelativePath and the ref reachability check. Documented inline; lib helper is private so a shared export is a follow-up (out of this batch's scope, which cannot edit lib/ledger.ts)."
    resolution: deferred-P3
  - id: s5-006
    batch_id: stage5-readonly-gate
    signature: stage5-gate-case-sensitive-ledger-path-compare
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "normalizePath compares case-sensitively on a core.ignorecase=true repo; a wrong-case ledger arg makes the gate REJECT a legitimate ledger-only checkpoint (fail-safe false positive that blocks convergence, not a bypass)."
    resolution: deferred-P3
  - id: hr-001
    batch_id: historical-rows-disposition
    signature: runbook-heal-form-undocumented-at-amend-time
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The amend records runbook-heal 8be31d4 (validator-accepted), but the canonical closure-vocabulary table in findings-and-validators.md does not yet list runbook-heal <sha> because its documenting batch runbook-heal-docs (U3) is still pending. Transient batch-ordering drift: U3 documents the form and closes the divergence; the amend consumed the vocabulary before its doc batch landed."
    resolution: deferred-P2
  - id: rd-001
    batch_id: runbook-heal-docs
    signature: stage5-gate-instruction-after-advance-clause-clarity
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "Clarity nit: the wired --assert-stage5-readonly gate instruction sits textually after step 5's commit-then-advance-to-Stage-6 clause; a careless reader could advance before running the gate. The AFTER-committing framing mitigates it and the instruction is load-bearing, so s5-002 stays closed; presentational ordering only."
    resolution: deferred-P3
  - id: fr5-001
    batch_id: final
    signature: runbook-heal-arm-no-finding-to-commit-binding
    persona: ce-adversarial-reviewer
    severity: P2
    status: deferred-P2
    summary: "The runbook-heal arm validates only that the cited commit is reachable and touches control-plane content; unlike the commit arm (terminalBuilderCommits.has), it does not bind the commit to the finding or the run. Any reachable control-plane commit (even an unrelated old one) can close any batch_id:final finding. Documented design choice (plan L45) but a posture gap."
    resolution: deferred-P2
  - id: fr5-002
    batch_id: final
    signature: empty-commit-fixture-is-actually-a-merge
    persona: ce-maintainability-reviewer
    severity: P2
    status: deferred-P2
    summary: "The runbook-heal empty-commit reject test labels dc6868a as a zero-file no-op, but dc6868a is the PR-70 2-parent merge; the test passes because diff-tree without -m emits zero rows for a merge, not because the commit is a genuine no-op. Sibling stage5-readonly.test.ts correctly labels the same sha as a merge. A rebase turning dc6868a non-merge would silently change what the test proves."
    resolution: deferred-P2
  - id: fr5-003
    batch_id: final
    signature: runbook-heal-doc-claims-merge-guard-code-lacks
    persona: ce-maintainability-reviewer
    severity: P2
    status: deferred-P2
    summary: "Doc/code drift: the findings-and-validators.md closure-table runbook-heal row states merge commits are rejected as vacuous-proof, but validateControlPlaneOnlyCommit has NO merge guard (only the Stage 5 gate got isMergeCommit). The runbook-heal arm rejects a merge only incidentally when its first-parent diff is empty; a merge whose first-parent diff touches control-plane content would NOT be rejected, contradicting the doc. Latent today."
    resolution: deferred-P2
  - id: fr5-004
    batch_id: final
    signature: stage5-gate-skips-reachability-binding
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "assertStage5ReadOnly resolves the ref via raw git but never calls validateReachableCommit (the runbook-heal arm does, enforcing is-ancestor of HEAD). The gate accepts any resolvable ref (tag, other-branch commit) provided it touches only the ledger; fails closed on garbage but proves less provenance than its sibling."
    resolution: deferred-P3
  - id: fr5-005
    batch_id: final
    signature: third-git-difftree-reader-duplication
    persona: ce-maintainability-reviewer
    severity: P3
    status: deferred-P3
    summary: "rawDiffForCommit (ledger.ts --raw) is a third near-identical git diff-tree reader alongside the private touchedFilesForCommit (ledger.ts --name-status) and touchedFilesForRef (decompose.ts --name-status). The deferred s5-005 recorded the two-copy duplication; this is three across two files. A future fix (e.g. -m/--cc, -z, maxBuffer) must be replicated thrice."
    resolution: deferred-P3
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| cr-001 | stage-3 | shared-test-file-no-dependency-edge | contract-reviewer | P1 | fixed | Both runbook-heal-resolution and stage5-readonly-gate list lib/ledger.test.ts with depends_on []; no ordering constraint means the second Builder can clobber the first's test additions to the shared file. | plan-revision 89c6b5e |
| cr-003 | stage-3 | stage-3-batch-id-collides-with-plan-revision-requirement | contract-reviewer | P1 | fixed | Plan scopes runbook-heal to batch_id stage-3 too, but validateFindingResolution short-circuits stage-3 findings to plan-revision only, so the new arm is unreachable for stage-3; behavior is unspecified and untested. | plan-revision 89c6b5e |
| cr-004 | stage-3 | deliverable-path-definition-undefined-plan-wide | contract-reviewer | P1 | fixed | The abuse guard's deliverable-path/control-plane-allowlist concept is new and plan-wide but leaves edges undefined: mixed control-plane+deliverable commits, and crucially whether the per-issue ledger path docs/runbooks/issue-to-pr/ is in the allowlist (U5 amend and Stage 5 checkpoints touch it). | plan-revision 89c6b5e |
| cr-002 | stage-3 | cited-function-name-does-not-exist | contract-reviewer | P2 | fixed | Plan cites validateFinalFindingResolution; the real function is validateFindingResolution (the cited line range is correct). Mild plan/DAG drift. | plan-revision 89c6b5e |
| cr-005 | stage-3 | stage5-gate-wiring-choice-bounded | contract-reviewer | P3 | fixed | Stage 5 gate wiring choice (decompose.ts flag vs in-validator) is a legitimately bounded implementation choice pinned by acceptance tests; no change required. Advisory only. | plan-revision 89c6b5e |
| cr-006 | stage-3 | traceability-table-cites-nonexistent-u4 | contract-reviewer | P3 | fixed | Cycle-2: Requirements Traceability table mapped AC4 to U4 (no such unit; AC4 is covered by U3 runbook-heal-docs). Cosmetic label typo; binding batch YAML correct. | plan-revision 55f4357 |
| cr-007 | stage-3 | u2-test-scenario-mislabels-8be31d4 | contract-reviewer | P3 | fixed | Cycle-2: U2 violation test scenario labeled 8be31d4 as a ledger+runbook mixed commit, but 8be31d4 touched only control-plane paths. Reworded to use a synthetic fixture; behavior unaffected. | plan-revision 55f4357 |
| cr-008 | stage-3 | stale-old-function-name-in-plan-prose | contract-reviewer | P3 | fixed | Cycle-2: two stale validateFinalFindingResolution references survived at plan Problem Frame and System-Wide Impact; corrected to validateFindingResolution. Completes cr-002. | plan-revision 55f4357 |
| vw-001 | runbook-heal-resolution | runbook-heal-arm-not-scoped-to-final | ce-correctness-reviewer | P1 | fixed | The runbook-heal arm fires for any non-stage-3 fixed finding, not just batch_id final as the confirmed contract requires; a batch-loop finding can be closed by runbook-heal with no terminal-batch ownership check (the commit arm enforces that), weakening per-batch closure provenance. | commit c93f5a0c3e77a24020cf08a2dad6d48bb20a9fa2 |
| vw-002 | runbook-heal-resolution | runbook-heal-empty-commit-vacuous-pass | ce-adversarial-reviewer | P1 | fixed | validateControlPlaneOnlyCommit accepts a zero-file (empty) commit vacuously: the allowlist loop never executes so no path is checked, letting runbook-heal <empty-sha> close a finding while proving nothing changed. The guard needs touched.length > 0 plus at least one allowlist match. | commit fd1839c9fd40e5fe78d6a016ee67e03cffa3f2d8 |
| vw-003 | runbook-heal-resolution | test-fixtures-pinned-to-live-branch-shas | ce-maintainability-reviewer | P2 | deferred-P2 | New tests pin four real branch shas plus a transcribed control-plane file list; a rebase/squash/amend would rot the reachable and non-regression assertions. Branch-history coupling is partly inherent to a git-reachability validator but the manual file-list transcription is fragile. | deferred-P2 |
| vw-004 | runbook-heal-resolution | runbook-heal-skill-artifact-allowlisted-backdoor | ce-adversarial-reviewer | P2 | deferred-P2 | skills/issue-to-pr/ is allowlisted, but skills/issue-to-pr/SKILL.md is a shippable artifact; for an issue whose deliverable IS the skill, a runbook-heal citing a SKILL.md-only commit passes despite mutating a deliverable. Allowlist conflates control-plane tooling with shipped skill content. | deferred-P2 |
| vw-005 | runbook-heal-resolution | stale-fixed-resolution-catch-all-message | ce-kieran-typescript-reviewer | P3 | deferred-P3 | The fixed-resolution catch-all message still lists only commit <sha> and patch-batch patch-NNN, omitting the new runbook-heal <sha> form; a malformed runbook-heal falls through to a message that never names the intended form. | deferred-P3 |
| vw-006 | runbook-heal-resolution | inline-control-plane-allowlist-vs-named-constant | ce-kieran-typescript-reviewer | P3 | deferred-P3 | The control-plane allowlist is an inline literal array in validateControlPlaneOnlyCommit; the file idiom puts policy literals in contract.ts named constants. Defensible single-use, but a named constant would make the control-plane boundary the single source of truth (relevant once stage5-readonly-gate also needs it). | deferred-P3 |
| vw-007 | runbook-heal-resolution | runbook-heal-mode-only-commit-vacuous-pass | ce-adversarial-reviewer | P2 | fixed | Re-validation residual: vw-002's literal empty-commit case is closed, but the guard requires at least one touched path, not a real content change. A mode-only (chmod) or delete-only control-plane commit emits a path and passes, the same vacuous-proof class. Edge case (requires a deliberately crafted mode-only commit); common no-op accident is closed. | commit c3b6cb3cf2d555cc58da021a209442b049163918 |
| s5-001 | stage5-readonly-gate | merge-commit-bypasses-stage5-readonly-gate | ce-adversarial-reviewer | P1 | fixed | The gate's git diff-tree omits -m/-c, so a merge commit that pulls non-ledger files into the branch reports zero touched files and PASSES as a vacuous read-only checkpoint (proven live). This is the exact non-ledger-touched-but-passes class the gate exists to catch; a merge Stage 5 checkpoint defeats it silently. | commit 22912cef8139f0d4b4d4b04a2d6a30a82c48a021 |
| s5-002 | runbook-heal-docs | stage5-readonly-gate-never-invoked-by-protected-flow | ce-adversarial-reviewer | P1 | fixed | The gate is opt-in: the only references to --assert-stage5-readonly are the implementation, its test, and a ledger note. stage-5-final-review.md commits the final-review checkpoint but never runs the gate against it, so AC3's in-run-non-ledger-edit-is-surfaced is not satisfied at runtime. Re-keyed to runbook-heal-docs (U3): the wiring lives in stage-5-final-review.md, which is U3's file; U3 must add an explicit orchestrator instruction to run --assert-stage5-readonly against the final-review checkpoint and close this finding. | commit a55b841af84e61a5dd46a70fd9339247c6341a65 |
| s5-003 | stage5-readonly-gate | unvalidated-ref-tree-ish-and-range-vacuous-pass | ce-adversarial-reviewer | P2 | deferred-P2 | touchedFilesForRef does no ref validation (unlike lib validateReachableCommit); a tree-ish (HEAD^{tree}) or range (A..B) makes git diff-tree exit 0 with empty stdout, so the gate sees zero files = vacuous PASS. A non-commit ref gets a false green instead of an error. | deferred-P2 |
| s5-004 | stage5-readonly-gate | stage5-gate-mixed-and-rename-status-untested | ce-testing-reviewer | P2 | deferred-P2 | The violation fixture (8be31d4) is a pure non-ledger commit; no test covers a mixed ledger+non-ledger commit (the skip-ledger-then-flag-nonledger branch) or the rename/copy/delete (R/C/D) status-parsing branch in touchedFilesForRef, both of which are live behavior. | deferred-P2 |
| s5-005 | stage5-readonly-gate | stage5-gate-duplicates-private-touchedfiles-helper | ce-kieran-typescript-reviewer | P3 | deferred-P3 | touchedFilesForRef near-verbatim duplicates the private touchedFilesForCommit in lib/ledger.ts (two copies of diff-tree parsing that can drift); the local copy also drops validateRepoRelativePath and the ref reachability check. Documented inline; lib helper is private so a shared export is a follow-up (out of this batch's scope, which cannot edit lib/ledger.ts). | deferred-P3 |
| s5-006 | stage5-readonly-gate | stage5-gate-case-sensitive-ledger-path-compare | ce-adversarial-reviewer | P3 | deferred-P3 | normalizePath compares case-sensitively on a core.ignorecase=true repo; a wrong-case ledger arg makes the gate REJECT a legitimate ledger-only checkpoint (fail-safe false positive that blocks convergence, not a bypass). | deferred-P3 |
| hr-001 | historical-rows-disposition | runbook-heal-form-undocumented-at-amend-time | ce-adversarial-reviewer | P2 | deferred-P2 | The amend records runbook-heal 8be31d4 (validator-accepted), but the canonical closure-vocabulary table in findings-and-validators.md does not yet list runbook-heal <sha> because its documenting batch runbook-heal-docs (U3) is still pending. Transient batch-ordering drift: U3 documents the form and closes the divergence; the amend consumed the vocabulary before its doc batch landed. | deferred-P2 |
| rd-001 | runbook-heal-docs | stage5-gate-instruction-after-advance-clause-clarity | ce-adversarial-reviewer | P3 | deferred-P3 | Clarity nit: the wired --assert-stage5-readonly gate instruction sits textually after step 5's commit-then-advance-to-Stage-6 clause; a careless reader could advance before running the gate. The AFTER-committing framing mitigates it and the instruction is load-bearing, so s5-002 stays closed; presentational ordering only. | deferred-P3 |
| fr5-001 | final | runbook-heal-arm-no-finding-to-commit-binding | ce-adversarial-reviewer | P2 | deferred-P2 | The runbook-heal arm validates only that the cited commit is reachable and touches control-plane content; unlike the commit arm (terminalBuilderCommits.has), it does not bind the commit to the finding or the run. Any reachable control-plane commit (even an unrelated old one) can close any batch_id:final finding. Documented design choice (plan L45) but a posture gap. | deferred-P2 |
| fr5-002 | final | empty-commit-fixture-is-actually-a-merge | ce-maintainability-reviewer | P2 | deferred-P2 | The runbook-heal empty-commit reject test labels dc6868a as a zero-file no-op, but dc6868a is the PR-70 2-parent merge; the test passes because diff-tree without -m emits zero rows for a merge, not because the commit is a genuine no-op. Sibling stage5-readonly.test.ts correctly labels the same sha as a merge. A rebase turning dc6868a non-merge would silently change what the test proves. | deferred-P2 |
| fr5-003 | final | runbook-heal-doc-claims-merge-guard-code-lacks | ce-maintainability-reviewer | P2 | deferred-P2 | Doc/code drift: the findings-and-validators.md closure-table runbook-heal row states merge commits are rejected as vacuous-proof, but validateControlPlaneOnlyCommit has NO merge guard (only the Stage 5 gate got isMergeCommit). The runbook-heal arm rejects a merge only incidentally when its first-parent diff is empty; a merge whose first-parent diff touches control-plane content would NOT be rejected, contradicting the doc. Latent today. | deferred-P2 |
| fr5-004 | final | stage5-gate-skips-reachability-binding | ce-maintainability-reviewer | P3 | deferred-P3 | assertStage5ReadOnly resolves the ref via raw git but never calls validateReachableCommit (the runbook-heal arm does, enforcing is-ancestor of HEAD). The gate accepts any resolvable ref (tag, other-branch commit) provided it touches only the ledger; fails closed on garbage but proves less provenance than its sibling. | deferred-P3 |
| fr5-005 | final | third-git-difftree-reader-duplication | ce-maintainability-reviewer | P3 | deferred-P3 | rawDiffForCommit (ledger.ts --raw) is a third near-identical git diff-tree reader alongside the private touchedFilesForCommit (ledger.ts --name-status) and touchedFilesForRef (decompose.ts --name-status). The deferred s5-005 recorded the two-copy duplication; this is three across two files. A future fix (e.g. -m/--cc, -z, maxBuffer) must be replicated thrice. | deferred-P3 |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

- 2026-05-24T16:47+10:00 — Stage 1: AC confirmed by Nathan (source: gold-standard, high confidence, 6 criteria). Full scope: Reading A guarded runbook-heal resolution + Stage 5 read-only gate + carve-out doc + tests. Feature branch feat/issue-71-pending created from main (post-PR-70 merge, commit dc6868a). Recursion noted: the deliverable is the issue-to-pr runbook + lib code itself.
- 2026-05-24T17:11+10:00 — Stage 3: batch contract confirmed by Nathan after 2 Contract Review cycles. Cycle 1: 3 P1 (cr-001 shared test file, cr-003 stage-3 scope, cr-004 undefined allowlist) + cr-002 P2, closed via plan-revision 89c6b5e (r1). Cycle 2: 3 P3 cosmetics (cr-006/cr-007/cr-008) closed via plan-revision 55f4357 (r2). AC6 user decision: AMEND fr-001..fr-004 in issue-68-ledger.md to status fixed + resolution runbook-heal 8be31d4 when the historical-rows-disposition batch runs.
- 2026-05-24T18:37+10:00 — Stage 5 final review: /ce-code-review report-only over main...HEAD (3 finders, cumulative-diff lens). 5 findings, all P2/P3, all deferred (Proposer refuses P2; no in-stage P2-fix path). fr5-001/002/003 deferred-P2, fr5-004/005 deferred-P3. Follow-up issue #72 filed. Stage 5 read-only gate run against checkpoint 8a37c8c (the wired instruction) -> PASS.
- 2026-05-24T18:52+10:00 — Stage 6 local checks (ship_mode standard, active harness repo):
  - bun_testFile lib/ledger.test.ts -> 76/76; lib/stage5-readonly.test.ts -> 5/5; bun_runTests pattern decompose -> 156/156.
  - tsc_check runbooks/issue-to-pr-v2 -> 0 errors.
  - biome_lintCheck decompose.ts -> 0 errors/0 warnings; lib/ledger.ts -> 0 errors, 2 warnings (noNonNullAssertion, noPrototypeBuiltins) PRE-EXISTING on main, not in this branch's added lines; repo gate is --diagnostic-level=error so warnings do not fail.
  - CI: no .github/workflows/ in repo. prompt-system render check not triggered (no prompt-fragments/rules/context changes).
- 2026-05-24T18:52+10:00 — Stage 6 ship (standard mode): branch feat/issue-71-runbook-heal-closure pushed; PR #73 created via /ce-commit-push-pr (https://github.com/nathanvale/claude-code-config/pull/73), Closes #71, with ## Residual Review Findings (3 deferred-P2 surfaced + 2 deferred-P3 noted, all tracked in #72). status: shipped.

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
