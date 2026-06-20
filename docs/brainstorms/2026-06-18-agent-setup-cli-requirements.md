---
date: 2026-06-18
topic: agent-setup-cli
---

# Agent Setup CLI Requirements

## Summary

Replace `install.sh` with `agent-setup`, a single agent-native CLI that owns symlink topology, git hook installation, and agent-instructions health reporting. Skills are excluded (managed by `npx skills`). The CLI provides ADHD-friendly observability, repair hints, and structured JSON output for agents.

---

## Problem Frame

`install.sh` is 242 lines of bash doing what a standard dotfiles tool does in one command. It bundles symlink creation, Codex per-skill projection (dead code), git hook installation, agent-instructions health checks, and v2 runbook presence checks. The complexity is disproportionate to the task, and the script has no structured output for agent consumers.

Community patterns (GNU Stow, dedicated dotfiles repos, manual symlinks) show that symlink management is a solved problem. The value of a custom tool is the agent-native contract (structured JSON, repair hints, next-safe-action) and ADHD-friendly observability (adaptive output, one next action, progressive help).

---

## Key Decisions

- **Full install.sh replacement.** One tool owns everything install.sh does. No coexistence. install.sh is deleted after agent-setup is proven.
- **Named `agent-setup`.** Follows the `agent-*` convention (`agent-worktree`). Lives at `runtime/agent-setup`.
- **Shell entrypoint that bootstraps Bun.** Solves the chicken-and-egg problem on fresh machines. Shell wrapper checks for Bun, installs deps if needed, hands off to TypeScript CLI.
- **Adaptive bare command.** One command adapts output to current state: calm dashboard when healthy, doctor with repair hints when broken, compact summary when clean slate (all missing). No separate `doctor` command.
- **Sync bundles symlinks + git hooks + agent-instructions check.** One command, fully operational clone. No forgotten second step.
- **Sync auto-applies safe changes, stops on conflicts.** Missing and wrong/broken links are safe to fix silently. Real files blocking a symlink (conflicts) require manual resolution. Sync writes nothing when conflicts exist for that link.
- **Skills excluded.** Managed by `npx skills`. agent-setup does not touch `~/.claude/skills/`, `~/.codex/skills/`, or `.agents/skills/`.
- **Envelope-shaped JSON, hand-rolled.** Follows the `agent-worktree` JSON envelope shape (`status`, `run_id`, `data` with `next_safe_action` + `changed_state`, `error` with `recoverability`/`hint`) without the facade dependency. Promotable to facade-backed later.

---

## Requirements

### Command Surface

- R1. Bare command (`agent-setup`) adapts output based on state: calm dashboard, doctor, or clean-slate summary.
- R2. `agent-setup sync` creates missing links, fixes wrong/broken links, installs git hooks, runs agent-instructions health check. Stops on conflicts without writing.
- R3. `agent-setup sync --check` previews what sync would do. Exit 0 when clean, 1 when sync needed.
- R4. `agent-setup unlink` removes all managed symlinks.
- R5. `agent-setup help` provides progressive ADHD-friendly help: what the tool does, what it manages, what it doesn't, typical workflow.
- R6. `--verbose` on bare command shows every link and where it points, not collapsed groups.
- R7. `--json` on any command emits structured agent-native envelope.
- R8. Respect `NO_COLOR`, `TERM=dumb`, and `--no-color`.

### Topology

- R9. Manage these symlinks:

  | Link | Target | Group |
  |------|--------|-------|
  | `~/.claude/CLAUDE.md` | `$REPO/CLAUDE.md` | claude |
  | `~/.claude/AGENTS.md` | `$REPO/AGENTS.md` | claude |
  | `~/.claude/context` | `$REPO/context` | claude |
  | `~/.claude/rules` | `$REPO/rules` | claude |
  | `~/.claude/commands` | `$REPO/commands` | claude |
  | `~/.claude/agents` | `$REPO/agents` | claude |
  | `~/.claude/runbooks` | `$REPO/runbooks` | claude |
  | `~/.claude/hooks` | `$REPO/hooks` | claude |
  | `~/.claude/hooks.json` | `$REPO/hooks.json` | claude |
  | `~/.claude/settings.json` | `$REPO/settings.json` | claude |
  | `~/.claude/.mcp.json` | `$REPO/.mcp.json` | claude |
  | `~/.codex/AGENTS.md` | `$REPO/AGENTS.md` | codex |
  | `~/.config/memory` | `$REPO/memory` | config |

