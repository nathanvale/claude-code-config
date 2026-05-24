# Stop conditions - parity seam

Verify that `skills/issue-to-pr/SKILL.md`'s `<fail_stops>` table
carries every load-bearing stop condition from the hot router's `##
Stop-and-ask conditions outside the route id catalog` section, the
`## Stop-and-ask checklist`, and the stop_conditions embedded in each
stage shell.

Every load-bearing stop condition must have a row with: condition,
record/surface behavior, and resume condition. Detailed hatch
semantics stay in `references/findings-and-validators.md`.

## Files in scope

- `skills/issue-to-pr/SKILL.md` (audited; specifically the
  `<fail_stops>` table)

Read-only context:

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (source of truth)
- `runbooks/issue-to-pr-v2/references/findings-and-validators.md`
  (owns hatch semantics; should be pointed at, not duplicated)
- `docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md`

## Suggested reviewer personas

- `ce-orchestration-reviewer` (fail-stop completeness; resume
  conditions are explicit)
- `ce-progressive-disclosure-reviewer` (hatch detail stays in
  findings-and-validators.md)
- `ce-adr-boundary-reviewer` (ADR 0002 placement: prose names the stop,
  reference owns the mechanics)

## ADR guardrails

- **ADR 0002** - The `<fail_stops>` table is judgment-in-prose. Hatch
  semantics (`same-signature-twice`, `finding-count-rises`,
  `tautological-test`, the patch-batch rationale prefixes) belong in
  `references/findings-and-validators.md`. Names may appear in the
  skill only when the table needs to refer to them.

## Scoped audit prompt

```
/ce-code-review
Scope: skills/issue-to-pr/SKILL.md <fail_stops> table vs
runbooks/issue-to-pr-v2/issue-to-pr.md sections "Stop-and-ask conditions
outside the route id catalog" (host-builder-tools-unavailable,
builder-infrastructure-failure, no-eligible-batch, ce-plan-no-output,
no-implementation-units, decompose-parse-error, cyclic-dag,
contract-review-cycle-cap, final-review-needs-replan,
local-check-failure-*, local-check-failure-final-ledger-commit) and
"Stop-and-ask checklist" (5 items), plus each stage shell's
stop_conditions list.

For each load-bearing stop condition, verify:

1. The skill carries a row in <fail_stops> with: condition, record or
   surface, resume condition.
2. The resume condition is explicit (not "fix it" or "ask user").
3. The row points back to the owning reference (most often
   findings-and-validators.md) for detailed mechanics, not duplicating
   them.

Verify the skill does NOT inline:
- hatch names beyond what the table needs to refer to
- patch-batch rationale prefixes (contract-softening-exception, etc)
- detailed escape-hatch fire-conditions

Verify the stop-and-ask checklist's five preconditions (cli.ts state
first, route id in catalog, references loaded, ledger committed,
ledger echo) are reflected in the skill's <orchestration_loop> or
<review_loop>.

File each missing or contradicted claim into stop-conditions-ledger.md.
```

## Closing a finding without fixing it

| Reason | When to use |
| --- | --- |
| `false-positive: ADR-0002` | Detailed hatch mechanics correctly stay in `references/findings-and-validators.md`. |
| `out-of-scope: covered-by-stage-shells` | The stop condition is also enumerated in the relevant stage shell and counted there. |
| `historical-only` | The condition exists in the hot router for v1-vs-v2 compatibility and does not apply to v2-only flow. |

## /loop fallback

```
/loop 10 Follow docs/runbooks/issue-to-pr-skill-parity-audit/stop-conditions.md.
Re-read the runbook and the ledger at the start of every turn. Verify
one stop condition per turn against the skill's <fail_stops> table,
then file one finding row and stop.
```

Convergence is the README's [Convergence
protocol](README.md#convergence-protocol): two consecutive independent
clean passes from different angles, not zero-open after one pass. A
pass that files or fixes a finding resets the counter.
