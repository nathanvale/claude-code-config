---
issue_number: 68
issue_title: "test: hello world for issue-to-pr skill test drive"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/68"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-004-test-hello-world-smoke-test-plan.md"
started_at: "2026-05-24T15:22:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "variant-heading"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T15:22:00+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-24T15:57:00+10:00"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:770958ac3561f12644deee1e00a00ba6b9e952a53f5badc1439c5809b3d8ce8e"
batch_contract_digest: "sha256:83952af8f7573a0cf097dc6d24a31802955c068b06f1b93eaecc1bf5c4733dcd"
ac_digest: "sha256:c9245e979faf0a512b6dd356bacc66603d870dde8dfbdb414c60ede52ed21b25"
---

# Issue 68 - test: hello world for issue-to-pr skill test drive

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

- [ ] A new file `docs/scratch/hello-world.md` exists with the content above
- [ ] A PR is opened against `main` linking to this issue
- [ ] CI passes (or is skipped, nothing in this change should trigger CI)

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
Persisted `blockers` and `probe_results` are compact string summaries, not raw
Builder envelope object arrays. Rich Builder evidence stays transient for
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
  - id: "hello-world-file"
    name: "Create the hello-world scratch file"
    goal: "A new file docs/scratch/hello-world.md exists with the content specified by the issue."
    files:
      - "docs/scratch/hello-world.md"
    depends_on: []
    execution_mode: change_first
    acceptance_tests:
      - "AC 1 holds: docs/scratch/hello-world.md exists with the exact specified content (heading line plus the verification sentence)."
      - "AC 2 holds: the change is shippable as a single-file PR against main linking issue #68."
      - "AC 3 holds: the change is docs-only and triggers no CI, so CI passes or is skipped."
    ac_mapping:
      - 1
      - 2
      - 3
    rationale: "docs-only change_first; AC2/AC3 are ship-stage outcomes mapped here so every AC index is covered without inventing non-implementation units."
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
reachable plan/DAG revision that closed them. Other fixed findings must use
`resolution: commit <sha>` recorded in a terminal ledger batch, or
`resolution: patch-batch patch-NNN`. Duplicate findings are identified by
`batch_id + signature`; superseded rows must point to the canonical
non-superseded row with the same batch id and signature.

```yaml
findings:
  - id: cr-001
    batch_id: stage-3
    signature: acceptance-test-looser-than-plan-byte-for-byte
    persona: contract-reviewer
    severity: P3
    status: deferred-P3
    summary: "Candidate acceptance_tests describe AC1 as exact specified content but do not restate the two literal lines or carry the plan byte-for-byte guard; contract digest binds it to the plan and content is trivial."
    resolution: deferred-P3
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| cr-001 | stage-3 | acceptance-test-looser-than-plan-byte-for-byte | contract-reviewer | P3 | deferred-P3 | Candidate acceptance_tests describe AC1 as exact specified content but do not restate the two literal lines or carry the plan byte-for-byte guard; contract digest binds it to the plan and content is trivial. | deferred-P3 |

## Notes

<append-only log of escape hatch fires, user decisions, blocker overrides,
host-builder-tools-unavailable evidence, builder-infrastructure-failure
evidence, Validator findings checkpoint evidence, reachable commit refs,
dirty/staged path summaries>

- 2026-05-24T15:22+10:00 — Stage 1: AC confirmed by Nathan (source: variant-heading, medium confidence). Tree cleaned by committing unrelated parity-audit changes (f0262d9); feature branch feat/issue-68-pending created from origin/main.

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
