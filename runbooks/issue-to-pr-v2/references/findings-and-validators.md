# Findings and Validators reference

**v1 source anchors:** `runbooks/issue-to-pr/issue-to-pr.md` L22-41 (reviewers
and ADR guardrails), L267-272 (scoped audit prompt is not declared here),
L784-793 (Mechanical-diff fallback), L982-1016 (Persona selector and broad
reviewer fallback), L1110-1195 (Validator invocation rules), L1288-1313 (close
reasons and `/loop` fallback); `runbooks/issue-to-pr/README.md` L260-346 (fix
protocol, risk classification, glossary).

**Read trigger:** open this reference when Stage 4 batch-loop is about to
dispatch Validator personas after a committed Builder envelope, when Stage 5
final-review is about to record `ce-code-review` output, when the orchestrator
needs the broad-reviewer fallback rule, or when closing a finding via one of
the allowed status/resolution pairs. See also:
[builder-dispatch.md](builder-dispatch.md),
[stage-4-batch-loop.md](stage-4-batch-loop.md),
[stage-5-final-review.md](stage-5-final-review.md).

## Reviewers and ADR guardrails (v1 L22-41)

### Always-on reviewer set

The always-on reviewers run on every committed Builder envelope, regardless of
the persona selector signals:

- `compound-engineering:ce-correctness-reviewer`
- `compound-engineering:ce-testing-reviewer`
- `compound-engineering:ce-maintainability-reviewer`
- `compound-engineering:ce-project-standards-reviewer`
- `compound-engineering:ce-adversarial-reviewer`

The persona selector table below adds conditional reviewers on top of this
always-on set.

### ADR guardrail (validate-time rule)

The runbook does not enforce target-repo ADRs ahead of time. It does enforce
the **target repo's** ADRs at validate time: if any persona surfaces a finding
citing the target repo's `docs/adr/*`, the inner-loop `ADR-contradicts-<id>`
escape hatch fires (the escape-hatch behaviour itself is owned by
[stage-4-batch-loop.md](stage-4-batch-loop.md), which links back here for the
validate-time trigger).

## No local audit prompt (v1 L267-272)

This reference does not declare a `/ce-code-review` prompt body. The
final-review stage invokes `/ce-code-review` once over the cumulative diff;
that prompt is generated from the `ce-code-review` skill body, not declared
here. This is the U2 invariant captured by the
`issue-to-pr-scoped-audit-prompt` row in the regression matrix.

## Mechanical-diff fallback (v1 L784-793)

When the cumulative diff at Stage 5 is dominated by mechanical changes (>80%
of changed lines are pure renames, identifier substitutions, or doc-pointer
refreshes that batch-level validators have already covered), the orchestrator
may substitute a single `ce-correctness-reviewer` subagent for the full
`/ce-code-review` wave. The subagent prompt MUST include the full list of
ledger-recorded finding signatures so it can signature-deduplicate and surface
only NEW findings. This is not a cap fallback; it is a cost-and-time choice
for diffs where the full reviewer suite would re-litigate already-closed
surfaces. Record the choice (and the >80% mechanical-line estimate) in Notes.

## Persona selector (v1 L982-1016)

After every committed Builder envelope, compute the conditional persona list
from touched file names, the batch contract, and Builder
`suggested_validator_focus`. Orchestrator may read full commit diff content
only for Builder authority checks, envelope integrity, and lightweight
correctness sanity checks; persona selection must not depend on Orchestrator
implementation analysis. When path/name signals or Builder focus are
incomplete, dispatch the default broad reviewer set. Existing path,
touched-file, and batch-contract signals that match the table below must
dispatch their validators regardless of Builder suggestion.

Before Validator dispatch, Orchestrator stops only for Builder authority
breaches or malformed envelopes; correctness concerns without an
authority/envelope violation are passed only as transient Validator focus.

### Broad-reviewer fallback

The **default broad reviewer set** is the always-on reviewer list plus every
conditional reviewer in the table below, except `ce-previous-comments-reviewer`
unless the PR or issue signal is present or unknown. Use it only when selector
evidence is incomplete enough that a path/name/focus-driven conditional set
would risk false negatives.

### Selector precedence

Existing path, touched-file, and batch-contract signals must dispatch their
validators regardless of Builder suggestion; the orchestrator stops only for
Builder authority breaches or malformed envelopes; correctness concerns become
transient Validator focus, not orchestrator-authored findings.

