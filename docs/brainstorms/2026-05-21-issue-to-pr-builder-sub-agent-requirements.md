---
title: "Issue-to-PR Builder sub-agent dispatch (cross-harness)"
type: requirements
status: draft
date: 2026-05-21
origin:
  - https://github.com/nathanvale/side-quest-engineering/pull/35
  - /Users/nathanvale/Library/Messages/Attachments/45/05/2D9408CF-A331-424D-9B8A-9405701BC92E/builder-agent-comprehensive-guide.md
related:
  - runbooks/issue-to-pr/README.md
  - runbooks/issue-to-pr/issue-to-pr.md
  - runbooks/issue-to-pr/decompose.ts
  - runbooks/issue-to-pr/issue-N-ledger.template.md
---

# Issue-to-PR Builder sub-agent dispatch (cross-harness)

## Problem frame

The `issue-to-pr` runbook today treats **Builder** as a role played by the
Orchestrator itself. When a batch lands, Claude-the-Orchestrator does the
reading, editing, command execution, commit creation, and ledger updates.
Validator personas, by contrast, are already dispatched as sub-agents.

The asymmetry has a concrete cost: every file Builder reads, every ledger
section it edits, and every Validator envelope it inspects accumulates in the
Orchestrator's context window. Over a six-batch run (issue #23), this produced
visible bleed: by stage 4 the Orchestrator had loaded many batch files, the
ledger multiple times, the plan multiple times, and several Validator returns.
Builder work should be self-contained per attempt, not spread across the whole
run.

The fix is two-part:

1. Add a Stage 3 **Contract Review** gate so plan/DAG drift is caught before
   candidate batches become ledger law.
2. Mirror the Validator pattern on the Builder side: dispatch a fresh Builder
   sub-agent per attempt, accept a structured envelope back, and keep
   implementation context out of the Orchestrator.

The runbook is harness-portable. Builder dispatch must work on both Claude
Code and Codex, the same way Validator dispatch already does. The runbook must
define the contract without baking in host-specific agent/tool vocabulary.

## Product boundary

This requirements pass is scoped to the `issue-to-pr` runbook.

It is not a generic agent-spawning framework, a generic Builder-agent product,
or a new planning-review framework. The staff-engineer Builder guide is source
material for this workflow, not a document to import wholesale.

The v1 Builder is a **bounded batch implementation mechanic**:

- It implements one confirmed batch attempt.
- It finds and uses existing seams.
- It makes the smallest coherent diff.
- It follows the confirmed `execution_mode`.
- It runs behaviour-focused checks/proofs where appropriate.
- It returns evidence for Validators.
- It fail-stops instead of guessing when readiness, scope, ownership,
  architecture, public contract, or domain language is unclear.

The Builder does not act as Planner, Orchestrator, Contract Reviewer, Validator
persona, Architect, product owner, or final judge of correctness.

V1 must preserve a compact common-case operator path: dispatch Builder for the
confirmed batch, receive one committed envelope, validate the commit, run
Validator personas, and advance. Advanced routing for fail-stops, replacement
batches, support-role hints, or host/tool problems should surface only when
those conditions are actually hit.

### V1 scope decision

Stage 3 Contract Review remains part of the same v1 delivery as Builder
dispatch.

Builder dispatch intentionally narrows Builder's Work Packet to one confirmed
batch and excludes the full plan, full ledger, raw Validator envelopes, and
other batches' state. Because of that narrow boundary, plan-wide and DAG-wide
drift must be caught before the batch contract becomes ledger law, not pushed
down into Builder Preflight. Contract Review owns the plan/DAG boundary;
Builder Preflight owns residual readiness and scoped implementation risk.

## Resolved language

- **Builder dispatch contract**: runbook-owned prompt shape, required tools,
  preflight rules, authority boundary, and return envelope. It is not a
  durable named `issue-to-pr-builder` capability in v1; each host maps the
  contract to its own agent primitive.
- **Builder Work Packet**: the per-attempt payload the Orchestrator passes to
  Builder under the Builder dispatch contract.
- **Builder Preflight Checklist**: Builder's required read-only readiness and
  deterministic-probe step before edits.
- **Contract Review**: Stage 3 review of the authored plan file plus parsed
  candidate DAG before the batch contract is written to the ledger.
- **Escalated Contract Review**: a higher-rigor Contract Review path for
  deterministic risk triggers.
- **Builder attempt**: one Builder sub-agent dispatch that returns a
  well-formed Builder envelope, whether it commits or Builder-authored
  fail-stops. Every Builder attempt appends one compact `builder_attempts`
  record and increments the batch iteration counter.
- **Host Builder readiness failure**: an Orchestrator-owned block before
  Builder exists because the host cannot provide the required fresh sub-agent
  capabilities. It is recorded as `host-builder-tools-unavailable`.
- **Builder infrastructure failure**: a post-dispatch host, tool, permission,
  dispatch, serialization, or schema failure before a well-formed Builder
  envelope exists. Infrastructure failures block the workflow outside the
  batch iteration cap and are not persisted as `builder_attempts`.
