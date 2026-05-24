---
name: issue-to-pr
description: Drives one GitHub issue to a PR through the host-neutral Issue-to-PR v2 ledger workflow. Use when the user says "ship issue #N", "drive issue-to-pr for #N", "open a PR for issue #N", "/issue-to-pr <N>", or asks to take a specific GitHub issue end-to-end through plan, build, validate, and ship. The skill is the control plane; deterministic facts come from the v2 CLI, repeated packets from templates, and deep stage mechanics from one-level references.
argument-hint: <issue-number> [target-repo]
user-invocable: true
disable-model-invocation: true
---

# /issue-to-pr

<objective>
Drive one GitHub issue to a PR using the Issue-to-PR v2 per-issue
ledger workflow. This skill is the host-neutral control plane: it owns
the durable orchestration loop, host adapter behavior, routing gates,
reference loading, stage shells, review loop, and success criteria.

Keep deterministic mechanics behind `runbooks/issue-to-pr-v2/cli.ts`
and `runbooks/issue-to-pr-v2/decompose.ts`. Keep repeated handoff
payloads in `runbooks/issue-to-pr-v2/templates/`. Keep deep or rare
stage detail in `runbooks/issue-to-pr-v2/references/`.
</objective>

<quick_start>

```
/issue-to-pr <issue-number> [target-repo]
```

- `<issue-number>` (required): the GitHub issue number to drive
- `[target-repo]` (optional): `owner/repo` form; defaults to the
  current repo

Use the canonical ledger path in the target repo:

```
docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md
```

On the first turn, establish `{issue-number}`, `{target-repo}`, the
target repo root, the ledger path, and `{v2-cli}`. If `{target-repo}` is
provided, resolve or open that repo before running helper commands. If
the ledger already exists, read it. Then run the v2 CLI from the target
repo root, making this the first durable-state command:

`{v2-cli}` is the host-resolved path to
`runbooks/issue-to-pr-v2/cli.ts`, such as the repo-local path in this
checkout or `~/.claude/runbooks/issue-to-pr-v2/cli.ts` in a Claude Code
install.

```
bun {v2-cli} state docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md --json
```

Route only from that command's emitted facts, not from conversation
memory.
</quick_start>

<host_adapters>

The workflow authority is this skill control plane plus the durable
ledger. Host drivers are only ways to keep the loop running.

**Codex**

- Drive the loop directly in the current thread.
- Use repo-local reads and edits from the target repo root.
- Resolve `{v2-cli}` before the first state command. In this config
  repo, the source path is `runbooks/issue-to-pr-v2/cli.ts`; in other
  target repos, prefer the installed runbook path for the active host.
- Do not depend on `/goal` or `/loop` for routing, convergence, or
  transcript evidence.

**Claude Code**

- Manual `/issue-to-pr <issue-number> [target-repo]` invocation remains
  supported.
- When an autonomous driver is useful, `/goal` may point at this skill
  control plane, the target issue, the target repo, the canonical
  ledger path, and the installed v2 assets under
  `~/.claude/runbooks/issue-to-pr-v2/`.
- `/loop` is a fixed-cadence fallback for older Claude Code harnesses.
- `/goal` and `/loop` do not own workflow policy; they re-enter this
  control plane and the ledger-driven loop.

</host_adapters>

<durable_state_contract>

Durable ledger state beats transcript memory. Every resumed turn routes
from the v2 CLI state envelope, not from what the conversation appears
to remember.

- The canonical ledger lives in the target repo at
  `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`.
- Run helper commands from the target repo root, even when `{v2-cli}`
  points to an installed path outside that repo.
- If the ledger does not exist yet, use the canonical ledger path and
  let the state envelope route to ledger creation.
- Treat `cli.ts state <ledger-path> --json` as the first non-read
  operation on every resumed turn.
- Use emitted facts such as `data.route_id`,
  `data.required_reference_ids`, `data.blocking_gates`, and sibling
  gate fields as inputs to orchestration.
- Do not restate or hand-validate the full ledger schema, route union,
  packet schema, or helper output contract in this skill. Those
  deterministic contracts belong to the CLI, helper, templates, and
  runtime code.

</durable_state_contract>

<orchestration_loop>

Start every turn in this order:

1. Re-read this skill control plane.
2. Resolve `{issue-number}`, `{target-repo}`, target repo root,
   `{ledger-path}`, and `{v2-cli}`.
3. Re-read the per-issue ledger if it exists.
4. Run `bun {v2-cli} state {ledger-path} --json` from the target repo
   root as the first non-read operation.