### Selector table (v1 L1003-1016)

| Selector signal | Persona dispatched |
| --- | --- |
| Paths, batch contract, or Builder focus matching `auth`, `session`, `token`, `password`, `crypto`, `oauth`, `sso`, `permission`, `acl`, `rbac`, `csrf` | `ce-security-reviewer` |
| Paths matching `migrations/`, `prisma/schema.prisma`, `schema.rb`, migration `*.sql` files | `ce-data-migrations-reviewer` |
| Any `index.ts`/`index.js` at a package boundary (re-exports), OpenAPI/Swagger spec, GraphQL schema | `ce-api-contract-reviewer` |
| Paths, batch contract, or Builder focus mentioning `bench`, `perf`, `virtualis`, loop-heavy large-N data, caching, or I/O-heavy work | `ce-performance-reviewer` |
| Paths, batch contract, or Builder focus mentioning retry, circuit-breaker, queue, timeout, or error-handling middleware | `ce-reliability-reviewer` |
| Files matching `*.swift`, `*.m`, `*.mm`, or paths under `ios/` | `ce-swift-ios-reviewer` |
| Files matching `*.rb`, `app/models/`, `app/controllers/`, `config/routes.rb` | `ce-dhh-rails-reviewer` AND `ce-kieran-rails-reviewer` |
| Paths, batch contract, or Builder focus for `*.tsx` React hooks/state work with race-shaped vocabulary (debounce, throttle, abort, signal, effect cleanup) | `ce-julik-frontend-races-reviewer` |
| Files matching `*.py` | `ce-kieran-python-reviewer` |
| Files matching `*.ts`/`*.tsx` AND no other language reviewer fired | `ce-kieran-typescript-reviewer` |
| The PR (if pre-existing) has prior review comments OR the issue body links a prior PR | `ce-previous-comments-reviewer` |

## Validator invocation rules (v1 L1110-1195)

1. Resolve each persona skill name against the host's available-skills list
   before dispatching. Use the exact listed name, including plugin namespace.
2. Pass each persona commit refs/ranges, touched file names, batch id, goal,
   files, `execution_mode`, acceptance tests, AC mapping, relevant ledger
   findings, and Builder evidence from the envelope (`implementation_steps`,
   `existing_seams_used`, `tests_run`, `assumptions`, `risks`, `deferred`, and
   `suggested_validator_focus`). Transient Orchestrator sanity concerns are
   passed only as Validator focus; they are not persisted as ledger entries or
   Orchestrator-authored findings.
3. Ask each persona to return this envelope:
   `{"reviewer":"<persona>","findings":[],"residual_risks":[],"testing_gaps":[]}`.
   Normalize the response before writing the ledger:
   - `findings: []`, `{"findings":[]}`, and the full envelope with an empty
     `findings` array all mean no rows from that persona.
   - Extra envelope metadata is not copied into `## Findings data`. Only
     ledger-ready findings are copied.
   - A non-empty finding is ledger-ready only when it has `id`, `batch_id`,
     `signature`, `persona`, `severity`, `status`, `summary`, and `resolution`.
   - Missing `findings`, non-array `findings`, malformed JSON or YAML, or a
     partial finding is malformed output. Rerun that persona once with the
     envelope contract. If still malformed, treat as unavailable per the
     unavailable-persona rule below and record the malformed shape in Notes.
   Produce candidate ledger rows only. Do not write `## Findings data` until
   after the dedupe step below. If every persona has empty findings, write
   `findings: []`.
4. Deduplicate normalized findings by `batch_id + signature` before writing
   the ledger. The group represents one underlying issue even when multiple
   personas report it. Keep one canonical finding row and mark the other rows
   `status: superseded` with `resolution: superseded-by-<canonical-id>`. The
   canonical row is usually open when first recorded; after convergence it may
   close normally. Choose the finding row with the highest severity as
   canonical; if multiple rows tie, the first row in stable normalized order
   wins. After dedupe, write `## Findings data`, then render the `## Findings`
   table from that data. The table's `summary` column must equal the YAML
   `summary` field verbatim; `decompose.ts --validate-findings` rejects any
   drift.
