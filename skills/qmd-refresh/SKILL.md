---
name: qmd-refresh
description: Refresh the shared QMD federation end-to-end. Use when you want to re-apply the roster, re-index collections, refresh embeddings, and print final status.
argument-hint: [--skip-embed]
disable-model-invocation: true
allowed-tools: Bash(~/.config/memory/scripts/qmd-refresh.sh *)
---

# QMD Refresh

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md`.

## Goal

Refresh the federated QMD index with one stable user-level command.

## Read Order

1. `~/.config/memory/docs/qmd-federation.md`
2. `~/.config/memory/federation/roster.yml`

## Workflow

1. Run `~/.config/memory/scripts/qmd-refresh.sh $ARGUMENTS`.
2. If no argument is given, run the full refresh including embeddings.
3. Use `--skip-embed` when you only want a faster re-index pass.

## Rules

- Run this sequentially; do not parallelize QMD maintenance commands.
- Prefer the default full refresh after meaningful cross-repo note changes.
- Use `--skip-embed` when you only changed a small amount of markdown and want the faster path.
