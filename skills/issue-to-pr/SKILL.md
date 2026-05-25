---
name: issue-to-pr
description: Drive one GitHub issue to PR via host-neutral Issue-to-PR v2 ledger workflow (plan, build, validate, ship). Trigger: "ship issue #N", "drive issue-to-pr for #N", "open PR for issue #N", "/issue-to-pr <N>". Sized for code deliverables; for decision-only or doc-only issues (e.g. standalone ADR), commit + PR directly. Control plane only: deterministic facts from v2 CLI, repeated packets from templates, deep mechanics from one-level references.
argument-hint: <issue-number> [target-repo]
user-invocable: true
disable-model-invocation: true
---

# /issue-to-pr

<objective>
Drive one GitHub issue to PR via Issue-to-PR v2 per-issue ledger. This skill is the host-neutral control plane — owns: orchestration loop, host adapters, routing gates, reference loading, stage shells, review loop, success criteria.

Deterministic mechanics → `runbooks/issue-to-pr-v2/cli.ts` + `decompose.ts`. Handoff payloads → `runbooks/issue-to-pr-v2/templates/`. Deep/rare stage detail → `runbooks/issue-to-pr-v2/references/`.
</objective>

<quick_start>

```
/issue-to-pr <issue-number> [target-repo]
```

- `<issue-number>` (required): GitHub issue number to drive
- `[target-repo]` (optional): `owner/repo`; defaults to current repo

Canonical ledger path in target repo:

```
docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md
```

On first turn: establish `{issue-number}`, `{target-repo}`, target repo root, ledger path, `{v2-cli}`. If `{target-repo}` provided, resolve/open it before helper commands. If the ledger exists, read it. Then run the v2 CLI from the target repo root as the first durable-state command.

`{v2-cli}` is the host-resolved path to `runbooks/issue-to-pr-v2/cli.ts` — repo-local in this checkout, or `~/.claude/runbooks/issue-to-pr-v2/cli.ts` in a Claude Code install.

```
bun {v2-cli} state docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md --json
```

Route only from emitted facts, not conversation memory.
</quick_start>

<host_adapters>

Workflow authority = this skill control plane + durable ledger. Host drivers only keep the loop running.

**Codex**

- Drive the loop directly in the current thread.
- Repo-local reads/edits from target repo root.
- Resolve `{v2-cli}` before first state command. This config repo: `runbooks/issue-to-pr-v2/cli.ts`. Other target repos: prefer the installed runbook path for the active host.
- Do not depend on `/goal` or `/loop` for routing, convergence, or transcript evidence.

**Claude Code**

- Manual `/issue-to-pr <issue-number> [target-repo]` supported.
- For autonomous driving, `/goal` may point at: this skill control plane, target issue, target repo, canonical ledger path, installed v2 assets at `~/.claude/runbooks/issue-to-pr-v2/`.
- `/loop` is a fixed-cadence fallback for older Claude Code harnesses.
- `/goal` and `/loop` do not own workflow policy — they re-enter this control plane and the ledger-driven loop.

**Autonomous-mode policy (active `/goal`, `/loop`, or `lfg`)**

Under an autonomous driver, the loop runs hands-off and does NOT pause for discretionary checkpoints. Distinction is by gate kind, not convenience:

- **Mandatory gates — always stop, even under a goal.** Designed human checkpoints + safety stops: Stage 1 AC confirmation, Stage 3 batch-contract confirmation (DAG, execution modes, digests), both Stage 4 decision gates (`change_first` investigation-required, `accepted-risk`), any `<fail_stops>` entry. Auto-confirming these defeats the workflow; an active goal never skips them.
- **Discretionary pauses — never stop under a goal; just proceed.** Do NOT ask "shall I proceed to Stage N?", "want me to run the next batch?", or "how should I drive the remaining batches?" between stages or subroutes. Under a goal these are noise: advance to the next `data.route_id` action and report inline. Surface a checkpoint only when it is a mandatory gate above.
- **Avoid self-inflicted permission prompts.** Prefer tool calls and git forms that do not trip permission/hook stops mid-run. To reconstruct a file's content, use `git diff <ref> -- <path> | git apply` (scoped to that path) rather than `git checkout <ref> -- <path>` or `git restore --source=<ref> <path>` (both commonly hook-blocked). Never use inline script-execution flags (Python `-c`, Node/Ruby `-e`, `sh -c '...'` / `bash -c '...'` one-liners) that may trip a permission/security prompt. A permission prompt for a genuinely-needed write is a harness-settings concern, not a reason to stop the goal — note it and continue once cleared.

