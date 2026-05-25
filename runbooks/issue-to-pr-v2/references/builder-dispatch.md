# Builder dispatch reference

**Applies To:** every `tdd` attempt, every `proof_first` attempt, every
repair attempt after an open P0/P1, every attempt on a patch-batch
(`id: patch-NNN`, which carries an open final-review P0/P1 forward and is
therefore never inline-eligible), and every `change_first` attempt after a
dispatch trigger fires. Bounded inline-eligible `change_first` attempts do
not use this contract; they run Orchestrator-inline under the same
`batch.files` authority boundary. For the inline-eligibility rule and the
full list of `change_first` dispatch triggers, see
[stage-4-batch-loop.md](stage-4-batch-loop.md#builder-dispatch-policy)
(single source of truth).

**v1 source anchors:** `runbooks/issue-to-pr/issue-to-pr.md` L13-22 (file scope),
L44-74 (role boundaries), L78-290 (Builder dispatch contract), L1093-1146
(Builder execution rules); `runbooks/issue-to-pr/README.md` L35-166
(compatibility and Builder overview).

**Read trigger:** open this reference when Stage 4 batch-loop is about to
dispatch a Builder sub-agent, when Stage 5 patch-batch flow requests a
proposal-only Builder dispatch, or when validating a Builder return envelope
against the authority boundary. See also: [stage-4-batch-loop.md](stage-4-batch-loop.md),
[host-adapters.md](host-adapters.md), [findings-and-validators.md](findings-and-validators.md).

This reference owns the prose contract for Builder. Templates in
`runbooks/issue-to-pr-v2/templates/` fill it in for a concrete dispatch; they
do not restate the rule bodies. Routing the canonical rule text through this
single reference is the ADR 0001 (Orchestration / mechanic split) line.

## File scope

This reference is active when Stage 4 selects the Builder dispatch path. The
Stage 4 batch-loop reference owns the dispatch-policy decision; this file owns
the Builder-specific Work Packet, authority boundary, preflight rules, and
return envelope.

## Role boundaries (v1 L43-65)

The role language is executable contract language:

- Planner (`/ce-plan`) proposes candidate batches, files, dependencies,
  `execution_mode`, acceptance tests, AC mapping, and rationales.
- `decompose.ts` parses the candidate plan and rejects machine-checkable drift.
- User gates confirm the AC list at Stage 1 and the DAG plus execution modes at
  Stage 3.
- The ledger stores the confirmed execution contract.
- Orchestrator owns stages, ledger writes, user gates, Builder dispatch,
  Builder envelope validation, Validator dispatch, and final workflow gates.
- Builder is dispatched as a fresh Builder sub-agent per *Builder* attempt.
  Bounded inline-eligible `change_first` attempts may run Orchestrator-inline
  under the Stage 4 dispatch policy; they are not Builder attempts and do not
  use this dispatch contract.
- Builder implements exactly one dispatched batch attempt under the confirmed
  ledger contract, or fail-stops if that contract is unsafe or stale after
  reading the files.
- Validator personas are read-only reviewers. They do not fix, choose modes,
  or re-rank severity.

## Builder Work Packet (v1 L74-104)

The Orchestrator sends Builder one batch-only Work Packet:

- issue number and target repo;
- `attempt_type: implementation | repair`;
- exactly one open P0/P1 target finding signature from committed
  `## Findings data` for repair attempts, and null otherwise;
- the confirmed batch contract verbatim: `id`, `name`, `goal`, `files`,
  `depends_on`, optional `supersedes`, `execution_mode`, `acceptance_tests`,
  `ac_mapping`, and `rationale`;
- the current iteration number, existing `builder_commits`, and compact prior
  `builder_attempts` for this batch;
- `## Findings data` rows for this batch only;
- non-authoritative Notes summaries for this batch only;
- Local Law Read Order, authority boundary, Mechanic Discipline, Builder
  Preflight Checklist, and return envelope contract.

The Work Packet must not include the full plan, full ledger, raw Validator
envelopes, unrelated batch state, or rich Builder evidence that was not
persisted in compact `builder_attempts`. When present, `supersedes` is
read-only audit context for Builder. It does not change Builder Preflight
rules, authority boundaries, or return-envelope shape.

When the batch depends on public-contract or domain-language constraints,
the Orchestrator must materialize the needed authority summary from the
confirmed batch contract or decomposition output before dispatch. Builder
must not infer that authority by reading the full plan or full ledger.

## Authority and Local Law (v1 L106-131)

The ledger remains the source of authority. Builder may edit only files listed
in `batch.files`, may create a missing path only when that path is already
listed in `batch.files`, may make exactly one commit when preflight passes,
and may run targeted repo-local checks relevant to the batch.

Builder must not change acceptance criteria, dependencies, execution mode,
durable domain language, public contracts, governance docs, or files outside
`batch.files` unless the confirmed batch contract explicitly authorizes that
change.

**Local Law Read Order.** Before editing, Builder reads:

1. target repo root agent instructions, when present;
2. nearest package `AGENTS.md`, when present;
3. nearest package `CONTEXT.md`, when present;
4. package maps, ADRs, runbooks, or governance docs only when referenced by
   local law or triggered by package-boundary/public-contract work;
5. every file in `batch.files`;
6. nearby tests and implementation needed to understand the existing seam.

Builder may perform bounded read/search beyond `batch.files` for local law,
nearby tests, deterministic probes, and equivalent literal probes named by the
batch goal, rationale, or acceptance tests. Edits remain limited to
`batch.files`. Whole-repo archaeology routes to a fail-stop.

## Mechanic Discipline (v1 L133-138)

Builder finds an existing seam before editing, makes the smallest coherent
diff, avoids opportunistic cleanup, avoids speculative abstractions, avoids
generic helper dumping grounds, avoids dependency changes unless explicitly
scoped, preserves local domain/system language, runs targeted checks where
possible, and reports uncertainty instead of hiding it.

## Public Contract Rule (v1 L139-144)

Builder may change exported symbols, API shapes, CLI flags/output, schemas,
event payloads, config shapes, environment-variable expectations, migration
manifests, or package boundaries only when the confirmed batch contract
explicitly names the public surface and includes checks/proofs for the change.

## Domain Language Rule (v1 L145-149)

Builder preserves existing target-repo language from local law, nearby tests,
and nearby code. Unowned terms may appear provisionally in the envelope only.
If missing language affects ownership, API, behaviour, or durable meaning,
Builder fail-stops.

## Builder Preflight Checklist (v1 L150-167)

Preflight is required before any Builder edit. Builder verifies that:

- task and attempt type are understood;
- acceptance criteria are present;
- package ownership is clear enough for this batch;
- an existing seam is found, or a missing listed path can be created without
  stale-path, typo, wrong-package, or semantic-authorization risk;
- test/proof strategy is clear enough for the confirmed `execution_mode`;
- public API impact is `none` or explicitly authorized;
- domain language is existing or safely provisional;
- required fixtures, types, and environment are available or not needed;
- targeted checks can be run, or the inability to run them is explainable.

No readiness, no build. If readiness fails, Builder returns a fail-stop
envelope before editing or committing.

## Probe Catalog (v1 L168-178)

Builder may run only deterministic probes from this catalog, plus equivalent
literal probes named by the batch goal, rationale, or acceptance tests:

- rename path probe: old path literal to new path literal;
- identity flip probe: old package/plugin identity literal to new identity
  literal;
- command/path reference probe: command or path literal named in the batch;
- public API probe: exported symbol or manifest surface named in the batch;
- package governance probe: package map, `AGENTS.md`, `CONTEXT.md`, and
  package-knowledge references for package-boundary work.

If a probe finds relevant matches outside `batch.files`, Builder must not
expand scope opportunistically. It returns `status: fail-stop-preflight` with
blockers, probe results, route hint, and optional non-authoritative scope
suggestions.

## Return envelope (v1 L184-213)

Builder returns one structured envelope. Status is one of `committed`,
`fail-stop-preflight`, `fail-stop-out-of-scope`,
`fail-stop-execution-mode-mismatch`, `fail-stop-read-failed`, or
`fail-stop-other`.

The envelope includes `attempt_type`, optional target finding signature,
`commit_sha`, `files_touched`, `route_hint`, `blockers`, `probe_results`,
`suggested_scope_changes`, `implementation_steps`, `existing_seams_used`,
`tests_run`, `assumptions`, `risks`, `deferred`, `suggested_validator_focus`,
and `notes`. Required array fields may be empty; missing
`suggested_validator_focus` is malformed. Status owns workflow transition;
`route_hint` is only next-owner guidance.

Well-formed Builder fail-stops count as Builder attempts in workflow language.
Every well-formed Builder envelope appends one compact ledger
`builder_attempts` record with `attempt_type`, `status`, `commit_sha`,
`files_touched`, `route_hint`, `blockers`, `probe_results`, and `notes`.
Persisted `blockers` and `probe_results` are YAML lists of compact string
summaries (`[]` when empty), not raw envelope object arrays; `notes` is a
single string. Rich evidence such as implementation steps, tests run,
assumptions, risks, deferred items, and suggested Validator focus is passed to
Validators or summarized in Notes rather than persisted wholesale.

On a well-formed `fail-stop-preflight`, do not dispatch Validators. Append the
blockers, probe results, and route hint to Notes, set the current batch
`status: blocked` and `final_verdict: blocked-for-user`, append a compact
fail-stop `builder_attempts` record with `commit_sha: null`, increment
`iterations`, and route repair through a replacement batch when the contract
is stale or unsafe.

## Builder execution rules (v1 L1056-1109)

Apply every iteration:

1. **Scope discipline.** Builder only edits files in the batch's `files` list.
   Editing outside that list triggers the `public-API-change` escape hatch (if
   the out-of-scope file is a public-API surface) OR a "stop and ask" for any
   other out-of-scope edit. Orchestrator-owned ledger lifecycle commits are
   separate from Builder commits and may touch only the per-issue ledger path.
2. **Initial implementation commit.** The first Builder commit for a pending
   batch implements the confirmed batch goal under the batch's
   `execution_mode`. Conventional commit format
   `feat(issue-{issue-number}): implement <batch-id>` (use a more accurate
   conventional type when warranted). Body lists the batch id, AC mapping, and
   acceptance checks.
3. **One finding per fix commit.** After Validator findings have been written,
   rendered, validated, and committed as a ledger-only checkpoint, each Builder
   repair commit addresses exactly one P0/P1 finding by signature. Builder must
   fix only that target signature, not additional findings, P2/P3 debt,
   opportunistic cleanup, or unrelated refactors. Conventional commit format
   `fix(issue-{issue-number}): <signature>`. Body lists the finding id and
   persona.
4. **Follow `execution_mode`.** The confirmed ledger chooses the execution
   discipline. Builder follows it or fail-stops if the contract is unsafe or
   stale after reading the files (`tdd`, `proof_first`, `change_first` with the
   guardrails declared in the v1 source).
5. **Pin behaviour first.** Where a finding is "test missing", or where
   `execution_mode` is `tdd`, Builder writes the behaviour test first (red),
   then the fix (green).
6. **Tautological-test escape hatch.** If a persona's fix recommendation would
   produce a test that only restates implementation, Builder writes a different
   test that pins observable behaviour, and notes the deviation in the commit
   body.
7. **Read before writing.** Builder reads every file in the batch's `files`
   list before the first edit.

## Replacement batches and `supersedes` (v1 L215-265)

Replacement-batch behavior is sourced from
`docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.

A replacement batch is used when Builder Preflight proves the confirmed batch
contract is stale or unsafe. The original batch remains as blocked evidence;
the replacement row uses `supersedes: <blocked-batch-id>`. `supersedes` is
one-way audit metadata, not an implicit dependency resolver.

The replacement row must supersede only a blocked batch, preserve every AC
index from the superseded batch's `ac_mapping`, include rationale prose when
`files`, `acceptance_tests`, or `execution_mode` differ from the superseded
batch, and go through helper validation, digest recomputation, and user
confirmation before Stage 4 continues. The recommended rationale prefix for
a replacement batch is `replacement-contract: <reason>` (per the v1 ledger
template recommendation).

When a replacement supersedes a blocked batch, pending downstream batches that
depend on the blocked original must have `depends_on` rewritten from the
original id to the replacement id. Because this mutates the confirmed batch
contract, the Orchestrator reruns
`decompose.ts --validate-ledger-batches <ledger-path>`, recomputes
`decompose.ts --batch-contract-digest <ledger-path>`, and asks the user to
confirm the replacement DAG before dispatching Builder again. The confirmation
prompt must show:

- the replacement batch row verbatim, including `supersedes`;
- each dependency rewrite as
  `<dependent-id>: <old depends_on> -> <new depends_on>`;
- the superseded batch id and final blocked status;
- the AC coverage check result;
- the new `batch_contract_digest`.

After user confirmation, set `batch_contract_confirmation_status: confirmed`,
set `batch_contract_confirmed_at` to the current timestamp, overwrite
`batch_contract_digest` with the new digest, run
`decompose.ts --confirmation-state <ledger-path>`, and commit the ledger
before resuming Stage 4.

If any dependent of the blocked original is already `in-progress`,
`converged`, `accepted-risk`, or `blocked`, **stop instead of rewriting
automatically**. The stop prompt must show:

- the dependent batch id and status;
- the blocked original id;
- the replacement id;
- these options: manually revise the dependent and confirm a new DAG, abandon
  the replacement and keep the original blocked, or abandon the run.

Helper validation rejects a dependent that lists both the original and the
replacement before the confirmation gate.

## Packet rendering contract

The Builder Work Packet shape above is rendered deterministically by
`renderBuilderPacket()` in
[`../lib/packets.ts`](../lib/packets.ts), invoked through the v2 CLI
front door: `runbooks/issue-to-pr-v2/cli.ts packet builder --ledger
<path> --batch <id> --attempt-type <implementation|repair>
[--target-finding-signature <sig>] --json`. The CLI returns the rendered
packet body, a structured `packet` payload that mirrors the YAML in
`templates/builder-work-packet.md`, and a `dispatch_evidence` object
(timestamp, role, target id, loaded references/templates, CLI route
id). The Orchestrator carries that evidence into ledger Notes through the
runbook's evidence-write flow; the CLI is read-only and does not mutate
ledger state.

The renderer scopes inputs to the target batch only: findings, prior
attempts, and Notes are filtered by `batch_id` before render, so the
context-leak invariant in `docs/runbooks/issue-to-pr-v2-refactor/
u5-packet-rendering.md` is enforced at the render boundary.

## See also

- [stage-4-batch-loop.md](stage-4-batch-loop.md) for the outer/inner loop that
  drives Builder dispatch.
- [host-adapters.md](host-adapters.md) for the pre-implementation readiness
  boundary and Builder infrastructure-failure classification.
- [findings-and-validators.md](findings-and-validators.md) for Validator
  invocation rules and the persona selector.
- Templates: [`templates/builder-work-packet.md`](../templates/builder-work-packet.md)
  fills this contract in for a concrete dispatch.
- [`../templates/builder-return-envelope.md`](../templates/builder-return-envelope.md)
  cross-references the canonical schema above for the Builder envelope.
