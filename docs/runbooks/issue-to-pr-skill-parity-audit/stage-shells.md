# Stage shells - parity seam

Verify that `skills/issue-to-pr/SKILL.md`'s `<stage_shells>` section
carries every load-bearing claim from the hot router's `## Stage
shells` section (Stages 1 through 6) and the `## Patch-batch playbook`
section, including the Stage 4 subroutes enumeration.

Each stage shell must declare inputs, required references, one visible
action, exit condition, and stop conditions. Stage 4 is the
highest-risk: it must enumerate the seven subroutes and assert that
only one subroute is the visible action per turn.

## Files in scope

- `skills/issue-to-pr/SKILL.md` (audited; specifically the
  `<stage_shells>` section)

Read-only context:

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (source of truth)
- `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md` through
  `stage-6-ship.md` (deeper mechanics; should not be duplicated)
- `docs/adr/0001-stage-4-context-isolation.md`

## Suggested reviewer personas

- `ce-orchestration-reviewer` (one-visible-action semantics, exit
  conditions)
- `ce-adr-boundary-reviewer` (ADR 0001 role separation; Stage 4 subroutes
  do not blur Orchestrator / Builder / Validator)
- `ce-progressive-disclosure-reviewer` (each shell stays an entrypoint,
  not a copy of the per-stage reference)

## ADR guardrails

- **ADR 0001** - Stage 4 subroutes must preserve Orchestrator (routes
  + records), Builder (one scoped attempt against confirmed
  `batch.files`), Validator (correctness findings), Proposer
  (Stage 5 patch-batch only) boundaries.
- **ADR 0002** - Each stage shell is judgment-in-prose. Deep stage
  mechanics live in `references/stage-*.md`. Schemas, full hatch
  semantics, and packet shapes are NOT inlined in the shells.

## Scoped audit prompt

```
/ce-code-review
Scope: skills/issue-to-pr/SKILL.md <stage_shells> section vs
runbooks/issue-to-pr-v2/issue-to-pr.md sections "Stage shells" (Stages
1-6) and "Patch-batch playbook".

For each stage shell (Stage 1 through Stage 6), verify the skill carries:

1. Inputs.
2. Required references (one level deep, paths resolve on disk).
3. One visible action.
4. Exit condition (matches hot router's exit condition, or is
   strictly tighter).
5. Stop conditions (matches hot router's stop conditions; missing or
   added stop conditions are findings).

For Stage 4 specifically, verify the skill enumerates all seven
subroutes:
- select-eligible-batch
- start-batch-checkpoint
- builder-attempt
- validator-wave
- finding-repair
- converge-batch
- accepted-risk-or-reframe

And asserts: only one subroute is the visible action for a turn.

Verify Stage 5 read-only invariant: a final-review P0/P1 routes through
the Proposer / patch-batch path, never becomes an Orchestrator-authored
implementation fix.

Verify no stage shell inlines: hatch names, ROUTE_IDS, packet schemas,
ledger schema, or per-stage reference body text.

File each missing or contradicted claim into stage-shells-ledger.md.
```

## Closing a finding without fixing it

| Reason | When to use |
| --- | --- |
| `false-positive: ADR-0002` | The omitted detail is deep stage mechanics belonging to `references/stage-*.md`. |
| `out-of-scope: covered-by-stop-conditions` | The stop condition is also tracked in the stop-conditions seam; do not duplicate. |
| `out-of-scope: covered-by-invariants-and-gates` | The claim is one of the 9 core invariants; tracked by that seam. |

## /loop fallback

```
/loop 10 Follow docs/runbooks/issue-to-pr-skill-parity-audit/stage-shells.md.
Re-read the runbook and the ledger at the start of every turn. Verify
one stage shell field per turn (e.g. Stage 3 exit condition), then file
one finding row and stop.
```
