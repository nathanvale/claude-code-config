---
name: wt
description: "Render per-repo VS Code workspaces from a branch-keyed registry and delegate worktree CRUD to @side-quest/git."
role: tool-workflow
---

# wt

Use when the user asks to render, sync, focus, color, or open a VS Code workspace across git worktrees.
Use when creating, removing, or pruning worktrees through the one `wt` front door.

Do not hand-edit the generated `.code-workspace`. Edit the registry; let `wt` render.
Do not re-implement worktree CRUD. `wt` delegates to `@side-quest/git worktree`.

## Owner

- Generated workspace: `<repo>.code-workspace` (rendered output — never hand-edit).
- Source of truth: gitignored `wt.config.json` at repo root (branch-keyed prefs).
- Command contract: `skills/wt/src/command-contract.ts`.
- Model (types + constants): `skills/wt/src/model.ts`.
- Render engine (pure): `skills/wt/src/wt-engine.ts`.
- Discovery (worktree list + registry + delegation): `skills/wt/src/wt-discovery.ts`.
- Dispatcher (argv + IO + launch): `skills/wt/src/wt.ts`.
- Runtime tests + alignment proof: `skills/wt/src/wt.test.ts`.
- Upstream worktree CLI: `docs/git/worktree.md` (`@side-quest/git worktree`).
- Plan: `docs/plans/2026-06-14-001-feat-wt-worktree-workspace-renderer-plan.md`.

## Dependencies

- `@side-quest/cli-command-facade`: hard dependency (facade-backed contract). Registered in root `package.json` workspaces.
- `@side-quest/git worktree`: hard dependency for delegated verbs (`new`/`rm`/`clean`). Absent → delegated verbs blocked; owned render verbs still work.
- `code` on PATH (or `defaults.codeBin`): needed only by `wt open <name>`. Absent → `code_not_found`, other verbs unaffected.
- `create-cli`: hard dependency before changing the CLI contract surface.

## Workflow

1. Read worktree + registry state; never hand-edit the generated workspace.
2. Choose the verb: render (`sync`), set a pref (`focus`/`color`), launch (`open`), or worktree CRUD (`new`/`rm`/`clean`).
3. For owned verbs, run `wt`; the engine renders and the drift gate guards manual edits.
4. For CRUD verbs, `wt` delegates to `@side-quest/git worktree`, then re-renders.
5. On `drift_blocked`, review the diff; port real changes into `wt.config.json`, then rerun with `--force`.
6. Report the verb, the workspace path, and the next safe action.
