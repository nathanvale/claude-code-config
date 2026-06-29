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

Correlation backfill shipped to main (`1c38f90a`): `correlate` preview/execute,
durable finalizer-authored candidate source, 274 tests passing. The 4 legacy
sparse diagnostics stay `insufficient_evidence` by design (KTD5), so
`no_repair_available` is correct, not a gap.

The next frontier is Trusted skill identity: the daily pilot gate is blocked on
`trusted_skill_identity_missing`, and Codex Stop has no engine-owned skill
identity source. Decide whether to name a trusted source or formally defer.

Next safe action:

```bash
bun --filter skill-feedback-scripts skill-feedback-runner -- health --plain
```

## Now

- [ ] P1 Find or defer Trusted skill identity source Lane: Capture Runtime.
      Done when: Codex Stop either gains engine-owned skill identity evidence or
      stays documented as low-signal runtime evidence, unblocking or formally
      deferring the daily pilot gate. Next: revisit
      `docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md`.

- [ ] P1 Confirm daily pilot gate status Lane: Capture Runtime. Done when:
      `health` and `review` show runtime capture, Trusted skill identity, Daily
      pilot readiness, and correlation blockers with no false-ready language.
      Next: inspect `claim_readiness` in `review` JSON after correlation branch
      checks pass.

## Next

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

- 2026-06-29: correlation backfill (U1-U5) merged to main at `1c38f90a`;
  package tests 274 pass, `tsc_check` clean.
- 2026-06-29: durable-candidate-source open question resolved in code; finalizer
  embeds `repair_candidates[]` into blocked diagnostics, execute revalidates.
- 2026-06-29: `correlate --plain` preview found 4 legacy sparse candidates, all
  `insufficient_evidence` -> `no_repair_available`; correct by design (KTD5).
- 2026-06-29: `health --plain` shows daily pilot blocked on
  `trusted_skill_identity_missing`; promoted to top of `Now`.
- 2026-06-29: package docs split added from the Component Tracker pattern.

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
