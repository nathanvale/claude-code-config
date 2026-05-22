# Ledger and helper reference

**v1 source anchors:** `runbooks/issue-to-pr/issue-to-pr.md` L295-305, L314-337
(stage preconditions and helper execution context);
`runbooks/issue-to-pr/issue-N-ledger.template.md` L28-61 (acceptance criteria
and batches YAML); `runbooks/issue-to-pr/README.md` L161-175, L239-258, L348-414
(helper execution context, shared turn protocol, ledger schema overview).

**Read trigger:** open this reference when starting or resuming a turn (to
re-read durable confirmation state), when writing or updating ledger YAML
sections (acceptance criteria, batches, findings data, notes), or when reading
helper command output during a stage transition. See also:
[stage-1-pick-issue.md](stage-1-pick-issue.md),
[stage-3-decompose.md](stage-3-decompose.md),
[findings-and-validators.md](findings-and-validators.md).

## Stages framing (v1 L295-305)

Six stages, walked in order: `pick-issue`, `plan`, `decompose`, `batch-loop`,
`final-review`, `ship`. Each turn advances exactly one stage, commits one
ledger lifecycle checkpoint, or, for `batch-loop`, runs exactly one inner-loop
iteration.

Once the ledger exists, at the start of every resumed turn, first read durable
confirmation state:

```bash
bun ~/.claude/runbooks/issue-to-pr/decompose.ts --confirmation-state <ledger-path>
```

(The full bun path is the v1-era invocation; U3/U4 will move this behind a v2
`cli.ts state --json` command and U7 will point the hot router at the new
form. The helper contract is unchanged in the meantime.)

The command reports whether `acceptance_criteria`, `batch_contract`, and the
digest triple are `pending`, `confirmed`, `stale`, or `blocked`. A resumed
agent must route from that state, not from conversation memory. (The full
four-state semantics and the routing rule body live with the U1
`confirmation-state-routing` out-of-scope invariant; a future seam covering
the v2 hot router invocation contract owns the rule body. This sentence is
the minimum pointer needed for the in-scope `--confirmation-state` invocation
to be useful.)

## Helper execution context (v1 L314-337)

Helper command invocations in this runbook use the path
`bun ~/.claude/runbooks/issue-to-pr/decompose.ts`. Helpers are pure: they read
the ledger and plan paths and emit either JSON on stdout (for digest commands)
or a structured line-oriented result (for confirmation-state). They do not
mutate filesystem state.

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

**Stage-transition digest recheck (v1 L315-326).** Before every stage
transition after Stage 3, recompute the current `plan_digest`,
`batch_contract_digest`, and `ac_digest` values via `--plan-digest`,
`--batch-contract-digest`, and `--ac-digest`, and compare them with the
stored frontmatter values. If any digest command exits non-zero, any stored
digest is null while `## Batches` is populated, or any current digest
differs from its stored value, fail-stop and return to Stage 3 confirmation
before Builder or ship work continues.

**Immutable batch contract fields covered by `batch_contract_digest`.** The
digest is recomputed over the confirmed batch contract: `id`, `name`, `goal`,
`files`, `depends_on`, optional `supersedes`, `execution_mode`,
`acceptance_tests`, `ac_mapping`, and optional `rationale`. Runtime
lifecycle fields (`status`, `iterations`, `builder_commits`,
`builder_attempts`, `final_verdict`) are mutated by Stage 4 and are **not**
part of the digest.

## Ledger schema overview (v1 README L348-414)

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

Helper validation rejects any drift between `## Findings data` and `## Findings`.
Frontmatter digest fields (`plan_digest`, `ac_digest`, `batch_contract_digest`)
are recomputed via `decompose.ts --plan-digest`, `--ac-digest`, and
`--batch-contract-digest`.

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
- `plan_path` (set at Stage 2), `plan_digest`, `ac_digest`,
  `batch_contract_digest` (digests set at Stage 3 confirmation).
- `final_reviewed_at` (set at Stage 5 final-review checkpoint).
- `ship_mode`: `standard` (default) or `smoke-direct`.
- `pr_url` (set at Stage 6).

### `## Batches` entry fields

Each batch entry must include:

- `id`, `name`, `goal`, `files` (non-empty repo-relative paths), `depends_on`
  (may be `[]`).