5. Finding severity must be `P0`, `P1`, `P2`, or `P3`. Finding status must be
   `open`, `fixed`, `accepted-risk`, `deferred-P2`, `deferred-P3`,
   `out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, or `superseded`. An
   open P0/P1 means `severity` is `P0` or `P1` and `status` is `open`. All
   convergence gates read this predicate from `## Findings data`, not from the
   rendered table. Run `decompose.ts --validate-findings <ledger-path>` after
   writing findings and before marking any batch converged or routing any
   P0/P1 to Builder repair. If `--validate-findings` passes, commit a
   ledger-only Validator findings checkpoint before any subsequent Builder
   repair dispatch:
   `chore(issue-{issue-number}): checkpoint <batch-id> validator findings`.
   The checkpoint may touch only the per-issue ledger path. It is
   orchestrator-owned workflow state, not a Builder commit, not a Builder
   attempt, and not part of `builder_commits` or `iterations`. Verify the
   working tree is clean after this checkpoint. A resumed run must route
   repair work from this committed findings state, never from transient
   persona output or an uncommitted findings table. Run
   `decompose.ts --assert-no-open-p0p1 <ledger-path>` before any convergence
   or ship transition that requires zero open P0/P1.
6. If a persona is unavailable, record it in Notes and continue with the
   remaining required personas. If fewer than the always-on personas can run,
   fail-stop and ask whether to use `/ce-code-review mode:report-only` as the
   validation fallback for that batch.
7. Personas are read-only by contract. If a persona's output suggests a fix,
   the runbook ignores the suggestion text; only the finding is recorded.
8. Severities (P0/P1/P2/P3) come from the persona's own rubric. The runbook
   does not re-rank.
9. P2 and P3 findings are auto-closed at batch convergence as `deferred-P2` /
   `deferred-P3`. They do NOT block the inner loop.

## Ledger findings tables (v1 ledger template L63-93)

`## Findings data` is the authoritative YAML store; the rendered `## Findings`
table is derived. Helper validation rejects drift between them. Notes accumulate
non-authoritative evidence (host omissions, malformed persona output, decisions
that did not produce a finding). The full ledger schema lives with
[ledger-and-helper.md](ledger-and-helper.md).

## Closing a finding without fixing it (v1 L1288-1301)

Allowed statuses and resolutions:

| Status | Resolution | Meaning |
| --- | --- | --- |
| `fixed` | `commit <sha>` or `patch-batch patch-NNN` or `plan-revision <sha>` or `runbook-heal <sha>` | The finding was fixed by a reachable Builder commit recorded in a terminal ledger batch, or a terminal patch-batch with reachable Builder commits. Fixed Stage 3 findings (`batch_id: stage-3`) use `plan-revision <sha>` where the SHA is the reachable plan/DAG revision that closed the finding. Fixed `batch_id: final` findings closed by an in-run orchestrator runbook self-heal use `runbook-heal <sha>` (see the `runbook-heal` row below). |
| `fixed` (runbook self-heal) | `runbook-heal <sha>` | **`batch_id: final` only.** Records a reachable commit that is an orchestrator runbook self-heal, letting an in-run runbook heal be honestly closed as `fixed` rather than fudged as `out-of-scope-for-this-issue`. **Guarded:** the cited commit's diff must touch ONLY control-plane paths (`runbooks/issue-to-pr-v2/` or `skills/issue-to-pr/`), never a deliverable file and never the per-issue ledger path `docs/runbooks/issue-to-pr/` (which is NOT control plane); the first offending path fails the gate. A merge commit (the condensed diff reports zero touched files) and a content-empty commit (mode-only chmod / zero-file) are both rejected as vacuous-proof. `plan-revision <sha>` stays the form for Stage 3 findings; `runbook-heal` is rejected for any non-`final` batch id. |
| `accepted-risk` | `accepted-risk: <reason>` | User explicitly accepted the finding; goes into PR body as a known-issue note. |
| `deferred-P2` | `deferred-P2` | Auto-closed at batch or final-review convergence (P2 severity). Surfaced in PR body. |
| `deferred-P3` | `deferred-P3` | Auto-closed at batch or final-review convergence (P3 severity). Logged only. |
| `out-of-scope-for-this-issue` | `out-of-scope-for-this-issue: <reason>` | The finding is real but belongs to a different issue. User creates the follow-up issue and notes its number here. |
| `ADR-contradicts-<id>` | `ADR-contradicts-<id>` | Finding would violate an ADR. Closed without fix. |
| `superseded` | `superseded-by-<finding-id>` | Duplicate finding kept for audit trail. The referenced finding id must exist, be the canonical non-superseded row, share the same batch id and signature, have equal-or-higher severity, and must not be itself. |

