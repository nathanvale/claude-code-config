# Issue to PR (v2 hot-router support file)

Drive one GitHub issue to a PR using a per-issue ledger, Builder
attempts, and Validator gates. The v2 hot router is prose orchestration;
the mechanic is the v2 CLI front door at
`~/.claude/runbooks/issue-to-pr-v2/cli.ts` (read-only, ADR 0002). Every
routing decision is made off the CLI's emitted facts, never from
conversation memory.

**Ledger:** `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`
in the target repo. Template at
`~/.claude/runbooks/issue-to-pr-v2/issue-N-ledger.template.md`.
Frontmatter declares `runbook_version: "3"`.

The public host-neutral control plane lives at
`skills/issue-to-pr/SKILL.md`. This file remains the installed v2
hot-router support artifact and Claude Code compatibility reference.
The v2 tree owns the runnable contract.

## Core invariants

1. **Durable ledger state beats transcript memory.** `cli.ts state
   <ledger> --json` is the first non-read operation in every resumed
   turn. The hot router routes off the returned envelope.
2. **User confirms ACs before planning.** Stage 1 ends with a durable
   `ac_confirmation_status: confirmed` checkpoint; no Stage 2 work
   until the envelope shows that confirmation.
3. **User confirms batch contract before implementation work.** Stage 3
   commits the DAG to `## Batches` only after the user confirms the
   exact digest triple, AC mapping, and execution modes.
4. **Implementation edits only confirmed `batch.files`.** Stage 4 runs
   one implementation attempt per turn against one confirmed contract.
   `tdd`, `proof_first`, every repair after an open P0/P1, and every
   attempt on a patch-batch (`id: patch-NNN`, never inline-eligible)
   dispatch one Builder attempt; bounded inline-eligible `change_first`
   may instead be Orchestrator-inline under the same `batch.files`
   authority boundary. Builder's authority over `batch.files` is
   unchanged on either path.
5. **Validators own correctness findings.** The orchestrator records,
   normalizes, and routes findings; Validators (and `/ce-code-review`
   personas at Stage 5) decide whether a finding stands.
6. **Open P0/P1 blocks convergence and ship.**
   `decompose.ts --assert-no-open-p0p1` is the closure gate at both
   batch-loop convergence and final review.
7. **Stage transitions require a clean tree.** Working tree must be
   committed and clean before any state-changing transition.
8. **Stop on version skew or partial install.** The two pre-stage
   gates (`runbook_version_skew` and `installed_artifact_presence`)
   fire before any implementation, Validator, or ship work.
9. **One visible action per turn.** Advance a stage, commit one
   lifecycle checkpoint, run one implementation attempt, run one Validator
   wave, or fail-stop with a question. Never two stages in one turn.

## Reference loading

Load the matching reference when the durable route id (or stage
context) names it. The `required_reference_ids` field on every
`cli.ts state --json` envelope mirrors this table verbatim — drift is
a finding against `lib/route.ts`.

