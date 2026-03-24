---
title: "my-second-brain Rename from v2"
type: adr
status: accepted
updated: 2026-03-22
summary: "Why we renamed my-second-brain-v2 to my-second-brain and how the migration was executed."
---

# ADR: my-second-brain Rename from v2

## Status

Accepted (2026-03-22)

## Context

The life vault repo existed at `~/code/my-second-brain-v2` — a transitional name from when it replaced v1. The `-v2` suffix was being cemented into docs, scripts, configs, and memory contracts across 5+ repos. The Memory OS contract referenced it as the canonical life-hub.

An older `~/code/my-second-brain` (v1) also existed with stale work that had been redone in v2. A backup of v1 existed at `~/code/my-second-brain-backup-2026-03-16-210353`.

## Decision

1. Move v1 and its backup to `~/code/my-second-brain-backups/` (not deleted, archived)
2. Rename `~/code/my-second-brain-v2` to `~/code/my-second-brain`
3. Update all references across source files in 5 repos
4. Update `~/.codex/config.toml` project trust path
5. Migrate Claude project memory from old path to new path

## Migration Details

- **47 references** updated across **30 files** in 5 repos (claude-code-config, my-second-brain, personal-messages, dotfiles, memory-context)
- **Verification:** grep confirmed zero remaining `my-second-brain-v2` references across all source files
- **Deliberately untouched:** `~/.claude/plans/`, `~/.codex/sessions/`, `~/.codex/history.jsonl` (ephemeral historical records)
- **Codex config.toml:** duplicate key error fixed (old v1 entry + renamed v2 entry collided)
- **Project memory:** 11 files copied from `~/.claude/projects/-Users-nathanvale-code-my-second-brain-v2/memory/` to new path, MEMORY.md index merged (15 total entries)

## Consequences

- All repos now reference `my-second-brain` consistently
- The old v2 project cache at `~/.claude/projects/-Users-nathanvale-code-my-second-brain-v2/` is stale but harmless
- v1 backups at `~/code/my-second-brain-backups/` can be deleted when no longer needed
