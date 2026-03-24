---
title: "Fragment Rendering Over Manual Sync"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why we chose composable prompt fragments with a render script instead of maintaining separate instruction files manually."
---

# ADR: Fragment Rendering Over Manual Sync

## Status

Accepted (2026-03-22)

## Context

Claude Code reads `~/.claude/CLAUDE.md`. Codex reads `~/.codex/AGENTS.md`. Both need the same core instructions (personal context, safety rules, communication style) plus harness-specific additions.

Previously, `CLAUDE.md` was a monolithic 167-line file maintained by hand, and `~/.codex/AGENTS.md` was a separate manually maintained copy that drifted from Claude's version.

## Decision

Split instruction content into small source fragments organized by audience (shared, Claude-only, Codex-only). A render script concatenates them into harness-specific output files.

## Alternatives Considered

### 1. Manual maintenance of separate files

Edit `CLAUDE.md` and `~/.codex/AGENTS.md` independently.

- Pro: No build step, no render script
- Con: Shared content drifts between files — the exact problem we had

### 2. Single AGENTS.md + @import shim only

Maintain one `AGENTS.md` by hand. `CLAUDE.md` imports it with `@AGENTS.md`. Copy `AGENTS.md` to Codex manually.

- Pro: Simpler than fragments — 3 files to maintain, no render script
- Con: Codex needs the tool map appended, so you'd either hand-edit the copy or accept Codex getting a slightly different version
- Con: No drift detection

### 3. Fragment-based rendering (chosen)

Source fragments → render script → harness-specific outputs with `--check` for drift detection.

- Pro: Shared content maintained once, composed differently per harness
- Pro: Drift caught automatically
- Pro: Scales to additional harnesses (Gemini CLI, Cursor, etc.)
- Con: More machinery — 9 fragments, render script, check logic
- Con: Arguably over-engineered for 2 consumers

## Consequences

- Editing instructions requires modifying fragment files then running `--write`
- The render script is a maintenance surface — new fragments must be wired into render arrays
- The system is ready for additional harnesses without restructuring
- A future simplification is possible if the fragment overhead proves not worth it (see Future Optimizations #4 in the research doc)

## References

- ETH Zurich study (arxiv 2602.11988): keep instructions minimal and non-inferable
- Research doc: `~/code/my-second-brain/docs/research/2026-03-22-claude-md-user-scope-alignment.md`