5. Apply pre-route gates before entering a stage.
6. Route from `data.route_id`. Unknown route IDs are findings against
   `runbooks/issue-to-pr-v2/lib/route.ts`, not invitations to invent a
   prose route.
7. Load every reference listed in `data.required_reference_ids`. Load
   action-specific templates only when preparing that packet or handoff.
8. Execute exactly one visible workflow action for the turn: advance a
   stage, commit one lifecycle checkpoint, dispatch one Builder
   attempt, run one Validator wave, converge one batch, or fail-stop
   with a specific question.
9. Commit any required lifecycle checkpoint before ending the turn when
   the stage requires durable state. The working tree must be committed
   and clean before any state-changing stage transition, not only at the
   stages whose exit conditions restate it.
10. When the host evaluator needs transcript evidence, echo the ledger
    frontmatter, `## Batches`, `## Findings data`, and `## Findings`
    table or provide an equivalent host-visible summary.

</orchestration_loop>

<pre_route_gates>

These gates re-fire on every turn after `cli.ts state --json` and
before any Builder, Validator, Proposer, or ship work.

**Runbook version skew**

- If the envelope reports `data.runbook_version_skew` as missing or
  mismatched without continuation evidence, stop.
- Surface the mismatch and load
  `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` for the
  continuation evidence shape.
- Do not auto-rewrite the ledger frontmatter version field.

**Installed artifact presence**

- If `data.installed_artifact_presence.all_present` is false, stop.
- Surface the missing installed roots and ask the operator to repair the
  v2 install or symlink before continuing.
- Treat this as a sibling-field gate. It is not necessarily represented
  as a `data.blocking_gates` entry or a blocked `route_id`, so do not
  route from those fields alone.

Both gates must clear before entering the route catalog.

</pre_route_gates>

<reference_loading_policy>

Load references one level deep from this skill. The CLI's
`data.required_reference_ids` is the turn-specific authority for files
under `runbooks/issue-to-pr-v2/references/`; each ID is a reference
filename. Templates are action-specific and are loaded only while
preparing that packet or handoff.

| Route or action need | Reference or action template |
| --- | --- |
| Stage 1 issue/ledger setup | `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md` |
| Stage 2 planning | `runbooks/issue-to-pr-v2/references/stage-2-plan.md`; `runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md` |
| Stage 3 decomposition and contract review | `runbooks/issue-to-pr-v2/references/stage-3-decompose.md` |
| Blocked Stage 3, stale AC, stale batch contract, or stale digests | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`; `runbooks/issue-to-pr-v2/references/stage-3-decompose.md` |
| Frontmatter blocked reason | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md` |
| Stage 4 batch loop | `runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md` |
| Stage 4 Builder dispatch | `runbooks/issue-to-pr-v2/references/builder-dispatch.md`; `runbooks/issue-to-pr-v2/templates/builder-work-packet.md` |
| Stage 4 Validator wave or findings write | `runbooks/issue-to-pr-v2/references/findings-and-validators.md`; `runbooks/issue-to-pr-v2/templates/validator-envelope.md` |
| Host readiness before Builder work | `runbooks/issue-to-pr-v2/references/host-adapters.md` |
| Ledger writes or helper output interpretation | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` |
| Stage 5 final review | `runbooks/issue-to-pr-v2/references/stage-5-final-review.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md` |
| Stage 5 Proposer or patch-batch handoff | `runbooks/issue-to-pr-v2/templates/proposer-envelope.md`; `runbooks/issue-to-pr-v2/templates/patch-proposal.md` |
| Stage 6 ship | `runbooks/issue-to-pr-v2/references/stage-6-ship.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md` |
| Router regression audit | `runbooks/issue-to-pr-v2/references/regression-matrix.md` |

Do not copy packet schemas, ledger schema, route field tuples, or full
hatch semantics into this skill. If a route needs a reference that
`data.required_reference_ids` does not name, file the drift against
`runbooks/issue-to-pr-v2/lib/route.ts` or the packet renderer.

</reference_loading_policy>

<route_catalog>

`runbooks/issue-to-pr-v2/lib/route.ts` is the runtime source of truth
for route IDs. This catalog is an operator-facing map for the control
plane.

**Happy path**

- `no-ledger` and `pick-issue`: enter Stage 1.
- `plan`: enter Stage 2.
- `decompose`: enter Stage 3.
- `batch-loop`: enter Stage 4.
- `final-review`: enter Stage 5.
- `ship`: enter Stage 6.
- `shipped`: terminal; echo final ledger state and stop.

**Blocked routes**

- `blocked-frontmatter-blocked-reason`: surface the recorded blocked
  reason and ask whether to unblock, abandon, or reframe.
- `blocked-runbook-version-skew`: use the version-skew gate above.
- `blocked-acceptance-criteria-stale`: return to Stage 1 AC
  re-confirmation; do not auto-rewrite ACs.
- `blocked-stage-3`: return to Stage 3 plan or contract revision.
- `blocked-batch-contract-stale` and `blocked-digests-stale`: return
  to Stage 3 recompute and user confirmation.

Unknown route IDs are blocking findings against the runtime route
contract. Do not invent prose-only routes.

</route_catalog>

<stage_shells>

Each stage shell is an entrypoint, not the full playbook. Load the
required references before taking the one visible action.

**Stage 1: issue and acceptance criteria**

- Inputs: `{issue-number}`, optional `{target-repo}`, target repo root,
  canonical ledger path.
- Required references: `stage-1-pick-issue.md`,
  `ledger-and-helper.md` when writing ledger state.
- One visible action: create or resume the ledger and get user-confirmed
  acceptance criteria.
- Exit condition: ledger exists, ACs are confirmed and committed, tree
  is clean, next state routes to `plan`.
- Stop conditions: closed or blocked issue without override, user
  abort, unsafe branch, or unresolved AC ambiguity.

**Stage 2: plan**

- Inputs: confirmed ACs and ledger path.
- Required references: `stage-2-plan.md`, `ledger-and-helper.md`,
  `ce-plan-addendum.md` when preparing the planning packet.
- One visible action: render the planning addendum, invoke planning, or
  persist the resulting `plan_path` checkpoint.
- Exit condition: `plan_path` is set, the plan exists, the feature
  branch is renamed off its `-pending` placeholder, tree is clean, next
  state routes to `decompose`.
- Stop conditions: planning asks the user a question, no plan output
  after one retry, or the plan has no implementation units.

**Stage 3: decompose and confirm batch contract**

- Inputs: plan path, confirmed ACs, ledger path.
- Required references: `stage-3-decompose.md`,
  `ledger-and-helper.md`.
- One visible action: parse/validate the candidate DAG, run contract
  review, present the digest-backed batch contract for confirmation, or
  persist the confirmed `## Batches` checkpoint.