- **Implementation attempt**: the first Builder attempt for a batch, aimed at
  satisfying the confirmed batch goal.
- **Repair attempt**: a later Builder attempt aimed at closing exactly one
  open P0/P1 finding signature.
- **Mechanic Discipline**: the Builder-specific behaviour rules that keep
  implementation local, reviewable, and non-architectural.
- **Route hint**: a non-authoritative next-owner hint in fail-stop envelopes.
  Status remains the workflow transition; `route_hint` says who should handle
  the next decision.

Do not introduce "Ralph Gate" as Issue-to-PR vocabulary. The existing
P0/P1-gated Validator persona loop already owns that concept.

## Scope

### In scope

- Builder sub-agent dispatch contract, expressed without host-specific
  primitive names.
- Builder Work Packet shape.
- Builder authority boundary derived from the confirmed batch contract.
- Builder Preflight Checklist with:
  - readiness check, and
  - deterministic probe catalog.
- "No readiness, no build" rule as part of preflight.
- Mechanic Discipline:
  - find an existing seam,
  - make the smallest coherent diff,
  - avoid opportunistic cleanup,
  - avoid speculative abstractions,
  - avoid generic helper dumping grounds,
  - avoid dependency changes unless explicitly scoped,
  - preserve local domain/system language,
  - report uncertainty instead of hiding it.
- Local Law Read Order for target repo/package governance documents.
- Public Contract Rule: public contract changes only when explicitly named in
  the confirmed batch contract and covered by checks/proofs.
- Domain Language Rule: preserve existing language and use provisional wording
  only when a term is not yet owned.
- Enriched Builder return envelope.
- Compact persisted `builder_attempts` records in the ledger.
- Rich Builder evidence passed to Validator personas without dumping the full
  report into the ledger.
- `attempt_type: implementation | repair`.
- `route_hint` values for blocked routing.
- `suggested_validator_focus` as a required array, empty allowed.
- `implementation_steps` as Builder evidence.
- Stage 3 Contract Review before batch confirmation.
- Machine-readable Stage 3 findings using `batch_id: stage-3`, closed by
  `resolution: plan-revision <sha>` once the plan/DAG revision lands.
- Preflight fail-stop state transition: well-formed preflight fail-stops
  record the Builder attempt and block the current batch with
  `final_verdict: blocked-for-user`; replacement batch mechanics are handled by
  the later `supersedes` flow.
- A one-way `supersedes` batch field for replacement batches created after a
  blocked batch exposes a stale or unsafe contract.
- Iteration-counter semantics: Builder attempts count toward the 5-cap;
  Builder infrastructure failures block outside the batch cap.
- Runbook prose updates to:
  - `## Role boundaries`,
  - `### Stage 3: decompose`,
  - `### Stage 4: batch-loop`,
  - `## Inner loop`,
  - `## Escape hatches`,
  - Builder/Validator prompt handoff text.
- Helper/schema updates in `decompose.ts`.
- Ledger template updates.

### Deferred for later

- Separate Surgeon actor/schema. V1 keeps Builder as the actor and uses
  `attempt_type: repair` for Surgeon-like discipline.
- Full contracts for Context Scout, Architect, Test Scout, Fixture Builder,
  or other support roles. V1 only uses these as `route_hint` values.
- Generic Builder-agent artifact outside Issue-to-PR.
- Builder persistence across iterations. V1 is fresh-per-attempt.
- Mid-batch telemetry such as file-read counts, edit attempts, duration, or
  command counts beyond compact `builder_attempts`.
- TODO/self-check prompt details. These can be included in executable Builder
  prompt wording without becoming requirements-doc schema.
- Dedicated helper command for preflight probes. V1 may specify probes in
  runbook prose unless repeated friction proves a helper is needed.

### Outside this product's identity

- Generic agent-spawning framework.
- Codex-specific or Claude-specific tool wiring instructions.
- Generic planning-review framework.
- A durable "Ralph Gate" term.
- A reusable staff-engineer Builder-agent guide before Issue-to-PR proves the
  contract in real runs.

## Actors

- **A1: Orchestrator.** Walks the six Issue-to-PR stages. Owns the ledger.
  Dispatches Contract Reviewer, Builder, and Validator personas. Does not
  read or edit batch implementation files during stage 4.
- **A2: Contract Reviewer.** Read-only Stage 3 reviewer. Reviews the authored
  plan and parsed candidate DAG before batches are written to the ledger.
  Returns the same finding envelope shape as Validator personas.
- **A3: Builder sub-agent.** Fresh per attempt. Receives one Builder Work
  Packet, runs preflight, reads authorized files, performs at most one commit,
  and returns one envelope.
- **A4: Validator personas.** Read-only reviewers. They receive the batch
  contract, diff, relevant findings, and rich Builder evidence. They do not
  fix, choose modes, or re-rank severity.
