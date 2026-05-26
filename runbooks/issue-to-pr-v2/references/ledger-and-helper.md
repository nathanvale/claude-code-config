# Ledger and helper reference

**Contract owner:** this reference owns stage framing, helper execution
context, turn protocol, ledger authoring guidance, acceptance criteria,
batches YAML purpose, findings YAML purpose, notes evidence, and
runbook-version skew handling. Ledger schema facts live in runtime contract
slices.

**Read trigger:** open this reference when starting or resuming a turn (to
re-read durable confirmation state), when writing or updating ledger YAML
sections (acceptance criteria, batches, findings data, notes), or when reading
helper command output during a stage transition. See also:
[stage-1-pick-issue.md](stage-1-pick-issue.md),
[stage-3-decompose.md](stage-3-decompose.md),
[findings-and-validators.md](findings-and-validators.md).

## Stages framing

Six stages, walked in order: `pick-issue`, `plan`, `decompose`, `batch-loop`,
`final-review`, `ship`. Each turn advances exactly one stage, commits one
ledger lifecycle checkpoint, or, for `batch-loop`, runs exactly one inner-loop
iteration.

### `cli.ts state` facts

Once the ledger exists, at the start of every resumed turn, run
`cli.ts state <ledger-path> --json` BEFORE reading frontmatter,
batches, findings, or notes from conversation memory. (The installed
path and invocation shape live in
[`README.md`](../README.md#invocation); this reference does not restate
them.)

The command writes exactly one `CliSuccessEnvelope` to stdout
(newline-terminated). The `data` shape is the contract; the hot router
routes off it without re-parsing the ledger inline:

- `confirmation_state.{acceptance_criteria, batch_contract, digests}` —
  each one of `pending | confirmed | stale | blocked`.
- `digest_drift.{acceptance_criteria, batch_contract, digests, any}` —
  per-axis booleans for "stored frontmatter digest no longer matches
  ledger content".
- `route_id` — one of `ROUTE_IDS` (see [Route ids](#route-ids-v2-clits)
  below); this is the single fact the hot router routes off.
- `required_reference_ids` — string[] of v2 reference filenames
  load-bearing for the returned route.
- `blocking_gates` — discriminated union; non-empty means the workflow
  cannot advance without operator action.
- `installed_artifact_presence.{references, templates, cli_ts,
  lib_dir, all_present, missing[]}` — install topology facts (U6).
- `runbook_version`, `runbook_version_skew` — version-contract facts
  (U6).
- `plan_path`, `has_batches`, `all_batches_terminal`,
  `final_reviewed_at`, `pr_url`, `frontmatter_status` — durable
  workflow facts mirrored from the ledger.

A resumed agent must route from this envelope, not from conversation
memory. The four-state confirmation semantics live in `lib/contract.ts`
(`CONFIRMATION_STATES`); the route-id catalog lives in `lib/route.ts`
(`ROUTE_IDS`). The CLI never says "run X" or "execute Y" — ADR 0002.

For richer diagnosis (per-axis digest drift, expected reference list,
install presence) the same shape is available via `cli.ts diagnose
<ledger-path> --json`; for route facts use `cli.ts contract route_ids
--json` and `cli.ts contract route_required_references --json`.
(Command surface and installed path live in
[`README.md`](../README.md#file-map).)

## Helper execution context

Helper command invocations in this runbook use the path
`bun ~/.claude/runbooks/issue-to-pr-v2/cli.ts` for fact reads and
`bun ~/.claude/runbooks/issue-to-pr-v2/decompose.ts` for validation /
digest / parse mechanics. Both helpers are pure: they read ledger,
plan, and template paths and emit either JSON on stdout (CLI envelope
shape for `cli.ts`, helper-specific JSON or line-oriented output for
`decompose.ts`). Neither mutates filesystem state.

**Run helpers from the target repo root.** Running the helper from the
installed runbook directory, a home directory, or a different checkout can
validate the same ledger against the wrong git repository, surfacing false
commit-reachability and repo-relative path failures. Change directory to the
target repo root before invoking any helper command in this runbook.

Digest recomputation is required whenever ledger acceptance criteria, batch
contract, or candidate batch contract content changes. The orchestrator
overwrites the digest fields after recomputation; agents must never edit them
by hand. The `--validate-ledger-batches`, `--validate-ac-coverage`,
`--validate-findings`, and `--assert-no-open-p0p1` invocations are also pure
checks; they exit non-zero on a violation and the agent must surface the
violation as a finding or fail-stop rather than overwrite the helper output.

**Stage-transition digest recheck.** Before every stage
transition after Stage 3, recompute the current `plan_digest`,
`batch_contract_digest`, and `ac_digest` values via `--plan-digest`,
`--batch-contract-digest`, and `--ac-digest`, and compare them with the
stored frontmatter values. If any digest command exits non-zero, any stored
digest is null while `## Batches` is populated, or any current digest
differs from its stored value, fail-stop and return to Stage 3 confirmation
before Builder or ship work continues. For the recovery sequence once that
fail-stop fires, this recheck is the *what*; the symptom-first CLI evidence
recipe that proves which digest drifted and walks the recompute-and-re-confirm
steps is [first-run-gotchas.md](first-run-gotchas.md) recipe 2.3
(`blocked-digests-stale`).

**Immutable batch contract fields covered by `batch_contract_digest`.** The
digest is recomputed over the confirmed candidate batch contract. Query
`cli.ts contract candidate_batch_fields --json` for digest-covered fields.
Runtime lifecycle fields from
`cli.ts contract ledger_batch_lifecycle_fields --json` are mutated by Stage 4
and are **not** part of the digest.

## Ledger schema overview

Per-issue ledger paths follow `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`
in the target repo. Frontmatter declares run-level state. Body sections in
order:

1. `# Issue {issue_number} - {issue_title}` heading and prose pointer back to
   this workflow runbook and the README.
2. `## Acceptance criteria` — confirmed AC list, numbered 1-based.
3. `## Batches` — YAML batches contract validated by
   `decompose.ts --validate-ledger-batches` and indexed by
   `--validate-ac-coverage`.
4. `## Findings data` — authoritative YAML store for Validator and final-review
   findings; consumed by `decompose.ts --validate-findings`.
5. `## Findings` — rendered table mirroring `## Findings data`.
6. `## Notes` — non-authoritative evidence log.
7. `## Workflow Learnings` — required section carrying **what this run
   observed** about the Issue-to-PR workflow itself. Validated by
   `decompose.ts --validate-workflow-learnings`. Each entry is a per-run
   reference into the cross-run registry at
   [`workflow-learnings-registry.md`](workflow-learnings-registry.md);
   the ledger records run-scoped evidence and the registry owns the
   canonical lifecycle and dedupe layer.

Helper validation rejects any drift between `## Findings data` and `## Findings`.
Frontmatter digest fields (`plan_digest`, `ac_digest`, `batch_contract_digest`)
are recomputed via `decompose.ts --plan-digest`, `--ac-digest`, and
`--batch-contract-digest`.

### Runtime-owned schema facts

Ledger field-set and finite enum membership live in runtime code and are
discoverable through `cli.ts contract <slice> --json`.

Ledger schema slices:

- `cli.ts contract candidate_batch_fields --json`
- `cli.ts contract ledger_batch_lifecycle_fields --json`
- `cli.ts contract builder_attempt_fields --json`
- `cli.ts contract orchestrator_inline_attempt_fields --json`
- `cli.ts contract finding_fields --json`
- `cli.ts contract builder_attempt_types --json`

Related existing slices:

- `cli.ts contract execution_modes --json`
- `cli.ts contract batch_statuses --json`
- `cli.ts contract builder_attempt_statuses --json`
- `cli.ts contract finding_severities --json`
- `cli.ts contract finding_statuses --json`
- `cli.ts contract final_verdicts --json`
- `cli.ts contract confirmation_states --json`

Ledger scaffold surfaces:

- Empty batches: `cli.ts scaffold ledger-empty-batches --json`
<!-- scaffold-pointer id=ledger-empty-batches source="cli.ts scaffold ledger-empty-batches --json" -->

- Lifecycle defaults: `cli.ts scaffold ledger-batch-lifecycle-defaults --json`
<!-- scaffold-pointer id=ledger-batch-lifecycle-defaults source="cli.ts scaffold ledger-batch-lifecycle-defaults --json" -->

- Empty findings data: `cli.ts scaffold ledger-empty-findings-data --json`
<!-- scaffold-pointer id=ledger-empty-findings-data source="cli.ts scaffold ledger-empty-findings-data --json" -->

- Finding row: `cli.ts scaffold ledger-finding-row --json`
<!-- scaffold-pointer id=ledger-finding-row source="cli.ts scaffold ledger-finding-row --json" -->

- Notes checkpoint: `cli.ts scaffold notes-implementation-attempt-checkpoint --json`
<!-- scaffold-pointer id=notes-implementation-attempt-checkpoint source="cli.ts scaffold notes-implementation-attempt-checkpoint --json" -->

- Notes Validator wave: `cli.ts scaffold notes-validator-wave-completed --json`
<!-- scaffold-pointer id=notes-validator-wave-completed source="cli.ts scaffold notes-validator-wave-completed --json" -->

- Notes version-skew continuation: `cli.ts scaffold notes-runbook-version-skew-continuation --json`
<!-- scaffold-pointer id=notes-runbook-version-skew-continuation source="cli.ts scaffold notes-runbook-version-skew-continuation --json" -->

- Empty workflow learnings: `cli.ts scaffold workflow-learnings-empty --json`
<!-- scaffold-pointer id=workflow-learnings-empty source="cli.ts scaffold workflow-learnings-empty --json" -->

### Frontmatter fields

Required fields (set at Stage 1 unless noted):

- `issue_number`, `issue_title`, `issue_url`, `target_repo`.
- `started_at` (ISO 8601 with timezone).
- `status`: one of `in-progress`, `blocked`, `shipped`. `blocked_reason` is
  set alongside `status: blocked` (allowed values include
  `host-builder-tools-unavailable`, `builder-infrastructure-failure`,
  `no-eligible-batch`, `ce-plan-no-output`, `no-implementation-units`,
  `decompose-parse-error`, `cyclic-dag`, `contract-review-cycle-cap`,
  `final-review-needs-replan`, and the `local-check-failure-*` family from
  Stage 6).
- `ac_source`, `ac_confirmation_status` (`pending | confirmed | stale | blocked`),
  `ac_confirmed_at`.
- `batch_contract_confirmation_status` (`pending | confirmed | stale | blocked`),
  `batch_contract_confirmed_at`.
- `plan_path` (set at Stage 2). Digests are set at the stage that produces
  their source content: `ac_digest` at Stage 1 (the AC confirmation
  checkpoint anchors the derived `acceptance_criteria` confirmation state to
  this digest), `plan_digest` at Stage 2, and `batch_contract_digest` at
  Stage 3 confirmation.
- `final_reviewed_at` (set at Stage 5 final-review checkpoint).
- `ship_mode`: `standard` (default) or `smoke-direct`.
- `pr_url` (set at Stage 6).

### `## Batches` entry fields

Candidate batch field membership is
`cli.ts contract candidate_batch_fields --json`. `files` are non-empty
repo-relative paths. `depends_on` may be `[]`. `supersedes` is audit metadata
for replacement batches; it never satisfies dependencies. `execution_mode`
membership is `cli.ts contract execution_modes --json`. `acceptance_tests`
is non-empty; `ac_mapping` is non-empty unless this is a `patch-*` batch.
`rationale` is required when execution-mode and path combinations need an
explicit exception prefix.

Lifecycle field membership is
`cli.ts contract ledger_batch_lifecycle_fields --json`. `status` membership
is `cli.ts contract batch_statuses --json`. Stage 4 mutates lifecycle fields
at runtime. `iterations` counts well-formed Builder attempts plus committed
Orchestrator-inline attempts seen so far. Builder infrastructure failures are
outside both attempt lanes and outside the iteration cap. `builder_commits`
records commit SHAs from successful Builder attempts on this batch.

`builder_attempts` are compact records, one per well-formed Builder envelope.
Field membership is `cli.ts contract builder_attempt_fields --json`;
`attempt_type` membership is `cli.ts contract builder_attempt_types --json`;
`status` membership is `cli.ts contract builder_attempt_statuses --json`.
`blockers` and `probe_results` are YAML lists of compact strings (`[]` when
empty); `notes` is a single string. Rich envelope evidence is **not**
persisted here; it lives in Notes or is passed to Validators.

`orchestrator_inline_attempts` are compact records, one per committed
Orchestrator-inline `change_first` attempt. Field membership is
`cli.ts contract orchestrator_inline_attempt_fields --json`. Inline rows are
committed-only evidence: if a dispatch trigger appears before the inline
implementation commit, append no inline row and route the work to Builder
dispatch. Inline commits are found through this lane, not through
`builder_commits`. Every batch row a `"3"` runtime emits carries this field,
so a field-lacking row originates from a pre-`"3"` runtime. The
runbook-version skew gate protects such legacy ledgers from being silently
reinterpreted under the inline-lane meaning.

`final_verdict` records the terminal Stage 4 outcome; membership is
`cli.ts contract final_verdicts --json`.

### `## Notes` implementation evidence

Stage 4 records two structured Notes rows around every committed
implementation attempt before a current-version batch may be terminal:

- `implementation_attempt_checkpoint` is ledger-only evidence written before
  Validator packet rendering.
- `validator_wave_completed` is durable evidence written after the full
  Validator wave.

Scaffolds:

- `cli.ts scaffold notes-implementation-attempt-checkpoint --json`
<!-- scaffold-pointer id=notes-implementation-attempt-checkpoint source="cli.ts scaffold notes-implementation-attempt-checkpoint --json" -->

- `cli.ts scaffold notes-validator-wave-completed --json`
<!-- scaffold-pointer id=notes-validator-wave-completed source="cli.ts scaffold notes-validator-wave-completed --json" -->

Both rows MUST cite a single resolved commit ref for `implementation_commit`
and (for `validator_wave_completed`) for the `target_id` `<commit>` slot — not
a range. The Validator packet's `commit_ref_or_range` field may carry a range
for the Builder reduced-wave case, but the durable evidence rows always pin
the one terminal commit each attempt produced, and the helper resolves and
compares them as full SHAs.

`findings: []` is the required clean-wave proof. The helper validates
current-version terminal batches against these Notes rows so a converged or
accepted-risk batch cannot silently skip Validator evidence after a committed
Builder or Orchestrator-inline attempt.

### `## Findings data` field requirements

Each finding row is YAML. Field membership is
`cli.ts contract finding_fields --json`. Constraints:

- `id` is unique within the ledger.
- `batch_id` must be one of `stage-3`, `final`, or a confirmed batch id from
  `## Batches`.
- `signature` is a stable kebab-case dedupe key; the same finding from
  multiple personas shares one signature.
- `severity` membership is `cli.ts contract finding_severities --json` (from
  the persona's own rubric; the runbook does not re-rank).
- finite `status` membership is `cli.ts contract finding_statuses --json`.
  Parameterized `ADR-contradicts-<id>` handling lives in
  [findings-and-validators.md](findings-and-validators.md).
- `summary` text is verbatim what the rendered `## Findings` table will show
  (helper validation enforces no drift).
- `resolution` matches the status per the allowed status/resolution pairs in
  [findings-and-validators.md](findings-and-validators.md#closing-a-finding-without-fixing-it).

### Dedupe and canonical-finding rule

A finding group is identified by `batch_id + signature`. The canonical row is
the row with the highest severity; on a tie, the first row in stable
normalized order (selected persona dispatch order, preserving each persona's
finding order) wins. Non-canonical rows in the group are
`status: superseded` with `resolution: superseded-by-<canonical-id>`. The
referenced canonical id must exist in the ledger, be the non-superseded row
of the same `batch_id + signature` group, have equal-or-higher severity, and
must not be itself.

### `## Workflow Learnings` entry fields

The per-issue ledger records **what this run observed** about the workflow
itself. The cross-run registry at
[`workflow-learnings-registry.md`](workflow-learnings-registry.md) owns
canonical lifecycle metadata and dedupe; the ledger never duplicates the
registry's canonical or lifecycle fields. Each ledger entry is a per-run
evidence reference plus a `signature` cross-reference into the registry.

Runtime validation owns the required run-scoped evidence keys, optional keys,
and closed-key whitelist for ledger entries. Canonical and lifecycle fields
(`summary`, `owner`, `retirement_condition`, `disposition`, `status`,
`confidence`, `follow_up`) are registry-only and must never appear in a ledger
entry. The valid empty case is `workflow_learnings: []`: a run with no observed
workflow learnings is the common path and must not block.

Empty-state scaffold: `cli.ts scaffold workflow-learnings-empty --json`.

<!-- scaffold-pointer id=workflow-learnings-empty source="cli.ts scaffold workflow-learnings-empty --json" -->

## Acceptance criteria and batches contract

`## Acceptance criteria` lists each AC verbatim from the source issue, numbered
1-based. The list is confirmed by the user at Stage 1 and is read-only after
confirmation; changes after confirmation route through helper validation and
re-confirmation.

`## Batches` is a fenced YAML block (no XML-style wrapping) with one entry per
batch. Candidate and lifecycle field membership is runtime-owned; query
`cli.ts contract candidate_batch_fields --json` and
`cli.ts contract ledger_batch_lifecycle_fields --json`.

The acceptance criteria list and batches block jointly drive
`decompose.ts --validate-ac-coverage`: every AC index must appear in at least
one batch's `ac_mapping`. Investigation placeholders use
`rationale: "out-of-scope: investigation-required"` and are surfaced as a
Stage 3 user gate.

## Turn protocol

At the start of every turn:

1. Re-read the v2 hot router at
   `~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md`.
2. Re-read the per-issue ledger.
3. Run `cli.ts state <ledger-path> --json` and route from the returned
   `route_id` + `blocking_gates` + `confirmation_state` fields. This is
   the first non-read operation of every resumed turn — never infer
   route from memory.
4. Walk one stage step (or one inner-loop iteration during `batch-loop`).
5. Commit the ledger lifecycle checkpoint or implementation attempt commit
   appropriate to the step.
6. Echo the ledger frontmatter + batches YAML + findings data + findings
   table inline at the end of the turn so the `/goal` evaluator can verify
   convergence from the transcript.

Each turn does **one thing visible**. The canonical list of legal visible
actions lives in `skills/issue-to-pr/SKILL.md` orchestration step 8; helpers
in this reference must not restate it (one canonical owner per policy).
**Never do two stages in one turn.**

## Route ids (v2 `cli.ts`)

The v2 CLI front door at `runbooks/issue-to-pr-v2/cli.ts` (U4) emits a
**route id** with every `state --json` and `next --json` response. Route
ids are **facts** about where the workflow currently sits, not imperative
instructions — ADR 0002. The hot router (U7) consumes a route id and
decides what to do next; the CLI never says "run X" or "execute Y".

Runtime owners:

- Route catalog and precedence: `ROUTE_IDS`, `BLOCKED_ROUTE_IDS`, and
  `classifyRoute` in `runbooks/issue-to-pr-v2/lib/route.ts`.
- Full route catalog: `cli.ts contract route_ids --json`.
- Route/reference map: `cli.ts contract route_required_references --json`.
- Per-route references for current turn: `data.required_reference_ids`.

### Blocked route ids

Blocked route semantics live in `classifyRoute` and `blockingGatesFor`.
Use `data.blocking_gates` and sibling state fields for the proximate
cause. For symptom-first recovery recipes (exact command, JSON fields,
what they prove, recovery action), see
[first-run-gotchas.md](first-run-gotchas.md).

## Runbook version skew (U6)

The v2 helper at `lib/contract.ts` exports the workflow-contract version
as a plain string (`RUNBOOK_VERSION`). The per-issue ledger frontmatter
declares the version the ledger was authored against in the
`runbook_version` field; the v2 helper compares the two strings
verbatim — no semver coercion, no integer parsing. A bumped
`RUNBOOK_VERSION` is a deliberate contract change that requires either a
matching ledger frontmatter update or an operator-authored continuation
evidence row in `## Notes`.

`readLedgerSnapshot` in `lib/ledger.ts` classifies the skew into one of
four states:

| Skew state | When |
| --- | --- |
| `matched` | Frontmatter `runbook_version` equals `RUNBOOK_VERSION`. |
| `missing` | Frontmatter has no `runbook_version` field (legacy ledger). |
| `mismatched` | Frontmatter has a value but it does NOT equal `RUNBOOK_VERSION` (a prior contract such as `"2"` authored before the inline-attempt lane, legacy v0, future v4, or a typo). Since the live version is `"3"`, every ledger created before that bump classifies here. |
| `continuation-evidence-present` | Skew detected (missing or mismatched) BUT a complete continuation evidence row exists in `## Notes` for the current runtime version. |

When the skew is `missing` or `mismatched` and no continuation evidence
applies, `classifyRoute` returns `blocked-runbook-version-skew` and
`blockingGatesFor` adds a `{kind: "field", field:
"frontmatter.runbook_version", value: "missing" | "mismatched"}` field
gate (the U7 prose calls this the "version-skew-stop-required" event)
so the hot router can fail closed before dispatching any packet
rendered against a contract the runbook no longer honors.

### Continuation evidence shape (U6)

Operators record continuation evidence in `## Notes` using a fenced YAML
block prefixed by an HTML comment marker. Scaffold:
`cli.ts scaffold notes-runbook-version-skew-continuation --json`.

<!-- scaffold-pointer id=notes-runbook-version-skew-continuation source="cli.ts scaffold notes-runbook-version-skew-continuation --json" -->

Every scaffold field is required; a missing field disqualifies the row and the
snapshot reports the underlying `missing` or `mismatched` skew.

The parser additionally requires that `ledger_version` matches the
actual ledger frontmatter value (or both are null) AND that
`runtime_version` matches the current `RUNBOOK_VERSION`. Evidence for a
different runtime version cannot be carried forward across a later
version bump; the operator must record a fresh row.

The first complete evidence row wins; later rows are ignored. The CLI
is read-only per ADR 0002 — the operator and orchestrator are
responsible for authoring this row through normal ledger editing.

## See also

- [host-adapters.md](host-adapters.md) for the host-readiness boundary that
  gates every Stage 4 implementation attempt and the
  `--confirmation-state` interpretation rules during resumed runs.
- [findings-and-validators.md](findings-and-validators.md) for ledger findings
  shape and helper validation of `## Findings data`.
- [stage-3-decompose.md](stage-3-decompose.md) for the batches contract author
  flow.
- [first-run-gotchas.md](first-run-gotchas.md) for symptom-first CLI evidence
  recipes covering digest-timing confusion and blocked-state recovery.
