---
name: ce-work-inspect
description: "Inspect a CE Work parallel wave, unit status, controller-owned worktrees, verification state, or next action without changing the run."
role: tool-workflow
---

# CE Work Inspect

Inspect one CE Work controller run from the same machine and Unix user that
started it. No arguments: show the CLI help.

## Route

- Require the run ID from the active CE Work receipt or handoff. Never guess by
  listing the private run root.
- Resolve scripts/unit-workspace.py from the installed `ce-work` skill. If it
  is absent, stop with `controller_not_found`; the installed CE Work version
  does not support this inspector.
- Enter the canonical config repo: `cd "$HOME/code/claude-code-config"`.
- Run `bun --filter ce-work-inspect-scripts ce-work-inspect --help`, then use the
  documented human or JSON form.
- Treat `next_action` as a handback to the owning CE Work run. This skill never
  advances, resumes, integrates, verifies, or cleans the run.

## Safety

- The CLI calls only CE Work `status`.
- The CLI refuses missing or unsafe state before the upstream controller can
  create or repair private directories.
- Never read `manifest.json` directly or parse CE Work prose.
- Never add controller-owned worker worktrees to cmux. Keep the durable outer
  workspace as the only sidebar surface.

## Owners

- CLI contract and help: `skills/ce-work-inspect/src/command-contract.ts`.
- Status projection and read-only gate: `skills/ce-work-inspect/src/ce-work-status.ts`.
- CLI parser and rendering: `skills/ce-work-inspect/src/ce-work-inspect.ts`.
- Tests: `skills/ce-work-inspect/src/ce-work-inspect.test.ts`.

## Verification

- `bun --filter ce-work-inspect-scripts test`
- `bun --filter ce-work-inspect-scripts typecheck`

Dependency: installed `compound-engineering:ce-work` with
scripts/unit-workspace.py.

Missing state: blocked.

Next repair: update Compound Engineering, then retry with the same run ID.
