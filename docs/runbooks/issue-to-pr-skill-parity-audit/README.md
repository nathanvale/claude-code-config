# Issue-to-PR Skill Parity Audit

Verify that `skills/issue-to-pr/SKILL.md` carries every load-bearing
claim from `runbooks/issue-to-pr-v2/issue-to-pr.md` that it is supposed
to carry under the ADR 0001 / ADR 0002 placement contract.

The
[`docs/plans/2026-05-24-003-refactor-issue-to-pr-skill-control-plane-plan.md`](../../plans/2026-05-24-003-refactor-issue-to-pr-skill-control-plane-plan.md)
refactor checked the skill against the plan. This audit is the inverse
check: the skill against the hot router as source-of-truth.

This area follows the `runbook-orchestrator` convention. Each seam
covers one domain of the hot router and verifies that the skill carries
the load-bearing claims for that domain.

## Why these seams

The hot router's load-bearing surface decomposes into five domains.
Each domain has different stop conditions, different placement rules,
and different reviewers, so each is its own seam.

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
| Invariants and gates | [invariants-and-gates.md](invariants-and-gates.md) | [invariants-and-gates-ledger.md](invariants-and-gates-ledger.md) | `skills/issue-to-pr/SKILL.md` |
| Reference loading and routing | [reference-loading-and-routing.md](reference-loading-and-routing.md) | [reference-loading-and-routing-ledger.md](reference-loading-and-routing-ledger.md) | `skills/issue-to-pr/SKILL.md` |
| Stage shells | [stage-shells.md](stage-shells.md) | [stage-shells-ledger.md](stage-shells-ledger.md) | `skills/issue-to-pr/SKILL.md` |
| Stop conditions | [stop-conditions.md](stop-conditions.md) | [stop-conditions-ledger.md](stop-conditions-ledger.md) | `skills/issue-to-pr/SKILL.md` |
| Placement and ADRs | [placement-and-adrs.md](placement-and-adrs.md) | [placement-and-adrs-ledger.md](placement-and-adrs-ledger.md) | `skills/issue-to-pr/SKILL.md`, `runbooks/issue-to-pr-v2/issue-to-pr.md`, `runbooks/issue-to-pr-v2/README.md` |

## Suggested execution order

1. Invariants and gates
2. Reference loading and routing
3. Stage shells
4. Stop conditions
5. Placement and ADRs

The first four are extraction-and-verify against load-bearing prose.
The last seam (placement-and-adrs) reads as a cross-cutting check
across the prior four ledgers, so it runs last.

## Source-of-truth contract

This framing is **migration-only**. The skill is the public control
plane post-promotion; the hot router's role in this audit is the
migration baseline against which the promotion is verified, not the
standing source of truth.

For every seam in this area:

- `runbooks/issue-to-pr-v2/issue-to-pr.md` is the **migration-baseline
  source of truth** for load-bearing claims that pre-date the skill
  control-plane promotion. This baseline framing exists solely to
  verify nothing load-bearing was dropped during the promotion.
- `skills/issue-to-pr/SKILL.md` is the **audited artifact** and the
  **standing public control plane**. After this audit converges, the
  skill is the source of truth and the hot router becomes
  compatibility/support only.
- ADR 0001 and ADR 0002 are the **placement authority** deciding
  whether a claim must be in the skill, in the runbook, or either.

The audit does not assume the skill must contain everything in the
runbook. It asks: of the claims that must live in the control plane
per ADR boundaries, are any missing?

### Post-audit disposition

When all five seams converge:

- The skill is the standing source of truth for the Issue-to-PR
  workflow.
- `runbooks/issue-to-pr-v2/issue-to-pr.md` becomes compatibility /
  support material only - no further competing-router edits.
- A follow-up runbook (not this one) may thin or freeze the hot
  router. That decision is out of scope here.

## Claim categories

Every claim extracted in any seam falls into exactly one category:

| Category | Where it must live | Example |
| --- | --- | --- |
| Orchestration authority | Skill (control plane) | Pre-route gate precedence, one-visible-action invariant |
| Mechanic | CLI / helper / `lib/route.ts` | Route classification logic, ledger schema |
| Repeated handoff | Templates | Builder Work Packet shape |
| Rare explanation | References | Hatch semantics, persona selection |
| Historical / compatibility | Hot router only | Legacy `/loop` prompt body, v1-vs-v2 skew prose |
| Cross-cutting | Both skill and runbook with cross-link | Reference-loading policy summary |

## Ledger format

Each ledger follows the orchestrator convention shape. One row per
finding:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer (001, 002, ...) | Sequential per seam |
| `signature` | kebab-case string | Stable dedupe key across passes |
| `status` | `open` / `fixed` / `closed` | Drives convergence |
| `risk` | `low` / `high` | Drives auto-fix gate |
| `summary` | one-line | Human-readable description |
| `resolution` | string | Commit SHA, close reason, or `pending-nathan` |

### Resolution conventions

| Resolution | Meaning |
| --- | --- |
| `commit <sha>` | Fix landed in named commit |
| `pending-nathan` | High-risk; awaiting user decision |
| `pending-fix` | Low-risk; queued for implementer |
| `out-of-scope: <reason>` | Not this seam's concern |
| `false-positive: <adr-id>` | Correctly omitted from skill per ADR placement |
| `historical-only` | Lives only in the hot router by design |

## Fix protocol

