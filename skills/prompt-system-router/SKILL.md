---
name: prompt-system-router
description: "Background routing brain for the multi-agent prompt system. Classifies where new guidance belongs: shared fragments, harness-specific fragments, rules, or context. Not user-invocable — loaded by prompt-system-workflow."
disable-model-invocation: true
---

# Prompt System Router

## Purpose

Answer "where does this go?" for any prompt-system change without maintaining an independent routing table.

## Authority

The routing matrix lives in the spec. This skill teaches you how to apply it — it does not replace it.

Before classifying any change, read:
1. `docs/specs/prompt-system.md` — the contract (especially "Routing Guide" and "Contract Invariants")

## Classification Procedure

For every proposed change, answer these questions in order:

### 1. What kind of instruction is this?

| Kind | Signal |
|------|--------|
| Startup guidance | Should be present when a session begins |
| Auto-applied rule | Claude should enforce this every session without being asked |
| On-demand reference | Useful when explicitly invoked, not needed at startup |

### 2. Who needs it?

Identify the audience first:

- all supported harnesses
- Claude only
- Codex only
- a future harness only

Then map that audience to the correct surface by reading the spec's:

- `Routing Guide`
- `Contract Invariants`
- `Shared Root Structure`

Do not invent or maintain a separate routing table here. The spec is the source of truth for the final surface decision.

### 3. Is mirroring required?

A change needs mirroring when:
- A Claude rule expresses behavior Codex also needs
- A shared behavior is being added only to one harness surface

Mirroring means adding the same behavioral intent (not a copy-paste) to the correct shared or harness-specific fragment.

## Common Misrouting Patterns

Flag these when you see them:

| Mistake | Why it's wrong |
|---------|---------------|
| Shared behavior placed only in `rules/` | Codex never sees `rules/` |
| Claude-only invocation syntax in `prompt-fragments/shared/` | Shared content must stay harness-neutral |
| Codex-needed behavior omitted from rendered path | Must be in `shared/` or `codex/` fragments |
| Editing `AGENTS.md`, `CLAUDE.md`, or `generated/` directly | These are generated artifacts |
| Using `context/` for startup behavior | Context files are on-demand, not auto-loaded |

## Output Shape

When classifying a change, report:

- **Surface:** which directory/file
- **Mirroring:** whether another surface needs the same behavior
- **Render required:** yes/no
- **Smoke required:** yes/no (yes if shared behavior or propagation logic changed)
- **Risk:** any misrouting risk worth noting