| Need | Read when | Reference |
| --- | --- | --- |
| Stage 1 details | `route_id == "pick-issue"` or `route_id == "no-ledger"` | [`references/stage-1-pick-issue.md`](references/stage-1-pick-issue.md) |
| Stage 2 details | `route_id == "plan"` | [`references/stage-2-plan.md`](references/stage-2-plan.md) |
| Stage 3 details | `route_id == "decompose"` or any `blocked-batch-contract-*` / `blocked-stage-3` / `blocked-digests-stale` | [`references/stage-3-decompose.md`](references/stage-3-decompose.md) |
| Stage 4 outer + inner loop | `route_id == "batch-loop"` | [`references/stage-4-batch-loop.md`](references/stage-4-batch-loop.md) |
| Stage 5 read-only gate | `route_id == "final-review"` | [`references/stage-5-final-review.md`](references/stage-5-final-review.md) |
| Stage 6 ship gate | `route_id == "ship"` | [`references/stage-6-ship.md`](references/stage-6-ship.md) |
| Terminal — no references required | `route_id == "shipped"` | (none — echo the final ledger and stop) |
| Builder dispatch envelope | About to dispatch a Builder packet | [`references/builder-dispatch.md`](references/builder-dispatch.md) |
| Validator persona + findings normalization | About to dispatch Validators or write `## Findings data` | [`references/findings-and-validators.md`](references/findings-and-validators.md) |
| Host-readiness gate | Before every Stage 4 implementation attempt | [`references/host-adapters.md`](references/host-adapters.md) |
| Ledger schema + helper context + `cli.ts state` shape | Any turn that writes ledger YAML; resumed runs reading durable state | [`references/ledger-and-helper.md`](references/ledger-and-helper.md) |
| ce-plan addendum body | Stage 2 only | [`templates/ce-plan-addendum.md`](templates/ce-plan-addendum.md) |
| Builder Work Packet shape | Stage 4 Builder dispatch | [`templates/builder-work-packet.md`](templates/builder-work-packet.md) |
| Validator envelope shape | Stage 4 Validator dispatch | [`templates/validator-envelope.md`](templates/validator-envelope.md) |
| Proposer envelope shape | Stage 5 finding handoff | [`templates/proposer-envelope.md`](templates/proposer-envelope.md) |
| Patch-proposal scratch schema | Stage 5 → Stage 4 patch-batch route | [`templates/patch-proposal.md`](templates/patch-proposal.md) |
| Regression invariants | Reviewing or auditing the hot router | [`references/regression-matrix.md`](references/regression-matrix.md) |

## Start every turn

Run these steps in order. Do not skip ahead even if the previous turn
"clearly" left work in some state — durable facts beat memory every
time.

1. **Re-read this hot file.** Conversation summarisation can drop
   orchestration prose; the file is the source of truth.
2. **Re-read the per-issue ledger.** If it does not exist yet,
   continue to step 3 with `<ledger-path>` set to the canonical
   `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md` path.
3. **Run `cli.ts state <ledger-path> --json`.** This is the first
   non-read operation. Capture the `data` envelope verbatim.