- R10. Do not manage `~/.claude/skills/`, `~/.codex/skills/`, or `.agents/skills/`.
- R11. `settings.local.json` is machine-specific and stays gitignored. agent-setup does not touch it.

### Health Model

- R12. Classify each link as: `ok`, `missing`, `wrong` (points elsewhere), `broken` (dangling), or `conflict` (real file/directory).
- R13. Bare command shows one next action based on state priority: conflict > broken/wrong > missing > healthy.
- R14. Doctor output includes: what's wrong, why it matters (plain language), and a copy-pasteable repair command.
- R15. Repair commands use literal paths that work when pasted into a shell (`~` expansion for link paths, full paths for targets).

### Agent Contract

- R16. JSON envelope follows `agent-worktree` shape: `status`, `run_id`, `data`, `error`, `duration_ms`.
- R17. `data` includes `next_safe_action`, `changed_state` (`none`, `links_created`, `links_removed`).
- R18. `error` includes `code`, `message`, `severity`, `recoverability` (`change_input`, `manual_repair`, `retry`), `hint` with `summary` and `action`.
- R19. `sync --check --json` is the agent/CI preflight gate. Exit 0 clean, exit 1 needs sync, exit 2 invalid usage.

### Entrypoint

- R20. Shell entrypoint script checks for Bun, offers to install it, installs package deps, then delegates to the TypeScript CLI.
- R21. The TypeScript CLI lives at `runtime/agent-setup/src/cli.ts`.

---

## Scope Boundaries

### Deferred for later

- Facade-backed command contract (promote when surface grows).
- Branch Station Catalog.
- GNU Stow integration (evaluate as implementation detail during planning).
- Repo-scope setup (project-level `.claude/` wiring, not user-scope).

### Outside this product's identity

- Skill projection or distribution (`npx skills` owns this).
- Instruction authoring or content editing.
- Package management or version solving.
- MCP server configuration beyond symlinking `.mcp.json`.
- Codex per-skill symlinking (dead, being removed).

---

## Acceptance Examples

- AE1. Given a fresh clone with no existing links, `agent-setup` shows a compact clean-slate summary with one next action.
- AE2. Given `agent-setup sync` on a fresh clone, all 13 links are created, git hooks installed, agent-instructions check runs, and the command exits 0.
- AE3. Given one conflict (real file at `~/.claude/settings.json`), `agent-setup sync` creates the other 12 links but stops on the conflict with a repair hint.
- AE4. Given a healthy state, `agent-setup` shows a calm dashboard with "All good. Nothing to do."
- AE5. Given a wrong link, `agent-setup` shows doctor output with "why it matters" and a copy-pasteable fix command.
- AE6. Given `agent-setup sync --check --json`, the output is a valid agent-native envelope with `next_safe_action` and `changed_state: none`.
- AE7. Given `agent-setup` on a machine without Bun, the shell entrypoint offers to install Bun before proceeding.

---

## Dependencies And Assumptions

- Bun is the TypeScript runtime (consistent with `runtime/agent-worktree`).
- `scripts/install-git-hooks.sh` exists and is executable.
- `scripts/agent-instructions.sh` exists and supports `check` subcommand.
- `npx skills` will manage skill projection separately.

---

## Sources

- Product review: compound-engineering:ce-product-lens-reviewer findings on the prototype.
- Community research: newsroom-investigate on Claude Code ~/.claude source control patterns.
- Existing patterns: `runtime/agent-worktree/src/cli.ts`, `skills/browser-use/src/browser-use.ts`.
- Glossary: `skills/prompt-system-workflow/CONTEXT.md` "Agent setup CLI" term.
- Prototype: `runtime/setup/src/cli.ts`.
