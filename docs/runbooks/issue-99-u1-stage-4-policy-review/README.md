# Issue #99 U1 Stage 4 policy review - iterative review runbook

Single-seam runbook for reviewing the **U1 implementation on this branch**
(`feat/issue-99-stage-4-dispatch-policy`) against the U1 spec in
[docs/plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md](../../plans/2026-05-21-001-feat-builder-work-packet-dispatch-plan.md).

U1 ("Refresh Builder Role Boundaries and Stage 4 Policy") is a **prose/contract**
unit: it rewrites ADR 0001 and ADR 0003 and aligns the active skill router, v1
source anchors, and v2 references so they all describe the same host-neutral
Stage 4 dispatch policy. There is no runtime behavioural test for the policy
prose itself; verification is markdown review, ADR consistency review, and
targeted text search (per the plan's U1 proof expectation).

The seam converges via the [Convergence protocol](#convergence-protocol): two
consecutive independent review passes that each produce zero new findings. This
area has exactly one seam.

## Why this seam

U1's acceptance tests assert three cross-document invariants:

- **R1** - `tdd` and `proof_first` require Builder dispatch; `change_first` is
  inline-eligible only while bounded and obvious.
- **R5** - every committed implementation attempt (Builder or inline) routes to
  the full Stage 4 Validator wave.
- **R8** - ADRs, v1 anchors, v2 references, and the active skill router describe
  the same host-neutral policy with no Claude-specific or Codex-specific
  primitive names.

The failure class this seam guards is **policy drift across documents**: the ADR
says one thing, the skill router says another, or a host-specific primitive name
leaks into shared prose. The review surface is the 8 files U1 owns.

**Contract-shaped seams**:

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
| U1 Stage 4 dispatch policy | [u1-stage-4-policy.md](u1-stage-4-policy.md) | [u1-stage-4-policy-ledger.md](u1-stage-4-policy-ledger.md) | Writable: the 8 U1 plan files (2 ADRs, SKILL.md, v1 README + issue-to-pr.md, v2 issue-to-pr.md + stage-4-batch-loop.md + builder-dispatch.md). Read-only: everything else, including U3/U6 files (`host-adapters.md`, `findings-and-validators.md`), `stage-4-policy-drift.test.ts`, `settings.json`, all `lib/*.ts`, templates, and the plan itself. |

## Invocation

```text
/goal Follow docs/runbooks/issue-99-u1-stage-4-policy-review/u1-stage-4-policy.md.
Re-read the runbook and u1-stage-4-policy-ledger.md at the start of every turn.
Drive every ledger row to status fixed or closed, then converge per the README
Convergence protocol (two consecutive independent /ce-code-review passes that
each return zero new findings, not zero-open after one pass). Echo the full
ledger status table inline at the end of every turn. Stop after 30 turns.
```

## Driver: /goal vs /loop

| | `/goal` (preferred) | `/loop` (fallback) |
| --- | --- | --- |
| Re-fire trigger | Previous turn finishes | Time interval elapses |
| Stop condition | Evaluator model confirms condition holds | You stop it, or agent decides |
| Verifies via | Conversation transcript only | Same |
| Min version | Claude Code v2.1.139+ | Any |

`/goal`'s evaluator reads only the **conversation transcript**, not the
filesystem. The runbook echoes the ledger status table inline at the end of each
turn so the evaluator can see convergence.

## Turn protocol (shared)

The seam runbook defines:

1. Files in scope
2. Suggested reviewer personas (passed to `/ce-code-review`)
3. The scoped audit prompt for `/ce-code-review`
4. Seam-specific ADR guardrails

Each turn:

1. Read the runbook and the seam's ledger fresh
2. Run `/ce-code-review` with the scoped audit prompt and suggested personas
3. For each finding, compute a stable kebab-case signature
4. Dedupe against the ledger (fixed/closed -> drop; open match -> leave; else insert new open row)
5. Classify each open finding `low` | `high` per the risk policy below
6. For `high`: pause and ask the user
7. Apply the [Fix protocol](#fix-protocol-shared) to the approved queue
8. Re-run `/ce-code-review` and repeat dedupe
9. Echo the full ledger status table inline at the end of every turn

Stop condition: every ledger row is `fixed` or `closed`, and the seam meets the
[Convergence protocol](#convergence-protocol).

## Fix protocol (shared)

For each open finding:

1. Confirm the signature is not already `fixed` or `closed`.
2. If risk is `high`, stop and ask Nathan before editing.
3. If risk is `low`, make the smallest prose edit to a writable in-scope file
   that resolves the finding. Keep all anti-list files read-only.
4. Update the ledger row with `status: fixed` or `status: closed` and a concise
   resolution.
5. Re-run the relevant consistency check (targeted text search across the 8
   files; ADR-vs-router cross-read).
6. Re-run `/ce-code-review`. New findings get new stable signatures; repeat.

## Convergence protocol

A seam is converged when **two consecutive independent review passes each return
zero new findings** - not when the ledger first shows every row `fixed` or
`closed`.

Each pass must:

1. **Re-extract from scratch.** Re-read all 8 U1 files and the U1 spec, then
   re-derive the policy claim inventory from the text. Do not reuse the prior
   pass's mental list.
2. **Attack from a different angle.** Rotate the lens: pass one reads ADR ->
   router for top-down consistency; pass two greps every Stage 4 policy claim
   (Builder-required modes, inline eligibility bounds, repair routing, wave
   floor) across all 8 files and checks each claim agrees everywhere; a third
   angle audits for host-specific primitive name leaks.
3. **Reset the counter on any fix.** A pass that files or fixes a finding is not
   clean. Convergence requires two clean passes in a row after the last change.

A seam re-launched via `/runbook-orchestrator launch` or `/loop` re-enters this
protocol from pass one.

## Risk classification (auto-fix gate)

**Low risk - auto-fix without asking:**

- Wording alignment across the 8 in-scope files to make the same policy claim
  read consistently (e.g. matching the inline-eligibility bound list, matching
  the "every committed implementation attempt" phrasing)
- Fixing a dangling cross-reference or stale anchor within an in-scope file
- Removing an accidental Claude-specific / Codex-specific primitive name from
  shared prose, replacing it with the host-neutral term
- Ledger bookkeeping

**High risk - pause and ask:**

- Any change that alters the **meaning** of the U1 policy (which modes require
  Builder, what bounds inline eligibility, the repair-routing rule, the wave
  floor) rather than aligning wording to the already-decided policy
- Any edit to a file outside the 8 in-scope files
- Any change that contradicts ADR 0001, 0002, or 0003
- Reopening a Resolved-During-Planning decision from the U1 spec

## Ledger format

```markdown
| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

## Closing reports

When the seam converges:

```text
/runbook-orchestrator report docs/runbooks/issue-99-u1-stage-4-policy-review u1-stage-4-policy
```

## Parallel execution

Do **not** run multiple runbooks concurrently in the same checkout. Run
sequentially, or use separate worktrees (`compound-engineering:ce-worktree`).
