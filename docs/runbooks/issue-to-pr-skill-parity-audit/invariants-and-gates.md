# Invariants and gates - parity seam

Verify that `skills/issue-to-pr/SKILL.md` carries every load-bearing
claim from the hot router's `## Core invariants` and `## Pre-stage
gates` sections.

The hot router calls out nine numbered invariants (durable state beats
memory, user-confirmed ACs, user-confirmed batch contract, Builder
edits only confirmed files, Validators own correctness, open P0/P1
blocks convergence, clean tree, stop on version skew or partial
install, one visible action per turn) plus two pre-stage gates
(version skew, install presence) and the discriminated-union shape of
`blocking_gates`.

This seam verifies that each of those claims has a corresponding
load-bearing statement in the skill (most likely under
`<durable_state_contract>`, `<orchestration_loop>`, or
`<pre_route_gates>`), and that nothing in the skill contradicts the
hot router on these claims.

## Files in scope

- `skills/issue-to-pr/SKILL.md` (audited; the only file edited if a
  finding is fixed in this seam)

Read-only context:

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (source of truth)
- `docs/adr/0001-stage-4-context-isolation.md`
- `docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md`

## Suggested reviewer personas

Dispatch in parallel after the scoped audit prompt runs:

- `ce-orchestration-reviewer` (gate precedence, one-visible-action
  semantics, durable-state-beats-memory)
- `ce-adr-boundary-reviewer` (placement against ADR 0001 / 0002)
- `ce-progressive-disclosure-reviewer` (no schema or runtime constants
  pulled into prose)

If those persona names do not exist in this kit, fall back to the
generic `ce-correctness-reviewer` plus a manual ADR-boundary read.

## ADR guardrails

- **ADR 0001** - Orchestrator routes and records, Builder owns one
  scoped attempt, Validators own findings. Any invariant fix must
  preserve those boundaries.
- **ADR 0002** - The skill carries judgment in prose; deterministic
  contracts stay behind `cli.ts` and `lib/route.ts`. Do not move the
  `BLOCKING_GATE_FIELD_NAMES` tuple, the route-id union, or the
  helper output schema into prose.

## Scoped audit prompt

```
/ce-code-review
Scope: skills/issue-to-pr/SKILL.md vs runbooks/issue-to-pr-v2/issue-to-pr.md
sections "Core invariants" and "Pre-stage gates" (including the
discriminated-union shape of blocking_gates).

For each of the 9 core invariants and the 2 pre-stage gates, verify:

1. The claim is present in the skill (cite file:line in both files).
2. The claim's wording is not weakened or contradicted.
3. Deterministic contracts (BLOCKING_GATE_FIELD_NAMES, ROUTE_IDS,
   RUNBOOK_VERSION) are NOT inlined into the skill - they stay in
   lib/route.ts and lib/contract.ts.
4. The install-presence gate is marked in the skill as a
   sibling-field gate, not a blocking_gates entry (F001).
5. Gate precedence: both pre-stage gates fire before route_id is
   read.

File each missing or contradicted claim into
invariants-and-gates-ledger.md with severity (P0 if unsafe
orchestration; P1 if ambiguous; P2/P3 if cosmetic).
```

## Closing a finding without fixing it

| Reason | When to use |
| --- | --- |
| `false-positive: ADR-0002` | Claim is correctly omitted from the skill because it is a deterministic contract belonging to the CLI / lib. |
| `historical-only` | Claim is present in the hot router for v1-vs-v2 compatibility and does not belong in the skill. |
| `out-of-scope: covered-by-<other-seam>` | Claim belongs to a different parity-audit seam (e.g. stage shells); do not duplicate here. |

## /loop fallback

```
/loop 10 Follow docs/runbooks/issue-to-pr-skill-parity-audit/invariants-and-gates.md.
Re-read the runbook and the ledger at the start of every turn. Extract
one claim per turn, classify it, verify presence in the skill with a
file:line citation, then file one finding row to the ledger and stop.
```

Convergence is the README's [Convergence
protocol](README.md#convergence-protocol): two consecutive independent
clean passes from different angles, not zero-open after one pass. A
pass that files or fixes a finding resets the counter.