- Exit condition: batch contract is confirmed, every batch starts
  pending, coverage and digests are confirmed, tree is clean, next state
  routes to `batch-loop`.
- Stop conditions: parse error, cyclic DAG, uncovered AC, missing batch
  contract field, open Stage 3 P0/P1, contract-review cycle cap reached
  without convergence, stale digest, or confirmation refusal.

**Stage 4: batch loop**

- Inputs: confirmed batch DAG and current findings state.
- Required references: `stage-4-batch-loop.md`,
  `builder-dispatch.md`, `host-adapters.md`,
  `findings-and-validators.md`, and `ledger-and-helper.md` for writes.
- One visible action: exactly one Stage 4 subroute below.
- Exit condition: every batch is `converged` or `accepted-risk`, no
  open P0/P1 blocks the batch loop, tree is clean, next state routes to
  `final-review`.
- Stop conditions: host readiness failure, Builder infrastructure
  failure, no eligible batch, escape hatch fire, iteration cap, or user
  decision required.

Stage 4 subroutes:

- `select-eligible-batch`: choose one pending batch whose dependencies
  are terminal; if none qualifies, fail-stop with dependency evidence.
- `start-batch-checkpoint`: after host readiness passes, record the
  selected batch lifecycle start. This is separate from Builder work.
- `builder-attempt`: render the Builder Work Packet and dispatch one
  Builder attempt. Builder edits only the confirmed `batch.files`.
- `validator-wave`: hand Validators the Builder evidence and touched
  files. Validators own correctness findings; the Orchestrator records
  and normalizes them.
- `finding-repair`: dispatch the smallest scoped repair for open
  P0/P1 findings in the active batch.
- `converge-batch`: run the no-open-P0/P1 gate and mark the batch
  terminal only when the ledger facts support convergence.
- `accepted-risk-or-reframe`: record a user-approved accepted risk or
  stop for reframe/replan when hatches or caps prevent convergence.

Only one Stage 4 subroute is the visible action for a turn. The
Orchestrator routes and records lifecycle state; Builder owns one
scoped implementation attempt; Validators own correctness findings;
Proposer only appears when Stage 5 sends a final-review finding back as
a patch-batch candidate.

**Stage 5: final review**

- Inputs: every batch terminal and a clean tree.
- Required references: `stage-5-final-review.md`,
  `findings-and-validators.md`, and `stage-4-batch-loop.md` for
  patch-batch routing.
- One visible action: run final review, record final findings, close
  non-blocking findings, or route one open P0/P1 through the
  Proposer/patch-batch handoff back to Stage 4.
