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
- Skill authoring owner: `skills/skill-author/SKILL.md`.
- Runtime-backed skill design owner: `skills/skill-author/references/agent-native-skill-design.md`.
- CLI contract owner: `skills/cli-author/SKILL.md`.
- Decision owner: `skills/record-decision/SKILL.md`.

## Dependencies

- `references/storage-routing.md`: bundled reference, hard dependency.
- `~/.config/context/vault.md`: optional configured external context owner.
- `skills/skill-author/SKILL.md`: optional handoff for skill-authoring routes.
- `skills/cli-author/SKILL.md`: optional handoff for CLI-contract routes.
- `skills/record-decision/SKILL.md`: optional handoff for accepted decision capture.
- `decision-mode` or `grill-with-docs`: optional handoff for unresolved ownership choices.
- Missing storage-routing map: blocked.
- Missing optional handoff: continue by naming the owner path and next safe action.

## Workflow

1. Read `references/storage-routing.md`.
2. Read `~/.config/context/vault.md` when a configured external owner may apply.
3. Name the context owner.
4. Name the context kind.
5. Name mutability.
6. Name sensitivity.
7. Name privacy boundary.
8. Name query, retention, deletion, and recovery need.
9. Name write actor and review gate.
10. Recommend the smallest matching owner path.
11. Name rejected nearby stores and the next safe action.

## Output

- Status: recommend, ask, escalate-record-decision, escalate-skill-author, escalate-cli-author, or blocked.
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
- Do not store project tracker state in skill files, context files, or decision logs.
- Allow a scoped foreground write only when the user explicitly requested it
  and the selected owner permits it.
- Let delegated, background, or ambiguous agents propose durable changes unless
  their handoff explicitly grants owner-scoped write authority.
- Treat logs, JSON, SQLite, projections, backups, and embeddings as durable sensitive stores.
- Use `skill-author` runtime-backed guidance when storage introduces or changes helper commands, machine-readable output, durable writes, side effects, privacy, durability, status, refresh, repair, retry, or runtime recovery.

## Next Safe Action

- If owner is unclear, ask one ownership question.
- If privacy, durability, write authority, or side-effect stance is unclear, ask one question.
- If context is an accepted repo decision, use `record-decision`.
- If storage choice is unresolved and affects ownership, privacy, durability, or side effects, use `decision-mode` or `grill-with-docs`.
- If accepted storage choice requires skill-authoring guidance, use `skill-author`.
- If accepted storage choice requires a runtime-backed skill capability, use `skill-author`.
- If context is only hot startup guidance, patch hot startup guidance and point to the durable owner.
