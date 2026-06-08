---
name: create-agent-native-skill
description: "Runtime helper skill design alias: helper commands, machine output, durable writes, repair, retry, facade envelopes."
---

# Create Agent-Native Skill

Temporary skill bridge.

## Owner Paths

- Canonical capability: `skills/create-skill/SKILL.md`.
- Runtime-backed skill design reference: `skills/create-skill/references/agent-native-skill-design.md`.
- Skill philosophy: `skills/create-skill/references/skill-design-philosophy.md`.
- CLI design owner path: `skills/create-cli/SKILL.md`.

## Entry-Screen Route

1. Read `skills/create-skill/SKILL.md`.
2. Read `skills/create-skill/references/agent-native-skill-design.md`.
3. Continue the request through `create-skill`.

## Removal Condition

- Remove this skill bridge after active references route runtime-backed skill creation requests to `create-skill`.
