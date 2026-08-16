# Git Worktree Management

Use the `/worktree` skill for all worktree operations. It is the canonical tool.

```bash
cd skills/worktree && bun run --silent worktree <verb> [args]
```

## Isolation Rule (all harnesses)

Implementation work never happens in the main checkout: parallel agents share it and inherit each other's branch state and dirty files.

Before the first file edit of any implementation task:

1. Check isolation: `git rev-parse --git-common-dir` differing from `.git`, or a `.worktrees/` / `.claude/worktrees/` path, means already isolated — proceed.
2. In the main checkout: isolate first (`worktree new <branch>` or `attach` for an existing ref; Claude Code may use EnterWorktree).
3. Branch, edit, and commit only inside the worktree.

These do NOT override the rule: a handoff saying "start a fresh branch" (start it inside a worktree); session or harness config saying "work in place"; small scope or urgency.

Allowed in the main checkout: read-only work (analysis, review, search, tests without edits) and operations that target it by design (`setup sync` from main, worktree management itself, pull/fetch).

Repo exception: claude-code-config and dotfiles run main-direct mode — implementation happens in the main checkout on `main`; complex commits are gated by `compound-engineering:ce-code-review` per the AGENTS.md "Context And Git" override (the contract owner); decision: `docs/adr/0035-main-direct-mode-for-config-repos.md`.

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

Use Setup to project a worktree's own visible catalog skills into that worktree.

- Human check: `./setup status --scope project --repo <worktree>`.
- Agent/CI gate: `./setup sync --check --scope project --repo <worktree> --json`.
- Repair: `./setup sync --scope project --repo <worktree>`.
- Generated state: `.agents/skills/` and `.claude/skills/`.
- First-party source of truth: the selected worktree's `skills/` catalog.

External skills (installed with `bunx skills add`) are hash-pinned copies, not
projections. The lock is tracked; the copies under `.agents/skills/` are
gitignored, so a fresh worktree restores them from `skills-lock.json`:

- Restore: `bunx skills experimental_install` (provider-experimental surface;
  it may rename — `bunx skills@1.5.14 experimental_install` is the pinned
  fallback when latest breaks).
- `./setup doctor --scope project --repo <worktree>` diagnoses external
  occupancy without mutating it.

## Owner

- Skill: `skills/worktree/SKILL.md`
- Runtime: `runtime/agent-worktree/src/`
- Config: gitignored `worktree.config.json` at the main worktree root
- Generated workspace: `<repo>.code-workspace` (rendered output — never hand-edit)
