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
    status: converged
    builder_commits:
      - e6bf9f87317fc6daeddb63542a22ddb43c473212
      - 8643d1007872b887089e82f924e7b2b1b418de7e
      - fbf72d0e2da7911628554ae17e1cb7c6f5a788df
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: e6bf9f87317fc6daeddb63542a22ddb43c473212
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "validators on contract-fact-loader"
        blockers: []
        probe_results: ["live CLI confirmed contract route_ids emits data.values not data.route_ids"]
        notes: "Initial loadContractFacts + helpers; 13 tests green."
      - attempt_type: repair
        status: committed
        commit_sha: 8643d1007872b887089e82f924e7b2b1b418de7e
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "re-validate repair wave"
        blockers: []
        probe_results: ["installed_artifact_presence yields 5 children; blocking_gates none"]
        notes: "Repair wave 1: fixed F4/F5/F6 (P1) + F7 (P2); 24 tests green. Squashed from 4 per-finding commits."
      - attempt_type: repair
        status: committed
        commit_sha: fbf72d0e2da7911628554ae17e1cb7c6f5a788df
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "converge contract-fact-loader"
        blockers: []
        probe_results: ["F9 test proven load-bearing via mutation; F10 over-correction guarded"]
        notes: "Repair wave 2: fixed F9 (P2) and F10 (P3); 27 tests green. F8 left advisory. Squashed from 2 commits."
    iterations: 3
    final_verdict: converged
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
    status: converged
    builder_commits:
      - f6b941a5be4c07ed444ed630cf32ce951f06bee2
      - cb005bc3a33e432234efb40dd865cf86956565c9
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: f6b941a5be4c07ed444ed630cf32ce951f06bee2
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "validators on doc-claim-extractor"
        blockers: []
        probe_results: ["55 tests green; extractor over prose + fenced code blocks"]
        notes: "Initial extractDocClaims + sub-extractors + claim types; 55 tests green."
      - attempt_type: repair
        status: committed
        commit_sha: cb005bc3a33e432234efb40dd865cf86956565c9
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "converge doc-claim-extractor"
        blockers: []
        probe_results: ["batch-4 clean-pass simulated: 0 false-positive claims across 4 live docs", "installed_artifact_presence.missing now consistent extractor/loader"]
        notes: "Repaired F11/F12 (P1) + F13/F14/F15 (P2) + F16 (P3) in one combined commit; 68 tests green. F12 used loader approach (arraySiblingKeys)."
    iterations: 2
    final_verdict: converged
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
    status: converged
    builder_commits:
      - c70acdb5b6f00c118011c7448108e4234b59802f
      - 50a3b8f36a85cede7ce246da29846874611fe4a2
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: c70acdb5b6f00c118011c7448108e4234b59802f
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "validators on claim-fact-comparator"
        blockers: []
        probe_results: ["live clean-pass: 0 findings across 4 docs; gotchas relationship []"]
        notes: "compareClaimsToFacts + scoped-link/gotchas-relationship check; 90 tests green."
      - attempt_type: repair
        status: committed
        commit_sha: 50a3b8f36a85cede7ce246da29846874611fe4a2
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "converge claim-fact-comparator"
        blockers: []
        probe_results: ["step-7b-only deletion now produces a finding (was 0); over-tightening ruled out; 4 live docs still 0 findings"]
        notes: "Repaired F17 (P1, anchor gotchas check on orchestration step-7b construct) + F18 (P2 signal robustness) + F19/F20 (P3) in one combined commit; 95 tests green."
    iterations: 2
    final_verdict: converged
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
    status: converged
    builder_commits:
      - adf73e8272b62a5669e91fdeef303f3151bba9c5
      - 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: adf73e8272b62a5669e91fdeef303f3151bba9c5
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "validators on orchestrator-and-stale-doc-test"
        blockers: []
        probe_results: ["AC7 stale-doc test fails the check (load-bearing); live 4-doc clean pass ok:true; missing doc throws; entry exits 0 clean"]
        notes: "checkContractDrift orchestrator + import.meta.main entry + AC7 fake-stale-doc test; 104 tests green."
      - attempt_type: repair
        status: committed
        commit_sha: 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
          - runbooks/issue-to-pr-v2/contract-drift.test.ts
        route_hint: "converge orchestrator-and-stale-doc-test"
        blockers: []
        probe_results: ["claim-free token-doc now not clean (F21); empty scopedDocs throws (F22); real 4 docs still ok:true; entry exits 0 clean"]
        notes: "Repaired F21/F22 (P2 silent-false-clean guards) + F23 (P3 helper dedup) + F24 (P3 entry exit-code test) in one combined commit; 109 tests green."
    iterations: 2
    final_verdict: converged
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
    status: converged
    builder_commits:
      - f5eb60f8877f24a04cdcd36b6c0b8422042b0f45
    builder_attempts:
      - attempt_type: implementation
        status: committed
        commit_sha: f5eb60f8877f24a04cdcd36b6c0b8422042b0f45
        files_touched:
          - runbooks/issue-to-pr-v2/contract-drift.ts
        route_hint: "converge out-of-scope-guard"
        blockers: []
        probe_results: ["AC8 boundary audit PASS across all clauses: git diff main...HEAD touches only contract-drift.ts/.test.ts + ledger/plan/CONTEXT.md; cli.ts/lib/decompose.ts/package.json UNCHANGED; extractor probes confirm decompose.ts flags/route-precedence/enum prose/template filenames/prose role words excluded"]
        notes: "change_first investigation batch: scope-boundary audit for AC8. Recorded a 'Scope boundary (AC8)' doc-comment in contract-drift.ts; no behavior change; 109 tests still green. AC8 holds."
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
    status: fixed
    summary: "loadContractFacts returns a silently empty/partial fact set when the CLI emits well-formed ok envelopes with empty arrays/objects (e.g. route_ids data.values:[] or empty commands/slices/shapes), violating the AC6 promise to hard-error on empty facts; expectStringArray checks element type but never non-emptiness."
    resolution: "commit 8643d1007872b887089e82f924e7b2b1b418de7e"
  - id: F5
    batch_id: contract-fact-loader
    signature: ac6-unparseable-stdout-path-untested
    persona: ce-testing-reviewer
    severity: P1
    status: fixed
    summary: "AC6 requires proving the unparseable-stdout and no-data-object failure paths, but no test feeds non-JSON stdout from an exit-0 process; the JSON.parse catch branch and the 'emitted no parseable envelope' / 'ok envelope with no data object' branches are never exercised."
    resolution: "commit 8643d1007872b887089e82f924e7b2b1b418de7e"
  - id: F6
    batch_id: contract-fact-loader
    signature: ac5-source-scan-omits-field-paths
    persona: ce-testing-reviewer
    severity: P1
    status: fixed
    summary: "AC5's source-scan test only forbids routeIds/packetRoles/slices literals; it never adds response-shape field-path keys (e.g. digest_drift, acceptance_criteria), so a future hardcoded field-path literal would pass undetected despite AC5 explicitly covering field paths."
    resolution: "commit 8643d1007872b887089e82f924e7b2b1b418de7e"
  - id: F7
    batch_id: contract-fact-loader
    signature: finite-child-keys-array-marker-reject-too-broad
    persona: ce-adversarial-reviewer
    severity: P2
    status: fixed
    summary: "finiteChildKeys rejects any description containing [] anywhere via the global /\\[\\]/ test, so the genuinely-finite installed_artifact_presence shape loses its child paths because the trailing missing:(...)[] suffix trips the array-element guard; real future doc claims like data.installed_artifact_presence.all_present would later read as false-positive drift (same class as F1)."
    resolution: "commit 8643d1007872b887089e82f924e7b2b1b418de7e"
  - id: F8
    batch_id: contract-fact-loader
    signature: finite-child-keys-or-word-and-multi-crossref-fragility
    persona: ce-adversarial-reviewer
    severity: P3
    status: deferred-P3
    summary: "Latent finiteChildKeys/deriveFieldPaths fragilities: the /\\bor\\b/ guard drops all finite children from any description containing the standalone word 'or'; only the first 'same shape as' cross-reference per description is resolved; firstLine envelope parsing would reject a pretty-printed multi-line envelope. Currently unreachable with the compact-emitting CLI."
    resolution: "deferred-P3"
  - id: F9
    batch_id: contract-fact-loader
    signature: ac6-no-data-branch-regex-not-load-bearing
    persona: ce-testing-reviewer
    severity: P2
    status: fixed
    summary: "F5 test (c) matcher for the ok-envelope-with-no-data branch is too loose (its alternation includes a bare 'data' alternative): deleting the no-data throw leaves all tests green because that bare alternative matches the downstream 'data.commands is not an array' error, so the test does not pin branch (c). Impl branch is correct and fires in production; only test load-bearingness is weak."
    resolution: "commit fbf72d0e2da7911628554ae17e1cb7c6f5a788df"
  - id: F10
    batch_id: contract-fact-loader
    signature: finite-child-keys-single-brace-array-union-over-correction
    persona: ce-adversarial-reviewer
    severity: P3
    status: fixed
    summary: "F7 over-corrected: scoping the []/union rejection to the brace inner means a single-brace array-of-objects ('{ a, b, c }[]') or single-brace union ('string or { a, b }') now has children invented; not reachable against the current CLI surface but latent if a future shape adds one."
    resolution: "commit fbf72d0e2da7911628554ae17e1cb7c6f5a788df"
  - id: F11
    batch_id: doc-claim-extractor
    signature: route-id-bullet-heuristic-over-captures-non-route-tokens
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "extractRouteIds bulletRe matches ANY backtick kebab token, not tokens in genuine route-ID positions. Run against live docs it falsely extracts SKILL.md Stage 4 subroute names (select-eligible-batch, start-batch-checkpoint, builder-attempt, validator-wave, finding-repair, converge-batch, accepted-risk-or-reframe) and ledger-and-helper.md field bullets (status, iterations) as route-ID claims; none are in facts.routeIds, so the comparator will flag false drift and the live docs cannot pass clean (breaks AC1/AC7)."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F12
    batch_id: doc-claim-extractor
    signature: brace-expander-emits-array-sibling-as-finite-child-asymmetry
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "first-run-gotchas.md writes data.installed_artifact_presence.{references,templates,cli_ts,lib_dir,all_present,missing} and the extractor expands all 6 incl. missing, but the loader's finiteChildKeys excludes missing (array sibling), so the two parsers disagree on the same source field and data.installed_artifact_presence.missing reads as false-positive drift; resolve the extractor/loader asymmetry so the live docs pass clean."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F13
    batch_id: doc-claim-extractor
    signature: no-test-asserts-claims-against-live-scoped-docs
    persona: ce-correctness-reviewer
    severity: P2
    status: fixed
    summary: "Extraction is only tested on hand-built fixtures; no test runs extractDocClaims over the actual 4 scoped docs and asserts emitted claims are consistent with live CLI facts. This is exactly why the route-ID and brace over-capture false positives (F11, F12) went uncaught; a live-doc test is the load-bearing guard."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F14
    batch_id: doc-claim-extractor
    signature: route-id-and-packet-role-guards-untested
    persona: ce-testing-reviewer
    severity: P2
    status: fixed
    summary: "The route-ID bullet-position guard and the packet-role command gate (command equals packet) both have happy-path tests but no mutation-proof negative case; weakening either keeps all tests green. Add negative tests: a non-blocked kebab token in prose is NOT a route id, and a non-packet cli.ts command argument (cli.ts state X) is NOT a packet role."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F15
    batch_id: doc-claim-extractor
    signature: bulletre-jsdoc-misdescribes-extraction-scope
    persona: ce-maintainability-reviewer
    severity: P2
    status: fixed
    summary: "contract-drift.ts bulletRe JSDoc claims it only matches tokens leading a route-catalog bullet followed by ':' or ' and ', but the regex matches any backtick kebab token anywhere in prose; the comment actively misleads the next maintainer about extraction scope (and is the root of F11). bulletPairRe is also dead code subsumed by bulletRe."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F16
    batch_id: doc-claim-extractor
    signature: scoped-link-title-and-image-mis-parse
    persona: ce-adversarial-reviewer
    severity: P3
    status: fixed
    summary: "linkRe captures '[t](y.md \"title\")' target as 'y.md \"title\"' (title not stripped) and matches the [alt](img.png) portion of an image '![alt](img.png)'; both would resolve to nonexistent paths and produce false-positive link-misses. Not reachable in the current 4 scoped docs but latent for future edits."
    resolution: "commit cb005bc3a33e432234efb40dd865cf86956565c9"
  - id: F17
    batch_id: claim-fact-comparator
    signature: ac4-relationship-check-passes-when-step-7b-load-removed
    persona: ce-adversarial-reviewer
    severity: P1
    status: fixed
    summary: "checkGotchasRelationship signal (a) is a whole-doc co-occurrence of the guide path AND a blocked- substring; three reviewers proved by mutation that deleting SKILL.md's step-7b deterministic-load block leaves the check returning 0 findings because blocked- and the guide path still appear in the route catalog and policy table. The check fails AC4's core promise: step 7b can be removed/broken without detection. The existing break-mode test wipes the whole doc so it never exercises this window."
    resolution: "commit 50a3b8f36a85cede7ce246da29846874611fe4a2"
  - id: F18
    batch_id: claim-fact-comparator
    signature: gotchas-signal-robustness-substring-basename-section
    persona: ce-adversarial-reviewer
    severity: P2
    status: fixed
    summary: "Gotchas-relationship signals are lexically fragile: /blocked-/ matches substrings like unblocked-; signal (a) requires the full repo-relative guide path so a legitimate basename-only reference produces a false 'missing 7b' finding; signal (b) for ledger-and-helper.md does not verify the guide link lives in the blocked-route section, and its heading regex assumes spaced 'Blocked route ids' (a hyphenated heading would false-positive). Tighten to anchor on the actual load construct and accept basename/section-scoped forms."
    resolution: "commit 50a3b8f36a85cede7ce246da29846874611fe4a2"
  - id: F19
    batch_id: claim-fact-comparator
    signature: live-clean-pass-no-non-empty-claim-floor
    persona: ce-testing-reviewer
    severity: P3
    status: fixed
    summary: "The live clean-pass test asserts findings.length === 0 for the 4 real docs but pins no non-empty claim floor for command/field-path/scoped-link kinds, so a future extractor regression that silently returns empty claim arrays would keep the test green while disarming drift detection. Add a per-doc total-claims > 0 assertion."
    resolution: "commit 50a3b8f36a85cede7ce246da29846874611fe4a2"
  - id: F20
    batch_id: claim-fact-comparator
    signature: comparator-dynamic-fs-import-and-line-zero-sentinel
    persona: ce-maintainability-reviewer
    severity: P3
    status: fixed
    summary: "pathExists uses inline await import('node:fs/promises') for the dir-stat fallback while sibling modules use top-level node:fs imports; and relationship findings use line: 0 as a doc-level sentinel while line is JSDoc'd as 1-based, which batch-4 operator output may render as a misleading 'line 0'. Both are stylistic nits."
    resolution: "commit 50a3b8f36a85cede7ce246da29846874611fe4a2"
  - id: F21
    batch_id: orchestrator-and-stale-doc-test
    signature: orchestrator-missing-claim-floor-silent-clean-on-extractor-regression
    persona: ce-adversarial-reviewer
    severity: P2
    status: fixed
    summary: "checkContractDrift has no non-empty claim floor (the F19 floor lives only in the test suite); a future extractor regression or a doc rewrite that strips structural markers would yield zero claims for a token-carrying doc and the live gate would still report ok:true for it, silently disarming that doc's contract validation. Add a runtime claim-floor guard for docs known to carry contract tokens."
    resolution: "commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e"
  - id: F22
    batch_id: orchestrator-and-stale-doc-test
    signature: empty-scopeddocs-array-returns-ok-true-checking-no-docs
    persona: ce-adversarial-reviewer
    severity: P2
    status: fixed
    summary: "checkContractDrift({scopedDocs: []}) returns ok:true having validated zero scoped docs (only the gotchas relationship check runs); per-doc validation is entirely bypassed with no guard against an empty scope. Test-only override so not production-reachable by default, but a caller mis-wiring scopedDocs would get a silent pass; guard against an empty scope."
    resolution: "commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e"
  - id: F23
    batch_id: orchestrator-and-stale-doc-test
    signature: duplicate-read-protected-doc-helper
    persona: ce-maintainability-reviewer
    severity: P3
    status: fixed
    summary: "Batch 4's readScopedDocOrThrow duplicates batch 3's readProtectedDoc almost exactly: both do Bun.file(absPath).exists() then throw-naming-the-doc then return file.text(), differing only in error prose; one shared helper would avoid the near-identical pair."
    resolution: "commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e"
  - id: F24
    batch_id: orchestrator-and-stale-doc-test
    signature: runnable-entry-exit-code-untested
    persona: ce-correctness-reviewer
    severity: P3
    status: fixed
    summary: "The import.meta.main runnable entry (formatFinding + console output + process.exit) is not exercised by any automated test; exit-0-on-clean / exit-1-on-drift and the report formatting are only verified manually. A regression flipping the exit code (e.g. always exit 0) would not be caught. Verified manually this run: clean exits 0, drift exits 1."
    resolution: "commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e"
