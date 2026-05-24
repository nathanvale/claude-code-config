# Reference loading and routing - parity seam

Verify that `skills/issue-to-pr/SKILL.md` carries every load-bearing
claim from the hot router's `## Reference loading` and `## Router
state enumeration` sections, including both happy-path and
blocked-state route IDs and the stop-and-ask conditions outside the
route id catalog.

This seam treats the route catalog and the reference-loading table as
runtime-driven (`lib/route.ts` and the CLI's
`data.required_reference_ids`). The skill should carry an
operator-facing map of route IDs and a one-level reference policy, but
must not inline the runtime route-id union or the schema for
`blocking_gates`.

## Files in scope

- `skills/issue-to-pr/SKILL.md` (audited)

Read-only context:

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (source of truth)
- `runbooks/issue-to-pr-v2/lib/route.ts` (runtime source of truth for
  route IDs)
- `docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md`

## Suggested reviewer personas

- `ce-orchestration-reviewer` (routing from CLI facts, no prose-only
  routes)
- `ce-adr-boundary-reviewer` (ADR 0002: deterministic contracts stay
  in code)
- `ce-progressive-disclosure-reviewer` (references one level deep)

## ADR guardrails

- **ADR 0002** - The route catalog in the skill is an operator map.
  The runtime source of truth is `lib/route.ts`. Unknown route IDs
  are findings against the runtime contract, never invitations to
  invent a prose-only route.
- **ADR 0002** - References stay one level deep from the skill entry.
  No two-hop links from the skill into nested reference subtrees.

## Scoped audit prompt

```
/ce-code-review
Scope: skills/issue-to-pr/SKILL.md vs runbooks/issue-to-pr-v2/issue-to-pr.md
sections "Reference loading" and "Router state enumeration" (happy-path
stage routes, blocked-state routes, and stop-and-ask conditions outside
the route id catalog).

For each row in the hot router's reference-loading table, verify:

1. The skill carries an equivalent row in its <reference_loading_policy>
   table.
2. The reference path resolves on disk and is one level deep.
3. Templates are listed as action-specific, not as required-on-route.

For each route id in the hot router's enumeration tables, verify:

1. The skill's <route_catalog> names the same id with the same stage
   meaning.
2. The skill names lib/route.ts as the runtime source of truth.
3. The skill does NOT inline the ROUTE_IDS tuple or the
   discriminated-union shape of blocking_gates.

For each stop-and-ask condition outside the route id catalog
(host-builder-tools-unavailable, builder-infrastructure-failure,
no-eligible-batch, ce-plan-no-output, no-implementation-units,
decompose-parse-error, cyclic-dag, contract-review-cycle-cap,
final-review-needs-replan, local-check-failure-*,
local-check-failure-final-ledger-commit), verify the skill's
<fail_stops> table or stage shells reference it.

File each missing or contradicted claim into
reference-loading-and-routing-ledger.md.
```

## Closing a finding without fixing it

| Reason | When to use |
| --- | --- |
| `false-positive: ADR-0002` | Claim is a runtime constant from `lib/route.ts` that correctly stays out of the skill. |
| `out-of-scope: covered-by-stop-conditions` | Stop-and-ask conditions outside the route catalog belong to the stop-conditions seam; do not duplicate here unless the reference-loading table cites them. |
| `out-of-scope: covered-by-stage-shells` | Stage-shell stop conditions belong to the stage-shells seam. |

## /loop fallback

```
/loop 10 Follow docs/runbooks/issue-to-pr-skill-parity-audit/reference-loading-and-routing.md.
Re-read the runbook and the ledger at the start of every turn. Verify
one reference-loading row or one route id per turn, then file one
finding row and stop.
```
