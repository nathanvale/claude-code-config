---
title: "Prompt System"
type: spec
status: active
updated: 2026-03-23
summary: "How user-scope agent instructions are managed, rendered, and delivered to Claude Code and Codex."
---

# Prompt System

## How It Works

1. You write instructions in `prompt-fragments/` (shared, claude-only, or codex-only)
2. `scripts/render-user-prompts.sh --write` glues them into output files
3. `rules/` are bonus behavioral instructions only Claude gets (auto-applied every session)
4. Codex also has separate runtime surfaces for execution policy and configuration (`~/.codex/rules/` and `.codex/config.toml` / `~/.codex/config.toml`) that are not rendered from prompt fragments
5. `context/` files are on-demand reference material (not auto-loaded)

## Where To Put Things

| You want... | Put it in... |
|-------------|--------------|
| Both harnesses know it at startup | `prompt-fragments/shared/` |
| Only Claude knows it | `prompt-fragments/claude/` or `rules/` |
| Only Codex knows it | `prompt-fragments/codex/` |
| On-demand reference material | `context/` |

**The one rule that matters:** `rules/` is invisible to Codex. If a rule contains behavior Codex also needs, mirror it into `prompt-fragments/shared/` or `prompt-fragments/codex/`.

Related but separate Codex runtime surfaces also exist:

- `~/.codex/rules/*.rules` for execution policy
- project `.codex/config.toml` and user `~/.codex/config.toml` for runtime config
- repo `.agents/skills/` and user `$HOME/.agents/skills/` for skills
- repo `.codex/agents/` and user `~/.codex/agents/` for custom Codex agents

Shared fragments should describe behavior and policy, not harness-specific invocation syntax.
Harness-specific fragments should describe how a particular runtime performs that behavior.

The shared root should stay compact and checklist-oriented. Prefer a small structure such as:

1. intro and preferences
2. boundaries
3. workflow
4. governance

## Contract Invariants

These rules define the prompt-system contract:

1. Shared fragments describe behavior, policy, and cross-harness governance.
2. Shared fragments must not contain harness-branded invocation syntax or harness-specific path conventions.
3. Harness-specific fragments describe how a particular runtime performs a shared behavior.
4. Claude `rules/` are invisible to Codex.
5. If Claude-only rules contain behavior Codex also needs, mirror the behavioral intent into `shared/` or `codex/` rather than copying runtime-specific wording.
6. `context/` files are on-demand reference material, not startup prompt content.
7. Rendered outputs are generated artifacts; fragments are the source of truth.

## Routing Guide

Use this routing logic when adding or moving prompt content:

| If the content is... | Put it in... |
|----------------------|--------------|
| A personal preference or cross-harness safety rail | `prompt-fragments/shared/` |
| A shared workflow or governance rule | `prompt-fragments/shared/` |
| Claude-only invocation syntax, slash-command behavior, or rule interplay | `prompt-fragments/claude/` or `rules/` |
| Codex-only runtime mechanics | `prompt-fragments/codex/` |
| Detailed reference material that should only load when needed | `context/` |

When deciding between shared and harness-specific placement, use this test:

- If the instruction says what both harnesses should do, it belongs in `shared/`.
- If the instruction says how one harness does it, it belongs in a harness-specific surface.

## Rendering

```bash
./scripts/render-user-prompts.sh --write   # Rebuild output files
./scripts/render-user-prompts.sh --check   # Verify no drift
./scripts/render-user-prompts.sh --diff    # Show differences
```

| Output | Built from | Consumer |
|--------|-----------|----------|
| `AGENTS.md` | `shared/*` | Imported by Claude via `@AGENTS.md` |
| `CLAUDE.md` | `@AGENTS.md` + `claude/*` | Claude startup file |
| `generated/codex-user-agents.md` | `shared/*` + `codex/*` | Copied to `~/.codex/AGENTS.md` as the global Codex layer |

Claude gets changes immediately (symlinks). Codex needs a re-render for the generated global layer.

## Delivery

| Harness | Reads from | Method |
|---------|-----------|--------|
| Claude | `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md` | Symlinked by `install.sh` |
| Codex | `~/.codex/AGENTS.md` + repo `AGENTS.md` + nested `AGENTS.md` / `AGENTS.override.md` | Global layer copied by render script; project and nested layers are discovered by Codex |

## Rules

| Rule | Purpose |
|------|---------|
| `code-quality.md` | Use runner MCP tools for tests/lint/types, never Bash |
| `context7.md` | Use Context7 MCP for library docs |
| `debugging-workflow.md` | Read errors, trace root cause, don't retry blindly |
| `dependency-and-file-hygiene.md` | Ask before new deps, prefer editing over creating files |
| `git-workflow.md` | Commit workflow reinforcement and attribution |
| `memory-os.md` | Memory OS governance — what goes where |
| `newsroom-trigger.md` | Auto-invoke `/newsroom:investigate` for community research |
| `prompt-system-workflow.md` | Auto-invoke `/prompt-system-workflow` for prompt changes |
| `scope-discipline.md` | Only change what was requested, no drive-by cleanups |
| `security-boundaries.md` | Never read/write credentials, secrets, or wallet data |
| `self-check.md` | Re-read diff and run checks before presenting work as done |
| `testing-policy.md` | Always run tests, reproduce bugs with failing tests first |
| `tool-routing.md` | Use `response_format: "json"` for MCP tools |

## Context Files

On-demand only. The docs live in `context/`, but each harness may load them differently.