- **A5: User.** Gates AC confirmation, DAG/mode confirmation, escape-hatch
  decisions, accepted-risk decisions, and replacement batch/supersedes
  decisions.

Support roles such as `architect`, `context-scout`, `test-scout`, and
`fixture-builder` are route hints only in v1. They do not become first-class
Issue-to-PR actors until separate contracts exist.

## Builder contract

### Builder identity

Builder may choose how to implement a known decision inside the confirmed batch
contract. Builder may not make the decision.

Builder may decide:

- which existing function, class, service, test, or fixture seam to extend,
- how to name local variables consistently with nearby code,
- which nearby behaviour-focused tests to add or update,
- how to preserve an existing public contract,
- how to make the smallest coherent diff within `batch.files`.

Builder must fail-stop when the missing or unsafe detail is:

- architectural,
- ownership-related,
- product-defining,
- domain-defining,
- public-contract-changing,
- security-sensitive,
- data-integrity-sensitive,
- dependency-changing,
- outside the confirmed batch scope.

### Authority boundary

The ledger remains the source of authority.

Builder may:

- edit only files listed in `batch.files`,
- create a file only when that file is already listed in `batch.files`,
- make exactly one commit when preflight passes,
- run targeted checks relevant to the batch,
- report non-authoritative scope suggestions when preflight fails.

Builder must not:

- add files outside `batch.files`,
- change acceptance criteria,
- change batch dependencies,
- relax execution mode,
- introduce new durable domain language,
- update `AGENTS.md`, `CONTEXT.md`, package maps, ADRs, or other governance
  docs unless those files are explicitly in `batch.files`,
- make public contract changes unless explicitly authorized by the batch,
- introduce dependencies unless explicitly authorized by the batch.

### Required Builder capabilities

The required Builder tool set is a host-neutral capability contract, not a
literal Claude Code or Codex tool list.

The host must be able to instantiate a fresh Builder sub-agent that can:

- read and search target-repo files,
- edit files authorized by the confirmed `batch.files` contract,
- run deterministic repo-local checks and probes,
- inspect git status and commit diffs,
- create exactly one commit for a successful attempt,
- return the structured Builder envelope.

The host must keep these capabilities outside Builder's authority:

- ledger writes,
- branch changes,
- pushes, PR creation, or GitHub calls,
- network access, secrets, or external services,
- governance edits unless the governance files are explicitly listed in
  `batch.files`.

V1 does not require every host to enforce identical per-file sandboxing.
Orchestrator must independently validate Builder's returned commit by deriving
touched files from the commit diff and checking them against `batch.files`.

If the current host cannot provide a fresh sub-agent with the required
capabilities and authority boundary for a selected eligible batch,
Orchestrator records `host-builder-tools-unavailable` before marking the batch
`in-progress` and does not fall back to Orchestrator-direct implementation.

### Local Law Read Order

Before editing, Builder reads local law in this order:

1. target repo root agent instructions, when present,
2. nearest package `AGENTS.md`, when present,
3. nearest package `CONTEXT.md`, when present,
4. package map, ADRs, runbooks, or governance docs only when referenced by
   local law or triggered by package-boundary/public-contract work,
5. every file in `batch.files`,
6. nearby tests and implementation needed to understand the existing seam.

Builder should not do whole-repo archaeology. If substantial discovery is
required, it returns a fail-stop envelope with `route_hint: "context-scout"` or
another appropriate route hint.

### Mechanic Discipline

Builder must:

- find the existing seam before editing,
- prefer modifying existing package-local code over adding new abstractions,
- keep diffs small and boring,
- avoid unrelated formatting and opportunistic cleanup,
- avoid generic `utils`, `helpers`, or `common` dumping grounds unless the
  package already uses that pattern and the batch explicitly fits it,
- add or update behaviour-focused tests when behaviour changes,
- run targeted checks when possible,
- report checks that could not be run,
- leave enough evidence for Validator personas to review meaningfully.

For high-risk batches, Builder must explicitly consider obvious failure modes
such as malformed input, partial writes, idempotency, permission failure,
rollback, data loss, privacy exposure, and contract drift. Builder does not
need to solve every possible failure mode, but it must not ignore obvious P0/P1
risks.

Builder commands and probes must be deterministic, repo-local, and
non-destructive by default. They must not use network access, environment
secrets, external services, or write outside the target repo unless that
capability is explicitly authorized by the confirmed batch contract and covered
by checks/proofs; otherwise Builder fail-stops.

### Public Contract Rule

Builder may change a public contract only when the confirmed batch contract:

- explicitly names the public surface, and
- includes acceptance tests or checks that cover the contract change.

Public contracts include exported symbols, API request/response shapes, CLI
flags/output, schemas, event payloads, config file shapes, environment variable
expectations, migration manifest formats, and package boundaries.

If a public contract change appears necessary but is not explicitly authorized,
Builder returns `status: fail-stop-out-of-scope` or `fail-stop-preflight` with
`route_hint: "contract-review"` or `route_hint: "architect"`.

