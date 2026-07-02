# Provenance

- Source plan: `runtime/agent-skills/docs/plans/2026-06-16-001-feat-agent-skills-local-projection-plan.md`.
- Division-of-labor plan: `runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md`.
- Source brainstorm: `runtime/agent-skills/docs/brainstorms/2026-06-16-agent-skills-local-projection-requirements.md`.
- Pivot brainstorm: `runtime/agent-skills/docs/brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md`.
- Division-of-labor decisions: `docs/decisions/2026-07-02-npx-skills-division-of-labor.md`.
- Lock-boundary rule: `docs/adr/0016-ownership-ledger-grain-and-lock-boundary.md`.
- Facade lane: `skills/cli-author/references/cli-command-facade.md`.
- Facade engine: `runtime/cli-command-facade/`.
- Package docs anatomy: `skills/skill-feedback/`.

## Notes

- v1 projects live symlinks from the repo catalog; no copies, no marketplace.
- Sync fails closed on blockers; the CLI never deletes unmanaged entries.
- `skills-lock.json` is read-only input owned by the community `skills` CLI.
- `imports:` was removed in the division-of-labor plan; configs carrying it
  fail with a migration error naming `bunx skills add`.
- The snapshot and projection links are generated state and belong outside
  git; tracked `.agents/skills` catalogs are supported as source.
- The source-linked bin is a temporary local-consumption contract until
  publish readiness lands (`TASKS.md`).