- Exit condition: final findings are terminal, `final_reviewed_at` is
  set and committed, next state routes to `ship`.
- Stop conditions: reviewer coverage cannot cover correctness and
  testing, final review needs replan, or patch-batch confirmation is
  required.

**Stage 6: ship**

- Inputs: final review complete, clean tree, no open P0/P1.
- Required references: `stage-6-ship.md`,
  `findings-and-validators.md`.
- One visible action: run local checks, create/push the PR, or persist
  the final shipped ledger checkpoint.
- Exit condition: `pr_url` is set, ledger status is `shipped`, tree is
  clean, next state routes to `shipped`.
- Stop conditions: local check failure, unsafe final ledger commit,
  unsupported smoke-direct request, or PR creation failure requiring
  operator input.

</stage_shells>

<fail_stops>

When a fail-stop fires, do three things: record durable state when the
stage requires it, surface the smallest useful evidence to the user,
and name the resume condition.

| Condition | Record or surface | Resume condition |
| --- | --- | --- |
| Unknown `data.route_id` | Raw state envelope and route ID | Runtime route contract fixed or clarified |
| Runbook version skew | Ledger version evidence and `ledger-and-helper.md` pointer | State envelope reports matched or continuation evidence present |
| Partial v2 install | Missing installed roots | Install or symlink repaired and state envelope reports all present |
| Stage 1 issue or branch unsafe | Closed/blocked issue, open blocker, abort, or default-branch evidence | Override flag supplied, blocker cleared, user resumes instead of aborting, or work moves to a feature branch; see `stage-1-pick-issue.md` |
| Stale or blocked ACs | Digest drift or AC block reason | User re-confirms ACs in Stage 1 |
| Stage 3 open P0/P1 | Contract-review finding summary | Plan or batch contract revision closes the finding |
| Stage 3 contract-review cycle cap | Cap reached without convergence and last finding summary | User replans, narrows the contract, or accepts surfaced advisories; see `stage-3-decompose.md` |
| Stale batch contract or digests | Recomputed drift evidence | Stage 3 recompute and user confirmation |
| Host Builder tools unavailable | Host readiness failure | Required host tools are available |
| Builder infrastructure failure | Malformed/missing Builder envelope and side effects | User decides whether to retry, repair, or reframe |
| No eligible batch | Pending batch dependencies | Dependencies converge or user reframes the DAG |
| Escape hatch or iteration cap | Hatch name and current batch/finding evidence | User accepts risk, authorizes replacement, or replans |
| Stage 5 reviewer coverage gap | Reviewer cap with no fallback covering correctness and testing | A fallback reviewer set covers correctness and testing; see `findings-and-validators.md` |
| Final review needs replan | Finding that exceeds patch-batch scope | User replans or narrows the contract |
| Local check failure | Check name and failing summary | Synthetic P0 routes through Stage 5 and is closed |
| Unsafe final ledger commit | Non-ledger path in final ledger commit | Commit is repaired so only the ledger checkpoint is included |
| Unsupported smoke-direct request | Requested `smoke-direct` on a non-disposable repo | Target repo and checkout are disposable, or the standard ship path is used; see `stage-6-ship.md` |

Detailed hatch semantics and closure rules live in
`runbooks/issue-to-pr-v2/references/findings-and-validators.md`.

</fail_stops>

<review_loop>

Stage 4 uses a Builder/Validator convergence loop:

1. Orchestrator selects one eligible confirmed batch and records
   lifecycle state.
2. Builder receives one Work Packet, edits only confirmed
   `batch.files`, and returns evidence for that attempt.
3. Validators review the attempt and own correctness findings.
4. Orchestrator records normalized findings in the ledger.
5. Open P0/P1 findings block batch convergence.
6. Builder repair attempts continue until no open P0/P1 remains, an
   accepted-risk decision is recorded, or a fail-stop fires.

Stage 5 repeats the same P0/P1 rule over the cumulative diff. A final
review P0/P1 never becomes an Orchestrator-authored implementation fix:
route it through the Proposer and patch-batch path back into Stage 4,
or fail-stop when it needs replan.

</review_loop>

<success_criteria>

The workflow is complete only when all of these are true:

- `cli.ts state {ledger-path} --json` reports `route_id: "shipped"`.
- Ledger frontmatter has `status: shipped`.
- `pr_url` is set.
- Every batch is terminal: `converged` or `accepted-risk`.
- No open P0/P1 finding remains.
- Required local checks have passed.
- The working tree is clean.
- The final ledger echo or equivalent host-visible summary has been
  produced.

</success_criteria>