4. **Honour pre-stage gates** before reading the route id (see
   [Pre-stage gates](#pre-stage-gates) below). If a gate fires, stop
   and ask the operator — do not proceed.
5. **Route from `data.route_id`.** Match it against the [Router state
   enumeration](#router-state-enumeration). If the id does not appear
   there, it does not exist — fail-stop with the literal id and the
   raw envelope so the gap can be filed against `lib/route.ts`.
6. **Load the references listed in `data.required_reference_ids`.**
   The table above mirrors this list per route. Do not load
   references for routes you are not entering.
7. **Execute one visible action** per the matched stage shell below.
8. **Commit the lifecycle checkpoint** the stage requires (Stage 4
   inner-loop iterations and lifecycle checkpoints are distinct —
   see Stage 4 shell).
9. **Echo the ledger frontmatter + `## Batches` + `## Findings data`
   + `## Findings` table** inline at the end of the turn so the
   `/goal` evaluator can verify convergence from the transcript.

## Pre-stage gates

Both gates re-fire on every turn. The hot router routes off
`cli.ts state --json` even when the route id is a happy-path stage,
because `data.blocking_gates` may carry a stop-required entry that the
classifier elevates to a blocked route id.

### Version-skew gate (R11)

If `data.runbook_version_skew` is `missing` or `mismatched` (and not
`continuation-evidence-present`):

- `data.route_id` is `blocked-runbook-version-skew`.
- `data.blocking_gates` contains a
  `{kind: "field", field: "frontmatter.runbook_version", value: "missing" | "mismatched"}`
  entry.
- **Stop.** Tell the operator the ledger's `runbook_version` does not
  match the v2 `RUNBOOK_VERSION` constant and point them at
  [`references/ledger-and-helper.md`](references/ledger-and-helper.md#continuation-evidence-shape-u6)
  for the continuation evidence shape. Do not dispatch any Builder,
  Proposer, Validator, or ship work. Do not auto-rewrite the
  frontmatter version field.

### Install-presence gate

If `data.installed_artifact_presence.all_present` is `false`:

- The full shape is
  `{references: bool, templates: bool, cli_ts: bool, lib_dir: bool, all_present: bool, missing: ('references'|'templates'|'cli_ts'|'lib_dir')[]}`;
  any per-root boolean that is `false` appears in the `missing` list.
- **Stop.** Tell the operator which roots are listed in
  `data.installed_artifact_presence.missing` and ask them to re-run
  the v2 install (or to check the `~/.claude/runbooks` symlink). A
  partial install would render Builder packets without their
  templates and silently drop sections.
- **Sibling-field gate, not a `blocking_gates` entry.** The classifier
  in `lib/route.ts:classifyRoute` does NOT elevate partial install to
  a `blocked-*` route id, and `blockingGatesFor` does NOT add a
  `{kind: "field", field: "installed_artifact_presence", ...}` entry.
  Install-presence is enforced procedurally by this hot file — step 4
  of [Start every turn](#start-every-turn) honours the gate **before**
  reading `route_id`. Any future router implementation that routes
  purely off `route_id` plus `blocking_gates` would regress this
  contract; route off the sibling field as well. (F001.)

### Discriminated-union shape of `blocking_gates`

`data.blocking_gates` is a discriminated union, not a plain string
array. Each entry is one of:

- `{kind: "route_id", value: <one of the blocked-* route ids>}` —
  emitted once when `data.route_id` is itself a `blocked-*` id.
- `{kind: "field", field: <one of BLOCKING_GATE_FIELD_NAMES>, value: <string>}`
  — emitted alongside (or in addition to) the route id when a
  specific frontmatter field is the proximate cause. The
  `BLOCKING_GATE_FIELD_NAMES` tuple from `lib/route.ts` is
  `("frontmatter.status", "ac_confirmation_status",
  "batch_contract_confirmation_status", "frontmatter.runbook_version")`.

A single stop can carry both forms simultaneously (for example, an
AC-blocked state surfaces `{kind: "route_id", value:
"blocked-acceptance-criteria-stale"}` AND
`{kind: "field", field: "ac_confirmation_status", value: "blocked"}`).

Both gates take precedence over every happy-path route id. Resume only
after `cli.ts state --json` confirms `runbook_version_skew == matched`
(or `continuation-evidence-present`) AND
`installed_artifact_presence.all_present == true`.

## Router state enumeration

Every route id below maps 1:1 to a `RouteId` from `ROUTE_IDS` in
`lib/route.ts`. If the prose ever needs a route the classifier does
not emit, file a finding against the classifier; never invent a new
route in this file.

### Happy-path stage routes

| `route_id` | Meaning | Hot-router action |
| --- | --- | --- |
| `no-ledger` | Ledger file does not exist | Run [Stage 1 shell](#stage-1-shell-pick-issue) to create the ledger. |
| `pick-issue` | Ledger exists but derived AC state not yet `confirmed` (status not `confirmed`, or status `confirmed` with a null `ac_digest`). A non-null but mismatched `ac_digest` routes to `blocked-acceptance-criteria-stale`, not here. | Run [Stage 1 shell](#stage-1-shell-pick-issue) from the AC-confirmation step. |
| `plan` | AC confirmed but `plan_path` is null | Run [Stage 2 shell](#stage-2-shell-plan). |
| `decompose` | Plan present but batch contract not yet `confirmed`, or no batches written | Run [Stage 3 shell](#stage-3-shell-decompose). |
| `batch-loop` | Batch contract confirmed; not every batch terminal | Run [Stage 4 shell](#stage-4-shell-batch-loop). |
| `final-review` | All batches terminal but `final_reviewed_at` is null | Run [Stage 5 shell](#stage-5-shell-final-review). |
| `ship` | Final review complete but `pr_url` is null | Run [Stage 6 shell](#stage-6-shell-ship). |
| `shipped` | `pr_url` set and `status: shipped` | Terminal — echo the final ledger and stop. |

### Blocked-state routes (stop-and-ask)

| `route_id` | Meaning | Hot-router action |
| --- | --- | --- |
| `blocked-frontmatter-blocked-reason` | `frontmatter.status` is the literal `blocked` (explicit operator decision) | Stop. Surface `frontmatter.blocked_reason` and ask whether to unblock, abandon, or reframe. |
| `blocked-runbook-version-skew` | Pre-stage version gate fired | See [Version-skew gate](#version-skew-gate-r11). |
| `blocked-acceptance-criteria-stale` | AC digest no longer matches `## Acceptance criteria` (or `ac_confirmation_status: blocked`) | Stop. Surface the digest drift and route back to Stage 1 AC re-confirmation; do not auto-rewrite the AC list. |
| `blocked-stage-3` | Stage 3 Contract Review surfaced an open P0/P1 finding | Stop. Route back to Stage 3 plan revision; close the finding with `resolution: plan-revision <sha>` after revision lands. |
| `blocked-batch-contract-stale` | `batch_contract_digest` no longer matches `## Batches` | Stop. Route back to Stage 3 confirmation with the recomputed candidate DAG. |
| `blocked-digests-stale` | One of `plan_digest`, `ac_digest`, or `batch_contract_digest` drifted but the per-axis status was not yet flipped | Stop. Route back to Stage 3 recompute + re-confirm. |

### Stop-and-ask conditions outside the route id catalog

The following are recorded as fail-stops with named frontmatter
`blocked_reason` values (or operator-facing prompts). They are NOT
their own route ids — the route id stays the stage the workflow is
in, plus `frontmatter.status: blocked` flipping the next turn's
classification to `blocked-frontmatter-blocked-reason`.

- `host-builder-tools-unavailable` — pre-implementation host-readiness
  failure before any Stage 4 implementation attempt, including bounded
  Orchestrator-inline work; see
  [`references/host-adapters.md`](references/host-adapters.md).
- `builder-infrastructure-failure` — Builder dispatch reached the
  remote runner but the runner returned a malformed envelope or no
  envelope. Stage 4 leaves the batch `in-progress`; do not append a
  `builder_attempts` row, increment `iterations`, or dispatch Validators.
- `no-eligible-batch` — pending batches exist but their `depends_on`
  set is not satisfied; print the blocked dependencies and ask the
  user.
- `ce-plan-no-output` — `/ce-plan` reported success but no plan file
  is present after one retry.
- `no-implementation-units` — `/ce-plan` produced zero Units.
- `decompose-parse-error` — helper exited non-zero parsing the plan
  YAML.
- `cyclic-dag` — DAG validation found a cycle.
- `contract-review-cycle-cap` — Stage 3 Contract Review hit the
  five-cycle cap without convergence.
- `final-review-needs-replan` — Stage 5 finding needs more than the
  smallest-contract-patch heuristic allows.
- `local-check-failure-<check-name>` — Stage 6 local check failed;
  routed back to Stage 5 as a synthetic P0 finding.
- `local-check-failure-final-ledger-commit` — Stage 6 final ledger
  commit included a non-ledger path; routed back to Stage 5.

## Stage shells

Each shell is short by design: inputs, required reference, CLI facts
to consume, action summary, exit condition, stop conditions. The
detailed mechanics live in the referenced stage file — read the
reference, then walk the steps.

### Stage 1 shell: pick-issue

- **Inputs:** `{issue-number}`, `{target-repo}` (optional).
- **Required reference:**
  [`references/stage-1-pick-issue.md`](references/stage-1-pick-issue.md).
- **CLI facts consumed:** `cli.ts state --json` post-create returns
  `confirmation_state.acceptance_criteria: "confirmed"`,
  `confirmation_state.batch_contract: "pending"`,
  `confirmation_state.digests: "pending"`, and `route_id: "plan"`.
- **Action summary:** Read the issue, check blockers, branch
  preflight, extract + confirm AC, create ledger with
  `runbook_version: "3"`, write confirmed AC list, commit.
- **Exit condition:** Ledger exists; AC list confirmed and committed;
  feature branch in place; tree clean. Next turn's
  `cli.ts state --json` reports `route_id: "plan"`.
- **Stop conditions:** Issue closed without `reopen-for-implementation`;
  open blocker without `force-run`; user replies `abort`; ledger
  would be created or mutated on the default branch.

### Stage 2 shell: plan

- **Inputs:** Confirmed AC list in ledger.
- **Required reference:**
  [`references/stage-2-plan.md`](references/stage-2-plan.md);
  [`templates/ce-plan-addendum.md`](templates/ce-plan-addendum.md).
- **CLI facts consumed:** `cli.ts state --json` should already report
  `route_id: "plan"`. After Stage 2 commit, it advances to
  `route_id: "decompose"`.
- **Action summary:** Render the ce-plan addendum body via
  `cli.ts packet ce-plan --json`, invoke `/ce-plan` with the addendum
  appended, verify the plan file exists, record `plan_path`, rename
  the feature branch from `-pending` to `-<slug>`, commit.
- **Exit condition:** `plan_path` is set in frontmatter; plan file
  exists; branch renamed; tree clean.
- **Stop conditions:** `ce-plan-no-output` after one retry; ce-plan
  asked clarifying questions (forward to user, do not auto-answer);
  `no-implementation-units` (zero Units in the plan).

### Stage 3 shell: decompose

- **Inputs:** Plan path + confirmed AC list.
- **Required reference:**
  [`references/stage-3-decompose.md`](references/stage-3-decompose.md).
- **CLI facts consumed:** Stale or blocked routes here surface as
  `blocked-batch-contract-stale`, `blocked-digests-stale`, or
  `blocked-stage-3` from `cli.ts state --json`. Post-confirmation,
  `route_id` advances to `batch-loop`.
- **Action summary:** Parse the plan, validate the DAG and AC
  coverage, surface rationales, dispatch a read-only Contract
  Reviewer, present the candidate batch list with the digest triple,
  user confirms, persist the digest triple in frontmatter, then write
  `## Batches`.
- **Exit condition:** `## Batches` populated, every batch `status:
  pending`, every AC covered, `cli.ts state --json` reports all three
  `confirmation_state` axes `confirmed`.
- **Stop conditions:** `decompose-parse-error`, `cyclic-dag`,
  AC-uncovered, missing files / acceptance tests / execution_mode,
  Stage 3 Contract Review open P0/P1 finding (routes the workflow to
  `blocked-stage-3`), `contract-review-cycle-cap`.

### Stage 4 shell: batch-loop

- **Inputs:** Confirmed batch DAG; at least one non-terminal batch.
- **Required references:**
  [`references/stage-4-batch-loop.md`](references/stage-4-batch-loop.md),
  [`references/builder-dispatch.md`](references/builder-dispatch.md),
  [`references/host-adapters.md`](references/host-adapters.md),
  [`references/findings-and-validators.md`](references/findings-and-validators.md).
- **CLI facts consumed:** `cli.ts state --json` carries
  `route_id: "batch-loop"`. Builder, Validator, and patch-proposal
  packets are rendered via
  `cli.ts packet <role> --ledger <path> [...] --json`.
- **Action summary (one visible thing per turn):** Select the next
  eligible pending batch, run host readiness, lifecycle-checkpoint
  the batch start, run one implementation attempt (Builder dispatch or
  bounded Orchestrator-inline), run the Validator wave, normalise
  findings, then loop. Convergence is `decompose.ts
  --assert-no-open-p0p1 <ledger-path>` exiting zero with batch
  P0/P1 == 0 and `iteration < 5`.
- **Exit condition:** Every batch is `converged` or `accepted-risk`;
  `cli.ts state --json` reports `route_id: "final-review"`.
- **Stop conditions:** `host-builder-tools-unavailable` (pre-implementation),
  `builder-infrastructure-failure` (post-dispatch),
  `no-eligible-batch`, escape-hatch fire (`same-signature-twice`,
  `finding-count-rises`, `tautological-test`), iteration cap (5)
  without convergence.

### Stage 5 shell: final-review

- **Inputs:** Cumulative diff after every batch is terminal; tree
  clean.
- **Required references:**
  [`references/stage-5-final-review.md`](references/stage-5-final-review.md),
  [`references/findings-and-validators.md`](references/findings-and-validators.md),
  [`references/stage-4-batch-loop.md`](references/stage-4-batch-loop.md).
- **CLI facts consumed:** `cli.ts state --json` reports
  `all_batches_terminal: true`, `final_reviewed_at: null`,
  `route_id: "final-review"`. Proposer / patch-proposal dispatch
  packets via `cli.ts packet proposer --json` and
  `cli.ts packet patch-proposal --json`.
- **Action summary:** Pre-review host hygiene, invoke
  `/ce-code-review` over the cumulative diff (full suite by default),
  write findings to `## Findings data` with `batch_id: final`, render
  `## Findings`, run `decompose.ts --validate-findings
  <ledger-path>`, then apply the P0/P1 gate. Stage 5 itself is
  read-only — open P0/P1 routes to the [Patch-batch
  playbook](#patch-batch-playbook) which lives in Stage 4. Zero open
  P0/P1 → close P2/P3 as `deferred-P2` / `deferred-P3`, set
  `final_reviewed_at`, commit.
- **Exit condition:** `final_reviewed_at` set; every `batch_id: final`
  row terminal; tree clean; `cli.ts state --json` reports
  `route_id: "ship"`.
- **Stop conditions:** Reviewer cap failure with no fallback that
  covers correctness + testing; `final-review-needs-replan`;
  patch-batch flow itself stop-required (returns control to the
  operator).

### Stage 6 shell: ship

- **Inputs:** `final_reviewed_at` set; tree clean.
- **Required references:**
  [`references/stage-6-ship.md`](references/stage-6-ship.md),
  [`references/findings-and-validators.md`](references/findings-and-validators.md).
- **CLI facts consumed:** `cli.ts state --json` reports
  `route_id: "ship"` and empty `blocking_gates`.
- **Action summary:** Run target-repo local checks (MCP runners
  preferred, shell fallback last); on any failure route the
  `local-check-failure-<check-name>` synthetic P0 back to Stage 5.
  On all-green: invoke `/ce-commit-push-pr` (or `gh pr create` only
  in `smoke-direct` mode), record `pr_url`, append
  `## Residual Review Findings` to the PR body, set
  `frontmatter.status: shipped`, commit the final ledger update with
  an explicit ledger pathspec, assert the commit contains only the
  ledger path before pushing.
- **Exit condition:** `pr_url` set; `status: shipped`; tree clean;
  next `cli.ts state --json` reports `route_id: "shipped"`.
- **Stop conditions:** `local-check-failure-*` (routed via Stage 5,
  not Stage 6), `local-check-failure-final-ledger-commit` (final
  ledger commit included a non-ledger path), `smoke-direct` requested
  on a non-disposable repo.

## Patch-batch playbook

Stage 5 routes every open P0/P1 final-review finding through the
patch-batch decision tree owned by
[`references/stage-4-batch-loop.md`](references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree).
The orchestrator hands the cited finding row to the Proposer (via
`cli.ts packet proposer --ledger <path> --finding <id> --json`),
validates the returned candidate via
`decompose.ts <patch-proposal-path> --patch-proposal <ledger-path>`,
asks the user to confirm, then appends the validated patch-batch row
to `## Batches` with `status: pending` and returns control to Stage 4
batch-loop to converge it.

Stage 5 is read-only: the orchestrator never authors Builder edits
for a final-review finding. If the finding does not fit the
patch-batch heuristic (more than 2 files and no contract-softening
patch available), fail-stop with
`blocked_reason: final-review-needs-replan` and ask the user to
re-plan.

## Hatch names (detail lives in `findings-and-validators.md`)

- `same-signature-twice` — same `batch_id + signature` reopens after
  a `status: fixed` close.
- `finding-count-rises` — total open P0/P1 finding count increases
  iteration-over-iteration in the same batch.
- `tautological-test` — Builder's repair commit asserts the change
  rather than the behaviour.
- `contract-softening-exception` — patch-batch rationale prefix when
  the smallest fix adjusts a contract (doc/AC/comment) instead of
  implementation.
- `new-file-patch-exception` /
  `high-risk-new-file-patch-exception` — patch-batch rationale
  prefixes when the proposal introduces a new file (the latter for
  auth / payment / API / data / privacy paths).
- `change_first-exception` /
  `high-risk-change_first-exception` — Stage 3 rationale prefixes
  when a non-doc batch is `change_first`.
- `replacement-contract` — Stage 4 replacement-batch rationale when
  superseding a blocked batch.

Detailed semantics, when each hatch fires, and the closure /
escalation rules live in
[`references/findings-and-validators.md`](references/findings-and-validators.md).
The hot file names them only so a reader can spot the right
reference quickly.

## ADR pointers

- **ADR 0001 (Orchestration / mechanic split).** The hot router is
  orchestration; the CLI is the mechanic. This file must not
  re-implement classification logic that lives in
  `lib/route.ts:classifyRoute`. If a decision needs facts the CLI
  does not emit, file a finding against the CLI rather than
  inventing the decision in prose.
- **ADR 0002 (CLI emits facts, not orchestration).** The CLI says
  what is true; this file says what to do about it.
- **R-no-orchestrator-CLI.** The CLI is read-only. Every ledger
  write is the orchestrator's responsibility.
- **R3 (lib/* module split).** No new `lib/*` modules in this seam
  except narrowly-scoped emitter extensions that preserve existing
  route-record shapes verbatim.
- **R8 (deterministic from templates + ledger).** Same ledger + same
  filesystem state must yield identical `route_id`,
  `blocking_gates`, and `required_reference_ids`. No mtime / inode /
  fs-order dependencies in this prose.
- **R10 (preserve helper module boundaries).** No re-exports from
  `lib/packets.ts`, `lib/ledger.ts`, or `lib/route.ts` added here.
- **R11 (runbook_version contract).** Skew classification is the
  helper's job; this file stops on `missing` / `mismatched` without
  continuation evidence, no exceptions.

## Stop-and-ask checklist

Before stopping a turn with a question, confirm:

1. **Did you `cli.ts state` first?** A stop derived from memory
   instead of the envelope is a P0 finding against this file.
2. **Is the route id in the catalog?** If not, the question is
   "file a finding against `lib/route.ts`", not "make up a route".
3. **Did you load the references listed in
   `required_reference_ids`?** A stop without the reference loaded
   is premature.
4. **Did the ledger frontmatter change in this turn?** If yes, the
   change must be committed before the stop so the next turn
   starts from a clean tree.
5. **Did you echo the ledger frontmatter + sections + findings
   table?** The `/goal` evaluator routes off the transcript; a
   silent stop will not converge.

## /loop fallback

```text
/loop 5 Follow ~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md.
Re-read the hot router and the per-issue ledger at the start of every
turn. Run cli.ts state <ledger-path> --json before any other action.
Echo the ledger frontmatter + ## Batches + ## Findings data + ##
Findings inline at the end of every turn.
```
