# Skill Feedback Tasks

Hot-path project-manager dashboard.

Archive: `TASKS.archive.md`. Source lineage: `PROVENANCE.md`. Agent route:
`SKILL.md`. Architecture: `ARCHITECTURE.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md`.
- Add at most 10 open tasks per priority group.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Correlation. Done when: observable command, test,
      or doc result. Next: `command`.
```

Lanes: CLI Contract, Capture Runtime, Closeout, Review Ledger, Correlation,
Inbox Retention, Redaction Trust, Docs Language, Verification.

## Current Priority

Keep the correlation backfill repair path honest: current preview classifies 4
blocked diagnostics as `insufficient_evidence` and reports no available repair.
Execute can write only after durable private evidence exists, or the execute
scope narrows to candidates that current source can validate.

Next safe action:

```bash
sed -n '207,299p' skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md
```

## Now

- [ ] P0 Define durable correlation backfill candidate source Lane:
      Correlation. Done when: `correlate --execute` writes witnesses only from
      private candidate evidence that survives current validation, or the execute
      scope is narrowed to candidates with enough private source. Next: finish
      `skills/skill-feedback/docs/plans/2026-06-28-001-fix-skill-feedback-correlation-backfill-plan.md`
      U1-U4 against `src/skill-feedback-runner.ts`.

- [ ] P0 Re-run package verification for the correlation branch Lane:
      Verification. Done when: skill-feedback tests, typecheck, command
      discovery/help/parser/runtime checks, and branch station evidence pass
      after current dirty source changes. Next:
      `skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src`.

- [ ] P1 Confirm daily pilot gate status Lane: Capture Runtime. Done when:
      `health` and `review` show runtime capture, Trusted skill identity, Daily
      pilot readiness, and correlation blockers with no false-ready language.
      Next: inspect `claim_readiness` in `review` JSON after correlation branch
      checks pass.

## Next

- [ ] P1 Find or defer Trusted Codex skill identity source Lane: Capture
      Runtime. Done when: Codex Stop either gains engine-owned skill identity
      evidence or stays documented as low-signal runtime evidence. Next: revisit
      `docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md`.

- [ ] P1 Decide native skill-attributed cost source Lane: Capture Runtime. Done
      when: cost remains `cost_unavailable` by design or a trusted runtime source
      is named with owner tests. Next: read `references/report-shape.md` Runtime
      Telemetry and Cost Attribution.

- [ ] P1 Decide whether `report:<id>` needs a resolver command Lane: CLI
      Contract. Done when: real downstream usage proves a command is worth owning
      or the documented JSON lookup remains enough. Next: keep using review JSON
      `review_units[*].report_ids`.

## Later

- [ ] P2 Temp artifact GC contract Lane: Inbox Retention. Done when:
      interrupted `.json.tmp-*` handling has an explicit cleanup command or stays
      invalid-health evidence only. Next: open a small CLI contract plan before
      adding deletion behavior.

- [ ] P2 Correlation artifact retention Lane: Inbox Retention. Done when:
      `.correlation/` witness and diagnostic retention has a separate preview and
      execute contract, or purge keeps skipping them. Next: read
      `references/report-shape.md` Purge and Correlate sections.

- [ ] P2 Pilot marker cleanup workflow Lane: Closeout. Done when:
      `pilot_started_at` has an owner command or remains manual source evidence
      with no broad purge coupling. Next: revisit the v1 report-card plan
      deferred work.

## Latest Signals

- 2026-06-29: source brainstorms, ideation artifacts, and plans copied under
  `skills/skill-feedback/docs/` with `docs/INDEX.md`.
- 2026-06-29: `correlate --plain` preview found 4 candidates, all
  `insufficient_evidence`, with next action `no_repair_available`.
- 2026-06-29: package docs split added from the Component Tracker pattern.
- 2026-06-29: ICA vocabulary pass identified missing `Report card`, `Owner path`,
  `HealthResultData Interface`, `Command facade contract`, and `Branch Station
  Catalog` terms.
- 2026-06-29: explorers found no major drift between current `SKILL.md`,
  `CONTEXT.md`, later plans, and current source.

## Command Shortcuts

```bash
bun --filter skill-feedback-scripts skill-feedback-runner -- --help
bun --filter skill-feedback-scripts skill-feedback-runner -- health --plain
bun --filter skill-feedback-scripts skill-feedback-runner -- review --plain
bun --filter skill-feedback-scripts skill-feedback-runner -- correlate --plain
bun --filter skill-feedback-scripts skill-feedback-runner -- purge --help
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
bun --filter skill-feedback-scripts typecheck
```