</host_adapters>

<durable_state_contract>

Durable ledger state beats transcript memory. Every resumed turn routes from the v2 CLI state envelope, not conversation recall.

- Canonical ledger: target repo at `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`.
- Run helper commands from target repo root, even when `{v2-cli}` points to an installed path outside it.
- If the ledger does not exist, use the canonical path and let the state envelope route to ledger creation.
- `cli.ts state <ledger-path> --json` = first non-read operation on every resumed turn.
- Use emitted facts (`data.route_id`, `data.required_reference_ids`, `data.blocking_gates`, sibling gate fields) as orchestration inputs.
- Do not restate or hand-validate the ledger schema, route union, packet schema, or helper output contract in this skill — those deterministic contracts belong to the CLI, helper, templates, and runtime code.

</durable_state_contract>

<orchestration_loop>

Start every turn in this order:

1. Re-read this skill control plane.
2. Resolve `{issue-number}`, `{target-repo}`, target repo root, `{ledger-path}`, `{v2-cli}`.
3. Re-read the per-issue ledger if it exists.
4. Run `bun {v2-cli} state {ledger-path} --json` from target repo root as first non-read operation.
5. Apply pre-route gates before entering a stage.
6. Route from `data.route_id`. Unknown route IDs = findings against `runbooks/issue-to-pr-v2/lib/route.ts`, not invitations to invent a prose route.
7. Load every reference listed in `data.required_reference_ids`. Action-specific templates load only when preparing that packet/handoff.
7b. When `data.route_id` begins with `blocked-`, also load `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` on top of `data.required_reference_ids`. This is a control-plane load: the CLI does not emit the guide in `data.required_reference_ids` by design, so the loop adds it deterministically on every `blocked-` route.
8. Execute exactly one visible workflow action: advance a stage, commit one lifecycle checkpoint, run one implementation attempt (Builder dispatch or bounded Orchestrator-inline), record one implementation-attempt checkpoint, run one Validator wave, converge one batch, or fail-stop with a specific question. Under an autonomous driver, "advance a stage" proceeds without inter-stage confirmation; only the mandatory gates and fail-stops in autonomous-mode policy (`<host_adapters>`) interrupt the loop.
9. Commit any required lifecycle checkpoint before turn-end when the stage requires durable state. Working tree must be committed + clean before any state-changing stage transition, not only at stages whose exit conditions restate it.
10. When the host evaluator needs transcript evidence, echo the ledger frontmatter, `## Batches`, `## Findings data`, and `## Findings` table — or an equivalent host-visible summary.

</orchestration_loop>

<pre_route_gates>

These gates re-fire on every turn after `cli.ts state --json` and before any Builder, Validator, Proposer, or ship work.

**Runbook version skew**

- If envelope reports `data.runbook_version_skew` missing/mismatched without continuation evidence, stop.
- Surface the mismatch and load `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` for the continuation evidence shape. See `first-run-gotchas.md` recipe 2.4 (`blocked-runbook-version-skew`) for the symptom-first evidence recipe (exact `state --json` fields that prove the skew).
- Do not auto-rewrite the ledger frontmatter version field.

**Installed artifact presence**

- If `data.installed_artifact_presence.all_present` is false, stop.
- Surface missing installed roots; ask operator to repair the v2 install or symlink before continuing.
- Sibling-field gate. Not necessarily a `data.blocking_gates` entry or blocked `route_id` — do not route from those fields alone.

Both gates must clear before entering the route catalog.

</pre_route_gates>

<reference_loading_policy>

Load references one level deep from this skill. `data.required_reference_ids` is the turn-specific authority for files under `runbooks/issue-to-pr-v2/references/` — each ID is a reference filename. Templates are action-specific, loaded only while preparing that packet/handoff.

