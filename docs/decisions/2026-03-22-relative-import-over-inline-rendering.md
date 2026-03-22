---
title: "Relative @AGENTS.md Import Over Inline Rendering"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why CLAUDE.md uses @AGENTS.md import syntax instead of rendering the full shared content inline."
---

# ADR: Relative @AGENTS.md Import Over Inline Rendering

## Status

Accepted (2026-03-22)

## Context

CLAUDE.md needs to include the shared instructions from AGENTS.md. Two approaches:

1. Use Claude Code's `@AGENTS.md` import syntax — CLAUDE.md stays tiny and delegates
2. Render CLAUDE.md with the full shared content baked in — no runtime dependency on import syntax

## Decision

Use `@AGENTS.md` (relative path import). CLAUDE.md is 12 lines.

## Rationale

- Keeps CLAUDE.md visually distinct from AGENTS.md — you can see at a glance it's a wrapper
- Avoids maintaining two copies of shared content in the render pipeline
- Relative path (`@AGENTS.md`, not `@~/.claude/AGENTS.md`) sidesteps the known Issue #8765 with absolute user-scope imports
- Both files are symlinked into `~/.claude/` from the same repo directory, so relative resolution is straightforward

## Risks

- The `@` import syntax at user scope is underdocumented and has known fragility (Issue #8765)
- If Anthropic changes how user-scope imports resolve, CLAUDE.md breaks silently — Claude would load only the Claude-specific notes without the shared core
- The `--check` script validates the target file exists but cannot verify that Claude Code actually resolves the import at runtime

## Fallback

If `@AGENTS.md` stops working, change the render script to inline the shared content:
1. Update `render_claude()` in `scripts/render-user-prompts.sh` to concatenate shared fragments directly
2. Run `--write`
3. No other changes needed — the fragment architecture handles it

## Alternatives Rejected

**Rendered inline content** — CLAUDE.md would contain the full shared instructions plus Claude-only notes. This removes the runtime import dependency but means CLAUDE.md becomes ~90 lines of generated content that looks editable but isn't. The thin wrapper makes the "don't edit this" boundary clearer.
