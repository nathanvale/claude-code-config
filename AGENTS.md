# Claude Code Configuration Repository Instructions

## Scope

- Work directly on `main` with one canonical writer. Do not create a worktree
  or pull request for this repository.
- Ask before commits, branch changes, destructive operations, broad refactors,
  new dependencies, or pushes.
- Keep personal startup content and user-scope pointer installation owned by
  `$HOME/code/dotfiles`. This repository does not manage personal `AGENTS.md`
  or `CLAUDE.md` destinations.

## Owners

- First-party skills: edit `skills/<id>/`. Read
  `skills/skill-author/references/skill-design-decision-runbook.md` before
  authoring or reviewing a skill. Treat `~/.agents/skills` and
  `~/.claude/skills` as projections.
- Setup topology: read `runtime/setup/CONTEXT.md` and its nearest instructions.
- Agent-instruction health: use `scripts/agent-instructions.sh`.
- Implementation or debugging: search relevant `docs/solutions/` entries.
- Repository terminology or orientation: read `CONCEPTS.md`.
- New module boundary or proposed design pattern: read `context/code-style.md`
  and use `codebase-design` with `gof-pressure-lens`.
- Repository Git procedure: read `docs/git/` for the triggering operation.
- Research, browser, and tool-specific work: use the matching skill. Keep its
  workflow out of this file.

## Proof

- After a first-party skill content change, run `./setup sync --check --json`.
  Apply `./setup sync` only for an approved add, rename, removal, or repair.
- After repository-instruction changes, run
  `bash scripts/agent-instructions.sh check --json`.
- Select targeted Bun tests and type checks from the changed package. Use its
  package contract and `CONTEXT.md`; report any broader proof gap.
- Keep generated projections unchanged unless the owning setup command creates
  them.

## Code Review Rules

- Flag edits to projected first-party skills. Safe path: edit `skills/<id>/`
  and verify the projection with `./setup sync --check --json`.
- Flag setup topology that creates, removes, or checks personal
  `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, or
  `~/.claude/AGENTS.md`. Safe path: leave those destinations to dotfiles.
- Flag behavior-changing setup code without a focused contract or integration
  test for the public command path.
- Leave formatting and lint findings to their executable checks.
