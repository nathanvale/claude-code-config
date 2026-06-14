# `wt` — Agent-Native Worktree Workspace Renderer

**Date:** 2026-06-14
**Status:** Requirements (ready for `create-cli` → `ce-plan`)
**Owner repo:** `claude-code-config` (lives under `skills/`)

---

## Problem

Nathan hand-edits `~/code/worktrees.code-workspace` to shape his VS Code view across git worktrees. Manual editing is fragile, doesn't scale across repos, and carries no ADHD scaffolding (every worktree window looks identical — same name, same color, same noisy file tree). The result: wrong-window commits, "which window was I in?" tax, and high activation energy to switch tasks cleanly.

The fix is to make the workspace **generated, not hand-edited** — rendered from a durable source of truth — and to bake ADHD-friendly scaffolding (color, naming, focus, noise-reduction) into the render. This aligns with the AGENTS.md philosophy: a mechanical CLI owns the contract, a thin skill reads the map and calls the owner, and the rendered file names its source.

## Goal

One agent-native command + thin skill (`wt`) that:

- Renders a per-repo `.code-workspace` from a branch-keyed preference registry.
- Bakes in ADHD scaffolding: per-worktree color, distinct window title, focus-folder pairs, noise excludes, WIP scratch folder.
- Delegates worktree CRUD to the existing `@side-quest/git worktree` CLI — never rebuilds it.
- Gives one front door + a one-key launcher to open the right workspace.

## Who it's for

Nathan: ADHD, visual learner, works across many repos under `~/code`, each with multiple worktrees. Needs reduced cognitive load and spatial/color scaffolding to track parallel work. Also: agents acting on his behalf, who must drive the same surface mechanically.

---

## Non-goals (v1)