**Closing a `commit <sha>` finding is atomic with convergence.** A non-`final`
batch finding closed by `resolution: commit <sha>` can only be marked `fixed`
once its batch is terminal: `validateLedgerOwnedFixedCommit` requires the cited
commit be recorded in a terminal batch's `builder_commits`, and a batch's
commits enter that set only when its status is `converged` or `accepted-risk`.
But the batch cannot converge while the finding is `open`. Resolve the
chicken-and-egg by flipping the finding to `fixed` and the batch to `converged`
in the **same** converge checkpoint, never before — closing the finding while
the batch is still `in-progress` fails `--validate-findings` with "fixed commit
must be recorded in a terminal ledger batch". This is the same
atomic-at-convergence pattern the P2/P3 auto-close uses.

## Fix protocol (v1 README L260-279)

Fixes happen inside `batch-loop`'s **inner loop** (see
[stage-4-batch-loop.md](stage-4-batch-loop.md#inner-loop-v1-l1017-1035)). They
are NOT cross-batch. Each batch's inner loop:

**A finding whose fix belongs to a different batch.** When a validator wave on
batch X raises a finding whose fix lands in files owned by a *different,
already-confirmed* batch Y (Y's `files` already cover the fix), re-key the
finding to `batch_id: Y` so it blocks Y's convergence rather than X's, and Y
closes it with a `commit <sha>` from its own terminal batch. Re-key ONLY when Y
already owns the fixing files; if the fix needs files in no confirmed batch, use
the patch-batch path (the blessed cross-batch remediation route in
[stage-4-batch-loop.md](stage-4-batch-loop.md)) instead of re-keying. Caveat:
the per-batch open-P0/P1 convergence gate is enforced by the orchestrator
reading `## Findings data` scoped to the batch, but `--assert-no-open-p0p1` is
global — so a re-keyed open finding still blocks the whole run from advancing to
`final-review` until Y closes it; re-keying changes *which batch* the finding
blocks, not whether the run is blocked.

1. Builder commits one implementation or repair attempt scoped to the batch's
   `files`.
2. Persona suite re-runs over the new diff.
3. Orchestrator normalizes and deduplicates Validator findings, writes
   `## Findings data`, renders `## Findings`, runs `--validate-findings`, and
   commits a ledger-only Validator findings checkpoint before any repair
   Builder starts.
4. Builder repairs exactly one committed open P0/P1 finding by signature, and
   fixes only that target finding.
5. Repeat until open P0/P1 == 0 OR iteration cap hit OR an escape hatch fires.

P2 and P3 findings do NOT trigger fixes inside the inner loop. P2 findings
are auto-closed at batch convergence with status `deferred-P2` and surfaced
in the final PR body. P3 findings are auto-closed as `deferred-P3` and stay
in the ledger only (not surfaced in the PR body unless count > 5).

## Risk classification (v1 README L281-300)

Not applicable in the data-table-review sense. The persona suite returns
severity (P0/P1/P2/P3) per their existing agent contracts. The runbook gates
on P0/P1 directly. There is no separate "low-risk auto-fix" lane.

A batch is **high-risk** when any of these hold:

- The batch's `files` list touches auth, sessions, tokens, crypto, OAuth,
  SSO, permissions, ACL, RBAC, payment, billing, checkout, invoice,
  subscription, webhook, PII, privacy, admin, secrets, credentials, Stripe,
  or PayPal paths.
- The batch's `files` list touches DB migrations (`migrations/`,
  `prisma/schema.prisma`, `schema.rb`, migration `*.sql` files).
- The batch's `files` list touches an exported public API surface (a
  package's `index.ts`/`index.js` re-export, an OpenAPI/Swagger spec, a
  GraphQL schema).
- The plan or issue marks it as high-risk explicitly.

High-risk batches trigger the `risk-high-finding` escape hatch on any open
P0/P1: stop, summarise, ask the user before any inner-loop fix.

## Local glossary (v1 README L302-346)

These terms are local to the Issue-to-PR workflow until another workflow
needs them.

- **Finding**: one validator-reported issue recorded in `## Findings data`.
  It belongs to one `batch_id` or to `final`.
