---
title: "feat: Improve worktree ADHD DX with color-coded folder names and window context"
type: feat
date: 2026-06-18
depth: standard
origin: docs/brainstorms/2026-06-14-wt-worktree-workspace-renderer-requirements.md
---

# feat: Improve Worktree ADHD DX

## Summary

Improve the worktree workspace renderer to carry color and activity context
through VS Code's multi-root sidebar — where title bar colors can't
differentiate per folder — using color dot emojis in folder display names,
richer window titles, and medium editor labels. Also add a `label` branch pref
for user-chosen short names that override the branch-derived default.

---

## Problem Frame

The worktree renderer already handles focus pairs, WIP pin, noise excludes, and
per-branch color assignment. But in multi-root workspace mode (the default when
`worktree sync` renders the `.code-workspace`), VS Code applies one title bar
color to the whole window — the last worktree's color wins. In the sidebar, all
worktree folders look identical except for the branch slug after the emoji.

For ADHD workflow, the sidebar is the primary navigation surface. Worktrees
need to be visually distinguishable at a glance without reading branch names.
The color signal that works in one-window-per-worktree mode (`worktree open`)
needs to carry into the multi-root sidebar.

---

## Requirements

- R1. Folder display names carry a color dot emoji matching the branch's
  assigned palette color, visible in the VS Code sidebar.
- R2. Users can set a custom short label per branch that replaces the
  branch-derived name in folder entries.
- R3. Window title shows the active folder's branch context when switching
  between folders in a multi-root workspace.
- R4. Editor tabs show which worktree folder they belong to via medium label
  format.
- R5. Existing focus pair behavior (🌐 focused + 📁 repo) is preserved.
- R6. Color dot assignment is deterministic — same branch always gets same dot.
- R7. All changes are pure render — no new dependencies, no runtime behavior
  changes, no new CLI commands.

---

## Key Technical Decisions

- KTD1. **Color dot emoji map replaces structural emoji prefixes.** Current
  `🌐`/`📁` prefixes communicate focus vs repo but not color. Replace with a
  palette-mapped color dot (`🔵`/`🟢`/`🟠`/`🟣`/`🔴`/`🩵`/`🩷`/`⚪`) followed
  by the short name. Focus folders get an arrow suffix (` → <focus>`); repo
  folders get ` repo` suffix. This preserves the focus/repo distinction while
  adding the color signal.
- KTD2. **Add `label` to BranchPrefs.** Optional string override for the
  display name. When set, replaces the branch-derived short name in folder
  entries. Useful when branch names are opaque (`codex/wt-codex-app-projects`
  → label `create-cli`).
- KTD3. **Window title includes `${folderName}`.** Change from
  `${rootName}${separator}${activeEditorShort}` to
  `${folderName}${separator}${activeEditorShort}` so switching between folders
  in a multi-root workspace updates the window title to show the active
  worktree's name.
- KTD4. **Add `workbench.editor.labelFormat: "medium"`.** Makes editor tabs
  show the folder prefix so tabs from different worktrees are distinguishable.
- KTD5. **Keep `workbench.colorCustomizations` for `worktree open` mode.** The
  per-window color still works when opening individual worktrees. The multi-root
  workspace gets the last-wins color as before — the color dots in folder names
  carry the per-branch signal instead.

---

## Implementation Units

### U1. Add color dot emoji map and label pref to model

**Goal:** Define the color-to-emoji mapping and add `label` to `BranchPrefs`.

**Requirements:** R1, R2, R6.

**Dependencies:** None.

**Files:**
- `skills/worktree/src/model.ts` (modify)
- `skills/worktree/src/worktree-engine.ts` (modify)
- `skills/worktree/src/worktree-engine.test.ts` (modify)

**Approach:** Add `COLOR_DOT_EMOJI: Record<WorkTreeColor, string>` mapping each
palette color to a circle emoji. Add optional `label?: string` to
`BranchPrefs`. Export `colorDot(color: WorkTreeColor): string` from the engine.

**Patterns to follow:** `PALETTE_COLORS` map in `worktree-engine.ts` —
same shape, different payload. `assignColor()` for the resolution pattern.

**Test scenarios:**
- Each palette color maps to a distinct emoji.
- `colorDot("blue")` returns `"🔵"`.
- `colorDot("amber")` returns `"🟠"`.
- Label pref is optional in `BranchPrefs` — omission is valid.

**Verification:** Types compile, emoji map covers all 8 palette colors.

### U2. Render color-coded folder names with optional labels

**Goal:** Update `buildFolders()` to use color dots and labels in display names.

