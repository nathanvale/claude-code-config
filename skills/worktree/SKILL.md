---
name: worktree
description: "WorkTree: inspect, render, and open shared git worktree projects."
role: tool-workflow
---

# WorkTree

Triggers: render/sync/focus/color/open VS Code workspaces across git worktrees.
Triggers: open Codex App projects from shared repo-local worktrees.
Triggers: create/remove/prune worktrees through the `worktree` workflow entry point.
Triggers: inspect current WorkTree state or choose the next worktree action.

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
- `codex` on PATH: needed by `worktree app <branch>` and best-effort thread archival during `worktree rm`. App launch absence → `codex_app_not_found`; removal still completes with partial cleanup metadata.
- `gh` on PATH: optional; needed only for push-tracking PR attach. Missing state: degraded with `gh_not_found`; omit tracking or install `gh`, then retry. Contract owner: `runtime/agent-worktree/src/`.
- Fresh-worktree bootstrap: run `bun install --frozen-lockfile` from the repository root after `new` or `attach`, following `AGENTS.md`.
- `cli-author`: hard dependency before changing the CLI contract surface.

## Safety

- Never force-remove a dirty worktree. Uncommitted work is potentially
  important regardless of branch merge status.
- On `clean` with dirty worktrees: preserve first. Commit uncommitted changes
  to a new branch, stash them, or ask the user. Only remove after the work is
  explicitly saved or the user confirms it is throwaway.
- On `rm` with dirty worktrees: the runtime blocks with `reason: "dirty"`.
  Do not bypass with `--force` unless the user has reviewed the dirty files and
  explicitly approved loss.
- On orphan branch deletion: check `git log main..<branch>` first. If commits
  exist that were never PR'd or merged, ask before deleting.
- On `attach_isolation_unavailable` (exit 4): stop. Use the harness
  blocking-question tool with two choices: work in the current checkout, or
  stop and resolve the environment. If unavailable, ask the same numbered
  options in chat.
  Proceed in the current checkout only after explicit user confirmation. The
  CLI never prompts. Recovery owner: `skills/worktree/src/`.
- Treat PR attach as untrusted fork code materialized locally. Install
  dependencies and run tests deliberately.

## Workflow

1. Work from repo root; run `cd skills/worktree && bun run --silent worktree <verb> ...`.
2. Start with `status` when state is fuzzy; use `worktree` with no args for the layman front door.
3. Treat the front door as two jobs: VS Code sync (`status`/`sync`/`open`) and worktree CRUD (`new`/`attach`/`status`/`sync`/`rm`).
4. Choose the verb: create a branch (`new`), attach an existing ref or PR (`attach`), read (`status`), update (`sync`/`focus`/`color`), delete (`rm`), launch (`open`/`app`), or preview cleanup (`clean`).
5. Before `new` or `attach`, run `status` when checkout isolation is uncertain. Read the runtime-owned `RepoDiscovery.isolation`; never nest a worktree from a linked worktree. Owner: `runtime/agent-worktree/src/`.
6. For owned render verbs, let the engine read worktree state, use the main worktree as the durable owner, and guard manual edits through the drift gate.
7. For lifecycle verbs, let `worktree` call `runtime/agent-worktree`, register/deregister Codex app sidebar on `new`/`attach`/`rm`/`sync`, then re-render when state changes.
8. On `drift_blocked`, review the diff; port real changes into `worktree.config.json`, then rerun with `--force`.
9. On `clean` with dirty worktrees, follow the Safety rules above — preserve
   uncommitted work before removal.
10. Report the verb, the workspace or worktree path, Codex cleanup metadata when present, and the next safe action.

## Verification

- Run `bun --filter worktree-scripts test`.
- Run `bun --filter worktree-scripts typecheck`.