| Route or action need | Reference or action template |
| --- | --- |
| Stage 1 issue/ledger setup | `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md` |
| Stage 2 planning | `runbooks/issue-to-pr-v2/references/stage-2-plan.md`; `runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md` |
| Stage 3 decomposition and contract review | `runbooks/issue-to-pr-v2/references/stage-3-decompose.md` |
| Blocked Stage 3, stale AC, stale batch contract, or stale digests | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`; `runbooks/issue-to-pr-v2/references/stage-3-decompose.md` |
| First-run gotchas or confusing first-run-state recovery (deterministic on `blocked-` routes, discretionary on non-blocked cryptic states; see note below) | `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` |
| Frontmatter blocked reason | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md`; `runbooks/issue-to-pr-v2/references/host-adapters.md` |
| Stage 4 batch loop | `runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md` |
| Stage 4 Builder dispatch | `runbooks/issue-to-pr-v2/references/builder-dispatch.md`; `runbooks/issue-to-pr-v2/templates/builder-work-packet.md` |
| Stage 4 Validator wave or findings write | `runbooks/issue-to-pr-v2/references/findings-and-validators.md`; `runbooks/issue-to-pr-v2/templates/validator-envelope.md` |
| Host readiness before Stage 4 implementation attempts | `runbooks/issue-to-pr-v2/references/host-adapters.md` |
| Ledger writes or helper output interpretation | `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` |
| Stage 5 final review | `runbooks/issue-to-pr-v2/references/stage-5-final-review.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md` |
| Stage 5 Proposer or patch-batch handoff | `runbooks/issue-to-pr-v2/templates/proposer-envelope.md`; `runbooks/issue-to-pr-v2/templates/patch-proposal.md` |
| Stage 6 ship | `runbooks/issue-to-pr-v2/references/stage-6-ship.md`; `runbooks/issue-to-pr-v2/references/findings-and-validators.md` |
| Router regression audit | `runbooks/issue-to-pr-v2/references/regression-matrix.md` |

Do not copy packet schemas, ledger schema, route field tuples, or full hatch semantics into this skill. If a route needs a reference that `data.required_reference_ids` does not name, file the drift against `runbooks/issue-to-pr-v2/lib/route.ts` or the packet renderer.

`first-run-gotchas.md` has a split trigger:
- On `blocked-` routes: **deterministically loaded by this skill's loop** (orchestration step 7b) while **absent from `data.required_reference_ids` by design**. `requiredReferenceIdsFor` does not return it for any route — intentional, not a route.ts drift to file. Adding it to `requiredReferenceIdsFor` would still be wrong.
- On non-blocked but cryptic first-run states: **discretionary** — a recovery overlay the operator loads on judgment when a valid state is confusing.

Either way, the load is a skill-loop decision, not because `data.required_reference_ids` named it.

</reference_loading_policy>

<route_catalog>

`runbooks/issue-to-pr-v2/lib/route.ts` is the runtime source of truth for route IDs. This catalog is an operator-facing map.

**Happy path**

- `no-ledger` and `pick-issue`: enter Stage 1.
- `plan`: enter Stage 2.
- `decompose`: enter Stage 3.
- `batch-loop`: enter Stage 4.
- `final-review`: enter Stage 5.
- `ship`: enter Stage 6.
- `shipped`: terminal; echo final ledger state and stop.

**Blocked routes**

- `blocked-frontmatter-blocked-reason`: surface recorded blocked reason; ask whether to unblock, abandon, or reframe.
- `blocked-runbook-version-skew`: use the version-skew gate above.
- `blocked-acceptance-criteria-stale`: return to Stage 1 AC re-confirmation; do not auto-rewrite ACs. See `first-run-gotchas.md` recipe 2.1 (`blocked-acceptance-criteria-stale`) for the symptom-first evidence recipe + stale-digest vs. blocked-status proof split.
- `blocked-stage-3`: return to Stage 3 plan or contract revision.
- `blocked-batch-contract-stale` and `blocked-digests-stale`: return to Stage 3 recompute + user confirmation. See `first-run-gotchas.md` recipes 2.2 + 2.3.