- Optional `supersedes` (only when this is a replacement batch superseding a
  blocked original).
- `execution_mode`: exactly one of `tdd`, `proof_first`, `change_first`.
- `acceptance_tests` (non-empty), `ac_mapping` (non-empty unless this is a
  `patch-*` batch).
- Optional `rationale` (required when execution_mode and path combinations
  need an explicit exception prefix).

Stage 4 mutates batch entries at runtime to add:

- `status`: `pending | in-progress | converged | accepted-risk | blocked`.
- `iterations`: number of well-formed Builder envelopes (committed or
  Builder-authored fail-stop) seen so far.
- `builder_commits`: list of commit SHAs from successful Builder attempts on
  this batch.
- `builder_attempts`: compact records, one per well-formed Builder envelope,
  each with `attempt_type`, `status`, `commit_sha`, `files_touched`,
  `route_hint`, `blockers`, `probe_results`, `notes`. Rich envelope evidence
  (implementation steps, tests run, assumptions, risks, deferred, suggested
  Validator focus) is **not** persisted here; it lives in Notes or is passed to
  Validators.
- `final_verdict`: `converged | accepted-risk | blocked-for-user`.

### `## Findings data` field requirements

Each finding row is YAML with `id`, `batch_id`, `signature`, `persona`,
`severity`, `status`, `summary`, and `resolution`. Constraints:

- `id` is unique within the ledger.
- `batch_id` must be one of `stage-3`, `final`, or a confirmed batch id from
  `## Batches`.
- `signature` is a stable kebab-case dedupe key; the same finding from
  multiple personas shares one signature.
- `severity` is one of `P0`, `P1`, `P2`, `P3` (from the persona's own rubric;
  the runbook does not re-rank).
- `status` is one of `open`, `fixed`, `accepted-risk`, `deferred-P2`,
  `deferred-P3`, `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`,
  `superseded`.
- `summary` text is verbatim what the rendered `## Findings` table will show
  (helper validation enforces no drift).
