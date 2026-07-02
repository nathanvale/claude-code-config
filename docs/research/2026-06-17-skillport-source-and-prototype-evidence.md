---
date: 2026-06-17
topic: skillport-source-and-prototype-evidence
type: research
---

# Skillport Source And Prototype Evidence

## Purpose

Durable evidence packet for Skillport planning.

Use with:

- `docs/brainstorms/2026-06-17-skillport-mvp-requirements.md`
- `docs/research/2026-06-17-skillport-mvp-architecture.md`

## Context7 Source Research

Library:

- `/vercel-labs/skills`

Useful URLs:

- `https://github.com/vercel-labs/skills/blob/main/_autodocs/configuration.md`
- `https://github.com/vercel-labs/skills/blob/main/_autodocs/types.md`
- `https://github.com/vercel-labs/skills/blob/main/_autodocs/architecture.md`

Observed capabilities:

- `skills add` supports target selection with `--agent`.
- `--agent` can be repeated.
- `--agent '*'` targets all supported agents.
- `skills list` supports `--json`.
- `skills list` supports `--agent`.
- `skills add` and `skills remove` support non-interactive execution with
  explicit flags and `--yes`.
- `skills remove` can remove broadly through all-skill or all-agent forms.
- Supported target ids include `codex`, `claude-code`, `cursor`,
  `gemini-cli`, `opencode`, and `universal`.

Planning inference:

- Skillport should expose provider target vocabulary instead of copying target
  path rules.
- Skillport should require plan-first behavior before any provider mutation.
- Skillport should make broad target operations visible and explicit.

## Stress Prototype Evidence

Question:

- Can a wrapper safely manage skills from a source without touching unrelated
  skills?

Result:

- Prototype passed 13/13 scenarios.

Evidence summary:

- Safe add can be planned and applied.
- Managed remove can be bounded to a matching source and skill.
- Same-name skill from a different source must block.
- A stale lock entry does not authorize unrelated deletion.
- Missing or weak frontmatter can be caught before provider mutation.
- Raw provider add was observed to overwrite same-name skills from another
  source.
- Current lock file shape observed locally is object-shaped under `skills`.

Guardrails:

- List source before mutation.
- Snapshot target state before mutation.
- Treat source ownership as authority.
- Refuse broad name-only remove.
- Refuse same-name add with different source.
- Refuse delete without matching ownership.
- Avoid raw update/experimental commands as the agent default path.

## MVP Seam Prototype Evidence

Question:

- Do the five MVP seams preserve safety while wrapping the provider?

Result:

- Scripted prototype passed.

Five required seams:

1. Skills Provider
2. Operation Planner / Executor
3. Ownership Ledger
4. Target Projection
5. CLI Facade front door

Scripted observations:

- Safe add created Skillport-owned entries for `codex` and `claude-code`.
- Same-name `storybook` on `cursor` from `other/source` blocked before mutation.
- Human-owned `local-only` on `codex` blocked before mutation.
- Managed `storybook` on `codex` removed and its ledger entry disappeared.
- Facade-style output reported changed state, repair hint, and continuation.

Planning inference:

- Ownership Ledger is an explicit MVP module.
- Planner must generate a ready or blocked plan before Executor mutates.
- CLI Facade should name changed-state category for every command.
- Target Projection should validate provider-supported ids before planning.
