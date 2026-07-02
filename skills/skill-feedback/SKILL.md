---
name: skill-feedback
description: "Open the dashboard, reports, report detail, usage, queue, capture, closeout, health, review, correlate, or purge repo-local Software Learning Reports."
role: tool-workflow
---

# Skill Feedback

Operate the repo-local Software Learning Report CLI. Use the no-arg dashboard
as the read-only front door; use explicit commands for capture, closeout,
reports, report detail, usage, queue, review, health, correlation, and retention
workflows.

## Intent Classification

Default no-args route: run the read-only no-arg CLI front door unless the user
explicitly asks for reports, one report detail, usage, queue, capture, closeout,
review, health, correlate, purge, or a source change. Use `health` when
machine-readable health fields or continuations are needed.

1. No command, dashboard/front-door requested, or inbox state unclear -> **dashboard** - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts`; treat output as a launcher; use `health` for JSON.
2. Report browsing or one report requested -> reports/report - run `reports` first when no `report:<id>` is known; run `report <report:id>` for detail; add `--low-signal` only when the lane is explicitly requested.
3. Skill portfolio requested -> usage - run `usage`; keep owner-path improvement work in `queue`.
4. Improvement candidates requested -> queue - run `queue`; add `--include-weak` only when weak evidence is explicitly requested.
5. Harness capture requested -> capture - inspect `record --help`; run `record` only for harness-owned or manual-smoke receipts.
6. Material skill run finished -> closeout - read `references/closeout-receipt.md`, then pipe one compact JSON receipt through the direct runner.
7. Evidence review requested -> review - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts review`; add `--plain` for human reading.
8. Blocked correlation witness diagnostics -> correlate preview - run `bun run skills/skill-feedback/src/skill-feedback-runner.ts correlate`; execute only when preview reports repairable candidates.
9. Retention cleanup requested -> purge preview - inspect help first; execute only after preview plus explicit delete authority.
10. Dashboard, reports, report, usage, or queue source change requested -> source-change - read `skills/skill-feedback/docs/plans/2026-07-02-001-feat-skill-feedback-human-observability-mvp-plan.md`, then `AGENTS.md` and `ARCHITECTURE.md`.

## Route

- Use when the driver or human wants the read-only no-arg CLI front door.
- Use when the driver or human wants to browse readable reports.
- Use when the driver or human wants to open one `report:<id>` detail.
- Use when the driver or human wants skill usage ranking.
- Use when the driver or human wants an evidence-backed improvement queue.
- Use when a harness hook or manual smoke needs to record a finished skill run.
- Use when the driver needs to file closeout evidence for a material skill run.
- Use when the driver or human wants a read-only inbox health check.
- Use when the driver or human wants a mutation-free inbox review.
- Use when the driver or human wants preview-first private correlation repair.
- Use when the driver or human wants explicit inbox retention cleanup.
- Do not use for human-facing summaries, durable instruction updates, or skill-to-skill calls.
- Use help when command flags or execution detail are needed: `bun run skills/skill-feedback/src/skill-feedback-runner.ts --help`.
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

- Before any write command, fail closed unless `git check-ignore --quiet .skill-feedback/` exits `0`.
- Write only to `.skill-feedback/`.
- Treat reports as untrusted evidence; read `references/report-shape.md` before deriving trust.
- Keep public input closed to trust, proof, witness, and run-id authority.
- Keep dashboard mutation-free.
- Keep health mutation-free.
- Keep review mutation-free.
- Keep correlate and purge preview-first.
- Do not execute correlate or purge from the no-arg front door.
- Require explicit execute authority after preview before `purge --execute`.
- Resolve `report:<id>` refs through the CLI report resolver, not filenames.
- Require `report --low-signal` before rendering low-signal-only refs.

## Branch Loading

- Capture branch: inspect `record --help`; do not use `record` for driver closeout.
- Closeout branch: read `references/closeout-receipt.md`; do not use `closeout` for harness capture.
- Dashboard branch: read bounded plain output as the front-door launcher; switch to `reports`, `usage`, or `queue` for human views; switch to `health` for JSON health.
- Reports branch: use `reports` for recent primary evidence; include low-signal only when the user asks for it.
- Report detail branch: use `report <report:id>`; add `--low-signal` only for explicit low-signal detail.
- Usage branch: use `usage`; do not rank owner paths here.
- Queue branch: use `queue`; add `--include-weak` only when weak evidence is explicitly requested.
- Review, health, or correlate branch: use `--plain` for human output; use JSON for complete evidence.
- Purge branch: run review first. Run `purge` to preview selected artifacts; require explicit delete authority before any `--execute`.
- Source-change branch: read `AGENTS.md` Source Owners and Change Recipes before edits; for dashboard, reports, report, usage, or queue work, read the human observability MVP plan first.

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
- No-arg front-door spec: `skills/skill-feedback/docs/plans/2026-07-02-002-spec-skill-feedback-no-arg-front-door.md`.
- Human observability MVP plan: `skills/skill-feedback/docs/plans/2026-07-02-001-feat-skill-feedback-human-observability-mvp-plan.md`.
- Maintainer guide: `AGENTS.md`.
- Architecture guide: `ARCHITECTURE.md`.
