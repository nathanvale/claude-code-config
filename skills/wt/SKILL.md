---
name: wt
description: "Render per-repo VS Code workspaces from branch-keyed prefs and shared worktree runtime."
role: tool-workflow
---

# wt

Triggers: render/sync/focus/color/open VS Code workspaces across git worktrees.
Triggers: create/remove/prune worktrees through the `wt` workflow entry point.

Do not hand-edit the generated `.code-workspace`. Edit the registry; let `wt` render.
Do not shell out to old worktree wrappers. `wt` calls the shared `runtime/agent-worktree` library.

## Owner

- Generated workspace: `<repo>.code-workspace` (rendered output — never hand-edit).
- Source of truth: gitignored `wt.config.json` at the main worktree root (branch-keyed prefs).
- Command contract: `skills/wt/src/command-contract.ts`.
- Model (types + constants): `skills/wt/src/model.ts`.
- Render engine (pure): `skills/wt/src/wt-engine.ts`.
- Discovery (worktree list + registry): `skills/wt/src/wt-discovery.ts`.
- Dispatcher (argv + IO + launch): `skills/wt/src/wt.ts`.
- Shared worktree runtime: `runtime/agent-worktree/src/index.ts`.
- Package command recipe: `skills/wt/package.json`.
- Runtime tests + alignment proof: `skills/wt/src/wt.test.ts`, `skills/wt/src/wt-engine.test.ts`, `skills/wt/src/wt-discovery.test.ts`.
- Plan: `docs/plans/2026-06-14-001-feat-wt-worktree-workspace-renderer-plan.md`.

## Dependencies

- `@side-quest/cli-command-facade`: hard dependency (facade-backed contract). Registered in root `package.json` workspaces.
- `runtime/agent-worktree`: hard dependency for live worktree discovery, main-owner resolution, lifecycle verbs, cleanup preview, and recovery vocabulary.
- `code` on PATH (or `defaults.codeBin`): needed only by `wt open <name>`. Absent → `code_not_found`, other verbs unaffected.
- `create-cli`: hard dependency before changing the CLI contract surface.

## Workflow

1. Work from repo root; run `cd skills/wt && bun run --silent wt <verb> ...`.
2. Choose the verb: render (`sync`), set a pref (`focus`/`color`), launch (`open`), or worktree CRUD (`new`/`rm`/`clean`).
3. For owned render verbs, let the engine read worktree state, use the main worktree as the durable owner, and guard manual edits through the drift gate.
4. For lifecycle verbs, let `wt` call `runtime/agent-worktree`, then re-render when state changes.
5. On `drift_blocked`, review the diff; port real changes into `wt.config.json`, then rerun with `--force`.
6. Report the verb, the workspace path, and the next safe action.

## Verification

- Run `bun --filter wt-scripts test`.
- Run `bun --filter wt-scripts typecheck`.
