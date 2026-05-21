# Issue to PR - Workflow Runbook

This is a **single-workflow runbook area**, not a multi-seam review area like
`docs/runbooks/data-table-review/` in side-quest experiences. The "seams" table
below has exactly one row by design: this area defines one reusable workflow
that, given a GitHub issue, drives the issue to a green PR using the
Builder/Validator pattern.

The runbook lives at `~/.claude/runbooks/issue-to-pr/`. The state for each run
lives in the **target repo** at `docs/runbooks/issue-to-pr/issue-<N>-ledger.md`.

`/goal` requires Claude Code v2.1.139+. `/loop` is a fallback (see
[Driver: /goal vs /loop](#driver-goal-vs-loop)).

## Why this is one workflow, not many seams

A multi-seam review area exposes independent loops over an existing codebase
(`selection`, `header-adapter`, `accessibility`, etc.), each one a tight
contract worth pinning. This area is the opposite: a **linear pipeline**,
parameterised by the target issue. Stages are sequential by construction
(`pick-issue` then `plan` then `decompose` then `batch-loop` then
`final-review` then `ship`), not independent loops. Splitting them into seams
would be cargo-culting the shape.

The `/runbook-orchestrator` `audit`, `launch`, and `status` subcommands still
work on this area because we preserve the convention's required sections
(`## Why these seams`, `## Invocation`, ledger format). The `new` subcommand
does not apply (there is nothing to bootstrap).

## Issue shape compatibility

This runbook reads three things from a GitHub issue:

1. **Acceptance criteria.** Extracted flexibly: prefers the `/to-issues`
   shape (`## Acceptance criteria` heading with `- [ ]` checkboxes), falls
   back through `## Acceptance`, `## AC`, `## Definition of done`, `## Done
   when`, then any contiguous checkbox block, then numbered lists under
   headings containing "must", "should", or "requirement". If none match,
   stage 1 prompts the user to paste a list inline OR draft one from the
   issue's prose. **The extracted list is always presented for user confirm
   before stage 2 begins.** After confirmation, the ledger frontmatter records
   both the extraction source (`gold-standard`, `variant-heading`,
   `loose-checkbox-block`, `numbered-requirements`, `pasted`, or `drafted`)
   and `ac_confirmation_status: confirmed` with the matching `ac_digest`, so
   resumed turns do not rely on transcript memory.

2. **Blocked by.** Optional. If present, stage 1 parses `#N` references and
   refuses to run if any blocker is still open. Override by adding a
   `force-run` label to the target issue.

3. **What to build.** Used as ce-plan context but not parsed structurally.

Issues created by `/to-issues` work out of the box. Free-form issues work as
long as ACs can be located by the heuristic above (or pasted at stage 1).

## Execution mode ownership

Each batch carries an `execution_mode` because execution discipline is part of
the batch contract, not an improvisation left to Builder. `/ce-plan` proposes
the mode, `decompose.ts` validates the machine-checkable shape, the stage 3
user gate confirms the DAG and modes, and the ledger records the confirmed
contract plus `batch_contract_confirmation_status: confirmed`. Builder follows
the ledger or fail-stops if the confirmed contract is unsafe or stale after
reading the files.

Allowed modes:

- `tdd`: write the next failing public-interface test for observable
  behaviour, then make the smallest change that passes it.
- `proof_first`: write a characterization check or target-state proof before
  the change.
- `change_first`: make the smallest scoped change before proof only when a
  prior red test or proof would be artificial. Docs-only paths are allowed by
  default. Non-doc generated config, mechanical changes, runtime changes, and
  investigation placeholders require `out-of-scope: investigation-required`
  or a non-empty `change_first-exception:` rationale so the stage 3 user gate
  can accept them explicitly. High-risk paths require a non-empty
  `high-risk-change_first-exception:` rationale.

Keep this vocabulary runbook-local until a second workflow adopts it. At that
point, promote the terms into a shared pattern doc or ADR.

## Builder dispatch overview

Stage 4 uses the Builder dispatch contract instead of in-session
implementation by the Orchestrator. The shared contract is host-neutral:
hosts must provide an isolated Builder dispatch with the required Builder tool
set and authority boundary, Work Packet delivery, git status and commit-ref
visibility, envelope capture, and timeout/failure classification. The required
Builder tool set is the ability to read/search target-repo files, edit only
authorized `batch.files`, run deterministic repo-local checks/probes, inspect
git status and diffs, create exactly one commit for a successful attempt, and
return the structured envelope. The runbook must not depend on any
host-specific primitive name for those capabilities.

The Builder Work Packet is batch-only. It includes the confirmed batch
contract, the current iteration, existing `builder_commits`, relevant findings
for that batch, compact prior `builder_attempts`, non-authoritative Notes
summaries for that batch, local-law instructions, authority boundaries,
preflight rules, and the return envelope contract. It excludes the full plan,
full ledger, unrelated batch state, raw Validator envelopes, and rich Builder
evidence fields that are not persisted wholesale in the ledger.

If host readiness fails before Builder dispatch, record frontmatter
`status: blocked` and `blocked_reason: host-builder-tools-unavailable`, append
Notes evidence, leave batch statuses unchanged, and do not fall back to
Orchestrator-direct implementation. If dispatch, timeout, permission,
serialization, schema, or malformed-envelope failure happens after Builder
dispatch, record `blocked_reason: builder-infrastructure-failure`, leave the
current batch `in-progress`, append no `builder_attempts` row, do not
increment `iterations`, and surface any reachable commit refs or dirty/staged
path summaries for user choice.

## Why these seams

| Seam        | Runbook                          | Ledger                                                                      | Files                                                  |
| ----------- | -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| Issue-to-PR | [issue-to-pr.md](issue-to-pr.md) | per-issue, see [issue-N-ledger.template.md](issue-N-ledger.template.md)     | varies per issue; the plan declares per-batch `files`  |

## Invocation

When the loop invokes `/ce-plan`, `/ce-code-review`, or `/ce-commit-push-pr`,
it must resolve the skill name against its host's available-skills list. Some
harnesses list skills under a plugin namespace
(`compound-engineering:ce-plan`); others list the bare name (`ce-plan`).
Invoking a short-form guess that isn't in the list will fail. Always match a
listed entry verbatim before calling the Skill tool.

"Invoke" is a host-neutral verb. In slash-command hosts, use the slash command
or Skill tool. In Codex-style hosts where slash commands are not literal,
follow the matching skill body directly and use the host's available agent,
tool, or persona primitives to satisfy the same contract. Record the fallback
in Notes only when it changes observable workflow behavior.

### Helper Execution Context

Run every `bun ~/.claude/runbooks/issue-to-pr/decompose.ts ...` helper command
from the target repo root unless a step explicitly says otherwise. The helper
intentionally reads the process working directory: repo-relative file checks
use it to reject directory paths and stale paths, and ledger/finding validation
uses the active git repository to verify `builder_commits` and fixed
`commit <sha>` resolutions exist and are reachable from `HEAD`.

Running the helper from the installed runbook directory, a home directory, or a
different checkout can validate the same ledger against the wrong git
repository. Keep the command shape stable and change directory to the target
repo root before invoking it; do not add a separate repo-root flag unless this
contract proves insufficient.

### Confirmation State

After the ledger exists, resumed turns should start with:

```
bun ~/.claude/runbooks/issue-to-pr/decompose.ts --confirmation-state <ledger-path>
```

The helper reports `acceptance_criteria`, `batch_contract`, and `digests` as
`pending`, `confirmed`, `stale`, or `blocked`. The states are derived from
durable ledger evidence: confirmation status fields, stored digest values, the
current AC section, the current or regenerable batch contract, and Stage 3
Contract Review blockers. A `stale` digest state routes back to confirmation
before Builder or ship work continues.

### Issue-to-PR

```
/goal Follow ~/.claude/runbooks/issue-to-pr/issue-to-pr.md. Target issue is
{issue-number} in {target-repo} (default: current repo from `git remote get-url
origin` parsed to owner/repo). Re-read the runbook AND the per-issue ledger at
docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md (in the target repo)
at the start of every turn. Create the ledger on first turn from the template
at ~/.claude/runbooks/issue-to-pr/issue-N-ledger.template.md.

Walk the six stages in order: pick-issue, plan, decompose, batch-loop,
final-review, ship. Inside batch-loop, walk batches in topological order. For
each batch, run the inner loop: Builder commits, persona suite (always-on +
adversarial + diff-conditional) validates, gate on P0/P1 findings. Iterate the
inner loop until zero open P0/P1 findings remain or the iteration cap (5) is
hit. After all batches converge, run final-review (one /ce-code-review pass
over the cumulative diff) under the same P0/P1 gate.

Goal met when: every batch has status `converged` (or `accepted-risk` with
user confirmation); final-review has zero open P0/P1 findings and
`final_reviewed_at` is set; ship stage has written a PR URL to the ledger
frontmatter; ledger frontmatter `status` is `shipped`; the final ledger update
has been committed and pushed. CI green-up is out of scope (run a follow-up
/loop if you want).

Fail-stop and ask the user if any of the following hold: gh cannot resolve the
issue; user aborts at the AC confirm gate; an open blocker is found in
`## Blocked by` (overridable with `force-run` label); ce-plan emits zero
implementation units; decompose detects a cyclic DAG, invalid batch contract,
or uncovered AC; an inner loop hits the iteration cap with open P0/P1; an inner
loop triggers an escape hatch (see issue-to-pr.md, Escape hatches);
final-review surfaces a P0/P1 whose fix spans more than 2 files; working tree is
dirty at a stage boundary; branch preflight cannot create or check out the
issue feature branch before ledger mutation; two ledgers exist for the same
issue (concurrent invocation).

Echo the ledger frontmatter + batches YAML block + findings data block +
findings table inline at the end of every turn so the evaluator can verify
convergence from the transcript. Stop after 60 turns.
```

## Driver: /goal vs /loop

| Driver  | Use when                                                                          |
| ------- | --------------------------------------------------------------------------------- |
| `/goal` | Default. The evaluator verifies convergence from each turn's echoed ledger state. |
| `/loop` | Claude Code older than v2.1.139, or you want fixed-cadence ticks instead of evaluator-driven stops. Pass the same prompt body, replace the trailing "Stop after 60 turns." with a `/loop` count. |

## Turn protocol (shared)

At the start of every turn:

1. Re-read `issue-to-pr.md` (the workflow runbook).
2. Re-read the per-issue ledger at
   `docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`.
3. If the ledger exists, run `--confirmation-state <ledger-path>` and route
   pending, stale, or blocked gates before relying on ACs, batches, or
   digests.
4. Determine current stage from ledger frontmatter `status` + ledger contents.
5. Execute the current stage per `issue-to-pr.md`.
6. Update ledger state.
7. Echo ledger frontmatter + batches YAML + findings data + findings table at
   the end of the turn.

Each turn does one thing visible: advance a stage, commit one ledger lifecycle
checkpoint, commit one Validator findings checkpoint, run one Builder commit,
run one validate pass, or fail-stop with a question. Never do two stages in one
turn.

## Fix protocol (shared)

Fixes happen inside `batch-loop`'s **inner loop** (see `issue-to-pr.md`,
`## Inner loop`). They are NOT cross-batch. Each batch's inner loop:

1. Builder commits one implementation or repair attempt scoped to the batch's
   `files`.
2. Persona suite re-runs over the new diff.
3. Orchestrator normalizes and deduplicates Validator findings, writes
   `## Findings data`, renders `## Findings`, runs `--validate-findings`, and
   commits a ledger-only Validator findings checkpoint before any repair
   Builder starts.
4. Builder repairs exactly one committed open P0/P1 finding by signature.
5. Repeat until open P0/P1 == 0 OR iteration cap hit OR an escape hatch fires.

P2 and P3 findings do NOT trigger fixes inside the inner loop. P2 findings are
auto-closed at batch convergence with status `deferred-P2` and surfaced in the
final PR body. P3 findings are auto-closed as `deferred-P3` and stay in the
ledger only (not surfaced in the PR body unless count > 5).

## Risk classification (auto-fix gate)

Not applicable in the data-table-review sense. The persona suite returns
severity (P0/P1/P2/P3) per their existing agent contracts. The runbook gates
on P0/P1 directly. There is no separate "low-risk auto-fix" lane.

A batch is **high-risk** when any of these hold:

- The batch's `files` list touches auth, sessions, tokens, crypto, OAuth, SSO,
  permissions, ACL, RBAC, payment, billing, checkout, invoice,
  subscription, webhook, PII, privacy, admin, secrets, credentials, Stripe,
  or PayPal paths.
- The batch's `files` list touches DB migrations (`migrations/`,
  `prisma/schema.prisma`, `schema.rb`, migration `*.sql` files).
- The batch's `files` list touches an exported public API surface (a package's
  `index.ts`/`index.js` re-export, an OpenAPI/Swagger spec, a GraphQL schema).
