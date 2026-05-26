# Stage 5: final-review reference

**Contract owner:** this reference owns Stage 5 read-only final review,
P0/P1 gate routing, final P2/P3 closure, and the Stage 5 exit condition.
Patch-batch remediation lives at
[stage-4-batch-loop.md](stage-4-batch-loop.md). Mechanical-diff fallback lives
at [findings-and-validators.md](findings-and-validators.md).

**Read trigger:** open this reference when Stage 4 has fully converged
(`batch-loop` exit condition satisfied) and the orchestrator is about to
invoke `/ce-code-review` over the cumulative diff, or when re-running Stage 5
after a patch-batch has converged. See also:
[findings-and-validators.md](findings-and-validators.md),
[stage-4-batch-loop.md](stage-4-batch-loop.md),
[stage-6-ship.md](stage-6-ship.md).

## Read-only authority

Stage 5 is read-only: this reference owns the final-review gate but never the
remediation mutation. Final-review findings that need code or contract changes
route back through Stage 4 patch-batch flow ([stage-4-batch-loop.md](stage-4-batch-loop.md))
via Proposer + confirmed Stage 4 patch batches only when they are open P0/P1
blockers. Stage 5 may mutate only the
ledger (writing `## Findings data`, updating the rendered table, setting
`final_reviewed_at`, closing P2/P3 rows) and may not edit source files,
acceptance criteria, batch contracts, or any non-ledger artifact.

### P2/P3 follow-up policy

Stage 5 patch-batch authority is reserved for open P0/P1 final-review
blockers. P2/P3 final-review findings are non-blocking deferred follow-up
work, not in-stage patch-batch work. If the operator wants to fix a genuine P2
promptly, create and drive a follow-up issue/PR, then reference that follow-up
from the ledger closure notes rather than widening Stage 5 patch-batch
authority.

Explicit lower-priority follow-up deferrals:

- `fr5-001` binding.
- `fr5-004` reachability.
- `fr5-005` shared-reader extraction.

### Blocked-by-doc-defect carve-out

