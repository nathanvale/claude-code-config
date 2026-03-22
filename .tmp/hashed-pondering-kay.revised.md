# Plan: Align User-Scope Claude/Codex Instructions with Memory OS Contract

## Context

This repo is a project-scoped config repo, but it is the canonical source for user-scoped instruction files consumed across all projects. Nathan's user-scope `~/.claude/CLAUDE.md` (currently 167 lines, symlinked from `~/code/claude-code-config/CLAUDE.md`) has drifted from the Memory OS contract. The contract says user-scope startup instructions should be a lean launch pad with only hot, session-start context.

At the same time, `~/.codex/AGENTS.md` is a manually maintained sibling that drifts from Claude's instructions. The current draft plan fixes that drift by deriving Codex from `CLAUDE.md`, but that approach is structurally brittle.

## Reference Pattern

Two local project-scoped repos show the right coexistence shape:

- `~/.claude/plugins/marketplaces/every-marketplace`
  - Uses `AGENTS.md` as the canonical instruction file
  - Uses `CLAUDE.md` as a compatibility shim pointing at `@AGENTS.md`
  - Treats the repo as the source, while target platforms consume installed user-scope outputs
- `~/code/everything-claude-code`
  - Uses a universal root `AGENTS.md`
  - Adds Codex-specific guidance in `.codex/AGENTS.md`
  - Keeps Claude-specific guidance in `CLAUDE.md`
  - Treats cross-harness parity as an explicit design goal, not an afterthought
- `~/code/side-quest-marketplace`
  - Keeps universal tool-routing guidance in root `AGENTS.md`
  - Keeps Claude-specific project guidance in `.claude/CLAUDE.md`
- `~/code/monash-smst` and `~/code/my-second-brain`
  - Both explicitly treat `~/.config/memory/AGENTS.md` as the shared user-scope contract
  - Both keep repo-local `AGENTS.md` for durable repo governance
  - Both keep repo-local `CLAUDE.md` lean as hot memory / launch-pad context
  - Both rely on user scope for non-domain governance and repo scope for domain truth

The shared lesson still applies at user scope: do not compile one runtime's prompt from another with string stripping. Model the system as shared instructions plus runtime-specific deltas, then render those into the actual user-scope files agents consume everywhere.

## Goal

1. Shrink `CLAUDE.md` to a lean Claude launch pad
2. Make `AGENTS.md` the canonical shared instruction layer for both Claude and Codex
3. Generate Codex output from canonical `AGENTS.md` plus Codex-only fragments, not by stripping Claude content
4. Move stable details into context and rule files without losing Codex parity
5. Add deterministic render and parity checks so drift becomes hard to introduce
6. Preserve the Memory OS layering model used by downstream repos: user scope governs non-domain concerns, repos govern domain concerns

Target:

- `AGENTS.md`: canonical shared user instruction source in the repo
- `CLAUDE.md`: a thin Claude-facing wrapper that imports `AGENTS.md` and adds Claude-only runtime notes
- `~/.codex/AGENTS.md`: generated from shared contract plus Codex supplement

---

## Design Principles

### 1. Shared instructions live in one place

Anything both Claude and Codex should know must live in canonical `AGENTS.md`, not in Claude-only rules.

Examples:

- Tool-routing preferences
- JSON response-format preference
- Personal working style
- Safety rails that apply across harnesses
- Memory OS guidance

### 2. Runtime-specific instructions stay runtime-specific

Keep harness-specific behavior in dedicated layers:

- Claude-only:
  - Slash-command conventions
  - `rules/` auto-apply references
  - Obsidian `/para-brain:*` routing
- Codex-only:
  - Compound tool map
  - Codex-specific compatibility notes
  - Any Codex-only skill loading or config caveats

### 3. Render outputs from fragments, never by stripping prose

Do not:

- parse headings out of `CLAUDE.md`
- regex-remove sections to form Codex output
- rely on section titles staying unchanged

Do:

- keep small source fragments under version control
- compose final outputs deterministically
- add a `--check` mode to catch drift in CI or local validation

### 4. Safe migration over destructive cleanup

Never require `rm -rf ~/.claude/rules/` in the happy path. If a real directory blocks a symlink, stop with a clear migration message and require a manual backup/rename step.

### 5. Verify shim semantics before depending on them

`every-marketplace` uses `CLAUDE.md` as a compatibility shim pointing at `@AGENTS.md`. Before making that the permanent user-scope pattern here, verify that Claude user-scope loading honors the same import behavior.

Fallback if the shim does not work reliably at user scope:

- keep `AGENTS.md` canonical in the repo
- render full `CLAUDE.md` from shared fragments plus Claude-only fragments
- keep `~/.codex/AGENTS.md` generated from canonical `AGENTS.md` plus Codex supplement

### 6. User scope is governance, not domain memory

