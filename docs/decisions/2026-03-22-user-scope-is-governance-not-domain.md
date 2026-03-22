---
title: "User Scope Is Governance, Not Domain Memory"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why user-scope instructions govern cross-project behavior rather than absorbing repo-specific content."
---

# ADR: User Scope Is Governance, Not Domain Memory

## Status

Accepted (2026-03-22)

## Context

User-scope files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) load into every Claude session across all projects. There's a natural temptation to add project-specific details here — Monash operational context, my-second-brain vault conventions, specific repo architectures.

## Decision

User-scope instructions govern **cross-project, non-domain concerns only**:

- Personal working style (ADHD, communication preferences)
- Tool-routing preferences (`response_format: "json"`, bunx over npx)
- Safety rails (never delete untracked changes, plan before implementing)
- Memory OS governance (what goes where, repo ownership model)
- Key people context

**Domain-specific content stays in the owning repo:**

- Monash operational context → `monash-smst` CLAUDE.md / AGENTS.md
- Life vault conventions → `my-second-brain` CLAUDE.md / AGENTS.md
- Side-quest architecture → `side-quest-*` repos
- iMessage integration details → `personal-messages` or `claude-code-config` specs

## Rationale

- ETH Zurich study: instructions only help when non-inferable from the codebase. Repo-specific content is inferable when you're in that repo.
- Context budget: every line in user-scope loads into every session. Repo-specific content wastes budget in unrelated sessions.
- Memory OS contract: repos own operational truth. User scope governs behavior.

## How to Apply

Before adding content to `prompt-fragments/shared/` or `rules/`, ask:

1. Does every project need this? → User scope
2. Does only one repo need this? → That repo's CLAUDE.md or AGENTS.md
3. Is it inferable from the codebase? → Don't add it anywhere

## Common Violations

- Adding repo-specific paths to AGENTS.md (the context file index is borderline — it lists paths but the descriptions add value)
- Adding project-specific architecture to user-scope rules
- Dumping operational runbooks into user scope instead of the owning repo's docs/
