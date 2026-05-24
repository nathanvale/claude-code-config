---
issue_number: 81
issue_title: "issue-to-pr: add runtime contract drift check for operator-facing docs"
issue_url: "https://github.com/nathanvale/claude-code-config/issues/81"
target_repo: "nathanvale/claude-code-config"
plan_path: "docs/plans/2026-05-24-008-feat-runtime-contract-drift-check-plan.md"
started_at: "2026-05-24T22:27:00+10:00"
status: "in-progress"
runbook_version: "2"
ac_source: "gold-standard"
ac_confirmation_status: "confirmed"
ac_confirmed_at: "2026-05-24T22:27:00+10:00"
batch_contract_confirmation_status: "confirmed"
batch_contract_confirmed_at: "2026-05-24T22:47:00+10:00"
blocked_reason: null
pr_url: null
ship_mode: "standard"
final_reviewed_at: null
plan_digest: "sha256:03e1dee39a58f9420656fd751e87d6495ef0b51db38753f93dc32dd75d928508"
batch_contract_digest: "sha256:874d57c1f5f7b053f1bd2646228c67309bac4e048316367483c681f6e3dc2177"
ac_digest: "sha256:390f5294990c12765d2b0e1d5e057074b9a874f20350ca97a86656f1e10a20cf"
---

# Issue 81 - issue-to-pr: add runtime contract drift check for operator-facing docs

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

