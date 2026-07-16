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

Slice one is complete (U1–U9): the package proves Agent Chrome via
`@side-quest/warm-chrome` in-process, injects the verified endpoint, and
execs a Browser Adapter. `check`, `connect`, bare-no-arg `dashboard`, and
`run <adapter> -- <cmd>` are implemented and proven through the 19-station
Branch Station catalog (7 real process spawns, 12 skipped-with-rationale
needing a real Agent Chrome). Closed unit detail is in `TASKS.archive.md`.

Next work is slice two — Human Chrome via the UI-consent door
(chrome-devtools-mcp `--autoConnect`, Chrome 144+ consent flow), which
freshly verifies the territory ADR 0006 recorded as a dead end. See the plan
Scope Boundaries and `docs/decisions/2026-07-14-001-browser-connect-architecture-decision-log.md`.

Closed follow-up (2026-07-16): `rules/browser-access.md` retired via the
prompt-system workflow (issue #230) — full removal; invariants are
mechanically enforced here and re-homed in `skills/browser-use/SKILL.md`. The
coexistence window is closed.

Next safe action:

```bash
bun --filter @side-quest/browser-connect typecheck
```
