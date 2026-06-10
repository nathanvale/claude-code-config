# Consolidation Map

Use when moving scattered skill-authoring material into `skills/create-skill/`.

## Working Folder Shape

```text
skills/create-skill/
  SKILL.md
  CONTEXT.md
  references/
    archive-cleanup.md
    consolidation-map.md
    research-portability.md
    runtime-portability.md
    agent-native-skill-design.md
    skill-dependency-rules.md
    skill-design-decision-runbook.md
    skill-io-shape-examples.md
    skill-roles.md
    community-skill-research-sources.md
  scripts/
    skill-description-audit.ts
    skill-role-audit.ts
```

- Project tracker owner: `skills/coding-task-tracker/SKILL.md`.
- `TASKS.md` is not part of the reusable folder shape unless imported as historical local state.

## Portable Export Payload

- Owner: `references/research-portability.md#export-surface`.
- Use this file for folder shape and consolidation rules only.

## Extraction Queue

- None currently.

## Consolidation Rules

- Move one owner path at a time.
- Remove stale owner-path redirects instead of preserving compatibility wrappers.
- Keep exact contracts in scripts, tests, generated docs, and CLI help.
- Keep research sources as source notes, not rules.
- Run `bun run skills/create-skill/scripts/skill-description-audit.ts` after description changes.
- Run startup checks after moving owner paths.