- [ ] The check validates quoted route IDs in the scoped operator-facing docs against `cli.ts contract route_ids --json`.
- [ ] The check validates mentioned `cli.ts` command names and contract slice names against `cli.ts --help --json` and `cli.ts contract <slice> --json`.
- [ ] The check validates explicit `data.*` response-field paths used by the scoped docs against the documented CLI response shapes.
- [ ] The check validates only recovery/control-plane links needed for this scope, especially links involving the first-run gotchas guide.
- [ ] The check does not hardcode expected route IDs, contract slices, packet roles, or response fields as duplicate source-of-truth lists.
- [ ] The check is read-only and introduces no runtime workflow behavior changes.
- [ ] Tests include at least one fake stale-doc claim proving the drift check fails for a real mismatch.
- [ ] Broad docs consistency, all Issue-to-PR references, prose truth judgments, new CLI observability, generated docs, and new dependencies are out of scope.

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
  - id: "contract-fact-loader"
    name: "Contract-fact loader (read expected values from the live CLI)"
    goal: "The check validates mentioned cli.ts command names, contract slice names, packet roles, and finite data.* response paths against cli.ts --help --json and cli.ts contract <slice> --json, sourcing expected values from the live CLI subprocess surface at runtime."
    files:
      - "runbooks/issue-to-pr-v2/contract-drift.ts"
      - "runbooks/issue-to-pr-v2/contract-drift.test.ts"
    depends_on: []
    execution_mode: tdd
    acceptance_tests:
      - "AC 2 holds: loadContractFacts derives command names, contract slice names, and packet roles from cli.ts --help --json and cli.ts contract <slice> --json subprocess calls, asserted by comparing against live CLI calls rather than hardcoded lists."
      - "AC 3 holds: loadContractFacts derives finite nested data.* response paths from the existing state_response_shape and diagnose_response_shape help payload, stopping at the nearest known parent when a child set is not mechanically finite."
      - "AC 5 holds: the loader holds no literal route IDs, slice names, packet roles, or field paths; a grep of the check source finds no duplicate source-of-truth lists."
      - "AC 6 holds: the loader only invokes the read-only CLI and reads no mutable state; failed CLI subprocesses or error envelopes throw clear hard errors instead of returning empty facts."
    ac_mapping:
      - 2
      - 3
      - 5
      - 6
    rationale: null
    status: in-progress
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "doc-claim-extractor"
    name: "Doc-claim extractor (bounded contract-token patterns)"
    goal: "The check extracts quoted route IDs, cli.ts command/slice names, packet roles in explicit cli.ts packet <role> positions, and explicit data.* response-field paths from the scoped docs using bounded patterns over prose and fenced code blocks, skipping placeholders and expanding brace-set shorthand."
    files:
      - "runbooks/issue-to-pr-v2/contract-drift.ts"
      - "runbooks/issue-to-pr-v2/contract-drift.test.ts"
    depends_on: []
    execution_mode: tdd
    acceptance_tests:
      - "AC 1 holds: route-ID claims are extracted from explicit route-ID positions in the scoped docs for comparison against cli.ts contract route_ids --json."
      - "AC 2 holds: command and slice claims are extracted only from cli.ts command positions, and packet-role claims only from explicit cli.ts packet <role> command positions."
      - "AC 3 holds: data.* field-path claims are extracted from prose and fenced code blocks, with {a, b, c} brace-sets, including multiline brace sets, expanded into individual paths and <placeholder> tokens skipped."
      - "AC 5 holds: the extractor reads docs and emits claims only; it holds no expected contract values of its own."
    ac_mapping:
      - 1
      - 2
      - 3
      - 5
    rationale: "Split from comparison (U3) because extraction patterns and fact-comparison are separable concerns tested independently; the extractor is the surface most prone to false positives and warrants its own unit."
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "claim-fact-comparator"
    name: "Claim-vs-fact comparator and scoped-link existence check"
    goal: "The check validates extracted claims against loaded contract facts and validates only the recovery/control-plane links needed for this scope, especially links involving the first-run gotchas guide, producing structured drift findings."
    files:
      - "runbooks/issue-to-pr-v2/contract-drift.ts"
      - "runbooks/issue-to-pr-v2/contract-drift.test.ts"
    depends_on:
      - "contract-fact-loader"
      - "doc-claim-extractor"
    execution_mode: tdd
    acceptance_tests:
      - "AC 1 holds: a route-ID claim absent from cli.ts contract route_ids --json produces exactly one route-ID drift finding."
      - "AC 2 holds: a command-name, slice-name, or explicit packet-role claim absent from the live CLI facts produces a drift finding."
      - "AC 3 holds: a data.* field-path claim absent from the documented response shapes produces a drift finding."
      - "AC 4 holds: scoped recovery/control-plane links (especially first-run-gotchas.md) are checked for target existence and the deterministic gotchas-guide relationship; a missing target or broken relationship produces one finding and a present one produces none."
    ac_mapping:
      - 1
      - 2
      - 3
      - 4
    rationale: null
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "orchestrator-and-stale-doc-test"
    name: "Orchestrator, runnable entry, and the fake-stale-doc failing test"
    goal: "The check runs read-only over the four scoped docs and ships a test with at least one fake stale-doc claim proving the drift check fails for a real mismatch."
    files:
      - "runbooks/issue-to-pr-v2/contract-drift.ts"
      - "runbooks/issue-to-pr-v2/contract-drift.test.ts"
    depends_on:
      - "contract-fact-loader"
      - "doc-claim-extractor"
      - "claim-fact-comparator"
    execution_mode: tdd
    acceptance_tests:
      - "AC 7 holds: a fixture doc with a deliberately stale contract claim (e.g. a route ID not in the live route_ids) makes the check return ok:false with a finding naming that token, proving the check fails for a real mismatch."
      - "AC 6 holds: checkContractDrift and the runnable entry perform no filesystem writes and no git mutations; the four scoped docs are unchanged after a run."
      - "AC 1 holds: run against the four explicit scoped doc paths, the check returns ok:true (docs currently in sync) by validating their quoted route IDs against cli.ts contract route_ids --json; a missing scoped doc is a hard error, not a clean result."
    ac_mapping:
      - 1
      - 6
      - 7
    rationale: "Merges orchestration and the AC7 proof test into one unit because the fake-stale-doc test exercises the full checkContractDrift path; they live in the same file and share inseparable test scaffolding."
    status: pending
    builder_commits: []
    builder_attempts: []
    iterations: 0
    final_verdict: null
  - id: "out-of-scope-guard"
    name: "Out-of-scope boundary (no broad audit, no new deps, no generated docs)"
    goal: "AC 8: Broad docs consistency, all Issue-to-PR references, prose truth judgments, new CLI observability, generated docs, and new dependencies are out of scope."
    files:
      - "runbooks/issue-to-pr-v2/contract-drift.ts"
    depends_on:
      - "orchestrator-and-stale-doc-test"
    execution_mode: change_first
    acceptance_tests:
      - "AC 8 holds: the delivered check covers only the four scoped docs and the contract-token kinds named in AC1-AC4, adds no dependency to package.json, adds no new CLI command or emitted fact, generates no docs, and does not validate decompose.ts flags, route precedence, enum prose, template filenames, or role-ish workflow words outside explicit cli.ts packet <role> command positions."
    ac_mapping:
      - 8
    rationale: "out-of-scope: investigation-required"
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
    signature: ac3-deep-nested-path-derivation-may-exceed-finite-flatten
    persona: contract-reviewer
    severity: P2
    status: open
    summary: "first-run-gotchas.md quotes data.drift.digest_drift.{...}, a two-level nest whose leaf set is only derivable by resolving the help payload 'same shape as state_response_shape.digest_drift' cross-reference; the comparator must resolve it or fall back to nearest-known-parent per Key Decision 5, else real doc claims become false-positive drift."
    resolution: null
  - id: F2
    batch_id: stage-3
    signature: readme-command-list-section-does-not-exist
    persona: contract-reviewer
    severity: P3
    status: open
    summary: "doc-claim-extractor U2 prose references 'the README cli.ts command-list section' but the README has no enumerated command-name list; the primary cli.ts <command> mechanism still satisfies AC2, so this is stale approach prose, not a coverage gap."
    resolution: null
  - id: F3
    batch_id: stage-3
    signature: u1-approach-text-says-route_ids-but-cli-emits-data-values
    persona: contract-reviewer
    severity: P3
    status: open
    summary: "contract-fact-loader approach prose says collect 'route_ids (from contract route_ids --json)' but the live slice emits data.values not data.route_ids; the unit test scenario has the correct anchor, but the prose could mislead."
    resolution: null
  - id: F4
    batch_id: contract-fact-loader
    signature: ac6-empty-facts-not-hard-errored
    persona: ce-adversarial-reviewer
    severity: P1
    status: open
    summary: "loadContractFacts returns a silently empty/partial fact set when the CLI emits well-formed ok envelopes with empty arrays/objects (e.g. route_ids data.values:[] or empty commands/slices/shapes), violating the AC6 promise to hard-error on empty facts; expectStringArray checks element type but never non-emptiness."
    resolution: null
  - id: F5
    batch_id: contract-fact-loader
    signature: ac6-unparseable-stdout-path-untested
    persona: ce-testing-reviewer
    severity: P1
    status: open
    summary: "AC6 requires proving the unparseable-stdout and no-data-object failure paths, but no test feeds non-JSON stdout from an exit-0 process; the JSON.parse catch branch and the 'emitted no parseable envelope' / 'ok envelope with no data object' branches are never exercised."
    resolution: null
  - id: F6
    batch_id: contract-fact-loader
    signature: ac5-source-scan-omits-field-paths
    persona: ce-testing-reviewer
    severity: P1
    status: open
    summary: "AC5's source-scan test only forbids routeIds/packetRoles/slices literals; it never adds response-shape field-path keys (e.g. digest_drift, acceptance_criteria), so a future hardcoded field-path literal would pass undetected despite AC5 explicitly covering field paths."
    resolution: null
  - id: F7
    batch_id: contract-fact-loader
    signature: finite-child-keys-array-marker-reject-too-broad
    persona: ce-adversarial-reviewer
    severity: P2
    status: open
    summary: "finiteChildKeys rejects any description containing [] anywhere via the global /\\[\\]/ test, so the genuinely-finite installed_artifact_presence shape loses its child paths because the trailing missing:(...)[] suffix trips the array-element guard; real future doc claims like data.installed_artifact_presence.all_present would later read as false-positive drift (same class as F1)."
    resolution: null
  - id: F8
    batch_id: contract-fact-loader
    signature: finite-child-keys-or-word-and-multi-crossref-fragility
    persona: ce-adversarial-reviewer
    severity: P3
    status: open
    summary: "Latent finiteChildKeys/deriveFieldPaths fragilities: the /\\bor\\b/ guard drops all finite children from any description containing the standalone word 'or'; only the first 'same shape as' cross-reference per description is resolved; firstLine envelope parsing would reject a pretty-printed multi-line envelope. Currently unreachable with the compact-emitting CLI."
    resolution: null
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| F1 | stage-3 | ac3-deep-nested-path-derivation-may-exceed-finite-flatten | contract-reviewer | P2 | open | first-run-gotchas.md quotes data.drift.digest_drift.{...}, a two-level nest whose leaf set is only derivable by resolving the help payload 'same shape as state_response_shape.digest_drift' cross-reference; the comparator must resolve it or fall back to nearest-known-parent per Key Decision 5, else real doc claims become false-positive drift. |  |
| F2 | stage-3 | readme-command-list-section-does-not-exist | contract-reviewer | P3 | open | doc-claim-extractor U2 prose references 'the README cli.ts command-list section' but the README has no enumerated command-name list; the primary cli.ts <command> mechanism still satisfies AC2, so this is stale approach prose, not a coverage gap. |  |
| F3 | stage-3 | u1-approach-text-says-route_ids-but-cli-emits-data-values | contract-reviewer | P3 | open | contract-fact-loader approach prose says collect 'route_ids (from contract route_ids --json)' but the live slice emits data.values not data.route_ids; the unit test scenario has the correct anchor, but the prose could mislead. |  |
| F4 | contract-fact-loader | ac6-empty-facts-not-hard-errored | ce-adversarial-reviewer | P1 | open | loadContractFacts returns a silently empty/partial fact set when the CLI emits well-formed ok envelopes with empty arrays/objects (e.g. route_ids data.values:[] or empty commands/slices/shapes), violating the AC6 promise to hard-error on empty facts; expectStringArray checks element type but never non-emptiness. |  |
| F5 | contract-fact-loader | ac6-unparseable-stdout-path-untested | ce-testing-reviewer | P1 | open | AC6 requires proving the unparseable-stdout and no-data-object failure paths, but no test feeds non-JSON stdout from an exit-0 process; the JSON.parse catch branch and the 'emitted no parseable envelope' / 'ok envelope with no data object' branches are never exercised. |  |
| F6 | contract-fact-loader | ac5-source-scan-omits-field-paths | ce-testing-reviewer | P1 | open | AC5's source-scan test only forbids routeIds/packetRoles/slices literals; it never adds response-shape field-path keys (e.g. digest_drift, acceptance_criteria), so a future hardcoded field-path literal would pass undetected despite AC5 explicitly covering field paths. |  |
| F7 | contract-fact-loader | finite-child-keys-array-marker-reject-too-broad | ce-adversarial-reviewer | P2 | open | finiteChildKeys rejects any description containing [] anywhere via the global /\[\]/ test, so the genuinely-finite installed_artifact_presence shape loses its child paths because the trailing missing:(...)[] suffix trips the array-element guard; real future doc claims like data.installed_artifact_presence.all_present would later read as false-positive drift (same class as F1). |  |
| F8 | contract-fact-loader | finite-child-keys-or-word-and-multi-crossref-fragility | ce-adversarial-reviewer | P3 | open | Latent finiteChildKeys/deriveFieldPaths fragilities: the /\bor\b/ guard drops all finite children from any description containing the standalone word 'or'; only the first 'same shape as' cross-reference per description is resolved; firstLine envelope parsing would reject a pretty-printed multi-line envelope. Currently unreachable with the compact-emitting CLI. |  |

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
