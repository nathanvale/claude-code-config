# Tasks

## Now

- [ ] ...

## Next

- [ ] **Add 16 headless smoke tests to multi-agent-smoke-lib.ts** — boundary, propagation, and operator skill tests run via `claude -p` and `codex exec`
  - Tests 1-10: boundary/propagation (rules Claude-only, context files Claude-only, context-index reaches both, tool map Codex-only, heal-skill Claude-only, co-author Claude-only, Memory OS shared, AGENTS.md not editable, code quality shared, newsroom Claude-only)
  - Tests 11-16: operator skills (workflow trigger, router classification, workflow rule Claude-only, contract auditor has router skill, smoke runner executes, heal-skill reachable)
- [ ] **Fix audit findings H1/H2/M1** — add missing symlinks to spec, register dark context files, add missing rules to spec
- [ ] **Reclassify prompt-system-workflow trigger as shared** — when Codex skill invocation is wired up, mirror the trigger rule from `rules/` into `prompt-fragments/shared/` or `prompt-fragments/codex/` so Codex also knows when to invoke the workflow

## Blocked

- [ ] ...

## Later

- [ ] ...

## Done

- [x] ~~**Create code-quality rule for runner plugins**~~ (2026-03-23) - `rules/code-quality.md` with alwaysApply for bun-runner, biome-runner, tsc-runner MCP tool routing
- [x] ~~**Add runner details to shared fragment for Codex**~~ (2026-03-23) - Updated `prompt-fragments/shared/tool-routing.md` with full tool table, re-rendered
- [x] ~~**Symlink settings.json to repo**~~ (2026-03-23) - Moved `~/.claude/settings.json` into repo, added to `install.sh` symlinks array alongside `hooks.json`
- [x] ~~**Consolidate hooks into settings.json**~~ (2026-03-23) - Moved datetime injector to `settings.json`, emptied `hooks.json`, archived ADHD coach to `docs/brainstorms/adhd-coach-hooks.md`, removed `hooks/adhd/`

## Notes

- Keep this file focused on active work only.
- Move stable intent into `docs/specs/` and `docs/plans/`.
- If this file stops being easy to scan, consider promoting detailed items into `todos/`.
- Clear old items from `Done` regularly instead of turning this into a long-term archive.