`first-run-gotchas.md` gives a symptom-first CLI evidence recipe (exact command, JSON fields, what they prove, recovery action). On any `blocked-` route the loop loads it deterministically (orchestration step 7b), so it is already in context for blocked-route recovery above. On a valid-but-cryptic non-blocked first-run state, load on operator judgment when recovery is not obvious: `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`.

Unknown route IDs = blocking findings against the runtime route contract. Do not invent prose-only routes.

</route_catalog>

<stage_shells>

Each stage shell is an entrypoint, not the full playbook. Load required references before taking the one visible action.

**Stage 1: issue and acceptance criteria**

- Inputs: `{issue-number}`, optional `{target-repo}`, target repo root, canonical ledger path.
- Required references: `stage-1-pick-issue.md`; `ledger-and-helper.md` when writing ledger state.
- One visible action: create/resume the ledger and get user-confirmed acceptance criteria.
- Exit: ledger exists, ACs confirmed + committed, issue feature branch in place, tree clean, next state routes to `plan`.
- Stop: closed/blocked issue without override, user abort, unsafe branch, unresolved AC ambiguity.

**Stage 2: plan**

- Inputs: confirmed ACs, ledger path.
- Required references: `stage-2-plan.md`, `ledger-and-helper.md`; `ce-plan-addendum.md` when preparing the planning packet.
- One visible action: render the planning addendum, invoke planning, or persist the resulting `plan_path` checkpoint.
- Exit: `plan_path` is set, plan exists, feature branch renamed off its `-pending` placeholder, tree clean, next state routes to `decompose`.
- Stop: planning asks the user a question, no plan output after one retry, plan has no implementation units.

**Stage 3: decompose and confirm batch contract**

- Inputs: plan path, confirmed ACs, ledger path.
- Required references: `stage-3-decompose.md`, `ledger-and-helper.md`.
- One visible action: parse/validate the candidate DAG, run contract review, present the digest-backed batch contract for confirmation, or persist the confirmed `## Batches` checkpoint.
- Exit: batch contract confirmed, every batch starts pending, coverage + digests confirmed, tree clean, next state routes to `batch-loop`.
- Stop: parse error, cyclic DAG, uncovered AC, missing batch contract field, open Stage 3 P0/P1, contract-review cycle cap reached without convergence, stale digest, confirmation refusal.

**Stage 4: batch loop**

- Inputs: confirmed batch DAG, current findings state.
- Required references: `stage-4-batch-loop.md`, `builder-dispatch.md`, `host-adapters.md`, `findings-and-validators.md`; `ledger-and-helper.md` for writes.
- One visible action: exactly one Stage 4 subroute below.
- Dispatch policy: `tdd`, `proof_first`, every repair after an open P0/P1, and every attempt on a patch-batch (`id: patch-NNN`, which carries an open final-review P0/P1 forward — never inline-eligible) MUST dispatch Builder. `change_first` MAY stay Orchestrator-inline only while bounded: ≤2 touched files, obvious, low-risk, non-behavioural, non-governance, non-public-contract, no broad discovery, no heavy Orchestrator context load, not the third consecutive inline attempt without user-confirmed exception. Falls back to Builder dispatch as soon as a dispatch trigger fires. The full always-on Validator wave runs on every committed implementation attempt regardless of path.
- Exit: every batch is `converged` or `accepted-risk`, no open P0/P1 blocks the batch loop, tree clean, next state routes to `final-review`.
- Stop: host readiness failure, Builder infrastructure failure, no eligible batch, escape hatch fire, iteration cap, user decision required.

Stage 4 subroutes:

- `select-eligible-batch`: choose one pending batch whose dependencies
  are terminal; if none qualifies, fail-stop with dependency evidence.
- `start-batch-checkpoint`: after host readiness passes, record the
  selected batch lifecycle start. This is separate from implementation
  work.
- `implementation-attempt`: run exactly one implementation attempt
  against the confirmed `batch.files` for the active batch. The umbrella
  has two paths; the dispatch policy above determines which path is
  legal for the active batch (it does not arbitrate between them on
  every turn):
  - `implementation-attempt-builder`: mandatory for `tdd`,
    `proof_first`, and any repair; required for `change_first` once a
    dispatch trigger fires. Render the Builder Work Packet and dispatch
    one Builder attempt.
  - `implementation-attempt-inline`: allowed only for bounded
    inline-eligible `change_first` attempts, and never for a patch-batch
    (`id: patch-NNN`), which is Builder-only on every attempt. The Orchestrator edits
    inline within the same authority boundary as Builder (edits only
    confirmed `batch.files`) and records the attempt as
    Orchestrator-inline evidence in its own audit lane on the ledger,
    separate from Builder attempt evidence.
