---
name: context-advisor
description: "Advise where durable context belongs when storage owner, context placement, privacy boundary, write authority, or next safe action is unclear."
role: advisor
---

# Context Advisor

Use when durable context needs a home and the owner, store, privacy boundary,
write authority, or next safe action is unclear.

Do not write content, mutate stores, manage runtime state, or replace accepted decisions.

## Owner Paths

- Storage routing map: `references/storage-routing.md`.
- Skill authoring owner: `skills/create-skill/SKILL.md`.
- Runtime-backed skill design owner: `skills/create-skill/references/agent-native-skill-design.md`.
- CLI contract owner: `skills/create-cli/SKILL.md`.
- Decision owner: `skills/record-decision/SKILL.md`.

## Dependencies

- `references/storage-routing.md`: bundled reference, hard dependency.
- `skills/create-skill/SKILL.md`: optional handoff for skill-authoring routes.
- `skills/create-cli/SKILL.md`: optional handoff for CLI-contract routes.
- `skills/record-decision/SKILL.md`: optional handoff for accepted decision capture.
- `decision-mode` or `grill-with-docs`: optional handoff for unresolved ownership choices.
- Missing storage-routing map: blocked.
- Missing optional handoff: continue by naming the owner path and next safe action.

## Workflow

1. Read `references/storage-routing.md`.
2. Name the context owner.
3. Name the context kind.
4. Name mutability.
5. Name sensitivity.
6. Name privacy boundary.
7. Name query, retention, deletion, and recovery need.
8. Name write actor and review gate.
9. Recommend the smallest matching owner path.
10. Name rejected nearby stores and the next safe action.

## Output

- Status: recommend, ask, escalate-record-decision, escalate-create-skill, escalate-create-cli, or blocked.
- Recommendation: storage bucket and owner path.
- Required facts: owner, kind, mutability, sensitivity, privacy, query, retention, deletion, recovery, write actor.
- Assumptions: facts inferred from prompt.
- Safety: redaction/logging stance, retention/delete route, and write gate.
- Truth stance: canonical source or recall layer.
- Operations needed: none, status, refresh, repair, inspect, backup, migration, or deletion.
- Not there: rejected nearby buckets.
- Next: write path, decision route, skill-authoring route, config route, or runtime design route.

## Safety

- Do not store secrets in repo docs.
- Do not store project tracker state in `SKILL.md`, `CONTEXT.md`, or decision logs.
- Do not let worker agents write durable context directly.
- Route durable writes through a curator, skill driver, or accepted owner workflow.
- Treat logs, JSON, SQLite, projections, backups, and embeddings as durable sensitive stores.
- Use `create-skill` runtime-backed guidance when storage introduces or changes helper commands, machine-readable output, durable writes, side effects, privacy, durability, status, refresh, repair, retry, or runtime recovery.

## Next Safe Action

- If owner is unclear, ask one ownership question.
- If privacy, durability, write authority, or side-effect stance is unclear, ask one question.
- If context is an accepted repo decision, use `record-decision`.
- If storage choice is unresolved and affects ownership, privacy, durability, or side effects, use `decision-mode` or `grill-with-docs`.
- If accepted storage choice requires skill-authoring guidance, use `create-skill`.
- If accepted storage choice requires a runtime-backed skill capability, use `create-skill`.
- If context is only hot startup guidance, patch hot startup guidance and point to the durable owner.