- **Canonical finding**: the non-superseded row that represents one
  underlying issue for one `batch_id + signature` group. It is the row read
  by the P0/P1 gate.
- **Superseded finding**: a duplicate row kept for audit trail, with
  `status: superseded` and `resolution: superseded-by-<canonical-id>`.
- **Duplicate finding group**: all findings with the same `batch_id +
  signature`. The highest-severity row is canonical; ties use the first row
  in stable normalized order.
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
  capabilities, preflight rules, authority boundary, and return envelope
  that each host maps to its own fresh Builder sub-agent per attempt.
  Source requirements:
  `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md`.
- **Builder Work Packet**: the per-attempt, batch-only payload the
  Orchestrator passes to Builder under the Builder dispatch contract.
- **Builder Preflight Checklist**: Builder's read-only readiness and
  deterministic-probe step before edits.
- **Builder attempt**: one Builder dispatch that returns a well-formed
  Builder envelope, whether it commits or Builder-authored fail-stops.
- **Host Builder readiness failure**: an Orchestrator-owned block before
  Builder exists because the host cannot provide the required fresh
  sub-agent capabilities. Recorded as `host-builder-tools-unavailable`.
  Rule body lives in [host-adapters.md](host-adapters.md).
- **Builder infrastructure failure**: a post-dispatch host, tool, permission,
  dispatch, serialization, schema, or malformed-envelope failure before a
  well-formed Builder envelope exists. Rule body lives in
  [host-adapters.md](host-adapters.md).
- **Mechanic Discipline**: the Builder rules that keep implementation local,
  reviewable, and non-architectural. Rule body lives in
  [builder-dispatch.md](builder-dispatch.md#mechanic-discipline-v1-l133-138).
- **Route hint**: a non-authoritative next-owner hint in a Builder fail-stop
  envelope. Status owns workflow transition; `route_hint` owns routing
  advice.

## /loop fallback (v1 L1302-1313)

If `/goal` is unavailable, use:

```text
/loop 60 Follow ~/.claude/runbooks/issue-to-pr/issue-to-pr.md. Target issue
is {issue-number} in {target-repo}. Re-read the runbook and the per-issue
ledger at docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md at the
start of every turn. Walk the six stages in order. Echo the ledger
frontmatter + batches YAML + findings data + findings table inline at end of
every turn. Stop when ledger frontmatter status is `shipped` or `blocked`.
```

(The `~/.claude/runbooks/issue-to-pr/issue-to-pr.md` runbook path is the
v1-era hot-router location; U7 will update the path to the v2 hot router
when the cutover lands.)

## Packet rendering contract (U5)

Validator, Proposer, and patch-proposal dispatch packets are rendered
deterministically by `lib/packets.ts`. CLI invocations:

- `cli.ts packet validator --ledger <path> --batch <id> --persona <skill>
  --commit <ref> [--touched-file <path>...] --json`
- `cli.ts packet proposer --ledger <path> --finding <id> --json`
- `cli.ts packet patch-proposal --ledger <path> --finding <id>
  --patch-id patch-NNN ... --json`

Each invocation returns a `CliSuccessEnvelope` carrying the rendered
packet data, a `packet_markdown` body, and a `dispatch_evidence` block
(timestamp, role, target id, loaded references / templates, CLI route
id). The U5 CLI is read-only; the dispatch evidence shape is *defined*
here but the write into ledger Notes lands in U6.

The per-packet allow-list / deny-list invariants are owned by the
templates ([validator-envelope.md](../templates/validator-envelope.md),
[proposer-envelope.md](../templates/proposer-envelope.md),
[patch-proposal.md](../templates/patch-proposal.md)). This reference
intentionally does not restate them — see those templates for the
contractual surface.

## See also

- [builder-dispatch.md](builder-dispatch.md) for the Builder authority boundary
  and envelope schema that Validators read.
- [stage-4-batch-loop.md](stage-4-batch-loop.md) for the inner-loop iteration
  cap, escape hatches, and patch-batch decision tree that consume Validator
  findings.
- [stage-5-final-review.md](stage-5-final-review.md) for the cumulative diff
  `/ce-code-review` invocation and the final P2/P3 closure rules.
- Templates: [`templates/validator-envelope.md`](../templates/validator-envelope.md)
  encodes the Validator return envelope this reference owns.
