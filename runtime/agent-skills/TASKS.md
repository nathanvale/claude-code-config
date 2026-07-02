# Agent Skills Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Decision lineage:
`docs/decisions/2026-07-02-npx-skills-division-of-labor.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` once it exists.
- Add at most 10 open tasks per priority group.
- Keep at most 5 Latest Signals; archive or drop older ones.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: External Lock. Done when: observable command,
      test, or doc result. Next: `command`.
```

Lanes: CLI Contract, Catalog, Projection, External Lock, Config,
Docs Language, Verification.

## Current Priority

The npx-skills division-of-labor plan (PR #221), the package docs split, and
docs de-drift all closed on 2026-07-03. No open P0/P1 work; next items are P2
publish readiness and external hash drift detection.

Next safe action:

```bash
agent-skills status --json
```

## Now

- (empty)

## Next

- [ ] P2 Publish readiness Lane: CLI Contract. Done when: the package
      publishes or the source-linked bin contract is re-accepted as durable;
      README stops calling `npm link` temporary. Next: decide publish target
      and registry.
- [ ] P2 External hash drift detection Lane: External Lock. Done when: a
      decision records whether agent-skills verifies `computedHash` against
      disk for externals, or names the provider surface that does. Next:
      check whether `skills update` verifies hashes; record in the
      division-of-labor decision log.

## Later

- [ ] P3 Upstream --link feature request Lane: External Lock. Done when: an
      issue on `vercel-labs/skills` requests a live-symlink mode for local
      sources, or a decision records not filing it. Next: draft the issue
      from the deferred-scope notes in
      `runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md`.
- [ ] P3 Reconcile ADR 0011 deploy topology Lane: Docs Language. Done when:
      the global `install.sh` deploy topology and the repo-local projector
      have one recorded ownership story. Next: read
      `docs/adr/0011-lean-startup-instructions.md` and the division-of-labor
      decision log open threads.

## Latest Signals

- 2026-07-03: Docs de-drift closed: `ARCHITECTURE.md` Module Map is the only
  per-module owner list, `tests/docs-drift.test.ts` enforces it both ways, and
  `check-owner-paths.ts` now checks explicitly passed `runtime/**` docs (P3
  owner-path checker task closed).
- 2026-07-03: Package docs split added from the skill-feedback pattern:
  `AGENTS.md`, `CONTEXT.md`, `TASKS.md`, and `docs/` with primary brainstorms,
  ideation, and plans moved from root `docs/`.
- 2026-07-03: PR #221 merged: skills-lock external recognition, imports
  removal with migration error, catalog-conflict blocker, lock-parse-failure
  diagnostics, missing-external restore hint.
- 2026-07-02: Projection CLI hardened: fail-closed import collisions before
  imports were retired.
- 2026-06-16: v1 landed: catalog discovery, projection planner/writer,
  snapshot, blockers, ignore rules, facade-backed CLI.

## Command Shortcuts

```bash
agent-skills status
agent-skills status --json
agent-skills sync --check --json
agent-skills list --why <skill>
agent-skills commands --json
skills/test-runner/src/test-runner.sh run --cwd runtime/agent-skills -- tests
bun --filter agent-skills typecheck
```