- The plan or issue marks it as high-risk explicitly.

High-risk batches trigger the `risk-high-finding` escape hatch on any open
P0/P1: stop, summarise, ask the user before any inner-loop fix.

## Local glossary

These terms are local to the Issue-to-PR workflow until another workflow needs
them.

- **Finding**: one validator-reported issue recorded in `## Findings data`.
  It belongs to one `batch_id` or to `final`.
- **Canonical finding**: the non-superseded row that represents one underlying
  issue for one `batch_id + signature` group. It is the row read by the P0/P1
  gate.
- **Superseded finding**: a duplicate row kept for audit trail, with
  `status: superseded` and `resolution: superseded-by-<canonical-id>`.
- **Duplicate finding group**: all findings with the same `batch_id +
  signature`. The highest-severity row is canonical; ties use the first row in
  stable normalized order.
- **Corroborating evidence**: supporting context from duplicate persona
  findings. Keep a short "also reported by ..." clause in the canonical
  summary and the fuller detail in Notes.
- **Contract Review**: Stage 3 read-only review of the authored plan plus
  parsed candidate DAG before candidate batches become the ledger contract.
  Source requirements:
  `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.
- **Escalated Contract Review**: the higher-rigor Stage 3 review path used
  only when deterministic risk triggers fire.
- **Builder dispatch contract**: the runbook-owned prompt shape, required
  capabilities, preflight rules, authority boundary, and return envelope that
  each host maps to its own fresh Builder sub-agent per attempt.
  Source requirements:
  `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.