The user-scope contract should govern cross-project, non-domain concerns such as:

- personal working style
- tool-routing preferences
- safety rails
- Memory OS ownership model
- shared capture and recall rules

It should not absorb repo-domain detail that belongs locally.

Examples that stay repo-local:

- Monash operational context in `monash-smst`
- life-hub durable knowledge in `my-second-brain`
- project-specific architecture, paths, and workflows in each repo's own `AGENTS.md` and `CLAUDE.md`

---

## Proposed Source Model

### Shared Sources

Create a small source tree for instructions shared across harnesses:

```text
prompt-fragments/
  shared/
    intro.md
    critical-rules.md
    communication-style.md
    key-people.md
    tool-routing.md
    memory-os.md
  claude/
    claude-launchpad.md
    claude-runtime-notes.md
  codex/
    codex-runtime-notes.md
    tool-map.md
```

The fragments render canonical `AGENTS.md` plus runtime-specific wrappers. The actual runtime targets remain user-scope files under `~/.claude/` and `~/.codex/`.

### Runtime Outputs

Render the following concrete files:

```text
AGENTS.md                       # Canonical shared instructions
CLAUDE.md                       # Thin wrapper for Claude, symlinked to ~/.claude/CLAUDE.md
generated/codex-user-agents.md  # Rendered Codex user-scope file for inspection
```

Then sync:

- `AGENTS.md` to `~/.claude/AGENTS.md` via symlink
- `CLAUDE.md` to `~/.claude/CLAUDE.md` via symlink
- `rules/` to `~/.claude/rules/` via symlink
- rendered Codex output to `~/.codex/AGENTS.md`

We are borrowing the separation pattern from `every-marketplace`, `everything-claude-code`, and `side-quest-marketplace`, not copying their exact file locations blindly. In this repo, the important part is canonical repo-managed sources that render or sync to user-scope destinations.

If `@AGENTS.md` is not reliable in user scope, `CLAUDE.md` remains a generated thin file rather than a literal shim.

This keeps the Memory OS contract usable as a governance base layer for all projects without swallowing repo-specific truth.

---

## Content Distribution

### Keep in `CLAUDE.md`

Keep only Claude-facing wrapper material:

- `@AGENTS.md` compatibility import
- Claude-only runtime notes
- Short index of auto-applied rules
- Claude-only slash-command and Obsidian notes if they should not live in `AGENTS.md`

### Keep in Canonical `AGENTS.md`

These should be read by both Claude and Codex:

- Personal context: location, ADHD, visual learner, exploratory style
- Plan -> Confirm -> Execute -> Test workflow
- Safety rails
- Communication style
- Key people
- Short index of context files
- Tool-routing preferences
- `response_format: "json"` preference
- Memory OS operating model

### Move to Claude `rules/`

These are Claude runtime optimizations, not the source of truth:

- `rules/tool-routing.md`
- `rules/newsroom-trigger.md`
- `rules/context7.md`

Important: if a rule matters to Codex too, it must also exist in canonical `AGENTS.md`.

### Move to `context/`

Stable, low-frequency context:

- `context/hardware.md`
- `context/known-issues.md`

---

## Files to Create

1. `AGENTS.md`
   - Canonical shared user instruction file rendered from shared fragments
2. `prompt-fragments/shared/*.md`
   - Shared instruction source files
3. `prompt-fragments/claude/*.md`
   - Claude-only launchpad fragments
4. `prompt-fragments/codex/*.md`
   - Codex-only supplement fragments
5. `rules/tool-routing.md`
   - Claude auto-apply copy of shared tool-routing guidance
6. `rules/newsroom-trigger.md`
   - Claude-only proactive research trigger guidance
7. `rules/context7.md`
   - Repo-managed copy of existing `~/.claude/rules/context7.md`
8. `context/hardware.md`
9. `context/known-issues.md`
10. `scripts/render-user-prompts.sh`
   - Deterministically renders `AGENTS.md`, `CLAUDE.md`, and Codex output
   - Supports `--write` and `--check`
11. `generated/.gitkeep`
   - Optional placeholder if rendered intermediates are kept on disk

## Files to Modify

1. `CLAUDE.md`
   - Rewrite as a thin Claude wrapper around canonical `AGENTS.md`
2. `install.sh`
   - Add `rules/` symlink support
   - Add `AGENTS.md` symlink support for Claude compatibility shim
   - Run render script in write mode
   - Refuse destructive migration of blocking real directories

---

## Render Pipeline

