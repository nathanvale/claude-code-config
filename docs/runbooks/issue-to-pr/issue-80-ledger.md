---
issue_number: 80
issue_title: "issue-to-pr: deterministically load first-run-gotchas.md on blocked routes"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/80"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-007-feat-blocked-route-gotchas-load-plan.md"
started_at: "2026-05-24T21:45:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T21:45:00+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-24T21:45:00+10:00"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: "2026-05-24T22:15:00+10:00"
plan_digest: "sha256:2ee41531149675bbcbca7d9cd70e62183c8d52213ca081dd085da409ded5651f"
batch_contract_digest: "sha256:2cba9f3af989eb209813bab81e4a90853dc51afcb7d1460c02e5399e876cbde8"
ac_digest: "sha256:0b74444e5bdf8647763a3a27e40e805591b43c3d0a5544bcfbc78be05c5203e1"
---

# Issue 80 - issue-to-pr: deterministically load first-run-gotchas.md on blocked routes

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

- [ ] `SKILL.md` `<orchestration_loop>` deterministically loads `first-run-gotchas.md` when `data.route_id` is a `blocked-*` route.
- [ ] No change to `lib/route.ts`, `requiredReferenceIdsFor`, or CLI runtime behavior.
- [ ] The discretionary framing in `<reference_loading_policy>` is reconciled with the new deterministic load (no contradiction between the two sections).
- [ ] The affected `first-run-gotchas.md` retirement triggers (2.1, 2.2, 2.4) are re-evaluated and updated if the deterministic load satisfies them.

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
  - id: "batch-1-skill-reconcile"
    name: "Reconcile SKILL.md control-plane sections (U1+U2+U3)"
    goal: "SKILL.md deterministically loads first-run-gotchas.md on blocked-* routes with no contradiction across orchestration-loop, reference-loading-policy, and route-catalog, and no CLI/route.ts change."
    files:
      - "skills/issue-to-pr/SKILL.md"
    depends_on: []
    execution_mode: change_first
    acceptance_tests:
      - "AC 1 holds: <orchestration_loop> has a step that loads runbooks/issue-to-pr-v2/references/first-run-gotchas.md whenever data.route_id begins with blocked-, worded as a skill-loop load layered on the CLI required set."
      - "AC 2 holds: git diff touches no .ts file; route.test.ts stays green; requiredReferenceIdsFor unchanged."
      - "AC 3 holds: <reference_loading_policy> and <route_catalog> read consistently with the new step (deterministic on blocked routes, discretionary on non-blocked cryptic states); no unqualified discretionary against the blocked path; the guide stays absent from data.required_reference_ids by design."
    ac_mapping:
      - 1
      - 2
      - 3
    rationale: "merge: U1/U2/U3 are inseparable coordinated edits to the single file skills/issue-to-pr/SKILL.md (orchestration-loop step plus the two reconciliations it forces); splitting would create three sequential single-file batches with overlapping ownership."
    status: converged
    builder_commits:
      - "f8e189f7cfd0a913482f210590d12a89383ff8aa"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "f8e189f7cfd0a913482f210590d12a89383ff8aa"
        files_touched:
          - "skills/issue-to-pr/SKILL.md"
        route_hint: "validator-wave"
        blockers: []
        probe_results: []
        notes: "Three coordinated docs-only edits: U1 orchestration-loop step 7b (deterministic blocked-route load), U2 reference-loading-policy split-trigger reconciliation, U3 route-catalog reconciliation. biome clean."
    iterations: 1
    final_verdict: converged
  - id: "batch-2-guide-and-verify"
    name: "Reconcile first-run-gotchas.md and verify whole change (U4)"
    goal: "The affected first-run-gotchas.md retirement triggers (2.1, 2.2, 2.4) are re-evaluated and the guide's read-trigger is reconciled, then whole-change consistency and green tests are verified."
    files:
      - "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"
    depends_on:
      - "batch-1-skill-reconcile"
    execution_mode: change_first
    acceptance_tests:
      - "AC 4 holds: triggers 2.1/2.2/2.4 re-evaluated against the deterministic blocked-route load; conclusion (remain open) recorded as an in-guide annotation folded into each Retire-when line; bar text left verbatim."
      - "AC 3 holds (guide half): the guide's read-trigger (lines 3-8) is qualified to the D3 split so it no longer frames blocked-route loading as a reader's choice, matching the new deterministic load."
    ac_mapping:
      - 4
    rationale: "split: U4 edits a different file (first-run-gotchas.md) from batch-1 and owns the whole-change verification gate; depends on batch-1 so the guide reconciliation matches the landed SKILL.md behavior."
    status: converged
    builder_commits:
      - "caf086c40caae714cda5438f8635a32b60635025"
      - "363cd4f2c13b6b1c84d3c3811c9836645ede962c"
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: "caf086c40caae714cda5438f8635a32b60635025"
        files_touched:
          - "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"
        route_hint: "validator-wave"
        blockers: []
        probe_results: []
        notes: "Read-trigger reconciled to D3 split; 2.1/2.2/2.4 retire-when bars verbatim with folded re-evaluation annotations. Whole-change verify: biome 0/0, runbook tests 503/0, no .ts diff."
      - attempt_type: repair
        status: committed
        commit_sha: "363cd4f2c13b6b1c84d3c3811c9836645ede962c"
        files_touched:
          - "runbooks/issue-to-pr-v2/references/first-run-gotchas.md"
        route_hint: "validator-wave"
        blockers: []
        probe_results: []
        notes: "Fixed b2-001 (annotation-step7b-block-mislabel): 2.4 annotation now attributes step 7b to <orchestration_loop>, not <route_catalog>. Re-check correctness pass clean."
    iterations: 2
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
  - id: b2-001
    batch_id: batch-2-guide-and-verify
    signature: "annotation-step7b-block-mislabel"
    persona: ce-correctness-reviewer
    severity: P2
    status: fixed
    summary: "2.4 retire-when annotation calls step 7b a `<route_catalog>` load; step 7b lives in `<orchestration_loop>`."
    resolution: "commit 363cd4f2c13b6b1c84d3c3811c9836645ede962c"
  - id: b2-002
    batch_id: batch-2-guide-and-verify
    signature: "annotations-lengthen-retire-when-block"
    persona: ce-project-standards-reviewer
    severity: P3
    status: deferred-P3
    summary: "2026-05 re-evaluation parentheticals lengthen each Retire-when block; stacking future notes could erode the no-junk-drawer intent."
    resolution: "deferred-P3"
  - id: b2-003
    batch_id: batch-2-guide-and-verify
    signature: "split-trigger-prose-drift-four-surfaces"
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "Split-trigger rationale duplicated as prose across four surfaces (guide read-trigger, step 7b, reference-loading-policy, route-catalog); nothing mechanically binds them."
    resolution: "deferred-P3"
  - id: fr-001
    batch_id: final
    signature: "read-trigger-install-presence-overclaim"
    persona: ce-code-review
    severity: P3
    status: deferred-P3
    summary: "Read-trigger characterizes all of Part 2 as blocked-route recovery recipes already in context, but Part 2.5 (install-presence) carries no blocked- route_id so step 7b never fires for an install-presence stop; mitigated (one-file load, SKILL.md sibling-field gate covers recovery)."
    resolution: "deferred-P3"
  - id: fr-002
    batch_id: final
    signature: "step-7b-markdown-list-marker"
    persona: ce-code-review
    severity: P3
    status: deferred-P3
    summary: "Step `7b.` is not a valid Markdown ordered-list marker; rendered views break the 1-10 numbering and show it as literal text (raw-source agents read it fine; cross-references resolve)."
    resolution: "deferred-P3"
  - id: fr-003
    batch_id: final
    signature: "step-7b-single-visible-action-ambiguity"
    persona: ce-code-review
    severity: P3
    status: deferred-P3
    summary: "Step 7b is a peer numbered loop step just before the single-visible-action step; a literal agent could read the load as consuming the turn (mitigated by 7b's layered-load prose and step 8's action enumeration)."
    resolution: "deferred-P3"
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| b2-001 | batch-2-guide-and-verify | annotation-step7b-block-mislabel | ce-correctness-reviewer | P2 | fixed | 2.4 retire-when annotation calls step 7b a `<route_catalog>` load; step 7b lives in `<orchestration_loop>`. | commit 363cd4f2c13b6b1c84d3c3811c9836645ede962c |
| b2-002 | batch-2-guide-and-verify | annotations-lengthen-retire-when-block | ce-project-standards-reviewer | P3 | deferred-P3 | 2026-05 re-evaluation parentheticals lengthen each Retire-when block; stacking future notes could erode the no-junk-drawer intent. | deferred-P3 |
| b2-003 | batch-2-guide-and-verify | split-trigger-prose-drift-four-surfaces | ce-adversarial-reviewer | P3 | deferred-P3 | Split-trigger rationale duplicated as prose across four surfaces (guide read-trigger, step 7b, reference-loading-policy, route-catalog); nothing mechanically binds them. | deferred-P3 |
| fr-001 | final | read-trigger-install-presence-overclaim | ce-code-review | P3 | deferred-P3 | Read-trigger characterizes all of Part 2 as blocked-route recovery recipes already in context, but Part 2.5 (install-presence) carries no blocked- route_id so step 7b never fires for an install-presence stop; mitigated (one-file load, SKILL.md sibling-field gate covers recovery). | deferred-P3 |
| fr-002 | final | step-7b-markdown-list-marker | ce-code-review | P3 | deferred-P3 | Step `7b.` is not a valid Markdown ordered-list marker; rendered views break the 1-10 numbering and show it as literal text (raw-source agents read it fine; cross-references resolve). | deferred-P3 |
| fr-003 | final | step-7b-single-visible-action-ambiguity | ce-code-review | P3 | deferred-P3 | Step 7b is a peer numbered loop step just before the single-visible-action step; a literal agent could read the load as consuming the turn (mitigated by 7b's layered-load prose and step 8's action enumeration). | deferred-P3 |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

