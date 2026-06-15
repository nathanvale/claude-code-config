---
name: worktree
description: "WorkTree: render VS Code workspaces and manage git worktrees from branch-keyed prefs."
role: tool-workflow
---

# WorkTree

Triggers: render/sync/focus/color/open VS Code workspaces across git worktrees.
Triggers: create/remove/prune worktrees through the `worktree` workflow entry point.

Do not hand-edit the generated `.code-workspace`. Edit the registry; let `worktree` render.
Do not shell out to old worktree wrappers. `worktree` calls the shared `runtime/agent-worktree` library.

## Owner

- Generated workspace: `<repo>.code-workspace` (rendered output — never hand-edit).
- Source of truth: gitignored `worktree.config.json` at the main worktree root (branch-keyed prefs).
- Daily view ignores: `defaults.ignoredWorktrees` path globs, e.g. `["**/fallow-audit-base-cache-*"]`.
- Contract, model, engine, discovery, and dispatcher: `skills/worktree/src/`.
- Shared worktree runtime: `runtime/agent-worktree/src/index.ts`.
- Package command recipe: `skills/worktree/package.json`.
- Runtime tests + alignment proof: `skills/worktree/src/`.

## Dependencies

- `@side-quest/cli-command-facade`: hard dependency (facade-backed contract). Registered in root `package.json` workspaces.
- `runtime/agent-worktree`: hard dependency for live worktree discovery, main-owner resolution, lifecycle verbs, cleanup preview, and recovery vocabulary.
- `code` on PATH (or `defaults.codeBin`): needed only by `worktree open <name>`. Other verbs do not launch VS Code.
- `create-cli`: hard dependency before changing the CLI contract surface.

## Workflow

1. Work from repo root; run `cd skills/worktree && bun run --silent worktree <verb> ...`.
2. Choose the verb: render (`sync`), set a pref (`focus`/`color`), launch (`open`), or worktree CRUD (`new`/`rm`/`clean`).
3. For owned render verbs, let the engine read worktree state, use the main worktree as the durable owner, and guard manual edits through the drift gate.
4. For lifecycle verbs, let `worktree` call `runtime/agent-worktree`, then re-render when state changes.
5. On `drift_blocked`, review the diff; port real changes into `worktree.config.json`, then rerun with `--force`.
6. Report the verb, the workspace path, and the next safe action.

## Verification

- Run `bun --filter worktree-scripts test`.
- Run `bun --filter worktree-scripts typecheck`.
