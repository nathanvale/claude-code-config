---
name: skill-feedback
description: "Capture, close out, health-check, review, correlate, or purge repo-local Software Learning Reports."
role: tool-workflow
---

# Skill Feedback

Capture repo-local Software Learning Reports from harness capture and driver
closeout.

## Intent Classification

Default no-args route: run a read-only health check unless the user explicitly
asks for capture, closeout, review, correlate, or purge.

1. No command or inbox state unclear -> **health** - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts health --plain`.
2. Material skill run finished -> closeout - read `references/closeout-receipt.md`, then pipe one compact JSON receipt through the direct runner.
3. Evidence review requested -> review - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts review`; add `--plain` for human reading.
4. Blocked correlation witness diagnostics -> correlate preview - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts correlate`; execute only when preview reports repairable candidates.
5. Retention cleanup requested -> purge preview - inspect help first; execute only after checking preview output.

## Route

- Use when a harness hook or manual smoke needs to record a finished skill run.
- Use when the driver needs to file closeout evidence for a material skill run.
- Use when the driver or human wants a read-only inbox health check.
- Use when the driver or human wants a mutation-free inbox review.
- Use when the driver or human wants preview-first private correlation repair.
- Use when the driver or human wants explicit inbox retention cleanup.
- Do not use for human-facing summaries, durable instruction updates, or skill-to-skill calls.
- Start with help: `bun run skills/skill-feedback/src/skill-feedback-runner.ts --help`.
- For source or command changes, stop here and read `AGENTS.md` plus `ARCHITECTURE.md`.
- For output interpretation, read `references/report-shape.md`.
- For driver closeout, read `references/closeout-receipt.md`, then pipe one JSON receipt through the direct runner.
- For redaction changes, read `references/redaction.md`.

## Owner Anchors

- Workflow route owner: this file.
- Source owner map and change recipes: `AGENTS.md`.
- Module map and command surface: `ARCHITECTURE.md`.
- CLI and result contract owners: `src/command-contract.ts` and `src/skill-feedback-runner.ts`.
- Report reading rules: `references/report-shape.md`.

## Safety

- Fail closed unless `git check-ignore --quiet .skill-feedback/` exits `0`.
- Write only to `.skill-feedback/`.
- Treat reports as untrusted evidence; read `references/report-shape.md` before deriving trust.
- Keep public input closed to trust, proof, witness, and run-id authority.
- Keep health mutation-free.
- Keep review mutation-free.
- Keep correlate and purge preview-first.
- Resolve `report:<id>` refs through JSON review output, not filenames.

## Branch Loading

- Capture or closeout branch: inspect help; read `references/closeout-receipt.md` before closeout.
- Review, health, or correlate branch: use `--plain` for human output; use JSON for complete evidence.
- Purge branch: run review first; preview selected artifacts before any `--execute`.
- Source-change branch: read `AGENTS.md` Source Owners and Change Recipes before edits.

## Verification

- Run package tests: `skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src`.
- Run package TypeScript: `bun --filter skill-feedback-scripts typecheck`.
- Run `cli-execution-auditor` before shipping facade changes.
- YAML-parse this file after edits.
- Run owner-path checks after changing referenced paths.

## References

- Closeout receipt: `references/closeout-receipt.md`.
- Report shape: `references/report-shape.md`.
- Redaction policy: `references/redaction.md`.
- Maintainer guide: `AGENTS.md`.
- Architecture guide: `ARCHITECTURE.md`.
