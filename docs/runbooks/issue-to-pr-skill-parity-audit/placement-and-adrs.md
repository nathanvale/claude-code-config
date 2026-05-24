# Placement and ADRs - cross-cutting parity seam

Cross-cutting verification across the four prior seams. Confirms:

1. Every claim closed as `false-positive: ADR-*` in a prior ledger
   cites the correct ADR clause.
2. The skill / hot router / README cross-link contract is intact:
   - Skill is the public control plane.
   - Hot router is named the v2 hot-router support file and explicitly
     cedes public authority to the skill.
   - README is a finder; it points at the skill as the first file-map
     entry and treats the hot router as a support reference.
3. No claim that should be in the skill was closed as
   `historical-only`, and no claim that should stay in the hot router
   was incorrectly elevated into the skill.

This seam runs **last** in the suggested execution order, because it
reads as a meta-check across the prior four ledgers.

## Files in scope

- `skills/issue-to-pr/SKILL.md`
- `runbooks/issue-to-pr-v2/issue-to-pr.md`
- `runbooks/issue-to-pr-v2/README.md`

Read-only context:

- `docs/adr/0001-stage-4-context-isolation.md`
- `docs/adr/0002-runbooks-and-skills-use-prose-as-orchestrator.md`
- The four prior parity-audit ledgers in this area.

## Suggested reviewer personas

- `ce-adr-boundary-reviewer` (primary; verifies every ADR citation)
- `ce-progressive-disclosure-reviewer` (README is a finder; hot router
  is support; skill is control plane)
- `ce-orchestration-reviewer` (host-adapter section keeps `/goal` and
  `/loop` scoped to Claude Code)

## ADR guardrails

- **ADR 0001** - Role boundaries (Orchestrator / Builder / Validator /
  Proposer) appear in the skill, not in the hot router as authority.
  The hot router may restate them for compatibility but does not own
  them.
- **ADR 0002** - The placement rule (prose / CLI / templates /
  references / README) is followed across all three files. Any
  exception must be justified and recorded.
- **No new ADR** unless this seam surfaces a durable boundary not
  already covered by 0001 or 0002. Candidates for promotion would
  include "skill control plane" or "host adapter" as canonical terms;
  capture in CONTEXT.md only if the audit decides they should become
  glossary terms.

## Scoped audit prompt

```
/ce-code-review
Scope: cross-cutting placement check across all four prior
parity-audit ledgers, skills/issue-to-pr/SKILL.md,
runbooks/issue-to-pr-v2/issue-to-pr.md, and
runbooks/issue-to-pr-v2/README.md.

Verify:

1. Every finding closed as false-positive: ADR-0001 or false-positive:
   ADR-0002 in invariants-and-gates-ledger.md,
   reference-loading-and-routing-ledger.md, stage-shells-ledger.md, or
   stop-conditions-ledger.md cites the correct ADR clause and the cite
   is accurate.

2. skills/issue-to-pr/SKILL.md frontmatter description names this as
   the host-neutral control plane.

3. runbooks/issue-to-pr-v2/issue-to-pr.md opens with language that
   cedes public-control-plane authority to skills/issue-to-pr/SKILL.md
   and frames itself as the support / compatibility reference. The
   header (title plus opening paragraphs) must make this unambiguous
   to a reader who has never seen the migration: a fresh reader must
   not be able to recover the pre-migration mental model in which
   issue-to-pr.md was the authoritative router. Missing or weak
   framing in the header is a P0 finding; a later section restating
   workflow policy without a back-pointer to the skill is a P1
   finding.

4. runbooks/issue-to-pr-v2/README.md is a finder, not a policy manual:
   it lists the skill control plane first in the file map, names the
   hot router as a support file, and does not duplicate workflow
   policy.

5. Codex remains first-class in the skill's <host_adapters> block.
   `/goal` and `/loop` appear only inside Claude Code adapter notes.

6. No claim that should live in the skill was closed as
   historical-only in any prior ledger.

7. No claim that should stay in the hot router was elevated into the
   skill.

8. CONTEXT.md was not edited and no new ADR was created, unless this
   audit surfaces a durable new term or boundary.

File each missing or contradicted claim into
placement-and-adrs-ledger.md.
```

## Closing a finding without fixing it

| Reason | When to use |
| --- | --- |
| `false-positive: deliberate-redundancy` | The claim is correctly carried in both the skill and the hot router with cross-links, per the cross-cutting category. |
| `out-of-scope: covered-by-<other-seam>` | The claim is owned by one of the four prior seams; this seam only verifies the cross-cutting placement. |
| `pending-context-md` | The claim warrants promotion to CONTEXT.md; do not edit CONTEXT.md unilaterally - escalate to the user. |

## /loop fallback

```
/loop 10 Follow docs/runbooks/issue-to-pr-skill-parity-audit/placement-and-adrs.md.
Re-read the runbook and the ledger at the start of every turn. Verify
one ADR citation or one cross-link per turn, then file one finding row
and stop.
```

Convergence is the README's [Convergence
protocol](README.md#convergence-protocol): two consecutive independent
clean passes from different angles, not zero-open after one pass. A
pass that files or fixes a finding resets the counter.