- `attempt-checkpoint`: after a committed Builder or Orchestrator-inline
  implementation attempt and before Validator packet rendering, record the
  `implementation_attempt_checkpoint` Notes evidence tied to the commit and
  attempt lane. This is ledger-only evidence; it does not replace the
  Validator wave.
- `validator-wave`: hand Validators the committed implementation
  evidence and touched files after the matching attempt checkpoint exists.
  Validators own correctness findings; the Orchestrator records and
  normalizes them. The full always-on wave runs regardless of which
  implementation path produced the commit.
- `finding-repair`: dispatch a Builder repair for open P0/P1 findings
  in the active batch. Repairs are Builder-only; inline repair is never
  permitted, even after an inline initial attempt.
- `converge-batch`: run the no-open-P0/P1 gate and mark the batch
  terminal only when the ledger facts support convergence.
- `accepted-risk-or-reframe`: record a user-approved accepted risk or
  stop for reframe/replan when hatches or caps prevent convergence.

Only one Stage 4 subroute is the visible action per turn. Orchestrator routes + records lifecycle state. Implementation path (Builder dispatch or bounded Orchestrator-inline) owns one scoped attempt against `batch.files`. Validators own correctness findings. Proposer only appears when Stage 5 sends a final-review finding back as a patch-batch candidate.

**Stage 5: final review**

- Inputs: every batch terminal, clean tree.
- Required references: `stage-5-final-review.md`, `findings-and-validators.md`; `stage-4-batch-loop.md` for patch-batch routing.
- One visible action: run final review, record final findings, close non-blocking findings, or route one open P0/P1 through the Proposer/patch-batch handoff back to Stage 4.
- Exit: final findings terminal, `final_reviewed_at` set + committed, tree clean, next state routes to `ship`.
- Stop: reviewer coverage cannot cover correctness + testing, final review needs replan, patch-batch confirmation required.

**Stage 6: ship**

- Inputs: final review complete, clean tree, no open P0/P1.
- Required references: `stage-6-ship.md`, `findings-and-validators.md`.
- One visible action: run local checks, create/push the PR, or persist the final shipped ledger checkpoint.
- Exit: `pr_url` is set, ledger status is `shipped`, tree clean, next state routes to `shipped`.
- Stop: local check failure, unsafe final ledger commit, unsupported smoke-direct request, PR creation failure requiring operator input.

</stage_shells>

<fail_stops>

When a fail-stop fires: record durable state when the stage requires it, surface the smallest useful evidence to the user, name the resume condition.

