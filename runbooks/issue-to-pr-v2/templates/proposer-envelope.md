# Proposer envelope template

**Role:** Proposer (read-only).

**Read trigger:** the Orchestrator fills this template in when Stage 5 final
review has surfaced an open P0/P1 finding whose fix appears eligible for the
bounded patch-batch path
([`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree)).
The proposal-only Builder sub-agent (the Proposer) reads this template on
entry. See also: [`references/stage-5-final-review.md`](../references/stage-5-final-review.md),
[patch-proposal.md](patch-proposal.md),
[`references/findings-and-validators.md`](../references/findings-and-validators.md).

## Proposer is read-only

The Proposer is dispatched as a **proposal-only Builder dispatch**. The role
is read-only and pre-confirmation. The Proposer:

- **must not** edit files;
- **must not** make commits;
- **must not** append to or modify `builder_attempts`;
- **must not** increment `iterations`;
- **must not** edit any prior Builder attempt;
- **must not** rewrite acceptance criteria, dependencies, batch contracts,
  or any ledger field outside the scratch proposal file;
- **returns** exactly one candidate patch-batch envelope (or a fail-stop) so
  the Orchestrator can route it through helper validation and user
  confirmation.

The user confirmation gate, not Proposer or reviewer output, authorizes the
patch contract. Until helper validation and user confirmation pass, the
Proposer candidate remains evidence only.

## Packet slots (orchestrator → Proposer)

**Rendered by `lib/packets.ts` (U5).** Invoke
`runbooks/issue-to-pr-v2/cli.ts packet proposer --ledger <path> --finding
<id> --json` to render this packet. The cited finding must satisfy
`batch_id: final`, severity `P0|P1`, and status `open`; otherwise the CLI
returns a `packet-render-failed` envelope.

The rendered packet body is runtime-owned by `renderProposerPacket()`.
Use `cli.ts packet proposer --json` for the concrete packet fields.
The renderer must include the cited final finding, terminal confirmed-batch
summaries, confirmation-state snapshot, and pointers to Local Law, helper
contract, and scratch schema. It must not contain any commit-write slot,
`builder_attempts` from any batch, full ledger contents, unrelated raw
Validator envelopes, findings outside `batch_id: final`, or whole-plan
replanning prompts.

The proposal Work Packet **does not** contain unrelated raw Validator
envelopes, full ledger contents, or whole-plan replanning prompts.

## Required reading on entry

1. [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
   Local Law Read Order, authority boundary, Mechanic Discipline, and the
   constraint that Builder reads but does not write outside a confirmed batch
   contract. Apply the read order to the cited finding's files before
   proposing.
2. [`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree) —
   the patch-batch decision tree, including the ≤2-files eligibility rule,
   `new-file-patch-exception:` and `high-risk-new-file-patch-exception:`
   rationale prefixes, and the smallest-contract-patch heuristic.
3. [patch-proposal.md](patch-proposal.md) — scratch proposal schema this
   envelope produces.

## Return envelope (Proposer → Orchestrator)

The Proposer returns exactly one of the following shapes:

### Success: one candidate patch-batch

Concrete envelope shape:
`cli.ts scaffold proposer-success-envelope --json`.

The embedded `candidate_patch_batch` object matches one entry from
`cli.ts scaffold patch-proposal-candidate-batch --json`. The scaffold root
`patch_batches:` is scratch-file wrapping only. Proposer returns its single
list item under `candidate_patch_batch`; Orchestrator wraps that object into
`patch_batches:` when writing the scratch file.

### Fail-stop

Concrete envelope shape:
`cli.ts scaffold proposer-fail-stop-envelope --json`.

Allowed fail-stop reasons include (but are not limited to): finding evidence
does not match the cited ledger or code state; eligible-file count exceeds 2
without a justified exception; cited file already converged under a different
contract; cited finding is genuine behaviour drift requiring full-sweep
replan; cited finding contradicts an ADR.

## What the Proposer must not do

This list restates the role boundary above and is enforced by the
Orchestrator's envelope validation:

- The Proposer **does not** open `## Findings data` rows owned by Builder or
  Validator for edit. Findings remain owned by the Validator persona that
  filed them and by the Orchestrator that records them.
- The Proposer **does not** rewrite, append to, or annotate prior
  `builder_attempts` rows. Those rows belong to the Builder envelopes that
  produced them.
- The Proposer **does not** write to `## Batches`. Only the Orchestrator
  appends a confirmed patch-batch after helper validation and user
  confirmation succeed.
- The Proposer **does not** invoke `git commit`, `git push`, or any
  filesystem write. The Orchestrator translates the Proposer's returned
  envelope into the scratch proposal file described in
  [patch-proposal.md](patch-proposal.md); the Proposer never writes that file
  itself.

## See also

- [patch-proposal.md](patch-proposal.md) — scratch-file schema consumed by
  `decompose.ts <patch-proposal-path> --patch-proposal <ledger-path>`.
- [`references/stage-5-final-review.md`](../references/stage-5-final-review.md) —
  read-only final-review gate that routes findings through this Proposer
  envelope.
- [validator-envelope.md](validator-envelope.md) — distinct read-only role
  that files findings (Validator) versus this read-only role that proposes
  remediation contracts (Proposer).