Runbook self-heals discovered at final review normally route through the
`runbook-heal <sha>` closure form on a separate concern
([findings-and-validators.md](findings-and-validators.md#closing-a-finding-without-fixing-it)),
not onto the issue branch. There is one narrow exception. When a runbook
**prose** defect actually **blocks the run from continuing** (the prose is the
sole carrier of a runtime-affecting instruction, e.g. it names a non-existent
`decompose.ts` helper flag), an in-branch heal is permitted to unblock the run
and is recorded via `runbook-heal <sha>`. This is the only carve-out to the
read-only rule. Unrelated runbook defects that do not block the run stay off
the issue branch and route through the normal `runbook-heal` concern. The heal
commit is still control-plane-only: it touches `runbooks/issue-to-pr-v2/` or
`skills/issue-to-pr/`, never deliverable files and never the per-issue ledger
path.

## Inputs

Cumulative diff after all batches converged
(`git diff <default-branch>...HEAD`). Confirm Stage 4 has fully converged
by running `cli.ts state <ledger-path> --json` and verifying
`data.all_batches_terminal: true`, `data.final_reviewed_at: null`, and
`data.route_id: "final-review"`. If any of those three facts disagrees
with conversation memory, route from the envelope.

## Actions

1. **Pre-review host hygiene.** Clean up completed Builder and Validator
   agents from earlier stages when the host provides an agent close primitive
   and the run has already seen a cap-related agent failure. Do not
   preemptively reduce fanout in hosts (such as Claude Code) where
   `/ce-code-review` can run its normal suite. If cleanup is unavailable,
   continue and record that in Notes.

2. **Invoke `/ce-code-review` at the top level of this orchestrator session.**
   Pass it the diff range (current branch vs default branch). Invoke in
   read-only / report-only mode; the Builder applies fixes, not the reviewer.
   (The Builder/Validator separation is the whole point of this runbook; do
   NOT use `mode:autofix`.) Full `/ce-code-review` is the default. Only fall
   back after a concrete cap-related failure. If that happens, close completed
   agents if possible and retry the full review once. If it still cannot run,
   preserve the intended reviewer list and run report-only reviewer waves.
   Start with one reviewer per wave when remaining headroom is unknown;
   otherwise use the largest wave size the host has already proven can run.
   Close completed agents between waves when the host supports it. Prefer
   completing the full reviewer list sequentially over dropping reviewers.
   Reduce the suite only as the last fallback, keep the largest set the host
   can run, and record any omitted reviewers plus the cap reason in Notes. If
   the fallback cannot cover correctness and testing, fail-stop.

   The **Mechanical-diff fallback** lives at
   [findings-and-validators.md](findings-and-validators.md#mechanical-diff-fallback);
   this reference does not restate it.

3. **Write findings.** `ce-code-review` returns findings. Write them into
   `## Findings data` with `batch_id: final`, then update the human-readable
   `## Findings` table from that data. Run
   `decompose.ts --validate-findings <ledger-path>` before reading the open
   P0/P1 gate.

4. **Apply the P0/P1 gate.**
   - If open P0/P1 == 0 → run
     `decompose.ts --assert-no-open-p0p1 <ledger-path>`, close final-review
     P2/P3 rows as described in step 5, then advance to Stage 6.
   - If open P0/P1 > 0 → enter the **final-review inner loop**, which is the
     patch-batch decision tree owned by
     [stage-4-batch-loop.md](stage-4-batch-loop.md#final-review-patch-batch-decision-tree).
     Stage 5 hands the finding row to the Proposer; Stage 5 does not author
     edits. After all patch-batches converge, re-invoke `/ce-code-review` from
     the top of Stage 5.
   - P2/P3 final-review findings never enter the final-review inner loop.
     Close them as deferred follow-up work in step 5 unless a separate
     follow-up issue/PR has been created to own them.

5. **Final P2/P3 closure.** When `/ce-code-review` returns zero open P0/P1,
   run `decompose.ts --assert-no-open-p0p1 <ledger-path>`. Then close
   final-review P2 rows as `status: deferred-P2` and final-review P3 rows as
   `status: deferred-P3`,
   preserving their summaries and signatures. Set frontmatter
   `final_reviewed_at` to the current ISO 8601 timestamp. Update the rendered
   findings table, re-run `--validate-findings`, commit the ledger, then
   advance to Stage 6. If final review found zero findings and the table
   would not otherwise change, the `final_reviewed_at` frontmatter update is
   the required final-review checkpoint.

   **Enforce the read-only gate.** AFTER committing the final-review ledger
   checkpoint, the orchestrator MUST run
   `decompose.ts --assert-stage5-readonly <ledger-path> <checkpoint-commit-ref>`
   against that checkpoint commit. The gate asserts the checkpoint touched ONLY
   the ledger path and rejects a merge-commit checkpoint. If it fails (a
   non-ledger path was touched during final review), that is a Stage-5
   read-only violation that MUST be surfaced, not ignored: record a synthetic
   `batch_id: final` finding for the violation and fail-stop. This makes the
   gate part of the protected flow so an in-run non-ledger edit is surfaced,
   never silent. (The only sanctioned non-ledger mutation at Stage 5 is the
   blocked-by-doc-defect carve-out above, closed via `runbook-heal <sha>` on a
   separate control-plane commit, not folded into the final-review checkpoint.)

## Exit condition

`frontmatter.final_reviewed_at` is set; `## Findings data` rows with
`batch_id == final` all have status `fixed`, `accepted-risk`, `deferred-P2`,
or `deferred-P3`; working tree clean.

## See also

- [stage-4-batch-loop.md](stage-4-batch-loop.md) for the patch-batch decision
  tree and smallest-contract-patch heuristic that own remediation.
- [findings-and-validators.md](findings-and-validators.md) for the
  `/ce-code-review` mechanical-diff fallback, persona selector, and Validator
  envelope shape.
- [`templates/proposer-envelope.md`](../templates/proposer-envelope.md) for
  the read-only Proposer dispatch envelope that Stage 5 hands the cited
  finding to.
- [`templates/patch-proposal.md`](../templates/patch-proposal.md) for the
  Orchestrator-written scratch-file schema consumed by
  `decompose.ts --patch-proposal`.
- [stage-6-ship.md](stage-6-ship.md) for the next stage.
