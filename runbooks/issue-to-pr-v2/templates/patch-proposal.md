# Patch proposal scratch-file template

**Role:** Orchestrator-written scratch artifact derived from the Proposer's
returned envelope.

**Read trigger:** the Orchestrator writes one scratch file in this shape -
using the Proposer's returned candidate envelope - so the
`--patch-proposal` helper invocation declared in
[`references/ledger-and-helper.md`](../references/ledger-and-helper.md) can
validate it before the user confirmation gate. The Proposer itself returns
the envelope and performs no filesystem write; the Orchestrator translates
that return into this scratch file. See also:
[proposer-envelope.md](proposer-envelope.md),
[`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree),
[`references/stage-5-final-review.md`](../references/stage-5-final-review.md).

The scratch file is **Orchestrator-owned audit context** captured from the
Proposer's read-only return envelope, not a confirmed batch. The Proposer
never edits, appends to, commits, or pushes any file. Only after the helper
validation passes and the user confirms does the Orchestrator append the
patch-batch row to the ledger's `## Batches` and continue.

## Helper contract

Invoke `decompose.ts <patch-proposal-path> --patch-proposal <ledger-path>`.
The canonical helper invocation path lives in
[`references/ledger-and-helper.md`](../references/ledger-and-helper.md). The
full validation list is owned by
[`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree):
exact fields, concrete paths, terminal ledger-backed dependencies, exactly
one patch batch, files already in confirmed ledger scope unless
`new-file-patch-exception:` is present, high-risk new files only when
`high-risk-new-file-patch-exception:` is present, `execution_mode`,
`acceptance_tests`, patch `ac_mapping: []`, and `change_first` guardrails.

## Scratch file shape

**Rendered by `lib/packets.ts` (U5).** Invoke
`runbooks/issue-to-pr-v2/cli.ts packet patch-proposal --ledger <path>
--finding <id> --patch-id patch-NNN --patch-name "<title>" --patch-goal
"<sentence>" --patch-file <path>... --patch-depends-on <terminal-id>...
--patch-execution-mode <mode> --patch-acceptance-test "<test>"...
--patch-rationale "<text>" --json` to render the scratch file body. The
renderer enforces: exactly one `patch_batches` entry, `ac_mapping: []`,
and a `patch-NNN` id shape.

The rendered scratch **MUST NOT** include more than one `patch_batches`
entry, wildcard paths, non-empty `ac_mapping`, or findings beyond the
cited `final_finding`.

The scratch file is a fenced YAML document (no XML-style wrapping). Exactly
one entry under `patch_batches`. Concrete paths only; no wildcards.

```yaml
final_finding:
  id: <ledger finding id>
  signature: <stable kebab-case signature>
  persona: <reviewer name>
  severity: <P0 | P1>
  summary: "<verbatim from ## Findings data>"

patch_batches:
  - id: patch-<NNN>            # incrementing; helper rejects collisions with existing ledger ids
    name: "<Title>"
    goal: "<one-sentence outcome that addresses final_finding.signature>"
    files:
      - <repo-relative path>   # must already be in some confirmed batch's files
                               # OR carry an explicit rationale prefix (see below)
    depends_on:
      - <terminal ledger-backed batch id>   # converged or accepted-risk
    execution_mode: <tdd | proof_first | change_first>
    acceptance_tests:
      - "AC <i> holds: <verifiable behaviour>"
    ac_mapping: []   # patch batches do not map to ACs by design
    rationale: |
      <free-form prose; may start with one of:
       - new-file-patch-exception: <reason>
       - high-risk-new-file-patch-exception: <reason>
       - contract-softening-exception: <reason>
       - change_first-exception: <reason>
       - high-risk-change_first-exception: <reason>
       when the helper rules require it>
```

## Rationale prefixes

- `new-file-patch-exception:` — at least one file in `files` is not already in
  any confirmed batch's `files`, but it is a new file of comparable shape
  (e.g. a test sibling). Helper validation requires this prefix when a new
  file appears.
- `high-risk-new-file-patch-exception:` — required instead of
  `new-file-patch-exception:` when the new file lands in auth, payment, API,
  data, privacy, or other high-risk paths.
- `contract-softening-exception:` — required by the smallest-contract-patch
  heuristic: the patch adjusts the *contract* the finding cites (a doc
  claim, an acceptance test, a comment, or a runbook section) rather than the
  full implementation surface.
- `change_first-exception:` / `high-risk-change_first-exception:` —
  required when `execution_mode: change_first` lands on non-doc paths or
  high-risk paths respectively.
- `replacement-contract:` — recommended (per v2 ledger template) when the
  replacement batch flow ([builder-dispatch.md](../references/builder-dispatch.md))
  supersedes a blocked original and the rationale documents the contract
  delta.

## What the Proposer must not include

- Any `## Findings data` row edits. Final-finding rows are updated by the
  Orchestrator after a patch-batch converges, not by the Proposer.
- Any modification to `prior_builder_attempts` from the Builder template. The
  Proposer never edits Builder attempts.
- More than one entry under `patch_batches`. Helper validation rejects two or
  more entries.
- Wildcard paths, glob patterns, or `*` placeholders in `files`.
- `ac_mapping` values. Patch batches always carry `ac_mapping: []`.

## Confirmed-flow recap (orchestrator)

After helper validation passes, the Orchestrator prints the validated
patch-batch and asks the user to confirm files, dependencies, execution
mode, tests, and rationale. On `y`, append the confirmed row to `## Batches`,
mark `status: pending`, recompute `batch_contract_digest`, keep
`batch_contract_confirmation_status: confirmed`, update
`batch_contract_confirmed_at`, run `--confirmation-state`, and return to
Stage 4 to converge the patch-batch.

## See also

- [proposer-envelope.md](proposer-envelope.md) — Proposer dispatch envelope
  that produces this scratch file.
- [`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree) —
  authoritative decision tree and helper validation list.
- [`references/stage-5-final-review.md`](../references/stage-5-final-review.md) —
  read-only final-review gate that routes the cited finding here.
