---
issue_number: 87
issue_title: "issue-to-pr: retire first-run-gotchas recipe 2.3 (blocked-digests-stale) and close its targeting gaps"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/87"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-25-001-docs-retire-recipe-2-3-targeting-gaps-plan.md"
started_at: "2026-05-25T07:40:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-25T07:40:00+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-25T07:52:00+10:00"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:7e6c309be55faefb3491635a5bccb4f3ef85fdb9278be8be39958c34e8c9f6c7"
batch_contract_digest: "sha256:1ce7bc105a3c6c25af830ecd42b01a014fe5356a4b0fdc51557b4f75a6b4e637"
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
batches:
  - id: "u1-ledger-helper-link"
    name: "Add the ledger-and-helper.md recovery-sequence link to recipe 2.3"
    goal: "The \"Stage-transition digest recheck\" paragraph in ledger-and-helper.md links to first-run-gotchas.md recipe 2.3 (blocked-digests-stale) by name, for the recovery sequence."
    files:
      - "runbooks/issue-to-pr-v2/references/ledger-and-helper.md"
    depends_on: []
    execution_mode: change_first
    acceptance_tests:
      - "AC 1 holds: the digest-recheck paragraph in ledger-and-helper.md names recipe 2.3 (blocked-digests-stale) and frames it for the recovery sequence, not a bare see-also."
    ac_mapping:
      - 1
    rationale: null
    status: pending
    iterations: 0
    builder_commits: []
    builder_attempts: []
    final_verdict: null
  - id: "u2-skill-route-catalog-link"
    name: "Add the SKILL.md route_catalog named link to recipe 2.3"
    goal: "The route_catalog blocked-batch-contract-stale and blocked-digests-stale bullet in SKILL.md links to first-run-gotchas.md recipe 2.3 by name, alongside the existing recipe 2.2 link."
    files:
      - "skills/issue-to-pr/SKILL.md"
    depends_on: []
    execution_mode: change_first
    acceptance_tests:
      - "AC 2 holds: the shared route_catalog bullet names recipe 2.3 for blocked-digests-stale while retaining the recipe 2.2 link for blocked-batch-contract-stale."
    ac_mapping:
      - 2
    rationale: null
    status: pending
    iterations: 0
    builder_commits: []
    builder_attempts: []
    final_verdict: null
  - id: "u3-retire-recipe-2-3"
    name: "Retire recipe 2.3 retire-when bar and verify no contradiction"
    goal: "Recipe 2.3's retire-when bar in first-run-gotchas.md is retired (marked retired per the entry-governance contract, recipe body retained), recording that the ledger-and-helper.md link satisfies the literal retire-when bar and the SKILL.md link closes the companion route-catalog targeting gap, with no contradiction across the three edited surfaces and both test suites green."
    files:
      - "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"
    depends_on:
      - "u1-ledger-helper-link"
      - "u2-skill-route-catalog-link"
    execution_mode: change_first
    acceptance_tests:
      - "AC 3 holds: recipe 2.3 ends with an Owner line and a retirement record in the #83 pattern naming both the ledger-and-helper.md and SKILL.md links; the recipe body is retained."
      - "AC 4 holds: no change to lib/route.ts, requiredReferenceIdsFor, or CLI runtime behavior across the cumulative diff."
      - "AC 5 holds: route.test.ts stays green (77/77) and contract-drift.test.ts stays green (109/109)."
      - "AC 6 holds: the SKILL.md route_catalog bullet, the ledger-and-helper digest-recheck paragraph, and the recipe 2.3 retirement record contain no contradictory claims about which links exist or what they satisfy."
    ac_mapping:
      - 3
      - 4
      - 5
      - 6
    rationale: "merge: ACs 4 (no .ts change), 5 (suites green), and 6 (cross-surface consistency) are invariants verified over the cumulative diff at the final coordinated edit; they have no source change of their own and are mapped onto the unit that lands last and runs the governing suite."
    status: pending
    iterations: 0
    builder_commits: []
    builder_attempts: []
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
    signature: wrong-test-file-paths
    persona: system-architecture-contract-reviewer
    severity: P3
    status: open
    summary: "Real test paths are runbooks/issue-to-pr-v2/contract-drift.test.ts (not under lib/) and runbooks/issue-to-pr-v2/lib/route.test.ts; combined run reports 186 pass. Builder must use correct paths."
    resolution: ""
  - id: F2
    batch_id: stage-3
    signature: ac6-ac3-manual-verification-only
    persona: system-architecture-contract-reviewer
    severity: P3
    status: open
    summary: "Neither contract-drift.test.ts nor route.test.ts asserts AC6 cross-surface consistency or AC3 body-retention; both rest on the U3 git-diff re-read gate, which the Builder must treat as a hard, non-skippable check."
    resolution: ""
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| F1 | stage-3 | wrong-test-file-paths | system-architecture-contract-reviewer | P3 | open | Real test paths are runbooks/issue-to-pr-v2/contract-drift.test.ts (not under lib/) and runbooks/issue-to-pr-v2/lib/route.test.ts; combined run reports 186 pass. Builder must use correct paths. |  |
| F2 | stage-3 | ac6-ac3-manual-verification-only | system-architecture-contract-reviewer | P3 | open | Neither contract-drift.test.ts nor route.test.ts asserts AC6 cross-surface consistency or AC3 body-retention; both rest on the U3 git-diff re-read gate, which the Builder must treat as a hard, non-skippable check. |  |

## Notes

- 2026-05-25: Stage 1 started. ACs extracted from issue #87 `## Acceptance criteria` heading (gold-standard, high confidence), confirmed as-is by Nathan. No `## Blocked by` section; issue open; no override needed. Branch `feat/issue-87-pending` created from clean `main` HEAD before ledger mutation.
- 2026-05-25: Stage 2 plan written and refined (U3 goal tightened to distinguish the literal retire-when bar from the companion route-catalog gap; added Bun MCP runner note). plan_digest recomputed after refinement. Branch renamed to `feat/issue-87-retire-recipe-2-3-targeting-gaps`.
- 2026-05-25: Stage 3 Contract Review (1 reviewer, no escalation triggers): no P0/P1 blockers. Two P3 advisories recorded as F1/F2. Key reviewer findings to carry into Builder/verification: (a) correct test paths are `runbooks/issue-to-pr-v2/contract-drift.test.ts` and `runbooks/issue-to-pr-v2/lib/route.test.ts`, combined run = 186 pass; (b) AC6 cross-surface consistency and AC3 body-retention are NOT asserted by either suite (no token/phrasing pin on recipe 2.3 retirement), so the U3 git-diff re-read is the hard gate; (c) U1's new link is additive and safe (the existing `### Blocked route ids` link at line ~299 already satisfies the gotchas-relationship check). Batch contract confirmed by Nathan: 3-batch DAG, all change_first, AC coverage 6/6. Confirmed digest triple persisted.

### runbook_version skew continuation evidence (U6)

When the v2 runtime detects `runbook_version` skew (a missing or mismatched
frontmatter value) and the operator decides to continue against the new
contract anyway, append a continuation evidence row to this section using the
exact shape below. The v2 helper parses it; partial rows are rejected and the
skew remains a stop-required signal.