- **Builder Work Packet**: the per-attempt, batch-only payload the Orchestrator
  passes to Builder under the Builder dispatch contract.
- **Builder Preflight Checklist**: Builder's read-only readiness and
  deterministic-probe step before edits.
- **Builder attempt**: one Builder dispatch that returns a well-formed Builder
  envelope, whether it commits or Builder-authored fail-stops.
- **Host Builder readiness failure**: an Orchestrator-owned block before
  Builder exists because the host cannot provide the required fresh sub-agent
  capabilities. Recorded as `host-builder-tools-unavailable`.
- **Builder infrastructure failure**: a post-dispatch host, tool, permission,
  dispatch, serialization, schema, or malformed-envelope failure before a
  well-formed Builder envelope exists.
- **Mechanic Discipline**: the Builder rules that keep implementation local,
  reviewable, and non-architectural.
- **Route hint**: a non-authoritative next-owner hint in a Builder fail-stop
  envelope. Status owns workflow transition; `route_hint` owns routing advice.

## Ledger format

One ledger file per issue, in the target repo at
`docs/runbooks/issue-to-pr/issue-<N>-ledger.md`. Created on first turn from
the template at [issue-N-ledger.template.md](issue-N-ledger.template.md).

Three sections plus frontmatter:

1. **Frontmatter** - issue metadata, AC extraction source, durable
   confirmation gate state, run status, plan path, final review checkpoint,
   PR URL (once shipped), ship mode, and confirmed digests (`plan_digest`,
   `batch_contract_digest`, `ac_digest`). `ac_confirmation_status` and
   `batch_contract_confirmation_status` are `pending`, `confirmed`, `stale`,
   or `blocked`; `--confirmation-state` computes the effective state from
   those fields plus current ledger evidence. Compute the plan digest with
   `bun ~/.claude/runbooks/issue-to-pr/decompose.ts --plan-digest <plan-path>`.
   Compute the AC digest with
   `bun ~/.claude/runbooks/issue-to-pr/decompose.ts --ac-digest <ledger-path>`.
   The batch contract digest covers immutable batch fields only: id, name,
   goal, files, depends_on, execution_mode, acceptance_tests, ac_mapping, and
   rationale. Compute it with
   `bun ~/.claude/runbooks/issue-to-pr/decompose.ts <plan-path> --candidate-contract-digest`
   before confirmation, and
   `bun ~/.claude/runbooks/issue-to-pr/decompose.ts --batch-contract-digest <ledger-path>`
   after the ledger is written.