- 2026-05-24: Stage 1 dirty-tree decision (Nathan): stashed an unrelated
  CONTEXT.md "Runtime contract drift check" glossary edit (stash@{0}) so it
  stays out of issue #80's PR; the untracked plan file (007-...) was carried
  onto the feature branch. Restore the stash separately after this run.
- 2026-05-24: Stage 2 plan decision (Nathan via skill): adopted the existing
  plan docs/plans/2026-05-24-007-feat-blocked-route-gotchas-load-plan.md
  rather than regenerating via /ce-plan; appended the structured batch
  contract (2 batches) to the plan so decompose.ts could parse it.
- 2026-05-24: Stage 3 decomposition decision (Nathan): 2 change_first batches
  (batch-1 merges U1+U2+U3 SKILL.md edits AC 1/2/3; batch-2 is U4
  first-run-gotchas.md + whole-change verify AC 4). Contract Review: 1
  reviewer (ce-architecture-strategist), no findings; advisories only.
- 2026-05-24: batch-1-skill-reconcile Validator wave on commit
  f8e189f7cfd0a913482f210590d12a89383ff8aa. Personas dispatched (always-on
  set, no conditional reviewers fired for a markdown-only diff):
  ce-correctness-reviewer, ce-project-standards-reviewer,
  ce-maintainability-reviewer, ce-adversarial-reviewer. All returned empty
  findings (0 P0/P1/P2/P3). Recurring non-blocking residual risks: the `7b`
  list marker is non-standard markdown (style nit, not a defect); the
  `blocked-` prefix is an unguarded prose-to-route.ts coupling (testing gap,
  deferred follow-up); first-run-gotchas.md read-trigger still says
  "discretionary" and contradicts step 7b until batch-2 reconciles it
  (correctly scoped to batch-2, which owns that file).
