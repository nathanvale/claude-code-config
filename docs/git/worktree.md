# Git Worktree Management

Use the `/worktree` skill for all worktree operations. It is the canonical tool.

```bash
cd skills/worktree && bun run --silent worktree <verb> [args]
```

## Verbs

| Verb | What it does | Side effects |
|---|---|---|
| (no args) | Layman front door — explains VS Code sync and worktree CRUD | read-only |
| `status` | Enriched view: branch, commits ahead/behind, dirty/clean, PR status, Codex state | read-only |
| `new <branch>` | Create worktree, copy config files, register Codex app sidebar | creates `.worktrees/<branch>/` |
| `sync <branch>` | Re-copy config files from main to a linked worktree | overwrites config files |
| `open <branch>` | Open worktree in VS Code | launches VS Code |
| `app <branch>` | Open worktree as Codex App project | launches Codex |
| `focus <branch>` | Set branch focus in workspace registry | updates `worktree.config.json` |
| `color <branch>` | Set workspace color for a worktree | updates `worktree.config.json` |
| `rm <branch>` | Remove worktree, deregister Codex sidebar, archive threads | deletes `.worktrees/<branch>/` |
| `clean` | Preview merged+clean worktrees for batch removal | preview-only by default |

## When to Use

- Creating a worktree for parallel branch development → `new`
- Inspecting worktree state or choosing next action → `status` or no args
- Propagating .env or .claude config changes → `sync`
- Cleaning up merged worktrees → `clean`
- Opening a worktree in VS Code or Codex → `open` / `app`

## Safety

- Never force-remove a dirty worktree. Uncommitted work is potentially important.
- On `clean` with dirty worktrees: preserve first — commit, stash, or ask.
- On `rm` with dirty worktrees: the runtime blocks with `reason: "dirty"`. Do not bypass with `--force` unless the user has reviewed and approved loss.
- On orphan branch deletion: check `git log main..<branch>` first. If unmerged commits exist, ask before deleting.

## Shared Location Across Tools (Claude + Codex)

One worktree location serves every tool. Worktrees live in `<repo>/.worktrees/<branch>/` (gitignored). A git worktree is just a directory — no tool owns it, so all of them open the same one.

- **Create** worktrees via the `/worktree` skill, not by letting a tool auto-create its own.
- **Front door:** `worktree status --json` inspects the owner root, VS Code workspace state, linked worktrees, CRUD actions, and next safe action.
- **Claude / shell:** `cd <repo>/.worktrees/<branch>`.
- **Codex App:** `worktree app <branch>` opens the repo-local worktree as a Codex App project. Do not rely on Codex auto-creating worktrees under `~/.codex/worktrees/<hash>/` — those are invisible to the shared convention.
- **Codex cleanup:** `worktree rm <branch> --force` removes the worktree, deregisters from Codex Desktop, and archives matching threads.
- **Never** scatter worktrees across `~/.codex/worktrees/`, `<repo>/.claude/worktrees/`, and `<repo>/.worktrees/`.

## Repo-local skills

Use `agent-skills` to project visible catalog skills into each worktree.

- Human check: `agent-skills status`.
- Agent/CI gate: `agent-skills sync --check --json`.
- Repair: `agent-skills sync`.
- Generated state: `.agents/skills/`, `.claude/skills/`, `.agents/agent-skills-snapshot.json`.
- Source of truth: `skills/` plus `.agent-skills.yml` plus `skills-lock.json`.

External skills (installed with `bunx skills add`) are hash-pinned copies, not
projections. The lock is tracked; the copies under `.agents/skills/` are
gitignored, so a fresh worktree restores them from `skills-lock.json`:

- Restore: `bunx skills experimental_install` (provider-experimental surface;
  it may rename — `bunx skills@1.5.14 experimental_install` is the pinned
  fallback when latest breaks).
- `agent-skills status` reports installed externals and counts missing ones
  with the restore hint; externals never block `sync`.

## Owner

- Skill: `skills/worktree/SKILL.md`
- Runtime: `runtime/agent-worktree/src/`
- Config: gitignored `worktree.config.json` at the main worktree root
- Generated workspace: `<repo>.code-workspace` (rendered output — never hand-edit)
