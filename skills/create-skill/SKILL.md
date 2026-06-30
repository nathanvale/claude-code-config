---
name: create-skill
description: "Create, repair, review, archive, or merge repo SKILL.md source when trigger descriptions, invocation lanes, routing, owner paths, or dependencies change."
role: main-entry
---

# Create Skill

## Intent Classification

Classify from args and proceed. Read `CONTEXT.md` only when creating a new
skill or when vocabulary matters. Do not show a menu unless intent is ambiguous.

| Signal | Route | References to open |
|--------|-------|--------------------|
| Target skill + review/audit/check | Review target skill | Target `SKILL.md`; `references/skill-review-rubric.md` |
| Target skill + description/trigger/frontmatter/invocation lane/model lane/self invocation | Fix trigger/frontmatter | Target `SKILL.md`; `references/skill-frontmatter-gate.md` |
| Target skill + body/headings/first screen/run card/no-args/next action/examples | Fix body shape | Target `SKILL.md`; `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` when heading shape is unclear |
| Target skill + owner path/contract/reference/dependency | Fix owner paths | Target `SKILL.md`; `references/skill-owner-path-gate.md`; `references/skill-dependency-rules.md` when dependency behavior changes |
| Target skill + safety/gotcha/private/destructive/auth/side effect | Fix safety gate | Target `SKILL.md`; `references/skill-safety-gate.md` |
| Target skill + verification/check/test/YAML/handoff | Fix verification | Target `SKILL.md`; `references/skill-verification-gate.md` |
| Target skill + fix/heal/repair/improve/patch | Classify edit branch | Target `SKILL.md`; `references/skill-design-decision-runbook.md`, then open the smallest branch reference |
| "create" / "new skill" / no target | Create new skill | `CONTEXT.md`; `references/skill-design-decision-runbook.md`, then open the smallest branch reference |
| Runtime / CLI / helper command | Add runtime behavior | `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/create-cli/SKILL.md` |
| `mcporter` / MCP via CLI / MCP config / thin MCP skill / server alias / tool schema | Add MC Porter skill guidance | Target `SKILL.md` when fixing; `references/mcporter-skill-design.md`; branch gate only when the `SKILL.md` body changes |
| Role / blocked / degraded | Check role or dependency | `references/skill-roles.md`; `references/skill-dependency-rules.md` |
| Archive / merge / retire | Archive or merge | `references/archive-cleanup.md`; `references/consolidation-map.md` |
| Research / import / handover | Import external input | `references/research-portability.md`; `references/community-skill-research-sources.md` |
| Context / where to save | Route to context advisor | `skills/context-advisor/SKILL.md` |
| Ambiguous | Show menu below | - |

### Ambiguous-only menu

Present only when intent classification cannot pick a route:

1. **Fix, heal, or repair a skill** - name the target, open its `SKILL.md`.
2. Review an existing skill - read target + review rubric, return findings.
3. Create a new skill - read `CONTEXT.md` first for vocabulary.
4. Unsure - read `CONTEXT.md`, then pick the closest route above or stop.

## Run Card

- Scope: create, repair, review, archive, or merge repo skill source files.
- First safe action: classify intent from args, open only the references for that route.
- Mode defaults: review returns findings only; create, fix, heal, repair, or patch edits source.
- Review boundary: do not patch during review unless the user asks for edits.
- Thin-router gate: keep `SKILL.md` a `thin router` for the `current step only`.
- Pruning gate: apply the `deletion test`; headings are options, not a checklist.
- Fallback: stop when owner path, input/output shape, write authority, or target skill is unclear.

## Owner Anchors

- Branch index: `references/skill-design-decision-runbook.md`.
- Review rubric: `references/skill-review-rubric.md`.