| File | Content |
|------|---------|
| `code-style.md` | TypeScript, testing, JSDoc |
| `search-tools.md` | Kit plugin tool selection |
| `bun-runner.md` | Test/lint MCP tools |
| `atuin.md` | Shell history search |
| `personal.md` | Birthdays, hobbies, details |
| `personal-projects.md` | Side projects and active builds |
| `learning-goals.md` | Currently learning, study goals |
| `obsidian-setup.md` | PARA method, vault commands |
| `hardware.md` | Monitor, Mac specs, SSH details |
| `known-issues.md` | Bunx cache, git-safety hook, VS Code |
| `git-workflow.md` | Git safety, conventional commits |

## Adjacent Runtime Surfaces

These are not part of the prompt render pipeline, but they affect Codex behavior and should be documented alongside it:

| Surface | Purpose |
|---------|---------|
| `.codex/config.toml` / `~/.codex/config.toml` | Runtime config: model, sandbox, approval, MCP, filesystem, network, and project-doc settings |
| `~/.codex/rules/*.rules` | Starlark execution-policy rules |
| `.agents/skills/` / `$HOME/.agents/skills/` | Codex skill discovery surfaces |
| `.codex/agents/` / `~/.codex/agents/` | Custom Codex agents |

## Shared Root Structure

The shared startup surface currently uses this shape:

- `intro.md` — personal preferences and collaboration cues
- `boundaries.md` — always do / ask first / never do
- `workflow.md` — execution workflow and general tool preferences
- `governance.md` — memory ownership and git safety
- `communication-style.md`
- `key-people.md`
- `context-index.md`

## Safety Checks

`--check` validates: fragment drift, wrapper drift, codex artifact drift, @AGENTS.md import resolution, codex parity, shared context doc existence, orphan fragments, and shared-fragment hygiene.

### Shared-Fragment Hygiene

Shared-fragment hygiene exists to prevent harness-specific leakage and stale runtime abstractions from creeping into the shared startup surface.

The check should fail if `prompt-fragments/shared/` contains patterns such as:

- harness-branded paths like `~/.claude/` or `~/.codex/`
- Claude-only import syntax like `@~/.claude/...`
- stale runtime nouns that should not appear in shared policy text

The check may also warn when the rendered shared startup surface grows beyond the target line budget.

## Smoke Tests

Headless tests that verify behavioral contracts propagate correctly.

```bash
bun scripts/multi-agent-smoke.ts              # Run all
bun scripts/multi-agent-smoke.ts --list       # See available tests
bun scripts/multi-agent-smoke.ts --dry-run    # Preview commands without executing
bun scripts/multi-agent-smoke.ts --warn-after-ms 30000
bun scripts/multi-agent-smoke.ts --timeout-ms 45000
bun scripts/multi-agent-smoke.ts --tests boundary,propagation --harnesses claude
```

Safety: Claude runs with `--tools ""`, Codex with `--sandbox read-only` and MCP server startup disabled for lean instruction-only probes. No code changes.
The smoke runner uses bounded, harness-aware defaults so slow runs surface as warnings and wedged runs degrade to `timeout` instead of hanging indefinitely. Use `--warn-after-ms` or `--timeout-ms` to override those defaults for one run.

## Editing Workflow

1. Edit files in `prompt-fragments/`, `rules/`, or `context/`
2. Run `--write` then `--check` for fragment changes
3. Run smoke tests when you change shared behavior or propagation logic
4. Rules-only changes need no render (symlinked)
5. If you changed routing, composition, or contract semantics, update this spec in the same change

## Adding a Context File

1. Create the file in `context/`
2. Add it to `prompt-fragments/shared/context-index.md`
3. Re-render (`--write` then `--check`)

## Adding a Rule

1. Create file in `rules/` with `alwaysApply: true` frontmatter
2. If Codex also needs this behavior, mirror into `prompt-fragments/shared/` or `prompt-fragments/codex/`
3. Re-render if you added fragments

## Reviews

Prompt-system audits and evaluative documents should use the review-note contract in [review-note-contract.md](/Users/nathanvale/code/claude-code-config/memory/docs/review-note-contract.md).

The current canonical example is [2026-03-23-prompt-system-review.md](/Users/nathanvale/code/claude-code-config/docs/reviews/2026-03-23-prompt-system-review.md).

### Review Cadence

Review the prompt system quarterly (March, June, September, December):

1. Run `./scripts/render-user-prompts.sh --check` to verify no drift
2. Read each rule — delete any that are stale or now covered by Claude's built-in behavior
3. Check rendered line counts against the 300-line target for AGENTS.md and keep Codex-facing output within the configured byte budget
4. Look for rules that are routinely ignored (sign of a bloated or vague instruction)
5. Record findings in `docs/reviews/` using the review-note contract

## Adding a New Harness

1. Create `prompt-fragments/<harness-name>/`
2. Add harness-specific fragments
3. Wire into `render-user-prompts.sh` (fragment array, render function, write/check steps)
4. Add to `install.sh` if it reads from a known config path
5. Render, verify, and extend smoke tests

## Reference Implementations

- **Trail of Bits** — `github.com/trailofbits/claude-code-config` — enterprise-grade CLAUDE.md with hooks-as-guardrails, credential deny rules, custom statusline (token/cost/cache metrics), and language-specific toolchains. The closest public peer to our setup.
- **lifedever/claude-rules** — composable three-tier rules (base → language → framework) with quantified metrics and Bad/Good code comparisons.

## Design Rationale

See `docs/decisions/2026-03-22-fragment-rendering-over-manual-sync.md`.