- **Rebuilding worktree CRUD.** `@side-quest/git worktree` already owns create / list / delete / clean / orphans / status with JSON output (see `docs/git/worktree.md`). `wt` delegates; it does not duplicate.
- **A global mega-workspace** spanning all repos in one window. Rejected — grows unbounded, fights the focus goal. One workspace per repo.
- **Live-git dashboard (#9)** and **status-bar breadcrumb (#5)** — deferred to v2 (see below).

---

## Core decisions (locked in brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Job of the tool | One front door; CRUD **delegates** to `@side-quest/git`, `wt` **owns** the VS Code render layer | Satisfies "thin wrapper, link owner"; zero duplication; single mental model |
| Source of truth | Branch-keyed `wt.config.json` per repo | Prefs survive worktree delete/recreate; whole fleet visible in one place |
| Rendered artifact | `<repo>.code-workspace`, generated, header-stamped | "Generated output names its source; edit source not output" |
| Multi-repo | One workspace per repo; registry repo-keyed | Matches how VS Code workspaces actually work (per-project); keeps each focused |
| Drift policy | Header banner + overwrite, **warn + diff** when manual edits detected | Honest about the one place the generated-file model meets VS Code writing to the file itself |
| Contract ownership | `create-cli` owns the CLI contract path | Discovery metadata, rendered help, parser acceptance, runtime semantics must not drift |

---

## In scope (v1)

### Command surface (one front door)

Owned by `wt` (the new render layer):

- `wt sync [repo]` — (re)render `<repo>.code-workspace` from `wt.config.json` joined with the live `@side-quest/git worktree list`. Applies drift policy.
- `wt focus <branch> <subfolder>` — set the focus subfolder for a branch in the registry, then re-render.
- `wt color <branch> <color>` — set the window color for a branch, then re-render. Auto-assigned when unset.
- `wt <name>` — launcher: open the named repo's workspace; with no arg, list all known workspaces.

Delegated to `@side-quest/git worktree` (then re-render):

- `wt new <branch>` → `worktree create`
- `wt rm <branch>` → `worktree delete`
- `wt clean` → `worktree orphans --delete` (prunes the `fallow-audit-*` temp worktrees = idea #10)

### Render features (the ADHD scaffolding)

Each is emitted into the `.code-workspace` JSON by `wt sync`:

- **#1 Per-worktree color** — `workbench.colorCustomizations` tints title-bar + activity-bar per worktree. Never commit to the wrong window.
- **#2 Distinct window title** — `window.title` per worktree so `Cmd+\`` / Mission Control shows *which* worktree, not N identical tiles.
- **Focus-folder pairs** — each worktree renders as a pair: focused subfolder entry on top (e.g. `🌐 browser-use`), collapsible full-repo entry below (`📁 … repo`). Focus subfolder comes from the registry, guessed from the branch name when unset, overridable via `wt focus`.
- **#6 Scoped search** — `search.exclude` mirrors `files.exclude` (no `node_modules`/`dist` in `Cmd+Shift+F`).
- **#8 fileNesting** — tuck generated/test files (`*.test.ts`, `*.tsbuildinfo`, build output) under their source; fewer top-level rows.
- **#7 WIP scratch folder** — a pinned `📌` folder at the top of every workspace for fast capture (park-a-thought). Path configured once in registry defaults.
- **Noise excludes** — `files.exclude` for `node_modules`, `dist`, `build`, `.turbo`, `coverage`, `*.tsbuildinfo`, `.DS_Store`.

### Registry shape (illustrative, not a schema commitment)

```jsonc
// wt.config.json — source of truth, per repo
{
  "branches": {
    "codex/browser-use-refactor": { "focus": "skills/browser-use", "color": "blue" },
    "codex/harden-test-runner":   { "focus": "skills/test-runner" }   // color auto-assigned
  },
  "defaults": {
    "wip": "~/code/_wip",
    "excludes": ["node_modules", "dist", "build", ".turbo", "coverage", "*.tsbuildinfo", ".DS_Store"]
  }
}
```

Branch-keyed so prefs are tied to **intent**, not the disposable worktree path. Exact format (JSON vs YAML), field names, and color palette are `create-cli` / `ce-plan` decisions.

### Drift safety

- Rendered `.code-workspace` carries a header: `GENERATED by wt from wt.config.json — edits here are overwritten on sync`.
- `wt sync` records a content hash. On next sync, if the file changed since the last render (VS Code wrote to it, or someone hand-edited), it **shows a diff and confirms before overwriting** — so real changes can be ported back into the registry instead of silently lost.

---

## Deferred to v2 (documented, not dropped)

- **#9 WORKTREES.md dashboard** — a generated map per worktree: branch, commits-ahead, dirty/clean, last-touched. Externalizes working memory. Needs a live-git reader beyond what render requires. High value, medium cost.
- **#5 Status-bar breadcrumb** — branch + a "what am I doing here" note pinned in the status bar for fast re-entry after interruption. Cannot be done from a workspace file alone — needs a small VS Code extension or a `window.title` fold-in (which overlaps #2). Highest cost, fuzziest payoff; revisit once the spine is proven.

---

## Success criteria

- `wt sync` produces a valid `.code-workspace` Nathan would otherwise have hand-written, with colors + titles + focus pairs + excludes, from registry + live worktree state.
- Editing a pref (`wt focus`, `wt color`) and re-syncing changes the workspace; deleting and recreating a worktree preserves its prefs (branch-keyed).
- `wt clean` removes the `fallow-audit-*` temp worktrees via delegation, with no duplicated prune logic.
- A manual edit to the rendered file is detected and surfaced (diff + confirm) on next sync, never silently clobbered.
- The skill body stays thin: it reads worktree/registry state and calls `wt`; it copies no contracts, flags, or schemas (per AGENTS.md skill-authoring rules).
- One front door: Nathan and agents reach for `wt` for all worktree+workspace work; CRUD verbs visibly delegate.

---

## Dependencies / assumptions

- **`@side-quest/git worktree`** is the worktree CRUD owner and stays so. `wt` shells out to it (`bunx @side-quest/git worktree …`) and parses its JSON. If that CLI's contract shifts, `wt`'s delegating verbs must track it — a known coupling, accepted deliberately over duplication.
- VS Code reads `.code-workspace` on reload; `wt` does not need a running VS Code to render. The launcher (`wt <name>`) shells `code <workspace>`.
- Branch-name → focus-folder guessing (e.g. `harden-test-runner` → `skills/test-runner`) is a heuristic; always overridable via `wt focus`. **Unverified assumption:** the guess is right often enough to be useful; if not, it degrades to "set it once per branch," which is still cheap.
- The WIP scratch folder path (`~/code/_wip`) is a one-time setup; folder creation may need to be handled (assumption: `wt` creates it if missing, or warns).

---

## Build sequence

1. **`create-cli`** — design the `wt` command contract (discovery metadata, rendered help, parser acceptance, runtime semantics; prove they cannot drift). The front-door + delegation split is the contract's spine.
2. **`ce-plan`** — implementation plan: registry format, renderer, delegation shims, drift-hash, launcher.
3. **Build** — CLI under `skills/wt/src/` + thin `SKILL.md`; `.code-workspace` becomes generated output.

## CLI contract (locked via `create-cli`, 2026-06-14)

**Lane:** Facade-backed (`@side-quest/cli-command-facade`) — forced by three signals: it delegates to another CLI (`@side-quest/git worktree`) whose contract coupling needs drift-checking; the repo already runs this lane (`test-runner`, `browser-use`, `record-decision` carry `command-contract.ts`); it's a mixed human+agent write surface needing previewable writes + structured failures.

**Owners** (name before build):

| Owner | Path / responsibility |
|---|---|
| Contract | `skills/wt/src/command-contract.ts` — verbs, per-command flags, result literals, action ids |
| Model | registry shape, rendered-workspace shape, drift-hash record (exported types) |
| Engine | pure render: registry + worktree-list → `.code-workspace`; color auto-assign; focus guess; drift compare. No I/O. |
| Discovery | live worktree lookup (`git worktree list --json`), repo→workspace-path resolution, registry freshness |
| CLI | argv parse, render-to-disk, `code` launch, diff display, diagnostics |
| Test | Command Surface Alignment Proof + engine unit tests |

**Command surface** (verb-first, one front door):

| Command | Side-effect | Owns / Delegates |
|---|---|---|
| `wt sync [repo]` | write `.code-workspace` | Owns; drift-gated |
| `wt focus <branch> <subfolder>` | write registry → re-render | Owns |
| `wt color <branch> <color>` | write registry → re-render | Owns |
| `wt open [name]` | exec `code` / read | Owns; no arg → list workspaces |
| `wt new <branch>` | creates worktree | Delegates → `git worktree create`, re-render |
| `wt rm <branch>` | removes worktree | Delegates → `git worktree delete`, re-render |
| `wt clean` | prunes temps | Delegates → `git worktree orphans --delete`, re-render |

**Resolved open questions:**

- **Registry format + location:** JSON, `wt.config.json` at repo root, **gitignored** (per-machine pref, not shared truth; matches `.worktrees.json` neighbor).
- **Launcher:** `wt open` subcommand (one front door, drift-provable). Optional shell alias `wt`→`wt open` on top for ergonomics.
- **Color palette:** fixed named set (blue/green/amber/…), auto-assigned by stable branch-hash → palette index. Deterministic across re-render; free-form hex is a v2 escape hatch.
- **WIP folder:** `sync` creates it if missing (assumption from doc, now confirmed as default; warn-only is the fallback if creation fails).

**I/O + exit codes:** stdout = primary data (`--json` everywhere for agents); stderr = diagnostics + drift diff. `0` success, `1` runtime failure, `2` invalid usage, plus a distinct **drift-blocked** code so agents branch without scraping text. Quiet success, rich failure (five recovery answers).

**Safety:**

- `sync` drift gate — header + content hash; if file changed since last render, stop, show diff on stderr, require `--force`/interactive confirm. Non-interactive agents get the drift exit code + structured `action`, never a silent clobber.
- Delegated destructive verbs (`rm`, `clean`) inherit `@side-quest/git` confirmation; `wt` adds `--force`/`--no-input` passthrough + previews removals first.
- Facade text-safety: error hints stay prose-only with `docs_url` → `docs/git/worktree.md`; no inlined command strings (facade rejects them at envelope construction).

**Required proof:** Command Surface Alignment Proof covering the four drift surfaces — advertised flags in help / foreign flags excluded; argv accept+reject; runtime semantics via probes (drift gate blocks, delegation calls git); result literals from package-owned constants.

## Remaining open questions for `ce-plan`

- Exact color palette membership + the branch-hash → index function.
- Drift-hash storage: sidecar file vs embedded header comment in the `.code-workspace`.
- `code` binary resolution (PATH vs explicit) for the launcher.
