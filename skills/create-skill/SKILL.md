---
name: create-skill
description: "Create, fix, repair, review, archive, or merge agent skills. Use for SKILL.md work, skill routing, owner paths, roles, dependencies, portability, and reusable skill guidance."
role: main-entry
---

# Create Skill

## Start Here

- Read `CONTEXT.md`.
- Pick one task from `Pick One`.
- Open only the files named on that line, plus the target `SKILL.md` when reviewing or repairing a skill.
- Leave with the owner file.
- Leave with the check to run.
- Leave with the next safe action.

## Run Card

- Scope: create, fix, heal, repair, review, archive, or merge skill source files.
- Defaults: review returns findings; create, fix, heal, repair, or patch edits source.
- First safe action: read `CONTEXT.md`, then the matching `Pick One` route.
- Input/output gate: before create, fix, heal, repair, or patch edits, name the shape owned by `references/skill-design-decision-runbook.md#inputoutput-gate`.
- Visible state: report edited paths, new references, untracked files, skipped checks, and owner-path results.
- Slow path: warn before repo-wide audits, external research, browser work, task-tracker writes, or multi-pass verification.
- Verify: run the checks owned by `references/skill-design-decision-runbook.md#verification`.
- Publish: return owner file, check result, next safe action, and user-facing skill follow-up.
- Fallback: stop with blocked state when owner path, input/output shape, write authority, or target skill is unclear.

## Pick One

- Create, fix, heal, or repair a skill: `references/skill-design-decision-runbook.md`; `references/skill-io-shape-examples.md`.
- Review an existing skill: target `SKILL.md`; `references/skill-design-decision-runbook.md`.
- Choose what shape a skill needs: `references/skill-io-shape-examples.md`.
- Add helper command or runtime behavior: `references/agent-native-skill-design.md`; `references/runtime-portability.md`; `skills/create-cli/SKILL.md`.
- Check role, ability, handoff, dependency, blocked state, or degraded state: `references/skill-roles.md`; `references/skill-dependency-rules.md`.
- Archive or merge old skills: `references/archive-cleanup.md`; `references/consolidation-map.md`.
- Import research, QMD recall hits, community-skill evidence, or handover notes: `references/research-portability.md`; `references/community-skill-research-sources.md`.
- Save lasting context: `skills/context-advisor/SKILL.md`; fallback `skills/context-advisor/references/storage-routing.md`.

## Owner Map

- Bundle: `skills/create-skill/`.
- Vocabulary: `CONTEXT.md`.
- Decision runbook: `references/skill-design-decision-runbook.md`.
- Verification owner: `references/skill-design-decision-runbook.md#verification`; scripts live in `skills/create-skill/scripts/`.