2. **`## Acceptance criteria`** - populated at stage 1 from the user-confirmed
   AC list. The source of truth for stage 2 and stage 3.
3. **`## Batches`** - one fenced YAML block listing every batch (id, name,
   goal, files, depends_on, execution_mode, acceptance_tests, ac_mapping,
   rationale, status, builder_commits, builder_attempts, iterations,
   final_verdict).
   `execution_mode` is one of `tdd`, `proof_first`, or `change_first`.
   `builder_commits` entries must be reachable git commit refs.
   `builder_attempts` entries are compact persisted records with
   `attempt_type`, `status`, `commit_sha`, `files_touched`, `route_hint`,
   `blockers`, `probe_results`, and `notes`. Persisted `blockers` and
   `probe_results` are string summaries. Raw Builder evidence such as
   implementation steps, tests run, assumptions, risks, deferred items, and
   suggested Validator focus is passed to Validators or summarized in Notes
   rather than copied into `builder_attempts`.
4. **`## Findings data`** - one fenced YAML block listing every finding with
   strict fields: id, batch_id, signature, persona, severity, status, summary,
   and resolution. Finding ids must be unique. `batch_id` must be `stage-3`,
   `final`, or a confirmed ledger batch id. This is the source of truth for
   Stage 3 Contract Review gates, P0/P1 gates, duplicate signature detection,
   accepted-risk handling, and final
   convergence.
   `severity` must be `P0`, `P1`, `P2`, or `P3`. `status` must be `open`,
   `fixed`, `accepted-risk`, `deferred-P2`, `deferred-P3`,
   `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, or `superseded`.
   An open blocker means `severity` is `P0` or `P1` and `status` is `open`.
   Fixed Stage 3 findings must use `resolution: plan-revision <sha>`, where
   the SHA is the reachable plan/DAG revision that closed the finding. Other
   fixed findings must reference a reachable `commit <sha>` recorded in a
   terminal ledger batch, or a terminal `patch-batch patch-NNN`. Duplicate
   findings are identified by `batch_id + signature`; superseded findings must
   point to an existing different canonical finding with the same signature,
   same batch id, and equal-or-higher severity. The canonical finding may be
   open or closed, but it must not itself be superseded.
   Convergence checks read this YAML source, not the rendered table.
5. **`## Findings`** - markdown table rendered from `## Findings data` for
   human scanning. Append rows only after the YAML source is updated.
   `--validate-findings` checks all rendered columns against the YAML source.