- 2026-05-24: batch-2-guide-and-verify Validator wave on commit
  caf086c40caae714cda5438f8635a32b60635025; personas (always-on set):
  ce-correctness-reviewer, ce-project-standards-reviewer,
  ce-maintainability-reviewer, ce-adversarial-reviewer. Findings: b2-001
  (P2, annotation-step7b-block-mislabel) fixed by repair commit
  363cd4f2c13b6b1c84d3c3811c9836645ede962c (re-check correctness clean);
  b2-002/b2-003 P3 deferred. Bar text verbatim and entry-governance
  preserved confirmed by all reviewers; adversarial independently re-ran
  route.test.ts (77/0 green).
- 2026-05-24: Stage 5 final review via /ce-code-review (report-only) over
  the cumulative diff main...HEAD. Docs-only diff; full reviewer suite ran
  (no cap failure, no fanout reduction). 0 open P0/P1. Three P3 findings
  recorded as batch_id: final, deferred-P3: fr-001 (read-trigger
  install-presence over-claim, PLAUSIBLE then mitigated), fr-002 (`7b.`
  markdown list marker), fr-003 (step 7b single-visible-action ambiguity).
  Stage 5 read-only gate (--assert-stage5-readonly b31fc6a) passed.
- 2026-05-24: Stage 6 local checks. biome_lintCheck (json)
  first-run-gotchas.md: 0/0 clean. biome_lintCheck (json) SKILL.md: 0/0
  clean. bun_runTests (json) pattern issue-to-pr-v2: 503 pass / 0 fail
  (route.test.ts pinned mapping green = AC #2 regression gate).

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
