---
name: skill-author
description: "Create, repair, review, archive, or merge repo SKILL.md source; handle legacy create-skill requests, trigger text, invocation lanes, routing, owner paths, or dependencies."
---

# Skill Author

## Intent Classification

Classify from args top to bottom and proceed. Read `CONTEXT.md` only when
creating a new skill or when vocabulary matters. Show the menu only for no
args, missing target on target-specific routes, or ambiguous intent.

| Signal | Route | References to open |
|--------|-------|--------------------|
| `create-skill` named as the skill, path, or handoff target | Treat as `skill-author`; patch live references instead of adding an alias unless active-reference evidence proves a bridge is needed | `skills/skill-author/SKILL.md`; `references/skill-frontmatter-gate.md` when route evidence or bridge decision changes |
| Target skill + review/audit/check + patch/fix/apply | Review, then patch requested findings | Target `SKILL.md`; `references/skill-design-decision-runbook.md`; `references/skill-review-rubric.md`, then open the smallest branch reference for requested findings |
| Target skill + review/audit/check + workflow fitness / working workflow / skill-authoring workflow | Review workflow fitness | Target `SKILL.md`; `references/skill-design-decision-runbook.md`; `references/skill-review-rubric.md`; `references/skill-workflow-fitness-probes.md`; smallest relevant branch references read-only |
| Target skill + review/audit/check | Review target skill | Target `SKILL.md`; `references/skill-design-decision-runbook.md`, then `references/skill-review-rubric.md` |
| Target skill + description/trigger/frontmatter/invocation lane/model lane/self invocation | Fix trigger/frontmatter | Target `SKILL.md`; `references/skill-frontmatter-gate.md` |
| Target skill + body/headings/first screen/run card/no-args/next action/examples | Fix body shape | Target `SKILL.md`; `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` when heading shape is unclear |
| Target skill + owner path/contract/reference/dependency | Fix owner paths | Target `SKILL.md`; `references/skill-owner-path-gate.md`; `references/skill-dependency-rules.md` when dependency behavior changes |
| Target skill + safety/gotcha/private/destructive/auth/side effect | Fix safety gate | Target `SKILL.md`; `references/skill-safety-gate.md` |
| Target skill + verification/check/test/YAML/handoff | Fix verification | Target `SKILL.md`; `references/skill-verification-gate.md` |
| Target skill + fix/heal/repair/improve/patch | Classify edit branch | Target `SKILL.md`; `references/skill-design-decision-runbook.md`, then open the smallest branch reference |
| Runtime / CLI / helper command / machine output / durable write / external side effect / repair envelope | Add runtime behavior or create runtime-backed skill | `references/skill-design-decision-runbook.md`; `references/skill-safety-gate.md`; `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/create-cli/SKILL.md` |
| "create" / "new skill" | Create a tiny prose skill by default; add owner, safety, or runtime gates only when evidence earns them | `CONTEXT.md`; `references/skill-design-decision-runbook.md`; `references/skill-frontmatter-gate.md`; `references/skill-body-shape-gate.md`; `references/skill-io-shape-examples.md` only when heading shape is unclear |
| `mcporter` / MCP via CLI / MCP config / thin MCP skill / server alias / tool schema | Add MC Porter skill guidance | Target `SKILL.md` when fixing; `references/mcporter-skill-design.md`; branch gate only when the `SKILL.md` body changes |
| Blocked / degraded / dependency | Check dependency behavior | `references/skill-dependency-rules.md` |
| Archive / merge / retire | Archive or merge | `references/archive-cleanup.md`; `references/consolidation-map.md` |
| Research / import / handover | Import external input | `references/research-portability.md`; `references/community-skill-research-sources.md` |
| Context / where to save | Route to context advisor | `skills/context-advisor/SKILL.md` |
| No args / missing target on target-specific route | Show menu below | - |
| Ambiguous | Show menu below | - |

### No-args or ambiguous menu

Present only for no args, missing target on target-specific routes, or when
intent classification cannot pick a route:

1. **Fix, heal, or repair a skill** - name the target, open its `SKILL.md`.
2. Review an existing skill - read target + runbook review-only branch + review rubric, return findings.
3. Create a new skill - read `CONTEXT.md`; default to the tiny prose path unless runtime, owner, or safety evidence earns more.
4. Unsure - read `CONTEXT.md`, then pick the closest route above or stop.

## Run Card

- Scope: create, repair, review, archive, or merge repo skill source files.
- First safe action: show the menu for no args, missing target on target-specific routes, or ambiguous intent; otherwise classify intent from args and open only the references for that route.
- Mode defaults: review-only returns findings; mixed review plus patch edits only requested findings; create, fix, heal, repair, or patch edits source.
- Review boundary: do not patch during review unless the user asks for edits.
- Thin-router gate: keep `SKILL.md` a `thin router` for the `current step only`.
- Pruning gate: apply the `deletion test`; headings are options, not a checklist.
- Fallback: stop when owner path, input/output shape, write authority, or target skill is unclear.

## Owner Anchors

- Branch index: `references/skill-design-decision-runbook.md`.
- Review rubric: `references/skill-review-rubric.md`.