| Condition | Record or surface | Resume condition |
| --- | --- | --- |
| Unknown `data.route_id` | Raw state envelope and route ID | Runtime route contract fixed or clarified |
| Runbook version skew | Ledger version evidence and `ledger-and-helper.md` pointer | State envelope reports matched or continuation evidence present |
| Partial v2 install | Missing installed roots | Install or symlink repaired and state envelope reports all present |
| Stage 1 issue or branch unsafe | Closed/blocked issue, open blocker, abort, or default-branch evidence | Override flag supplied, blocker cleared, user resumes instead of aborting, or work moves to a feature branch; see `stage-1-pick-issue.md` |
| Stale or blocked ACs | Digest drift or AC block reason | User re-confirms ACs in Stage 1 |
| Stage 2 plan missing or empty | No plan output after the retry, or zero implementation units | Planning produces a plan with at least one unit, or the user reframes the request; see `stage-2-plan.md` |
| Stage 3 plan parse or DAG invalid | Verbatim parse error, or the offending dependency cycle | User revises the plan so parsing and DAG validation pass, then Stage 3 re-runs; see `stage-3-decompose.md` |
| Stage 3 open P0/P1 | Contract-review finding summary | Plan or batch contract revision closes the finding |
| Stage 3 contract-review cycle cap | Cap reached without convergence and last finding summary | User replans, narrows the contract, or accepts surfaced advisories; see `stage-3-decompose.md` |
| Stale batch contract or digests | Recomputed drift evidence | Stage 3 recompute and user confirmation |
| Host Builder tools unavailable | Host readiness failure before any Stage 4 implementation attempt, including Builder dispatch and bounded inline work; no attempt evidence, iteration increment, or Validator wave is recorded | Required host tools are available |
| Builder infrastructure failure | Malformed/missing Builder envelope and side effects | User decides whether to retry, repair, or reframe |
| No eligible batch | Pending batch dependencies | Dependencies converge or user reframes the DAG |
| Escape hatch or iteration cap | Hatch name and current batch/finding evidence | User accepts risk, authorizes replacement, or replans |
| Stage 5 reviewer coverage gap | Reviewer cap with no fallback covering correctness and testing | A fallback reviewer set covers correctness and testing; see `findings-and-validators.md` |
| Patch-batch confirmation required | Validated patch-batch proposal awaiting user decision | User confirms the patch batch (returns to Stage 4) or declines and replans; see `stage-4-batch-loop.md` |
| Final review needs replan | Finding that exceeds patch-batch scope | User replans or narrows the contract |
| Local check failure | Check name and failing summary | Synthetic P0 routes through Stage 5 and is closed |
| Unsafe final ledger commit | Non-ledger path in final ledger commit | Commit is repaired so only the ledger checkpoint is included |
| Unsupported smoke-direct request | Requested `smoke-direct` on a non-disposable repo | Target repo and checkout are disposable, or the standard ship path is used; see `stage-6-ship.md` |
| PR creation failure | Failing `gh pr create` / push evidence | Operator resolves the failure and the PR URL is recorded; see `stage-6-ship.md` |

Detailed hatch semantics + closure rules: `runbooks/issue-to-pr-v2/references/findings-and-validators.md`.

</fail_stops>

<review_loop>

Stage 4 uses an implementation/Validator convergence loop:

1. Orchestrator selects one eligible confirmed batch and records lifecycle state.
2. One implementation attempt runs against the confirmed batch. For `tdd` and `proof_first`, the attempt is always Builder dispatch: Builder receives one Work Packet, edits only confirmed `batch.files`, returns evidence. For `change_first`, Orchestrator MAY edit inline within the same `batch.files` authority boundary, but only while inline eligibility holds (see Stage 4 dispatch policy above); as soon as a dispatch trigger fires, the attempt MUST dispatch Builder. Inline attempts record their evidence in the Orchestrator-inline audit lane on the ledger, separate from Builder attempt evidence.
3. Orchestrator records the ledger-only `implementation_attempt_checkpoint` Notes evidence for the committed attempt before rendering Validator packets.
4. Validators review the committed attempt and own correctness findings. The full always-on wave runs regardless of path; completed-wave evidence is recorded in Notes.
5. Orchestrator records normalized findings in the ledger.
6. Open P0/P1 findings block batch convergence.
7. Repair attempts continue until no open P0/P1 remains, an accepted-risk decision is recorded, or a fail-stop fires. Repairs are Builder-only: an open P0/P1 after any committed attempt (Builder or inline) routes to Builder repair, never inline.

Each repair dispatch targets exactly one committed open P0/P1 finding signature and may land at most one Builder commit for that target. Run separate Builder repair dispatches for separate signatures; if the attempt cap would be exceeded, fail-stop for user choice instead of batching unrelated finding fixes into one repair packet.

Stage 5 repeats the same P0/P1 rule over the cumulative diff. A final review P0/P1 never becomes an Orchestrator-authored implementation fix: route through Proposer + patch-batch path back into Stage 4, or fail-stop when it needs replan.

</review_loop>

<success_criteria>

Workflow is complete only when all are true:

- `cli.ts state {ledger-path} --json` reports `route_id: "shipped"`.
- Ledger frontmatter has `status: shipped`.
- `pr_url` is set.
- Every batch terminal: `converged` or `accepted-risk`.
- No open P0/P1 finding remains.
- Required local checks have passed.
- Working tree is clean.
- Final ledger echo (or equivalent host-visible summary) produced.

</success_criteria>
