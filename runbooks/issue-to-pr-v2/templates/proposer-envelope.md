# Proposer envelope template

**Role:** Proposer (read-only).

**Read trigger:** the Orchestrator fills this template in when Stage 5 final
review has surfaced an open P0/P1 finding whose fix appears eligible for the
bounded patch-batch path
([`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree-v1-l806-886)).
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

The rendered packet **MUST NOT** contain any commit-write slot
(`commit_sha`, `builder_commits`), `builder_attempts` from any batch, the
full ledger contents, unrelated raw Validator envelopes, findings outside
`batch_id: final`, or whole-plan replanning prompts.

```yaml
issue_number: <int>
target_repo: "<owner/repo>"

final_finding_row:
  id: <finding-id>
  signature: <kebab-case signature>
  persona: <reviewer name>
  severity: <P0 | P1>
  summary: "<text>"
  evidence: "<reviewer evidence; read-only context>"

confirmed_batch_summaries:   # only what Proposer needs for terminal deps and file-scope checks
  - id: <batch-id>
    files: []
    status: <converged | accepted-risk>

confirmation_state_snapshot:
  acceptance_criteria: <pending | confirmed | stale | blocked>
  batch_contract: <pending | confirmed | stale | blocked>
  digests: <pending | confirmed | stale | blocked>

local_law_read_order: <see references/builder-dispatch.md>
patch_proposal_helper_contract: <see references/stage-4-batch-loop.md final-review patch-batch decision tree>
scratch_proposal_schema: <see templates/patch-proposal.md>
```

The proposal Work Packet **does not** contain unrelated raw Validator
envelopes, full ledger contents, or whole-plan replanning prompts.

## Required reading on entry

1. [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
   Local Law Read Order, authority boundary, Mechanic Discipline, and the
   constraint that Builder reads but does not write outside a confirmed batch
   contract. Apply the read order to the cited finding's files before
   proposing.
2. [`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree-v1-l806-886) —
   the patch-batch decision tree, including the ≤2-files eligibility rule,
   `new-file-patch-exception:` and `high-risk-new-file-patch-exception:`
   rationale prefixes, and the smallest-contract-patch heuristic.
3. [patch-proposal.md](patch-proposal.md) — scratch proposal schema this
   envelope produces.

## Return envelope (Proposer → Orchestrator)

The Proposer returns exactly one of the following shapes:

### Success: one candidate patch-batch

```yaml
status: candidate-patch-batch
candidate_patch_batch:
  id: patch-<NNN>
  name: "<Title>"
  goal: "<one-sentence outcome that addresses the cited finding>"
  files:
    - <repo-relative path>
  depends_on:
    - <terminal ledger-backed batch id>
  execution_mode: <tdd | proof_first | change_first>
  acceptance_tests:
    - "AC <i> holds: <verifiable behaviour>"   # patch ac_mapping is [] by design
  ac_mapping: []
  rationale: "<may begin with new-file-patch-exception: | high-risk-new-file-patch-exception: | contract-softening-exception: when applicable>"
evidence_summary: "<one paragraph: ledger and code evidence consulted; no edits performed>"
```

### Fail-stop

```yaml
status: fail-stop
blockers:
  - "<one short statement per blocker>"
probe_results:
  - "<one short statement per probe>"
route_hint: "<next-owner guidance, not authoritative>"
notes: ""
```

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