When a seam ledger has open P0/P1 findings:

1. The seam's runbook `/goal` invocation re-enters the seam with the
   open findings already filed.
2. The implementer agent reads `skills/issue-to-pr/SKILL.md` and the
   cited section of `runbooks/issue-to-pr-v2/issue-to-pr.md`.
3. The agent edits only `skills/issue-to-pr/SKILL.md` (the audited
   artifact). The hot router is read-only in this audit.
4. The agent runs the seam's scoped audit prompt again, expects the
   open findings to be closed, and stops if any open finding remains.

### Hard constraints (apply to every seam)

These constraints carry forward from the original refactor plan and
apply to every fix made in this audit area:

- Do not duplicate the v2 hot router into `skills/issue-to-pr/SKILL.md`.
- Do not move deterministic YAML/JSON/runtime contracts into prose.
- Do not wrap helper-validated YAML or JSON in XML.
- Keep Codex first-class; `/goal` and `/loop` stay scoped to the
  Claude Code host adapter.
- Preserve Stage 4 one-visible-action-per-turn semantics.
- Preserve ADR 0001 role boundaries (Orchestrator / Builder /
  Validator / Proposer).
- Preserve ADR 0002 placement rules (prose / CLI / templates /
  references / README).
- No new ADR unless the audit surfaces a durable new boundary not
  already covered by ADR 0001 or 0002.

## Invocation

Each seam has its own `/goal` invocation block below. The
runbook-orchestrator's `launch` subcommand reads these and copies them
verbatim. Do not invoke `/goal` from inside a skill.

### Invariants and gates

```
/goal Follow docs/runbooks/issue-to-pr-skill-parity-audit/invariants-and-gates.md.
Source of truth: runbooks/issue-to-pr-v2/issue-to-pr.md sections
"Core invariants" and "Pre-stage gates" (including the
discriminated-union shape of blocking_gates).
Audited artifact: skills/issue-to-pr/SKILL.md.
Re-read the runbook and the ledger at the start of every turn.
Extract claims, classify, verify presence in the skill with line
citations, file findings into invariants-and-gates-ledger.md, then
converge to zero open P0/P1.
```

### Reference loading and routing

```
/goal Follow docs/runbooks/issue-to-pr-skill-parity-audit/reference-loading-and-routing.md.
Source of truth: runbooks/issue-to-pr-v2/issue-to-pr.md sections
"Reference loading" and "Router state enumeration" (happy-path stage
routes, blocked-state routes, and stop-and-ask conditions outside the
route id catalog).
Audited artifact: skills/issue-to-pr/SKILL.md.
Re-read the runbook and the ledger at the start of every turn.
Extract claims, classify, verify presence in the skill, file findings
into reference-loading-and-routing-ledger.md, converge to zero open
P0/P1.
```

### Stage shells

```
/goal Follow docs/runbooks/issue-to-pr-skill-parity-audit/stage-shells.md.
Source of truth: runbooks/issue-to-pr-v2/issue-to-pr.md sections
"Stage shells" (Stage 1 through Stage 6) and "Patch-batch playbook".
Audited artifact: skills/issue-to-pr/SKILL.md (the <stage_shells>
section).
Re-read the runbook and the ledger at the start of every turn.
Extract claims, classify, verify each stage shell carries inputs,
required references, one visible action, exit condition, and stop
conditions in the skill. Stage 4 subroutes must be enumerated.
File findings into stage-shells-ledger.md, converge to zero open
P0/P1.
```

### Stop conditions

```
/goal Follow docs/runbooks/issue-to-pr-skill-parity-audit/stop-conditions.md.
Source of truth: runbooks/issue-to-pr-v2/issue-to-pr.md sections
"Stop-and-ask conditions outside the route id catalog", "Stop-and-ask
checklist", and the stop_conditions inside every stage shell.
Audited artifact: skills/issue-to-pr/SKILL.md (the <fail_stops>
table).
Re-read the runbook and the ledger at the start of every turn.
Extract claims, classify, verify every load-bearing stop condition has
a row in the <fail_stops> table with a resume condition. File
findings into stop-conditions-ledger.md, converge to zero open P0/P1.
```

### Placement and ADRs

```
/goal Follow docs/runbooks/issue-to-pr-skill-parity-audit/placement-and-adrs.md.
Source of truth: docs/adr/0001-stage-4-context-isolation.md,
docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md, plus
the four prior seam ledgers in this area.
Audited artifacts: skills/issue-to-pr/SKILL.md,
runbooks/issue-to-pr-v2/issue-to-pr.md,
runbooks/issue-to-pr-v2/README.md.
Re-read the prior four ledgers at the start of every turn. Confirm
every claim closed as false-positive cites the correct ADR clause and
that the skill / hot router / README cross-link contract is intact.
File findings into placement-and-adrs-ledger.md, converge to zero
open P0/P1.
```

## /loop fallback

If `/goal` is not available, replace `/goal` with `/loop 10` in any of
the invocations above. The loop body is the same.

## What this area deliberately does not do

- Live execution against a GitHub issue. That gate stays open per the
  original refactor plan.
- Rewrites of `runbooks/issue-to-pr-v2/issue-to-pr.md`. It is the
  read-only source of truth.
- Automated XML-shape lint for the skill. Deferred.
- `CONTEXT.md` edits or new ADRs, unless a seam surfaces durable new
  terminology.
