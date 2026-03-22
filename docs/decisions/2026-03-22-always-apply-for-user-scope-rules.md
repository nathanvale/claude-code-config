---
title: "alwaysApply: true for All User-Scope Rules"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why all rules in ~/.claude/rules/ use alwaysApply: true instead of path-scoped conditional loading."
---

# ADR: alwaysApply: true for All User-Scope Rules

## Status

Accepted (2026-03-22)

## Context

Claude Code rules support three loading modes:

- `alwaysApply: true` — loaded every session automatically
- `alwaysApply: false` — Claude decides when it's relevant
- `paths: ["**/*.ts"]` — loaded only when working with matching files

Path-scoped rules would be ideal for some content (e.g., TypeScript code style only when editing `.ts` files). However, three open bugs make path scoping unreliable at user scope:

1. **Issue #21858:** `paths:` frontmatter in user-level rules (`~/.claude/rules/`) is completely ignored
2. **Issue #16299:** Path-scoped rules load globally at session start regardless of working directory
3. **Issue #23478:** Path-based rules only trigger on file reads, not writes

## Decision

All user-scope rules use `alwaysApply: true`. No path-scoped rules at user scope until Issue #21858 is fixed.

## Current Rules

| Rule | Why always-apply |
|------|-----------------|
| `context7.md` | Should always check live docs for libraries |
| `tool-routing.md` | Should always use `response_format: "json"` |
| `newsroom-trigger.md` | Should always watch for research trigger phrases |
| `memory-os.md` | Should always follow Memory OS governance |

## Consequences

- All 4 rules (~55 lines total) load into every session — acceptable context budget
- No conditional loading available until bugs are fixed
- When Issue #21858 is resolved, revisit: context files like `code-style.md` could become `rules/code-style.md` with `paths: ["**/*.ts"]` to reduce on-demand `@path` lookups

## Re-evaluation Trigger

Monitor Issue #21858. When fixed, evaluate migrating context files to path-scoped rules.
