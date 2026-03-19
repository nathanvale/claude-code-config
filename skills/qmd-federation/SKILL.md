---
name: qmd-federation
description: Inspect or set up the shared QMD federation from the Memory OS roster. Use when you want to see the current collection plan, generate QMD commands, or apply the roster after QMD is installed.
argument-hint: [plan|commands|status|apply]
disable-model-invocation: true
allowed-tools: Bash(bun run /Users/nathanvale/.config/memory/scripts/qmd-roster-sync.ts *)
---

# QMD Federation

Use the shared Memory OS contract at `~/.config/memory/AGENTS.md`.

## Goal

Turn the shared federation roster into an executable QMD setup plan.

## Read Order

1. `~/.config/memory/docs/qmd-federation.md`
2. `~/.config/memory/federation/roster.yml`

## Workflow

1. Run `bun run ~/.config/memory/scripts/qmd-roster-sync.ts $ARGUMENTS`.
2. If no argument is given, default to `plan`.
3. Use `commands` to print the exact QMD collection/context commands.
4. Use `status` to verify the roster shape and whether `qmd` is installed.
5. Use `apply` only after confirming QMD is installed and you want to configure collections.
6. For embedding or deeper QMD verification on this machine, use `~/.config/memory/scripts/qmd-node.sh`.

## Rules

- Prefer `plan` or `commands` before `apply`.
- If `qmd` is missing, stop at planning and explain the gap.
- Run QMD CLI commands sequentially when checking status, collections, or applying updates against the same index.
- Prefer `~/.config/memory/scripts/qmd-node.sh embed` over `qmd embed` on this machine.
- Keep the roster in `~/.config/memory/federation/roster.yml` as the source of truth.