### Domain Language Rule

Builder preserves existing target-repo language from `CONTEXT.md`, `AGENTS.md`,
package maps, ADRs, nearby tests, and nearby code.

If Builder needs a term that is not clearly owned, it may use provisional
language in the envelope and must not canonize it in governance docs unless
that governance edit is explicitly in `batch.files`.

If the missing term affects ownership, API, behaviour, or durable meaning,
Builder fail-stops with `route_hint: "context-scout"` or
`route_hint: "architect"`.

## Key flows

### F0: Stage 3 Contract Review

1. Stage 2 writes the authored plan file.
2. Stage 3 invokes `decompose.ts <plan-path>` to parse candidate batches.
3. Orchestrator dispatches a read-only Contract Reviewer with:
   - the plan file path/content,
   - the user-confirmed AC list,
   - the parsed candidate DAG,
   - the candidate contract digest,
   - the runbook's Contract Review rubric.
4. Default review is one Contract Reviewer.
5. Escalated Contract Review runs only when deterministic triggers fire:
   rename, identity flip, migration, public API, auth/data/privacy,
   many-file changes, or cross-package governance.
6. Contract Review returns the existing Validator envelope shape:
   `{"reviewer":"<persona>","findings":[],"residual_risks":[],"testing_gaps":[]}`.
7. P0/P1 findings block Stage 3. Orchestrator records them in
   `## Findings data` with `batch_id: stage-3`, then sends the plan back for
   revision.
8. Plan revisions close Stage 3 findings with `status: fixed` and
   `resolution: plan-revision <sha>`.
9. Contract Review always re-runs after a plan revision.
10. The Stage 3 review loop has a 5-cycle cap. Hitting the cap fail-stops and
    asks the user.
11. P2/P3 findings are surfaced in the confirmation prompt but do not block
    ledger write.

### F1: Initial implementation attempt

1. Orchestrator selects the next pending batch in topological order.
2. Before every Builder dispatch for the selected eligible batch, Orchestrator
   verifies that the current host can instantiate Builder with the required
   tool set. If not, Orchestrator records the host-level fail-stop
   `host-builder-tools-unavailable` and does not mark any batch in progress.
   This is a host Builder readiness failure, not a Builder attempt or Builder
   infrastructure failure, and it does not increment `iterations`.
3. Orchestrator marks `status: in-progress` in the ledger and commits the
   lifecycle checkpoint. This is an Orchestrator-owned ledger commit, separate
   from Builder.
4. Orchestrator dispatches a Builder sub-agent with a Builder Work Packet
   using `attempt_type: implementation`.
5. Builder runs the Builder Preflight Checklist.
6. If preflight fails, Builder returns a fail-stop envelope without editing or
   committing.
7. If preflight passes, Builder reads authorized files, implements the batch,
   makes exactly one commit, and returns the envelope.
8. Orchestrator verifies:
   - `commit_sha` exists when `status: committed`,
   - touched files are independently derived from the commit diff and
     authorized by `batch.files`,
   - the derived touched files match envelope `files_touched`,
   - any full diff content read is limited to Builder authority checks,
     envelope integrity, and lightweight correctness sanity checks,
   - any correctness sanity concern is forwarded only as transient Validator
     focus, not persisted as a ledger entry or recorded as an
     Orchestrator-authored finding or correctness gate,
   - pre-Validator gating happens only for Builder authority breaches or
     malformed envelopes,
   - the envelope is well-formed,
   - the compact attempt record can be appended to `builder_attempts`.
9. If the envelope is well-formed, Orchestrator records the attempt, appends
   the SHA to `builder_commits` for committed attempts, and increments
   `iterations`. If the envelope is malformed or cannot be validated because
   of host/tool/schema drift, Orchestrator records a Builder infrastructure
   failure outside the batch cap.
10. For committed attempts, Orchestrator dispatches Validator personas with
    rich Builder evidence. For fail-stop attempts, Orchestrator routes according
    to F5 without dispatching Validators.

### F2: Repair attempt

1. After Validator personas return open P0/P1 findings, Orchestrator
   dispatches a fresh Builder sub-agent with `attempt_type: repair`.
2. The Work Packet includes exactly one target finding signature.
3. Builder reruns preflight.
4. Builder fixes exactly one open P0/P1 finding by signature, makes one commit,
   and returns the envelope.
5. Builder must not address P2/P3 debt, opportunistic cleanup, unrelated
   refactors, or additional findings during a repair attempt.
6. If the repair requires broader scope, Builder fail-stops with an appropriate
   `route_hint`.
7. If the envelope is well-formed, Orchestrator records the attempt and
   increments `iterations`. If the envelope is malformed or cannot be
   validated because of host/tool/schema drift, Orchestrator records a Builder
   infrastructure failure outside the batch cap.
8. For committed repair attempts, Orchestrator dispatches Validator personas
   again. For fail-stop repair attempts, Orchestrator routes according to F5
   without dispatching Validators.

### F3: Builder Preflight Checklist

