---
name: create-skill
description: "Create, fix, repair, review, archive, or merge agent skills. Use for SKILL.md work, skill routing, owner paths, roles, dependencies, portability, and reusable skill guidance."
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
- Edit-only gates: the next gates apply only to create, fix, heal, repair, or patch routes.
- Input/output gate: before create, fix, heal, repair, or patch edits, name the shape owned by `references/skill-design-decision-runbook.md#inputoutput-gate`.
- Thin-router gate: before create, fix, heal, repair, or patch edits, keep `SKILL.md` a `thin router` for the `current step only`: trigger, branch choice, immediate fail-closed gate, one owner anchor per hot branch, and next safe action.
- Branch-hidden reference rule: move branch-only detail to `branch-hidden reference` files in `references/`; keep exact flags, schemas, states, output envelopes, and deterministic contracts in their `single source of truth`: code, CLI help, generated docs, tests, or scripts.
- Deletion test: if deleting text does not change agent behavior for the selected branch, delete it or move it behind a context pointer.
- MC Porter gate: when a skill uses `mcporter`, read `references/mcporter-skill-design.md`; before edits name the server alias, config owner, schema owner, read path, write path, config hygiene scan, and failure modes.
- DX gate: every new or healed skill must have a no-args front door. Before handing off, check the new `SKILL.md` has an `## Intent Classification` block (or equivalent `## Next Safe Actions` block) that tells the agent what to do when invoked with no arguments. If the skill has multiple launch paths, the no-args route must show a numbered menu (max 4 choices, one bolded default, defaults stated as readable values). If the menu is missing, patch it before reporting done — do not leave it for a follow-up. Read `references/adhd-friendly-dx.md` for the pattern. Skills with choices but no menu fail this gate; skills with no front door at all also fail.
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
