---
name: create-skill
description: "Create, audit, repair, archive, or consolidate portable agent skills. Use for skill authoring, routing evidence, supporting files, skill cleanup, research portability, and moving scattered skill guidance into one reusable skill bundle."
role: main-entry
---

# Create Skill

Use as the single skill runbook for creating, updating, auditing, repairing,
archiving, or consolidating any type of agent skill.

## Owner Paths

- Portable skill bundle: `skills/create-skill/`.
- Vocabulary owner path: `CONTEXT.md`.
- Philosophy: `references/skill-design-philosophy.md`.
- Cleanup plan: `references/archive-cleanup.md`.
- Consolidation map: `references/consolidation-map.md`.
- Research portability: `references/research-portability.md`.
- Runtime portability: `references/runtime-portability.md`.
- Skill dependency rules: `references/skill-dependency-rules.md`.
- Skill role runbooks: `references/skill-roles.md`.
- I/O shape examples: `references/skill-io-shape-examples.md`.
- Agent-native skill design: `references/agent-native-skill-design.md`.
- Context advisor: `skills/context-advisor/SKILL.md`.
- Storage routing fallback: `skills/context-advisor/references/storage-routing.md`.
- Legacy storage routing pointer: `references/skill-memory-storage-routing.md`.
- Community-skill source note: `references/community-skill-research-sources.md`.
- Skill collision and routing evidence audit: `skills/create-skill/scripts/skill-description-audit.ts`.
- Skill role audit: `skills/create-skill/scripts/skill-role-audit.ts`.
- Compatibility wrapper: `scripts/skill-description-audit.ts`.
- Role audit compatibility wrapper: `scripts/skill-role-audit.ts`.
- CLI design owner path: `skills/create-cli/SKILL.md`.

## Entry-Screen Route

1. Read `CONTEXT.md` and `references/skill-design-philosophy.md` before editing any `SKILL.md`.
2. Route the request shape: create, audit, repair, archive, or consolidate.
3. If runtime-backed skill behavior is in scope, read `references/agent-native-skill-design.md`; run `create-cli` before changing any CLI/runtime surface.
4. If changing skill descriptions as routing evidence, run `bun run skills/create-skill/scripts/skill-description-audit.ts`.
5. If archiving, read `references/archive-cleanup.md` first.
6. If consolidating scattered guidance, read `references/consolidation-map.md`.
7. If importing research or a handover, read `references/research-portability.md`.
8. If adding or auditing Bun, Node, Python, shell, package, lockfile, or helper-script portability, read `references/runtime-portability.md`.
9. If adding or auditing skill dependencies, read `references/skill-dependency-rules.md`.
10. If assigning or auditing skill roles, read `references/skill-roles.md`; run `bun run skills/create-skill/scripts/skill-role-audit.ts`.
11. If durable context placement is unclear, use `skills/context-advisor/SKILL.md`; if unavailable, read `skills/context-advisor/references/storage-routing.md`.

## Rules

- Keep active skills few and obvious.
- Move unused skills only after an archive plan names keep-active skills.
- Preserve published skill names unless a skill bridge and removal condition exist.
- Keep deterministic contracts in code, help, generated docs, tests, or scripts.
- Keep `SKILL.md` as entry-screen route clarity: request shapes, owner paths, references, scripts, templates, and next safe actions.
- Keep references one level deep from this skill.
- Treat skill collision warnings as routing evidence review prompts, not automatic edits.
- Label every dependency and name its missing state.
- Give every active skill one primary role.

## Verification

- Run `bun run skills/create-skill/scripts/skill-description-audit.ts --json` after adding, renaming, or changing skill descriptions.
- Run `bun run skills/create-skill/scripts/skill-role-audit.ts --json` after adding, archiving, or changing active skill roles.
- Run wrapper checks only after wrapper edits: `bun run scripts/skill-description-audit.ts --json` and `bun run scripts/skill-role-audit.ts --json`.
- YAML-parse edited `SKILL.md` frontmatter before handoff.

## Next Safe Action

- For create: read `CONTEXT.md` and `references/skill-design-philosophy.md`, choose the smallest skill shape, then draft the bundle.
- For audit: compare the entry screen against owner paths, command discoverability, routing evidence, and next safe actions.
- For repair: start from the observed failure, patch the smallest owner path, description, command, or reference that would have prevented it.
- For archive: read `references/archive-cleanup.md`, inventory skills, ask for must-keep-active names, then draft the archive move list.
- For consolidation: read `references/consolidation-map.md`, move one owner path at a time, then leave temporary owner-path redirect stubs.
- For handover: read `references/research-portability.md`, add the handover path to `TASKS.md`, then extract accepted rules and open questions.