Preflight is required before any Builder edit. It is a bounded read-only
discovery step, not planning permission.

Preflight has two parts.

#### Readiness check

Builder verifies:

- task and attempt type are understood,
- acceptance criteria are present,
- package ownership is clear enough for this batch,
- an existing seam is found or a missing `batch.files` path can be created
  without stale-path, typo, wrong-package, or semantic-authorization risk,
- test/proof strategy is clear enough for the `execution_mode`,
- public API impact is `none` or explicitly authorized,
- domain language is existing or safely provisional,
- required fixtures/types/env are available or not needed,
- targeted checks can be run or the inability to run them is explainable.

No readiness, no build. If readiness fails, Builder returns a fail-stop
envelope.

#### Deterministic probes

Builder may run only deterministic probes from the runbook-defined probe
catalog. V1 catalog:

- **Rename path probe:** old path literal -> new path literal.
- **Identity flip probe:** old package/plugin identity literal -> new identity
  literal.
- **Command/path reference probe:** command or path literal named in goal,
  rationale, or acceptance tests.
- **Public API probe:** exported symbol or manifest surface named in the batch
  contract.
- **Package governance probe:** package map, `AGENTS.md`, `CONTEXT.md`, and
  package-knowledge references for package-boundary work.

If a probe finds relevant matches outside `batch.files`, Builder does not edit
or commit. It returns `status: fail-stop-preflight` with `blockers`,
`probe_results`, `route_hint`, and optional non-authoritative
`suggested_scope_changes`.

### F4: Builder Work Packet shape

The Orchestrator passes the Builder sub-agent:

- issue number and target repo,
- `attempt_type: implementation | repair`,
- target finding id/signature for repair attempts,
- batch contract verbatim:
  - `id`,
  - `name`,
  - `goal`,
  - `files`,
  - `depends_on`,
  - `execution_mode`,
  - `acceptance_tests`,
  - `ac_mapping`,
  - `rationale`,
  - optional `supersedes`,
- compact prior `builder_attempts` for this batch,
- current `builder_commits` for this batch,
- current iteration number,
- `## Findings data` rows for this batch only,
- Local Law Read Order,
- authority boundary,
- Mechanic Discipline,
- Builder Preflight Checklist,
- return envelope schema.

The Work Packet does not include the full plan, full ledger, raw Validator
envelopes, or other batches' state. Stage 3 Contract Review owns plan-wide
reasoning; Builder owns one confirmed batch attempt.

### F5: Builder return envelope

Builder returns a structured envelope:

```json
{
  "status": "committed | fail-stop-preflight | fail-stop-out-of-scope | fail-stop-execution-mode-mismatch | fail-stop-read-failed | fail-stop-other",
  "attempt_type": "implementation | repair",
  "target_finding_signature": "<signature for repair attempts, null otherwise>",
  "commit_sha": "<full SHA when status is committed, null otherwise>",
  "files_touched": ["<repo-relative path>", "..."],
  "route_hint": "human | contract-review | architect | context-scout | test-scout | fixture-builder | validator | other | null",
  "blockers": [
    {"path": "<repo-relative path or null>", "reason": "<why this blocks the authorized attempt>"}
  ],
  "probe_results": [
    {"probe": "<catalog probe id>", "query": "<literal searched>", "matches": 0}
  ],
  "suggested_scope_changes": [
    {"path": "<repo-relative path>", "reason": "<non-authoritative scope hint>"}
  ],
  "implementation_steps": ["<compact step>", "..."],
  "existing_seams_used": ["<symbol/module/path>", "..."],
  "tests_run": [
    {"command": "<command or runner>", "result": "passed | failed | not-run", "summary": "<short summary>"}
  ],
  "assumptions": ["<assumption>", "..."],
  "risks": ["<risk>", "..."],
  "deferred": ["<deferred item>", "..."],
  "suggested_validator_focus": ["<focus item>", "..."],
  "notes": "<one to three sentence ledger summary>"
}
```

Required array fields may be empty. `suggested_validator_focus` is required
and may be `[]`; absence is malformed.

Status owns workflow transition. `route_hint` owns next-owner routing.

Orchestrator validation on receipt:

- `committed`: verify `commit_sha` exists in git, derive touched files from the
  commit diff, compare the derived list to envelope `files_touched`, and verify
  the derived files are authorized by `batch.files`. Orchestrator may read full
  commit diff content for Builder authority checks, envelope integrity, and
  lightweight correctness sanity checks. Correctness sanity concerns may only
  annotate transient Validator focus; they are not ledger entries,
  Orchestrator-authored findings, or correctness gates. Orchestrator gates
  before Validator dispatch only when the diff shows a Builder authority breach
  or malformed envelope. A mismatch between the derived file list and envelope
  `files_touched` is treated as malformed.
- `fail-stop-preflight`: record the attempt, block the original batch, and
  repair through a replacement batch with `supersedes`.
- `fail-stop-out-of-scope`: route through the public-API/out-of-scope escape
  hatch.
