---
name: fallow
description: "Run Fallow code-quality self-review."
---

# Fallow

Use after implementation, cleanup, or review prep when JS/TS code needs
Fallow analyzer evidence.

## Skill Route Index

- Implemented work / PR prep: start with changed-code `audit --plain` when the target fit is plausible.
- Blocked PR evidence: run `doctor`, follow the first safe repair hint, then retry the same evidence command.
- Current-task reporting: list current-task findings first; keep pre-existing findings as count or status context.
- Changed-code review: use `audit`; escalate to JSON only for issue references, repair planning, structured evidence, or before/after comparison.
- Audit triage: read the attribution split first; act on introduced findings, treat inherited as base context. Zero introduced means the changeset added nothing; stop without per-finding triage.
- Introduced remove-export finding: follow the advertised Finding resolver action (the `why` target) for reachability evidence before treating removal as a candidate.
- Resolver evidence: act on the evidence grade, not absence of references as proof.
- Noisy non-audit scan on a skill/CLI folder: `dead-code`, `health`, and `dupes` carry no attribution; `add-tests` and `remove-export` run mostly false-positive against contract exports and integration-tested code; intersect with coverage per `references/workflows.md` before treating findings as real.
- Cleanup / refactor scan: use `dead-code`, `dupes`, or `health` from the request shape; use `health` first for bare cleanup asks.
- Readiness check: use `doctor` when setup, JS/TS target fit, git readiness, JSON capability, or config scope is unknown.
- Fix request: run `fix-preview` before source mutation.
- Apply request: stop unless current-task source-mutation authorization exists; read `references/safety.md`; use runner help for the apply marker.
- Suspect target: challenge the premise or retarget before treating readiness or evidence as useful.

## Owner

- Runner: `skills/fallow/scripts/fallow-runner.ts`.
- Public command contract, result vocab, and repair action ids: `skills/fallow/scripts/command-contract.ts`.
- Runner tests: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live compatibility smoke: `skills/fallow/scripts/fallow-runner.live.test.ts`.
- Command recipes: `skills/fallow/references/commands.md`.
- Workflow recipes: `skills/fallow/references/workflows.md`.
- Safety policy: `skills/fallow/references/safety.md`.
- CI adoption notes: `skills/fallow/references/ci.md`.
- Source lineage: `skills/fallow/PROVENANCE.md`.

## Workflow

- Challenge suspect targets before readiness checks.
- Run `doctor` when Fallow availability, repo shape, git readiness, or config scope is unknown on a plausible JS/TS target.
- Choose one evidence command for the current question.
- Use `commands.md` for mode selection and `--help` for exact syntax.
- Read plain summary output first for routine judgment.
- Parse runner JSON when issue references or structured evidence are needed.
- Follow runner repair hints before retrying blocked runs.
- Rerun the same evidence command after code changes.
- Report before/after summary when a rerun exists.

## Safety

- Read `references/safety.md` before mutation.
- Treat `references/safety.md` as owner for apply policy, excluded behavior, and config trust.

## References

- Read `references/commands.md` for mode selection and help pointers.
- Read `references/workflows.md` for self-review, audit attribution, cleanup, coverage-intersect, preview, apply, and rerun loops.
- Read `references/safety.md` for the mutation boundary and trust rules.
- Read `references/ci.md` only for adoption guidance; CI setup is reference-only in v1.