- `resolution` matches the status per the allowed status/resolution pairs in
  [findings-and-validators.md](findings-and-validators.md#closing-a-finding-without-fixing-it-v1-l1288-1301).

### Dedupe and canonical-finding rule

A finding group is identified by `batch_id + signature`. The canonical row is
the row with the highest severity; on a tie, the first row in stable
normalized order (selected persona dispatch order, preserving each persona's
finding order) wins. Non-canonical rows in the group are
`status: superseded` with `resolution: superseded-by-<canonical-id>`. The
referenced canonical id must exist in the ledger, be the non-superseded row
of the same `batch_id + signature` group, have equal-or-higher severity, and
must not be itself.

## Acceptance criteria and batches contract (v1 ledger template L28-61)

`## Acceptance criteria` lists each AC verbatim from the source issue, numbered
1-based. The list is confirmed by the user at Stage 1 and is read-only after
confirmation; changes after confirmation route through helper validation and
re-confirmation.

`## Batches` is a fenced YAML block (no XML-style wrapping) with one entry per
batch. Each entry includes `id`, `name`, `goal`, `files`, `depends_on`,
optional `supersedes`, `execution_mode` (`tdd | proof_first | change_first`),
`acceptance_tests`, `ac_mapping`, optional `rationale`, plus run-time fields
populated by Stage 4 (`status`, `iterations`, `builder_commits`,
`builder_attempts`, `final_verdict`).

The acceptance criteria list and batches block jointly drive
`decompose.ts --validate-ac-coverage`: every AC index must appear in at least
one batch's `ac_mapping`. Investigation placeholders use
`rationale: "out-of-scope: investigation-required"` and are surfaced as a
Stage 3 user gate.

## Turn protocol (v1 README L239-258)

At the start of every turn:

1. Re-read the v2 hot router (when it exists; until U7 this remains the v1
   `runbooks/issue-to-pr/issue-to-pr.md`).
2. Re-read the per-issue ledger.
3. Run `decompose.ts --confirmation-state <ledger-path>` and route from its
   output before relying on AC/batch/digest content from memory.
4. Walk one stage step (or one inner-loop iteration during `batch-loop`).
5. Commit the ledger lifecycle checkpoint or Builder commit appropriate to
   the step.
6. Echo the ledger frontmatter + batches YAML + findings data + findings
   table inline at the end of the turn so the `/goal` evaluator can verify
   convergence from the transcript.

Each turn does **one thing visible**: advance a stage, commit one ledger
lifecycle checkpoint, commit one Validator findings checkpoint, run one
Builder commit, run one validate pass, or fail-stop with a question. **Never
do two stages in one turn.**

## Route ids (v2 `cli.ts`)

The v2 CLI front door at `runbooks/issue-to-pr-v2/cli.ts` (U4) emits a
**route id** with every `state --json` and `next --json` response. Route
ids are **facts** about where the workflow currently sits, not imperative
instructions — ADR 0002. The hot router (U7) consumes a route id and
decides what to do next; the CLI never says "run X" or "execute Y".

The executable source of truth is the `ROUTE_IDS` const in
`runbooks/issue-to-pr-v2/lib/route.ts`. The catalog below mirrors that
const verbatim; drift between code and this section is a P1 finding per
the U4 audit prompt.

### Stage route ids (happy path)

| Route id | When the CLI emits it |
| --- | --- |
| `pick-issue` | Ledger exists but `ac_confirmation_status` is not `confirmed`; Stage 1 has not yet committed the AC checkpoint. |
| `plan` | AC is confirmed but `frontmatter.plan_path` is null; Stage 2 has not yet recorded a plan file. |
| `decompose` | Plan path present but `batch_contract_confirmation_status` is not `confirmed`, or no batches have been written to `## Batches`. |
| `batch-loop` | Batch contract confirmed and at least one batch exists, but not every batch is in a terminal status (`converged` or `accepted-risk`). |
| `final-review` | Every batch is terminal but `frontmatter.final_reviewed_at` is null; Stage 5 has not yet committed the cumulative-diff review checkpoint. |
| `ship` | Final review complete but `frontmatter.pr_url` is null; Stage 6 has not yet recorded the PR URL. |
| `shipped` | `frontmatter.pr_url` is set and `frontmatter.status` is `shipped`. Terminal success state. |

### Blocked route ids

| Route id | When the CLI emits it |
| --- | --- |
| `blocked-frontmatter-blocked-reason` | `frontmatter.status` is the literal `blocked`. Highest-precedence blocked state. |
| `blocked-runbook-version-skew` | `runbook_version` skew classification is `mismatched` or `missing` (U6 work — the field itself lands there; until then the CLI never emits this id). |
| `blocked-acceptance-criteria-stale` | `ac_confirmation_status` is `blocked` or the stored AC digest no longer matches the ledger's `## Acceptance criteria` content. |
| `blocked-stage-3` | `batch_contract_confirmation_status` is `blocked` because Stage 3 Contract Review surfaced an open P0/P1 finding. |
| `blocked-batch-contract-stale` | The stored batch contract digest no longer matches the ledger's `## Batches` content. |
| `blocked-digests-stale` | One of `plan_digest`, `ac_digest`, or `batch_contract_digest` no longer matches the source content but the individual `*_confirmation_status` fields haven't been flipped yet. |

### Special route ids

| Route id | When the CLI emits it |
| --- | --- |
| `no-ledger` | The ledger file does not exist on disk. The CLI never advances past this point; the consuming router must invoke Stage 1 to create the ledger. |

### Precedence order

`classifyRoute` in `lib/route.ts` walks the inputs in this fixed precedence
order, returning the first match:

1. `no-ledger` — ledger file absent.
2. `blocked-frontmatter-blocked-reason` — explicit user decision wins
   over any derived state.
3. `blocked-runbook-version-skew` — version mismatch must be resolved
   before any other gate.
4. `blocked-*` durable states (AC blocked, Stage 3 blocked).
5. `blocked-*` stale states (AC stale, batch contract stale, digests
   stale).
6. `shipped` (when both `pr_url` and `frontmatter.status: shipped` are
   set).
7. Happy-path stage progression in stage order.

Tests at `runbooks/issue-to-pr-v2/lib/route.test.ts` pin every branch.

## See also

- [host-adapters.md](host-adapters.md) for the host-readiness boundary that
  guards Builder dispatch and the `--confirmation-state` interpretation rules
  during resumed runs.
- [findings-and-validators.md](findings-and-validators.md) for ledger findings
  shape and helper validation of `## Findings data`.
- [stage-3-decompose.md](stage-3-decompose.md) for the batches contract author
  flow.
