---
title: "Codex Output Is a Copy, Not a Symlink"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why ~/.codex/AGENTS.md is a rendered copy rather than a symlink to the repo."
---

# ADR: Codex Output Is a Copy, Not a Symlink

## Status

Accepted (2026-03-22)

## Context

Claude's files (`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`) are symlinked to the repo. Changes in the repo are immediately visible to Claude.

Codex reads `~/.codex/AGENTS.md`. Should this also be a symlink?

## Decision

No. `~/.codex/AGENTS.md` is a **copy** produced by the render script, not a symlink.

## Rationale

The content differs. Codex's AGENTS.md contains:

1. All shared fragments (same as Claude's AGENTS.md)
2. **Plus** Codex-specific fragments (runtime notes + tool compatibility map)

If we symlinked to `AGENTS.md` in the repo, Codex would get the shared content but miss the Codex-specific tool map. If we symlinked to `generated/codex-user-agents.md`, that would work but creates a confusing indirection — a symlink pointing at a generated file in the repo.

Copying is simpler and makes the relationship explicit: the render script produces the file and places it where Codex reads it.

## Consequences

- Changes to shared fragments require running `--write` for Codex to see them (Claude sees them immediately via symlinks)
- The `--check` script verifies `~/.codex/AGENTS.md` matches the generated output to catch drift
- The Codex file could be hand-edited and the edits would survive until the next `--write` — the generated-file header warns against this

## Alternative Considered

**Symlink to generated file** — `~/.codex/AGENTS.md` → `$REPO/generated/codex-user-agents.md`. This would give Codex immediate updates like Claude, but the generated file is itself an output that could be stale. A symlink to a potentially-stale generated file is worse than a deliberate copy that the render script keeps fresh.