```text
prompt-fragments/shared/*       ─┐
                                 ├──> AGENTS.md
prompt-fragments/claude/*       ─┘
                                       └──> CLAUDE.md

prompt-fragments/shared/*       ─┐
prompt-fragments/codex/*        ─┴──> generated/codex-user-agents.md
                                       └──> ~/.codex/AGENTS.md

AGENTS.md --------------------------> ~/.claude/AGENTS.md (symlinked file)
CLAUDE.md --------------------------> ~/.claude/CLAUDE.md (symlinked file)
rules/*.md -------------------------> ~/.claude/rules/ (symlinked directory)
context/* --------------------------> ~/.claude/context/ (symlinked directory)
```

Key point:

- Claude and Codex share the same core fragments
- Claude consumes canonical `AGENTS.md` through a thin `CLAUDE.md` wrapper plus `rules/`
- Codex gets extra runtime help via Codex-only fragments
- no output is generated by stripping another output

---

## `install.sh` Changes

Add to symlinks array:

```bash
"${CLAUDE_HOME}/AGENTS.md|${SCRIPT_DIR}/AGENTS.md"
"${CLAUDE_HOME}/rules|${SCRIPT_DIR}/rules"
```

After link creation, run:

```bash
echo "Rendering user prompt files..."
"${SCRIPT_DIR}/scripts/render-user-prompts.sh" --write
```

### Safe Migration Behavior

If `~/.claude/rules/` exists and is not a symlink:

1. Print a blocking warning
2. Tell Nathan to back it up or rename it manually
3. Exit without modifying the directory

Recommended manual migration:

1. Copy `~/.claude/rules/context7.md` into repo `rules/context7.md`
2. Rename existing directory to `~/.claude/rules.bak-YYYYMMDD`
3. Run `./install.sh`
4. Diff old vs new if needed, then delete the backup later

No destructive deletion in the scripted flow.

---

## Execution Order

1. Create `prompt-fragments/shared/`, `prompt-fragments/claude/`, and `prompt-fragments/codex/`
2. Move shared instruction text into fragments
3. Render canonical `AGENTS.md`
4. Create `rules/tool-routing.md`, `rules/newsroom-trigger.md`, and repo-managed `rules/context7.md`
5. Create `context/hardware.md` and `context/known-issues.md`
6. Verify whether user-scope `CLAUDE.md` reliably supports `@AGENTS.md`
7. Rewrite `CLAUDE.md` as a thin wrapper around `@AGENTS.md`, or as a rendered thin file if shim behavior is not reliable
8. Create `scripts/render-user-prompts.sh`
9. Update `install.sh` for `AGENTS.md` and `rules/` symlinks plus render step
10. Manually migrate any blocking real `~/.claude/rules/` directory using backup/rename
11. Run `./install.sh`
12. Run render check and parity check
13. Manually spot-check both Claude and Codex startup files

---

## Verification

### File and Size Checks

- `AGENTS.md` exists and contains shared cross-harness guidance
- `CLAUDE.md` is thin and either delegates to `@AGENTS.md` or is rendered from the same shared source
- `~/.codex/AGENTS.md` is rendered, not hand-edited

### Drift Checks

- `scripts/render-user-prompts.sh --check` passes
- Shared sections in `AGENTS.md` and `~/.codex/AGENTS.md` come from the same fragments

### Behavior Checks

- `./install.sh --status` shows `rules/`, `context/`, and `CLAUDE.md` linked correctly
- `./install.sh --status` shows `AGENTS.md` linked into `~/.claude/`
- Claude still auto-loads `rules/tool-routing.md`, `rules/newsroom-trigger.md`, and `rules/context7.md`
- Codex still receives tool-routing and Memory OS guidance even though it does not consume Claude `rules/`

### Manual Spot Checks

Start a fresh Claude Code session and confirm:

- `CLAUDE.md` successfully pulls in `AGENTS.md`, or the rendered fallback produces equivalent behavior
- Claude-specific rules still apply automatically

Open Codex and confirm:

- `~/.codex/AGENTS.md` contains shared guidance plus Codex-only supplement
- no Claude-only slash-command assumptions leaked into Codex output

Open `monash-smst` and `my-second-brain` and confirm:

- repo-local `AGENTS.md` and `CLAUDE.md` still make sense as domain overlays
- the shared user-scope contract remains the base governance layer for non-domain concerns
- no domain-specific repo detail has been accidentally promoted into user scope

---

## Non-Goals

- Do not build a fully generalized prompt templating framework
- Do not move every preference into fragments on day one
- Do not introduce CI unless local `--check` proves useful first
- Do not chase an arbitrary 90-line target if it harms clarity

## Success Criteria

This plan is successful if:

1. Claude and Codex share one maintained core contract
2. Claude-specific and Codex-specific behavior are layered cleanly
3. No destructive migration steps are required
4. Drift is caught by render/parity checks instead of memory
5. `CLAUDE.md` remains a lightweight compatibility layer without making Codex blind to important guidance
6. Downstream repos can continue using the shared user-scope Memory OS contract for non-domain governance while keeping domain truth local