See [issue-N-ledger.template.md](issue-N-ledger.template.md) for the exact
shape.

## Suggested execution order

Not applicable: one seam. The stage order is fixed inside `issue-to-pr.md`.

## Closing reports

Optional. After ship, `/runbook-orchestrator report ~/.claude/runbooks/issue-to-pr
issue-to-pr` produces a tightness assessment specific to this run. Per-issue
closing reports land in the target repo at
`docs/runbooks/issue-to-pr/issue-<N>-report-<YYYY-MM-DD>.md`.

## Parallel execution

One issue per checkout. Multiple issues across worktrees (or across separate
clones of the same repo) is supported and safe: ledgers live at distinct paths
and don't collide. v1 enforces `batch-loop` sequential execution within a
single run; the batch schema's `depends_on` field is populated so a future
parallel-batches mode is a flip, not a rewrite.

## What this area deliberately does not do

- **Is not /lfg.** `/lfg` is hands-off autopilot: one ce-plan, one ce-work,
  one ce-code-review autofix pass, then ship, plus a 3-attempt CI fix loop.
  This runbook is the opposite trade-off: DAG batches with adversarial review
  per batch, a per-issue audit ledger, four interactive gates (AC confirm,
  DAG plus execution-mode confirm, escape-hatch fires, final-review
  patch-batch vs replan), and refusal to run on dirty trees. Use `/lfg` when
  you want speed; use this
  runbook when you want rigour and an audit trail. They are independent
  siblings, not a pipeline.
- Does not watch CI. Goal-met is "PR open"; CI green-up is a separate
  concern. Run a follow-up `/loop` or use `/lfg`'s CI-watch step on the same
  PR after this runbook ships.
- Does not handle PR review feedback after the PR is open. Use
  `compound-engineering:ce-resolve-pr-feedback`.
- Does not use direct `git push` plus `gh pr create` in real repos. That path
  is named `smoke-direct` and is only for disposable smoke-test repos when the
  user explicitly asks to keep the smoke small.
- Does not work on closed issues without a `reopen-for-implementation` label
  (stage 1 will ask).
- Does not mutate ledgers on the default branch. Stage 1 may start on the
  default branch only long enough to create or check out the issue feature
  branch before the first ledger mutation.
- Does not run when the issue has open blockers in `## Blocked by` (override
  with a `force-run` label on the target issue).
