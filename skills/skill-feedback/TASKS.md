# Skill Feedback Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Archive: `TASKS.archive.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` in the same pass that closes it.
- Add at most 10 open tasks per priority group.
- Keep at most 5 Latest Signals; archive or drop older ones.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.
- Leave historical plan docs unchanged unless
  `skills/skill-feedback/docs/INDEX.md` or archive wording misleads current
  agents.

Task shape:

```markdown
- [ ] P0/P1/P2 Title Lane: Correlation. Done when: observable command, test,
      or doc result. Next: `command`.
```

Lanes: CLI Contract, Capture Runtime, Closeout, Review Ledger, Correlation,
Inbox Retention, Redaction Trust, Docs Language, Verification.

## Current Priority

Human dashboard MVP closed on 2026-07-02: `reports`, `report`, `usage`,
`queue`, and the zero-arg dashboard are live. Docs de-drift closed on
2026-07-03. Codex Trusted skill identity stays deferred and native cost stays
`cost_unavailable`. Open work: the P1 human promotion loop and the P3 purge
plain-output decision.

Next safe action:

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts
```

## Now

- (empty)

## Next

- [ ] P1 Human promotion loop Lane: Docs Language. Done when: the queue makes a
      clear jump from evidence to action: "inspect these reports, edit this
      skill owner path, or record no-build"; docs explain this with one example.
      Next: write after `reports`, `report`, `usage`, and `queue` exist.

## Later

- [ ] P3 Decide purge plain-output parity Lane: CLI Contract. Done when:
      `purge` either advertises and tests `--plain`, or the smoke matrix records
      JSON-only purge output as intentional. Next: inspect
      `skillFeedbackContracts.purge` output modes and purge renderer ownership.

## Latest Signals

- 2026-07-03: Docs de-drift closed: `ARCHITECTURE.md` Module Map is the only
  per-module owner list, `src/docs-drift.test.ts` enforces it both ways, and
  the AGENTS.md Doc Drift Gate runs pass/fail commands instead of prose.
- 2026-07-02: Human dashboard MVP closed on this branch. The default dashboard
  now launches `reports`, `usage`, and `queue`; `reports`, `report`, `usage`,
  and `queue` have bounded plain output plus JSON envelopes; Branch Station
  scenarios cover primary, low-signal opt-in, empty, invalid, weak-evidence,
  no-build, duplicate, and unknown-ref paths.
- 2026-07-01: Zero-arg front door now aliases contract-backed `dashboard`,
  grouped into good and needs-work checks. `health` keeps JSON/plain output for
  scripts and agents. Unit and process-boundary tests cover empty, populated,
  and unsafe dashboard paths; review engineering signals now preserve every
  owner path on open ledger entries.
- 2026-06-30: Decision surface and bounded review plain output closed:
  `decision-surface.ts` owns review and health result assembly; runner keeps
  process envelopes and plain renderers. `review --plain` now surfaces health,
  top warning, next action, top open actions, top ledger anchors, truncation
  facts, and `full_evidence=json`; review JSON remains complete.
- 2026-06-30: Inherited Fallow cleanup closed. `audit` reports
  `introduced=0 inherited=0`; `dead-code`, `dupes`, and `health` report zero
  findings for `skills/skill-feedback`. Shared raw-object helpers removed the
  production duplicate; adjacent suppressions now document analyzer blind spots
  for public seams, test entrypoints, fixture duplication, and covered
  parser/orchestration complexity. Package runner passed 13 files, 299 tests;
  typecheck passed.
## Command Shortcuts

```bash
bun run skills/skill-feedback/src/skill-feedback-runner.ts
bun run skills/skill-feedback/src/skill-feedback-runner.ts --help
bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts review --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts correlate --plain
bun run skills/skill-feedback/src/skill-feedback-runner.ts purge --help
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
bun --filter skill-feedback-scripts typecheck
```
