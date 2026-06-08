# Consolidation Map

Use when moving scattered skill-authoring material into `skills/create-skill/`.

## Working Folder Shape

```text
skills/create-skill/
  SKILL.md
  CONTEXT.md
  TASKS.md
  references/
    archive-cleanup.md
    consolidation-map.md
    research-portability.md
    agent-native-skill-design.md
    skill-design-philosophy.md
    skill-io-shape-examples.md
    community-skill-research-sources.md
  scripts/
    skill-description-audit.ts
```

## Portable Export Payload

- Include `SKILL.md`.
- Include `CONTEXT.md`.
- Include `references/`.
- Include `scripts/`.
- Include templates and assets owned by the skill.
- Exclude `TASKS.md` unless exporting local project state on purpose.
- Exclude repo decision logs unless exporting evidence on purpose.

## Migrated Owner Path Map

- `context/skill-design-philosophy.md` -> `references/skill-design-philosophy.md`.
- `context/references/skill-io-shape-examples.md` -> `references/skill-io-shape-examples.md`.
- `context/references/skill-memory-storage-routing.md` -> `skills/context-advisor/references/storage-routing.md`.
- `skills/create-skill/references/skill-memory-storage-routing.md` -> legacy pointer to `skills/context-advisor/references/storage-routing.md`.
- `context/references/community-skill-research-sources.md` -> `references/community-skill-research-sources.md`.
- `scripts/skill-description-audit.ts` -> `skills/create-skill/scripts/skill-description-audit.ts`.
- `context/agent-native-cli/CONTEXT.md` -> `CONTEXT.md`.
- `context/capability-registry/CONTEXT.md` -> `CONTEXT.md`.
- `context/skill-design/CONTEXT.md` -> `CONTEXT.md`.
- `skills/create-agent-skills/` -> archived after extraction review found no reusable owner material beyond existing `create-skill` references.
- `skills/create-agent-native-skill/` -> archived without bridge after runtime-backed guidance moved to `skills/create-skill/references/agent-native-skill-design.md`.
- `skills/choose-skill-memory-store/` -> archived after reusable routing guidance moved to `skills/context-advisor/references/storage-routing.md`.
- Legacy storage-framework contract -> reviewed as historical source; reusable storage routing and write-gate rules live in `skills/context-advisor/references/storage-routing.md`; old `/capture` workflow stays rejected unless a future replacement accepts it.

## Extraction Queue

- None currently.

## Migration Rules

- Move one owner path at a time.
- Keep a pointer in the old location until startup docs and active skills point to `create-skill`.
- Remove owner-path redirect stubs after `rg` finds no active references outside historical docs and `scripts/agent-instructions.sh check --json` passes.
- Keep exact contracts in scripts, tests, generated docs, and CLI help.
- Keep research sources as source notes, not rules.
- Run `bun run skills/create-skill/scripts/skill-description-audit.ts` after description changes.
- Run startup checks after moving owner paths.

## Resolved Owner Split

- `create-skill` supersedes `create-agent-skills` for ordinary skill authoring.
- `create-agent-skills` is archived without a bridge after extraction review.
- `create-skill` owns runtime-backed skill creation through `references/agent-native-skill-design.md`.
- `create-agent-native-skill` is archived without a bridge because it had not been used as a real route.
- `context-advisor` is the thin advisor front door and storage routing owner.
- `choose-skill-memory-store` archives without a bridge because the old name does not need compatibility.
- Root `scripts/skill-description-audit.ts` remains a compatibility wrapper until old external references are gone.
