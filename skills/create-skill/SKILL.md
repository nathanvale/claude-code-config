---
name: create-skill
description: "Create, fix, repair, review, archive, or merge SKILL.md source. Use for skill trigger descriptions, invocation lanes, routing, owner paths, roles, dependencies, portability, and reusable skill guidance."
role: main-entry
---

# Create Skill

## Intent Classification

Classify from args and proceed. Read `CONTEXT.md` only when creating a new
skill or when vocabulary matters. Do NOT show a menu unless intent is ambiguous.

| Signal | Route | References to open |
|--------|-------|--------------------|
| Target skill + fix/heal/repair/improve/patch | **Fix target skill** | Target `SKILL.md`; `references/skill-design-decision-runbook.md`; `references/skill-io-shape-examples.md` |
| Target skill + review/audit/check | Review target skill | Target `SKILL.md`; `references/skill-review-rubric.md` |
| "create" / "new skill" / no target | Create new skill | `CONTEXT.md`; `references/skill-design-decision-runbook.md`; `references/skill-io-shape-examples.md` |
| DX / numbered choices / next-action / landing page | Add ADHD-friendly DX | Target `SKILL.md`; `references/adhd-friendly-dx.md`; `references/skill-design-decision-runbook.md` |
| Runtime / CLI / helper command | Add runtime behavior | `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/create-cli/SKILL.md` |
| `mcporter` / MCP via CLI / MCP config / thin MCP skill / server alias / tool schema | Add MC Porter skill guidance | Target `SKILL.md` when fixing; `references/skill-design-decision-runbook.md`; `references/skill-io-shape-examples.md`; `references/mcporter-skill-design.md` |
| Role / dependency / blocked / degraded | Check role or dependency | `references/skill-roles.md`; `references/skill-dependency-rules.md` |
| Archive / merge / retire | Archive or merge | `references/archive-cleanup.md`; `references/consolidation-map.md` |
| Shape / what kind of skill | Choose skill shape | `references/skill-io-shape-examples.md` |
| Research / import / handover | Import external input | `references/research-portability.md`; `references/community-skill-research-sources.md` |
| Context / where to save | Route to context advisor | `skills/context-advisor/SKILL.md` |
| Ambiguous | Show menu below | — |

### Ambiguous-only menu

Present only when intent classification cannot pick a route:

1. **Fix, heal, or repair a skill** — name the target, open its `SKILL.md`.
2. Review an existing skill — read target + review rubric, return findings.
3. Create a new skill — read `CONTEXT.md` first for vocabulary.
4. Unsure — read `CONTEXT.md`, then pick the closest route above or stop.

## Run Card

- Scope: create, fix, heal, repair, review, archive, or merge skill source files.
- First safe action: classify intent from args, open only the references on that route.
- Mode defaults: review returns findings only; create, fix, heal, repair, or patch edits source.
- Review-only branch: read target `SKILL.md` and `references/skill-review-rubric.md`; return findings with severity, path, rubric failure, suggested direction, and next safe action.
- Review boundary: do not patch during review unless the user asks for edits.
- Edit branch: read `references/skill-design-decision-runbook.md`, then apply only the gates for the selected branch.
- Invocation lane: before frontmatter or trigger edits, choose `model lane` or `self invocation lane`; ask the user one question when the lane is unclear.
- Thin-router gate: keep `SKILL.md` a `thin router` for the `current step only`; move branch-only detail to `branch-hidden reference` files.
- Pruning gate: apply the `deletion test` before handoff; headings are options, not a checklist.
- MC Porter branch: when a skill uses `mcporter`, read `references/mcporter-skill-design.md` before edits.
- DX branch: every new or healed skill needs one no-args default action; use a numbered menu only when user choice changes owner, risk, target, or next action.
- Visible state: report edited paths, new references, untracked files, skipped checks, and owner-path results.
- Slow path: warn before repo-wide audits, external research, browser work, task-tracker writes, or multi-pass verification.
- Verify: run the checks owned by `references/skill-design-decision-runbook.md#verification`.
- Publish: return owner file, check result, next safe action, and user-facing skill follow-up.
- Fallback: stop with blocked state when owner path, input/output shape, write authority, or target skill is unclear.
- Leave with: the owner file, the check to run, the next safe action.

## Owner Map

- Bundle: `skills/create-skill/`.
- Vocabulary: `CONTEXT.md`.
- Decision runbook: `references/skill-design-decision-runbook.md`.
- Review rubric: `references/skill-review-rubric.md`.
- ADHD-friendly DX: `references/adhd-friendly-dx.md`.
- MC Porter skill design: `references/mcporter-skill-design.md`.
- Verification owner: `references/skill-design-decision-runbook.md#verification`; scripts live in `skills/create-skill/scripts/`.
