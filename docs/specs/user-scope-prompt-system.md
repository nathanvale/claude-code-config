---
title: "User-Scope Prompt System"
type: spec
status: active
updated: 2026-03-22
summary: "How user-scope agent instructions are managed, rendered, and delivered to Claude Code and Codex from this repo."
---

# User-Scope Prompt System

## What This System Does

This repo (`claude-code-config`) is the canonical source for user-scope instruction files that Claude Code and Codex load at the start of every session. It manages what those tools read, keeps them in sync, and prevents drift.

## How Claude Code Finds Instructions

Claude Code has hardcoded behavior — it always reads these paths:

1. `~/.claude/CLAUDE.md` — loaded every session
2. `~/.claude/rules/*.md` — files with `alwaysApply: true` loaded every session
3. Project-local `CLAUDE.md` and `rules/` layered on top

We don't control this behavior. We control what files exist at those paths.

## How Codex Finds Instructions

Codex reads `~/.codex/AGENTS.md` at session start. That's it — no rules directory, no import syntax.

## How This Repo Delivers Files

### Symlinks (Claude)

`install.sh` creates symlinks so `~/.claude/` files point at this repo:

| Symlink | Target |
|---------|--------|
| `~/.claude/CLAUDE.md` | `$REPO/CLAUDE.md` |
| `~/.claude/AGENTS.md` | `$REPO/AGENTS.md` |
| `~/.claude/rules/` | `$REPO/rules/` |
| `~/.claude/context/` | `$REPO/context/` |
| `~/.claude/skills/` | `$REPO/skills/` |
| `~/.claude/commands/` | `$REPO/commands/` |
| `~/.claude/agents/` | `$REPO/agents/` |
| `~/.claude/.mcp.json` | `$REPO/.mcp.json` |
| `~/.config/memory/` | `$REPO/memory/` |

When you edit a file in this repo, Claude sees it immediately — the symlink means it's the same file.

### Copy (Codex)

`~/.codex/AGENTS.md` is a **copy**, not a symlink. The render script copies `generated/codex-user-agents.md` into `~/.codex/AGENTS.md`. If you change a fragment, you must re-render for Codex to see it.

## The CLAUDE.md → @AGENTS.md Import

`CLAUDE.md` is a thin wrapper:

```
@AGENTS.md

## Claude-Specific Notes
- Skills, Obsidian, newsroom, etc.
```

The `@AGENTS.md` line is Claude Code's import syntax. It pulls in the contents of `AGENTS.md` from the same directory. This means Claude loads both files — the shared core from AGENTS.md plus Claude-only notes from CLAUDE.md.

This import syntax is resolved relative to the file's directory. Since both files are symlinked into `~/.claude/`, the resolution works.

**Known fragility:** Issue #8765 reports problems with absolute `@~/.claude/` paths. We use relative paths which sidestep this, but it's a known area of instability.

## Prompt Fragments

### What They Are

Small markdown files in `prompt-fragments/` that get concatenated to produce rendered output files. They're not a Claude Code feature — they're just our way of organizing source content.

### Why They Exist

Claude and Codex need mostly the same instructions (personal context, safety rules, communication style) but each needs some unique content (Claude gets slash-command notes, Codex gets a tool compatibility map). Fragments let us maintain shared content once and compose different outputs.

### Structure

```
prompt-fragments/
  shared/           → Goes into both Claude and Codex output
    intro.md
    critical-rules.md
    tool-routing.md
    communication-style.md
    key-people.md
    memory-os.md
  claude/           → Goes into Claude output only
    claude-runtime-notes.md
  codex/            → Goes into Codex output only
    codex-runtime-notes.md
    tool-map.md
```

### How Rendering Works

`scripts/render-user-prompts.sh --write` concatenates fragments into output files:

- `shared/*` → `AGENTS.md` (80 lines, shared core)
- `@AGENTS.md` + `claude/*` → `CLAUDE.md` (12 lines, thin wrapper)
- `shared/*` + `codex/*` → `generated/codex-user-agents.md` (104 lines, standalone)

The generated Codex file is then copied to `~/.codex/AGENTS.md`.

**Nothing runs automatically.** You change a fragment, you run `--write`, it rebuilds. Symlinks deliver the Claude changes immediately. The Codex copy is updated by the script.

## Rules

Rules live in `rules/` and are symlinked to `~/.claude/rules/`. Each has `alwaysApply: true` frontmatter so Claude loads them every session.

| Rule | Purpose |
|------|---------|
| `context7.md` | Always use Context7 MCP for library docs |
| `tool-routing.md` | Always use `response_format: "json"` for MCP tools |
| `newsroom-trigger.md` | Auto-invoke `/newsroom:investigate` for community research |
| `memory-os.md` | Memory OS governance — what goes where |

Rules are Claude-only. Codex doesn't have a rules directory.

## Context Files

Context files live in `context/` and are symlinked to `~/.claude/context/`. They are **not** loaded automatically — Claude only reads them when invoked with `@~/.claude/context/filename.md`.

| File | Content |
|------|---------|
| `hardware.md` | Monitor, Mac specs, SSH details |
| `known-issues.md` | Bunx cache, git-safety hook, VS Code |
| `git-workflow.md` | Git safety, conventional commits |
| `code-style.md` | TypeScript, testing, JSDoc |
| `search-tools.md` | Kit plugin tool selection |
| `bun-runner.md` | Test/lint MCP tools |
| `atuin.md` | Shell history search |
| `personal.md` | Birthdays, hobbies, details |
| `obsidian-setup.md` | PARA method, vault commands |

## Safety Checks

`scripts/render-user-prompts.sh --check` runs 7 validations:

| Check | What It Catches | Self-Maintaining? |
|-------|----------------|-------------------|
| Fragment drift | Rendered files don't match source fragments | Yes |
| @AGENTS.md shim | Broken symlink or missing import target | Yes |
| Codex parity | `~/.codex/AGENTS.md` desynced from generated | Yes |
| Context file existence | memory-os fragment references a missing file | Needs update when adding context files |
| Orphan fragments | `.md` in `prompt-fragments/` not wired into render | Yes |

## Editing Workflow

1. Edit a file in `prompt-fragments/`
2. Run `scripts/render-user-prompts.sh --write`
3. Run `scripts/render-user-prompts.sh --check`
4. If check passes — done, symlinks deliver to Claude immediately, Codex copy updated
5. If check fails — fix the issue and re-render

## Size Budget

| File | Lines | Token estimate |
|------|-------|---------------|
| AGENTS.md | 82 | ~3,300 |
| CLAUDE.md | 12 | ~500 |
| Rules (4 files) | ~55 | ~2,200 |
| **Total hot-loaded** | **~149** | **~6,000** |

Community consensus: keep under 200 lines / 10,000 tokens. We're well within budget.

## What the Memory OS Contract Is

The Memory OS contract (`~/.config/memory/AGENTS.md`) is a governance document — it tells *us* (and skills like `/capture`) how to organize information across repos. Claude doesn't read it automatically. It only knows about Memory OS through:

1. The summary in `AGENTS.md` (pointers to where things live)
2. The `rules/memory-os.md` auto-applied rule (behavioral governance)
3. Skills that reference the contract directly (e.g., `/capture`, `/memory-capture`)

## Design Rationale

See `docs/decisions/2026-03-22-fragment-rendering-over-manual-sync.md` for why we chose fragments over manual maintenance.