**Requirements:** R1, R2, R5.

**Dependencies:** U1.

**Files:**
- `skills/worktree/src/worktree-engine.ts` (modify)
- `skills/worktree/src/worktree-engine.test.ts` (modify)

**Approach:** In `buildFolders()`, resolve the color dot from `assignColor()`
+ `colorDot()`. Resolve display name from `prefs.label ?? shortName`. Render
focused folders as `{dot} {name} → {focus}` and repo folders as
`{dot} {name} repo`. Main worktree renders as `{dot} main`.

Current: `🌐 browser-use-refactor` / `📁 browser-use-refactor repo`
After: `🟣 browser-use → skills/browser-use` / `🟣 browser-use repo`

With label: `🔵 agent-skills → runtime/agent-skills` (label overrides slug).

**Patterns to follow:** Current `buildFolders()` focus pair logic at lines
146-158 of `worktree-engine.ts`.

**Test scenarios:**
- Focused worktree renders two entries: `{dot} {name} → {focus}` and `{dot} {name} repo`.
- Unfocused worktree renders one entry: `{dot} {name}`.
- Main worktree renders as `{dot} main`.
- WIP folder renders unchanged as `📌 WIP`.
- Label pref overrides branch-derived short name.
- Color dot matches the branch's assigned color.
- Deterministic: same inputs produce same folder names across re-renders.

**Verification:** `renderWorkspace` output matches expected folder names with
dots and labels.

### U3. Update workspace settings for window title and editor labels

**Goal:** Change `window.title` and add `editor.labelFormat` to workspace
settings.

**Requirements:** R3, R4.

**Dependencies:** None (independent of U1/U2).

**Files:**
- `skills/worktree/src/worktree-engine.ts` (modify)
- `skills/worktree/src/worktree-engine.test.ts` (modify)

**Approach:** In `buildSettings()`, change `window.title` from
`"${rootName}${separator}${activeEditorShort}"` to
`"${folderName}${separator}${activeEditorShort}"`. Add
`"workbench.editor.labelFormat": "medium"`.

**Patterns to follow:** Existing settings block in `buildSettings()` at lines
186-198 of `worktree-engine.ts`.

**Test scenarios:**
- `window.title` contains `${folderName}` instead of `${rootName}`.
- `workbench.editor.labelFormat` is `"medium"`.
- Existing settings (excludes, nesting, sort, color) are preserved.

**Verification:** `buildSettings()` output includes both new settings alongside
existing ones.

### U4. Add `worktree label` CLI command

**Goal:** Let users set a custom label for a branch via the CLI.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**
- `skills/worktree/src/worktree.ts` (modify)
- `skills/worktree/src/command-contract.ts` (modify — if facade-backed)
- `skills/worktree/src/worktree.test.ts` (modify)

**Approach:** Add `label` as a pref verb alongside `focus` and `color`. Same
pattern: `worktree label <branch> <name>` stores `label` in
`worktree.config.json` under `branches[branch].label`, then re-renders.

**Patterns to follow:** `focus` and `color` command handlers in `worktree.ts`.
`setPrefAndSync()` pattern.

**Test scenarios:**
- `worktree label codex/browser-use-refactor browser-use` stores the label.
- Re-render after label set uses the label in folder names.
- Label with spaces is accepted and stored.
- Missing branch argument returns usage error.

**Verification:** Label roundtrips through config → render → folder name.

---

## Scope Boundaries

- Changes are render-only — no new worktree lifecycle behavior.
- No new dependencies.
- No Peacock extension dependency — color dots work without any extension.
- The `worktree open` per-window color path is unchanged.

### Deferred to Follow-Up Work

- VS Code profiles per worktree type (active dev, docs, browser) — needs
  `worktree open --profile` integration with VS Code's profile CLI.
- Per-folder `.vscode/settings.json` generation — the worktree renderer
  currently doesn't write into worktrees; adding that is a larger scope change.
- Color palette expansion beyond 8 colors.

---

## Sources & Research

- `skills/worktree/src/worktree-engine.ts` — pure render engine (buildFolders,
  buildSettings, assignColor, guessFocus).
- `skills/worktree/src/model.ts` — BranchPrefs, WorkTreeColor, Registry types.
- `docs/brainstorms/2026-06-14-wt-worktree-workspace-renderer-requirements.md`
  — original ADHD-motivated requirements.
- VS Code docs: multi-root workspace `name` field, `window.title` variables
  (`${folderName}`, `${rootName}`), `workbench.editor.labelFormat`.
