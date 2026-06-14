---
name: seam-scaffold
description: "Find implementation seams before work; scaffold or recommend structure."
role: main-entry
---

# Seam Scaffold

Use when a plan or feature needs code-placement guidance before implementation.

## Boundary

- Read the plan before implementation.
- Inspect current code state before naming target structure.
- Prefer existing seams over new directories.
- Do not move code unless the user explicitly asks.
- Do not invent GoF names.
- Treat pattern names as earned, provisional, or rejected from pressure evidence.
- Stop for user decision when ownership, public API, CLI surface, dependency direction, or migration safety is unclear.

## Owner Map

- Pattern pressure gate: `context/code-style.md`.
- Live-code architecture review: `skills/improve-codebase-architecture/SKILL.md`.
- Pattern referee handoff: `skills/gof-pressure-lens/SKILL.md`.
- Workflow detail: `references/seam-scaffold-workflow.md`.
- Implementation handoff: `ce-work` when available; final response plan when not.

## Workflow

1. Read the plan, target files, local docs, tests, and existing architecture notes.
2. Survey current state: entry points, modules, imports, generated outputs, tests, and naming already in use.
3. Find candidate seams with pressure source, interface, deletion-test consequence, locality, and leverage.
4. Run `context/code-style.md` before naming any design pattern.
5. Hand off to `gof-pressure-lens` when a GoF label is claimed or disputed.
6. Classify names as earned, provisional, or rejected.
7. Pick one mode from `references/seam-scaffold-workflow.md`.
8. Return a seam packet, scaffold marked shells, or stop with a decision question.
9. Hand implementation to `ce-work` with changed state, remaining work, paths, guardrails, tests, and next safe action.

## Scaffold Rules

- Greenfield: scaffold marked shells only when the plan owns the new structure and paths are clear.
- Fat file: recommend seam splits; leave code in place unless asked to move it.
- Existing seams: place work in an existing seam, or justify the new seam.
- Refactor: map current structure to target seams before implementation.
- Generated outputs: edit source, not rendered output.
- Mark shells with deletion-test headers and earned/provisional status.
- Add guardrails for rejected names, import direction, and drift when an owner path exists.

## Output Shape

Return:

- Current-state survey.
- Seam map.
- Pattern verdicts: earned, provisional, rejected.
- Deletion tests.
- Guardrails.
- Files to create or leave untouched.
- Tests or checks.
- Handoff target.
- Next safe action.

## Verification

- YAML-parse this frontmatter after edits.
- Run `bun run skills/create-skill/scripts/check-owner-paths.ts --json` after owner-path edits.