- `fail-stop-execution-mode-mismatch`: route through the
  execution-mode-mismatch escape hatch.
- `fail-stop-read-failed`: surface stale batch contract or missing prior
  dependency.
- `fail-stop-other`: surface the notes, blockers, and route hint to the user.

All well-formed Builder envelopes, including Builder-authored fail-stops,
count as Builder attempts and increment `iterations`.

Malformed envelopes, missing required fields, dispatch failures,
tool-permission mismatches, host serialization failures, and schema parse
failures are Builder infrastructure failures. They do not append
`builder_attempts`, do not increment `iterations`, and do not dispatch
Validators. Orchestrator surfaces the infrastructure failure, any reachable
commit or working-tree change, and the host/schema evidence to the user before
continuing.

### F6: Compact `builder_attempts`

Every Builder attempt appends one compact attempt record to the batch's
`builder_attempts`. Builder infrastructure failures are recorded outside the
batch cap and do not append `builder_attempts`.

Persisted attempt records contain:

- `attempt_type`,
- `status`,
- `commit_sha`,
- `files_touched`,
- `route_hint`,
- `blockers`,
- `probe_results`,
- `notes`.

Committed attempts also append their SHA to `builder_commits`. Fail-stop
attempts use `commit_sha: null` and do not append to `builder_commits`.

Rich evidence fields from the envelope are passed to Validator personas and
may be summarized in ledger Notes, but are not persisted wholesale in
`builder_attempts`.

`decompose.ts` must validate:

- every non-null `builder_attempts[*].commit_sha` appears in
  `builder_commits`,
- every `builder_commits` SHA appears in exactly one committed
  `builder_attempts` item,
- `iterations` equals the number of Builder attempts for terminal batches,
- Builder-authored fail-stop attempts are counted toward the 5-cap,
- Builder infrastructure failures are not counted toward the 5-cap,
- terminal committed batches have at least one committed attempt.

### F7: Replacement batches and `supersedes`

If preflight finds relevant surfaces outside `batch.files`, the original batch
is marked:

- `status: blocked`,
- `final_verdict: blocked-for-user`.

The replacement batch:

- uses `supersedes: <blocked-batch-id>`,
- may only supersede a blocked batch,
- preserves every AC index from the superseded batch's `ac_mapping`,
- may change files, acceptance tests, and execution mode,
- must include rationale prose when changing tests or mode.

Dependency behavior after replacement:

- `supersedes` remains one-way audit metadata, not an implicit dependency
  resolver.
- Pending batches that depend on the blocked original batch must have
  `depends_on` rewritten from the original batch id to the replacement batch
  id.
- Rewriting dependent `depends_on` values mutates the confirmed batch contract,
  so Orchestrator must rerun helper validation, recompute digests, and ask the
  user to confirm the replacement DAG before Stage 4 continues.
- If any dependent of the blocked original batch is already `in-progress`,
  `converged`, or `accepted-risk`, Orchestrator must stop and ask the user
  instead of rewriting it automatically.
- If a dependent already depends on both the original and replacement, helper
  validation must reject the duplicate dependency before confirmation.

The replacement batch goes through the same confirmation and helper validation
path as any other batch.

### F8: Final-review patch proposals

When final review finds an open P0/P1 that can be fixed through a patch-batch,
Builder may produce a **candidate patch proposal** from ledger and code
evidence.

Builder does not authorize the patch contract.

The Orchestrator owns:

- helper validation,
- user confirmation,
- appending the patch batch to the ledger,
- digest recomputation,
- return to stage 4.

If patch proposal requires architecture, public-contract, ownership, domain, or
scope decisions beyond local evidence, Builder fail-stops with `route_hint`
instead of proposing a contract.

## Acceptance examples

- **AE1:** Stage 3 Contract Review runs before batch confirmation. It sees a
  rename plus identity flip and flags P1 findings for missing plan surfaces.
  Orchestrator records `batch_id: stage-3` rows, revises the plan, closes rows
  with `resolution: plan-revision <sha>`, and reruns Contract Review.
- **AE2:** Builder receives an implementation Work Packet, reads local law,
  finds an existing seam, completes readiness, runs deterministic probes,
  commits one scoped diff, and returns `status: committed` with
  `implementation_steps`, `existing_seams_used`, `tests_run`, and
  `suggested_validator_focus: []`.
- **AE3:** Builder Preflight on a rename batch finds live references outside
  `batch.files`. Builder returns `status: fail-stop-preflight`,
  `commit_sha: null`, `route_hint: "contract-review"`, blockers, probe
  results, and suggested scope changes. Orchestrator records the failed
  attempt, increments `iterations`, blocks the batch, and routes repair through
  a replacement batch with `supersedes`.
- **AE4:** A repair attempt receives one target P0 finding signature. Builder
  fixes only that finding, makes one commit, and returns evidence. Validator
  personas receive the rich Builder evidence.