```

## Findings

| id  | batch_id | signature | persona | severity | status | summary | resolution |
| --- | -------- | --------- | ------- | -------- | ------ | ------- | ---------- |
| F1 | stage-3 | ac3-deep-nested-path-derivation-may-exceed-finite-flatten | contract-reviewer | P2 | open | first-run-gotchas.md quotes data.drift.digest_drift.{...}, a two-level nest whose leaf set is only derivable by resolving the help payload 'same shape as state_response_shape.digest_drift' cross-reference; the comparator must resolve it or fall back to nearest-known-parent per Key Decision 5, else real doc claims become false-positive drift. |  |
| F2 | stage-3 | readme-command-list-section-does-not-exist | contract-reviewer | P3 | open | doc-claim-extractor U2 prose references 'the README cli.ts command-list section' but the README has no enumerated command-name list; the primary cli.ts <command> mechanism still satisfies AC2, so this is stale approach prose, not a coverage gap. |  |
| F3 | stage-3 | u1-approach-text-says-route_ids-but-cli-emits-data-values | contract-reviewer | P3 | open | contract-fact-loader approach prose says collect 'route_ids (from contract route_ids --json)' but the live slice emits data.values not data.route_ids; the unit test scenario has the correct anchor, but the prose could mislead. |  |
| F4 | contract-fact-loader | ac6-empty-facts-not-hard-errored | ce-adversarial-reviewer | P1 | fixed | loadContractFacts returns a silently empty/partial fact set when the CLI emits well-formed ok envelopes with empty arrays/objects (e.g. route_ids data.values:[] or empty commands/slices/shapes), violating the AC6 promise to hard-error on empty facts; expectStringArray checks element type but never non-emptiness. | commit 8643d1007872b887089e82f924e7b2b1b418de7e |
| F5 | contract-fact-loader | ac6-unparseable-stdout-path-untested | ce-testing-reviewer | P1 | fixed | AC6 requires proving the unparseable-stdout and no-data-object failure paths, but no test feeds non-JSON stdout from an exit-0 process; the JSON.parse catch branch and the 'emitted no parseable envelope' / 'ok envelope with no data object' branches are never exercised. | commit 8643d1007872b887089e82f924e7b2b1b418de7e |
| F6 | contract-fact-loader | ac5-source-scan-omits-field-paths | ce-testing-reviewer | P1 | fixed | AC5's source-scan test only forbids routeIds/packetRoles/slices literals; it never adds response-shape field-path keys (e.g. digest_drift, acceptance_criteria), so a future hardcoded field-path literal would pass undetected despite AC5 explicitly covering field paths. | commit 8643d1007872b887089e82f924e7b2b1b418de7e |
| F7 | contract-fact-loader | finite-child-keys-array-marker-reject-too-broad | ce-adversarial-reviewer | P2 | fixed | finiteChildKeys rejects any description containing [] anywhere via the global /\[\]/ test, so the genuinely-finite installed_artifact_presence shape loses its child paths because the trailing missing:(...)[] suffix trips the array-element guard; real future doc claims like data.installed_artifact_presence.all_present would later read as false-positive drift (same class as F1). | commit 8643d1007872b887089e82f924e7b2b1b418de7e |
| F8 | contract-fact-loader | finite-child-keys-or-word-and-multi-crossref-fragility | ce-adversarial-reviewer | P3 | deferred-P3 | Latent finiteChildKeys/deriveFieldPaths fragilities: the /\bor\b/ guard drops all finite children from any description containing the standalone word 'or'; only the first 'same shape as' cross-reference per description is resolved; firstLine envelope parsing would reject a pretty-printed multi-line envelope. Currently unreachable with the compact-emitting CLI. | deferred-P3 |
| F9 | contract-fact-loader | ac6-no-data-branch-regex-not-load-bearing | ce-testing-reviewer | P2 | fixed | F5 test (c) matcher for the ok-envelope-with-no-data branch is too loose (its alternation includes a bare 'data' alternative): deleting the no-data throw leaves all tests green because that bare alternative matches the downstream 'data.commands is not an array' error, so the test does not pin branch (c). Impl branch is correct and fires in production; only test load-bearingness is weak. | commit fbf72d0e2da7911628554ae17e1cb7c6f5a788df |
| F10 | contract-fact-loader | finite-child-keys-single-brace-array-union-over-correction | ce-adversarial-reviewer | P3 | fixed | F7 over-corrected: scoping the []/union rejection to the brace inner means a single-brace array-of-objects ('{ a, b, c }[]') or single-brace union ('string or { a, b }') now has children invented; not reachable against the current CLI surface but latent if a future shape adds one. | commit fbf72d0e2da7911628554ae17e1cb7c6f5a788df |
| F11 | doc-claim-extractor | route-id-bullet-heuristic-over-captures-non-route-tokens | ce-adversarial-reviewer | P1 | fixed | extractRouteIds bulletRe matches ANY backtick kebab token, not tokens in genuine route-ID positions. Run against live docs it falsely extracts SKILL.md Stage 4 subroute names (select-eligible-batch, start-batch-checkpoint, builder-attempt, validator-wave, finding-repair, converge-batch, accepted-risk-or-reframe) and ledger-and-helper.md field bullets (status, iterations) as route-ID claims; none are in facts.routeIds, so the comparator will flag false drift and the live docs cannot pass clean (breaks AC1/AC7). | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F12 | doc-claim-extractor | brace-expander-emits-array-sibling-as-finite-child-asymmetry | ce-adversarial-reviewer | P1 | fixed | first-run-gotchas.md writes data.installed_artifact_presence.{references,templates,cli_ts,lib_dir,all_present,missing} and the extractor expands all 6 incl. missing, but the loader's finiteChildKeys excludes missing (array sibling), so the two parsers disagree on the same source field and data.installed_artifact_presence.missing reads as false-positive drift; resolve the extractor/loader asymmetry so the live docs pass clean. | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F13 | doc-claim-extractor | no-test-asserts-claims-against-live-scoped-docs | ce-correctness-reviewer | P2 | fixed | Extraction is only tested on hand-built fixtures; no test runs extractDocClaims over the actual 4 scoped docs and asserts emitted claims are consistent with live CLI facts. This is exactly why the route-ID and brace over-capture false positives (F11, F12) went uncaught; a live-doc test is the load-bearing guard. | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F14 | doc-claim-extractor | route-id-and-packet-role-guards-untested | ce-testing-reviewer | P2 | fixed | The route-ID bullet-position guard and the packet-role command gate (command equals packet) both have happy-path tests but no mutation-proof negative case; weakening either keeps all tests green. Add negative tests: a non-blocked kebab token in prose is NOT a route id, and a non-packet cli.ts command argument (cli.ts state X) is NOT a packet role. | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F15 | doc-claim-extractor | bulletre-jsdoc-misdescribes-extraction-scope | ce-maintainability-reviewer | P2 | fixed | contract-drift.ts bulletRe JSDoc claims it only matches tokens leading a route-catalog bullet followed by ':' or ' and ', but the regex matches any backtick kebab token anywhere in prose; the comment actively misleads the next maintainer about extraction scope (and is the root of F11). bulletPairRe is also dead code subsumed by bulletRe. | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F16 | doc-claim-extractor | scoped-link-title-and-image-mis-parse | ce-adversarial-reviewer | P3 | fixed | linkRe captures '[t](y.md "title")' target as 'y.md "title"' (title not stripped) and matches the [alt](img.png) portion of an image '![alt](img.png)'; both would resolve to nonexistent paths and produce false-positive link-misses. Not reachable in the current 4 scoped docs but latent for future edits. | commit cb005bc3a33e432234efb40dd865cf86956565c9 |
| F17 | claim-fact-comparator | ac4-relationship-check-passes-when-step-7b-load-removed | ce-adversarial-reviewer | P1 | fixed | checkGotchasRelationship signal (a) is a whole-doc co-occurrence of the guide path AND a blocked- substring; three reviewers proved by mutation that deleting SKILL.md's step-7b deterministic-load block leaves the check returning 0 findings because blocked- and the guide path still appear in the route catalog and policy table. The check fails AC4's core promise: step 7b can be removed/broken without detection. The existing break-mode test wipes the whole doc so it never exercises this window. | commit 50a3b8f36a85cede7ce246da29846874611fe4a2 |
| F18 | claim-fact-comparator | gotchas-signal-robustness-substring-basename-section | ce-adversarial-reviewer | P2 | fixed | Gotchas-relationship signals are lexically fragile: /blocked-/ matches substrings like unblocked-; signal (a) requires the full repo-relative guide path so a legitimate basename-only reference produces a false 'missing 7b' finding; signal (b) for ledger-and-helper.md does not verify the guide link lives in the blocked-route section, and its heading regex assumes spaced 'Blocked route ids' (a hyphenated heading would false-positive). Tighten to anchor on the actual load construct and accept basename/section-scoped forms. | commit 50a3b8f36a85cede7ce246da29846874611fe4a2 |
| F19 | claim-fact-comparator | live-clean-pass-no-non-empty-claim-floor | ce-testing-reviewer | P3 | fixed | The live clean-pass test asserts findings.length === 0 for the 4 real docs but pins no non-empty claim floor for command/field-path/scoped-link kinds, so a future extractor regression that silently returns empty claim arrays would keep the test green while disarming drift detection. Add a per-doc total-claims > 0 assertion. | commit 50a3b8f36a85cede7ce246da29846874611fe4a2 |
| F20 | claim-fact-comparator | comparator-dynamic-fs-import-and-line-zero-sentinel | ce-maintainability-reviewer | P3 | fixed | pathExists uses inline await import('node:fs/promises') for the dir-stat fallback while sibling modules use top-level node:fs imports; and relationship findings use line: 0 as a doc-level sentinel while line is JSDoc'd as 1-based, which batch-4 operator output may render as a misleading 'line 0'. Both are stylistic nits. | commit 50a3b8f36a85cede7ce246da29846874611fe4a2 |
| F21 | orchestrator-and-stale-doc-test | orchestrator-missing-claim-floor-silent-clean-on-extractor-regression | ce-adversarial-reviewer | P2 | fixed | checkContractDrift has no non-empty claim floor (the F19 floor lives only in the test suite); a future extractor regression or a doc rewrite that strips structural markers would yield zero claims for a token-carrying doc and the live gate would still report ok:true for it, silently disarming that doc's contract validation. Add a runtime claim-floor guard for docs known to carry contract tokens. | commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e |
| F22 | orchestrator-and-stale-doc-test | empty-scopeddocs-array-returns-ok-true-checking-no-docs | ce-adversarial-reviewer | P2 | fixed | checkContractDrift({scopedDocs: []}) returns ok:true having validated zero scoped docs (only the gotchas relationship check runs); per-doc validation is entirely bypassed with no guard against an empty scope. Test-only override so not production-reachable by default, but a caller mis-wiring scopedDocs would get a silent pass; guard against an empty scope. | commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e |
| F23 | orchestrator-and-stale-doc-test | duplicate-read-protected-doc-helper | ce-maintainability-reviewer | P3 | fixed | Batch 4's readScopedDocOrThrow duplicates batch 3's readProtectedDoc almost exactly: both do Bun.file(absPath).exists() then throw-naming-the-doc then return file.text(), differing only in error prose; one shared helper would avoid the near-identical pair. | commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e |
| F24 | orchestrator-and-stale-doc-test | runnable-entry-exit-code-untested | ce-correctness-reviewer | P3 | fixed | The import.meta.main runnable entry (formatFinding + console output + process.exit) is not exercised by any automated test; exit-0-on-clean / exit-1-on-drift and the report formatting are only verified manually. A regression flipping the exit code (e.g. always exit 0) would not be caught. Verified manually this run: clean exits 0, drift exits 1. | commit 71c4c118c4ef27e48a38725aad8c2e1c7123ac0e |

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
