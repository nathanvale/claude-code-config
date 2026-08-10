# Archive Cleanup

Use before moving skills into `skills/archive/`.

## Preview Index

- Read `Goal` and `Order` for the portable archive workflow.
- Read `Protected Boundary` before proposing archive moves.
- Read `Move Rules` and `Validation` before editing files.

## Goal

- Reduce active skill noise.
- Keep only skills the owner actively wants available.
- Avoid polishing skills that will be deprecated.
- Preserve old skills in an archive instead of deleting them.

## Order

1. Inventory all skills.
2. Identify broken symlinks.
3. Identify skills referenced by startup docs, rules, scripts, or active plans.
4. Ask for must-keep-active skills.
5. Build three buckets:
   - active
   - archive
   - investigate
6. Move archive skills only after the active list is accepted.
7. Run description checks and a Setup preview after any move.

## Protected Boundary

- Protected means not ordinary active routing, not archive-safe.
- Use for user-invocable control planes, startup routes, active owner paths, or dependency-heavy workflows.
- Keep protected skills out of broad polish.
- Do not archive protected skills until the dependent workflow is explicitly retired or replaced.

## Investigate Before Archive

- Skills referenced by `AGENTS.md`.
- Skills referenced by startup rules.
- Skills with active scripts used by other skills.
- Skills that write memory or external data.
- Skills with user-specific daily workflows.

## Move Rules

- Do not archive a skill named in `AGENTS.md` without replacing the route.
- Do not archive a skill referenced by another active skill without updating the owner path.
- Do not archive memory-writing skills before checking memory storage routing.
- Do not archive broken symlinks by following their targets.
- Do not classify user-scope symlink skills as repo-owned active or archived payloads.
- Do not move non-skill prompt/content material into a skill owner unless it is scoped to that skill's prompt/content boundary.
- Do not archive a replaced route before active references point to the new owner.
- Preserve directory contents under skills/archive/<name>/.

## Validation

- Run `bun run skills/skill-author/scripts/skill-description-audit.ts`.
- Run `./setup sync --check --json`.
- Run `git diff --check`.
- YAML-parse edited `SKILL.md` frontmatter.