- **AE5:** A Builder attempt discovers that a public API surface must change,
  but the batch contract does not name that public surface. Builder returns a
  fail-stop envelope with `route_hint: "architect"` or
  `route_hint: "contract-review"` and does not edit.
- **AE6:** A final-review P1 can be fixed by a two-file patch. Builder
  produces a candidate patch proposal, `decompose.ts --patch-proposal`
  validates it, the user confirms it, and Orchestrator appends the patch batch.
- **AE7:** Runbook works on Codex. Codex uses its available agent primitive to
  instantiate the runbook's Builder dispatch contract. The runbook does not
  name Codex's primitive directly.
- **AE8:** On a host that cannot grant the required Builder tool set,
  Orchestrator selects the eligible batch, then records an Orchestrator-owned
  `host-builder-tools-unavailable` fail-stop before marking it `in-progress`
  or dispatching Builder. There is no fallback to Orchestrator-direct Builder,
  and the batch iteration counter is not incremented.
- **AE9:** Builder dispatch reaches the host but returns a malformed envelope
  because of schema or serialization drift. Orchestrator records a Builder
  infrastructure failure, surfaces any reachable commit or working-tree change
  to the user, does not append `builder_attempts`, does not increment
  `iterations`, and does not dispatch Validators.

## Success criteria

- Orchestrator context window does not grow per batch by the size of
  implementation files, full Builder reports, raw Validator envelopes, repeated
  plan rereads, or repeated ledger rereads. Orchestrator may read full commit
  diff content for Builder authority checks, envelope integrity, and
  lightweight correctness sanity checks only. Sanity concerns may annotate
  transient Validator focus, but Validators own findings and correctness gates.
  Only compact digests/evidence needed for routing remain in Orchestrator
  context.
- Builder dispatch is identical in contract shape across Claude Code and
  Codex, even if each host maps it to a different primitive.
- Stage 3 Contract Review catches plan/DAG drift before the batch contract is
  written to the ledger.
- Builder Preflight catches residual rename/identity/path/API/governance scope
  drift before implementation commits.
- Builder acts as a bounded implementation mechanic and fail-stops on
  architecture, ownership, public contract, domain language, dependency, or
  scope decisions.
- Replacement batches use `supersedes` to preserve an audit trail from blocked
  stale contract to replacement contract.
- `iterations` increments on every well-formed Builder attempt, committed or
  Builder-authored fail-stop.
- `builder_attempts` records every well-formed Builder attempt in compact
  form.
- Builder infrastructure failures block outside the batch iteration cap and do
  not append `builder_attempts`.
- `builder_attempts` and `builder_commits` are cross-validated.
- Validator personas receive rich Builder evidence without the ledger becoming
  a transcript dump.

## Dependencies and implementation gaps

The current system evidence does not yet implement several v1 requirements.
This is expected; the requirements doc is ahead of the implementation.

### Runbook prose gaps

- `issue-to-pr.md` still describes Builder as an in-session role rather than a
  required sub-agent dispatch.
- `issue-to-pr.md` lacks Builder Work Packet wording.
- `issue-to-pr.md` lacks Local Law Read Order for Builder attempts.
- `issue-to-pr.md` lacks the enriched return envelope schema.
- `issue-to-pr.md` lacks `attempt_type`.
- `issue-to-pr.md` still says final-review patch planning is Builder-owned.
  It should say Builder may produce a bounded candidate patch proposal, while
  Orchestrator/helper/user own the patch contract.

### Ledger/template gaps

- `issue-N-ledger.template.md` lacks `builder_attempts`.
- `issue-N-ledger.template.md` lacks optional batch `supersedes`.
- The ledger prose does not yet distinguish compact persisted attempt records
  from rich Builder evidence passed to Validators.

### Helper/schema gaps

- `decompose.ts` does not allow ledger batch field `builder_attempts`.
- `decompose.ts` does not allow ledger batch field `supersedes`.
- `decompose.ts` does not validate the `builder_attempts` /
  `builder_commits` relationship.
- `decompose.ts` does not validate `iterations` against attempt count.
- `decompose.ts` does not allow `batch_id: stage-3` findings.
- `decompose.ts` does not allow Stage 3 `fixed` resolution
  `plan-revision <sha>`.
- `decompose.ts` does not validate a Builder envelope shape.

### Existing helper alignment

`decompose.ts --patch-proposal` already aligns with the accepted patch-batch
direction: it validates exactly one patch batch, terminal ledger dependencies,
file-count bounds, new-file rationale, high-risk new-file rationale, and
`ac_mapping: []`.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Builder envelope becomes too large and defeats context savings. | Persist only compact `builder_attempts`; pass rich evidence to Validators; summarize in Notes only when useful. |
| `route_hint` becomes a parallel workflow status. | Status remains workflow transition; `route_hint` is only next-owner guidance. |
| Builder invents architecture while producing patch proposals. | Patch proposals are candidate contracts only; Orchestrator/helper/user authorize. |
| Preflight probes false-positive on provenance references. | Probe hits fail-stop before edits; user/Contract Review decides whether the hit is live or provenance. |
| Generic support roles imply missing contracts. | V1 uses support roles only as `route_hint` values. |
| Rich Builder evidence drifts across hosts. | Define envelope schema in runbook; treat missing required fields as Builder infrastructure failures. |
| Iteration cap is consumed by Builder-authored fail-stops. | This is a correct signal that the batch contract is stale or unsafe. |
| Iteration cap is consumed by host/tool/schema drift. | Treat infrastructure failures outside the batch cap; block until the dispatch path or schema bridge is fixed. |
| Ledger grows noisy. | Persist compact attempts only; keep rich evidence transient. |

