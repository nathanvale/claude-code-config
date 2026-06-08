# Tasks

## Now

- None.

## Next

- None.

## Blocked

- None.

## Later

- None.

## Done

- [x] ~~**Refactor CLI command facade internals without public Interface drift**~~ (2026-06-08) - Preserved root/testing public imports, explicit root inventory, and package-boundary scans
- [x] ~~**Split command-facade.ts by Interface slice**~~ (2026-06-08) - Extracted command contract, discovery, metadata, runtime envelope, runtime text safety, CLI writer, usage, diagnostics, and baseline-exit owners
- [x] ~~**Split command facade tests by Interface slice**~~ (2026-06-08) - Split focused suites for package boundary, discovery, metadata, runtime envelope, diagnostics, writer, usage, and testing subpath
- [x] ~~**Clean stale facade context references**~~ (2026-06-08) - Replaced missing package-map and ADR links; updated source owner paths in `runtime/cli-command-facade/CONTEXT.md`
- [x] ~~**Prove facade refactor safety**~~ (2026-06-08) - Passed `bun --filter @side-quest/cli-command-facade test` and `bun --filter @side-quest/cli-command-facade typecheck`
- [x] ~~**Reclassify prompt-system-workflow trigger as shared**~~ (2026-06-08) - Added the shared prompt-system workflow route to `AGENTS.md`; focused smoke passed for `boundary`, `propagation`, and `workflow-trigger` across Claude and Codex
- [x] ~~**Fix audit findings H1/H2/M1**~~ (2026-06-08) - ADR 0011 now records delivery symlink topology, registered on-demand context owners, and registered Claude rules
- [x] ~~**Add 16 headless smoke tests to multi-agent-smoke-lib.ts**~~ (2026-06-08) - Added prompt boundary and operator skill matrix IDs; dry-run builds 48 commands across 24 smoke tests and 2 harnesses
- [x] ~~**Fix git-safety hook cross-repo cwd bug**~~ (2026-03-30) - `resolveEffectiveGitCwd()` extracts target repo from `git -C` and `cd` prefixes instead of using session cwd
- [x] ~~**Create code-quality rule for runner plugins**~~ (2026-03-23) - `rules/code-quality.md` with alwaysApply for bun-runner, biome-runner, tsc-runner MCP tool routing
- [x] ~~**Add runner details to shared fragment for Codex**~~ (2026-03-23) - Updated `prompt-fragments/shared/tool-routing.md` with full tool table, re-rendered
- [x] ~~**Symlink settings.json to repo**~~ (2026-03-23) - Moved `~/.claude/settings.json` into repo, added to `install.sh` symlinks array alongside `hooks.json`
- [x] ~~**Consolidate hooks into settings.json**~~ (2026-03-23) - Moved datetime injector to `settings.json`, emptied `hooks.json`, archived ADHD coach to `docs/brainstorms/adhd-coach-hooks.md`, removed `hooks/adhd/`

## Notes

- Keep this file focused on active work only.
- Move stable intent into `docs/specs/` and `docs/plans/`.
- If this file stops being easy to scan, consider promoting detailed items into `todos/`.
- Clear old items from `Done` regularly instead of turning this into a long-term archive.
