# Browser Connect Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Plan lineage:
`docs/plans/2026-07-14-001-feat-browser-connect-plan.md`.
Archive: `TASKS.archive.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` in the same pass that closes it.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

## Current Priority

U1 package scaffold is closed: the package exists at
`runtime/browser-connect`, source-linked bin `browser-connect`, workspace
deps on `@side-quest/warm-chrome` and `@side-quest/cli-command-facade`, and
it passes every workspace gate. Later units add the envelope model, command
contract, environment gateway, adapter registry, and dispatcher.

Next safe action:

```bash
bun run check:workspace-facade
```