## Open questions

- Should a future helper validate Builder envelopes directly?
- Should Stage 3 findings get their own rendered table if `stage-3` rows make
  normal findings noisy?
- Should the preflight probe catalog become a helper command after the first
  real run?
- Should a separate Surgeon actor be promoted after v1 proves that repair
  attempts need different schema?
- Should a reusable Builder-agent guide be extracted after Issue-to-PR proves
  this contract in real runs?

## Deferred / Open Questions

### From 2026-05-21 review

- **Resolved: Builder tool set is a host-neutral capability contract** — Builder contract (P1, feasibility, security-lens, confidence 100)

  Resolved on 2026-05-21: v1 defines required Builder tools as capabilities
  rather than literal host tool names. The host must provide a fresh Builder
  sub-agent that can read/search target files, edit authorized `batch.files`,
  run deterministic repo-local checks, inspect git status/diffs, create one
  commit, and return the Builder envelope. Ledger writes, branch changes,
  pushes/PRs/GitHub calls, network/secrets/external services, and unauthorized
  governance edits remain outside Builder authority. Per-file sandboxing is
  not required in v1 because Orchestrator validates the returned commit diff
  against `batch.files`.

  <!-- dedup-key: section="builder contract" title="required builder tool set is undefined" evidence="Builder dispatch contract: runbook-owned prompt shape, required tools, preflight rules, authority boundary, and return envelope." -->

- **Resolved: replacement rewrites pending dependents** — F7: Replacement batches and `supersedes` (P1, feasibility, adversarial, confidence 100)

  Resolved on 2026-05-21: `supersedes` remains one-way audit metadata, not an
  implicit dependency resolver. Pending downstream batches that depend on the
  blocked original batch have `depends_on` rewritten to the replacement batch
  id, then helper validation, digest recomputation, and user confirmation run
  before Stage 4 continues. If a dependent is already `in-progress`,
  `converged`, or `accepted-risk`, Orchestrator stops and asks instead of
  rewriting automatically.

  <!-- dedup-key: section="f7 replacement batches and supersedes" title="replacement batches can strand dependents" evidence="The replacement batch: - uses `supersedes: <blocked-batch-id>`, - may only supersede a blocked batch," -->

- **Resolved: Stage 3 Contract Review stays bundled in v1** — Problem frame (P1, product-lens, confidence 75)

  Resolved on 2026-05-21: Stage 3 Contract Review remains part of the same v1
  delivery as Builder dispatch. Builder dispatch deliberately narrows the Work
  Packet to one confirmed batch and excludes full-plan and cross-batch state,
  so plan-wide and DAG-wide drift must be caught before candidate batches
  become ledger law. Contract Review owns the plan/DAG boundary; Builder
  Preflight owns residual readiness and scoped implementation risk.

  <!-- dedup-key: section="problem frame" title="two fixes are bundled without proving both" evidence="The asymmetry has a concrete cost: every file Builder reads, every ledger section it edits, and every Validator envelope it" -->

- **Stage 3 review assumes drift is reviewer-detectable** — F0: Stage 3 Contract Review (P2, adversarial, confidence 75)

  If Stage 3 Contract Review stays in v1, the default one-reviewer path needs a falsification standard for when one reviewer is enough. Drift outside the listed escalation categories can still pass into the ledger, especially when the issue is semantic rather than a rename, API, migration, or package-boundary signal.

  <!-- dedup-key: section="f0 stage 3 contract review" title="stage 3 review assumes drift is reviewerdetectable" evidence="Stage 3 Contract Review catches plan/DAG drift before the batch contract is written to the ledger." -->

- **Resolved: infrastructure failures do not consume batch cap** — F5: Builder return envelope (P2, adversarial, confidence 75)

  Resolved on 2026-05-21: v1 distinguishes Builder attempts from Builder
  infrastructure failures. Well-formed Builder envelopes, including
  Builder-authored fail-stops, count toward the batch cap because they are
  evidence about the confirmed batch contract. Host/tool/permission/dispatch,
  serialization, schema parse, and malformed-envelope failures block outside
  the batch cap, do not append `builder_attempts`, and do not increment
  `iterations`.

  <!-- dedup-key: section="f5 builder return envelope" title="iteration cap conflates contract failures with infrastructure drift" evidence="Iteration-counter semantics: every Builder dispatch counts toward the 5-cap." -->
