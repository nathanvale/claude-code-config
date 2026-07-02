---
name: pr-review-loop
description: "Launch a multi-lens PR review workflow for blocking issues."
---

# PR Review Loop

Generate a workflow script that runs N review lenses concurrently over a package diff,
adversarially verifies every finding, and loops until dry — then launches it.

## Intent Classification

Classify from args and **stop at the first matching row**. Do NOT launch a workflow before the user confirms.

| Signal | Route |
|--------|-------|
| No args, empty args, or unrecognized args | **STOP — show pre-launch DX menu** (see below); do not launch |
| Lens names or lens customisation request (e.g. "new reviewers", "use X instead of Y") | **STOP — show pre-launch DX menu** with proposed lenses listed; wait for user confirmation before launching |
| `mode: fast` or "fast" in args | Skip menu — launch with defaults immediately |
| Package name or path supplied | Launch with `pkg` override |
| `baseRef` / branch name supplied | Launch with `baseRef` override |
| `resume` / run ID supplied | Resume paused run via `resumeFromRunId` |
| Findings at `0 blocking, 0 major` | Hand off to `/bb-pr` |

### Pre-launch DX menu

**REQUIRED when no args are supplied.** Show this block verbatim — state defaults, then present numbered choices and wait for user input. Do not proceed until the user replies.

> **Ready to launch PR review.**
>
> Defaults:
> - Package: `packages/portal-ui`
> - Diff base: `origin/develop`
> - Lenses: correctness · design-system · pr-readiness · storybook
> - Max rounds: 3 · Max findings/lens: 3

1. **Launch with these defaults** — reply `1` to start now.
2. Change package — reply with path (e.g. `packages/my-pkg`).
3. Change base ref — reply with branch or ref (e.g. `origin/main`).
4. Resume a paused run — reply with the run ID.

> Wait for the user to reply before taking any action.

## Owner Paths

- Workflow template: `references/workflow-template.js`
- Pattern: `skills/skill-author/references/skill-io-shape-examples.md#skill-io-example`
- Findings artifact: `/tmp/pr-review-loop/<runId>/findings.json` (written by the generated workflow)

## Parameters

All have defaults — pass only what you want to override.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `repo` | current working dir | Absolute repo root |
| `pkg` | `packages/portal-ui` | Package path relative to repo root |
| `baseRef` | `origin/develop` | Git ref to diff against |
| `lenses` | 4 built-in (storybook, correctness, design-system, pr-readiness) | Array of lens configs (see below) |
| `maxRounds` | `3` | Max review rounds before stopping |
| `maxFindingsPerLens` | `3` | Cap per lens per round |
| `runId` | caller must supply | Timestamp string e.g. `"2026-06-18T2010"` — `Date.now()` is banned in workflow scripts |

### Lens config shape (illustrative)

```js
{
  key: "correctness",          // id prefix e.g. COR
  label: "Correctness",
  prompt: "You are a Correctness reviewer..."  // full reviewer prompt
}
```

Pass `lenses: null` to use the 4 built-in lenses from the template unchanged.

## Workflow

1. **Read** `references/workflow-template.js` — the canonical script source.
2. **Substitute** repo, pkg, baseRef, maxRounds, maxFindingsPerLens, runId into the template constants.
3. **If custom lenses supplied** — replace the built-in lens block with the caller's lens array.
4. **Write** the generated script to a temp path (e.g. `/tmp/pr-review-loop-<runId>.js`).
5. **Launch** via `Workflow({ script: <generated>, args: { runId } })`.
6. **Report** run ID, artifact dir, and watch instruction (`/workflows`).

## Model Tiers

The template assigns models by phase to match agent capability to task difficulty:

| Phase | Model | Why |
|-------|-------|-----|
| Scout (diff, exports, changed-files) | `haiku` | Shell commands + paste output |
| Review (lens prompts) | `sonnet` | Structured code review with judgement |
| Verify/refute | inherited (Opus) | Hardest — must read code and reason about false positives |
| Snapshot writers | `haiku` | `mkdir -p && cat >` |
| Synthesize | `sonnet` | Counting + narrative |
| Write-final | `haiku` | `mkdir -p && cat >` |

When generating scripts, preserve these tiers from the template. Custom lenses inherit `model: "sonnet"` from the review loop unless explicitly overridden.

## Constraints (enforce in generated script)

- `export const meta` must be a pure literal — no variables, spreads, or calls.
- No `Date.now()`, `Math.random()`, or argless `new Date()` — caller passes `runId`.
- `import` must not precede `export const meta`.
- Findings written to `/tmp/pr-review-loop/<runId>/findings.json` via a low-effort agent shell call.
- Resume works via `Workflow({ scriptPath, resumeFromRunId })` — cached agents replay instantly.

## Gotchas

- **`process` global unavailable** in workflow scripts — use `args` instead.
- **`import` banned at top level** — all imports are dynamic inside agent prompts or unavailable; the template uses no ES imports.
- **Write tool needs permission** — the final findings write step can pause for approval; resume with `Workflow({ scriptPath, resumeFromRunId })`.
- **Duplicate runs** — if a run is already active, stop it with `TaskStop` before resuming or relaunching.

## Next Safe Action

- Missing `runId`? Stamp the current time manually (e.g. `"2026-06-18T2100"`) — do not use `Date.now()`.
- Custom lenses? Supply as a JS array of `{ key, label, prompt }` objects.
- Run paused? Use `resumeFromRunId` — completed agents return cached results instantly.
- Findings at `0 blocking, 0 major`? Hand off to `/bb-pr` to create the PR.
