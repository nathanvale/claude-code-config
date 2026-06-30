---
name: choose-skill-memory-store
description: "Choose where skill memory should live when durable state, learned memory, project tracker state, setup, research, decision-adjacent context, or runtime storage is unclear; use decisions for accepted repo decisions."
---

# Choose Skill Memory Store

Use when a skill, agent, helper, or operating manual needs memory that survives the current turn and the storage bucket is unclear.

Do not use for accepted repo decisions. Use `decisions`.

## Owner Paths

- Memory storage routing map: `skills/context-advisor/references/storage-routing.md`.
- Skill design runbook: `skills/skill-author/references/skill-design-decision-runbook.md`.
- Skill vocabulary: `skills/skill-author/CONTEXT.md`.
- Decision log: `docs/decisions/`.

## Workflow

1. Read `skills/context-advisor/references/storage-routing.md`.
2. Name the memory owner.
3. Name the memory kind.
4. Name mutability.
5. Name sensitivity.
6. Name privacy boundary.
7. Name query, retention, deletion, and recovery need.
8. Name write actor and review gate.
9. Recommend the smallest matching store.
10. Name the owner path and next safe action.

## Output

- Status: recommend, ask, escalate-decisions, escalate-create-agent-native-skill, or blocked.
- Recommendation: storage bucket and owner path.
- Required facts: owner, kind, mutability, sensitivity, privacy, query, retention, deletion, recovery, write actor.
- Assumptions: facts inferred from prompt.
- Safety: redaction/logging stance, retention/delete route, and write gate.
- Truth stance: canonical source or recall layer.
- Operations needed: none, status, refresh, repair, inspect, backup, migration, or deletion.
- Not there: rejected nearby buckets.
- Next: write path, decision route, config route, or runtime design route.

## Safety

- Do not store secrets in repo docs.
- Do not store project tracker state in `SKILL.md`, `CONTEXT.md`, or decision logs.
- Do not let worker agents write durable memory directly.
- Route durable writes through a curator, skill driver, or accepted owner workflow.
- Treat logs, JSON, SQLite, projections, backups, and embeddings as durable sensitive stores.
- Use `skill-author` runtime-backed guidance when storage introduces or changes helper commands, machine-readable output, durable writes, side effects, privacy, durability, status, refresh, repair, retry, or runtime recovery.

## Next Safe Action

- If owner is unclear, ask one ownership question.
- If privacy, durability, write authority, or side-effect stance is unclear, ask one question.
- If memory is an accepted repo decision, use `decisions`.
- If storage choice is unresolved and affects ownership, privacy, durability, or side effects, use `decision-mode` or `grill-with-docs`.
- If accepted storage choice requires a runtime-backed capability, use `skill-author`.
- If memory is only hot startup guidance, patch hot startup guidance and point to the durable owner.
