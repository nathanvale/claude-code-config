---
name: create-skill
description: "Create, audit, repair, archive, or consolidate portable agent skills. Use for skill authoring, routing evidence, supporting files, skill cleanup, research portability, and moving scattered skill guidance into one reusable skill bundle."
role: main-entry
---

# Create Skill

## Quick Start

- Create or repair: read `CONTEXT.md`; `references/skill-design-philosophy.md`.
- Audit: check routing evidence, owner paths, verification, and next safe action.
- Archive or consolidate: read the matching route card before inventory work.
- Escalate for input/output shape: read `references/skill-io-shape-examples.md`.
- Escalate for runtime-backed behavior: read `references/agent-native-skill-design.md`; use `create-cli` before CLI/runtime edits.
- Escalate for durable context placement: use `skills/context-advisor/SKILL.md`.

## Global Owner Paths

- Bundle: `skills/create-skill/`.
- Vocabulary: `CONTEXT.md`.
- Philosophy: `references/skill-design-philosophy.md`.
- Input/output shape: `references/skill-io-shape-examples.md`.
- Audits: `skills/create-skill/scripts/`.

## Route Map

### Create Or Repair

- When: new skill, broken skill, stale owner path, routing miss, or skill cleanup.
- Read: `CONTEXT.md`; `references/skill-design-philosophy.md`.
- Add: `references/skill-io-shape-examples.md` when input/output shape or headings are unclear.
- Next: patch the smallest owner path, sentence, command, or example that would have prevented the miss.

### Audit

- When: reviewing an existing skill for routing, owner paths, commands, role, or portability.
- Read: `CONTEXT.md`; `references/skill-design-philosophy.md`.
- Next: report findings by owner path; patch only when the request asks for edits.

### Archive Or Consolidate

- When: moving inactive, duplicate, or superseded skills out of active routing.
- Read: `references/archive-cleanup.md`; `references/consolidation-map.md`.
- Next: name keep-active skills, protected skills, archive candidates, and blocked questions.

### Runtime-Backed Skill

- When: helper commands, parsed input, machine-readable output, durable writes, repair, retry, or safety evidence enter the workflow.
- Read: `references/agent-native-skill-design.md`; `references/runtime-portability.md`.
- Use: `skills/create-cli/SKILL.md` before changing any CLI/runtime surface.
- Next: keep exact flags, schemas, states, and output envelopes in code/help/tests.

### Role Or Dependency Audit

- When: active roles, ability labels, optional handoffs, hard dependencies, or missing states change.
- Read: `references/skill-roles.md`; `references/skill-dependency-rules.md`.
- Next: give every active skill one primary role and label every dependency.

### Research Or Handover Import

- When: importing research, community-skill evidence, or handover notes into reusable skill guidance.
- Read: `references/research-portability.md`; `references/community-skill-research-sources.md`.
- Next: extract accepted rules and open questions; keep research sources as source notes.

### Durable Context Placement

- When: storage owner, privacy boundary, write authority, or durable recall placement is unclear.
- Use: `skills/context-advisor/SKILL.md`.
- Fallback: read `skills/context-advisor/references/storage-routing.md` if the advisor skill is unavailable.
- Next: name owner path, safety gate, rejected nearby stores, and next safe action.

## Rules

- Keep active skills few and obvious.
- Read `CONTEXT.md` and `references/skill-design-philosophy.md` before editing any `SKILL.md`.
- Load only selected route references; stop once owner path, invariant, and next safe action are clear.
- Keep deterministic contracts in code, help, generated docs, tests, or scripts.
- Treat skill collision warnings as routing evidence review prompts, not automatic edits.
- Preserve published skill names unless a skill bridge and removal condition exist.
- Label every dependency and name its missing state; give every active skill one primary role.
- Keep compatibility wrappers only while they preserve a live entrypoint.

## Verification

- Run `bun run skills/create-skill/scripts/skill-description-audit.ts --json` after adding, renaming, or changing skill descriptions.
- Run `bun run skills/create-skill/scripts/skill-role-audit.ts --json` after adding, archiving, or changing active skill roles.
- Run wrapper checks only after wrapper edits: `bun run scripts/skill-description-audit.ts --json` and `bun run scripts/skill-role-audit.ts --json`.
- YAML-parse edited `SKILL.md` frontmatter before handoff.
- Remove root audit wrappers after `rg "scripts/skill-description-audit|scripts/skill-role-audit"` finds no live references outside historical docs.
